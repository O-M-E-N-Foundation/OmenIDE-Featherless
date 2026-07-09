/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from '../../../../../../base/browser/dom.js';
import { StandardKeyboardEvent } from '../../../../../../base/browser/keyboardEvent.js';
import { ButtonWithDropdown, IButton } from '../../../../../../base/browser/ui/button/button.js';
import { Action } from '../../../../../../base/common/actions.js';
import { Codicon } from '../../../../../../base/common/codicons.js';
import { ThemeIcon } from '../../../../../../base/common/themables.js';
import { Emitter, Event } from '../../../../../../base/common/event.js';
import { KeyCode } from '../../../../../../base/common/keyCodes.js';
import { Disposable, DisposableStore } from '../../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../../base/common/uri.js';
import { localize } from '../../../../../../nls.js';
import { ICommandService } from '../../../../../../platform/commands/common/commands.js';
import { IContextMenuService } from '../../../../../../platform/contextview/browser/contextView.js';
import { defaultButtonStyles } from '../../../../../../platform/theme/browser/defaultStyles.js';
import { IChatCreatedPlan } from '../../../common/chatService/chatService.js';
import { ChatCreatedPlanData } from '../../../common/model/chatProgressTypes/chatCreatedPlanData.js';
import { IChatRendererContent } from '../../../common/model/chatViewModel.js';
import { IPlanBuildService } from '../../plan/planBuildService.js';
import { ChatTreeItem } from '../../chat.js';
import { IChatContentPart, IChatContentPartRenderContext } from './chatContentParts.js';
import './media/chatCreatedPlan.css';

const MAX_OVERVIEW_LENGTH = 280;

export class ChatCreatedPlanPart extends Disposable implements IChatContentPart {
	public readonly domNode: HTMLElement;

	private readonly _onDidChangeHeight = this._register(new Emitter<void>());
	public readonly onDidChangeHeight: Event<void> = this._onDidChangeHeight.event;

	private readonly _buttonStore = this._register(new DisposableStore());
	private _buildButton: IButton | undefined;

	constructor(
		public readonly plan: IChatCreatedPlan,
		_context: IChatContentPartRenderContext,
		@ICommandService private readonly _commandService: ICommandService,
		@IPlanBuildService private readonly _planBuildService: IPlanBuildService,
		@IContextMenuService private readonly _contextMenuService: IContextMenuService,
	) {
		super();

		const elements = dom.h('.chat-created-plan-card@card', [
			dom.h('.chat-created-plan-eyebrow@eyebrow'),
			dom.h('.chat-created-plan-title@title'),
			dom.h('.chat-created-plan-overview@overview'),
			dom.h('.chat-created-plan-actions@actions', [
				dom.h('.chat-created-plan-view-link@viewLink'),
				dom.h('.chat-created-plan-build@buildContainer'),
			]),
		]);

		this.domNode = elements.card;
		elements.eyebrow.textContent = localize('chat.createdPlan.eyebrow', 'Created Plan');
		elements.title.textContent = plan.title;

		const overview = plan.overview.length > MAX_OVERVIEW_LENGTH
			? `${plan.overview.slice(0, MAX_OVERVIEW_LENGTH).trimEnd()}…`
			: plan.overview;
		elements.overview.textContent = overview;

		const viewLink = elements.viewLink;
		viewLink.textContent = localize('chat.createdPlan.viewPlan', 'View Plan');
		viewLink.setAttribute('role', 'button');
		viewLink.tabIndex = 0;
		this._register(dom.addDisposableListener(viewLink, 'click', () => this.viewPlan()));
		this._register(dom.addDisposableListener(viewLink, 'keydown', (e) => {
			const event = new StandardKeyboardEvent(e);
			if (event.equals(KeyCode.Enter) || event.equals(KeyCode.Space)) {
				event.preventDefault();
				this.viewPlan();
			}
		}));

		this.renderBuildButton(elements.buildContainer);
		this._register(this._planBuildService.onDidBuildPlan(uri => {
			if (URI.revive(plan.planUri).toString() === uri.toString()) {
				plan.built = true;
				if (this.plan instanceof ChatCreatedPlanData) {
					// mutate for in-session updates
				}
				this.renderBuildButton(elements.buildContainer);
			}
		}));

		this._register(dom.addDisposableListener(this.domNode, 'keydown', (e) => {
			const event = new StandardKeyboardEvent(e);
			if (event.ctrlKey && event.keyCode === KeyCode.Enter && !plan.built) {
				event.preventDefault();
				void this.buildPlan();
			}
		}));
	}

	hasSameContent(other: IChatRendererContent, _followingContent: IChatRendererContent[], _element: ChatTreeItem): boolean {
		return other.kind === 'createdPlan'
			&& other.title === this.plan.title
			&& other.overview === this.plan.overview
			&& !!other.built === !!this.plan.built;
	}

	private renderBuildButton(container: HTMLElement): void {
		this._buttonStore.clear();
		dom.clearNode(container);

		if (this.plan.built) {
			const built = dom.append(container, dom.$('.chat-created-plan-built'));
			built.textContent = localize('chat.createdPlan.built', 'Built');
			const icon = dom.append(built, dom.$('span'));
			icon.classList.add(...ThemeIcon.asClassNameArray(Codicon.check));
			return;
		}

		const buildLabel = localize('chat.createdPlan.build', 'Build');
		const buildTooltip = localize('chat.createdPlan.buildTooltip', 'Build plan (Ctrl+Enter)');

		const dropdownActions = [
			new Action('omen.plan.build.agent', localize('chat.createdPlan.buildAgent', 'Build in Agent mode'), undefined, true, () => {
				void this.buildPlan();
				return Promise.resolve();
			}),
			new Action('omen.plan.openFile', localize('chat.createdPlan.openFile', 'Open plan file'), undefined, true, () => {
				void this._commandService.executeCommand('vscode.open', URI.revive(this.plan.planUri));
				return Promise.resolve();
			}),
		];

		this._buildButton = this._buttonStore.add(new ButtonWithDropdown(container, {
			...defaultButtonStyles,
			supportIcons: true,
			title: buildTooltip,
			actions: dropdownActions,
			contextMenuProvider: this._contextMenuService,
			addPrimaryActionToDropdown: false,
		}));
		this._buildButton.element.classList.add('chat-created-plan-build-button');
		this._buildButton.label = `${buildLabel}  Ctrl+Enter`;
		this._buttonStore.add(this._buildButton.onDidClick(() => this.buildPlan()));
	}

	private viewPlan(): void {
		const uri = URI.revive(this.plan.planUri);
		void this._commandService.executeCommand('markdown.showPreview', uri);
	}

	private async buildPlan(): Promise<void> {
		await this._planBuildService.executeBuild(URI.revive(this.plan.planUri));
	}
}
