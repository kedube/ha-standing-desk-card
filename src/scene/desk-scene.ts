import {
  Box3,
  CanvasTexture,
  DirectionalLight,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  NeutralToneMapping,
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from 'three';
import type { WebGLRenderTarget } from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { followHeight } from '../motion';
import { DeskModel } from './desk-model';
import type { ModelSettings } from './desk-model';
import { V2 } from './layout';

/** Camera looks down at the desk from a standing viewer's eye level. */
const PITCH = MathUtils.degToRad(12);
/** A longish lens, as in product photography, so the feet don't splay. */
const FOV = 18;

function softSpotTexture(): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  gradient.addColorStop(0, 'rgba(0,0,0,1)');
  gradient.addColorStop(0.45, 'rgba(0,0,0,0.55)');
  gradient.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 128, 128);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

/** Fraction of the soft-shadow texture taken by the blur margin on each side. */
const SHADOW_MARGIN = 0.2;

/** A heavily blurred rectangle: the shadow an overhead softbox casts under the desktop. */
function softRectTexture(): CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const inset = size * SHADOW_MARGIN;
  // Draw the rectangle off-canvas and keep only its blurred shadow (works without ctx.filter).
  ctx.shadowColor = 'rgba(0,0,0,1)';
  ctx.shadowBlur = inset * 0.9;
  ctx.shadowOffsetX = size * 2;
  ctx.fillStyle = '#000';
  ctx.fillRect(inset - size * 2, inset, size - 2 * inset, size - 2 * inset);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

/**
 * Owns the WebGL renderer for one card. Renders only when something changes: while the
 * displayed height is catching up with the reported height, or after a settings, ghost
 * or keypad update.
 */
export class DeskScene {
  readonly canvas: HTMLCanvasElement;
  /** Called after each rendered frame with the height currently drawn. */
  onFrame?: (heightCm: number) => void;

  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(FOV, 1, 10, 6000);
  private environment: WebGLRenderTarget;
  private readonly keyLight = new DirectionalLight(0xffffff, 1.1);
  private readonly spotTexture = softSpotTexture();
  private readonly deskShadow = new Mesh(
    new PlaneGeometry(1, 1),
    new MeshBasicMaterial({ map: softRectTexture(), transparent: true, depthWrite: false }),
  );
  private readonly contact: Mesh[] = [];
  private model?: DeskModel;
  private modelKey = '';
  private settings?: ModelSettings;
  private width = 0;
  private height = 0;
  private displayed = NaN;
  private target = NaN;
  private ghost: number | null = null;
  private keypadText = '---';
  private frame = 0;
  private lastTime = 0;
  private contextLost = false;

  constructor() {
    this.renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = NeutralToneMapping;
    this.renderer.toneMappingExposure = 0.95;
    this.canvas = this.renderer.domElement;
    this.canvas.addEventListener('webglcontextlost', this.onContextLost);
    this.canvas.addEventListener('webglcontextrestored', this.onContextRestored);

    // Studio lighting: a soft room environment for reflections plus one key light for shadows.
    this.environment = this.buildEnvironment();
    this.scene.environmentIntensity = 0.8;

    this.keyLight.position.set(-70, 360, 170);
    this.scene.add(this.keyLight, this.keyLight.target);

    this.deskShadow.rotation.x = -Math.PI / 2;
    this.deskShadow.position.y = 0.04;
    this.deskShadow.renderOrder = 1;
    this.scene.add(this.deskShadow);
  }

  /** Rebuilds the model when the desk's look or size changes. Returns true if it did. */
  configure(settings: ModelSettings): boolean {
    const key = JSON.stringify(settings);
    if (key === this.modelKey) return false;
    this.modelKey = key;
    this.settings = settings;
    if (this.model) {
      this.scene.remove(this.model.root);
      this.model.dispose();
    }
    this.model = new DeskModel(settings, this.renderer.capabilities.getMaxAnisotropy());
    this.scene.add(this.model.root);
    this.model.setKeypadText(this.keypadText);
    this.model.setGhost(this.ghost);
    if (Number.isFinite(this.displayed)) this.model.setHeight(this.displayed);
    this.placeContactShadows();
    this.placeDeskShadow(Number.isFinite(this.displayed) ? this.displayed : this.model.layout.minHeight);
    this.fitCamera();
    this.requestRender();
    return true;
  }

