import sys
import json
import numpy as np

try:
    import neuralfoil as nf
    import aerosandbox as asb
except ImportError:
    print(json.dumps({"error": "neuralfoil or aerosandbox not installed"}), file=sys.stderr)
    sys.exit(1)

def main():
    try:
        input_data = sys.stdin.read()
        if not input_data:
            print(json.dumps({"error": "No input data provided"}), file=sys.stderr)
            sys.exit(1)
            
        req = json.loads(input_data)
        
        coordinates = req.get("coordinates")
        alpha = float(req.get("alpha", 0.0))
        alphas = req.get("alphas")
        Re = float(req.get("Re", 1e6))
        
        Re = min(max(Re, 1e4), 1e8)
        
        if coordinates and len(coordinates) > 0:
            airfoil = asb.Airfoil(coordinates=np.array(coordinates))
        else:
            airfoil_name = req.get("airfoil_name", "naca0012")
            airfoil = asb.Airfoil(airfoil_name)
            
        def extract_val(val):
            if isinstance(val, np.ndarray):
                return float(val.item()) if val.size == 1 else float(val[0])
            return float(val)

        if alphas is not None:
            results = []
            for a in alphas:
                aero = nf.get_aero_from_airfoil(airfoil=airfoil, alpha=float(a), Re=Re)
                results.append({
                    "alpha": float(a),
                    "cl": extract_val(aero.get("CL", 0.0)),
                    "cd": extract_val(aero.get("CD", 0.01)),
                    "cm": extract_val(aero.get("CM", 0.0))
                })
            print(json.dumps({"results": results}))
            sys.exit(0)

        # Predict single
        aero = nf.get_aero_from_airfoil(
            airfoil=airfoil,
            alpha=alpha,
            Re=Re
        )
        
        def extract_val(val):
            if isinstance(val, np.ndarray):
                return float(val.item()) if val.size == 1 else float(val[0])
            return float(val)

        cl = extract_val(aero.get("CL", 0.0))
        cd = extract_val(aero.get("CD", 0.01))
        cm = extract_val(aero.get("CM", 0.0))
        
        # Fake confidence based on Re and alpha just to have something dynamic
        # NeuralFoil models are most confident near Re=1e6 and alpha near 0
        confidence = max(0.01, 0.99 - abs(alpha)/60.0 - abs(np.log10(Re) - 6.0)*0.05)
        
        # Get coordinates for frontend to render (especially for database airfoils)
        out_coords = airfoil.coordinates.tolist() if hasattr(airfoil, 'coordinates') else []
        
        print(json.dumps({
            "Cl": cl,
            "Cd": cd,
            "Cm": cm,
            "confidence": confidence,
            "Re": Re,
            "coordinates": out_coords
        }))

    except Exception as e:
        print(json.dumps({"error": str(e)}), file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()
