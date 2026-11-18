import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import { Menu } from "lucide-react";
import BottomPanel from "./components/BottomPanel.tsx";
import ErrorBoundary from "./components/ErrorBoundary.tsx";
import ProfileEditor from "./components/ProfileEditor.tsx";
import Sidebar from "./components/Sidebar.tsx";
import {
  simulate, simulateBatch,
  type PolarPoint, type RequestStatus, type SimulationResult,
} from "./lib/api.ts";
import { generateNACA, reynoldsNumber, toApiCoordinates } from "./lib/physics.ts";
import {
  DEFAULT_CHORD, DEFAULT_FLIGHT_PRESET, DEFAULT_GEOMETRY_PRESET, DEFAULT_SPAN,
  FLIGHT_PRESETS, GEOMETRY_PRESETS, POLAR_ALPHAS,
  type Flight, type Geometry,
} from "./lib/presets.ts";

// Three.js is large; load it only once the workspace is opened.
const Scene3D = lazy(() => import("./components/Scene3D.tsx"));

const DEBOUNCE_MS = 400;
const DESKTOP_BREAKPOINT_PX = 1024;
/** Below this NeuralFoil confidence the prediction is flagged as unreliable. */
const LOW_CONFIDENCE = 0.5;

const EMPTY_RESULT: SimulationResult = {
  source: "neuralfoil", cl: 0, cd: 0, cm: 0, ldRatio: 0, confidence: null, re: 0,
};

function Hero({ onLaunch }: { onLaunch: () => void }) {
  return (
    <div className="fixed inset-0 z-[100] bg-black bg-[radial-gradient(ellipse_at_50%_30%,rgba(34,211,238,0.18),transparent_60%)] text-white font-sans overflow-hidden flex flex-col items-center justify-center p-6 text-center">
      <div className="relative z-20 flex flex-col items-center max-w-4xl">
        <motion.h1
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          className="text-5xl md:text-7xl lg:text-[7rem] font-bold tracking-tight mb-4 text-white"
        >
          AEROVATE
        </motion.h1>
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3, duration: 0.8 }}
          className="text-zinc-300 font-medium tracking-widest text-sm md:text-lg uppercase mb-6"
        >
          Aerodynamic Prototyping Laboratory
        </motion.p>
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5, duration: 0.8 }}
          className="max-w-2xl text-zinc-400 text-sm md:text-base leading-relaxed mb-10"
        >
          Sculpt NACA 4-digit airfoils, predict their lift, drag and moment with NeuralFoil, and explore the flow in
          real time.
        </motion.p>
        <motion.button
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.7, duration: 0.5 }}
          onClick={onLaunch}
          className="px-8 py-3 bg-white text-black font-semibold tracking-wide text-sm rounded-full transition-all duration-300 hover:scale-105 hover:bg-zinc-200 cursor-pointer shadow-[0_0_20px_rgba(255,255,255,0.2)]"
        >
          Initialize Workspace
        </motion.button>
      </div>
    </div>
  );
}

function statusChip(status: RequestStatus, source: SimulationResult["source"]) {
  if (status === "error") return { dot: "bg-red-500", label: "PREDICTION FAILED" };
  if (status === "loading") return { dot: "bg-amber-500 animate-pulse", label: "PREDICTING..." };
  if (source === "thin_airfoil_fallback") return { dot: "bg-amber-500", label: "FALLBACK MODEL (NO ML)" };
  return { dot: "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]", label: "PREDICTION ACTIVE" };
}

