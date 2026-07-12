/*---------------------------------------------------------------------------------------------
 *  OmenIDE — Featherless OAuth via OMEN backend broker (sign-in, secrets, refresh).
 *--------------------------------------------------------------------------------------------*/
import { CancellationToken, CancellationTokenSource, commands, env, ProgressLocation, Uri, window } from 'vscode';
import { OmenIDEDefaults } from '../common/omenideConfig';
import { IVSCodeExtensionContext } from '../../../platform/extContext/common/extensionContext';
import { ILogService } from '../../../platform/log/common/logService';
import { IFetcherService } from '../../../platform/networking/common/fetcherService';
import { FeatherlessBYOKLMProvider } from '../../byok/vscode-node/featherlessProvider';
import { BYOKAuthType } from '../../byok/common/byokProvider';
import { IBYOKStorageService } from '../../byok/vscode-node/byokStorageService';
import {
	FEATHERLESS_API_BASE_URL,
	FEATHERLESS_AUTH_METHOD_SECRET,
	FEATHERLESS_OAUTH_ACCESS_TOKEN_SECRET,
	FEATHERLESS_OAUTH_EXPIRES_AT_SECRET,
	FEATHERLESS_OAUTH_REFRESH_TOKEN_SECRET,
	FeatherlessAuthMethod,
	getFeatherlessLoopbackWaitingUrl,
	IFeatherlessAccountSummary,
	IFeatherlessConcurrencySnapshot,
	IFeatherlessOAuthTokenResponse,
	IFeatherlessPlan,
	IFeatherlessSettingsModelsPage,
	IFeatherlessSettingsModelsQuery,
	IOmenFeatherlessOAuthCompleteResponse,
	IOmenFeatherlessOAuthStartResponse,
	OMEN_FEATHERLESS_OAUTH_COMPLETE_PATH,
	OMEN_FEATHERLESS_OAUTH_REFRESH_PATH,
	OMEN_FEATHERLESS_OAUTH_START_PATH,
	resolveFeatherlessLoopbackReturnUri,
	resolveOmenOAuthBrokerBaseUrl,
} from '../common/featherlessOAuth';
import {
	buildFeatherlessModelsUrl,
	mapFeatherlessApiModelToSettingsModel,
	settingsQueryToDiscoveryOptions,
	sortFeatherlessSettingsModels,
	parseFeatherlessModelsPage,
} from '../../byok/common/featherlessModelDiscovery';
import { FeatherlessLoopbackServer } from './featherlessLoopbackServer';

const CLIENT_ID_ENV = 'FEATHERLESS_OAUTH_CLIENT_ID';
const INTEGRATED_BROWSER_COMMAND = 'workbench.action.browser.open';
const SIMPLE_BROWSER_COMMAND = 'simpleBrowser.show';
const CLOSE_ACTIVE_EDITOR_COMMAND = 'workbench.action.closeActiveEditor';
const CLOSE_ALL_BROWSER_TABS_COMMAND = 'workbench.action.browser.closeAll';
const CLOSE_AUXILIARY_BAR_COMMAND = 'workbench.action.closeAuxiliaryBar';
const FOCUS_AUXILIARY_BAR_COMMAND = 'workbench.action.focusAuxiliaryBar';

export class FeatherlessAuthService {
	private _openedWorkbenchBrowser = false;
	private _collapsedAuxiliaryBarForSignIn = false;

	constructor(
		private readonly _extensionContext: IVSCodeExtensionContext,
		private readonly _byokStorageService: IBYOKStorageService,
		private readonly _fetcherService: IFetcherService,
		private readonly _logService: ILogService,
	) { }

	getRegisteredRedirectUris(): string[] {
		return [resolveFeatherlessLoopbackReturnUri()];
	}

	resolveClientId(): string {
		return process.env[CLIENT_ID_ENV]?.trim() || OmenIDEDefaults.featherlessOAuthClientId;
	}

	async hasCredentials(): Promise<boolean> {
		if (await this._byokStorageService.getAPIKey(FeatherlessBYOKLMProvider.providerName)) {
			return true;
		}
		const accessToken = await this._extensionContext.secrets.get(FEATHERLESS_OAUTH_ACCESS_TOKEN_SECRET);
		return !!accessToken?.trim();
	}

