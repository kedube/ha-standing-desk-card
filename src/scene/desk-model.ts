import {
  BufferGeometry,
  CanvasTexture,
  CylinderGeometry,
  EdgesGeometry,
  ExtrudeGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  Material,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  Shape,
  SRGBColorSpace,
  Vector3,
} from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { CELL_HEIGHT, CELL_WIDTH, DOT, SEGMENT_NAMES, displayCells, segmentPolygon } from '../seven-segment';
import type { DesktopFinish, FrameFinish, KeypadColor, KeypadSide } from '../types';
import { KEYPAD_COLORS, darken, desktopMaterial, frameMaterial, plasticMaterial } from './materials';
import { V2, frameLayout, legStages } from './layout';
import type { DesktopSize, FrameLayout } from './layout';

export interface ModelSettings {
  desktop: DesktopSize;
  desktopColor: string;
  desktopFinish: DesktopFinish;
  frameColor: string;
  frameFinish: FrameFinish;
  keypadColor: KeypadColor;
  keypadSide: KeypadSide;
  presetCount: number;
  /** Desktop surface heights the controller is limited to (cm). */
  rangeMin: number;
  rangeMax: number;
  accentColor: string;
}

// --- Geometry helpers ------------------------------------------------------------------

function roundedRect(width: number, height: number, radius: number): Shape {
  const x0 = -width / 2;
  const x1 = width / 2;
  const y0 = -height / 2;
  const y1 = height / 2;
  const r = Math.min(radius, width / 2, height / 2);
  const shape = new Shape();
  shape.moveTo(x0 + r, y0);
  shape.lineTo(x1 - r, y0);
  shape.quadraticCurveTo(x1, y0, x1, y0 + r);
  shape.lineTo(x1, y1 - r);
  shape.quadraticCurveTo(x1, y1, x1 - r, y1);
  shape.lineTo(x0 + r, y1);
  shape.quadraticCurveTo(x0, y1, x0, y1 - r);
  shape.lineTo(x0, y0 + r);
  shape.quadraticCurveTo(x0, y0, x0 + r, y0);
  return shape;
}

/** Desktop slab from y = 0 to y = thickness, front edge at z = +depth/2. */
function desktopGeometry({ width, depth, thickness }: DesktopSize): BufferGeometry {
  const bevel = Math.min(0.3, thickness / 5);
  const geometry = new ExtrudeGeometry(roundedRect(width - 2 * bevel, depth - 2 * bevel, 1.2), {
    depth: thickness - 2 * bevel,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 3,
    curveSegments: 6,
  });
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, bevel, 0);
  return geometry;
}

/**
 * Extrudes a side profile drawn in (z, y) across the x axis, centred on x = 0.
 * Used for the feet and the side brackets, which are long front-to-back.
 */
function sideProfileGeometry(profile: Shape, width: number, bevel: number): BufferGeometry {
  const geometry = new ExtrudeGeometry(profile, {
    depth: width - 2 * bevel,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 3,
    curveSegments: 12,
  });
  geometry.rotateY(-Math.PI / 2); // profile u → world z, extrusion → world -x
  geometry.translate((width - 2 * bevel) / 2, 0, 0);
  return geometry;
}

/** T-foot profile: thick under the leg, tapering toward both ends; bottom at y = 0. */
function footGeometry(length: number, rear: number): BufferGeometry {
  const b = 0.45;
  const front = length - rear - b;
  const back = -rear + b;
  const top = V2.footHeight - b;
  const end = V2.footEndHeight - b;
  const flat = 5;
  const shape = new Shape();
  shape.moveTo(back, b);
  shape.lineTo(front, b);
  shape.lineTo(front, end);
  shape.bezierCurveTo(front - 14, end + 0.2, flat + 10, top, flat, top);
  shape.lineTo(-flat, top);
  shape.bezierCurveTo(-flat - 8, top, back + 8, end + 0.2, back, end);
  shape.closePath();
  return sideProfileGeometry(shape, V2.footWidth, b);
}

