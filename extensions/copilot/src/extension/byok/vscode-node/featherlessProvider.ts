/*---------------------------------------------------------------------------------------------

 *  Copyright (c) Microsoft Corporation. All rights reserved.

 *  Licensed under the MIT License. See License.txt in the project root for license information.

 *--------------------------------------------------------------------------------------------*/

import { CancellationToken, PrepareLanguageModelChatModelOptions } from 'vscode';

import { IConfigurationService } from '../../../platform/configuration/common/configurationService';

import { ILogService } from '../../../platform/log/common/logService';

import { IFetcherService } from '../../../platform/networking/common/fetcherService';

import { IExperimentationService } from '../../../platform/telemetry/common/nullExperimentationService';

import { IStringDictionary } from '../../../util/vs/base/common/collections';

import { IInstantiationService } from '../../../util/vs/platform/instantiation/common/instantiation';

import { BYOKKnownModels, BYOKModelCapabilities } from '../common/byokProvider';

import {

	buildFeatherlessModelsDiscoveryUrl,

	mapFeatherlessModelToCapabilities,

	mergeFeatherlessModelsIntoKnownModels,

	parseFeatherlessModelsPage,

	selectDefaultFeatherlessModelId,

	type FeatherlessApiModel,

} from '../common/featherlessModelDiscovery';

import { ModelSupportedEndpoint } from '../../../platform/endpoint/common/endpointProvider';

import { OpenAIEndpoint } from '../node/openAIEndpoint';

import { OmenIDEConfig, OmenIDEDefaults } from '../../omenide/common/omenideConfig';

import { AbstractOpenAICompatibleLMProvider, OpenAICompatibleLanguageModelChatInformation } from './abstractLanguageModelChatProvider';

import { IBYOKStorageService } from './byokStorageService';

import { byokKnownModelsToAPIInfoWithEffort } from './byokModelInfo';

import type { FeatherlessAuthService } from '../../omenide/vscode-node/featherlessAuthService';



export const GLM_5_2_MODEL_ID = OmenIDEDefaults.chatModel;



const MODELS_PER_PAGE = 100;



let featherlessAuthService: FeatherlessAuthService | undefined;



export function setFeatherlessAuthService(service: FeatherlessAuthService | undefined): void {

	featherlessAuthService = service;

}

export function getFeatherlessAuthService(): FeatherlessAuthService | undefined {

	return featherlessAuthService;

}



