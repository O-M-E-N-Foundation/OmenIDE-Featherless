/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { encodeBase64, VSBuffer } from '../../../../base/common/buffer.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import {
	ChatImageMimeType,
	ChatMessageRole,
	ILanguageModelsService,
} from '../common/languageModels.js';
import {
	buildOmenImageAnalysisPrompt,
	IOmenImageAnalysisRequest,
	IOmenImageAnalysisService,
} from '../common/omenImageAnalysis.js';
import { isOmenImageSidecarConfigured, OmenIDEConfiguration, OmenIDEDefaults } from './omenSettings/omenSettings.js';

export const OMEN_ANALYZE_CHAT_IMAGE_COMMAND = 'omenide.analyzeChatImage';

function toChatImageMimeType(mimeType: string): ChatImageMimeType | undefined {
	switch (mimeType.toLowerCase()) {
		case 'image/png': return ChatImageMimeType.PNG;
		case 'image/jpeg':
		case 'image/jpg': return ChatImageMimeType.JPEG;
		case 'image/gif': return ChatImageMimeType.GIF;
		case 'image/webp': return ChatImageMimeType.WEBP;
		case 'image/bmp': return ChatImageMimeType.BMP;
		default: return undefined;
	}
}

export class OmenImageAnalysisService implements IOmenImageAnalysisService {
	declare readonly _serviceBrand: undefined;

	constructor(
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@ILanguageModelsService private readonly _languageModelsService: ILanguageModelsService,
		@ICommandService private readonly _commandService: ICommandService,
		@ILogService private readonly _logService: ILogService,
	) { }

	isEnabled(): boolean {
		return isOmenImageSidecarConfigured(this._configurationService.getValue(OmenIDEConfiguration.visionModel));
	}

	async analyzeImage(request: IOmenImageAnalysisRequest, token: CancellationToken): Promise<string | undefined> {
		if (!this.isEnabled() || token.isCancellationRequested) {
			return undefined;
		}

		// Prefer the extension command (direct Featherless call) so the vision
		// model need not appear in the chat picker allowlist.
		const viaCommand = await this._analyzeViaExtensionCommand(request);
		if (viaCommand) {
			return viaCommand;
		}
		if (token.isCancellationRequested) {
			return undefined;
		}
		return this._analyzeViaLanguageModel(request, token);
	}

	private async _analyzeViaExtensionCommand(request: IOmenImageAnalysisRequest): Promise<string | undefined> {
		try {
			const result = await this._commandService.executeCommand<string | undefined>(OMEN_ANALYZE_CHAT_IMAGE_COMMAND, {
				imageBase64: encodeBase64(VSBuffer.wrap(request.imageData)),
				mimeType: request.mimeType,
				userPrompt: request.userPrompt,
				imageLabel: request.imageLabel,
			});
			const trimmed = typeof result === 'string' ? result.trim() : '';
			return trimmed || undefined;
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			this._logService.trace(`[OmenIDE] Vision sidecar command unavailable, falling back to LM API: ${message}`);
			return undefined;
		}
	}

	private async _analyzeViaLanguageModel(request: IOmenImageAnalysisRequest, token: CancellationToken): Promise<string | undefined> {
		const visionModelId = this._getVisionModelId();
		const mimeType = toChatImageMimeType(request.mimeType);
		if (!mimeType) {
			this._logService.warn(`[OmenIDE] Unsupported image mime type for vision sidecar: ${request.mimeType}`);
			return undefined;
		}

		const modelIdentifier = await this._resolveVisionModelIdentifier(visionModelId);
		if (!modelIdentifier) {
			this._logService.warn(`[OmenIDE] Vision sidecar model not found in LM registry: ${visionModelId}`);
			return undefined;
		}

		const analysisPrompt = buildOmenImageAnalysisPrompt(request.userPrompt, request.imageLabel);
		try {
			const response = await this._languageModelsService.sendChatRequest(
				modelIdentifier,
				undefined,
				[{
					role: ChatMessageRole.User,
					content: [
						{ type: 'text', value: analysisPrompt },
						{
							type: 'image_url',
							value: {
								mimeType,
								data: VSBuffer.wrap(request.imageData),
							},
						},
					],
				}],
				{},
				token,
			);

			let content = '';
			const streaming = (async () => {
				for await (const part of response.stream) {
					const parts = Array.isArray(part) ? part : [part];
					for (const p of parts) {
						if (p.type === 'text') {
							content += p.value;
						}
					}
				}
			})();
			await Promise.all([response.result, streaming]);

			const trimmed = content.trim();
			if (!trimmed) {
				this._logService.warn(`[OmenIDE] Vision sidecar returned empty description for ${visionModelId}`);
				return undefined;
			}
			return trimmed;
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			this._logService.warn(`[OmenIDE] Vision sidecar analysis failed (${visionModelId}): ${message}`);
			return undefined;
		}
	}

	private _getVisionModelId(): string {
		const configured = this._configurationService.getValue<string>(OmenIDEConfiguration.visionModel);
		return (typeof configured === 'string' && configured.trim() ? configured.trim() : OmenIDEDefaults.visionModel);
	}

	private async _resolveVisionModelIdentifier(visionModelId: string): Promise<string | undefined> {
		const selected = await this._languageModelsService.selectLanguageModels({ id: visionModelId });
		if (selected.length > 0) {
			return selected[0];
		}

		for (const identifier of this._languageModelsService.getLanguageModelIds()) {
			const metadata = this._languageModelsService.lookupLanguageModel(identifier);
			if (!metadata?.isBYOK || metadata.targetChatSessionType) {
				continue;
			}
			if (metadata.id === visionModelId || identifier.endsWith(`/${visionModelId}`) || identifier === visionModelId) {
				return identifier;
			}
		}
		return undefined;
	}
}
