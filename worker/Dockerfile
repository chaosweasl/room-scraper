# Use the absolute latest Playwright image (v1.60.0 Ubuntu Noble)
FROM mcr.microsoft.com/playwright:v1.60.0-noble

WORKDIR /app

# Install dependencies first for Docker caching
COPY package*.json ./
RUN npm install

# Copy the rest of the TS code
COPY . .

# Run the typescript file directly
CMD ["npx", "ts-node", "index.ts"]