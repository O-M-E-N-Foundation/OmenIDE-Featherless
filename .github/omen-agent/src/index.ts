/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { loadEnv, type AgentMode } from './config.ts';
import { runAddressReview } from './modes/address-review.ts';
import { runAutoMerge, runMergeReady } from './modes/auto-merge.ts';
import { runImplement } from './modes/implement.ts';
import { runTriage } from './modes/triage.ts';

async function main(): Promise<void> {
	const mode = (process.argv[2] || process.env.OMEN_AGENT_MODE || '') as AgentMode;
	if (!mode) {
		console.error('Usage: node --experimental-strip-types src/index.ts <triage|implement|address-review|merge-ready|auto-merge>');
		process.exit(2);
	}

	const env = loadEnv(mode);
	console.log(`omen-agent mode=${mode} repo=${env.owner}/${env.repo} model=${env.model}`);

	switch (mode) {
		case 'triage':
			await runTriage(env);
			break;
		case 'implement':
			await runImplement(env);
			break;
		case 'address-review':
			await runAddressReview(env);
			break;
		case 'merge-ready':
			await runMergeReady(env);
			break;
		case 'auto-merge':
			await runAutoMerge(env);
			break;
		default:
			throw new Error(`Unknown mode: ${mode}`);
	}
}

main().catch(err => {
	console.error(err);
	process.exit(1);
});
