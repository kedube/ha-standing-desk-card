import { LitElement, css, html, nothing, svg } from 'lit';
import type { PropertyValues, TemplateResult } from 'lit';
import { findDeskDevices, missingRoles, resolveEntities } from './entities';
import { KeypadController } from './keypad-controller';
import type { Direction } from './keypad-controller';
import { StandingDeskKeypad } from './keypad-element';
import { StandingDeskCardEditor } from './editor';
import { scaleTicks, spreadMarkers } from './scale';
import { DeskScene } from './scene/desk-scene';
import type { ModelSettings } from './scene/desk-model';
import { resolveDesktop, resolveFrame } from './scene/materials';
import { V2 } from './scene/layout';
import { PRESET_NUMBERS } from './types';
import type { EntityMap, EntityRole, HomeAssistant, StandingDeskCardConfig, Unit } from './types';
import {
  CM_PER_IN,
  clamp,
  formatHeight,
  fromUnit,
  keypadText,
  parseLength,
  resolveUnit,
  snapHeight,
  snapStep,
  toUnit,
  unitLabel,
} from './units';

const VERSION = __CARD_VERSION__;
export const CARD_TYPE = 'standing-desk-card';
const EDITOR_TYPE = 'standing-desk-card-editor';
const KEYPAD_TYPE = 'standing-desk-keypad';

/** Defaults when the controller's Min/Max Height entities aren't available: the V2's range with a 1″ top. */
const FALLBACK_MIN = V2.frameMin + CM_PER_IN;
const FALLBACK_MAX = V2.frameMax + CM_PER_IN;
const SCALE_WIDTH = 70;

interface DeskState {
  available: boolean;
  height: number;
  status: string;
  moving: boolean;
  presets: number[];
  min: number;
  max: number;
  idleSeconds: number;
}

interface EntryState {
  value: string;
  error?: string;
}

export class StandingDeskCard extends LitElement {
  static override properties = {
    hass: { attribute: false },
    _config: { state: true },
    _entry: { state: true },
    _dragTarget: { state: true },
    _pendingTarget: { state: true },
    _webglFailed: { state: true },
    _layoutVersion: { state: true },
  };

  declare hass?: HomeAssistant;
  declare _config?: StandingDeskCardConfig;
  declare _entry?: EntryState;
  declare _dragTarget?: number;
  declare _pendingTarget?: number;
  declare _webglFailed: boolean;
  declare _layoutVersion: number;

  private scene?: DeskScene;
  private resizeObserver?: ResizeObserver;
  private readonly keypad: KeypadController;
  private entityCache?: { registry: unknown; states: unknown; config: unknown; entities: EntityMap };
  private pendingSince = 0;
  private pendingSawMovement = false;
  private pendingTimer?: ReturnType<typeof setTimeout>;
  private dragPointer?: number;
  private focusEntry = false;
  // `themes: {}` never matches hass.themes, so the first call reads the theme.
  private accent = { themes: {} as unknown, color: '#03a9f4' };

  constructor() {
    super();
    this._webglFailed = false;
    this._layoutVersion = 0;
    this.keypad = new KeypadController(
      {
        nudge: (direction) => {
          this.clearPending();
          this.press(direction === 'up' ? 'nudge_up' : 'nudge_down');
        },
        stop: () => {
          this.clearPending();
          this.press('stop');
        },
        gotoPreset: (preset) => {
          this.press(`preset_${preset}` as EntityRole);
          const height = this.deskState().presets[preset - 1];
          if (Number.isFinite(height)) this.setPending(height);
        },
        savePreset: (preset) => this.press(`save_preset_${preset}` as EntityRole),
      },
      {},
      () => this.requestUpdate(),
    );
    this.keypad.isDeskMoving = () => this.deskState().moving;
  }

  // --- Lovelace API --------------------------------------------------------------------------

  setConfig(config: StandingDeskCardConfig): void {
    if (!config) throw new Error('Invalid configuration');
    const presets = Number(config.presets ?? 4);
    if (!Number.isInteger(presets) || presets < 2 || presets > 4) {
      throw new Error('presets must be 2, 3 or 4');
    }
    this._config = { ...config, presets };
    this.keypad.options = {
      ...this.keypad.options,
      allowSave: config.allow_preset_save !== false,
      repeatMs: clamp(Number(config.hold_repeat_ms) || 250, 100, 1000),
    };
  }

