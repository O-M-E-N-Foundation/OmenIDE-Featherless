/*---------------------------------------------------------------------------------------------
 *  OmenIDE — Featherless vision sidecar for describing chat image attachments.
 *--------------------------------------------------------------------------------------------*/

import type { CancellationToken } from 'vscode';
import { IConfigurationService } from '../../../platform/configuration/common/configurationService';
import { ILogService } from '../../../platform/log/common/logService';
import { IFetcherService } from '../../../platform/networking/common/fetcherService';
import { getMimeType } from '../../../util/common/imageUtils';
import { IBYOKStorageService } from '../../byok/vscode-node/byokStorageService';
import { FeatherlessBYOKLMProvider, getFeatherlessAuthService } from '../../byok/vscode-node/featherlessProvider';
import {
	buildOmenImageAnalysisPrompt,
	IOmenImageAnalysisRequest,
	IOmenImageAnalysisService,
} from '../common/imageAnalysisService';
import { OmenIDEConfig, OmenIDEDefaults } from '../common/omenideConfig';

function resolveMimeType(imageData: Uint8Array, mimeType: string | undefined): string {
	if (mimeType && mimeType.startsWith('image/')) {
		return mimeType;
	}
	const base64 = Buffer.from(imageData).toString('base64');
	return getMimeType(base64) ?? 'image/png';
}

export class FeatherlessImageAnalysisService implements IOmenImageAnalysisService {
	declare readonly _serviceBrand: undefined;

	constructor(
		@IBYOKStorageService private readonly _byokStorage: IBYOKStorageService,
		@IFetcherService private readonly _fetcher: IFetcherService,
		@IConfigurationService private readonly _config: IConfigurationService,
		@ILogService private readonly _log: ILogService,
	) { }

	isEnabled(): boolean {
		return this._getVisionModelId().length > 0;
	}

	async analyzeImage(request: IOmenImageAnalysisRequest, token?: CancellationToken): Promise<string | undefined> {
		if (!this.isEnabled() || token?.isCancellationRequested) {
			return undefined;
		}

		const apiKey = await getFeatherlessAuthService()?.getBearerToken()
			?? await this._byokStorage.getAPIKey(FeatherlessBYOKLMProvider.providerName);
		if (!apiKey) {
			this._log.warn('[OmenIDE] Vision sidecar skipped: Featherless API key not configured');
			return undefined;
		}

		const model = this._getVisionModelId();
		const mimeType = resolveMimeType(request.imageData, request.mimeType);
		const base64 = Buffer.from(request.imageData).toString('base64');
		const analysisPrompt = buildOmenImageAnalysisPrompt(request.userPrompt, request.imageLabel);

		try {
			const response = await this._fetcher.fetch(`${OmenIDEDefaults.featherlessBaseUrl}/chat/completions`, {
				method: 'POST',
				headers: {
					'Authorization': `Bearer ${apiKey}`,
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({
					model,
					messages: [{
						role: 'user',
						content: [
							{ type: 'text', text: analysisPrompt },
							{
								type: 'image_url',
								image_url: { url: `data:${mimeType};base64,${base64}` },
							},
						],
					}],
					max_tokens: 2048,
					temperature: 0.2,
				}),
				signal: token as AbortSignal | undefined,
				callSite: 'featherless-image-analysis',
			});

			if (!response.ok) {
				const text = await response.text().catch(() => '');
				this._log.warn(`[OmenIDE] Vision sidecar failed (${response.status}): ${text}`);
				return undefined;
			}

			const json = await response.json() as {
				choices?: { message?: { content?: string | { type?: string; text?: string }[] } }[];
			};
			const content = json.choices?.[0]?.message?.content;
			let text = '';
			if (typeof content === 'string') {
				text = content;
			} else if (Array.isArray(content)) {
				text = content.map(part => typeof part?.text === 'string' ? part.text : '').join('');
			}
			const trimmed = text.trim();
			return trimmed || undefined;
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			this._log.warn(`[OmenIDE] Vision sidecar request error: ${message}`);
			return undefined;
		}
	}

	private _getVisionModelId(): string {
		const configured = this._config.getNonExtensionConfig<string>(OmenIDEConfig.FeatherlessVisionModel);
		return (configured?.trim() || OmenIDEDefaults.visionModel).trim();
	}
}
