/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './media/sessionCompositeBar.css';
import { Disposable, DisposableStore } from '../../../base/common/lifecycle.js';
import { Emitter, Event } from '../../../base/common/event.js';
import { $, addDisposableListener, DisposableResizeObserver, EventType, reset } from '../../../base/browser/dom.js';
import { ScrollableElement } from '../../../base/browser/ui/scrollbar/scrollableElement.js';
import { ScrollbarVisibility } from '../../../base/common/scrollable.js';
import { autorun } from '../../../base/common/observable.js';
import { IThemeService } from '../../../platform/theme/common/themeService.js';
import { Action } from '../../../base/common/actions.js';
import { ActionBar } from '../../../base/browser/ui/actionbar/actionbar.js';
import { Codicon } from '../../../base/common/codicons.js';
import { ThemeIcon } from '../../../base/common/themables.js';
import { IInstantiationService } from '../../../platform/instantiation/common/instantiation.js';
import { HiddenItemStrategy, MenuWorkbenchToolBar } from '../../../platform/actions/browser/toolbar.js';
import { Menus } from '../menus.js';
import { localize } from '../../../nls.js';
import { SessionStatus } from '../../services/sessions/common/session.js';
import { IActiveSession } from '../../services/sessions/common/sessionsManagement.js';
import { ISessionsService } from '../../services/sessions/browser/sessionsService.js';
import { ISessionsPartService } from '../../services/sessions/browser/sessionsPartService.js';
import { IHoverService } from '../../../platform/hover/browser/hover.js';
import { getDefaultHoverDelegate } from '../../../base/browser/ui/hover/hoverDelegateFactory.js';
import { applySessionBarThemeColors } from './sessionBarStyles.js';

interface ISessionTab {
	readonly session: IActiveSession | undefined;
	readonly element: HTMLElement;
}

/**
 * Part-level composite bar that displays open agent sessions as tabs (Cursor-style).
 * Selecting a tab activates that session; the sessions sidebar remains the full history.
 */
export class SessionCompositeBar extends Disposable {

	private readonly _container: HTMLElement;
	private readonly _tabsRow: HTMLElement;
	private readonly _tabsContainer: HTMLElement;
	private readonly _tabsScrollbar: ScrollableElement;
	private readonly _tabs: ISessionTab[] = [];
	private readonly _tabDisposables = this._register(new DisposableStore());

	private readonly _newSessionAction: Action;
	private readonly _newSessionContainer: HTMLElement;

	private readonly _onDidChangeVisibility = this._register(new Emitter<boolean>());
	readonly onDidChangeVisibility: Event<boolean> = this._onDidChangeVisibility.event;

	private readonly _onDidChangeHeight = this._register(new Emitter<void>());
	readonly onDidChangeHeight: Event<void> = this._onDidChangeHeight.event;

	private _visible = false;
	private _activeSessionId: string | undefined;
	private _boundKey = '';

	get element(): HTMLElement {
		return this._container;
	}

	get visible(): boolean {
		return this._visible;
	}

	get height(): number {
		return this._visible ? this._container.offsetHeight : 0;
	}

