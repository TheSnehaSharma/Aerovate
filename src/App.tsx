import React, { useState, useEffect, useRef, useMemo } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Zap,
  Info,
  Play,
  X,
  ShieldAlert,
  Cpu,
  ChevronLeft,
  Menu,
  Maximize,
  BarChart3,
  Box,
  Activity,
  AlertTriangle,
  Download,
  Home,
  Minimize2,
} from "lucide-react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, PerspectiveCamera, Html } from "@react-three/drei";
import { EffectComposer, Bloom } from "@react-three/postprocessing";
import * as THREE from "three";
import {
  LineChart,
  Line,
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  ReferenceArea,
  ReferenceDot,
} from "recharts";

interface Telemetry {
  cl: number;
  cd: number;
  cm: number;
  confidence: number;
  ld_ratio: number;
  re: number;
  status: string;
  prediction_source: string;
  color: string;
}

function generateNACA(m: number, p: number, t: number, numPoints = 80) {
  // m: max camber [0, 0.09]
  // p: position of max camber [0, 0.9]
  // t: max thickness [0.01, 0.4]
  const points = [];
  for (let i = 0; i <= numPoints; i++) {
    const beta = (i / numPoints) * Math.PI;
    const x = 0.5 * (1 - Math.cos(beta)); // cosine spacing

    const yt =
      5 *
      t *
      (0.2969 * Math.sqrt(x) -
        0.126 * x -
        0.3516 * Math.pow(x, 2) +
        0.2843 * Math.pow(x, 3) -
        0.1015 * Math.pow(x, 4));

    let yc = 0;
    let dyc_dx = 0;

    if (p > 0) {
      if (x >= 0 && x <= p) {
        yc = (m / Math.pow(p, 2)) * (2 * p * x - x * x);
        dyc_dx = ((2 * m) / Math.pow(p, 2)) * (p - x);
      } else {
        yc = (m / Math.pow(1 - p, 2)) * (1 - 2 * p + 2 * p * x - x * x);
        dyc_dx = ((2 * m) / Math.pow(1 - p, 2)) * (p - x);
      }
    }

    const theta = Math.atan(dyc_dx);

    const xu = x - yt * Math.sin(theta);
    const yu = yc + yt * Math.cos(theta);

    const xl = x + yt * Math.sin(theta);
    const yl = yc - yt * Math.cos(theta);

    points.push({ x, xu, yu, xl, yl, yc, yt });
  }
  return points;
}

function Airfoil3D({ nacaPoints, alpha, cl, cd, chord, span }: any) {
  const shape = useMemo(() => {
    const s = new THREE.Shape();
    if (!nacaPoints || nacaPoints.length === 0) return s;
    s.moveTo(nacaPoints[0].x, nacaPoints[0].yu);
    for (let i = 1; i < nacaPoints.length; i++)
      s.lineTo(nacaPoints[i].x, nacaPoints[i].yu);
    for (let i = nacaPoints.length - 2; i >= 0; i--)
      s.lineTo(nacaPoints[i].x, nacaPoints[i].yl);
    s.closePath();
    return s;
  }, [nacaPoints]);

  const extrudeSettings = useMemo(() => {
    return {
      depth: span,
      bevelEnabled: true,
      bevelThickness: 0.002,
      bevelSize: 0.002,
      bevelSegments: 3,
    };
  }, [span]);

  const geoRef = useRef<THREE.ExtrudeGeometry>(null);

  useEffect(() => {
    if (!geoRef.current) return;
    const geo = geoRef.current;
    geo.computeVertexNormals();

    const count = geo.attributes.position.count;
    const colorArray = new Float32Array(count * 3);
    const norm = geo.attributes.normal.array;

    for (let i = 0; i < count; i++) {
      const nx = norm[i * 3];
      const ny = norm[i * 3 + 1];

      // Simulate pressure based on normals and Cl / Cd
      let cp = 1.0 - (nx * nx + ny * ny);
      if (ny > 0)
        cp -= Math.max(0, cl) * 1.5 * ny; // top - lower pressure (suction)
      else cp += Math.max(0, cl) * 0.5 * -ny; // bottom - higher pressure

      // Stagnation point effect
      if (nx < -0.8) cp += 1.0;

      // Jet colormap roughly (blue -> green -> yellow -> red)
      let r = Math.max(0, Math.min(1, 1.5 - Math.abs(cp * 2 - 1)));
      let g = Math.max(0, Math.min(1, 1.5 - Math.abs(cp * 2)));
      let b = Math.max(0, Math.min(1, 1.5 - Math.abs(cp * 2 + 1)));

      if (cp > 0.5) {
        r = 1;
        g = 1 - cp;
        b = 0;
      } // High pressure: Red/Orange
      else if (cp < -0.5) {
        r = 0;
        g = 0.5;
        b = 1;
      } // Low pressure: Blue

      colorArray[i * 3] = r;
      colorArray[i * 3 + 1] = g;
      colorArray[i * 3 + 2] = b;
    }

    geo.setAttribute("color", new THREE.BufferAttribute(colorArray, 3));
  }, [shape, cl, cd, span]);

  return (
    <group position={[0, 0, 0]}>
      <group
        position={[0.25 * chord, 0, 0]}
        rotation={[0, 0, (alpha * Math.PI) / 180]}
      >
        <group position={[-0.25 * chord, 0, 0]}>
          <mesh
            position={[0, 0, -span / 2]}
            scale={[chord, chord, 1]}
            castShadow
            receiveShadow
            onPointerOver={(e) => {
              document.body.style.cursor = "grab";
            }}
            onPointerOut={(e) => {
              document.body.style.cursor = "default";
            }}
          >
            <extrudeGeometry ref={geoRef} args={[shape, extrudeSettings]} />
            <meshStandardMaterial
              vertexColors
              roughness={0.3}
              metalness={0.4}
            />
          </mesh>
        </group>
      </group>
    </group>
  );
}

function WindStreamlines({ alpha, velocity, chord, span }: any) {
  const particlesCount = 800; // Removed extra areas for smaller screens

  const linePositions = useMemo(
    () => new Float32Array(particlesCount * 6),
    [particlesCount],
  ); // x1,y1,z1, x2,y2,z2
  const stateRef = useRef(new Float32Array(particlesCount * 3)); // x, y, z

  useMemo(() => {
    for (let i = 0; i < particlesCount; i++) {
      stateRef.current[i * 3] = (Math.random() - 0.5) * 6; // x: -3 to 3
      stateRef.current[i * 3 + 1] = (Math.random() - 0.5) * 4; // y: -2 to 2
      stateRef.current[i * 3 + 2] = (Math.random() - 0.5) * span * 1.2; // z
    }
  }, [particlesCount, span]);

  const pointsRef = useRef<THREE.LineSegments>(null);

  useFrame((state, delta) => {
    if (!pointsRef.current) return;
    const pos = pointsRef.current.geometry.attributes.position
      .array as Float32Array;

    const uInf = 0.5 + velocity / 100;
    const alphaRad = (alpha * Math.PI) / 180;
    const u0 = uInf * Math.cos(alphaRad);
    const v0 = uInf * Math.sin(alphaRad);

    const x0 = 0.25 * chord;
    const y0 = 0;
    // Rough approximations for potential flow
    // circulation Gamma depends on alpha explicitly, but let's just use alpha directly for visual effect
    const clApprox = alphaRad * 2 * Math.PI;
    const Gamma = Math.max(-2, Math.min(2, clApprox)) * chord * uInf * 0.5;
    const kappa = chord * chord * uInf * 0.05;

    for (let i = 0; i < particlesCount; i++) {
      let x = stateRef.current[i * 3];
      let y = stateRef.current[i * 3 + 1];
      let z = stateRef.current[i * 3 + 2];

      const dx = x - x0;
      const dy = y - y0;
      const r2 = Math.max(0.01, dx * dx + dy * dy);
      const r4 = r2 * r2;

      let u = u0;
      let v = v0;

      // Doublet velocity
      u -= (kappa * (dx * dx - dy * dy)) / r4;
      v -= (kappa * 2 * dx * dy) / r4;

      // Vortex velocity
      u += (Gamma / (2 * Math.PI)) * (dy / r2);
      v -= (Gamma / (2 * Math.PI)) * (dx / r2);

      // Solid body clamp inside the airfoil approx
      if (
        dx > -0.2 * chord &&
        dx < 0.8 * chord &&
        Math.abs(dy) < 0.1 * chord &&
        Math.abs(z) < span / 2
      ) {
        u *= 0.1;
        v *= 0.1;
      }

      // update state
      x += u * delta * 4;
      y += v * delta * 4;

      if (x > 3) {
        x = -4 - Math.random();
        y = (Math.random() - 0.5) * 6;
      }

      stateRef.current[i * 3] = x;
      stateRef.current[i * 3 + 1] = y;

      // Line start
      pos[i * 6] = x;
      pos[i * 6 + 1] = y;
      pos[i * 6 + 2] = z;

      // Line tail based on actual velocity
      const tailLen = 0.3;
      pos[i * 6 + 3] = x - u * tailLen;
      pos[i * 6 + 4] = y - v * tailLen;
      pos[i * 6 + 5] = z;
    }
    pointsRef.current.geometry.attributes.position.needsUpdate = true;
  });

  return (
    <lineSegments ref={pointsRef}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          count={particlesCount * 2}
          array={linePositions}
          itemSize={3}
        />
      </bufferGeometry>
      <lineBasicMaterial
        color={0xaaddff}
        transparent
        opacity={0.4}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
      />
    </lineSegments>
  );
}

