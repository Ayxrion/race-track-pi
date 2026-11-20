FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html ./
COPY src ./src
COPY shared ./shared
RUN npm run build

FROM node:24-alpine
ENV NODE_ENV=production PORT=8787
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY relay ./relay
COPY shared ./shared
USER node
EXPOSE 8787
CMD ["node", "relay/server.mjs"]
