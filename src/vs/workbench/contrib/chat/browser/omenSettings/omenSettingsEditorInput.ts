/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from '../../../../../base/common/codicons.js';
import { ThemeIcon } from '../../../../../base/common/themables.js';
import { localize } from '../../../../../nls.js';
import { registerIcon } from '../../../../../platform/theme/common/iconRegistry.js';
import { EditorInputCapabilities, IUntypedEditorInput } from '../../../../common/editor.js';
import { EditorInput } from '../../../../common/editor/editorInput.js';
import { OMEN_SETTINGS_EDITOR_INPUT_ID } from './omenSettings.js';

const OmenSettingsEditorIcon = registerIcon(
	'omen-settings-editor-label-icon',
	Codicon.sparkle,
	localize('omenSettingsEditorLabelIcon', 'Icon of the Omen IDE Settings editor label.')
);

export class OmenSettingsEditorInput extends EditorInput {

	private static _instance: OmenSettingsEditorInput | undefined;

	static getOrCreate(): OmenSettingsEditorInput {
		if (!OmenSettingsEditorInput._instance || OmenSettingsEditorInput._instance.isDisposed()) {
			OmenSettingsEditorInput._instance = new OmenSettingsEditorInput();
		}
		return OmenSettingsEditorInput._instance;
	}

	readonly resource = undefined;

	override get capabilities(): EditorInputCapabilities {
		return super.capabilities | EditorInputCapabilities.Singleton;
	}

	private constructor() {
		super();
	}

	override matches(otherInput: EditorInput | IUntypedEditorInput): boolean {
		return super.matches(otherInput) || otherInput instanceof OmenSettingsEditorInput;
	}

	override get typeId(): string {
		return OMEN_SETTINGS_EDITOR_INPUT_ID;
	}

	override getName(): string {
		return localize('omenSettingsEditorInputName', "Omen IDE Settings");
	}

	override getIcon(): ThemeIcon {
		return OmenSettingsEditorIcon;
	}

	override async resolve(): Promise<null> {
		return null;
	}

	override dispose(): void {
		if (OmenSettingsEditorInput._instance === this) {
			OmenSettingsEditorInput._instance = undefined;
		}
		super.dispose();
	}
}