export default function App() {
  const [showHero, setShowHero] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth >= DESKTOP_BREAKPOINT_PX);

  const [geoPreset, setGeoPreset] = useState(DEFAULT_GEOMETRY_PRESET);
  const [flightPreset, setFlightPreset] = useState(DEFAULT_FLIGHT_PRESET);
  const [geo, setGeo] = useState<Geometry>({
    ...GEOMETRY_PRESETS[DEFAULT_GEOMETRY_PRESET].values,
    chord: DEFAULT_CHORD,
    span: DEFAULT_SPAN,
  });
  const [flight, setFlight] = useState<Flight>({ ...FLIGHT_PRESETS[DEFAULT_FLIGHT_PRESET].values });

  const [result, setResult] = useState<SimulationResult>(EMPTY_RESULT);
  const [status, setStatus] = useState<RequestStatus>("loading");
  const [polar, setPolar] = useState<PolarPoint[]>([]);
  const [polarStatus, setPolarStatus] = useState<RequestStatus>("loading");

  const points = useMemo(() => generateNACA(geo.m, geo.p, geo.t), [geo.m, geo.p, geo.t]);
  const coordinates = useMemo(() => toApiCoordinates(points), [points]);
  const re = reynoldsNumber(flight.velocity, geo.chord, flight.viscosity);

  const updateGeo = (patch: Partial<Geometry>) => {
    setGeo((g) => ({ ...g, ...patch }));
    if (patch.m !== undefined || patch.p !== undefined || patch.t !== undefined) setGeoPreset("");
  };
  const updateFlight = (patch: Partial<Flight>) => {
    setFlight((f) => ({ ...f, ...patch }));
    setFlightPreset("");
  };
  const applyGeoPreset = (key: string) => {
    setGeoPreset(key);
    const preset = GEOMETRY_PRESETS[key];
    if (preset) setGeo((g) => ({ ...g, ...preset.values }));
  };
  const applyFlightPreset = (key: string) => {
    setFlightPreset(key);
    const preset = FLIGHT_PRESETS[key];
    if (preset) setFlight(preset.values);
  };

  // Operating-point prediction: re-run (debounced) when geometry, alpha or Reynolds number change.
  useEffect(() => {
    const controller = new AbortController();
    setStatus("loading");
    const timer = setTimeout(async () => {
      try {
        setResult(await simulate({ coordinates, alpha: flight.alpha, Re: re }, controller.signal));
        setStatus("ready");
      } catch (err) {
        if (controller.signal.aborted) return;
        console.error("Simulation failed:", err);
        setStatus("error");
      }
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [coordinates, flight.alpha, re]);

  // Polar sweep: independent of alpha, so only geometry and Reynolds number retrigger it.
  useEffect(() => {
    const controller = new AbortController();
    setPolarStatus("loading");
    const timer = setTimeout(async () => {
      setPolar([]);
      try {
        setPolar(await simulateBatch({ coordinates, alphas: POLAR_ALPHAS, Re: re }, controller.signal));
        setPolarStatus("ready");
      } catch (err) {
        if (controller.signal.aborted) return;
        console.warn("Polar sweep failed:", err);
        setPolarStatus("error");
      }
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [coordinates, re]);

  if (showHero) return <Hero onLaunch={() => setShowHero(false)} />;

  const chip = statusChip(status, result.source);
  const confidence = status === "ready" ? result.confidence : null;
  const lowConfidence = confidence !== null && confidence < LOW_CONFIDENCE;
  const confidenceTone =
    confidence === null
      ? { box: "border-zinc-800", label: "text-zinc-500", value: "text-zinc-500" }
      : lowConfidence
        ? { box: "border-red-900/80 shadow-red-900/20", label: "text-red-500", value: "text-red-400" }
        : { box: "border-green-900/50 shadow-green-900/10", label: "text-green-500", value: "text-green-400" };
  const confidenceText =
    confidence !== null ? `${(confidence * 100).toFixed(1)}%` : status === "ready" ? "N/A" : "—";

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-300 font-sans selection:bg-blue-900 overflow-hidden flex flex-col lg:flex-row">
      {!sidebarOpen && (
        <button
          onClick={() => setSidebarOpen(true)}
          aria-label="Open sidebar"
          className="absolute top-6 left-6 z-40 bg-zinc-900/90 p-2 rounded-full border border-zinc-800 text-zinc-400 hover:text-blue-400 transition-colors shadow-2xl"
        >
          <Menu size={20} />
        </button>
      )}

      <Sidebar
        open={sidebarOpen}
        geo={geo}
        flight={flight}
        geoPreset={geoPreset}
        flightPreset={flightPreset}
        onGeoPreset={applyGeoPreset}
        onFlightPreset={applyFlightPreset}
        onGeoChange={updateGeo}
        onFlightChange={updateFlight}
        onHome={() => setShowHero(true)}
        onClose={() => setSidebarOpen(false)}
      />

      <div className="flex-1 flex flex-col relative w-full h-full lg:h-screen overflow-hidden">
        <div className="p-4 sm:p-6 flex justify-between items-start pointer-events-none z-10 w-full relative shrink-0">
          <div className="pointer-events-auto ml-10 lg:ml-0" role="status" aria-live="polite">
            <div className="flex items-center gap-2 bg-zinc-950/80 backdrop-blur border border-zinc-800 px-3 py-1.5 rounded-full">
              <span className={`inline-block w-2 h-2 rounded-full ${chip.dot}`} />
              <span className="text-[10px] sm:text-xs uppercase tracking-widest text-zinc-400 font-mono">{chip.label}</span>
            </div>
          </div>
          <div
            className={`pointer-events-auto px-3 py-1.5 rounded-full border bg-zinc-950/80 backdrop-blur flex items-center gap-2 shadow-sm ${confidenceTone.box}`}
          >
            <span className={`text-[9px] uppercase tracking-widest font-bold ${confidenceTone.label}`}>ML Confidence</span>
            <span className={`text-xs font-mono ${confidenceTone.value}`}>
              {confidenceText}
            </span>
          </div>
        </div>

        <div className="flex-1 w-full relative flex flex-col z-0 lg:-mt-16 min-h-[50vh]">
          <div
            className="absolute inset-0 z-0 opacity-[0.03] pointer-events-none"
            style={{
              backgroundImage:
                "linear-gradient(#0F2836 1px, transparent 1px), linear-gradient(90deg, #0F2836 1px, transparent 1px)",
              backgroundSize: "40px 40px",
              backgroundPosition: "center",
            }}
          />
          <div className="w-full h-full relative z-10">
            <div className="absolute inset-0 z-0">
              <ErrorBoundary
                fallback={
                  <div className="w-full h-full flex items-center justify-center text-sm text-zinc-500 font-mono">
                    3D view unavailable on this device
                  </div>
                }
              >
                <Suspense fallback={null}>
                  <Scene3D
                    points={points}
                    alpha={flight.alpha}
                    cl={result.cl}
                    chord={geo.chord}
                    span={geo.span}
                    velocity={flight.velocity}
                  />
                </Suspense>
              </ErrorBoundary>
            </div>
            <ProfileEditor points={points} alpha={flight.alpha} onChange={updateGeo} />
          </div>
        </div>

        <BottomPanel
          result={result}
          loading={status === "loading"}
          lowConfidence={lowConfidence}
          polar={polar}
          polarStatus={polarStatus}
          alpha={flight.alpha}
          velocity={flight.velocity}
          chord={geo.chord}
          span={geo.span}
        />
      </div>
    </div>
  );
}
