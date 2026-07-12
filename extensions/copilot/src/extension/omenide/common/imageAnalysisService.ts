/*---------------------------------------------------------------------------------------------
 *  OmenIDE — image analysis service contract for non-vision chat models.
 *--------------------------------------------------------------------------------------------*/

import type { CancellationToken } from 'vscode';
import { createServiceIdentifier } from '../../../util/common/services';

export interface IOmenImageAnalysisRequest {
	readonly imageData: Uint8Array;
	readonly mimeType?: string;
	readonly userPrompt?: string;
	readonly imageLabel?: string;
}

export const IOmenImageAnalysisService = createServiceIdentifier<IOmenImageAnalysisService>('IOmenImageAnalysisService');

export interface IOmenImageAnalysisService {
	readonly _serviceBrand: undefined;

	isEnabled(): boolean;

	analyzeImage(request: IOmenImageAnalysisRequest, token?: CancellationToken): Promise<string | undefined>;
}

export class NullOmenImageAnalysisService implements IOmenImageAnalysisService {
	declare readonly _serviceBrand: undefined;

	isEnabled(): boolean {
		return false;
	}

	async analyzeImage(): Promise<string | undefined> {
		return undefined;
	}
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