function buildGlmFallbackCapabilities(chatModelId: string): BYOKModelCapabilities {

	return {

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

			{ [chatModelId]: buildGlmFallbackCapabilities(chatModelId), ...knownModels },

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



	protected override async configureDefaultGroupWithApiKeyOnly(): Promise<string | undefined> {

		const apiKey = await this._byokStorageService.getAPIKey(FeatherlessBYOKLMProvider.providerName);

		if (apiKey) {

			return apiKey;

		}

		return featherlessAuthService?.getBearerToken();

	}



	protected override async createOpenAIEndPoint(model: OpenAICompatibleLanguageModelChatInformation<import('./abstractLanguageModelChatProvider').LanguageModelChatConfiguration>): Promise<OpenAIEndpoint> {

		const modelInfo = this.getModelInfo(model.id, model.url);

		const url = modelInfo.supported_endpoints?.includes(ModelSupportedEndpoint.Responses) ?

			`${model.url}/responses` :

			`${model.url}/chat/completions`;

		const apiKey = await featherlessAuthService?.getBearerToken()

			?? model.configuration?.apiKey

			?? model.apiKey

			?? await this._byokStorageService.getAPIKey(this._name)

			?? '';

		return this._instantiationService.createInstance(OpenAIEndpoint, modelInfo, apiKey, url);

	}



	override async provideLanguageModelChatInformation(options: PrepareLanguageModelChatModelOptions, token: CancellationToken): Promise<OpenAICompatibleLanguageModelChatInformation<import('./abstractLanguageModelChatProvider').LanguageModelChatConfiguration>[]> {

		if (!options.configuration) {

			return [];

		}

		return super.provideLanguageModelChatInformation(options, token);

	}



	protected override resolveModelCapabilities(modelData: unknown): BYOKModelCapabilities | undefined {

		const chatModelId = this._configurationService.getNonExtensionConfig<string>(OmenIDEConfig.FeatherlessChatModel)

			?? OmenIDEDefaults.chatModel;

		const glmFallback = buildGlmFallbackCapabilities(chatModelId);

		return mapFeatherlessModelToCapabilities(modelData as FeatherlessApiModel, glmFallback);

	}



	protected override async getAllModels(silent: boolean, apiKey: string | undefined, configuration: import('./abstractLanguageModelChatProvider').LanguageModelChatConfiguration | undefined): Promise<OpenAICompatibleLanguageModelChatInformation<import('./abstractLanguageModelChatProvider').LanguageModelChatConfiguration>[]> {

		if (!apiKey) {

			return [];

		}



		const chatModelId = this._configurationService.getNonExtensionConfig<string>(OmenIDEConfig.FeatherlessChatModel)

			?? OmenIDEDefaults.chatModel;

		const modelsUrl = this.getModelsBaseUrl();

		const glmFallback = buildGlmFallbackCapabilities(chatModelId);



		let knownModels: BYOKKnownModels = { ...(this._knownModels ?? {}) };

		let page = 1;

		let hasMore = true;



		while (hasMore) {

			const discoveryUrl = buildFeatherlessModelsDiscoveryUrl(modelsUrl, page, MODELS_PER_PAGE);

			const headers: IStringDictionary<string> = {

				'Content-Type': 'application/json',

				'Authorization': `Bearer ${apiKey}`,

			};



			const response = await this._fetcherService.fetch(discoveryUrl, {

				method: 'GET',

				headers,

				callSite: 'featherless-models-discovery',

			});



			if (!response.ok) {

				const body = await response.text();

				throw new Error(`Featherless models request failed (${response.status}): ${body}`);

			}



			const data = await response.json();

			const pageResult = parseFeatherlessModelsPage(data, MODELS_PER_PAGE);

			knownModels = mergeFeatherlessModelsIntoKnownModels(knownModels, pageResult.models, glmFallback);

			this._knownModels = knownModels;

			hasMore = pageResult.hasMore;

			page++;

		}



		if (Object.keys(knownModels).length === 0) {

			if (silent) {

				return [];

			}

			throw new Error('Featherless returned no chat models for your plan.');

		}



		const enabledModels = this._configurationService.getNonExtensionConfig<string[]>(OmenIDEConfig.FeatherlessEnabledModels)
			?? OmenIDEDefaults.enabledModels;
		const disabledModels = this._configurationService.getNonExtensionConfig<string[]>(OmenIDEConfig.FeatherlessDisabledModels)
			?? OmenIDEDefaults.disabledModels;
		const enabledSet = Array.isArray(enabledModels) && enabledModels.length > 0
			? new Set(enabledModels)
			: undefined;
		const disabledSet = !enabledSet && Array.isArray(disabledModels) && disabledModels.length > 0
			? new Set(disabledModels)
			: undefined;
		const filteredModels: BYOKKnownModels = enabledSet
			? Object.fromEntries(Object.entries(knownModels).filter(([id]) => enabledSet.has(id)))
			: disabledSet
				? Object.fromEntries(Object.entries(knownModels).filter(([id]) => !disabledSet.has(id)))
				: knownModels;
		const modelsForPicker = Object.keys(filteredModels).length > 0 ? filteredModels : knownModels;



		const defaultModelId = selectDefaultFeatherlessModelId(Object.keys(modelsForPicker), chatModelId);

		return byokKnownModelsToAPIInfoWithEffort(FeatherlessBYOKLMProvider.providerName, modelsForPicker).map(model => ({

			...model,

			url: modelsUrl,

			isDefault: model.id === defaultModelId ? true : undefined,

		}));

	}

}


