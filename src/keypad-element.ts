import { LitElement, css, html, nothing, svg } from 'lit';
import { CELL_HEIGHT, CELL_WIDTH, DOT, SEGMENT_NAMES, displayCells, segmentPolygon } from './seven-segment';
import type { Direction } from './keypad-controller';
import type { KeypadColor } from './types';

const PITCH = CELL_WIDTH + 1.4;

/**
 * Replica of the UPLIFT Advanced keypad: display, ▲ ▼, memory keys and M.
 * Emits `keypad-hold` ({ direction, active }) for the arrows, `keypad-key` ({ key }) for 1–4 / M,
 * and `display-click` when the display is tapped.
 */
export class StandingDeskKeypad extends LitElement {
  static override properties = {
    text: {},
    presetCount: { attribute: false },
    color: {},
    allowSave: { attribute: false },
    armed: { attribute: false },
    held: { attribute: false },
    disabled: { attribute: false },
    label: {},
  };

  declare text: string;
  declare presetCount: number;
  declare color: KeypadColor;
  declare allowSave: boolean;
  declare armed: boolean;
  declare held: Direction | null;
  declare disabled: boolean;
  declare label: string;

  private activePointer?: number;

  constructor() {
    super();
    this.text = '---';
    this.presetCount = 4;
    this.color = 'black';
    this.allowSave = true;
    this.armed = false;
    this.held = null;
    this.disabled = false;
    this.label = '';
  }

  protected override render() {
    const presets = Array.from({ length: this.presetCount }, (_, i) => i + 1);
    return html`
      <div class="pad ${this.color}" role="group" aria-label="Desk keypad">
        <button class="display" aria-label=${this.label} ?disabled=${this.disabled} @click=${this.onDisplay}>
          ${this.renderDigits()}
        </button>
        <div class="keys">
          ${this.renderArrow('up')} ${this.renderArrow('down')}
          ${presets.map(
            (n) => html`<button
              class="key"
              aria-label=${`Memory ${n}`}
              ?disabled=${this.disabled}
              @click=${() => this.emitKey(n)}
            >
              ${n}
            </button>`,
          )}
          ${this.allowSave
            ? html`<button
                class="key ${this.armed ? 'armed' : ''}"
                aria-label="Memory: save the current height to a preset"
                aria-pressed=${this.armed ? 'true' : 'false'}
                ?disabled=${this.disabled}
                @click=${() => this.emitKey('M')}
              >
                M
              </button>`
            : nothing}
        </div>
      </div>
    `;
  }