	constructor(
		@IThemeService private readonly _themeService: IThemeService,
		@ISessionsService private readonly _sessionsService: ISessionsService,
		@ISessionsPartService private readonly _sessionsPartService: ISessionsPartService,
		@IHoverService private readonly _hoverService: IHoverService,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
	) {
		super();

		this._container = $('.session-composite-bar.session-tabs-bar');

		this._tabsRow = $('.session-composite-bar-tabs-row');
		this._container.appendChild(this._tabsRow);

		this._tabsContainer = $('.session-composite-bar-tabs');
		this._tabsContainer.setAttribute('role', 'tablist');
		this._tabsContainer.setAttribute('aria-label', localize('sessionTabsAriaLabel', "Sessions"));
		this._tabsScrollbar = this._register(new ScrollableElement(this._tabsContainer, {
			horizontal: ScrollbarVisibility.Hidden,
			vertical: ScrollbarVisibility.Hidden,
			scrollYToX: true,
			useShadows: false,
		}));
		this._tabsRow.appendChild(this._tabsScrollbar.getDomNode());

		const newSessionAction = this._newSessionAction = this._register(new Action(
			'sessionCompositeBar.newSession',
			localize('sessionCompositeBar.newSession', "New Session"),
			ThemeIcon.asClassName(Codicon.add),
			true,
			async () => {
				this._sessionsService.openNewSession();
				this._sessionsPartService.focusSession(this._sessionsService.activeSession.get());
			},
		));
		const newSessionActionBar = this._register(new ActionBar(this._tabsRow, { actionViewItemProvider: undefined }));
		newSessionActionBar.push(newSessionAction, { icon: true, label: false });
		this._newSessionContainer = newSessionActionBar.getContainer();
		this._newSessionContainer.classList.add('session-composite-bar-new-session');

		this._register(addDisposableListener(this._tabsContainer, EventType.SCROLL, () => {
			this._tabsScrollbar.setScrollPosition({ scrollLeft: this._tabsContainer.scrollLeft });
		}));
		this._register(this._tabsScrollbar.onScroll(e => {
			if (e.scrollLeftChanged) {
				this._tabsContainer.scrollLeft = e.scrollLeft;
			}
		}));

		const resizeObserver = this._register(new DisposableResizeObserver('SessionCompositeBar.activeTabReveal', () => {
			this._updateScrollDimensions();
			this._revealActiveTab();
		}));
		this._register(resizeObserver.observe(this._tabsContainer));

		const heightObserver = this._register(new DisposableResizeObserver('SessionCompositeBar.height', () => {
			this._onDidChangeHeight.fire();
		}));
		this._register(heightObserver.observe(this._container));

		this._setVisible(false);
		this._updateStyles();
		this._register(this._themeService.onDidColorThemeChange(() => this._updateStyles()));
	}

	/**
	 * Sync the tab strip with the current visible/active sessions.
	 */
	bind(visible: readonly (IActiveSession | undefined)[], active: IActiveSession | undefined): void {
		this._activeSessionId = active?.sessionId;

		const boundKey = visible.map(s => s?.sessionId ?? '').join('\0');
		const sessionsChanged = boundKey !== this._boundKey;
		this._boundKey = boundKey;

		const hasRealOrPlaceholder = visible.length > 0;
		this._setVisible(hasRealOrPlaceholder);
		this._newSessionAction.enabled = true;

		if (sessionsChanged) {
			this._rebuildTabs(visible, active?.sessionId);
		} else {
			this._updateActiveTab(active?.sessionId);
		}
	}

	private _rebuildTabs(sessions: readonly (IActiveSession | undefined)[], activeSessionId: string | undefined): void {
		this._tabDisposables.clear();
		this._tabs.length = 0;
		reset(this._tabsContainer);

		for (const session of sessions) {
			this._createTab(session);
		}

		this._updateActiveTab(activeSessionId);
		this._updateScrollDimensions();
		this._onDidChangeHeight.fire();
	}

	private _updateScrollDimensions(): void {
		this._tabsScrollbar.setScrollDimensions({
			width: this._tabsContainer.clientWidth,
			scrollWidth: this._tabsContainer.scrollWidth,
		});
	}

