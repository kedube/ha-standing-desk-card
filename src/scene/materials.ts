import {
  CanvasTexture,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  RepeatWrapping,
  SRGBColorSpace,
} from 'three';
import type { DesktopFinish, FrameFinish, KeypadColor } from '../types';

export interface FinishPreset<F> {
  label: string;
  color: string;
  finish: F;
}

export const DESKTOP_PRESETS: Record<string, FinishPreset<DesktopFinish>> = {
  bamboo: { label: 'Bamboo', color: '#c99c62', finish: 'bamboo' },
  'dark-bamboo': { label: 'Carbonized bamboo', color: '#8a5d38', finish: 'bamboo' },
  walnut: { label: 'Walnut', color: '#6b4733', finish: 'wood' },
  'dark-walnut': { label: 'Dark walnut', color: '#40291d', finish: 'wood' },
  oak: { label: 'Oak', color: '#b98c5f', finish: 'wood' },
  maple: { label: 'Maple', color: '#d7b98f', finish: 'wood' },
  rubberwood: { label: 'Rubberwood', color: '#c59b6e', finish: 'wood' },
  cherry: { label: 'Cherry', color: '#8f5034', finish: 'wood' },
  white: { label: 'White', color: '#ebeae5', finish: 'laminate' },
  gray: { label: 'Gray', color: '#8d8e90', finish: 'laminate' },
  black: { label: 'Black', color: '#28282a', finish: 'laminate' },
};

export const FRAME_PRESETS: Record<string, FinishPreset<FrameFinish>> = {
  black: { label: 'Black', color: '#1f2022', finish: 'powder' },
  white: { label: 'White', color: '#ededeb', finish: 'powder' },
  gray: { label: 'Gray', color: '#a7a9ac', finish: 'powder' },
  industrial: { label: 'Industrial (metallic)', color: '#7b7e82', finish: 'metallic' },
};

export const KEYPAD_COLORS: Record<KeypadColor, string> = {
  black: '#1b1b1d',
  white: '#e7e7e4',
  gray: '#8e9195',
};

export const DEFAULT_DESKTOP = 'bamboo';
export const DEFAULT_FRAME = 'black';

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

export function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && HEX.test(value.trim());
}

export function normalizeHex(value: string): string {
  const hex = value.trim().toLowerCase();
  if (hex.length === 4) return `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`;
  return hex;
}

/** Mixes a hex color toward black (amount 0–1). */
export function darken(hex: string, amount: number): string {
  return `#${hexToRgb(hex)
    .map((c) => Math.round(c * (1 - amount)).toString(16).padStart(2, '0'))
    .join('')}`;
}

/** sRGB components 0–255. (three's Color would hand back linear values.) */
export function hexToRgb(hex: string): [number, number, number] {
  const value = normalizeHex(hex).slice(1);
  return [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16)) as [number, number, number];
}

function resolveFinish<F>(
  presets: Record<string, FinishPreset<F>>,
  fallbackPreset: string,
  fallbackFinish: F,
  color?: string,
  finish?: F,
): { color: string; finish: F } {
  const preset = color ? presets[color.trim().toLowerCase()] : undefined;
  if (preset) return { color: preset.color, finish: finish ?? preset.finish };
  if (isHexColor(color)) return { color: normalizeHex(color), finish: finish ?? fallbackFinish };
  const base = presets[fallbackPreset];
  return { color: base.color, finish: finish ?? base.finish };
}

export const resolveDesktop = (color?: string, finish?: DesktopFinish) =>
  resolveFinish(DESKTOP_PRESETS, DEFAULT_DESKTOP, 'laminate', color, finish);

export const resolveFrame = (color?: string, finish?: FrameFinish) =>
  resolveFinish(FRAME_PRESETS, DEFAULT_FRAME, 'powder', color, finish);

// --- Procedural surface textures -------------------------------------------------------

/** Small seeded PRNG so textures look the same on every render. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 2D value noise with smooth interpolation; fbm sums octaves. */
class ValueNoise {
  private readonly size = 256;
  private readonly values: Float32Array;

  constructor(seed: number) {
    const rand = random(seed);
    this.values = new Float32Array(this.size * this.size);
    for (let i = 0; i < this.values.length; i++) this.values[i] = rand();
  }

  noise(x: number, y: number): number {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const s = this.size - 1;
    const at = (ix: number, iy: number) => this.values[(iy & s) * this.size + (ix & s)];
    const u = xf * xf * (3 - 2 * xf);
    const v = yf * yf * (3 - 2 * yf);
    const top = at(xi, yi) + (at(xi + 1, yi) - at(xi, yi)) * u;
    const bottom = at(xi, yi + 1) + (at(xi + 1, yi + 1) - at(xi, yi + 1)) * u;
    return top + (bottom - top) * v;
  }

  fbm(x: number, y: number, octaves = 4): number {
    let sum = 0;
    let amplitude = 0.5;
    let frequency = 1;
    for (let i = 0; i < octaves; i++) {
      sum += amplitude * this.noise(x * frequency, y * frequency);
      frequency *= 2;
      amplitude *= 0.5;
    }
    return sum / (1 - Math.pow(0.5, octaves));
  }
}

