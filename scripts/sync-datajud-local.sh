#!/bin/zsh
# Sync do DataJud a partir do Mac do escritório (11/11/2026).
# O DataJud recusa (429/timeout) as consultas que saem do Railway desde 03-04/11; do Brasil responde.
# Este script roda o MESMO sincronizarTodos() do servidor, com o banco e o Redis de produção pelas
# URLs públicas, só para os tribunais fora do TJPB (o TJPB chega pelo push do PJe).
# Uso manual:  zsh scripts/sync-datajud-local.sh
# Agendado pelo launchd (~/Library/LaunchAgents/br.am.sync-datajud.plist) às 07h30 e 19h30.
set -euo pipefail
cd /Users/ramonabrantes/am-plataforma
export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"

LOG_DIR="$HOME/Library/Logs/am-sync-datajud"
mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/$(date +%Y-%m-%d_%H%M).log"

DB_URL=$(railway variables --service Postgres --kv 2>/dev/null | sed -n 's/^DATABASE_PUBLIC_URL=//p')
REDIS_PUB=$(railway variables --service Redis --kv 2>/dev/null | sed -n 's/^REDIS_PUBLIC_URL=//p')
if [[ -z "$DB_URL" || -z "$REDIS_PUB" ]]; then
  echo "$(date) sem acesso às variáveis do Railway (railway login?)" >> "$LOG"
  exit 1
fi

railway run --service am-plataforma sh -c "
  DATABASE_URL='$DB_URL' REDIS_URL='$REDIS_PUB' DATAJUD_TRIBUNAIS_IGNORADOS='TJPB' \
  node --input-type=module -e \"
    const { sincronizarTodos } = await import('./src/services/tribunal/sync.js');
    const r = await sincronizarTodos();
    const lista = Array.isArray(r) ? r : [];
    console.log('[Sync local] ok=' + lista.filter(x => x.ok).length + ' falhas=' + lista.filter(x => !x.ok).length + (r && r.ignorado ? ' (ignorado: ' + r.motivo + ')' : ''));
    process.exit(0);
  \"
" >> "$LOG" 2>&1
grep "\[Sync local\]" "$LOG" | tail -1