	private _createTab(session: IActiveSession | undefined): void {
		const tab = $('.session-composite-bar-tab');
		tab.tabIndex = 0;
		tab.setAttribute('role', 'tab');
		if (session) {
			tab.dataset.sessionId = session.sessionId;
		} else {
			tab.dataset.sessionId = '';
			tab.dataset.isNewSession = 'true';
		}

		const pinIcon = $('.session-composite-bar-tab-pin');
		pinIcon.classList.add(...ThemeIcon.asClassNameArray(Codicon.pinned));
		tab.appendChild(pinIcon);

		const labelEl = $('.session-composite-bar-tab-label');
		labelEl.textContent = session
			? session.title.get()
			: localize('sessionCompositeBar.newSessionTab', "New Session");
		tab.appendChild(labelEl);

		const indicator = $('.session-composite-bar-tab-indicator');
		const indicatorIcon = $('.session-composite-bar-tab-indicator-icon');
		indicator.appendChild(indicatorIcon);
		tab.appendChild(indicator);

		this._tabDisposables.add(this._hoverService.setupManagedHover(
			getDefaultHoverDelegate('element'),
			tab,
			() => session ? session.title.get() : localize('sessionCompositeBar.newSessionTab', "New Session"),
		));

		if (session) {
			this._tabDisposables.add(autorun(reader => {
				labelEl.textContent = session.title.read(reader);
				tab.classList.toggle('sticky', session.sticky.read(reader));

				const isActive = this._activeSessionId === session.sessionId;
				const status = session.status.read(reader);
				const isRead = session.isRead.read(reader);

				let mode: 'needs-input' | 'unread' | 'in-progress' | 'none' = 'none';
				if (status === SessionStatus.NeedsInput) {
					mode = 'needs-input';
				} else if (status === SessionStatus.InProgress) {
					mode = 'in-progress';
				} else if (!isRead && !isActive) {
					mode = 'unread';
				}

				tab.classList.toggle('needs-input', mode === 'needs-input');
				tab.classList.toggle('unread', mode === 'unread');
				tab.classList.toggle('in-progress', mode === 'in-progress');

				indicatorIcon.className = 'session-composite-bar-tab-indicator-icon';
				if (mode === 'in-progress') {
					indicatorIcon.classList.add(...ThemeIcon.asClassNameArray(ThemeIcon.modify(Codicon.loading, 'spin')));
				}
			}));

			const actionsContainer = $('.session-composite-bar-tab-actions');
			tab.appendChild(actionsContainer);
			const tabToolbar = this._tabDisposables.add(this._instantiationService.createInstance(MenuWorkbenchToolBar, actionsContainer, Menus.SessionTab, {
				hiddenItemStrategy: HiddenItemStrategy.Ignore,
				menuOptions: { shouldForwardArgs: true },
				toolbarOptions: { primaryGroup: () => true },
			}));
			tabToolbar.context = session;
		}

		this._tabsContainer.appendChild(tab);

		this._tabDisposables.add(addDisposableListener(tab, EventType.CLICK, () => {
			this._onTabClicked(session);
		}));
		this._tabDisposables.add(addDisposableListener(tab, EventType.KEY_DOWN, (e: KeyboardEvent) => {
			if (e.key === 'Enter' || e.key === ' ') {
				e.preventDefault();
				this._onTabClicked(session);
			}
		}));
		this._tabDisposables.add(addDisposableListener(tab, EventType.AUXCLICK, (e: MouseEvent) => {
			if (e.button === 1 && session) {
				e.preventDefault();
				this._sessionsService.closeSession(session);
			}
		}));

		this._tabs.push({ session, element: tab });
	}

	private _onTabClicked(session: IActiveSession | undefined): void {
		if (session) {
			this._sessionsService.setActive(session);
			this._sessionsPartService.focusSession(session);
		} else {
			this._sessionsService.openNewSession();
			this._sessionsPartService.focusSession(this._sessionsService.activeSession.get());
		}
	}

	private _updateActiveTab(activeSessionId: string | undefined): void {
		for (const tab of this._tabs) {
			const isActive = tab.session
				? tab.session.sessionId === activeSessionId
				: activeSessionId === undefined;
			tab.element.classList.toggle('active', isActive);
			tab.element.setAttribute('aria-selected', String(isActive));
			if (isActive) {
				tab.element.scrollIntoView({ block: 'nearest', inline: 'nearest' });
			}
		}
	}

	private _revealActiveTab(): void {
		const activeTab = this._tabs.find(t => t.element.classList.contains('active'));
		activeTab?.element.scrollIntoView({ block: 'nearest', inline: 'nearest' });
	}

	private _setVisible(visible: boolean): void {
		const wasVisible = this._visible;
		this._visible = visible;
		this._container.style.display = this._visible ? '' : 'none';
		if (wasVisible !== this._visible) {
			this._onDidChangeVisibility.fire(this._visible);
		}
	}

	private _updateStyles(): void {
		applySessionBarThemeColors(this._container, this._themeService.getColorTheme());
	}
}