	async getAuthMethod(): Promise<FeatherlessAuthMethod | undefined> {
		const method = await this._extensionContext.secrets.get(FEATHERLESS_AUTH_METHOD_SECRET);
		return method === 'oauth' || method === 'apikey' ? method : undefined;
	}

	/**
	 * Returns a Bearer token for Featherless API calls.
	 * Prefers a manually entered API key; otherwise uses OAuth (with broker refresh).
	 */
	async getBearerToken(): Promise<string | undefined> {
		const apiKey = await this._byokStorageService.getAPIKey(FeatherlessBYOKLMProvider.providerName);
		if (apiKey) {
			return apiKey;
		}
		return this._getValidOAuthAccessToken();
	}

	async signInWithOAuth(): Promise<void> {
		// Use Window progress (status bar) — Notification progress spams "taking longer" alerts
		// during the multi-minute browser consent wait.
		const cts = new CancellationTokenSource();
		try {
			await this._collapseChatPanelForSignIn();
			await window.withProgress({
				location: ProgressLocation.Window,
				title: 'Featherless sign-in',
			}, async () => {
				const tokens = await this._authorizeWithBroker(cts.token);
				await this._storeOAuthTokens(tokens);
				await this._extensionContext.secrets.store(FEATHERLESS_AUTH_METHOD_SECRET, 'oauth');
				await this._byokStorageService.deleteAPIKey(FeatherlessBYOKLMProvider.providerName, BYOKAuthType.GlobalApiKey);
				this._logService.info('Featherless OAuth sign-in succeeded via OMEN broker');
			});
		} finally {
			await this._restoreChatPanelAfterSignIn();
			cts.dispose();
		}
	}

	async clearAllCredentials(): Promise<void> {
		await this.clearOAuthSession();
		await this._extensionContext.secrets.delete(FEATHERLESS_AUTH_METHOD_SECRET);
	}

	async clearOAuthSession(): Promise<void> {
		await this._extensionContext.secrets.delete(FEATHERLESS_OAUTH_ACCESS_TOKEN_SECRET);
		await this._extensionContext.secrets.delete(FEATHERLESS_OAUTH_REFRESH_TOKEN_SECRET);
		await this._extensionContext.secrets.delete(FEATHERLESS_OAUTH_EXPIRES_AT_SECRET);
	}

	async markApiKeyAuth(): Promise<void> {
		await this.clearOAuthSession();
		await this._extensionContext.secrets.store(FEATHERLESS_AUTH_METHOD_SECRET, 'apikey');
	}

	async getPlan(): Promise<IFeatherlessPlan> {
		const token = await this.getBearerToken();
		if (!token) {
			throw new Error('Not signed in to Featherless');
		}
		const response = await this._fetcherService.fetch(`${FEATHERLESS_API_BASE_URL}/v1/plan`, {
			method: 'GET',
			headers: {
				Authorization: `Bearer ${token}`,
				Accept: 'application/json',
			},
			callSite: 'featherless-plan',
		});
		if (!response.ok) {
			const body = await response.text();
			throw new Error(`Featherless plan request failed (${response.status}): ${body}`);
		}
		const json = await response.json() as IFeatherlessPlan;
		if (!json?.id || !json?.name) {
			throw new Error('Featherless plan response was incomplete');
		}
		return json;
	}

	async getConcurrencySnapshot(): Promise<IFeatherlessConcurrencySnapshot> {
		const token = await this.getBearerToken();
		if (!token) {
			throw new Error('Not signed in to Featherless');
		}
		const response = await this._fetcherService.fetch(`${FEATHERLESS_API_BASE_URL}/account/concurrency`, {
			method: 'GET',
			headers: {
				Authorization: `Bearer ${token}`,
				Accept: 'application/json',
			},
			callSite: 'featherless-concurrency',
		});
		if (!response.ok) {
			const body = await response.text();
			throw new Error(`Featherless concurrency request failed (${response.status}): ${body}`);
		}
		const json = await response.json() as IFeatherlessConcurrencySnapshot;
		return {
			limit: json.limit ?? null,
			used_cost: typeof json.used_cost === 'number' ? json.used_cost : 0,
			request_count: typeof json.request_count === 'number' ? json.request_count : 0,
		};
	}

