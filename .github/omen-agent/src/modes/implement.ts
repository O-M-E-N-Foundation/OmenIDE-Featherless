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

	const comments = await gh.listIssueComments(env, issue.number);
	const recentComments = comments
		.slice(-8)
		.map(c => `### Comment by ${c.user.login} (${c.created_at})\n${c.body.slice(0, 4000)}`)
		.join('\n\n');

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
		requireFinish: true,
		userPrompt: [
			`Implement GitHub issue #${issue.number}.`,
			`Suggested branch name: ${branchHint}`,
			`Title: ${issue.title}`,
			`URL: ${issue.html_url}`,
			`maxSteps budget: ${env.maxSteps} — prioritize write_file/edit_file early; do not burn the budget exploring.`,
			'',
			'## Issue body',
			issue.body || '(no body)',
			'',
			'## Recent issue comments (follow the latest implementation plan if present)',
			recentComments || '(no comments)',
			'',
			'## Required outcome',
			'1. Create/edit implementation files (write_file/edit_file) within the first ~15 tool steps.',
			'2. git checkout -b, commit, push.',
			'3. Open PR labeled ai-authored with Fixes #' + issue.number + ' via gh_create_pr.',
			'4. Call finish_implement(status=ok, pr_url=...).',
			'',
			'ready-for-ai already approved shipping. Choose sensible defaults. Do not escalate for complexity.',
		].join('\n'),
		tools,
	});

	await gh.removeIssueLabel(env, issue.number, 'ai-in-flight');

	const finished = ctx.finished;
	if (!finished) {
		await gh.commentOnIssue(
			env,
			issue.number,
			[
				'### Omen implement — failed (no finish)',
				'',
				'The agent exhausted its step budget or stopped without calling `finish_implement` and **did not open a PR**.',
				'',
				'This is an agent-runner failure, not a missing human decision.',
				'',
				'**What happens next:** maintainers can re-add `ready-for-ai` to retry after agent fixes land on `main`.',
			].join('\n'),
		);
		throw new Error('Implement agent exited without finish_implement');
	}

	if (finished.status === 'needs-human') {
		if (!isActionableNeedsHuman(finished)) {
			await gh.commentOnIssue(
				env,
				issue.number,
				formatRejectedNeedsHumanComment(String(finished.message || finished.blocker || '')),
			);
			throw new Error('Implement agent returned non-actionable needs-human');
		}

		await gh.setIssueLabels(env, issue.number, ['needs-human']);
		await gh.commentOnIssue(
			env,
			issue.number,
			formatNeedsHumanComment(finished, { issueNumber: issue.number }),
		);
		return;
	}

	if (!finished.pr_url) {
		await gh.commentOnIssue(
			env,
			issue.number,
			[
				'### Omen implement — incomplete',
				'',
				String(finished.message || 'Agent reported ok but did not provide pr_url.'),
				'',
				'Re-add `ready-for-ai` to retry.',
			].join('\n'),
		);
		throw new Error('Implement agent finished ok without pr_url');
	}

	const prUrl = String(finished.pr_url);
	await gh.setIssueLabels(env, issue.number, ['in-review']);
	await gh.commentOnIssue(
		env,
		issue.number,
		`### Omen implement\n\n${String(finished.message || 'Implementation PR opened.')}\n\nPR: ${prUrl}\n\nLabeled \`in-review\`. CodeRabbit + security CI will run next; merge is automatic when clean. QA is post-merge.`,
	);
}
