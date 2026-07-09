/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './media/omenSettings.css';
import * as DOM from '../../../../../base/browser/dom.js';
import { Button } from '../../../../../base/browser/ui/button/button.js';
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
import { IStorageService, StorageScope, StorageTarget } from '../../../../../platform/storage/common/storage.js';
import { ITelemetryService } from '../../../../../platform/telemetry/common/telemetry.js';
import { defaultButtonStyles } from '../../../../../platform/theme/browser/defaultStyles.js';
import { IThemeService } from '../../../../../platform/theme/common/themeService.js';
import { EditorPane } from '../../../../browser/parts/editor/editorPane.js';
import { IEditorOpenContext } from '../../../../common/editor.js';
import { IEditorGroup } from '../../../../services/editor/common/editorGroupsService.js';
import { FEATHERLESS_CONFIGURE_API_KEY_COMMAND, FEATHERLESS_EXTENSION_HAS_KEY_COMMAND } from '../../../../services/chat/common/featherless.js';
import {
	CONTEXT_OMEN_SETTINGS_EDITOR,
	OMEN_SETTINGS_EDITOR_ID,
	OMEN_SETTINGS_SELECTED_SECTION_KEY,
	OMEN_SETTINGS_SIDEBAR_WIDTH_KEY,
	OmenIDEConfiguration,
	OmenIDEDefaults,
	OmenSettingsSection,
	SIDEBAR_DEFAULT_WIDTH,
	SIDEBAR_MAX_WIDTH,
	SIDEBAR_MIN_WIDTH,
} from './omenSettings.js';
import { OmenSettingsEditorInput } from './omenSettingsEditorInput.js';

const $ = DOM.$;

interface INavItem {
	readonly id: OmenSettingsSection;
	readonly label: string;
	readonly icon: ThemeIcon;
}

export class OmenSettingsEditor extends EditorPane {

	static readonly ID = OMEN_SETTINGS_EDITOR_ID;

