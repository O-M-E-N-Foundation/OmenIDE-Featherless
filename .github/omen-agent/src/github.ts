/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { AgentEnv } from './config.ts';

async function gh<T>(env: AgentEnv, pathname: string, init?: RequestInit): Promise<T> {
	const res = await fetch(`https://api.github.com${pathname}`, {
		...init,
		headers: {
			Accept: 'application/vnd.github+json',
			Authorization: `Bearer ${env.githubToken}`,
			'X-GitHub-Api-Version': '2022-11-28',
			'Content-Type': 'application/json',
			...(init?.headers ?? {}),
		},
	});
	if (!res.ok) {
		const text = await res.text();
		throw new Error(`GitHub API ${res.status} ${pathname}: ${text.slice(0, 2000)}`);
	}
	if (res.status === 204) {
		return undefined as T;
	}
	return await res.json() as T;
}

export async function getIssue(env: AgentEnv, issueNumber: number) {
	return gh<{
		number: number;
		title: string;
		body: string | null;
		labels: Array<{ name: string }>;
		state: string;
		html_url: string;
	}>(env, `/repos/${env.owner}/${env.repo}/issues/${issueNumber}`);
}

export async function listIssueComments(env: AgentEnv, issueNumber: number) {
	return gh<Array<{ user: { login: string }; body: string; created_at: string }>>(
		env,
		`/repos/${env.owner}/${env.repo}/issues/${issueNumber}/comments?per_page=50`,
	);
}

export async function commentOnIssue(env: AgentEnv, issueNumber: number, body: string) {
	return gh(env, `/repos/${env.owner}/${env.repo}/issues/${issueNumber}/comments`, {
		method: 'POST',
		body: JSON.stringify({ body }),
	});
}

export async function setIssueLabels(env: AgentEnv, issueNumber: number, labels: string[]) {
	return gh(env, `/repos/${env.owner}/${env.repo}/issues/${issueNumber}/labels`, {
		method: 'POST',
		body: JSON.stringify({ labels }),
	});
}

export async function removeIssueLabel(env: AgentEnv, issueNumber: number, name: string) {
	try {
		await gh(env, `/repos/${env.owner}/${env.repo}/issues/${issueNumber}/labels/${encodeURIComponent(name)}`, {
			method: 'DELETE',
		});
	} catch {
		// label may already be absent
	}
}

export async function getPull(env: AgentEnv, prNumber: number) {
	return gh<{
		number: number;
		title: string;
		body: string | null;
		html_url: string;
		draft: boolean;
		merged: boolean;
		head: { ref: string; sha: string };
		base: { ref: string };
		labels: Array<{ name: string }>;
		user: { login: string };
	}>(env, `/repos/${env.owner}/${env.repo}/pulls/${prNumber}`);
}

export async function listPullComments(env: AgentEnv, prNumber: number) {
	const issueComments = await gh<Array<{ user: { login: string }; body: string; created_at: string; id: number }>>(
		env,
		`/repos/${env.owner}/${env.repo}/issues/${prNumber}/comments?per_page=100`,
	);
	const reviewComments = await gh<Array<{ user: { login: string }; body: string; path?: string; created_at: string; id: number }>>(
		env,
		`/repos/${env.owner}/${env.repo}/pulls/${prNumber}/comments?per_page=100`,
	);
	return { issueComments, reviewComments };
}

export async function createPull(env: AgentEnv, input: {
	title: string;
	head: string;
	base?: string;
	body: string;
}) {
	return gh<{ number: number; html_url: string }>(env, `/repos/${env.owner}/${env.repo}/pulls`, {
		method: 'POST',
		body: JSON.stringify({
			title: input.title,
			head: input.head,
			base: input.base ?? 'main',
			body: input.body,
		}),
	});
}

export async function addPullLabels(env: AgentEnv, prNumber: number, labels: string[]) {
	return setIssueLabels(env, prNumber, labels);
}

