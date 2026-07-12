/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { AgentEnv } from '../config.ts';
import { runAgentLoop } from '../agent-loop.ts';
import * as gh from '../github.ts';
import { formatNeedsHumanComment, isActionableNeedsHuman } from '../needs-human.ts';
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
			blocker: { type: 'string' },
			questions: { type: 'array', items: { type: 'string' } },
			unblock_steps: { type: 'string' },
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
			return;
		}
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
