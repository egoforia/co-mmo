# One container runs the game server and serves the built client.
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
COPY packages/client/package.json packages/client/
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production PORT=8080 DATA_FILE=/data/world.json
COPY --from=build /app /app
# Accounts, invites and positions live here; mount a persistent volume.
VOLUME /data
EXPOSE 8080
CMD ["npm", "start"]
