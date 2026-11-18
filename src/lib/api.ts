/** Typed client for the Aerovate backend. */

export type Coordinates = [number, number][];
export type RequestStatus = "loading" | "ready" | "error";
export type PredictionSource = "neuralfoil" | "thin_airfoil_fallback";

export interface PolarPoint {
  alpha: number;
  cl: number;
  cd: number;
  cm: number;
}

export interface SimulationResult {
  source: PredictionSource;
  cl: number;
  cd: number;
  cm: number;
  ldRatio: number;
  /** NeuralFoil's own 0-1 confidence; null when the fallback model produced the result. */
  confidence: number | null;
  /** Reynolds number actually used (the server clamps to its supported range). */
  re: number;
}

async function post<T>(url: string, body: unknown, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.message ?? `Request failed (${response.status})`);
  return data as T;
}

export function simulate(
  request: { coordinates: Coordinates; alpha: number; Re: number },
  signal: AbortSignal,
): Promise<SimulationResult> {
  return post<SimulationResult>("/api/v1/simulate", request, signal);
}

export async function simulateBatch(
  request: { coordinates: Coordinates; alphas: number[]; Re: number },
  signal: AbortSignal,
): Promise<PolarPoint[]> {
  const data = await post<{ results: PolarPoint[] }>("/api/v1/simulate-batch", request, signal);
  return [...data.results].sort((a, b) => a.alpha - b.alpha);
}
