FROM python:3.10-slim

# Install system dependencies
RUN apt-get update && apt-get install -y curl build-essential

# Install Node.js
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
RUN apt-get install -y nodejs

# Set working directory
WORKDIR /app

# Install Python dependencies first
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Install Node dependencies (ignores package-lock missing state if not present)
COPY package.json package-lock.json* ./
RUN npm install

# Copy project files
COPY . .

# Build the client app
RUN npm run build

# Start the server (Node.js will spawn Python processes as needed)
ENV PORT=3000
ENV NODE_ENV=production
EXPOSE 3000

# server.ts runs natively using Node via tsx (installed in devDependencies)
CMD ["npx", "tsx", "server.ts"]
