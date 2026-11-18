# ---- Stage 1: build the React client ----
FROM node:20-slim AS client-build
WORKDIR /build
COPY package.json package-lock.json* ./
RUN npm install
COPY index.html vite.config.ts tsconfig.json ./
COPY src ./src
RUN npm run build

# ---- Stage 2: runtime (Python for NeuralFoil + Node for the API) ----
FROM python:3.10-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl ca-certificates build-essential \
 && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
 && apt-get install -y --no-install-recommends nodejs \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY package.json package-lock.json* ./
RUN npm install --omit=dev && npm cache clean --force

COPY tsconfig.json server.ts ./
COPY server ./server
COPY api ./api
COPY --from=client-build /build/dist ./dist

# Non-root user; a home directory is needed for matplotlib's cache (imported by aerosandbox).
RUN useradd --create-home app
USER app

ENV NODE_ENV=production
EXPOSE 10000
CMD ["node_modules/.bin/tsx", "server.ts"]
