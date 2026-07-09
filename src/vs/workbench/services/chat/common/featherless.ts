/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IProductService } from '../../../../platform/product/common/productService.js';

export const FEATHERLESS_CONFIGURE_API_KEY_COMMAND = 'workbench.action.chat.configureFeatherlessApiKey';
export const FEATHERLESS_EXTENSION_SET_KEY_COMMAND = 'omenide.setFeatherlessApiKey';
export const FEATHERLESS_EXTENSION_CONFIGURE_KEY_COMMAND = 'omenide.configureFeatherlessApiKey';
export const FEATHERLESS_EXTENSION_HAS_KEY_COMMAND = 'omenide.hasFeatherlessApiKey';

export function usesFeatherlessOnlyProvider(productService: IProductService): boolean {
	return productService.defaultChatAgent?.provider?.default?.id === 'featherless';
}
