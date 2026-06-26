# Use the absolute latest Playwright image (v1.60.0 Ubuntu Noble)
FROM mcr.microsoft.com/playwright:v1.60.0-noble

WORKDIR /app

# Install dependencies first for Docker caching
COPY package*.json ./
RUN npm install

# Copy the rest of the TS code (including shared/ and all scraper files)
COPY . .

# Default command — overridden by docker-compose per service
CMD ["npx", "ts-node", "orchestrator.ts"]