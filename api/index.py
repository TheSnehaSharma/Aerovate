import os
import uvicorn
import joblib
import numpy as np
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
aero_model = None
aero_scaler = None
noise_model = None
noise_scaler = None
GLOBAL_ERROR_STATE = "Models are booting..."

def load_models():
    global aero_model, aero_scaler, noise_model, noise_scaler, GLOBAL_ERROR_STATE
    try:
        if not os.path.exists(MODELS_DIR):
            raise FileNotFoundError(f"Directory not found: {MODELS_DIR}")
            
        aero_model = joblib.load(os.path.join(MODELS_DIR, "aero_model.pkl"))
        aero_scaler = joblib.load(os.path.join(MODELS_DIR, "aero_scaler.pkl"))
        noise_model = joblib.load(os.path.join(MODELS_DIR, "noise_model.pkl"))
        noise_scaler = joblib.load(os.path.join(MODELS_DIR, "noise_scaler.pkl"))
        
        GLOBAL_ERROR_STATE = "ALL SYSTEMS GO"
        print("✅ ML models loaded successfully")

    except Exception as e:
        GLOBAL_ERROR_STATE = f"LOAD ERROR: {str(e)}"
        print("MODEL LOAD FAILED:", GLOBAL_ERROR_STATE)
        aero_model = None
        noise_model = None

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

@app.on_event("startup")
async def startup_event():
    load_models()

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
# Simulation Endpoint
# ---------------------------------------------------------
@app.get("/api/v1/ping")
async def ping_server():
    return {"status": "SUCCESS", "message": "The Vercel Python API is alive and routing correctly!"}

@app.post("/api/v1/simulate")
async def simulate_physics(req: TelemetryRequest):
    global GLOBAL_ERROR_STATE

    # Guard: If models failed to load, return error to UI
    if aero_model is None or noise_model is None:
        return zero_response(GLOBAL_ERROR_STATE)

    try:
        # 1. Build Feature Vector (MUST be 69 length based on your setup)
        features = np.array([[ 
            req.alpha, req.velocity, req.wing_area, req.wing_span,
            req.chord_length, req.thrust_n, req.weight_n
        ] + req.geometry_coeffs])

        # 2. Predict Aerodynamics
        features_scaled = aero_scaler.transform(features)
        aero_pred = aero_model.predict(features_scaled)[0]
        Cl, Cd = float(aero_pred[0]), float(aero_pred[1])

        # 3. Physics Math
        q = 0.5 * 1.225 * (req.velocity ** 2)
        Lift_N = float(q * req.wing_area * Cl)
        Drag_N = float(abs(q * req.wing_area * Cd))
        
        Stress_MPa = float((Lift_N * req.wing_span * 25) / 1e6)
        FoS = float(min(10.0, req.material_yield_strength / max(1.0, Stress_MPa)))

        stall_base = 0.5 * 1.225 * req.wing_area * 1.5
        V_stall = float(np.sqrt(req.weight_n / stall_base)) if stall_base > 0 else 999.0
        
        Takeoff_Ready = bool(req.velocity > V_stall and req.thrust_n > 10000)
        Range_km = float(max(0, 1200 + (req.wing_span * 10) - (req.thrust_n / 1000 * 5) - (abs(req.alpha) * 10)))

        # 4. Predict Noise
        noise_scaled = noise_scaler.transform(features)
        Noise_dB = float(noise_model.predict(noise_scaled)[0])

        # 5. Status Logic
        if FoS <= 1.0: status = "FRACTURE"
        elif FoS <= 1.5: status = "STRESSED"
        else: status = "OPTIMAL"

        # 6. Return Payload
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

if __name__ == "__main__":
    uvicorn.run("index:app", host="0.0.0.0", port=8000, reload=True)
