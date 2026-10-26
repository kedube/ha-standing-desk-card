import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KeypadController } from '../src/keypad-controller';
import type { KeypadActions } from '../src/keypad-controller';

function setup(options = {}) {
  const calls: string[] = [];
  const actions: KeypadActions = {
    nudge: (direction) => calls.push(`nudge:${direction}`),
    stop: () => calls.push('stop'),
    gotoPreset: (preset) => calls.push(`goto:${preset}`),
    savePreset: (preset) => calls.push(`save:${preset}`),
  };
  const keypad = new KeypadController(actions, options);
  return { keypad, calls };
}

describe('keypad', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-26T12:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('nudges once on a tap and sends nothing on release', () => {
    const { keypad, calls } = setup();
    keypad.pressDirection('up');
    vi.advanceTimersByTime(100);
    keypad.releaseDirection();
    vi.advanceTimersByTime(2000);
    expect(calls).toEqual(['nudge:up']);
  });

  it('repeats nudges while held and stops on release', () => {
    const { keypad, calls } = setup({ holdDelayMs: 400, repeatMs: 250 });
    keypad.pressDirection('down');
    vi.advanceTimersByTime(400 + 250 * 3);
    keypad.releaseDirection();
    vi.advanceTimersByTime(2000);
    expect(calls).toEqual(['nudge:down', 'nudge:down', 'nudge:down', 'nudge:down', 'stop']);
  });

  it('caps a single hold', () => {
    const { keypad, calls } = setup({ holdDelayMs: 0, repeatMs: 100, maxHoldMs: 1000 });
    keypad.pressDirection('up');
    vi.advanceTimersByTime(5000);
    expect(calls.filter((c) => c === 'nudge:up').length).toBeLessThanOrEqual(11);
    expect(calls.at(-1)).toBe('stop');
    expect(keypad.heldDirection).toBeNull();
  });

  it('recalls presets', () => {
    const { keypad, calls } = setup();
    keypad.pressPreset(2);
    expect(calls).toEqual(['goto:2']);
  });

  it('saves with M then a number, and shows S- then S-n', () => {
    const { keypad, calls } = setup();
    keypad.pressMemory();
    expect(keypad.saveArmed).toBe(true);
    expect(keypad.message).toBe('S-');
    keypad.pressPreset(3);
    expect(calls).toEqual(['save:3']);
    expect(keypad.message).toBe('S-3');
    expect(keypad.saveArmed).toBe(false);
    vi.advanceTimersByTime(1600);
    expect(keypad.message).toBeNull();
  });

  it('forgets M after the save window', () => {
    const { keypad, calls } = setup({ saveWindowMs: 4000 });
    keypad.pressMemory();
    vi.advanceTimersByTime(4100);
    keypad.pressPreset(1);
    expect(calls).toEqual(['goto:1']);
  });

  it('ignores M when saving is turned off', () => {
    const { keypad, calls } = setup({ allowSave: false });
    keypad.pressMemory();
    keypad.pressPreset(1);
    expect(keypad.saveArmed).toBe(false);
    expect(calls).toEqual(['goto:1']);
  });

  it('stops a desk travelling on its own when any key is pressed', () => {
    const { keypad, calls } = setup();
    keypad.isDeskMoving = () => true;
    keypad.pressPreset(1);
    keypad.pressMemory();
    keypad.pressDirection('up');
    keypad.releaseDirection();
    expect(calls).toEqual(['stop', 'stop', 'stop']);
  });

  it('treats motion right after a nudge as manual, so a second tap still nudges', () => {
    const { keypad, calls } = setup();
    keypad.pressDirection('up');
    keypad.releaseDirection();
    keypad.isDeskMoving = () => true;
    vi.advanceTimersByTime(300);
    keypad.pressDirection('up');
    keypad.releaseDirection();
    expect(calls).toEqual(['nudge:up', 'nudge:up']);
    vi.advanceTimersByTime(2000);
    keypad.pressPreset(2);
    expect(calls.at(-1)).toBe('stop');
  });
});
