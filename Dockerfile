FROM node:22-alpine

WORKDIR /app

# Copy package files first for better caching
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy source code
COPY . .

# Expose port (use PORT env var or default to 3051)
EXPOSE 3051

# Start command for production (uses env vars from Railway)
CMD ["npm", "run", "start:api"]
