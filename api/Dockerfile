# Start from a lightweight Node.js image
FROM node:18-alpine

# Create a folder inside the container
WORKDIR /app

# Copy package files first (better for caching)
COPY package*.json ./

# Install dependencies inside the container
RUN npm install

# Copy the rest of your API code
COPY . .

# Expose the port the app runs on
EXPOSE 3000

# The command to start the app
CMD ["node", "src/index.js"]