	private container: HTMLElement | undefined;
	private splitView: SplitView | undefined;
	private sidebarContainer: HTMLElement | undefined;
	private contentContainer: HTMLElement | undefined;
	private navButtons = new Map<OmenSettingsSection, HTMLButtonElement>();
	private selectedSection: OmenSettingsSection = OmenSettingsSection.General;
	private apiKeyStatusElement: HTMLElement | undefined;
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
	) {
		super(OmenSettingsEditor.ID, group, telemetryService, themeService, storageService);
		this.inOmenSettingsEditorContextKey = CONTEXT_OMEN_SETTINGS_EDITOR.bindTo(contextKeyService);
	}

	protected override createEditor(parent: HTMLElement): void {
		this.container = DOM.append(parent, $('.omen-settings-editor'));
		const splitHost = DOM.append(this.container, $('.omen-settings-split'));

		const sidebarWidth = this.storageService.getNumber(OMEN_SETTINGS_SIDEBAR_WIDTH_KEY, StorageScope.PROFILE, SIDEBAR_DEFAULT_WIDTH);
		const storedSection = this.storageService.get(OMEN_SETTINGS_SELECTED_SECTION_KEY, StorageScope.PROFILE);
		if (storedSection && Object.values(OmenSettingsSection).includes(storedSection as OmenSettingsSection)) {
			this.selectedSection = storedSection as OmenSettingsSection;
		}

		this.splitView = this._register(new SplitView(splitHost, { orientation: Orientation.HORIZONTAL }));
		this.sidebarContainer = this.createSidebar();
		this.splitView.addView({
			onDidChange: Event.None,
			element: this.sidebarContainer,
			minimumSize: SIDEBAR_MIN_WIDTH,
			maximumSize: SIDEBAR_MAX_WIDTH,
			layout: (width, _, height) => {
				this.sidebarContainer!.style.width = `${width}px`;
				if (height !== undefined) {
					this.sidebarContainer!.style.height = `${height}px`;
				}
			},
		}, sidebarWidth, undefined, true);

		this.contentContainer = $('.omen-settings-content');
		this.splitView.addView({
			onDidChange: Event.None,
			element: this.contentContainer,
			minimumSize: 360,
			maximumSize: Number.POSITIVE_INFINITY,
			layout: (width, _, height) => {
				this.contentContainer!.style.width = `${width}px`;
				if (height !== undefined) {
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

		this.renderContent();
	}

	private createSidebar(): HTMLElement {
		const sidebar = $('.omen-settings-sidebar');
		DOM.append(sidebar, $('.omen-settings-sidebar-title', undefined, localize('omenSettings.sidebarTitle', "Omen IDE")));

		const navItems: INavItem[] = [
			{ id: OmenSettingsSection.General, label: localize('omenSettings.section.general', "General"), icon: Codicon.home },
			{ id: OmenSettingsSection.Models, label: localize('omenSettings.section.models', "Models"), icon: Codicon.sparkle },
			{ id: OmenSettingsSection.Performance, label: localize('omenSettings.section.performance', "Performance"), icon: Codicon.pulse },
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

		switch (this.selectedSection) {
			case OmenSettingsSection.Models:
				this.renderModelsSection(this.contentContainer);
				break;
			case OmenSettingsSection.Performance:
				this.renderPerformanceSection(this.contentContainer);
				break;
			case OmenSettingsSection.General:
			default:
				this.renderGeneralSection(this.contentContainer);
				break;
		}
	}

	private renderGeneralSection(parent: HTMLElement): void {
		DOM.append(parent, $('h1.omen-settings-section-title', undefined, localize('omenSettings.general.title', "General")));

		const group = this.createGroup(parent);

		const apiKeyRow = this.createRow(group,
			localize('omenSettings.apiKey.label', "Featherless API Key"),
			localize('omenSettings.apiKey.description', "Required for chat, Tab autocomplete, and codebase search. Your key is stored locally."),
		);
		const control = this.getRowControl(apiKeyRow);
		this.apiKeyStatusElement = DOM.append(control, $('.omen-settings-status'));
		void this.refreshApiKeyStatus();

		const configureButton = this.editorDisposables.add(new Button(control, { ...defaultButtonStyles, title: localize('omenSettings.apiKey.configure', "Configure API Key") }));
		configureButton.label = localize('omenSettings.apiKey.configure', "Configure API Key");
		this.editorDisposables.add(configureButton.onDidClick(async () => {
			await this.commandService.executeCommand(FEATHERLESS_CONFIGURE_API_KEY_COMMAND);
			await this.refreshApiKeyStatus();
		}));

		const accountGroup = this.createGroup(parent);
		const accountRow = this.createRow(accountGroup,
			localize('omenSettings.account.label', "Featherless Account"),
			localize('omenSettings.account.description', "Manage billing, usage, and API keys on Featherless.ai."),
		);
		const accountControl = this.getRowControl(accountRow);
		const openAccountButton = this.editorDisposables.add(new Button(accountControl, { ...defaultButtonStyles, title: localize('omenSettings.account.open', "Open Account") }));
		openAccountButton.label = localize('omenSettings.account.open', "Open Account");
		this.editorDisposables.add(openAccountButton.onDidClick(() => this.openerService.open('https://featherless.ai/account')));

		const docsLink = DOM.append(parent, $('.omen-settings-link-row'));
		const docsAnchor = DOM.append(docsLink, $('a', { href: 'https://featherless.ai/docs', role: 'button' }, localize('omenSettings.docs', "Featherless documentation")));
		this.editorDisposables.add(DOM.addDisposableListener(docsAnchor, 'click', e => {
			e.preventDefault();
			this.openerService.open('https://featherless.ai/docs');
		}));
	}

	private renderModelsSection(parent: HTMLElement): void {
		DOM.append(parent, $('h1.omen-settings-section-title', undefined, localize('omenSettings.models.title', "Models")));

		const group = this.createGroup(parent);
		this.addTextSetting(group,
			OmenIDEConfiguration.chatModel,
			localize('omenSettings.chatModel.label', "Chat model"),
			localize('omenSettings.chatModel.description', "Used for agent chat and fast-apply. Default: GLM-5.2."),
			OmenIDEDefaults.chatModel,
		);
		this.addTextSetting(group,
			OmenIDEConfiguration.embeddingModel,
			localize('omenSettings.embeddingModel.label', "Embedding model"),
			localize('omenSettings.embeddingModel.description', "Powers @codebase semantic search."),
			OmenIDEDefaults.embeddingModel,
		);
		this.addTextSetting(group,
			OmenIDEConfiguration.completionModel,
			localize('omenSettings.completionModel.label', "Tab completion model"),
			localize('omenSettings.completionModel.description', "FIM model for inline Tab suggestions."),
			OmenIDEDefaults.completionModel,
		);

		const pickerRow = this.createRow(group,
			localize('omenSettings.modelPicker.label', "Model picker"),
			localize('omenSettings.modelPicker.description', "Browse and switch chat models from the agent panel."),
		);
		const pickerControl = this.getRowControl(pickerRow);
		const pickerButton = this.editorDisposables.add(new Button(pickerControl, { ...defaultButtonStyles, title: localize('omenSettings.modelPicker.open', "Open Model Picker") }));
		pickerButton.label = localize('omenSettings.modelPicker.open', "Open Model Picker");
		this.editorDisposables.add(pickerButton.onDidClick(() => this.commandService.executeCommand('workbench.action.chat.openModelPicker')));
	}

	private renderPerformanceSection(parent: HTMLElement): void {
		DOM.append(parent, $('h1.omen-settings-section-title', undefined, localize('omenSettings.performance.title', "Performance")));

		const group = this.createGroup(parent);
		this.addCheckboxSetting(group,
			OmenIDEConfiguration.autocompleteEnabled,
			localize('omenSettings.autocomplete.label', "Tab autocomplete"),
			localize('omenSettings.autocomplete.description', "Enable Featherless FIM inline completions as you type."),
			OmenIDEDefaults.autocompleteEnabled,
		);
		this.addNumberSetting(group,
			OmenIDEConfiguration.concurrencyLimit,
			localize('omenSettings.concurrencyLimit.label', "Concurrency limit"),
			localize('omenSettings.concurrencyLimit.description', "Maximum concurrent Featherless request units. GLM-5.2 uses 4 units per request (feather_max plan = 8)."),
			OmenIDEDefaults.concurrencyLimit,
			1,
			64,
		);
		this.addNumberSetting(group,
			OmenIDEConfiguration.concurrencyMaxRetries,
			localize('omenSettings.concurrencyRetries.label', "Concurrency retries"),
			localize('omenSettings.concurrencyRetries.description', "How many times to wait and retry when Featherless reports a concurrency limit."),
			OmenIDEDefaults.concurrencyMaxRetries,
			1,
			50,
		);
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

	private async refreshApiKeyStatus(): Promise<void> {
		if (!this.apiKeyStatusElement) {
			return;
		}
		try {
			const hasKey = await this.commandService.executeCommand<boolean>(FEATHERLESS_EXTENSION_HAS_KEY_COMMAND);
			if (hasKey) {
				this.apiKeyStatusElement.textContent = localize('omenSettings.apiKey.configured', "Configured");
				this.apiKeyStatusElement.className = 'omen-settings-status configured';
			} else {
				this.apiKeyStatusElement.textContent = localize('omenSettings.apiKey.missing', "Not configured");
				this.apiKeyStatusElement.className = 'omen-settings-status missing';
			}
		} catch {
			this.apiKeyStatusElement.textContent = localize('omenSettings.apiKey.unknown', "Unknown");
			this.apiKeyStatusElement.className = 'omen-settings-status';
		}
	}

	override async setInput(input: OmenSettingsEditorInput, options: IEditorOptions | undefined, context: IEditorOpenContext, token: CancellationToken): Promise<void> {
		this.inOmenSettingsEditorContextKey.set(true);
		await super.setInput(input, options, context, token);
		this.renderContent();
	}

	override layout(dimension: DOM.Dimension): void {
		this.splitView?.layout(dimension.height);
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
