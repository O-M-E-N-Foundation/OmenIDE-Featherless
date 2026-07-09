/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { InlineThinkTagStreamParser } from '../inlineThinkTagParser';

function collect(chunks: string[]): { text: string; thinking: string } {
	const parser = new InlineThinkTagStreamParser();
	let text = '';
	let thinking = '';
	for (const chunk of chunks) {
		const r = parser.push(chunk);
		text += r.text;
		thinking += r.thinking;
	}
	const rest = parser.flush();
	text += rest.text;
	thinking += rest.thinking;
	return { text, thinking };
}

describe('InlineThinkTagStreamParser', () => {
	it('passes through plain text untouched', () => {
		expect(collect(['Hello', ' world'])).toEqual({ text: 'Hello world', thinking: '' });
	});

	it('splits a leading think block in a single chunk', () => {
		expect(collect(['<think>reasoning</think>\n\nanswer'])).toEqual({ text: 'answer', thinking: 'reasoning' });
	});

	it('splits a think block streamed in many small chunks', () => {
		expect(collect(['<th', 'ink>rea', 'soning</th', 'ink>\n\nan', 'swer'])).toEqual({ text: 'answer', thinking: 'reasoning' });
	});

	it('allows leading whitespace before the open tag', () => {
		expect(collect(['\n\n<think>r</think>a'])).toEqual({ text: 'a', thinking: 'r' });
	});

	it('does not treat a mid-response tag as reasoning', () => {
		expect(collect(['answer with <think>literal</think> tags'])).toEqual({ text: 'answer with <think>literal</think> tags', thinking: '' });
	});

	it('surfaces an unterminated think block as thinking on flush', () => {
		expect(collect(['<think>ran out of tok'])).toEqual({ text: '', thinking: 'ran out of tok' });
	});

	it('surfaces a pending partial open tag as text on flush', () => {
		expect(collect(['<thi'])).toEqual({ text: '<thi', thinking: '' });
	});

	it('does not hold back text resembling the close tag prefix forever', () => {
		expect(collect(['<think>a</t', 'not a close tag</think>b'])).toEqual({ text: 'b', thinking: 'a</tnot a close tag' });
	});

	it('handles close tag split exactly at the boundary', () => {
		expect(collect(['<think>r</', 'think>a'])).toEqual({ text: 'a', thinking: 'r' });
	});
});
