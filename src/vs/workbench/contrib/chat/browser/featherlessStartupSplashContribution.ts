/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './media/featherlessStartupSplash.css';
import { Disposable, MutableDisposable } from '../../../../base/common/lifecycle.js';
import { DeferredPromise, disposableTimeout, raceTimeout } from '../../../../base/common/async.js';
import { $, append } from '../../../../base/browser/dom.js';
import { localize } from '../../../../nls.js';
import { FileAccess } from '../../../../base/common/network.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IWorkbenchLayoutService } from '../../../services/layout/browser/layoutService.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';
import { IExtensionService } from '../../../services/extensions/common/extensions.js';
import { IChatEntitlementService } from '../../../services/chat/common/chatEntitlementService.js';
import { ChatEntitlementContextKeys } from '../../../services/chat/common/chatEntitlementService.js';
import { IExtensionsWorkbenchService } from '../../extensions/common/extensions.js';
import { ILanguageModelsService } from '../common/languageModels.js';
import { usesFeatherlessOnlyProvider } from '../../../services/chat/common/featherless.js';
import { ensureFeatherlessChatExtensionReady } from '../common/featherlessSetup.js';
import { IOnboardingService } from '../../welcomeOnboarding/common/onboardingService.js';

/**
 * Safety timeout (ms) after which the splash dismisses regardless of readiness,
 * so a hung service can never permanently block the IDE.
 */
const SPLASH_SAFETY_TIMEOUT_MS = 15_000;

/**
 * Full-page loading splash shown on Featherless-only Omen IDE startups.
 *
 * Sequence:
 *  1. Splash shows immediately on construct.
 *  2. Wait for Featherless credential resolution (`omenide.hasFeatherlessCredentials`).
 *  3. If no credentials → dismiss splash → show existing connect/onboarding UI.
 *  4. If credentials present → wait until chat/models are usable OR 15s timeout.
 *  5. On error/timeout → dismiss splash; IDE usable; AI disabled/degraded via existing paths.
 *
 * The splash z-index (9000) sits below the onboarding overlay (10000) so the
 * connect/auth UI can render on top once the splash is dismissed.
 */
export class FeatherlessStartupSplashContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.featherlessStartupSplash';

	private readonly _overlayRef = this._register(new MutableDisposable<{ element: HTMLElement }>());
	private _dismissed = false;

	constructor(
		@IWorkbenchLayoutService private readonly _layoutService: IWorkbenchLayoutService,
		@IContextKeyService private readonly _contextKeyService: IContextKeyService,
		@IProductService private readonly _productService: IProductService,
		@ILogService private readonly _logService: ILogService,
		@ICommandService private readonly _commandService: ICommandService,
		@IExtensionService private readonly _extensionService: IExtensionService,
		@IExtensionsWorkbenchService private readonly _extensionsWorkbenchService: IExtensionsWorkbenchService,
		@IChatEntitlementService private readonly _chatEntitlementService: IChatEntitlementService,
		@ILanguageModelsService private readonly _languageModelsService: ILanguageModelsService,
		@IOnboardingService private readonly _onboardingService: IOnboardingService,
	) {
		super();

		if (!usesFeatherlessOnlyProvider(this._productService)) {
			return;
		}

		this._showOverlay();
		void this._runSequence();
	}

	private _showOverlay(): void {
		const overlay = append(this._layoutService.mainContainer, $('div.featherless-startup-splash'));
		overlay.setAttribute('role', 'status');
		overlay.setAttribute('aria-busy', 'true');
		overlay.setAttribute('aria-label', localize('featherlessSplash.loading', "Loading Omen IDE"));

		const mark = append(overlay, $('img.featherless-startup-splash-mark'));
		mark.alt = '';
		try {
			mark.src = FileAccess.asBrowserUri('resources/omen/app-icon.svg').toString(true);
		} catch (err) {
			this._logService.warn('[featherless splash] could not load app icon', err);
		}

		append(overlay, $('div.featherless-startup-splash-title')).textContent = localize('featherlessSplash.title', "Omen IDE");
		append(overlay, $('div.featherless-startup-splash-status')).textContent = localize('featherlessSplash.status', "Loading Omen IDE\u2026");

		const progress = append(overlay, $('div.featherless-startup-splash-progress'));
		append(progress, $('span.featherless-startup-splash-progress-bar'));

		this._overlayRef.value = { element: overlay, dispose: () => overlay.remove() };
	}

	private _setStatus(text: string): void {
		const overlay = this._overlayRef.value?.element;
		overlay?.querySelector('.featherless-startup-splash-status')?.replaceChildren(text);
	}

	private async _runSequence(): Promise<void> {
		try {
			// 1. Wait for Featherless credential resolution (OAuth/API key present OR confirmed missing).
			const hasCredentials = await this._waitForCredentialResolution();

			if (this._store.isDisposed || this._dismissed) {
				return;
			}

			// 2. No credentials → dismiss splash and surface the existing connect/onboarding UI.
			if (!hasCredentials) {
				this._logService.info('[featherless splash] no credentials — handing off to connect/onboarding');
				this._dismiss();
				this._showConnectFlow();
				return;
			}

			// 3. Credentials present → wait until chat/models are usable, racing the safety timeout.
			this._setStatus(localize('featherlessSplash.preparing', "Preparing agents\u2026"));
			await this._waitForReady();
			this._dismiss();
		} catch (err) {
			this._logService.warn(`[featherless splash] error during startup sequence: ${err instanceof Error ? err.message : String(err)}`);
			this._dismiss();
		}
	}

	/**
	 * Resolves once `omenide.hasFeatherlessCredentials` has a definitive value
	 * (true or false), racing the safety timeout so a missing secret-storage
	 * response cannot block forever.
	 */
	private async _waitForCredentialResolution(): Promise<boolean> {
		const resolved = new DeferredPromise<boolean>();

		const check = (): void => {
			const value = this._contextKeyService.getContextKeyValue<boolean>(ChatEntitlementContextKeys.hasFeatherlessCredentials.key);
			if (value === true) {
				resolved.complete(true);
			} else if (value === false) {
				// `false` is only definitive once the FeatherlessCredentialsContribution refresh
				// has run. Give it a tick to settle before treating false as final.
				disposableTimeout(() => {
					if (!resolved.isSettled) {
						const v = this._contextKeyService.getContextKeyValue<boolean>(ChatEntitlementContextKeys.hasFeatherlessCredentials.key);
						resolved.complete(v === true);
					}
				}, 500, this._store);
			}
		};

		const listener = this._register(this._contextKeyService.onDidChangeContext(e => {
			if (e.affectsSome(new Set([ChatEntitlementContextKeys.hasFeatherlessCredentials.key]))) {
				check();
			}
		}));

		check();

		const result = await raceTimeout(resolved.p, SPLASH_SAFETY_TIMEOUT_MS);
		listener.dispose();

		// On timeout, treat as "no credentials" so the connect flow is shown.
		return result === true;
	}

	/**
	 * Ensures the Omen IDE chat extension is ready and waits until Featherless
	 * models are registered (or the safety timeout fires). Errors/timeouts fall
	 * through to dismissal; the IDE remains usable with AI degraded.
	 */
	private async _waitForReady(): Promise<void> {
		try {
			await ensureFeatherlessChatExtensionReady(
				this._extensionsWorkbenchService,
				this._extensionService,
				this._chatEntitlementService,
				this._productService,
				this._logService,
				this._commandService,
				this._languageModelsService,
			);
		} catch (err) {
			this._logService.warn(`[featherless splash] chat extension ready failed: ${err instanceof Error ? err.message : String(err)}`);
			return;
		}

		if (this._store.isDisposed || this._dismissed) {
			return;
		}

		// Wait for at least one Featherless model OR omenide.hasByokModels, racing the timeout.
		const ready = new DeferredPromise<void>();

		const checkModels = (): void => {
			if (this._languageModelsService.getLanguageModelIds().some(id => id.startsWith('featherless/'))) {
				ready.complete(undefined);
				return;
			}
			if (this._contextKeyService.getContextKeyValue<boolean>(ChatEntitlementContextKeys.hasByokModels.key) === true) {
				ready.complete(undefined);
			}
		};

		const modelListener = this._register(this._languageModelsService.onDidChangeLanguageModels(() => checkModels()));
		const ctxListener = this._register(this._contextKeyService.onDidChangeContext(e => {
			if (e.affectsSome(new Set([ChatEntitlementContextKeys.hasByokModels.key]))) {
				checkModels();
			}
		}));

		checkModels();

		await raceTimeout(ready.p, SPLASH_SAFETY_TIMEOUT_MS);
		modelListener.dispose();
		ctxListener.dispose();
	}

	/**
	 * Surfaces the existing connect/onboarding UI. Prefers the onboarding overlay
	 * when available; otherwise triggers the Featherless sign-in / API-key commands.
	 */
	private _showConnectFlow(): void {
		try {
			this._onboardingService.show();
		} catch (err) {
			this._logService.warn('[featherless splash] onboarding show failed, falling back to sign-in command', err);
			void this._commandService.executeCommand('workbench.action.chat.signInFeatherless');
		}
	}

	private _dismiss(): void {
		if (this._dismissed) {
			return;
		}
		this._dismissed = true;

		const overlay = this._overlayRef.value?.element;
		if (!overlay) {
			this._overlayRef.clear();
			return;
		}

		overlay.classList.add('featherless-startup-splash-dismissed');
		overlay.setAttribute('aria-busy', 'false');
		this._register(disposableTimeout(() => {
			overlay.remove();
			this._overlayRef.clear();
		}, 240));
	}

	override dispose(): void {
		this._dismiss();
		super.dispose();
	}
}