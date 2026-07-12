/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { GLM_5_2_MODEL_ID } from '../featherlessProvider';
import {
	buildFeatherlessModelsUrl,
	compareGlmVersions,
	deriveFeatherlessClassifications,
	mapFeatherlessApiModelToSettingsModel,
	mapFeatherlessModelToCapabilities,
	parseFeatherlessModelsPage,
	selectDefaultFeatherlessModelId,
	settingsQueryToDiscoveryOptions,
	sortFeatherlessSettingsModels,
} from '../../common/featherlessModelDiscovery';

describe('featherlessModelDiscovery', () => {
	it('parseFeatherlessModelsPage detects pagination', () => {
		const page = parseFeatherlessModelsPage({
			data: [
				{ id: 'org/model-a', context_length: 8192, max_completion_tokens: 1024 },
			],
		}, 100);
		expect(page.models.length).toBe(1);
		expect(page.hasMore).toBe(false);
	});

	it('parseFeatherlessModelsPage marks full page as hasMore', () => {
		const models = Array.from({ length: 100 }, (_, i) => ({ id: `org/model-${i}` }));
		const page = parseFeatherlessModelsPage({ data: models }, 100);
		expect(page.hasMore).toBe(true);
	});

	it('buildFeatherlessModelsUrl includes search sort and filters', () => {
		const url = buildFeatherlessModelsUrl('https://api.featherless.ai/v1', {
			page: 2,
			perPage: 25,
			q: 'glm',
			sort: '-popularity',
			capabilities: 'code',
			contextLengthMin: 32768,
			gated: false,
		});
		const parsed = new URL(url);
		expect(parsed.searchParams.get('page')).toBe('2');
		expect(parsed.searchParams.get('per_page')).toBe('25');
		expect(parsed.searchParams.get('q')).toBe('glm');
		expect(parsed.searchParams.get('sort')).toBe('-popularity');
		expect(parsed.searchParams.get('capabilities')).toBe('code');
		expect(parsed.searchParams.get('context_length_min')).toBe('32768');
		expect(parsed.searchParams.get('gated')).toBe('false');
		expect(parsed.searchParams.get('available_on_current_plan')).toBe('true');
	});

	it('settingsQueryToDiscoveryOptions maps browse presets', () => {
		const coding = settingsQueryToDiscoveryOptions({ browse: 'coding', sort: 'popularity' });
		expect(coding.capabilities).toBe('code');
		expect(coding.sort).toBe('-favorites');
		expect(coding.gated).toBeUndefined();

		const vision = settingsQueryToDiscoveryOptions({ browse: 'vision' });
		expect(vision.modalities).toBe('vision');

		const creative = settingsQueryToDiscoveryOptions({ browse: 'creative' });
		expect(creative.creative).toBe(true);

		const popular = settingsQueryToDiscoveryOptions({ browse: 'popular' });
		expect(popular.popularityLevel).toBe(4);
	});

	it('mapFeatherlessApiModelToSettingsModel keeps gated models', () => {
		const model = mapFeatherlessApiModelToSettingsModel({
			id: 'org/gated-model',
			name: 'Gated Model',
			is_gated: true,
			features: { tool_use: true },
		});
		expect(model).toBeTruthy();
		expect(model!.gated).toBe(true);
	});

	it('deriveFeatherlessClassifications detects coding tools and vision', () => {
		const classifications = deriveFeatherlessClassifications({
			id: 'Qwen/Qwen2.5-Coder-7B-Instruct',
			name: 'Qwen2.5-Coder-7B-Instruct',
			features: { tool_use: true },
			vision_supported: true,
			tags: ['code', 'chat'],
		});
		expect(classifications).toContain('coding');
		expect(classifications).toContain('tools');
		expect(classifications).toContain('vision');
		expect(classifications).toContain('chat');
	});

	it('mapFeatherlessApiModelToSettingsModel maps metadata', () => {
		const model = mapFeatherlessApiModelToSettingsModel({
			id: 'org/test-model',
			name: 'Test Model',
			context_length: 131072,
			max_completion_tokens: 8192,
			features: { tool_use: true },
			vision_supported: false,
			downloads: 1000,
			favorites: 50,
			parameter_size: 7_000_000_000,
			tags: ['chat'],
		});
		expect(model).toBeTruthy();
		expect(model!.name).toBe('Test Model');
		expect(model!.contextLength).toBe(131072);
		expect(model!.toolUse).toBe(true);
		expect(model!.downloads).toBe(1000);
		expect(model!.classifications).toContain('tools');
	});

	it('sortFeatherlessSettingsModels sorts by context', () => {
		const sorted = sortFeatherlessSettingsModels([
			{ id: 'a', name: 'A', availableOnPlan: true, contextLength: 8_000, classifications: [] },
			{ id: 'b', name: 'B', availableOnPlan: true, contextLength: 128_000, classifications: [] },
		], 'context');
		expect(sorted[0].id).toBe('b');
	});

	it('mapFeatherlessModelToCapabilities maps API fields', () => {
		const capabilities = mapFeatherlessModelToCapabilities({
			id: 'org/test-model',
			name: 'Test Model',
			context_length: 200000,
			max_completion_tokens: 16000,
			features: { tool_use: true },
			vision_supported: true,
			input_modalities: ['text', 'image'],
		});
		expect(capabilities).toBeTruthy();
		expect(capabilities!.name).toBe('Test Model');
		expect(capabilities!.contextWindow).toBe(200000);
		expect(capabilities!.maxOutputTokens).toBe(16000);
		expect(capabilities!.toolCalling).toBe(true);
		expect(capabilities!.vision).toBe(true);
	});

	it('mapFeatherlessModelToCapabilities skips gated models', () => {
		expect(mapFeatherlessModelToCapabilities({ id: 'org/gated', is_gated: true })).toBeUndefined();
	});

	it('selectDefaultFeatherlessModelId prefers configured GLM-5.2', () => {
		const selected = selectDefaultFeatherlessModelId([
			'org/other',
			'zai-org/GLM-5.2',
			'org/GLM-4.7',
		], 'zai-org/GLM-5.2');
		expect(selected).toBe('zai-org/GLM-5.2');
	});

	it('selectDefaultFeatherlessModelId falls back to latest GLM', () => {
		const selected = selectDefaultFeatherlessModelId([
			'org/other',
			'org/GLM-4.7',
			'org/GLM-5',
		], 'zai-org/GLM-5.2');
		expect(selected).toBe('org/GLM-5');
	});

	it('compareGlmVersions orders newer GLM versions later', () => {
		expect(compareGlmVersions('org/GLM-5', 'org/GLM-4.7')).toBeGreaterThan(0);
		expect(compareGlmVersions('zai-org/GLM-5.2', 'org/GLM-5')).toBeGreaterThan(0);
	});
});

describe('FeatherlessBYOKLMProvider', () => {
	it('GLM-5.2 model id is correct', () => {
		expect(GLM_5_2_MODEL_ID).toBe('zai-org/GLM-5.2');
	});
});
