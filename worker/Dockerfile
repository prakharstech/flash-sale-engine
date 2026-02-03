# Start from a lightweight Node.js image
FROM node:18-alpine

# Create a folder inside the container
WORKDIR /app

# Copy package files first
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy the rest of the worker code
COPY . .

# The command to start the worker
CMD ["node", "src/index.js"]