/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { KeyCode, KeyMod } from '../../../../../base/common/keyCodes.js';
import { localize, localize2 } from '../../../../../nls.js';
import { Action2, MenuId, registerAction2 } from '../../../../../platform/actions/common/actions.js';
import { ContextKeyExpr } from '../../../../../platform/contextkey/common/contextkey.js';
import { SyncDescriptor } from '../../../../../platform/instantiation/common/descriptors.js';
import { IInstantiationService, ServicesAccessor } from '../../../../../platform/instantiation/common/instantiation.js';
import { KeybindingWeight } from '../../../../../platform/keybinding/common/keybindingsRegistry.js';
import { IProductService } from '../../../../../platform/product/common/productService.js';
import { Registry } from '../../../../../platform/registry/common/platform.js';
import { EditorPaneDescriptor, IEditorPaneRegistry } from '../../../../browser/editor.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../../common/contributions.js';
import { EditorExtensions, IEditorFactoryRegistry, IEditorSerializer } from '../../../../common/editor.js';
import { EditorInput } from '../../../../common/editor/editorInput.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { usesFeatherlessOnlyProvider } from '../../../../services/chat/common/featherless.js';
import { ChatEntitlementContextKeys } from '../../../../services/chat/common/chatEntitlementService.js';
import {
	OMEN_SETTINGS_EDITOR_ID,
	OMEN_SETTINGS_EDITOR_INPUT_ID,
	OMEN_SETTINGS_OPEN_COMMAND,
	OmenSettingsSection,
} from './omenSettings.js';
import { OmenSettingsEditor } from './omenSettingsEditor.js';
import { OmenSettingsEditorInput } from './omenSettingsEditorInput.js';

const WHEN_FEATHERLESS_OMEN = ContextKeyExpr.equals(ChatEntitlementContextKeys.clientByokEnabled.key, true);

Registry.as<IEditorPaneRegistry>(EditorExtensions.EditorPane).registerEditorPane(
	EditorPaneDescriptor.create(
		OmenSettingsEditor,
		OMEN_SETTINGS_EDITOR_ID,
		localize('omenSettingsEditor', "Omen IDE Settings")
	),
	[
		new SyncDescriptor(OmenSettingsEditorInput as unknown as { new(): OmenSettingsEditorInput })
	]
);

class OmenSettingsEditorInputSerializer implements IEditorSerializer {
	canSerialize(editorInput: EditorInput): boolean {
		return editorInput instanceof OmenSettingsEditorInput;
	}

	serialize(_input: OmenSettingsEditorInput): string {
		return '';
	}

	deserialize(_instantiationService: IInstantiationService): OmenSettingsEditorInput {
		return OmenSettingsEditorInput.getOrCreate();
	}
}

Registry.as<IEditorFactoryRegistry>(EditorExtensions.EditorFactory).registerEditorSerializer(
	OMEN_SETTINGS_EDITOR_INPUT_ID,
	OmenSettingsEditorInputSerializer
);

class OmenSettingsContribution implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.omenSettings';

	constructor(
		@IProductService productService: IProductService,
	) {
		if (!usesFeatherlessOnlyProvider(productService)) {
			return;
		}
		this.registerActions();
	}

	private registerActions(): void {
		registerAction2(class extends Action2 {
			constructor() {
				super({
					id: OMEN_SETTINGS_OPEN_COMMAND,
					title: localize2('openOmenSettings', "Omen IDE Settings"),
					category: localize2('omenIDE.category', "Omen IDE"),
					f1: true,
					keybinding: {
						weight: KeybindingWeight.SessionsContrib,
						primary: KeyMod.CtrlCmd | KeyCode.Comma,
						when: WHEN_FEATHERLESS_OMEN,
					},
					menu: [
						{
							id: MenuId.MenubarPreferencesMenu,
							group: '2_configuration',
							order: 1,
							when: WHEN_FEATHERLESS_OMEN,
						},
						{
							id: MenuId.GlobalActivity,
							group: '2_configuration',
							order: 1,
							when: WHEN_FEATHERLESS_OMEN,
						},
					],
				});
			}

			async run(accessor: ServicesAccessor, section?: OmenSettingsSection): Promise<void> {
				const editorService = accessor.get(IEditorService);
				const input = OmenSettingsEditorInput.getOrCreate();
				const pane = await editorService.openEditor(input, { pinned: true });
				if (section && pane instanceof OmenSettingsEditor) {
					pane.selectSection(section);
				}
			}
		});
	}
}

registerWorkbenchContribution2(OmenSettingsContribution.ID, OmenSettingsContribution, WorkbenchPhase.AfterRestored);
