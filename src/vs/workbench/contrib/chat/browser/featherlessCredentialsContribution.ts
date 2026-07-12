/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { IContextKey, IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { ISecretStorageService } from '../../../../platform/secrets/common/secrets.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';
import { ChatEntitlementContextKeys } from '../../../services/chat/common/chatEntitlementService.js';
import { usesFeatherlessOnlyProvider } from '../../../services/chat/common/featherless.js';
import {
	getFeatherlessApiKeySecretStorageKey,
	getFeatherlessOAuthSecretStorageKey,
} from '../../../services/chat/common/featherlessSecrets.js';

/**
 * Binds `omenide.hasFeatherlessCredentials` from extension secret storage so AI
 * gating is correct before the Omen IDE chat extension activates.
 */
export class FeatherlessCredentialsContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.featherlessCredentials';

	private readonly _hasFeatherlessCredentials: IContextKey<boolean>;

	constructor(
		@ISecretStorageService private readonly _secretStorageService: ISecretStorageService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IProductService productService: IProductService,
	) {
		super();

		this._hasFeatherlessCredentials = ChatEntitlementContextKeys.hasFeatherlessCredentials.bindTo(contextKeyService);

		if (!usesFeatherlessOnlyProvider(productService)) {
			this._hasFeatherlessCredentials.set(false);
			return;
		}

		void this._refresh();
		this._register(this._secretStorageService.onDidChangeSecret(e => {
			if (e === getFeatherlessApiKeySecretStorageKey() || e === getFeatherlessOAuthSecretStorageKey()) {
				void this._refresh();
			}
		}));
	}

	private async _refresh(): Promise<void> {
		if (this._store.isDisposed) {
			return;
		}
		const [apiKey, oauthToken] = await Promise.all([
			this._secretStorageService.get(getFeatherlessApiKeySecretStorageKey()),
			this._secretStorageService.get(getFeatherlessOAuthSecretStorageKey()),
		]);
		this._hasFeatherlessCredentials.set(!!apiKey?.trim() || !!oauthToken?.trim());
	}
}
