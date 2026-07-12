/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface NeedsHumanPayload {
	blocker?: string;
	questions?: unknown;
	unblock_steps?: string;
	message?: string;
}

function asStringList(value: unknown): string[] {
	if (!Array.isArray(value)) {
		return [];
	}
	return value.map(v => String(v).trim()).filter(Boolean);
}

/**
 * needs-human is only valid when the agent gives the human something concrete to do.
 */
export function isActionableNeedsHuman(payload: NeedsHumanPayload | undefined): boolean {
	if (!payload) {
		return false;
	}
	const questions = asStringList(payload.questions);
	const blocker = String(payload.blocker || '').trim();
	const unblock = String(payload.unblock_steps || '').trim();
	const message = String(payload.message || '').trim();

	if (questions.length < 1) {
		return false;
	}
	if (!blocker && !message) {
		return false;
	}
	if (!unblock) {
		return false;
	}

	const blob = `${blocker}\n${message}\n${questions.join('\n')}`.toLowerCase();
	const vagueOnly =
		/architectural|benefits from human|design decision|discuss|needs design/.test(blob) &&
		questions.length < 1;
	if (vagueOnly) {
		return false;
	}

	return true;
}

export function formatNeedsHumanComment(payload: NeedsHumanPayload, opts?: { issueNumber?: number }): string {
	const questions = asStringList(payload.questions);
	const blocker = String(payload.blocker || payload.message || 'Blocked.').trim();
	const unblock = String(payload.unblock_steps || '').trim() ||
		'Reply to this issue with answers to the questions below, remove `needs-human`, then add `ready-for-ai`.';

	const lines = [
		'### Omen needs human input',
		'',
		'The agent **cannot continue** until a Write collaborator answers the items below.',
		'',
		`**Blocker:** ${blocker}`,
		'',
		'**Please answer:**',
		...questions.map((q, i) => `${i + 1}. ${q}`),
		'',
		'**To unblock:**',
		unblock,
	];

	if (opts?.issueNumber) {
		lines.push('', `_Issue #${opts.issueNumber}_`);
	}

	return lines.join('\n');
}

export function formatRejectedNeedsHumanComment(rawMessage: string): string {
	return [
		'### Omen implement — escalation rejected',
		'',
		'The agent attempted `needs-human` without actionable questions for a human.',
		'That is not allowed when `ready-for-ai` already approved shipping.',
		'',
		'**Agent said:**',
		'',
		'> ' + String(rawMessage || '(empty)').replace(/\n/g, '\n> '),
		'',
		'**What you can do:**',
		'1. Re-add the `ready-for-ai` label to retry implementation (preferred if the issue AC are already clear).',
		'2. Or comment concrete decisions (timeouts, readiness definition, etc.), then re-add `ready-for-ai`.',
	].join('\n');
}
