/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { raceTimeout } from '../../../../base/common/async.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { localize } from '../../../../nls.js';
import { ExtensionIdentifier } from '../../../../platform/extensions/common/extensions.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';
import { EnablementState } from '../../../services/extensionManagement/common/extensionManagement.js';
import { IExtensionService } from '../../../services/extensions/common/extensions.js';
import { IChatEntitlementService } from '../../../services/chat/common/chatEntitlementService.js';
import { FEATHERLESS_EXTENSION_BOOTSTRAP_COMMAND, FEATHERLESS_EXTENSION_HAS_KEY_COMMAND, usesFeatherlessOnlyProvider } from '../../../services/chat/common/featherless.js';
import { IExtensionsWorkbenchService } from '../../extensions/common/extensions.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { ILanguageModelsService } from './languageModels.js';

/**
 * Ensures the in-tree Omen IDE chat extension (`OmenIDE.omenide-chat`, built from
 * `extensions/copilot`) is enabled, activated, and chat setup is marked complete.
 *
 * This is NOT GitHub Copilot — the folder name is legacy. No marketplace install
 * or GitHub signup is performed.
 */
export async function ensureFeatherlessChatExtensionReady(
	extensionsWorkbenchService: IExtensionsWorkbenchService,
	extensionService: IExtensionService,
	chatEntitlementService: IChatEntitlementService,
	productService: IProductService,
	logService: ILogService,
	commandService?: ICommandService,
	languageModelsService?: ILanguageModelsService,
): Promise<void> {
	const chatExtensionId = productService.defaultChatAgent?.chatExtensionId;
	if (!chatExtensionId) {
		return;
	}

	if (!chatEntitlementService.sentiment.completed) {
		try {
			chatEntitlementService.markSetupCompleted();
		} catch (err) {
			logService.warn(`[featherless setup] markSetupCompleted failed: ${err instanceof Error ? err.message : String(err)}`);
		}
	}

	await extensionService.whenInstalledExtensionsRegistered();
	await extensionsWorkbenchService.queryLocal();

	const chatExtension = extensionsWorkbenchService.local.find(
		e => ExtensionIdentifier.equals(e.identifier.id, chatExtensionId)
	);

	if (!chatExtension?.local) {
		logService.error(`[featherless setup] Omen IDE chat extension not installed (${chatExtensionId}). Run: npm run compile-copilot`);
		return;
	}

	if (
		chatExtension.enablementState === EnablementState.DisabledGlobally
		|| chatExtension.enablementState === EnablementState.DisabledWorkspace
	) {
		logService.info(`[featherless setup] enabling disabled Omen IDE chat extension (${chatExtensionId})`);
		await extensionsWorkbenchService.setEnablement([chatExtension], EnablementState.EnabledGlobally);
		await extensionsWorkbenchService.updateRunningExtensions(localize('enableOmenIDEChatExtension', "Enabling Omen IDE"));
	}

	const extensionIdentifier = new ExtensionIdentifier(chatExtensionId);
	const isActivated = (): boolean => {
		const status = extensionService.getExtensionsStatus();
		for (const id of Object.keys(status)) {
			if (ExtensionIdentifier.equals(id, extensionIdentifier) && status[id].activationTimes !== undefined) {
				return true;
			}
		}
		return false;
	};

	if (isActivated()) {
		return;
	}

	try {
		await extensionService.activateById(extensionIdentifier, {
			activationEvent: 'onStartupFinished',
			extensionId: extensionIdentifier,
			startup: false,
		});
	} catch (err) {
		logService.warn(`[featherless setup] extension activation failed: ${err instanceof Error ? err.message : String(err)}`);
		return;
	}

	if (isActivated()) {
		return;
	}

	const store = new DisposableStore();
	try {
		await raceTimeout(new Promise<void>(resolve => {
			const check = () => {
				if (isActivated()) {
					resolve();
				}
			};
			store.add(extensionService.onDidChangeExtensionsStatus(check));
			check();
		}), 8000);
	} finally {
		store.dispose();
	}

	if (usesFeatherlessOnlyProvider(productService) && commandService) {
		try {
			const hasCredentials = await commandService.executeCommand<boolean>(FEATHERLESS_EXTENSION_HAS_KEY_COMMAND);
			if (hasCredentials) {
				await commandService.executeCommand(FEATHERLESS_EXTENSION_BOOTSTRAP_COMMAND);
				if (languageModelsService) {
					await raceTimeout(new Promise<void>(resolve => {
						if (languageModelsService.getLanguageModelIds().some(id => id.startsWith('featherless/'))) {
							resolve();
							return;
						}
						const listener = languageModelsService.onDidChangeLanguageModels(() => {
							if (languageModelsService.getLanguageModelIds().some(id => id.startsWith('featherless/'))) {
								listener.dispose();
								resolve();
							}
						});
					}), 10000);
				}
			}
		} catch (err) {
			logService.warn(`[featherless setup] bootstrap deferred: ${err instanceof Error ? err.message : String(err)}`);
		}
	}
}

/**
 * Eagerly enables and activates the in-tree Omen IDE chat extension on startup
 * so Featherless BYOK models are available without waiting for user interaction.
 */
export class FeatherlessChatExtensionBootstrapContribution implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.featherlessChatExtensionBootstrap';

	constructor(
		@IExtensionsWorkbenchService extensionsWorkbenchService: IExtensionsWorkbenchService,
		@IExtensionService extensionService: IExtensionService,
		@IChatEntitlementService chatEntitlementService: IChatEntitlementService,
		@IProductService productService: IProductService,
		@ILogService logService: ILogService,
	) {
		if (!usesFeatherlessOnlyProvider(productService)) {
			return;
		}
		void ensureFeatherlessChatExtensionReady(
			extensionsWorkbenchService,
			extensionService,
			chatEntitlementService,
			productService,
			logService,
		);
	}
}
