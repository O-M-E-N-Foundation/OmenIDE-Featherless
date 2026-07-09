/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { localize, localize2 } from '../../../../../nls.js';
import { Action2, MenuId, MenuRegistry, registerAction2 } from '../../../../../platform/actions/common/actions.js';
import { ContextKeyExpr, IContextKey, IContextKeyService, RawContextKey } from '../../../../../platform/contextkey/common/contextkey.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { ServicesAccessor } from '../../../../../platform/instantiation/common/instantiation.js';
import { KeyCode, KeyMod } from '../../../../../base/common/keyCodes.js';
import { KeybindingWeight } from '../../../../../platform/keybinding/common/keybindingsRegistry.js';
import { Codicon } from '../../../../../base/common/codicons.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../../common/contributions.js';
import { ChatConfiguration } from '../../common/constants.js';
import { ChatMode } from '../../common/chatModes.js';
import { IWorkspacePlanService } from '../../common/plan/workspacePlanService.js';
import { IPlanBuildService } from '../plan/planBuildService.js';
import { IChatWidgetService, ChatViewId } from '../chat.js';
import { ILanguageModelsService } from '../../common/languageModels.js';
import { IQuickInputService } from '../../../../../platform/quickinput/common/quickInput.js';
import { IViewsService } from '../../../../services/views/common/viewsService.js';

export const OmenPlanEditorContext = new RawContextKey<boolean>('resourceIsOmenPlan', false, localize('resourceIsOmenPlan', "Whether the active editor is an Omen plan file"));

export const OpenPlanModeActionId = 'workbench.action.chat.openPlan';
export const BuildPlanActionId = 'omen.plan.build';
export const OpenPlanPreviewActionId = 'omen.plan.openPreview';
export const OpenPlanSourceActionId = 'omen.plan.openSource';

class OmenPlanContextKeysContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.omenPlanContextKeys';

	private readonly _isOmenPlan: IContextKey<boolean>;

	constructor(
		@IEditorService private readonly editorService: IEditorService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IWorkspacePlanService private readonly workspacePlanService: IWorkspacePlanService,
	) {
		super();
		this._isOmenPlan = OmenPlanEditorContext.bindTo(contextKeyService);
		this._register(this.editorService.onDidActiveEditorChange(() => this.updateContext()));
		this.updateContext();
	}

	private updateContext(): void {
		const resource = this.editorService.activeEditor?.resource;
		this._isOmenPlan.set(!!resource && this.workspacePlanService.isOmenPlanUri(resource));
	}
}

class OmenPlanDefaultPreviewContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.omenPlanDefaultPreview';

	private readonly _opened = new Set<string>();

	constructor(
		@IEditorService private readonly editorService: IEditorService,
		@ICommandService private readonly commandService: ICommandService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IWorkspacePlanService private readonly workspacePlanService: IWorkspacePlanService,
	) {
		super();
		this._register(this.editorService.onDidActiveEditorChange(() => this.maybeOpenPreview()));
	}

	private maybeOpenPreview(): void {
		if (!this.configurationService.getValue<boolean>(ChatConfiguration.OmenPlanOpenPreviewByDefault)) {
			return;
		}
		const resource = this.editorService.activeEditor?.resource;
		if (!resource || !this.workspacePlanService.isOmenPlanUri(resource)) {
			return;
		}
		const key = resource.toString();
		if (this._opened.has(key)) {
			return;
		}
		this._opened.add(key);
		void this.commandService.executeCommand(OpenPlanPreviewActionId, resource);
	}
}

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: OpenPlanModeActionId,
			title: localize2('openPlanMode', "Open Plan Mode"),
			category: localize2('chat.category', 'Chat'),
			f1: true,
			icon: Codicon.tasklist,
		});
	}
	async run(accessor: ServicesAccessor): Promise<void> {
		const viewsService = accessor.get(IViewsService);
		const widgetService = accessor.get(IChatWidgetService);
		await viewsService.openView(ChatViewId);
		const widget = widgetService.lastFocusedWidget;
		widget?.input.setChatMode(ChatMode.Plan.id, true, true);
		widget?.focusInput();
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: BuildPlanActionId,
			title: localize2('buildPlan', "Build Plan"),
			icon: Codicon.play,
			keybinding: {
				primary: KeyMod.CtrlCmd | KeyCode.Enter,
				when: OmenPlanEditorContext,
				weight: KeybindingWeight.WorkbenchContrib,
			},
			menu: [{
				id: MenuId.EditorTitle,
				when: ContextKeyExpr.and(OmenPlanEditorContext, ContextKeyExpr.has('omenPlan.isBuilt').negate()),
				group: 'navigation',
				order: 1,
			}],
		});
	}
	async run(accessor: ServicesAccessor, resource?: URI): Promise<void> {
		const editorService = accessor.get(IEditorService);
		const planBuildService = accessor.get(IPlanBuildService);
		const planUri = resource ?? editorService.activeEditor?.resource;
		if (!planUri) {
			return;
		}
		await planBuildService.executeBuild(planUri);
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: OpenPlanPreviewActionId,
			title: localize2('openPlanPreview', "Open Preview"),
			menu: [{
				id: MenuId.EditorTitle,
				when: OmenPlanEditorContext,
				group: 'navigation',
				order: 3,
			}],
		});
	}
	async run(accessor: ServicesAccessor, resource?: URI): Promise<void> {
		const editorService = accessor.get(IEditorService);
		const uri = resource ?? editorService.activeEditor?.resource;
		if (!uri) {
			return;
		}
		await accessor.get(ICommandService).executeCommand('markdown.showPreview', uri);
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: OpenPlanSourceActionId,
			title: localize2('openPlanSource', "Open Source"),
			menu: [{
				id: MenuId.EditorTitle,
				when: OmenPlanEditorContext,
				group: 'navigation',
				order: 4,
			}],
		});
	}
	async run(accessor: ServicesAccessor): Promise<void> {
		const editorService = accessor.get(IEditorService);
		const uri = editorService.activeEditor?.resource;
		if (!uri) {
			return;
		}
		await editorService.openEditor({ resource: uri, options: { override: 'default' } });
	}
});