  private renderDigits() {
    const cells = displayCells(this.text);
    const width = PITCH * 3 + 1;
    return html`<svg viewBox="-0.5 -0.5 ${width} ${CELL_HEIGHT + 1}" aria-hidden="true">
      ${cells.map(
        (cell, index) => svg`<g transform="translate(${index * PITCH} 0)">
          ${SEGMENT_NAMES.map(
            (segment) => svg`<polygon
              class=${cell.lit.has(segment) ? 'on' : 'off'}
              points=${segmentPolygon(segment)
                .map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`)
                .join(' ')}
            />`,
          )}
          <rect class=${cell.dot ? 'on' : 'off'} x=${DOT[0]} y=${DOT[1]} width=${DOT[2]} height=${DOT[2]} rx="0.4" />
        </g>`,
      )}
    </svg>`;
  }

  private renderArrow(direction: Direction) {
    const path = direction === 'up' ? 'M12 19V5M6 11l6-6 6 6' : 'M12 5v14M6 13l6 6 6-6';
    return html`<button
      class="key arrow ${this.held === direction ? 'down' : ''}"
      aria-label=${direction === 'up' ? 'Raise (hold to keep moving)' : 'Lower (hold to keep moving)'}
      ?disabled=${this.disabled}
      @pointerdown=${(ev: PointerEvent) => this.onArrowDown(ev, direction)}
      @pointerup=${this.onArrowUp}
      @pointercancel=${this.onArrowUp}
      @lostpointercapture=${this.onArrowUp}
      @keydown=${(ev: KeyboardEvent) => this.onArrowKey(ev, direction, true)}
      @keyup=${(ev: KeyboardEvent) => this.onArrowKey(ev, direction, false)}
      @contextmenu=${(ev: Event) => ev.preventDefault()}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d=${path} /></svg>
    </button>`;
  }

  private onArrowDown(ev: PointerEvent, direction: Direction): void {
    if (this.disabled || ev.button > 0 || this.activePointer !== undefined) return;
    ev.preventDefault();
    this.activePointer = ev.pointerId;
    (ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId);
    this.emitHold(direction, true);
  }

  private readonly onArrowUp = (ev: PointerEvent): void => {
    if (ev.pointerId !== this.activePointer) return;
    this.activePointer = undefined;
    this.emitHold(null, false);
  };

  private onArrowKey(ev: KeyboardEvent, direction: Direction, pressed: boolean): void {
    if (ev.key !== 'Enter' && ev.key !== ' ') return;
    ev.preventDefault();
    if (pressed && ev.repeat) return;
    this.emitHold(direction, pressed);
  }

  /** Called by the card when the page is hidden mid-hold. */
  releaseAll(): void {
    if (this.activePointer === undefined) return;
    this.activePointer = undefined;
    this.emitHold(null, false);
  }

  private emitHold(direction: Direction | null, active: boolean): void {
    this.dispatchEvent(new CustomEvent('keypad-hold', { detail: { direction, active }, bubbles: true, composed: true }));
  }

  private emitKey(key: number | 'M'): void {
    this.dispatchEvent(new CustomEvent('keypad-key', { detail: { key }, bubbles: true, composed: true }));
  }

  private onDisplay(): void {
    this.dispatchEvent(new CustomEvent('display-click', { bubbles: true, composed: true }));
  }

  static override styles = css`
    :host {
      display: block;
      container-type: inline-size;
      --key-size: clamp(28px, 8.4cqi, 44px);
      --gap: clamp(4px, 1.5cqi, 9px);
    }
    .pad {
      display: flex;
      align-items: center;
      gap: calc(var(--gap) * 1.6);
      width: fit-content;
      max-width: 100%;
      box-sizing: border-box;
      margin: 0 auto;
      padding: calc(var(--key-size) * 0.26) calc(var(--key-size) * 0.55);
      border-radius: 999px;
      user-select: none;
      -webkit-user-select: none;
    }
    .pad.black {
      background: linear-gradient(180deg, #2c2c30 0%, #18181a 55%, #111113 100%);
      box-shadow:
        inset 0 1px 0 rgba(255, 255, 255, 0.14),
        inset 0 -2px 4px rgba(0, 0, 0, 0.55),
        0 3px 10px rgba(0, 0, 0, 0.28);
      --key-bg: linear-gradient(180deg, #303034, #1d1d20);
      --key-edge: #46464c;
      --key-ink: #ececef;
    }
    .pad.white {
      background: linear-gradient(180deg, #ffffff 0%, #ececea 55%, #d9d9d5 100%);
      box-shadow:
        inset 0 1px 0 #fff,
        inset 0 -2px 4px rgba(0, 0, 0, 0.12),
        0 3px 10px rgba(0, 0, 0, 0.18);
      --key-bg: linear-gradient(180deg, #ffffff, #e9e9e6);
      --key-edge: #bdbdb9;
      --key-ink: #2b2b2e;
    }
    .pad.gray {
      background: linear-gradient(180deg, #b3b6ba 0%, #8f9296 55%, #7b7e82 100%);
      box-shadow:
        inset 0 1px 0 rgba(255, 255, 255, 0.35),
        inset 0 -2px 4px rgba(0, 0, 0, 0.25),
        0 3px 10px rgba(0, 0, 0, 0.22);
      --key-bg: linear-gradient(180deg, #a6a9ad, #888b8f);
      --key-edge: #6f7276;
      --key-ink: #18181a;
    }
    button {
      font: inherit;
      margin: 0;
      -webkit-tap-highlight-color: transparent;
    }
    .display {
      flex: none;
      display: block;
      padding: calc(var(--key-size) * 0.16) calc(var(--key-size) * 0.22);
      border: 0;
      border-radius: calc(var(--key-size) * 0.16);
      background: #050506;
      box-shadow:
        inset 0 1px 3px rgba(0, 0, 0, 0.9),
        0 0 0 1px rgba(255, 255, 255, 0.07);
      cursor: pointer;
    }
    .display svg {
      display: block;
      height: calc(var(--key-size) * 0.7);
      overflow: visible;
    }
    .display .on {
      fill: #eef5ff;
      filter: drop-shadow(0 0 1.2px rgba(170, 205, 255, 0.85));
    }
    .display .off {
      fill: rgba(255, 255, 255, 0.055);
    }
    .display:disabled .on {
      fill: rgba(238, 245, 255, 0.35);
      filter: none;
    }
    .keys {
      display: flex;
      gap: var(--gap);
    }
    .key {
      flex: none;
      display: grid;
      place-items: center;
      width: var(--key-size);
      height: var(--key-size);
      padding: 0;
      border: 1px solid var(--key-edge);
      border-radius: calc(var(--key-size) * 0.2);
      background: var(--key-bg);
      color: var(--key-ink);
      font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
      font-weight: 600;
      font-size: calc(var(--key-size) * 0.4);
      line-height: 1;
      box-shadow:
        inset 0 1px 0 rgba(255, 255, 255, 0.12),
        0 1px 1px rgba(0, 0, 0, 0.35);
      cursor: pointer;
      touch-action: none;
      -webkit-touch-callout: none;
      transition:
        transform 60ms ease,
        box-shadow 60ms ease;
    }
    .key svg {
      width: 58%;
      height: 58%;
      fill: none;
      stroke: currentColor;
      stroke-width: 2.4;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    .key:active:not(:disabled),
    .key.down {
      transform: translateY(1px);
      box-shadow:
        inset 0 2px 3px rgba(0, 0, 0, 0.45),
        0 0 0 rgba(0, 0, 0, 0);
    }
    .key.armed {
      box-shadow:
        inset 0 2px 3px rgba(0, 0, 0, 0.45),
        0 0 0 2px var(--primary-color, #03a9f4);
    }
    .key:focus-visible,
    .display:focus-visible {
      outline: 2px solid var(--primary-color, #03a9f4);
      outline-offset: 2px;
    }
    .key:disabled {
      opacity: 0.45;
      cursor: default;
    }
  `;
}
