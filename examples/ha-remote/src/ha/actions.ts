// An entity and a user action to a service call (HA spec section 4). Pure
// functions: no network, no state.
import type { Entity, ServiceCall } from './types.js';

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

function call(e: Entity, service: string, data?: Record<string, unknown>): ServiceCall {
  return data ? { domain: e.domain, service, service_data: data, target: { entity_id: e.id } } : { domain: e.domain, service, target: { entity_id: e.id } };
}

/** The toggle of a row: <domain>.toggle. null for climate and cover. */
export function toggleCall(e: Entity): ServiceCall | null {
  return e.domain === 'climate' || e.domain === 'cover' ? null : call(e, 'toggle');
}

/** A light has a brightness when it supports a color mode other than onoff. */
export function hasBrightness(e: Entity): boolean {
  const modes = e.attrs.supported_color_modes;
  return Array.isArray(modes) && modes.some((m) => m !== 'onoff');
}

/** The brightness in percent; 0 when the light is off. */
export function brightnessPct(e: Entity): number {
  const b = e.attrs.brightness;
  return e.state === 'on' && typeof b === 'number' ? Math.round((b / 255) * 100) : 0;
}

export function brightnessCall(e: Entity, pct: number): ServiceCall {
  return call(e, 'turn_on', { brightness_pct: clamp(Math.round(pct), 0, 100) });
}

export function temperatureStep(e: Entity): number {
  const s = e.attrs.target_temp_step;
  return typeof s === 'number' && s > 0 ? s : 0.5;
}

/** The target temperature one step up or down, within min_temp..max_temp. null without a target. */
export function temperatureCall(e: Entity, direction: 1 | -1): ServiceCall | null {
  const t = e.attrs.temperature;
  if (typeof t !== 'number') return null;
  const min = typeof e.attrs.min_temp === 'number' ? e.attrs.min_temp : 7;
  const max = typeof e.attrs.max_temp === 'number' ? e.attrs.max_temp : 35;
  const next = clamp(Math.round((t + direction * temperatureStep(e)) * 10) / 10, min, max);
  return call(e, 'set_temperature', { temperature: next });
}

export function hvacModes(e: Entity): string[] {
  const modes = e.attrs.hvac_modes;
  return Array.isArray(modes) ? modes.filter((m): m is string => typeof m === 'string') : [];
}

export function modeCall(e: Entity, mode: string): ServiceCall {
  return call(e, 'set_hvac_mode', { hvac_mode: mode });
}

const COVER_OPEN = 1;
const COVER_CLOSE = 2;
const COVER_SET_POSITION = 4;
const COVER_STOP = 8;

/** The buttons of a cover, from supported_features. position needs a current_position too. */
export function coverFeatures(e: Entity): { open: boolean; close: boolean; stop: boolean; position: boolean } {
  const f = typeof e.attrs.supported_features === 'number' ? e.attrs.supported_features : 0;
  return {
    open: (f & COVER_OPEN) !== 0,
    close: (f & COVER_CLOSE) !== 0,
    stop: (f & COVER_STOP) !== 0,
    position: (f & COVER_SET_POSITION) !== 0 && typeof e.attrs.current_position === 'number',
  };
}

export function coverCall(e: Entity, action: 'open' | 'stop' | 'close'): ServiceCall {
  return call(e, action + '_cover');
}

export function positionCall(e: Entity, position: number): ServiceCall {
  return call(e, 'set_cover_position', { position: clamp(Math.round(position), 0, 100) });
}