	async getAccountSummary(): Promise<IFeatherlessAccountSummary> {
		const configured = await this.hasCredentials();
		if (!configured) {
			return { configured: false };
		}
		const authMethod = await this.getAuthMethod();
		try {
			const [plan, concurrency] = await Promise.all([
				this.getPlan(),
				this.getConcurrencySnapshot().catch(() => undefined),
			]);
			return {
				configured: true,
				authMethod,
				plan,
				concurrency,
			};
		} catch (err) {
			return {
				configured: true,
				authMethod,
				error: err instanceof Error ? err.message : String(err),
			};
		}
	}

	async listModelsForSettings(query: IFeatherlessSettingsModelsQuery = {}): Promise<IFeatherlessSettingsModelsPage> {
		const token = await this.getBearerToken();
		const normalized: IFeatherlessSettingsModelsQuery = {
			page: Math.max(1, query.page ?? 1),
			perPage: Math.min(100, Math.max(1, query.perPage ?? 100)),
			q: query.q,
			sort: query.sort ?? 'popularity',
			browse: query.browse ?? 'all',
			contextLengthMin: query.contextLengthMin,
		};

		if (!token) {
			return {
				models: [],
				page: normalized.page!,
				perPage: normalized.perPage!,
				hasMore: false,
				query: normalized,
			};
		}

		const discovery = settingsQueryToDiscoveryOptions(normalized);
		const discoveryUrl = buildFeatherlessModelsUrl(`${FEATHERLESS_API_BASE_URL}/v1`, discovery);
		const response = await this._fetcherService.fetch(discoveryUrl, {
			method: 'GET',
			headers: {
				Authorization: `Bearer ${token}`,
				Accept: 'application/json',
			},
			callSite: 'featherless-settings-models',
		});
		if (!response.ok) {
			const body = await response.text();
			throw new Error(`Featherless models request failed (${response.status}): ${body}`);
		}

		const pageResult = parseFeatherlessModelsPage(await response.json(), discovery.perPage ?? 25, discovery.page ?? 1);
		const mapped = pageResult.models
			.map(mapFeatherlessApiModelToSettingsModel)
			.filter((model): model is NonNullable<typeof model> => !!model);
		const models = sortFeatherlessSettingsModels(mapped, normalized.sort);

		return {
			models,
			page: normalized.page!,
			perPage: normalized.perPage!,
			hasMore: pageResult.hasMore,
			query: normalized,
		};
	}

	private _brokerUrl(path: string): string {
		return `${resolveOmenOAuthBrokerBaseUrl().replace(/\/$/, '')}${path}`;
	}

