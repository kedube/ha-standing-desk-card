import { describe, expect, it } from 'vitest';
import { nextVersion } from '../scripts/next-version';

describe('release numbering', () => {
  it('starts at 0.01', () => {
    expect(nextVersion([])).toBe('0.01');
  });

  it('counts up in hundredths', () => {
    expect(nextVersion(['0.01'])).toBe('0.02');
    expect(nextVersion(['0.09'])).toBe('0.10');
    expect(nextVersion(['0.41', '0.42'])).toBe('0.43');
  });

  it('rolls 0.99 over to 1.00, and so on', () => {
    expect(nextVersion(['0.99'])).toBe('1.00');
    expect(nextVersion(['1.00'])).toBe('1.01');
    expect(nextVersion(['1.99'])).toBe('2.00');
  });

  it('compares numerically, not as text', () => {
    expect(nextVersion(['0.98', '1.00', '0.99'])).toBe('1.01');
    expect(nextVersion(['9.99', '10.00'])).toBe('10.01');
  });

  it('ignores tags in other formats', () => {
    expect(nextVersion(['v5.00', '0.1.0', '2.5', 'latest', '0.03'])).toBe('0.04');
  });
});
