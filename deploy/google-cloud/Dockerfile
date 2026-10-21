FROM node:24-bookworm-slim
WORKDIR /app
ENV PUPPETEER_SKIP_DOWNLOAD=true
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund && npm cache clean --force
COPY src ./src
USER node
CMD ["node", "--import", "tsx", "src/cloud-cli.ts"]
