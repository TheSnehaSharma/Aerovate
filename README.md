# Aerovate — Neural Airfoil Design

Interactive airfoil design tool: sculpt a NACA 4-digit airfoil, and get lift, drag and moment coefficients
predicted by [NeuralFoil](https://github.com/peterdsharpe/NeuralFoil) in real time, along with 3D visualization,
polar plots and force estimates.

**Live demo:** https://aerovate.onrender.com (free tier — the first request after idle can take ~30–60 s)

![Aerovate Dashboard](Aerovate.png)

## Features
- **Geometry editor:** sliders, numeric inputs, or drag handles on a 2D profile to change camber, camber position and thickness; presets for common sections (approximated as NACA 4-digit shapes).
- **Neural predictions:** Cl, Cd, Cm, L/D and NeuralFoil's own confidence score for the chosen angle of attack and Reynolds number.
- **Polars:** Cl–α and Cl–Cd sweeps with stall (max Cl) and best L/D markers.
- **Forces:** lift, drag and dynamic pressure for the chosen chord, span and velocity (sea-level ISA air).
- **3D view:** extruded wing coloured by an illustrative pressure map, plus decorative potential-flow streamlines (not CFD).
- **Graceful degradation:** if NeuralFoil is unavailable, the API falls back to thin-airfoil theory and the UI says so.

## Architecture
```
Browser (React + Three.js)  ──HTTP/JSON──▶  Express (server.ts)  ──stdin/stdout JSON lines──▶  Python worker (NeuralFoil)
```
| Path | Responsibility |
|---|---|
| `server.ts` | HTTP routes, request validation, error mapping, static hosting, graceful shutdown |
| `server/neuralfoil.ts` | Manages one long-lived Python process: request IDs, timeouts, restart on crash, back-pressure |
| `server/physics.ts` | Reynolds clamping, L/D, thin-airfoil fallback |
| `api/neuralfoil_service.py` | Loads NeuralFoil once; answers `single` and `batch` requests |
| `src/lib/physics.ts` | NACA geometry, Reynolds/Mach, forces, polar analysis |
| `src/lib/presets.ts` | Geometry and flight presets, defaults |
| `src/lib/api.ts` | Typed API client |
| `src/components/` | `Scene3D`, `ProfileEditor`, `Sidebar`, `BottomPanel`, `ErrorBoundary` |
| `src/App.tsx` | State, debounced/cancellable data fetching, layout |

## API
| Method & path | Body | Response |
|---|---|---|
| `GET /api/health` | — | `{ "status": "ok" }` |
| `POST /api/v1/simulate` | `{ coordinates: [[x,y],…], alpha: deg, Re }` | `{ source, cl, cd, cm, ldRatio, confidence, re }` |
| `POST /api/v1/simulate-batch` | `{ coordinates, alphas: [deg,…], Re }` | `{ results: [{ alpha, cl, cd, cm }] }` |

`source` is `"neuralfoil"` or `"thin_airfoil_fallback"` (then `confidence` is `null`). `Re` is clamped to 1e4–1e8 and the value used is returned as `re`. Errors: `400` invalid input, `503` worker overloaded, `500` otherwise; all as `{ "message": "…" }`.

## Run locally
Requires Node 20+ and Python 3.10+.
```bash
pip install -r requirements.txt
npm install
npm run dev        # http://localhost:10000 (Vite dev middleware)
npm test           # unit tests (node:test)
npm run lint       # type-check
npm run build && npm start   # production mode
```

## Deploy on Render
Push this repo to GitHub, then create a **Blueprint** from it (uses `render.yaml`) or a Docker Web Service. The `Dockerfile` builds the client in one stage and ships Node + Python in the runtime image. Health check: `/api/health`.

## Limitations
- NACA 4-digit shapes only; named presets are approximations.
- 2D airfoil data; no 3D/finite-wing corrections. Incompressible, sea-level air assumed for forces.
- Pressure colours and streamlines are illustrative, not simulation output.
- Single Python worker: predictions are serialized (requests beyond a queue limit receive `503`).

## License
MIT — see [LICENSE](LICENSE).
