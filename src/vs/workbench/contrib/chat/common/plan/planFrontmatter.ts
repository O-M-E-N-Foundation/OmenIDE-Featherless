/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Mutable } from '../../../../../base/common/types.js';
export interface IOmenPlanMetadata {
	readonly createdAt?: string;
	readonly builtAt?: string;
	readonly built?: boolean;
	readonly buildModel?: string;
	readonly buildSession?: string;
	readonly overview?: string;
}

const FRONTMATTER_REGEX = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export function parsePlanFrontmatter(content: string): { metadata: IOmenPlanMetadata; body: string } {
	const match = content.match(FRONTMATTER_REGEX);
	if (!match) {
		return { metadata: {}, body: content };
	}

	const metadata: Mutable<IOmenPlanMetadata> = {};
	const yamlBlock = match[1];
	const omenPlanMatch = yamlBlock.match(/omenPlan:\s*\n((?:[ \t]+[^\n]+\n?)*)/);
	if (omenPlanMatch) {
		for (const line of omenPlanMatch[1].split('\n')) {
			const trimmed = line.trim();
			if (!trimmed) {
				continue;
			}
			const colon = trimmed.indexOf(':');
			if (colon === -1) {
				continue;
			}
			const key = trimmed.slice(0, colon).trim();
			let value = trimmed.slice(colon + 1).trim();
			if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith('\'') && value.endsWith('\''))) {
				value = value.slice(1, -1);
			}
			switch (key) {
				case 'createdAt': metadata.createdAt = value; break;
				case 'builtAt': metadata.builtAt = value; break;
				case 'built': metadata.built = value === 'true'; break;
				case 'buildModel': metadata.buildModel = value; break;
				case 'buildSession': metadata.buildSession = value; break;
				case 'overview': metadata.overview = value; break;
			}
		}
	}

	return { metadata, body: content.slice(match[0].length) };
}

export function serializePlanContent(metadata: IOmenPlanMetadata, body: string): string {
	const lines: string[] = ['---', 'omenPlan:'];
	if (metadata.createdAt) {
		lines.push(`  createdAt: ${metadata.createdAt}`);
	}
	if (metadata.overview) {
		lines.push(`  overview: ${escapeYamlValue(metadata.overview)}`);
	}
	if (metadata.built) {
		lines.push(`  built: true`);
	}
	if (metadata.builtAt) {
		lines.push(`  builtAt: ${metadata.builtAt}`);
	}
	if (metadata.buildModel) {
		lines.push(`  buildModel: ${escapeYamlValue(metadata.buildModel)}`);
	}
	if (metadata.buildSession) {
		lines.push(`  buildSession: ${escapeYamlValue(metadata.buildSession)}`);
	}
	lines.push('---', '');
	return lines.join('\n') + body.replace(/^\n+/, '');
}

function escapeYamlValue(value: string): string {
	if (/[:#\n\r]/.test(value)) {
		return JSON.stringify(value);
	}
	return value;
}

export function slugifyPlanTitle(title: string): string {
	return title
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '_')
		.replace(/^_+|_+$/g, '')
		.slice(0, 48) || 'plan';
}
