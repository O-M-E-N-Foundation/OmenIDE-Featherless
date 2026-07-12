/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { timeout } from '../../../../base/common/async.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { $, append, addDisposableListener, EventType, clearNode, getActiveWindow } from '../../../../base/browser/dom.js';
import { isCancellationError } from '../../../../base/common/errors.js';
import { StopWatch } from '../../../../base/common/stopwatch.js';
import { URI } from '../../../../base/common/uri.js';
import { isWindows, isMacintosh, isLinux } from '../../../../base/common/platform.js';
import { assertDefined } from '../../../../base/common/types.js';
import { FileAccess } from '../../../../base/common/network.js';
import { IWorkbenchLayoutService, Parts } from '../../../services/layout/browser/layoutService.js';
import { KeyCode } from '../../../../base/common/keyCodes.js';
import { StandardKeyboardEvent } from '../../../../base/browser/keyboardEvent.js';
import { InputBox, MessageType } from '../../../../base/browser/ui/inputbox/inputBox.js';
import { localize } from '../../../../nls.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { renderIcon } from '../../../../base/browser/ui/iconLabel/iconLabels.js';
import { Action } from '../../../../base/common/actions.js';
import { IWorkbenchThemeService } from '../../../services/themes/common/workbenchThemeService.js';
import { EXTENSION_INSTALL_SKIP_WALKTHROUGH_CONTEXT, IExtensionGalleryService, IExtensionManagementService } from '../../../../platform/extensionManagement/common/extensionManagement.js';
import { GitHubPaths, IDefaultAccountService } from '../../../../platform/defaultAccount/common/defaultAccount.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { INotificationService, Severity } from '../../../../platform/notification/common/notification.js';
import { ConfigurationTarget, IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { defaultInputBoxStyles } from '../../../../platform/theme/browser/defaultStyles.js';
import product from '../../../../platform/product/common/product.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IPathService } from '../../../services/path/common/pathService.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { InstallChatEvent, InstallChatClassification, ChatSetupStrategy } from '../../chat/browser/chatSetup/chatSetup.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IAccessibilityService } from '../../../../platform/accessibility/common/accessibility.js';
import { ISecretStorageService } from '../../../../platform/secrets/common/secrets.js';
import { IExtensionService } from '../../../services/extensions/common/extensions.js';
import { IExtensionsWorkbenchService } from '../../extensions/common/extensions.js';
import { IChatEntitlementService } from '../../../services/chat/common/chatEntitlementService.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { ensureFeatherlessChatExtensionReady } from '../../chat/common/featherlessSetup.js';
import { FEATHERLESS_EXTENSION_BOOTSTRAP_COMMAND, FEATHERLESS_EXTENSION_HAS_KEY_COMMAND, FEATHERLESS_EXTENSION_SET_KEY_COMMAND, FEATHERLESS_EXTENSION_SIGN_IN_COMMAND } from '../../../services/chat/common/featherless.js';
import { ExtensionIdentifier } from '../../../../platform/extensions/common/extensions.js';
import {
	OnboardingStepId,
	ONBOARDING_STEPS,
	ONBOARDING_AI_PREFERENCE_OPTIONS,
	AiCollaborationMode,
	IOnboardingThemeOption,
	getOnboardingStepTitle,
	getOnboardingStepSubtitle,
	GHE_FULL_URI_REGEX,
	GheParseResultKind,
	parseGheInstanceInput,
} from '../common/onboardingTypes.js';
import { IOnboardingService } from '../common/onboardingService.js';

type OnboardingStepViewClassification = {
	owner: 'cwebster-99';
	comment: 'Tracks which onboarding step is viewed.';
	step: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'The step identifier.' };
	stepNumber: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; isMeasurement: true; comment: 'The 1-based step index.' };
};

type OnboardingStepViewEvent = {
	step: string;
	stepNumber: number;
};

type OnboardingActionClassification = {
	owner: 'cwebster-99';
	comment: 'Tracks actions taken on the onboarding wizard.';
	action: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'The action performed.' };
	step: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'The step the action was performed on.' };
	argument: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'Optional context such as theme id, extension id, or provider.' };
};

type OnboardingActionEvent = {
	action: string;
	step: string;
	argument: string | undefined;
};

type EnterpriseSignInUiState = 'options' | 'instance' | 'progress';

import {
	FEATHERLESS_API_KEY_SECRET,
	OMENIDE_CHAT_EXTENSION_ID,
	getExtensionSecretStorageKey,
	readFeatherlessCredentialSecrets,
} from '../../../services/chat/common/featherlessSecrets.js';

assertDefined(product.defaultChatAgent, 'Onboarding requires a default chat agent product configuration.');
const defaultChat = product.defaultChatAgent;

/** Extension id for the in-tree Copilot/Featherless extension (`extensions/copilot`). */
const COPILOT_CHAT_EXTENSION_ID = new ExtensionIdentifier(OMENIDE_CHAT_EXTENSION_ID);

/**
 * Variation A — Classic Wizard Modal
 *
 * A centered modal overlay with progress dots, clean step transitions,
 * and polished navigation. Sits on top of the agent sessions welcome
 * tab. When dismissed, the welcome tab is revealed underneath.
 *
 * Steps:
 * 1. Sign In — sessions-style sign-in hero with GitHub Copilot, Google, and Apple options
 * 2. Personalize — Theme selection grid + keymap pills
 * 3. Agent Sessions — Feature cards showcasing AI capabilities
 */
export class OnboardingVariationA extends Disposable implements IOnboardingService {

	declare readonly _serviceBrand: undefined;

	private readonly _onDidComplete = this._register(new Emitter<void>());
	readonly onDidComplete: Event<void> = this._onDidComplete.event;

	private readonly _onDidDismiss = this._register(new Emitter<void>());
	readonly onDidDismiss: Event<void> = this._onDidDismiss.event;

	private overlay: HTMLElement | undefined;
	private card: HTMLElement | undefined;
	private bodyEl: HTMLElement | undefined;
	private progressContainer: HTMLElement | undefined;
	private stepLabelEl: HTMLElement | undefined;
	private titleEl: HTMLElement | undefined;
	private subtitleEl: HTMLElement | undefined;
	private contentEl: HTMLElement | undefined;
	private backButton: HTMLButtonElement | undefined;
	private nextButton: HTMLButtonElement | undefined;
	private closeButton: HTMLButtonElement | undefined;
	private footerLeft: HTMLElement | undefined;
	private _footerSignInBtn: HTMLButtonElement | undefined;

	private currentStepIndex = 0;
	private readonly steps = ONBOARDING_STEPS;
	private readonly disposables = this._register(new DisposableStore());
	private readonly stepDisposables = this._register(new DisposableStore());
	private previouslyFocusedElement: HTMLElement | undefined;
	private _isShowing = false;

	private readonly footerFocusableElements: HTMLElement[] = [];
	private readonly stepFocusableElements: HTMLElement[] = [];
	private selectedThemeId = 'dark-2026';
	private selectedKeymapId = 'vscode';
	private _detectedEditorIds: Set<string> | undefined;
	private _userSignedIn = false;
	private selectedAiMode: AiCollaborationMode = AiCollaborationMode.Balanced;
	private enterpriseSignInUiState: EnterpriseSignInUiState = 'options';
	private enterpriseInstanceValue = '';
	private enterpriseSignInWatch: StopWatch | undefined;
	private featherlessApiKeyValue = '';
	private featherlessApiKeyConfigured = false;
	private featherlessOAuthConfigured = false;
	private featherlessApiKeyInputBox: InputBox | undefined;
	private _auxBarWasVisibleBeforeOAuth: boolean | undefined;

	constructor(
		@IWorkbenchLayoutService private readonly layoutService: IWorkbenchLayoutService,
		@IWorkbenchThemeService private readonly themeService: IWorkbenchThemeService,
		@IDefaultAccountService private readonly defaultAccountService: IDefaultAccountService,
		@IExtensionGalleryService private readonly extensionGalleryService: IExtensionGalleryService,
		@IExtensionManagementService private readonly extensionManagementService: IExtensionManagementService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@INotificationService private readonly notificationService: INotificationService,
		@IFileService private readonly fileService: IFileService,
		@IPathService private readonly pathService: IPathService,
		@ITelemetryService private readonly telemetryService: ITelemetryService,
		@ICommandService private readonly commandService: ICommandService,
		@IAccessibilityService private readonly accessibilityService: IAccessibilityService,
		@ISecretStorageService private readonly secretStorageService: ISecretStorageService,
		@IExtensionService private readonly extensionService: IExtensionService,
		@IExtensionsWorkbenchService private readonly extensionsWorkbenchService: IExtensionsWorkbenchService,
		@IChatEntitlementService private readonly chatEntitlementService: IChatEntitlementService,
		@IProductService private readonly productService: IProductService,
		@ILogService private readonly logService: ILogService,
	) {
		super();

		// Detect currently active theme
		const currentTheme = this.themeService.getColorTheme();
		const allThemes = product.onboardingThemes ?? [];
		const matchingTheme = allThemes.find(t => t.themeId === currentTheme.settingsId);
		if (matchingTheme) {
			this.selectedThemeId = matchingTheme.id;
		}

		// Start detecting installed editors early so results are ready by the Personalize step
		this._detectInstalledEditors().then(ids => { this._detectedEditorIds = ids; });
	}