	/**
	 * Broker flow:
	 * 1. Start loopback; open full-window integrated browser to /waiting immediately
	 * 2. POST /api/featherless/oauth/start → authorizeUrl + state
	 * 3. Navigate the same browser tab to authorizeUrl
	 * 4. Backend redirects to loopback with ?session=&state=
	 * 5. POST /api/featherless/oauth/complete with session → tokens
	 */
	private async _authorizeWithBroker(token: CancellationToken): Promise<IFeatherlessOAuthTokenResponse> {
		const loopbackReturnUri = resolveFeatherlessLoopbackReturnUri();
		const brokerBase = resolveOmenOAuthBrokerBaseUrl();
		const waitingUrl = getFeatherlessLoopbackWaitingUrl(loopbackReturnUri);

		const loopbackServer = new FeatherlessLoopbackServer(env.appName, '');
		try {
			await loopbackServer.start();
		} catch (err) {
			throw new Error(`Could not start local OAuth server on port 33418: ${err instanceof Error ? err.message : String(err)}`);
		}

		try {
			// Open the browser immediately so the UI isn't blocked on the broker round-trip.
			await this._openSignInBrowser(waitingUrl, /* reuseLocalhostTab */ false);

			const startResponse = await this._fetcherService.fetch(this._brokerUrl(OMEN_FEATHERLESS_OAUTH_START_PATH), {
				method: 'POST',
				headers: {
					Accept: 'application/json',
					'Content-Type': 'application/json',
				},
				body: '{}',
				callSite: 'featherless-oauth-start',
			});

			const startText = await startResponse.text();
			let startPayload: IOmenFeatherlessOAuthStartResponse;
			try {
				startPayload = JSON.parse(startText) as IOmenFeatherlessOAuthStartResponse;
			} catch {
				throw new Error(`Could not start Featherless sign-in: unexpected response from ${brokerBase} (HTTP ${startResponse.status})`);
			}

			if (startResponse.status === 503 || startPayload.error === 'featherless_not_configured') {
				throw new Error(startPayload.message
					?? 'Featherless OAuth is not configured on the OMEN API. Ask an admin to configure the Featherless OAuth app on the backend.');
			}

			if (!startResponse.ok || !startPayload.success || !startPayload.authorizeUrl || !startPayload.state) {
				const detail = startPayload.message ?? startPayload.error ?? `HTTP ${startResponse.status}`;
				throw new Error(`Could not start Featherless sign-in: ${detail}`);
			}

			loopbackServer.setExpectedState(startPayload.state);

			let authorizeRedirectUri = '(unknown)';
			try {
				authorizeRedirectUri = new URL(startPayload.authorizeUrl).searchParams.get('redirect_uri') ?? '(missing)';
			} catch {
				// ignore
			}
			this._logService.info(`Featherless OAuth: broker=${brokerBase} loopback=${loopbackReturnUri} featherless_redirect_uri=${authorizeRedirectUri}`);
			this._logService.info(`Featherless OAuth authorize URL: ${startPayload.authorizeUrl}`);

			// Reuse the waiting tab and navigate it to Featherless.
			await this._openSignInBrowser(startPayload.authorizeUrl, /* reuseLocalhostTab */ true);

			const result = await this._raceCancellation(
				this._withTimeout(loopbackServer.resultPromise, 5 * 60_000, this._brokerHelpMessage(brokerBase)),
				token,
			);
			if (result.error) {
				throw new Error(this._formatBrokerCallbackError(result.error, result.errorDescription));
			}
			if (!result.session) {
				throw new Error('No OAuth session received from OMEN broker. Expected ?session= on the loopback callback.');
			}
			return await this._completeBrokerSession(result.session);
		} finally {
			// Always tear down the browser tab before returning — otherwise the welcome
			// overlay can cover the error page and brick the UI.
			await this._closeSignInBrowserIfOpened();
			setTimeout(() => { void loopbackServer.stop(); }, 500);
		}
	}

	private _formatBrokerCallbackError(error: string, errorDescription?: string): string {
		const detail = errorDescription ?? error;
		if (/missing authorization code or state/i.test(detail)) {
			return `${detail}. The OMEN broker did not receive a valid code/state from Featherless. Confirm the Featherless app redirect URI is exactly ${resolveOmenOAuthBrokerBaseUrl().replace(/\/$/, '')}/api/featherless/oauth/callback, and that the broker tolerates Featherless omitting state on redirect.`;
		}
		return detail;
	}

	private _brokerHelpMessage(brokerBase: string): string {
		return `Featherless sign-in timed out. Confirm the OMEN broker is reachable (${brokerBase}) and Featherless redirects to ${brokerBase.replace(/\/$/, '')}/api/featherless/oauth/callback. For local API use OMEN_OAUTH_BROKER_BASE_URL=http://localhost:3001.`;
	}

