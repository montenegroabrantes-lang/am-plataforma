FROM node:20-slim

# Repositório oficial apt.postgresql.org (PGDG), via script oficial do pacote
# postgresql-common: o postgresql-client do Debian bookworm trava na major 15, mas o
# Postgres de produção (Railway) está na major 18 — pg_dump 15 contra um servidor 18
# falha (mismatch de versão) e, sem essa correção, o worker de backup silenciosamente
# gravava um gzip vazio em vez de abortar (ver backup.worker.js). Este passo só registra
# o repositório; o "postgresql-client" do apt-get install seguinte passa a resolver para
# a versão mais nova do PGDG em vez da 15 do bookworm (sem precisar fixar número aqui,
# então builds futuros acompanham upgrades de major version do Postgres em produção).
RUN apt-get update && apt-get install -y --no-install-recommends postgresql-common ca-certificates \
 && /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y \
 && rm -rf /var/lib/apt/lists/*

# Chromium para Puppeteer
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-liberation \
    libappindicator3-1 \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libgdk-pixbuf2.0-0 \
    libnspr4 \
    libnss3 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    xdg-utils \
    postgresql-client \
    --no-install-recommends \
 && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV CHROMIUM_PATH=/usr/bin/chromium

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY . .

EXPOSE 3001

CMD ["node", "src/index.js"]