	get isShowing(): boolean {
		return this._isShowing;
	}

	show(): void {
		if (this.overlay) {
			return;
		}

		this._isShowing = true;
		this.previouslyFocusedElement = getActiveWindow().document.activeElement as HTMLElement | undefined;

		const container = this.layoutService.activeContainer;

		// Overlay
		this.overlay = append(container, $('.onboarding-a-overlay'));
		this.overlay.setAttribute('role', 'dialog');
		this.overlay.setAttribute('aria-modal', 'true');
		this.overlay.setAttribute('aria-label', localize('onboarding.a.aria', "Welcome to Omen IDE"));

		// Card
		this.card = append(this.overlay, $('.onboarding-a-card'));

		// Close button (upper-right corner of card)
		this.closeButton = append(this.card, $<HTMLButtonElement>('button.onboarding-a-close-btn'));
		this.closeButton.type = 'button';
		this.closeButton.setAttribute('aria-label', localize('onboarding.close', "Close"));
		this.closeButton.appendChild(renderIcon(Codicon.close));

		// Header with progress
		const header = append(this.card, $('.onboarding-a-header'));
		this.progressContainer = append(header, $('.onboarding-a-progress'));
		this.stepLabelEl = append(this.progressContainer, $('span.onboarding-a-step-label'));
		this._renderProgress();

		// Body
		this.bodyEl = append(this.card, $('.onboarding-a-body'));
		this.titleEl = append(this.bodyEl, $('h2.onboarding-a-step-title'));
		this.subtitleEl = append(this.bodyEl, $('p.onboarding-a-step-subtitle'));
		this.contentEl = append(this.bodyEl, $('.onboarding-a-step-content'));
		this._renderStep();
		this._logStepView();

		// Footer
		const footer = append(this.card, $('.onboarding-a-footer'));

		this.footerLeft = append(footer, $('.onboarding-a-footer-left'));

		const footerRight = append(footer, $('.onboarding-a-footer-right'));

		this.backButton = append(footerRight, $<HTMLButtonElement>('button.onboarding-a-btn.onboarding-a-btn-secondary'));
		this.backButton.textContent = localize('onboarding.back', "Back");
		this.backButton.type = 'button';
		this.footerFocusableElements.push(this.backButton);

		this.nextButton = append(footerRight, $<HTMLButtonElement>('button.onboarding-a-btn.onboarding-a-btn-primary'));
		this.nextButton.type = 'button';
		this.footerFocusableElements.push(this.nextButton);
		this._updateButtonStates();

		// Event handlers
		this.disposables.add(addDisposableListener(this.closeButton, EventType.CLICK, () => {
			this._logAction('skip');
			this._dismiss('skip');
		}));
		this.disposables.add(addDisposableListener(this.backButton, EventType.CLICK, () => {
			this._logAction('back');
			this._prevStep();
		}));
		this.disposables.add(addDisposableListener(this.nextButton, EventType.CLICK, () => {
			void this._handleNextClick();
		}));

		// Intentionally modal: clicking the backdrop must NOT dismiss the wizard.
		// Only the close button or an explicit step action may change state.

		this.disposables.add(addDisposableListener(this.overlay, EventType.KEY_DOWN, (e: KeyboardEvent) => {
			const event = new StandardKeyboardEvent(e);

			// Prevent all keyboard shortcuts from reaching the keybinding service
			e.stopPropagation();

			if (event.keyCode === KeyCode.Escape) {
				e.preventDefault();
				this._dismiss('skip');
				return;
			}

			if (event.keyCode === KeyCode.Tab) {
				this._trapTab(e, event.shiftKey);
			}
		}));

		// Entrance animation
		this.overlay.classList.add('entering');
		getActiveWindow().requestAnimationFrame(() => {
			this.overlay?.classList.remove('entering');
			this.overlay?.classList.add('visible');
		});

		this._focusCurrentStepElement();
	}

	private async _handleNextClick(): Promise<void> {
		if (!(await this._tryAdvanceFromCurrentStep())) {
			return;
		}
		this._advanceFromCurrentStep();
	}

	/** Move past the current step after validation/auth succeeded. */
	private _advanceFromCurrentStep(): void {
		if (this._isLastStep()) {
			this._logAction('complete');
			this._dismiss('complete');
		} else {
			this._logAction('next');
			this._nextStep();
		}
	}

	private async _tryAdvanceFromCurrentStep(): Promise<boolean> {
		const stepId = this.steps[this.currentStepIndex];
		if (stepId === OnboardingStepId.FeatherlessApiKey) {
			if (this._hasFeatherlessCredentials()) {
				return true;
			}
			return this._saveFeatherlessApiKeyFromWizard();
		}
		return true;
	}

	private _hasFeatherlessCredentials(): boolean {
		return this.featherlessApiKeyConfigured || this.featherlessOAuthConfigured;
	}

	private async _saveFeatherlessApiKeyFromWizard(): Promise<boolean> {
		if (this._hasFeatherlessCredentials()) {
			return true;
		}

		const key = this.featherlessApiKeyValue.trim();
		if (!key) {
			this.featherlessApiKeyInputBox?.showMessage({
				type: MessageType.ERROR,
				content: localize('onboarding.featherlessApiKey.required', "Sign in with Featherless or enter your API key to continue."),
			});
			return false;
		}

		if (this.nextButton) {
			this.nextButton.disabled = true;
			this.nextButton.textContent = localize('onboarding.featherlessApiKey.saving', "Saving…");
		}

		try {
			// Write directly to the same secret-storage slot the Copilot BYOK layer
			// uses. The onboarding wizard opens before the extension has activated
			// (activation is onStartupFinished), so extension commands are not
			// available yet — but secret storage is always reachable from the workbench.
			await this.secretStorageService.set(
				getExtensionSecretStorageKey(COPILOT_CHAT_EXTENSION_ID.value, FEATHERLESS_API_KEY_SECRET),
				key,
			);
			this.featherlessApiKeyConfigured = true;
			this.featherlessApiKeyInputBox?.hideMessage();

			// Do not block the wizard on extension activation / provider registration.
			// The key is already in secret storage; BYOK will pick it up when ready.
			void this._activateFeatherlessExtension(key);
			return true;
		} catch (err) {
			if (this.nextButton) {
				this.nextButton.disabled = false;
			}
			this._updateButtonStates();

			const detail = err instanceof Error ? err.message : String(err);
			this.notificationService.notify({
				severity: Severity.Error,
				message: localize('onboarding.featherlessApiKey.saveFailed', "Could not save your Featherless API key ({0}). You can also set it later from the Command Palette: \"Omen IDE: Configure Featherless API Key\".", detail),
			});
			return false;
		}
	}

	private async _activateFeatherlessExtension(key: string): Promise<void> {
		try {
			await ensureFeatherlessChatExtensionReady(
				this.extensionsWorkbenchService,
				this.extensionService,
				this.chatEntitlementService,
				this.productService,
				this.logService,
				this.commandService,
			);
			await this.commandService.executeCommand(FEATHERLESS_EXTENSION_SET_KEY_COMMAND, key);
			await this.commandService.executeCommand(FEATHERLESS_EXTENSION_BOOTSTRAP_COMMAND);
		} catch (err) {
			this.logService.warn(`[onboarding] Featherless activation deferred: ${err instanceof Error ? err.message : String(err)}`);
		}
	}

	private async _readFeatherlessOAuthFromStorage(): Promise<boolean> {
		const { oauthToken } = await readFeatherlessCredentialSecrets(this.secretStorageService);
		return !!oauthToken;
	}

	private async _readFeatherlessApiKeyFromStorage(): Promise<string | undefined> {
		const { apiKey } = await readFeatherlessCredentialSecrets(this.secretStorageService);
		return apiKey;
	}

	private async _refreshFeatherlessApiKeyState(): Promise<boolean> {
		this.featherlessApiKeyConfigured = !!(await this._readFeatherlessApiKeyFromStorage());
		this.featherlessOAuthConfigured = await this._readFeatherlessOAuthFromStorage();

		// Prefer the extension's view of credentials when secret-storage reads race or miss.
		if (!this._hasFeatherlessCredentials()) {
			try {
				const hasFromExtension = await this.commandService.executeCommand<boolean>(FEATHERLESS_EXTENSION_HAS_KEY_COMMAND);
				if (hasFromExtension) {
					this.featherlessOAuthConfigured = true;
				}
			} catch {
				// Extension may not be activated yet.
			}
		}

		this._updateButtonStates();
		return this._hasFeatherlessCredentials();
	}

