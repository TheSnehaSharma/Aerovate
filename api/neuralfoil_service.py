"""NeuralFoil worker.

Long-lived process: loads NeuralFoil once, then answers newline-delimited JSON
requests on stdin with newline-delimited JSON replies on stdout.

Request : {"id": int, "op": "single" | "batch", "coordinates": [[x, y], ...], "Re": float,
           "alpha": float            # op == "single"
           "alphas": [float, ...]}   # op == "batch"
Reply   : {"id": int, "result": ...} or {"id": int, "error": str}
"""
import json
import sys

# Keep stdout reserved for the protocol; anything a library prints goes to stderr.
_protocol_out = sys.stdout
sys.stdout = sys.stderr

import aerosandbox as asb  # noqa: E402
import neuralfoil as nf  # noqa: E402
import numpy as np  # noqa: E402


def _scalar(value) -> float:
    return float(np.asarray(value).reshape(-1)[0])


def _predict_single(airfoil, alpha: float, re: float) -> dict:
    aero = nf.get_aero_from_airfoil(airfoil=airfoil, alpha=alpha, Re=re)
    return {
        "cl": _scalar(aero["CL"]),
        "cd": _scalar(aero["CD"]),
        "cm": _scalar(aero["CM"]),
        # NeuralFoil's own estimate (0-1) of how trustworthy this prediction is.
        "confidence": _scalar(aero["analysis_confidence"]),
    }


def _predict_batch(airfoil, alphas, re: float) -> list:
    alpha_arr = np.asarray(alphas, dtype=float)
    aero = nf.get_aero_from_airfoil(airfoil=airfoil, alpha=alpha_arr, Re=re)
    cl, cd, cm = (np.atleast_1d(aero[key]) for key in ("CL", "CD", "CM"))
    return [
        {"alpha": float(a), "cl": float(l), "cd": float(d), "cm": float(m)}
        for a, l, d, m in zip(alpha_arr, cl, cd, cm)
    ]


def _handle(request: dict):
    airfoil = asb.Airfoil(coordinates=np.array(request["coordinates"], dtype=float))
    re = float(request["Re"])
    op = request["op"]
    if op == "single":
        return _predict_single(airfoil, float(request["alpha"]), re)
    if op == "batch":
        return _predict_batch(airfoil, request["alphas"], re)
    raise ValueError(f"unknown op: {op!r}")


def _reply(payload: dict) -> None:
    # allow_nan=False: NaN/Infinity are not valid JSON and would break the Node parser.
    _protocol_out.write(json.dumps(payload, allow_nan=False) + "\n")
    _protocol_out.flush()


def main() -> None:
    for line in sys.stdin:
        if not line.strip():
            continue
        request_id = None
        try:
            request = json.loads(line)
            request_id = request.get("id")
            _reply({"id": request_id, "result": _handle(request)})
        except Exception as exc:  # report to caller; keep the worker alive
            _reply({"id": request_id, "error": str(exc)})


if __name__ == "__main__":
    main()
