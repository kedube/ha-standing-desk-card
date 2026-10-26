import { describe, expect, it } from 'vitest';
import { DESK_SPEED_CM_S, followHeight } from '../src/motion';
import { V2, frameLayout, legStages } from '../src/scene/layout';
import { displayCells } from '../src/seven-segment';
import { CM_PER_IN } from '../src/units';

const desktop = { width: 60 * CM_PER_IN, depth: 30 * CM_PER_IN, thickness: CM_PER_IN };
const v2Min = V2.frameMin + CM_PER_IN; // 25.3″
const v2Max = V2.frameMax + CM_PER_IN; // 50.9″

describe('height following', () => {
  it('moves at the desk speed for small gaps', () => {
    const next = followHeight(80, 81, 0.1);
    expect(next - 80).toBeCloseTo(DESK_SPEED_CM_S * 1.1 * 0.1);
  });

  it('catches up faster on big jumps and never overshoots', () => {
    expect(followHeight(70, 110, 0.1)).toBeGreaterThan(70 + DESK_SPEED_CM_S * 0.2);
    expect(followHeight(80, 80.2, 1)).toBe(80.2);
    expect(followHeight(80, 70, 0.1)).toBeLessThan(80);
  });
});

describe('UPLIFT V2 frame layout', () => {
  const layout = frameLayout(desktop, v2Min, v2Max);

  it('keeps the frame width within the V2 adjustment range', () => {
    expect(frameLayout({ ...desktop, width: 42 * CM_PER_IN }, v2Min, v2Max).frameWidth).toBeCloseTo(V2.frameWidthMin);
    expect(frameLayout({ ...desktop, width: 80 * CM_PER_IN }, v2Min, v2Max).frameWidth).toBeCloseTo(V2.frameWidthMax);
    expect(layout.frameWidth).toBeCloseTo(54 * CM_PER_IN);
  });

  it('puts the foot front just behind the desktop edge and uses short feet for 24″ tops', () => {
    expect(layout.footFront).toBeLessThan(desktop.depth / 2);
    expect(layout.footFront).toBeGreaterThan(desktop.depth / 2 - 3);
    expect(layout.footLength).toBeCloseTo(V2.footLength);
    expect(frameLayout({ ...desktop, depth: 24 * CM_PER_IN }, v2Min, v2Max).footLength).toBeCloseTo(V2.shortFootLength);
  });

  it('extends both lower stages together, widest stage on top', () => {
    for (const height of [v2Min, 90, v2Max]) {
      const stages = legStages(layout, desktop, height);
      expect(stages.frameTop).toBeCloseTo(height - desktop.thickness);
      const middleExposed = stages.outer.bottom - stages.middle.bottom;
      const innerExposed = stages.middle.bottom - stages.inner.bottom;
      expect(middleExposed).toBeCloseTo(innerExposed);
      expect(stages.outer.width).toBeGreaterThan(stages.middle.width);
      expect(stages.middle.width).toBeGreaterThan(stages.inner.width);
    }
  });

  it('keeps every stage overlapping the one above across the whole range', () => {
    for (const [min, max] of [
      [v2Min, v2Max],
      [58, 131], // the controller's firmware defaults
    ]) {
      const wide = frameLayout(desktop, min, max);
      for (let height = min; height <= max; height += 2.5) {
        const stages = legStages(wide, desktop, height);
        expect(stages.middle.top).toBeGreaterThan(stages.outer.bottom + 1);
        expect(stages.middle.top).toBeLessThanOrEqual(stages.outer.top);
        expect(stages.inner.top).toBeGreaterThan(stages.middle.bottom + 1);
        expect(stages.inner.top).toBeLessThanOrEqual(stages.middle.top);
        expect(stages.middle.bottom).toBeGreaterThan(stages.inner.bottom);
      }
    }
  });

  it('shows just a little of the lower stages at the lowest height', () => {
    const stages = legStages(layout, desktop, v2Min);
    expect(stages.outer.bottom - stages.middle.bottom).toBeCloseTo(V2.minExposed);
  });
});

describe('seven-segment display', () => {
  const lit = (text: string) => displayCells(text).map((cell) => [...cell.lit].sort().join('') + (cell.dot ? '.' : ''));

  it('right-aligns numbers and keeps the decimal point on its digit', () => {
    expect(lit('29.5')).toEqual(['abdeg', 'abcdfg.', 'acdfg']);
    expect(lit('5.0')).toEqual(['', 'acdfg.', 'abcdef']);
  });

  it('left-aligns the save prompt', () => {
    expect(lit('S-')).toEqual(['acdfg', 'g', '']);
    expect(lit('S-2')).toEqual(['acdfg', 'g', 'abdeg']);
  });
});
