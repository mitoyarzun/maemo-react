import { platform, quit } from 'maemo:app';
import * as gobject from 'maemo:gobject';
import type { Bridge } from './bridge.js';
import { createRenderer } from './renderer.js';

export type { Bridge, Handle, Platform, WidgetTarget } from './bridge.js';
export type { Renderer, RendererOptions, Root } from './renderer.js';
export { createRenderer } from './renderer.js';

const renderer = createRenderer(gobject as Bridge, platform, {
  onWindowClosed: () => quit(0),
  onFatalError: () => quit(1),
});

/** Render an element tree. The application runs until its window closes. */
export const render = renderer.render;
export const createRoot = renderer.createRoot;
/** Run fn like an event handler: its updates render before flushSync returns. */
export const flushSync = renderer.flushSync;
/** Show a Hildon banner with the text (hildon_banner_show_information). */
export const banner = renderer.banner;