export const SelectPlanBuildModelActionId = 'omen.plan.selectBuildModel';

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: SelectPlanBuildModelActionId,
			title: localize2('selectPlanBuildModel', "Select Build Model"),
			menu: [{
				id: MenuId.EditorTitle,
				when: OmenPlanEditorContext,
				group: 'navigation',
				order: 0,
			}],
		});
	}
	async run(accessor: ServicesAccessor): Promise<void> {
		const editorService = accessor.get(IEditorService);
		const workspacePlanService = accessor.get(IWorkspacePlanService);
		const languageModelsService = accessor.get(ILanguageModelsService);
		const quickInputService = accessor.get(IQuickInputService);
		const uri = editorService.activeEditor?.resource;
		if (!uri) {
			return;
		}
		const models = languageModelsService.getLanguageModelIds()
			.map(id => ({ id, meta: languageModelsService.lookupLanguageModel(id) }))
			.filter((m): m is { id: string; meta: NonNullable<typeof m.meta> } => !!m.meta);
		const pick = await quickInputService.pick(
			models.map(m => ({ label: m.meta.name, description: m.id })),
			{ placeHolder: localize('selectPlanBuildModelPlaceholder', 'Model for building this plan') },
		);
		if (pick?.description) {
			await workspacePlanService.setBuildModel(uri, pick.description);
		}
	}
});

export const OmenPlanBuiltContext = new RawContextKey<boolean>('omenPlan.isBuilt', false);

class OmenPlanBuiltStatusContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.omenPlanBuiltStatus';

	private readonly _isBuilt: IContextKey<boolean>;

	constructor(
		@IEditorService private readonly editorService: IEditorService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IWorkspacePlanService private readonly workspacePlanService: IWorkspacePlanService,
		@IPlanBuildService planBuildService: IPlanBuildService,
	) {
		super();
		this._isBuilt = OmenPlanBuiltContext.bindTo(contextKeyService);
		const update = () => this.updateBuiltState();
		this._register(this.editorService.onDidActiveEditorChange(update));
		this._register(planBuildService.onDidBuildPlan(update));
		this._register(workspacePlanService.onDidChangePlan(update));
		update();
	}

	private async updateBuiltState(): Promise<void> {
		const resource = this.editorService.activeEditor?.resource;
		if (!resource || !this.workspacePlanService.isOmenPlanUri(resource)) {
			this._isBuilt.set(false);
			return;
		}
		const metadata = await this.workspacePlanService.getPlanMetadata(resource);
		this._isBuilt.set(!!metadata.built);
	}
}

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'omen.plan.builtStatus',
			title: localize2('omen.plan.builtStatus', "Built"),
			precondition: OmenPlanBuiltContext,
		});
	}
	async run(): Promise<void> { }
});

MenuRegistry.appendMenuItem(MenuId.EditorTitle, {
	command: {
		id: 'omen.plan.builtStatus',
		title: localize('omen.plan.built', "Built"),
		precondition: OmenPlanBuiltContext,
	},
	when: OmenPlanBuiltContext,
	group: 'navigation',
	order: 2,
});

registerWorkbenchContribution2(OmenPlanContextKeysContribution.ID, OmenPlanContextKeysContribution, WorkbenchPhase.BlockRestore);
registerWorkbenchContribution2(OmenPlanDefaultPreviewContribution.ID, OmenPlanDefaultPreviewContribution, WorkbenchPhase.AfterRestored);
registerWorkbenchContribution2(OmenPlanBuiltStatusContribution.ID, OmenPlanBuiltStatusContribution, WorkbenchPhase.AfterRestored);
