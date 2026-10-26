import { describe, expect, it } from 'vitest';
import { fromFormData, rgbToHex, toFormData } from '../src/editor-data';
import { hexToRgb } from '../src/scene/materials';
import type { StandingDeskCardConfig } from '../src/types';

const base: StandingDeskCardConfig = { type: 'custom:standing-desk-card', device: 'abc' };

describe('editor data', () => {
  it('round-trips colors as sRGB', () => {
    expect(hexToRgb('#c99c62')).toEqual([201, 156, 98]);
    expect(hexToRgb('#fff')).toEqual([255, 255, 255]);
    expect(rgbToHex([201, 156, 98])).toBe('#c99c62');
  });

  it('shows defaults for a minimal config', () => {
    const data = toFormData(base);
    expect(data).toMatchObject({
      presets: '4',
      unit: 'auto',
      desktop_style: 'bamboo',
      frame_style: 'black',
      desktop_width: 60,
      show_scale: true,
      allow_preset_save: true,
    });
  });

  it('writes only what changed, leaving defaults out', () => {
    const data = toFormData(base);
    expect(fromFormData(base, data)).toEqual(base);
    expect(fromFormData(base, { ...data, presets: '2' })).toEqual({ ...base, presets: 2 });
    expect(fromFormData({ ...base, presets: 2 }, { ...toFormData({ ...base, presets: 2 }), presets: '4' })).toEqual(base);
  });

  it('switches between presets and custom colors', () => {
    const walnut = fromFormData(base, { ...toFormData(base), desktop_style: 'walnut' });
    expect(walnut.desktop_color).toBe('walnut');
    const custom = fromFormData(walnut, { ...toFormData(walnut), desktop_style: 'custom' });
    expect(custom.desktop_color).toBe('#6b4733');
    expect(custom.desktop_finish).toBe('wood');
    const recolored = fromFormData(custom, { ...toFormData(custom), desktop_rgb: [10, 20, 30] });
    expect(recolored.desktop_color).toBe('#0a141e');
    const frame = fromFormData(base, { ...toFormData(base), frame_style: 'custom', frame_finish: 'metallic' });
    expect(frame.frame_color).toBe('#1f2022');
    expect(frame.frame_finish).toBe('metallic');
  });

  it('keeps sizes written with units unless they are edited', () => {
    const config = { ...base, desktop_width: '160cm' };
    const data = toFormData(config);
    expect(data.desktop_width).toBeCloseTo(62.99, 1);
    expect(fromFormData(config, data).desktop_width).toBe('160cm');
    expect(fromFormData(config, { ...data, desktop_width: 72 }).desktop_width).toBe(72);
  });
});
