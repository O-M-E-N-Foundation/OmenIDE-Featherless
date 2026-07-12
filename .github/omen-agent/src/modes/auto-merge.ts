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

		const rabbitReview = await gh.getLatestCodeRabbitReview(env, pr.number);
		if (!gh.codeRabbitApproved(rabbitReview)) {
			console.log(`PR #${pr.number}: waiting for CodeRabbit APPROVED (got ${rabbitReview?.state ?? 'none'})`);
			continue;
		}

		const unresolved = await gh.listUnresolvedCodeRabbitThreads(env, pr.number);
		if (unresolved.length) {
			console.log(`PR #${pr.number}: ${unresolved.length} unresolved CodeRabbit thread(s)`);
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
				'### Omen auto-merge\n\nSquash-merged to `main` after CodeRabbit **approval**, resolved review threads, and security checks passed.\n\n**QA is post-merge.** Please verify in a build/release; file a new issue if you find a regression.',
			);
			// Linked issues close via "Fixes #N"; clear in-review if still open somehow.
			const linked = await gh.listClosingIssueNumbers(env, pr.number);
			for (const issueNumber of linked) {
				await gh.removeIssueLabel(env, issueNumber, 'in-review');
				await gh.removeIssueLabel(env, issueNumber, 'ai-in-flight');
				await gh.removeIssueLabel(env, issueNumber, 'ready-for-ai');
			}
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
	// Re-evaluate merge readiness from CodeRabbit state (does not invent approval).
	if (!env.prNumber) {
		throw new Error('OMEN_PR_NUMBER required');
	}
	const pr = await gh.getPull(env, env.prNumber);
	const unresolved = await gh.listUnresolvedCodeRabbitThreads(env, pr.number);
	const rabbitReview = await gh.getLatestCodeRabbitReview(env, pr.number);
	const approved = gh.codeRabbitApproved(rabbitReview) && unresolved.length === 0;
	await gh.createCheckRun(env, {
		name: 'omen-review-clean',
		headSha: pr.head.sha,
		conclusion: approved ? 'success' : rabbitReview ? 'neutral' : 'neutral',
		title: approved
			? 'CodeRabbit approved + threads clear'
			: unresolved.length
				? `${unresolved.length} CodeRabbit thread(s) open`
				: rabbitReview
					? `Waiting for CodeRabbit approval (state: ${rabbitReview.state})`
					: 'Waiting for CodeRabbit',
		summary: [
			`CodeRabbit review state: ${rabbitReview?.state ?? '(none)'}`,
			`Unresolved CodeRabbit threads: ${unresolved.length}`,
		].join('\n'),
	});
}
