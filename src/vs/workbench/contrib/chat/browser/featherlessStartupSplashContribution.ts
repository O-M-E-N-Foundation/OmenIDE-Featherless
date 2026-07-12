/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './media/featherlessStartupSplash.css';
import { Disposable, MutableDisposable } from '../../../../base/common/lifecycle.js';
import { DeferredPromise, disposableTimeout, raceTimeout, timeout } from '../../../../base/common/async.js';
import { $, append, getWindow } from '../../../../base/browser/dom.js';
import { mainWindow } from '../../../../base/browser/window.js';
import { localize } from '../../../../nls.js';
import { FileAccess } from '../../../../base/common/network.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { ISecretStorageService } from '../../../../platform/secrets/common/secrets.js';
import { IWorkbenchLayoutService } from '../../../services/layout/browser/layoutService.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';
import { IExtensionService } from '../../../services/extensions/common/extensions.js';
import { IChatEntitlementService, ChatEntitlementContextKeys } from '../../../services/chat/common/chatEntitlementService.js';
import { IExtensionsWorkbenchService } from '../../extensions/common/extensions.js';
import { ILanguageModelsService } from '../common/languageModels.js';
import { FEATHERLESS_EXTENSION_HAS_KEY_COMMAND, usesFeatherlessOnlyProvider } from '../../../services/chat/common/featherless.js';
import { readFeatherlessCredentialSecrets } from '../../../services/chat/common/featherlessSecrets.js';
import { ensureFeatherlessChatExtensionReady } from '../common/featherlessSetup.js';
import { IOnboardingService } from '../../welcomeOnboarding/common/onboardingService.js';

/**
 * Safety timeout (ms) after which the splash dismisses regardless of readiness,
 * so a hung service can never permanently block the IDE.
 */
const SPLASH_SAFETY_TIMEOUT_MS = 15_000;

type CredentialResolution = 'present' | 'absent' | 'unknown';

/** Natural size of `media/splash.png`. */
const SPLASH_IMAGE = { width: 1376, height: 768 } as const;

/**
 * Progress-track slot in `splash.png` (pixel rect in natural image space).
 * Live fill is positioned over this so it reads as part of the artwork.
 */
const SPLASH_PROGRESS_SLOT = { x: 369, y: 648, width: 638, height: 22 } as const;

type SplashOverlay = { element: HTMLElement; dispose(): void };

/**
 * Full-page loading splash shown on Featherless-only Omen IDE startups.
 *
 * Sequence:
 *  1. Splash shows immediately on construct.
 *  2. Resolve Featherless credentials from application-scoped secret storage.
 *  3. If confirmed absent → dismiss splash → show connect/onboarding UI.
 *  4. If present (or still unknown after timeout) → wait until chat/models are usable OR 15s timeout.
 *  5. On error/timeout → dismiss splash; IDE usable; AI disabled/degraded via existing paths.
 *
 * Auth is never re-prompted on workspace switches unless secrets are confirmed missing.
 * Uncertain secret-storage races dismiss the splash without the connect UI.
 *
 * The splash z-index (9000) sits below the onboarding overlay (10000) so the
 * connect/auth UI can render on top once the splash is dismissed.
 */
export class FeatherlessStartupSplashContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.featherlessStartupSplash';

	private readonly _overlayRef = this._register(new MutableDisposable<SplashOverlay>());
	private _statusEl: HTMLElement | undefined;
	private _backgroundEl: HTMLImageElement | undefined;
	private _contentEl: HTMLElement | undefined;
	private _progressEl: HTMLElement | undefined;
	private _progressBarEl: HTMLElement | undefined;
	private _progressPercent = 0;
	private _progressCreepTimer: number | undefined;
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
		@ISecretStorageService private readonly _secretStorageService: ISecretStorageService,
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

		const background = append(overlay, $<HTMLImageElement>('img.featherless-startup-splash-bg'));
		background.alt = '';
		this._backgroundEl = background;
		try {
			background.src = FileAccess.asBrowserUri('vs/workbench/contrib/chat/browser/media/splash.png').toString(true);
		} catch (err) {
			this._logService.warn('[featherless splash] could not load splash image', err);
		}

		const content = append(overlay, $('div.featherless-startup-splash-content'));
		this._contentEl = content;
		const logo = append(content, $<HTMLImageElement>('img.featherless-startup-splash-logo'));
		logo.alt = '';
		try {
			logo.src = FileAccess.asBrowserUri('vs/workbench/contrib/chat/browser/media/app-icon.png').toString(true);
		} catch (err) {
			this._logService.warn('[featherless splash] could not load app logo', err);
		}
		append(content, $('div.featherless-startup-splash-title')).textContent = localize('featherlessSplash.title', "Omen IDE");
		this._statusEl = append(content, $('div.featherless-startup-splash-status'));
		this._statusEl.textContent = localize('featherlessSplash.status', "Loading Omen IDE\u2026");

		const progress = append(overlay, $('div.featherless-startup-splash-progress'));
		this._progressEl = progress;
		this._progressBarEl = append(progress, $('span.featherless-startup-splash-progress-bar'));
		this._setProgress(8);

		const layout = () => this._layoutSplashChrome();
		background.addEventListener('load', layout);
		const ro = new ResizeObserver(layout);
		ro.observe(overlay);
		this._register({ dispose: () => ro.disconnect() });
		layout();
		getWindow(overlay).requestAnimationFrame(layout);

		this._overlayRef.value = { element: overlay, dispose: () => overlay.remove() };
	}

	/**
	 * Map natural splash.png coordinates through object-fit:cover so the live
	 * progress bar stays locked to the recessed track in the artwork.
	 */
	private _layoutSplashChrome(): void {
		const overlay = this._overlayRef.value?.element;
		const background = this._backgroundEl;
		const content = this._contentEl;
		const progress = this._progressEl;
		if (!overlay || !background || !content || !progress) {
			return;
		}

		const containerWidth = overlay.clientWidth;
		const containerHeight = overlay.clientHeight;
		if (containerWidth <= 0 || containerHeight <= 0) {
			return;
		}

		const imageWidth = background.naturalWidth || SPLASH_IMAGE.width;
		const imageHeight = background.naturalHeight || SPLASH_IMAGE.height;
		const scale = Math.max(containerWidth / imageWidth, containerHeight / imageHeight);
		const renderedWidth = imageWidth * scale;
		const renderedHeight = imageHeight * scale;
		const offsetX = (containerWidth - renderedWidth) / 2;
		const offsetY = (containerHeight - renderedHeight) / 2;

		const slotLeft = offsetX + (SPLASH_PROGRESS_SLOT.x / SPLASH_IMAGE.width) * renderedWidth;
		const slotTop = offsetY + (SPLASH_PROGRESS_SLOT.y / SPLASH_IMAGE.height) * renderedHeight;
		const slotWidth = (SPLASH_PROGRESS_SLOT.width / SPLASH_IMAGE.width) * renderedWidth;
		const slotHeight = (SPLASH_PROGRESS_SLOT.height / SPLASH_IMAGE.height) * renderedHeight;

		progress.style.left = `${slotLeft}px`;
		progress.style.top = `${slotTop}px`;
		progress.style.width = `${slotWidth}px`;
		progress.style.height = `${Math.max(4, slotHeight)}px`;

		// Branding card sits just above the artwork progress track.
		const contentWidth = Math.min(slotWidth * 0.72, containerWidth * 0.42, 360);
		content.style.width = `${contentWidth}px`;
		content.style.left = `${slotLeft + (slotWidth - contentWidth) / 2}px`;
		content.style.top = `${Math.max(12, slotTop - content.offsetHeight - Math.max(10, slotHeight * 0.8))}px`;
	}

	private _setStatus(text: string): void {
		if (this._statusEl) {
			this._statusEl.textContent = text;
		}
	}

	/** Monotonic progress only — the bar never moves backwards. */
	private _setProgress(percent: number): void {
		const next = Math.max(this._progressPercent, Math.min(100, percent));
		if (next === this._progressPercent && this._progressBarEl?.style.width) {
			return;
		}
		this._progressPercent = next;
		if (this._progressBarEl) {
			this._progressBarEl.style.width = `${next}%`;
		}
	}

	/**
	 * Slow forward creep toward `ceiling` while a stage is in-flight, so the bar
	 * doesn't look frozen — still never exceeds the ceiling or goes backwards.
	 */
	private _startProgressCreep(ceiling: number): void {
		this._stopProgressCreep();
		const start = Date.now();
		const from = this._progressPercent;
		const span = Math.max(0, ceiling - from);
		if (span <= 0) {
			return;
		}

		this._progressCreepTimer = mainWindow.setInterval(() => {
			if (this._dismissed || this._store.isDisposed) {
				this._stopProgressCreep();
				return;
			}
			const elapsedSec = (Date.now() - start) / 1000;
			// Ease toward the ceiling without reaching it until the real stage completes.
			const eased = from + span * (1 - Math.exp(-elapsedSec / 4.5));
			this._setProgress(Math.min(ceiling, eased));
		}, 100);
	}

	private _stopProgressCreep(): void {
		if (this._progressCreepTimer !== undefined) {
			mainWindow.clearInterval(this._progressCreepTimer);
			this._progressCreepTimer = undefined;
		}
	}

	private async _runSequence(): Promise<void> {
		try {
			this._setStatus(localize('featherlessSplash.status', "Loading Omen IDE\u2026"));
			this._setProgress(10);
			this._startProgressCreep(32);

			// 1. Resolve credentials from application-scoped secret storage.
			const credentials = await this._waitForCredentialResolution();
			this._stopProgressCreep();

			if (this._store.isDisposed || this._dismissed) {
				return;
			}

			// 2. Confirmed absent → connect/onboarding. Unknown must NOT re-prompt
			// (workspace switches can race secret-storage init and look empty briefly).
			if (credentials === 'absent') {
				this._logService.info('[featherless splash] no credentials — handing off to connect/onboarding');
				this._setProgress(100);
				this._dismiss();
				this._showConnectFlow();
				return;
			}

			if (credentials === 'unknown') {
				this._logService.warn('[featherless splash] credential state uncertain — continuing without re-prompting auth');
			}

			// 3. Credentials present (or unknown) → wait until chat/models are usable.
			this._setStatus(localize('featherlessSplash.preparing', "Preparing agents\u2026"));
			this._setProgress(42);
			this._startProgressCreep(88);
			await this._waitForReady();
			this._stopProgressCreep();
			this._setProgress(100);
			this._dismiss();
		} catch (err) {
			this._logService.warn(`[featherless splash] error during startup sequence: ${err instanceof Error ? err.message : String(err)}`);
			this._stopProgressCreep();
			this._setProgress(100);
			this._dismiss();
		}
	}

	/**
	 * Resolves application-scoped Featherless credentials.
	 * Returns `absent` only after a trustworthy empty read from persisted storage.
	 */
	private async _waitForCredentialResolution(): Promise<CredentialResolution> {
		const deadline = Date.now() + SPLASH_SAFETY_TIMEOUT_MS;
		let last: CredentialResolution = 'unknown';

		while (Date.now() < deadline) {
			if (this._store.isDisposed || this._dismissed) {
				return last;
			}

			if (this._contextKeyService.getContextKeyValue<boolean>(ChatEntitlementContextKeys.hasFeatherlessCredentials.key) === true) {
				return 'present';
			}

			last = await this._readCredentialState();
			if (last === 'present') {
				return last;
			}
			if (last === 'absent') {
				// Persisted empty read — confirm with the extension before signing out.
				break;
			}

			await timeout(200);
		}

		// Final authoritative checks before giving up.
		if (this._contextKeyService.getContextKeyValue<boolean>(ChatEntitlementContextKeys.hasFeatherlessCredentials.key) === true) {
			return 'present';
		}
		last = await this._readCredentialState();
		if (last === 'present') {
			return last;
		}

		// Ask the extension itself — it uses the correct SecretStorage keys.
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
			const hasFromExtension = await this._commandService.executeCommand<boolean>(FEATHERLESS_EXTENSION_HAS_KEY_COMMAND);
			if (hasFromExtension) {
				return 'present';
			}
		} catch {
			// Extension may not be available yet.
		}

		return last === 'absent' ? 'absent' : last;
	}

	private async _readCredentialState(): Promise<CredentialResolution> {
		try {
			const { apiKey, oauthToken } = await readFeatherlessCredentialSecrets(this._secretStorageService);
			if (!!apiKey || !!oauthToken) {
				return 'present';
			}
			// In-memory/unknown secret storage can look empty during workspace
			// switches before OS encryption is ready — do not treat as signed out.
			if (this._secretStorageService.type !== 'persisted') {
				return 'unknown';
			}
			return 'absent';
		} catch (err) {
			this._logService.warn(`[featherless splash] secret read failed: ${err instanceof Error ? err.message : String(err)}`);
			return 'unknown';
		}
	}

	/**
	 * Ensures the Omen IDE chat extension is ready and waits until Featherless
	 * models are registered. One safety deadline covers extension setup + model wait.
	 */
	private async _waitForReady(): Promise<void> {
		const ready = new DeferredPromise<void>();

		const checkModels = (): void => {
			if (this._store.isDisposed || this._dismissed) {
				ready.complete(undefined);
				return;
			}
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

		const work = (async () => {
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
				this._setProgress(72);
				this._setStatus(localize('featherlessSplash.models', "Loading models\u2026"));
			} catch (err) {
				this._logService.warn(`[featherless splash] chat extension ready failed: ${err instanceof Error ? err.message : String(err)}`);
				return;
			}

			if (this._store.isDisposed || this._dismissed) {
				return;
			}

			checkModels();
			await ready.p;
			this._setProgress(96);
		})();

		await raceTimeout(work, SPLASH_SAFETY_TIMEOUT_MS);
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
		this._stopProgressCreep();
		this._setProgress(100);

		const overlay = this._overlayRef.value?.element;
		if (!overlay) {
			this._overlayRef.clear();
			return;
		}

		overlay.classList.add('featherless-startup-splash-dismissed');
		overlay.setAttribute('aria-busy', 'false');
		// Fade then remove. Contribution dispose() clears the overlay synchronously instead.
		this._register(disposableTimeout(() => {
			if (this._overlayRef.value?.element === overlay) {
				this._overlayRef.clear();
			} else {
				overlay.remove();
			}
		}, 240));
	}

	override dispose(): void {
		// Sync remove — deferred dismiss timeouts are cancelled by store disposal.
		this._dismissed = true;
		this._stopProgressCreep();
		this._statusEl = undefined;
		this._backgroundEl = undefined;
		this._contentEl = undefined;
		this._progressEl = undefined;
		this._progressBarEl = undefined;
		this._overlayRef.clear();
		super.dispose();
	}
}
