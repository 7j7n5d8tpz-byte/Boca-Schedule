FROM node:22-alpine

WORKDIR /app

# Copy workspace root manifests so npm ci resolves all workspaces
COPY package.json package-lock.json ./
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/

# Install all workspace dependencies
RUN npm ci

# Copy backend source and build
COPY backend/tsconfig.json ./backend/
COPY backend/src ./backend/src
RUN npm run build --workspace=backend

EXPOSE 3001

CMD ["node", "backend/dist/server.js"]
