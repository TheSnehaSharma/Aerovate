import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { aerodynamicForces, analyzePolar, generateNACA, machNumber, reynoldsNumber, toApiCoordinates } from "./physics.ts";

const close = (a: number, b: number, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} !≈ ${b}`);

describe("generateNACA", () => {
  const naca0012 = generateNACA(0, 0.4, 0.12);

  it("produces numPoints + 1 stations from leading to trailing edge", () => {
    assert.equal(naca0012.length, 81);
    close(naca0012[0].x, 0);
    close(naca0012[80].x, 1);
  });
  it("is symmetric with no camber for m = 0", () => {
    for (const pt of naca0012) {
      close(pt.yc, 0);
      close(pt.yu, -pt.yl);
    }
  });
  it("reaches the requested maximum thickness (NACA 0012 → 12 %)", () => {
    const maxThickness = Math.max(...naca0012.map((pt) => pt.yu - pt.yl));
    close(maxThickness, 0.12, 1e-3);
  });
  it("places maximum camber at the requested position", () => {
    const cambered = generateNACA(0.04, 0.4, 0.12);
    const peak = cambered.reduce((best, pt) => (pt.yc > best.yc ? pt : best));
    close(peak.yc, 0.04, 1e-3);
    close(peak.x, 0.4, 0.02);
  });
});

describe("toApiCoordinates", () => {
  const coords = toApiCoordinates(generateNACA(0.02, 0.4, 0.12));
  it("returns 2n + 1 points starting and ending at the trailing edge", () => {
    assert.equal(coords.length, 161);
    close(coords[0][0], 1, 1e-3);
    close(coords[160][0], 1, 1e-3);
  });
  it("passes through the leading edge in the middle", () => close(coords[80][0], 0));
});

describe("flow quantities", () => {
  it("computes Reynolds and Mach numbers", () => {
    close(reynoldsNumber(30, 1, 1.5e-5), 2e6);
    close(machNumber(340.29), 1);
  });
  it("computes forces from q = ½ρV²", () => {
    const { dynamicPressure, lift, drag } = aerodynamicForces(20, 2, 3, 0.5, 0.02);
    close(dynamicPressure, 0.5 * 1.225 * 400);
    close(lift, dynamicPressure * 6 * 0.5);
    close(drag, dynamicPressure * 6 * 0.02);
  });
});

describe("analyzePolar", () => {
  const polar = [
    { alpha: 0, cl: 0.2, cd: 0.01, cm: 0 },
    { alpha: 5, cl: 0.8, cd: 0.012, cm: 0 },
    { alpha: 10, cl: 1.2, cd: 0.03, cm: 0 },
    { alpha: 15, cl: 1.0, cd: 0.1, cm: 0 },
  ];
  it("finds stall at max Cl and best L/D", () => {
    const { stall, bestLD } = analyzePolar(polar);
    assert.equal(stall?.alpha, 10);
    assert.equal(bestLD?.point.alpha, 5);
  });
  it("returns nulls for an empty polar", () => {
    assert.deepEqual(analyzePolar([]), { stall: null, bestLD: null });
  });
});
