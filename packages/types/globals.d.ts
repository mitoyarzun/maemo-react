// The web-standard globals that maemo-react-host gives. This is a subset of
// lib.dom on purpose: an application that uses anything else does not compile,
// because the tablet does not have it.
declare global {
  interface Console {
    log(...data: unknown[]): void;
    info(...data: unknown[]): void;
    debug(...data: unknown[]): void;
    warn(...data: unknown[]): void;
    error(...data: unknown[]): void;
    trace(...data: unknown[]): void;
    assert(condition?: boolean, ...data: unknown[]): void;
    dir(item?: unknown): void;
  }
  var console: Console;

  interface Performance {
    now(): number;
  }
  var performance: Performance;

  function setTimeout<A extends unknown[]>(handler: (...args: A) => void, timeout?: number, ...args: A): number;
  function setInterval<A extends unknown[]>(handler: (...args: A) => void, timeout?: number, ...args: A): number;
  function clearTimeout(id?: number): void;
  function clearInterval(id?: number): void;
  function queueMicrotask(callback: () => void): void;

  class TextEncoder {
    readonly encoding: 'utf-8';
    encode(input?: string): Uint8Array;
  }

  class TextDecoder {
    constructor(label?: string, options?: { fatal?: boolean; ignoreBOM?: boolean });
    readonly encoding: 'utf-8';
    readonly fatal: boolean;
    readonly ignoreBOM: boolean;
    decode(input?: ArrayBuffer | ArrayBufferView): string;
  }

  class URLSearchParams implements Iterable<[string, string]> {
    constructor(init?: string | Record<string, string> | Iterable<[string, string]> | URLSearchParams);
    readonly size: number;
    append(name: string, value: string): void;
    delete(name: string, value?: string): void;
    get(name: string): string | null;
    getAll(name: string): string[];
    has(name: string, value?: string): boolean;
    set(name: string, value: string): void;
    sort(): void;
    forEach(fn: (value: string, key: string, parent: URLSearchParams) => void, thisArg?: unknown): void;
    entries(): IterableIterator<[string, string]>;
    keys(): IterableIterator<string>;
    values(): IterableIterator<string>;
    [Symbol.iterator](): IterableIterator<[string, string]>;
    toString(): string;
  }

  class URL {
    constructor(url: string | URL, base?: string | URL);
    static canParse(url: string | URL, base?: string | URL): boolean;
    href: string;
    readonly protocol: string;
    readonly username: string;
    readonly password: string;
    readonly host: string;
    readonly hostname: string;
    readonly port: string;
    readonly origin: string;
    pathname: string;
    search: string;
    readonly searchParams: URLSearchParams;
    hash: string;
    toString(): string;
    toJSON(): string;
  }

  class Event {
    constructor(type: string, init?: { bubbles?: boolean; cancelable?: boolean });
    readonly type: string;
    readonly bubbles: boolean;
    readonly cancelable: boolean;
    readonly defaultPrevented: boolean;
    readonly target: EventTarget | null;
    readonly currentTarget: EventTarget | null;
    readonly timeStamp: number;
    preventDefault(): void;
    stopPropagation(): void;
    stopImmediatePropagation(): void;
  }

  type EventListenerOrObject = ((event: Event) => void) | { handleEvent(event: Event): void };

  class EventTarget {
    addEventListener(type: string, listener: EventListenerOrObject | null, options?: { once?: boolean } | boolean): void;
    removeEventListener(type: string, listener: EventListenerOrObject | null): void;
    dispatchEvent(event: Event): boolean;
  }

  class DOMException extends Error {
    constructor(message?: string, name?: string);
    readonly code: number;
  }

  class AbortSignal extends EventTarget {
    readonly aborted: boolean;
    readonly reason: unknown;
    onabort: ((event: Event) => void) | null;
    throwIfAborted(): void;
    static abort(reason?: unknown): AbortSignal;
    static timeout(ms: number): AbortSignal;
  }

  class AbortController {
    readonly signal: AbortSignal;
    abort(reason?: unknown): void;
  }

  type HeadersInit = Headers | Record<string, string> | Iterable<[string, string]>;

  class Headers implements Iterable<[string, string]> {
    constructor(init?: HeadersInit);
    append(name: string, value: string): void;
    set(name: string, value: string): void;
    get(name: string): string | null;
    has(name: string): boolean;
    delete(name: string): void;
    getSetCookie(): string[];
    forEach(fn: (value: string, key: string, parent: Headers) => void, thisArg?: unknown): void;
    entries(): IterableIterator<[string, string]>;
    keys(): IterableIterator<string>;
    values(): IterableIterator<string>;
    [Symbol.iterator](): IterableIterator<[string, string]>;
  }

  type BodyInit = string | URLSearchParams | ArrayBuffer | ArrayBufferView;

  interface RequestInit {
    method?: string;
    headers?: HeadersInit;
    body?: BodyInit | null;
    signal?: AbortSignal | null;
    redirect?: 'follow' | 'manual';
  }

  class Request {
    constructor(input: string | URL | Request, init?: RequestInit);
    readonly url: string;
    readonly method: string;
    readonly headers: Headers;
    readonly signal: AbortSignal | null;
    readonly redirect: 'follow' | 'manual';
  }

  interface ResponseInit {
    status?: number;
    statusText?: string;
    headers?: HeadersInit;
  }

  class Response {
    constructor(body?: BodyInit | null, init?: ResponseInit);
    static json(data: unknown, init?: ResponseInit): Response;
    readonly ok: boolean;
    readonly status: number;
    readonly statusText: string;
    readonly headers: Headers;
    readonly url: string;
    readonly redirected: boolean;
    readonly type: string;
    readonly bodyUsed: boolean;
    arrayBuffer(): Promise<ArrayBuffer>;
    bytes(): Promise<Uint8Array>;
    text(): Promise<string>;
    json(): Promise<any>;
  }

  function fetch(input: string | URL | Request, init?: RequestInit): Promise<Response>;

  class CloseEvent extends Event {
    constructor(type: string, init?: { wasClean?: boolean; code?: number; reason?: string });
    readonly wasClean: boolean;
    readonly code: number;
    readonly reason: string;
  }

  class MessageEvent<T = unknown> extends Event {
    constructor(type: string, init?: { data?: T; origin?: string });
    readonly data: T;
    readonly origin: string;
    readonly lastEventId: string;
  }

  /** The error event of a WebSocket. message is a maemo-react extension: the curl error text. */
  interface WebSocketErrorEvent extends Event {
    readonly message?: string;
  }

  /**
   * A WebSocket on libcurl. ws and wss only (an http or https URL is
   * converted). A text message gives a string, a binary message an
   * ArrayBuffer. TLS checks the certificate against the n810-modern CA store.
   */
  class WebSocket extends EventTarget {
    constructor(url: string | URL, protocols?: string | string[]);
    static readonly CONNECTING: 0;
    static readonly OPEN: 1;
    static readonly CLOSING: 2;
    static readonly CLOSED: 3;
    readonly CONNECTING: 0;
    readonly OPEN: 1;
    readonly CLOSING: 2;
    readonly CLOSED: 3;
    readonly url: string;
    readonly readyState: 0 | 1 | 2 | 3;
    readonly protocol: string;
    readonly extensions: string;
    readonly bufferedAmount: number;
    /** Only 'arraybuffer': the tablet has no Blob. */
    binaryType: 'arraybuffer';
    onopen: ((event: Event) => void) | null;
    onmessage: ((event: MessageEvent<string | ArrayBuffer>) => void) | null;
    onerror: ((event: WebSocketErrorEvent) => void) | null;
    onclose: ((event: CloseEvent) => void) | null;
    send(data: string | ArrayBuffer | ArrayBufferView): void;
    /** code: 1000 or 3000 to 4999. reason: at most 123 bytes of UTF-8. */
    close(code?: number, reason?: string): void;
  }

  /**
   * localStorage: a JSON file in /home/user/.maemo-react/<app-id>/, mode
   * 0600, written during idle time after a change. The keys and values
   * together are at most 1,048,576 characters; setItem above that throws a
   * DOMException QuotaExceededError. There is no sessionStorage and no
   * storage event.
   */
  interface Storage {
    readonly length: number;
    key(index: number): string | null;
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
    clear(): void;
  }
  var localStorage: Storage;
}

export {};