  setHeight(heightCm: number, immediate = false): void {
    if (!Number.isFinite(heightCm)) return;
    this.target = heightCm;
    if (immediate || !Number.isFinite(this.displayed)) {
      this.displayed = heightCm;
      this.model?.setHeight(heightCm);
      this.placeDeskShadow(heightCm);
    }
    this.requestRender();
  }

  setGhost(heightCm: number | null): void {
    if (heightCm === this.ghost) return;
    this.ghost = heightCm;
    this.model?.setGhost(heightCm);
    this.requestRender();
  }

  setKeypadText(text: string): void {
    this.keypadText = text;
    if (this.model?.setKeypadText(text)) this.requestRender();
  }

  setSize(width: number, height: number): void {
    if (width === this.width && height === this.height) return;
    if (width <= 0 || height <= 0) return;
    this.width = width;
    this.height = height;
    this.renderer.setSize(width, height, false);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.fitCamera();
    this.requestRender();
  }

  /** Vertical position (CSS px from the canvas top) of the desktop's front edge at a height. */
  projectHeight(heightCm: number): number {
    if (!this.settings || !this.height) return 0;
    const { width, depth } = this.settings.desktop;
    const point = new Vector3(-width / 2, heightCm, depth / 2).project(this.camera);
    return ((1 - point.y) / 2) * this.height;
  }

