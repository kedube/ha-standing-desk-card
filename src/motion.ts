import { CM_PER_IN } from './units';

/** UPLIFT V2 travel speed from its spec sheet: 1.57 in/s. */
export const DESK_SPEED_CM_S = 1.57 * CM_PER_IN;

export interface FollowOptions {
  /** Speed used for small gaps, slightly above the desk's own so the render never lags far behind. */
  speed: number;
  /** For large gaps (late updates, first paint after a pause) close this fraction of the gap per second. */
  catchUp: number;
}

export const DEFAULT_FOLLOW: FollowOptions = { speed: DESK_SPEED_CM_S * 1.1, catchUp: 3 };

/**
 * Moves the displayed height toward the last reported height. Home Assistant reports
 * the desk every few hundred milliseconds while it moves; following at the desk's real
 * speed turns those steps into continuous motion.
 */
export function followHeight(current: number, target: number, dt: number, options: FollowOptions = DEFAULT_FOLLOW): number {
  const gap = target - current;
  const distance = Math.abs(gap);
  if (distance < 0.01 || dt <= 0) return distance < 0.01 ? target : current;
  const speed = Math.max(options.speed, distance * options.catchUp);
  return current + Math.sign(gap) * Math.min(distance, speed * dt);
}
