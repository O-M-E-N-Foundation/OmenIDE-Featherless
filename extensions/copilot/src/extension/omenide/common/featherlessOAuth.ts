/*---------------------------------------------------------------------------------------------
 *  OmenIDE — Featherless OAuth via OMEN backend broker (confidential client on server).
 *--------------------------------------------------------------------------------------------*/
import { OmenIDEDefaults } from './omenideConfig';

/** Scopes requested during Featherless sign-in (set by the broker authorize URL). */
export const FEATHERLESS_OAUTH_SCOPES = 'user.read user.write api.access';

export type FeatherlessAuthMethod = 'oauth' | 'apikey';

export const FEATHERLESS_API_BASE_URL = 'https://api.featherless.ai';

/** Featherless plan details from GET /v1/plan. */
export interface IFeatherlessPlan {
	readonly id: string;
	readonly name: string;
	readonly max_context_length: number | null;
	readonly max_model_size: number | null;
	readonly concurrency: number | null;
}

/** Concurrency snapshot from GET /account/concurrency. */
export interface IFeatherlessConcurrencySnapshot {
	readonly limit: number | null;
	readonly used_cost: number;
	readonly request_count: number;
}

/** Account summary for Omen IDE Settings. */
export interface IFeatherlessAccountSummary {
	readonly configured: boolean;
	readonly authMethod?: FeatherlessAuthMethod;
	readonly plan?: IFeatherlessPlan;
	readonly concurrency?: IFeatherlessConcurrencySnapshot;
	readonly error?: string;
}

/** Model row for Omen IDE Settings toggles. */
export interface IFeatherlessSettingsModel {
	readonly id: string;
	readonly name: string;
	readonly availableOnPlan: boolean;
	readonly contextLength?: number;
	readonly maxCompletionTokens?: number;
	readonly modelClass?: string;
	readonly toolUse?: boolean;
	readonly vision?: boolean;
	readonly tags?: readonly string[];
	readonly tasks?: readonly string[];
	readonly downloads?: number;
	readonly favorites?: number;
	readonly parameterSize?: number;
	readonly popularityLevel?: number;
	readonly gated?: boolean;
	readonly classifications?: readonly string[];
}

export interface IFeatherlessSettingsModelsQuery {
	readonly page?: number;
	readonly perPage?: number;
	readonly q?: string;
	readonly sort?: 'popularity' | 'name' | 'context';
	readonly browse?: 'all' | 'coding' | 'tools' | 'vision' | 'creative' | 'popular';
	readonly contextLengthMin?: number;
}

export interface IFeatherlessSettingsModelsPage {
	readonly models: readonly IFeatherlessSettingsModel[];
	readonly page: number;
	readonly perPage: number;
	readonly hasMore: boolean;
	readonly query: IFeatherlessSettingsModelsQuery;
}

/** OMEN backend OAuth broker paths (client_secret stays on the server). */
export const OMEN_FEATHERLESS_OAUTH_START_PATH = '/api/featherless/oauth/start';
export const OMEN_FEATHERLESS_OAUTH_COMPLETE_PATH = '/api/featherless/oauth/complete';
export const OMEN_FEATHERLESS_OAUTH_REFRESH_PATH = '/api/featherless/oauth/refresh';
export const OMEN_OAUTH_BROKER_BASE_URL_ENV = 'OMEN_OAUTH_BROKER_BASE_URL';

/**
 * Loopback return URI after the OMEN backend broker completes Featherless OAuth.
 * Must match FEATHERLESS_OAUTH_LOOPBACK_URI on the backend.
 * Featherless itself redirects to the backend callback, not this URI.
 */
export const FEATHERLESS_LOOPBACK_RETURN_URI = 'http://localhost:33418/callback';
export const FEATHERLESS_LOOPBACK_PORT = 33418;
export const FEATHERLESS_LOOPBACK_WAITING_PATH = '/waiting';
export const FEATHERLESS_OAUTH_LOOPBACK_URI_ENV = 'FEATHERLESS_OAUTH_LOOPBACK_URI';

export function getFeatherlessLoopbackWaitingUrl(redirectUri: string = resolveFeatherlessLoopbackReturnUri()): string {
	try {
		const url = new URL(redirectUri);
		return `${url.protocol}//${url.host}${FEATHERLESS_LOOPBACK_WAITING_PATH}`;
	} catch {
		return `http://localhost:${FEATHERLESS_LOOPBACK_PORT}${FEATHERLESS_LOOPBACK_WAITING_PATH}`;
	}
}

/** @deprecated Alias for resolveFeatherlessLoopbackReturnUri callers. */
export const FEATHERLESS_LOOPBACK_REDIRECT_URI = FEATHERLESS_LOOPBACK_RETURN_URI;

export function resolveOmenOAuthBrokerBaseUrl(): string {
	return process.env[OMEN_OAUTH_BROKER_BASE_URL_ENV]?.trim() || OmenIDEDefaults.omenOAuthBrokerBaseUrl;
}

export function resolveFeatherlessLoopbackReturnUri(): string {
	return process.env[FEATHERLESS_OAUTH_LOOPBACK_URI_ENV]?.trim() || FEATHERLESS_LOOPBACK_RETURN_URI;
}

/** @deprecated Use resolveFeatherlessLoopbackReturnUri. */
export function resolveFeatherlessOAuthRedirectUri(): string {
	return resolveFeatherlessLoopbackReturnUri();
}

export function getFeatherlessLoopbackCallbackPath(redirectUri: string = resolveFeatherlessLoopbackReturnUri()): string {
	try {
		const pathname = new URL(redirectUri).pathname;
		return pathname && pathname !== '/' ? pathname : '/';
	} catch {
		return '/callback';
	}
}

export interface IOmenFeatherlessOAuthStartResponse {
	success: boolean;
	authorizeUrl?: string;
	state?: string;
	error?: string;
	message?: string;
}

export interface IOmenFeatherlessOAuthCompleteResponse {
	success: boolean;
	access_token?: string;
	refresh_token?: string;
	token_type?: string;
	expires_in?: number;
	scope?: string;
	error?: string;
	message?: string;
}

export const FEATHERLESS_OAUTH_ACCESS_TOKEN_SECRET = 'copilot-byok-Featherless-oauth-access-token';
export const FEATHERLESS_OAUTH_REFRESH_TOKEN_SECRET = 'copilot-byok-Featherless-oauth-refresh-token';
export const FEATHERLESS_OAUTH_EXPIRES_AT_SECRET = 'copilot-byok-Featherless-oauth-expires-at';
export const FEATHERLESS_AUTH_METHOD_SECRET = 'copilot-byok-Featherless-auth-method';

export interface IFeatherlessOAuthTokenResponse {
	access_token: string;
	refresh_token?: string;
	token_type: string;
	expires_in?: number;
	scope?: string;
}
