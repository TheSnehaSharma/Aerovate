import { useMemo, useRef, useState, type PointerEvent } from "react";
import { Maximize } from "lucide-react";
import type { AirfoilPoint } from "../lib/physics.ts";
import type { Geometry } from "../lib/presets.ts";

type Handle = "camber" | "thickness";
type ShapePatch = Partial<Pick<Geometry, "m" | "p" | "t">>;

interface Props {
  points: AirfoilPoint[];
  alpha: number;
  onChange: (patch: ShapePatch) => void;
}

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

/** 2D airfoil profile with draggable camber and thickness handles. */
export default function ProfileEditor({ points, alpha, onChange }: Props) {
  const [dragging, setDragging] = useState<Handle | null>(null);
  const rotatedGroupRef = useRef<SVGGElement>(null);

  const { outline, camberLine, camberHandle, thicknessHandle } = useMemo(() => {
    const upper = points.map((pt) => `${pt.x},${-pt.yu}`);
    const lower = points.map((pt) => `${pt.x},${-pt.yl}`).reverse();
    return {
      outline: [...upper, ...lower].join(" "),
      camberLine: points.map((pt) => `${pt.x},${-pt.yc}`).join(" "),
      camberHandle: points.reduce((best, pt) => (Math.abs(pt.yc) > Math.abs(best.yc) ? pt : best), points[0]),
      thicknessHandle: points.reduce((best, pt) => (pt.yt > best.yt ? pt : best), points[0]),
    };
  }, [points]);

  const handleMove = (e: PointerEvent) => {
    const ctm = rotatedGroupRef.current?.getScreenCTM();
    if (!dragging || !ctm) return;
    // Pointer position in the airfoil's own (alpha-rotated, y-down) coordinate system.
    const local = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    if (dragging === "camber") {
      onChange({ p: clamp(local.x, 0.05, 0.95), m: clamp(-local.y, -0.09, 0.09) });
    } else {
      onChange({ t: clamp(Math.abs(local.y) * 2.5, 0.01, 0.4) });
    }
  };

  const startDrag = (handle: Handle) => (e: PointerEvent) => {
    e.preventDefault();
    setDragging(handle);
  };
  const stopDrag = () => setDragging(null);
  const rotation = `rotate(${-alpha}, 0.25, 0)`;

  return (
    <div className="absolute top-24 sm:top-4 left-4 sm:left-auto right-auto sm:right-4 w-40 sm:w-64 aspect-[2/1] bg-black/70 backdrop-blur-md border border-white/10 rounded-lg pointer-events-auto overflow-hidden shadow-2xl z-20">
      <div className="px-2 py-1 bg-white/5 text-[9px] uppercase tracking-widest text-zinc-500 border-b border-white/10 flex justify-between">
        <span className="flex items-center gap-1">
          <Maximize size={8} /> Profile Editor
        </span>
        <span className="text-[8px] opacity-40">2D HUD</span>
      </div>
      <svg
        viewBox="-0.1 -0.5 1.2 1"
        preserveAspectRatio="xMidYMid meet"
        className="w-full h-full touch-none"
        role="img"
        aria-label="Airfoil profile editor: drag the cyan handle to change camber and the red handle to change thickness"
        onPointerMove={handleMove}
        onPointerUp={stopDrag}
        onPointerLeave={stopDrag}
      >
        <defs>
          <pattern id="grid" width="0.1" height="0.1" patternUnits="userSpaceOnUse">
            <path d="M 0.1 0 L 0 0 0 0.1" fill="none" stroke="#0F2836" strokeWidth="0.002" />
          </pattern>
        </defs>
        <rect x="-0.1" y="-0.5" width="1.2" height="1" fill="url(#grid)" opacity="0.5" />
        <line x1="-0.1" y1="0" x2="1.1" y2="0" stroke="#0F2836" strokeWidth="0.005" />
        <line x1="0" y1="-0.5" x2="0" y2="0.5" stroke="#0F2836" strokeWidth="0.005" />

        {dragging && (
          <g transform={rotation} opacity="0.2">
            <polygon points={outline} fill="#ffffff" />
          </g>
        )}

        <g ref={rotatedGroupRef} transform={rotation}>
          <polyline
            points={camberLine}
            fill="none"
            stroke="rgba(255,255,255,0.1)"
            strokeWidth="0.005"
            strokeDasharray="0.01,0.01"
          />
          <polygon points={outline} fill="transparent" stroke="rgba(255,255,255,0.2)" strokeWidth="0.005" />
          <g
            transform={`translate(${camberHandle.x}, ${-camberHandle.yc})`}
            style={{ cursor: "move" }}
            onPointerDown={startDrag("camber")}
          >
            <circle r="0.06" fill="transparent" />
            <circle r="0.03" fill="#22D3EE" opacity="0.3" className="animate-ping origin-center" />
            <circle r="0.02" fill="#22D3EE" />
          </g>
          <g
            transform={`translate(${thicknessHandle.x}, ${-(thicknessHandle.yc + thicknessHandle.yt)})`}
            style={{ cursor: "ns-resize" }}
            onPointerDown={startDrag("thickness")}
          >
            <circle r="0.06" fill="transparent" />
            <circle r="0.03" fill="#F43F5E" opacity="0.3" className="animate-ping origin-center" />
            <circle r="0.02" fill="#F43F5E" />
          </g>
        </g>
      </svg>
    </div>
  );
}
