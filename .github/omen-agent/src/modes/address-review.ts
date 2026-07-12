/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { AgentEnv } from '../config.ts';
import { runAgentLoop } from '../agent-loop.ts';
import * as gh from '../github.ts';
import { baseTools, finishTool } from '../tools.ts';

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
		await gh.addPullLabels(env, pr.number, ['needs-human']);
		await gh.commentOnIssue(env, pr.number, `Exceeded max CodeRabbit fix rounds (${env.maxReviewRounds}). Labeled needs-human.`);
		await gh.createCheckRun(env, {
			name: 'omen-review-clean',
			headSha: pr.head.sha,
			conclusion: 'failure',
			title: 'Review fix rounds exhausted',
			summary: `Stopped after ${env.maxReviewRounds} rounds.`,
		});
		return;
	}

	const { issueComments, reviewComments } = await gh.listPullComments(env, pr.number);
	const rabbit = [
		...issueComments.filter(c => gh.isCodeRabbitLogin(c.user.login)),
		...reviewComments.filter(c => gh.isCodeRabbitLogin(c.user.login)),
	];

	const feedback = rabbit
		.slice(-20)
		.map(c => {
			const path = 'path' in c && c.path ? ` (${c.path})` : '';
			return `#### ${c.user.login}${path}\n${c.body.slice(0, 3000)}`;
		})
		.join('\n\n---\n\n');

	if (!feedback.trim()) {
		// No CodeRabbit comments yet — do not mark clean (wait for first review).
		await gh.createCheckRun(env, {
			name: 'omen-review-clean',
			headSha: pr.head.sha,
			conclusion: 'neutral',
			title: 'Waiting for CodeRabbit',
			summary: 'No CodeRabbit comments found yet.',
		});
		return;
	}

	const tools = [
		...baseTools(),
		finishTool('finish_address_review', 'Finish addressing review', {
			clean: { type: 'boolean' },
			needs_human: { type: 'boolean' },
			message: { type: 'string' },
		}, ['clean', 'message']),
	];

	const ctx = await runAgentLoop({
		env,
		systemPromptName: 'address-review',
		userPrompt: [
			`PR #${pr.number}: ${pr.title}`,
			`Branch: ${pr.head.ref}`,
			`URL: ${pr.html_url}`,
			`Review round: ${round}/${env.maxReviewRounds}`,
			'',
			'CodeRabbit feedback:',
			feedback || '(none)',
			'',
			'Checkout the PR branch if needed, fix issues, commit, push, then finish_address_review.',
		].join('\n'),
		tools,
	});

	const finished = ctx.finished;
	if (finished?.needs_human) {
		await gh.addPullLabels(env, pr.number, ['needs-human']);
		await gh.commentOnIssue(env, pr.number, `### Omen address-review\n\nNeeds human.\n\n${String(finished.message || '')}`);
		await gh.createCheckRun(env, {
			name: 'omen-review-clean',
			headSha: pr.head.sha,
			conclusion: 'failure',
			title: 'Needs human',
			summary: String(finished.message || 'Agent requested human help'),
		});
		return;
	}

	const refreshed = await gh.getPull(env, pr.number);
	const clean = Boolean(finished?.clean);
	await gh.commentOnIssue(
		env,
		pr.number,
		`### Omen address-review (round ${round})\n\n${String(finished?.message || (clean ? 'Review feedback addressed.' : 'Partial fixes pushed.'))}`,
	);

	await gh.createCheckRun(env, {
		name: 'omen-review-clean',
		headSha: refreshed.head.sha,
		conclusion: clean ? 'success' : 'neutral',
		title: clean ? 'CodeRabbit feedback clear' : 'Still addressing feedback',
		summary: String(finished?.message || ''),
	});
}