  /** Inverse of projectHeight within the model's range. */
  heightAt(y: number, min: number, max: number): number {
    let lo = min;
    let hi = max;
    for (let i = 0; i < 28; i++) {
      const mid = (lo + hi) / 2;
      // Higher desks project higher up the canvas (smaller y).
      if (this.projectHeight(mid) > y) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  }

  get displayedHeight(): number {
    return this.displayed;
  }

  dispose(): void {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.canvas.removeEventListener('webglcontextlost', this.onContextLost);
    this.canvas.removeEventListener('webglcontextrestored', this.onContextRestored);
    this.model?.dispose();
    this.model = undefined;
    this.deskShadow.geometry.dispose();
    this.deskShadow.material.map?.dispose();
    this.deskShadow.material.dispose();
    for (const mesh of this.contact) {
      mesh.geometry.dispose();
      (mesh.material as MeshBasicMaterial).dispose();
    }
    this.spotTexture.dispose();
    this.environment.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.canvas.remove();
  }

  private requestRender(): void {
    if (!this.frame && !this.contextLost) this.frame = requestAnimationFrame(this.tick);
  }

  private readonly tick = (time: number): void => {
    this.frame = 0;
    if (!this.model || !this.width) return;
    const dt = this.lastTime ? Math.min(0.1, (time - this.lastTime) / 1000) : 0;
    this.lastTime = time;
    let moving = false;
    if (Number.isFinite(this.target) && this.displayed !== this.target) {
      this.displayed = followHeight(this.displayed, this.target, dt);
      this.model.setHeight(this.displayed);
      this.placeDeskShadow(this.displayed);
      moving = this.displayed !== this.target;
    }
    this.renderer.render(this.scene, this.camera);
    this.onFrame?.(this.displayed);
    if (moving) this.requestRender();
    else this.lastTime = 0;
  };

  /** Soft dark pads under each foot so the desk sits on the floor. */
  private placeContactShadows(): void {
    for (const mesh of this.contact) {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
      (mesh.material as MeshBasicMaterial).dispose();
    }
    this.contact.length = 0;
    if (!this.model) return;
    const { legX, legZ, footFront, footRear } = this.model.layout;
    for (const x of [-legX, legX]) {
      const length = footFront - footRear + 8;
      const mesh = new Mesh(
        new PlaneGeometry(V2.footWidth * 2.1, length),
        new MeshBasicMaterial({ map: this.spotTexture, transparent: true, opacity: 0.42, depthWrite: false }),
      );
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(x, 0.05, (footFront + footRear) / 2);
      mesh.renderOrder = 1;
      this.contact.push(mesh);
      this.scene.add(mesh);
      // A tighter, darker pad right under the leg where the foot is thickest.
      const pad = new Mesh(
        new PlaneGeometry(V2.footWidth * 1.6, 24),
        new MeshBasicMaterial({ map: this.spotTexture, transparent: true, opacity: 0.3, depthWrite: false }),
      );
      pad.rotation.x = -Math.PI / 2;
      pad.position.set(x, 0.06, legZ);
      pad.renderOrder = 1;
      this.contact.push(pad);
      this.scene.add(pad);
    }
  }

  /** The higher the desktop, the wider and fainter its shadow, as under a large softbox. */
  private placeDeskShadow(heightCm: number): void {
    if (!this.settings || !this.model) return;
    const { width, depth } = this.settings.desktop;
    const t = MathUtils.clamp((heightCm - 60) / 70, 0, 1);
    // Fades out just past the desktop's ends so the canvas never cuts it off; the penumbra
    // (the texture's blurred margin) widens slightly as the desk rises.
    const spread = heightCm * 0.1;
    this.deskShadow.scale.set(width + 12 + spread, depth + 24 + spread, 1);
    this.deskShadow.position.z = -2;
    this.deskShadow.material.opacity = MathUtils.lerp(0.24, 0.13, t);
  }

  /**
   * Fixes the viewing direction and finds the distance at which the desk at full height,
   * plus its feet, fills the canvas with a small margin.
   */
  private fitCamera(): void {
    if (!this.model || !this.width) return;
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
    const points = this.model.boundsPoints();
    const center = new Box3().setFromPoints(points).getCenter(new Vector3());
    const direction = new Vector3(0, Math.sin(PITCH), Math.cos(PITCH));
    const projected = new Vector3();

    const place = (distance: number) => {
      this.camera.position.copy(center).addScaledVector(direction, distance);
      this.camera.lookAt(center);
      this.camera.updateMatrixWorld();
    };
    const extent = () => {
      let minY = Infinity;
      let maxY = -Infinity;
      let maxX = 0;
      for (const point of points) {
        projected.copy(point).project(this.camera);
        minY = Math.min(minY, projected.y);
        maxY = Math.max(maxY, projected.y);
        maxX = Math.max(maxX, Math.abs(projected.x));
      }
      return { minY, maxY, maxX };
    };

    for (let pass = 0; pass < 3; pass++) {
      let lo = 50;
      let hi = 8000;
      for (let i = 0; i < 32; i++) {
        const distance = (lo + hi) / 2;
        place(distance);
        const { minY, maxY, maxX } = extent();
        if (maxX <= 0.94 && (maxY - minY) / 2 <= 0.9) hi = distance;
        else lo = distance;
      }
      place(hi);
      // Re-centre vertically: perspective makes the top and bottom margins uneven.
      const { minY, maxY } = extent();
      const offset = (maxY + minY) / 2;
      const halfHeight = hi * Math.tan(MathUtils.degToRad(FOV / 2));
      center.y += offset * halfHeight;
    }
  }

  private readonly onContextLost = (event: Event): void => {
    event.preventDefault();
    this.contextLost = true;
    cancelAnimationFrame(this.frame);
    this.frame = 0;
  };

  private buildEnvironment(): WebGLRenderTarget {
    const pmrem = new PMREMGenerator(this.renderer);
    const room = new RoomEnvironment();
    const target = pmrem.fromScene(room, 0.04);
    room.dispose();
    pmrem.dispose();
    this.scene.environment = target.texture;
    return target;
  }

  private readonly onContextRestored = (): void => {
    this.contextLost = false;
    // Rebuild everything that lived on the GPU.
    this.environment.dispose();
    this.environment = this.buildEnvironment();
    const settings = this.settings;
    this.modelKey = '';
    if (settings) this.configure(settings);
  };
}
