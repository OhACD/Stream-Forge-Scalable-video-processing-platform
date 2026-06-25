FROM node:22-alpine AS build

WORKDIR /app

COPY package*.json ./
COPY tsconfig.base.json ./tsconfig.base.json
COPY apps ./apps
COPY packages ./packages

RUN npm ci
RUN npm run build -w @stream-forge/web

FROM nginx:1.27-alpine

COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