export async function mergePull(env: AgentEnv, prNumber: number) {
	return gh(env, `/repos/${env.owner}/${env.repo}/pulls/${prNumber}/merge`, {
		method: 'PUT',
		body: JSON.stringify({
			merge_method: 'squash',
			commit_title: undefined,
		}),
	});
}

export async function listCheckRunsForRef(env: AgentEnv, ref: string) {
	return gh<{
		check_runs: Array<{
			id: number;
			name: string;
			status: string;
			conclusion: string | null;
			output?: { title?: string; summary?: string; text?: string };
		}>;
	}>(env, `/repos/${env.owner}/${env.repo}/commits/${encodeURIComponent(ref)}/check-runs?per_page=100`);
}

export async function getCheckRunAnnotations(env: AgentEnv, checkRunId: number) {
	return gh<Array<{
		path: string;
		start_line: number;
		end_line: number;
		message: string;
		annotation_level: string;
	}>>(env, `/repos/${env.owner}/${env.repo}/check-runs/${checkRunId}/annotations?per_page=50`);
}

/** Failing omen-typecheck / compile annotations for the PR head, if any. */
export async function getTypecheckFailureSummary(env: AgentEnv, headSha: string): Promise<string | null> {
	const { check_runs } = await listCheckRunsForRef(env, headSha);
	const failed = [...check_runs]
		.reverse()
		.find(r => (r.name === 'omen-typecheck' || r.name.startsWith('omen-typecheck')) && r.conclusion === 'failure');
	if (!failed) {
		return null;
	}
	let details = failed.output?.summary || failed.output?.text || failed.output?.title || 'omen-typecheck failed';
	try {
		const anns = await getCheckRunAnnotations(env, failed.id);
		if (anns.length) {
			details += '\n\n' + anns.map(a => `${a.path}:${a.start_line}: ${a.message}`).join('\n');
		}
	} catch (err) {
		console.warn('getCheckRunAnnotations failed:', err instanceof Error ? err.message : err);
	}
	return details.slice(0, 8000);
}

export async function createCheckRun(env: AgentEnv, input: {
	name: string;
	headSha: string;
	conclusion: 'success' | 'failure' | 'neutral';
	title: string;
	summary: string;
}) {
	const token = env.checksGithubToken || env.githubToken;
	const checksEnv = { ...env, githubToken: token };
	try {
		return await gh(checksEnv, `/repos/${env.owner}/${env.repo}/check-runs`, {
			method: 'POST',
			body: JSON.stringify({
				name: input.name,
				head_sha: input.headSha,
				status: 'completed',
				conclusion: input.conclusion,
				output: {
					title: input.title,
					summary: input.summary,
				},
			}),
		});
	} catch (err) {
		// Do not abort address-review after real work; log and continue.
		console.warn(
			`createCheckRun(${input.name}) failed (token ends …${String(token).slice(-4)}):`,
			err instanceof Error ? err.message : err,
		);
		return undefined;
	}
}

export function isCodeRabbitLogin(login: string): boolean {
	return login.toLowerCase().includes('coderabbit');
}

export interface ReviewThreadSummary {
	id: string;
	isResolved: boolean;
	isOutdated: boolean;
	path?: string;
	body: string;
	author: string;
}

export async function listPullReviewThreads(env: AgentEnv, prNumber: number): Promise<ReviewThreadSummary[]> {
	const query = `
		query($owner:String!, $repo:String!, $number:Int!) {
			repository(owner:$owner, name:$repo) {
				pullRequest(number:$number) {
					reviewThreads(first:100) {
						nodes {
							id
							isResolved
							isOutdated
							comments(first:1) {
								nodes {
									body
									path
									author { login }
								}
							}
						}
					}
				}
			}
		}`;
	const data = await gh<{
		data?: {
			repository?: {
				pullRequest?: {
					reviewThreads?: {
						nodes: Array<{
							id: string;
							isResolved: boolean;
							isOutdated: boolean;
							comments: { nodes: Array<{ body: string; path?: string; author?: { login: string } }> };
						}>;
					};
				};
			};
		};
		errors?: Array<{ message: string }>;
	}>(env, '/graphql', {
		method: 'POST',
		body: JSON.stringify({
			query,
			variables: { owner: env.owner, repo: env.repo, number: prNumber },
		}),
	});
	if (data.errors?.length) {
		throw new Error(`GraphQL reviewThreads: ${data.errors.map(e => e.message).join('; ')}`);
	}
	const nodes = data.data?.repository?.pullRequest?.reviewThreads?.nodes ?? [];
	return nodes.map(n => {
		const c = n.comments.nodes[0];
		return {
			id: n.id,
			isResolved: n.isResolved,
			isOutdated: n.isOutdated,
			path: c?.path,
			body: c?.body ?? '',
			author: c?.author?.login ?? '',
		};
	});
}

