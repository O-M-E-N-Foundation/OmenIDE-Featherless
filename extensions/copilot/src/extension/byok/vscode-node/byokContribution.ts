/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { commands, LanguageModelChatInformation, LanguageModelChatProvider, lm, window } from 'vscode';
import { IAuthenticationService } from '../../../platform/authentication/common/authentication';
import { IVSCodeExtensionContext } from '../../../platform/extContext/common/extensionContext';
import { ILogService } from '../../../platform/log/common/logService';
import { IFetcherService } from '../../../platform/networking/common/fetcherService';
import { Disposable, DisposableStore } from '../../../util/vs/base/common/lifecycle';
import { IInstantiationService } from '../../../util/vs/platform/instantiation/common/instantiation';
import { BYOKKnownModels, BYOKAuthType } from '../../byok/common/byokProvider';
import { IExtensionContribution } from '../../common/contributions';
import { AbstractLanguageModelChatProvider } from './abstractLanguageModelChatProvider';
import { AnthropicLMProvider } from './anthropicProvider';
import { AzureBYOKModelProvider } from './azureProvider';
import { BYOKStorageService, IBYOKStorageService } from './byokStorageService';
import { CustomEndpointBYOKModelProvider } from './customEndpointProvider';
import { CustomOAIBYOKModelProvider } from './customOAIProvider';
import { FeatherlessBYOKLMProvider } from './featherlessProvider';
import { OmenIDEDefaults } from '../../omenide/common/omenideConfig';
import { GeminiNativeBYOKLMProvider } from './geminiNativeProvider';
import { OllamaLMProvider } from './ollamaProvider';
import { OAIBYOKLMProvider } from './openAIProvider';
import { OpenRouterLMProvider } from './openRouterProvider';
import { XAIBYOKLMProvider } from './xAIProvider';

export class BYOKContrib extends Disposable implements IExtensionContribution {
	public readonly id: string = 'byok-contribution';
	private readonly _byokStorageService: IBYOKStorageService;
	private readonly _providers: Map<string, LanguageModelChatProvider<LanguageModelChatInformation>> = new Map();
	private readonly _providerRegistrations = this._register(new DisposableStore());
	private _providersRegistered = false;
	private _featherlessGroupEnsured = false;
	private _knownModelsRefreshed = false;
	private _knownModelsRefreshTargets: ReadonlyArray<readonly [string, AbstractLanguageModelChatProvider]> = [];

	constructor(
		@IFetcherService private readonly _fetcherService: IFetcherService,
		@ILogService private readonly _logService: ILogService,
		@IVSCodeExtensionContext extensionContext: IVSCodeExtensionContext,
		@IAuthenticationService private readonly _authService: IAuthenticationService,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
	) {
		super();
		this._byokStorageService = new BYOKStorageService(extensionContext);
		this._register(commands.registerCommand('omenide.configureFeatherlessApiKey', () => this._promptFeatherlessApiKeyIfNeeded(true)));
		this._register(commands.registerCommand('omenide.resetFeatherlessApiKey', () => this._resetFeatherlessApiKey()));
		this._register(commands.registerCommand('omenide.hasFeatherlessApiKey', () => this._hasFeatherlessApiKey()));
		this._register(commands.registerCommand('omenide.setFeatherlessApiKey', (apiKey?: string) => this._setFeatherlessApiKey(apiKey)));
		this._applyPolicy();
		this._register(this._authService.onDidAuthenticationChange(() => this._applyPolicy()));
	}

