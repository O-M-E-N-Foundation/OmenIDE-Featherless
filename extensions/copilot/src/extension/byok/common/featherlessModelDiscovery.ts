/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { BYOKKnownModels, BYOKModelCapabilities } from './byokProvider';

export interface FeatherlessApiModel {
	readonly id: string;
	readonly name?: string;
	readonly model_class?: string;
	readonly context_length?: number;
	readonly max_completion_tokens?: number;
	readonly is_gated?: boolean;
	readonly available_on_current_plan?: boolean;
	readonly features?: { tool_use?: boolean; image_input?: boolean };
	readonly vision_supported?: boolean;
	readonly input_modalities?: readonly string[];
	readonly output_modalities?: readonly string[];
	readonly tasks?: readonly string[];
	readonly tags?: readonly string[];
	readonly downloads?: number;
	readonly favorites?: number;
	readonly parameter_size?: number;
	readonly popularity_level?: number;
	readonly license?: string;
	readonly status?: string;
}

export type FeatherlessModelClassification =
	| 'coding'
	| 'chat'
	| 'tools'
	| 'vision'
	| 'creative'
	| 'reasoning';

export interface FeatherlessModelsDiscoveryOptions {
	readonly page?: number;
	readonly perPage?: number;
	readonly q?: string;
	readonly sort?: string;
	readonly capabilities?: string;
	readonly modalities?: string;
	readonly domains?: string;
	readonly creative?: boolean;
	readonly conversational?: boolean;
	readonly popularityLevel?: number;
	readonly contextLengthMin?: number;
	readonly contextLengthMax?: number;
	readonly availableOnCurrentPlan?: boolean;
	readonly gated?: boolean;
	readonly tags?: string;
	readonly family?: string;
	readonly tasks?: string;
}

export interface FeatherlessModelsPage {
	readonly models: readonly FeatherlessApiModel[];
	readonly hasMore: boolean;
	readonly page: number;
	readonly perPage: number;
}

/** Settings-row DTO returned by `omenide.listFeatherlessModels`. */
export interface FeatherlessSettingsModel {
	readonly id: string;
	readonly name: string;
	readonly availableOnPlan: boolean;
	readonly contextLength?: number;
	readonly maxCompletionTokens?: number;
	readonly modelClass?: string;
	readonly toolUse?: boolean;
	readonly vision?: boolean;
	readonly tags?: readonly string[];
	readonly tasks?: readonly string[];
	readonly downloads?: number;
	readonly favorites?: number;
	readonly parameterSize?: number;
	readonly popularityLevel?: number;
	readonly gated?: boolean;
	readonly classifications: readonly FeatherlessModelClassification[];
}

export interface FeatherlessSettingsModelsQuery {
	readonly page?: number;
	readonly perPage?: number;
	readonly q?: string;
	readonly sort?: 'popularity' | 'name' | 'context';
	/** Browse presets that map onto Featherless query params. */
	readonly browse?: 'all' | 'coding' | 'tools' | 'vision' | 'creative' | 'popular';
	readonly contextLengthMin?: number;
}

export interface FeatherlessSettingsModelsPage {
	readonly models: readonly FeatherlessSettingsModel[];
	readonly page: number;
	readonly perPage: number;
	readonly hasMore: boolean;
	readonly query: FeatherlessSettingsModelsQuery;
}

export function buildFeatherlessModelsUrl(baseUrl: string, options: FeatherlessModelsDiscoveryOptions = {}): string {
	const url = new URL(`${baseUrl.replace(/\/$/, '')}/models`);
	const page = options.page ?? 1;
	const perPage = options.perPage ?? 100;

	url.searchParams.set('page', String(page));
	url.searchParams.set('per_page', String(perPage));

	if (options.availableOnCurrentPlan !== false) {
		url.searchParams.set('available_on_current_plan', 'true');
	}
	if (options.capabilities) {
		url.searchParams.set('capabilities', options.capabilities);
	}
	if (options.q?.trim()) {
		url.searchParams.set('q', options.q.trim());
	}
	if (options.sort) {
		url.searchParams.set('sort', options.sort);
	}
	if (options.modalities) {
		url.searchParams.set('modalities', options.modalities);
	}
	if (options.domains) {
		url.searchParams.set('domains', options.domains);
	}
	if (options.creative === true) {
		url.searchParams.set('creative', 'true');
	}
	if (options.conversational === true) {
		url.searchParams.set('conversational', 'true');
	}
	if (options.popularityLevel !== undefined) {
		url.searchParams.set('popularity_level', String(options.popularityLevel));
	}
	if (options.contextLengthMin !== undefined) {
		url.searchParams.set('context_length_min', String(options.contextLengthMin));
	}
	if (options.contextLengthMax !== undefined) {
		url.searchParams.set('context_length_max', String(options.contextLengthMax));
	}
	if (options.gated === false) {
		url.searchParams.set('gated', 'false');
	} else if (options.gated === true) {
		url.searchParams.set('gated', 'true');
	}
	if (options.tags) {
		url.searchParams.set('tags', options.tags);
	}
	if (options.family) {
		url.searchParams.set('family', options.family);
	}
	if (options.tasks) {
		url.searchParams.set('tasks', options.tasks);
	}

	return url.toString();
}

