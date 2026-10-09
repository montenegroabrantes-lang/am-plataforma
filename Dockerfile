# Node 22 (LTS ativa). A versão do Debian fica fixa em bookworm para o repositório do cliente
# PostgreSQL (PGDG) continuar o mesmo de sempre; sem isso "node:22-slim" pode andar de Debian.
FROM node:22-bookworm-slim

# Cliente PostgreSQL do repositório oficial apt.postgresql.org (PGDG), via script oficial do
# pacote postgresql-common: o postgresql-client do Debian bookworm trava na major 15, mas o
# Postgres de produção (Railway) está na major 18 — pg_dump 15 contra um servidor 18
# falha (mismatch de versão) e, sem essa correção, o worker de backup silenciosamente
# gravava um gzip vazio em vez de abortar (ver backup.worker.js). O script só registra o
# repositório; o "postgresql-client" do apt-get install seguinte passa a resolver para
# a versão mais nova do PGDG em vez da 15 do bookworm (sem precisar fixar número aqui,
# então builds futuros acompanham upgrades de major version do Postgres em produção).
#
# ATENÇÃO: o Chromium/Puppeteer que dividia este passo foi removido (nenhum código em src/ usa
# navegador, desde o Lote S/S-16), mas o postgresql-client NÃO pode sair daqui: é o pg_dump do
# backup diário (23h).
#
# LibreOffice Writer (sem interface) + fontes Liberation (métricas idênticas a Arial/Times):
# converte em PDF as peças montadas em Word no padrão do escritório (services/drive/pecas.js,
# ferramenta salvar_peca_drive) — o PJe só aceita PDF e o layout precisa sair igual em todas.
RUN apt-get update && apt-get install -y --no-install-recommends postgresql-common ca-certificates \
 && /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y \
 && apt-get update \
 && apt-get install -y --no-install-recommends postgresql-client \
      libreoffice-writer-nogui fonts-liberation fontconfig \
 && rm -rf /var/lib/apt/lists/*

# /app é do usuário "node": o processo não roda como root (o backup grava em /tmp/am-backups,
# que qualquer usuário consegue criar; nada mais escreve em disco).
WORKDIR /app
RUN chown node:node /app

# Instalação pelo lockfile (npm ci): mesmas versões que foram testadas, sem "latest do dia".
# npm ci recusa o build se package.json e package-lock.json divergirem; o build falho não
# vira deploy e o anterior continua no ar. Regerar o lock: npm install --package-lock-only.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --chown=node:node . .

USER node

EXPOSE 3001

CMD ["node", "src/index.js"]
