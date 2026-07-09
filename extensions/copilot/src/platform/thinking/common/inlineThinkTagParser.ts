/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const OPEN_TAG = '<think>';
const CLOSE_TAG = '</think>';

export interface IInlineThinkChunk {
	/** Visible response text extracted from the pushed chunk. */
	readonly text: string;
	/** Reasoning text extracted from a leading `<think>...</think>` block. */
	readonly thinking: string;
}

/**
 * Incremental parser that splits a leading `<think>...</think>` reasoning
 * block out of a streamed completion.
 *
 * Some OpenAI-compatible servers (e.g. Featherless serving GLM / DeepSeek-R1
 * style models) emit reasoning inline in `delta.content` rather than in a
 * dedicated `reasoning_content` field. Without separation the tags leak into
 * the visible response and are echoed back into the conversation history,
 * which quickly degrades the model.
 *
 * Only a think block at the very start of the response (after optional
 * whitespace) is treated as reasoning — that is where chat templates place
 * it. Tags appearing later in the response are left untouched. Tags split
 * across stream chunks are handled by buffering the smallest necessary
 * suffix.
 */
export class InlineThinkTagStreamParser {

	private _state: 'detect' | 'thinking' | 'text' = 'detect';
	private _buffer = '';

	push(chunk: string): IInlineThinkChunk {
		this._buffer += chunk;
		let thinking = '';

		if (this._state === 'detect') {
			const lead = this._buffer.trimStart();
			if (lead.length === 0) {
				// Only whitespace so far; keep buffering.
				return { text: '', thinking: '' };
			}
			if (lead.startsWith(OPEN_TAG)) {
				this._state = 'thinking';
				this._buffer = lead.slice(OPEN_TAG.length);
			} else if (OPEN_TAG.startsWith(lead)) {
				// Potential partial open tag; keep buffering.
				return { text: '', thinking: '' };
			} else {
				this._state = 'text';
			}
		}

		if (this._state === 'thinking') {
			const closeIdx = this._buffer.indexOf(CLOSE_TAG);
			if (closeIdx === -1) {
				// Hold back a potential partial close tag at the end of the buffer.
				const holdback = partialSuffixLength(this._buffer, CLOSE_TAG);
				thinking = this._buffer.slice(0, this._buffer.length - holdback);
				this._buffer = this._buffer.slice(this._buffer.length - holdback);
				return { text: '', thinking };
			}
			thinking = this._buffer.slice(0, closeIdx);
			// Drop whitespace between the close tag and the answer (chat
			// templates emit `</think>\n\n`).
			this._buffer = this._buffer.slice(closeIdx + CLOSE_TAG.length).replace(/^\s+/, '');
			this._state = 'text';
		}

		const text = this._buffer;
		this._buffer = '';
		return { text, thinking };
	}

	/**
	 * Returns whatever is still buffered when the stream ends. An unterminated
	 * think block (e.g. generation hit the token limit) is surfaced as
	 * thinking; a pending partial open tag is surfaced as text.
	 */
	flush(): IInlineThinkChunk {
		const rest = this._buffer;
		this._buffer = '';
		if (this._state === 'thinking') {
			return { text: '', thinking: rest };
		}
		this._state = 'text';
		return { text: rest, thinking: '' };
	}
}

/** Length of the longest prefix of `tag` that is a suffix of `s` (shorter than the full tag). */
function partialSuffixLength(s: string, tag: string): number {
	const max = Math.min(s.length, tag.length - 1);
	for (let len = max; len > 0; len--) {
		if (s.endsWith(tag.slice(0, len))) {
			return len;
		}
	}
	return 0;
}
