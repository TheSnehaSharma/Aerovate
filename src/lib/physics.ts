/** Geometry generation and derived aerodynamic quantities. */
import type { Coordinates, PolarPoint } from "./api.ts";

/** ISA sea-level air density, kg/m³ (the app assumes sea-level air everywhere). */
export const AIR_DENSITY = 1.225;
/** Speed of sound at ISA sea level, m/s. */
export const SPEED_OF_SOUND = 340.29;

export interface AirfoilPoint {
  x: number;
  xu: number;
  yu: number;
  xl: number;
  yl: number;
  yc: number;
  yt: number;
}

/** NACA 4-digit airfoil with cosine point spacing (numPoints + 1 stations). */
export function generateNACA(m: number, p: number, t: number, numPoints = 80): AirfoilPoint[] {
  const points: AirfoilPoint[] = [];
  for (let i = 0; i <= numPoints; i++) {
    const x = 0.5 * (1 - Math.cos((i / numPoints) * Math.PI));
    const yt = 5 * t * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x ** 2 + 0.2843 * x ** 3 - 0.1015 * x ** 4);

    let yc = 0;
    let dycDx = 0;
    if (p > 0) {
      if (x <= p) {
        yc = (m / p ** 2) * (2 * p * x - x * x);
        dycDx = ((2 * m) / p ** 2) * (p - x);
      } else {
        yc = (m / (1 - p) ** 2) * (1 - 2 * p + 2 * p * x - x * x);
        dycDx = ((2 * m) / (1 - p) ** 2) * (p - x);
      }
    }

    const theta = Math.atan(dycDx);
    points.push({
      x,
      xu: x - yt * Math.sin(theta),
      yu: yc + yt * Math.cos(theta),
      xl: x + yt * Math.sin(theta),
      yl: yc - yt * Math.cos(theta),
      yc,
      yt,
    });
  }
  return points;
}

/** Selig-ordered outline for the API: upper surface trailing edge → leading edge, then lower surface. */
export function toApiCoordinates(points: AirfoilPoint[]): Coordinates {
  const upper = [...points].reverse().map((pt): [number, number] => [pt.xu, pt.yu]);
  const lower = points.slice(1).map((pt): [number, number] => [pt.xl, pt.yl]);
  return [...upper, ...lower];
}

/** Re = V·c / ν */
export const reynoldsNumber = (velocity: number, chord: number, kinematicViscosity: number) =>
  (velocity * chord) / kinematicViscosity;

export const machNumber = (velocity: number) => velocity / SPEED_OF_SOUND;

/** q = ½ρV², L = q·S·Cl, D = q·S·Cd, with S = chord × span. */
export function aerodynamicForces(velocity: number, chord: number, span: number, cl: number, cd: number) {
  const dynamicPressure = 0.5 * AIR_DENSITY * velocity ** 2;
  const area = chord * span;
  return { dynamicPressure, lift: dynamicPressure * area * cl, drag: dynamicPressure * area * cd };
}

const liftToDrag = (pt: PolarPoint) => (pt.cd > 0 ? pt.cl / pt.cd : 0);

/** Stall = point of maximum Cl; best L/D = point of maximum Cl/Cd. */
export function analyzePolar(polar: PolarPoint[]) {
  let stall: PolarPoint | null = null;
  let bestLD: { point: PolarPoint; ratio: number } | null = null;
  for (const point of polar) {
    if (!stall || point.cl > stall.cl) stall = point;
    const ratio = liftToDrag(point);
    if (!bestLD || ratio > bestLD.ratio) bestLD = { point, ratio };
  }
  return { stall, bestLD };
}
