FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production TZ=Asia/Jakarta
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY src ./src
COPY tools ./tools
EXPOSE 3000
HEALTHCHECK --interval=60s --timeout=5s CMD wget -qO- http://127.0.0.1:3000/sehat || exit 1
CMD ["node", "src/server.js"]
