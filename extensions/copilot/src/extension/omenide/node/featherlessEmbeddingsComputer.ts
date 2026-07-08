/*---------------------------------------------------------------------------------------------
 *  OmenIDE — Featherless.ai OpenAI-compatible embeddings backend.
 *--------------------------------------------------------------------------------------------*/

import type { CancellationToken } from 'vscode';
import { TelemetryCorrelationId } from '../../../util/common/telemetryCorrelationId';
import { IConfigurationService } from '../../../platform/configuration/common/configurationService';
import { ILogService } from '../../../platform/log/common/logService';
import { IFetcherService } from '../../../platform/networking/common/fetcherService';
import { ComputeEmbeddingsOptions, Embedding, EmbeddingType, Embeddings, IEmbeddingsComputer } from '../../../platform/embeddings/common/embeddingsComputer';
import { IBYOKStorageService } from '../../byok/vscode-node/byokStorageService';
import { FeatherlessBYOKLMProvider } from '../../byok/vscode-node/featherlessProvider';
import { OmenIDEConfig, OmenIDEDefaults, OmenIDEEmbeddingTypeId } from '../common/omenideConfig';

export const FeatherlessEmbeddingType = new EmbeddingType(OmenIDEEmbeddingTypeId);

export class FeatherlessEmbeddingsComputer implements IEmbeddingsComputer {
	declare readonly _serviceBrand: undefined;

	private readonly _batchSize = 64;

	constructor(
		@IBYOKStorageService private readonly _byokStorage: IBYOKStorageService,
		@IFetcherService private readonly _fetcher: IFetcherService,
		@IConfigurationService private readonly _config: IConfigurationService,
		@ILogService private readonly _log: ILogService,
	) { }

	public async computeEmbeddings(
		embeddingType: EmbeddingType,
		inputs: readonly string[],
		_options?: ComputeEmbeddingsOptions,
		_telemetryInfo?: TelemetryCorrelationId,
		cancellationToken?: CancellationToken,
	): Promise<Embeddings> {
		if (embeddingType.id !== FeatherlessEmbeddingType.id || !inputs.length) {
			return { type: embeddingType, values: [] };
		}

		const apiKey = await this._byokStorage.getAPIKey(FeatherlessBYOKLMProvider.providerName);
		if (!apiKey) {
			return { type: embeddingType, values: [] };
		}

		const model = this._config.getNonExtensionConfig<string>(OmenIDEConfig.FeatherlessEmbeddingModel)
			?? OmenIDEDefaults.embeddingModel;

		const values: Embedding[] = [];
		for (let i = 0; i < inputs.length; i += this._batchSize) {
			if (cancellationToken?.isCancellationRequested) {
				break;
			}
			const batch = inputs.slice(i, i + this._batchSize);
			const response = await this._fetcher.fetch(`${OmenIDEDefaults.featherlessBaseUrl}/embeddings`, {
				method: 'POST',
				headers: {
					'Authorization': `Bearer ${apiKey}`,
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({ model, input: batch }),
				signal: cancellationToken as AbortSignal | undefined,
				callSite: 'featherless-embeddings',
			});

			if (!response.ok) {
				const text = await response.text().catch(() => '');
				this._log.warn(`[OmenIDE] Featherless embeddings failed (${response.status}): ${text}`);
				return { type: embeddingType, values: [] };
			}

			const json = await response.json() as { data?: { embedding: number[] }[] };
			for (const item of json.data ?? []) {
				if (Array.isArray(item.embedding) && item.embedding.length > 0) {
					values.push({ type: embeddingType, value: item.embedding });
				}
			}
		}

		return { type: embeddingType, values };
	}
}
