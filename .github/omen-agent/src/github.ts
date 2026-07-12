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
		check_runs: Array<{ name: string; status: string; conclusion: string | null }>;
	}>(env, `/repos/${env.owner}/${env.repo}/commits/${encodeURIComponent(ref)}/check-runs?per_page=100`);
}

export async function createCheckRun(env: AgentEnv, input: {
	name: string;
	headSha: string;
	conclusion: 'success' | 'failure' | 'neutral';
	title: string;
	summary: string;
}) {
	return gh(env, `/repos/${env.owner}/${env.repo}/check-runs`, {
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
}

export function isCodeRabbitLogin(login: string): boolean {
	return login.toLowerCase().includes('coderabbit');
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
