import React, { useState, useEffect, useRef } from 'react';
import { Activity, ChevronDown, Menu, X } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, ReferenceDot, ResponsiveContainer } from 'recharts';
import { motion, AnimatePresence } from 'motion/react';
import clsx from 'clsx';
import { twMerge } from 'tailwind-merge';

import materialLibrary from './material_library.json';
import airfoilDatabase from './airfoil_database.json';

// 

function cn(...inputs: (string | undefined | null | false)[]) {
  return twMerge(clsx(inputs));
}

// Dynamically get airfoil names from your database
type Airfoil = string;
type TailType = 'Conventional' | 'T-Tail' | 'V-Tail' | 'Twin Boom';
type Material = keyof typeof materialLibrary;

interface Telemetry {
  cl: number; cd: number; lift: number; drag: number;
  stress: number; fos: number; n: number;
  acoustic_db: number; ld_ratio: number;
  v_stall: number; takeoff_ready: boolean;
  weight_n: number; yield_strength_mpa: number;
  range_km: number; status: string; color: string;
}

export default function App() {
  const [airfoil, setAirfoil] = useState<Airfoil>(Object.keys(airfoilDatabase)[0]);
  const [tailType, setTailType] = useState<TailType>('Conventional');
  const [sweep, setSweep] = useState<number>(15);
  const [span, setSpan] = useState<number>(15);
  const [velocity, setVelocity] = useState<number>(150);
  const [aoa, setAoa] = useState<number>(5);
  const [thrust, setThrust] = useState<number>(50); 
  const [material, setMaterial] = useState<Material>('Aluminum 6061-T6');

  const [isSidebarOpen, setIsSidebarOpen] = useState<boolean>(true);
  const [showSplash, setShowSplash] = useState<boolean>(true);

  const [telemetry, setTelemetry] = useState<Telemetry>({
    cl: 0, cd: 0, lift: 0, drag: 0, stress: 0, fos: 10, n: 1, 
    acoustic_db: 50, ld_ratio: 0, v_stall: 0, takeoff_ready: false, 
    weight_n: 10000, yield_strength_mpa: 276, range_km: 0,
    status: 'BOOTING API...', color: '#94A3B8'
  });

  const planeRef = useRef<SVGGElement>(null);

  // --- LIVE API SYNC ---
  useEffect(() => {
    const fetchRealPhysics = async () => {
      const realCoeffs = airfoilDatabase[airfoil] || Object.values(airfoilDatabase)[0];
      const baseWingArea = span * 2;
      const currentMat = materialLibrary[material];
      const totalWeightN = (baseWingArea * 15 + thrust * 15) * 9.81;

      try {
        const response = await fetch('/api/simulate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            alpha: aoa,
            velocity: velocity,
            chord_length: 2.0,
            wing_span: span,
            wing_area: baseWingArea,
            material_yield_strength: currentMat.yield_strength_mpa,
            weight_n: totalWeightN,
            thrust_n: thrust * 1000,
            geometry_coeffs: realCoeffs
          })
        });

        const data = await response.json();

        setTelemetry({
          cl: data.aero.Cl,
          cd: data.aero.Cd,
          lift: data.aero.Lift_N,
          drag: data.aero.Drag_N,
          stress: data.structure.Stress_MPa,
          fos: data.structure.FoS,
          n: data.aero.Lift_N / totalWeightN,
          acoustic_db: data.noise.Noise_dB,
          ld_ratio: data.aero.Cl / Math.max(0.001, data.aero.Cd),
          v_stall: data.performance.V_stall_m_s,
          takeoff_ready: data.performance.Takeoff_Ready,
          range_km: data.performance.Range_km,
          weight_n: totalWeightN,
          yield_strength_mpa: currentMat.yield_strength_mpa,
          status: data.status,
          color: data.status === "FRACTURE" ? "#EF4444" : data.status === "STRESSED" ? "#F59E0B" : "#22D3EE"
        });
      } catch (e) {
        setTelemetry(t => ({ ...t, status: "OFFLINE", color: "#EF4444" }));
      }
    };

    const handler = setTimeout(fetchRealPhysics, 150);
    return () => clearTimeout(handler);
  }, [span, airfoil, aoa, velocity, material, thrust]);

  return (
    <div className="h-screen w-full bg-[#0F172A] flex overflow-hidden">
      {/* SIDEBAR */}
      <aside className={cn("w-[300px] bg-[#0F172A] border-r border-slate-800 p-6 space-y-8 z-50 transition-transform", !isSidebarOpen && "-translate-x-full")}>
        <div className="flex justify-between items-center">
          <h2 className="text-xl font-bold text-white tracking-tighter">AEROVATE</h2>
          <Activity className="text-cyan-400 w-5 h-5" />
        </div>

        <div className="space-y-6">
          <ControlSelect 
            label="Airfoil Profile" 
            value={airfoil} 
            onChange={setAirfoil} 
            options={Object.keys(airfoilDatabase)} // Dynamic options!
          />
          <ControlSlider label="Wing Span (m)" value={span} onChange={setSpan} min={2} max={30} />
          <ControlSlider label="Velocity (m/s)" value={velocity} onChange={setVelocity} min={10} max={400} />
          <ControlSlider label="Angle of Attack" value={aoa} onChange={setAoa} min={-5} max={20} />
          <ControlSelect label="Material" value={material} onChange={(v) => setMaterial(v as Material)} options={Object.keys(materialLibrary)} />
        </div>
      </aside>

      {/* VISUALIZER */}
      <main className="flex-1 relative flex flex-col items-center justify-center p-10">
        <div className="absolute top-10 right-10">
            <div className="bg-slate-900/80 border-r-4 p-4 rounded" style={{ borderRightColor: telemetry.color }}>
                <div className="text-[10px] text-slate-500 uppercase tracking-widest">Safety Factor</div>
                <div className="text-4xl font-mono font-bold" style={{ color: telemetry.color }}>{telemetry.fos.toFixed(2)}</div>
                <div className="text-[10px] font-bold mt-1" style={{ color: telemetry.color }}>{telemetry.status}</div>
            </div>
        </div>
        
        {/* Your Airplane SVG stays here, using telemetry.lift for flex animation */}
        <h3 className="text-slate-700 font-mono text-sm uppercase tracking-[1em]">Simulation Active</h3>
      </main>
    </div>
  );
}

// --- SUBCOMPONENTS ---
function ControlSelect({ label, value, options, onChange }: { label: string, value: string, options: string[], onChange: (v: string) => void }) {
  return (
    <div className="space-y-2">
      <label className="text-[10px] uppercase font-bold text-slate-500 tracking-widest">{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="w-full bg-slate-900 border border-slate-700 text-cyan-400 p-2 rounded text-xs outline-none">
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
}

function ControlSlider({ label, value, min, max, onChange }: { label: string, value: number, min: number, max: number, onChange: (v: number) => void }) {
  return (
    <div className="space-y-2">
      <div className="flex justify-between text-[10px] font-bold uppercase text-slate-500">
        <span>{label}</span>
        <span className="text-cyan-400 font-mono">{value}</span>
      </div>
      <input type="range" min={min} max={max} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-full h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer" />
    </div>
  );
}