/** Side bracket under the desktop: flat top at y = 0, deepest at the leg. */
function bracketGeometry(): BufferGeometry {
  const b = 0.3;
  const half = V2.bracketLength / 2 - b;
  const deep = -(V2.bracketHeight - b);
  const end = -(V2.bracketEndHeight - b);
  const flat = 6;
  const shape = new Shape();
  shape.moveTo(-half, -b);
  shape.lineTo(half, -b);
  shape.lineTo(half, end);
  shape.bezierCurveTo(half - 8, end, flat + 6, deep, flat, deep);
  shape.lineTo(-flat, deep);
  shape.bezierCurveTo(-flat - 6, deep, -half + 8, end, -half, end);
  shape.closePath();
  return sideProfileGeometry(shape, V2.bracketWidth, b);
}

/** Stability brace: a triangular gusset from the leg side up to the frame (x outward, y down). */
function braceGeometry(depth: number): BufferGeometry {
  const shape = new Shape();
  shape.moveTo(0, 0);
  shape.lineTo(5.2, 0);
  shape.lineTo(0, -10);
  shape.closePath();
  const geometry = new ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: 0.15,
    bevelSize: 0.15,
    bevelSegments: 1,
  });
  geometry.translate(0, 0, -depth / 2);
  return geometry;
}

function stadium(width: number, height: number): Shape {
  const r = height / 2;
  const shape = new Shape();
  shape.moveTo(-width / 2 + r, -r);
  shape.lineTo(width / 2 - r, -r);
  shape.absarc(width / 2 - r, 0, r, -Math.PI / 2, Math.PI / 2, false);
  shape.lineTo(-width / 2 + r, r);
  shape.absarc(-width / 2 + r, 0, r, Math.PI / 2, (3 * Math.PI) / 2, false);
  return shape;
}

// --- Keypad face -------------------------------------------------------------------------

const FACE_W = 512;
const FACE_H = Math.round((FACE_W * V2.keypadHeight) / V2.keypadWidth);

interface KeypadFace {
  map: CanvasTexture;
  glow: CanvasTexture;
  draw(text: string): void;
}

