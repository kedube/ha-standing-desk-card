import { describe, expect, it } from 'vitest';
import { scaleTicks, spreadMarkers } from '../src/scale';
import { CM_PER_IN } from '../src/units';

// A linear projection: `pxPerCm` pixels per centimetre, higher heights nearer the top.
const linear = (pxPerCm: number) => (cm: number) => 400 - cm * pxPerCm;

describe('scale ticks', () => {
  const min = 25.3 * CM_PER_IN;
  const max = 50.9 * CM_PER_IN;

  it('uses 1″ ticks with labels every 5″ when there is room', () => {
    const ticks = scaleTicks(min, max, 'in', linear(3));
    expect(ticks[0].value).toBe(26);
    expect(ticks.at(-1)!.value).toBe(50);
    expect(ticks.filter((t) => t.major).map((t) => t.value)).toEqual([30, 35, 40, 45, 50]);
  });

  it('thins ticks out on small cards', () => {
    const ticks = scaleTicks(min, max, 'in', linear(1.2));
    expect(ticks.map((t) => t.value)).toEqual([27.5, 30, 32.5, 35, 37.5, 40, 42.5, 45, 47.5, 50]);
  });

  it('uses centimetre spacing in cm', () => {
    const ticks = scaleTicks(64, 129, 'cm', linear(3));
    expect(ticks[0].value).toBe(64);
    expect(ticks.filter((t) => t.major).map((t) => t.value)).toEqual([70, 80, 90, 100, 110, 120]);
  });
});

describe('preset markers', () => {
  it('leaves well-separated markers alone', () => {
    const placed = spreadMarkers([{ index: 0, y: 100 }, { index: 1, y: 200 }], 19, 0, 300);
    expect(placed.map((m) => m.y)).toEqual([100, 200]);
  });

  it('pushes overlapping markers apart and remembers where they belong', () => {
    const placed = spreadMarkers(
      [
        { index: 3, y: 210 },
        { index: 0, y: 200 },
      ],
      19,
      0,
      300,
    );
    expect(placed).toEqual([
      { index: 0, y: 200, trueY: 200 },
      { index: 3, y: 219, trueY: 210 },
    ]);
  });

  it('stays above the bottom edge', () => {
    const placed = spreadMarkers(
      [
        { index: 0, y: 295 },
        { index: 1, y: 296 },
      ],
      19,
      0,
      300,
    );
    expect(placed.map((m) => m.y)).toEqual([281, 300]);
  });
});
