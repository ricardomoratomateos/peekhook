FROM node:20-alpine AS dev

WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
RUN pnpm install --frozen-lockfile

COPY apps/web ./apps/web

WORKDIR /app/apps/web

ENV CHOKIDAR_USEPOLLING=true

EXPOSE 5173

CMD ["npm", "run", "dev"]

FROM node:20-alpine AS build

ARG VITE_API_URL=""
ARG VITE_WEB_URL=""

WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
RUN pnpm install --frozen-lockfile

COPY apps/web ./apps/web

WORKDIR /app/apps/web
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_WEB_URL=$VITE_WEB_URL
ENV CI=true
RUN pnpm build

FROM nginx:1.27-alpine

COPY --from=build /app/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 5173

CMD ["nginx", "-g", "daemon off;"]
