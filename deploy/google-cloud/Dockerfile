FROM node:24-bookworm-slim
WORKDIR /app
ENV PUPPETEER_SKIP_DOWNLOAD=true
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund \
    && npm uninstall --ignore-scripts --no-audit --no-fund whatsapp-web.js qrcode-terminal \
    && npm cache clean --force
COPY src ./src
COPY frontend ./frontend
RUN npm run build:web
USER node
CMD ["node", "--import", "tsx", "src/cloud-cli.ts"]
