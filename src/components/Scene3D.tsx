import { useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, PerspectiveCamera } from "@react-three/drei";
import { Bloom, EffectComposer } from "@react-three/postprocessing";
import * as THREE from "three";
import type { AirfoilPoint } from "../lib/physics.ts";

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const MAX_FRAME_DELTA_S = 0.05;

/** Visual-only pressure colouring (blue = suction, red = high pressure) from the surface normal and Cl. */
function pressureColor(nx: number, ny: number, cl: number): [number, number, number] {
  const lift = Math.max(0, cl);
  let cp = 1 - (nx * nx + ny * ny);
  cp += ny > 0 ? -lift * 1.5 * ny : lift * 0.5 * -ny;
  if (nx < -0.8) cp += 1; // stagnation region

  if (cp > 0.5) return [1, 1 - cp, 0];
  if (cp < -0.5) return [0, 0.5, 1];
  return [
    clamp01(1.5 - Math.abs(cp * 2 - 1)),
    clamp01(1.5 - Math.abs(cp * 2)),
    clamp01(1.5 - Math.abs(cp * 2 + 1)),
  ];
}

interface AirfoilProps {
  points: AirfoilPoint[];
  alpha: number;
  cl: number;
  chord: number;
  span: number;
}

function Airfoil3D({ points, alpha, cl, chord, span }: AirfoilProps) {
  const shape = useMemo(() => {
    const s = new THREE.Shape();
    s.moveTo(points[0].x, points[0].yu);
    for (let i = 1; i < points.length; i++) s.lineTo(points[i].x, points[i].yu);
    for (let i = points.length - 2; i >= 0; i--) s.lineTo(points[i].x, points[i].yl);
    s.closePath();
    return s;
  }, [points]);

  const extrudeSettings = useMemo(
    () => ({ depth: span, bevelEnabled: true, bevelThickness: 0.002, bevelSize: 0.002, bevelSegments: 3 }),
    [span],
  );

  const geometryRef = useRef<THREE.ExtrudeGeometry>(null);

  useEffect(() => {
    const geometry = geometryRef.current;
    if (!geometry) return;
    geometry.computeVertexNormals();
    const count = geometry.attributes.position.count;
    const normals = geometry.attributes.normal.array;
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      colors.set(pressureColor(normals[i * 3], normals[i * 3 + 1], cl), i * 3);
    }
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  }, [shape, extrudeSettings, cl]);

  // Rotate about the quarter-chord point.
  return (
    <group position={[0.25 * chord, 0, 0]} rotation={[0, 0, (alpha * Math.PI) / 180]}>
      <group position={[-0.25 * chord, 0, 0]}>
        <mesh position={[0, 0, -span / 2]} scale={[chord, chord, 1]} castShadow receiveShadow>
          <extrudeGeometry ref={geometryRef} args={[shape, extrudeSettings]} />
          <meshStandardMaterial vertexColors roughness={0.3} metalness={0.4} />
        </mesh>
      </group>
    </group>
  );
}

const PARTICLE_COUNT = 800;

interface StreamlinesProps {
  alpha: number;
  velocity: number;
  chord: number;
  span: number;
}

/** Decorative potential-flow approximation (free stream + doublet + vortex); not a CFD result. */
function WindStreamlines({ alpha, velocity, chord, span }: StreamlinesProps) {
  const linePositions = useMemo(() => new Float32Array(PARTICLE_COUNT * 6), []);
  const particles = useMemo(() => {
    const state = new Float32Array(PARTICLE_COUNT * 3);
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      state[i * 3] = (Math.random() - 0.5) * 6;
      state[i * 3 + 1] = (Math.random() - 0.5) * 4;
      state[i * 3 + 2] = (Math.random() - 0.5) * span * 1.2;
    }
    return state;
  }, [span]);

  const linesRef = useRef<THREE.LineSegments>(null);

  useFrame((_, rawDelta) => {
    const lines = linesRef.current;
    if (!lines) return;
    const delta = Math.min(rawDelta, MAX_FRAME_DELTA_S); // avoid jumps after the tab was in the background
    const pos = lines.geometry.attributes.position.array as Float32Array;

    const uInf = 0.5 + velocity / 100;
    const alphaRad = (alpha * Math.PI) / 180;
    const u0 = uInf * Math.cos(alphaRad);
    const v0 = uInf * Math.sin(alphaRad);
    const x0 = 0.25 * chord;
    const gamma = Math.max(-2, Math.min(2, alphaRad * 2 * Math.PI)) * chord * uInf * 0.5;
    const kappa = chord * chord * uInf * 0.05;

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      let x = particles[i * 3];
      let y = particles[i * 3 + 1];
      const z = particles[i * 3 + 2];

      const dx = x - x0;
      const dy = y;
      const r2 = Math.max(0.01, dx * dx + dy * dy);
      const r4 = r2 * r2;

      let u = u0 - (kappa * (dx * dx - dy * dy)) / r4 + (gamma / (2 * Math.PI)) * (dy / r2);
      let v = v0 - (kappa * 2 * dx * dy) / r4 - (gamma / (2 * Math.PI)) * (dx / r2);

      // Slow particles inside the airfoil's approximate volume.
      if (dx > -0.2 * chord && dx < 0.8 * chord && Math.abs(dy) < 0.1 * chord && Math.abs(z) < span / 2) {
        u *= 0.1;
        v *= 0.1;
      }

      x += u * delta * 4;
      y += v * delta * 4;
      if (x > 3) {
        x = -4 - Math.random();
        y = (Math.random() - 0.5) * 6;
      }
      particles[i * 3] = x;
      particles[i * 3 + 1] = y;

      const tail = 0.3;
      pos.set([x, y, z, x - u * tail, y - v * tail, z], i * 6);
    }
    lines.geometry.attributes.position.needsUpdate = true;
  });

  return (
    <lineSegments ref={linesRef}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" count={PARTICLE_COUNT * 2} array={linePositions} itemSize={3} />
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

interface SceneProps extends AirfoilProps {
  velocity: number;
}

export default function Scene3D({ points, alpha, cl, chord, span, velocity }: SceneProps) {
  return (
    <Canvas shadows dpr={[1, 2]}>
      <PerspectiveCamera makeDefault position={[3, 2, 8]} fov={45} />
      <OrbitControls makeDefault enableDamping dampingFactor={0.05} />
      <ambientLight intensity={0.6} />
      <pointLight position={[10, 10, 10]} intensity={1} />
      <directionalLight position={[2, 5, 2]} intensity={1.5} castShadow />
      <Airfoil3D points={points} alpha={alpha} cl={cl} chord={chord} span={span} />
      <WindStreamlines alpha={alpha} velocity={velocity} chord={chord} span={span} />
      <EffectComposer>
        <Bloom luminanceThreshold={0.2} luminanceSmoothing={0.9} height={300} intensity={1.5} />
      </EffectComposer>
    </Canvas>
  );
}
