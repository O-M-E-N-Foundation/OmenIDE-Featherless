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
	Models = 'models',
	Performance = 'performance',
}

/** Mirrors `extensions/copilot/src/extension/omenide/common/omenideConfig.ts`. */
export const OmenIDEConfiguration = {
	chatModel: 'omenide.featherless.chatModel',
	embeddingModel: 'omenide.featherless.embeddingModel',
	completionModel: 'omenide.featherless.completionModel',
	autocompleteEnabled: 'omenide.featherless.autocomplete.enabled',
	concurrencyLimit: 'omenide.featherless.concurrencyLimit',
	concurrencyMaxRetries: 'omenide.featherless.concurrencyMaxRetries',
} as const;

export const OmenIDEDefaults = {
	chatModel: 'zai-org/GLM-5.2',
	embeddingModel: 'Qwen/Qwen3-Embedding-8B',
	completionModel: 'Etherll/Qwen2.5-CodeFIM-1.5B-v2',
	autocompleteEnabled: true,
	concurrencyLimit: 8,
	concurrencyMaxRetries: 12,
} as const;

export const CONTEXT_OMEN_SETTINGS_EDITOR = new RawContextKey<boolean>(
	'omenSettingsEditorFocused',
	false,
	localize('omenSettingsEditorFocused', "Whether the Omen IDE Settings editor is focused")
);
