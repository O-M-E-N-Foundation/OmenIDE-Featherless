/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './media/chatViewSessionTabBar.css';
import { $, addDisposableListener, DisposableResizeObserver, EventType, reset } from '../../../../../../base/browser/dom.js';
import { ScrollableElement } from '../../../../../../base/browser/ui/scrollbar/scrollableElement.js';
import { Codicon } from '../../../../../../base/common/codicons.js';
import { Emitter, Event } from '../../../../../../base/common/event.js';
import { Disposable, DisposableStore } from '../../../../../../base/common/lifecycle.js';
import { isEqual } from '../../../../../../base/common/resources.js';
import { ScrollbarVisibility } from '../../../../../../base/common/scrollable.js';
import { ThemeIcon } from '../../../../../../base/common/themables.js';
import { URI } from '../../../../../../base/common/uri.js';
import { localize } from '../../../../../../nls.js';
import { IHoverService } from '../../../../../../platform/hover/browser/hover.js';
import { getDefaultHoverDelegate } from '../../../../../../base/browser/ui/hover/hoverDelegateFactory.js';
import { ChatViewOpenTabsModel } from './chatViewOpenTabsModel.js';

export interface IChatViewSessionTabBarDelegate {
	readonly getTitle: (resource: URI) => string;
	readonly openNew: () => void | Promise<void>;
	readonly activate: (resource: URI) => void | Promise<void>;
	readonly close: (resource: URI) => void | Promise<void>;
}

/**
 * Cursor-style tab strip for open chats in the main Chat view pane.
 */
export class ChatViewSessionTabBar extends Disposable {

	private readonly _container: HTMLElement;
	private readonly _tabsContainer: HTMLElement;
	private readonly _tabsScrollbar: ScrollableElement;
	private readonly _tabDisposables = this._register(new DisposableStore());

	private readonly _onDidChangeHeight = this._register(new Emitter<void>());
	readonly onDidChangeHeight: Event<void> = this._onDidChangeHeight.event;

	get element(): HTMLElement {
		return this._container;
	}

	get height(): number {
		return this._container.style.display === 'none' ? 0 : this._container.offsetHeight;
	}

	constructor(
		private readonly _model: ChatViewOpenTabsModel,
		private readonly _delegate: IChatViewSessionTabBarDelegate,
		@IHoverService private readonly _hoverService: IHoverService,
	) {
		super();

		this._container = $('.chat-view-session-tab-bar');
		const row = $('.chat-view-session-tab-bar-row');
		this._container.appendChild(row);

		this._tabsContainer = $('.chat-view-session-tab-bar-tabs');
		this._tabsContainer.setAttribute('role', 'tablist');
		this._tabsContainer.setAttribute('aria-label', localize('chatViewSessionTabs', "Open chats"));
		this._tabsScrollbar = this._register(new ScrollableElement(this._tabsContainer, {
			horizontal: ScrollbarVisibility.Hidden,
			vertical: ScrollbarVisibility.Hidden,
			scrollYToX: true,
			useShadows: false,
		}));
		row.appendChild(this._tabsScrollbar.getDomNode());

		const newButton = $('button.chat-view-session-tab-bar-new');
		newButton.title = localize('chatViewNewSessionTab', "New Chat");
		newButton.setAttribute('aria-label', localize('chatViewNewSessionTab', "New Chat"));
		const newIcon = $('span');
		newIcon.classList.add(...ThemeIcon.asClassNameArray(Codicon.add));
		newButton.appendChild(newIcon);
		row.appendChild(newButton);
		this._register(addDisposableListener(newButton, EventType.CLICK, () => {
			void this._delegate.openNew();
		}));

		this._register(addDisposableListener(this._tabsContainer, EventType.SCROLL, () => {
			this._tabsScrollbar.setScrollPosition({ scrollLeft: this._tabsContainer.scrollLeft });
		}));
		this._register(this._tabsScrollbar.onScroll(e => {
			if (e.scrollLeftChanged) {
				this._tabsContainer.scrollLeft = e.scrollLeft;
			}
		}));

		const resizeObserver = this._register(new DisposableResizeObserver('ChatViewSessionTabBar', () => {
			this._updateScrollDimensions();
			this._onDidChangeHeight.fire();
		}));
		this._register(resizeObserver.observe(this._container));
		this._register(resizeObserver.observe(this._tabsContainer));

		this._register(this._model.onDidChange(() => this.render()));
		this.render();
	}

	render(): void {
		this._tabDisposables.clear();
		reset(this._tabsContainer);

		const tabs = this._model.tabs;
		const active = this._model.active;
		this._container.style.display = tabs.length > 0 ? '' : 'none';

		for (const tab of tabs) {
			this._createTab(tab.resource, !!active && isEqual(active, tab.resource));
		}

		this._updateScrollDimensions();
		this._onDidChangeHeight.fire();
	}

	private _createTab(resource: URI, isActive: boolean): void {
		const tab = $('.chat-view-session-tab');
		tab.tabIndex = 0;
		tab.setAttribute('role', 'tab');
		tab.setAttribute('aria-selected', String(isActive));
		tab.dataset.sessionResource = resource.toString();
		tab.classList.toggle('active', isActive);

		const label = $('.chat-view-session-tab-label');
		const title = this._delegate.getTitle(resource);
		label.textContent = title;
		tab.appendChild(label);

		const close = $('button.chat-view-session-tab-close');
		close.title = localize('chatViewCloseTab', "Close");
		close.setAttribute('aria-label', localize('chatViewCloseTab', "Close"));
		const closeIcon = $('span');
		closeIcon.classList.add(...ThemeIcon.asClassNameArray(Codicon.close));
		close.appendChild(closeIcon);
		tab.appendChild(close);

		this._tabDisposables.add(this._hoverService.setupManagedHover(
			getDefaultHoverDelegate('element'),
			tab,
			() => this._delegate.getTitle(resource),
		));

		this._tabsContainer.appendChild(tab);

		this._tabDisposables.add(addDisposableListener(tab, EventType.CLICK, e => {
			if ((e.target as HTMLElement).closest('.chat-view-session-tab-close')) {
				return;
			}
			void this._delegate.activate(resource);
		}));
		this._tabDisposables.add(addDisposableListener(tab, EventType.KEY_DOWN, (e: KeyboardEvent) => {
			if (e.key === 'Enter' || e.key === ' ') {
				e.preventDefault();
				void this._delegate.activate(resource);
			}
		}));
		this._tabDisposables.add(addDisposableListener(close, EventType.MOUSE_DOWN, e => {
			// Handle on mousedown so the tab's click-to-activate path cannot win the race.
			e.preventDefault();
			e.stopPropagation();
			void this._delegate.close(resource);
		}));
		this._tabDisposables.add(addDisposableListener(close, EventType.CLICK, e => {
			e.preventDefault();
			e.stopPropagation();
		}));
		this._tabDisposables.add(addDisposableListener(tab, EventType.AUXCLICK, (e: MouseEvent) => {
			if (e.button === 1) {
				e.preventDefault();
				void this._delegate.close(resource);
			}
		}));

		if (isActive) {
			tab.scrollIntoView({ block: 'nearest', inline: 'nearest' });
		}
	}

	private _updateScrollDimensions(): void {
		this._tabsScrollbar.setScrollDimensions({
			width: this._tabsContainer.clientWidth,
			scrollWidth: this._tabsContainer.scrollWidth,
		});
	}
}
