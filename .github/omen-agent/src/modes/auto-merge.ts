/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { AgentEnv } from '../config.ts';
import * as gh from '../github.ts';

const REQUIRED_CHECKS = ['CodeQL', 'secret-scan', 'pr-hygiene', 'omen-review-clean'];

function checkOk(runs: Array<{ name: string; status: string; conclusion: string | null }>, name: string): boolean {
	const matches = runs.filter(r => r.name === name || r.name.startsWith(name));
	if (!matches.length) {
		return false;
	}
	const latest = matches[matches.length - 1];
	return latest.status === 'completed' && latest.conclusion === 'success';
}

export async function runAutoMerge(env: AgentEnv): Promise<void> {
	const prNumbers = env.prNumber
		? [env.prNumber]
		: (await gh.listOpenAiPulls(env)).map(p => p.number);

	for (const prNumber of prNumbers) {
		const pr = await gh.getPull(env, prNumber);
		const labels = pr.labels.map(l => l.name);
		if (!labels.includes('ai-authored')) {
			continue;
		}
		if (pr.draft || pr.merged) {
			continue;
		}
		if (labels.includes('needs-human') || labels.includes('security')) {
			continue;
		}

		const { issueComments } = await gh.listPullComments(env, pr.number);
		const hasCodeRabbit = issueComments.some(c => gh.isCodeRabbitLogin(c.user.login));
		if (!hasCodeRabbit) {
			console.log(`PR #${pr.number}: waiting for CodeRabbit`);
			continue;
		}

		const { check_runs } = await gh.listCheckRunsForRef(env, pr.head.sha);
		const missing = REQUIRED_CHECKS.filter(name => !checkOk(check_runs, name));
		if (missing.length) {
			console.log(`PR #${pr.number}: missing/red checks: ${missing.join(', ')}`);
			continue;
		}

		try {
			await gh.mergePull(env, pr.number);
			await gh.commentOnIssue(
				env,
				pr.number,
				'### Omen auto-merge\n\nSquash-merged to `main` after CodeRabbit + security checks passed.\n\n**QA is post-merge.** Please verify in a build/release; file a new issue if you find a regression.',
			);
			console.log(`Merged PR #${pr.number}`);
		} catch (err) {
			await gh.addPullLabels(env, pr.number, ['needs-human']);
			await gh.commentOnIssue(
				env,
				pr.number,
				`### Omen auto-merge\n\nMerge failed: ${err instanceof Error ? err.message : String(err)}\n\nLabeled \`needs-human\`.`,
			);
		}
	}
}

export async function runMergeReady(env: AgentEnv): Promise<void> {
	// Compatibility alias used by workflows that only need a clean check re-evaluation.
	if (!env.prNumber) {
		throw new Error('OMEN_PR_NUMBER required');
	}
	const pr = await gh.getPull(env, env.prNumber);
	const { issueComments, reviewComments } = await gh.listPullComments(env, pr.number);
	const rabbit = [...issueComments, ...reviewComments].filter(c => gh.isCodeRabbitLogin(c.user.login));
	const conclusion = rabbit.length ? 'success' : 'neutral';
	await gh.createCheckRun(env, {
		name: 'omen-review-clean',
		headSha: pr.head.sha,
		conclusion: conclusion === 'success' ? 'success' : 'neutral',
		title: conclusion === 'success' ? 'CodeRabbit seen' : 'Waiting for CodeRabbit',
		summary: conclusion === 'success'
			? 'CodeRabbit has reviewed; ensure address-review marked clean before merge.'
			: 'No CodeRabbit activity yet.',
	});
}
