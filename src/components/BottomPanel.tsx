import { useState, type ReactElement, type ReactNode } from "react";
import { BarChart3, Minimize2 } from "lucide-react";
import {
  CartesianGrid, Line, LineChart, ReferenceArea, ReferenceDot,
  ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis,
} from "recharts";
import type { PolarPoint, RequestStatus, SimulationResult } from "../lib/api.ts";
import { aerodynamicForces, analyzePolar } from "../lib/physics.ts";

type Tab = "performance" | "forces" | "polars";
const TABS: { id: Tab; label: string }[] = [
  { id: "performance", label: "Performance" },
  { id: "forces", label: "Forces" },
  { id: "polars", label: "Polars" },
];

const formatForce = (newtons: number) =>
  Math.abs(newtons) >= 1000 ? `${(newtons / 1000).toFixed(1)}kN` : `${newtons.toFixed(0)}N`;

// ---------- Stat card ----------

interface StatProps {
  label: string;
  value: string;
  unit?: string;
  valueClass: string;
  labelClass?: string;
  borderClass?: string;
  glowClass?: string;
  className?: string;
}

function Stat({
  label, value, unit, valueClass, labelClass = "text-zinc-500",
  borderClass = "border-zinc-800 hover:border-zinc-700", glowClass, className = "",
}: StatProps) {
  return (
    <div className={`bg-[#010609] p-2 sm:p-3 rounded border flex flex-col transition-colors relative overflow-hidden ${borderClass} ${className}`}>
      {glowClass && <div className={`absolute top-0 right-0 w-8 h-8 rounded-full blur-xl ${glowClass}`} />}
      <span className={`text-[9px] uppercase mb-1 tracking-widest font-bold ${labelClass}`}>{label}</span>
      <span className={`text-xl sm:text-2xl font-mono tabular-nums ${valueClass}`}>
        {value}
        {unit && <span className="text-[9px] text-zinc-600 font-sans"> {unit}</span>}
      </span>
    </div>
  );
}

// ---------- Polar charts ----------

const axisProps = {
  type: "number" as const,
  tick: { fontSize: 8, fill: "#52525b" },
  tickLine: false,
  axisLine: false,
  domain: ["auto", "auto"] as [string, string],
};
const chartMargin = { top: 15, right: 10, bottom: 5, left: -25 };
const tooltipProps = {
  contentStyle: { backgroundColor: "#18181b", border: "1px solid #27272a", fontSize: "9px" },
  cursor: { strokeDasharray: "3 3" },
};

interface ChartCardProps {
  title: string;
  badge?: ReactNode;
  emptyMessage: string | null;
  children: ReactElement;
}

function ChartCard({ title, badge, emptyMessage, children }: ChartCardProps) {
  return (
    <div className="flex flex-col bg-zinc-900 rounded p-1.5 sm:p-2 border border-zinc-800 relative w-full h-[140px] sm:h-[180px]">
      <div className="flex justify-between items-center mb-1 px-1 sm:px-2 shrink-0">
        <span className="text-[8px] sm:text-[10px] uppercase text-zinc-500 tracking-widest font-bold">{title}</span>
        {badge}
      </div>
      <div className="w-full flex-1 relative min-h-0">
        {emptyMessage === null ? (
          <ResponsiveContainer width="100%" height="100%">
            {children}
          </ResponsiveContainer>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-zinc-600 font-mono">
            {emptyMessage}
          </div>
        )}
      </div>
    </div>
  );
}

interface PolarChartsProps {
  polar: PolarPoint[];
  status: RequestStatus;
  alpha: number;
  current: SimulationResult;
}

function PolarCharts({ polar, status, alpha, current }: PolarChartsProps) {
  const { stall, bestLD } = analyzePolar(polar);
  const emptyMessage = polar.length > 0 ? null : status === "error" ? "Polar unavailable" : "Sweeping alphas...";
  return (
    <div className="grid grid-cols-2 gap-2 sm:gap-4 min-h-[140px] sm:h-[180px]">
      <ChartCard
        title="Lift Polar (Cl vs α)"
        emptyMessage={emptyMessage}
        badge={stall && <span className="text-[7px] sm:text-[9px] text-red-400 font-mono">Stall α ≈ {stall.alpha}°</span>}
      >
        <LineChart margin={chartMargin} data={polar}>
          <CartesianGrid strokeDasharray="3 3" stroke="#ffffff05" />
          <XAxis {...axisProps} dataKey="alpha" />
          <YAxis {...axisProps} dataKey="cl" />
          <Tooltip {...tooltipProps} />
          {stall && <ReferenceArea x1={stall.alpha} x2={stall.alpha + 5} fill="#ef4444" fillOpacity={0.05} />}
          <Line type="monotone" dataKey="cl" stroke="#22c55e" strokeWidth={2} dot={false} isAnimationActive={false} />
          <ReferenceDot x={alpha} y={current.cl} r={4} fill="#ef4444" stroke="#000" strokeWidth={1} />
          {stall && (
            <ReferenceDot
              x={stall.alpha}
              y={stall.cl}
              r={4}
              fill="#ef4444"
              stroke="none"
              label={{ position: "top", value: "Stall", fill: "#ef4444", fontSize: 8 }}
            />
          )}
        </LineChart>
      </ChartCard>

      <ChartCard
        title="Drag Polar (Cl vs Cd)"
        emptyMessage={emptyMessage}
        badge={bestLD && <span className="text-[7px] sm:text-[9px] text-blue-400 font-mono">Best L/D: {bestLD.ratio.toFixed(1)}</span>}
      >
        <ScatterChart margin={chartMargin}>
          <CartesianGrid strokeDasharray="3 3" stroke="#ffffff05" />
          <XAxis {...axisProps} dataKey="cd" />
          <YAxis {...axisProps} dataKey="cl" />
          <Tooltip {...tooltipProps} />
          <Scatter data={polar} line={{ stroke: "#3b82f6", strokeWidth: 2 }} shape="circle" fill="#3b82f6" isAnimationActive={false} />
          <ReferenceDot x={current.cd} y={current.cl} r={4} fill="#ef4444" stroke="#000" strokeWidth={1} />
          {bestLD && (
            <ReferenceDot
              x={bestLD.point.cd}
              y={bestLD.point.cl}
              r={4}
              fill="#3b82f6"
              stroke="none"
              label={{ position: "top", value: "Best L/D", fill: "#3b82f6", fontSize: 8 }}
            />
          )}
        </ScatterChart>
      </ChartCard>
    </div>
  );
}

