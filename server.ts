import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { spawn } from "child_process";
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();

  const PORT = process.env.PORT || 10000;

  app.use(express.json());

  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", engine: "Aerovate Pro v1.0" });
  });

  // --- API Routes ---

  app.post("/api/v1/simulate-batch", async (req, res) => {
    try {
      const { coordinates, alphas, Re } = req.body;
      const scriptPath = path.join(process.cwd(), 'api', 'neuralfoil_predict.py');
      const payload = JSON.stringify({ coordinates, alphas, Re });
      
      const predictAero = () => new Promise((resolve, reject) => {
          const py = spawn('python3', [scriptPath]);
          let output = '';
          let errData = '';
          py.stdout.on('data', (data) => { output += data.toString(); });
          py.stderr.on('data', (data) => { errData += data.toString(); });
          py.on('close', (code) => {
            if (code !== 0) reject(new Error(errData || `Process exited with code ${code}`));
            else {
               try { resolve(JSON.parse(output)); } catch(e) { reject(e); }
            }
          });
          py.stdin.write(payload);
          py.stdin.end();
      });
      const data = await predictAero();
      res.json(data);
    } catch (err: any) {
      console.error("Batch Simulation Error:", err.message);
      res.status(500).json({ status: "ERROR", message: String(err.message) });
    }
  });

  app.post("/api/v1/simulate", async (req, res) => {
    try {
      const { coordinates, alpha, velocity, chord_length, Re_input } = req.body;

      const rho = 1.225; 
      const mu = 1.81e-5; 
      let Re = Re_input || ((rho * (velocity || 10) * (chord_length || 1.0)) / mu);
      const alphaRad = (alpha || 0) * (Math.PI / 180);
      
      let Cl = 0.0, Cd = 0.01, Cm = 0.0, confidence = 0.0;
      let prediction_source = "Classical Math";

      try {
        const scriptPath = path.join(process.cwd(), 'backend', 'neuralfoil_predict.py');
        const payload = JSON.stringify({ coordinates, alpha, Re });
        
        const predictAero = () => new Promise<any>((resolve, reject) => {
           const py = spawn('python3', [scriptPath]);
           let output = '';
           let errData = '';
           py.stdout.on('data', (data) => { output += data.toString(); });
           py.stderr.on('data', (data) => { errData += data.toString(); });
           py.on('close', (code) => {
              if (code !== 0) reject(new Error(errData));
              else {
                 try { resolve(JSON.parse(output)); } catch(e) { reject(e); }
              }
           });
           py.stdin.write(payload);
           py.stdin.end();
        });
        
        const result = await predictAero();
        Cl = result.Cl ?? 0.0;
        Cd = result.Cd ?? 0.01;
        Cm = result.Cm ?? 0.0;
        confidence = result.confidence ?? 0.0;
        prediction_source = "Neuralfoil";
      } catch (e: any) {
        console.warn("Falling back to classical math:", e.message);
        const Cl_alpha = 2 * Math.PI;
        Cl = alphaRad > -0.1 ? Cl_alpha * alphaRad : 0;
        Cd = 0.02 + Math.pow(Cl, 2) / (Math.PI * 10 * 0.8);
      }

      res.json({
        prediction_source,
        aero: { Cl, Cd, Cm },
        efficiency: { ld_ratio: Cd > 0 ? Cl / Cd : 0 },
        meta: { confidence, Re },
        status: "OPTIMAL"
      });

    } catch (err: any) {
      res.status(500).json({ status: "ERROR", message: String(err.message) });
    }
  });

  // --- Static Files & Vite Middleware ---

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(Number(PORT), "0.0.0.0", () => {
    console.log(`
    🚀 AEROVATE MISSION CONTROL ONLINE
    📡  Address: http://0.0.0.0:${PORT}
    🛠️  Environment: ${process.env.NODE_ENV || 'development'}
    `);
  });
}

startServer();
