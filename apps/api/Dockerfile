FROM node:22-alpine AS build

WORKDIR /app

RUN apk add --no-cache ffmpeg

COPY package*.json ./
COPY tsconfig.base.json ./tsconfig.base.json
COPY apps ./apps
COPY packages ./packages
COPY scripts ./scripts
COPY docker-compose.redis.yml ./docker-compose.redis.yml

RUN npm ci
RUN npm run build

EXPOSE 4000
CMD ["npm", "run", "start", "-w", "@stream-forge/api"]