	private async _signInWithFeatherlessOAuthFromWizard(oauthBtn?: HTMLButtonElement, oauthLabel?: HTMLElement): Promise<void> {
		const originalLabel = oauthLabel?.textContent;
		if (oauthBtn) {
			oauthBtn.disabled = true;
			if (oauthLabel) {
				oauthLabel.textContent = localize('onboarding.featherlessApiKey.signingIn', "Opening browser…");
			}
		}
		if (this.nextButton) {
			this.nextButton.disabled = true;
		}
		// Hide the welcome overlay so the integrated browser can use the full window
		// (and expose the editor tab close button). Restore when sign-in finishes.
		this._setOnboardingOverlayHiddenForOAuth(true);
		this._setChatPanelHiddenForOAuth(true);
		let signedIn = false;
		try {
			await this._ensureFeatherlessExtensionReady();
			await this.commandService.executeCommand(FEATHERLESS_EXTENSION_SIGN_IN_COMMAND);
			await this.commandService.executeCommand(FEATHERLESS_EXTENSION_BOOTSTRAP_COMMAND);
			signedIn = await this._refreshFeatherlessApiKeyState();
			if (!signedIn) {
				this.featherlessApiKeyInputBox?.showMessage({
					type: MessageType.ERROR,
					content: localize('onboarding.featherlessApiKey.oauthFailed', "Featherless sign-in did not complete. Try again or paste an API key."),
				});
			}
		} catch (err) {
			const detail = err instanceof Error ? err.message : String(err);
			this.featherlessApiKeyInputBox?.showMessage({
				type: MessageType.ERROR,
				content: localize('onboarding.featherlessApiKey.oauthFailed', "Featherless sign-in did not complete. Try again or paste an API key."),
			});
			// Toast is already shown by omenide.signInFeatherless; log for diagnostics.
			this.logService.warn(`[onboarding] Featherless OAuth failed: ${detail}`);
		} finally {
			// Close any leftover OAuth browser tabs first, then bring the wizard back.
			// Restoring the overlay while the error page is still open bricks the UI.
			try {
				await this.commandService.executeCommand('workbench.action.browser.closeAll');
			} catch {
				// Browser tabs may already be closed by the auth service.
			}
			await timeout(50);
			this._setChatPanelHiddenForOAuth(false);
			this._setOnboardingOverlayHiddenForOAuth(false);
			if (oauthBtn) {
				oauthBtn.disabled = false;
				if (oauthLabel && originalLabel) {
					oauthLabel.textContent = originalLabel;
				}
			}
			if (this.nextButton) {
				this.nextButton.disabled = false;
			}
			this._updateButtonStates();
		}

		if (signedIn && this.steps[this.currentStepIndex] === OnboardingStepId.FeatherlessApiKey) {
			this._advanceFromCurrentStep();
		}
	}

	private _setOnboardingOverlayHiddenForOAuth(hidden: boolean): void {
		if (!this.overlay) {
			return;
		}
		this.overlay.classList.toggle('oauth-browser-active', hidden);
		this.overlay.setAttribute('aria-hidden', hidden ? 'true' : 'false');
	}

	private _setChatPanelHiddenForOAuth(hidden: boolean): void {
		if (hidden) {
			this._auxBarWasVisibleBeforeOAuth = this.layoutService.isVisible(Parts.AUXILIARYBAR_PART);
			if (this._auxBarWasVisibleBeforeOAuth) {
				this.layoutService.setPartHidden(true, Parts.AUXILIARYBAR_PART);
			}
			return;
		}
		if (this._auxBarWasVisibleBeforeOAuth) {
			this.layoutService.setPartHidden(false, Parts.AUXILIARYBAR_PART);
		}
		this._auxBarWasVisibleBeforeOAuth = undefined;
	}

	private async _ensureFeatherlessExtensionReady(): Promise<void> {
		const deadline = Date.now() + 8_000;
		let lastError: unknown;
		while (Date.now() < deadline) {
			await ensureFeatherlessChatExtensionReady(
				this.extensionsWorkbenchService,
				this.extensionService,
				this.chatEntitlementService,
				this.productService,
				this.logService,
				this.commandService,
			);
			try {
				// Probe a lightweight BYOK command to confirm the extension host registered handlers.
				await this.commandService.executeCommand(FEATHERLESS_EXTENSION_HAS_KEY_COMMAND);
				return;
			} catch (err) {
				lastError = err;
				await timeout(150);
			}
		}
		const detail = lastError instanceof Error ? lastError.message : String(lastError ?? 'unknown error');
		throw new Error(localize('onboarding.featherlessApiKey.extensionNotReady', "Omen IDE extension is not ready yet ({0}). Try again in a moment.", detail));
	}

	private _dismiss(reason: 'complete' | 'skip'): void {
		if (!this.overlay) {
			return;
		}

		this._logAction('dismiss', undefined, reason);

		this.overlay.classList.remove('visible');
		this.overlay.classList.add('exiting');

		let handled = false;
		const onTransitionEnd = () => {
			if (handled) {
				return;
			}
			handled = true;
			this._removeFromDOM();
			if (reason === 'complete') {
				this._onDidComplete.fire();
			}
			this._onDidDismiss.fire();
		};

		this.overlay.addEventListener('transitionend', onTransitionEnd, { once: true });
		setTimeout(onTransitionEnd, 400);
	}

	private _nextStep(): void {
		if (this.currentStepIndex < this.steps.length - 1) {
			const leavingStep = this.steps[this.currentStepIndex];
			if (leavingStep === OnboardingStepId.SignIn) {
				this.enterpriseSignInUiState = 'options';
				this.enterpriseInstanceValue = '';
				this.enterpriseSignInWatch = undefined;
			}
			if (leavingStep === OnboardingStepId.Personalize) {
				this._applyKeymap(this.selectedKeymapId);
			}
			this.currentStepIndex++;
			this._renderStep();
			this._renderProgress();
			this._updateButtonStates();
			this._focusCurrentStepElement();
			this._logStepView();
		}
	}

	private _prevStep(): void {
		if (this.currentStepIndex > 0) {
			this.currentStepIndex--;
			this._renderStep();
			this._renderProgress();
			this._updateButtonStates();
			this._focusCurrentStepElement();
			this._logStepView();
		}
	}

	private _isLastStep(): boolean {
		return this.currentStepIndex === this.steps.length - 1;
	}

	private _renderProgress(): void {
		if (!this.progressContainer || !this.stepLabelEl) {
			return;
		}

		clearNode(this.progressContainer);

		for (let i = 0; i < this.steps.length; i++) {
			const dot = append(this.progressContainer, $('span.onboarding-a-progress-dot'));
			if (i === this.currentStepIndex) {
				dot.classList.add('active');
			} else if (i < this.currentStepIndex) {
				dot.classList.add('completed');
			}
		}

		this.progressContainer.appendChild(this.stepLabelEl);
		this.stepLabelEl.textContent = localize(
			'onboarding.stepOf',
			"{0} of {1}",
			this.currentStepIndex + 1,
			this.steps.length
		);
	}

	private _renderStep(): void {
		if (!this.titleEl || !this.subtitleEl || !this.contentEl) {
			return;
		}

		this.stepDisposables.clear();
		this.stepFocusableElements.length = 0;

		const stepId = this.steps[this.currentStepIndex];
		const useSignInHero = stepId === OnboardingStepId.SignIn || stepId === OnboardingStepId.FeatherlessApiKey;
		this.titleEl.style.display = useSignInHero ? 'none' : '';
		this.subtitleEl.style.display = useSignInHero ? 'none' : '';
		this.titleEl.textContent = getOnboardingStepTitle(stepId);
		if (stepId === OnboardingStepId.AgentSessions) {
			this._renderAgentSessionsSubtitle(this.subtitleEl);
		} else if (stepId === OnboardingStepId.Personalize) {
			this._renderPersonalizeSubtitle(this.subtitleEl);
		} else {
			this.subtitleEl.textContent = getOnboardingStepSubtitle(stepId);
		}

		clearNode(this.contentEl);

		switch (stepId) {
			case OnboardingStepId.FeatherlessApiKey:
				this._renderFeatherlessApiKeyStep(this.contentEl);
				break;
			case OnboardingStepId.SignIn:
				this._renderSignInStep(this.contentEl);
				break;
			case OnboardingStepId.Personalize:
				this._renderPersonalizeStep(this.contentEl);
				break;
			case OnboardingStepId.AiPreference:
				this._renderAiPreferenceStep(this.contentEl);
				break;
			case OnboardingStepId.AgentSessions:
				this._renderAgentSessionsStep(this.contentEl);
				break;
		}

		this.bodyEl?.setAttribute('aria-label', localize(
			'onboarding.step.aria',
			"Step {0} of {1}: {2}",
			this.currentStepIndex + 1,
			this.steps.length,
			getOnboardingStepTitle(stepId)
		));
	}

	private _updateButtonStates(): void {
		if (this.backButton) {
			this.backButton.style.display = this.currentStepIndex === 0 ? 'none' : '';
		}
		if (this.nextButton) {
			const onFeatherlessAuthStep = this.steps[this.currentStepIndex] === OnboardingStepId.FeatherlessApiKey;
			const hideFooterContinue = onFeatherlessAuthStep && !this._hasFeatherlessCredentials();
			this.nextButton.style.display = hideFooterContinue ? 'none' : '';
			this.nextButton.className = 'onboarding-a-btn onboarding-a-btn-primary';
			this.nextButton.textContent = this._isLastStep()
				? localize('onboarding.getStarted', "Get Started")
				: localize('onboarding.next', "Continue");
			// Always clickable when visible; Featherless key Submit validates in-step.
			this.nextButton.disabled = false;
			this.nextButton.style.opacity = '';
		}
		// GitHub Copilot sign-in nudge intentionally omitted — Omen IDE uses Featherless.ai.
		if (this.footerLeft && this._footerSignInBtn) {
			this._footerSignInBtn.remove();
			this._footerSignInBtn = undefined;
		}
	}

