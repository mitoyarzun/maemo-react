// The server URL and the long-lived access token (HA spec section 4). Only
// fetch and a storage object: the tests give fakes. There is no login flow,
// no token refresh and no revoke: the user makes the token in the Home
// Assistant profile, and deletes it there.

/** The sign-in message when Home Assistant refuses the token: auth_invalid on the socket, or HTTP 401. */
export const TOKEN_REJECTED = 'Home Assistant did not accept the token. Make a new token in your profile.';

export const SERVER_KEY = 'ha.server';
export const TOKEN_KEY = 'ha.token';

export type AuthCode = 'url' | 'token' | 'network' | 'certificate' | 'server' | 'rejected';

/** An error with a plain-words message for the screen (HA spec sections 2 and 7). */
export class AuthError extends Error {
  readonly code: AuthCode;

  constructor(code: AuthCode, message: string) {
    super(message);
    this.name = 'AuthError';
    this.code = code;
  }
}

export interface AuthDeps {
  fetch: typeof fetch;
}

/** The part of localStorage that this module uses. */
export type TokenStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export interface Credentials {
  /** '' when there is no saved server URL. */
  server: string;
  /** null when the user is not signed in. */
  token: string | null;
}

/**
 * The server URL as the application keeps it: the scheme, the host and the
 * port. Home Assistant does not run under a path, and a URL copied from the
 * browser often has the path of a dashboard.
 */
export function normalizeServer(input: string): string {
  let s = input.trim();
  if (s === '') throw new AuthError('url', 'Type the server URL');
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = 'http://' + s;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    throw new AuthError('url', 'The server URL is not valid');
  }
  if ((u.protocol !== 'http:' && u.protocol !== 'https:') || u.host === '') throw new AuthError('url', 'The server URL must start with http:// or https://');
  return u.origin;
}

/** The token as the application keeps it. A paste often adds a space or a line break at the start or at the end. */
export function normalizeToken(input: string): string {
  const t = input.trim();
  if (t === '') throw new AuthError('token', 'Paste the token');
  if (/\s/.test(t)) throw new AuthError('token', 'The token has a space or a line break in it');
  return t;
}

/** The WebSocket URL of a server. */
export function socketUrl(server: string): string {
  return server.replace(/^http/, 'ws') + '/api/websocket';
}

function networkError(e: unknown): AuthError {
  const cause = e instanceof Error && e.cause instanceof Error ? e.cause.message : '';
  // Host and connection phrases first: a host name can contain "ssl" or "tls".
  if (/resolve host|connect to|timed out|connection refused/i.test(cause)) return new AuthError('network', 'The server did not answer');
  if (/SSL certificate|certificate problem|SSL peer|SSL connect error|unable to get local issuer/i.test(cause)) {
    return new AuthError('certificate', 'The certificate is not valid');
  }
  return new AuthError('network', 'The server did not answer');
}

/**
 * Check the token before the application keeps it: GET /api/ with the
 * bearer token. Home Assistant answers 200 ({"message":"API running."}), or
 * 401 when it does not accept the token. The request does not follow a
 * redirect: a redirect would send the token again, maybe to another host.
 */
export async function checkToken(deps: AuthDeps, server: string, token: string): Promise<void> {
  let r: Response;
  try {
    r = await deps.fetch(server + '/api/', { method: 'GET', headers: { Authorization: 'Bearer ' + token }, redirect: 'manual' });
  } catch (e) {
    throw networkError(e);
  }
  if (r.status >= 300 && r.status < 400) throw new AuthError('server', 'The server moved to another address. Type the final address of the server.');
  if (r.status === 401) throw new AuthError('rejected', TOKEN_REJECTED);
  if (r.status !== 200) throw new AuthError('server', 'The server answered ' + r.status);
}

/** The saved server URL and token. A token without a server URL does not count. */
export function readCredentials(storage: TokenStorage): Credentials {
  const server = storage.getItem(SERVER_KEY) ?? '';
  const token = storage.getItem(TOKEN_KEY);
  return { server, token: server !== '' && token ? token : null };
}

export function saveCredentials(storage: TokenStorage, server: string, token: string): void {
  storage.setItem(SERVER_KEY, server);
  storage.setItem(TOKEN_KEY, token);
}

/** Delete the token and keep the server URL. The application cannot revoke a long-lived token. */
export function clearToken(storage: TokenStorage): void {
  storage.removeItem(TOKEN_KEY);
}

/** The text of an error for the screen. */
export function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
