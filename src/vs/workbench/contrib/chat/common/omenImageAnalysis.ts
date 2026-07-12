/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

export interface IOmenImageAnalysisRequest {
	readonly imageData: Uint8Array;
	readonly mimeType: string;
	readonly userPrompt?: string;
	readonly imageLabel?: string;
}

export const IOmenImageAnalysisService = createDecorator<IOmenImageAnalysisService>('omenImageAnalysisService');

/**
 * Describes chat image attachments with a vision-capable Featherless model so
 * non-vision chat models (e.g. GLM-5.2) still receive useful image context.
 */
export interface IOmenImageAnalysisService {
	readonly _serviceBrand: undefined;

	/** Whether a vision sidecar model is configured. */
	isEnabled(): boolean;

	/**
	 * Analyze an image in light of the user's prompt. Returns `undefined` on
	 * soft failure (missing key/model, network error) so chat can continue.
	 */
	analyzeImage(request: IOmenImageAnalysisRequest, token: CancellationToken): Promise<string | undefined>;
}

export function buildOmenImageAnalysisPrompt(userPrompt: string | undefined, imageLabel: string | undefined): string {
	const label = imageLabel?.trim() || 'attached image';
	const prompt = userPrompt?.trim();
	const relevance = prompt
		? `The user wrote this message with the image:\n"""\n${prompt}\n"""\n\nFocus on details that help answer or act on that message.`
		: 'Describe the image for a developer assistant that cannot see it.';
	return [
		`You are describing an image ("${label}") attached in an IDE chat.`,
		relevance,
		'Include visible UI text, layout, errors, code, diagrams, and other concrete facts.',
		'Be concise but complete. Reply with the description only — no preamble.',
	].join('\n');
}
