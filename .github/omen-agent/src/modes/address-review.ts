/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { AgentEnv } from '../config.ts';
import { runAgentLoop } from '../agent-loop.ts';
import * as gh from '../github.ts';
import { formatNeedsHumanComment, isActionableNeedsHuman } from '../needs-human.ts';
import { baseTools, finishTool } from '../tools.ts';

function formatThreads(threads: gh.ReviewThreadSummary[]): string {
	return threads
		.map((t, i) => {
			const path = t.path ? ` (${t.path})` : '';
			return `#### [${i + 1}] ${t.author}${path}\nthread_id: ${t.id}\n${t.body.slice(0, 3000)}`;
		})
		.join('\n\n---\n\n');
}

export async function runAddressReview(env: AgentEnv): Promise<void> {
	if (!env.prNumber) {
		throw new Error('OMEN_PR_NUMBER required for address-review');
	}
	const pr = await gh.getPull(env, env.prNumber);
	if (!pr.labels.some(l => l.name === 'ai-authored')) {
		console.log('Skipping non ai-authored PR');
		return;
	}
	if (pr.labels.some(l => l.name === 'needs-human' || l.name === 'security')) {
		console.log('Skipping PR with needs-human/security');
		return;
	}

	const round = Number(process.env.OMEN_REVIEW_ROUND || '1');
	if (round > env.maxReviewRounds) {
		const exhausted = {
			blocker: `Exceeded max CodeRabbit fix rounds (${env.maxReviewRounds}).`,
			questions: [
				'Should we raise OMEN_MAX_REVIEW_ROUNDS and retry address-review? (recommended: yes, set to 5)',
				'Or close this PR and open a narrower follow-up issue? (recommended: retry first)',
			],
			unblock_steps: 'Comment your choice, remove `needs-human`, then re-run the Omen address-review workflow (or push a commit to the PR).',
			message: 'Review fix rounds exhausted.',
		};
		await gh.addPullLabels(env, pr.number, ['needs-human']);
		await gh.commentOnIssue(env, pr.number, formatNeedsHumanComment(exhausted, { issueNumber: pr.number }));
		await gh.createCheckRun(env, {
			name: 'omen-review-clean',
			headSha: pr.head.sha,
			conclusion: 'failure',
			title: 'Review fix rounds exhausted',
			summary: exhausted.blocker,
		});
		throw new Error(exhausted.blocker);
	}

	const unresolvedAtStart = await gh.listUnresolvedCodeRabbitThreads(env, pr.number);
	const startSha = pr.head.sha;
	const typecheckFailure = await gh.getTypecheckFailureSummary(env, startSha);
	const { issueComments, reviewComments } = await gh.listPullComments(env, pr.number);
	const rabbitComments = [
		...issueComments.filter(c => gh.isCodeRabbitLogin(c.user.login)),
		...reviewComments.filter(c => gh.isCodeRabbitLogin(c.user.login)),
	];
	const rabbitReview = await gh.getLatestCodeRabbitReview(env, pr.number);

	if (!unresolvedAtStart.length && !rabbitComments.length && !typecheckFailure) {
		await gh.createCheckRun(env, {
			name: 'omen-review-clean',
			headSha: pr.head.sha,
			conclusion: 'neutral',
			title: 'Waiting for CodeRabbit',
			summary: 'No CodeRabbit review activity found yet.',
		});
		return;
	}

	if (!unresolvedAtStart.length && !typecheckFailure && gh.codeRabbitApproved(rabbitReview)) {
		await gh.createCheckRun(env, {
			name: 'omen-review-clean',
			headSha: pr.head.sha,
			conclusion: 'success',
			title: 'CodeRabbit approved',
			summary: 'No unresolved CodeRabbit threads; typecheck clean; latest CodeRabbit review is APPROVED.',
		});
		return;
	}

	// Threads open (or CHANGES_REQUESTED / COMMENTED without approval) → agent must edit.
	if (!unresolvedAtStart.length && !typecheckFailure && rabbitReview && !gh.codeRabbitApproved(rabbitReview)) {
		console.log(`No open threads but CodeRabbit state is ${rabbitReview.state}; waiting for APPROVE`);
		await gh.createCheckRun(env, {
			name: 'omen-review-clean',
			headSha: pr.head.sha,
			conclusion: 'neutral',
			title: `Waiting for CodeRabbit APPROVED (got ${rabbitReview.state})`,
			summary: 'Threads clear; CodeRabbit has not approved yet.',
		});
		return;
	}

	const feedback = unresolvedAtStart.length
		? formatThreads(unresolvedAtStart)
		: rabbitComments
			.slice(-20)
			.map(c => {
				const path = 'path' in c && c.path ? ` (${c.path})` : '';
				return `#### ${c.user.login}${path}\n${c.body.slice(0, 3000)}`;
			})
			.join('\n\n---\n\n');

	const tools = [
		...baseTools(),
		finishTool('finish_address_review', 'Finish addressing review', {
			clean: { type: 'boolean' },
			needs_human: { type: 'boolean' },
			message: { type: 'string' },
			blocker: { type: 'string' },
			questions: { type: 'array', items: { type: 'string' } },
			unblock_steps: { type: 'string' },
			resolved_thread_ids: {
				type: 'array',
				items: { type: 'string' },
				description: 'GraphQL thread ids you fixed and want resolved',
			},
		}, ['clean', 'message']),
	];

	const ctx = await runAgentLoop({
		env,
		systemPromptName: 'address-review',
		requireFinish: true,
		finishToolName: 'finish_address_review',
		userPrompt: [
			`PR #${pr.number}: ${pr.title}`,
			`Branch: ${pr.head.ref}`,
			`Head SHA: ${pr.head.sha}`,
			`URL: ${pr.html_url}`,
			`Review round: ${round}/${env.maxReviewRounds}`,
			`Latest CodeRabbit review state: ${rabbitReview?.state ?? '(none)'}`,
			`Unresolved CodeRabbit threads: ${unresolvedAtStart.length}`,
			`omen-typecheck failing: ${typecheckFailure ? 'yes' : 'no'}`,
			'',
			'HARD RULES:',
			'- You MUST call write_file or edit_file for each valid finding before finishing.',
			'- Explore-only runs are a FAILURE. Do not finish without code edits + git push.',
			'- Client must typecheck: after edits run `npm run typecheck-client` (npm ci first if needed) and fix all TS errors before finish.',
			`- Checkout: git fetch origin ${pr.head.ref} && git checkout ${pr.head.ref}`,
			'- Push to that branch only (never main).',
			'- After fixing, put thread_id values in finish_address_review.resolved_thread_ids.',
			'- clean=true only when every unresolved CodeRabbit thread is fixed AND typecheck is clean.',
			'',
			typecheckFailure
				? ['## COMPILE / TYPECHECK FAILURES (must fix)', typecheckFailure, ''].join('\n')
				: '',
			'CodeRabbit unresolved feedback:',
			feedback || '(none)',
		].join('\n'),
		tools,
	});

	const finished = ctx.finished;
	if (finished?.needs_human) {
		if (!isActionableNeedsHuman(finished)) {
			await gh.commentOnIssue(
				env,
				pr.number,
				[
					'### Omen address-review — escalation rejected',
					'',
					'Agent requested needs-human without actionable questions. Continuing without that label.',
					'',
					`> ${String(finished.message || '')}`,
				].join('\n'),
			);
		} else {
			await gh.addPullLabels(env, pr.number, ['needs-human']);
			await gh.commentOnIssue(env, pr.number, formatNeedsHumanComment(finished, { issueNumber: pr.number }));
			await gh.createCheckRun(env, {
				name: 'omen-review-clean',
				headSha: pr.head.sha,
				conclusion: 'failure',
				title: 'Needs human',
				summary: String(finished.blocker || finished.message || 'Agent requested human help'),
			});
			throw new Error(String(finished.blocker || 'needs-human'));
		}
	}

	const resolvedIds = Array.isArray(finished?.resolved_thread_ids)
		? finished.resolved_thread_ids.map(String).filter(Boolean)
		: [];
	for (const threadId of resolvedIds) {
		try {
			await gh.resolveReviewThread(env, threadId);
			console.log(`Resolved review thread ${threadId}`);
		} catch (err) {
			console.warn(`Failed to resolve thread ${threadId}:`, err instanceof Error ? err.message : err);
		}
	}

	const remaining = await gh.listUnresolvedCodeRabbitThreads(env, pr.number);
	const refreshedReview = await gh.getLatestCodeRabbitReview(env, pr.number);
	const refreshed = await gh.getPull(env, pr.number);
	const typecheckStillFailing = await gh.getTypecheckFailureSummary(env, refreshed.head.sha);
	const pushedFixes = refreshed.head.sha !== startSha;
	const wroteAnything = Boolean(ctx.wroteAnything);

	// Never trust agent clean=true while CodeRabbit threads remain open or typecheck is red.
	let clean = Boolean(finished?.clean) && remaining.length === 0 && !typecheckStillFailing && (wroteAnything || pushedFixes || (unresolvedAtStart.length === 0 && !typecheckFailure));
	if (Boolean(finished?.clean) && remaining.length > 0) {
		console.warn(`Agent claimed clean=true but ${remaining.length} CodeRabbit thread(s) remain unresolved`);
	}
	if (Boolean(finished?.clean) && typecheckStillFailing) {
		console.warn('Agent claimed clean=true but omen-typecheck is still failing');
	}
	if (clean && !gh.codeRabbitApproved(refreshedReview)) {
		clean = false;
		console.log('Fixes applied / threads cleared; waiting for CodeRabbit APPROVED review');
	}

	await gh.commentOnIssue(
		env,
		pr.number,
		[
			`### Omen address-review (round ${round})`,
			'',
			String(finished?.message || (clean ? 'Review feedback addressed.' : 'Address-review round finished.')),
			'',
			`- Wrote files this run: **${wroteAnything ? 'yes' : 'no'}**`,
			`- Pushed new commits: **${pushedFixes ? 'yes' : 'no'}**`,
			`- Unresolved CodeRabbit threads remaining: **${remaining.length}**`,
			`- omen-typecheck: **${typecheckStillFailing ? 'FAILING' : 'ok/pending'}**`,
			`- Latest CodeRabbit review: **${refreshedReview?.state ?? '(none)'}**`,
			`- omen-review-clean: **${clean ? 'success' : remaining.length || typecheckStillFailing || unresolvedAtStart.length || typecheckFailure ? 'failed' : 'pending'}**`,
		].join('\n'),
	);

	await gh.createCheckRun(env, {
		name: 'omen-review-clean',
		headSha: refreshed.head.sha,
		conclusion: clean
			? 'success'
			: remaining.length || typecheckStillFailing || (unresolvedAtStart.length > 0 && !pushedFixes) || (Boolean(typecheckFailure) && !pushedFixes)
				? 'failure'
				: 'neutral',
		title: clean
			? 'CodeRabbit approved + threads clear'
			: typecheckStillFailing
				? 'omen-typecheck still failing'
				: !wroteAnything && !pushedFixes && (unresolvedAtStart.length > 0 || Boolean(typecheckFailure))
					? 'Address-review explore-only (no edits)'
					: remaining.length
						? `${remaining.length} CodeRabbit thread(s) still open`
						: 'Waiting for CodeRabbit approval',
		summary: [
			String(finished?.message || ''),
			'',
			`Wrote files: ${wroteAnything}`,
			`Pushed commits: ${pushedFixes}`,
			`Unresolved threads: ${remaining.length}`,
			`Typecheck failing: ${Boolean(typecheckStillFailing)}`,
			`CodeRabbit review state: ${refreshedReview?.state ?? '(none)'}`,
		].join('\n'),
	});

	// Fail the job so schedule / monitors retry — never exit green while work remains.
	if ((unresolvedAtStart.length > 0 || typecheckFailure) && !wroteAnything && !pushedFixes) {
		throw new Error(
			`Address-review explore-only failure on PR #${pr.number}: open review/typecheck work remained, no write_file/edit_file and no new commits.`,
		);
	}
	if (remaining.length > 0) {
		throw new Error(
			`Address-review incomplete on PR #${pr.number}: ${remaining.length} CodeRabbit thread(s) still unresolved after round ${round}.`,
		);
	}
	if (typecheckStillFailing) {
		throw new Error(
			`Address-review incomplete on PR #${pr.number}: omen-typecheck still failing after round ${round}.`,
		);
	}
}
