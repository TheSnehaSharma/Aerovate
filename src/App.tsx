import React, { useState, useEffect, useRef } from 'react';
import { Activity, AlertTriangle, ChevronDown, Menu, X, Download, Home } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, ReferenceDot, ResponsiveContainer } from 'recharts';
import { motion, AnimatePresence } from 'motion/react';
import clsx from 'clsx';
import { twMerge } from 'tailwind-merge';

import materialLibrary from './material_library.json';
import airfoilDatabase from './airfoil_database.json';

const AIRFOIL_MAP: Record<string, string> = {
  'NACA 0012': 'n0012',
  'Clark Y':   'clarky',
  'NACA 4412': 'naca4412',
  'S1223':     's1223',
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
  const [airfoil, setAirfoil] = useState<Airfoil>('Clark Y');
  const [tailType, setTailType] = useState<TailType>('Conventional');
  const [sweep, setSweep] = useState<number>(15);
  const [taper, setTaper] = useState<number>(0.6);
  const [span, setSpan] = useState<number>(15);
  const [velocity, setVelocity] = useState<number>(80);
  const [aoa, setAoa] = useState<number>(5);
  const [thrust, setThrust] = useState<number>(50); // kN
  const [material, setMaterial] = useState<Material>('Aluminum 6061-T6');
  const [isSidebarOpen, setIsSidebarOpen] = useState<boolean>(true);
  const [showHero, setShowHero] = useState<boolean>(true);
  const [showAssumptions, setShowAssumptions] = useState<boolean>(false);
  const [showMethodology, setShowMethodology] = useState<boolean>(false);
  const [telemetry, setTelemetry] = useState<Telemetry>({
    cl: 0, cd: 0, lift: 0, drag: 0, stress: 0, fos: 10, n: 1, 
    acoustic_db: 50, ld_ratio: 0, weight_fraction: 0.1, 
    structural_weight: 1000, status: 'BOOTING API...', 
    color: '#94A3B8', v_stall: 0, takeoff_ready: false, 
    weight_n: 10000, yield_strength_mpa: 276, range_km: 0
  });

  const planeRef = useRef<SVGGElement>(null);
  const fanPortRef = useRef<SVGGElement>(null);
  const fanStarbRef = useRef<SVGGElement>(null);
  const targetFlightOffset = useRef({ x: 0, y: 0, rot: 0 });
  const currentFlightOffset = useRef({ x: 0, y: 0, rot: 0 });
  const getMaterialStyle = () => {
    switch(material) {
      case 'Carbon Fiber': return { stroke: '#0F2836', dash: '3 2', filter: 'none', flexMult: 0.01, name: 'Carbon' };
      case 'Titanium Grade 5': return { stroke: '#94A3B8', dash: 'none', filter: 'url(#shimmer-glow)', flexMult: 0.15, name: 'Titanium' };
      case 'Sitka Spruce': return { stroke: '#B45309', dash: 'none', filter: 'none', flexMult: 1.5, name: 'Sitka Spruce' };
      case 'Maraging Steel': return { stroke: '#64748B', dash: 'none', filter: 'none', flexMult: 0.05, name: 'Steel' };
      default: return { stroke: '#D1D5DB', dash: 'none', filter: 'none', flexMult: 0.2, name: 'Aluminum' };
    }
  };
  const matStyle = getMaterialStyle();
  const particlesRef = useRef(Array.from({ length: 120 }).map((_, i) => ({
    id: i, x: (Math.random() * 2400) - 1200, y: (Math.random() * 1600) - 800,
    length: 60 + Math.random() * 100, baseOpacity: 0.15 + Math.random() * 0.4,
    angle: 0, r: 10, cx: 0, cy: 0
  })));

  // =======================================================================
  // LIVE API CONNECTION (Strict ML Data Only)
  // =======================================================================
  useEffect(() => {
    const fetchRealPhysics = async () => {
      const jsonKey = AIRFOIL_MAP[airfoil];
      const db = (airfoilDatabase as any).default || airfoilDatabase;
      const realCoeffs = db[jsonKey];

      if (!realCoeffs) {
        setTelemetry(t => ({ ...t, status: `MISSING DATA: ${jsonKey}`, color: "#F59E0B" }));
        return;
      }
      const baseWingArea = span * 2; 
      const currentMat = materialLibrary[material as keyof typeof materialLibrary];
      const totalWeightN = (baseWingArea * 15 + thrust * 15) * 9.81;

      try {
        const payload = {
          alpha: aoa,
          velocity: velocity,
          chord_length: 2.0,
          wing_span: span,
          wing_area: baseWingArea,
          material_yield_strength: currentMat.yield_strength_mpa,
          weight_n: totalWeightN,
          thrust_n: thrust * 1000,
          geometry_coeffs: realCoeffs
        };
        
        const response = await fetch('/api/v1/simulate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        
        if (!response.ok) throw new Error("API error");
        
        const data = await response.json();

        
        console.log("✈️ Telemetry Received:", data);

        let uiColor = '#94A3B8'; // Slate 400
        if (data.structure.FoS <= 1.0) uiColor = '#475569'; // Slate 600
        else if (velocity <= data.performance.V_stall_m_s) uiColor = '#64748B'; // Slate 500
        else if (data.structure.FoS <= 1.5) uiColor = '#64748B'; // Slate 500
          setTelemetry(prev => ({
            ...prev,
            
            cl: data.aero?.Cl ?? 0,
            cd: data.aero?.Cd ?? 0,
            lift: data.aero?.Lift_N ?? 0,
            drag: data.aero?.Drag_N ?? 0,
            
            
            ld_ratio: (data.aero?.Cl / Math.max(0.001, data.aero?.Cd)) || 0,

            
            stress: data.structure?.Stress_MPa ?? 0,
            fos: data.structure?.FoS ?? 0,

            
            v_stall: data.performance?.V_stall_m_s ?? 0,
            takeoff_ready: data.performance?.Takeoff_Ready ?? false,
            range_km: data.performance?.Range_km ?? 0,

            
            acoustic_db: data.noise?.Noise_dB ?? 0,

            
            status: data.status,
            color: data.status === "FRACTURE" ? "#e11d48" : // rose-600
                   data.status === "STRESSED" ? "#d97706" : "#2563eb", // amber-600 : blue-600

            
            yield_strength_mpa: currentMat.yield_strength_mpa,
            weight_n: totalWeightN
          }));

      } catch (error) {
        console.error(`[Error] ML Backend API unreachable. Reason:`, (error as Error).message);
        
        
        setTelemetry(prev => ({ 
          ...prev, 
          cl: 0, cd: 0, lift: 0, drag: 0, stress: 0, fos: 0, n: 0,
          acoustic_db: 0, ld_ratio: 0, v_stall: 0, range_km: 0, takeoff_ready: false,
          status: "API CONNECTION FAILED", 
          color: "#e11d48", // rose-600
          weight_n: totalWeightN,
          yield_strength_mpa: currentMat.yield_strength_mpa
        }));
      }
    };

    const handler = setTimeout(() => {
      fetchRealPhysics();
    }, 150); // 150ms debounce

    return () => clearTimeout(handler);
  }, [span, airfoil, aoa, sweep, velocity, material, thrust]);

  
  const isFractured = telemetry.fos <= 1.0 && telemetry.status !== "API CONNECTION FAILED";
  const isStressed = telemetry.fos <= 1.5 && telemetry.fos > 1.0;
  const stressIntensity = Math.min(1, Math.max(0, 1.5 - telemetry.fos) / 0.5);

  let noiseColor = '#CBD5E1'; 
  if (telemetry.acoustic_db > 100) noiseColor = '#475569'; 
  else if (telemetry.acoustic_db > 80) noiseColor = '#94A3B8'; 

  const noiseColorRef = useRef<string>(noiseColor);
  useEffect(() => { noiseColorRef.current = noiseColor; }, [noiseColor]);

  
  useEffect(() => {
    let rafId: number;
    let startFrame = performance.now();

    const loop = (time: number) => {
      
      if (planeRef.current) {
        currentFlightOffset.current.x += (targetFlightOffset.current.x - currentFlightOffset.current.x) * 0.05;
        currentFlightOffset.current.y += (targetFlightOffset.current.y - currentFlightOffset.current.y) * 0.05;
        currentFlightOffset.current.rot += (targetFlightOffset.current.rot - currentFlightOffset.current.rot) * 0.05;

        let tx = currentFlightOffset.current.x;
        let ty = currentFlightOffset.current.y;

        if (isStressed) {
          const intensity = (1.5 - telemetry.fos) / 0.5; 
          const maxShake = 6 * Math.pow(intensity, 2); 
          tx += (Math.random() - 0.5) * maxShake;
          ty += (Math.random() - 0.5) * maxShake;
        }
        
        planeRef.current.style.transform = `translate(${tx}px, ${ty}px) rotate(${currentFlightOffset.current.rot}deg)`;
      }

      
      if (fanPortRef.current && fanStarbRef.current) {
        const rpm = (velocity * 2) + Math.max(0, thrust * 0.1);
        fanPortRef.current.setAttribute('transform', `translate(125, 37) rotate(${time * rpm * 0.05})`);
        fanStarbRef.current.setAttribute('transform', `translate(125, -37) rotate(${time * rpm * 0.05})`);
      }

      
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

  
  const visualSpan = 50 + ((span - 2) / 28) * 250;
  const flexOffset = (telemetry.lift / 150000) * matStyle.flexMult * (span / 15);
  const visualFlex = Math.min(60, flexOffset); 
  const visualFlapDeflection = (aoa > 0 ? aoa * 1.5 : 0) + (velocity / 15); 
  const rootChord = 80 + (sweep * 0.5); 
  const tipChord = rootChord * taper;
  const tipOffset = visualSpan * Math.tan((sweep * Math.PI) / 180);

  const isPointerDownRef = useRef(false);
  const pressTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handlePointerDown = () => {
    pressTimeoutRef.current = setTimeout(() => {
      isPointerDownRef.current = true;
    }, 50);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isPointerDownRef.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;
    const mx = e.clientX - rect.left - centerX;
    const my = e.clientY - rect.top - centerY;
    
    targetFlightOffset.current.rot = (-my / centerY) * 25; 
    targetFlightOffset.current.y = (my / centerY) * 60; 
    targetFlightOffset.current.x = (mx / centerX) * 60;
  };

  const handlePointerUpOrLeave = () => {
    if (pressTimeoutRef.current) clearTimeout(pressTimeoutRef.current);
    isPointerDownRef.current = false;
    targetFlightOffset.current = { x: 0, y: 0, rot: 0 };
  };

  return (
    <>
      <AnimatePresence>
        {showHero && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.5 }}
            className="fixed inset-0 z-50 bg-[#01080A] text-zinc-300 flex flex-col overflow-y-auto overflow-x-hidden"
          >
            {/* Hero Image Section */}
            <div className="relative w-full flex-none flex flex-col justify-center min-h-[70vh] sm:min-h-[60vh] pb-16">
              <div className="absolute top-0 left-0 w-full h-full z-0 pointer-events-none">
                 <img src="https://images.unsplash.com/photo-1436491865332-7a61a109cc05?auto=format&fit=crop&q=80&w=2000" alt="Aerospace Concept" className="w-full h-full object-cover opacity-60 mix-blend-luminosity object-top" />
                 <div className="absolute inset-0 bg-gradient-to-b from-[#01080A]/30 via-[#020D12]/70 to-[#05131A]" />
              </div>

              <div className="w-full max-w-[1800px] mx-auto px-4 sm:px-6 pt-24 sm:pt-32 w-full relative z-10">
                {/* Top Hero Layout */}
                <div className="w-full text-left">
                  <div className="mb-6">
                    <h1 className="text-6xl sm:text-8xl font-black text-white tracking-tight mb-4 font-sans drop-shadow-lg">
                      AEROVATE
                    </h1>
                    <p className="text-xl sm:text-2xl text-zinc-300 font-medium tracking-wide w-full max-w-[90%]">
                      Rapid Aero Prototyping
                    </p>
                  </div>
                  
                  <p className="text-lg text-zinc-300 mb-10 w-full max-w-[90%] leading-relaxed">
                    Bridge the gap between imagination and physics. Aerovate provides instantaneous, simulated predictions for aerodynamic properties, enabling you to explore structural dynamics in an intuitive educational sandbox environment.
                  </p>

                  <div className="flex flex-col sm:flex-row flex-wrap gap-4 mb-6 w-full max-w-[90%]">
                    <button 
                      onClick={() => setShowHero(false)}
                      className="bg-black text-white hover:bg-white hover:text-black border border-white px-8 py-4 rounded-sm font-semibold flex items-center justify-center gap-2 transition-colors cursor-pointer w-full sm:w-auto shadow-[0_0_20px_rgba(255,255,255,0.2)]"
                    >
                      <Activity className="w-5 h-5"/> Launch Design Lab
                    </button>
                    <button onClick={() => setShowMethodology(true)} className="bg-zinc-800/80 hover:bg-zinc-700/80 border border-zinc-600 text-zinc-200 px-8 py-4 rounded-sm font-semibold flex items-center justify-center gap-2 transition-colors cursor-pointer w-full sm:w-auto group backdrop-blur-sm">
                      <Activity className="w-5 h-5 text-zinc-400 group-hover:text-zinc-300 transition-colors"/> How does it work?
                    </button>
                  </div>
                  <p className="text-xs text-zinc-400 mt-4 w-full max-w-[80%]">
                    Take your analysis further. Download the foundational surrogate model (.onnx) for your own inference or datasets to train your own model.
                  </p>
                </div>
              </div>
            </div>

            <div className="flex-1 w-full bg-[#030A0E] relative z-20 py-16">
              <div className="w-full max-w-[1800px] mx-auto px-4 sm:px-6">
              
              {/* Real-Time Parameter Analysis */}
              <div className="mb-16">
                <div className="border-b border-zinc-700/50 pb-2 mb-6">
                  <h2 className="text-2xl font-bold text-white tracking-tight uppercase text-base">Real-Time Parameter Analysis</h2>
                </div>
                <p className="text-zinc-400 text-sm mb-6">Test the limits of your designs dynamically:</p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="bg-zinc-800/50 border border-zinc-700/50 p-6 rounded-sm">
                     <h4 className="text-zinc-200 font-semibold mb-3 text-sm">Lift & Drag Sensitivity</h4>
                     <p className="text-xs text-zinc-400">Observe how geometry and angle of attack alterations shift the L/D ratio in real-time.</p>
                  </div>
                  <div className="bg-zinc-800/50 border border-zinc-700/50 p-6 rounded-sm">
                     <h4 className="text-zinc-200 font-semibold mb-3 text-sm">Noise Signature</h4>
                     <p className="text-xs text-zinc-400">Understand the aeroacoustic impacts of airspeed, configuration, and turbulence.</p>
                  </div>
                  <div className="bg-zinc-800/50 border border-zinc-700/50 p-6 rounded-sm">
                     <h4 className="text-zinc-200 font-semibold mb-3 text-sm">Structural Stress</h4>
                     <p className="text-xs text-zinc-400">Monitor load factors and yield strength margins across flight envelopes and material selections.</p>
                  </div>
                </div>
              </div>

              {/* Explanation, Goal & Limitations Section */}
              <div className="mb-16 space-y-12">
                
                <div>
                  <div className="border-b border-zinc-700/50 pb-2 mb-6">
                    <h2 className="text-2xl font-bold text-white tracking-tight uppercase text-base">Instant Aerodynamic Insight, Anchored in Physics</h2>
                  </div>
                  <p className="text-zinc-300 text-sm leading-relaxed w-full max-w-[1800px]">
                    Aerovate utilizes a two-stage hybrid architecture. First, pre-trained AI surrogate models analyze your design inputs to provide near-instant predictions of complex aerodynamic and acoustic coefficients, bypassing computationally expensive simulations. Second, these coefficients are integrated into classical aerospace physics equations to calculate expected physical forces and structural stresses, ensuring results are scientifically grounded in fundamental principles.
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-start">
                  <div>
                    <h2 className="text-white tracking-tight font-semibold uppercase text-sm mb-3 flex items-center gap-2">
                       The Goal: Accelerating Iteration
                    </h2>
                    <p className="text-zinc-400 text-sm leading-relaxed mb-6 max-w-full">
                      AEROVATE aims to drastically accelerate the conceptual design phase by replacing traditional Computational Fluid Dynamics (CFD) with a trained surrogate model. While CFD is essential for final validation, it is too slow for real-time intuition building. AEROVATE predicts results approximately, allowing for instant feedback loops.
                    </p>
                  </div>
                  <div className="flex flex-col gap-0 border border-zinc-700/80 rounded-sm overflow-hidden md:max-w-[320px] max-w-full mt-2 shadow-2xl bg-[#02080B]">
                     <div className="flex items-center justify-between text-[11px] px-4 py-2.5 border-b border-zinc-800">
                        <div className="text-zinc-500 uppercase tracking-wider font-semibold">Traditional CFD</div>
                        <div className="font-mono text-zinc-400">~2-12 Hrs</div>
                     </div>
                     <div className="flex items-center justify-between text-[11px] px-4 py-2.5 border-l-2 border-blue-500 bg-blue-900/10">
                        <div className="text-blue-400 uppercase tracking-wider font-bold">AEROVATE AI</div>
                        <div className="font-mono text-white font-bold">~150 ms</div>
                     </div>
                  </div>
                </div>
                
                {/* LIMITATIONS */}
                <div className="bg-amber-950/20 border border-amber-900/40 p-5 w-full rounded-sm">
                  <h3 className="text-amber-500 font-semibold mb-2 flex items-center gap-2 uppercase text-sm tracking-wider">
                     <AlertTriangle className="w-5 h-5"/> Limitation Statement
                  </h3>
                  <p className="text-amber-200/70 text-sm leading-relaxed">
                    AEROVATE is based on an ML model and can give wrong results. It cannot handle extreme conditions nor simulate real world environments. Not suitable for safety-critical engineering, structural verification, or flight certification.
                  </p>
                </div>
              </div>
              
              </div>
            </div>

            {/* Footer */}
            <div className="w-full border-t border-zinc-800 py-8 bg-[#010507] relative z-10">
              <div className="max-w-4xl mx-auto px-4 sm:px-6 flex flex-col items-center justify-center gap-4 text-center">
                 <div className="text-sm text-zinc-500 max-w-3xl px-4 leading-relaxed">
                    AEROVATE operates on predicting surrogate models solely for educational demonstration. It is not a replacement for CFD models and should not be used for designing airplanes. Just for ideation.
                 </div>
                 <div className="text-xs text-zinc-600 font-mono mt-2">
                    © 2026 AEROVATE Project. All rights reserved.
                 </div>
              </div>
            </div>
          </motion.div>
        )}

        {showMethodology && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="fixed inset-0 z-[60] bg-[#01080A]/60 backdrop-blur-md text-zinc-300 flex flex-col overflow-y-auto"
          >
            <div className="sticky top-0 w-full border-b border-zinc-700/50 bg-[#01080A]/40 backdrop-blur-xl z-20 px-6 py-4 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold text-white tracking-tight">How does it work?</h2>
                <p className="text-xs text-zinc-400">A manual of AI architecture, formulas, and datasets.</p>
              </div>
              <button onClick={() => setShowMethodology(false)} className="p-2 bg-zinc-800 hover:bg-zinc-700 rounded-md text-zinc-300 transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="max-w-5xl mx-auto px-4 sm:px-6 py-12 space-y-12 relative z-10 w-full">
              
              <section>
                <h3 className="text-2xl font-bold text-white mb-4">Formulas</h3>
                <p className="text-sm text-zinc-400 mb-6 leading-relaxed">
                  Aerovate combines fundamental aerospace formulas with an AI surrogate model designed specifically for early-stage conceptual design iteration. The AI predicts the aerodynamic coefficients which are then fed into classical formulas.
                </p>
                
                <div className="overflow-x-auto bg-[#05131A]/20 border border-[#121A2F] rounded-lg">
                    <table className="w-full text-left border-collapse text-sm">
                        <thead>
                            <tr className="border-b border-[#0F2836] text-zinc-300 bg-[#05131A]/40">
                                <th className="py-3 pl-5 pr-4 font-semibold whitespace-nowrap">Parameter</th>
                                <th className="py-3 pr-4 font-semibold whitespace-nowrap">Symbol</th>
                                <th className="py-3 pr-5 font-semibold">Formula</th>
                            </tr>
                        </thead>
                        <tbody className="text-zinc-400 divide-y divide-[#121A2F]/50">
                            <tr className="hover:bg-[#05131A]/30 transition-colors">
                                <td className="py-3 pl-5 pr-4 text-white">Lift Force</td>
                                <td className="py-3 pr-4 font-mono text-zinc-300">L</td>
                                <td className="py-3 pr-5 font-mono text-zinc-300">L = &frac12; &rho; V&sup2; S C<sub>L</sub></td>
                            </tr>
                            <tr className="hover:bg-zinc-800/30 transition-colors">
                                <td className="py-3 pl-5 pr-4 text-white">Drag Force</td>
                                <td className="py-3 pr-4 font-mono text-zinc-300">D</td>
                                <td className="py-3 pr-5 font-mono text-zinc-300">D = &frac12; &rho; V&sup2; S C<sub>D</sub></td>
                            </tr>
                            <tr className="hover:bg-zinc-800/30 transition-colors">
                                <td className="py-3 pl-5 pr-4 text-white">Wing Area</td>
                                <td className="py-3 pr-4 font-mono text-zinc-300">S</td>
                                <td className="py-3 pr-5 font-mono text-zinc-300">S = b &times; (C<sub>root</sub> + C<sub>tip</sub>) / 2</td>
                            </tr>
                            <tr className="hover:bg-zinc-800/30 transition-colors">
                                <td className="py-3 pl-5 pr-4 text-white">Stall Speed</td>
                                <td className="py-3 pr-4 font-mono text-zinc-300">V<sub>stall</sub></td>
                                <td className="py-3 pr-5 font-mono text-zinc-300">V<sub>stall</sub> = &radic;(2W / (&rho; S C<sub>L,max</sub>))</td>
                            </tr>
                            <tr className="hover:bg-zinc-800/30 transition-colors">
                                <td className="py-3 pl-5 pr-4 text-white">Structural Weight</td>
                                <td className="py-3 pr-4 font-mono text-zinc-300">W<sub>struct</sub></td>
                                <td className="py-3 pr-5 font-mono text-zinc-300">W<sub>struct</sub> = S &times; t<sub>avg</sub> &times; &rho;<sub>mat</sub> &times; g</td>
                            </tr>
                            <tr className="hover:bg-[#05131A]/30 transition-colors">
                                <td className="py-3 pl-5 pr-4 text-white">Load Factor</td>
                                <td className="py-3 pr-4 font-mono text-zinc-300">n</td>
                                <td className="py-3 pr-5 font-mono text-zinc-300">n = L / W<sub>total</sub></td>
                            </tr>
                            <tr className="hover:bg-[#05131A]/30 transition-colors">
                                <td className="py-3 pl-5 pr-4 text-white">Structural Stress</td>
                                <td className="py-3 pr-4 font-mono text-zinc-300">&sigma;</td>
                                <td className="py-3 pr-5 font-mono text-zinc-300">&sigma; = (L/2 &times; b/4) / I<sub>root</sub></td>
                            </tr>
                        </tbody>
                    </table>
                </div>
                <div className="mt-4 text-xs text-zinc-500 leading-relaxed px-2">
                    * Where <strong className="text-zinc-400">&rho;</strong> is air density, <strong className="text-zinc-400">V</strong> is velocity, <strong className="text-zinc-400">b</strong> is wing span, <strong className="text-zinc-400">t<sub>avg</sub></strong> is average wing thickness, <strong className="text-zinc-400">&rho;<sub>mat</sub></strong> is material density, and <strong className="text-zinc-400">I<sub>root</sub></strong> is the area moment of inertia at the wing root.
                </div>
              </section>

              <section>
                 <h3 className="text-2xl font-bold text-white mb-4">Assumptions & Constraints</h3>
                 <div className="bg-[#05131A]/30 border border-[#121A2F] p-6 rounded-lg text-sm text-zinc-400 space-y-3">
                   <p><strong className="text-zinc-300">Air Density (&rho;):</strong> Sea-level standard ISA (1.225 kg/m&sup3;) is assumed.</p>
                   <p><strong className="text-zinc-300">Steady State Flow:</strong> Equations ignore transient aeroelastic effects, dynamic stall, and unsteady wake shedding.</p>
                   <p><strong className="text-zinc-300">Rigid Body:</strong> The wing structure is assumed infinitely stiff (no deformation under aerodynamic load).</p>
                   <p><strong className="text-zinc-300">Dimensionality:</strong> Lift and drag are extrapolated from 2D airfoil data to 3D Finite Wing Theory using standard correction factors. Complex 3D cross-flows are ignored.</p>
                   <p><strong className="text-zinc-300">Payload & Systems (W<sub>payload</sub>):</strong> Modeled as a fixed mass or fixed fraction of total lifting capacity unless customized.</p>
                 </div>
              </section>

              <section>
                 <h3 className="text-2xl font-bold text-white mb-4">Limitations</h3>
                 <div className="bg-[#05131A]/30 border border-[#121A2F] p-6 rounded-lg text-sm text-zinc-400 space-y-3">
                   <p className="text-zinc-300 font-semibold mb-2 flex items-center gap-2 uppercase text-xs tracking-wider"><AlertTriangle className="w-4 h-4"/> Predictive Boundaries</p>
                   <ul className="list-disc list-outside ml-5 space-y-2 mt-2">
                     <li><strong className="text-white">Structural Proxies:</strong> Stress and load calculations utilize hardcoded constant multipliers rather than detailed material density or precise cross-sectional beam theory computations.</li>
                     <li><strong className="text-white">Simplified Aerodynamics:</strong> The model abstracts away intricate 3D aerodynamic phenomena such as wingtip vortices (induced drag), fixing key variables like chord length and maximum lift coefficient for computational speed.</li>
                     <li><strong className="text-white">Conceptual Performance Limits:</strong> Performance estimations, including aircraft range, use simplified surrogate formulas. These intentionally omit complex variables like specific fuel consumption metrics and dynamic fuel weight fractions.</li>
                     <li><strong className="text-white">Locked Atmospheric Environment:</strong> To maintain rapid inference, the engine assumes incompressible flow conditions and permanently constrains the simulated atmosphere to standard Sea Level air density (1.225 kg/m&sup3;). Calculations at high-altitudes or high-speeds may be invalid.</li>
                     <li><strong className="text-white">Approximated Acoustic Inputs:</strong> The acoustic model's inputs are simplified versions of reality. Frequency is fixed, and parameters like suction side displacement are linearly approximated based on the vehicle's angle of attack.</li>
                   </ul>
                 </div>
              </section>

              <section>
                 <h3 className="text-2xl font-bold text-white mb-4">Datasets</h3>
                 <p className="text-sm text-zinc-400 mb-6 leading-relaxed">
                   The surrogate models were trained on industry-standard aerodynamics open datasets directly compiled into tabular formats.
                 </p>
                 <div className="grid sm:grid-cols-2 gap-4">
                    <a href="https://archive.ics.uci.edu/dataset/291/airfoil+self+noise" target="_blank" rel="noreferrer" className="block bg-[#01080A] hover:bg-zinc-900 border border-zinc-800 p-5 rounded-sm transition-colors group">
                       <h4 className="text-zinc-200 font-semibold mb-1 group-hover:text-white flex justify-between items-center">NASA Airfoil Noise Dataset <Activity className="w-4 h-4 opacity-50 group-hover:opacity-100 transition-opacity"/></h4>
                       <p className="text-xs text-zinc-400">Used for predicting acoustic signatures based on frequency, angle of attack, chord length, free-stream velocity, and displacement thickness.</p>
                    </a>
                    <a href="https://m-selig.ae.illinois.edu/ads/coord_database.html" target="_blank" rel="noreferrer" className="block bg-[#01080A] hover:bg-zinc-900 border border-zinc-800 p-5 rounded-sm transition-colors group">
                       <h4 className="text-zinc-200 font-semibold mb-1 group-hover:text-white flex justify-between items-center">UIUC Airfoil Coordinates <Activity className="w-4 h-4 opacity-50 group-hover:opacity-100 transition-opacity"/></h4>
                       <p className="text-xs text-zinc-400">Foundational aerodynamic geometric data for calculating airfoil performance and CFD baseline interpolations.</p>
                    </a>
                 </div>
              </section>

              <section>
                 <h3 className="text-2xl font-bold text-white mb-4">Models & Accuracy Metrics</h3>
                 <p className="text-sm text-zinc-400 mb-6 leading-relaxed">
                     The core predictive engine is powered by an <strong className="text-zinc-200">XGBoost (Extreme Gradient Boosting)</strong> model, selected for its speed, interpretability, and performance on tabular engineering datasets. The metrics below demonstrate the baseline errors reported during testing against holdout aerodynamic data.
                 </p>
                 
                 <div className="grid sm:grid-cols-2 gap-4 mb-6">
                    <div className="bg-[#01080A] border border-zinc-800 p-5 rounded-sm">
                       <h4 className="text-white font-semibold mb-4 flex items-center gap-2">Coefficient Model</h4>
                       <dl className="space-y-3 text-sm">
                           <div className="flex justify-between items-center pb-2 border-b border-zinc-800/50">
                               <dt className="text-zinc-400">Lift Accuracy (R&sup2;)</dt>
                               <dd className="font-mono text-zinc-300">0.9841 (98.41%)</dd>
                           </div>
                           <div className="flex justify-between items-center pt-1">
                               <dt className="text-zinc-400">Drag Accuracy (R&sup2;)</dt>
                               <dd className="font-mono text-zinc-300">0.9136 (91.36%)</dd>
                           </div>
                       </dl>
                    </div>
                    <div className="bg-[#01080A] border border-zinc-800 p-5 rounded-sm">
                       <h4 className="text-white font-semibold mb-4 flex items-center gap-2">Acoustic / Noise Model</h4>
                       <dl className="space-y-3 text-sm">
                           <div className="flex justify-between items-center pb-2 border-b border-zinc-800/50">
                               <dt className="text-zinc-400">Mean Absolute Error (MAE)</dt>
                               <dd className="font-mono text-zinc-300">0.86 dB</dd>
                           </div>
                           <div className="flex justify-between items-center pt-1">
                               <dt className="text-zinc-400">Accuracy Score (R&sup2;)</dt>
                               <dd className="font-mono text-zinc-300">0.9643 (96.43%)</dd>
                           </div>
                       </dl>
                    </div>
                 </div>

                 <div className="flex items-start md:items-center gap-4">
                   <button onClick={() => alert("Downloading models.zip...")} className="bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-600 px-6 py-3 rounded-sm font-bold flex items-center justify-center gap-2 transition-colors cursor-pointer text-sm shadow-sm">
                      <Download className="w-4 h-4"/> Download Models (.zip)
                   </button>
                 </div>
              </section>

            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="h-[100dvh] w-full bg-[#030E14] flex overflow-hidden selection:bg-blue-500/30">
      
      {/* SIDEBAR */}
      <aside className={cn(
        "w-[85vw] sm:w-[300px] shrink-0 bg-[#030E14]/95 border-r border-[#121A2F] flex flex-col z-40 shadow-2xl overflow-y-auto backdrop-blur-xl absolute xl:relative h-full transition-all duration-500 ease-in-out",
        isSidebarOpen ? "translate-x-0" : "-translate-x-full xl:translate-x-0 xl:-ml-[300px]"
      )}>
        <div className="p-6 border-b border-[#121A2F] flex items-start justify-between bg-[#030E14]">
          <div className="space-y-1">
            <h1 className="text-[10px] font-bold tracking-[0.2em] text-zinc-400 uppercase">Design Lab</h1>
            <p className="text-2xl font-black tracking-tight leading-none text-zinc-100">AEROVATE</p>
          </div>
          <div className="flex gap-1 items-center">
            <button className="p-1 text-zinc-400 hover:text-white transition-colors" onClick={() => setShowHero(true)} title="Back to Home">
              <Home className="w-5 h-5" />
            </button>
            <button className="p-1 text-zinc-400 hover:text-white transition-colors" onClick={() => setIsSidebarOpen(false)} title="Close Sidebar">
              <X className="w-6 h-6" />
            </button>
          </div>
        </div>

        <div className="p-6 flex flex-col gap-8">
          <div className="space-y-4">
            <div className="border-l-2 border-zinc-500 pl-2">
              <label className="text-[10px] font-bold uppercase tracking-[0.15em] text-zinc-400 block">Deck A: Geometry</label>
            </div>
            <div className="space-y-4 bg-[#05131A]/30 p-4 rounded-md border border-[#121A2F]">
              <ControlSelect label="Airfoil Profile" value={airfoil} onChange={(v) => setAirfoil(v as Airfoil)} options={['NACA 0012', 'Clark Y', 'NACA 4412', 'S1223', 'FX 63-137']} />
              <ControlSelect label="Tail Config" value={tailType} onChange={(v) => setTailType(v as TailType)} options={['Conventional', 'T-Tail', 'V-Tail', 'Twin Boom']} />
              <ControlSlider label="Wing Sweep (°)" value={sweep} onChange={setSweep} min={0} max={45} />
              <ControlSlider label="Taper Ratio" value={taper} onChange={setTaper} min={0.1} max={1.0} step={0.05} />
              <ControlSlider label="Wing Span (m)" value={span} onChange={setSpan} min={2} max={30} step={0.5} />
            </div>
          </div>

          <div className="space-y-4">
            <div className="border-l-2 border-zinc-500 pl-2">
              <label className="text-[10px] font-bold uppercase tracking-[0.15em] text-zinc-400 block">Deck B: Mission Profile</label>
            </div>
            <div className="space-y-4 bg-[#05131A]/30 p-4 rounded-md border border-[#121A2F]">
              <ControlSlider label="Airspeed (V) [m/s]" value={velocity} onChange={setVelocity} min={10} max={400} />
              <ControlSlider label="Angle of Attack [°]" value={aoa} onChange={setAoa} min={-5} max={20} />
              <ControlSlider label="Thrust Capacity [kN]" value={thrust} onChange={setThrust} min={0} max={250} step={5} />
            </div>
          </div>

          <div className="space-y-4">
            <div className="border-l-2 border-zinc-500 pl-2">
               <label className="text-[10px] font-bold uppercase tracking-[0.15em] text-zinc-400 block">Deck C: Structural Material</label>
            </div>
            <div className="space-y-4 bg-[#05131A]/30 p-4 rounded-md border border-[#121A2F]">
              <ControlSelect label="Material" value={material} onChange={(v) => setMaterial(v as Material)} options={Object.keys(materialLibrary)} />
            </div>
          </div>
        </div>
      </aside>

      {/* MAIN VISUALIZER */}
      <main className="flex-1 relative flex flex-col bg-[#030E14] grid-bg h-full overflow-y-auto sm:overflow-hidden overflow-x-hidden">
        
        {/* HUD Elements Overlay - TOP */}
        <div className="p-3 sm:p-6 z-20 flex justify-between items-start pointer-events-none gap-2 shrink-0 relative w-full">
          <div className="flex gap-2 pointer-events-auto items-start shrink-0">
             <button 
               onClick={() => setIsSidebarOpen(!isSidebarOpen)}
               className="bg-[#05131A]/90 backdrop-blur-md border border-[#0F2836] p-2 rounded shadow-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors mt-[1px]"
             >
               <Menu className="w-5 h-5 sm:w-6 sm:h-6" />
             </button>
             
             <div className="hidden sm:flex flex-col gap-2">
               <div className="bg-[#05131A]/90 backdrop-blur-md border border-[#0F2836] p-2 rounded shadow-lg min-w-[200px]">
               <h3 className="text-[8px] uppercase tracking-widest text-zinc-400 mb-0.5">V-n Envelope Simulation</h3>
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
            <div className="bg-[#05131A]/90 backdrop-blur-md border border-[#0F2836] px-3 py-2 sm:px-4 sm:py-3 rounded-lg flex flex-col items-end min-w-[150px] sm:min-w-[200px] shadow-2xl transition-colors duration-300"
                 style={{ borderRightColor: telemetry.color, borderRightWidth: '4px' }}>
              <span className="text-[7px] sm:text-[8px] uppercase tracking-[0.2em] text-zinc-500 mb-0.5 sm:mb-1 relative group cursor-help">
                State: {telemetry.status}
                {telemetry.status === "API CONNECTION FAILED" && (
                   <div className="absolute hidden group-hover:block right-0 top-full mt-2 w-48 p-2 bg-zinc-800/90 text-zinc-300 border border-zinc-600 rounded text-[9px] normal-case tracking-normal shadow-xl z-50 text-right">
                     Cannot reach the Python FastAPI backend. Check server logs.
                   </div>
                )}
              </span>
              <span className="text-3xl sm:text-4xl font-mono leading-none tracking-tighter" style={{ color: telemetry.color, textShadow: isStressed || isFractured ? `0 0 20px ${telemetry.color}80` : 'none' }}>
                {telemetry.fos.toFixed(2)}
              </span>
              <div className="flex flex-col items-end gap-0.5 sm:gap-1 mt-1 sm:mt-2 text-[7px] sm:text-[8px] uppercase tracking-widest">
                <span className="text-[#94A3B8]">Mat: {matStyle.name}</span>
                <span className={telemetry.takeoff_ready ? "text-zinc-300 font-bold" : "text-zinc-500 font-bold"}>
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
          <div className="absolute top-6 left-1/2 -translate-x-1/2 z-40 pointer-events-none">
             <div className="bg-amber-950/80 text-amber-500 border border-amber-500/50 rounded backdrop-blur-md px-6 py-3 font-semibold text-sm flex items-center justify-center gap-3 shadow-[0_0_30px_rgba(245,158,11,0.2)]">
               <AlertTriangle className="w-5 h-5 animate-pulse" />
               <span className="tracking-widest uppercase">Catastrophic Material Fracture</span>
             </div>
          </div>
        )}

        <div onClick={() => setIsSidebarOpen(false)} onPointerDown={handlePointerDown} onPointerUp={handlePointerUpOrLeave} onPointerMove={handlePointerMove} onPointerLeave={handlePointerUpOrLeave} className="select-none flex-1 min-h-[300px] sm:min-h-0 w-full relative z-10 flex items-center justify-center pointer-events-auto shrink-0 py-8 lg:py-0 overflow-hidden cursor-crosshair">
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
                <stop offset="0%" stopColor="#60A5FA" stopOpacity="0.8" />
                <stop offset="100%" stopColor="#60A5FA" stopOpacity="0" />
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

              <g stroke={matStyle.stroke} fill="#0B1121" strokeWidth="1.5" strokeDasharray={matStyle.dash} filter={matStyle.filter}>
                <path d="M -220 0 C -220 -25, -120 -35, 0 -35 C 150 -35, 230 -15, 230 0 C 230 15, 150 35, 0 35 C -120 35, -220 25, -220 0 Z" opacity="0.9"/>
                <path d="M -202 -17 Q -190 0 -202 17" fill="none" strokeWidth="1" strokeDasharray="3 3"/>
                <line x1="-120" y1="-34" x2="-120" y2="34" strokeWidth="0.5" opacity="0.4" />
                <line x1="0" y1="-35" x2="0" y2="35" strokeWidth="0.5" opacity="0.4" />
                <line x1="120" y1="-30" x2="120" y2="30" strokeWidth="0.5" opacity="0.4" />
              </g>

              <g fill="rgba(96, 165, 250, 0.2)" stroke="#60A5FA" strokeWidth="1">
                <path d="M -192 0 L -182 -12 Q -155 -15 -140 -12 L -135 0 L -140 12 Q -155 15 -182 12 Z" />
                <line x1="-192" y1="0" x2="-135" y2="0" opacity="0.5"/>
                <line x1="-165" y1="-14" x2="-165" y2="14" opacity="0.5"/>
              </g>

              <g>
                {Array.from({length: 12}).map((_, i) => (
                   <React.Fragment key={i}>
                     <rect x={-90 + i * 16} y={-23} width={7} height={10} rx={3} fill="rgba(15, 23, 42, 0.9)" stroke="rgba(96, 165, 250, 0.4)" strokeWidth="0.8" />
                     <rect x={-90 + i * 16} y={13} width={7} height={10} rx={3} fill="rgba(15, 23, 42, 0.9)" stroke="rgba(96, 165, 250, 0.4)" strokeWidth="0.8" />
                   </React.Fragment>
                ))}
              </g>

              <g stroke={matStyle.stroke} fill="#0B1121" strokeWidth="1.5" strokeDasharray={matStyle.dash} filter={matStyle.filter}>
                <path d="M 130 30 L 130 40 L 160 40 L 160 30 Z" />
                <rect x="120" y="25" width="70" height="24" rx="12" />
                <path d="M 130 -30 L 130 -40 L 160 -40 L 160 -30 Z" />
                <rect x="120" y="-49" width="70" height="24" rx="12" />
              </g>

              <g id="fan-port" ref={fanPortRef} transform="translate(125, 37)">
                <ellipse cx="0" cy="0" rx="3" ry="10" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="1" filter={velocity > 200 ? "url(#prop-blur)" : ""} />
                <line x1="0" y1="-10" x2="0" y2="10" stroke="#60A5FA" strokeWidth="1.5" opacity="0.8" />
                <line x1="-3" y1="0" x2="3" y2="0" stroke="#60A5FA" strokeWidth="1.5" opacity="0.8" />
              </g>
              <g id="fan-starb" ref={fanStarbRef} transform="translate(125, -37)">
                <ellipse cx="0" cy="0" rx="3" ry="10" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="1" filter={velocity > 200 ? "url(#prop-blur)" : ""} />
                <line x1="0" y1="-10" x2="0" y2="10" stroke="#60A5FA" strokeWidth="1.5" opacity="0.8" />
                <line x1="-3" y1="0" x2="3" y2="0" stroke="#60A5FA" strokeWidth="1.5" opacity="0.8" />
              </g>

              {thrust > 0 && (
                <motion.g
                   fill="none" stroke="#60A5FA" strokeWidth={1 + thrust * 0.01}
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
                      <motion.path animate={{ d: `M 205 -46 L ${220+visualFlapDeflection} -40 L ${220+visualFlapDeflection} 0 L 205 0 Z` }} fill="rgba(96, 165, 250, 0.15)" stroke="#60A5FA" strokeDasharray="none" transition={{ type: 'spring', bounce: 0.2 }} />
                      <path d="M 170 60 L 220 40 L 220 0 L 140 0 Z" />
                      <motion.path animate={{ d: `M 205 46 L ${220+visualFlapDeflection} 40 L ${220+visualFlapDeflection} 0 L 205 0 Z` }} fill="rgba(96, 165, 250, 0.15)" stroke="#60A5FA" strokeDasharray="none" transition={{ type: 'spring', bounce: 0.2 }} />
                    </>
                  )}
                  {tailType === 'T-Tail' && (
                    <>
                      <path d="M 210 -60 L 230 -60 L 230 60 L 210 60 Z" />
                      <motion.path animate={{ d: `M 220 -60 L ${230+visualFlapDeflection} -60 L ${230+visualFlapDeflection} 60 L 220 60 Z` }} fill="rgba(96, 165, 250, 0.15)" stroke="#60A5FA" strokeDasharray="none" transition={{ type: 'spring', bounce: 0.2 }} />
                    </>
                  )}
                  {tailType === 'V-Tail' && (
                    <>
                      <path d="M 160 -80 L 230 -100 L 210 0 L 150 0 Z" />
                      <motion.path animate={{ d: `M 205 -88 L ${230+visualFlapDeflection} -100 L ${210+visualFlapDeflection} 0 L 195 0 Z` }} fill="rgba(96, 165, 250, 0.15)" stroke="#60A5FA" strokeDasharray="none" transition={{ type: 'spring', bounce: 0.2 }} />
                      <path d="M 160 80 L 230 100 L 210 0 L 150 0 Z" />
                      <motion.path animate={{ d: `M 205 88 L ${230+visualFlapDeflection} 100 L ${210+visualFlapDeflection} 0 L 195 0 Z` }} fill="rgba(96, 165, 250, 0.15)" stroke="#60A5FA" strokeDasharray="none" transition={{ type: 'spring', bounce: 0.2 }} />
                    </>
                  )}
                  {tailType === 'Twin Boom' && (
                    <>
                      <path d="M 40 -80 L 220 -80 L 220 -70 L 40 -70 Z" />
                      <path d="M 40 80 L 220 80 L 220 70 L 40 70 Z" />
                      <path d="M 190 -80 L 220 -80 L 220 80 L 190 80 Z" />
                      <motion.path animate={{ d: `M 205 -80 L ${220+visualFlapDeflection} -80 L ${220+visualFlapDeflection} 80 L 205 80 Z` }} fill="rgba(96, 165, 250, 0.15)" stroke="#60A5FA" strokeDasharray="none" transition={{ type: 'spring', bounce: 0.2 }} />
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
                   <g stroke={matStyle.stroke} fill="rgba(96, 165, 250, 0.03)" strokeWidth="1.5" strokeDasharray={matStyle.dash} filter={matStyle.filter}>
                     <path d={portWing} />
                     <motion.path animate={{ d: portFlap }} transition={{ type: 'spring', bounce: 0.3 }} fill="rgba(96, 165, 250, 0.15)" stroke="#60A5FA" strokeDasharray="none" filter="none" />
                     
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
                       <motion.path animate={{ d: starbFlap }} transition={{ type: "spring", bounce: 0.3 }} fill="rgba(96, 165, 250, 0.15)" stroke="#60A5FA" strokeDasharray="none" filter="none" />
                       
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
             <AeroDeckGauge title="Acoustic Sig" value={telemetry.acoustic_db.toFixed(1)} unit="dB" max={140} color="#94A3B8" />
             <AeroDeckGauge title="L/D Ratio" value={telemetry.ld_ratio.toFixed(1)} unit="R" max={30} color={aoa > 5 ? '#64748B' : '#94A3B8'} />
           </div>

           <div className="sm:hidden flex flex-col gap-2 pointer-events-auto shrink-0 justify-end w-[180px] ml-auto pb-1 relative">
             <div className="bg-[#05131A]/90 backdrop-blur-md border border-[#0F2836] p-2 rounded shadow-lg w-full">
               <h3 className="text-[7px] uppercase tracking-widest text-zinc-400 mb-1">V-n Envelope</h3>
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

           <div className="hidden lg:flex bg-[#030E14]/80 border border-[#0F2836] px-3 py-2 items-start rounded max-w-[200px] pointer-events-auto shadow-lg backdrop-blur-md">
              <div className="w-full">
                <div className="text-[7px] text-zinc-400 uppercase mb-1.5 tracking-widest font-bold">Configuration</div>
                <div className="text-[9px] font-mono text-zinc-400 border-b border-zinc-700/50 pb-1 mb-1">Airfoil: {airfoil}</div>
                <div className="text-[9px] font-mono text-zinc-400 border-b border-zinc-700/50 pb-1 mb-1">Tail: {tailType}</div>
                <div className="text-[9px] font-mono text-zinc-400">Material: {material}</div>
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
    <div className="space-y-1.5 focus-within:ring-1 ring-zinc-500/50 rounded transition-all">
      <label className="text-[10px] uppercase font-semibold tracking-wider text-zinc-400">{label}</label>
      <div className="relative">
        <select 
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full appearance-none bg-[#030E14] border border-[#0F2836] text-xs p-2 rounded text-zinc-300 outline-none focus:border-zinc-500 transition-colors cursor-pointer font-mono"
        >
          {options.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
        <ChevronDown className="w-4 h-4 absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" />
      </div>
    </div>
  );
}

function ControlSlider({ label, value, min, max, step = 1, onChange }: { label: string, value: number, min: number, max: number, step?: number, onChange: (v: number) => void }) {
  return (
    <div className="space-y-2">
      <div className="flex justify-between text-[10px] font-semibold tracking-wider uppercase">
        <span className="text-zinc-400">{label}</span>
        <span className="font-mono text-zinc-300">{value.toLocaleString()}</span>
      </div>
      <input 
        type="range" 
        min={min} max={max} step={step} 
        value={value} 
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full h-1 bg-[#05131A] rounded-full appearance-none cursor-pointer"
      />
      <div className="flex justify-between text-[9px] text-zinc-600 font-mono mt-1">
        <span>{min}</span>
        <span>{max}</span>
      </div>
    </div>
  );
}

function HudMetricCard({ label, value, highlight }: { label: string, value: string, highlight?: boolean }) {
  return (
    <div className={cn("bg-[#05131A]/80 backdrop-blur-md border px-2 py-1.5 sm:px-3 sm:py-1.5 rounded shadow-lg transition-colors w-full", highlight ? "border-amber-500/50" : "border-[#0F2836]")}>
      <div className={cn("text-[6px] sm:text-[7px] uppercase tracking-widest mb-0.5 sm:mb-1 whitespace-nowrap", highlight ? "text-amber-500" : "text-zinc-500")}>{label}</div>
      <div className={cn("text-sm sm:text-base font-mono leading-none", highlight ? "text-amber-100" : "text-zinc-400")}>{value}</div>
    </div>
  );
}

function AeroDeckGauge({ title, value, unit, max, color }: { title: string, value: string, unit: string, max: number, color: string }) {
  const percentage = Math.min(100, Math.max(0, (Number(value) / max) * 100));
  return (
    <div className="bg-[#05131A]/80 backdrop-blur-md border border-[#0F2836] px-2 py-1.5 sm:px-3 sm:py-2 rounded flex flex-col min-w-[75px] sm:min-w-[90px] shadow-lg">
      <div className="text-[6px] sm:text-[7px] uppercase tracking-widest text-zinc-400 mb-1 sm:mb-1.5">{title}</div>
      <div className="flex items-end gap-1 mb-1 sm:mb-1.5">
        <span className="text-base sm:text-lg lg:text-xl font-mono leading-none text-zinc-100">{value}</span>
        <span className="text-[6px] sm:text-[8px] font-mono text-zinc-500 uppercase mb-0.5">{unit}</span>
      </div>
      <div className="w-full h-1 sm:h-1.5 bg-[#030E14] rounded-full overflow-hidden">
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
  const dotColor = isBreached ? '#e11d48' : '#60a5fa'; // rose-600 : blue-400
  const yAxisMax = Math.ceil(n_max * 1.2);
  const yAxisMin = Math.floor(n_min * 1.2);

  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 5, right: 10, left: -25, bottom: 10 }}>
        <XAxis dataKey="v" type="number" domain={[0, 400]} label={{ value: 'Velocity (m/s)', position: 'insideBottom', offset: -10, fill: '#64748b', fontSize: 7, textAnchor: 'middle' }} tick={false} axisLine={{ stroke: '#0F2836' }} />
        <YAxis label={{ value: 'Load Factor (G)', angle: -90, position: 'insideLeft', offset: 15, fill: '#64748b', fontSize: 7, textAnchor: 'middle' }} tick={{ fontSize: 7, fill: '#64748b' }} domain={[yAxisMin, yAxisMax]} axisLine={{ stroke: '#0F2836' }} tickLine={false} tickCount={5} />
        <Area type="monotone" dataKey="envelope" stroke="#2563eb" fill="#3b82f6" fillOpacity={0.15} strokeWidth={1.5} isAnimationActive={false} />
        <ReferenceDot x={velocity} y={current_n} r={3.5} fill={dotColor} stroke={isBreached ? 'rgba(225,29,72,0.4)' : 'rgba(96,165,250,0.4)'} strokeWidth={5} isAnimationActive={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
});
