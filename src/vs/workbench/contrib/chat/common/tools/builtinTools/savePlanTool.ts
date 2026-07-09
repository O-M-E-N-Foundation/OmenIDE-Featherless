/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from '../../../../../../base/common/codicons.js';
import { MarkdownString } from '../../../../../../base/common/htmlContent.js';
import { IJSONSchema, IJSONSchemaMap } from '../../../../../../base/common/jsonSchema.js';
import { Disposable } from '../../../../../../base/common/lifecycle.js';
import { ThemeIcon } from '../../../../../../base/common/themables.js';
import { URI } from '../../../../../../base/common/uri.js';
import { localize } from '../../../../../../nls.js';
import { ILogService } from '../../../../../../platform/log/common/log.js';
import { IChatService } from '../../chatService/chatService.js';
import { IChatRequestModel } from '../../model/chatModel.js';
import { ChatCreatedPlanData } from '../../model/chatProgressTypes/chatCreatedPlanData.js';
import { IWorkspacePlanService } from '../../plan/workspacePlanService.js';
import { IChatArtifactsService } from '../chatArtifactsService.js';
import { CountTokensCallback, IPreparedToolInvocation, IToolData, IToolImpl, IToolInvocation, IToolInvocationPreparationContext, IToolResult, ToolDataSource, ToolProgress } from '../languageModelToolsService.js';

export const SavePlanToolId = 'vscode_savePlan';

export interface ISavePlanParams {
	readonly title: string;
	readonly content: string;
	readonly overview: string;
}

export function createSavePlanToolData(): IToolData {
	const inputSchema: IJSONSchema & { properties: IJSONSchemaMap } = {
		type: 'object',
		properties: {
			title: {
				type: 'string',
				description: 'Short plan title (2-10 words).'
			},
			content: {
				type: 'string',
				description: 'Full markdown plan body (without frontmatter).'
			},
			overview: {
				type: 'string',
				description: '1-3 sentence TL;DR shown in the Created Plan chat card.'
			}
		},
		required: ['title', 'content', 'overview']
	};

	return {
		id: SavePlanToolId,
		source: ToolDataSource.Internal,
		icon: ThemeIcon.fromId(Codicon.tasklist.id),
		displayName: localize('tool.savePlan.displayName', 'Save Plan'),
		userDescription: localize('tool.savePlan.userDescription', 'Save a plan to the workspace and show it for review.'),
		modelDescription: 'Save the plan to the workspace `.omen/plans/` directory and show a Created Plan card with View Plan and Build buttons. Call this once the plan is ready. Provide title, full markdown content, and a short overview for the chat card.',
		inputSchema,
		canBeReferencedInPrompt: true,
		tags: ['plan'],
	};
}

export const SavePlanToolData: IToolData = createSavePlanToolData();

export class SavePlanTool extends Disposable implements IToolImpl {

	constructor(
		@IChatService private readonly chatService: IChatService,
		@IWorkspacePlanService private readonly workspacePlanService: IWorkspacePlanService,
		@IChatArtifactsService private readonly chatArtifactsService: IChatArtifactsService,
		@ILogService private readonly logService: ILogService,
	) {
		super();
	}

	async invoke(invocation: IToolInvocation, _countTokens: CountTokensCallback, _progress: ToolProgress): Promise<IToolResult> {
		const parameters = invocation.parameters as ISavePlanParams;
		const { title, content, overview } = parameters;

		if (!title?.trim() || !content?.trim() || !overview?.trim()) {
			throw new Error(localize('savePlanTool.missingFields', 'title, content, and overview are required.'));
		}

		const { request } = this.getRequest(invocation.context?.sessionResource, invocation.chatRequestId);
		if (!request) {
			this.logService.warn('[SavePlanTool] Missing chat context.');
			throw new Error(localize('savePlanTool.noContext', 'No active chat request.'));
		}

		const planUri = await this.workspacePlanService.createPlan({
			sessionResource: invocation.context?.sessionResource,
			title: title.trim(),
			content: content.trim(),
			overview: overview.trim(),
		});

		const createdPlan = new ChatCreatedPlanData(
			title.trim(),
			overview.trim(),
			planUri.toJSON(),
			false,
		);
		this.chatService.appendProgress(request, createdPlan);

		if (invocation.context?.sessionResource) {
			const artifacts = this.chatArtifactsService.getArtifacts(invocation.context.sessionResource);
			artifacts.setAgentArtifacts([{
				label: title.trim(),
				uri: planUri.toString(),
				type: 'plan',
				groupName: 'Plans',
			}]);
		}

		return {
			content: [{ kind: 'text', value: JSON.stringify({ planUri: planUri.toString(), title: title.trim() }) }]
		};
	}

	async prepareToolInvocation(_context: IToolInvocationPreparationContext): Promise<IPreparedToolInvocation | undefined> {
		return {
			invocationMessage: new MarkdownString(localize('savePlanTool.invocation', 'Saving plan to workspace')),
			pastTenseMessage: new MarkdownString(localize('savePlanTool.invocation.past', 'Saved plan to workspace'))
		};
	}

	private getRequest(chatSessionResource: URI | undefined, chatRequestId: string | undefined): { request: IChatRequestModel | undefined } {
		if (!chatSessionResource) {
			return { request: undefined };
		}
		const model = this.chatService.getSession(chatSessionResource);
		if (!model) {
			return { request: undefined };
		}
		let request: IChatRequestModel | undefined;
		if (chatRequestId) {
			request = model.getRequests().find(r => r.id === chatRequestId);
		}
		if (!request) {
			request = model.getRequests().at(-1);
		}
		return { request };
	}
}
