/*---------------------------------------------------------------------------------------------
 *  OmenIDE — Featherless.ai configuration defaults and setting keys.
 *--------------------------------------------------------------------------------------------*/

export const OmenIDEConfig = {
	FeatherlessChatModel: 'omenide.featherless.chatModel',
	FeatherlessEmbeddingModel: 'omenide.featherless.embeddingModel',
	FeatherlessCompletionModel: 'omenide.featherless.completionModel',
	FeatherlessVisionModel: 'omenide.featherless.visionModel',
	AutocompleteEnabled: 'omenide.featherless.autocomplete.enabled',
	FeatherlessConcurrencyLimit: 'omenide.featherless.concurrencyLimit',
	FeatherlessConcurrencyMaxRetries: 'omenide.featherless.concurrencyMaxRetries',
	FeatherlessEnabledModels: 'omenide.featherless.enabledModels',
	FeatherlessDisabledModels: 'omenide.featherless.disabledModels',
} as const;

export const OmenIDEDefaults = {
	chatModel: 'zai-org/GLM-5.2',
	embeddingModel: 'Qwen/Qwen3-Embedding-8B',
	completionModel: 'Etherll/Qwen2.5-CodeFIM-1.5B-v2',
	/** Vision sidecar used when the chat model does not accept image inputs. */
	visionModel: 'Qwen/Qwen3.6-27B',
	featherlessBaseUrl: 'https://api.featherless.ai/v1',
	/** OAuth client id for the Omen IDE Featherless app (secret held by OMEN backend broker). */
	featherlessOAuthClientId: 'app_XptvKSbw6vQ4yfHC',
	/** OMEN API base URL for Featherless OAuth broker endpoints. */
	omenOAuthBrokerBaseUrl: 'https://api.omen.foundation',
	autocompleteEnabled: true,
	concurrencyLimit: 8,
	concurrencyMaxRetries: 12,
	/** Empty = all plan-available models enabled (minus disabledModels). */
	enabledModels: [] as string[],
	disabledModels: [] as string[],
} as const;

export const OmenIDEEmbeddingTypeId = 'featherless-qwen3-embedding-8b';
