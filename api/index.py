import os
import json
import numpy as np
import onnxruntime as rt
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List
from functools import lru_cache

app = FastAPI()

# Enable CORS for React communication
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Vercel Folder Path Setup
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MODELS_DIR = os.path.join(BASE_DIR, "models")

def load_res(f, is_onnx=True):
    """Helper to locate and load model files within the Vercel environment."""
    p = os.path.join(MODELS_DIR, f)
    if not os.path.exists(p):
        return None
    return rt.InferenceSession(p) if is_onnx else json.load(open(p))

# Cached loaders to prevent reloading models on every slider move
@lru_cache()
def get_aero_assets():
    return load_res("aero_model.onnx"), load_res("aero_scaler.json", False)

@lru_cache()
def get_noise_assets():
    return load_res("noise_model.onnx"), load_res("noise_scaler.json", False)

class TelemetryRequest(BaseModel):
    alpha: float
    velocity: float
    chord_length: float
    wing_span: float
    wing_area: float
    material_yield_strength: float
    weight_n: float
    thrust_n: float
    geometry_coeffs: List[float]

@app.get("/api")
async def root():
    return {"message": "Aerovate AI Engine Online"}

@app.post("/api/simulate")
async def simulate(req: TelemetryRequest):
    # Retrieve cached models/scalers
    aero_sess, aero_cfg = get_aero_assets()
    noise_sess, noise_cfg = get_noise_assets()
    
    try:
        # --- 1. AERO PREDICTION (64 Features) ---
        # Features: [62 geometry coeffs] + [Reynolds] + [Alpha]
        re_num = (1.225 * req.velocity * req.chord_length) / 1.81e-5
        aero_input = req.geometry_coeffs + [re_num, req.alpha]
        aero_features = np.array([aero_input], dtype=np.float32)

        Cl, Cd = 0.5, 0.05 # Fallbacks
        if aero_sess and aero_cfg:
            a_mean = np.array(aero_cfg['mean'], dtype=np.float32)
            a_scale = np.array(aero_cfg['scale'], dtype=np.float32)
            scaled_aero = (aero_features - a_mean) / a_scale
            a_res = aero_sess.run(None, {aero_sess.get_inputs()[0].name: scaled_aero})[0]
            Cl, Cd = float(a_res[0][0]), float(a_res[0][1])

        # --- 2. NOISE PREDICTION (5 Features) ---
        # Features: Frequency, Alpha, Chord, Velocity, SSD
        # Estimating SSD (Suction Side Displacement) based on Alpha
        ssd_estimate = 0.002663 * (1 + abs(req.alpha) * 0.1)
        noise_input = [1000.0, req.alpha, req.chord_length, req.velocity, ssd_estimate]
        noise_features = np.array([noise_input], dtype=np.float32)

        Noise_dB = 75.0 # Fallback
        if noise_sess and noise_cfg:
            n_mean = np.array(noise_cfg['mean'], dtype=np.float32)
            n_scale = np.array(noise_cfg['scale'], dtype=np.float32)
            scaled_noise = (noise_features - n_mean) / n_scale
            n_res = noise_sess.run(None, {noise_sess.get_inputs()[0].name: scaled_noise})[0]
            Noise_dB = float(n_res[0][0])

        # --- 3. PHYSICS CALCULATIONS ---
        q = 0.5 * 1.225 * (req.velocity ** 2)
        Lift_N = q * req.wing_area * Cl
        Drag_N = abs(q * req.wing_area * Cd)
        
        # Structural Stress & Factor of Safety
        Stress_MPa = (Lift_N * req.wing_span * 25) / 1e6
        FoS = req.material_yield_strength / max(1.0, Stress_MPa)
        
        # Stall Speed
        V_stall = np.sqrt(req.weight_n / (0.5 * 1.225 * req.wing_area * 1.5))
        
        # Dynamic Range (Breguet-inspired efficiency calc)
        Range_km = (Cl / max(0.001, Cd)) * (req.velocity / 10.0) * 5.0

        # --- 4. RETURN PAYLOAD ---
        # We explicitly cast to standard types to prevent numpy.bool/float errors
        return {
            "aero": {
                "Cl": float(Cl),
                "Cd": float(Cd),
                "Lift_N": float(Lift_N),
                "Drag_N": float(Drag_N)
            },
            "structure": {
                "Stress_MPa": float(Stress_MPa),
                "FoS": float(min(10.0, FoS))
            },
            "performance": {
                "V_stall_m_s": float(V_stall),
                "Takeoff_Ready": bool(req.velocity > V_stall),
                "Range_km": float(Range_km)
            },
            "noise": {
                "Noise_dB": float(Noise_dB)
            },
            "status": "FRACTURE" if FoS <= 1.0 else ("STRESSED" if FoS <= 1.5 else "OPTIMAL")
        }

    except Exception as e:
        return {"status": "ERROR", "message": str(e)}
