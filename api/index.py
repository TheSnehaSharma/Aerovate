import os
import joblib
import numpy as np
import onnxruntime as rt
from functools import lru_cache
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List

# ---------------------------------------------------------
# 1. OS Pathing
# ---------------------------------------------------------
CURRENT_FILE = os.path.abspath(__file__)
BASE_DIR = os.path.dirname(CURRENT_FILE)
MODELS_DIR = os.path.join(BASE_DIR, "models")

# ---------------------------------------------------------
# Global Model Handles & Error Tracking
# ---------------------------------------------------------
GLOBAL_ERROR_STATE = "Models not loaded yet"

# ---------------------------------------------------------
# Fault-Tolerant Lazy Model Loader
# ---------------------------------------------------------
@lru_cache()
def load_models():
    global GLOBAL_ERROR_STATE
    aero_model, aero_scaler = None, None
    noise_model, noise_scaler = None, None
    status_msgs = []

    if not os.path.exists(MODELS_DIR):
        GLOBAL_ERROR_STATE = f"Directory not found: {MODELS_DIR}"
        print(f"❌ {GLOBAL_ERROR_STATE}")
        return None, None, None, None

    # Try loading Aero models (.pkl)
    try:
        aero_model = joblib.load(os.path.join(MODELS_DIR, "aero_model.pkl"))
        aero_scaler = joblib.load(os.path.join(MODELS_DIR, "aero_scaler.pkl"))
        status_msgs.append("Aero: OK")
    except Exception as e:
        status_msgs.append("Aero: MISSING/ERROR")
        print(f"⚠️ Aero model failed to load: {e}")

    # Try loading Noise models (ONNX + .pkl scaler)
    try:
        noise_scaler = joblib.load(os.path.join(MODELS_DIR, "noise_scaler.pkl"))
        noise_model = rt.InferenceSession(os.path.join(MODELS_DIR, "noise_model.onnx"))
        status_msgs.append("Noise: OK (ONNX)")
    except Exception as e:
        status_msgs.append("Noise: MISSING/ERROR")
        print(f"⚠️ Noise model failed to load: {e}")

    GLOBAL_ERROR_STATE = " | ".join(status_msgs)
    print(f"System State: {GLOBAL_ERROR_STATE}")

    return aero_model, aero_scaler, noise_model, noise_scaler

# ---------------------------------------------------------
# FastAPI Init
# ---------------------------------------------------------
app = FastAPI(title="Aerovate ML Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------
# Debug Root Endpoint
# ---------------------------------------------------------
@app.get("/")
def root():
    return {"status": GLOBAL_ERROR_STATE}

# ---------------------------------------------------------
# Request Schema
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

# ---------------------------------------------------------
# Safe Fallback Response
# ---------------------------------------------------------
def zero_response(status_msg):
    return {
        "aero": {"Cl": 0.0, "Cd": 0.0, "Lift_N": 0.0, "Drag_N": 0.0},
        "structure": {"Stress_MPa": 0.0, "FoS": 0.0},
        "performance": {"V_stall_m_s": 0.0, "Takeoff_Ready": False, "Range_km": 0.0},
        "noise": {"Noise_dB": 0.0},
        "status": status_msg
    }

# ---------------------------------------------------------
# Health Check
# ---------------------------------------------------------
@app.get("/v1/ping")
async def ping_server():
    return {
        "status": "SUCCESS",
        "message": "FastAPI on Vercel is working"
    }

# ---------------------------------------------------------
# Simulation Endpoint
# ---------------------------------------------------------
@app.post("/v1/simulate")
async def simulate_physics(req: TelemetryRequest):

    aero_model, aero_scaler, noise_model, noise_scaler = load_models()

    try:
        # 1. Build Feature Vector
        features = np.array([[ 
            req.alpha, req.velocity, req.wing_area, req.wing_span,
            req.chord_length, req.thrust_n, req.weight_n
        ] + req.geometry_coeffs])

        # 2. Predict Aerodynamics (Fallback to 0.0 if missing)
        Cl, Cd = 0.0, 0.0
        if aero_model is not None and aero_scaler is not None:
            features_scaled = aero_scaler.transform(features)
            aero_pred = aero_model.predict(features_scaled)[0]
            Cl, Cd = float(aero_pred[0]), float(aero_pred[1])

        # 3. Physics Calculations (Calculates naturally with 0s if aero failed)
        q = 0.5 * 1.225 * (req.velocity ** 2)
        Lift_N = float(q * req.wing_area * Cl)
        Drag_N = float(abs(q * req.wing_area * Cd))
        
        Stress_MPa = float((Lift_N * req.wing_span * 25) / 1e6)
        FoS = float(min(10.0, req.material_yield_strength / max(1.0, Stress_MPa)))

        stall_base = 0.5 * 1.225 * req.wing_area * 1.5
        V_stall = float(np.sqrt(req.weight_n / stall_base)) if stall_base > 0 else 999.0
        
        Takeoff_Ready = bool(req.velocity > V_stall and req.thrust_n > 10000)
        Range_km = float(max(0, 1200 + (req.wing_span * 10) - (req.thrust_n / 1000 * 5) - (abs(req.alpha) * 10)))

        # 4. Predict Noise (ONNX Inference with Fallback)
        Noise_dB = 0.0
        if noise_model is not None and noise_scaler is not None:
            # ONNX strictly requires float32 mapping
            noise_scaled = noise_scaler.transform(features).astype(np.float32)
            
            # Extract input mapping and run
            input_name = noise_model.get_inputs()[0].name
            noise_pred = noise_model.run(None, {input_name: noise_scaled})[0]
            
            # Ravel flattens nested arrays to ensure we grab the float properly
            Noise_dB = float(np.ravel(noise_pred)[0])

        # 5. Status Logic
        if FoS <= 1.0:
            status = "FRACTURE"
        elif FoS <= 1.5:
            status = "STRESSED"
        else:
            status = "OPTIMAL"

        # 6. Response (Format remains identical)
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
