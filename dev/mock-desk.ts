import type { HassEntity, HomeAssistant } from '../src/types';

const PREFIX = 'deskup_pro_controller';
const DEVICE_ID = 'deskup-pro-dev';
const SPEED = 1.57 * 2.54; // cm/s, UPLIFT V2
const TICK_MS = 100;

/**
 * Simulates a DeskUp Pro controller (entity ids from its common/base.yaml) on an UPLIFT V2:
 * set_value travels to a height, M1–M4 recall presets, Set M1–M4 store the current height,
 * nudges move ~1 cm each and accumulate while held, Stop halts.
 */
export class MockDesk {
  height = 74.2;
  min = 64.3;
  max = 129.3;
  presets = [72.4, 113.0, 95.3, 66.0];
  available = true;
  unit: 'km' | 'mi' = 'mi';
  darkMode = false;
  private target: number | null = null;
  private status: 'Idle' | 'Raising' | 'Lowering' = 'Idle';
  private idleSeconds = 0;
  private listeners = new Set<(hass: HomeAssistant) => void>();
  private registry = this.buildRegistry();
  private config = { unit_system: { length: this.unit as string } };
  private themes = { darkMode: false };
  readonly log: string[] = [];

  subscribe(listener: (hass: HomeAssistant) => void): void {
    this.listeners.add(listener);
    listener(this.hass());
  }

  start(): void {
    setInterval(() => this.tick(), TICK_MS);
  }

  setUnit(length: 'km' | 'mi'): void {
    this.unit = length;
    this.config = { unit_system: { length } };
    this.emit();
  }

  setDarkMode(dark: boolean): void {
    this.darkMode = dark;
    this.themes = { darkMode: dark };
    this.emit();
  }

  setAvailable(available: boolean): void {
    this.available = available;
    if (!available) this.target = null;
    this.emit();
  }

  /** Jumps straight to a height (for screenshots). */
  jumpTo(height: number): void {
    this.target = null;
    this.status = 'Idle';
    this.height = height;
    this.emit();
  }

  hass(): HomeAssistant {
    return {
      states: this.states(),
      entities: this.registry,
      config: this.config,
      themes: this.themes,
      callService: async (domain, service, data) => this.callService(domain, service, data ?? {}),
    };
  }

  private callService(domain: string, service: string, data: Record<string, unknown>): void {
    const entityId = String(data.entity_id ?? '');
    this.log.push(`${domain}.${service} ${entityId}${data.value !== undefined ? ` = ${data.value}` : ''}`);
    if (!this.available) throw new Error('Device unavailable');
    const name = entityId.slice(entityId.indexOf('.') + 1 + PREFIX.length + 1);
    if (domain === 'number' && service === 'set_value') {
      const value = Number(data.value);
      if (name === 'desk_height') this.target = Math.min(this.max, Math.max(this.min, value));
      if (name === 'min_height') this.min = value;
      if (name === 'max_height') this.max = value;
    } else if (domain === 'button' && service === 'press') {
      const preset = /^desk_m([1-4])$/.exec(name);
      const save = /^set_desk_m([1-4])$/.exec(name);
      if (preset) this.target = this.presets[Number(preset[1]) - 1];
      else if (save) this.presets[Number(save[1]) - 1] = Math.round(this.height * 10) / 10;
      else if (name === 'desk_nudge_up') this.target = Math.min(this.max, (this.target ?? this.height) + 1);
      else if (name === 'desk_nudge_down') this.target = Math.max(this.min, (this.target ?? this.height) - 1);
      else if (name === 'desk_stop') this.target = null;
    }
    this.emit();
  }

  private tick(): void {
    if (this.target === null) {
      const wasMoving = this.status !== 'Idle';
      this.status = 'Idle';
      this.idleSeconds += TICK_MS / 1000;
      if (wasMoving || Math.round(this.idleSeconds * 10) % 10 === 0) this.emit();
      return;
    }
    const gap = this.target - this.height;
    const step = (SPEED * TICK_MS) / 1000;
    this.idleSeconds = 0;
    if (Math.abs(gap) <= step) {
      this.height = this.target;
      this.target = null;
    } else {
      this.height += Math.sign(gap) * step;
      this.status = gap > 0 ? 'Raising' : 'Lowering';
    }
    this.height = Math.round(this.height * 10) / 10;
    this.emit();
  }

  private emit(): void {
    const hass = this.hass();
    this.listeners.forEach((listener) => listener(hass));
  }

  private states(): Record<string, HassEntity> {
    const states: Record<string, HassEntity> = {};
    const set = (entityId: string, state: string | number, attributes: Record<string, unknown> = {}) => {
      states[entityId] = { entity_id: entityId, state: this.available ? String(state) : 'unavailable', attributes };
    };
    set(`number.${PREFIX}_desk_height`, this.height, { min: 58, max: 131, step: 0.1, unit_of_measurement: 'cm' });
    set(`sensor.${PREFIX}_desk_height`, this.height, { unit_of_measurement: 'cm' });
    set(`sensor.${PREFIX}_desk_status`, this.status);
    set(`number.${PREFIX}_min_height`, this.min);
    set(`number.${PREFIX}_max_height`, this.max);
    set(`sensor.${PREFIX}_idle_time`, Math.floor(this.idleSeconds));
    for (const n of [1, 2, 3, 4]) {
      set(`button.${PREFIX}_desk_m${n}`, 'unknown');
      set(`button.${PREFIX}_set_desk_m${n}`, 'unknown');
      set(`sensor.${PREFIX}_desk_m${n}_height`, this.presets[n - 1]);
    }
    for (const name of ['desk_nudge_up', 'desk_nudge_down', 'desk_stop']) set(`button.${PREFIX}_${name}`, 'unknown');
    return states;
  }

  private buildRegistry(): NonNullable<HomeAssistant['entities']> {
    const registry: NonNullable<HomeAssistant['entities']> = {};
    for (const entityId of Object.keys(this.states())) {
      registry[entityId] = { entity_id: entityId, device_id: DEVICE_ID, platform: 'esphome' };
    }
    return registry;
  }
}
