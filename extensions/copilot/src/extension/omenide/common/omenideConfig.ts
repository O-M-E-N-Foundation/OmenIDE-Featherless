/*---------------------------------------------------------------------------------------------
 *  OmenIDE — Featherless.ai configuration defaults and setting keys.
 *--------------------------------------------------------------------------------------------*/

export const OmenIDEConfig = {
	FeatherlessChatModel: 'omenide.featherless.chatModel',
	FeatherlessEmbeddingModel: 'omenide.featherless.embeddingModel',
	FeatherlessCompletionModel: 'omenide.featherless.completionModel',
	AutocompleteEnabled: 'omenide.featherless.autocomplete.enabled',
} as const;

export const OmenIDEDefaults = {
	chatModel: 'zai-org/GLM-5.2',
	embeddingModel: 'Qwen/Qwen3-Embedding-8B',
	completionModel: 'Etherll/Qwen2.5-CodeFIM-1.5B-v2',
	featherlessBaseUrl: 'https://api.featherless.ai/v1',
	autocompleteEnabled: true,
} as const;

export const OmenIDEEmbeddingTypeId = 'featherless-qwen3-embedding-8b';
