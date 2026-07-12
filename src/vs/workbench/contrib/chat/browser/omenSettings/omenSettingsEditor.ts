/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './media/omenSettings.css';
import * as DOM from '../../../../../base/browser/dom.js';
import { Button } from '../../../../../base/browser/ui/button/button.js';
import { Toggle } from '../../../../../base/browser/ui/toggle/toggle.js';
import { Orientation, Sizing, SplitView } from '../../../../../base/browser/ui/splitview/splitview.js';
import { Codicon } from '../../../../../base/common/codicons.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { Event } from '../../../../../base/common/event.js';
import { ThemeIcon } from '../../../../../base/common/themables.js';
import { localize } from '../../../../../nls.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { ConfigurationTarget, IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { IContextKey, IContextKeyService } from '../../../../../platform/contextkey/common/contextkey.js';
import { IEditorOptions } from '../../../../../platform/editor/common/editor.js';
import { IOpenerService } from '../../../../../platform/opener/common/opener.js';
import { ISecretStorageService } from '../../../../../platform/secrets/common/secrets.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../../platform/storage/common/storage.js';
import { ITelemetryService } from '../../../../../platform/telemetry/common/telemetry.js';
import { defaultButtonStyles, defaultToggleStyles } from '../../../../../platform/theme/browser/defaultStyles.js';
import { IThemeService } from '../../../../../platform/theme/common/themeService.js';
import { EditorPane } from '../../../../browser/parts/editor/editorPane.js';
import { IEditorOpenContext } from '../../../../common/editor.js';
import { IEditorGroup } from '../../../../services/editor/common/editorGroupsService.js';
import {
	FEATHERLESS_CONFIGURE_API_KEY_COMMAND,
	FEATHERLESS_EXTENSION_ACCOUNT_SUMMARY_COMMAND,
	FEATHERLESS_EXTENSION_LIST_MODELS_COMMAND,
	FEATHERLESS_EXTENSION_SIGN_OUT_COMMAND,
} from '../../../../services/chat/common/featherless.js';
import { isFeatherlessCredentialSecretKey } from '../../../../services/chat/common/featherlessSecrets.js';
import {
	CONTEXT_OMEN_SETTINGS_EDITOR,
	IOmenFeatherlessAccountSummary,
	IOmenFeatherlessSettingsModel,
	IOmenFeatherlessSettingsModelsPage,
	IOmenFeatherlessSettingsModelsQuery,
	OMEN_SETTINGS_EDITOR_ID,
	OMEN_SETTINGS_SELECTED_SECTION_KEY,
	OMEN_SETTINGS_SIDEBAR_WIDTH_KEY,
	OmenAgentsConfiguration,
	OmenIDEConfiguration,
	OmenIDEDefaults,
	OmenModelsBrowseFilter,
	OmenModelsSort,
	OmenSettingsSection,
	SIDEBAR_DEFAULT_WIDTH,
	SIDEBAR_MAX_WIDTH,
	SIDEBAR_MIN_WIDTH,
} from './omenSettings.js';
import { OmenSettingsEditorInput } from './omenSettingsEditorInput.js';

const $ = DOM.$;
const FEATHERLESS_ACCOUNT_URL = 'https://featherless.ai/account';
const FEATHERLESS_DOCS_URL = 'https://featherless.ai/docs';
const MODELS_PAGE_SIZE = 100;

const CLASSIFICATION_LABELS: Record<string, string> = {
	coding: localize('omenSettings.models.class.coding', "Coding"),
	chat: localize('omenSettings.models.class.chat', "Chat"),
	tools: localize('omenSettings.models.class.tools', "Tools"),
	vision: localize('omenSettings.models.class.vision', "Vision"),
	creative: localize('omenSettings.models.class.creative', "Creative"),
	reasoning: localize('omenSettings.models.class.reasoning', "Reasoning"),
};

function formatTokenCount(value: number | undefined): string | undefined {
	if (value === undefined || value <= 0) {
		return undefined;
	}
	if (value >= 1_000_000) {
		const millions = value / 1_000_000;
		return `${Number.isInteger(millions) ? millions : millions.toFixed(1)}M ctx`;
	}
	if (value >= 1000) {
		return `${Math.round(value / 1000)}K ctx`;
	}
	return `${value} ctx`;
}

function formatParameterSize(value: number | undefined): string | undefined {
	if (value === undefined || value <= 0) {
		return undefined;
	}
	if (value >= 1_000_000_000) {
		const billions = value / 1_000_000_000;
		return `${Number.isInteger(billions) ? billions : billions.toFixed(1)}B`;
	}
	if (value >= 1_000_000) {
		return `${Math.round(value / 1_000_000)}M`;
	}
	return undefined;
}

