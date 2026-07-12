/*---------------------------------------------------------------------------------------------
 *  OmenIDE — Local loopback server for OMEN Featherless OAuth broker callback.
 *--------------------------------------------------------------------------------------------*/
import * as http from 'http';
import {
	FEATHERLESS_LOOPBACK_PORT,
	FEATHERLESS_LOOPBACK_WAITING_PATH,
	getFeatherlessLoopbackCallbackPath,
} from '../common/featherlessOAuth';

export interface IFeatherlessOAuthCallbackResult {
	session?: string;
	error?: string;
	errorDescription?: string;
	state: string;
}

export class FeatherlessLoopbackServer {
	private _server: http.Server | undefined;
	private _callbackHandled = false;
	private _expectedState: string;
	private _deferred: {
		resolve: (result: IFeatherlessOAuthCallbackResult) => void;
		reject: (reason: unknown) => void;
	} | undefined;

	readonly resultPromise: Promise<IFeatherlessOAuthCallbackResult>;

	constructor(
		private readonly _appName: string,
		expectedState: string,
		private readonly _callbackPath = getFeatherlessLoopbackCallbackPath(),
	) {
		this._expectedState = expectedState;
		this.resultPromise = new Promise<IFeatherlessOAuthCallbackResult>((resolve, reject) => {
			this._deferred = { resolve, reject };
		});
	}

	get state(): string {
		return this._expectedState;
	}

	/** Set after POST /start returns the broker state JWT. */
	setExpectedState(state: string): void {
		this._expectedState = state;
	}

	async start(): Promise<void> {
		if (this._server) {
			throw new Error('Server is already started');
		}

		this._server = http.createServer((req, res) => {
			const host = req.headers.host ?? `localhost:${FEATHERLESS_LOOPBACK_PORT}`;
			const reqUrl = new URL(req.url ?? '/', `http://${host}`);

			if (reqUrl.pathname === FEATHERLESS_LOOPBACK_WAITING_PATH) {
				this._sendWaitingPage(res);
				return;
			}

			const callbackPath = this._callbackPath;
			if (reqUrl.pathname !== callbackPath && !(callbackPath === '/' && reqUrl.pathname === '')) {
				res.writeHead(404);
				res.end();
				return;
			}

			const error = reqUrl.searchParams.get('error') ?? undefined;
			const errorDescription = reqUrl.searchParams.get('error_description') ?? undefined;
			const session = reqUrl.searchParams.get('session') ?? undefined;
			const returnedState = reqUrl.searchParams.get('state');

			// Validate state when the broker includes it (and we already know expected state).
			if (returnedState && this._expectedState && returnedState !== this._expectedState) {
				this._failCallback(res, 'Authentication failed: state does not match.');
				return;
			}

			if (error) {
				this._sendPage(res, errorDescription ?? error, true);
				this._finishCallback({ error, errorDescription, state: returnedState ?? this._expectedState });
				return;
			}

			if (session) {
				this._sendPage(res, 'Completing sign-in in Omen IDE…', false);
				this._finishCallback({ session, state: returnedState ?? this._expectedState });
				return;
			}

			res.writeHead(400);
			res.end('Missing session');
			this._failCallback(res, 'Missing session from OMEN OAuth broker callback', false);
		});

		await new Promise<void>((resolve, reject) => {
			this._server!.once('error', reject);
			this._server!.listen(FEATHERLESS_LOOPBACK_PORT, 'localhost', () => resolve());
		});
	}

	async stop(): Promise<void> {
		if (!this._server) {
			return;
		}
		const server = this._server;
		this._server = undefined;
		await new Promise<void>((resolve, reject) => {
			server.close(err => (err ? reject(err) : resolve()));
		});
	}

	private _failCallback(res: http.ServerResponse, message: string, sendPage = true): void {
		if (sendPage) {
			this._sendPage(res, message, true);
		}
		this._finishCallback(undefined, new Error(message));
	}

	private _finishCallback(result?: IFeatherlessOAuthCallbackResult, error?: Error): void {
		if (this._callbackHandled) {
			return;
		}
		this._callbackHandled = true;
		if (error) {
			this._deferred?.reject(error);
		} else if (result) {
			this._deferred?.resolve(result);
		}
	}

	private _sendWaitingPage(res: http.ServerResponse): void {
		const html = `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="utf-8" />
	<title>Signing in — ${this._appName}</title>
	<style>
		body { font-family: system-ui, sans-serif; background: #1e1e1e; color: #ccc; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
		.card { max-width: 480px; padding: 2rem; border-radius: 8px; background: #252526; box-shadow: 0 4px 24px rgba(0,0,0,.4); text-align: center; }
		h1 { font-size: 1.25rem; margin: 0 0 1rem; color: #cccccc; }
		p { margin: 0; line-height: 1.5; }
		.spinner { width: 28px; height: 28px; border: 3px solid #3c3c3c; border-top-color: #4ec9b0; border-radius: 50%; margin: 0 auto 1.25rem; animation: spin 0.8s linear infinite; }
		@keyframes spin { to { transform: rotate(360deg); } }
	</style>
</head>
<body>
	<div class="card">
		<div class="spinner" aria-hidden="true"></div>
		<h1>Starting Featherless sign-in…</h1>
		<p>This tab will open Featherless shortly. You can close it with the editor tab × if you want to cancel.</p>
	</div>
</body>
</html>`;
		res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
		res.end(html);
	}

	private _sendPage(res: http.ServerResponse, message: string, isError: boolean): void {
		const title = isError ? 'Sign-in failed' : 'Signed in';
		const safeMessage = message
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;');
		const html = `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="utf-8" />
	<title>${title} — ${this._appName}</title>
	<style>
		body { font-family: system-ui, sans-serif; background: #1e1e1e; color: #ccc; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
		.card { max-width: 520px; padding: 2rem; border-radius: 8px; background: #252526; box-shadow: 0 4px 24px rgba(0,0,0,.4); text-align: center; }
		h1 { font-size: 1.25rem; margin: 0 0 1rem; color: ${isError ? '#f48771' : '#4ec9b0'}; }
		p { margin: 0; line-height: 1.5; }
	</style>
</head>
<body>
	<div class="card">
		<h1>${title}</h1>
		<p>${safeMessage}</p>
	</div>
</body>
</html>`;
		res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
		res.end(html);
	}
}
