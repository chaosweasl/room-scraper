# Playwright image (v1.60.0 Ubuntu Noble) with browsers pre-installed
FROM mcr.microsoft.com/playwright:v1.60.0-noble

WORKDIR /app

# Install dependencies first for Docker caching
COPY package*.json ./
RUN npm ci

# Copy the rest of the TS code (including shared/ and all scraper files)
COPY . .

# Compile once and run plain JS at runtime
RUN npx tsc

CMD ["node", "dist/orchestrator.js"]
