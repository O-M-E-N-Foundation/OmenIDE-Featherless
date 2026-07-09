/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../base/test/common/utils.js';
import { parsePlanFrontmatter, serializePlanContent, slugifyPlanTitle } from '../../../common/plan/planFrontmatter.js';

suite('planFrontmatter', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('round-trips metadata', () => {
		const body = '## Plan\n\nDo the thing.';
		const serialized = serializePlanContent({
			createdAt: '2026-07-09T00:00:00.000Z',
			overview: 'Short overview',
			built: true,
			builtAt: '2026-07-09T01:00:00.000Z',
			buildModel: 'featherless/model',
		}, body);
		const parsed = parsePlanFrontmatter(serialized);
		assert.strictEqual(parsed.body, body);
		assert.strictEqual(parsed.metadata.createdAt, '2026-07-09T00:00:00.000Z');
		assert.strictEqual(parsed.metadata.overview, 'Short overview');
		assert.strictEqual(parsed.metadata.built, true);
		assert.strictEqual(parsed.metadata.buildModel, 'featherless/model');
	});

	test('slugifyPlanTitle', () => {
		assert.strictEqual(slugifyPlanTitle('Cursor Plan Mode Parity'), 'cursor_plan_mode_parity');
		assert.strictEqual(slugifyPlanTitle(''), 'plan');
	});
});
