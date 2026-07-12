/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { AgentEnv } from '../config.ts';
import { runAgentLoop } from '../agent-loop.ts';
import * as gh from '../github.ts';
import { formatNeedsHumanComment, formatRejectedNeedsHumanComment, isActionableNeedsHuman } from '../needs-human.ts';
import { baseTools, finishTool } from '../tools.ts';

export async function runImplement(env: AgentEnv): Promise<void> {
	if (!env.issueNumber) {
		throw new Error('OMEN_ISSUE_NUMBER required for implement');
	}
	const issue = await gh.getIssue(env, env.issueNumber);
	if (issue.labels.some(l => l.name === 'security')) {
		await gh.removeIssueLabel(env, issue.number, 'ready-for-ai');
		await gh.commentOnIssue(env, issue.number, 'Refusing implement: issue is labeled `security`.');
		return;
	}

	await gh.setIssueLabels(env, issue.number, ['ai-in-flight']);
	await gh.removeIssueLabel(env, issue.number, 'ready-for-ai');
	await gh.removeIssueLabel(env, issue.number, 'needs-human');

	const tools = [
		...baseTools(),
		finishTool('finish_implement', 'Finish implementation', {
			status: { type: 'string', enum: ['ok', 'needs-human'] },
			branch: { type: 'string' },
			pr_url: { type: 'string' },
			message: { type: 'string' },
			blocker: { type: 'string', description: 'Required when status=needs-human: concrete blocker' },
			questions: {
				type: 'array',
				items: { type: 'string' },
				description: 'Required when status=needs-human: actionable questions with recommended defaults',
			},
			unblock_steps: {
				type: 'string',
				description: 'Required when status=needs-human: exact human steps to resume',
			},
		}, ['status', 'message']),
	];

	const slug = issue.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'work';
	const branchHint = `ai/issue-${issue.number}-${slug}`;

	const ctx = await runAgentLoop({
		env,
		systemPromptName: 'implement',
		userPrompt: [
			`Implement GitHub issue #${issue.number}.`,
			`Suggested branch name: ${branchHint}`,
			`Title: ${issue.title}`,
			`URL: ${issue.html_url}`,
			'',
			issue.body || '(no body)',
			'',
			'Create commits on the suggested branch, push with gh/git, and open a PR labeled ai-authored that Fixes this issue.',
			'',
			'IMPORTANT: ready-for-ai already approved shipping. Choose sensible defaults for unspecified UX/timeout details and implement. Do not escalate for "architectural complexity".',
		].join('\n'),
		tools,
	});

	await gh.removeIssueLabel(env, issue.number, 'ai-in-flight');

	const finished = ctx.finished;
	if (!finished) {
		await gh.commentOnIssue(
			env,
			issue.number,
			formatRejectedNeedsHumanComment('Agent exited without finish_implement.'),
		);
		return;
	}

	if (finished.status === 'needs-human') {
		if (!isActionableNeedsHuman(finished)) {
			await gh.commentOnIssue(
				env,
				issue.number,
				formatRejectedNeedsHumanComment(String(finished.message || finished.blocker || '')),
			);
			// Do not apply needs-human — leave the issue easy to re-queue with ready-for-ai.
			return;
		}

		await gh.setIssueLabels(env, issue.number, ['needs-human']);
		await gh.commentOnIssue(
			env,
			issue.number,
			formatNeedsHumanComment(finished, { issueNumber: issue.number }),
		);
		return;
	}

	const prUrl = finished.pr_url ? String(finished.pr_url) : '';
	await gh.commentOnIssue(
		env,
		issue.number,
		`### Omen implement\n\n${String(finished.message || 'Implementation PR opened.')}${prUrl ? `\n\nPR: ${prUrl}` : ''}\n\nCodeRabbit + security CI will run next; merge is automatic when clean. QA is post-merge.`,
	);
}