function formatCount(value: number | undefined): string | undefined {
	if (value === undefined || value <= 0) {
		return undefined;
	}
	if (value >= 1_000_000) {
		return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`;
	}
	if (value >= 1000) {
		return `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)}K`;
	}
	return String(value);
}

interface INavItem {
	readonly id: OmenSettingsSection;
	readonly label: string;
	readonly icon: ThemeIcon;
}

export class OmenSettingsEditor extends EditorPane {

	static readonly ID = OMEN_SETTINGS_EDITOR_ID;

	private container: HTMLElement | undefined;
	private splitView: SplitView<number> | undefined;
	private sidebarContainer: HTMLElement | undefined;
	private contentContainer: HTMLElement | undefined;
	private accountHeaderEl: HTMLElement | undefined;
	private navButtons = new Map<OmenSettingsSection, HTMLButtonElement>();
	private selectedSection: OmenSettingsSection = OmenSettingsSection.General;
	private accountSummary: IOmenFeatherlessAccountSummary | undefined;
	private readonly editorDisposables = this._register(new DisposableStore());
	private readonly inOmenSettingsEditorContextKey: IContextKey<boolean>;

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService private readonly storageService: IStorageService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@ICommandService private readonly commandService: ICommandService,
		@IOpenerService private readonly openerService: IOpenerService,
		@ISecretStorageService private readonly secretStorageService: ISecretStorageService,
	) {
		super(OmenSettingsEditor.ID, group, telemetryService, themeService, storageService);
		this.inOmenSettingsEditorContextKey = CONTEXT_OMEN_SETTINGS_EDITOR.bindTo(contextKeyService);

		this._register(this.secretStorageService.onDidChangeSecret(e => {
			if (isFeatherlessCredentialSecretKey(e)) {
				void this.refreshAccountSummary(true);
			}
		}));
	}

	protected override createEditor(parent: HTMLElement): void {
		this.container = DOM.append(parent, $('.omen-settings-editor'));
		const splitHost = DOM.append(this.container, $('.omen-settings-split'));

		const sidebarWidth = this.storageService.getNumber(OMEN_SETTINGS_SIDEBAR_WIDTH_KEY, StorageScope.PROFILE, SIDEBAR_DEFAULT_WIDTH);
		const storedSection = this.storageService.get(OMEN_SETTINGS_SELECTED_SECTION_KEY, StorageScope.PROFILE);
		if (storedSection && Object.values(OmenSettingsSection).includes(storedSection as OmenSettingsSection)) {
			this.selectedSection = storedSection as OmenSettingsSection;
		} else if (storedSection === 'performance') {
			this.selectedSection = OmenSettingsSection.PlanUsage;
		}

		this.splitView = this._register(new SplitView<number>(splitHost, { orientation: Orientation.HORIZONTAL }));
		this.sidebarContainer = this.createSidebar();
		this.splitView.addView({
			onDidChange: Event.None,
			element: this.sidebarContainer,
			minimumSize: SIDEBAR_MIN_WIDTH,
			maximumSize: SIDEBAR_MAX_WIDTH,
			layout: (width, _offset, height) => {
				this.sidebarContainer!.style.width = `${width}px`;
				if (typeof height === 'number') {
					this.sidebarContainer!.style.height = `${height}px`;
				}
			},
		}, sidebarWidth, undefined, true);

		this.contentContainer = $('.omen-settings-content');
		this.splitView.addView({
			onDidChange: Event.None,
			element: this.contentContainer,
			minimumSize: 280,
			maximumSize: Number.POSITIVE_INFINITY,
			layout: (width, _offset, height) => {
				this.contentContainer!.style.width = `${width}px`;
				if (typeof height === 'number') {
					this.contentContainer!.style.height = `${height}px`;
				}
			},
		}, Sizing.Distribute, undefined, true);

		this._register(this.splitView.onDidSashChange(() => {
			const width = this.splitView?.getViewSize(0);
			if (width) {
				this.storageService.store(OMEN_SETTINGS_SIDEBAR_WIDTH_KEY, width, StorageScope.PROFILE, StorageTarget.USER);
			}
		}));

		void this.refreshAccountSummary(true);
	}

	private createSidebar(): HTMLElement {
		const sidebar = $('.omen-settings-sidebar');
		this.accountHeaderEl = DOM.append(sidebar, $('.omen-settings-account-header'));
		this.renderAccountHeader();

		DOM.append(sidebar, $('.omen-settings-sidebar-title', undefined, localize('omenSettings.sidebarTitle', "Omen IDE")));

		const navItems: INavItem[] = [
			{ id: OmenSettingsSection.General, label: localize('omenSettings.section.general', "General"), icon: Codicon.home },
			{ id: OmenSettingsSection.PlanUsage, label: localize('omenSettings.section.planUsage', "Plan & Usage"), icon: Codicon.graph },
			{ id: OmenSettingsSection.Agents, label: localize('omenSettings.section.agents', "Agents"), icon: Codicon.robot },
			{ id: OmenSettingsSection.Models, label: localize('omenSettings.section.models', "Models"), icon: Codicon.sparkle },
		];

		for (const item of navItems) {
			const button = DOM.append(sidebar, $('button.omen-settings-nav-item')) as HTMLButtonElement;
			button.type = 'button';
			DOM.append(button, $(ThemeIcon.asCSSSelector(item.icon)));
			DOM.append(button, $('span', undefined, item.label));
			button.setAttribute('aria-label', item.label);
			this.navButtons.set(item.id, button);
			this._register(DOM.addDisposableListener(button, 'click', () => this.selectSection(item.id)));
		}

		const footer = DOM.append(sidebar, $('.omen-settings-sidebar-footer'));
		const vscodeSettingsButton = this._register(new Button(footer, { ...defaultButtonStyles, title: localize('omenSettings.openVsCodeSettings', "Open VS Code Settings") }));
		vscodeSettingsButton.label = localize('omenSettings.vsCodeSettings', "VS Code Settings");
		this._register(vscodeSettingsButton.onDidClick(() => this.commandService.executeCommand('workbench.action.openSettings')));

		return sidebar;
	}

	private renderAccountHeader(): void {
		if (!this.accountHeaderEl) {
			return;
		}
		DOM.clearNode(this.accountHeaderEl);
		const summary = this.accountSummary;
		const configured = !!summary?.configured;
		const planName = summary?.plan?.name;
		const avatar = DOM.append(this.accountHeaderEl, $('.omen-settings-account-avatar'));
		avatar.textContent = configured ? (planName?.[0]?.toUpperCase() ?? 'F') : '?';

		const textCol = DOM.append(this.accountHeaderEl, $('.omen-settings-account-text'));
		const title = DOM.append(textCol, $('.omen-settings-account-title'));
		title.textContent = configured
			? (planName ?? localize('omenSettings.account.featherless', "Featherless"))
			: localize('omenSettings.account.notSignedIn', "Not signed in");

		const subtitle = DOM.append(textCol, $('.omen-settings-account-subtitle'));
		if (!configured) {
			subtitle.textContent = localize('omenSettings.account.connectHint', "Connect Featherless to continue");
		} else if (summary?.authMethod === 'oauth') {
			subtitle.textContent = localize('omenSettings.account.signedInOauth', "Signed in with Featherless");
		} else if (summary?.authMethod === 'apikey') {
			subtitle.textContent = localize('omenSettings.account.signedInApiKeyShort', "API key");
		} else {
			subtitle.textContent = localize('omenSettings.account.connected', "Connected");
		}

		if (planName) {
			const badge = DOM.append(this.accountHeaderEl, $('.omen-settings-plan-badge'));
			badge.textContent = planName;
		}
	}

	selectSection(section: OmenSettingsSection): void {
		this.selectedSection = section;
		this.storageService.store(OMEN_SETTINGS_SELECTED_SECTION_KEY, section, StorageScope.PROFILE, StorageTarget.USER);
		this.updateNavSelection();
		this.renderContent();
	}

	private updateNavSelection(): void {
		for (const [id, button] of this.navButtons) {
			button.classList.toggle('selected', id === this.selectedSection);
		}
	}

	private renderContent(): void {
		if (!this.contentContainer) {
			return;
		}
		this.editorDisposables.clear();
		DOM.clearNode(this.contentContainer);
		this.updateNavSelection();

		const parent = DOM.append(this.contentContainer, $('.omen-settings-content-inner'));

		switch (this.selectedSection) {
			case OmenSettingsSection.PlanUsage:
				this.renderPlanUsageSection(parent);
				break;
			case OmenSettingsSection.Agents:
				this.renderAgentsSection(parent);
				break;
			case OmenSettingsSection.Models:
				void this.renderModelsSection(parent);
				break;
			case OmenSettingsSection.General:
			default:
				this.renderGeneralSection(parent);
				break;
		}
	}

	private renderGeneralSection(parent: HTMLElement): void {
		DOM.append(parent, $('h1.omen-settings-section-title', undefined, localize('omenSettings.general.title', "General")));
		const configured = !!this.accountSummary?.configured;

		if (configured) {
			const group = this.createGroup(parent);
			const planName = this.accountSummary?.plan?.name ?? localize('omenSettings.account.featherless', "Featherless");
			const authLabel = this.accountSummary?.authMethod === 'oauth'
				? localize('omenSettings.account.signedInOauth', "Signed in with Featherless")
				: this.accountSummary?.authMethod === 'apikey'
					? localize('omenSettings.account.signedInApiKey', "Connected with an API key")
					: localize('omenSettings.account.connected', "Connected");

			const accountRow = this.createRow(group,
				localize('omenSettings.account.label', "Featherless Account"),
				localize('omenSettings.account.connectedDescription', "{0} · {1}", planName, authLabel),
			);
			const control = this.getRowControl(accountRow);

			const manageButton = this.editorDisposables.add(new Button(control, { ...defaultButtonStyles, secondary: true, title: localize('omenSettings.account.manage', "Manage") }));
			manageButton.label = localize('omenSettings.account.manage', "Manage");
			this.editorDisposables.add(manageButton.onDidClick(() => this.openerService.open(FEATHERLESS_ACCOUNT_URL)));

			const signOutButton = this.editorDisposables.add(new Button(control, { ...defaultButtonStyles, secondary: true, title: localize('omenSettings.account.signOut', "Sign out") }));
			signOutButton.label = localize('omenSettings.account.signOut', "Sign out");
			this.editorDisposables.add(signOutButton.onDidClick(async () => {
				await this.commandService.executeCommand(FEATHERLESS_EXTENSION_SIGN_OUT_COMMAND);
				await this.refreshAccountSummary(true);
			}));
		} else {
			const group = this.createGroup(parent);
			const connectRow = this.createRow(group,
				localize('omenSettings.apiKey.label', "Featherless Account"),
				localize('omenSettings.apiKey.description', "Sign in with Featherless OAuth or paste an API key. Credentials are stored locally."),
			);
			const control = this.getRowControl(connectRow);
			const status = DOM.append(control, $('.omen-settings-status.missing'));
			status.textContent = localize('omenSettings.apiKey.missing', "Not configured");

			const connectButton = this.editorDisposables.add(new Button(control, { ...defaultButtonStyles, title: localize('omenSettings.apiKey.configure', "Connect Featherless") }));
			connectButton.label = localize('omenSettings.apiKey.configure', "Connect Featherless");
			this.editorDisposables.add(connectButton.onDidClick(async () => {
				await this.commandService.executeCommand(FEATHERLESS_CONFIGURE_API_KEY_COMMAND);
				await this.refreshAccountSummary(true);
			}));
		}

		const prefs = this.createGroup(parent);
		const editorRow = this.createRow(prefs,
			localize('omenSettings.prefs.editor.label', "Editor Settings"),
			localize('omenSettings.prefs.editor.description', "Font, formatting, and editor behavior."),
		);
		const editorBtn = this.editorDisposables.add(new Button(this.getRowControl(editorRow), { ...defaultButtonStyles, secondary: true }));
		editorBtn.label = localize('omenSettings.prefs.open', "Open");
		this.editorDisposables.add(editorBtn.onDidClick(() => this.commandService.executeCommand('workbench.action.openSettings', '@id:editor.fontSize')));

		const keysRow = this.createRow(prefs,
			localize('omenSettings.prefs.keys.label', "Keyboard Shortcuts"),
			localize('omenSettings.prefs.keys.description', "Customize keybindings for Omen IDE."),
		);
		const keysBtn = this.editorDisposables.add(new Button(this.getRowControl(keysRow), { ...defaultButtonStyles, secondary: true }));
		keysBtn.label = localize('omenSettings.prefs.open', "Open");
		this.editorDisposables.add(keysBtn.onDidClick(() => this.commandService.executeCommand('workbench.action.openGlobalKeybindings')));

		if (configured) {
			const signOutFooter = DOM.append(parent, $('.omen-settings-signout-footer'));
			const signOut = this.editorDisposables.add(new Button(signOutFooter, { ...defaultButtonStyles, secondary: true, title: localize('omenSettings.account.signOut', "Sign out") }));
			signOut.label = localize('omenSettings.account.signOut', "Sign out");
			this.editorDisposables.add(signOut.onDidClick(async () => {
				await this.commandService.executeCommand(FEATHERLESS_EXTENSION_SIGN_OUT_COMMAND);
				await this.refreshAccountSummary(true);
			}));
		}

		const docsLink = DOM.append(parent, $('.omen-settings-link-row'));
		const docsAnchor = DOM.append(docsLink, $('a', { href: FEATHERLESS_DOCS_URL, role: 'button' }, localize('omenSettings.docs', "Featherless documentation")));
		this.editorDisposables.add(DOM.addDisposableListener(docsAnchor, 'click', e => {
			e.preventDefault();
			this.openerService.open(FEATHERLESS_DOCS_URL);
		}));
	}

	private renderPlanUsageSection(parent: HTMLElement): void {
		DOM.append(parent, $('h1.omen-settings-section-title', undefined, localize('omenSettings.planUsage.title', "Plan & Usage")));

		if (!this.accountSummary?.configured) {
			this.renderConnectPrompt(parent);
			return;
		}

		if (this.accountSummary.error && !this.accountSummary.plan) {
			const err = DOM.append(parent, $('.omen-settings-empty'));
			err.textContent = localize('omenSettings.planUsage.error', "Could not load plan details: {0}", this.accountSummary.error);
		}

		const plan = this.accountSummary.plan;
		if (plan) {
			const cards = DOM.append(parent, $('.omen-settings-plan-cards'));
			const card = DOM.append(cards, $('.omen-settings-plan-card'));
			DOM.append(card, $('.omen-settings-plan-card-label', undefined, localize('omenSettings.planUsage.currentPlan', "Current Plan")));
			DOM.append(card, $('.omen-settings-plan-card-title', undefined, plan.name));
			const details: string[] = [];
			if (plan.concurrency !== null && plan.concurrency !== undefined) {
				details.push(localize('omenSettings.planUsage.concurrency', "{0} concurrent units", plan.concurrency));
			}
			if (plan.max_context_length !== null && plan.max_context_length !== undefined) {
				details.push(localize('omenSettings.planUsage.context', "{0} context tokens", plan.max_context_length.toLocaleString()));
			}
			if (plan.max_model_size !== null && plan.max_model_size !== undefined) {
				details.push(localize('omenSettings.planUsage.modelSize', "Up to {0}B params", plan.max_model_size));
			}
			if (details.length) {
				DOM.append(card, $('.omen-settings-plan-card-meta', undefined, details.join(' · ')));
			}
			const manage = this.editorDisposables.add(new Button(card, { ...defaultButtonStyles, secondary: true }));
			manage.label = localize('omenSettings.account.manage', "Manage");
			this.editorDisposables.add(manage.onDidClick(() => this.openerService.open(FEATHERLESS_ACCOUNT_URL)));
		}

		const concurrency = this.accountSummary.concurrency;
		const usageGroup = this.createGroup(parent);
		DOM.append(usageGroup, $('.omen-settings-group-heading', undefined, localize('omenSettings.planUsage.included', "Included concurrency")));

		if (concurrency) {
			const limit = concurrency.limit;
			const used = concurrency.used_cost;
			const pct = limit && limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
			const row = DOM.append(usageGroup, $('.omen-settings-usage-row'));
			DOM.append(row, $('.omen-settings-usage-label', undefined, localize('omenSettings.planUsage.total', "In use")));
			const barWrap = DOM.append(row, $('.omen-settings-usage-bar'));
			const fill = DOM.append(barWrap, $('.omen-settings-usage-bar-fill'));
			fill.style.width = `${limit === null || limit === undefined ? 0 : pct}%`;
			DOM.append(row, $('.omen-settings-usage-value', undefined,
				limit === null || limit === undefined
					? localize('omenSettings.planUsage.unlimited', "{0} / Unlimited", used)
					: localize('omenSettings.planUsage.usedOf', "{0} / {1} ({2}%)", used, limit, pct),
			));
			DOM.append(usageGroup, $('.omen-settings-usage-hint', undefined,
				localize('omenSettings.planUsage.requests', "{0} requests in flight", concurrency.request_count),
			));
		} else {
			DOM.append(usageGroup, $('.omen-settings-empty', undefined, localize('omenSettings.planUsage.noConcurrency', "Concurrency usage is unavailable right now.")));
		}

		const overrides = this.createGroup(parent);
		this.addNumberSetting(overrides,
			OmenIDEConfiguration.concurrencyLimit,
			localize('omenSettings.concurrencyLimit.label', "Local concurrency limit"),
			localize('omenSettings.concurrencyLimit.description', "Client-side cap on concurrent Featherless request units. Should match your plan."),
			OmenIDEDefaults.concurrencyLimit,
			1,
			64,
		);
		this.addNumberSetting(overrides,
			OmenIDEConfiguration.concurrencyMaxRetries,
			localize('omenSettings.concurrencyRetries.label', "Concurrency retries"),
			localize('omenSettings.concurrencyRetries.description', "How many times to wait and retry when Featherless reports a concurrency limit."),
			OmenIDEDefaults.concurrencyMaxRetries,
			1,
			50,
		);
	}

	private renderAgentsSection(parent: HTMLElement): void {
		DOM.append(parent, $('h1.omen-settings-section-title', undefined, localize('omenSettings.agents.title', "Agents")));

		const startup = this.createGroup(parent);
		DOM.append(startup, $('.omen-settings-group-heading', undefined, localize('omenSettings.agents.startup', "Startup")));
		this.addCheckboxSetting(startup,
			OmenAgentsConfiguration.agentEnabled,
			localize('omenSettings.agents.enabled.label', "Agent mode"),
			localize('omenSettings.agents.enabled.description', "Allow agent mode and tools that can change your workspace."),
			true,
		);

		const notifications = this.createGroup(parent);
		DOM.append(notifications, $('.omen-settings-group-heading', undefined, localize('omenSettings.agents.notifications', "Notifications")));
		this.addSelectSetting(notifications,
			OmenAgentsConfiguration.notifyOnResponse,
			localize('omenSettings.agents.notify.label', "System notifications"),
			localize('omenSettings.agents.notify.description', "Show an OS notification when an agent response arrives."),
			[
				{ value: 'off', label: localize('omenSettings.agents.notify.off', "Off") },
				{ value: 'windowNotFocused', label: localize('omenSettings.agents.notify.unfocused', "When window not focused") },
				{ value: 'always', label: localize('omenSettings.agents.notify.always', "Always") },
			],
			'windowNotFocused',
		);

		const approvals = this.createGroup(parent);
		DOM.append(approvals, $('.omen-settings-group-heading', undefined, localize('omenSettings.agents.approvals', "Approvals")));
		this.addCheckboxSetting(approvals,
			OmenAgentsConfiguration.globalAutoApprove,
			localize('omenSettings.agents.autoApprove.label', "Global auto-approve"),
			localize('omenSettings.agents.autoApprove.description', "Bypass tool approvals for all workspaces. Dangerous — use only if you understand the risk."),
			false,
		);

		const privacy = this.createGroup(parent);
		DOM.append(privacy, $('.omen-settings-group-heading', undefined, localize('omenSettings.agents.privacy', "Privacy")));
		const privacyRow = this.createRow(privacy,
			localize('omenSettings.agents.privacy.label', "Featherless data practices"),
			localize('omenSettings.agents.privacy.description', "Review how Featherless handles prompts and usage on their documentation site."),
		);
		const privacyBtn = this.editorDisposables.add(new Button(this.getRowControl(privacyRow), { ...defaultButtonStyles, secondary: true }));
		privacyBtn.label = localize('omenSettings.agents.privacy.open', "Open docs");
		this.editorDisposables.add(privacyBtn.onDidClick(() => this.openerService.open(FEATHERLESS_DOCS_URL)));

		this.addCheckboxSetting(this.createGroup(parent),
			OmenIDEConfiguration.autocompleteEnabled,
			localize('omenSettings.autocomplete.label', "Tab autocomplete"),
			localize('omenSettings.autocomplete.description', "Enable Featherless FIM inline completions as you type."),
			OmenIDEDefaults.autocompleteEnabled,
		);
	}

	private async renderModelsSection(parent: HTMLElement): Promise<void> {
		DOM.append(parent, $('h1.omen-settings-section-title', undefined, localize('omenSettings.models.title', "Models")));

		if (!this.accountSummary?.configured) {
			this.renderConnectPrompt(parent);
			return;
		}

		const defaults = this.createGroup(parent);
		DOM.append(defaults, $('.omen-settings-group-heading', undefined, localize('omenSettings.models.defaults', "Task models")));
		this.addTextSetting(defaults,
			OmenIDEConfiguration.chatModel,
			localize('omenSettings.chatModel.label', "Chat model"),
			localize('omenSettings.chatModel.description', "Used for agent chat and fast-apply."),
			OmenIDEDefaults.chatModel,
		);
		this.addTextSetting(defaults,
			OmenIDEConfiguration.embeddingModel,
			localize('omenSettings.embeddingModel.label', "Embedding model"),
			localize('omenSettings.embeddingModel.description', "Powers @codebase semantic search."),
			OmenIDEDefaults.embeddingModel,
		);
		this.addTextSetting(defaults,
			OmenIDEConfiguration.completionModel,
			localize('omenSettings.completionModel.label', "Tab completion model"),
			localize('omenSettings.completionModel.description', "FIM model for inline Tab suggestions."),
			OmenIDEDefaults.completionModel,
		);
		this.addTextSetting(defaults,
			OmenIDEConfiguration.visionModel,
			localize('omenSettings.visionModel.label', "Vision model"),
			localize('omenSettings.visionModel.description', "Describes pasted or attached images when the chat model does not support vision (for example GLM-5.2)."),
			OmenIDEDefaults.visionModel,
		);

		const listGroup = this.createGroup(parent);
		DOM.append(listGroup, $('.omen-settings-group-heading', undefined, localize('omenSettings.models.enabled', "Enabled models")));
		DOM.append(listGroup, $('.omen-settings-group-description', undefined, localize(
			'omenSettings.models.enabledDescription',
			"Browse Featherless models available on your plan. Toggle models on or off for the chat picker."
		)));

		const toolbar = DOM.append(listGroup, $('.omen-settings-model-toolbar'));
		const searchRow = DOM.append(toolbar, $('.omen-settings-model-search'));
		const search = DOM.append(searchRow, $('input', {
			type: 'search',
			placeholder: localize('omenSettings.models.search', "Search models by name or id"),
			'aria-label': localize('omenSettings.models.searchAria', "Search models"),
		})) as HTMLInputElement;

		const filtersRow = DOM.append(toolbar, $('.omen-settings-model-filters'));
		const browseFilters: { id: OmenModelsBrowseFilter; label: string }[] = [
			{ id: 'all', label: localize('omenSettings.models.filter.all', "All") },
			{ id: 'popular', label: localize('omenSettings.models.filter.popular', "Popular") },
			{ id: 'coding', label: localize('omenSettings.models.filter.coding', "Coding") },
			{ id: 'tools', label: localize('omenSettings.models.filter.tools', "Tools") },
			{ id: 'vision', label: localize('omenSettings.models.filter.vision', "Vision") },
			{ id: 'creative', label: localize('omenSettings.models.filter.creative', "Creative") },
		];
		const filterButtons = new Map<OmenModelsBrowseFilter, HTMLButtonElement>();
		for (const filter of browseFilters) {
			const button = DOM.append(filtersRow, $('button.omen-settings-filter-chip', { type: 'button' }, filter.label)) as HTMLButtonElement;
			filterButtons.set(filter.id, button);
		}

		const controlsRow = DOM.append(toolbar, $('.omen-settings-model-controls'));
		const sortLabel = DOM.append(controlsRow, $('label.omen-settings-control-label'));
		sortLabel.textContent = localize('omenSettings.models.sort', "Sort");
		const sortSelect = DOM.append(sortLabel, $('select', { 'aria-label': localize('omenSettings.models.sortAria', "Sort models") })) as HTMLSelectElement;
		for (const [value, label] of [
			['popularity', localize('omenSettings.models.sort.popularity', "Most popular")],
			['name', localize('omenSettings.models.sort.name', "Name A-Z")],
			['context', localize('omenSettings.models.sort.context', "Largest context")],
		] as const) {
			DOM.append(sortSelect, $('option', { value }, label));
		}

		const contextLabel = DOM.append(controlsRow, $('label.omen-settings-control-label'));
		contextLabel.textContent = localize('omenSettings.models.context', "Context");
		const contextSelect = DOM.append(contextLabel, $('select', { 'aria-label': localize('omenSettings.models.contextAria', "Minimum context length") })) as HTMLSelectElement;
		for (const [value, label] of [
			['0', localize('omenSettings.models.context.any', "Any")],
			['32768', localize('omenSettings.models.context.32k', "32K+")],
			['131072', localize('omenSettings.models.context.128k', "128K+")],
		] as const) {
			DOM.append(contextSelect, $('option', { value }, label));
		}

		const actionsRow = DOM.append(toolbar, $('.omen-settings-model-actions'));
		const enablePageBtn = DOM.append(actionsRow, $('button.omen-settings-action-btn', { type: 'button' }, localize('omenSettings.models.enablePage', "Enable page"))) as HTMLButtonElement;
		const disablePageBtn = DOM.append(actionsRow, $('button.omen-settings-action-btn', { type: 'button' }, localize('omenSettings.models.disablePage', "Disable page"))) as HTMLButtonElement;
		const onlyPageBtn = DOM.append(actionsRow, $('button.omen-settings-action-btn', { type: 'button' }, localize('omenSettings.models.onlyPage', "Only this page"))) as HTMLButtonElement;
		const resetBtn = DOM.append(actionsRow, $('button.omen-settings-action-btn', { type: 'button' }, localize('omenSettings.models.resetAll', "Enable all"))) as HTMLButtonElement;

		const statusEl = DOM.append(listGroup, $('.omen-settings-model-status'));
		const listHost = DOM.append(listGroup, $('.omen-settings-model-list'));
		const pager = DOM.append(listGroup, $('.omen-settings-model-pager'));
		const prevBtn = DOM.append(pager, $('button.omen-settings-action-btn', { type: 'button' }, localize('omenSettings.models.prev', "Previous"))) as HTMLButtonElement;
		const pageLabel = DOM.append(pager, $('.omen-settings-model-page-label'));
		const nextBtn = DOM.append(pager, $('button.omen-settings-action-btn', { type: 'button' }, localize('omenSettings.models.next', "Next"))) as HTMLButtonElement;

		let browse: OmenModelsBrowseFilter = 'popular';
		let sort: OmenModelsSort = 'popularity';
		let page = 1;
		let contextLengthMin = 0;
		let currentModels: IOmenFeatherlessSettingsModel[] = [];
		let hasMore = false;
		let loadGeneration = 0;
		let searchDebounce: ReturnType<typeof setTimeout> | undefined;

		const syncFilterChips = () => {
			for (const [id, button] of filterButtons) {
				button.classList.toggle('active', id === browse);
				button.setAttribute('aria-pressed', String(id === browse));
			}
		};

		const isModelEnabled = (modelId: string): boolean => {
			const enabled = this.configurationService.getValue<string[]>(OmenIDEConfiguration.enabledModels) ?? [];
			if (enabled.length > 0) {
				return enabled.includes(modelId);
			}
			const disabled = this.configurationService.getValue<string[]>(OmenIDEConfiguration.disabledModels) ?? [];
			return !disabled.includes(modelId);
		};

		const renderRows = () => {
			DOM.clearNode(listHost);
			if (!currentModels.length) {
				DOM.append(listHost, $('.omen-settings-empty', undefined, localize('omenSettings.models.none', "No models match your search.")));
				return;
			}

			for (const model of currentModels) {
				const row = DOM.append(listHost, $('.omen-settings-model-row'));
				const text = DOM.append(row, $('.omen-settings-model-row-main'));
				DOM.append(text, $('.omen-settings-row-label', undefined, model.name));
				DOM.append(text, $('.omen-settings-row-description', undefined, model.id));

				const meta = DOM.append(text, $('.omen-settings-model-meta'));
				const badges = DOM.append(meta, $('.omen-settings-model-badges'));
				if (model.gated) {
					DOM.append(badges, $('span.omen-settings-model-badge.omen-settings-model-badge-gated', undefined, localize('omenSettings.models.gated', "Gated")));
				}
				for (const classification of model.classifications ?? []) {
					const label = CLASSIFICATION_LABELS[classification] ?? classification;
					DOM.append(badges, $('span.omen-settings-model-badge', undefined, label));
				}
				const details: string[] = [];
				const ctx = formatTokenCount(model.contextLength);
				if (ctx) {
					details.push(ctx);
				}
				const params = formatParameterSize(model.parameterSize);
				if (params) {
					details.push(params);
				}
				const favorites = formatCount(model.favorites);
				if (favorites) {
					details.push(localize('omenSettings.models.favorites', "{0} favorites", favorites));
				}
				const downloads = formatCount(model.downloads);
				if (downloads) {
					details.push(localize('omenSettings.models.downloads', "{0} downloads", downloads));
				}
				if (details.length) {
					DOM.append(meta, $('.omen-settings-model-details', undefined, details.join(' · ')));
				}

				const control = DOM.append(row, $('.omen-settings-row-control'));
				const toggle = this.editorDisposables.add(new Toggle({
					...defaultToggleStyles,
					icon: Codicon.check,
					title: localize('omenSettings.models.toggle', "Enable {0}", model.name),
					isChecked: isModelEnabled(model.id),
				}));
				control.appendChild(toggle.domNode);
				this.editorDisposables.add(toggle.onChange(() => {
					void this.setModelEnabled(model.id, toggle.checked);
				}));
			}
		};

		const updatePager = () => {
			pageLabel.textContent = localize('omenSettings.models.page', "Page {0}", page);
			prevBtn.disabled = page <= 1;
			nextBtn.disabled = !hasMore;
		};

		const updateStatus = (text: string) => {
			statusEl.textContent = text;
		};

		const getEnablementModeLabel = (): string => {
			if ((this.configurationService.getValue<string[]>(OmenIDEConfiguration.enabledModels) ?? []).length > 0) {
				return localize('omenSettings.models.mode.allowlist', "Allowlist mode");
			}
			if ((this.configurationService.getValue<string[]>(OmenIDEConfiguration.disabledModels) ?? []).length > 0) {
				return localize('omenSettings.models.mode.denylist', "Some models disabled");
			}
			return localize('omenSettings.models.mode.all', "All plan models enabled");
		};

		const updateListStatus = () => {
			updateStatus(localize(
				'omenSettings.models.status',
				"{0} models on this page · {1}",
				currentModels.length,
				getEnablementModeLabel(),
			));
		};

		const loadPage = async (resetPage = false) => {
			if (resetPage) {
				page = 1;
			}
			const generation = ++loadGeneration;
			updateStatus(localize('omenSettings.models.loading', "Loading models…"));
			DOM.clearNode(listHost);
			DOM.append(listHost, $('.omen-settings-empty', undefined, localize('omenSettings.models.loading', "Loading models…")));

			const query: IOmenFeatherlessSettingsModelsQuery = {
				page,
				perPage: MODELS_PAGE_SIZE,
				q: search.value.trim() || undefined,
				sort,
				browse,
				contextLengthMin: contextLengthMin > 0 ? contextLengthMin : undefined,
			};

			try {
				const raw = await this.commandService.executeCommand<IOmenFeatherlessSettingsModelsPage | IOmenFeatherlessSettingsModel[]>(
					FEATHERLESS_EXTENSION_LIST_MODELS_COMMAND,
					query,
				);
				if (generation !== loadGeneration || this.selectedSection !== OmenSettingsSection.Models || !parent.isConnected) {
					return;
				}
				const result: IOmenFeatherlessSettingsModelsPage = Array.isArray(raw)
					? { models: raw, page, perPage: MODELS_PAGE_SIZE, hasMore: false, query }
					: (raw ?? { models: [], page, perPage: MODELS_PAGE_SIZE, hasMore: false, query });
				currentModels = [...result.models];
				hasMore = !!result.hasMore;
				page = result.page ?? page;
				renderRows();
				updatePager();
				updateListStatus();
			} catch (err) {
				if (generation !== loadGeneration || this.selectedSection !== OmenSettingsSection.Models || !parent.isConnected) {
					return;
				}
				currentModels = [];
				hasMore = false;
				DOM.clearNode(listHost);
				DOM.append(listHost, $('.omen-settings-empty', undefined, localize(
					'omenSettings.models.loadFailed',
					"Could not load models: {0}",
					err instanceof Error ? err.message : String(err),
				)));
				updatePager();
				updateStatus('');
			}
		};

		syncFilterChips();
		sortSelect.value = sort;
		void loadPage();

		this.editorDisposables.add(DOM.addDisposableListener(search, 'input', () => {
			if (searchDebounce !== undefined) {
				clearTimeout(searchDebounce);
			}
			searchDebounce = setTimeout(() => {
				searchDebounce = undefined;
				void loadPage(true);
			}, 300);
		}));
		this.editorDisposables.add({ dispose: () => { if (searchDebounce !== undefined) { clearTimeout(searchDebounce); } } });

		for (const [id, button] of filterButtons) {
			this.editorDisposables.add(DOM.addDisposableListener(button, 'click', () => {
				browse = id;
				if (id === 'popular') {
					sort = 'popularity';
					sortSelect.value = sort;
				}
				syncFilterChips();
				void loadPage(true);
			}));
		}

		this.editorDisposables.add(DOM.addDisposableListener(sortSelect, 'change', () => {
			sort = sortSelect.value as OmenModelsSort;
			void loadPage(true);
		}));
		this.editorDisposables.add(DOM.addDisposableListener(contextSelect, 'change', () => {
			contextLengthMin = Number.parseInt(contextSelect.value, 10) || 0;
			void loadPage(true);
		}));
		this.editorDisposables.add(DOM.addDisposableListener(prevBtn, 'click', () => {
			if (page > 1) {
				page -= 1;
				void loadPage();
			}
		}));
		this.editorDisposables.add(DOM.addDisposableListener(nextBtn, 'click', () => {
			if (hasMore) {
				page += 1;
				void loadPage();
			}
		}));
		this.editorDisposables.add(DOM.addDisposableListener(enablePageBtn, 'click', () => {
			void this.setModelsEnabled(currentModels.map(m => m.id), true).then(() => {
				renderRows();
				updateListStatus();
			});
		}));
		this.editorDisposables.add(DOM.addDisposableListener(disablePageBtn, 'click', () => {
			void this.setModelsEnabled(currentModels.map(m => m.id), false).then(() => {
				renderRows();
				updateListStatus();
			});
		}));
		this.editorDisposables.add(DOM.addDisposableListener(onlyPageBtn, 'click', () => {
			void this.setModelsAllowlist(currentModels.map(m => m.id)).then(() => {
				renderRows();
				updateListStatus();
			});
		}));
		this.editorDisposables.add(DOM.addDisposableListener(resetBtn, 'click', () => {
			void this.resetModelEnablement().then(() => {
				renderRows();
				updateListStatus();
			});
		}));

		const pickerRow = this.createRow(this.createGroup(parent),
			localize('omenSettings.modelPicker.label', "Model picker"),
			localize('omenSettings.modelPicker.description', "Browse and switch chat models from the agent panel."),
		);
		const pickerButton = this.editorDisposables.add(new Button(this.getRowControl(pickerRow), { ...defaultButtonStyles }));
		pickerButton.label = localize('omenSettings.modelPicker.open', "Open Model Picker");
		this.editorDisposables.add(pickerButton.onDidClick(() => this.commandService.executeCommand('workbench.action.chat.openModelPicker')));
	}

	private async setModelEnabled(modelId: string, enable: boolean): Promise<void> {
		await this.setModelsEnabled([modelId], enable);
	}

	private async setModelsEnabled(modelIds: readonly string[], enable: boolean): Promise<void> {
		if (!modelIds.length) {
			return;
		}
		const enabled = [...(this.configurationService.getValue<string[]>(OmenIDEConfiguration.enabledModels) ?? [])];
		if (enabled.length > 0) {
			const set = new Set(enabled);
			for (const id of modelIds) {
				if (enable) {
					set.add(id);
				} else {
					set.delete(id);
				}
			}
			await this.configurationService.updateValue(OmenIDEConfiguration.enabledModels, Array.from(set), ConfigurationTarget.USER);
			return;
		}

		const disabled = new Set(this.configurationService.getValue<string[]>(OmenIDEConfiguration.disabledModels) ?? []);
		for (const id of modelIds) {
			if (enable) {
				disabled.delete(id);
			} else {
				disabled.add(id);
			}
		}
		await this.configurationService.updateValue(OmenIDEConfiguration.disabledModels, Array.from(disabled), ConfigurationTarget.USER);
	}

	private async setModelsAllowlist(modelIds: readonly string[]): Promise<void> {
		await this.configurationService.updateValue(OmenIDEConfiguration.disabledModels, [], ConfigurationTarget.USER);
		await this.configurationService.updateValue(OmenIDEConfiguration.enabledModels, [...modelIds], ConfigurationTarget.USER);
	}

	private async resetModelEnablement(): Promise<void> {
		await this.configurationService.updateValue(OmenIDEConfiguration.enabledModels, [], ConfigurationTarget.USER);
		await this.configurationService.updateValue(OmenIDEConfiguration.disabledModels, [], ConfigurationTarget.USER);
	}

	private renderConnectPrompt(parent: HTMLElement): void {
		const empty = DOM.append(parent, $('.omen-settings-empty-card'));
		DOM.append(empty, $('p', undefined, localize('omenSettings.connectPrompt', "Connect Featherless to view this section.")));
		const btn = this.editorDisposables.add(new Button(empty, { ...defaultButtonStyles }));
		btn.label = localize('omenSettings.apiKey.configure', "Connect Featherless");
		this.editorDisposables.add(btn.onDidClick(async () => {
			await this.commandService.executeCommand(FEATHERLESS_CONFIGURE_API_KEY_COMMAND);
			await this.refreshAccountSummary(true);
		}));
	}

	private createGroup(parent: HTMLElement): HTMLElement {
		return DOM.append(parent, $('.omen-settings-group'));
	}

	private createRow(group: HTMLElement, label: string, description: string): HTMLElement {
		const row = DOM.append(group, $('.omen-settings-row'));
		const text = DOM.append(row, $('div'));
		DOM.append(text, $('.omen-settings-row-label', undefined, label));
		DOM.append(text, $('.omen-settings-row-description', undefined, description));
		DOM.append(row, $('.omen-settings-row-control'));
		return row;
	}

	private getRowControl(row: HTMLElement): HTMLElement {
		return row.lastElementChild as HTMLElement;
	}

	private addTextSetting(group: HTMLElement, key: string, label: string, description: string, defaultValue: string): void {
		const row = this.createRow(group, label, description);
		const control = this.getRowControl(row);
		const input = DOM.append(control, $('input', { type: 'text' })) as HTMLInputElement;
		input.value = this.configurationService.getValue<string>(key) ?? defaultValue;

		const commit = () => {
			const value = input.value.trim() || defaultValue;
			void this.configurationService.updateValue(key, value, ConfigurationTarget.USER);
		};
		this.editorDisposables.add(DOM.addDisposableListener(input, 'change', commit));
		this.editorDisposables.add(DOM.addDisposableListener(input, 'blur', commit));
		this.editorDisposables.add(this.configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(key)) {
				input.value = this.configurationService.getValue<string>(key) ?? defaultValue;
			}
		}));
	}

	private addNumberSetting(group: HTMLElement, key: string, label: string, description: string, defaultValue: number, min: number, max: number): void {
		const row = this.createRow(group, label, description);
		const control = this.getRowControl(row);
		const input = DOM.append(control, $('input', { type: 'number', min: String(min), max: String(max) })) as HTMLInputElement;
		input.value = String(this.configurationService.getValue<number>(key) ?? defaultValue);

		const commit = () => {
			const parsed = Number.parseInt(input.value, 10);
			const value = Number.isNaN(parsed) ? defaultValue : Math.min(max, Math.max(min, parsed));
			input.value = String(value);
			void this.configurationService.updateValue(key, value, ConfigurationTarget.USER);
		};
		this.editorDisposables.add(DOM.addDisposableListener(input, 'change', commit));
		this.editorDisposables.add(DOM.addDisposableListener(input, 'blur', commit));
		this.editorDisposables.add(this.configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(key)) {
				input.value = String(this.configurationService.getValue<number>(key) ?? defaultValue);
			}
		}));
	}

	private addCheckboxSetting(group: HTMLElement, key: string, label: string, description: string, defaultValue: boolean): void {
		const row = this.createRow(group, label, description);
		const control = this.getRowControl(row);
		const input = DOM.append(control, $('input', { type: 'checkbox' })) as HTMLInputElement;
		input.checked = this.configurationService.getValue<boolean>(key) ?? defaultValue;
		this.editorDisposables.add(DOM.addDisposableListener(input, 'change', () => {
			void this.configurationService.updateValue(key, input.checked, ConfigurationTarget.USER);
		}));
		this.editorDisposables.add(this.configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(key)) {
				input.checked = this.configurationService.getValue<boolean>(key) ?? defaultValue;
			}
		}));
	}

	private addSelectSetting(
		group: HTMLElement,
		key: string,
		label: string,
		description: string,
		options: ReadonlyArray<{ value: string; label: string }>,
		defaultValue: string,
	): void {
		const row = this.createRow(group, label, description);
		const control = this.getRowControl(row);
		const select = DOM.append(control, $('select')) as HTMLSelectElement;
		for (const opt of options) {
			const option = DOM.append(select, $('option')) as HTMLOptionElement;
			option.value = opt.value;
			option.textContent = opt.label;
		}
		select.value = this.configurationService.getValue<string>(key) ?? defaultValue;
		this.editorDisposables.add(DOM.addDisposableListener(select, 'change', () => {
			void this.configurationService.updateValue(key, select.value, ConfigurationTarget.USER);
		}));
		this.editorDisposables.add(this.configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(key)) {
				select.value = this.configurationService.getValue<string>(key) ?? defaultValue;
			}
		}));
	}

	private async refreshAccountSummary(rerender: boolean): Promise<void> {
		try {
			this.accountSummary = await this.commandService.executeCommand<IOmenFeatherlessAccountSummary>(FEATHERLESS_EXTENSION_ACCOUNT_SUMMARY_COMMAND)
				?? { configured: false };
		} catch {
			this.accountSummary = { configured: false };
		}
		this.renderAccountHeader();
		if (rerender) {
			this.renderContent();
		}
	}

	override async setInput(input: OmenSettingsEditorInput, options: IEditorOptions | undefined, context: IEditorOpenContext, token: CancellationToken): Promise<void> {
		this.inOmenSettingsEditorContextKey.set(true);
		await super.setInput(input, options, context, token);
		await this.refreshAccountSummary(true);
	}

	override layout(dimension: DOM.Dimension): void {
		if (!this.splitView || !this.container) {
			return;
		}
		// Horizontal SplitView distributes along width; pass height as layout context
		// so each view can size itself vertically.
		this.splitView.layout(dimension.width, dimension.height);
	}

	override clearInput(): void {
		this.inOmenSettingsEditorContextKey.set(false);
		super.clearInput();
	}

	override focus(): void {
		super.focus();
		this.container?.focus();
	}
}
