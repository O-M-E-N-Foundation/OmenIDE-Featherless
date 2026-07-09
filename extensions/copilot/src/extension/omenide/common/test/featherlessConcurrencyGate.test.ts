/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { getFeatherlessConcurrencyCost, isFeatherlessConcurrencyLimitError } from '../featherlessConcurrencyGate';
import { ChatFetchResponseType } from '../../../../platform/chat/common/commonTypes';

suite('Featherless concurrency', () => {
	test('getFeatherlessConcurrencyCost', () => {
		assert.strictEqual(getFeatherlessConcurrencyCost('zai-org/GLM-5.2'), 4);
		assert.strictEqual(getFeatherlessConcurrencyCost('Qwen/Qwen3-Embedding-8B'), 1);
	});

	test('isFeatherlessConcurrencyLimitError', () => {
		assert.strictEqual(isFeatherlessConcurrencyLimitError({
			type: ChatFetchResponseType.RateLimited,
			reason: 'Concurrency limit exceeded',
			requestId: '1',
			serverRequestId: undefined,
			retryAfter: 5,
			rateLimitKey: '',
			isAuto: false,
			capiError: { code: 'concurrency_limit_exceeded', message: 'over limit' },
		}), true);

		assert.strictEqual(isFeatherlessConcurrencyLimitError({
			type: ChatFetchResponseType.RateLimited,
			reason: 'Rate limited',
			requestId: '1',
			serverRequestId: undefined,
			retryAfter: 5,
			rateLimitKey: '',
			isAuto: false,
			capiError: { code: 'user_model_rate_limited', message: 'slow down' },
		}), false);
	});
});
