// Minimal slices of the Home Assistant frontend types this card relies on.

export interface HassEntity {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown>;
  last_changed?: string;
  last_updated?: string;
}

export interface HassEntityRegistryDisplayEntry {
  entity_id: string;
  device_id?: string | null;
  platform?: string;
  name?: string | null;
  hidden?: boolean;
  entity_category?: 'config' | 'diagnostic' | null;
}

export interface HassDevice {
  id: string;
  name?: string | null;
  name_by_user?: string | null;
  manufacturer?: string | null;
  model?: string | null;
}

export interface HomeAssistant {
  states: Record<string, HassEntity>;
  entities?: Record<string, HassEntityRegistryDisplayEntry>;
  devices?: Record<string, HassDevice>;
  config: { unit_system: { length: string } };
  themes?: { darkMode?: boolean };
  callService(
    domain: string,
    service: string,
    serviceData?: Record<string, unknown>,
    target?: Record<string, unknown>,
  ): Promise<unknown>;
}

export const PRESET_NUMBERS = [1, 2, 3, 4] as const;
export type PresetNumber = (typeof PRESET_NUMBERS)[number];

export type EntityRole =
  | 'height'
  | 'height_sensor'
  | 'status'
  | 'nudge_up'
  | 'nudge_down'
  | 'stop'
  | 'min_height'
  | 'max_height'
  | 'idle_time'
  | `preset_${PresetNumber}`
  | `save_preset_${PresetNumber}`
  | `preset_${PresetNumber}_height`;

export type EntityMap = Partial<Record<EntityRole, string>>;

export type UnitSetting = 'auto' | 'in' | 'cm';
export type Unit = 'in' | 'cm';
export type DesktopFinish = 'laminate' | 'wood' | 'bamboo';
export type FrameFinish = 'powder' | 'metallic';
export type KeypadColor = 'black' | 'white' | 'gray';
export type KeypadSide = 'left' | 'right';

export interface StandingDeskCardConfig {
  type: string;
  name?: string;
  /** Device registry id of the DeskUp Pro. Optional: the first DeskUp Pro found is used. */
  device?: string;
  /** Per-role entity overrides, e.g. `{ height: number.office_desk_height }`. */
  entities?: EntityMap;
  unit?: UnitSetting;
  /** Memory presets on your controller: 2, 3 or 4. */
  presets?: number;
  /** Bare numbers are inches; strings may carry a unit ("152cm", "60in"). */
  desktop_width?: number | string;
  desktop_depth?: number | string;
  desktop_thickness?: number | string;
  /** A preset name (bamboo, walnut, white, ...) or a hex color. */
  desktop_color?: string;
  desktop_finish?: DesktopFinish;
  /** A preset name (black, white, gray, industrial) or a hex color. */
  frame_color?: string;
  frame_finish?: FrameFinish;
  keypad_color?: KeypadColor;
  keypad_side?: KeypadSide;
  show_scale?: boolean;
  show_idle?: boolean;
  allow_preset_save?: boolean;
  /** Interval between repeated nudges while ▲/▼ is held. */
  hold_repeat_ms?: number;
}
