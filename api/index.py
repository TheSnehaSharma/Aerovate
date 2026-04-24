import os
import json
import numpy as np
import onnxruntime as rt
from functools import lru_cache
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List

# ---------------------------------------------------------
# OS Pathing & Global State
# ---------------------------------------------------------
CURRENT_FILE = os.path.abspath(__file__)
BASE_DIR = os.path.dirname(CURRENT_FILE)
MODELS_DIR = os.path.join(BASE_DIR, "models")

GLOBAL_ERROR_STATE = "Initializing..."

# ---------------------------------------------------------
# All-ONNX Lazy Loader (ZERO Scikit-Learn required)
# ---------------------------------------------------------
@lru_cache()
def load_models():
    global GLOBAL_ERROR_STATE
    aero_sess, noise_sess = None, None
    aero_cfg, noise_cfg = None, None
    status_msgs = []

    if not os.path.exists(MODELS_DIR):
        GLOBAL_ERROR_STATE = f"Directory not found: {MODELS_DIR}"
        return None, None, None, None

    # Helper to load JSON scaler configs
    def load_json(filename):
        path = os.path.join(MODELS_DIR, filename)
        if os.path.exists(path):
            with open(path, 'r') as f: 
                return json.load(f)
        return None

    # Try loading Aero files
    try:
        aero_sess = rt.InferenceSession(os.path.join(MODELS_DIR, "aero_model.onnx"))
        aero_cfg = load_json("aero_scaler.json")
        status_msgs.append("Aero: OK")
    except Exception as e:
        status_msgs.append("Aero: ERROR")
        print(f"⚠️ Aero load failed: {e}")

    # Try loading Noise files
    try:
        noise_sess = rt.InferenceSession(os.path.join(MODELS_DIR, "noise_model.onnx"))
        noise_cfg = load_json("noise_scaler.json")
        status_msgs.append("Noise: OK")
    except Exception as e:
        status_msgs.append("Noise: ERROR")
        print(f"⚠️ Noise load failed: {e}")

    GLOBAL_ERROR_STATE = " | ".join(status_msgs)
    print(f"System State: {GLOBAL_ERROR_STATE}")
    return aero_sess, aero_cfg, noise_sess, noise_cfg

# ---------------------------------------------------------
# FastAPI Init
# ---------------------------------------------------------
app = FastAPI(title="Aerovate ML Backend (ONNX Edition)")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------
# Schemas & Fallbacks
# ---------------------------------------------------------
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

def zero_response(status_msg):
    return {
        "aero": {"Cl": 0.0, "Cd": 0.0, "Lift_N": 0.0, "Drag_N": 0.0},
        "structure": {"Stress_MPa": 0.0, "FoS": 0.0},
        "performance": {"V_stall_m_s": 0.0, "Takeoff_Ready": False, "Range_km": 0.0},
        "noise": {"Noise_dB": 0.0},
        "status": status_msg
    }

@app.get("/")
def root(): 
    return {"status": GLOBAL_ERROR_STATE}

@app.get("/v1/ping")
async def ping_server():
    return {"status": "SUCCESS", "message": "Aerovate API is online"}

# ---------------------------------------------------------
# Simulation Endpoint
# ---------------------------------------------------------
@app.post("/v1/simulate")
async def simulate_physics(req: TelemetryRequest):
    aero_sess, aero_cfg, noise_sess, noise_cfg = load_models()

    try:
        # 1. Build Feature Vector (ONNX strictly requires float32)
        features = np.array([[ 
            req.alpha, req.velocity, req.wing_area, req.wing_span,
            req.chord_length, req.thrust_n, req.weight_n
        ] + req.geometry_coeffs], dtype=np.float32)

        # 2. Predict Aerodynamics (Manual Z-Score Scaling: (x - mean) / scale)
        Cl, Cd = 0.0, 0.0
        if aero_sess and aero_cfg:
            means = np.array(aero_cfg['mean'], dtype=np.float32)
            scales = np.array(aero_cfg['scale'], dtype=np.float32)
            scaled_features = (features - means) / scales
            
            input_name = aero_sess.get_inputs()[0].name
            aero_pred = aero_sess.run(None, {input_name: scaled_features})[0]
            Cl, Cd = float(aero_pred[0][0]), float(aero_pred[0][1])

        # 3. Physics Calculations 
        q = 0.5 * 1.225 * (req.velocity ** 2)
        Lift_N = float(q * req.wing_area * Cl)
        Drag_N = float(abs(q * req.wing_area * Cd))
        
        Stress_MPa = float((Lift_N * req.wing_span * 25) / 1e6)
        FoS = float(min(10.0, req.material_yield_strength / max(1.0, Stress_MPa)))

        stall_base = 0.5 * 1.225 * req.wing_area * 1.5
        V_stall = float(np.sqrt(req.weight_n / stall_base)) if stall_base > 0 else 999.0
        
        Takeoff_Ready = bool(req.velocity > V_stall and req.thrust_n > 10000)
        Range_km = float(max(0, 1200 + (req.wing_span * 10) - (req.thrust_n / 1000 * 5) - (abs(req.alpha) * 10)))

        # 4. Predict Noise (Manual Scaling)
        Noise_dB = 0.0
        if noise_sess and noise_cfg:
            means = np.array(noise_cfg['mean'], dtype=np.float32)
            scales = np.array(noise_cfg['scale'], dtype=np.float32)
            scaled_features = (features - means) / scales
            
            input_name = noise_sess.get_inputs()[0].name
            noise_pred = noise_sess.run(None, {input_name: scaled_features})[0]
            Noise_dB = float(np.ravel(noise_pred)[0])

        # 5. Status Logic
        if FoS <= 1.0: 
            status = "FRACTURE"
        elif FoS <= 1.5: 
            status = "STRESSED"
        else: 
            status = "OPTIMAL"

        # 6. JSON Response
        return {
            "aero": {"Cl": Cl, "Cd": Cd, "Lift_N": Lift_N, "Drag_N": Drag_N},
            "structure": {"Stress_MPa": Stress_MPa, "FoS": FoS},
            "performance": {"V_stall_m_s": V_stall, "Takeoff_Ready": Takeoff_Ready, "Range_km": Range_km},
            "noise": {"Noise_dB": Noise_dB},
            "status": status
        }

    except Exception as e:
        error_msg = f"PREDICT ERROR: {str(e)}"
        print(f"❌ {error_msg}")
        return zero_response(error_msg)
