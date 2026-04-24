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
    
    try:
        # 1. Physics Calculations
        re_num = (1.225 * req.velocity * req.chord_length) / 1.81e-5

        # 2. ML Prediction
        Cl, Cd = 0.5, 0.05 # Default fallbacks
        if aero_sess and aero_cfg:
            ml_input = req.geometry_coeffs + [re_num, req.alpha]
            features = np.array([ml_input], dtype=np.float32)
            scaled = (features - np.array(aero_cfg['mean'])) / np.array(aero_cfg['scale'])
            res = aero_sess.run(None, {aero_sess.get_inputs()[0].name: scaled.astype(np.float32)})[0]
            Cl, Cd = res[0][0], res[0][1]

        # 3. Physics Scaling
        q = 0.5 * 1.225 * (req.velocity ** 2)
        Lift_N = q * req.wing_area * Cl
        Drag_N = abs(q * req.wing_area * Cd)
        
        Stress_MPa = (Lift_N * req.wing_span * 25) / 1e6
        FoS = req.material_yield_strength / max(1.0, Stress_MPa)
        V_stall = np.sqrt(req.weight_n / (0.5 * 1.225 * req.wing_area * 1.5))
        
        # 4. THE CRITICAL FIX: Explicitly cast everything to standard Python types
        # This prevents the "numpy.bool is not iterable" error
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
                "Takeoff_Ready": bool(req.velocity > V_stall), # Forced standard bool
                "Range_km": 1200
            },
            "noise": {"Noise_dB": 75.0},
            "status": "FRACTURE" if float(FoS) <= 1.0 else ("STRESSED" if float(FoS) <= 1.5 else "OPTIMAL")
        }
    except Exception as e:
        return {"status": "ERROR", "message": str(e)}
