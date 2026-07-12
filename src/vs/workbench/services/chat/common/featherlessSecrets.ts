/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Extension id for the in-tree Omen IDE chat extension (`extensions/copilot`). */
export const OMENIDE_CHAT_EXTENSION_ID = 'OmenIDE.omenide-chat';

/** Secret key used by BYOKStorageService for the Featherless provider API key. */
export const FEATHERLESS_API_KEY_SECRET = 'copilot-byok-Featherless-api-key';

/** Secret key used by FeatherlessAuthService for OAuth access tokens. */
export const FEATHERLESS_OAUTH_ACCESS_TOKEN_SECRET = 'copilot-byok-Featherless-oauth-access-token';

export function getExtensionSecretStorageKey(extensionId: string, key: string): string {
	return JSON.stringify({ extensionId, key });
}

export function getFeatherlessApiKeySecretStorageKey(extensionId: string = OMENIDE_CHAT_EXTENSION_ID): string {
	return getExtensionSecretStorageKey(extensionId, FEATHERLESS_API_KEY_SECRET);
}

export function getFeatherlessOAuthSecretStorageKey(extensionId: string = OMENIDE_CHAT_EXTENSION_ID): string {
	return getExtensionSecretStorageKey(extensionId, FEATHERLESS_OAUTH_ACCESS_TOKEN_SECRET);
}
