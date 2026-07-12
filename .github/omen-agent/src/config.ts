/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export type AgentMode = 'triage' | 'implement' | 'address-review' | 'merge-ready' | 'auto-merge';

export interface AgentEnv {
	mode: AgentMode;
	workspace: string;
	featherlessApiKey: string;
	featherlessBaseUrl: string;
	model: string;
	githubToken: string;
	/** Token used for check-runs (Actions GITHUB_TOKEN). Classic PATs often lack checks:write. */
	checksGithubToken: string;
	owner: string;
	repo: string;
	issueNumber?: number;
	prNumber?: number;
	maxSteps: number;
	maxReviewRounds: number;
	sha?: string;
}

export function loadEnv(mode: AgentMode): AgentEnv {
	const featherlessApiKey = process.env.FEATHERLESS_API_KEY ?? '';
	const githubToken = process.env.OMEN_AGENT_GITHUB_TOKEN || process.env.GITHUB_TOKEN || '';
	const checksGithubToken = process.env.OMEN_CHECKS_GITHUB_TOKEN || process.env.GITHUB_TOKEN || githubToken;
	const repository = process.env.GITHUB_REPOSITORY ?? 'O-M-E-N-Foundation/vscode';
	const [owner, repo] = repository.split('/');
	if (!owner || !repo) {
		throw new Error(`Invalid GITHUB_REPOSITORY: ${repository}`);
	}

	const issueNumber = process.env.OMEN_ISSUE_NUMBER ? Number(process.env.OMEN_ISSUE_NUMBER) : undefined;
	const prNumber = process.env.OMEN_PR_NUMBER ? Number(process.env.OMEN_PR_NUMBER) : undefined;

	return {
		mode,
		workspace: process.env.GITHUB_WORKSPACE || process.cwd(),
		featherlessApiKey,
		featherlessBaseUrl: process.env.FEATHERLESS_BASE_URL || 'https://api.featherless.ai/v1',
		model: process.env.OMEN_AGENT_MODEL || 'zai-org/GLM-5.2',
		githubToken,
		checksGithubToken,
		owner,
		repo,
		issueNumber: Number.isFinite(issueNumber) ? issueNumber : undefined,
		prNumber: Number.isFinite(prNumber) ? prNumber : undefined,
		maxSteps: Number(process.env.OMEN_MAX_STEPS || (mode === 'implement' ? 100 : mode === 'address-review' ? 60 : 40)),
		maxReviewRounds: Number(process.env.OMEN_MAX_REVIEW_ROUNDS || 3),
		sha: process.env.GITHUB_SHA,
	};
}
