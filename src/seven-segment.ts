// Seven-segment glyphs for the keypad display, shared by the HTML keypad (SVG)
// and the keypad on the 3D model (canvas).

const GLYPHS: Record<string, string> = {
  '0': 'abcdef',
  '1': 'bc',
  '2': 'abdeg',
  '3': 'abcdg',
  '4': 'bcfg',
  '5': 'acdfg',
  '6': 'acdefg',
  '7': 'abc',
  '8': 'abcdefg',
  '9': 'abcdfg',
  '-': 'g',
  S: 'acdfg',
  E: 'adefg',
  r: 'eg',
  L: 'def',
  O: 'abcdef',
  C: 'adef',
  ' ': '',
};

export const SEGMENT_NAMES = ['a', 'b', 'c', 'd', 'e', 'f', 'g'] as const;
export type SegmentName = (typeof SEGMENT_NAMES)[number];

export interface DisplayCell {
  lit: Set<SegmentName>;
  dot: boolean;
}

/** Splits text such as "29.5" or "S-1" into three cells; numbers are right-aligned. */
export function displayCells(text: string, cells = 3): DisplayCell[] {
  const parsed: DisplayCell[] = [];
  for (const char of text) {
    if (char === '.') {
      if (parsed.length) parsed[parsed.length - 1].dot = true;
      continue;
    }
    const segments = GLYPHS[char] ?? GLYPHS[char.toUpperCase()] ?? '';
    parsed.push({ lit: new Set(segments.split('') as SegmentName[]), dot: false });
  }
  const blank = (): DisplayCell => ({ lit: new Set(), dot: false });
  const numeric = /^[0-9.]+$/.test(text);
  while (parsed.length < cells) numeric ? parsed.unshift(blank()) : parsed.push(blank());
  return parsed.slice(0, cells);
}

/** Cell size in segment units. */
export const CELL_WIDTH = 12;
export const CELL_HEIGHT = 18;
const T = 2.2; // stroke
const G = 0.45; // gap at segment ends
const SLANT = 0.1;

type Point = [number, number];

const skew = ([x, y]: Point): Point => [x + (CELL_HEIGHT - y) * SLANT, y];

function horizontal(y: number): Point[] {
  const x0 = 1.6 + G;
  const x1 = 9.4 - G;
  return [
    [x0, y],
    [x0 + T / 2, y - T / 2],
    [x1 - T / 2, y - T / 2],
    [x1, y],
    [x1 - T / 2, y + T / 2],
    [x0 + T / 2, y + T / 2],
  ];
}

function vertical(x: number, y0: number, y1: number): Point[] {
  const a = y0 + G;
  const b = y1 - G;
  return [
    [x, a],
    [x + T / 2, a + T / 2],
    [x + T / 2, b - T / 2],
    [x, b],
    [x - T / 2, b - T / 2],
    [x - T / 2, a + T / 2],
  ];
}

const SEGMENT_POINTS: Record<SegmentName, Point[]> = {
  a: horizontal(1.6),
  g: horizontal(9),
  d: horizontal(16.4),
  f: vertical(1.6, 1.6, 9),
  b: vertical(9.4, 1.6, 9),
  e: vertical(1.6, 9, 16.4),
  c: vertical(9.4, 9, 16.4),
};

/** Polygon points for a segment, already slanted, within one cell. */
export function segmentPolygon(segment: SegmentName): Point[] {
  return SEGMENT_POINTS[segment].map(skew);
}

/** Decimal point square: [x, y, size] within one cell. */
export const DOT: [number, number, number] = [10.4, 15.2, 2.1];
