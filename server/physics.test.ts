import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { RE_MAX, RE_MIN, clampReynolds, liftToDragRatio, thinAirfoilFallback } from "./physics.ts";

describe("clampReynolds", () => {
  it("keeps in-range values", () => assert.equal(clampReynolds(1e6), 1e6));
  it("clamps low and high values", () => {
    assert.equal(clampReynolds(10), RE_MIN);
    assert.equal(clampReynolds(1e12), RE_MAX);
  });
});

describe("liftToDragRatio", () => {
  it("divides Cl by Cd", () => assert.equal(liftToDragRatio(1, 0.02), 50));
  it("returns 0 for non-positive Cd", () => assert.equal(liftToDragRatio(1, 0), 0));
});

describe("thinAirfoilFallback", () => {
  it("gives zero lift and base drag at alpha = 0", () => {
    const { cl, cd, cm } = thinAirfoilFallback(0);
    assert.equal(cl, 0);
    assert.equal(cd, 0.02);
    assert.equal(cm, 0);
  });
  it("gives Cl ≈ 2π·α for positive alpha", () => {
    assert.ok(Math.abs(thinAirfoilFallback(5).cl - 2 * Math.PI * (5 * Math.PI) / 180) < 1e-12);
  });
  it("floors Cl at 0 for strongly negative alpha", () => assert.equal(thinAirfoilFallback(-10).cl, 0));
});
