/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { mainWindow } from '../../../../../base/browser/window.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { basename } from '../../../../../base/common/resources.js';
import Severity from '../../../../../base/common/severity.js';
import { URI } from '../../../../../base/common/uri.js';
import { localize } from '../../../../../nls.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';
import { INotificationHandle, INotificationService, IPromptChoice } from '../../../../../platform/notification/common/notification.js';
import { ChatMode } from '../../common/chatModes.js';
import { ChatConfiguration } from '../../common/constants.js';
import { IWorkspacePlanService } from '../../common/plan/workspacePlanService.js';
import { IChatWidgetService } from '../chat.js';

export const IPlanBuildService = createDecorator<IPlanBuildService>('planBuildService');

export interface IPlanBuildOptions {
	readonly model?: string;
	readonly autopilot?: boolean;
	readonly sessionResource?: URI;
}

export interface IPlanBuildService {
	readonly _serviceBrand: undefined;
	readonly onDidBuildPlan: Event<URI>;
	executeBuild(planUri: URI, options?: IPlanBuildOptions): Promise<void>;
}

export class PlanBuildService extends Disposable implements IPlanBuildService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidBuildPlan = this._register(new Emitter<URI>());
	readonly onDidBuildPlan = this._onDidBuildPlan.event;

	private _activeNotificationHandle: INotificationHandle | undefined;
	private _activeTimeout: ReturnType<typeof mainWindow.setTimeout> | undefined;

	constructor(
		@IWorkspacePlanService private readonly workspacePlanService: IWorkspacePlanService,
		@IChatWidgetService private readonly chatWidgetService: IChatWidgetService,
		@INotificationService private readonly notificationService: INotificationService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
	) {
		super();
	}

	async executeBuild(planUri: URI, options?: IPlanBuildOptions): Promise<void> {
		const widget = this.chatWidgetService.lastFocusedWidget;
		if (!widget) {
			return;
		}

		const confirmed = await this.promptSwitchToAgent();
		if (!confirmed) {
			return;
		}

		const defaultModel = this.configurationService.getValue<string>(ChatConfiguration.OmenPlanDefaultBuildModel);
		const metadata = await this.workspacePlanService.getPlanMetadata(planUri);
		const modelToUse = options?.model ?? metadata.buildModel ?? defaultModel;

		widget.input.setChatMode(ChatMode.Agent.id, true, true);
		if (modelToUse) {
			widget.input.switchModelByQualifiedName([modelToUse]);
			await this.workspacePlanService.setBuildModel(planUri, modelToUse);
		}

		const relativeName = basename(planUri);
		const prompt = localize(
			'omen.plan.buildPrompt',
			"Implement the plan in {0}. Follow the plan steps exactly.",
			relativeName,
		);

		widget.input.attachmentModel.addFile(planUri);
		widget.input.setValue(prompt, false);
		widget.input.focus();
		await widget.acceptInput();

		await this.workspacePlanService.markBuilt(planUri, {
			model: modelToUse,
			session: options?.sessionResource?.toString() ?? widget.viewModel?.model.sessionResource?.toString(),
		});
		this._onDidBuildPlan.fire(planUri);
	}

	private promptSwitchToAgent(): Promise<boolean> {
		this.clearActivePrompt();

		return new Promise<boolean>(resolve => {
			let resolved = false;
			const finish = (value: boolean) => {
				if (resolved) {
					return;
				}
				resolved = true;
				this.clearActivePrompt();
				resolve(value);
			};

			const timeoutSeconds = this.configurationService.getValue<number>(ChatConfiguration.OmenPlanBuildSwitchTimeoutSeconds) ?? 30;
			let remaining = timeoutSeconds;

			const updateMessage = () => localize(
				'omen.plan.switchToAgentMessage',
				"Switch to Agent mode to build this plan? Auto-switching in {0}s.",
				remaining,
			);

			const choices: IPromptChoice[] = [
				{
					label: localize('omen.plan.switch', "Switch"),
					run: () => finish(true),
				},
				{
					label: localize('omen.plan.cancel', "Cancel"),
					run: () => finish(false),
				},
			];

			const handle = this.notificationService.prompt(
				Severity.Info,
				updateMessage(),
				choices,
				{ sticky: true },
			);
			this._activeNotificationHandle = handle;

			const interval = mainWindow.setInterval(() => {
				remaining -= 1;
				if (remaining <= 0) {
					mainWindow.clearInterval(interval);
					finish(true);
					handle.close();
					return;
				}
				handle.updateMessage(updateMessage());
			}, 1000);
			this._activeTimeout = mainWindow.setTimeout(() => {
				mainWindow.clearInterval(interval);
				if (!resolved) {
					handle.close();
					finish(true);
				}
			}, timeoutSeconds * 1000);
		});
	}

	private clearActivePrompt(): void {
		if (this._activeTimeout) {
			mainWindow.clearTimeout(this._activeTimeout);
			this._activeTimeout = undefined;
		}
		this._activeNotificationHandle?.close();
		this._activeNotificationHandle = undefined;
	}
}