// ---------- Panel ----------

interface Props {
  result: SimulationResult;
  loading: boolean;
  lowConfidence: boolean;
  polar: PolarPoint[];
  polarStatus: RequestStatus;
  alpha: number;
  velocity: number;
  chord: number;
  span: number;
}

export default function BottomPanel({
  result, loading, lowConfidence, polar, polarStatus, alpha, velocity, chord, span,
}: Props) {
  const [tab, setTab] = useState<Tab>("performance");
  const [minimized, setMinimized] = useState(false);

  const forces = aerodynamicForces(velocity, chord, span, result.cl, result.cd);
  const show = (text: string) => (loading ? "..." : text);
  const pulse = "border-rose-900/50 animate-[pulse_2s_ease-in-out_infinite]";

  return (
    <div
      className={`w-full p-3 sm:p-5 z-20 pointer-events-none border-t border-zinc-800 glass-panel shrink-0 transition-transform duration-300 relative ${minimized ? "translate-y-full" : "translate-y-0"}`}
    >
      <button
        onClick={() => setMinimized(!minimized)}
        aria-label={minimized ? "Show data panel" : "Minimize data panel"}
        className="absolute top-0 right-4 -translate-y-full glass-panel pointer-events-auto rounded-t-lg px-4 py-1 text-zinc-500 hover:text-white border border-zinc-800 border-b-0 flex items-center justify-center transition-colors"
      >
        {minimized ? <BarChart3 size={16} /> : <Minimize2 size={16} />}
      </button>

      <div className="max-w-5xl mx-auto w-full pointer-events-auto">
        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center mb-3 sm:mb-4 gap-2">
          <div className="flex gap-4 border-b border-zinc-800 overflow-x-auto whitespace-nowrap [scrollbar-width:none]" role="tablist">
            {TABS.map(({ id, label }) => (
              <button
                key={id}
                role="tab"
                aria-selected={tab === id}
                onClick={() => setTab(id)}
                className={`pb-2 px-1 text-[10px] sm:text-xs font-mono uppercase tracking-widest transition-colors font-bold ${tab === id ? "text-blue-400 border-b-2 border-cyan-400" : "text-zinc-500 hover:text-zinc-300"}`}
              >
                {label}
              </button>
            ))}
          </div>
          {lowConfidence && (
            <div className="flex items-center gap-2 text-red-400 text-xs font-mono bg-rose-500/10 px-3 py-1 rounded-full border border-rose-500/20">
              <span className="animate-pulse">●</span> Low model confidence: results may be unreliable (possible separation/stall)
            </div>
          )}
        </div>

        {tab === "performance" && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2 sm:gap-3 min-h-[140px] sm:min-h-0 items-start">
            <Stat
              label="Lift (Cl)"
              value={show(result.cl.toFixed(3))}
              valueClass={result.cl > 0 ? "text-green-400" : "text-red-400"}
              borderClass={lowConfidence ? pulse : undefined}
            />
            <Stat label="Drag (Cd)" value={show(result.cd.toFixed(3))} valueClass="text-amber-500" />
            <Stat
              label="Efficiency"
              value={show(result.ldRatio.toFixed(1))}
              unit="L/D"
              valueClass="text-blue-400"
              labelClass="text-cyan-600"
              glowClass="bg-blue-500/10"
              borderClass={lowConfidence ? pulse : "border-zinc-800 hover:border-cyan-900"}
            />
            <Stat label="Moment (Cm)" value={show(result.cm.toFixed(4))} valueClass="text-zinc-300" />
            <Stat
              label="Reynolds"
              value={show((result.re / 1e6).toFixed(2))}
              unit="M"
              valueClass="text-zinc-400"
              className="col-span-2 md:col-span-1"
            />
          </div>
        )}

        {tab === "forces" && (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2 sm:gap-3 min-h-[140px] sm:min-h-0 items-start">
            <Stat
              label="Lift Force"
              value={show(formatForce(forces.lift))}
              valueClass="text-green-400"
              labelClass="text-emerald-600"
              borderClass="border-green-900/50"
              glowClass="bg-emerald-500/10"
            />
            <Stat
              label="Drag Force"
              value={show(formatForce(forces.drag))}
              valueClass="text-amber-500"
              labelClass="text-amber-600"
              borderClass="border-amber-900/50"
              glowClass="bg-amber-500/10"
            />
            <Stat
              label="Dyn. Pressure (q)"
              value={show(forces.dynamicPressure.toFixed(0))}
              unit="Pa"
              valueClass="text-zinc-400"
              className="col-span-2 md:col-span-1"
            />
          </div>
        )}

        {tab === "polars" && <PolarCharts polar={polar} status={polarStatus} alpha={alpha} current={result} />}
      </div>
    </div>
  );
}
