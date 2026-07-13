/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { AgentEnv } from '../config.ts';
import * as gh from '../github.ts';

const REQUIRED_CHECKS = ['CodeQL', 'secret-scan', 'pr-hygiene', 'omen-typecheck', 'omen-review-clean'];

function checkOk(runs: Array<{ name: string; status: string; conclusion: string | null; completed_at?: string | null }>, name: string): boolean {
	const matches = runs
		.filter(r => r.name === name || r.name.startsWith(name))
		.sort((a, b) => String(a.completed_at || '').localeCompare(String(b.completed_at || '')));
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

	let blocked = 0;
	let merged = 0;

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
			console.log(`PR #${pr.number}: skipped (needs-human/security)`);
			blocked++;
			continue;
		}

		const rabbitReview = await gh.getLatestCodeRabbitReview(env, pr.number);
		if (!gh.codeRabbitApproved(rabbitReview)) {
			console.log(`PR #${pr.number}: waiting for CodeRabbit APPROVED (got ${rabbitReview?.state ?? 'none'})`);
			blocked++;
			continue;
		}

		const unresolved = await gh.listUnresolvedCodeRabbitThreads(env, pr.number);
		if (unresolved.length) {
			console.log(`PR #${pr.number}: ${unresolved.length} unresolved CodeRabbit thread(s)`);
			blocked++;
			continue;
		}

		// Ensure omen-review-clean is green now that CodeRabbit has approved.
		await runMergeReady({ ...env, prNumber: pr.number });

		const { check_runs } = await gh.listCheckRunsForRef(env, pr.head.sha);
		const missing = REQUIRED_CHECKS.filter(name => !checkOk(check_runs, name));
		if (missing.length) {
			console.log(`PR #${pr.number}: missing/red checks: ${missing.join(', ')}`);
			// Keep branch current so strict status checks can pass on next sweep.
			try {
				await gh.updatePullBranch(env, pr.number);
				console.log(`PR #${pr.number}: requested update-branch from main`);
			} catch (err) {
				console.warn(`PR #${pr.number}: update-branch failed:`, err instanceof Error ? err.message : err);
			}
			blocked++;
			continue;
		}

		try {
			await gh.mergePull(env, pr.number);
			await gh.commentOnIssue(
				env,
				pr.number,
				'### Omen auto-merge\n\nSquash-merged to `main` after CodeRabbit **approval**, resolved review threads, and security checks passed.\n\n**QA is post-merge.** Please verify in a build/release; file a new issue if you find a regression.',
			);
			const linked = await gh.listClosingIssueNumbers(env, pr.number);
			for (const issueNumber of linked) {
				await gh.removeIssueLabel(env, issueNumber, 'in-review');
				await gh.removeIssueLabel(env, issueNumber, 'ai-in-flight');
				await gh.removeIssueLabel(env, issueNumber, 'ready-for-ai');
			}
			console.log(`Merged PR #${pr.number}`);
			merged++;
		} catch (err) {
			await gh.addPullLabels(env, pr.number, ['needs-human']);
			await gh.commentOnIssue(
				env,
				pr.number,
				`### Omen auto-merge\n\nMerge failed: ${err instanceof Error ? err.message : String(err)}\n\nLabeled \`needs-human\`.`,
			);
			blocked++;
		}
	}

	console.log(`auto-merge done: merged=${merged} blocked=${blocked} considered=${prNumbers.length}`);
}

export async function runMergeReady(env: AgentEnv): Promise<void> {
	// Re-evaluate merge readiness from CodeRabbit state (does not invent approval).
	if (!env.prNumber) {
		throw new Error('OMEN_PR_NUMBER required');
	}
	const pr = await gh.getPull(env, env.prNumber);
	if (!pr.labels.some(l => l.name === 'ai-authored')) {
		await gh.ensureAiAuthoredLabel(env, pr.number);
	}
	const unresolved = await gh.listUnresolvedCodeRabbitThreads(env, pr.number);
	const rabbitReview = await gh.getLatestCodeRabbitReview(env, pr.number);
	const typecheckFailure = await gh.getTypecheckFailureSummary(env, pr.head.sha);
	const approved = gh.codeRabbitApproved(rabbitReview) && unresolved.length === 0 && !typecheckFailure;
	await gh.createCheckRun(env, {
		name: 'omen-review-clean',
		headSha: pr.head.sha,
		conclusion: approved ? 'success' : 'neutral',
		title: approved
			? 'CodeRabbit approved + threads clear'
			: typecheckFailure
				? 'omen-typecheck still failing'
				: unresolved.length
					? `${unresolved.length} CodeRabbit thread(s) open`
					: rabbitReview
						? `Waiting for CodeRabbit approval (state: ${rabbitReview.state})`
						: 'Waiting for CodeRabbit',
		summary: [
			`CodeRabbit review state: ${rabbitReview?.state ?? '(none)'}`,
			`Unresolved CodeRabbit threads: ${unresolved.length}`,
			`Typecheck failing: ${Boolean(typecheckFailure)}`,
		].join('\n'),
	});
	console.log(`merge-ready PR #${pr.number}: ${approved ? 'success' : 'neutral'} (review=${rabbitReview?.state ?? 'none'})`);
}
