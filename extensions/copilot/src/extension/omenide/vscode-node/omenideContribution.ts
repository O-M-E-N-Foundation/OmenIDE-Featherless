/*---------------------------------------------------------------------------------------------
 *  OmenIDE — registers Featherless FIM completions and default NES provider settings.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ConfigKey, IConfigurationService } from '../../../platform/configuration/common/configurationService';
import { Disposable } from '../../../util/vs/base/common/lifecycle';
import { IInstantiationService } from '../../../util/vs/platform/instantiation/common/instantiation';
import { IBYOKStorageService } from '../../byok/vscode-node/byokStorageService';
import { FeatherlessBYOKLMProvider } from '../../byok/vscode-node/featherlessProvider';
import { IExtensionContribution } from '../../common/contributions';
import { OmenIDEConfig, OmenIDEDefaults } from '../common/omenideConfig';
import { FeatherlessFimCompletionProvider } from './featherlessFimCompletionProvider';

export class OmenIDEContribution extends Disposable implements IExtensionContribution {
	public readonly id = 'omenide-contribution';

	constructor(
		@IInstantiationService instantiationService: IInstantiationService,
		@IConfigurationService private readonly _config: IConfigurationService,
		@IBYOKStorageService private readonly _byokStorage: IBYOKStorageService,
	) {
		super();

		void this._configureDefaults();
		void this._registerFimProvider(instantiationService);
	}

	private async _configureDefaults(): Promise<void> {
		const apiKey = await this._byokStorage.getAPIKey(FeatherlessBYOKLMProvider.providerName);
		if (!apiKey) {
			return;
		}

		const config = vscode.workspace.getConfiguration();
		const xtabUrl = config.get<string>(ConfigKey.TeamInternal.InlineEditsXtabProviderUrl.fullyQualifiedId);
		if (!xtabUrl) {
			await config.update(
				ConfigKey.TeamInternal.InlineEditsXtabProviderUrl.fullyQualifiedId,
				`${OmenIDEDefaults.featherlessBaseUrl}/chat/completions`,
				vscode.ConfigurationTarget.Global,
			);
		}

		const xtabKey = config.get<string>(ConfigKey.TeamInternal.InlineEditsXtabProviderApiKey.fullyQualifiedId);
		if (!xtabKey) {
			await config.update(
				ConfigKey.TeamInternal.InlineEditsXtabProviderApiKey.fullyQualifiedId,
				apiKey,
				vscode.ConfigurationTarget.Global,
			);
		}

		const chatModel = this._config.getNonExtensionConfig<string>(OmenIDEConfig.FeatherlessChatModel)
			?? OmenIDEDefaults.chatModel;
		const xtabModel = config.get<string>(ConfigKey.TeamInternal.InlineEditsXtabProviderModelConfiguration.fullyQualifiedId);
		if (!xtabModel) {
			await config.update(
				ConfigKey.TeamInternal.InlineEditsXtabProviderModelConfiguration.fullyQualifiedId,
				chatModel,
				vscode.ConfigurationTarget.Global,
			);
		}
	}

	private async _registerFimProvider(instantiationService: IInstantiationService): Promise<void> {
		const register = () => {
			this._register(vscode.languages.registerInlineCompletionItemProvider(
				{ pattern: '**' },
				instantiationService.createInstance(FeatherlessFimCompletionProvider),
				{
					debounceDelayMs: 75,
					groupId: 'omenide-fim',
					excludes: ['nes', 'completions', 'github.copilot'],
				},
			));
		};

		const apiKey = await this._byokStorage.getAPIKey(FeatherlessBYOKLMProvider.providerName);
		if (apiKey) {
			register();
			return;
		}

		const interval = setInterval(async () => {
			const key = await this._byokStorage.getAPIKey(FeatherlessBYOKLMProvider.providerName);
			if (key) {
				clearInterval(interval);
				register();
				void this._configureDefaults();
			}
		}, 2000);
		this._register({ dispose: () => clearInterval(interval) });
	}
}
