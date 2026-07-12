/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import type { AgentEnv } from './config.ts';
import type { ToolDefinition } from './featherless.ts';
import * as gh from './github.ts';
import { assertSafeCommand, assertSafeRepoPath, looksLikeSecretContent } from './safety.ts';

const execFileAsync = promisify(execFile);

export type FinishPayload = Record<string, unknown>;

export interface ToolContext {
	env: AgentEnv;
	finished?: FinishPayload;
}

function truncate(text: string, max = 12000): string {
	if (text.length <= max) {
		return text;
	}
	return `${text.slice(0, max)}\n…(truncated)`;
}

export function baseTools(): ToolDefinition[] {
	return [
		{
			type: 'function',
			function: {
				name: 'read_file',
				description: 'Read a UTF-8 text file from the workspace',
				parameters: {
					type: 'object',
					properties: { path: { type: 'string' } },
					required: ['path'],
				},
			},
		},
		{
			type: 'function',
			function: {
				name: 'write_file',
				description: 'Write a UTF-8 text file in the workspace (creates parents)',
				parameters: {
					type: 'object',
					properties: {
						path: { type: 'string' },
						content: { type: 'string' },
					},
					required: ['path', 'content'],
				},
			},
		},
		{
			type: 'function',
			function: {
				name: 'edit_file',
				description: 'Replace an exact substring in a file once',
				parameters: {
					type: 'object',
					properties: {
						path: { type: 'string' },
						old_string: { type: 'string' },
						new_string: { type: 'string' },
					},
					required: ['path', 'old_string', 'new_string'],
				},
			},
		},
		{
			type: 'function',
			function: {
				name: 'list_dir',
				description: 'List directory entries',
				parameters: {
					type: 'object',
					properties: { path: { type: 'string' } },
					required: ['path'],
				},
			},
		},
		{
			type: 'function',
			function: {
				name: 'run_command',
				description: 'Run an allowlisted shell command in the workspace (git/gh/npm/node/rg/…)',
				parameters: {
					type: 'object',
					properties: {
						command: { type: 'string' },
					},
					required: ['command'],
				},
			},
		},
		{
			type: 'function',
			function: {
				name: 'gh_comment',
				description: 'Comment on the current issue or PR number',
				parameters: {
					type: 'object',
					properties: {
						issue_number: { type: 'number' },
						body: { type: 'string' },
					},
					required: ['issue_number', 'body'],
				},
			},
		},
		{
			type: 'function',
			function: {
				name: 'gh_add_labels',
				description: 'Add labels to an issue/PR (never ready-for-ai)',
				parameters: {
					type: 'object',
					properties: {
						issue_number: { type: 'number' },
						labels: { type: 'array', items: { type: 'string' } },
					},
					required: ['issue_number', 'labels'],
				},
			},
		},
		{
			type: 'function',
			function: {
				name: 'gh_create_pr',
				description: 'Open a pull request from a head branch',
				parameters: {
					type: 'object',
					properties: {
						title: { type: 'string' },
						head: { type: 'string' },
						body: { type: 'string' },
						labels: { type: 'array', items: { type: 'string' } },
					},
					required: ['title', 'head', 'body'],
				},
			},
		},
	];
}

export function finishTool(name: string, description: string, properties: Record<string, unknown>, required: string[]): ToolDefinition {
	return {
		type: 'function',
		function: {
			name,
			description,
			parameters: { type: 'object', properties, required },
		},
	};
}

export async function runTool(ctx: ToolContext, name: string, argsJson: string): Promise<string> {
	let args: Record<string, unknown> = {};
	try {
		args = JSON.parse(argsJson || '{}') as Record<string, unknown>;
	} catch {
		return `Invalid JSON arguments for ${name}`;
	}

	try {
		switch (name) {
			case 'read_file': {
				const abs = assertSafeRepoPath(ctx.env.workspace, String(args.path));
				const content = await fs.readFile(abs, 'utf8');
				return truncate(content);
			}
			case 'write_file': {
				const abs = assertSafeRepoPath(ctx.env.workspace, String(args.path));
				const content = String(args.content ?? '');
				if (looksLikeSecretContent(content)) {
					return 'Refused: content looks like a secret';
				}
				await fs.mkdir(path.dirname(abs), { recursive: true });
				await fs.writeFile(abs, content, 'utf8');
				return `Wrote ${args.path}`;
			}
			case 'edit_file': {
				const abs = assertSafeRepoPath(ctx.env.workspace, String(args.path));
				const oldString = String(args.old_string ?? '');
				const newString = String(args.new_string ?? '');
				if (looksLikeSecretContent(newString)) {
					return 'Refused: new content looks like a secret';
				}
				const current = await fs.readFile(abs, 'utf8');
				if (!current.includes(oldString)) {
					return 'old_string not found';
				}
				const updated = current.replace(oldString, newString);
				await fs.writeFile(abs, updated, 'utf8');
				return `Edited ${args.path}`;
			}
			case 'list_dir': {
				const abs = assertSafeRepoPath(ctx.env.workspace, String(args.path || '.'));
				const entries = await fs.readdir(abs, { withFileTypes: true });
				return entries.map(e => `${e.isDirectory() ? 'dir' : 'file'}\t${e.name}`).join('\n');
			}
			case 'run_command': {
				const command = String(args.command ?? '');
				assertSafeCommand(command);
				const { stdout, stderr } = await execFileAsync('bash', ['-lc', command], {
					cwd: ctx.env.workspace,
					maxBuffer: 5 * 1024 * 1024,
					env: { ...process.env, GIT_AUTHOR_NAME: 'Omen Agent', GIT_AUTHOR_EMAIL: 'omen-agent@users.noreply.github.com', GIT_COMMITTER_NAME: 'Omen Agent', GIT_COMMITTER_EMAIL: 'omen-agent@users.noreply.github.com' },
				});
				return truncate(`stdout:\n${stdout}\nstderr:\n${stderr}`);
			}
			case 'gh_comment': {
				await gh.commentOnIssue(ctx.env, Number(args.issue_number), String(args.body));
				return 'Commented';
			}
			case 'gh_add_labels': {
				const labels = (args.labels as string[]).filter(l => l !== 'ready-for-ai');
				if (!labels.length) {
					return 'No labels to add (ready-for-ai is forbidden for the agent)';
				}
				await gh.setIssueLabels(ctx.env, Number(args.issue_number), labels);
				return `Added labels: ${labels.join(', ')}`;
			}
			case 'gh_create_pr': {
				const pr = await gh.createPull(ctx.env, {
					title: String(args.title),
					head: String(args.head),
					body: String(args.body),
				});
				const labels = Array.isArray(args.labels) ? args.labels as string[] : ['ai-authored'];
				await gh.addPullLabels(ctx.env, pr.number, labels.includes('ai-authored') ? labels : [...labels, 'ai-authored']);
				return JSON.stringify(pr);
			}
			case 'finish_triage':
			case 'finish_implement':
			case 'finish_address_review': {
				ctx.finished = { tool: name, ...args };
				return 'Finished';
			}
			default:
				return `Unknown tool: ${name}`;
		}
	} catch (err) {
		return `Tool error: ${err instanceof Error ? err.message : String(err)}`;
	}
}
