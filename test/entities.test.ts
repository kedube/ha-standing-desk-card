import { describe, expect, it } from 'vitest';
import { findDeskDevices, mapEntityIds, missingRoles, resolveEntities } from '../src/entities';
import type { HassEntity, HomeAssistant, StandingDeskCardConfig } from '../src/types';

const DESK_OBJECT_IDS = [
  'number.%_desk_height',
  'sensor.%_desk_height',
  'sensor.%_desk_height_percent',
  'sensor.%_desk_status',
  'button.%_desk_nudge_up',
  'button.%_desk_nudge_down',
  'button.%_desk_stop',
  'number.%_min_height',
  'number.%_max_height',
  'sensor.%_idle_time',
  'sensor.%_idle_timestamp',
  'button.%_desk_m1',
  'button.%_desk_m2',
  'button.%_desk_m3',
  'button.%_desk_m4',
  'button.%_set_desk_m1',
  'button.%_set_desk_m2',
  'button.%_set_desk_m3',
  'button.%_set_desk_m4',
  'sensor.%_desk_m1_height',
  'sensor.%_desk_m2_height',
  'sensor.%_desk_m3_height',
  'sensor.%_desk_m4_height',
  'cover.%_height_slider',
  'button.%_reset_idle_timer',
];

function deskIds(prefix: string, suffix = ''): string[] {
  return DESK_OBJECT_IDS.map((pattern) => pattern.replace('%', prefix) + suffix);
}

function makeHass(devices: Record<string, string[]>, withRegistry = true): HomeAssistant {
  const states: Record<string, HassEntity> = {};
  const entities: NonNullable<HomeAssistant['entities']> = {};
  for (const [deviceId, ids] of Object.entries(devices)) {
    for (const entityId of ids) {
      states[entityId] = { entity_id: entityId, state: '1', attributes: {} };
      entities[entityId] = { entity_id: entityId, device_id: deviceId, platform: 'esphome' };
    }
  }
  states['light.kitchen'] = { entity_id: 'light.kitchen', state: 'on', attributes: {} };
  return {
    states,
    entities: withRegistry ? entities : undefined,
    config: { unit_system: { length: 'km' } },
    callService: async () => undefined,
  };
}

const config = (extra: Partial<StandingDeskCardConfig> = {}): StandingDeskCardConfig => ({
  type: 'custom:standing-desk-card',
  ...extra,
});

describe('entity discovery', () => {
  it('maps every DeskUp Pro role, keeping go-to and save buttons apart', () => {
    const map = mapEntityIds(deskIds('deskup_pro_controller'));
    expect(map.height).toBe('number.deskup_pro_controller_desk_height');
    expect(map.height_sensor).toBe('sensor.deskup_pro_controller_desk_height');
    expect(map.preset_1).toBe('button.deskup_pro_controller_desk_m1');
    expect(map.save_preset_1).toBe('button.deskup_pro_controller_set_desk_m1');
    expect(map.preset_4_height).toBe('sensor.deskup_pro_controller_desk_m4_height');
    expect(map.idle_time).toBe('sensor.deskup_pro_controller_idle_time');
    expect(map.min_height).toBe('number.deskup_pro_controller_min_height');
    expect(missingRoles(map, 4)).toEqual([]);
  });

  it('handles Home Assistant de-duplication suffixes', () => {
    const map = mapEntityIds(deskIds('deskup_pro_controller', '_2'));
    expect(map.height).toBe('number.deskup_pro_controller_desk_height_2');
    expect(map.save_preset_2).toBe('button.deskup_pro_controller_set_desk_m2_2');
  });

  it('uses the configured device', () => {
    const hass = makeHass({ a: deskIds('office_desk'), b: deskIds('studio_desk') });
    const { entities } = resolveEntities(hass, config({ device: 'b' }));
    expect(entities.height).toBe('number.studio_desk_desk_height');
  });

  it('finds the first DeskUp Pro device when none is configured', () => {
    const hass = makeHass({ other: ['sensor.weather_temperature'], desk: deskIds('deskup_pro_controller') });
    expect(findDeskDevices(hass)).toEqual(['desk']);
    expect(resolveEntities(hass, config()).deviceId).toBe('desk');
  });

  it('falls back to entity ids when there is no entity registry', () => {
    const hass = makeHass({ desk: deskIds('my_desk') }, false);
    const { entities } = resolveEntities(hass, config());
    expect(entities.nudge_up).toBe('button.my_desk_desk_nudge_up');
    expect(entities.preset_3).toBe('button.my_desk_desk_m3');
  });

  it('applies per-role overrides', () => {
    const hass = makeHass({ desk: deskIds('deskup_pro_controller') });
    const { entities } = resolveEntities(hass, config({ entities: { stop: 'script.stop_desk' } }));
    expect(entities.stop).toBe('script.stop_desk');
  });

  it('only requires as many presets as the controller has', () => {
    const ids = deskIds('desk').filter((id) => !/_m[34]($|_)/.test(id));
    const map = mapEntityIds(ids);
    expect(missingRoles(map, 2)).toEqual([]);
    expect(missingRoles(map, 3)).toEqual(['preset_3']);
    expect(missingRoles(map, 4)).toEqual(['preset_3', 'preset_4']);
  });
});
