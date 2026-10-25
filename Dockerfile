FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3000
COPY package*.json ./
RUN npm ci --omit=dev
COPY server.js ./
COPY public ./public
EXPOSE 3000
USER node
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:3000/healthz || exit 1
CMD ["node", "server.js"]
