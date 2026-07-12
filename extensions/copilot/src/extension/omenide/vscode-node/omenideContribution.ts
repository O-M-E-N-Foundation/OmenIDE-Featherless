/*---------------------------------------------------------------------------------------------
 *  OmenIDE — registers the Featherless FIM inline completion provider and image analysis command.
 *
 *  Note: this intentionally does NOT configure the NES/xtab inline-edits
 *  provider. Its `github.copilot.chat.advanced.inlineEdits.xtabProvider.*`
 *  settings are unregistered team-internal keys (writes are rejected by the
 *  workbench and reads are gated to internal Copilot tokens), and the FIM
 *  provider below suppresses NES via `excludes` anyway.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { Disposable } from '../../../util/vs/base/common/lifecycle';
import { IInstantiationService } from '../../../util/vs/platform/instantiation/common/instantiation';
import { IBYOKStorageService } from '../../byok/vscode-node/byokStorageService';
import { FeatherlessBYOKLMProvider } from '../../byok/vscode-node/featherlessProvider';
import { IExtensionContribution } from '../../common/contributions';
import { IOmenImageAnalysisService } from '../common/imageAnalysisService';
import { FeatherlessFimCompletionProvider } from './featherlessFimCompletionProvider';

export class OmenIDEContribution extends Disposable implements IExtensionContribution {
	public readonly id = 'omenide-contribution';

	constructor(
		@IInstantiationService instantiationService: IInstantiationService,
		@IBYOKStorageService private readonly _byokStorage: IBYOKStorageService,
		@IOmenImageAnalysisService private readonly _imageAnalysis: IOmenImageAnalysisService,
	) {
		super();

		this._register(vscode.commands.registerCommand('omenide.analyzeChatImage', async (args?: {
			imageBase64?: string;
			mimeType?: string;
			userPrompt?: string;
			imageLabel?: string;
		}) => {
			if (!args?.imageBase64) {
				return undefined;
			}
			try {
				const imageData = Buffer.from(args.imageBase64, 'base64');
				return await this._imageAnalysis.analyzeImage({
					imageData,
					mimeType: args.mimeType,
					userPrompt: args.userPrompt,
					imageLabel: args.imageLabel,
				});
			} catch {
				return undefined;
			}
		}));

		void this._registerFimProvider(instantiationService);
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
			}
		}, 2000);
		this._register({ dispose: () => clearInterval(interval) });
	}
}