	// =====================================================================
	// Step: Featherless API Key
	// =====================================================================

	private _renderFeatherlessApiKeyStep(container: HTMLElement): void {
		const wrapper = append(container, $('.onboarding-a-signin'));
		const brand = append(wrapper, $('.onboarding-a-signin-brand'));
		const brandIcon = append(brand, $('span.onboarding-a-signin-brand-icon'));
		brandIcon.setAttribute('role', 'img');
		brandIcon.setAttribute('aria-label', product.nameLong);

		const content = append(wrapper, $('.onboarding-a-signin-content'));
		const contentMain = append(content, $('.onboarding-a-signin-content-main'));
		const title = append(contentMain, $('h2.onboarding-a-signin-title'));
		title.textContent = localize('onboarding.featherlessApiKey.heroTitle', "Welcome to Omen IDE");

		const subtitle = append(contentMain, $('p.onboarding-a-signin-subtitle'));
		subtitle.textContent = localize('onboarding.featherlessApiKey.heroSubtitle', "Sign in with Featherless or paste an API key to enable chat, agents, and Tab autocomplete.");

		const actions = append(contentMain, $('.onboarding-a-signin-actions.onboarding-a-featherless-auth-stack'));

		if (this._hasFeatherlessCredentials()) {
			const saved = append(actions, $('.onboarding-a-signin-confirmation'));
			const icon = append(saved, $('span'));
			icon.classList.add(...ThemeIcon.asClassNameArray(Codicon.check));
			icon.setAttribute('aria-hidden', 'true');
			const text = append(saved, $('span'));
			text.textContent = this.featherlessOAuthConfigured
				? localize('onboarding.featherlessApiKey.oauthSaved', "Signed in with Featherless. Continuing…")
				: localize('onboarding.featherlessApiKey.saved', "API key saved. Continuing…");
		} else {
			const oauthBtn = this._registerStepFocusable(append(actions, $<HTMLButtonElement>('button.onboarding-a-signin-btn.primary')));
			oauthBtn.type = 'button';
			oauthBtn.title = localize('onboarding.featherlessApiKey.signIn', "Sign in with Featherless");
			oauthBtn.setAttribute('aria-label', localize('onboarding.featherlessApiKey.signIn', "Sign in with Featherless"));
			const oauthLabel = append(oauthBtn, $('span.onboarding-a-signin-btn-label'));
			oauthLabel.textContent = localize('onboarding.featherlessApiKey.signIn', "Sign in with Featherless");
			this.stepDisposables.add(addDisposableListener(oauthBtn, EventType.CLICK, () => {
				this._logAction('signIn', undefined, 'featherless-oauth');
				void this._signInWithFeatherlessOAuthFromWizard(oauthBtn, oauthLabel);
			}));

			const divider = append(actions, $('.onboarding-a-signin-or-divider'));
			divider.textContent = localize('onboarding.featherlessApiKey.or', "or");

			const keyRow = append(actions, $('.onboarding-a-featherless-key-row'));
			const inputContainer = append(keyRow, $('.onboarding-a-signin-ghe-input'));
			const inputBox = this.stepDisposables.add(new InputBox(inputContainer, undefined, {
				placeholder: localize('onboarding.featherlessApiKey.placeholder', 'Paste your Featherless.ai API key'),
				ariaLabel: localize('onboarding.featherlessApiKey.inputAria', "Featherless API key"),
				type: 'password',
				inputBoxStyles: defaultInputBoxStyles,
			}));
			this.featherlessApiKeyInputBox = inputBox;
			inputBox.value = this.featherlessApiKeyValue;
			const input = this._registerStepFocusable(inputBox.inputElement);
			this.stepDisposables.add(inputBox.onDidChange(value => {
				this.featherlessApiKeyValue = value;
				inputBox.hideMessage();
				this._updateButtonStates();
			}));
			this.stepDisposables.add(addDisposableListener(input, EventType.KEY_DOWN, (e: KeyboardEvent) => {
				if (e.key === 'Enter' && this.featherlessApiKeyValue.trim()) {
					e.preventDefault();
					void this._handleNextClick();
				}
			}));

			const submitBtn = this._registerStepFocusable(append(keyRow, $<HTMLButtonElement>('button.onboarding-a-btn.onboarding-a-btn-primary.onboarding-a-featherless-submit')));
			submitBtn.type = 'button';
			submitBtn.textContent = localize('onboarding.featherlessApiKey.submit', "Submit");
			submitBtn.setAttribute('aria-label', localize('onboarding.featherlessApiKey.submit', "Submit"));
			this.stepDisposables.add(addDisposableListener(submitBtn, EventType.CLICK, () => {
				this._logAction('next', undefined, 'featherless-api-key-submit');
				void this._handleNextClick();
			}));
		}

		const footer = append(wrapper, $('.onboarding-a-signin-footer'));
		const disclaimerCol = append(footer, $('.onboarding-a-signin-disclaimer-col'));
		const disclaimer = append(disclaimerCol, $('.onboarding-a-signin-disclaimer'));
		disclaimer.append(localize('onboarding.featherlessApiKey.getKeyPrefix', "Don't have a key yet? "));
		this._createInlineLink(disclaimer, localize('onboarding.featherlessApiKey.getKey', "Get one from Featherless.ai"), 'https://featherless.ai/account/api-keys');

		void this._refreshFeatherlessApiKeyState().then(ready => {
			if (ready && this.steps[this.currentStepIndex] === OnboardingStepId.FeatherlessApiKey) {
				this._advanceFromCurrentStep();
			}
		});
	}

	// =====================================================================
	// Step: Sign In
	// =====================================================================

	private _renderSignInStep(container: HTMLElement): void {
		const wrapper = append(container, $('.onboarding-a-signin'));
		const brand = append(wrapper, $('.onboarding-a-signin-brand'));
		const brandIcon = append(brand, $('span.onboarding-a-signin-brand-icon'));
		brandIcon.setAttribute('role', 'img');
		brandIcon.setAttribute('aria-label', product.nameLong);

		const content = append(wrapper, $('.onboarding-a-signin-content'));
		const contentMain = append(content, $('.onboarding-a-signin-content-main'));
		const title = append(contentMain, $('h2.onboarding-a-signin-title'));
		title.textContent = localize('onboarding.signIn.heroTitle', "Welcome to Omen IDE");

		const subtitle = append(contentMain, $('p.onboarding-a-signin-subtitle'));
		subtitle.textContent = localize('onboarding.signIn.heroSubtitle', "Enter your Featherless.ai API key to continue.");

		const actions = append(contentMain, $('.onboarding-a-signin-actions'));

		if (this._userSignedIn) {
			const signedIn = append(actions, $('.onboarding-a-signin-confirmation'));
			const icon = append(signedIn, $('span'));
			icon.classList.add(...ThemeIcon.asClassNameArray(Codicon.check));
			icon.setAttribute('aria-hidden', 'true');
			const text = append(signedIn, $('span'));
			text.textContent = localize('onboarding.signIn.signedIn', "You're signed in. You can continue to the next step.");
		} else {
			switch (this.enterpriseSignInUiState) {
				case 'instance':
					this._renderEnterpriseInstanceForm(actions);
					break;
				case 'progress':
					this._renderEnterpriseSignInProgress(actions);
					break;
				default:
					this._renderDefaultSignInActions(actions);
					break;
			}
		}

		const footer = append(wrapper, $('.onboarding-a-signin-footer'));

		const disclaimerCol = append(footer, $('.onboarding-a-signin-disclaimer-col'));

		// Featherless disclaimer
		const copilotDisclaimer = append(disclaimerCol, $('.onboarding-a-signin-disclaimer'));
		copilotDisclaimer.append(localize('onboarding.signIn.disclaimer.prefix', "By signing in, you agree to {0}'s ", defaultChat.provider.default.name));
		this._createInlineLink(copilotDisclaimer, localize('onboarding.signIn.disclaimer.terms', "Terms"), defaultChat.termsStatementUrl);
		copilotDisclaimer.append(localize('onboarding.signIn.disclaimer.middle', " and "));
		this._createInlineLink(copilotDisclaimer, localize('onboarding.signIn.disclaimer.privacy', "Privacy Statement"), defaultChat.privacyStatementUrl);
		copilotDisclaimer.append(localize('onboarding.signIn.disclaimer.copilotPrefix', ". {0} Featherless may show ", defaultChat.provider.default.name));
		this._createInlineLink(copilotDisclaimer, localize('onboarding.signIn.disclaimer.publicCode', "public code"), defaultChat.publicCodeMatchesUrl);
		copilotDisclaimer.append(localize('onboarding.signIn.disclaimer.improveSuffix', " suggestions and use your data to improve the product."));
		copilotDisclaimer.append(' ');
		copilotDisclaimer.append(localize('onboarding.signIn.disclaimer.settingsPrefix', "You can change these "));
		this._createInlineLink(copilotDisclaimer, localize('onboarding.signIn.disclaimer.settings', "settings"), this.defaultAccountService.resolveGitHubUrl(GitHubPaths.copilotSettings));
		copilotDisclaimer.append(localize('onboarding.signIn.disclaimer.suffix', " anytime."));
	}

