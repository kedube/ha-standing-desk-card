import { DESKTOP_PRESETS, FRAME_PRESETS, hexToRgb, isHexColor, resolveDesktop, resolveFrame } from './scene/materials';
import type { StandingDeskCardConfig } from './types';
import { CM_PER_IN, parseLength } from './units';

/** Flat view of the config for ha-form; style/rgb pairs stand in for desktop_color / frame_color. */
export interface FormData {
  device?: string;
  name?: string;
  unit: string;
  presets: string;
  desktop_style: string;
  desktop_rgb: [number, number, number];
  desktop_finish: string;
  desktop_width: number;
  desktop_depth: number;
  desktop_thickness: number;
  frame_style: string;
  frame_rgb: [number, number, number];
  frame_finish: string;
  keypad_color: string;
  keypad_side: string;
  show_scale: boolean;
  show_idle: boolean;
  allow_preset_save: boolean;
  hold_repeat_ms: number;
}

export const DEFAULT_SIZE_IN = { desktop_width: 60, desktop_depth: 30, desktop_thickness: 1 };

const round = (value: number, places: number) => Math.round(value * 10 ** places) / 10 ** places;

export function rgbToHex(rgb: unknown): string | undefined {
  if (!Array.isArray(rgb) || rgb.length !== 3) return undefined;
  return `#${rgb.map((c) => Math.max(0, Math.min(255, Math.round(Number(c) || 0))).toString(16).padStart(2, '0')).join('')}`;
}

function styleOf(presets: Record<string, unknown>, color: string | undefined, fallback: string): string {
  if (!color) return fallback;
  const key = color.trim().toLowerCase();
  if (key in presets) return key;
  return isHexColor(color) ? 'custom' : fallback;
}

function sizeInches(value: number | string | undefined, fallbackIn: number): number {
  return round(parseLength(value, fallbackIn * CM_PER_IN) / CM_PER_IN, 2);
}

export function toFormData(config: StandingDeskCardConfig): FormData {
  const desktop = resolveDesktop(config.desktop_color, config.desktop_finish);
  const frame = resolveFrame(config.frame_color, config.frame_finish);
  return {
    device: config.device,
    name: config.name,
    unit: config.unit ?? 'auto',
    presets: String(config.presets ?? 4),
    desktop_style: styleOf(DESKTOP_PRESETS, config.desktop_color, 'bamboo'),
    desktop_rgb: hexToRgb(desktop.color),
    desktop_finish: desktop.finish,
    desktop_width: sizeInches(config.desktop_width, DEFAULT_SIZE_IN.desktop_width),
    desktop_depth: sizeInches(config.desktop_depth, DEFAULT_SIZE_IN.desktop_depth),
    desktop_thickness: sizeInches(config.desktop_thickness, DEFAULT_SIZE_IN.desktop_thickness),
    frame_style: styleOf(FRAME_PRESETS, config.frame_color, 'black'),
    frame_rgb: hexToRgb(frame.color),
    frame_finish: frame.finish,
    keypad_color: config.keypad_color ?? 'black',
    keypad_side: config.keypad_side ?? 'right',
    show_scale: config.show_scale !== false,
    show_idle: config.show_idle === true,
    allow_preset_save: config.allow_preset_save !== false,
    hold_repeat_ms: config.hold_repeat_ms ?? 250,
  };
}

const sameValue = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Applies the fields the user changed in the form to the config. Untouched fields keep their
 * original YAML form (e.g. "152cm" stays a string); defaults are left out to keep YAML short.
 */
export function fromFormData(config: StandingDeskCardConfig, data: FormData): StandingDeskCardConfig {
  const before = toFormData(config);
  const next: Record<string, unknown> = { ...config };
  const changed = (key: keyof FormData) => !sameValue(before[key], data[key]);
  const assign = (key: string, value: unknown, fallback?: unknown) => {
    if (value === undefined || value === '' || value === null || sameValue(value, fallback)) delete next[key];
    else next[key] = value;
  };

  if (changed('device')) assign('device', data.device);
  if (changed('name')) assign('name', data.name);
  if (changed('unit')) assign('unit', data.unit, 'auto');
  if (changed('presets')) assign('presets', Number(data.presets), 4);

  if (changed('desktop_style') || changed('desktop_rgb') || changed('desktop_finish')) {
    if (data.desktop_style === 'custom') {
      assign('desktop_color', rgbToHex(data.desktop_rgb));
      assign('desktop_finish', data.desktop_finish);
    } else {
      assign('desktop_color', data.desktop_style, 'bamboo');
      delete next.desktop_finish;
    }
  }
  for (const key of ['desktop_width', 'desktop_depth', 'desktop_thickness'] as const) {
    if (changed(key)) assign(key, data[key], DEFAULT_SIZE_IN[key]);
  }

  if (changed('frame_style') || changed('frame_rgb') || changed('frame_finish')) {
    if (data.frame_style === 'custom') {
      assign('frame_color', rgbToHex(data.frame_rgb));
      assign('frame_finish', data.frame_finish);
    } else {
      assign('frame_color', data.frame_style, 'black');
      delete next.frame_finish;
    }
  }

  if (changed('keypad_color')) assign('keypad_color', data.keypad_color, 'black');
  if (changed('keypad_side')) assign('keypad_side', data.keypad_side, 'right');
  if (changed('show_scale')) assign('show_scale', data.show_scale, true);
  if (changed('show_idle')) assign('show_idle', data.show_idle, false);
  if (changed('allow_preset_save')) assign('allow_preset_save', data.allow_preset_save, true);
  if (changed('hold_repeat_ms')) assign('hold_repeat_ms', data.hold_repeat_ms, 250);

  return next as unknown as StandingDeskCardConfig;
}
