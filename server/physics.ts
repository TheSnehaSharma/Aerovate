/** Derived aerodynamic results computed on the server. */

/** Reynolds-number range the service evaluates; requests outside it are clamped. */
export const RE_MIN = 1e4;
export const RE_MAX = 1e8;

// Thin-airfoil fallback model (used only when NeuralFoil is unavailable).
const FALLBACK_CD0 = 0.02;
const FALLBACK_ASPECT_RATIO = 10;
const FALLBACK_OSWALD_EFFICIENCY = 0.8;
const FALLBACK_ZERO_LIFT_CUTOFF_RAD = -0.1;

export interface Coefficients {
  cl: number;
  cd: number;
  cm: number;
}

export const clampReynolds = (re: number): number => Math.min(Math.max(re, RE_MIN), RE_MAX);

/** L/D = Cl / Cd (0 when Cd is not positive). */
export const liftToDragRatio = (cl: number, cd: number): number => (cd > 0 ? cl / cd : 0);

/** Cl = 2π·α, Cd = Cd0 + Cl² / (π·AR·e), Cm = 0. */
export function thinAirfoilFallback(alphaDeg: number): Coefficients {
  const alphaRad = (alphaDeg * Math.PI) / 180;
  const cl = alphaRad > FALLBACK_ZERO_LIFT_CUTOFF_RAD ? 2 * Math.PI * alphaRad : 0;
  const cd = FALLBACK_CD0 + cl ** 2 / (Math.PI * FALLBACK_ASPECT_RATIO * FALLBACK_OSWALD_EFFICIENCY);
  return { cl, cd, cm: 0 };
}
