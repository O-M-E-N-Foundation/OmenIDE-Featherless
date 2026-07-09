/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { UriComponents } from '../../../../../../base/common/uri.js';
import { IChatCreatedPlan } from '../../chatService/chatService.js';
import { ToolDataSource } from '../../tools/languageModelToolsService.js';

export class ChatCreatedPlanData implements IChatCreatedPlan {
	public readonly kind = 'createdPlan' as const;

	constructor(
		public title: string,
		public overview: string,
		public planUri: UriComponents,
		public built?: boolean,
		public source?: ToolDataSource,
	) { }

	toJSON(): IChatCreatedPlan {
		return {
			kind: this.kind,
			title: this.title,
			overview: this.overview,
			planUri: this.planUri,
			built: this.built,
			source: this.source,
		};
	}
}
