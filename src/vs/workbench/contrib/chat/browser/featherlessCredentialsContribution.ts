/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { timeout } from '../../../../base/common/async.js';
import { IContextKey, IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { ISecretStorageService } from '../../../../platform/secrets/common/secrets.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';
import { ChatEntitlementContextKeys } from '../../../services/chat/common/chatEntitlementService.js';
import { usesFeatherlessOnlyProvider } from '../../../services/chat/common/featherless.js';
import {
	isFeatherlessCredentialSecretKey,
	readFeatherlessCredentialSecrets,
} from '../../../services/chat/common/featherlessSecrets.js';

/**
 * Binds `omenide.hasFeatherlessCredentials` from extension secret storage so AI
 * gating is correct before the Omen IDE chat extension activates.
 *
 * Credentials are application-scoped (not per-workspace). Reads may race secret
 * storage initialization on window/workspace switches, so empty results are only
 * trusted once storage is persisted.
 */
export class FeatherlessCredentialsContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.featherlessCredentials';

	private readonly _hasFeatherlessCredentials: IContextKey<boolean>;
	private _refreshGeneration = 0;

	constructor(
		@ISecretStorageService private readonly _secretStorageService: ISecretStorageService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IProductService productService: IProductService,
		@ILogService private readonly _logService: ILogService,
	) {
		super();

		this._hasFeatherlessCredentials = ChatEntitlementContextKeys.hasFeatherlessCredentials.bindTo(contextKeyService);

		if (!usesFeatherlessOnlyProvider(productService)) {
			this._hasFeatherlessCredentials.set(false);
			return;
		}

		void this._refreshWithRetries();
		this._register(this._secretStorageService.onDidChangeSecret(e => {
			if (isFeatherlessCredentialSecretKey(e)) {
				void this._refreshWithRetries();
			}
		}));
	}

	private async _refreshWithRetries(): Promise<void> {
		const generation = ++this._refreshGeneration;
		const delaysMs = [0, 250, 750, 1500, 3000];

		for (const delayMs of delaysMs) {
			if (this._store.isDisposed || generation !== this._refreshGeneration) {
				return;
			}
			if (delayMs > 0) {
				await timeout(delayMs);
			}
			if (this._store.isDisposed || generation !== this._refreshGeneration) {
				return;
			}

			const result = await this._readCredentials();
			if (this._store.isDisposed || generation !== this._refreshGeneration) {
				return;
			}
			if (result === 'yes') {
				this._hasFeatherlessCredentials.set(true);
				return;
			}
			if (result === 'no' && this._secretStorageService.type === 'persisted') {
				// Only clear the flag once we know we're reading real disk-backed secrets.
				this._hasFeatherlessCredentials.set(false);
				return;
			}
			// 'unknown' or empty read from non-persisted storage — keep retrying.
		}

		this._logService.warn('[featherless credentials] could not confirm credential state after retries; leaving context key unchanged');
	}

	private async _readCredentials(): Promise<'yes' | 'no' | 'unknown'> {
		try {
			const { apiKey, oauthToken } = await readFeatherlessCredentialSecrets(this._secretStorageService);
			if (!!apiKey || !!oauthToken) {
				return 'yes';
			}
			// Empty reads from in-memory/unknown storage are not trustworthy on
			// workspace switches — encryption may not be ready yet.
			if (this._secretStorageService.type !== 'persisted') {
				return 'unknown';
			}
			return 'no';
		} catch (err) {
			this._logService.warn(`[featherless credentials] secret read failed: ${err instanceof Error ? err.message : String(err)}`);
			return 'unknown';
		}
	}
}