	private _renderDefaultSignInActions(actions: HTMLElement): void {
		const githubBtn = this._registerStepFocusable(this._createSignInButton(actions, 'github', localize('onboarding.signIn.github', "Continue with GitHub"), {
			emphasized: true,
			label: localize('onboarding.signIn.github.aria', "Continue with GitHub")
		}));
		this.stepDisposables.add(addDisposableListener(githubBtn, EventType.CLICK, () => {
			this._logAction('signIn', undefined, 'github');
			this._handleSignIn();
		}));

		const googleBtn = this._registerStepFocusable(this._createSignInButton(actions, 'google', localize('onboarding.signIn.google', "Continue with Google"), {
			iconOnly: true,
			label: localize('onboarding.signIn.google', "Continue with Google")
		}));
		this.stepDisposables.add(addDisposableListener(googleBtn, EventType.CLICK, () => {
			this._logAction('signIn', undefined, 'google');
			this._handleSignIn('google');
		}));

		const appleBtn = this._registerStepFocusable(this._createSignInButton(actions, 'apple', localize('onboarding.signIn.apple', "Continue with Apple"), {
			iconOnly: true,
			label: localize('onboarding.signIn.apple', "Continue with Apple")
		}));
		this.stepDisposables.add(addDisposableListener(appleBtn, EventType.CLICK, () => {
			this._logAction('signIn', undefined, 'apple');
			this._handleSignIn('apple');
		}));

		const gheBtn = this._registerStepFocusable(this._createSignInButton(actions, 'github-enterprise', localize('onboarding.signIn.ghe', "GHE"), {
			textOnly: true,
			label: localize('onboarding.signIn.ghe.aria', "Continue with GitHub Enterprise")
		}));
		this.stepDisposables.add(addDisposableListener(gheBtn, EventType.CLICK, () => {
			this._logAction('signIn', undefined, 'github-enterprise');
			void this._handleEnterpriseSignIn();
		}));
	}

	private static readonly GHE_INPUT_ACTION_PADDING = 28;

	private _renderEnterpriseInstanceForm(actions: HTMLElement): void {
		const enterprisePromptLabel = this._getEnterpriseInstancePromptLabel();

		const container = append(actions, $('.onboarding-a-signin-ghe-input'));

		const submitAction = this.stepDisposables.add(new Action(
			'onboarding.signIn.enterprise.submit',
			localize('onboarding.signIn.enterprise.continue', "Continue"),
			ThemeIcon.asClassName(Codicon.arrowRight),
			false,
		));

		const inputBox = this.stepDisposables.add(new InputBox(container, undefined, {
			placeholder: localize('onboarding.signIn.enterprise.placeholder', 'i.e. "octocat" or "https://octocat.ghe.com"...'),
			ariaLabel: enterprisePromptLabel,
			actions: [submitAction],
			inputBoxStyles: defaultInputBoxStyles,
		}));
		inputBox.value = this.enterpriseInstanceValue;
		inputBox.paddingRight = OnboardingVariationA.GHE_INPUT_ACTION_PADDING;
		const input = this._registerStepFocusable(inputBox.inputElement);

		const submit = async () => {
			const result = parseGheInstanceInput(inputBox.value);
			if (result.kind === GheParseResultKind.Empty || result.kind === GheParseResultKind.Invalid) {
				validate();
				return;
			}
			await this._submitEnterpriseInstance(result.resolvedUri);
		};
		submitAction.run = submit;

		const message = append(container, $('.onboarding-a-signin-ghe-message'));

		const validate = (): boolean => {
			this.enterpriseInstanceValue = inputBox.value;
			inputBox.element.classList.remove('error');
			message.classList.remove('error', 'info');

			const result = parseGheInstanceInput(inputBox.value);
			switch (result.kind) {
				case GheParseResultKind.Empty:
					message.textContent = enterprisePromptLabel;
					submitAction.enabled = false;
					return false;
				case GheParseResultKind.SingleWord:
					message.classList.add('info');
					message.textContent = localize('onboarding.signIn.enterprise.resolve', "Will resolve to {0}", result.resolvedUri);
					submitAction.enabled = true;
					return true;
				case GheParseResultKind.FullUri:
					submitAction.enabled = true;
					message.textContent = '';
					return true;
				case GheParseResultKind.Invalid:
					inputBox.element.classList.add('error');
					message.classList.add('error');
					message.textContent = localize('onboarding.signIn.enterprise.invalid', 'You must enter a valid {0} instance (i.e. "octocat" or "https://octocat.ghe.com")', defaultChat.provider.enterprise.name);
					submitAction.enabled = false;
					return false;
			}
		};

		this.stepDisposables.add(inputBox.onDidChange(() => {
			validate();
		}));

		this.stepDisposables.add(addDisposableListener(input, EventType.KEY_DOWN, e => {
			const event = new StandardKeyboardEvent(e);
			if (event.keyCode === KeyCode.Enter) {
				e.preventDefault();
				void submitAction.run();
				return;
			}

			if (event.keyCode === KeyCode.Escape) {
				e.preventDefault();
				e.stopPropagation();
				this._logAction('cancelEnterpriseInstancePrompt');
				this.enterpriseSignInWatch = undefined;
				this._setEnterpriseSignInUiState('options');
			}
		}));

		validate();
	}

	private _renderEnterpriseSignInProgress(actions: HTMLElement): void {
		const container = append(actions, $('.onboarding-a-signin-ghe-progress'));
		container.setAttribute('aria-live', 'polite');
		const spinner = append(container, $('span'));
		spinner.classList.add(...ThemeIcon.asClassNameArray(Codicon.loading), 'codicon-modifier-spin');
		spinner.setAttribute('aria-hidden', 'true');
		const message = append(container, $('.onboarding-a-signin-ghe-progress-message'));
		message.textContent = localize('onboarding.signIn.enterprise.progress', "Waiting for {0} sign-in to complete...", defaultChat.provider.enterprise.name);
	}

	private _getEnterpriseInstancePromptLabel(): string {
		return localize('onboarding.signIn.enterprise.prompt', "What is your {0} instance?", defaultChat.provider.enterprise.name);
	}

	private _setEnterpriseSignInUiState(state: EnterpriseSignInUiState): void {
		this.enterpriseSignInUiState = state;
		if (this.steps[this.currentStepIndex] === OnboardingStepId.SignIn && this.contentEl) {
			this._renderStep();
			this._updateButtonStates();
			this._focusCurrentStepElement();
		}
	}

	private _createSignInButton(parent: HTMLElement, providerClass: 'github' | 'github-enterprise' | 'google' | 'apple', label: string, options?: { emphasized?: boolean; iconOnly?: boolean; textOnly?: boolean; label?: string }): HTMLButtonElement {
		const isCompact = options?.iconOnly || options?.textOnly;
		const btn = append(parent, $<HTMLButtonElement>(isCompact ? 'button.onboarding-a-signin-icon-btn' : 'button.onboarding-a-signin-btn'));
		btn.type = 'button';
		btn.title = options?.label ?? label;
		btn.setAttribute('aria-label', options?.label ?? label);
		if (options?.emphasized) {
			btn.classList.add('primary');
		}

		if (!options?.textOnly) {
			const mark = append(btn, $('span.onboarding-a-provider-mark'));
			mark.classList.add(providerClass);
			mark.setAttribute('aria-hidden', 'true');
			if (providerClass === 'github' || providerClass === 'github-enterprise') {
				mark.appendChild(renderIcon(Codicon.github));
			}
		}

		if (!options?.iconOnly) {
			const labelEl = append(btn, $('span.onboarding-a-signin-btn-label'));
			labelEl.textContent = label;
		}

		return btn;
	}

	private async _handleSignIn(socialProvider?: string): Promise<void> {
		const provider = socialProvider ?? 'github';
		const watch = StopWatch.create();
		try {
			const account = await this.defaultAccountService.signIn({
				extraAuthorizeParameters: { get_started_with: 'copilot-vscode' },
				provider: socialProvider,
			});
			if (account) {
				this._userSignedIn = true;
				this.telemetryService.publicLog2<InstallChatEvent, InstallChatClassification>('commandCenter.chatInstall', { installResult: 'installed', installDuration: watch.elapsed(), signUpErrorCode: undefined, provider });
				// Run chat setup in the background (sign-up, extension install, entitlement resolution)
				this.commandService.executeCommand('workbench.action.chat.triggerSetup', undefined, {
					disableChatViewReveal: true,
					setupStrategy: ChatSetupStrategy.DefaultSetup,
				});
				this._nextStep();
			}
		} catch (error) {
			if (isCancellationError(error)) {
				this.telemetryService.publicLog2<InstallChatEvent, InstallChatClassification>('commandCenter.chatInstall', { installResult: 'cancelled', installDuration: watch.elapsed(), signUpErrorCode: undefined, provider });
				return;
			}

			this.telemetryService.publicLog2<InstallChatEvent, InstallChatClassification>('commandCenter.chatInstall', { installResult: 'failedNotSignedIn', installDuration: watch.elapsed(), signUpErrorCode: undefined, provider });
			this.notificationService.notify({
				severity: Severity.Error,
				message: localize('onboarding.signIn.error', "Sign-in failed. You can try again later from the Accounts menu."),
			});
		}
	}

