import type { HomeAssistant, Unit, UnitSetting } from './types';

export const CM_PER_IN = 2.54;

export function resolveUnit(setting: UnitSetting | undefined, hass?: HomeAssistant): Unit {
  if (setting === 'in' || setting === 'cm') return setting;
  return hass?.config?.unit_system?.length === 'mi' ? 'in' : 'cm';
}

export const toUnit = (cm: number, unit: Unit): number => (unit === 'in' ? cm / CM_PER_IN : cm);
export const fromUnit = (value: number, unit: Unit): number => (unit === 'in' ? value * CM_PER_IN : value);

export const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

export function formatHeight(cm: number, unit: Unit, withUnit = true): string {
  const text = toUnit(cm, unit).toFixed(1);
  if (!withUnit) return text;
  return unit === 'in' ? `${text}″` : `${text} cm`;
}

export const unitLabel = (unit: Unit): string => (unit === 'in' ? 'in' : 'cm');

/**
 * Text for the keypad's 3-digit display: one decimal below 100 ("29.5", "74.9"),
 * whole numbers from 100 up ("120"), like the real handset.
 */
export function keypadText(cm: number, unit: Unit): string {
  const value = toUnit(cm, unit);
  if (!Number.isFinite(value)) return '---';
  const tenths = Math.round(value * 10) / 10;
  if (tenths >= 100) return String(Math.min(999, Math.round(value)));
  return tenths.toFixed(1);
}

/**
 * Parses a length from the card config. Bare numbers and unit-less strings are inches,
 * since UPLIFT desktops are sold in inch sizes; "152cm" / "152 cm" / "60in" / '60"' also work.
 */
export function parseLength(value: number | string | undefined, fallbackCm: number): number {
  if (value === undefined || value === null || value === '') return fallbackCm;
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value * CM_PER_IN : fallbackCm;
  const match = /^\s*([0-9]*\.?[0-9]+)\s*(cm|mm|in|"|″)?\s*$/i.exec(value);
  if (!match) return fallbackCm;
  const amount = parseFloat(match[1]);
  if (!(amount > 0)) return fallbackCm;
  switch ((match[2] ?? 'in').toLowerCase()) {
    case 'cm':
      return amount;
    case 'mm':
      return amount / 10;
    default:
      return amount * CM_PER_IN;
  }
}

/**
 * Reads an on/off option. The raw config editor parses YAML 1.2, where `no` and `off` are
 * strings, so a plain truthiness or `!== false` check would read them as on.
 */
export function parseFlag(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const text = value.trim().toLowerCase();
    if (['true', 'yes', 'on', '1'].includes(text)) return true;
    if (['false', 'no', 'off', '0'].includes(text)) return false;
  }
  return fallback;
}

/** Snap step for picking a target height: half an inch, or one centimetre. */
export const snapStep = (unit: Unit): number => (unit === 'in' ? 0.5 : 1);

export function snapHeight(cm: number, unit: Unit): number {
  const step = snapStep(unit);
  const snapped = Math.round(toUnit(cm, unit) / step) * step;
  return fromUnit(snapped, unit);
}