  getCardSize(): number {
    return 7;
  }

  getGridOptions() {
    return { columns: 12, rows: 'auto', min_columns: 6 };
  }

  static getConfigElement(): HTMLElement {
    return document.createElement(EDITOR_TYPE);
  }

  static getStubConfig(hass: HomeAssistant): Partial<StandingDeskCardConfig> {
    const device = findDeskDevices(hass)[0];
    return device ? { device } : {};
  }

  // --- Derived state -------------------------------------------------------------------------

  private get presetCount(): number {
    return this._config?.presets ?? 4;
  }

  private get unit(): Unit {
    return resolveUnit(this._config?.unit, this.hass);
  }

  private get entities(): EntityMap {
    const hass = this.hass;
    const config = this._config;
    if (!hass || !config) return {};
    const cache = this.entityCache;
    // Without an entity registry, discovery scans states; only redo that until something is found.
    const statesMatter = !hass.entities && !cache?.entities.height;
    if (
      cache &&
      cache.registry === hass.entities &&
      cache.config === config &&
      (!statesMatter || cache.states === hass.states)
    ) {
      return cache.entities;
    }
    const { entities } = resolveEntities(hass, config);
    this.entityCache = { registry: hass.entities, states: hass.states, config, entities };
    return entities;
  }

  /** The DeskUp Pro reports centimetres, but a customised firmware may use inches. */
  private get sourceUnit(): Unit {
    const id = this.entities.height ?? this.entities.height_sensor;
    const unit = id ? this.hass?.states[id]?.attributes.unit_of_measurement : undefined;
    return typeof unit === 'string' && /^(in|inch|inches|"|″)$/i.test(unit.trim()) ? 'in' : 'cm';
  }

  private deskState(): DeskState {
    const hass = this.hass;
    const entities = this.entities;
    const source = this.sourceUnit;
    const stateOf = (role: EntityRole) => {
      const id = entities[role];
      return id && hass ? hass.states[id] : undefined;
    };
    const numberOf = (role: EntityRole) => {
      const value = parseFloat(stateOf(role)?.state ?? '');
      return Number.isFinite(value) ? value : NaN;
    };
    const heightOf = (role: EntityRole) => fromUnit(numberOf(role), source);
    const heightEntity = stateOf('height') ?? stateOf('height_sensor');
    let height = heightOf('height');
    if (!Number.isFinite(height)) height = heightOf('height_sensor');
    const available = !!heightEntity && heightEntity.state !== 'unavailable' && Number.isFinite(height);
    const status = stateOf('status')?.state ?? '';

    let min = heightOf('min_height');
    let max = heightOf('max_height');
    const attributes = stateOf('height')?.attributes ?? {};
    if (!Number.isFinite(min)) min = fromUnit(Number(attributes.min), source);
    if (!Number.isFinite(max)) max = fromUnit(Number(attributes.max), source);
    if (!Number.isFinite(min) || !Number.isFinite(max) || max - min < 5) {
      min = FALLBACK_MIN;
      max = FALLBACK_MAX;
    }

    return {
      available,
      height,
      status,
      moving: status === 'Raising' || status === 'Lowering',
      presets: PRESET_NUMBERS.slice(0, this.presetCount).map((n) => {
        const value = heightOf(`preset_${n}_height`);
        return value > 0 ? value : NaN;
      }),
      min,
      max,
      idleSeconds: numberOf('idle_time'),
    };
  }

  private modelSettings(state: DeskState): ModelSettings {
    const config = this._config!;
    const desktop = resolveDesktop(config.desktop_color, config.desktop_finish);
    const frame = resolveFrame(config.frame_color, config.frame_finish);
    return {
      desktop: {
        width: clamp(parseLength(config.desktop_width, 60 * CM_PER_IN), 60, 260),
        depth: clamp(parseLength(config.desktop_depth, 30 * CM_PER_IN), 45, 110),
        thickness: clamp(parseLength(config.desktop_thickness, CM_PER_IN), 1, 6),
      },
      desktopColor: desktop.color,
      desktopFinish: desktop.finish,
      frameColor: frame.color,
      frameFinish: frame.finish,
      keypadColor: config.keypad_color ?? 'black',
      keypadSide: config.keypad_side ?? 'right',
      presetCount: this.presetCount,
      rangeMin: state.min,
      rangeMax: state.max,
      accentColor: this.accentColor(),
    };
  }

  /** The theme's primary color, re-read only when the theme changes. */
  private accentColor(): string {
    const themes = this.hass?.themes;
    if (this.accent.themes !== themes) {
      const value = getComputedStyle(this).getPropertyValue('--primary-color').trim();
      this.accent = { themes, color: /^#[0-9a-f]{6}$/i.test(value) || /^rgb/i.test(value) ? value : '#03a9f4' };
    }
    return this.accent.color;
  }

  // --- Lifecycle -----------------------------------------------------------------------------

  override connectedCallback(): void {
    super.connectedCallback();
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    // The scene is released on disconnect; draw again when Home Assistant re-attaches the card.
    if (this.hasUpdated) this.requestUpdate();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    this.keypad.releaseDirection();
    this.keypad.dispose();
    clearTimeout(this.pendingTimer);
    this.resizeObserver?.disconnect();
    this.resizeObserver = undefined;
    this.scene?.dispose();
    this.scene = undefined;
  }

  protected override shouldUpdate(changed: PropertyValues): boolean {
    if (!this._config) return false;
    if (changed.size > 1 || !changed.has('hass')) return true;
    const previous = changed.get('hass') as HomeAssistant | undefined;
    const hass = this.hass;
    if (!previous || !hass) return true;
    if (previous.entities !== hass.entities || previous.themes !== hass.themes || previous.config !== hass.config) {
      return true;
    }
    if (!this.entities.height) return previous.states !== hass.states;
    return Object.values(this.entities).some((id) => id && previous.states[id] !== hass.states[id]);
  }

  protected override willUpdate(): void {
    if (!this.hass || !this._config) return;
    const state = this.deskState();
    this.updatePending(state);
    // Before render, so the scale is drawn against the refitted camera.
    this.scene?.configure(this.modelSettings(state));
  }

  protected override updated(): void {
    const created = this.ensureScene();
    const scene = this.scene;
    if (!scene || !this.hass || !this._config) return;
    const state = this.deskState();
    if (created) scene.configure(this.modelSettings(state));
    scene.setHeight(state.height);
    scene.setKeypadText(this.displayText(state));
    scene.setGhost(this._dragTarget ?? this._pendingTarget ?? null);
    this.positionMarker(scene.displayedHeight);
    if (this.focusEntry) {
      this.focusEntry = false;
      this.renderRoot.querySelector<HTMLInputElement>('.entry input')?.focus();
    }
  }

  /** Creates the scene (returning true) or re-homes its canvas if Lit replaced the host. */
  private ensureScene(): boolean {
    const host = this.renderRoot.querySelector<HTMLElement>('.gl');
    if (!host || this._webglFailed) return false;
    let created = false;
    if (!this.scene) {
      try {
        this.scene = new DeskScene();
      } catch (error) {
        console.warn('standing-desk-card: WebGL is unavailable', error);
        this._webglFailed = true;
        return false;
      }
      this.scene.onFrame = (height) => this.positionMarker(height);
      created = true;
    }
    if (this.scene.canvas.parentElement === host) return created;
    host.appendChild(this.scene.canvas);
    this.resizeObserver?.disconnect();
    this.resizeObserver = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (!box || !this.scene) return;
      this.scene.setSize(Math.round(box.width), Math.round(box.height));
      this._layoutVersion++;
    });
    this.resizeObserver.observe(host);
    return created;
  }

