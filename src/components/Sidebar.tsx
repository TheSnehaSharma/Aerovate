import type { ReactNode } from "react";
import { ChevronLeft, X, Zap } from "lucide-react";
import { FLIGHT_PRESETS, GEOMETRY_PRESETS, type Flight, type Geometry } from "../lib/presets.ts";
import { machNumber } from "../lib/physics.ts";

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

interface SliderFieldProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  /** Displayed number = value × scale (e.g. 100 to show a fraction as a percentage). */
  scale?: number;
  decimals?: number;
  inputStep?: number;
  unit?: string;
  suffix?: ReactNode;
  valueClass?: string;
  alt?: boolean;
}

function SliderField({
  label, value, min, max, step, onChange,
  scale = 1, decimals = 1, inputStep = 0.1, unit, suffix, valueClass = "text-zinc-200", alt = false,
}: SliderFieldProps) {
  const focusClass = alt ? "focus:text-emerald-300" : "focus:text-blue-400";
  return (
    <div className="space-y-2">
      <div className="flex justify-between items-center text-xs font-mono text-zinc-400">
        <span>{label}</span>
        <div className="flex items-center">
          <input
            type="number"
            aria-label={`${label} (value)`}
            step={inputStep}
            value={(value * scale).toFixed(decimals)}
            onChange={(e) => {
              const parsed = parseFloat(e.target.value);
              if (Number.isFinite(parsed)) onChange(clamp(parsed / scale, min, max));
            }}
            className={`bg-transparent border-none w-12 text-right focus:outline-none ${focusClass} ${valueClass}`}
          />
          {unit}
          {suffix}
        </div>
      </div>
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className={`w-full hud-slider ${alt ? "hud-slider-alt" : ""}`}
      />
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-4 pt-4 border-t border-zinc-800 first:pt-0 first:border-t-0">
      <h3 className="text-[10px] uppercase tracking-[0.2em] text-zinc-500 font-bold">{title}</h3>
      {children}
    </div>
  );
}

interface PresetSelectProps {
  label: string;
  value: string;
  customLabel: string;
  presets: Record<string, { label: string }>;
  focusClass: string;
  onChange: (key: string) => void;
}

function PresetSelect({ label, value, customLabel, presets, focusClass, onChange }: PresetSelectProps) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`w-full bg-zinc-900 border border-zinc-800 text-zinc-300 p-2.5 rounded font-mono text-sm focus:outline-none ${focusClass} appearance-none cursor-pointer`}
    >
      <option value="">{customLabel}</option>
      {Object.entries(presets).map(([key, preset]) => (
        <option key={key} value={key}>
          {preset.label}
        </option>
      ))}
    </select>
  );
}

interface Props {
  open: boolean;
  geo: Geometry;
  flight: Flight;
  geoPreset: string;
  flightPreset: string;
  onGeoPreset: (key: string) => void;
  onFlightPreset: (key: string) => void;
  onGeoChange: (patch: Partial<Geometry>) => void;
  onFlightChange: (patch: Partial<Flight>) => void;
  onHome: () => void;
  onClose: () => void;
}

export default function Sidebar(props: Props) {
  const { open, geo, flight, geoPreset, flightPreset, onGeoChange, onFlightChange } = props;
  return (
    <div
      className={`absolute lg:relative top-0 left-0 w-80 lg:w-96 border-r border-zinc-800 bg-zinc-950/95 lg:bg-zinc-950 backdrop-blur-xl flex flex-col shrink-0 h-screen overflow-y-auto transition-transform duration-300 z-50 shadow-[10px_0_40px_rgba(0,0,0,0.5)] lg:shadow-none ${open ? "translate-x-0" : "-translate-x-full lg:hidden"}`}
    >
      <div className="flex gap-2 p-4 border-b border-zinc-800 bg-zinc-950/50">
        <button
          onClick={props.onHome}
          className="flex-1 flex items-center justify-center gap-2 text-xs uppercase tracking-widest text-zinc-400 hover:text-white bg-zinc-800/40 hover:bg-zinc-800 py-2 rounded transition-colors"
        >
          <ChevronLeft size={14} /> Design Hub
        </button>
        <button
          onClick={props.onClose}
          aria-label="Close sidebar"
          className="lg:hidden px-3 flex items-center justify-center text-zinc-400 hover:text-blue-400 bg-zinc-800/40 hover:bg-zinc-800 rounded transition-colors"
        >
          <X size={14} />
        </button>
      </div>

      <div className="p-6 border-b border-zinc-800">
        <h1 className="text-xl font-mono text-blue-400 font-bold tracking-tight mb-1 flex items-center gap-2">
          <Zap size={20} /> AEROVATE
        </h1>
        <p className="text-xs text-zinc-400 leading-relaxed font-mono">Precision Airfoil Engineering</p>
      </div>

      <div className="p-6 flex-1 flex flex-col gap-6">
        <Section title="Profile Preset">
          <PresetSelect
            label="Profile preset"
            value={geoPreset}
            customLabel="Custom Geometry"
            presets={GEOMETRY_PRESETS}
            focusClass="focus:border-blue-500"
            onChange={props.onGeoPreset}
          />
        </Section>

        <Section title="Refine Geometry">
          <SliderField label="Max Camber" value={geo.m} min={-0.1} max={0.1} step={0.001} scale={100} unit="%" onChange={(m) => onGeoChange({ m })} />
          <SliderField label="Camber Position" value={geo.p} min={0.01} max={0.99} step={0.01} scale={10} onChange={(p) => onGeoChange({ p })} />
          <SliderField label="Thickness" value={geo.t} min={0.01} max={0.4} step={0.005} scale={100} unit="%" onChange={(t) => onGeoChange({ t })} />
          <SliderField label="Chord Length" value={geo.chord} min={0.1} max={10} step={0.1} decimals={2} unit="m" onChange={(chord) => onGeoChange({ chord })} />
          <SliderField label="Wing Span" value={geo.span} min={0.1} max={50} step={0.5} decimals={2} unit="m" onChange={(span) => onGeoChange({ span })} />
        </Section>

        <Section title="Flight Conditions Preset">
          <PresetSelect
            label="Flight conditions preset"
            value={flightPreset}
            customLabel="Custom Conditions"
            presets={FLIGHT_PRESETS}
            focusClass="focus:border-emerald-500"
            onChange={props.onFlightPreset}
          />
        </Section>

        <Section title="Flight Conditions">
          <SliderField
            alt
            label="Angle of Attack"
            value={flight.alpha}
            min={-30}
            max={30}
            step={0.5}
            unit="°"
            valueClass={flight.alpha >= 0 ? "text-green-400" : "text-red-400"}
            onChange={(alpha) => onFlightChange({ alpha })}
          />
          <SliderField
            alt
            label="Velocity"
            value={flight.velocity}
            min={1}
            max={1000}
            step={1}
            decimals={0}
            inputStep={1}
            unit=" m/s"
            valueClass="text-green-400"
            suffix={<span className="text-zinc-600 ml-1">/ M{machNumber(flight.velocity).toFixed(2)}</span>}
            onChange={(velocity) => onFlightChange({ velocity })}
          />
        </Section>
      </div>
    </div>
  );
}
