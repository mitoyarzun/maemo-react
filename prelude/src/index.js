// The prelude: web-standard globals for maemo-react applications. The host
// runs this module before the application.
import * as http from 'maemo:http';
import * as storage from 'maemo:storage';
import * as ws from 'maemo:ws';
import { installConsole } from './console.js';
import { TextDecoder, TextEncoder } from './encoding.js';
import { AbortController, AbortSignal, DOMException, Event, EventTarget } from './events.js';
import { createFetch, Headers, Request, Response } from './fetch.js';
import { createStorage } from './storage.js';
import { URL, URLSearchParams } from './url.js';
import { CloseEvent, MessageEvent, createWebSocket } from './websocket.js';

installConsole(globalThis.console);

function define(name, value) {
  Object.defineProperty(globalThis, name, { value, writable: true, configurable: true, enumerable: false });
}

define('TextEncoder', TextEncoder);
define('TextDecoder', TextDecoder);
define('URL', URL);
define('URLSearchParams', URLSearchParams);
define('Event', Event);
define('EventTarget', EventTarget);
define('AbortController', AbortController);
define('AbortSignal', AbortSignal);
define('DOMException', DOMException);
define('Headers', Headers);
define('Request', Request);
define('Response', Response);
define('fetch', createFetch(http));
define('WebSocket', createWebSocket(ws));
define('CloseEvent', CloseEvent);
define('MessageEvent', MessageEvent);
define('queueMicrotask', function queueMicrotask(fn) {
  if (typeof fn !== 'function') throw new TypeError('queueMicrotask: the argument must be a function');
  Promise.resolve().then(() => fn());
});

// localStorage reads its file on the first use, so an application that does
// not use it pays nothing.
let localStorage = null;
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  enumerable: false,
  get() {
    if (!localStorage) localStorage = createStorage(storage);
    return localStorage;
  },
});
