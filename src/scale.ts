import type { Unit } from './types';
import { fromUnit, toUnit } from './units';

export interface Tick {
  value: number;
  y: number;
  major: boolean;
}

// [minor, major] spacing in display units, finest first.
const SPACINGS: Record<Unit, [number, number][]> = {
  in: [
    [1, 5],
    [2.5, 5],
    [5, 10],
  ],
  cm: [
    [2, 10],
    [5, 10],
    [10, 20],
  ],
};

/**
 * Ticks for the height scale between min and max (cm), using the finest spacing whose
 * minor ticks stay `minGap` px apart and whose labels don't collide.
 */
export function scaleTicks(min: number, max: number, unit: Unit, project: (cm: number) => number, minGap = 5): Tick[] {
  const from = toUnit(min, unit);
  const to = toUnit(max, unit);
  const pxPerUnit = Math.abs(project(fromUnit(from, unit)) - project(fromUnit(to, unit))) / Math.max(1e-6, to - from);
  const spacings = SPACINGS[unit];
  const [minor, major] =
    spacings.find(([minorStep, majorStep]) => minorStep * pxPerUnit >= minGap && majorStep * pxPerUnit >= 14) ??
    spacings[spacings.length - 1];
  const ticks: Tick[] = [];
  for (let value = Math.ceil(from / minor - 1e-9) * minor; value <= to + 1e-6; value += minor) {
    const rounded = Math.round(value * 10) / 10;
    ticks.push({
      value: rounded,
      y: project(fromUnit(rounded, unit)),
      major: Math.abs(rounded / major - Math.round(rounded / major)) < 1e-6,
    });
  }
  return ticks;
}

export interface Marker {
  index: number;
  /** Where the marker is drawn. */
  y: number;
  /** Where its height actually is on the scale. */
  trueY: number;
}

/** Pushes overlapping preset markers apart vertically, keeping their order and staying within [top, bottom]. */
export function spreadMarkers(markers: { index: number; y: number }[], gap: number, top: number, bottom: number): Marker[] {
  const placed = markers
    .map((marker) => ({ index: marker.index, y: marker.y, trueY: marker.y }))
    .sort((a, b) => a.y - b.y);
  for (let i = 1; i < placed.length; i++) placed[i].y = Math.max(placed[i].y, placed[i - 1].y + gap);
  const last = placed.length - 1;
  if (last >= 0 && placed[last].y > bottom) {
    placed[last].y = bottom;
    for (let i = last - 1; i >= 0; i--) placed[i].y = Math.min(placed[i].y, placed[i + 1].y - gap);
  }
  for (const marker of placed) marker.y = Math.max(marker.y, top);
  return placed;
}
