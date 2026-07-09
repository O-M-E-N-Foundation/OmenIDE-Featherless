/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { CancellationToken, PrepareLanguageModelChatModelOptions } from 'vscode';
import { IConfigurationService } from '../../../platform/configuration/common/configurationService';
import { ILogService } from '../../../platform/log/common/logService';
import { IFetcherService } from '../../../platform/networking/common/fetcherService';
import { IExperimentationService } from '../../../platform/telemetry/common/nullExperimentationService';
import { IInstantiationService } from '../../../util/vs/platform/instantiation/common/instantiation';
import { BYOKKnownModels, BYOKModelCapabilities } from '../common/byokProvider';
import { OmenIDEConfig, OmenIDEDefaults } from '../../omenide/common/omenideConfig';
import { AbstractOpenAICompatibleLMProvider, OpenAICompatibleLanguageModelChatInformation } from './abstractLanguageModelChatProvider';
import { IBYOKStorageService } from './byokStorageService';
import { byokKnownModelsToAPIInfoWithEffort } from './byokModelInfo';

export const GLM_5_2_MODEL_ID = OmenIDEDefaults.chatModel;

function buildFeatherlessKnownModels(chatModelId: string): BYOKKnownModels {
	return {
		[chatModelId]: {
			name: 'GLM-5.2',
			contextWindow: 256000,
			maxInputTokens: 224000,
			maxOutputTokens: 32000,
			toolCalling: true,
			vision: false,
			streaming: true,
			thinking: true,
			supportsReasoningEffort: ['low', 'medium', 'high'],
			editTools: ['apply-patch', 'find-replace', 'multi-find-replace'],
		},
	};
}

export class FeatherlessBYOKLMProvider extends AbstractOpenAICompatibleLMProvider {

	public static readonly providerName = 'Featherless';
	public static readonly providerId = 'featherless';

	constructor(
		knownModels: BYOKKnownModels,
		byokStorageService: IBYOKStorageService,
		@IFetcherService fetcherService: IFetcherService,
		@ILogService logService: ILogService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IConfigurationService configurationService: IConfigurationService,
		@IExperimentationService expService: IExperimentationService
	) {
		const chatModelId = configurationService.getNonExtensionConfig<string>(OmenIDEConfig.FeatherlessChatModel)
			?? OmenIDEDefaults.chatModel;
		super(
			FeatherlessBYOKLMProvider.providerId,
			FeatherlessBYOKLMProvider.providerName,
			{ ...buildFeatherlessKnownModels(chatModelId), ...knownModels },
			byokStorageService,
			fetcherService,
			logService,
			instantiationService,
			configurationService,
			expService
		);
	}

	protected getModelsBaseUrl(): string {
		return OmenIDEDefaults.featherlessBaseUrl;
	}

	/**
	 * Omen IDE keeps the Featherless key in secret storage as the source of
	 * truth (onboarding + `omenide.hasFeatherlessApiKey` read it, and the
	 * request path falls back to it), so unlike upstream this neither migrates
	 * the key into the provider group nor deletes it. Running the upstream
	 * migration here is harmful: the group already exists (created keyless at
	 * startup), so the migrate command conflicts and rejecting here would drop
	 * all Featherless models from the picker.
	 */
	protected override async configureDefaultGroupWithApiKeyOnly(): Promise<string | undefined> {
		return this._byokStorageService.getAPIKey(FeatherlessBYOKLMProvider.providerName);
	}

	/**
	 * The workbench resolves models twice for vendors with a configuration
	 * schema: once grouplessly (`configuration === undefined`) and once for the
	 * "Featherless" provider group created at activation. Because this provider
	 * falls back to the secret-storage key, both passes would return the full
	 * catalog under different identifiers, registering every model twice — the
	 * duplicates then flow through the agent-host BYOK bridge and spam
	 * "[LM] Model … is already registered. Skipping." warnings. Serve models
	 * exclusively through the group pass; the groupless probe returns nothing.
	 */
	override async provideLanguageModelChatInformation(options: PrepareLanguageModelChatModelOptions, token: CancellationToken): Promise<OpenAICompatibleLanguageModelChatInformation<import('./abstractLanguageModelChatProvider').LanguageModelChatConfiguration>[]> {
		if (!options.configuration) {
			return [];
		}
		return super.provideLanguageModelChatInformation(options, token);
	}

	protected override resolveModelCapabilities(modelData: unknown): BYOKModelCapabilities | undefined {
		const model = modelData as { id?: string };
		if (!model?.id) {
			return undefined;
		}

		const chatModelId = this._configurationService.getNonExtensionConfig<string>(OmenIDEConfig.FeatherlessChatModel)
			?? OmenIDEDefaults.chatModel;
		if (model.id.includes('GLM-5.2') || model.id.includes('glm-5.2') || model.id === chatModelId) {
			return buildFeatherlessKnownModels(chatModelId)[chatModelId];
		}

		return {
			name: model.id.split('/').pop() ?? model.id,
			contextWindow: 128000,
			maxInputTokens: 100000,
			maxOutputTokens: 8192,
			toolCalling: true,
			vision: false,
			streaming: true,
		};
	}

	protected override async getAllModels(silent: boolean, apiKey: string | undefined, configuration: import('./abstractLanguageModelChatProvider').LanguageModelChatConfiguration | undefined): Promise<OpenAICompatibleLanguageModelChatInformation<import('./abstractLanguageModelChatProvider').LanguageModelChatConfiguration>[]> {
		const chatModelId = this._configurationService.getNonExtensionConfig<string>(OmenIDEConfig.FeatherlessChatModel)
			?? OmenIDEDefaults.chatModel;
		// Startup model warmup:
		// For signed-out / before-key scenarios, the base provider may return an
		// empty model list for silent calls when `apiKey` is undefined. We still
		// want a non-Copilot (Featherless) model to be available in the picker so
		// Omen IDE doesn't show the "Sign in to use Copilot" gate.
		if (!apiKey) {
			const modelsUrl = this.getModelsBaseUrl();
			const known = buildFeatherlessKnownModels(chatModelId);
			const fallbackModels = byokKnownModelsToAPIInfoWithEffort(FeatherlessBYOKLMProvider.providerName, known);
			return fallbackModels.map(model => ({
				...model,
				url: modelsUrl,
				isDefault: model.id === chatModelId ? true : undefined,
			})) as OpenAICompatibleLanguageModelChatInformation<import('./abstractLanguageModelChatProvider').LanguageModelChatConfiguration>[];
		}

		const models = await super.getAllModels(silent, apiKey, configuration);
		return models.map(model => ({
			...model,
			isDefault: model.id === chatModelId ? true : undefined,
		}));
	}
}
