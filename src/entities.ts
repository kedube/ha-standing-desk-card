import { PRESET_NUMBERS } from './types';
import type { EntityMap, EntityRole, HomeAssistant, StandingDeskCardConfig } from './types';

interface RoleSpec {
  domain: string;
  /** Entity-name part of the id the DeskUp Pro firmware produces, e.g. `desk_nudge_up`. */
  suffix: string;
}

// Entity ids follow "<domain>.<device friendly name>_<entity name>", e.g.
// button.deskup_pro_controller_desk_m1 (see the controller's common/base.yaml).
export const ROLE_SPECS: Record<EntityRole, RoleSpec> = {
  height: { domain: 'number', suffix: 'desk_height' },
  height_sensor: { domain: 'sensor', suffix: 'desk_height' },
  status: { domain: 'sensor', suffix: 'desk_status' },
  nudge_up: { domain: 'button', suffix: 'desk_nudge_up' },
  nudge_down: { domain: 'button', suffix: 'desk_nudge_down' },
  stop: { domain: 'button', suffix: 'desk_stop' },
  min_height: { domain: 'number', suffix: 'min_height' },
  max_height: { domain: 'number', suffix: 'max_height' },
  idle_time: { domain: 'sensor', suffix: 'idle_time' },
  preset_1: { domain: 'button', suffix: 'desk_m1' },
  preset_2: { domain: 'button', suffix: 'desk_m2' },
  preset_3: { domain: 'button', suffix: 'desk_m3' },
  preset_4: { domain: 'button', suffix: 'desk_m4' },
  save_preset_1: { domain: 'button', suffix: 'set_desk_m1' },
  save_preset_2: { domain: 'button', suffix: 'set_desk_m2' },
  save_preset_3: { domain: 'button', suffix: 'set_desk_m3' },
  save_preset_4: { domain: 'button', suffix: 'set_desk_m4' },
  preset_1_height: { domain: 'sensor', suffix: 'desk_m1_height' },
  preset_2_height: { domain: 'sensor', suffix: 'desk_m2_height' },
  preset_3_height: { domain: 'sensor', suffix: 'desk_m3_height' },
  preset_4_height: { domain: 'sensor', suffix: 'desk_m4_height' },
};

const ROLES = Object.keys(ROLE_SPECS) as EntityRole[];

/** Length of the matched suffix, or 0. Allows HA's "_2" de-duplication suffix. */
function suffixMatch(entityId: string, spec: RoleSpec): number {
  const dot = entityId.indexOf('.');
  if (entityId.slice(0, dot) !== spec.domain) return 0;
  const objectId = entityId.slice(dot + 1).replace(/_\d+$/, '');
  if (objectId === spec.suffix || objectId.endsWith(`_${spec.suffix}`)) return spec.suffix.length;
  return 0;
}

/**
 * Assigns each entity id to the role with the longest matching suffix, so that
 * `button.x_set_desk_m1` becomes save_preset_1 rather than preset_1.
 */
export function mapEntityIds(entityIds: Iterable<string>): EntityMap {
  const found: EntityMap = {};
  for (const entityId of entityIds) {
    let bestRole: EntityRole | undefined;
    let bestLength = 0;
    for (const role of ROLES) {
      const length = suffixMatch(entityId, ROLE_SPECS[role]);
      if (length > bestLength) {
        bestLength = length;
        bestRole = role;
      }
    }
    if (!bestRole) continue;
    const current = found[bestRole];
    // Prefer the id without a de-duplication suffix, then the shorter one.
    if (!current || entityId.length < current.length) found[bestRole] = entityId;
  }
  return found;
}

function deviceEntityIds(hass: HomeAssistant, deviceId: string): string[] {
  return Object.values(hass.entities ?? {})
    .filter((entry) => entry.device_id === deviceId)
    .map((entry) => entry.entity_id);
}

function looksLikeDesk(map: EntityMap): boolean {
  return Boolean(map.height && map.nudge_up && map.preset_1);
}

/** Device ids that expose the DeskUp Pro entity set. */
export function findDeskDevices(hass: HomeAssistant): string[] {
  const byDevice = new Map<string, string[]>();
  for (const entry of Object.values(hass.entities ?? {})) {
    if (!entry.device_id) continue;
    const list = byDevice.get(entry.device_id) ?? [];
    list.push(entry.entity_id);
    byDevice.set(entry.device_id, list);
  }
  return [...byDevice.entries()].filter(([, ids]) => looksLikeDesk(mapEntityIds(ids))).map(([id]) => id);
}

/** Fallback when the entity registry isn't available: group state ids by their shared prefix. */
function discoverFromStates(hass: HomeAssistant): EntityMap {
  const heightIds = Object.keys(hass.states).filter((id) => suffixMatch(id, ROLE_SPECS.height) > 0).sort();
  for (const heightId of heightIds) {
    const prefix = heightId.slice('number.'.length).replace(/_\d+$/, '').slice(0, -'desk_height'.length);
    const ids = Object.keys(hass.states).filter((id) => id.slice(id.indexOf('.') + 1).startsWith(prefix));
    const map = mapEntityIds(ids);
    if (looksLikeDesk(map)) return map;
  }
  return {};
}

export interface ResolvedEntities {
  entities: EntityMap;
  deviceId?: string;
}

export function resolveEntities(hass: HomeAssistant, config: StandingDeskCardConfig): ResolvedEntities {
  let deviceId = config.device;
  let entities: EntityMap = {};
  if (deviceId) {
    entities = mapEntityIds(deviceEntityIds(hass, deviceId));
  } else if (hass.entities) {
    deviceId = findDeskDevices(hass)[0];
    if (deviceId) entities = mapEntityIds(deviceEntityIds(hass, deviceId));
  }
  if (!deviceId && !entities.height) entities = discoverFromStates(hass);

  for (const [role, entityId] of Object.entries(config.entities ?? {})) {
    if (typeof entityId === 'string' && entityId && role in ROLE_SPECS) entities[role as EntityRole] = entityId;
  }
  return { entities, deviceId };
}

/** Roles the card can't work without, given the configured preset count. */
export function missingRoles(entities: EntityMap, presetCount: number): EntityRole[] {
  const required: EntityRole[] = ['height', 'nudge_up', 'nudge_down', 'stop'];
  for (const n of PRESET_NUMBERS.slice(0, presetCount)) required.push(`preset_${n}`);
  return required.filter((role) => !entities[role]);
}