function keypadFace(color: KeypadColor, presetCount: number): KeypadFace {
  const mapCanvas = document.createElement('canvas');
  const glowCanvas = document.createElement('canvas');
  for (const canvas of [mapCanvas, glowCanvas]) {
    canvas.width = FACE_W;
    canvas.height = FACE_H;
  }
  const map = new CanvasTexture(mapCanvas);
  const glow = new CanvasTexture(glowCanvas);
  map.colorSpace = SRGBColorSpace;
  glow.colorSpace = SRGBColorSpace;
  for (const texture of [map, glow]) {
    texture.repeat.set(1 / V2.keypadWidth, 1 / V2.keypadHeight);
    texture.offset.set(0.5, 0.5);
  }

  const light = color === 'white';
  const keys = ['↑', '↓', ...Array.from({ length: presetCount }, (_, i) => String(i + 1)), 'M'];
  const display = { x: FACE_W * 0.075, y: FACE_H * 0.2, w: FACE_W * 0.165, h: FACE_H * 0.6 };

  const drawDigits = (ctx: CanvasRenderingContext2D, text: string, litStyle: string, unlitStyle: string | null) => {
    const cells = displayCells(text);
    const pitch = CELL_WIDTH + 1.4;
    const scale = Math.min((display.w * 0.86) / (pitch * 3), (display.h * 0.78) / CELL_HEIGHT);
    const ox = display.x + (display.w - pitch * 3 * scale) / 2;
    const oy = display.y + (display.h - CELL_HEIGHT * scale) / 2;
    cells.forEach((cell, index) => {
      for (const segment of SEGMENT_NAMES) {
        const lit = cell.lit.has(segment);
        if (!lit && !unlitStyle) continue;
        ctx.fillStyle = lit ? litStyle : unlitStyle!;
        ctx.beginPath();
        segmentPolygon(segment).forEach(([x, y], i) => {
          const px = ox + (index * pitch + x) * scale;
          const py = oy + y * scale;
          i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
        });
        ctx.fill();
      }
      if (cell.dot) {
        ctx.fillStyle = litStyle;
        const [x, y, size] = DOT;
        ctx.fillRect(ox + (index * pitch + x) * scale, oy + y * scale, size * scale, size * scale);
      }
    });
  };

  const draw = (text: string) => {
    const ctx = mapCanvas.getContext('2d')!;
    ctx.fillStyle = KEYPAD_COLORS[color];
    ctx.fillRect(0, 0, FACE_W, FACE_H);
    ctx.fillStyle = '#060607';
    ctx.beginPath();
    ctx.roundRect(display.x, display.y, display.w, display.h, 6);
    ctx.fill();
    drawDigits(ctx, text, '#f2f7ff', 'rgba(255,255,255,0.05)');

    const start = display.x + display.w + FACE_W * 0.03;
    const end = FACE_W * 0.9;
    const size = Math.min(FACE_H * 0.5, ((end - start) / keys.length) * 0.78);
    const gap = (end - start - size * keys.length) / Math.max(1, keys.length - 1);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `600 ${Math.round(size * 0.5)}px sans-serif`;
    keys.forEach((key, i) => {
      const x = start + i * (size + gap);
      const y = (FACE_H - size) / 2;
      ctx.fillStyle = light ? '#f7f7f5' : '#252528';
      ctx.strokeStyle = light ? '#b9b9b6' : '#4a4a4f';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(x, y, size, size, size * 0.18);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = light ? '#2a2a2c' : '#e9e9ec';
      ctx.fillText(key, x + size / 2, y + size / 2 + 1);
    });
    map.needsUpdate = true;

    const gctx = glowCanvas.getContext('2d')!;
    gctx.fillStyle = '#000';
    gctx.fillRect(0, 0, FACE_W, FACE_H);
    drawDigits(gctx, text, '#d8e8ff', null);
    glow.needsUpdate = true;
  };

  return { map, glow, draw };
}

// --- Model ---------------------------------------------------------------------------------

/**
 * UPLIFT V2 2-leg desk. Coordinates in cm: x right, y up from the floor, z toward the viewer.
 * The top assembly (desktop, brackets, crossbar, braces, upper leg stages, keypad) moves with
 * the height; the middle stages move at half that rate; the inner stages and feet stay put.
 */
export class DeskModel {
  readonly root = new Group();
  readonly layout: FrameLayout;
  private readonly top = new Group();
  private readonly middleStages: Object3D[] = [];
  private readonly middleBushings: Object3D[] = [];
  private readonly ghost = new Group();
  private readonly geometries: BufferGeometry[] = [];
  private readonly materials: Material[] = [];
  private readonly textures: CanvasTexture[] = [];
  private readonly face: KeypadFace;
  private faceText = '';

