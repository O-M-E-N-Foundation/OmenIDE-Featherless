/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { GLM_5_2_MODEL_ID } from './featherlessProvider';

suite('FeatherlessBYOKLMProvider', () => {
	test('GLM-5.2 model id is correct', () => {
		assert.strictEqual(GLM_5_2_MODEL_ID, 'zai-org/GLM-5.2');
	});
});
