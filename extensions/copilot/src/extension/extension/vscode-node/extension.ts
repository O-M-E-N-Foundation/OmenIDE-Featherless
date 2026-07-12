/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Must be the first import to ensure it evaluates before other imports.
import './disableProcessReport';

import { ExtensionContext } from 'vscode';
import { join } from '../../../util/vs/base/common/path';
import { baseActivate } from '../vscode/extension';
import { vscodeNodeContributions } from './contributions';
import { registerServices } from './services';

// ###############################################################################################
// ###                                                                                         ###
// ###                 Node extension that runs ONLY in node.js extension host.                ###
// ###                                                                                         ###
// ### !!! Prefer to add code in ../vscode/extension.ts to support all extension runtimes !!!  ###
// ###                                                                                         ###
// ###############################################################################################

//#region TODO@bpasero this needs cleanup
import '../../intents/node/allIntents';

function configureDevPackages() {
	try {
		const sourceMapSupport = require('source-map-support');
		sourceMapSupport.install();
		const dotenv = require('dotenv');
		const fs = require('fs');
		// Optional dev-only convenience: load `.env` from the vscode repo root only.
		const repoRoot = findRepoRoot(__dirname);
		if (repoRoot) {
			const repoEnv = join(repoRoot, '.env');
			if (fs.existsSync(repoEnv)) {
				dotenv.config({ path: repoEnv });
			}
		}
	} catch (err) {
		console.error(err);
	}
}

/** Walks up from `startDir` to find the VS Code repo root (dir containing product.json). */
function findRepoRoot(startDir: string): string | undefined {
	const fs = require('fs');
	let dir = startDir;
	for (let i = 0; i < 12; i++) {
		if (fs.existsSync(join(dir, 'product.json'))) {
			return dir;
		}
		const parent = dirname(dir);
		if (parent === dir) {
			break;
		}
		dir = parent;
	}
	return undefined;
}
//#endregion

export function activate(context: ExtensionContext, forceActivation?: boolean) {
	return baseActivate({
		context,
		registerServices,
		contributions: vscodeNodeContributions,
		configureDevPackages,
		forceActivation
	});
}
