/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { AgentEnv } from './config.ts';
import { chatCompletion, readPrompt, type ChatMessage, type ToolDefinition } from './featherless.ts';
import { runTool, type ToolContext } from './tools.ts';

const EXPLORE_TOOLS = new Set(['list_dir', 'read_file', 'run_command']);
const WRITE_TOOLS = new Set(['write_file', 'edit_file', 'gh_create_pr']);

export async function runAgentLoop(options: {
	env: AgentEnv;
	systemPromptName: string;
	userPrompt: string;
	tools: ToolDefinition[];
	/** When true, do not exit on text-only replies; nudge toward tools/finish instead. */
	requireFinish?: boolean;
	/** Finish tool name used in nudges (default finish_implement). */
	finishToolName?: string;
}): Promise<ToolContext> {
	const finishName = options.finishToolName || 'finish_implement';
	const ctx: ToolContext = { env: options.env, wroteAnything: false };
	const messages: ChatMessage[] = [
		{ role: 'system', content: readPrompt(options.systemPromptName) },
		{ role: 'user', content: options.userPrompt },
	];

	let exploreStreak = 0;
	let wroteAnything = false;
	let emptyReplies = 0;

	for (let step = 0; step < options.env.maxSteps; step++) {
		const remaining = options.env.maxSteps - step;
		if (remaining <= 8 && options.requireFinish && !ctx.finished) {
			messages.push({
				role: 'user',
				content: wroteAnything
					? `Only ${remaining} steps left. Commit, push, then call ${finishName}. Do not explore further.`
					: `Only ${remaining} steps left and you have NOT written files yet. STOP exploring. Immediately write_file/edit_file to fix the open review items, commit, push, then call ${finishName}.`,
			});
		} else if (exploreStreak >= 8 && !wroteAnything) {
			messages.push({
				role: 'user',
				content: `You have explored for many steps without writing code. STOP exploring. Apply the review fixes now with write_file/edit_file. Exploring without edits will fail this job.`,
			});
			exploreStreak = 0;
		}

		const assistant = await chatCompletion(options.env, messages, options.tools);
		messages.push(assistant);

		const toolCalls = assistant.tool_calls ?? [];
		if (!toolCalls.length) {
			if (assistant.content) {
				console.log(assistant.content);
			}
			emptyReplies++;
			if (options.requireFinish && emptyReplies < 3 && !ctx.finished) {
				messages.push({
					role: 'user',
					content: `You replied without tools. Continue by calling tools. You must edit code and call ${finishName}, or escalate with needs_human + blocker/questions/unblock_steps.`,
				});
				continue;
			}
			break;
		}

		emptyReplies = 0;
		let stepWasExploreOnly = true;
		for (const call of toolCalls) {
			console.log(`tool: ${call.function.name}`);
			if (WRITE_TOOLS.has(call.function.name)) {
				wroteAnything = true;
				ctx.wroteAnything = true;
				stepWasExploreOnly = false;
				exploreStreak = 0;
			} else if (!EXPLORE_TOOLS.has(call.function.name)) {
				stepWasExploreOnly = false;
			}
			const result = await runTool(ctx, call.function.name, call.function.arguments);
			messages.push({
				role: 'tool',
				tool_call_id: call.id,
				name: call.function.name,
				content: result,
			});
			if (ctx.finished) {
				return ctx;
			}
		}
		if (stepWasExploreOnly) {
			exploreStreak++;
		}
	}

	return ctx;
}
