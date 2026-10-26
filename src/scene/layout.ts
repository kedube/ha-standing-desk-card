import { CM_PER_IN, clamp } from '../units';

const IN = CM_PER_IN;

/**
 * UPLIFT V2 2-leg frame (FRMA-2), in centimetres. Sources: UPLIFT spec sheet SP-FRMA-2-SRD-C-1.4
 * and the V2 / V2-Commercial comparison sheet. Values marked "est." are read off the drawings.
 */
export const V2 = {
  /** Floor to top of frame (underside of the desktop). */
  frameMin: 24.3 * IN,
  frameMax: 49.9 * IN,
  frameWidthMin: 41.3 * IN,
  frameWidthMax: 72.2 * IN,
  /** Inverted 3-stage legs: widest stage on top. [front face width, depth]. Outer is 80 × 50 mm. */
  legOuter: [5.0, 8.0] as const,
  legMiddle: [4.4, 7.4] as const, // est.
  legInner: [3.8, 6.8] as const, // est.
  bracketLength: 20.9 * IN,
  bracketWidth: 5.7, // est. from 41.3″ outer vs 36.8″ inner frame width
  bracketHeight: 4.2, // est.
  bracketEndHeight: 1.6, // est.
  footLength: 27.6 * IN,
  footRear: 10.4 * IN, // leg centre to rear end
  shortFootLength: 23.6 * IN, // for 24″-deep desktops
  shortFootRear: 9.4 * IN,
  footWidth: 2.75 * IN,
  footHeight: 3.4, // est.
  footEndHeight: 1.8, // est.
  glideRadius: 1.7,
  glideHeight: 1.0,
  crossbarHeight: 4.0, // est.
  crossbarDepth: 3.0, // est.
  /** Advanced keypad, FRM001: 6.1″ × 1.25″ face, 2.1″ deep. */
  keypadWidth: 6.1 * IN,
  keypadHeight: 1.25 * IN,
  keypadDepth: 2.1 * IN,
  /** Keypad centre distance from the desktop's end. */
  keypadInset: 9 * IN,
  /** Exposed length of each lower stage at the lowest height. */
  minExposed: 3.5,
  /** Length of each lower stage kept inside the stage above it at full height. */
  overlap: 6,
} as const;

export interface DesktopSize {
  width: number;
  depth: number;
  thickness: number;
}

export interface LegStage {
  width: number;
  depth: number;
  bottom: number;
  top: number;
}

export interface FrameLayout {
  legX: number;
  legZ: number;
  frameWidth: number;
  footLength: number;
  footFront: number;
  footRear: number;
  footTop: number;
  outerLength: number;
  middleLength: number;
  innerLength: number;
  /** Lowest/highest desktop surface heights the model can show. */
  minHeight: number;
  maxHeight: number;
}

/**
 * Fixed proportions of the frame for a desktop size and travel range. Stage lengths are
 * sized from the range so the lower stages are just visible at the bottom and still
 * overlap at the top, whatever min/max the controller is configured with.
 */
export function frameLayout(desktop: DesktopSize, rangeMin: number, rangeMax: number): FrameLayout {
  const shortFeet = desktop.depth < 27 * IN;
  const footLength = shortFeet ? V2.shortFootLength : V2.footLength;
  const footRear = shortFeet ? V2.shortFootRear : V2.footRear;
  // The foot's front end sits just behind the desktop's front edge.
  const legZ = desktop.depth / 2 - 1.3 - (footLength - footRear);

  const frameWidth = clamp(desktop.width - 6 * IN, V2.frameWidthMin, V2.frameWidthMax);
  const legX = frameWidth / 2 - V2.bracketWidth / 2;
  const footTop = V2.glideHeight + V2.footHeight;

  const frameLow = Math.min(V2.frameMin, rangeMin - desktop.thickness);
  const frameHigh = Math.max(V2.frameMax, rangeMax - desktop.thickness, frameLow + 20);
  const legLow = frameLow - V2.bracketHeight - footTop;
  const legHigh = frameHigh - V2.bracketHeight - footTop;
  const outerLength = Math.max(10, legLow - 2 * V2.minExposed);
  const maxExposed = (legHigh - outerLength) / 2;
  const middleLength = Math.min(maxExposed + V2.overlap, outerLength + V2.minExposed - 0.5);
  const innerLength = Math.min(maxExposed + V2.overlap, middleLength + V2.minExposed - 0.5);

  return {
    legX,
    legZ,
    frameWidth,
    footLength,
    footFront: legZ + (footLength - footRear),
    footRear: legZ - footRear,
    footTop,
    outerLength,
    middleLength,
    innerLength,
    minHeight: frameLow + desktop.thickness,
    maxHeight: frameHigh + desktop.thickness,
  };
}

export interface LegStages {
  outer: LegStage;
  middle: LegStage;
  inner: LegStage;
  /** Underside of the desktop / top of the frame. */
  frameTop: number;
}

/** Positions of the three stages for a desktop surface height; both joints extend together. */
export function legStages(layout: FrameLayout, desktop: DesktopSize, heightCm: number): LegStages {
  const height = clamp(heightCm, layout.minHeight, layout.maxHeight);
  const frameTop = height - desktop.thickness;
  const outerTop = frameTop - V2.bracketHeight;
  const outerBottom = outerTop - layout.outerLength;
  const exposed = Math.max(0.5, (outerBottom - layout.footTop) / 2);
  const middleBottom = layout.footTop + exposed;
  return {
    frameTop,
    outer: { width: V2.legOuter[0], depth: V2.legOuter[1], bottom: outerBottom, top: outerTop },
    middle: {
      width: V2.legMiddle[0],
      depth: V2.legMiddle[1],
      bottom: middleBottom,
      top: middleBottom + layout.middleLength,
    },
    inner: {
      width: V2.legInner[0],
      depth: V2.legInner[1],
      bottom: layout.footTop,
      top: layout.footTop + layout.innerLength,
    },
  };
}