  constructor(private readonly settings: ModelSettings, anisotropy: number) {
    const { desktop } = settings;
    this.layout = frameLayout(desktop, settings.rangeMin, settings.rangeMax);
    const layout = this.layout;

    const frame = this.track(frameMaterial(settings.frameColor, settings.frameFinish));
    const plastic = this.track(plasticMaterial());
    // Guide bushings between leg stages: plastic, a shade darker than the frame.
    const bushing = this.track(plasticMaterial(darken(settings.frameColor, 0.55), 0.7));
    const desk = this.track(desktopMaterial(settings.desktopColor, settings.desktopFinish, desktop.width, desktop.depth, anisotropy));
    this.textures.push(desk.map as CanvasTexture);

    // Desktop
    const slab = this.geometry(desktopGeometry(desktop));
    this.top.add(this.mesh(slab, desk));

    // Brackets, braces and upper leg stages, mirrored for each side.
    const bracket = this.geometry(bracketGeometry());
    const brace = this.geometry(braceGeometry(V2.legOuter[1] - 1.2));
    const stages = legStages(layout, desktop, layout.minHeight);
    const outer = this.geometry(new RoundedBoxGeometry(V2.legOuter[0], layout.outerLength, V2.legOuter[1], 2, 0.4));
    const middle = this.geometry(new RoundedBoxGeometry(V2.legMiddle[0], layout.middleLength, V2.legMiddle[1], 2, 0.35));
    const inner = this.geometry(new RoundedBoxGeometry(V2.legInner[0], layout.innerLength, V2.legInner[1], 2, 0.3));
    const outerBushing = this.geometry(new RoundedBoxGeometry(V2.legOuter[0] - 0.2, 0.6, V2.legOuter[1] - 0.2, 1, 0.15));
    const middleBushing = this.geometry(new RoundedBoxGeometry(V2.legMiddle[0] - 0.2, 0.5, V2.legMiddle[1] - 0.2, 1, 0.12));
    const foot = this.geometry(footGeometry(layout.footLength, layout.legZ - layout.footRear));
    const glide = this.geometry(new CylinderGeometry(V2.glideRadius, V2.glideRadius * 0.9, V2.glideHeight, 24));

    const outerTopLocal = -V2.bracketHeight;
    for (const side of [-1, 1]) {
      const x = side * layout.legX;
      this.top.add(this.mesh(bracket, frame, x, 0, layout.legZ));

      const outerMesh = this.mesh(outer, frame, x, outerTopLocal - layout.outerLength / 2, layout.legZ);
      this.top.add(outerMesh);
      this.top.add(this.mesh(outerBushing, bushing, x, outerTopLocal - layout.outerLength - 0.25, layout.legZ));

      // Stability brace: a gusset from the inner face of the leg up to the crossbar.
      const gusset = this.mesh(brace, frame, x - side * (V2.legOuter[0] / 2), outerTopLocal + 0.01, layout.legZ);
      gusset.scale.x = -side;
      this.top.add(gusset);

      const middleMesh = this.mesh(middle, frame, x, 0, layout.legZ);
      const middleBushingMesh = this.mesh(middleBushing, bushing, x, 0, layout.legZ);
      this.middleStages.push(middleMesh);
      this.middleBushings.push(middleBushingMesh);
      this.root.add(middleMesh, middleBushingMesh);

      this.root.add(this.mesh(inner, frame, x, stages.inner.bottom + layout.innerLength / 2, layout.legZ));

      const footMesh = this.mesh(foot, frame, x, V2.glideHeight, layout.legZ);
      this.root.add(footMesh);
      for (const z of [layout.footFront - 3.5, layout.footRear + 3.5]) {
        this.root.add(this.mesh(glide, plastic, x, V2.glideHeight / 2, z));
      }
    }

    // Crossbar between the brackets, over the legs.
    const crossbarLength = 2 * layout.legX - V2.bracketWidth;
    const crossbar = this.geometry(new RoundedBoxGeometry(crossbarLength, V2.crossbarHeight, V2.crossbarDepth, 2, 0.3));
    this.top.add(this.mesh(crossbar, frame, 0, -V2.crossbarHeight / 2, layout.legZ));

    // Advanced keypad under the front edge.
    this.face = keypadFace(settings.keypadColor, settings.presetCount);
    this.textures.push(this.face.map, this.face.glow);
    const faceMaterial = this.track(
      new MeshStandardMaterial({
        map: this.face.map,
        emissiveMap: this.face.glow,
        emissive: '#ffffff',
        emissiveIntensity: 1.1,
        roughness: 0.42,
      }),
    );
    const bodyMaterial = this.track(plasticMaterial(KEYPAD_COLORS[settings.keypadColor], 0.5));
    const keypadDepth = 1.6;
    const keypad = this.geometry(
      new ExtrudeGeometry(stadium(V2.keypadWidth, V2.keypadHeight), {
        depth: keypadDepth,
        bevelEnabled: true,
        bevelThickness: 0.15,
        bevelSize: 0.12,
        bevelSegments: 2,
        curveSegments: 16,
      }),
    );
    const keypadX = (settings.keypadSide === 'left' ? -1 : 1) * (desktop.width / 2 - V2.keypadInset);
    const keypadMesh = new Mesh(keypad, [faceMaterial, bodyMaterial]);
    keypadMesh.position.set(keypadX, -V2.keypadHeight / 2 - 0.1, desktop.depth / 2 - keypadDepth - 0.1);
    this.top.add(keypadMesh);
    const mount = this.geometry(new RoundedBoxGeometry(V2.keypadWidth * 0.56, V2.keypadHeight * 0.8, V2.keypadDepth, 1, 0.3));
    this.top.add(this.mesh(mount, bodyMaterial, keypadX, -V2.keypadHeight / 2, desktop.depth / 2 - keypadDepth - V2.keypadDepth / 2));

    // Ghost of the desktop at a target height.
    const ghostFill = this.track(
      new MeshBasicMaterial({ color: settings.accentColor, transparent: true, opacity: 0.16, depthWrite: false }),
    );
    const ghostLine = this.track(
      new LineBasicMaterial({ color: settings.accentColor, transparent: true, opacity: 0.9, depthWrite: false }),
    );
    const ghostMesh = new Mesh(slab, ghostFill);
    ghostMesh.renderOrder = 2;
    const edges = this.geometry(new EdgesGeometry(slab, 40));
    const ghostEdges = new LineSegments(edges, ghostLine);
    ghostEdges.renderOrder = 3;
    this.ghost.add(ghostMesh, ghostEdges);
    this.ghost.visible = false;

    this.root.add(this.top, this.ghost);
    this.setKeypadText('---');
    this.setHeight(layout.minHeight);
  }