  private readonly onVisibilityChange = (): void => {
    if (document.hidden) {
      this.renderRoot.querySelector<StandingDeskKeypad>(KEYPAD_TYPE)?.releaseAll();
      this.keypad.releaseDirection();
    }
  };

  // --- Actions ---------------------------------------------------------------------------------

  private press(role: EntityRole): void {
    const entityId = this.entities[role];
    if (!entityId) {
      this.notify(`Standing desk: no entity found for ${role.replace(/_/g, ' ')}`);
      return;
    }
    this.call('button', 'press', { entity_id: entityId });
  }

  private moveTo(heightCm: number): void {
    const entityId = this.entities.height;
    if (!entityId) return;
    const value = Math.round(toUnit(heightCm, this.sourceUnit) * 10) / 10;
    this.call('number', 'set_value', { entity_id: entityId, value });
    this.setPending(fromUnit(value, this.sourceUnit));
  }

  private call(domain: string, service: string, data: Record<string, unknown>): void {
    this.hass?.callService(domain, service, data).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : (error as { message?: string })?.message ?? String(error);
      this.notify(`Standing desk: ${message}`);
    });
  }

  private notify(message: string): void {
    this.dispatchEvent(new CustomEvent('hass-notification', { detail: { message }, bubbles: true, composed: true }));
  }

  /** Shows the target outline until the desk gets there, stops elsewhere, or never starts. */
  private setPending(heightCm: number): void {
    this._pendingTarget = heightCm;
    this.pendingSince = Date.now();
    this.pendingSawMovement = false;
    clearTimeout(this.pendingTimer);
    this.pendingTimer = setTimeout(() => this.requestUpdate(), 8_500);
  }

  private clearPending(): void {
    this._pendingTarget = undefined;
    clearTimeout(this.pendingTimer);
  }

  private updatePending(state: DeskState): void {
    if (this._pendingTarget === undefined) return;
    const elapsed = Date.now() - this.pendingSince;
    if (state.moving) this.pendingSawMovement = true;
    const arrived = Math.abs(state.height - this._pendingTarget) <= 0.6;
    const stoppedShort = this.pendingSawMovement && !state.moving && elapsed > 1_500;
    const neverStarted = !this.pendingSawMovement && elapsed > 8_000;
    if (arrived || stoppedShort || neverStarted || elapsed > 90_000 || !state.available) this.clearPending();
  }

  private onHold(ev: CustomEvent<{ direction: Direction | null; active: boolean }>): void {
    if (ev.detail.active && ev.detail.direction) this.keypad.pressDirection(ev.detail.direction);
    else this.keypad.releaseDirection();
  }

  private onKey(ev: CustomEvent<{ key: number | 'M' }>): void {
    if (ev.detail.key === 'M') this.keypad.pressMemory();
    else this.keypad.pressPreset(ev.detail.key);
  }

  // --- Height entry ------------------------------------------------------------------------------

  private openEntry(): void {
    const state = this.deskState();
    if (!state.available) return;
    this._entry = { value: toUnit(state.height, this.unit).toFixed(1) };
    this.focusEntry = true;
  }

  private submitEntry(ev: Event): void {
    ev.preventDefault();
    const entry = this._entry;
    if (!entry) return;
    const state = this.deskState();
    const unit = this.unit;
    const value = parseFloat(entry.value);
    const cm = fromUnit(value, unit);
    if (!Number.isFinite(value) || cm < state.min - 0.05 || cm > state.max + 0.05) {
      this._entry = { ...entry, error: `Enter a height from ${this.rangeText(state)}` };
      return;
    }
    this._entry = undefined;
    this.moveTo(clamp(cm, state.min, state.max));
  }

  private rangeText(state: DeskState): string {
    const unit = this.unit;
    return `${toUnit(state.min, unit).toFixed(1)} to ${formatHeight(state.max, unit)}`;
  }

  // --- Height scale ------------------------------------------------------------------------------

  private scaleHeightAt(ev: PointerEvent, state: DeskState): number | undefined {
    const scene = this.scene;
    if (!scene) return undefined;
    const box = (ev.currentTarget as HTMLElement).getBoundingClientRect();
    const height = scene.heightAt(ev.clientY - box.top, state.min, state.max);
    return clamp(snapHeight(height, this.unit), state.min, state.max);
  }

  private onScaleDown(ev: PointerEvent): void {
    const state = this.deskState();
    if (!state.available || ev.button > 0 || this.dragPointer !== undefined) return;
    ev.preventDefault();
    (ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId);
    this.dragPointer = ev.pointerId;
    this._dragTarget = this.scaleHeightAt(ev, state);
  }

  private onScaleMove(ev: PointerEvent): void {
    if (ev.pointerId !== this.dragPointer) return;
    this._dragTarget = this.scaleHeightAt(ev, this.deskState());
  }

  private onScaleUp(ev: PointerEvent): void {
    if (ev.pointerId !== this.dragPointer) return;
    this.dragPointer = undefined;
    const target = this._dragTarget;
    this._dragTarget = undefined;
    if (target !== undefined) this.moveTo(target);
  }

  private onScaleCancel(ev: PointerEvent): void {
    if (ev.pointerId !== this.dragPointer) return;
    this.dragPointer = undefined;
    this._dragTarget = undefined;
  }

  private onScaleKey(ev: KeyboardEvent): void {
    const state = this.deskState();
    if (!state.available) return;
    const step = fromUnit(snapStep(this.unit), this.unit);
    const current = this._dragTarget ?? snapHeight(state.height, this.unit);
    const moves: Record<string, number> = {
      ArrowUp: current + step,
      ArrowDown: current - step,
      PageUp: current + step * 5,
      PageDown: current - step * 5,
      Home: state.max,
      End: state.min,
    };
    if (ev.key in moves) {
      ev.preventDefault();
      this._dragTarget = clamp(moves[ev.key], state.min, state.max);
    } else if (ev.key === 'Enter' && this._dragTarget !== undefined) {
      ev.preventDefault();
      const target = this._dragTarget;
      this._dragTarget = undefined;
      this.moveTo(target);
    } else if (ev.key === 'Escape') {
      this._dragTarget = undefined;
    }
  }

  private positionMarker(heightCm: number): void {
    const scene = this.scene;
    const marker = this.renderRoot.querySelector<HTMLElement>('.marker');
    if (!scene || !marker || !Number.isFinite(heightCm)) return;
    marker.style.transform = `translateY(${scene.projectHeight(heightCm).toFixed(1)}px)`;
    marker.style.opacity = '1';
  }

  // --- Rendering ---------------------------------------------------------------------------------

  private displayText(state: DeskState): string {
    if (!state.available) return '---';
    return this.keypad.message ?? keypadText(state.height, this.unit);
  }

  protected override render() {
    const config = this._config;
    const hass = this.hass;
    if (!config || !hass) return nothing;
    const entities = this.entities;
    if (!entities.height) {
      return html`<ha-card>
        <div class="setup">
          <strong>No DeskUp Pro controller found.</strong>
          Choose the controller's device in the card editor, or set <code>device</code> in YAML.
        </div>
      </ha-card>`;
    }

    const state = this.deskState();
    const unit = this.unit;
    const missing = missingRoles(entities, this.presetCount);
    const statusText = !state.available ? 'Unavailable' : state.moving ? `${state.status}…` : '';
    const target = this._dragTarget ?? this._pendingTarget;
    const showScale = config.show_scale !== false;

    return html`<ha-card>
      ${config.name
        ? html`<div class="header">
            <span class="name">${config.name}</span><span class="status">${statusText}</span>
          </div>`
        : nothing}
      <div class="stage ${state.available ? '' : 'offline'} ${showScale ? '' : 'no-scale'}">
        ${showScale ? this.renderScale(state, unit) : nothing}
        <div class="viewport">
          <div class="gl"></div>
          ${this._webglFailed
            ? html`<div class="notice">The 3D view needs WebGL, which this browser has turned off. The keypad still works.</div>`
            : nothing}
          ${!config.name && statusText ? html`<div class="chip">${statusText}</div>` : nothing}
          ${target !== undefined && this.scene
            ? html`<div class="target-pill" style="top: ${this.scene.projectHeight(target).toFixed(1)}px">
                ${formatHeight(target, unit)}
              </div>`
            : nothing}
          ${this._entry ? this.renderEntry(state, unit) : nothing}
        </div>
      </div>
      <standing-desk-keypad
        .text=${this.displayText(state)}
        .presetCount=${this.presetCount}
        .color=${config.keypad_color ?? 'black'}
        .allowSave=${config.allow_preset_save !== false}
        .armed=${this.keypad.saveArmed}
        .held=${this.keypad.heldDirection}
        .disabled=${!state.available}
        .label=${state.available
          ? `Desk height ${formatHeight(state.height, unit)}. Tap to type a height.`
          : 'Desk unavailable'}
        @keypad-hold=${this.onHold}
        @keypad-key=${this.onKey}
        @display-click=${this.openEntry}
      ></standing-desk-keypad>
      ${config.show_idle && Number.isFinite(state.idleSeconds)
        ? html`<div class="footer">${formatIdle(state.idleSeconds)}</div>`
        : nothing}
      ${missing.length
        ? html`<div class="warning">Missing entities: ${missing.map((role) => role.replace(/_/g, ' ')).join(', ')}</div>`
        : nothing}
    </ha-card>`;
  }

  private renderScale(state: DeskState, unit: Unit): TemplateResult {
    const scene = this.scene;
    const height = this.renderRoot.querySelector<HTMLElement>('.gl')?.clientHeight ?? 0;
    const ready = scene && height > 0;
    const ticks: TemplateResult[] = [];
    const markers: TemplateResult[] = [];
    const top = ready ? scene.projectHeight(state.max) : 0;
    const bottom = ready ? scene.projectHeight(state.min) : 0;
    if (ready) {
      for (const tick of scaleTicks(state.min, state.max, unit, (cm) => scene.projectHeight(cm))) {
        ticks.push(
          svg`<line class=${tick.major ? 'tick major' : 'tick'} x1=${tick.major ? 50 : 55} x2="62" y1=${tick.y} y2=${tick.y} />`,
        );
        if (tick.major) ticks.push(svg`<text class="label" x="46" y=${tick.y}>${tick.value}</text>`);
      }
      const presets = state.presets.flatMap((presetHeight, index) =>
        Number.isFinite(presetHeight)
          ? [{ index, y: scene.projectHeight(clamp(presetHeight, state.min, state.max)) }]
          : [],
      );
      for (const marker of spreadMarkers(presets, 19, top, height - 10)) {
        const presetHeight = state.presets[marker.index];
        markers.push(svg`<g
          class="preset"
          @pointerdown=${(ev: PointerEvent) => ev.stopPropagation()}
          @click=${() => state.available && this.keypad.pressPreset(marker.index + 1)}
        >
          <title>${`Memory ${marker.index + 1}: ${formatHeight(presetHeight, unit)}`}</title>
          ${Math.abs(marker.y - marker.trueY) > 1
            ? svg`<line class="leader" x1="18" y1=${marker.y} x2="24" y2=${marker.trueY} />`
            : nothing}
          <circle cx="10" cy=${marker.y} r="8.5" />
          <text x="10" y=${marker.y}>${marker.index + 1}</text>
        </g>`);
      }
    }
    const now = this._dragTarget ?? (state.available ? state.height : state.min);

    return html`<div
      class="scale"
      tabindex="0"
      role="slider"
      aria-label="Target height. Drag, or use the arrow keys and Enter."
      aria-valuemin=${toUnit(state.min, unit).toFixed(1)}
      aria-valuemax=${toUnit(state.max, unit).toFixed(1)}
      aria-valuenow=${toUnit(now, unit).toFixed(1)}
      aria-valuetext=${formatHeight(now, unit)}
      style="width: ${SCALE_WIDTH}px"
      @pointerdown=${this.onScaleDown}
      @pointermove=${this.onScaleMove}
      @pointerup=${this.onScaleUp}
      @pointercancel=${this.onScaleCancel}
      @keydown=${this.onScaleKey}
    >
      <svg width=${SCALE_WIDTH} height=${height} aria-hidden="true">
        ${ready ? svg`<line class="track" x1="62" x2="62" y1=${top} y2=${bottom} />` : nothing} ${ticks} ${markers}
        ${ready ? svg`<text class="unit" x="46" y=${bottom + 16}>${unitLabel(unit)}</text>` : nothing}
      </svg>
      <div class="marker" aria-hidden="true"></div>
    </div>`;
  }

  private renderEntry(state: DeskState, unit: Unit): TemplateResult {
    const entry = this._entry!;
    return html`<form
      class="entry"
      @submit=${this.submitEntry}
      @keydown=${(ev: KeyboardEvent) => {
        if (ev.key === 'Escape') this._entry = undefined;
      }}
    >
      <label for="desk-target">Move to</label>
      <div class="field">
        <input
          id="desk-target"
          type="number"
          inputmode="decimal"
          step="0.1"
          min=${toUnit(state.min, unit).toFixed(1)}
          max=${toUnit(state.max, unit).toFixed(1)}
          .value=${entry.value}
          @input=${(ev: Event) => (this._entry = { value: (ev.target as HTMLInputElement).value })}
        />
        <span>${unitLabel(unit)}</span>
      </div>
      <button type="submit" class="go">Go</button>
      <button type="button" class="close" aria-label="Cancel" @click=${() => (this._entry = undefined)}>×</button>
      <div class="hint ${entry.error ? 'error' : ''}">${entry.error ?? this.rangeText(state)}</div>
    </form>`;
  }

  static override styles = css`
    :host {
      display: block;
    }
    ha-card {
      overflow: hidden;
      padding-bottom: 14px;
    }
    .header {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 12px;
      padding: 14px 16px 0;
    }
    .name {
      font-size: 1.15rem;
      font-weight: 500;
      color: var(--primary-text-color);
    }
    .status {
      font-size: 0.875rem;
      color: var(--secondary-text-color);
    }
    .stage {
      position: relative;
      display: flex;
      padding: 6px 12px 0 0;
    }
    .stage.offline .gl {
      filter: grayscale(1);
      opacity: 0.55;
    }
    .viewport {
      position: relative;
      flex: 1;
      min-width: 0;
      aspect-ratio: 1.3;
      border-radius: 12px;
      background: radial-gradient(
        ellipse 70% 62% at 50% 48%,
        color-mix(in srgb, var(--primary-text-color, #000) 7%, transparent),
        transparent 72%
      );
    }
    .stage.no-scale .viewport {
      margin-left: 12px;
    }
    .gl {
      position: absolute;
      inset: 0;
    }
    .gl canvas {
      display: block;
    }
    .scale {
      position: relative;
      flex: none;
      cursor: ns-resize;
      touch-action: none;
      outline: none;
      -webkit-tap-highlight-color: transparent;
    }
    .scale:focus-visible {
      outline: 2px solid var(--primary-color);
      outline-offset: -2px;
      border-radius: 8px;
    }
    .scale svg {
      display: block;
      overflow: visible;
    }
    .track {
      stroke: var(--divider-color, rgba(127, 127, 127, 0.4));
      stroke-width: 1.5;
    }
    .tick {
      stroke: var(--secondary-text-color);
      stroke-opacity: 0.45;
      stroke-width: 1;
    }
    .tick.major {
      stroke-opacity: 0.85;
    }
    .label,
    .unit {
      fill: var(--secondary-text-color);
      font-size: 11px;
      text-anchor: end;
      dominant-baseline: central;
      font-variant-numeric: tabular-nums;
    }
    .unit {
      font-size: 10px;
      opacity: 0.8;
    }
    .preset {
      cursor: pointer;
    }
    .preset circle {
      fill: var(--card-background-color, #fff);
      stroke: var(--secondary-text-color);
      stroke-width: 1.2;
    }
    .preset:hover circle {
      stroke: var(--primary-color);
    }
    .leader {
      stroke: var(--secondary-text-color);
      stroke-opacity: 0.6;
    }
    .preset text {
      fill: var(--primary-text-color);
      font-size: 10px;
      font-weight: 600;
      text-anchor: middle;
      dominant-baseline: central;
    }
    .marker {
      position: absolute;
      top: -6px;
      left: 63px;
      width: 0;
      height: 0;
      border-top: 6px solid transparent;
      border-bottom: 6px solid transparent;
      border-left: 8px solid var(--primary-text-color);
      opacity: 0;
      pointer-events: none;
    }
    .target-pill {
      position: absolute;
      left: 4px;
      transform: translateY(-50%);
      padding: 2px 8px;
      border-radius: 999px;
      background: var(--primary-color);
      color: var(--text-primary-color, #fff);
      font-size: 12px;
      font-weight: 600;
      font-variant-numeric: tabular-nums;
      pointer-events: none;
      white-space: nowrap;
    }
    .chip {
      position: absolute;
      top: 8px;
      right: 8px;
      padding: 2px 10px;
      border-radius: 999px;
      background: color-mix(in srgb, var(--card-background-color, #fff) 80%, transparent);
      color: var(--secondary-text-color);
      font-size: 12px;
    }
    .notice,
    .setup {
      padding: 16px;
      color: var(--secondary-text-color);
      font-size: 0.9rem;
      line-height: 1.4;
    }
    .notice {
      position: absolute;
      inset: auto 0 0 0;
      text-align: center;
    }
    standing-desk-keypad {
      margin: 12px 12px 0;
    }
    .footer {
      margin-top: 10px;
      text-align: center;
      color: var(--secondary-text-color);
      font-size: 0.85rem;
    }
    .warning {
      margin: 10px 16px 0;
      color: var(--warning-color, #ffa600);
      font-size: 0.8rem;
    }
    .entry {
      position: absolute;
      left: 50%;
      top: 12px;
      transform: translateX(-50%);
      display: grid;
      grid-template-columns: auto auto auto auto;
      align-items: center;
      gap: 6px 8px;
      padding: 10px 12px;
      border-radius: 12px;
      background: var(--card-background-color, #fff);
      box-shadow: 0 4px 18px rgba(0, 0, 0, 0.25);
      color: var(--primary-text-color);
      font-size: 0.9rem;
    }
    .entry label {
      color: var(--secondary-text-color);
      white-space: nowrap;
    }
    .field {
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .entry input {
      width: 5.5em;
      padding: 6px 8px;
      border: 1px solid var(--divider-color, #ccc);
      border-radius: 8px;
      background: transparent;
      color: inherit;
      font: inherit;
      font-variant-numeric: tabular-nums;
    }
    .entry button {
      border: 0;
      border-radius: 8px;
      font: inherit;
      cursor: pointer;
    }
    .go {
      padding: 6px 14px;
      background: var(--primary-color);
      color: var(--text-primary-color, #fff);
      font-weight: 600;
    }
    .close {
      padding: 4px 8px;
      background: transparent;
      color: var(--secondary-text-color);
      font-size: 1.2rem;
      line-height: 1;
    }
    .hint {
      grid-column: 1 / -1;
      color: var(--secondary-text-color);
      font-size: 0.8rem;
    }
    .hint.error {
      color: var(--error-color, #db4437);
    }
  `;
}

