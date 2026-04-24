import os
import json
import numpy as np
import onnxruntime as rt
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List

app = FastAPI()

# Enable CORS so your React app can talk to the backend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Vercel path setup
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MODELS_DIR = os.path.join(BASE_DIR, "models")

def load_res(f, is_onnx=True):
    p = os.path.join(MODELS_DIR, f)
    if not os.path.exists(p):
        return None
    return rt.InferenceSession(p) if is_onnx else json.load(open(p))

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
    return {"message": "API is online"}

@app.post("/api/simulate")
async def simulate(req: TelemetryRequest):
    aero_sess = load_res("aero_model.onnx")
    aero_cfg = load_res("aero_scaler.json", False)
    noise_sess = load_res("noise_model.onnx")
    noise_cfg = load_res("noise_scaler.json", False)
    
    try:
        # --- 1. AERO FEATURE VECTOR (64 Features) ---
        # [62 Coeffs] + [Reynolds] + [Alpha]
        re_num = (1.225 * req.velocity * req.chord_length) / 1.81e-5
        aero_ml_input = req.geometry_coeffs + [re_num, req.alpha]
        aero_features = np.array([aero_ml_input], dtype=np.float32)

        # --- 2. NOISE FEATURE VECTOR (5 Features) ---
        # Features: Frequency, AoA, Chord, Velocity, Suction_Side_Displacement
        # We'll use 1000Hz as a standard reference frequency
        # SSD is usually ~0.002-0.01 depending on the airfoil
        ssd_estimate = 0.002663 * (1 + abs(req.alpha) * 0.1) 
        
        noise_ml_input = [
            1000.0,            # Frequency (Hz)
            req.alpha,         # Angle of Attack
            req.chord_length,  # Chord Length
            req.velocity,      # Free-stream Velocity
            ssd_estimate       # Suction Side Displacement
        ]
        noise_features = np.array([noise_ml_input], dtype=np.float32)

        # --- 3. RUN PREDICTIONS ---
        Cl, Cd, Noise_dB = 0.5, 0.05, 75.0

        if aero_sess and aero_cfg:
            scaled_aero = (aero_features - np.array(aero_cfg['mean'])) / np.array(aero_cfg['scale'])
            a_res = aero_sess.run(None, {aero_sess.get_inputs()[0].name: scaled_aero.astype(np.float32)})[0]
            Cl, Cd = float(a_res[0][0]), float(a_res[0][1])

        if noise_sess and noise_cfg:
            scaled_noise = (noise_features - np.array(noise_cfg['mean'])) / np.array(noise_cfg['scale'])
            n_res = noise_sess.run(None, {noise_sess.get_inputs()[0].name: scaled_noise.astype(np.float32)})[0]
            Noise_dB = float(n_res[0][0])

        # --- 4. PHYSICS MATH ---
        q = 0.5 * 1.225 * (req.velocity ** 2)
        Lift_N = q * req.wing_area * Cl
        Drag_N = abs(q * req.wing_area * Cd)
        
        Stress_MPa = (Lift_N * req.wing_span * 25) / 1e6
        FoS = req.material_yield_strength / max(1.0, Stress_MPa)
        V_stall = np.sqrt(req.weight_n / (0.5 * 1.225 * req.wing_area * 1.5))
        
        # Range is influenced by Aero Efficiency (L/D)
        Range_km = (Cl / max(0.001, Cd)) * (req.velocity / 10.0) * 5.0

        return {
            "aero": {
                "Cl": float(Cl), "Cd": float(Cd), 
                "Lift_N": float(Lift_N), "Drag_N": float(Drag_N)
            },
            "structure": {
                "Stress_MPa": float(Stress_MPa), "FoS": float(min(10.0, FoS))
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