const TEX_W = 1024;
const TEX_H = 512;

/** Paints `shade(x, y) → brightness multiplier` over a base color; x/y are in cm across the desktop. */
function paintSurface(
  base: string,
  widthCm: number,
  depthCm: number,
  shade: (x: number, y: number) => number,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = TEX_W;
  canvas.height = TEX_H;
  const ctx = canvas.getContext('2d')!;
  const image = ctx.createImageData(TEX_W, TEX_H);
  const [r, g, b] = hexToRgb(base);
  const data = image.data;
  for (let py = 0; py < TEX_H; py++) {
    const y = (py / TEX_H) * depthCm;
    for (let px = 0; px < TEX_W; px++) {
      const k = shade((px / TEX_W) * widthCm, y);
      const i = (py * TEX_W + px) * 4;
      data[i] = Math.min(255, r * k);
      data[i + 1] = Math.min(255, g * k);
      data[i + 2] = Math.min(255, b * k);
      data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

/** `contrast` scales the figure; dark woods need more of it to read as wood rather than paint. */
function woodShade(noise: ValueNoise, contrast: number) {
  return (x: number, y: number) => {
    // Growth rings along the length, bent by slow noise into cathedral patterns.
    const warp = noise.fbm(x / 55, y / 9, 3) * 7 + noise.fbm(x / 9, y / 2.5, 2) * 0.35;
    const ring = (y * 0.55 + warp) % 1;
    // Each ring darkens toward its latewood edge, which ends in a fine dark line.
    const band = ring * ring;
    const latewood = Math.pow(Math.max(0, Math.sin(ring * Math.PI)), 14);
    // Long streaks along the board: the figure that still shows when the desk is small on screen.
    const streak = noise.fbm(x / 70, y / 1.8, 3) - 0.5;
    const fibre = noise.noise(x * 1.6, y * 22) - 0.5;
    const mottle = noise.fbm(x / 30, y / 12, 2) - 0.5;
    return 1.08 + contrast * (-0.16 * band - 0.12 * latewood + 0.3 * streak + 0.06 * fibre + 0.1 * mottle);
  };
}

function bambooShade(noise: ValueNoise, seed: number) {
  const rand = random(seed);
  const stripTone = Array.from({ length: 128 }, () => 0.93 + rand() * 0.12);
  const nodeOffset = Array.from({ length: 128 }, () => rand() * 40);
  const stripWidth = 1.9;
  return (x: number, y: number) => {
    const strip = Math.floor(y / stripWidth);
    const within = y / stripWidth - strip;
    const seam = within < 0.035 || within > 0.965 ? 0.82 : 1;
    const fibre = noise.noise(x * 0.9, y * 26) - 0.5;
    // Bamboo nodes: darker bands across a strip every ~40 cm.
    const node = (x + nodeOffset[strip & 127]) % 41;
    const nodeShade = node < 1.1 ? 0.84 + node * 0.1 : 1;
    return stripTone[strip & 127] * seam * nodeShade + fibre * 0.06;
  };
}

function laminateShade(noise: ValueNoise) {
  return (x: number, y: number) => 1 + (noise.fbm(x / 20, y / 20, 3) - 0.5) * 0.035 + (noise.noise(x * 3, y * 3) - 0.5) * 0.02;
}

export function desktopTexture(
  color: string,
  finish: DesktopFinish,
  widthCm: number,
  depthCm: number,
  anisotropy: number,
): CanvasTexture {
  const noise = new ValueNoise(7);
  const [r, g, b] = hexToRgb(color);
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  const contrast = Math.min(1.7, Math.max(0.8, 1 + (0.45 - luminance) * 1.6));
  const shade =
    finish === 'wood'
      ? woodShade(noise, contrast)
      : finish === 'bamboo'
        ? bambooShade(noise, 11)
        : laminateShade(noise);
  const texture = new CanvasTexture(paintSurface(color, widthCm, depthCm, shade));
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.anisotropy = anisotropy;
  // Extrusion UVs are in centimetres; map the texture once across the desktop.
  texture.repeat.set(1 / widthCm, 1 / depthCm);
  texture.offset.set(0.5, 0.5);
  return texture;
}

export function desktopMaterial(
  color: string,
  finish: DesktopFinish,
  widthCm: number,
  depthCm: number,
  anisotropy: number,
): MeshStandardMaterial {
  return new MeshStandardMaterial({
    map: desktopTexture(color, finish, widthCm, depthCm, anisotropy),
    roughness: finish === 'laminate' ? 0.55 : 0.48,
    metalness: 0,
  });
}

export function frameMaterial(color: string, finish: FrameFinish): MeshPhysicalMaterial {
  const metallic = finish === 'metallic';
  return new MeshPhysicalMaterial({
    color,
    metalness: metallic ? 0.72 : 0.08,
    roughness: metallic ? 0.34 : 0.46,
    clearcoat: metallic ? 0.2 : 0.12,
    clearcoatRoughness: 0.45,
  });
}

export function plasticMaterial(color = '#151516', roughness = 0.62): MeshStandardMaterial {
  return new MeshStandardMaterial({ color, roughness, metalness: 0 });
}
