import React, { useState, useEffect, useRef } from 'react';
import { Activity, AlertTriangle, ChevronDown, Menu, X } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, ReferenceDot, ResponsiveContainer } from 'recharts';
import { motion, AnimatePresence } from 'motion/react';
import clsx from 'clsx';
import { twMerge } from 'tailwind-merge';

import materialLibrary from './material_library.json';
import airfoilDatabase from './airfoil_database.json';

const AIRFOIL_MAP: Record<string, string> = {
  'NACA 0012': 'n0012',
  'Clark Y':   'clarky',
  'NACA 4412': 'naca4412',
  'S1223':     's1223',
  'FX 63-137': 'fx63137'
};

function cn(...inputs: (string | undefined | null | false)[]) {
  return twMerge(clsx(inputs));
}

type Airfoil = 'NACA 0012' | 'Clark Y' | 'NACA 4412' | 'S1223' | 'FX 63-137';
type TailType = 'Conventional' | 'T-Tail' | 'V-Tail' | 'Twin Boom';
type Material = keyof typeof materialLibrary;

interface Telemetry {
  cl: number;
  cd: number;
  lift: number;
  drag: number;
  stress: number;
  fos: number;
  n: number;
  acoustic_db: number;
  ld_ratio: number;
  weight_fraction: number;
  structural_weight: number;
  status: string;
  color: string;
  v_stall: number;
  takeoff_ready: boolean;
  weight_n: number;
  yield_strength_mpa: number;
  range_km: number;
}