	private async _handleEnterpriseSignIn(): Promise<void> {
		const existingUri = this.configurationService.getValue<string>(defaultChat.providerUriSetting);
		if (typeof existingUri !== 'string' || !GHE_FULL_URI_REGEX.test(existingUri)) {
			this.enterpriseInstanceValue = existingUri ?? '';
			this.enterpriseSignInWatch = StopWatch.create();
			this._setEnterpriseSignInUiState('instance');
			return;
		}

		this.enterpriseInstanceValue = existingUri;
		await this._runEnterpriseSignInSetup();
	}

	private async _submitEnterpriseInstance(resolvedUri: string): Promise<void> {
		try {
			await this.configurationService.updateValue(defaultChat.providerUriSetting, resolvedUri, ConfigurationTarget.USER);
			this.enterpriseInstanceValue = resolvedUri;
			await this._runEnterpriseSignInSetup();
		} catch {
			this.enterpriseSignInWatch = undefined;
			this._setEnterpriseSignInUiState('instance');
			this._notifyEnterpriseSignInError();
		}
	}

	private async _runEnterpriseSignInSetup(): Promise<void> {
		const watch = this.enterpriseSignInWatch ?? StopWatch.create();
		const provider = defaultChat.provider.enterprise.id;
		this._setEnterpriseSignInUiState('progress');

		try {
			const success = await this.commandService.executeCommand<boolean>('workbench.action.chat.triggerSetup', undefined, {
				disableChatViewReveal: true,
				setupStrategy: ChatSetupStrategy.SetupWithEnterpriseProvider,
			});

			if (success) {
				this._userSignedIn = true;
				this.telemetryService.publicLog2<InstallChatEvent, InstallChatClassification>('commandCenter.chatInstall', { installResult: 'installed', installDuration: watch.elapsed(), signUpErrorCode: undefined, provider });
				this._nextStep();
			} else {
				this._setEnterpriseSignInUiState('options');
			}
		} catch (error) {
			if (isCancellationError(error)) {
				this._setEnterpriseSignInUiState('options');
				this.telemetryService.publicLog2<InstallChatEvent, InstallChatClassification>('commandCenter.chatInstall', { installResult: 'cancelled', installDuration: watch.elapsed(), signUpErrorCode: undefined, provider });
				return;
			}

			this._setEnterpriseSignInUiState('instance');
			this.telemetryService.publicLog2<InstallChatEvent, InstallChatClassification>('commandCenter.chatInstall', { installResult: 'failedNotSignedIn', installDuration: watch.elapsed(), signUpErrorCode: undefined, provider });
			this._notifyEnterpriseSignInError();
		} finally {
			this.enterpriseSignInWatch = undefined;
		}
	}

	private _notifyEnterpriseSignInError(): void {
		this.notificationService.notify({
			severity: Severity.Error,
			message: localize('onboarding.signIn.enterprise.error', "GitHub Enterprise sign-in failed. Check your instance URL and try again."),
		});
	}

	// =====================================================================
	// Step: Personalize (Theme + Keymap)
	// =====================================================================

	private _renderPersonalizeStep(container: HTMLElement): void {
		const wrapper = append(container, $('.onboarding-a-personalize'));

		// Theme section
		const themeLabel = append(wrapper, $('div.onboarding-a-section-label'));
		themeLabel.textContent = localize('onboarding.personalize.theme', "Color Theme");

		const themeHint = append(wrapper, $('div.onboarding-a-theme-hint'));
		themeHint.textContent = localize('onboarding.personalize.themeHint', "You can browse and install more themes later from the Extensions view.");

		const themeGrid = append(wrapper, $('.onboarding-a-theme-grid'));
		themeGrid.setAttribute('role', 'radiogroup');
		themeGrid.setAttribute('aria-label', localize('onboarding.personalize.themeLabel', "Choose a color theme"));

		const hasOtherEditors = this._hasOtherEditors();
		const allThemes = product.onboardingThemes ?? [];
		// When other editors are detected, show a compact set (exclude solarized variants).
		const themes: readonly IOnboardingThemeOption[] = hasOtherEditors
			? allThemes.filter(t => !t.id.startsWith('solarized'))
			: allThemes;

		if (!hasOtherEditors) {
			themeGrid.classList.add('theme-grid-expanded');
		}

		const themeCards: HTMLElement[] = [];
		for (const theme of themes) {
			this._createThemeCard(themeGrid, theme, themeCards);
		}
		// Make all theme cards individually tabbable
		for (const card of themeCards) {
			card.setAttribute('tabindex', '0');
		}

		// Keyboard Mapping section — only shown when another editor is detected
		const keymapOptions = this._detectedEditorIds
			? (product.onboardingKeymaps ?? []).filter(k => this._detectedEditorIds!.has(k.id))
			: [];

		if (hasOtherEditors) {
			const keymapLabel = append(wrapper, $('div.onboarding-a-section-label.onboarding-a-section-label-keymap'));
			keymapLabel.textContent = localize('onboarding.personalize.keymap', "Keyboard Mapping");

			const keymapHint = append(wrapper, $('div.onboarding-a-theme-hint'));
			keymapHint.textContent = localize('onboarding.personalize.keymapHint', "Coming from another editor? Import your keyboard mapping to feel right at home.");

			const keymapList = append(wrapper, $('.onboarding-a-keymap-list'));
			keymapList.setAttribute('role', 'radiogroup');
			keymapList.setAttribute('aria-label', localize('onboarding.personalize.keymapLabel', "Choose a keyboard mapping"));

			const keymapPills: HTMLButtonElement[] = [];
			for (const keymap of keymapOptions) {
				const pill = this._registerStepFocusable(append(keymapList, $<HTMLButtonElement>('button.onboarding-a-keymap-pill')));
				pill.type = 'button';
				pill.setAttribute('role', 'radio');
				pill.setAttribute('aria-checked', keymap.id === this.selectedKeymapId ? 'true' : 'false');
				pill.title = keymap.description;
				keymapPills.push(pill);

				const labelSpan = append(pill, $('span'));
				labelSpan.textContent = keymap.label;

				if (keymap.id === this.selectedKeymapId) {
					pill.classList.add('selected');
				}

				this.stepDisposables.add(addDisposableListener(pill, EventType.CLICK, () => {
					this._logAction('selectKeymap', undefined, keymap.id);
					this.selectedKeymapId = keymap.id;

					for (const p of keymapPills) {
						p.classList.remove('selected');
						p.setAttribute('aria-checked', 'false');
					}
					pill.classList.add('selected');
					pill.setAttribute('aria-checked', 'true');
					this.accessibilityService.alert(localize('onboarding.keymap.selected.alert', "{0} keyboard mapping selected", keymap.label));
				}));
			}
			const selectedKeymapIndex = keymapOptions.findIndex(k => k.id === this.selectedKeymapId);
			this._setupRadioGroupNavigation(keymapPills, Math.max(0, selectedKeymapIndex));
		}

	}

	private _renderPersonalizeSubtitle(container: HTMLElement): void {
		clearNode(container);
		const modifier = isMacintosh ? 'Cmd' : 'Ctrl';
		container.append(
			localize('onboarding.personalize.tip.prefix', "Tip: Press "),
			this._createKbd(localize({ key: 'onboarding.personalize.tip.modifier', comment: ['This is a keyboard modifier key, Ctrl on Windows/Linux or Cmd on Mac'] }, "{0}", modifier)),
			'+',
			this._createKbd(localize('onboarding.personalize.tip.shift', "Shift")),
			'+',
			this._createKbd(localize('onboarding.personalize.tip.p', "P")),
			localize('onboarding.personalize.tip.suffix', " to access all Omen IDE commands."),
		);
	}

	private _createThemeCard(parent: HTMLElement, theme: IOnboardingThemeOption, allCards: HTMLElement[]): void {
		const card = this._registerStepFocusable(append(parent, $('div.onboarding-a-theme-card')));
		allCards.push(card);
		card.setAttribute('role', 'radio');
		card.setAttribute('aria-checked', theme.id === this.selectedThemeId ? 'true' : 'false');
		card.setAttribute('aria-label', theme.label);

		if (theme.id === this.selectedThemeId) {
			card.classList.add('selected');
		}

		// SVG preview image
		const preview = append(card, $('div.onboarding-a-theme-preview'));
		const img = append(preview, $<HTMLImageElement>('img.onboarding-a-theme-preview-img'));
		img.alt = '';
		img.src = FileAccess.asBrowserUri(`vs/workbench/contrib/welcomeOnboarding/browser/media/theme-preview-${theme.id}.svg`).toString(true);

		// Label
		const label = append(card, $('div.onboarding-a-theme-label'));
		label.textContent = theme.label;

		this.stepDisposables.add(addDisposableListener(card, EventType.CLICK, () => {
			this._logAction('selectTheme', undefined, theme.id);
			this._selectTheme(theme);
			for (const c of allCards) {
				c.classList.remove('selected');
				c.setAttribute('aria-checked', 'false');
			}
			card.classList.add('selected');
			card.setAttribute('aria-checked', 'true');
			this.accessibilityService.alert(localize('onboarding.theme.selected.alert', "{0} theme selected", theme.label));
		}));

		this.stepDisposables.add(addDisposableListener(card, EventType.KEY_DOWN, (e: KeyboardEvent) => {
			if (e.key === 'Enter' || e.key === ' ') {
				e.preventDefault();
				card.click();
			}
		}));
	}