export default function App() {
  const [m, setM] = useState(0.04);
  const [p, setP] = useState(0.4);
  const [t, setT] = useState(0.12);

  const [alpha, setAlpha] = useState(5.0);
  const [velocity, setVelocity] = useState(30);
  const [chord, setChord] = useState(1.0);
  const [span, setSpan] = useState(3.0);
  const [kinematicViscosity, setKinematicViscosity] = useState(1.46e-5);

  const touchStartY = useRef<number>(0);

  const [selectedPreset, setSelectedPreset] = useState("naca64415");
  const [selectedEnvPreset, setSelectedEnvPreset] = useState("stol");
  const [polarHistory, setPolarHistory] = useState<any[]>([]);
  const [polarCurve, setPolarCurve] = useState<any[]>([]);

  const geoPresets: Record<
    string,
    { m: number; p: number; t: number; label: string }
  > = {
    naca64415: { m: 0.022, p: 0.4, t: 0.15, label: "NACA 64-415 (Laminar)" },
    b737a: { m: 0.02, p: 0.35, t: 0.154, label: "Boeing 737 Root" },
    dae11: { m: 0.055, p: 0.42, t: 0.093, label: "DAE-11 (HALE Drone)" },
    supercritical: {
      m: 0.03,
      p: 0.7,
      t: 0.14,
      label: "Whitcomb Supercritical",
    },
  };

  const envPresets: Record<
    string,
    { vel: number; alpha: number; visc: number; label: string }
  > = {
    transonic: { vel: 250, alpha: 2, visc: 1.46e-5, label: "Transonic Cruise" },
    stol: { vel: 35, alpha: 12, visc: 1.46e-5, label: "STOL Utility" },
    mars: { vel: 50, alpha: 4, visc: 6.5e-4, label: "Mars Flight (Ingenuity)" },
  };

  const handlePresetChange = (key: string) => {
    setSelectedPreset(key);
    const config = geoPresets[key];
    if (config) {
      setM(config.m);
      setP(config.p);
      setT(config.t);
    }
  };

  const handleEnvPresetChange = (key: string) => {
    setSelectedEnvPreset(key);
    const config = envPresets[key];
    if (config) {
      setVelocity(config.vel);
      setAlpha(config.alpha);
      setKinematicViscosity(config.visc);
    }
  };

  const [telemetry, setTelemetry] = useState<Telemetry>({
    cl: 0,
    cd: 0,
    cm: 0,
    confidence: 0,
    ld_ratio: 0,
    re: 1e6,
    status: "BOOTING",
    prediction_source: "...",
    color: "#94A3B8",
  });

  const [showHero, setShowHero] = useState<boolean>(true);
  const [glitchText, setGlitchText] = useState("AEROVATE");
  const [showMethodology, setShowMethodology] = useState<boolean>(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState<boolean>(
    window.innerWidth >= 1024,
  );
  const [bottomTab, setBottomTab] = useState<
    "performance" | "forces" | "polars"
  >("performance");
  const [isFooterMinimized, setIsFooterMinimized] = useState<boolean>(false);

  const handleLaunch = async () => {
    setShowHero(false);
  };

  useEffect(() => {
    if (!showHero) return;
    const interval = setInterval(() => {
      if (Math.random() > 0.9) {
        setGlitchText("A3ROV4TE");
        setTimeout(() => setGlitchText("AEROVATE"), 100);
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [showHero]);

  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<NodeJS.Timeout>(null);

  const nacaPoints = useMemo(() => generateNACA(m, p, t), [m, p, t]);

  const [draggingPoint, setDraggingPoint] = useState<
    "camber" | "thickness" | null
  >(null);

  useEffect(() => {
    document.title = "Aerovate — Neural Airfoil Design";
  }, []);

  // Fetch polar curve data (calculate CL/CD for a range of alphas)
  const updatePolarCurve = async (
    currentM: number,
    currentP: number,
    currentT: number,
    currentChord: number,
    currentVel: number,
    currentVisc: number,
  ) => {
    try {
      const alphas = [-20, -15, -10, -5, 0, 5, 10, 15, 20, 25];
      const points = nacaPoints; // use current geometry
      const coords = [];
      for (let i = points.length - 1; i >= 0; i--)
        coords.push([points[i].xu, points[i].yu]);
      for (let i = 1; i < points.length; i++)
        coords.push([points[i].xl, points[i].yl]);

      const res = await fetch("/api/v1/simulate-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          coordinates: coords,
          alphas: alphas,
          Re: (currentVel * currentChord) / currentVisc,
        }),
      });
      const data = await res.json();
      if (data.results) {
        setPolarCurve(data.results.sort((a: any, b: any) => a.alpha - b.alpha));
      }
    } catch (e) {
      console.warn("Failed to update polar curve", e);
    }
  };

  const lastCurveGeoHash = useRef("");

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    setTelemetry((prev) => ({
      ...prev,
      status: "EVALUATING...",
      color: "#eab308",
    }));
    setLoading(true);

    debounceRef.current = setTimeout(async () => {
      try {
        const coords = [];
        for (let i = nacaPoints.length - 1; i >= 0; i--)
          coords.push([nacaPoints[i].xu, nacaPoints[i].yu]);
        for (let i = 1; i < nacaPoints.length; i++)
          coords.push([nacaPoints[i].xl, nacaPoints[i].yl]);

        const payload = {
          coordinates: coords,
          alpha,
          velocity,
          chord_length: chord,
          Re_input: (velocity * chord) / kinematicViscosity,
        };

        const res = await fetch("/api/v1/simulate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        if (!res.ok) throw new Error("API Error");

        const data = await res.json();

        setTelemetry({
          cl: data.aero.Cl,
          cd: data.aero.Cd,
          cm: data.aero.Cm,
          confidence: data.meta.confidence || 0,
          ld_ratio: data.efficiency.ld_ratio,
          re: data.meta.Re,
          status: data.status,
          prediction_source: data.prediction_source,
          color: (data.meta.confidence || 0) < 0.5 ? "#eab308" : "#22c55e",
        });

        // Background update polar curve if not already done for this geometry
        const geoHash = `${m}-${p}-${t}-${chord}-${velocity}`;
        if (lastCurveGeoHash.current !== geoHash) {
          lastCurveGeoHash.current = geoHash;
          setPolarCurve([]);
          updatePolarCurve(m, p, t, chord, velocity, kinematicViscosity);
        }
      } catch (e) {
        console.error(e);
        setTelemetry((prev) => ({
          ...prev,
          status: "FAILED",
          color: "#ef4444",
          prediction_source: "ERROR",
        }));
      } finally {
        setLoading(false);
      }
    }, 400);
  }, [nacaPoints, alpha, velocity, chord]);

  // SVG interaction logic
  const svgRef = useRef<SVGSVGElement>(null);

  const handlePointerDown =
    (type: "camber" | "thickness") => (e: React.PointerEvent) => {
      e.preventDefault();
      setSelectedPreset(""); // clear preset when dragging
      setDraggingPoint(type);
    };

  const handlePointerUp = () => setDraggingPoint(null);
  const handlePointerLeave = () => setDraggingPoint(null);

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!draggingPoint || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();

    // Map screen cursor to SVG viewBox coordinates
    const xRaw = -0.1 + ((e.clientX - rect.left) / rect.width) * 1.2;
    const yRaw = -0.5 + ((e.clientY - rect.top) / rect.height) * 1.0;

    // Un-rotate the coordinates since the SVG `<g>` is rotated by `-alpha`
    const a = (-alpha * Math.PI) / 180;
    const dx = xRaw - 0.25;
    const dy = yRaw - 0;
    const xSvg = 0.25 + (dx * Math.cos(-a) - dy * Math.sin(-a));
    const ySvg = 0 + (dx * Math.sin(-a) + dy * Math.cos(-a));

    if (draggingPoint === "camber") {
      // Clamp x to [0.05, 0.95] for p
      const newP = Math.max(0.05, Math.min(0.95, xSvg));
      // ySvg goes down, but mathematically yc goes up. So m = -ySvg
      const newM = Math.max(-0.09, Math.min(0.09, -ySvg));
      setP(newP);
      setM(newM);
    } else if (draggingPoint === "thickness") {
      // The thickness handle is at (x, -(yc + yt)) where ySvg = -(yc + yt)
      // So yt = -ySvg - yc. We roughly map vertical drag to t.
      // Let's just map distance directly to t relative to the chord line.
      // Easiest is just map absolute y to thickness (t max is 0.4).
      // Because yt is 5 * t * (...), max yt is roughly t / 2.
      // So t is roughly 2 * Math.abs(ySvg - (-mPoint.yc)).
      const newT = Math.max(0.01, Math.min(0.4, Math.abs(ySvg) * 2.5));
      setT(newT);
    }
  };

  const polyProps = {
    fill: "transparent",
    stroke: "rgba(255,255,255,0.2)",
    strokeWidth: "0.005",
  };

  // Upper from LE to TE
  const upperPts = nacaPoints.map((pt) => `${pt.x},${-pt.yu}`).join(" ");
  // Lower from LE to TE
  const lowerPts = nacaPoints
    .map((pt) => `${pt.x},${-pt.yl}`)
    .reverse()
    .join(" ");
  const polygonPoints = `${upperPts} ${lowerPts}`;

  const camberLine = nacaPoints.map((pt) => `${pt.x},${-pt.yc}`).join(" ");

  // Get max camber coords for the handle
  const mPoint = nacaPoints.reduce(
    (max, pt) => (Math.abs(pt.yc) > Math.abs(max.yc) ? pt : max),
    nacaPoints[0],
  );

  // Get max thickness coords for the handle
  const tPoint = nacaPoints.reduce(
    (max, pt) => (pt.yt > max.yt ? pt : max),
    nacaPoints[0],
  );

  const rho = 1.225; // kg/m^3 standard sea level density
  const q = 0.5 * rho * velocity * velocity;
  const S = chord * span;
  const liftForce = q * S * telemetry.cl;
  const dragForce = q * S * telemetry.cd;

  if (showHero) {
    return (
      <div className="fixed inset-0 z-[100] bg-black text-white font-sans overflow-hidden flex flex-col items-center justify-center p-6 text-center">
        <video
          autoPlay
          loop
          muted
          playsInline
          className="absolute inset-0 w-full h-full object-cover"
          src="https://assets.mixkit.co/videos/preview/mixkit-white-smoke-clouds-in-the-dark-14236-large.mp4"
        />
        <div className="absolute inset-0 bg-black/60 pointer-events-none" />

        <div className="relative z-20 flex flex-col items-center max-w-4xl">
          <motion.h1
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: "easeOut" }}
            className="text-5xl md:text-7xl lg:text-[7rem] font-bold tracking-tight mb-4 text-white"
            style={{ fontFamily: "'Space Grotesk', system-ui, sans-serif" }}
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
            A real-time geometric morphing and aerofoil prediction engine.
            Sculpt shapes, evaluate coefficients, and visualize
            computational flow fields instantly.
          </motion.p>

          <motion.button
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.7, duration: 0.5 }}
            onClick={() => setShowHero(false)}
            className="px-8 py-3 bg-white text-black font-semibold tracking-wide text-sm rounded-full transition-all duration-300 hover:scale-105 hover:bg-zinc-200 cursor-pointer shadow-[0_0_20px_rgba(255,255,255,0.2)]"
          >
            Initialize Workspace
          </motion.button>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`min-h-screen bg-zinc-950 text-zinc-300 font-sans selection:bg-blue-900 overflow-hidden flex flex-col lg:flex-row ${draggingPoint ? "select-none cursor-grabbing" : ""}`}
    >
      {/* SIDEBAR TOGGLE BUTTON */}
      {!isSidebarOpen && (
        <button
          onClick={() => setIsSidebarOpen(true)}
          className="absolute top-6 left-6 z-40 bg-zinc-900/90 p-2 rounded-full border border-zinc-800 text-zinc-400 hover:text-blue-400 transition-colors shadow-2xl"
        >
          <Menu size={20} />
        </button>
      )}

      {/* SIDEBAR */}
      <div
        className={`absolute lg:relative top-0 left-0 w-80 lg:w-96 border-r border-zinc-800 bg-zinc-950/95 lg:bg-zinc-950 backdrop-blur-xl flex flex-col shrink-0 h-screen overflow-y-auto transition-transform duration-300 z-50 shadow-[10px_0_40px_rgba(0,0,0,0.5)] lg:shadow-none ${isSidebarOpen ? "translate-x-0" : "-translate-x-full lg:hidden"}`}
      >
        <div className="flex gap-2 p-4 pt-4 border-b border-zinc-800 pb-4 bg-zinc-950/50">
          <button
            onClick={() => setShowHero(true)}
            className="flex-1 flex items-center justify-center gap-2 text-xs uppercase tracking-widest text-zinc-400 hover:text-white bg-zinc-800/40 hover:bg-zinc-800 py-2 rounded transition-colors"
          >
            <ChevronLeft size={14} /> Design Hub
          </button>
          <button
            onClick={() => setIsSidebarOpen(false)}
            className="lg:hidden px-3 flex items-center justify-center text-zinc-400 hover:text-blue-400 bg-zinc-800/40 hover:bg-zinc-800 rounded transition-colors"
          >
            <X size={14} />
          </button>
        </div>

        <div className="p-6 border-b border-zinc-800">
          <h1 className="text-xl font-mono text-blue-400 font-bold tracking-tight mb-1 flex items-center gap-2">
            <Zap size={20} /> AEROVATE{" "}
            <span className="text-xs font-normal text-zinc-500 uppercase tracking-widest mt-1">
              PRO
            </span>
          </h1>
          <p className="text-xs text-zinc-400 leading-relaxed font-mono">
            Precision Airfoil Engineering
          </p>
        </div>

        <div className="p-6 flex-1 flex flex-col gap-6">
          <div className="space-y-6">
            <div className="space-y-4">
              <h3 className="text-[10px] uppercase tracking-[0.2em] text-zinc-500 font-bold">
                Profile Preset
              </h3>
              <select
                value={selectedPreset}
                onChange={(e) => handlePresetChange(e.target.value)}
                className="w-full bg-zinc-900 border border-zinc-800 text-zinc-300 p-2.5 rounded font-mono text-sm focus:outline-none focus:border-blue-500 appearance-none cursor-pointer"
              >
                <option value="">Custom Geometry</option>
                {Object.entries(geoPresets).map(([key, conf]) => (
                  <option key={key} value={key}>
                    {conf.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-4 pt-4 border-t border-zinc-800">
              <h3 className="text-[10px] uppercase tracking-[0.2em] text-zinc-500 font-bold">
                Refine Geometry
              </h3>
              <div className="space-y-4">
                <div className="space-y-2">
                  <div className="flex justify-between items-center text-xs font-mono text-zinc-400">
                    <span>Max Camber</span>
                    <div className="flex items-center">
                      <input
                        type="number"
                        step="0.1"
                        value={(m * 100).toFixed(1)}
                        onChange={(e) => {
                          setM(parseFloat(e.target.value) / 100);
                          setSelectedPreset("");
                        }}
                        className="bg-transparent border-none w-12 text-right text-zinc-200 focus:outline-none focus:text-blue-400"
                      />
                      %
                    </div>
                  </div>
                  <input
                    type="range"
                    min="-0.1"
                    max="0.1"
                    step="0.001"
                    value={m}
                    onChange={(e) => {
                      setM(parseFloat(e.target.value));
                      setSelectedPreset("");
                    }}
                    className="w-full hud-slider"
                  />
                </div>

                <div className="space-y-2">
                  <div className="flex justify-between items-center text-xs font-mono text-zinc-400">
                    <span>Camber Position</span>
                    <input
                      type="number"
                      step="0.1"
                      value={(p * 10).toFixed(1)}
                      onChange={(e) => {
                        setP(parseFloat(e.target.value) / 10);
                        setSelectedPreset("");
                      }}
                      className="bg-transparent border-none w-12 text-right text-zinc-200 focus:outline-none focus:text-blue-400"
                    />
                  </div>
                  <input
                    type="range"
                    min="0.01"
                    max="0.99"
                    step="0.01"
                    value={p}
                    onChange={(e) => {
                      setP(parseFloat(e.target.value));
                      setSelectedPreset("");
                    }}
                    className="w-full hud-slider"
                  />
                </div>

                <div className="space-y-2">
                  <div className="flex justify-between items-center text-xs font-mono text-zinc-400">
                    <span>Thickness</span>
                    <div className="flex items-center">
                      <input
                        type="number"
                        step="0.1"
                        value={(t * 100).toFixed(1)}
                        onChange={(e) => {
                          setT(parseFloat(e.target.value) / 100);
                          setSelectedPreset("");
                        }}
                        className="bg-transparent border-none w-12 text-right text-zinc-200 focus:outline-none focus:text-blue-400"
                      />
                      %
                    </div>
                  </div>
                  <input
                    type="range"
                    min="0.01"
                    max="0.40"
                    step="0.005"
                    value={t}
                    onChange={(e) => {
                      setT(parseFloat(e.target.value));
                      setSelectedPreset("");
                    }}
                    className="w-full hud-slider"
                  />
                </div>

                <div className="space-y-2 pt-2">
                  <div className="flex justify-between items-center text-xs font-mono text-zinc-400">
                    <span>Chord Length</span>
                    <div className="flex items-center">
                      <input
                        type="number"
                        step="0.1"
                        value={chord.toFixed(2)}
                        onChange={(e) => setChord(parseFloat(e.target.value))}
                        className="bg-transparent border-none w-12 text-right text-zinc-200 focus:outline-none focus:text-blue-400"
                      />
                      m
                    </div>
                  </div>
                  <input
                    type="range"
                    min="0.1"
                    max="10.0"
                    step="0.1"
                    value={chord}
                    onChange={(e) => setChord(parseFloat(e.target.value))}
                    className="w-full hud-slider"
                  />
                </div>

                <div className="space-y-2">
                  <div className="flex justify-between items-center text-xs font-mono text-zinc-400">
                    <span>Wing Span</span>
                    <div className="flex items-center">
                      <input
                        type="number"
                        step="0.1"
                        value={span.toFixed(2)}
                        onChange={(e) => setSpan(parseFloat(e.target.value))}
                        className="bg-transparent border-none w-12 text-right text-zinc-200 focus:outline-none focus:text-blue-400"
                      />
                      m
                    </div>
                  </div>
                  <input
                    type="range"
                    min="0.1"
                    max="50.0"
                    step="0.5"
                    value={span}
                    onChange={(e) => setSpan(parseFloat(e.target.value))}
                    className="w-full hud-slider"
                  />
                </div>
              </div>
            </div>

            <div className="space-y-4 pt-4 border-t border-zinc-800">
              <h3 className="text-[10px] uppercase tracking-[0.2em] text-zinc-500 font-bold">
                Flight Conditions Preset
              </h3>
              <select
                value={selectedEnvPreset}
                onChange={(e) => handleEnvPresetChange(e.target.value)}
                className="w-full bg-zinc-900 border border-zinc-800 text-zinc-300 p-2.5 rounded font-mono text-sm focus:outline-none focus:border-emerald-500 appearance-none cursor-pointer"
              >
                <option value="">Custom Conditions</option>
                {Object.entries(envPresets).map(([key, conf]) => (
                  <option key={key} value={key}>
                    {conf.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-4 pt-4 border-t border-zinc-800">
              <h3 className="text-[10px] uppercase tracking-[0.2em] text-zinc-500 font-bold">
                Flight Conditions
              </h3>

              <div className="space-y-2">
                <div className="flex justify-between items-center text-xs font-mono text-zinc-400">
                  <span>Angle of Attack</span>
                  <div className="flex items-center">
                    <input
                      type="number"
                      step="0.1"
                      value={alpha.toFixed(1)}
                      onChange={(e) => {
                        setAlpha(parseFloat(e.target.value));
                        setSelectedEnvPreset("");
                      }}
                      className={`bg-transparent border-none w-12 text-right focus:outline-none focus:text-emerald-300 ${alpha >= 0 ? "text-green-400" : "text-red-400"}`}
                    />
                    °
                  </div>
                </div>
                <input
                  type="range"
                  min="-30"
                  max="30"
                  step="0.5"
                  value={alpha}
                  onChange={(e) => {
                    setAlpha(parseFloat(e.target.value));
                    setSelectedEnvPreset("");
                  }}
                  className="w-full hud-slider hud-slider-alt"
                />
              </div>

              <div className="space-y-2">
                <div className="flex justify-between items-center text-xs font-mono text-zinc-400">
                  <span>Velocity</span>
                  <div className="flex items-center text-green-400">
                    <input
                      type="number"
                      step="1"
                      value={velocity.toFixed(0)}
                      onChange={(e) => {
                        setVelocity(parseFloat(e.target.value));
                        setSelectedEnvPreset("");
                      }}
                      className="bg-transparent border-none w-12 text-right text-green-400 focus:outline-none focus:text-emerald-300"
                    />{" "}
                    m/s
                    <span className="text-zinc-600 ml-1">
                      / M{(velocity / 340.29).toFixed(2)}
                    </span>
                  </div>
                </div>
                <input
                  type="range"
                  min="1"
                  max="1000"
                  step="1"
                  value={velocity}
                  onChange={(e) => {
                    setVelocity(parseFloat(e.target.value));
                    setSelectedEnvPreset("");
                  }}
                  className="w-full hud-slider hud-slider-alt"
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* MAIN CONTENT AREA */}
      <div
        className={`flex-1 flex flex-col relative w-full h-full lg:h-screen overflow-hidden transition-all duration-300 pb-0`}
      >
        {/* HUD HEADER */}
        <div className="p-4 sm:p-6 flex justify-between items-start pointer-events-none z-10 w-full relative shrink-0">
          <div className="pointer-events-auto flex flex-col gap-1 ml-10 lg:ml-0">
            <div className="flex items-center gap-2 bg-zinc-950/80 backdrop-blur border border-zinc-800 px-3 py-1.5 rounded-full">
              <span
                className={`inline-block w-2 h-2 rounded-full ${loading ? "bg-amber-500 animate-pulse" : "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]"}`}
              />
              <span className="text-[10px] sm:text-xs uppercase tracking-widest text-zinc-400 font-mono">
                {loading ? "PREDICTING..." : "PREDICTION ACTIVE"}
              </span>
            </div>
          </div>

          <div className="pointer-events-auto flex items-center gap-2 flex-col sm:flex-row items-end sm:items-center">
            {/* Neural Confidence */}
            <div
              className={`px-3 py-1.5 rounded-full border bg-zinc-950/80 backdrop-blur flex items-center gap-2 shadow-sm ${telemetry.confidence < 0.5 ? "border-red-900/80 shadow-red-900/20" : "border-green-900/50 shadow-green-900/10"}`}
            >
              <span
                className={`text-[9px] uppercase tracking-widest font-bold ${telemetry.confidence < 0.5 ? "text-red-500" : "text-green-500"}`}
              >
                ML Confidence
              </span>
              <span
                className={`text-xs font-mono ${telemetry.confidence < 0.5 ? "text-red-400" : "text-green-400"}`}
              >
                {(telemetry.confidence * 100).toFixed(1)}%
              </span>
            </div>
          </div>
        </div>

        {/* INTERACTIVE STAGE */}
        <div className="flex-1 w-full relative flex flex-col z-0 lg:-mt-16 min-h-[50vh]">
          <div
            className="absolute inset-0 z-0 opacity-[0.03] pointer-events-none"
            style={{
              backgroundImage:
                "linear-gradient(#0F2836 1px, transparent 1px), linear-gradient(90deg, #0F2836 1px, transparent 1px)",
              backgroundSize: "40px 40px",
              backgroundPosition: "center",
            }}
          ></div>

          <div className="w-full h-full relative z-10">
            {/* 3D CANVAS */}
            <div className="absolute inset-0 z-0 opacity-100 pointer-events-auto">
              <Canvas shadows>
                <PerspectiveCamera makeDefault position={[3, 2, 8]} fov={45} />
                <OrbitControls makeDefault enableDamping dampingFactor={0.05} />
                <ambientLight intensity={0.6} />
                <pointLight position={[10, 10, 10]} intensity={1} />
                <directionalLight
                  position={[2, 5, 2]}
                  intensity={1.5}
                  castShadow
                />

                <Airfoil3D
                  nacaPoints={nacaPoints}
                  alpha={alpha}
                  cl={telemetry.cl}
                  cd={telemetry.cd}
                  chord={chord}
                  span={span}
                />
                <WindStreamlines
                  alpha={alpha}
                  velocity={velocity}
                  chord={chord}
                  span={span}
                />

                <EffectComposer>
                  <Bloom
                    luminanceThreshold={0.2}
                    luminanceSmoothing={0.9}
                    height={300}
                    intensity={1.5}
                  />
                </EffectComposer>
              </Canvas>
            </div>

            {/* PROFILE HUD */}
            <div className="absolute top-24 sm:top-4 left-4 sm:left-auto right-auto sm:right-4 w-40 sm:w-64 aspect-[2/1] bg-black/70 backdrop-blur-md border border-white/10 rounded-lg pointer-events-auto overflow-hidden shadow-2xl z-20">
              <div className="px-2 py-1 bg-white/5 text-[9px] uppercase tracking-widest text-zinc-500 border-b border-white/10 flex justify-between">
                <span className="flex items-center gap-1">
                  <Maximize size={8} /> Profile Editor
                </span>
                <span className="text-[8px] opacity-40">2D HUD</span>
              </div>
              <svg
                ref={svgRef}
                viewBox="-0.1 -0.5 1.2 1"
                preserveAspectRatio="xMidYMid meet"
                className="w-full h-full pointer-events-auto"
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerLeave={handlePointerLeave}
              >
                <defs>
                  <pattern
                    id="grid"
                    width="0.1"
                    height="0.1"
                    patternUnits="userSpaceOnUse"
                  >
                    <path
                      d="M 0.1 0 L 0 0 0 0.1"
                      fill="none"
                      stroke="#0F2836"
                      strokeWidth="0.002"
                    />
                  </pattern>
                </defs>
                <rect
                  x="-0.1"
                  y="-0.5"
                  width="1.2"
                  height="1"
                  fill="url(#grid)"
                  opacity="0.5"
                />
                <line
                  x1="-0.1"
                  y1="0"
                  x2="1.1"
                  y2="0"
                  stroke="#0F2836"
                  strokeWidth="0.005"
                />
                <line
                  x1="0"
                  y1="-0.5"
                  x2="0"
                  y2="0.5"
                  stroke="#0F2836"
                  strokeWidth="0.005"
                />

                {/* Ghost Airfoil */}
                {draggingPoint && (
                  <g transform={`rotate(${-alpha}, 0.25, 0)`} opacity="0.2">
                    <polygon points={polygonPoints} fill="#ffffff" />
                  </g>
                )}

                <g transform={`rotate(${-alpha}, 0.25, 0)`}>
                  <polyline
                    points={camberLine}
                    fill="none"
                    stroke="rgba(255,255,255,0.1)"
                    strokeWidth="0.005"
                    strokeDasharray="0.01,0.01"
                  />
                  <polygon points={polygonPoints} {...polyProps} />
                  <g
                    transform={`translate(${mPoint.x}, ${-mPoint.yc})`}
                    style={{ cursor: "move" }}
                    onPointerDown={handlePointerDown("camber")}
                  >
                    <circle r="0.06" fill="transparent" />
                    <circle
                      r="0.03"
                      fill="#22D3EE"
                      opacity="0.3"
                      className="animate-ping origin-center"
                    />
                    <circle r="0.02" fill="#22D3EE" />
                  </g>
                  <g
                    transform={`translate(${tPoint.x}, ${-(tPoint.yc + tPoint.yt)})`}
                    style={{ cursor: "ns-resize" }}
                    onPointerDown={handlePointerDown("thickness")}
                  >
                    <circle r="0.06" fill="transparent" />
                    <circle
                      r="0.03"
                      fill="#F43F5E"
                      opacity="0.3"
                      className="animate-ping origin-center"
                    />
                    <circle r="0.02" fill="#F43F5E" />
                  </g>
                </g>
              </svg>
            </div>
          </div>
        </div>

        {/* FLIGHT DATA FOOTER */}
        <div
          className={`w-full p-3 sm:p-5 z-20 pointer-events-none border-t border-zinc-800 glass-panel shrink-0 transition-transform duration-300 ${isFooterMinimized ? "translate-y-full" : "translate-y-0"} relative`}
        >
          <button
            onClick={() => setIsFooterMinimized(!isFooterMinimized)}
            className="absolute top-0 right-4 -translate-y-full glass-panel pointer-events-auto rounded-t-lg px-4 py-1 text-zinc-500 hover:text-white border border-zinc-800 border-b-0 flex items-center justify-center transition-colors"
          >
            {isFooterMinimized ? (
              <BarChart3 size={16} />
            ) : (
              <Minimize2 size={16} />
            )}
          </button>

          <div className="max-w-5xl mx-auto w-full pointer-events-auto">
            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center mb-3 sm:mb-4 gap-2">
              <div className="flex gap-4 border-b border-zinc-800 overflow-x-auto whitespace-nowrap scrollbar-none">
                <button
                  onClick={() => setBottomTab("performance")}
                  className={`pb-2 px-1 text-[10px] sm:text-xs font-mono uppercase tracking-widest transition-colors font-bold ${bottomTab === "performance" ? "text-blue-400 border-b-2 border-cyan-400" : "text-zinc-500 hover:text-zinc-300"}`}
                >
                  Performance
                </button>
                <button
                  onClick={() => setBottomTab("forces")}
                  className={`pb-2 px-1 text-[10px] sm:text-xs font-mono uppercase tracking-widest transition-colors font-bold ${bottomTab === "forces" ? "text-blue-400 border-b-2 border-cyan-400" : "text-zinc-500 hover:text-zinc-300"}`}
                >
                  Forces
                </button>
                <button
                  onClick={() => setBottomTab("polars")}
                  className={`pb-2 px-1 text-[10px] sm:text-xs font-mono uppercase tracking-widest transition-colors font-bold ${bottomTab === "polars" ? "text-blue-400 border-b-2 border-cyan-400" : "text-zinc-500 hover:text-zinc-300"}`}
                >
                  Polars
                </button>
              </div>

              {telemetry.confidence < 0.5 && (
                <div className="flex items-center gap-2 text-red-400 text-xs font-mono bg-rose-500/10 px-3 py-1 rounded-full border border-rose-500/20">
                  <span className="animate-pulse">●</span> Low Model Confidence:
                  Potential Separation/Stall
                </div>
              )}
            </div>

            {/* PERFORMANCE TAB */}
            {bottomTab === "performance" && (
              <div className="grid grid-cols-2 md:grid-cols-5 gap-2 sm:gap-3 flex-1 min-h-[140px] sm:min-h-0 items-start">
                <div
                  className={`bg-[#010609] p-2 sm:p-3 rounded border flex flex-col transition-colors relative overflow-hidden ${telemetry.confidence < 0.5 ? "border-rose-900/50 animate-[pulse_2s_ease-in-out_infinite]" : "border-zinc-800 hover:border-zinc-700"}`}
                >
                  <span className="text-[9px] uppercase text-zinc-500 mb-1 tracking-widest font-bold">
                    Lift (Cl)
                  </span>
                  <span
                    className={`text-xl sm:text-2xl font-mono tabular-nums ${telemetry.cl > 0 ? "text-green-400" : "text-red-400"}`}
                  >
                    {loading ? "..." : telemetry.cl.toFixed(3)}
                  </span>
                </div>
                <div className="bg-[#010609] p-2 sm:p-3 rounded border border-zinc-800 flex flex-col hover:border-zinc-700 transition-colors relative overflow-hidden">
                  <span className="text-[9px] uppercase text-zinc-500 mb-1 tracking-widest font-bold">
                    Drag (Cd)
                  </span>
                  <span className="text-xl sm:text-2xl font-mono tabular-nums text-amber-500">
                    {loading ? "..." : telemetry.cd.toFixed(3)}
                  </span>
                </div>
                <div
                  className={`bg-[#010609] p-2 sm:p-3 rounded border flex flex-col transition-colors relative overflow-hidden ${telemetry.confidence < 0.5 ? "border-rose-900/50 animate-[pulse_2s_ease-in-out_infinite]" : "border-zinc-800 hover:border-cyan-900"}`}
                >
                  <div className="absolute top-0 right-0 w-8 h-8 bg-blue-500/10 rounded-full blur-xl" />
                  <span className="text-[9px] uppercase text-cyan-600 mb-1 tracking-widest font-bold">
                    Efficiency
                  </span>
                  <span className="text-xl sm:text-2xl font-mono tabular-nums text-blue-400">
                    {loading ? "..." : telemetry.ld_ratio.toFixed(1)}{" "}
                    <span className="text-[9px] text-cyan-800 font-sans tracking-tight">
                      L/D
                    </span>
                  </span>
                </div>
                <div className="bg-[#010609] p-2 sm:p-3 rounded border border-zinc-800 flex flex-col group relative hover:border-zinc-700 transition-colors">
                  <span className="text-[9px] uppercase text-zinc-500 mb-1 tracking-widest font-bold">
                    Moment (Cm)
                  </span>
                  <span className="text-xl sm:text-2xl font-mono tabular-nums text-zinc-300">
                    {loading ? "..." : telemetry.cm.toFixed(4)}
                  </span>
                </div>
                <div className="bg-[#010609] p-2 sm:p-3 rounded border border-zinc-800 flex flex-col col-span-2 md:col-span-1 hover:border-zinc-700 transition-colors">
                  <span className="text-[9px] uppercase text-zinc-500 mb-1 tracking-widest font-bold">
                    Reynolds
                  </span>
                  <span className="text-xl sm:text-2xl font-mono tabular-nums text-zinc-400">
                    {loading ? "..." : (telemetry.re / 1e6).toFixed(2)}
                    <span className="text-[9px] text-zinc-600 font-sans">
                      M
                    </span>
                  </span>
                </div>
              </div>
            )}

            {/* FORCES TAB */}
            {bottomTab === "forces" && (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2 sm:gap-3 flex-1 min-h-[140px] sm:min-h-0 items-start">
                <div className="bg-[#010609] p-2 sm:p-3 rounded border border-green-900/50 flex flex-col relative overflow-hidden">
                  <div className="absolute top-0 right-0 w-8 h-8 bg-emerald-500/10 rounded-full blur-xl" />
                  <span className="text-[9px] uppercase text-emerald-600 mb-1 tracking-widest font-bold">
                    Lift Force
                  </span>
                  <span className="text-xl sm:text-2xl font-mono tabular-nums text-green-400">
                    {loading
                      ? "..."
                      : Math.abs(liftForce) >= 1000
                        ? (liftForce / 1000).toFixed(1) + "kN"
                        : liftForce.toFixed(0) + "N"}
                  </span>
                </div>
                <div className="bg-[#010609] p-2 sm:p-3 rounded border border-amber-900/50 flex flex-col relative overflow-hidden">
                  <div className="absolute top-0 right-0 w-8 h-8 bg-amber-500/10 rounded-full blur-xl" />
                  <span className="text-[9px] uppercase text-amber-600 mb-1 tracking-widest font-bold">
                    Drag Force
                  </span>
                  <span className="text-xl sm:text-2xl font-mono tabular-nums text-amber-500">
                    {loading
                      ? "..."
                      : dragForce >= 1000
                        ? (dragForce / 1000).toFixed(1) + "kN"
                        : dragForce.toFixed(0) + "N"}
                  </span>
                </div>
                <div className="bg-[#010609] p-2 sm:p-3 rounded border border-zinc-800 flex flex-col md:col-span-1 col-span-2">
                  <span className="text-[9px] uppercase text-zinc-500 mb-1 tracking-widest font-bold">
                    Dyn. Pressure (q)
                  </span>
                  <span className="text-xl sm:text-2xl font-mono tabular-nums text-zinc-400">
                    {loading ? "..." : q.toFixed(0)}
                    <span className="text-[9px] text-zinc-600 font-sans">
                      Pa
                    </span>
                  </span>
                </div>
              </div>
            )}

            {/* POLARS TAB */}
            {bottomTab === "polars" &&
              (() => {
                const maxLDPt =
                  polarCurve.length > 0
                    ? polarCurve.reduce(
                        (max, pt) =>
                          pt.cl / pt.cd > max.cl / max.cd ? pt : max,
                        polarCurve[0],
                      )
                    : null;
                const maxClPt =
                  polarCurve.length > 0
                    ? polarCurve.reduce(
                        (max, pt) => (pt.cl > max.cl ? pt : max),
                        polarCurve[0],
                      )
                    : null;

                return (
                  <div className="grid grid-cols-2 gap-2 sm:gap-4 flex-1 min-h-[140px] sm:h-[180px]">
                    {/* Lift Polar */}
                    <div className="flex flex-col bg-zinc-900 rounded p-1.5 sm:p-2 border border-zinc-800 relative w-full h-[140px] sm:h-[180px]">
                      <div className="flex justify-between items-center mb-1 px-1 sm:px-2">
                        <span className="text-[8px] sm:text-[10px] uppercase text-zinc-500 tracking-widest font-bold">
                          Lift Polar (Cl vs α)
                        </span>
                        {maxClPt && (
                          <span className="text-[7px] sm:text-[9px] text-red-400 font-mono">
                            Stall α ≈ {maxClPt.alpha}°
                          </span>
                        )}
                      </div>
                      <div className="w-full flex-1 h-[140px] relative">
                        {polarCurve.length > 0 ? (
                          <ResponsiveContainer width="100%" height="100%">
                            <LineChart
                              margin={{
                                top: 15,
                                right: 10,
                                bottom: 5,
                                left: -25,
                              }}
                              data={polarCurve}
                            >
                              <CartesianGrid
                                strokeDasharray="3 3"
                                stroke="#ffffff05"
                              />
                              <XAxis
                                type="number"
                                dataKey="alpha"
                                tick={{ fontSize: 8, fill: "#52525b" }}
                                tickLine={false}
                                axisLine={false}
                                domain={["auto", "auto"]}
                              />
                              <YAxis
                                type="number"
                                dataKey="cl"
                                tick={{ fontSize: 8, fill: "#52525b" }}
                                tickLine={false}
                                axisLine={false}
                                domain={["auto", "auto"]}
                              />
                              <Tooltip
                                contentStyle={{
                                  backgroundColor: "#18181b",
                                  border: "1px solid #27272a",
                                  fontSize: "9px",
                                }}
                                cursor={{ strokeDasharray: "3 3" }}
                              />
                              {maxClPt && (
                                <ReferenceArea
                                  x1={maxClPt.alpha}
                                  x2={maxClPt.alpha + 5}
                                  fill="#ef4444"
                                  fillOpacity={0.05}
                                />
                              )}
                              <Line
                                type="monotone"
                                dataKey="cl"
                                stroke="#22c55e"
                                strokeWidth={2}
                                dot={false}
                                isAnimationActive={false}
                              />
                              <ReferenceDot
                                x={alpha}
                                y={telemetry.cl}
                                r={4}
                                fill="#ef4444"
                                stroke="#000"
                                strokeWidth={1}
                              />
                              {maxClPt && (
                                <ReferenceDot
                                  x={maxClPt.alpha}
                                  y={maxClPt.cl}
                                  r={4}
                                  fill="#ef4444"
                                  stroke="none"
                                  label={{
                                    position: "top",
                                    value: "Stall",
                                    fill: "#ef4444",
                                    fontSize: 8,
                                  }}
                                />
                              )}
                            </LineChart>
                          </ResponsiveContainer>
                        ) : (
                          <div className="absolute inset-0 flex items-center justify-center text-xs text-zinc-600 font-mono">Sweeping alphas...</div>
                        )}
                      </div>
                    </div>
                    {/* Drag Polar */}
                    <div className="flex flex-col bg-zinc-900 rounded p-1.5 sm:p-2 border border-zinc-800 relative w-full min-h-[160px] sm:h-[180px]">
                      <div className="flex justify-between items-center mb-1 px-1 sm:px-2 shrink-0">
                        <span className="text-[8px] sm:text-[10px] uppercase text-zinc-500 tracking-widest font-bold">
                          Drag Polar (Cl vs Cd)
                        </span>
                        {maxLDPt && (
                          <span className="text-[7px] sm:text-[9px] text-blue-400 font-mono">
                            Best L/D: {(maxLDPt.cl / maxLDPt.cd).toFixed(1)}
                          </span>
                        )}
                      </div>
                      <div className="w-full flex-1 h-[140px] relative">
                        {polarCurve.length > 0 ? (
                          <ResponsiveContainer width="100%" height="100%">
                            <ScatterChart
                              margin={{
                                top: 15,
                                right: 10,
                                bottom: 5,
                                left: -25,
                              }}
                            >
                              <CartesianGrid
                                strokeDasharray="3 3"
                                stroke="#ffffff05"
                              />
                              <XAxis
                                type="number"
                                dataKey="cd"
                                tick={{ fontSize: 8, fill: "#52525b" }}
                                tickLine={false}
                                axisLine={false}
                                domain={["auto", "auto"]}
                              />
                              <YAxis
                                type="number"
                                dataKey="cl"
                                tick={{ fontSize: 8, fill: "#52525b" }}
                                tickLine={false}
                                axisLine={false}
                                domain={["auto", "auto"]}
                              />
                              <Tooltip
                                contentStyle={{
                                  backgroundColor: "#18181b",
                                  border: "1px solid #27272a",
                                  fontSize: "9px",
                                }}
                                cursor={{ strokeDasharray: "3 3" }}
                              />
                              <Scatter
                                data={polarCurve}
                                line={{ stroke: "#3b82f6", strokeWidth: 2 }}
                                shape="circle"
                                fill="#3b82f6"
                                isAnimationActive={false}
                              />
                              <ReferenceDot
                                x={telemetry.cd}
                                y={telemetry.cl}
                                r={4}
                                fill="#ef4444"
                                stroke="#000"
                                strokeWidth={1}
                              />
                              {maxLDPt && (
                                <ReferenceDot
                                  x={maxLDPt.cd}
                                  y={maxLDPt.cl}
                                  r={4}
                                  fill="#3b82f6"
                                  stroke="none"
                                  label={{
                                    position: "top",
                                    value: "Best L/D",
                                    fill: "#3b82f6",
                                    fontSize: 8,
                                  }}
                                />
                              )}
                            </ScatterChart>
                          </ResponsiveContainer>
                        ) : (
                          <div className="absolute inset-0 flex items-center justify-center text-xs text-zinc-600 font-mono">Sweeping alphas...</div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })()}
          </div>
        </div>
      </div>

      {/* METHODOLOGY MODAL */}
      <AnimatePresence>
        {showMethodology && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="fixed inset-0 z-[60] bg-[#09090b]/60 backdrop-blur-md text-zinc-300 flex flex-col overflow-y-auto"
          >
            <div className="sticky top-0 w-full border-b border-zinc-700/50 bg-[#09090b]/40 backdrop-blur-xl z-20 px-6 py-4 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold text-white tracking-tight">
                  How does it work?
                </h2>
                <p className="text-xs text-zinc-400">
                  A manual of AI architecture, formulas, and datasets.
                </p>
              </div>
              <button
                onClick={() => setShowMethodology(false)}
                className="p-2 bg-zinc-800 hover:bg-zinc-700 rounded-md text-zinc-300 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="max-w-5xl mx-auto px-4 sm:px-6 py-12 space-y-12 relative z-10 w-full">
              <section>
                <h3 className="text-2xl font-bold text-white mb-4">Formulas</h3>
                <p className="text-sm text-zinc-400 mb-6 leading-relaxed">
                  Aerovate combines fundamental aerospace formulas with an AI
                  surrogate model designed specifically for early-stage
                  conceptual design iteration. The AI predicts the aerodynamic
                  coefficients which are then fed into classical formulas.
                </p>

                <div className="overflow-x-auto bg-zinc-900/20 border border-zinc-800 rounded-lg">
                  <table className="w-full text-left border-collapse text-sm">
                    <thead>
                      <tr className="border-b border-zinc-800 text-zinc-300 bg-zinc-900/40">
                        <th className="py-3 pl-5 pr-4 font-semibold whitespace-nowrap">
                          Parameter
                        </th>
                        <th className="py-3 pr-4 font-semibold whitespace-nowrap">
                          Symbol
                        </th>
                        <th className="py-3 pr-5 font-semibold">Formula</th>
                      </tr>
                    </thead>
                    <tbody className="text-zinc-400 divide-y divide-zinc-800/50">
                      <tr className="hover:bg-zinc-900/30 transition-colors">
                        <td className="py-3 pl-5 pr-4 text-white">
                          Lift Force
                        </td>
                        <td className="py-3 pr-4 font-mono text-zinc-300">L</td>
                        <td className="py-3 pr-5 font-mono text-zinc-300">
                          L = &frac12; &rho; V&sup2; S C<sub>L</sub>
                        </td>
                      </tr>
                      <tr className="hover:bg-zinc-800/30 transition-colors">
                        <td className="py-3 pl-5 pr-4 text-white">
                          Drag Force
                        </td>
                        <td className="py-3 pr-4 font-mono text-zinc-300">D</td>
                        <td className="py-3 pr-5 font-mono text-zinc-300">
                          D = &frac12; &rho; V&sup2; S C<sub>D</sub>
                        </td>
                      </tr>
                      <tr className="hover:bg-zinc-800/30 transition-colors">
                        <td className="py-3 pl-5 pr-4 text-white">Wing Area</td>
                        <td className="py-3 pr-4 font-mono text-zinc-300">S</td>
                        <td className="py-3 pr-5 font-mono text-zinc-300">
                          S = b &times; (C<sub>root</sub> + C<sub>tip</sub>) / 2
                        </td>
                      </tr>
                      <tr className="hover:bg-zinc-800/30 transition-colors">
                        <td className="py-3 pl-5 pr-4 text-white">
                          Stall Speed
                        </td>
                        <td className="py-3 pr-4 font-mono text-zinc-300">
                          V<sub>stall</sub>
                        </td>
                        <td className="py-3 pr-5 font-mono text-zinc-300">
                          V<sub>stall</sub> = &radic;(2W / (&rho; S C
                          <sub>L,max</sub>))
                        </td>
                      </tr>
                      <tr className="hover:bg-zinc-800/30 transition-colors">
                        <td className="py-3 pl-5 pr-4 text-white">
                          Structural Weight
                        </td>
                        <td className="py-3 pr-4 font-mono text-zinc-300">
                          W<sub>struct</sub>
                        </td>
                        <td className="py-3 pr-5 font-mono text-zinc-300">
                          W<sub>struct</sub> = S &times; t<sub>avg</sub> &times;
                          &rho;<sub>mat</sub> &times; g
                        </td>
                      </tr>
                      <tr className="hover:bg-zinc-900/30 transition-colors">
                        <td className="py-3 pl-5 pr-4 text-white">
                          Load Factor
                        </td>
                        <td className="py-3 pr-4 font-mono text-zinc-300">n</td>
                        <td className="py-3 pr-5 font-mono text-zinc-300">
                          n = L / W<sub>total</sub>
                        </td>
                      </tr>
                      <tr className="hover:bg-zinc-900/30 transition-colors">
                        <td className="py-3 pl-5 pr-4 text-white">
                          Structural Stress
                        </td>
                        <td className="py-3 pr-4 font-mono text-zinc-300">
                          &sigma;
                        </td>
                        <td className="py-3 pr-5 font-mono text-zinc-300">
                          &sigma; = (L/2 &times; b/4) / I<sub>root</sub>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <div className="mt-4 text-xs text-zinc-500 leading-relaxed px-2">
                  * Where <strong className="text-zinc-400">&rho;</strong> is
                  air density, <strong className="text-zinc-400">V</strong> is
                  velocity, <strong className="text-zinc-400">b</strong> is wing
                  span,{" "}
                  <strong className="text-zinc-400">
                    t<sub>avg</sub>
                  </strong>{" "}
                  is average wing thickness,{" "}
                  <strong className="text-zinc-400">
                    &rho;<sub>mat</sub>
                  </strong>{" "}
                  is material density, and{" "}
                  <strong className="text-zinc-400">
                    I<sub>root</sub>
                  </strong>{" "}
                  is the area moment of inertia at the wing root.
                </div>
              </section>

              <section>
                <h3 className="text-2xl font-bold text-white mb-4">
                  Assumptions & Constraints
                </h3>
                <div className="bg-zinc-900/30 border border-zinc-800 p-6 rounded-lg text-sm text-zinc-400 space-y-3">
                  <p>
                    <strong className="text-zinc-300">
                      Air Density (&rho;):
                    </strong>{" "}
                    Sea-level standard ISA (1.225 kg/m&sup3;) is assumed.
                  </p>
                  <p>
                    <strong className="text-zinc-300">
                      Steady State Flow:
                    </strong>{" "}
                    Equations ignore transient aeroelastic effects, dynamic
                    stall, and unsteady wake shedding.
                  </p>
                  <p>
                    <strong className="text-zinc-300">Rigid Body:</strong> The
                    wing structure is assumed infinitely stiff (no deformation
                    under aerodynamic load).
                  </p>
                  <p>
                    <strong className="text-zinc-300">Dimensionality:</strong>{" "}
                    Lift and drag are extrapolated from 2D airfoil data to 3D
                    Finite Wing Theory using standard correction factors.
                    Complex 3D cross-flows are ignored.
                  </p>
                  <p>
                    <strong className="text-zinc-300">
                      Payload & Systems (W<sub>payload</sub>):
                    </strong>{" "}
                    Modeled as a fixed mass or fixed fraction of total lifting
                    capacity unless customized.
                  </p>
                </div>
              </section>

              <section>
                <h3 className="text-2xl font-bold text-white mb-4">
                  Limitations
                </h3>
                <div className="bg-zinc-900/30 border border-zinc-800 p-6 rounded-lg text-sm text-zinc-400 space-y-3">
                  <p className="text-zinc-300 font-semibold mb-2 flex items-center gap-2 uppercase text-xs tracking-wider">
                    <AlertTriangle className="w-4 h-4" /> Predictive Boundaries
                  </p>
                  <ul className="list-disc list-outside ml-5 space-y-2 mt-2">
                    <li>
                      <strong className="text-white">
                        Structural Proxies:
                      </strong>{" "}
                      Stress and load calculations utilize hardcoded constant
                      multipliers rather than detailed material density or
                      precise cross-sectional beam theory computations.
                    </li>
                    <li>
                      <strong className="text-white">
                        Simplified Aerodynamics:
                      </strong>{" "}
                      The model abstracts away intricate 3D aerodynamic
                      phenomena such as wingtip vortices (induced drag), fixing
                      key variables like chord length and maximum lift
                      coefficient for computational speed.
                    </li>
                    <li>
                      <strong className="text-white">
                        Conceptual Performance Limits:
                      </strong>{" "}
                      Performance estimations, including aircraft range, use
                      simplified surrogate formulas. These intentionally omit
                      complex variables like specific fuel consumption metrics
                      and dynamic fuel weight fractions.
                    </li>
                    <li>
                      <strong className="text-white">
                        Locked Atmospheric Environment:
                      </strong>{" "}
                      To maintain rapid inference, the engine assumes
                      incompressible flow conditions and permanently constrains
                      the simulated atmosphere to standard Sea Level air density
                      (1.225 kg/m&sup3;). Calculations at high-altitudes or
                      high-speeds may be invalid.
                    </li>
                    <li>
                      <strong className="text-white">
                        Approximated Acoustic Inputs:
                      </strong>{" "}
                      The acoustic model's inputs are simplified versions of
                      reality. Frequency is fixed, and parameters like suction
                      side displacement are linearly approximated based on the
                      vehicle's angle of attack.
                    </li>
                  </ul>
                </div>
              </section>

              <section>
                <h3 className="text-2xl font-bold text-white mb-4">Datasets</h3>
                <p className="text-sm text-zinc-400 mb-6 leading-relaxed">
                  The surrogate models were trained on industry-standard
                  aerodynamics open datasets directly compiled into tabular
                  formats.
                </p>
                <div className="grid sm:grid-cols-2 gap-4">
                  <a
                    href="https://archive.ics.uci.edu/dataset/291/airfoil+self+noise"
                    target="_blank"
                    rel="noreferrer"
                    className="block bg-[#09090b] hover:bg-zinc-900 border border-zinc-800 p-5 rounded-sm transition-colors group"
                  >
                    <h4 className="text-zinc-200 font-semibold mb-1 group-hover:text-white flex justify-between items-center">
                      NASA Airfoil Noise Dataset{" "}
                      <Activity className="w-4 h-4 opacity-50 group-hover:opacity-100 transition-opacity" />
                    </h4>
                    <p className="text-xs text-zinc-400">
                      Used for predicting acoustic signatures based on
                      frequency, angle of attack, chord length, free-stream
                      velocity, and displacement thickness.
                    </p>
                  </a>
                  <a
                    href="https://m-selig.ae.illinois.edu/ads/coord_database.html"
                    target="_blank"
                    rel="noreferrer"
                    className="block bg-[#09090b] hover:bg-zinc-900 border border-zinc-800 p-5 rounded-sm transition-colors group"
                  >
                    <h4 className="text-zinc-200 font-semibold mb-1 group-hover:text-white flex justify-between items-center">
                      UIUC Airfoil Coordinates{" "}
                      <Activity className="w-4 h-4 opacity-50 group-hover:opacity-100 transition-opacity" />
                    </h4>
                    <p className="text-xs text-zinc-400">
                      Foundational aerodynamic geometric data for calculating
                      airfoil performance and CFD baseline interpolations.
                    </p>
                  </a>
                </div>
              </section>

              <section>
                <h3 className="text-2xl font-bold text-white mb-4">
                  Models & Accuracy Metrics
                </h3>
                <p className="text-sm text-zinc-400 mb-6 leading-relaxed">
                  The core predictive engine is powered by an{" "}
                  <strong className="text-zinc-200">
                    XGBoost (Extreme Gradient Boosting)
                  </strong>{" "}
                  model, selected for its speed, interpretability, and
                  performance on tabular engineering datasets. The metrics below
                  demonstrate the baseline errors reported during testing
                  against holdout aerodynamic data.
                </p>

                <div className="grid sm:grid-cols-2 gap-4 mb-6">
                  <div className="bg-[#09090b] border border-zinc-800 p-5 rounded-sm">
                    <h4 className="text-white font-semibold mb-4 flex items-center gap-2">
                      Coefficient Model
                    </h4>
                    <dl className="space-y-3 text-sm">
                      <div className="flex justify-between items-center pb-2 border-b border-zinc-800/50">
                        <dt className="text-zinc-400">
                          Lift Accuracy (R&sup2;)
                        </dt>
                        <dd className="font-mono text-zinc-300">
                          0.9841 (98.41%)
                        </dd>
                      </div>
                      <div className="flex justify-between items-center pt-1">
                        <dt className="text-zinc-400">
                          Drag Accuracy (R&sup2;)
                        </dt>
                        <dd className="font-mono text-zinc-300">
                          0.9136 (91.36%)
                        </dd>
                      </div>
                    </dl>
                  </div>
                  <div className="bg-[#09090b] border border-zinc-800 p-5 rounded-sm">
                    <h4 className="text-white font-semibold mb-4 flex items-center gap-2">
                      Acoustic / Noise Model
                    </h4>
                    <dl className="space-y-3 text-sm">
                      <div className="flex justify-between items-center pb-2 border-b border-zinc-800/50">
                        <dt className="text-zinc-400">
                          Mean Absolute Error (MAE)
                        </dt>
                        <dd className="font-mono text-zinc-300">0.86 dB</dd>
                      </div>
                      <div className="flex justify-between items-center pt-1">
                        <dt className="text-zinc-400">
                          Accuracy Score (R&sup2;)
                        </dt>
                        <dd className="font-mono text-zinc-300">
                          0.9643 (96.43%)
                        </dd>
                      </div>
                    </dl>
                  </div>
                </div>

                <div className="flex items-start md:items-center gap-4">
                  <button
                    onClick={() => alert("Downloading models.zip...")}
                    className="bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-600 px-6 py-3 rounded-sm font-bold flex items-center justify-center gap-2 transition-colors cursor-pointer text-sm shadow-sm"
                  >
                    <Download className="w-4 h-4" /> Download Models (.zip)
                  </button>
                </div>
              </section>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function MetricBox({
  title,
  value,
  unit,
  color,
}: {
  title: string;
  value: string | number;
  unit: string;
  color: string;
}) {
  return (
    <div className="bg-zinc-900/90 backdrop-blur-md border border-zinc-800 p-4 rounded-lg flex flex-col relative overflow-hidden w-full min-w-[120px]">
      <h4 className="text-[9px] uppercase tracking-widest text-zinc-500 mb-1 z-10">
        {title}
      </h4>
      <div className="flex items-baseline gap-1 mt-auto z-10">
        <span
          className="text-xl sm:text-2xl font-mono leading-none"
          style={{ color }}
        >
          {value}
        </span>
        <span className="text-[10px] font-mono text-zinc-600">{unit}</span>
      </div>
    </div>
  );
}