	private _buildProviders(): void {
		const instantiationService = this._instantiationService;

		const anthropic = instantiationService.createInstance(AnthropicLMProvider, undefined, this._byokStorageService);
		const gemini = instantiationService.createInstance(GeminiNativeBYOKLMProvider, undefined, this._byokStorageService);
		const xai = instantiationService.createInstance(XAIBYOKLMProvider, {}, this._byokStorageService);
		const openai = instantiationService.createInstance(OAIBYOKLMProvider, {}, this._byokStorageService);

		this._providers.set(OllamaLMProvider.providerId, instantiationService.createInstance(OllamaLMProvider, this._byokStorageService));
		this._providers.set(AnthropicLMProvider.providerId, anthropic);
		this._providers.set(GeminiNativeBYOKLMProvider.providerId, gemini);
		this._providers.set(XAIBYOKLMProvider.providerId, xai);
		this._providers.set(OAIBYOKLMProvider.providerId, openai);
		this._providers.set(OpenRouterLMProvider.providerId, instantiationService.createInstance(OpenRouterLMProvider, this._byokStorageService));
		this._providers.set(AzureBYOKModelProvider.providerId, instantiationService.createInstance(AzureBYOKModelProvider, this._byokStorageService));
		this._providers.set(CustomOAIBYOKModelProvider.providerId, instantiationService.createInstance(CustomOAIBYOKModelProvider, this._byokStorageService));
		this._providers.set(CustomEndpointBYOKModelProvider.providerId, instantiationService.createInstance(CustomEndpointBYOKModelProvider, this._byokStorageService));
		this._providers.set(FeatherlessBYOKLMProvider.providerId, instantiationService.createInstance(FeatherlessBYOKLMProvider, {}, this._byokStorageService));

		this._knownModelsRefreshTargets = [
			[AnthropicLMProvider.providerName, anthropic],
			[GeminiNativeBYOKLMProvider.providerName, gemini],
			[XAIBYOKLMProvider.providerName, xai],
			[OAIBYOKLMProvider.providerName, openai],
		];
	}

	private _applyPolicy(): void {
		// OmenIDE: always register BYOK providers (Featherless, etc.) without GitHub/Copilot auth.
		if (!this._providersRegistered) {
			if (this._providers.size === 0) {
				this._buildProviders();
			}
			for (const [providerId, provider] of this._providers) {
				this._providerRegistrations.add(lm.registerLanguageModelChatProvider(providerId, provider));
			}
			this._providersRegistered = true;
			this._logService.info(`BYOK: registered ${this._providers.size} provider(s): ${Array.from(this._providers.keys()).join(', ')}`);

			// Ensure a non-Copilot (Featherless) provider group exists even before
			// the user has entered an API key. The UI gating for the chat model
			// picker (hasByokModels) depends on provider groups existing, not just
			// providers being registered.
			// This must be best-effort and must NOT require a valid apiKey.
			void this._ensureFeatherlessProviderGroup();

			if (!this._knownModelsRefreshed) {
				this._knownModelsRefreshed = true;
				void this._refreshKnownModels().catch(err => {
					this._knownModelsRefreshed = false;
					this._logService.warn(`BYOK: failed to refresh known models, will retry on next allowed transition: ${err instanceof Error ? err.message : String(err)}`);
				});
			}
			// Featherless API key is collected in the first-run onboarding wizard; do not
			// show a separate deferred prompt that competes with that modal.
		}
	}

	private async _ensureFeatherlessProviderGroup(): Promise<void> {
		if (this._featherlessGroupEnsured) {
			return;
		}

		this._featherlessGroupEnsured = true;
		try {
			await commands.executeCommand('lm.addLanguageModelsProviderGroup', {
				name: FeatherlessBYOKLMProvider.providerName,
				vendor: FeatherlessBYOKLMProvider.providerId,
				// Minimal settings scaffold: group existence is what the model-picker
				// gate cares about. The actual API key is handled separately.
				settings: {
					[OmenIDEDefaults.chatModel]: {},
				},
			});
			this._logService.info('BYOK: ensured Featherless language-model provider group (keyless warm UI)');
		} catch (err) {
			// Expected when the group already exists (or if config isn't ready yet).
			this._logService.debug(`BYOK: featherless provider group ensure skipped: ${err instanceof Error ? err.message : String(err)}`);
		}
	}

	private async _hasFeatherlessApiKey(): Promise<boolean> {
		if (await this._seedApiKeyFromEnvironment()) {
			return true;
		}
		const apiKey = await this._byokStorageService.getAPIKey(FeatherlessBYOKLMProvider.providerName);
		return !!apiKey?.trim();
	}

	private async _setFeatherlessApiKey(apiKey?: string): Promise<void> {
		const key = apiKey?.trim();
		if (!key) {
			throw new Error('Featherless API key is required');
		}
		await this._storeFeatherlessApiKey(key);
	}

