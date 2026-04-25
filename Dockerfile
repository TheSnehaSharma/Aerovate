# 1. Use Python 3.10 slim as the foundation
FROM python:3.10-slim

# 2. Install system dependencies (including math libs for SciPy/AeroSandbox)
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    build-essential \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/*

# 3. Install Node.js 20
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 4. Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 5. Install Node dependencies 
COPY package.json package-lock.json* ./
RUN npm install --legacy-peer-deps

# 6. Copy the entire project
COPY . .

# 7. Build the Vite/React frontend
RUN npm run build

# 8. Set Production Environment
ENV NODE_ENV=production
# Render uses 10000 by default. This makes it dynamic.
ENV PORT=10000

# 9. Expose the port
EXPOSE 10000

# 10. Start the server
# We use '0.0.0.0' to ensure it's accessible externally
CMD ["npx", "tsx", "server.ts", "--port", "10000"]
