import express from "express";
import { createServer as createViteServer } from "vite";
import fs from "fs";
import path from "path";
import { spawn } from "child_process";

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // API Route
  
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
            if (code !== 0) reject(new Error(errData));
            else {
               try { resolve(JSON.parse(output)); } catch(e) { reject(e); }
            }
         });
         py.stdin.write(payload);
         py.stdin.end();
      });
      const data = await predictAero();
      res.json(data);
    } catch (err) {
      console.error(err);
      res.status(500).json({ status: "ERROR", message: String(err.message) });
    }
  });
  app.post("/api/v1/simulate", async (req, res) => {
    try {
      const {
        coordinates,
        alpha,
        velocity, // Keep for backward compatibility, maybe change to Re later, or compute Re from it
        chord_length,
        Re_input // If client sends Re explicitly
      } = req.body as any;

      const rho = 1.225; // Sea level density
      const mu = 1.81e-5; // Dynamic viscosity
      
      let Re = Re_input || ((rho * (velocity || 10) * (chord_length || 1.0)) / mu);
      const alphaRad = (alpha || 0) * (Math.PI / 180);
      
      let Cl = 0.0;
      let Cd = 0.01;
      let Cm = 0.0;
      let confidence = 0.0;
      let prediction_source = "Classical Math";

      try {
        const scriptPath = path.join(process.cwd(), 'api', 'neuralfoil_predict.py');
        const payload = JSON.stringify({ coordinates, alpha, Re });
        
        const predictAero = () => new Promise<any>((resolve, reject) => {
           const py = spawn('python3', [scriptPath]);
           let output = '';
           let errData = '';
           py.stdout.on('data', (data: any) => { output += data.toString(); });
           py.stderr.on('data', (data: any) => { errData += data.toString(); });
           py.on('close', (code: any) => {
              if (code !== 0) reject(new Error(errData));
              else {
                 try { resolve(JSON.parse(output)); } catch(e) { reject(e); }
              }
           });
           py.stdin.write(payload);
           py.stdin.end();
        });
        
        const result = await predictAero();
        if (result.Cl !== undefined) Cl = result.Cl;
        if (result.Cd !== undefined) Cd = result.Cd;
        if (result.Cm !== undefined) Cm = result.Cm;
        if (result.confidence !== undefined) confidence = result.confidence;
        prediction_source = "Neuralfoil";
      } catch (e: any) {
        console.warn("Neuralfoil predict error, falling back:", e.message || String(e));
        // Simple fallback
        const Cl_alpha = 2 * Math.PI;
        Cl = alphaRad > -0.1 ? Cl_alpha * alphaRad : 0;
        Cd = 0.02 + Math.pow(Cl, 2) / (Math.PI * 10 * 0.8); // Random fallback Cd
      }

      // Calculate efficiency
      const ld_ratio = Cd > 0.0001 ? Cl / Cd : 0;

      // RETURN PAYLOAD
      res.json({
        prediction_source,
        aero: { Cl, Cd, Cm },
        efficiency: { ld_ratio },
        meta: { confidence, Re },
        status: "OPTIMAL"
      });

    } catch (err: any) {
      console.error(err);
      res.status(500).json({ status: "ERROR", message: String(err.message) });
    }
  });

  // Vite middleware for development
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

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
