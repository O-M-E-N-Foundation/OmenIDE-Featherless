/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ExtensionIdentifier } from '../../../../platform/extensions/common/extensions.js';
import { ISecretStorageService } from '../../../../platform/secrets/common/secrets.js';

/** Extension id for the in-tree Omen IDE chat extension (`extensions/copilot`). */
export const OMENIDE_CHAT_EXTENSION_ID = 'OmenIDE.omenide-chat';

/**
 * Extension SecretStorage indexes by {@link ExtensionIdentifier.toKey}, which is
 * lowercase. Workbench reads of the same secrets must use the same key or they
 * will always miss credentials after a window/workspace reload.
 */
export const OMENIDE_CHAT_EXTENSION_SECRET_ID = ExtensionIdentifier.toKey(OMENIDE_CHAT_EXTENSION_ID);

/** Secret key used by BYOKStorageService for the Featherless provider API key. */
export const FEATHERLESS_API_KEY_SECRET = 'copilot-byok-Featherless-api-key';

/** Secret key used by FeatherlessAuthService for OAuth access tokens. */
export const FEATHERLESS_OAUTH_ACCESS_TOKEN_SECRET = 'copilot-byok-Featherless-oauth-access-token';

export function getExtensionSecretStorageKey(extensionId: string, key: string): string {
	return JSON.stringify({ extensionId: ExtensionIdentifier.toKey(extensionId), key });
}

/** Pre-fix mixed-case key shape (do not use for new writes). */
function getLegacyExtensionSecretStorageKey(extensionId: string, key: string): string {
	return JSON.stringify({ extensionId, key });
}

export function getFeatherlessApiKeySecretStorageKey(extensionId: string = OMENIDE_CHAT_EXTENSION_SECRET_ID): string {
	return getExtensionSecretStorageKey(extensionId, FEATHERLESS_API_KEY_SECRET);
}

export function getFeatherlessOAuthSecretStorageKey(extensionId: string = OMENIDE_CHAT_EXTENSION_SECRET_ID): string {
	return getExtensionSecretStorageKey(extensionId, FEATHERLESS_OAUTH_ACCESS_TOKEN_SECRET);
}

function getLegacyFeatherlessApiKeySecretStorageKey(): string {
	return getLegacyExtensionSecretStorageKey(OMENIDE_CHAT_EXTENSION_ID, FEATHERLESS_API_KEY_SECRET);
}

function getLegacyFeatherlessOAuthSecretStorageKey(): string {
	return getLegacyExtensionSecretStorageKey(OMENIDE_CHAT_EXTENSION_ID, FEATHERLESS_OAUTH_ACCESS_TOKEN_SECRET);
}

export function isFeatherlessCredentialSecretKey(secretKey: string): boolean {
	return secretKey === getFeatherlessApiKeySecretStorageKey()
		|| secretKey === getFeatherlessOAuthSecretStorageKey()
		|| secretKey === getLegacyFeatherlessApiKeySecretStorageKey()
		|| secretKey === getLegacyFeatherlessOAuthSecretStorageKey();
}

/**
 * Reads Featherless credentials from the canonical (lowercase) extension secret
 * keys, falling back to the legacy mixed-case keys and migrating when found.
 */
export async function readFeatherlessCredentialSecrets(secretStorage: ISecretStorageService): Promise<{
	apiKey: string | undefined;
	oauthToken: string | undefined;
}> {
	const canonicalApiKey = getFeatherlessApiKeySecretStorageKey();
	const canonicalOauth = getFeatherlessOAuthSecretStorageKey();
	const legacyApiKey = getLegacyFeatherlessApiKeySecretStorageKey();
	const legacyOauth = getLegacyFeatherlessOAuthSecretStorageKey();

	const [apiKey, oauthToken, legacyApi, legacyOAuth] = await Promise.all([
		secretStorage.get(canonicalApiKey),
		secretStorage.get(canonicalOauth),
		secretStorage.get(legacyApiKey),
		secretStorage.get(legacyOauth),
	]);

	let resolvedApiKey = apiKey?.trim() || undefined;
	let resolvedOauth = oauthToken?.trim() || undefined;

	if (!resolvedApiKey && legacyApi?.trim()) {
		resolvedApiKey = legacyApi.trim();
		void secretStorage.set(canonicalApiKey, resolvedApiKey).then(() => secretStorage.delete(legacyApiKey));
	}
	if (!resolvedOauth && legacyOAuth?.trim()) {
		resolvedOauth = legacyOAuth.trim();
		void secretStorage.set(canonicalOauth, resolvedOauth).then(() => secretStorage.delete(legacyOauth));
	}

	return { apiKey: resolvedApiKey, oauthToken: resolvedOauth };
}
