// The application manifest (app.json) and the install paths on the tablet.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const PREFIX = '/opt/n810-modern';
export const HOST = `${PREFIX}/bin/maemo-react-host`;
export const APPS = `${PREFIX}/share/maemo-react/apps`;
export const RUNTIME_DEPENDS = 'maemo-react-runtime (>= 0.3.0)';

export interface AppManifest {
  /** The Debian package name: a-z, 0-9, "+", "-" and ".". */
  id: string;
  /** The name in the menu. */
  name: string;
  version: string;
  description?: string;
  maintainer?: string;
  /** A PNG file, relative to the application folder. */
  icon?: string;
  deploy?: { host?: string; port?: number; user?: string };
}

/** Checks for values that reach ssh, scp and a remote shell. Each one throws an Error that names the field. */
export function checkUser(user: unknown, field = 'user'): string {
  if (typeof user !== 'string' || !/^[A-Za-z0-9._-]+$/.test(user) || user.startsWith('-')) {
    throw new Error(`${field} must contain only letters, digits, ".", "_" and "-", not ${JSON.stringify(user)}`);
  }
  return user;
}

export function checkHost(host: unknown, field = 'host'): string {
  if (typeof host !== 'string' || !/^[A-Za-z0-9.:[\]-]+$/.test(host) || host.startsWith('-')) {
    throw new Error(`${field} must be a host name or an IP address, not ${JSON.stringify(host)}`);
  }
  return host;
}

export function checkPort(port: unknown, field = 'port'): number {
  if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${field} must be an integer from 1 to 65535, not ${JSON.stringify(port)}`);
  }
  return port;
}

export function checkDebName(name: string): string {
  if (!/^[A-Za-z0-9._+~-]+\.deb$/.test(name)) {
    throw new Error(`the .deb file name has a bad character: ${JSON.stringify(name)}`);
  }
  return name;
}

export function readManifest(dir: string): AppManifest {
  const path = join(dir, 'app.json');
  let m: AppManifest;
  try {
    m = JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    throw new Error(`cannot read ${path}: ${(e as Error).message}`);
  }
  if (typeof m !== 'object' || m === null || Array.isArray(m)) throw new Error(`${path}: must contain a JSON object`);
  if (typeof m.id !== 'string' || !/^[a-z0-9][a-z0-9+.-]+$/.test(m.id)) {
    throw new Error(`app.json: "id" must be a Debian package name (a-z, 0-9, + - .), not ${JSON.stringify(m.id)}`);
  }
  if (typeof m.name !== 'string' || m.name.trim() === '') throw new Error('app.json: "name" is missing');
  if (typeof m.version !== 'string' || !/^[0-9][A-Za-z0-9.+~-]*$/.test(m.version)) {
    throw new Error(`app.json: "version" must start with a digit, not ${JSON.stringify(m.version)}`);
  }
  for (const key of ['name', 'description', 'maintainer'] as const) {
    const v = m[key];
    if (v !== undefined && (typeof v !== 'string' || /[\r\n]/.test(v))) {
      throw new Error(`app.json: "${key}" must be one line of text`);
    }
  }
  if (m.deploy !== undefined) {
    if (typeof m.deploy !== 'object' || m.deploy === null) throw new Error('app.json: "deploy" must be an object');
    try {
      if (m.deploy.host !== undefined) checkHost(m.deploy.host, 'deploy.host');
      if (m.deploy.user !== undefined) checkUser(m.deploy.user, 'deploy.user');
      if (m.deploy.port !== undefined) checkPort(m.deploy.port, 'deploy.port');
    } catch (e) {
      throw new Error('app.json: ' + (e as Error).message);
    }
  }
  return m;
}