export default function App() {
  // Deck A: Geometry
  const [airfoil, setAirfoil] = useState<Airfoil>('Clark Y');
  const [tailType, setTailType] = useState<TailType>('Conventional');
  const [sweep, setSweep] = useState<number>(15);
  const [taper, setTaper] = useState<number>(0.6);
  const [span, setSpan] = useState<number>(15);

  // Deck B: Mission Profile
  const [velocity, setVelocity] = useState<number>(150);
  const [aoa, setAoa] = useState<number>(5);
  const [thrust, setThrust] = useState<number>(50); // kN

  // Deck C: Weight & Material
  const [material, setMaterial] = useState<Material>('Aluminum 6061-T6');

  // UI State
  const [isSidebarOpen, setIsSidebarOpen] = useState<boolean>(true);
  const [showSplash, setShowSplash] = useState<boolean>(true);

  // Backend Telemetry State
  const [telemetry, setTelemetry] = useState<Telemetry>({
    cl: 0, cd: 0, lift: 0, drag: 0, stress: 0, fos: 10, n: 1, 
    acoustic_db: 50, ld_ratio: 0, weight_fraction: 0.1, 
    structural_weight: 1000, status: 'BOOTING API...', 
    color: '#94A3B8', v_stall: 0, takeoff_ready: false, 
    weight_n: 10000, yield_strength_mpa: 276, range_km: 0
  });

  useEffect(() => {
    const timer = setTimeout(() => setShowSplash(false), 4500);
    return () => clearTimeout(timer);
  }, []);

  const planeRef = useRef<SVGGElement>(null);
  const fanPortRef = useRef<SVGGElement>(null);
  const fanStarbRef = useRef<SVGGElement>(null);

  // Material Theme Mapping
  const getMaterialStyle = () => {
    switch(material) {
      case 'Carbon Fiber': return { stroke: '#334155', dash: '3 2', filter: 'none', flexMult: 0.01, name: 'Carbon' };
      case 'Titanium Grade 5': return { stroke: '#94A3B8', dash: 'none', filter: 'url(#shimmer-glow)', flexMult: 0.15, name: 'Titanium' };
      case 'Sitka Spruce': return { stroke: '#B45309', dash: 'none', filter: 'none', flexMult: 1.5, name: 'Sitka Spruce' };
      case 'Maraging Steel': return { stroke: '#64748B', dash: 'none', filter: 'none', flexMult: 0.05, name: 'Steel' };
      default: return { stroke: '#D1D5DB', dash: 'none', filter: 'none', flexMult: 0.2, name: 'Aluminum' };
    }
  };
  const matStyle = getMaterialStyle();

  // Mutable state for wind particles
  const particlesRef = useRef(Array.from({ length: 120 }).map((_, i) => ({
    id: i, x: (Math.random() * 2400) - 1200, y: (Math.random() * 1600) - 800,
    length: 60 + Math.random() * 100, baseOpacity: 0.15 + Math.random() * 0.4,
    angle: 0, r: 10, cx: 0, cy: 0
  })));

  useEffect(() => {
    // Update the Tab Name
    document.title = "Aerovate | Rapid Aero Prototyping";
  
    // Update the Tab Icon (Favicon)
    const link = document.querySelector("link[rel~='icon']") || document.createElement('link');
    // @ts-ignore
    link.rel = 'icon';
    // Using a data URI for a cyan "A" icon so you don't need a separate file
    link.href = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="%2322d3ee" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 22 12 2l10 20M6 12h12"/></svg>';
    document.getElementsByTagName('head')[0].appendChild(link);
  }, []);

  // =======================================================================
  // LIVE API CONNECTION (Strict ML Data Only)
  // =======================================================================
  useEffect(() => {
      const fetchRealPhysics = async () => {
        // 1. Map the UI selection to the JSON key (e.g. 'Clark Y' -> 'clarky')
        const jsonKey = AIRFOIL_MAP[airfoil];
        
        // 2. Safety Check: Extract coefficients from your JSON database
        const db = (airfoilDatabase as any).default || airfoilDatabase;
        const realCoeffs = db[jsonKey];
  
        if (!realCoeffs) {
          setTelemetry(t => ({ ...t, status: `MISSING DATA: ${jsonKey}`, color: "#F59E0B" }));
          return;
        }
  
        // 3. Prepare Physics Constants
        const baseWingArea = span * 2;
        const currentMat = materialLibrary[material];
        const totalWeightN = (baseWingArea * 15 + thrust * 15) * 9.81;
  
        try {
          // 4. Send the POST request to your FastAPI backend
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
  
          if (!response.ok) {
            setTelemetry(t => ({ ...t, status: `SERVER ERR: ${response.status}`, color: "#EF4444" }));
            return;
          }
  
          const data = await response.json();
          
          // DEBUG: Open F12 > Console to see this log!
          console.log("✈️ Telemetry Received:", data);
  
          // 5. MAP DATA TO STATE (Matching your index.py keys exactly)
          setTelemetry(prev => ({
            ...prev,
            // Aero Data
            cl: data.aero?.Cl ?? 0,
            cd: data.aero?.Cd ?? 0,
            lift: data.aero?.Lift_N ?? 0,
            drag: data.aero?.Drag_N ?? 0,
            
            // L/D Ratio (Calculated from results)
            ld_ratio: (data.aero?.Cl / Math.max(0.001, data.aero?.Cd)) || 0,
  
            // Structural Data
            stress: data.structure?.Stress_MPa ?? 0,
            fos: data.structure?.FoS ?? 0,
  
            // Performance Data (V-Stall and Range)
            v_stall: data.performance?.V_stall_m_s ?? 0,
            takeoff_ready: data.performance?.Takeoff_Ready ?? false,
            range_km: data.performance?.Range_km ?? 0,
  
            // Noise Data
            acoustic_db: data.noise?.Noise_dB ?? 0,
  
            // Global UI Status
            status: data.status,
            color: data.status === "FRACTURE" ? "#EF4444" : 
                   data.status === "STRESSED" ? "#F59E0B" : "#22D3EE",
  
            // Pass material constants back to UI for the graphs
            yield_strength_mpa: currentMat.yield_strength_mpa,
            weight_n: totalWeightN
          }));
  
        } catch (error) {
          console.error("Fetch failed:", error);
          setTelemetry(t => ({ ...t, status: "NETWORK ERROR", color: "#EF4444" }));
        }
      };
  
      // Debounce the API calls to prevent overloading the server while sliding
      const handler = setTimeout(fetchRealPhysics, 150);
      return () => clearTimeout(handler);
      
    }, [airfoil, span, aoa, velocity, material, thrust]);
  
  
  // Derived Visualization States
  const isFractured = telemetry.fos <= 1.0 && telemetry.status !== "API CONNECTION FAILED";
  const isStressed = telemetry.fos <= 1.5 && telemetry.fos > 1.0;
  const stressIntensity = Math.min(1, Math.max(0, 1.5 - telemetry.fos) / 0.5);

  let noiseColor = '#FFFFFF'; 
  if (telemetry.acoustic_db > 100) noiseColor = '#FF4500'; 
  else if (telemetry.acoustic_db > 80) noiseColor = '#FFFF00'; 

  const noiseColorRef = useRef<string>(noiseColor);
  useEffect(() => { noiseColorRef.current = noiseColor; }, [noiseColor]);

  // Render Loop (Animation & Particles)
  useEffect(() => {
    let rafId: number;
    let startFrame = performance.now();

    const loop = (time: number) => {
      // Vibration logic (Stressed + Non-Fractured)
      if (planeRef.current) {
        if (isStressed) {
          const intensity = (1.5 - telemetry.fos) / 0.5; 
          const maxShake = 6 * Math.pow(intensity, 2); 
          const dx = (Math.random() - 0.5) * maxShake;
          const dy = (Math.random() - 0.5) * maxShake;
          planeRef.current.style.transform = `translate(${dx}px, ${dy}px)`;
        } else {
          planeRef.current.style.transform = `translate(0px, 0px)`;
        }
      }

      // Fan rotation
      if (fanPortRef.current && fanStarbRef.current) {
        const rpm = (velocity * 2) + Math.max(0, thrust * 0.1);
        fanPortRef.current.setAttribute('transform', `translate(125, 37) rotate(${time * rpm * 0.05})`);
        fanStarbRef.current.setAttribute('transform', `translate(125, -37) rotate(${time * rpm * 0.05})`);
      }

      // Wind Particles
      if (velocity > 0 || isFractured) {
        const speed = (velocity / 100) * 12 + 1; 

        particlesRef.current.forEach((p) => {
          if (isFractured) {
             p.angle += 0.1 * (speed / 5);
             p.r += Math.random() * 3;
             p.x = p.cx + Math.cos(p.angle) * p.r;
             p.y = p.cy + Math.sin(p.angle) * p.r;
          } else {
             p.x += speed;
             if (p.x > 1200) {
               p.x = -1200 - Math.random() * 400;
               p.y = (Math.random() * 1600) - 800; 
             }
             p.cx = p.x; 
             p.cy = p.y;
             p.r = 10;
             p.angle = Math.random() * Math.PI * 2;
          }
          
          let currentOpacity = p.baseOpacity;
          if (!isFractured) {
            if (p.x < -600) currentOpacity = p.baseOpacity * ((p.x + 600) / 600);
            else if (p.x > 600) currentOpacity = p.baseOpacity * ((1200 - p.x) / 600);
          } else {
            currentOpacity = Math.max(0, p.baseOpacity - (p.r * 0.001)); 
          }

          let el = (p as any).el as SVGLineElement | null;
          if (!el) {
             el = document.getElementById(`wind-particle-${p.id}`) as unknown as SVGLineElement | null;
             (p as any).el = el;
          }

          if (el) {
            el.setAttribute('x1', p.x.toString());
            el.setAttribute('x2', (p.x + p.length).toString());
            el.setAttribute('y1', p.y.toString());
            el.setAttribute('y2', p.y.toString());
            el.setAttribute('opacity', Math.max(0, currentOpacity).toString());
            
            let currentStroke = 'rgba(255,255,255,0.7)';
            if (isFractured) {
               currentStroke = '#FF0000';
            } else {
               const isNearPlane = p.x > -500 && p.x < 550 && p.y > -450 && p.y < 450;
               currentStroke = isNearPlane ? noiseColorRef.current : 'rgba(255,255,255,0.3)';
            }
            if (el.style.stroke !== currentStroke) {
               el.style.stroke = currentStroke;
            }
          }
        });
      }

      rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  }, [telemetry.fos, isFractured, isStressed, velocity, thrust]);

  // Visual computations for SVG
  const visualSpan = 50 + ((span - 2) / 28) * 250;
  const flexOffset = (telemetry.lift / 150000) * matStyle.flexMult * (span / 15);
  const visualFlex = Math.min(60, flexOffset); 
  const visualFlapDeflection = (aoa > 0 ? aoa * 1.5 : 0) + (velocity / 15); 
  const rootChord = 80 + (sweep * 0.5); 
  const tipChord = rootChord * taper;
  const tipOffset = visualSpan * Math.tan((sweep * Math.PI) / 180);

  return (
    <>
      <AnimatePresence>
        {showSplash && (
          <motion.div
            initial={{ opacity: 1 }}
            exit={{ opacity: 0, scale: 1.05 }}
            transition={{ duration: 0.8, ease: "easeInOut" }}
            className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-[#050B14] overflow-hidden"
          >
            <div className="absolute inset-0 opacity-10 pointer-events-none" style={{ backgroundImage: 'linear-gradient(rgba(34, 211, 238, 0.4) 1px, transparent 1px), linear-gradient(90deg, rgba(34, 211, 238, 0.4) 1px, transparent 1px)', backgroundSize: '40px 40px' }} />
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5, duration: 0.8 }} className="relative z-10 flex flex-col items-center">
              <div className="mb-8 relative flex items-center justify-center">
                 <motion.div animate={{ rotate: 360 }} transition={{ duration: 10, repeat: Infinity, ease: "linear" }} className="absolute w-32 h-32 rounded-full border-t-2 border-b-2 border-cyan-500/50" />
                 <motion.div animate={{ rotate: -360 }} transition={{ duration: 15, repeat: Infinity, ease: "linear" }} className="absolute w-40 h-40 rounded-full border-r-2 border-l-2 border-[#F59E0B]/30" />
                 <Activity className="w-16 h-16 text-cyan-400" />
              </div>
              <h1 className="text-6xl sm:text-8xl font-black tracking-tighter text-white mb-2" style={{ textShadow: '0 0 40px rgba(34, 211, 238, 0.5)' }}>AEROVATE</h1>
              <p className="text-xl sm:text-2xl font-mono text-cyan-300 tracking-[0.3em] uppercase mb-12 text-center">Rapid Aero Prototyping</p>
              <div className="flex flex-col items-center">
                <motion.div initial={{ width: 0 }} animate={{ width: "300px" }} transition={{ delay: 1.5, duration: 2.5, ease: "easeInOut" }} className="h-1 bg-gradient-to-r from-transparent via-cyan-500 to-transparent mb-6" />
                <motion.p initial={{ opacity: 0 }} animate={{ opacity: [0, 1, 0.5, 1] }} transition={{ delay: 2, duration: 1.5 }} className="text-sm font-bold tracking-[0.5em] text-[#94A3B8] uppercase">Build • Test • Fly</motion.p>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="h-[100dvh] w-full bg-[#0F172A] flex overflow-hidden selection:bg-cyan-500/30">
      
      {/* SIDEBAR */}
      <aside className={cn(
        "w-[85vw] sm:w-[300px] shrink-0 bg-[#0F172A]/95 border-r border-[#1E293B] flex flex-col z-40 shadow-2xl overflow-y-auto backdrop-blur-xl absolute xl:relative h-full transition-all duration-500 ease-in-out",
        isSidebarOpen ? "translate-x-0" : "-translate-x-full xl:translate-x-0 xl:-ml-[300px]"
      )}>
        <div className="p-6 border-b border-[#1E293B] flex items-start justify-between bg-gradient-to-br from-[#0F172A] to-[#1E293B]">
          <div className="space-y-1">
            <h1 className="text-[10px] font-bold tracking-[0.2em] text-cyan-500 uppercase">Rapid Aero Prototyping</h1>
            <p className="text-2xl font-black tracking-tight leading-none text-slate-100">AEROVATE</p>
          </div>
          <button className="xl:hidden p-1 text-slate-400 hover:text-white transition-colors" onClick={() => setIsSidebarOpen(false)}>
            <X className="w-6 h-6" />
          </button>
          <Activity className="hidden xl:block w-5 h-5 text-cyan-400" />
        </div>

        <div className="p-6 flex flex-col gap-8">
          <div className="space-y-4">
            <div className="border-l-2 border-cyan-500 pl-2">
              <label className="text-[10px] font-bold uppercase tracking-[0.15em] text-slate-400 block">Deck A: Geometry</label>
            </div>
            <div className="space-y-4 bg-[#1E293B]/30 p-4 rounded-md border border-[#1E293B]">
              <ControlSelect label="Airfoil Profile" value={airfoil} onChange={(v) => setAirfoil(v as Airfoil)} options={['NACA 0012', 'Clark Y', 'NACA 4412', 'S1223', 'FX 63-137']} />
              <ControlSelect label="Tail Config" value={tailType} onChange={(v) => setTailType(v as TailType)} options={['Conventional', 'T-Tail', 'V-Tail', 'Twin Boom']} />
              <ControlSlider label="Wing Sweep (°)" value={sweep} onChange={setSweep} min={0} max={45} />
              <ControlSlider label="Taper Ratio" value={taper} onChange={setTaper} min={0.1} max={1.0} step={0.05} />
              <ControlSlider label="Wing Span (m)" value={span} onChange={setSpan} min={2} max={30} step={0.5} />
            </div>
          </div>

          <div className="space-y-4">
            <div className="border-l-2 border-fuchsia-500 pl-2">
              <label className="text-[10px] font-bold uppercase tracking-[0.15em] text-slate-400 block">Deck B: Mission Profile</label>
            </div>
            <div className="space-y-4 bg-[#1E293B]/30 p-4 rounded-md border border-[#1E293B]">
              <ControlSlider label="Airspeed (V) [m/s]" value={velocity} onChange={setVelocity} min={10} max={400} />
              <ControlSlider label="Angle of Attack [°]" value={aoa} onChange={setAoa} min={-5} max={20} />
              <ControlSlider label="Thrust Capacity [kN]" value={thrust} onChange={setThrust} min={0} max={250} step={5} />
            </div>
          </div>

          <div className="space-y-4">
            <div className="border-l-2 border-emerald-500 pl-2">
               <label className="text-[10px] font-bold uppercase tracking-[0.15em] text-slate-400 block">Deck C: Structural Material</label>
            </div>
            <div className="space-y-4 bg-[#1E293B]/30 p-4 rounded-md border border-[#1E293B]">
              <ControlSelect label="Material" value={material} onChange={(v) => setMaterial(v as Material)} options={Object.keys(materialLibrary)} />
            </div>
          </div>
        </div>
      </aside>

      {/* MAIN VISUALIZER */}
      <main className="flex-1 relative flex flex-col bg-[#0F172A] grid-bg h-full overflow-y-auto sm:overflow-hidden overflow-x-hidden">
        
        {/* HUD Elements Overlay - TOP */}
        <div className="p-3 sm:p-6 z-20 flex justify-between items-start pointer-events-none gap-2 shrink-0 relative w-full">
          <div className="flex gap-2 pointer-events-auto items-start shrink-0">
             <button 
               onClick={() => setIsSidebarOpen(!isSidebarOpen)}
               className="bg-[#1E293B]/90 backdrop-blur-md border border-[#334155] p-2 rounded shadow-lg text-cyan-400 hover:text-cyan-300 hover:bg-[#0F172A] transition-colors mt-[1px]"
             >
               <Menu className="w-5 h-5 sm:w-6 sm:h-6" />
             </button>
             
             <div className="hidden sm:flex flex-col gap-2">
               <div className="bg-[#1E293B]/90 backdrop-blur-md border border-[#334155] p-2 rounded shadow-lg min-w-[200px]">
               <h3 className="text-[8px] uppercase tracking-widest text-slate-400 mb-0.5">V-n Envelope Simulation</h3>
               <div className="h-28 w-full mt-1">
                 <VnEnvelopeGraph 
                   velocity={velocity} 
                   lift={telemetry.lift} 
                   weight={telemetry.weight_n} 
                   wingArea={span * 2} 
                   wingSpan={span} 
                   yieldStrength={telemetry.yield_strength_mpa} 
                 />
               </div>
             </div>
          </div>
          </div>

          <div className="flex flex-col items-end gap-1.5 sm:gap-2 shrink-0 pointer-events-auto">
            <div className="bg-[#1E293B]/90 backdrop-blur-md border border-[#334155] px-3 py-2 sm:px-4 sm:py-3 rounded-lg flex flex-col items-end min-w-[150px] sm:min-w-[200px] shadow-2xl transition-colors duration-300"
                 style={{ borderRightColor: telemetry.color, borderRightWidth: '4px' }}>
              <span className="text-[7px] sm:text-[8px] uppercase tracking-[0.2em] text-slate-500 mb-0.5 sm:mb-1 relative group cursor-help">
                State: {telemetry.status}
                {telemetry.status === "API CONNECTION FAILED" && (
                   <div className="absolute hidden group-hover:block right-0 top-full mt-2 w-48 p-2 bg-red-900/90 text-red-200 border border-red-500 rounded text-[9px] normal-case tracking-normal shadow-xl z-50 text-right">
                     Cannot reach the Python FastAPI backend. Check server logs.
                   </div>
                )}
              </span>
              <span className="text-3xl sm:text-4xl font-mono leading-none tracking-tighter" style={{ color: telemetry.color, textShadow: isStressed || isFractured ? `0 0 20px ${telemetry.color}80` : 'none' }}>
                {telemetry.fos.toFixed(2)}
              </span>
              <div className="flex flex-col items-end gap-0.5 sm:gap-1 mt-1 sm:mt-2 text-[7px] sm:text-[8px] uppercase tracking-widest">
                <span className="text-[#94A3B8]">Mat: {matStyle.name}</span>
                <span className={telemetry.takeoff_ready ? "text-emerald-400 font-bold" : "text-rose-400 font-bold"}>
                  {telemetry.takeoff_ready ? '◆ FLIGHT READY' : '◇ INSUFFICIENT FORCE'}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-1 w-[150px] sm:w-[170px]">
              <HudMetricCard label="Lift (kN)" value={(telemetry.lift / 1000).toFixed(1)} highlight={telemetry.lift > (telemetry.structural_weight * 9.81 + thrust * 15 * 9.81)} />
              <HudMetricCard label="Drag (kN)" value={(telemetry.drag / 1000).toFixed(1)} highlight={(telemetry.drag / 1000) > thrust} />
              <HudMetricCard label="Range" value={`${telemetry.range_km.toFixed(0)}km`} highlight={telemetry.range_km < 1000} />
              <HudMetricCard label="V-Stall" value={telemetry.v_stall > 500 ? 'N/A' : `${telemetry.v_stall.toFixed(0)}m/s`} highlight={velocity <= telemetry.v_stall} />
            </div>
          </div>
        </div>

        {isFractured && (
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-40 pointer-events-none">
             <div className="bg-red-950/90 text-red-500 border-y-2 border-red-500/50 backdrop-blur-md px-12 py-4 tracking-[0.3em] font-bold text-2xl flex items-center justify-center w-screen text-center shadow-[0_0_100px_rgba(239,68,68,0.5)]">
               <span className="animate-pulse">CATASTROPHIC MATERIAL FRACTURE</span>
             </div>
          </div>
        )}

        <div className="flex-1 min-h-[300px] sm:min-h-0 w-full relative z-10 flex items-center justify-center pointer-events-none shrink-0 py-8 lg:py-0 overflow-hidden">
          <svg viewBox="-550 -450 1100 900" preserveAspectRatio="xMidYMid meet" className={cn("w-full h-full max-w-[1600px] max-h-[1600px] transition-all duration-1000")}>
            <defs>
              <filter id="stress-glow" x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur stdDeviation={10 + telemetry.fos * 10} result="blur" />
                <feComponentTransfer in="blur" result="glow"><feFuncA type="linear" slope={1.2 + telemetry.fos * 2.5} /></feComponentTransfer>
                <feMerge><feMergeNode in="glow" /><feMergeNode in="SourceGraphic" /></feMerge>
              </filter>
              <filter id="shimmer-glow" x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur stdDeviation="3" result="blur" />
                <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
              </filter>
              <filter id="prop-blur" x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur stdDeviation="4" result="blur" />
                <feComponentTransfer><feFuncA type="linear" slope="0.8"/></feComponentTransfer>
              </filter>
              <linearGradient id="thrust-glow" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#22D3EE" stopOpacity="0.8" />
                <stop offset="100%" stopColor="#22D3EE" stopOpacity="0" />
              </linearGradient>
              <linearGradient id="thrust-core" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#F59E0B" stopOpacity="0.9" />
                <stop offset="100%" stopColor="#EF4444" stopOpacity="0" />
              </linearGradient>
            </defs>

            {velocity > 5 && (
              <g strokeWidth="3" strokeLinecap="round">
                {particlesRef.current.map(p => (
                  <line key={p.id} id={`wind-particle-${p.id}`} x1={0} y1={0} x2={1} y2={0} opacity={0} style={{ transition: "stroke 0.25s linear" }} />
                ))}
              </g>
            )}

            <g transform="scale(1.5)">
              <g ref={planeRef}>
                
              {thrust > 0 && (
                <motion.g animate={{ opacity: [0.5, 1, 0.5] }} transition={{ duration: Math.max(0.05, 0.3 - (thrust / 250) * 0.25), repeat: Infinity, ease: "easeInOut" }}>
                  <g transform="translate(190, 37)">
                    <path d={`M 0 -10 L ${40 + thrust} -${6 + thrust * 0.1} Q ${80 + thrust * 1.5} 0 ${40 + thrust} ${6 + thrust * 0.1} L 0 10 Z`} fill="url(#thrust-glow)" filter="url(#prop-blur)" />
                    {thrust > 50 && <path d={`M 0 -5 L ${20 + thrust * 0.6} -${3 + thrust * 0.05} Q ${50 + thrust * 1.2} 0 ${20 + thrust * 0.6} ${3 + thrust * 0.05} L 0 5 Z`} fill="url(#thrust-core)" filter="url(#shimmer-glow)" />}
                    {thrust > 150 && <path transform="translate(5, 0)" d={`M 0 -2 L ${thrust * 0.3} -1 Q ${thrust * 0.4} 0 ${thrust * 0.3} 1 L 0 2 Z`} fill="#ffffff" filter="url(#shimmer-glow)" />}
                  </g>
                  <g transform="translate(190, -37)">
                    <path d={`M 0 -10 L ${40 + thrust} -${6 + thrust * 0.1} Q ${80 + thrust * 1.5} 0 ${40 + thrust} ${6 + thrust * 0.1} L 0 10 Z`} fill="url(#thrust-glow)" filter="url(#prop-blur)" />
                    {thrust > 50 && <path d={`M 0 -5 L ${20 + thrust * 0.6} -${3 + thrust * 0.05} Q ${50 + thrust * 1.2} 0 ${20 + thrust * 0.6} ${3 + thrust * 0.05} L 0 5 Z`} fill="url(#thrust-core)" filter="url(#shimmer-glow)" />}
                    {thrust > 150 && <path transform="translate(5, 0)" d={`M 0 -2 L ${thrust * 0.3} -1 Q ${thrust * 0.4} 0 ${thrust * 0.3} 1 L 0 2 Z`} fill="#ffffff" filter="url(#shimmer-glow)" />}
                  </g>
                </motion.g>
              )}

              <g stroke={matStyle.stroke} fill="#0F172A" strokeWidth="1.5" strokeDasharray={matStyle.dash} filter={matStyle.filter}>
                <path d="M -220 0 C -220 -25, -120 -35, 0 -35 C 150 -35, 230 -15, 230 0 C 230 15, 150 35, 0 35 C -120 35, -220 25, -220 0 Z" opacity="0.9"/>
                <path d="M -202 -17 Q -190 0 -202 17" fill="none" strokeWidth="1" strokeDasharray="3 3"/>
                <line x1="-120" y1="-34" x2="-120" y2="34" strokeWidth="0.5" opacity="0.4" />
                <line x1="0" y1="-35" x2="0" y2="35" strokeWidth="0.5" opacity="0.4" />
                <line x1="120" y1="-30" x2="120" y2="30" strokeWidth="0.5" opacity="0.4" />
              </g>

              <g fill="rgba(34, 211, 238, 0.2)" stroke="#22D3EE" strokeWidth="1">
                <path d="M -192 0 L -182 -12 Q -155 -15 -140 -12 L -135 0 L -140 12 Q -155 15 -182 12 Z" />
                <line x1="-192" y1="0" x2="-135" y2="0" opacity="0.5"/>
                <line x1="-165" y1="-14" x2="-165" y2="14" opacity="0.5"/>
              </g>

              <g>
                {Array.from({length: 12}).map((_, i) => (
                   <React.Fragment key={i}>
                     <rect x={-90 + i * 16} y={-23} width={7} height={10} rx={3} fill="rgba(15, 23, 42, 0.9)" stroke="rgba(34, 211, 238, 0.4)" strokeWidth="0.8" />
                     <rect x={-90 + i * 16} y={13} width={7} height={10} rx={3} fill="rgba(15, 23, 42, 0.9)" stroke="rgba(34, 211, 238, 0.4)" strokeWidth="0.8" />
                   </React.Fragment>
                ))}
              </g>

              <g stroke={matStyle.stroke} fill="#0F172A" strokeWidth="1.5" strokeDasharray={matStyle.dash} filter={matStyle.filter}>
                <path d="M 130 30 L 130 40 L 160 40 L 160 30 Z" />
                <rect x="120" y="25" width="70" height="24" rx="12" />
                <path d="M 130 -30 L 130 -40 L 160 -40 L 160 -30 Z" />
                <rect x="120" y="-49" width="70" height="24" rx="12" />
              </g>

              <g id="fan-port" ref={fanPortRef} transform="translate(125, 37)">
                <ellipse cx="0" cy="0" rx="3" ry="10" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="1" filter={velocity > 200 ? "url(#prop-blur)" : ""} />
                <line x1="0" y1="-10" x2="0" y2="10" stroke="#22D3EE" strokeWidth="1.5" opacity="0.8" />
                <line x1="-3" y1="0" x2="3" y2="0" stroke="#22D3EE" strokeWidth="1.5" opacity="0.8" />
              </g>
              <g id="fan-starb" ref={fanStarbRef} transform="translate(125, -37)">
                <ellipse cx="0" cy="0" rx="3" ry="10" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="1" filter={velocity > 200 ? "url(#prop-blur)" : ""} />
                <line x1="0" y1="-10" x2="0" y2="10" stroke="#22D3EE" strokeWidth="1.5" opacity="0.8" />
                <line x1="-3" y1="0" x2="3" y2="0" stroke="#22D3EE" strokeWidth="1.5" opacity="0.8" />
              </g>

              {thrust > 0 && (
                <motion.g
                   fill="none" stroke="#22D3EE" strokeWidth={1 + thrust * 0.01}
                   filter="url(#shimmer-glow)"
                   animate={{ opacity: [0.2, 0.4 + (thrust / 250) * 0.5, 0.2] }}
                   transition={{ duration: Math.max(0.05, 0.3 - (thrust / 250) * 0.25), repeat: Infinity, ease: "easeInOut" }}
                >
                  <ellipse cx="123" cy="37" rx={4 + thrust * 0.01} ry={11 + thrust * 0.01} />
                  <ellipse cx="123" cy="-37" rx={4 + thrust * 0.01} ry={11 + thrust * 0.01} />
                </motion.g>
              )}

              <g stroke={matStyle.stroke} fill="rgba(255,255,255,0.02)" strokeWidth="1.5" strokeDasharray={matStyle.dash}>
                  {tailType === 'Conventional' && (
                    <>
                      <path d="M 170 -60 L 220 -40 L 220 0 L 140 0 Z" />
                      <motion.path animate={{ d: `M 205 -46 L ${220+visualFlapDeflection} -40 L ${220+visualFlapDeflection} 0 L 205 0 Z` }} fill="rgba(34, 211, 238, 0.15)" stroke="#22D3EE" strokeDasharray="none" transition={{ type: 'spring', bounce: 0.2 }} />
                      <path d="M 170 60 L 220 40 L 220 0 L 140 0 Z" />
                      <motion.path animate={{ d: `M 205 46 L ${220+visualFlapDeflection} 40 L ${220+visualFlapDeflection} 0 L 205 0 Z` }} fill="rgba(34, 211, 238, 0.15)" stroke="#22D3EE" strokeDasharray="none" transition={{ type: 'spring', bounce: 0.2 }} />
                    </>
                  )}
                  {tailType === 'T-Tail' && (
                    <>
                      <path d="M 210 -60 L 230 -60 L 230 60 L 210 60 Z" />
                      <motion.path animate={{ d: `M 220 -60 L ${230+visualFlapDeflection} -60 L ${230+visualFlapDeflection} 60 L 220 60 Z` }} fill="rgba(34, 211, 238, 0.15)" stroke="#22D3EE" strokeDasharray="none" transition={{ type: 'spring', bounce: 0.2 }} />
                    </>
                  )}
                  {tailType === 'V-Tail' && (
                    <>
                      <path d="M 160 -80 L 230 -100 L 210 0 L 150 0 Z" />
                      <motion.path animate={{ d: `M 205 -88 L ${230+visualFlapDeflection} -100 L ${210+visualFlapDeflection} 0 L 195 0 Z` }} fill="rgba(34, 211, 238, 0.15)" stroke="#22D3EE" strokeDasharray="none" transition={{ type: 'spring', bounce: 0.2 }} />
                      <path d="M 160 80 L 230 100 L 210 0 L 150 0 Z" />
                      <motion.path animate={{ d: `M 205 88 L ${230+visualFlapDeflection} 100 L ${210+visualFlapDeflection} 0 L 195 0 Z` }} fill="rgba(34, 211, 238, 0.15)" stroke="#22D3EE" strokeDasharray="none" transition={{ type: 'spring', bounce: 0.2 }} />
                    </>
                  )}
                  {tailType === 'Twin Boom' && (
                    <>
                      <path d="M 40 -80 L 220 -80 L 220 -70 L 40 -70 Z" />
                      <path d="M 40 80 L 220 80 L 220 70 L 40 70 Z" />
                      <path d="M 190 -80 L 220 -80 L 220 80 L 190 80 Z" />
                      <motion.path animate={{ d: `M 205 -80 L ${220+visualFlapDeflection} -80 L ${220+visualFlapDeflection} 80 L 205 80 Z` }} fill="rgba(34, 211, 238, 0.15)" stroke="#22D3EE" strokeDasharray="none" transition={{ type: 'spring', bounce: 0.2 }} />
                    </>
                  )}
              </g>

               {(() => {
                 const tipAdj = sweep > 0 ? tipOffset : 0;
                 const portWing = `M -20 ${rootChord/2} Q ${-20 - visualFlex} ${visualSpan/2} ${-20 + tipAdj} ${visualSpan} L ${-20 + tipAdj + tipChord} ${visualSpan} L ${rootChord/2} ${rootChord/2} Z`;
                 const portFlap = `M ${rootChord/2 - 10} ${rootChord/2} L ${-20 + tipAdj + tipChord - Math.max(10, tipChord*0.2)} ${visualSpan} L ${-20 + tipAdj + tipChord + visualFlapDeflection} ${visualSpan} L ${rootChord/2 + visualFlapDeflection + 10} ${rootChord/2} Z`;

                 const starbWing = `M -20 ${-rootChord/2} Q ${-20 - visualFlex} ${-visualSpan/2} ${-20 + tipAdj} ${-visualSpan} L ${-20 + tipAdj + tipChord} ${-visualSpan} L ${rootChord/2} ${-rootChord/2} Z`;
                 const starbFlap = `M ${rootChord/2 - 10} ${-rootChord/2} L ${-20 + tipAdj + tipChord - Math.max(10, tipChord*0.2)} ${-visualSpan} L ${-20 + tipAdj + tipChord + visualFlapDeflection} ${-visualSpan} L ${rootChord/2 + visualFlapDeflection + 10} ${-rootChord/2} Z`;

                 return (
                   <g stroke={matStyle.stroke} fill="rgba(34, 211, 238, 0.03)" strokeWidth="1.5" strokeDasharray={matStyle.dash} filter={matStyle.filter}>
                     <path d={portWing} />
                     <motion.path animate={{ d: portFlap }} transition={{ type: 'spring', bounce: 0.3 }} fill="rgba(34, 211, 238, 0.15)" stroke="#22D3EE" strokeDasharray="none" filter="none" />
                     
                     {(isStressed || isFractured) && (
                       <motion.g 
                         filter="url(#stress-glow)"
                         animate={isFractured ? { opacity: [0.7, 1, 0.7] } : { opacity: [0.4, 0.8 + stressIntensity * 0.2, 0.4] }}
                         transition={{ duration: isFractured ? 0.3 : Math.max(0.1, 1.2 - stressIntensity), repeat: Infinity, ease: "easeInOut" }}
                       >
                         <line x1="-30" y1="40" x2="30" y2="40" stroke={isFractured ? "#EF4444" : "#F59E0B"} strokeWidth={6 + (stressIntensity * 18)} strokeLinecap="round" />
                         <line x1="-30" y1="-40" x2="30" y2="-40" stroke={isFractured ? "#EF4444" : "#F59E0B"} strokeWidth={6 + (stressIntensity * 18)} strokeLinecap="round" />
                         {isFractured && <circle cx="0" cy="40" r="40" fill="#EF4444" opacity="0.6" />}
                         {isFractured && <circle cx="0" cy="-40" r="40" fill="#EF4444" opacity="0.6" />}
                       </motion.g>
                     )}

                     <g style={{
                        transform: isFractured ? 'translate(40px, -80px) rotate(-15deg)' : 'none',
                        transformOrigin: '0px -40px',
                        transition: isFractured ? 'transform 0.5s cubic-bezier(0.8, 0, 0.2, 1)' : 'transform 0.2s ease-out'
                     }}>
                       <path d={starbWing} />
                       <motion.path animate={{ d: starbFlap }} transition={{ type: "spring", bounce: 0.3 }} fill="rgba(34, 211, 238, 0.15)" stroke="#22D3EE" strokeDasharray="none" filter="none" />
                       
                       {isFractured && (
                          <path d="M -40 -40 L -25 -55 L -5 -35 L 20 -50 L 40 -40" stroke="#EF4444" strokeWidth="3" fill="none" filter="url(#stress-glow)" strokeDasharray="none"/>
                       )}
                     </g>
                   </g>
                 );
               })()}
              </g>
            </g>
          </svg>
        </div>

        {/* Footer Aero Deck */}
        <div className="p-3 sm:p-6 z-20 flex justify-between items-end pointer-events-none gap-2 shrink-0 relative mt-auto w-full">
           <div className="flex flex-wrap gap-1.5 sm:gap-2 pointer-events-auto shrink-0 self-end">
             <AeroDeckGauge title="Acoustic Sig" value={telemetry.acoustic_db.toFixed(1)} unit="dB" max={140} color="#34D399" />
             <AeroDeckGauge title="L/D Ratio" value={telemetry.ld_ratio.toFixed(1)} unit="R" max={30} color={aoa > 5 ? '#F59E0B' : '#22D3EE'} />
           </div>

           <div className="sm:hidden flex flex-col gap-2 pointer-events-auto shrink-0 justify-end w-[180px] ml-auto pb-1 relative">
             <div className="bg-[#1E293B]/90 backdrop-blur-md border border-[#334155] p-2 rounded shadow-lg w-full">
               <h3 className="text-[7px] uppercase tracking-widest text-slate-400 mb-1">V-n Envelope</h3>
               <div className="h-20 w-full mt-1">
                 <VnEnvelopeGraph 
                   velocity={velocity} 
                   lift={telemetry.lift} 
                   weight={telemetry.weight_n} 
                   wingArea={span * 2} 
                   wingSpan={span} 
                   yieldStrength={telemetry.yield_strength_mpa} 
                 />
               </div>
             </div>
           </div>

           <div className="hidden lg:flex bg-[#0F172A]/80 border border-[#334155] px-3 py-2 items-start rounded max-w-[200px] pointer-events-auto shadow-lg backdrop-blur-md">
              <div className="w-full">
                <div className="text-[7px] text-cyan-500 uppercase mb-1.5 tracking-widest font-bold">Terminal Output</div>
                <div className="text-[9px] font-mono text-slate-400">Yield: {telemetry.yield_strength_mpa.toFixed(1)} MPa</div>
                <div className="text-[9px] font-mono text-slate-400">Stress: {telemetry.stress > 1e12 ? 'MAX' : (telemetry.stress / 1e6).toFixed(1)} MPa</div>
                <div className="text-[9px] font-mono text-slate-400">Total Wgt: {(telemetry.structural_weight * 9.81 / 1000).toFixed(1)} kN</div>
              </div>
           </div>
        </div>
      </main>
    </div>
    </>
  );
}

// -- Reusable UI Components

function ControlSelect({ label, value, options, onChange }: { label: string, value: string, options: string[], onChange: (v: string) => void }) {
  return (
    <div className="space-y-1.5 focus-within:ring-1 ring-cyan-500/50 rounded transition-all">
      <label className="text-[10px] uppercase font-semibold tracking-wider text-slate-400">{label}</label>
      <div className="relative">
        <select 
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full appearance-none bg-[#0F172A] border border-[#334155] text-xs p-2 rounded text-cyan-400 outline-none focus:border-cyan-500 transition-colors cursor-pointer font-mono"
        >
          {options.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
        <ChevronDown className="w-4 h-4 absolute right-2 top-1/2 -translate-y-1/2 text-cyan-600 pointer-events-none" />
      </div>
    </div>
  );
}

function ControlSlider({ label, value, min, max, step = 1, onChange }: { label: string, value: number, min: number, max: number, step?: number, onChange: (v: number) => void }) {
  return (
    <div className="space-y-2">
      <div className="flex justify-between text-[10px] font-semibold tracking-wider uppercase">
        <span className="text-slate-400">{label}</span>
        <span className="font-mono text-cyan-400">{value.toLocaleString()}</span>
      </div>
      <input 
        type="range" 
        min={min} max={max} step={step} 
        value={value} 
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full h-1 bg-[#1E293B] rounded-full appearance-none cursor-pointer"
      />
      <div className="flex justify-between text-[9px] text-slate-600 font-mono mt-1">
        <span>{min}</span>
        <span>{max}</span>
      </div>
    </div>
  );
}

function HudMetricCard({ label, value, highlight }: { label: string, value: string, highlight?: boolean }) {
  return (
    <div className={cn("bg-[#1E293B]/80 backdrop-blur-md border px-2 py-1.5 sm:px-3 sm:py-1.5 rounded shadow-lg transition-colors w-full", highlight ? "border-[#F59E0B]" : "border-[#334155]")}>
      <div className={cn("text-[6px] sm:text-[7px] uppercase tracking-widest mb-0.5 sm:mb-1 whitespace-nowrap", highlight ? "text-[#F59E0B]" : "text-slate-500")}>{label}</div>
      <div className={cn("text-sm sm:text-base font-mono leading-none", highlight ? "text-amber-100" : "text-slate-200")}>{value}</div>
    </div>
  );
}

function AeroDeckGauge({ title, value, unit, max, color }: { title: string, value: string, unit: string, max: number, color: string }) {
  const percentage = Math.min(100, Math.max(0, (Number(value) / max) * 100));
  return (
    <div className="bg-[#1E293B]/80 backdrop-blur-md border border-[#334155] px-2 py-1.5 sm:px-3 sm:py-2 rounded flex flex-col min-w-[75px] sm:min-w-[90px] shadow-lg">
      <div className="text-[6px] sm:text-[7px] uppercase tracking-widest text-slate-400 mb-1 sm:mb-1.5">{title}</div>
      <div className="flex items-end gap-1 mb-1 sm:mb-1.5">
        <span className="text-base sm:text-lg lg:text-xl font-mono leading-none text-slate-100">{value}</span>
        <span className="text-[6px] sm:text-[8px] font-mono text-slate-500 uppercase mb-0.5">{unit}</span>
      </div>
      <div className="w-full h-1 sm:h-1.5 bg-[#0F172A] rounded-full overflow-hidden">
         <motion.div className="h-full rounded-full transition-colors duration-500" style={{ backgroundColor: color }} animate={{ width: `${percentage}%` }} transition={{ type: "spring", stiffness: 50, damping: 20 }} />
      </div>
    </div>
  );
}

const VnEnvelopeGraph = React.memo(({ velocity, lift, weight, wingArea, wingSpan, yieldStrength }: { velocity: number, lift: number, weight: number, wingArea: number, wingSpan: number, yieldStrength: number }) => {
  const structural_constant = 5000;
  const CL_max = 1.5;
  const CL_min = -1.0;

  const L_max_struct = (yieldStrength * structural_constant) / wingSpan;
  const n_max = L_max_struct / Math.max(1, weight); 
  const n_min = -0.4 * n_max;

  const data = [];
  for (let v = 0; v <= 400; v += 10) {
    const q = 0.5 * 1.225 * Math.pow(v, 2) * wingArea;
    let stall_positive = (q * CL_max) / weight;
    let stall_negative = (q * CL_min) / weight;

    if (stall_positive > n_max) stall_positive = n_max;
    if (stall_negative < n_min) stall_negative = n_min;

    data.push({ v, envelope: [stall_negative, stall_positive] });
  }

  const q_current = 0.5 * 1.225 * Math.pow(velocity, 2) * wingArea;
  let exact_pos = (q_current * CL_max) / weight;
  let exact_neg = (q_current * CL_min) / weight;
  if (exact_pos > n_max) exact_pos = n_max;
  if (exact_neg < n_min) exact_neg = n_min;

  const current_n = lift / weight;
  const isBreached = current_n > exact_pos || current_n < exact_neg;
  const dotColor = isBreached ? '#EF4444' : '#22D3EE';
  const yAxisMax = Math.ceil(n_max * 1.2);
  const yAxisMin = Math.floor(n_min * 1.2);

  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 5, right: 10, left: -25, bottom: 10 }}>
        <XAxis dataKey="v" type="number" domain={[0, 400]} label={{ value: 'Velocity (m/s)', position: 'insideBottom', offset: -10, fill: '#64748b', fontSize: 7, textAnchor: 'middle' }} tick={false} axisLine={{ stroke: '#334155' }} />
        <YAxis label={{ value: 'Load Factor (G)', angle: -90, position: 'insideLeft', offset: 15, fill: '#64748b', fontSize: 7, textAnchor: 'middle' }} tick={{ fontSize: 7, fill: '#64748b' }} domain={[yAxisMin, yAxisMax]} axisLine={{ stroke: '#334155' }} tickLine={false} tickCount={5} />
        <Area type="monotone" dataKey="envelope" stroke="#06b6d4" fill="#06b6d4" fillOpacity={0.15} strokeWidth={1.5} isAnimationActive={false} />
        <ReferenceDot x={velocity} y={current_n} r={3.5} fill={dotColor} stroke={isBreached ? 'rgba(239,68,68,0.4)' : 'rgba(34,211,238,0.4)'} strokeWidth={5} isAnimationActive={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
});
