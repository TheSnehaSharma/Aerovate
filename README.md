# Aerovate: Aerodynamic Surrogate Model

![Aerovate Dashboard](https://github.com/user-attachments/assets/9d90e65f-ce1b-432d-8044-9b26486125c1)

[![Live Application](https://img.shields.io/badge/Live_Application-Online-06b6d4?style=for-the-badge&logo=vercel)](https://aerovate.vercel.app/)
[![Model Training](https://img.shields.io/badge/Model_Training-Colab-F9AB00?style=for-the-badge&logo=googlecolab)](https://colab.research.google.com/drive/1C1OH7P1czpiotfcBVyb87AmENtQlW0uu?usp=sharing)

Aerovate is a machine learning surrogate model developed to predict aerodynamic forces (lift and drag) and aeroacoustic noise. It provides low-latency inference for Multidisciplinary Design Optimization (MDAO) workflows, bypassing the computational overhead of Computational Fluid Dynamics (CFD).

---

## 1. Background and Problem Statement
Aircraft conceptual design and optimization require evaluating thousands of airfoil geometries across various flight profiles. 
* **Computational Fluid Dynamics (CFD):** Provides high fidelity but requires significant computational time (hours per iteration).
* **Panel Methods (e.g., XFOIL):** Execute rapidly but rely on inviscid assumptions, resulting in low accuracy during non-linear flow regimes such as boundary layer separation and stall ($C_{l,max}$).

This project introduces a data-driven approach that balances the accuracy of CFD with the execution speed required for real-time iterative design.

## 2. Methodology
Aerovate utilizes an Extreme Gradient Boosting (XGBoost) model trained on a high-fidelity aerodynamic dataset. This approach maps the non-linear relationships between airfoil geometry, flow conditions, and the resulting aerodynamic coefficients without solving the Navier-Stokes equations at runtime.

### Performance Metrics
The surrogate model was evaluated against the baseline dataset, yielding the following accuracy scores:

**Aerodynamic Coefficients:**
* **Lift Coefficient ($C_l$) $R^2$:** 0.9841
* **Drag Coefficient ($C_d$) $R^2$:** 0.9136

**Aeroacoustic Noise:**
* **Noise Prediction $R^2$:** 0.9643
* **Mean Absolute Error (MAE):** 0.86 dB

---

## 3. System Architecture
The application architecture separates the mathematical inference engine from the user interface to optimize performance.

* **Inference Engine:** Pre-trained XGBoost models are exported to `.onnx` format and executed via `ONNX Runtime` to minimize latency.
* **Backend API:** A `FastAPI` framework handles HTTP requests and executes deterministic physics equations on the model outputs.
* **Client Interface:** A `React` and `TypeScript` dashboard provides real-time parameter adjustment and data visualization.

### Input Parameters
The model requires a defined feature space to generate predictions:
1. **Geometry:** 62 Class Shape Transformation (CST) parameters defining the 2D airfoil cross-section.
2. **Flow Conditions:** Reynolds Number ($Re$) to account for viscous scaling effects.
3. **Operational State:** Angle of Attack ($\alpha$), freestream velocity, and chord length.

---

## 4. Physical Constraints and Assumptions
To maintain validity within the domain of Computational Mechanics, the system applies deterministic physical corrections to the machine learning outputs.

* **Non-Linear Flow Identification:** The XGBoost ensemble is tuned to identify adverse pressure gradients and predict stall onset, addressing the primary limitation of linear lifting theories.
* **Finite Wing Correction:** The machine learning model outputs 2D section coefficients ($c_l, c_d$). The backend applies **Prandtl’s Lifting-Line Theory** to calculate the corresponding 3D finite wing performance, deriving induced drag ($C_{D,i}$) based on aspect ratio and sweep.

### Operating Limitations
The model's predictions are constrained by the following assumptions:
1. **Steady-State Flow:** Transient aerodynamic effects, such as dynamic stall or vortex shedding, are not modeled.
2. **Incompressible Flow:** Valid only for subsonic Mach numbers ($Ma < 0.3$). Compressibility effects and wave drag are excluded.
3. **Rigid Structure:** Assumes infinite structural stiffness. Aeroelastic deformation (twist and bending) under dynamic loading is neglected.
4. **Data Interpolation:** The model's accuracy degrades when processing geometric inputs that fall outside the bounding box of the original training data.

---

*Developed for a B.Tech Minor Project in Engineering and Computational Mechanics.*
