/** Design templates and default configuration. */

export interface Geometry {
  /** Max camber, fraction of chord. */
  m: number;
  /** Max camber position, fraction of chord. */
  p: number;
  /** Max thickness, fraction of chord. */
  t: number;
  /** Chord length, m. */
  chord: number;
  /** Wing span, m. */
  span: number;
}

export interface Flight {
  /** Angle of attack, degrees. */
  alpha: number;
  /** Free-stream velocity, m/s. */
  velocity: number;
  /** Kinematic viscosity, m²/s. */
  viscosity: number;
}

export interface GeometryPreset {
  label: string;
  values: Pick<Geometry, "m" | "p" | "t">;
}

export interface FlightPreset {
  label: string;
  values: Flight;
}

/** NACA 4-digit approximations of well-known sections (the generator only supports 4-digit shapes). */
export const GEOMETRY_PRESETS: Record<string, GeometryPreset> = {
  naca64415: { label: "NACA 64-415 (approx.)", values: { m: 0.022, p: 0.4, t: 0.15 } },
  b737a: { label: "Boeing 737 Root (approx.)", values: { m: 0.02, p: 0.35, t: 0.154 } },
  dae11: { label: "DAE-11 HALE Drone (approx.)", values: { m: 0.055, p: 0.42, t: 0.093 } },
  supercritical: { label: "Whitcomb Supercritical (approx.)", values: { m: 0.03, p: 0.7, t: 0.14 } },
};

export const FLIGHT_PRESETS: Record<string, FlightPreset> = {
  transonic: { label: "Transonic Cruise", values: { velocity: 250, alpha: 2, viscosity: 1.46e-5 } },
  stol: { label: "STOL Utility", values: { velocity: 35, alpha: 12, viscosity: 1.46e-5 } },
  mars: { label: "Mars Flight (Ingenuity)", values: { velocity: 50, alpha: 4, viscosity: 6.5e-4 } },
};

export const DEFAULT_GEOMETRY_PRESET = "naca64415";
export const DEFAULT_FLIGHT_PRESET = "stol";
export const DEFAULT_CHORD = 1.0;
export const DEFAULT_SPAN = 3.0;

/** Angles of attack (degrees) swept for the polar plots. */
export const POLAR_ALPHAS = [-20, -15, -10, -5, 0, 5, 10, 15, 20, 25];
