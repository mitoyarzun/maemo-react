import { describe, expect, test } from 'vitest';
import { brightnessCall, brightnessPct, coverCall, coverFeatures, hasBrightness, hvacModes, modeCall, positionCall, temperatureCall, temperatureStep, toggleCall } from '../src/ha/actions.js';
import type { Entity } from '../src/ha/types.js';

const entity = (id: string, state: string, attrs: Record<string, unknown> = {}): Entity => ({
  id, domain: id.slice(0, id.indexOf('.')) as Entity['domain'], name: id, areaId: null, state, attrs,
});

describe('actions', () => {
  test('toggle for on/off domains only', () => {
    expect(toggleCall(entity('light.a', 'on'))).toEqual({ domain: 'light', service: 'toggle', target: { entity_id: 'light.a' } });
    expect(toggleCall(entity('input_boolean.a', 'off'))?.service).toBe('toggle');
    expect(toggleCall(entity('climate.a', 'heat'))).toBeNull();
    expect(toggleCall(entity('cover.a', 'open'))).toBeNull();
  });

  test('brightness', () => {
    const e = entity('light.a', 'on', { brightness: 128, supported_color_modes: ['brightness'] });
    expect(brightnessCall(e, 60.4)).toEqual({ domain: 'light', service: 'turn_on', service_data: { brightness_pct: 60 }, target: { entity_id: 'light.a' } });
    expect(brightnessCall(e, 150).service_data).toEqual({ brightness_pct: 100 });
    expect([hasBrightness(e), hasBrightness(entity('light.b', 'on', { supported_color_modes: ['onoff'] })), hasBrightness(entity('light.c', 'on'))]).toEqual([true, false, false]);
    expect([brightnessPct(e), brightnessPct(entity('light.b', 'off', { brightness: 128 }))]).toEqual([50, 0]);
  });

  test('temperature steps within the limits', () => {
    const e = entity('climate.a', 'heat', { temperature: 21, target_temp_step: 0.5, min_temp: 7, max_temp: 21.4 });
    expect(temperatureStep(e)).toBe(0.5);
    expect(temperatureCall(e, 1)?.service_data).toEqual({ temperature: 21.4 });
    expect(temperatureCall(e, -1)).toEqual({ domain: 'climate', service: 'set_temperature', service_data: { temperature: 20.5 }, target: { entity_id: 'climate.a' } });
    expect(temperatureStep(entity('climate.b', 'heat'))).toBe(0.5);
    expect(temperatureCall(entity('climate.b', 'heat'), 1)).toBeNull();
    expect(temperatureCall(entity('climate.c', 'heat', { temperature: 20.1, target_temp_step: 1 }), 1)?.service_data).toEqual({ temperature: 21.1 });
  });

  test('mode', () => {
    const e = entity('climate.a', 'heat', { hvac_modes: ['off', 'heat', 7] });
    expect(hvacModes(e)).toEqual(['off', 'heat']);
    expect(modeCall(e, 'off')).toEqual({ domain: 'climate', service: 'set_hvac_mode', service_data: { hvac_mode: 'off' }, target: { entity_id: 'climate.a' } });
  });

  test('cover', () => {
    const e = entity('cover.a', 'open', { supported_features: 15, current_position: 100 });
    expect(coverFeatures(e)).toEqual({ open: true, close: true, stop: true, position: true });
    expect(coverFeatures(entity('cover.b', 'open', { supported_features: 3 }))).toEqual({ open: true, close: true, stop: false, position: false });
    expect(coverFeatures(entity('cover.c', 'open', { supported_features: 4 }))).toEqual({ open: false, close: false, stop: false, position: false });
    expect(coverCall(e, 'open').service).toBe('open_cover');
    expect(coverCall(e, 'stop').service).toBe('stop_cover');
    expect(coverCall(e, 'close').service).toBe('close_cover');
    expect(positionCall(e, 40)).toEqual({ domain: 'cover', service: 'set_cover_position', service_data: { position: 40 }, target: { entity_id: 'cover.a' } });
  });
});
