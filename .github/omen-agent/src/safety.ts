/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import path from 'node:path';

const BLOCKED_BASENAMES = new Set([
	'.env',
	'.env.local',
	'.env.production',
	'credentials.json',
	'service-account.json',
]);

const BLOCKED_SUFFIXES = ['.pem', '.p12', '.key'];

export function assertSafeRepoPath(workspace: string, relativePath: string): string {
	const normalized = relativePath.replace(/\\/g, '/');
	if (normalized.includes('\0') || normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized)) {
		throw new Error(`Blocked absolute path: ${relativePath}`);
	}
	if (normalized.split('/').includes('..')) {
		throw new Error(`Path traversal blocked: ${relativePath}`);
	}

	const base = path.basename(normalized).toLowerCase();
	if (BLOCKED_BASENAMES.has(base) || base.startsWith('.env')) {
		throw new Error(`Blocked secret-like path: ${relativePath}`);
	}
	for (const suffix of BLOCKED_SUFFIXES) {
		if (base.endsWith(suffix)) {
			throw new Error(`Blocked key material path: ${relativePath}`);
		}
	}

	const resolved = path.resolve(workspace, normalized);
	const root = path.resolve(workspace);
	if (resolved !== root && !resolved.startsWith(root + path.sep)) {
		throw new Error(`Path escapes workspace: ${relativePath}`);
	}
	return resolved;
}

export function assertSafeCommand(command: string): void {
	const trimmed = command.trim();
	const lowered = trimmed.toLowerCase();
	if (lowered.includes('--no-verify')) {
		throw new Error('git --no-verify is not allowed');
	}
	if (lowered.includes('push') && /\s+(-f|--force)\b/.test(lowered) && /\bmain\b/.test(lowered)) {
		throw new Error('Force-push to main is not allowed');
	}
	if (/(^|[;&|])\s*rm\s+-rf\s+\/\s*$/.test(lowered)) {
		throw new Error('Destructive command blocked');
	}

	const allowed = /^(git|gh|npm|node|ls|pwd|cat|head|rg|npx|echo|mkdir|cp|mv)\b/;
	if (!allowed.test(trimmed)) {
		throw new Error(`Command not allowlisted: ${command}`);
	}
}

export function looksLikeSecretContent(content: string): boolean {
	return /FEATHERLESS_API_KEY\s*=\s*\S+|-----BEGIN (RSA |OPENSSH )?PRIVATE KEY-----|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}/.test(content);
}
