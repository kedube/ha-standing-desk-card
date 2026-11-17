import { describe, expect, it } from 'vitest';
import { fromUnit, keypadText, parseFlag, parseLength, resolveUnit, snapHeight, toUnit } from '../src/units';
import type { HomeAssistant } from '../src/types';

const hassWithLength = (length: string) => ({ config: { unit_system: { length } } }) as unknown as HomeAssistant;

describe('units', () => {
  it('follows the Home Assistant unit system unless forced', () => {
    expect(resolveUnit('auto', hassWithLength('mi'))).toBe('in');
    expect(resolveUnit(undefined, hassWithLength('km'))).toBe('cm');
    expect(resolveUnit('cm', hassWithLength('mi'))).toBe('cm');
    expect(resolveUnit('in', hassWithLength('km'))).toBe('in');
  });

  it('converts between centimetres and inches', () => {
    expect(toUnit(76.2, 'in')).toBeCloseTo(30);
    expect(fromUnit(30, 'in')).toBeCloseTo(76.2);
    expect(toUnit(76.2, 'cm')).toBe(76.2);
  });

  it('formats the 3-digit keypad display like the real handset', () => {
    expect(keypadText(74.93, 'in')).toBe('29.5');
    expect(keypadText(74.93, 'cm')).toBe('74.9');
    expect(keypadText(120.4, 'cm')).toBe('120');
    expect(keypadText(99.96, 'cm')).toBe('100');
    expect(keypadText(NaN, 'cm')).toBe('---');
  });

  it('parses desktop sizes in inches by default, or with a unit', () => {
    expect(parseLength(60, 0)).toBeCloseTo(152.4);
    expect(parseLength('60', 0)).toBeCloseTo(152.4);
    expect(parseLength('60in', 0)).toBeCloseTo(152.4);
    expect(parseLength('60"', 0)).toBeCloseTo(152.4);
    expect(parseLength('160cm', 0)).toBe(160);
    expect(parseLength('160 cm', 0)).toBe(160);
    expect(parseLength('25mm', 0)).toBe(2.5);
    expect(parseLength('wide', 99)).toBe(99);
    expect(parseLength(undefined, 99)).toBe(99);
    expect(parseLength(-4, 99)).toBe(99);
  });

  it('snaps target heights to half inches or whole centimetres', () => {
    expect(toUnit(snapHeight(fromUnit(30.3, 'in'), 'in'), 'in')).toBeCloseTo(30.5);
    expect(toUnit(snapHeight(fromUnit(30.2, 'in'), 'in'), 'in')).toBeCloseTo(30);
    expect(snapHeight(74.6, 'cm')).toBe(75);
  });

  it('reads on/off options, including YAML 1.2 strings such as no and off', () => {
    expect(parseFlag('no', true)).toBe(false);
    expect(parseFlag(' Off ', true)).toBe(false);
    expect(parseFlag('yes', false)).toBe(true);
    expect(parseFlag(false, true)).toBe(false);
    expect(parseFlag(0, true)).toBe(false);
    expect(parseFlag(undefined, true)).toBe(true);
    expect(parseFlag('maybe', false)).toBe(false);
  });
});
