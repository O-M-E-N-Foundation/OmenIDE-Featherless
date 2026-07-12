/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { AgentEnv } from '../config.ts';
import { runAgentLoop } from '../agent-loop.ts';
import * as gh from '../github.ts';
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

	const tools = [
		...baseTools(),
		finishTool('finish_implement', 'Finish implementation', {
			status: { type: 'string', enum: ['ok', 'needs-human'] },
			branch: { type: 'string' },
			pr_url: { type: 'string' },
			message: { type: 'string' },
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
		].join('\n'),
		tools,
	});

	await gh.removeIssueLabel(env, issue.number, 'ai-in-flight');

	const finished = ctx.finished;
	if (!finished || finished.status === 'needs-human') {
		await gh.setIssueLabels(env, issue.number, ['needs-human']);
		await gh.commentOnIssue(
			env,
			issue.number,
			`### Omen implement\n\nNeeds human attention.\n\n${String(finished?.message || 'Agent did not complete successfully.')}`,
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