function formatIdle(seconds: number): string {
  if (seconds < 60) return `Idle for ${Math.round(seconds)} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `Idle for ${minutes} min`;
  return `Idle for ${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

// --- Registration ------------------------------------------------------------------------------------

const define = (name: string, element: CustomElementConstructor) => {
  if (!customElements.get(name)) customElements.define(name, element);
};
define(KEYPAD_TYPE, StandingDeskKeypad);
define(CARD_TYPE, StandingDeskCard);
define(EDITOR_TYPE, StandingDeskCardEditor);

interface CustomCardEntry {
  type: string;
  name: string;
  description: string;
  preview?: boolean;
  documentationURL?: string;
}
const registry = window as unknown as { customCards?: CustomCardEntry[] };
registry.customCards = registry.customCards ?? [];
if (!registry.customCards.some((card) => card.type === CARD_TYPE)) {
  registry.customCards.push({
    type: CARD_TYPE,
    name: 'Standing Desk Card',
    description: 'A 3D standing desk you can raise, lower, and send to memory presets (DeskUp Pro controller).',
    preview: true,
    documentationURL: 'https://github.com/kedube/ha-standing-desk-card',
  });
}

console.info(`%c STANDING-DESK-CARD %c ${VERSION} `, 'background:#3b3b3b;color:#fff', 'background:#c99c62;color:#000');
