// The native modules of maemo-react-host.

declare module 'maemo:app' {
  /** Stop the application with an exit code. */
  export function quit(code?: number): void;
  /** The path of the application module, then its arguments. */
  export const args: string[];
  /** The maemo-react version, for example "0.1.0". */
  export const version: string;
  /** 'hildon' on the tablet, 'desktop' in the desktop dev host. */
  export const platform: 'hildon' | 'desktop';
  /** The application id: $MR_APP_ID, else the <id> of the install path, else the module file name. */
  export const id: string;
  /** /home/user/.maemo-react/<id> on the tablet; $MR_DATA_DIR/<id> when that is set. */
  export const dataDir: string;
}

declare module 'maemo:gobject' {
  export type Handle = number;
  export function create(type: string): Handle;
  export function set(h: Handle, prop: string, value: unknown): void;
  export function get(h: Handle, prop: string): unknown;
  export function reset(h: Handle, prop: string): void;
  export function connect(h: Handle, signal: string, fn: (...args: any[]) => unknown): number;
  export function childSet(parent: Handle, child: Handle, prop: string, value: unknown): void;
  export function childGet(parent: Handle, child: Handle, prop: string): unknown;
  export function call(h: Handle, helper: string, ...args: unknown[]): unknown;
  export function destroy(h: Handle): void;
}

declare module 'maemo:http' {
  export interface RequestOptions {
    url: string;
    method?: string;
    headers?: Array<[string, string]>;
    body?: ArrayBuffer | null;
    timeoutMs?: number;
    followRedirects?: boolean;
  }
  export type HttpEvent =
    | { type: 'headers'; status: number; statusText: string; url: string; redirected: boolean; headers: Array<[string, string]> }
    | { type: 'data'; chunk: ArrayBuffer }
    | { type: 'end' }
    | { type: 'error'; message: string; code: number };
  export function request(options: RequestOptions, onEvent: (event: HttpEvent) => void): number;
  export function abort(id: number): void;
}

declare module 'maemo:ws' {
  export interface OpenOptions {
    /** A ws or wss URL. */
    url: string;
    /** Sec-WebSocket-Protocol. */
    protocols?: string[];
    /** The handshake limit. Default 30000. */
    timeoutMs?: number;
  }
  export type WsEvent =
    | { type: 'open'; protocol: string }
    | { type: 'message'; data: string | ArrayBuffer }
    | { type: 'error'; message: string }
    | { type: 'close'; code: number; reason: string; wasClean: boolean }; // error always comes before close with wasClean false, except when the 5 s wait for server close times out
  export function open(options: OpenOptions, onEvent: (event: WsEvent) => void): number;
  /**
   * Returns true when the data is queued. Returns false, and sends nothing,
   * when the connection is not open (connecting or closing). Throws a
   * TypeError for an unknown id or a bad argument.
   */
  export function send(id: number, data: string | ArrayBuffer, binary: boolean): boolean;
  /** code 0 sends a close frame without a payload. */
  export function close(id: number, code: number, reason: string): void;
  /** Drop the connection. No more events. */
  export function abort(id: number): void;
  export function bufferedAmount(id: number): number;
}

declare module 'maemo:debug' {
  export function stats(): { handles: number; closures: number; jsMallocSize: number };
  /** Milliseconds spent in GTK setters and layout helpers since the last call. */
  export function bridgeTime(): number;
  /** Paint all pending changes now, and wait for the X server. */
  export function flushPaint(): void;
  export function cpu(): { governor: string; kHz: number | null } | null;
  export function gc(): void;
}

declare module 'maemo:storage' {
  /** The text of <dataDir>/localStorage.json, or null when there is none. */
  export function load(): string | null;
  /** Call fn during idle time and write its result to the file. */
  export function schedule(fn: () => string): void;
  /** Rename the file to localStorage.json.bad. */
  export function markBad(): void;
  /** Write a pending change now. */
  export function flush(): void;
  export function path(): string;
}
