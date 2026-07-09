/*---------------------------------------------------------------------------------------------
 *  OmenIDE — client-side concurrency gate for Featherless.ai plan limits.
 *--------------------------------------------------------------------------------------------*/

import type { CancellationToken } from 'vscode';
import { ChatFetchResponseType, type ChatResponse } from '../../../platform/chat/common/commonTypes';
import { OmenIDEDefaults } from './omenideConfig';

interface IWaiter {
	readonly units: number;
	readonly resolve: () => void;
	readonly reject: (error: Error) => void;
	readonly token: CancellationToken;
	readonly onCancel: () => void;
}

export function isFeatherlessEndpoint(modelUrl: string): boolean {
	return modelUrl.includes('featherless.ai');
}

/**
 * Featherless bills concurrency in units per model. GLM-5.2 costs 4 units on feather_max (8 total).
 */
export function getFeatherlessConcurrencyCost(modelId: string): number {
	const normalized = modelId.toLowerCase();
	if (normalized.includes('glm-5.2') || normalized.includes('glm52') || normalized.includes('glm5.2')) {
		return 4;
	}
	return 1;
}

export function isFeatherlessConcurrencyLimitError(response: ChatResponse): boolean {
	return response.type === ChatFetchResponseType.RateLimited
		&& response.capiError?.code === 'concurrency_limit_exceeded';
}

export function parseFeatherlessRetryAfterSeconds(response: ChatResponse): number | undefined {
	const retryAfter = response.retryAfter;
	if (typeof retryAfter === 'number' && retryAfter > 0) {
		return retryAfter;
	}
	if (typeof retryAfter === 'string') {
		const parsed = Number.parseInt(retryAfter, 10);
		if (!Number.isNaN(parsed) && parsed > 0) {
			return parsed;
		}
	}
	return undefined;
}

class FeatherlessConcurrencyGate {
	private _activeUnits = 0;
	private readonly _queue: IWaiter[] = [];

	async acquire(units: number, limit: number, token: CancellationToken): Promise<void> {
		if (token.isCancellationRequested) {
			throw new Error('Cancelled');
		}

		if (this._activeUnits + units <= limit) {
			this._activeUnits += units;
			return;
		}

		await new Promise<void>((resolve, reject) => {
			const waiter: IWaiter = {
				units,
				resolve: () => resolve(),
				reject,
				token,
				onCancel: () => {
					const index = this._queue.indexOf(waiter);
					if (index >= 0) {
						this._queue.splice(index, 1);
						reject(new Error('Cancelled'));
					}
				},
			};
			this._queue.push(waiter);
			token.onCancellationRequested(waiter.onCancel);
		});
	}

	release(units: number, limit: number): void {
		this._activeUnits = Math.max(0, this._activeUnits - units);
		this._drain(limit);
	}

	private _drain(limit: number): void {
		while (this._queue.length > 0) {
			const next = this._queue[0];
			if (next.token.isCancellationRequested) {
				this._queue.shift();
				next.reject(new Error('Cancelled'));
				continue;
			}
			if (this._activeUnits + next.units > limit) {
				break;
			}
			this._queue.shift();
			this._activeUnits += next.units;
			next.resolve();
		}
	}
}

export const featherlessConcurrencyGate = new FeatherlessConcurrencyGate();

export function getFeatherlessConcurrencyLimit(limitOverride?: number): number {
	return limitOverride ?? OmenIDEDefaults.concurrencyLimit;
}
