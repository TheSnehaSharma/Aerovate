/** Bridge to the long-lived Python NeuralFoil worker (api/neuralfoil_service.py). */
import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import path from "node:path";

export type Coordinates = [number, number][];

export interface SinglePrediction {
  cl: number;
  cd: number;
  cm: number;
  confidence: number;
}

export interface PolarPoint {
  alpha: number;
  cl: number;
  cd: number;
  cm: number;
}

/** Raised when too many requests are already waiting for the (single) worker. */
export class WorkerBusyError extends Error {
  constructor() {
    super("Prediction service is busy; try again shortly");
  }
}

const SCRIPT_PATH = path.join(process.cwd(), "api", "neuralfoil_service.py");
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_PENDING_REQUESTS = 50;

interface Pending {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

class NeuralFoilWorker {
  private proc: ChildProcess | null = null;
  private pending = new Map<number, Pending>();
  private nextId = 1;

  call<T>(request: Record<string, unknown>): Promise<T> {
    if (this.pending.size >= MAX_PENDING_REQUESTS) return Promise.reject(new WorkerBusyError());
    const proc = this.proc ?? this.start();
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(
        () => this.shutdown(proc, new Error("NeuralFoil request timed out")),
        REQUEST_TIMEOUT_MS,
      );
      this.pending.set(id, { resolve, reject, timer });
      proc.stdin!.write(JSON.stringify({ id, ...request }) + "\n");
    });
  }

  /** Spawn the worker now so the slow NeuralFoil import happens before the first request. */
  warmUp(): void {
    if (!this.proc) this.start();
  }

  close(): void {
    if (this.proc) this.shutdown(this.proc, new Error("Server shutting down"));
  }

  private start(): ChildProcess {
    const proc = spawn("python3", [SCRIPT_PATH], { stdio: ["pipe", "pipe", "inherit"] });
    createInterface({ input: proc.stdout! }).on("line", (line) => this.onLine(line));
    proc.on("error", (err) => this.shutdown(proc, err));
    proc.on("exit", (code) => this.shutdown(proc, new Error(`NeuralFoil worker exited (code ${code})`)));
    proc.stdin!.on("error", (err) => this.shutdown(proc, err));
    this.proc = proc;
    return proc;
  }

  private onLine(line: string): void {
    let message: { id: number; result?: unknown; error?: string };
    try {
      message = JSON.parse(line);
    } catch {
      console.error("NeuralFoil worker sent malformed output:", line);
      return;
    }
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    clearTimeout(pending.timer);
    if (message.error) pending.reject(new Error(message.error));
    else pending.resolve(message.result);
  }

  /** Fail all in-flight requests and discard the worker; the next call spawns a fresh one. */
  private shutdown(proc: ChildProcess, reason: Error): void {
    if (this.proc !== proc) return;
    this.proc = null;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(reason);
    }
    this.pending.clear();
    proc.kill();
  }
}

const worker = new NeuralFoilWorker();

export const warmUpNeuralFoil = () => worker.warmUp();
export const closeNeuralFoil = () => worker.close();

export function predictSingle(coordinates: Coordinates, alpha: number, Re: number): Promise<SinglePrediction> {
  return worker.call<SinglePrediction>({ op: "single", coordinates, alpha, Re });
}

export function predictBatch(coordinates: Coordinates, alphas: number[], Re: number): Promise<PolarPoint[]> {
  return worker.call<PolarPoint[]>({ op: "batch", coordinates, alphas, Re });
}
