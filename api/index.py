import os
import json
import numpy as np
import onnxruntime as rt
from functools import lru_cache
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MODELS_DIR = os.path.join(BASE_DIR, "models")

@lru_cache()
def load_models():
    # Helper to load sessions and scaler JSONs
    def get_res(f, is_onnx=True):
        p = os.path.join(MODELS_DIR, f)
        if not os.path.exists(p): return None
        return rt.InferenceSession(p) if is_onnx else json.load(open(p))

    return (get_res("aero_model.onnx"), get_res("aero_scaler.json", False),
            get_res("noise_model.onnx"), get_res("noise_scaler.json", False))

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

class TelemetryRequest(BaseModel):
    alpha: float
    velocity: float
    chord_length: float
    wing_span: float
    wing_area: float
    material_yield_strength: float
    weight_n: float
    thrust_n: float
    geometry_coeffs: List[float] # This will be the 62 coefficients from React

@app.post("/api/simulate")
async def simulate(req: TelemetryRequest):
    aero_sess, aero_cfg, noise_sess, noise_cfg = load_models()
    
    try:
        # 1. Calculate Reynolds Number (Air Density ~1.225, Viscosity ~1.81e-5)
        re_num = (1.225 * req.velocity * req.chord_length) / 1.81e-5

        # 2. Build 64-feature vector: [62 Coeffs] + [Reynolds] + [Alpha]
        # This MUST match your training column order
        ml_input = req.geometry_coeffs + [re_num, req.alpha]
        features = np.array([ml_input], dtype=np.float32)

        # 3. ML Prediction (Efficiency Scores)
        Cl, Cd = 0.0, 0.0
        if aero_sess and aero_cfg:
            scaled = (features - np.array(aero_cfg['mean'])) / np.array(aero_cfg['scale'])
            res = aero_sess.run(None, {aero_sess.get_inputs()[0].name: scaled.astype(np.float32)})[0]
            # Handle MultiOutputRegressor shape [1, 2]
            Cl, Cd = float(res[0][0]), float(res[0][1])

        # 4. Physics Scaling (From 2D Score to 3D Force)
        q = 0.5 * 1.225 * (req.velocity ** 2)
        Lift_N = q * req.wing_area * Cl
        Drag_N = abs(q * req.wing_area * Cd)
        
        Stress_MPa = (Lift_N * req.wing_span * 25) / 1e6
        FoS = min(10.0, req.material_yield_strength / max(1.0, Stress_MPa))
        V_stall = np.sqrt(req.weight_n / (0.5 * 1.225 * req.wing_area * 1.5))

        return {
            "aero": {"Cl": Cl, "Cd": Cd, "Lift_N": Lift_N, "Drag_N": Drag_N},
            "structure": {"Stress_MPa": Stress_MPa, "FoS": FoS},
            "performance": {"V_stall_m_s": V_stall, "Takeoff_Ready": req.velocity > V_stall, "Range_km": 1200},
            "noise": {"Noise_dB": 75.0}, # Placeholder or use noise_sess logic
            "status": "OPTIMAL" if FoS > 1.5 else "STRESSED"
        }
    except Exception as e:
        return {"status": f"ERROR: {str(e)}", "aero": {"Cl": 0, "Cd": 0, "Lift_N": 0, "Drag_N": 0}, "structure": {"FoS": 0}}