	// =====================================================================
	// Theme / Keymap helpers
	// =====================================================================

	private async _selectTheme(theme: IOnboardingThemeOption): Promise<void> {
		this.selectedThemeId = theme.id;
		const allThemes = await this.themeService.getColorThemes();
		const match = allThemes.find(t => t.settingsId === theme.themeId);
		if (match) {
			this.themeService.setColorTheme(match.id, ConfigurationTarget.USER);
		}
	}

	private async _applyKeymap(keymapId: string): Promise<void> {
		const keymap = (product.onboardingKeymaps ?? []).find(k => k.id === keymapId);
		if (!keymap?.extensionId) {
			return; // VS Code default, nothing to install
		}

		try {
			const gallery = await this.extensionGalleryService.getExtensions([{ id: keymap.extensionId }], CancellationToken.None);
			if (gallery.length > 0) {
				await this.extensionManagementService.installFromGallery(gallery[0], { context: { [EXTENSION_INSTALL_SKIP_WALKTHROUGH_CONTEXT]: true } });
			}
		} catch {
			this.notificationService.notify({
				severity: Severity.Warning,
				message: localize('onboarding.keymap.installError', "Could not install {0} keymap. You can install it later from Extensions.", keymap.label),
			});
		}
	}

	private _hasOtherEditors(): boolean {
		const keymapOptions = this._detectedEditorIds
			? (product.onboardingKeymaps ?? []).filter(k => this._detectedEditorIds!.has(k.id))
			: [];
		return keymapOptions.some(k => k.id !== 'vscode');
	}

	/**
	 * Checks common install paths for known editors and returns the set of
	 * keymap option IDs whose editors are found on this machine.
	 * Always includes 'vscode' (the default). In web environments or on
	 * unknown platforms, returns only 'vscode'.
	 */
	private async _detectInstalledEditors(): Promise<Set<string>> {
		const detected = new Set<string>(['vscode']);
		const home = this.pathService.userHome({ preferLocal: true });

		interface EditorCheck { id: string; paths: URI[] }
		const checks: EditorCheck[] = [];

		if (isWindows) {
			const localAppData = URI.joinPath(home, 'AppData', 'Local');
			checks.push(
				{ id: 'sublime', paths: [URI.file('C:\\Program Files\\Sublime Text\\sublime_text.exe'), URI.file('C:\\Program Files\\Sublime Text 3\\sublime_text.exe')] },
				{ id: 'intellij', paths: [URI.joinPath(localAppData, 'JetBrains', 'Toolbox')] },
				{ id: 'vim', paths: [URI.joinPath(home, '_vimrc'), URI.joinPath(localAppData, 'nvim', 'init.vim'), URI.joinPath(localAppData, 'nvim', 'init.lua')] },
				{ id: 'eclipse', paths: [URI.file('C:\\Program Files\\Eclipse\\eclipse.exe'), URI.file('C:\\Program Files\\eclipse\\eclipse.exe')] },
				{ id: 'notepadpp', paths: [URI.file('C:\\Program Files\\Notepad++\\notepad++.exe'), URI.file('C:\\Program Files (x86)\\Notepad++\\notepad++.exe')] },
			);
		} else if (isMacintosh) {
			checks.push(
				{ id: 'sublime', paths: [URI.file('/Applications/Sublime Text.app')] },
				{ id: 'intellij', paths: [URI.file('/Applications/IntelliJ IDEA.app'), URI.file('/Applications/IntelliJ IDEA CE.app')] },
				{ id: 'vim', paths: [URI.joinPath(home, '.vimrc'), URI.joinPath(home, '.config', 'nvim', 'init.vim'), URI.joinPath(home, '.config', 'nvim', 'init.lua')] },
				{ id: 'eclipse', paths: [URI.file('/Applications/Eclipse.app'), URI.file('/Applications/Eclipse IDE.app')] },
				{ id: 'notepadpp', paths: [URI.file('/Applications/Notepad++.app')] },
			);
		} else if (isLinux) {
			checks.push(
				{ id: 'sublime', paths: [URI.file('/usr/bin/subl'), URI.file('/opt/sublime_text/sublime_text')] },
				{ id: 'intellij', paths: [URI.joinPath(home, '.local', 'share', 'JetBrains', 'Toolbox'), URI.file('/opt/idea')] },
				{ id: 'vim', paths: [URI.joinPath(home, '.vimrc'), URI.joinPath(home, '.config', 'nvim', 'init.vim'), URI.joinPath(home, '.config', 'nvim', 'init.lua')] },
				{ id: 'eclipse', paths: [URI.file('/usr/bin/eclipse'), URI.file('/opt/eclipse/eclipse'), URI.joinPath(home, 'eclipse', 'eclipse')] },
				{ id: 'notepadpp', paths: [URI.file('/usr/bin/notepadqq'), URI.file('/snap/notepad-plus-plus/current')] },
			);
		}

		await Promise.all(checks.map(async check => {
			for (const path of check.paths) {
				try {
					if (await this.fileService.exists(path)) {
						detected.add(check.id);
						return;
					}
				} catch {
					// Path not accessible — skip
				}
			}
		}));

		return detected;
	}

	// =====================================================================
	// Step: AI Preference
	// =====================================================================

	private _renderAiPreferenceStep(container: HTMLElement): void {
		const wrapper = append(container, $('.onboarding-a-ai-pref'));

		const cards = append(wrapper, $('.onboarding-a-ai-pref-cards'));
		cards.setAttribute('role', 'radiogroup');
		cards.setAttribute('aria-label', localize('onboarding.aiPref.label', "Choose your AI collaboration style"));

		const allCards: HTMLButtonElement[] = [];
		for (const option of ONBOARDING_AI_PREFERENCE_OPTIONS) {
			const card = this._registerStepFocusable(append(cards, $<HTMLButtonElement>('button.onboarding-a-ai-pref-card')));
			card.type = 'button';
			card.dataset.id = option.id;
			card.setAttribute('role', 'radio');
			card.setAttribute('aria-checked', option.id === this.selectedAiMode ? 'true' : 'false');
			allCards.push(card);

			if (option.id === this.selectedAiMode) {
				card.classList.add('selected');
			}

			const iconEl = append(card, $('span.onboarding-a-ai-pref-card-icon'));
			iconEl.setAttribute('aria-hidden', 'true');
			const icon = Codicon[option.icon as keyof typeof Codicon] ?? Codicon.sparkle;
			iconEl.appendChild(renderIcon(icon));

			const titleEl = append(card, $('div.onboarding-a-ai-pref-card-title'));
			titleEl.textContent = option.label;

			const descEl = append(card, $('div.onboarding-a-ai-pref-card-desc'));
			descEl.textContent = option.description;

			this.stepDisposables.add(addDisposableListener(card, EventType.CLICK, () => {
				this._logAction('selectAiMode', undefined, option.id);
				this.selectedAiMode = option.id;
				for (const c of allCards) {
					c.classList.toggle('selected', c.dataset.id === option.id);
					c.setAttribute('aria-checked', c.dataset.id === option.id ? 'true' : 'false');
				}
				this._applyAiPreference(option.id);
				this.accessibilityService.alert(localize('onboarding.aiPref.selected.alert', "{0} selected", option.label));
			}));
		}
		const selectedAiIndex = ONBOARDING_AI_PREFERENCE_OPTIONS.findIndex(o => o.id === this.selectedAiMode);
		this._setupRadioGroupNavigation(allCards, Math.max(0, selectedAiIndex));

		const hint = append(wrapper, $('div.onboarding-a-ai-pref-hint'));
		hint.textContent = localize('onboarding.aiPref.hint', "You can change this anytime in Settings.");
	}

	private _applyAiPreference(mode: AiCollaborationMode): void {
		switch (mode) {
			case AiCollaborationMode.CodeFirst:
				this.configurationService.updateValue('chat.agent.autoFix', false, ConfigurationTarget.USER);
				break;
			case AiCollaborationMode.Balanced:
				this.configurationService.updateValue('chat.agent.autoFix', true, ConfigurationTarget.USER);
				break;
			case AiCollaborationMode.AgentForward:
				this.configurationService.updateValue('chat.agent.autoFix', true, ConfigurationTarget.USER);
				break;
		}
	}

	// =====================================================================
	// Step: Agent Sessions
	// =====================================================================

	private _renderAgentSessionsSubtitle(el: HTMLElement): void {
		clearNode(el);
		const keys = isMacintosh
			? ['\u2318', '\u2303', 'I']  // Cmd+Control+I
			: ['Ctrl', 'Alt', 'I'];
		const shortcut = keys.map(k => this._createKbd(k));
		el.append(localize('onboarding.step.agentSessions.subtitle.before', "Open Chat anytime with "));
		for (let i = 0; i < shortcut.length; i++) {
			if (i > 0) {
				el.append('+');
			}
			el.append(shortcut[i]);
		}
	}

