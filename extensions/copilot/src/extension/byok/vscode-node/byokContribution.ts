/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { commands, LanguageModelChatInformation, LanguageModelChatProvider, lm, QuickPickItem, window } from 'vscode';
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
import { FeatherlessBYOKLMProvider, setFeatherlessAuthService } from './featherlessProvider';
import { resolveOmenOAuthBrokerBaseUrl } from '../../omenide/common/featherlessOAuth';
import { FeatherlessAuthService } from '../../omenide/vscode-node/featherlessAuthService';
import { GeminiNativeBYOKLMProvider } from './geminiNativeProvider';
import { OllamaLMProvider } from './ollamaProvider';
import { OAIBYOKLMProvider } from './openAIProvider';
import { OpenRouterLMProvider } from './openRouterProvider';
import { XAIBYOKLMProvider } from './xAIProvider';

export type FeatherlessBootstrapStatus = 'no-credentials' | 'ready' | 'error';

export interface FeatherlessBootstrapResult {
	readonly status: FeatherlessBootstrapStatus;
	readonly error?: string;
}

const FEATHERLESS_CREDENTIALS_CONTEXT_KEY = 'omenide.hasFeatherlessCredentials';

export class BYOKContrib extends Disposable implements IExtensionContribution {
	public readonly id: string = 'byok-contribution';
	private readonly _byokStorageService: IBYOKStorageService;
	private readonly _featherlessAuthService: FeatherlessAuthService;
	private readonly _providers: Map<string, LanguageModelChatProvider<LanguageModelChatInformation>> = new Map();
	private readonly _providerRegistrations = this._register(new DisposableStore());
	private _providersRegistered = false;
	private _knownModelsRefreshed = false;
	private _knownModelsRefreshTargets: ReadonlyArray<readonly [string, AbstractLanguageModelChatProvider]> = [];
	private _bootstrapInFlight: Promise<FeatherlessBootstrapResult> | undefined;

	constructor(
		@IFetcherService private readonly _fetcherService: IFetcherService,
		@ILogService private readonly _logService: ILogService,
		@IVSCodeExtensionContext extensionContext: IVSCodeExtensionContext,
		@IAuthenticationService private readonly _authService: IAuthenticationService,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
	) {
		super();
		this._byokStorageService = new BYOKStorageService(extensionContext);
		this._featherlessAuthService = new FeatherlessAuthService(extensionContext, this._byokStorageService, this._fetcherService, this._logService);
		setFeatherlessAuthService(this._featherlessAuthService);
		this._register(commands.registerCommand('omenide.configureFeatherlessApiKey', () => this._configureFeatherlessCredentials(true)));
		this._register(commands.registerCommand('omenide.signInFeatherless', () => this._signInFeatherlessOAuth()));
		this._register(commands.registerCommand('omenide.resetFeatherlessApiKey', () => this._resetFeatherlessCredentials()));
		this._register(commands.registerCommand('omenide.signOutFeatherless', () => this._signOutFeatherless()));
		this._register(commands.registerCommand('omenide.hasFeatherlessApiKey', () => this._hasFeatherlessCredentials()));
		this._register(commands.registerCommand('omenide.setFeatherlessApiKey', (apiKey?: string) => this._setFeatherlessApiKey(apiKey)));
		this._register(commands.registerCommand('omenide.bootstrapFeatherlessModels', () => this._bootstrapFeatherlessModels()));
		this._register(commands.registerCommand('omenide.getFeatherlessAccountSummary', () => this._featherlessAuthService.getAccountSummary()));
		this._register(commands.registerCommand('omenide.listFeatherlessModels', (query?: unknown) => this._featherlessAuthService.listModelsForSettings((query && typeof query === 'object') ? query as Parameters<typeof this._featherlessAuthService.listModelsForSettings>[0] : {})));
		this._applyPolicy();
		this._register(this._authService.onDidAuthenticationChange(() => this._applyPolicy()));
		void this._updateFeatherlessCredentialsContext();
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
		if (!this._providersRegistered) {
			if (this._providers.size === 0) {
				this._buildProviders();
			}
			for (const [providerId, provider] of this._providers) {
				this._providerRegistrations.add(lm.registerLanguageModelChatProvider(providerId, provider));
			}
			this._providersRegistered = true;
			this._logService.info(`BYOK: registered ${this._providers.size} provider(s): ${Array.from(this._providers.keys()).join(', ')}`);

			if (!this._knownModelsRefreshed) {
				this._knownModelsRefreshed = true;
				void this._refreshKnownModels().catch(err => {
					this._knownModelsRefreshed = false;
					this._logService.warn(`BYOK: failed to refresh known models, will retry on next allowed transition: ${err instanceof Error ? err.message : String(err)}`);
				});
			}

			void this._bootstrapFeatherlessModels();
		}
	}

