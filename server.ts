import express, { type Request, type RequestHandler, type Response } from "express";
import path from "node:path";
import {
  WorkerBusyError, closeNeuralFoil, predictBatch, predictSingle, warmUpNeuralFoil,
  type Coordinates,
} from "./server/neuralfoil.ts";
import { clampReynolds, liftToDragRatio, thinAirfoilFallback } from "./server/physics.ts";

const PORT = Number(process.env.PORT) || 10000;
const IS_PRODUCTION = process.env.NODE_ENV === "production";
const SHUTDOWN_GRACE_MS = 10_000;

const MIN_COORDINATES = 3;
const MAX_COORDINATES = 500;
const MAX_ALPHAS = 200;
const MAX_ABS_ALPHA_DEG = 90;

// ---------- Request validation ----------

class BadRequest extends Error {}

const isFiniteNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function parseCoordinates(value: unknown): Coordinates {
  const valid =
    Array.isArray(value) &&
    value.length >= MIN_COORDINATES &&
    value.length <= MAX_COORDINATES &&
    value.every((p) => Array.isArray(p) && p.length === 2 && p.every(isFiniteNumber));
  if (!valid) {
    throw new BadRequest(`coordinates must be an array of ${MIN_COORDINATES}-${MAX_COORDINATES} [x, y] number pairs`);
  }
  return value as Coordinates;
}

function parseAlpha(value: unknown): number {
  if (!isFiniteNumber(value) || Math.abs(value) > MAX_ABS_ALPHA_DEG) {
    throw new BadRequest(`alpha must be a number between -${MAX_ABS_ALPHA_DEG} and ${MAX_ABS_ALPHA_DEG} degrees`);
  }
  return value;
}

function parseAlphas(value: unknown): number[] {
  const valid =
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= MAX_ALPHAS &&
    value.every((a) => isFiniteNumber(a) && Math.abs(a) <= MAX_ABS_ALPHA_DEG);
  if (!valid) throw new BadRequest(`alphas must be 1-${MAX_ALPHAS} numbers within ±${MAX_ABS_ALPHA_DEG} degrees`);
  return value as number[];
}

function parseReynolds(value: unknown): number {
  if (!isFiniteNumber(value) || value <= 0) throw new BadRequest("Re must be a positive number");
  return clampReynolds(value);
}

// ---------- Routes ----------

const route =
  (handler: (req: Request, res: Response) => Promise<void>): RequestHandler =>
  (req, res) => {
    handler(req, res).catch((err: Error) => {
      const status = err instanceof BadRequest ? 400 : err instanceof WorkerBusyError ? 503 : 500;
      if (status === 500) console.error(`${req.method} ${req.path} failed:`, err.message);
      res.status(status).json({ message: err.message });
    });
  };

const health = route(async (_req, res) => {
  res.json({ status: "ok" });
});

const simulate = route(async (req, res) => {
  const { coordinates, alpha, Re } = req.body ?? {};
  const airfoil = parseCoordinates(coordinates);
  const alphaDeg = parseAlpha(alpha);
  const re = parseReynolds(Re);

  try {
    const { cl, cd, cm, confidence } = await predictSingle(airfoil, alphaDeg, re);
    res.json({ source: "neuralfoil", cl, cd, cm, ldRatio: liftToDragRatio(cl, cd), confidence, re });
  } catch (err) {
    if (err instanceof WorkerBusyError) throw err;
    console.warn("NeuralFoil unavailable, using thin-airfoil fallback:", (err as Error).message);
    const { cl, cd, cm } = thinAirfoilFallback(alphaDeg);
    res.json({ source: "thin_airfoil_fallback", cl, cd, cm, ldRatio: liftToDragRatio(cl, cd), confidence: null, re });
  }
});

const simulateBatch = route(async (req, res) => {
  const { coordinates, alphas, Re } = req.body ?? {};
  const results = await predictBatch(parseCoordinates(coordinates), parseAlphas(alphas), parseReynolds(Re));
  res.json({ results });
});

// ---------- Bootstrap ----------

async function main() {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "1mb" }));

  app.get("/api/health", health);
  app.post("/api/v1/simulate", simulate);
  app.post("/api/v1/simulate-batch", simulateBatch);
  app.use("/api", (_req, res) => {
    res.status(404).json({ message: "Not found" });
  });

  if (IS_PRODUCTION) {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => res.sendFile(path.join(distPath, "index.html")));
  } else {
    const { createServer } = await import("vite");
    const vite = await createServer({ server: { middlewareMode: true }, appType: "spa" });
    app.use(vite.middlewares);
  }

  const server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`Aerovate listening on http://0.0.0.0:${PORT} (${IS_PRODUCTION ? "production" : "development"})`);
    warmUpNeuralFoil();
  });

  const shutdown = () => {
    closeNeuralFoil();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), SHUTDOWN_GRACE_MS).unref();
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