  setHeight(heightCm: number): void {
    const stages = legStages(this.layout, this.settings.desktop, heightCm);
    this.top.position.y = stages.frameTop;
    for (const stage of this.middleStages) stage.position.y = stages.middle.bottom + this.layout.middleLength / 2;
    // The bushing at the foot of the middle stage, where the inner stage comes out.
    for (const bushing of this.middleBushings) bushing.position.y = stages.middle.bottom - 0.2;
  }

  setGhost(heightCm: number | null): void {
    this.ghost.visible = heightCm !== null;
    if (heightCm !== null) {
      const stages = legStages(this.layout, this.settings.desktop, heightCm);
      this.ghost.position.y = stages.frameTop;
    }
  }

  setKeypadText(text: string): boolean {
    if (text === this.faceText) return false;
    this.faceText = text;
    this.face.draw(text);
    return true;
  }

  /** Points that must stay in frame: the desk at full height plus the feet. */
  boundsPoints(): Vector3[] {
    const { width, depth } = this.settings.desktop;
    const { maxHeight, minHeight, legX, footFront, footRear } = this.layout;
    const points: Vector3[] = [];
    for (const x of [-width / 2, width / 2]) {
      for (const z of [-depth / 2, depth / 2]) {
        points.push(new Vector3(x, maxHeight, z), new Vector3(x, minHeight - this.settings.desktop.thickness, z));
      }
    }
    for (const x of [-legX - V2.footWidth / 2, legX + V2.footWidth / 2]) {
      for (const z of [footFront, footRear]) points.push(new Vector3(x, 0, z));
    }
    return points;
  }

  dispose(): void {
    this.geometries.forEach((g) => g.dispose());
    this.materials.forEach((m) => m.dispose());
    this.textures.forEach((t) => t.dispose());
    this.root.clear();
  }

  private geometry<T extends BufferGeometry>(geometry: T): T {
    this.geometries.push(geometry);
    return geometry;
  }

  private track<T extends Material>(material: T): T {
    this.materials.push(material);
    return material;
  }

  private mesh(geometry: BufferGeometry, material: Material, x = 0, y = 0, z = 0): Mesh {
    const mesh = new Mesh(geometry, material);
    mesh.position.set(x, y, z);
    return mesh;
  }
}
