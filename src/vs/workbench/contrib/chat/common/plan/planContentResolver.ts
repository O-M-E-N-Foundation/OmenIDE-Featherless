/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IChatProgressResponseContent } from '../model/chatModel.js';
import { SavePlanToolId } from '../tools/builtinTools/savePlanTool.js';

/**
 * Collects the last contiguous markdown block that precedes a `vscode_savePlan`
 * tool invocation in the current response. Plan mode agents usually write the
 * full plan in the assistant message before calling the save tool; that message
 * is the reliable source when tool-call JSON arguments get truncated.
 */
export function extractPlanMarkdownBeforeSave(
	parts: readonly IChatProgressResponseContent[],
	savePlanToolCallId?: string,
): string | undefined {
	let savePlanIndex = parts.length;

	if (savePlanToolCallId) {
		const idx = parts.findIndex(part =>
			(part.kind === 'toolInvocation' || part.kind === 'toolInvocationSerialized')
			&& part.toolCallId === savePlanToolCallId
		);
		if (idx >= 0) {
			savePlanIndex = idx;
		}
	} else {
		for (let i = parts.length - 1; i >= 0; i--) {
			const part = parts[i];
			if ((part.kind === 'toolInvocation' || part.kind === 'toolInvocationSerialized') && part.toolId === SavePlanToolId) {
				savePlanIndex = i;
				break;
			}
		}
	}

	let end = savePlanIndex - 1;
	while (end >= 0) {
		const part = parts[end];
		if (part.kind === 'markdownContent' || part.kind === 'markdownVuln') {
			if (part.content.value.length > 0) {
				break;
			}
		} else if (part.kind === 'inlineReference') {
			break;
		} else if (part.kind === 'toolInvocation' || part.kind === 'toolInvocationSerialized') {
			break;
		}
		end--;
	}

	if (end < 0) {
		return undefined;
	}

	let start = end;
	while (start >= 0) {
		const part = parts[start];
		if (part.kind === 'markdownContent' || part.kind === 'markdownVuln' || part.kind === 'inlineReference') {
			start--;
		} else {
			break;
		}
	}
	start++;

	const segments: string[] = [];
	for (let i = start; i <= end; i++) {
		const part = parts[i];
		if (part.kind === 'markdownContent' || part.kind === 'markdownVuln') {
			segments.push(part.content.value);
		}
	}

	const result = segments.join('\n\n').trim();
	return result || undefined;
}

/**
 * Picks the fullest plan body between tool-call `content` and assistant-message
 * markdown. Tool JSON arguments are often truncated for large plans.
 */
export function resolvePlanBody(toolContent: string | undefined, responseMarkdown: string | undefined): string | undefined {
	const tool = toolContent?.trim() ?? '';
	const response = responseMarkdown?.trim() ?? '';

	if (!tool && !response) {
		return undefined;
	}
	if (!tool) {
		return response;
	}
	if (!response) {
		return tool;
	}

	if (tool.length < response.length * 0.85) {
		return response;
	}
	if (response.includes(tool) && response.length > tool.length) {
		return response;
	}
	if (tool.includes(response) && tool.length > response.length) {
		return tool;
	}
	return tool.length >= response.length ? tool : response;
}
