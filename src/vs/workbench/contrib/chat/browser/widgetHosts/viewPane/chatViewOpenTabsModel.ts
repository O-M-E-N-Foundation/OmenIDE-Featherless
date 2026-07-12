/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../../../base/common/event.js';
import { Disposable } from '../../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../../base/common/uri.js';
import { isEqual } from '../../../../../../base/common/resources.js';

export interface IChatViewOpenTab {
	readonly resource: URI;
}

/**
 * Pane-local working set of open chat sessions (Cursor-style tabs).
 * The Sessions sidebar remains full history; this model tracks only open tabs.
 */
export class ChatViewOpenTabsModel extends Disposable {

	private readonly _tabs: IChatViewOpenTab[] = [];
	private _active: URI | undefined;

	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange: Event<void> = this._onDidChange.event;

	get tabs(): readonly IChatViewOpenTab[] {
		return this._tabs;
	}

	get active(): URI | undefined {
		return this._active;
	}

	get count(): number {
		return this._tabs.length;
	}

	indexOf(resource: URI): number {
		return this._tabs.findIndex(t => isEqual(t.resource, resource));
	}

	contains(resource: URI): boolean {
		return this.indexOf(resource) >= 0;
	}

	/**
	 * Open `resource` as a tab (or activate if already open). Does not close others.
	 */
	openOrActivate(resource: URI): void {
		const idx = this.indexOf(resource);
		if (idx < 0) {
			this._tabs.push({ resource });
		}
		this._active = resource;
		this._onDidChange.fire();
	}

	/**
	 * Activate an already-open tab. No-op if not open.
	 */
	activate(resource: URI): boolean {
		if (!this.contains(resource)) {
			return false;
		}
		this._active = resource;
		this._onDidChange.fire();
		return true;
	}

	/**
	 * Close a tab. Returns the resource that should become active next, if any.
	 */
	close(resource: URI): URI | undefined {
		const idx = this.indexOf(resource);
		if (idx < 0) {
			return this._active;
		}

		const wasActive = this._active && isEqual(this._active, resource);
		this._tabs.splice(idx, 1);

		if (!wasActive) {
			this._onDidChange.fire();
			return this._active;
		}

		const next = this._tabs[Math.min(idx, this._tabs.length - 1)];
		this._active = next?.resource;
		this._onDidChange.fire();
		return this._active;
	}

	/**
	 * Replace the active tab's resource (e.g. untitled → committed session id).
	 */
	replaceActive(from: URI, to: URI): void {
		const idx = this.indexOf(from);
		if (idx < 0) {
			this.openOrActivate(to);
			return;
		}
		this._tabs[idx] = { resource: to };
		if (this._active && isEqual(this._active, from)) {
			this._active = to;
		}
		this._onDidChange.fire();
	}

	clear(): void {
		this._tabs.length = 0;
		this._active = undefined;
		this._onDidChange.fire();
	}

	restore(resources: readonly URI[], active: URI | undefined): void {
		this._tabs.length = 0;
		for (const resource of resources) {
			this._tabs.push({ resource });
		}
		this._active = active && this.contains(active) ? active : this._tabs[0]?.resource;
		this._onDidChange.fire();
	}

	toJSON(): { resources: URI[]; active: URI | undefined } {
		return {
			resources: this._tabs.map(t => t.resource),
			active: this._active,
		};
	}
}
