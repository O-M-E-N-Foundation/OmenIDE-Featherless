/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AgentEnv } from './config.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface ChatMessage {
	role: 'system' | 'user' | 'assistant' | 'tool';
	content?: string | null;
	tool_calls?: ToolCall[];
	tool_call_id?: string;
	name?: string;
}

export interface ToolCall {
	id: string;
	type: 'function';
	function: { name: string; arguments: string };
}

export interface ToolDefinition {
	type: 'function';
	function: {
		name: string;
		description: string;
		parameters: Record<string, unknown>;
	};
}

export async function chatCompletion(
	env: AgentEnv,
	messages: ChatMessage[],
	tools: ToolDefinition[],
): Promise<ChatMessage> {
	if (!env.featherlessApiKey) {
		throw new Error('FEATHERLESS_API_KEY is required');
	}

	const res = await fetch(`${env.featherlessBaseUrl}/chat/completions`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${env.featherlessApiKey}`,
		},
		body: JSON.stringify({
			model: env.model,
			messages,
			tools,
			tool_choice: 'auto',
			temperature: 0.2,
		}),
	});

	if (!res.ok) {
		const text = await res.text();
		throw new Error(`Featherless error ${res.status}: ${text.slice(0, 2000)}`);
	}

	const data = await res.json() as {
		choices?: Array<{ message?: ChatMessage }>;
	};
	const message = data.choices?.[0]?.message;
	if (!message) {
		throw new Error('Featherless returned no message');
	}
	return message;
}

export function readPrompt(name: string): string {
	const file = path.join(__dirname, '..', 'prompts', `${name}.md`);
	return readFileSync(file, 'utf8');
}