	/**
	 * Open (or navigate) the integrated browser full-window — not beside the onboarding card.
	 */
	private async _openSignInBrowser(url: string, reuseLocalhostTab: boolean): Promise<void> {
		const availableCommands = await commands.getCommands(true);
		const loopbackOrigin = (() => {
			try {
				return new URL(resolveFeatherlessLoopbackReturnUri()).origin;
			} catch {
				return 'http://localhost:33418';
			}
		})();

		if (availableCommands.includes(INTEGRATED_BROWSER_COMMAND)) {
			this._logService.info(`Featherless OAuth: opening integrated browser (${reuseLocalhostTab ? 'navigate' : 'new'})`);
			await commands.executeCommand(INTEGRATED_BROWSER_COMMAND, {
				url,
				// Full editor area — do not openToSide (that made the narrow "modal" look).
				openToSide: false,
				...(reuseLocalhostTab ? { reuseUrlFilter: `${loopbackOrigin}/*` } : {}),
			});
			this._openedWorkbenchBrowser = true;
			return;
		}

		if (availableCommands.includes(SIMPLE_BROWSER_COMMAND)) {
			this._logService.info('Featherless OAuth: opening simple browser for sign-in');
			await commands.executeCommand(SIMPLE_BROWSER_COMMAND, url);
			this._openedWorkbenchBrowser = true;
			return;
		}

		this._logService.warn('Featherless OAuth: integrated browser unavailable, falling back to system browser');
		let externalUri: Uri;
		try {
			const parsed = new URL(url);
			externalUri = Uri.from({
				scheme: parsed.protocol.replace(/:$/, ''),
				authority: parsed.host,
				path: parsed.pathname,
				query: parsed.search.replace(/^\?/, ''),
				fragment: parsed.hash.replace(/^#/, ''),
			});
		} catch {
			externalUri = Uri.parse(url);
		}
		const opened = await env.openExternal(externalUri);
		if (!opened) {
			throw new Error('Could not open the browser for Featherless sign-in.');
		}
	}

	private async _collapseChatPanelForSignIn(): Promise<void> {
		this._collapsedAuxiliaryBarForSignIn = false;
		const availableCommands = await commands.getCommands(true);
		if (!availableCommands.includes(CLOSE_AUXILIARY_BAR_COMMAND)) {
			return;
		}
		try {
			await commands.executeCommand(CLOSE_AUXILIARY_BAR_COMMAND);
			this._collapsedAuxiliaryBarForSignIn = true;
		} catch (err) {
			this._logService.trace(`Featherless OAuth: could not collapse chat panel: ${err instanceof Error ? err.message : String(err)}`);
		}
	}

	private async _restoreChatPanelAfterSignIn(): Promise<void> {
		if (!this._collapsedAuxiliaryBarForSignIn) {
			return;
		}
		this._collapsedAuxiliaryBarForSignIn = false;
		const availableCommands = await commands.getCommands(true);
		if (!availableCommands.includes(FOCUS_AUXILIARY_BAR_COMMAND)) {
			return;
		}
		try {
			await commands.executeCommand(FOCUS_AUXILIARY_BAR_COMMAND);
		} catch (err) {
			this._logService.trace(`Featherless OAuth: could not restore chat panel: ${err instanceof Error ? err.message : String(err)}`);
		}
	}

	private async _closeSignInBrowserIfOpened(): Promise<void> {
		if (!this._openedWorkbenchBrowser) {
			return;
		}
		this._openedWorkbenchBrowser = false;
		const availableCommands = await commands.getCommands(true);
		try {
			if (availableCommands.includes(CLOSE_ALL_BROWSER_TABS_COMMAND)) {
				await commands.executeCommand(CLOSE_ALL_BROWSER_TABS_COMMAND);
				return;
			}
			if (availableCommands.includes(CLOSE_ACTIVE_EDITOR_COMMAND)) {
				await commands.executeCommand(CLOSE_ACTIVE_EDITOR_COMMAND);
			}
		} catch (err) {
			this._logService.trace(`Featherless OAuth: could not close sign-in browser tab: ${err instanceof Error ? err.message : String(err)}`);
		}
	}

	private async _withTimeout<T>(promise: Promise<T>, ms: number, timeoutMessage: string): Promise<T> {
		let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
		try {
			return await Promise.race([
				promise,
				new Promise<T>((_, reject) => {
					timeoutHandle = setTimeout(() => reject(new Error(timeoutMessage)), ms);
				}),
			]);
		} finally {
			if (timeoutHandle) {
				clearTimeout(timeoutHandle);
			}
		}
	}

	private async _completeBrokerSession(session: string): Promise<IFeatherlessOAuthTokenResponse> {
		const response = await this._fetcherService.fetch(this._brokerUrl(OMEN_FEATHERLESS_OAUTH_COMPLETE_PATH), {
			method: 'POST',
			headers: {
				Accept: 'application/json',
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({ session }),
			callSite: 'featherless-oauth-complete',
		});

		const text = await response.text();
		let payload: IOmenFeatherlessOAuthCompleteResponse;
		try {
			payload = JSON.parse(text) as IOmenFeatherlessOAuthCompleteResponse;
		} catch {
			throw new Error(`Featherless token completion failed (HTTP ${response.status}): ${text}`);
		}

		if (response.status === 404 || payload.error === 'session_not_found') {
			throw new Error(payload.message
				?? 'OAuth session not found or already used. Sign in again (sessions are single-use and expire in a few minutes).');
		}

		if (!response.ok || !payload.success || !payload.access_token) {
			const detail = payload.message ?? payload.error ?? `HTTP ${response.status}`;
			throw new Error(`Featherless token completion failed: ${detail}`);
		}

		return {
			access_token: payload.access_token,
			refresh_token: payload.refresh_token,
			token_type: payload.token_type ?? 'Bearer',
			expires_in: payload.expires_in,
			scope: payload.scope,
		};
	}

	private async _refreshAccessToken(refreshToken: string): Promise<IFeatherlessOAuthTokenResponse> {
		const response = await this._fetcherService.fetch(this._brokerUrl(OMEN_FEATHERLESS_OAUTH_REFRESH_PATH), {
			method: 'POST',
			headers: {
				Accept: 'application/json',
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({ refresh_token: refreshToken }),
			callSite: 'featherless-oauth-refresh',
		});

		const text = await response.text();
		let payload: IOmenFeatherlessOAuthCompleteResponse;
		try {
			payload = JSON.parse(text) as IOmenFeatherlessOAuthCompleteResponse;
		} catch {
			throw new Error(`Featherless token refresh failed (HTTP ${response.status}): ${text}`);
		}

		if (!response.ok || !payload.success || !payload.access_token) {
			const detail = payload.message ?? payload.error ?? `HTTP ${response.status}`;
			throw new Error(`Featherless token refresh failed: ${detail}`);
		}

		return {
			access_token: payload.access_token,
			refresh_token: payload.refresh_token,
			token_type: payload.token_type ?? 'Bearer',
			expires_in: payload.expires_in,
			scope: payload.scope,
		};
	}

	private async _getValidOAuthAccessToken(): Promise<string | undefined> {
		const accessToken = await this._extensionContext.secrets.get(FEATHERLESS_OAUTH_ACCESS_TOKEN_SECRET);
		if (!accessToken) {
			return undefined;
		}

		const expiresAtRaw = await this._extensionContext.secrets.get(FEATHERLESS_OAUTH_EXPIRES_AT_SECRET);
		const expiresAt = expiresAtRaw ? Number(expiresAtRaw) : undefined;
		const isExpired = expiresAt !== undefined && Date.now() >= expiresAt - 60_000;

		if (!isExpired) {
			return accessToken;
		}

		const refreshToken = await this._extensionContext.secrets.get(FEATHERLESS_OAUTH_REFRESH_TOKEN_SECRET);
		if (!refreshToken) {
			await this.clearOAuthSession();
			return undefined;
		}

		try {
			const refreshed = await this._refreshAccessToken(refreshToken);
			await this._storeOAuthTokens(refreshed);
			return refreshed.access_token;
		} catch (err) {
			this._logService.warn(`Featherless OAuth refresh failed: ${err instanceof Error ? err.message : String(err)}`);
			await this.clearOAuthSession();
			return undefined;
		}
	}

	private async _storeOAuthTokens(tokens: IFeatherlessOAuthTokenResponse): Promise<void> {
		await this._extensionContext.secrets.store(FEATHERLESS_OAUTH_ACCESS_TOKEN_SECRET, tokens.access_token);
		if (tokens.refresh_token) {
			await this._extensionContext.secrets.store(FEATHERLESS_OAUTH_REFRESH_TOKEN_SECRET, tokens.refresh_token);
		}
		if (tokens.expires_in) {
			const expiresAt = Date.now() + tokens.expires_in * 1000;
			await this._extensionContext.secrets.store(FEATHERLESS_OAUTH_EXPIRES_AT_SECRET, String(expiresAt));
		}
	}

	private async _raceCancellation<T>(promise: Promise<T>, token: CancellationToken): Promise<T> {
		if (token.isCancellationRequested) {
			throw new Error('Sign-in cancelled.');
		}
		const cts = new CancellationTokenSource();
		const cancelListener = token.onCancellationRequested(() => cts.cancel());
		try {
			return await Promise.race([
				promise,
				new Promise<T>((_, reject) => {
					cts.token.onCancellationRequested(() => reject(new Error('Sign-in cancelled.')));
				}),
			]);
		} finally {
			cancelListener.dispose();
			cts.dispose();
		}
	}
}