/** @deprecated Prefer {@link buildFeatherlessModelsUrl}. Kept for chat-provider bootstrap. */
export function buildFeatherlessModelsDiscoveryUrl(baseUrl: string, page: number, perPage = 100): string {
	return buildFeatherlessModelsUrl(baseUrl, {
		page,
		perPage,
		availableOnCurrentPlan: true,
		capabilities: 'chat',
	});
}

export function settingsQueryToDiscoveryOptions(query: FeatherlessSettingsModelsQuery = {}): FeatherlessModelsDiscoveryOptions {
	const browse = query.browse ?? 'all';
	const sort = query.sort ?? 'popularity';
	const options: FeatherlessModelsDiscoveryOptions = {
		page: query.page ?? 1,
		// Featherless currently ignores smaller page sizes and returns ~100; request 100 and paginate by page=.
		perPage: Math.min(100, Math.max(1, query.perPage ?? 100)),
		q: query.q,
		availableOnCurrentPlan: true,
		contextLengthMin: query.contextLengthMin,
	};

	switch (browse) {
		case 'coding':
			options.capabilities = 'code';
			break;
		case 'tools':
			options.capabilities = 'chat,tool-use';
			break;
		case 'vision':
			options.capabilities = 'chat';
			options.modalities = 'vision';
			break;
		case 'creative':
			options.capabilities = 'chat';
			options.creative = true;
			break;
		case 'popular':
			options.capabilities = 'chat';
			options.popularityLevel = 4;
			break;
		case 'all':
		default:
			options.capabilities = 'chat';
			break;
	}

	switch (sort) {
		case 'name':
		case 'context':
			// Featherless `sort=-context_length` / name sorts are sparse; sort the returned page client-side.
			break;
		case 'popularity':
		default:
			// `sort=-popularity` is sparse/broken; favorites matches their catalog ranking.
			options.sort = '-favorites';
			break;
	}

	return options;
}

export function parseFeatherlessModelsPage(data: unknown, perPage: number, page = 1): FeatherlessModelsPage {
	const payload = data as { data?: FeatherlessApiModel[] };
	const models = Array.isArray(payload?.data) ? payload.data : [];
	return {
		models,
		hasMore: models.length >= perPage,
		page,
		perPage,
	};
}

export function deriveFeatherlessClassifications(model: FeatherlessApiModel): FeatherlessModelClassification[] {
	const classifications = new Set<FeatherlessModelClassification>();
	const haystack = [
		model.id,
		model.name,
		model.model_class,
		...(model.tags ?? []),
		...(model.tasks ?? []),
		...(model.input_modalities ?? []),
	].filter(Boolean).join(' ').toLowerCase();

	const toolUse = model.features?.tool_use === true;
	const vision = model.vision_supported === true
		|| model.features?.image_input === true
		|| model.input_modalities?.includes('image') === true
		|| model.input_modalities?.includes('vision') === true;

	if (toolUse) {
		classifications.add('tools');
	}
	if (vision) {
		classifications.add('vision');
	}
	if (/\b(code|coder|coding|fim|devtools|programming)\b/.test(haystack)) {
		classifications.add('coding');
	}
	if (/\b(roleplay|rp\b|creative|story|writer|uncensored|mythos|eris)\b/.test(haystack)) {
		classifications.add('creative');
	}
	if (/\b(reason|thinking|r1|logic|math)\b/.test(haystack)) {
		classifications.add('reasoning');
	}
	if (/\b(chat|instruct|assistant|conversational)\b/.test(haystack) || classifications.size === 0) {
		classifications.add('chat');
	}

	return Array.from(classifications);
}

