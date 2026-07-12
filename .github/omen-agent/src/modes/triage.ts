/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { AgentEnv } from '../config.ts';
import { runAgentLoop } from '../agent-loop.ts';
import * as gh from '../github.ts';
import { baseTools, finishTool } from '../tools.ts';

const TRIAGE_LABELS = new Set([
	'triage:needs-info',
	'triage:duplicate',
	'security',
]);
// needs-human is reserved for implement/address-review with actionable questions.

export async function runTriage(env: AgentEnv): Promise<void> {
	if (!env.issueNumber) {
		throw new Error('OMEN_ISSUE_NUMBER required for triage');
	}
	const issue = await gh.getIssue(env, env.issueNumber);
	const tools = [
		...baseTools().filter(t => ['read_file', 'list_dir', 'gh_comment', 'gh_add_labels'].includes(t.function.name)),
		finishTool('finish_triage', 'Complete triage', {
			summary: { type: 'string' },
			suggested_labels: { type: 'array', items: { type: 'string' } },
			needs_info: { type: 'boolean' },
			comment_markdown: { type: 'string' },
		}, ['summary', 'suggested_labels', 'needs_info', 'comment_markdown']),
	];

	const ctx = await runAgentLoop({
		env,
		systemPromptName: 'triage',
		userPrompt: [
			`Issue #${issue.number}: ${issue.title}`,
			`URL: ${issue.html_url}`,
			`Existing labels: ${issue.labels.map(l => l.name).join(', ') || '(none)'}`,
			'',
			issue.body || '(no body)',
		].join('\n'),
		tools,
	});

	const finished = ctx.finished;
	const comment = String(finished?.comment_markdown || finished?.summary || 'Triage completed.');
	await gh.commentOnIssue(env, issue.number, `### Omen triage\n\n${comment}`);

	const suggested = Array.isArray(finished?.suggested_labels) ? finished.suggested_labels as string[] : [];
	const labels = suggested.filter(l => TRIAGE_LABELS.has(l));
	if (finished?.needs_info) {
		labels.push('triage:needs-info');
	}
	const unique = [...new Set(labels)].filter(l => l !== 'ready-for-ai');
	if (unique.length) {
		await gh.setIssueLabels(env, issue.number, unique);
	}
}