	private async _storeFeatherlessApiKey(key: string): Promise<void> {
		// Persisting the key is the operation that must succeed. If it fails, the
		// caller should surface an error.
		await this._byokStorageService.storeAPIKey(FeatherlessBYOKLMProvider.providerName, key, BYOKAuthType.GlobalApiKey);
		this._logService.info('BYOK: saved Featherless API key');

		// Registering/validating the provider group is a best-effort follow-up. It
		// performs a live model lookup that can throw if the provider isn't ready
		// yet or the network is briefly unavailable; that must not fail the save.
		try {
			await commands.executeCommand('lm.migrateLanguageModelsProviderGroup', {
				vendor: FeatherlessBYOKLMProvider.providerId,
				name: FeatherlessBYOKLMProvider.providerName,
				apiKey: key,
			});
		} catch (err) {
			this._logService.warn(`BYOK: Featherless provider group migration deferred: ${err instanceof Error ? err.message : String(err)}`);
		}
	}

	private async _resetFeatherlessApiKey(): Promise<void> {
		try {
			await this._byokStorageService.deleteAPIKey(FeatherlessBYOKLMProvider.providerName, BYOKAuthType.GlobalApiKey);
			this._logService.info('BYOK: cleared Featherless API key (first-run reset)');
		} catch (err) {
			this._logService.warn(`BYOK: failed to clear Featherless API key: ${err instanceof Error ? err.message : String(err)}`);
		}
	}

	private async _seedApiKeyFromEnvironment(): Promise<boolean> {
		const existing = await this._byokStorageService.getAPIKey(FeatherlessBYOKLMProvider.providerName);
		if (existing) {
			return true;
		}

		const envKey = process.env.FEATHERLESS_API_KEY ?? process.env.FETHERLESS_API_KEY;
		if (!envKey?.trim()) {
			return false;
		}

		await this._storeFeatherlessApiKey(envKey.trim());
		this._logService.info('BYOK: seeded Featherless API key from environment');
		return true;
	}

	private async _promptFeatherlessApiKeyIfNeeded(force = false): Promise<void> {
		if (await this._seedApiKeyFromEnvironment()) {
			return;
		}

		const apiKey = await this._byokStorageService.getAPIKey(FeatherlessBYOKLMProvider.providerName);
		if (apiKey) {
			return;
		}

		await window.showInformationMessage(
			'Welcome to Omen IDE! Enter your Featherless.ai API key to use GLM-5.2 for chat, agents, and codebase search.',
			{ modal: true },
		);

		const key = await window.showInputBox({
			title: 'Welcome to Omen IDE',
			prompt: 'Enter your Featherless.ai API key to chat with GLM-5.2',
			password: true,
			ignoreFocusOut: true,
			placeHolder: 'Featherless API key',
		});

		if (!key?.trim()) {
			if (force) {
				return;
			}
			const configure = await window.showWarningMessage(
				'Featherless API key is required for AI features.',
				'Enter API Key',
				'Later',
			);
			if (configure === 'Enter API Key') {
				await this._promptFeatherlessApiKeyIfNeeded(true);
			}
			return;
		}

		await this._storeFeatherlessApiKey(key.trim());
		window.showInformationMessage('Featherless API key saved. Select GLM-5.2 in the model picker to start chatting.');
	}

	private async _refreshKnownModels(): Promise<void> {
		const knownModels = await this._fetchKnownModelList(this._fetcherService);
		if (this._store.isDisposed) {
			return;
		}
		for (const [providerName, provider] of this._knownModelsRefreshTargets) {
			provider.updateKnownModels(knownModels[providerName]);
		}
	}

	private async _fetchKnownModelList(fetcherService: IFetcherService): Promise<Record<string, BYOKKnownModels>> {
		this._logService.info('BYOK: fetching known models list');
		const data = await (await fetcherService.fetch('https://main.vscode-cdn.net/extensions/copilotChat.json', { method: 'GET', callSite: 'byok-known-models' })).json();
		// Use this for testing with changes from a local file. Don't check in
		// const data = JSON.parse((await this._fileSystemService.readFile(URI.file('/Users/roblou/code/vscode-engineering/chat/copilotChat.json'))).toString());
		if (data.version !== 1) {
			this._logService.warn('BYOK: Copilot Chat known models list is not in the expected format. Defaulting to empty list.');
			return {};
		}
		this._logService.info('BYOK: Copilot Chat known models list fetched successfully.');
		return data.modelInfo;
	}
}
