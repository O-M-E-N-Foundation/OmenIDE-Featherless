/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { AgentEnv } from './config.ts';
import { chatCompletion, readPrompt, type ChatMessage, type ToolDefinition } from './featherless.ts';
import { runTool, type ToolContext } from './tools.ts';

export async function runAgentLoop(options: {
	env: AgentEnv;
	systemPromptName: string;
	userPrompt: string;
	tools: ToolDefinition[];
}): Promise<ToolContext> {
	const ctx: ToolContext = { env: options.env };
	const messages: ChatMessage[] = [
		{ role: 'system', content: readPrompt(options.systemPromptName) },
		{ role: 'user', content: options.userPrompt },
	];

	for (let step = 0; step < options.env.maxSteps; step++) {
		const assistant = await chatCompletion(options.env, messages, options.tools);
		messages.push(assistant);

		const toolCalls = assistant.tool_calls ?? [];
		if (!toolCalls.length) {
			if (assistant.content) {
				console.log(assistant.content);
			}
			break;
		}

		for (const call of toolCalls) {
			console.log(`tool: ${call.function.name}`);
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
	}

	return ctx;
}
