/*---------------------------------------------------------------------------------------------
 *  OmenIDE — delegates embeddings to Featherless when a key exists, else Copilot remote.
 *--------------------------------------------------------------------------------------------*/

import type { CancellationToken } from 'vscode';
import { TelemetryCorrelationId } from '../../../util/common/telemetryCorrelationId';
import { ComputeEmbeddingsOptions, EmbeddingType, Embeddings, IEmbeddingsComputer } from '../../../platform/embeddings/common/embeddingsComputer';
import { RemoteEmbeddingsComputer } from '../../../platform/embeddings/common/remoteEmbeddingsComputer';
import { IInstantiationService } from '../../../util/vs/platform/instantiation/common/instantiation';
import { IBYOKStorageService } from '../../byok/vscode-node/byokStorageService';
import { FeatherlessBYOKLMProvider } from '../../byok/vscode-node/featherlessProvider';
import { FeatherlessEmbeddingType, FeatherlessEmbeddingsComputer } from './featherlessEmbeddingsComputer';

export class OmenIDEEmbeddingsComputer implements IEmbeddingsComputer {
	declare readonly _serviceBrand: undefined;

	private readonly _remote: RemoteEmbeddingsComputer;
	private readonly _featherless: FeatherlessEmbeddingsComputer;

	constructor(
		@IBYOKStorageService private readonly _byokStorage: IBYOKStorageService,
		@IInstantiationService instantiationService: IInstantiationService,
	) {
		this._remote = instantiationService.createInstance(RemoteEmbeddingsComputer);
		this._featherless = instantiationService.createInstance(FeatherlessEmbeddingsComputer);
	}

	public async computeEmbeddings(
		type: EmbeddingType,
		inputs: readonly string[],
		options?: ComputeEmbeddingsOptions,
		telemetryInfo?: TelemetryCorrelationId,
		cancellationToken?: CancellationToken,
	): Promise<Embeddings> {
		const apiKey = await this._byokStorage.getAPIKey(FeatherlessBYOKLMProvider.providerName);
		if (apiKey) {
			const featherlessType = type.id === FeatherlessEmbeddingType.id ? type : FeatherlessEmbeddingType;
			return this._featherless.computeEmbeddings(featherlessType, inputs, options, telemetryInfo, cancellationToken);
		}
		return this._remote.computeEmbeddings(type, inputs, options, telemetryInfo, cancellationToken);
	}
}
