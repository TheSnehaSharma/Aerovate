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

@app.post("/api/v1/simulate")
@app.post("/api/simulate")
async def simulate(req: TelemetryRequest):
    # Retrieve cached models/scalers
    aero_sess, aero_cfg = get_aero_assets()
    noise_sess, noise_cfg = get_noise_assets()
    
    try:
        import math
        rho = 1.225
        alphaRad = req.alpha * (math.pi / 180)
        Cl_alpha = 2 * math.pi
        AR = (req.wing_span ** 2) / req.wing_area if req.wing_area > 0 else 1.0
        e = 0.8
        
        # Fallbacks based on classical physics
        Cl = Cl_alpha * alphaRad * (AR / (AR + 2)) if alphaRad > -0.1 else 0
        Cd_p = 0.02
        Cd_i = (Cl ** 2) / (math.pi * AR * e)
        Cd = Cd_p + Cd_i

        # --- 1. AERO PREDICTION (64 Features) ---
        # Features: [62 geometry coeffs] + [Reynolds] + [Alpha]
        re_num = (1.225 * req.velocity * req.chord_length) / 1.81e-5
        aero_input = req.geometry_coeffs + [re_num, req.alpha]
        aero_features = np.array([aero_input], dtype=np.float32)

        if aero_sess and aero_cfg:
            a_mean = np.array(aero_cfg['mean'], dtype=np.float32)
            a_scale = np.array(aero_cfg['scale'], dtype=np.float32)
            scaled_aero = (aero_features - a_mean) / a_scale
            a_res = aero_sess.run(None, {aero_sess.get_inputs()[0].name: scaled_aero})[0]
            Cl, Cd = float(a_res[0][0]), float(a_res[0][1])

        # --- 2. NOISE PREDICTION (5 Features) ---
        ssd_estimate = 0.002663 * (1 + abs(req.alpha) * 0.1)
        noise_input = [1000.0, req.alpha, req.chord_length, req.velocity, ssd_estimate]
        noise_features = np.array([noise_input], dtype=np.float32)

        base_db = 50 + 10 * math.log10(req.thrust_n) if req.thrust_n > 0 else 0
        vel_db = 20 * math.log10(req.velocity) if req.velocity > 0 else 0
        Noise_dB = base_db + vel_db

        if noise_sess and noise_cfg:
            n_mean = np.array(noise_cfg['mean'], dtype=np.float32)
            n_scale = np.array(noise_cfg['scale'], dtype=np.float32)
            scaled_noise = (noise_features - n_mean) / n_scale
            n_res = noise_sess.run(None, {noise_sess.get_inputs()[0].name: scaled_noise})[0]
            Noise_dB = float(n_res[0][0])

        # --- 3. PHYSICS CALCULATIONS ---
        q = 0.5 * rho * (req.velocity ** 2)
        Lift_N = q * req.wing_area * Cl
        Drag_N = abs(q * req.wing_area * Cd)
        
        # Structural Stress & Factor of Safety
        material_yield_strength_Pa = req.material_yield_strength * 1e6
        h = req.chord_length * 0.12
        t = 0.005
        b = req.chord_length * 0.5
        I = (b * (h ** 3) - max(0, b - 2 * t) * (max(0, h - 2 * t) ** 3)) / 12
        y = h / 2
        
        root_bending_moment = (Lift_N * req.wing_span) / 8
        Stress_Pa = (root_bending_moment * y) / max(1e-9, I)
        Stress_MPa = Stress_Pa / 1e6
        FoS = req.material_yield_strength / max(1.0, Stress_MPa)

        M_per_G = (req.weight_n * req.wing_span) / 8
        Stress_Pa_per_G = (M_per_G * y) / max(1e-9, I)
        n_max = material_yield_strength_Pa / max(1.0, Stress_Pa_per_G)
        
        # Stall Speed
        alphaStallRad = 15 * (math.pi / 180)
        CL_max = max(0.1, Cl_alpha * alphaStallRad * (AR / (AR + 2)))
        V_stall = math.sqrt(req.weight_n / (0.5 * rho * req.wing_area * CL_max))
        Takeoff_Ready = req.velocity > V_stall
        V_star_m_s = math.sqrt((2 * n_max * req.weight_n) / (rho * req.wing_area * CL_max))
        
        # Dynamic Range (Breguet Range Equation)
        eta = 0.8
        SFC = 5e-7
        W_initial = req.weight_n
        W_final = req.weight_n * 0.8
        LD_ratio = Lift_N / max(Drag_N, 1)
        Range_m = (eta / SFC) * LD_ratio * math.log(W_initial / W_final)
        Range_km = Range_m / 1000 if Range_m > 0 else 0

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
                "FoS": float(min(10.0, FoS)),
                "n_max": float(n_max)
            },
            "performance": {
                "V_stall_m_s": float(V_stall),
                "Takeoff_Ready": bool(Takeoff_Ready),
                "Range_km": float(Range_km),
                "V_star_m_s": float(V_star_m_s)
            },
            "noise": {
                "Noise_dB": float(Noise_dB)
            },
            "status": "FRACTURE" if FoS <= 1.0 else ("STRESSED" if FoS <= 1.5 else "OPTIMAL")
        }

    except Exception as e:
        return {"status": "ERROR", "message": str(e)}