export function mapFeatherlessApiModelToSettingsModel(model: FeatherlessApiModel): FeatherlessSettingsModel | undefined {
	if (!model.id) {
		return undefined;
	}

	return {
		id: model.id,
		name: model.name ?? model.id.split('/').pop() ?? model.id,
		availableOnPlan: model.available_on_current_plan !== false,
		contextLength: model.context_length,
		maxCompletionTokens: model.max_completion_tokens,
		modelClass: model.model_class,
		toolUse: model.features?.tool_use === true,
		vision: model.vision_supported === true
			|| model.features?.image_input === true
			|| model.input_modalities?.includes('image') === true
			|| model.input_modalities?.includes('vision') === true,
		tags: model.tags,
		tasks: model.tasks,
		downloads: model.downloads,
		favorites: model.favorites,
		parameterSize: model.parameter_size,
		popularityLevel: model.popularity_level,
		gated: model.is_gated === true,
		classifications: deriveFeatherlessClassifications(model),
	};
}

export function sortFeatherlessSettingsModels(
	models: readonly FeatherlessSettingsModel[],
	sort: FeatherlessSettingsModelsQuery['sort'] = 'popularity',
): FeatherlessSettingsModel[] {
	const copy = [...models];
	switch (sort) {
		case 'name':
			return copy.sort((a, b) => a.name.localeCompare(b.name));
		case 'context':
			return copy.sort((a, b) => (b.contextLength ?? 0) - (a.contextLength ?? 0) || a.name.localeCompare(b.name));
		case 'popularity':
		default:
			return copy.sort((a, b) => {
				const pop = (b.popularityLevel ?? 0) - (a.popularityLevel ?? 0);
				if (pop !== 0) {
					return pop;
				}
				const fav = (b.favorites ?? 0) - (a.favorites ?? 0);
				if (fav !== 0) {
					return fav;
				}
				const dl = (b.downloads ?? 0) - (a.downloads ?? 0);
				if (dl !== 0) {
					return dl;
				}
				// Preserve API order when popularity metadata is absent.
				return 0;
			});
	}
}

export function mapFeatherlessModelToCapabilities(model: FeatherlessApiModel, glmFallback?: BYOKModelCapabilities): BYOKModelCapabilities | undefined {
	if (!model.id || model.is_gated) {
		return undefined;
	}

	const contextWindow = model.context_length ?? 128000;
	const maxOutputTokens = model.max_completion_tokens ?? 8192;
	const maxInputTokens = Math.max(4096, contextWindow - maxOutputTokens);
	const toolCalling = model.features?.tool_use !== false;
	const vision = model.vision_supported === true
		|| model.input_modalities?.includes('image') === true
		|| model.input_modalities?.includes('vision') === true;

	if (glmFallback && (model.id.includes('GLM-5.2') || model.id.includes('glm-5.2'))) {
		return { ...glmFallback, name: model.name ?? glmFallback.name };
	}

	return {
		name: model.name ?? model.id.split('/').pop() ?? model.id,
		contextWindow,
		maxInputTokens,
		maxOutputTokens,
		toolCalling,
		vision,
		streaming: true,
	};
}

export function mergeFeatherlessModelsIntoKnownModels(
	knownModels: BYOKKnownModels,
	pageModels: readonly FeatherlessApiModel[],
	glmFallback?: BYOKModelCapabilities,
): BYOKKnownModels {
	const merged: BYOKKnownModels = { ...knownModels };
	for (const model of pageModels) {
		const capabilities = mapFeatherlessModelToCapabilities(model, glmFallback);
		if (capabilities) {
			merged[model.id] = capabilities;
		}
	}
	return merged;
}

const GLM_VERSION_PATTERN = /GLM[- ]?(\d+(?:\.\d+)*)/i;

export function extractGlmVersion(modelId: string): number[] | undefined {
	const match = modelId.match(GLM_VERSION_PATTERN);
	if (!match) {
		return undefined;
	}
	return match[1].split('.').map(part => Number.parseInt(part, 10)).filter(n => !Number.isNaN(n));
}

export function compareGlmVersions(a: string, b: string): number {
	const av = extractGlmVersion(a);
	const bv = extractGlmVersion(b);
	if (!av && !bv) {
		return a.localeCompare(b);
	}
	if (!av) {
		return -1;
	}
	if (!bv) {
		return 1;
	}
	const len = Math.max(av.length, bv.length);
	for (let i = 0; i < len; i++) {
		const diff = (av[i] ?? 0) - (bv[i] ?? 0);
		if (diff !== 0) {
			return diff;
		}
	}
	return 0;
}

export function selectDefaultFeatherlessModelId(
	modelIds: readonly string[],
	preferredModelId: string,
): string | undefined {
	if (modelIds.length === 0) {
		return undefined;
	}
	if (modelIds.includes(preferredModelId)) {
		return preferredModelId;
	}

	const glmModels = modelIds.filter(id => /GLM/i.test(id));
	if (glmModels.length > 0) {
		return [...glmModels].sort(compareGlmVersions).at(-1);
	}

	return modelIds[0];
}
