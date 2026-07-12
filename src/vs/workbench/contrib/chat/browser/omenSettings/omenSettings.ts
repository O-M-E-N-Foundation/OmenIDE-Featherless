/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../../nls.js';
import { RawContextKey } from '../../../../../platform/contextkey/common/contextkey.js';

export const OMEN_SETTINGS_EDITOR_ID = 'workbench.editor.omenSettings';
export const OMEN_SETTINGS_EDITOR_INPUT_ID = 'workbench.input.omenSettings';
export const OMEN_SETTINGS_OPEN_COMMAND = 'omenide.openSettings';

export const OMEN_SETTINGS_SELECTED_SECTION_KEY = 'omenSettings.selectedSection';
export const OMEN_SETTINGS_SIDEBAR_WIDTH_KEY = 'omenSettings.sidebarWidth';

export const SIDEBAR_DEFAULT_WIDTH = 220;
export const SIDEBAR_MIN_WIDTH = 180;
export const SIDEBAR_MAX_WIDTH = 320;

export enum OmenSettingsSection {
	General = 'general',
	PlanUsage = 'planUsage',
	Agents = 'agents',
	Models = 'models',
}

/** Mirrors `extensions/copilot/src/extension/omenide/common/omenideConfig.ts`. */
export const OmenIDEConfiguration = {
	chatModel: 'omenide.featherless.chatModel',
	embeddingModel: 'omenide.featherless.embeddingModel',
	completionModel: 'omenide.featherless.completionModel',
	visionModel: 'omenide.featherless.visionModel',
	autocompleteEnabled: 'omenide.featherless.autocomplete.enabled',
	concurrencyLimit: 'omenide.featherless.concurrencyLimit',
	concurrencyMaxRetries: 'omenide.featherless.concurrencyMaxRetries',
	enabledModels: 'omenide.featherless.enabledModels',
	disabledModels: 'omenide.featherless.disabledModels',
} as const;

export const OmenIDEDefaults = {
	chatModel: 'zai-org/GLM-5.2',
	embeddingModel: 'Qwen/Qwen3-Embedding-8B',
	completionModel: 'Etherll/Qwen2.5-CodeFIM-1.5B-v2',
	visionModel: 'Qwen/Qwen3.6-27B',
	autocompleteEnabled: true,
	concurrencyLimit: 8,
	concurrencyMaxRetries: 12,
	enabledModels: [] as string[],
	disabledModels: [] as string[],
} as const;

/** True when pasted/attached images will be described via the vision sidecar. */
export function isOmenImageSidecarConfigured(visionModelSetting: unknown): boolean {
	const configured = typeof visionModelSetting === 'string' ? visionModelSetting.trim() : '';
	const model = (configured || OmenIDEDefaults.visionModel).trim();
	return model.length > 0;
}

/** Chat/agent settings surfaced on the Agents page. */
export const OmenAgentsConfiguration = {
	agentEnabled: 'chat.agent.enabled',
	notifyOnResponse: 'chat.notifyWindowOnResponseReceived',
	defaultConfiguration: 'chat.defaultConfiguration',
	globalAutoApprove: 'chat.tools.global.autoApprove',
} as const;

export const CONTEXT_OMEN_SETTINGS_EDITOR = new RawContextKey<boolean>(
	'omenSettingsEditorFocused',
	false,
	localize('omenSettingsEditorFocused', "Whether the Omen IDE Settings editor is focused")
);

/** Shared account DTO from `omenide.getFeatherlessAccountSummary`. */
export interface IOmenFeatherlessAccountSummary {
	readonly configured: boolean;
	readonly authMethod?: 'oauth' | 'apikey';
	readonly plan?: {
		readonly id: string;
		readonly name: string;
		readonly max_context_length: number | null;
		readonly max_model_size: number | null;
		readonly concurrency: number | null;
	};
	readonly concurrency?: {
		readonly limit: number | null;
		readonly used_cost: number;
		readonly request_count: number;
	};
	readonly error?: string;
}

export interface IOmenFeatherlessSettingsModel {
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
	readonly classifications?: readonly string[];
}

export type OmenModelsBrowseFilter = 'all' | 'coding' | 'tools' | 'vision' | 'creative' | 'popular';
export type OmenModelsSort = 'popularity' | 'name' | 'context';

export interface IOmenFeatherlessSettingsModelsQuery {
	readonly page?: number;
	readonly perPage?: number;
	readonly q?: string;
	readonly sort?: OmenModelsSort;
	readonly browse?: OmenModelsBrowseFilter;
	readonly contextLengthMin?: number;
}

export interface IOmenFeatherlessSettingsModelsPage {
	readonly models: readonly IOmenFeatherlessSettingsModel[];
	readonly page: number;
	readonly perPage: number;
	readonly hasMore: boolean;
	readonly query: IOmenFeatherlessSettingsModelsQuery;
}