	private _renderAgentSessionsStep(container: HTMLElement): void {
		const wrapper = append(container, $('.onboarding-a-sessions'));

		const features = append(wrapper, $('.onboarding-a-sessions-features'));

		// Group 1: Chat modes — Plan / Agent
		const chatGroup = append(features, $('.onboarding-a-sessions-group'));
		const chatLabel = append(chatGroup, $('div.onboarding-a-sessions-group-label'));
		chatLabel.textContent = localize('onboarding.sessions.group.chat', "Agents made for the task");
		const chatGrid = append(chatGroup, $('.onboarding-a-sessions-grid.onboarding-a-sessions-grid-2'));

		this._createFeatureCard(chatGrid, Codicon.listOrdered,
			localize('onboarding.sessions.planMode', "Plan"),
			localize('onboarding.sessions.planMode.desc', "Produce a structured implementation plan before any code changes, then hand it off to an agent to execute."));

		this._createFeatureCard(chatGrid, Codicon.commentDiscussion,
			localize('onboarding.sessions.agentMode', "Agent"),
			localize('onboarding.sessions.agentMode.desc', "Describe a goal. The agent plans the approach, edits files, runs commands, and self-corrects. You review and approve along the way."));

		// Group 2: ways to run and customize agents beyond the default Chat experience
		const moreGroup = append(features, $('.onboarding-a-sessions-group'));
		const moreLabel = append(moreGroup, $('div.onboarding-a-sessions-group-label'));
		moreLabel.textContent = localize('onboarding.sessions.group.more', "Agents that work your way");
		const moreGrid = append(moreGroup, $('.onboarding-a-sessions-grid.onboarding-a-sessions-grid-2'));

		this._createFeatureCard(moreGrid, Codicon.rocket,
			localize('onboarding.sessions.runAnywhere', "Run Agents Anywhere"),
			localize('onboarding.sessions.runAnywhere.desc', "Run agents locally for interactive work, in the background with Copilot CLI, or in the cloud with cloud agents that open a pull request your team can review."));

		this._createFeatureCard(moreGrid, Codicon.settingsGear,
			localize('onboarding.sessions.customize', "Customize Your Agents"),
			localize('onboarding.sessions.customize.desc', "Tailor Copilot to your project with custom instructions and agents, skills, reusable prompts, and MCP servers that connect to the tools and context you rely on."));

		// Tutorial link at bottom of content, above footer
		const docsRow = append(wrapper, $('.onboarding-a-sessions-docs'));
		this._createDocLink(docsRow, localize('onboarding.sessions.agentsTutorial', "Agents tutorial"), 'https://code.visualstudio.com/docs/copilot/agents/agents-tutorial', 'agentsTutorial');
	}

	private _createFeatureCard(parent: HTMLElement, icon: ThemeIcon, title: string, description?: string): HTMLElement {
		const card = append(parent, $('div.onboarding-a-feature-card'));
		const iconCol = append(card, $('div.onboarding-a-feature-icon'));
		iconCol.appendChild(renderIcon(icon));
		const textCol = append(card, $('div.onboarding-a-feature-text'));
		const titleEl = append(textCol, $('div.onboarding-a-feature-title'));
		titleEl.textContent = title;
		const descEl = append(textCol, $('div.onboarding-a-feature-desc'));
		if (description) {
			descEl.textContent = description;
		}
		return descEl;
	}

	private _createKbd(label: string): HTMLElement {
		const kbd = $('kbd.onboarding-a-kbd');
		kbd.textContent = label;
		return kbd;
	}

	private _createDocLink(parent: HTMLElement, label: string, href: string, linkId?: string): void {
		const link = this._registerStepFocusable(append(parent, $<HTMLAnchorElement>('a.onboarding-a-doc-link')));
		link.textContent = label;
		link.href = href;
		link.target = '_blank';
		link.rel = 'noopener';
		link.prepend(renderIcon(Codicon.linkExternal));
		if (linkId) {
			this.stepDisposables.add(addDisposableListener(link, EventType.CLICK, () => {
				this._logAction('docLinkClick', undefined, linkId);
			}));
		}
	}

	private _createInlineLink(parent: HTMLElement, label: string, href: string): HTMLAnchorElement {
		const link = this._registerStepFocusable(append(parent, $<HTMLAnchorElement>('a.onboarding-a-inline-link')));
		link.textContent = label;
		link.href = href;
		link.target = '_blank';
		link.rel = 'noopener';
		return link;
	}

	// =====================================================================
	// Radio-group keyboard navigation (roving tabindex)
	// =====================================================================

	/**
	 * Sets up WAI-ARIA radio-group keyboard navigation on a set of elements:
	 * - Arrow keys move focus between items (with wrap-around)
	 * - Only the focused item has tabindex=0; the rest have tabindex=-1
	 * - Space/Enter on a focused item fires its click handler
	 */
	private _setupRadioGroupNavigation(items: HTMLElement[], selectedIndex: number): void {
		// Initialise roving tabindex: only the selected item is tab-reachable
		for (let i = 0; i < items.length; i++) {
			items[i].setAttribute('tabindex', i === selectedIndex ? '0' : '-1');
		}

		for (let i = 0; i < items.length; i++) {
			this.stepDisposables.add(addDisposableListener(items[i], EventType.KEY_DOWN, (e: KeyboardEvent) => {
				const event = new StandardKeyboardEvent(e);
				let newIndex: number | undefined;

				if (event.keyCode === KeyCode.RightArrow || event.keyCode === KeyCode.DownArrow) {
					newIndex = (i + 1) % items.length;
				} else if (event.keyCode === KeyCode.LeftArrow || event.keyCode === KeyCode.UpArrow) {
					newIndex = (i - 1 + items.length) % items.length;
				} else if (event.keyCode === KeyCode.Home) {
					newIndex = 0;
				} else if (event.keyCode === KeyCode.End) {
					newIndex = items.length - 1;
				}

				if (newIndex !== undefined) {
					e.preventDefault();
					e.stopPropagation();
					items[i].setAttribute('tabindex', '-1');
					items[newIndex].setAttribute('tabindex', '0');
					items[newIndex].focus();
					items[newIndex].click();
				}
			}));
		}
	}

	// =====================================================================
	// Focus trap
	// =====================================================================

	private _trapTab(e: KeyboardEvent, shiftKey: boolean): void {
		if (!this.overlay) {
			return;
		}

		const allFocusable = this._getFocusableElements();

		if (allFocusable.length === 0) {
			e.preventDefault();
			return;
		}

		const first = allFocusable[0];
		const last = allFocusable[allFocusable.length - 1];

		if (shiftKey && getActiveWindow().document.activeElement === first) {
			e.preventDefault();
			last.focus();
		} else if (!shiftKey && getActiveWindow().document.activeElement === last) {
			e.preventDefault();
			first.focus();
		}
	}

	private _getFocusableElements(): HTMLElement[] {
		return [...(this.closeButton ? [this.closeButton] : []), ...this.stepFocusableElements, ...this.footerFocusableElements].filter(element => this._isTabbable(element));
	}

	private _focusCurrentStepElement(): void {
		const stepFocusable = this.stepFocusableElements.find(element => this._isTabbable(element));
		(stepFocusable ?? this.nextButton ?? this.closeButton)?.focus();
	}

	private _registerStepFocusable<T extends HTMLElement>(element: T): T {
		this.stepFocusableElements.push(element);
		return element;
	}

	private _isTabbable(element: HTMLElement): boolean {
		if (!element.isConnected || element.getAttribute('aria-hidden') === 'true' || element.tabIndex === -1 || element.hasAttribute('disabled')) {
			return false;
		}

		const computedStyle = getActiveWindow().getComputedStyle(element);
		return computedStyle.display !== 'none' && computedStyle.visibility !== 'hidden';
	}

	// =====================================================================
	// Telemetry
	// =====================================================================

	private _logStepView(): void {
		const stepId = this.steps[this.currentStepIndex];
		this.telemetryService.publicLog2<OnboardingStepViewEvent, OnboardingStepViewClassification>('welcomeOnboarding.stepView', {
			step: stepId,
			stepNumber: this.currentStepIndex + 1,
		});
	}

	private _logAction(action: string, stepOverride?: OnboardingStepId, argument?: string): void {
		this.telemetryService.publicLog2<OnboardingActionEvent, OnboardingActionClassification>('welcomeOnboarding.actionExecuted', {
			action,
			step: stepOverride ?? this.steps[this.currentStepIndex],
			argument: argument ?? undefined,
		});
	}

	// =====================================================================
	// Cleanup
	// =====================================================================

	private _removeFromDOM(): void {
		if (this.overlay) {
			this.overlay.remove();
			this.overlay = undefined;
		}

		this.card = undefined;
		this.bodyEl = undefined;
		this.progressContainer = undefined;
		this.stepLabelEl = undefined;
		this.titleEl = undefined;
		this.subtitleEl = undefined;
		this.contentEl = undefined;
		this.backButton = undefined;
		this.nextButton = undefined;
		this.closeButton = undefined;
		this.footerLeft = undefined;
		this._footerSignInBtn = undefined;
		this.footerFocusableElements.length = 0;
		this.stepFocusableElements.length = 0;
		this.enterpriseSignInUiState = 'options';
		this.enterpriseInstanceValue = '';
		this.enterpriseSignInWatch = undefined;
		this._isShowing = false;
		this.disposables.clear();
		this.stepDisposables.clear();

		if (this.previouslyFocusedElement) {
			this.previouslyFocusedElement.focus();
			this.previouslyFocusedElement = undefined;
		}

		this.currentStepIndex = 0;
	}

	override dispose(): void {
		this._removeFromDOM();
		super.dispose();
	}
}
