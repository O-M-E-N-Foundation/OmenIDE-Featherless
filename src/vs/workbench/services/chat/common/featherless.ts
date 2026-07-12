/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IProductService } from '../../../../platform/product/common/productService.js';

export const FEATHERLESS_CONFIGURE_API_KEY_COMMAND = 'workbench.action.chat.configureFeatherlessApiKey';
export const FEATHERLESS_SIGN_IN_COMMAND = 'workbench.action.chat.signInFeatherless';
export const FEATHERLESS_EXTENSION_SET_KEY_COMMAND = 'omenide.setFeatherlessApiKey';
export const FEATHERLESS_EXTENSION_CONFIGURE_KEY_COMMAND = 'omenide.configureFeatherlessApiKey';
export const FEATHERLESS_EXTENSION_SIGN_IN_COMMAND = 'omenide.signInFeatherless';
export const FEATHERLESS_EXTENSION_HAS_KEY_COMMAND = 'omenide.hasFeatherlessApiKey';
export const FEATHERLESS_EXTENSION_BOOTSTRAP_COMMAND = 'omenide.bootstrapFeatherlessModels';
export const FEATHERLESS_EXTENSION_ACCOUNT_SUMMARY_COMMAND = 'omenide.getFeatherlessAccountSummary';
export const FEATHERLESS_EXTENSION_SIGN_OUT_COMMAND = 'omenide.signOutFeatherless';
export const FEATHERLESS_EXTENSION_LIST_MODELS_COMMAND = 'omenide.listFeatherlessModels';

export function usesFeatherlessOnlyProvider(productService: IProductService): boolean {
	return productService.defaultChatAgent?.provider?.default?.id === 'featherless';
}
