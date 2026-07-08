/*---------------------------------------------------------------------------------------------
 *  OmenIDE — Featherless FIM inline completion provider (/v1/completions).
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { IConfigurationService } from '../../../platform/configuration/common/configurationService';
import { IFetcherService } from '../../../platform/networking/common/fetcherService';
import { IBYOKStorageService } from '../../byok/vscode-node/byokStorageService';
import { FeatherlessBYOKLMProvider } from '../../byok/vscode-node/featherlessProvider';
import { OmenIDEConfig, OmenIDEDefaults } from '../common/omenideConfig';

export class FeatherlessFimCompletionProvider implements vscode.InlineCompletionItemProvider {
	constructor(
		@IBYOKStorageService private readonly _byokStorage: IBYOKStorageService,
		@IFetcherService private readonly _fetcher: IFetcherService,
		@IConfigurationService private readonly _config: IConfigurationService,
	) { }

	async provideInlineCompletionItems(
		document: vscode.TextDocument,
		position: vscode.Position,
		_context: vscode.InlineCompletionContext,
		token: vscode.CancellationToken,
	): Promise<vscode.InlineCompletionItem[] | vscode.InlineCompletionList | undefined> {
		const enabled = this._config.getNonExtensionConfig<boolean>(OmenIDEConfig.AutocompleteEnabled);
		if (enabled === false) {
			return undefined;
		}

		const apiKey = await this._byokStorage.getAPIKey(FeatherlessBYOKLMProvider.providerName);
		if (!apiKey) {
			return undefined;
		}

		const model = this._config.getNonExtensionConfig<string>(OmenIDEConfig.FeatherlessCompletionModel)
			?? OmenIDEDefaults.completionModel;

		const prefixRange = new vscode.Range(new vscode.Position(0, 0), position);
		const suffixRange = new vscode.Range(position, document.lineAt(document.lineCount - 1).range.end);
		const prefix = document.getText(prefixRange);
		const suffix = document.getText(suffixRange);
		const fileName = document.fileName.split(/[/\\]/).pop() ?? 'file';

		const prompt = `<|file_name|>${fileName}<|fim_prefix|>${prefix}<|fim_suffix|>${suffix}<|fim_middle|>`;

		try {
			const response = await this._fetcher.fetch(`${OmenIDEDefaults.featherlessBaseUrl}/completions`, {
				method: 'POST',
				headers: {
					'Authorization': `Bearer ${apiKey}`,
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({
					model,
					prompt,
					max_tokens: 128,
					temperature: 0.1,
					stop: ['<|fim_suffix|>', '<|file_name|>', '\n\n'],
				}),
				signal: token as unknown as AbortSignal,
				callSite: 'featherless-fim',
			});

			if (!response.ok || token.isCancellationRequested) {
				return undefined;
			}

			const json = await response.json() as { choices?: { text?: string }[] };
			const text = json.choices?.[0]?.text;
			if (!text) {
				return undefined;
			}

			return [new vscode.InlineCompletionItem(text, new vscode.Range(position, position))];
		} catch {
			return undefined;
		}
	}
}