	private async _updateFeatherlessCredentialsContext(): Promise<void> {
		const hasCredentials = await this._featherlessAuthService.hasCredentials();
		await commands.executeCommand('setContext', FEATHERLESS_CREDENTIALS_CONTEXT_KEY, hasCredentials);
	}

	private async _bootstrapFeatherlessModels(): Promise<FeatherlessBootstrapResult> {
		if (this._bootstrapInFlight) {
			return this._bootstrapInFlight;
		}

		this._bootstrapInFlight = this._doBootstrapFeatherlessModels();
		try {
			return await this._bootstrapInFlight;
		} finally {
			this._bootstrapInFlight = undefined;
		}
	}

	private async _doBootstrapFeatherlessModels(): Promise<FeatherlessBootstrapResult> {
		await this._seedApiKeyFromEnvironment();
		await this._updateFeatherlessCredentialsContext();

		const token = await this._featherlessAuthService.getBearerToken();
		if (!token) {
			this._logService.trace('BYOK: Featherless bootstrap skipped — no credentials');
			return { status: 'no-credentials' };
		}

		try {
			await commands.executeCommand('lm.migrateLanguageModelsProviderGroup', {
				vendor: FeatherlessBYOKLMProvider.providerId,
				name: FeatherlessBYOKLMProvider.providerName,
				apiKey: token,
			});
			this._logService.info('BYOK: Featherless models bootstrapped from API');
			return { status: 'ready' };
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			this._logService.warn(`BYOK: Featherless bootstrap failed: ${message}`);
			return { status: 'error', error: message };
		}
	}

	private async _hasFeatherlessCredentials(): Promise<boolean> {
		if (await this._seedApiKeyFromEnvironment()) {
			return true;
		}
		return this._featherlessAuthService.hasCredentials();
	}

	private async _setFeatherlessApiKey(apiKey?: string): Promise<void> {
		const key = apiKey?.trim();
		if (!key) {
			throw new Error('Featherless API key is required');
		}
		await this._storeFeatherlessApiKey(key);
	}

	private async _storeFeatherlessApiKey(key: string): Promise<void> {
		await this._featherlessAuthService.markApiKeyAuth();
		await this._byokStorageService.storeAPIKey(FeatherlessBYOKLMProvider.providerName, key, BYOKAuthType.GlobalApiKey);
		this._logService.info('BYOK: saved Featherless API key');
		await this._updateFeatherlessCredentialsContext();
		const result = await this._bootstrapFeatherlessModels();
		if (result.status === 'error') {
			this._logService.warn(`BYOK: Featherless model discovery after key save failed: ${result.error}`);
		}
	}

	private async _resetFeatherlessCredentials(): Promise<void> {
		try {
			await this._byokStorageService.deleteAPIKey(FeatherlessBYOKLMProvider.providerName, BYOKAuthType.GlobalApiKey);
			await this._featherlessAuthService.clearAllCredentials();
			await this._updateFeatherlessCredentialsContext();
			try {
				await commands.executeCommand('lm.migrateLanguageModelsProviderGroup', {
					vendor: FeatherlessBYOKLMProvider.providerId,
					name: FeatherlessBYOKLMProvider.providerName,
					apiKey: '',
				});
			} catch {
				// Group may not exist yet; clearing credentials is sufficient.
			}
			this._logService.info('BYOK: cleared Featherless credentials');
		} catch (err) {
			this._logService.warn(`BYOK: failed to clear Featherless credentials: ${err instanceof Error ? err.message : String(err)}`);
		}
	}

