# Start from a lightweight Python base image
FROM python:3.10-slim

# Install system dependencies including curl to fetch Node.js
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Install Node.js (version 20.x)
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Set up the working directory inside the container
WORKDIR /app

# Copy and install Python dependencies first (takes advantage of Docker caching)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy package data and install Node.js dependencies
COPY package.json package-lock.json* ./
RUN npm ci || npm install

# Copy the rest of the application files containing your source code
COPY . .

# Build the React frontend using Vite
RUN npm run build

# Configure environment variables
ENV NODE_ENV=production
ENV PORT=3000

# Expose the server port
EXPOSE 3000

# Start your application server using tsx
CMD ["npx", "tsx", "server.ts"]