export async function listUnresolvedCodeRabbitThreads(env: AgentEnv, prNumber: number): Promise<ReviewThreadSummary[]> {
	const threads = await listPullReviewThreads(env, prNumber);
	return threads.filter(t => !t.isResolved && !t.isOutdated && isCodeRabbitLogin(t.author));
}

export async function resolveReviewThread(env: AgentEnv, threadId: string): Promise<void> {
	const mutation = `
		mutation($id:ID!) {
			resolveReviewThread(input:{threadId:$id}) {
				thread { isResolved }
			}
		}`;
	const data = await gh<{ errors?: Array<{ message: string }> }>(env, '/graphql', {
		method: 'POST',
		body: JSON.stringify({ query: mutation, variables: { id: threadId } }),
	});
	if (data.errors?.length) {
		throw new Error(`resolveReviewThread: ${data.errors.map(e => e.message).join('; ')}`);
	}
}

export type PullReviewState = 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'DISMISSED' | 'PENDING' | string;

export async function getLatestCodeRabbitReview(env: AgentEnv, prNumber: number): Promise<{
	state: PullReviewState | null;
	submittedAt: string | null;
} | null> {
	const reviews = await gh<Array<{
		user: { login: string };
		state: string;
		submitted_at: string | null;
	}>>(env, `/repos/${env.owner}/${env.repo}/pulls/${prNumber}/reviews?per_page=100`);
	const rabbit = reviews.filter(r => isCodeRabbitLogin(r.user.login));
	if (!rabbit.length) {
		return null;
	}
	const latest = rabbit[rabbit.length - 1];
	return { state: latest.state, submittedAt: latest.submitted_at };
}

export function codeRabbitApproved(review: { state: PullReviewState | null } | null): boolean {
	return Boolean(review && review.state === 'APPROVED');
}

export async function listClosingIssueNumbers(env: AgentEnv, prNumber: number): Promise<number[]> {
	const query = `
		query($owner:String!, $repo:String!, $number:Int!) {
			repository(owner:$owner, name:$repo) {
				pullRequest(number:$number) {
					closingIssuesReferences(first:20) {
						nodes { number }
					}
				}
			}
		}`;
	const data = await gh<{
		data?: {
			repository?: {
				pullRequest?: {
					closingIssuesReferences?: { nodes: Array<{ number: number }> };
				};
			};
		};
		errors?: Array<{ message: string }>;
	}>(env, '/graphql', {
		method: 'POST',
		body: JSON.stringify({
			query,
			variables: { owner: env.owner, repo: env.repo, number: prNumber },
		}),
	});
	if (data.errors?.length) {
		console.warn(`closingIssuesReferences: ${data.errors.map(e => e.message).join('; ')}`);
		return [];
	}
	return (data.data?.repository?.pullRequest?.closingIssuesReferences?.nodes ?? []).map(n => n.number);
}

export async function listOpenAiPulls(env: AgentEnv) {
	const pulls = await gh<Array<{
		number: number;
		draft: boolean;
		labels: Array<{ name: string }>;
		html_url: string;
		head: { sha: string; ref: string };
	}>>(env, `/repos/${env.owner}/${env.repo}/pulls?state=open&per_page=50`);
	return pulls.filter(p => p.labels.some(l => l.name === 'ai-authored'));
}
