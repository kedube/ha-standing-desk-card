export type Direction = 'up' | 'down';

export interface KeypadActions {
  nudge(direction: Direction): void;
  stop(): void;
  gotoPreset(preset: number): void;
  savePreset(preset: number): void;
}

export interface KeypadOptions {
  /** How long ▲/▼ must be held before repeating starts. */
  holdDelayMs: number;
  /** Interval between nudges while held. */
  repeatMs: number;
  /** Safety cap on a single hold. */
  maxHoldMs: number;
  /** Time allowed after M to pick a preset, as on the real keypad. */
  saveWindowMs: number;
  /** How long "S-1" stays on the display after saving. */
  savedFlashMs: number;
  /** Treat the desk as under manual control for this long after a nudge. */
  manualGraceMs: number;
  allowSave: boolean;
}

export const DEFAULT_KEYPAD_OPTIONS: KeypadOptions = {
  holdDelayMs: 400,
  repeatMs: 250,
  maxHoldMs: 60_000,
  saveWindowMs: 4_000,
  savedFlashMs: 1_500,
  manualGraceMs: 1_500,
  allowSave: true,
};

/**
 * Keypad behaviour of the UPLIFT Advanced keypad, independent of rendering:
 * - ▲/▼ tap nudges; hold repeats nudges (the desk stops by itself if they stop arriving)
 *   and sends Stop on release.
 * - 1–4 recall a preset; M then 1–4 saves the current height to it ("S-" → "S-1").
 * - Any key pressed while the desk is travelling on its own stops it.
 */
export class KeypadController {
  options: KeypadOptions;
  /** Supplied by the card: true while the desk reports Raising/Lowering. */
  isDeskMoving: () => boolean = () => false;

  private holding: Direction | null = null;
  private holdStartedAt = 0;
  private repeating = false;
  private swallowRelease = false;
  private lastNudgeAt = -Infinity;
  private holdTimer?: ReturnType<typeof setTimeout>;
  private repeatTimer?: ReturnType<typeof setInterval>;
  private displayTimer?: ReturnType<typeof setTimeout>;
  private _saveArmed = false;
  private _message: string | null = null;

  constructor(
    private readonly actions: KeypadActions,
    options: Partial<KeypadOptions> = {},
    private readonly onChange: () => void = () => {},
  ) {
    this.options = { ...DEFAULT_KEYPAD_OPTIONS, ...options };
  }

  /** Text that replaces the height on the display ("S-", "S-2"), or null to show the height. */
  get message(): string | null {
    return this._message;
  }

  get saveArmed(): boolean {
    return this._saveArmed;
  }

  get heldDirection(): Direction | null {
    return this.holding;
  }

  /** True while the desk is moving because of a preset or target height, not a nudge. */
  isAutoMoving(now = Date.now()): boolean {
    return this.isDeskMoving() && this.holding === null && now - this.lastNudgeAt > this.options.manualGraceMs;
  }

  pressDirection(direction: Direction): void {
    if (this.holding) return;
    this.disarm();
    if (this.isAutoMoving()) {
      this.actions.stop();
      this.swallowRelease = true;
      return;
    }
    this.holding = direction;
    this.holdStartedAt = Date.now();
    this.nudge(direction);
    this.holdTimer = setTimeout(() => this.startRepeating(direction), this.options.holdDelayMs);
    this.onChange();
  }

  releaseDirection(): void {
    if (this.swallowRelease) {
      this.swallowRelease = false;
      return;
    }
    if (!this.holding) return;
    const wasRepeating = this.repeating;
    this.clearHold();
    if (wasRepeating) this.actions.stop();
    this.onChange();
  }

  pressPreset(preset: number): void {
    if (this._saveArmed) {
      this._saveArmed = false;
      this.actions.savePreset(preset);
      this.flash(`S-${preset}`, this.options.savedFlashMs);
      return;
    }
    if (this.isAutoMoving()) {
      this.actions.stop();
      return;
    }
    this.actions.gotoPreset(preset);
  }

  pressMemory(): void {
    if (this.isAutoMoving()) {
      this.disarm();
      this.actions.stop();
      return;
    }
    if (!this.options.allowSave) return;
    if (this._saveArmed) {
      this.disarm();
      return;
    }
    this._saveArmed = true;
    this.flash('S-', this.options.saveWindowMs, () => {
      this._saveArmed = false;
    });
  }

  dispose(): void {
    this.clearHold();
    clearTimeout(this.displayTimer);
  }

  private nudge(direction: Direction): void {
    this.lastNudgeAt = Date.now();
    this.actions.nudge(direction);
  }

  private startRepeating(direction: Direction): void {
    if (this.holding !== direction) return;
    this.repeating = true;
    this.repeatTimer = setInterval(() => {
      if (Date.now() - this.holdStartedAt >= this.options.maxHoldMs) {
        this.releaseDirection();
        return;
      }
      this.nudge(direction);
    }, this.options.repeatMs);
  }

  private clearHold(): void {
    clearTimeout(this.holdTimer);
    clearInterval(this.repeatTimer);
    this.holdTimer = undefined;
    this.repeatTimer = undefined;
    this.holding = null;
    this.repeating = false;
  }

  private disarm(): void {
    if (!this._saveArmed && this._message === null) return;
    this._saveArmed = false;
    clearTimeout(this.displayTimer);
    this._message = null;
    this.onChange();
  }

  private flash(text: string, durationMs: number, onExpire?: () => void): void {
    clearTimeout(this.displayTimer);
    this._message = text;
    this.onChange();
    this.displayTimer = setTimeout(() => {
      this._message = null;
      onExpire?.();
      this.onChange();
    }, durationMs);
  }
}
