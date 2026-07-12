/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { MarkdownString } from '../../../../../../base/common/htmlContent.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../base/test/common/utils.js';
import { IChatToolInvocationSerialized } from '../../../common/chatService/chatService.js';
import { IChatProgressResponseContent } from '../../../common/model/chatModel.js';
import { extractPlanMarkdownBeforeSave, resolvePlanBody } from '../../../common/plan/planContentResolver.js';
import { SavePlanToolId } from '../../../common/tools/builtinTools/savePlanTool.js';

function markdown(value: string): IChatProgressResponseContent {
	return { kind: 'markdownContent', content: new MarkdownString(value) };
}

function savePlanTool(toolCallId: string): IChatToolInvocationSerialized {
	return {
		kind: 'toolInvocationSerialized',
		toolCallId,
		toolId: SavePlanToolId,
		invocationMessage: 'Saving plan',
		originMessage: undefined,
		pastTenseMessage: undefined,
		isConfirmed: true,
		isComplete: false,
		presentation: undefined,
		source: undefined,
	};
}

function readTool(toolCallId: string): IChatToolInvocationSerialized {
	return {
		kind: 'toolInvocationSerialized',
		toolCallId,
		toolId: 'read',
		invocationMessage: 'Read file',
		originMessage: undefined,
		pastTenseMessage: undefined,
		isConfirmed: true,
		isComplete: true,
		presentation: undefined,
		source: undefined,
	};
}

suite('planContentResolver', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('extractPlanMarkdownBeforeSave returns markdown immediately before savePlan', () => {
		const parts: IChatProgressResponseContent[] = [
			markdown('earlier note'),
			savePlanTool('tc-save'),
		];
		assert.strictEqual(extractPlanMarkdownBeforeSave(parts, 'tc-save'), 'earlier note');
	});

	test('extractPlanMarkdownBeforeSave ignores markdown before earlier tools', () => {
		const parts: IChatProgressResponseContent[] = [
			markdown('old context'),
			readTool('tc-read'),
			markdown('## Final plan\n\nStep 1\nStep 2'),
			savePlanTool('tc-save'),
		];
		assert.strictEqual(extractPlanMarkdownBeforeSave(parts, 'tc-save'), '## Final plan\n\nStep 1\nStep 2');
	});

	test('resolvePlanBody prefers fuller assistant markdown over truncated tool content', () => {
		const tool = '## Plan\n\nStep 1 only';
		const response = '## Plan\n\nStep 1 only\nStep 2\nStep 3';
		assert.strictEqual(resolvePlanBody(tool, response), response);
	});

	test('resolvePlanBody keeps tool content when it is the only source', () => {
		const tool = '## Plan\n\nAll steps here';
		assert.strictEqual(resolvePlanBody(tool, undefined), tool);
	});
});