	private async _signOutFeatherless(): Promise<void> {
		await this._resetFeatherlessCredentials();
		window.showInformationMessage('Signed out of Featherless.');
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

		await this._featherlessAuthService.markApiKeyAuth();
		await this._byokStorageService.storeAPIKey(FeatherlessBYOKLMProvider.providerName, envKey.trim(), BYOKAuthType.GlobalApiKey);
		await this._updateFeatherlessCredentialsContext();
		this._logService.info('BYOK: seeded Featherless API key from environment');
		return true;
	}

	private async _signInFeatherlessOAuth(): Promise<void> {
		try {
			await this._featherlessAuthService.signInWithOAuth();
			await this._updateFeatherlessCredentialsContext();
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			this._logService.warn(`BYOK: Featherless OAuth sign-in failed: ${message}`);
			const brokerBase = resolveOmenOAuthBrokerBaseUrl();
			const hint = message.includes('broker') || message.includes('timed out') || message.includes('not configured') || message.includes('session')
				? message
				: `${message}\n\nOAuth is brokered by ${brokerBase}. For local backend set OMEN_OAUTH_BROKER_BASE_URL=http://localhost:3001.`;
			window.showErrorMessage(hint);
			// Re-throw so onboarding (and other callers) can detect failure and avoid advancing.
			throw err instanceof Error ? err : new Error(message);
		}

		// Token storage succeeded — model discovery is best-effort and must not undo sign-in.
		const result = await this._bootstrapFeatherlessModels();
		if (result.status === 'error') {
			this._logService.warn(`BYOK: Featherless model discovery after OAuth failed: ${result.error}`);
			window.showWarningMessage(`Signed in to Featherless, but model discovery failed: ${result.error ?? 'unknown error'}. Try reloading the window.`);
			return;
		}
		window.showInformationMessage('Signed in to Featherless. Your models are ready in the picker.');
	}

	private async _configureFeatherlessCredentials(force = false): Promise<void> {
		if (!force) {
			if (await this._seedApiKeyFromEnvironment()) {
				await this._bootstrapFeatherlessModels();
				return;
			}
			if (await this._featherlessAuthService.hasCredentials()) {
				return;
			}
		}

		type FeatherlessAuthPick = QuickPickItem & { id: 'oauth' | 'apikey' | 'signout' };
		const hasCredentials = await this._featherlessAuthService.hasCredentials();
		const items: FeatherlessAuthPick[] = [
			{
				id: 'oauth',
				label: 'Sign in with Featherless',
				description: 'Open your browser to authorize Omen IDE',
			},
			{
				id: 'apikey',
				label: 'Enter API Key',
				description: 'Paste a key from featherless.ai/account/api-keys',
			},
		];
		if (hasCredentials) {
			items.push({
				id: 'signout',
				label: 'Sign out / Clear credentials',
				description: 'Remove stored API key and OAuth tokens',
			});
		}

		const choice = await window.showQuickPick(items, {
			title: 'Connect Featherless.ai',
			placeHolder: 'Sign in with OAuth or enter an API key',
			ignoreFocusOut: true,
		});
		if (!choice) {
			return;
		}

		switch (choice.id) {
			case 'oauth':
				await this._signInFeatherlessOAuth();
				break;
			case 'apikey':
				await this._promptFeatherlessApiKey();
				break;
			case 'signout':
				await this._resetFeatherlessCredentials();
				window.showInformationMessage('Featherless credentials cleared.');
				break;
		}
	}

	private async _promptFeatherlessApiKey(): Promise<void> {
		const key = await window.showInputBox({
			title: 'Featherless API Key',
			prompt: 'Enter your Featherless.ai API key',
			password: true,
			ignoreFocusOut: true,
			placeHolder: 'Featherless API key',
		});

		if (!key?.trim()) {
			return;
		}

		await this._storeFeatherlessApiKey(key.trim());
		window.showInformationMessage('Featherless connected. Your models are ready in the picker.');
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
		if (data.version !== 1) {
			this._logService.warn('BYOK: Copilot Chat known models list is not in the expected format. Defaulting to empty list.');
			return {};
		}
		this._logService.info('BYOK: Copilot Chat known models list fetched successfully.');
		return data.modelInfo;
	}
}
