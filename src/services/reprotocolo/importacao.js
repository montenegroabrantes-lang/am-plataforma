// Importação controlada dos dados apurados fora do AM (pasta antiga do Drive, inventário de
// documentos, duplicidade e conferência oficial) para as tabelas da verificação. Existe porque o
// AM ainda não indexa o Drive sozinho: sem isto, todo ciclo apareceria como "pasta não verificada".
// Tudo é validado linha a linha; linha inválida é recusada com o motivo, nunca "corrigida". Pasta
// vinculada por um usuário (origem manual) nunca é sobrescrita pela importação.
import { db } from '../../db/index.js';
import { uuidValido } from '../../utils/validacao.js';

export const LIMITE_IMPORTACAO = 1000;
const STATUS_PASTA = ['unica', 'ambigua', 'nao_encontrada'];
const TIPOS_DOC = ['identidade', 'inicial', 'procuracao', 'vinculo', 'contracheque', 'residencia', 'protocolo'];
const ID_DRIVE_RE = /^[A-Za-z0-9_-]{10,120}$/;
const DATA_RE = /^\d{4}-\d{2}-\d{2}$/;
const texto = (v, max) => (v === null || v === undefined ? null : String(v).slice(0, max));

export function validarPasta(l) {
  if (!l || typeof l !== 'object') return { erro: 'linha inválida' };
  if (!uuidValido(l.cliente_id)) return { erro: 'cliente_id inválido' };
  if (!STATUS_PASTA.includes(l.status)) return { erro: `status deve ser: ${STATUS_PASTA.join(', ')}` };
  if (l.status === 'unica' && !ID_DRIVE_RE.test(String(l.drive_pasta_id ?? ''))) return { erro: 'pasta única exige drive_pasta_id válido' };
  if (l.drive_pasta_id && !ID_DRIVE_RE.test(String(l.drive_pasta_id))) return { erro: 'drive_pasta_id inválido' };
  const duplicidade = (Array.isArray(l.duplicidade) ? l.duplicidade : []).slice(0, 20).map(d => ({
    pasta: texto(d?.pasta, 200), pai: texto(d?.pai, 120), criada: DATA_RE.test(String(d?.criada ?? '')) ? d.criada : null,
    exato: Boolean(d?.exato), teses: (Array.isArray(d?.teses) ? d.teses : []).slice(0, 7).map(t => texto(t, 20)), onda_fgts: Boolean(d?.onda_fgts),
  }));
  let documentos = null;
  if (l.documentos && typeof l.documentos === 'object') {
    documentos = {};
    for (const tipo of TIPOS_DOC) {
      const d = l.documentos[tipo];
      if (d && Number.isInteger(d.qtd) && d.qtd > 0) documentos[tipo] = { qtd: d.qtd, ultima: DATA_RE.test(String(d.ultima ?? '')) ? d.ultima : null };
    }
  }
  return { ok: { cliente_id: l.cliente_id, status: l.status, drive_pasta_id: l.drive_pasta_id ?? null, titulo: texto(l.titulo, 300), pai: texto(l.pai, 120), duplicidade, documentos } };
}

export function validarOficial(l) {
  if (!l || typeof l !== 'object') return { erro: 'linha inválida' };
  if (!uuidValido(l.tarefa_id)) return { erro: 'tarefa_id inválido' };
  const r = l.resultado;
  if (!r || typeof r !== 'object' || typeof r.status !== 'string' || r.status === 'erro') return { erro: 'resultado inválido' };
  const vinculos = (Array.isArray(r.vinculos) ? r.vinculos : []).slice(0, 10).map(v => ({
    cargo: texto(v?.cargo, 120), orgao: texto(v?.orgao, 160), regime: texto(v?.regime, 40), admissao: texto(v?.admissao, 20),
    ultima_paga: texto(v?.ultima_paga, 7), sem_pgto_meses: Number.isInteger(v?.sem_pgto_meses) ? v.sem_pgto_meses : null,
    competencias: Number.isInteger(v?.competencias) ? v.competencias : null,
  }));
  const risco = Number.isFinite(Number(r.risco)) && r.risco !== null ? Math.round(Number(r.risco) * 100) / 100 : null;
  return { ok: { tarefa_id: l.tarefa_id, resultado: { status: r.status.slice(0, 40), uf: texto(r.uf, 2), correspondencia: texto(r.correspondencia, 20), risco, periodo_consultado: r.periodo_consultado ?? null, vinculos } } };
}

export async function importarDados({ conexao = db, pastas = [], oficiais = [], usuarioId, dryRun = true }) {
  const saida = { dry_run: dryRun, pastas: { recebidas: pastas.length, validas: 0, gravadas: 0, mantidas_manuais: 0, recusadas: [] }, oficiais: { recebidas: oficiais.length, validas: 0, gravadas: 0, recusadas: [] } };
  for (const [i, l] of pastas.entries()) {
    const v = validarPasta(l);
    if (v.erro) { saida.pastas.recusadas.push({ linha: i, erro: v.erro }); continue; }
    saida.pastas.validas += 1;
    if (dryRun) continue;
    const r = await conexao.execute(
      `INSERT INTO reprotocolo_pasta_antiga (cliente_id, status, drive_pasta_id, titulo, pai, duplicidade, documentos, origem, atualizado_em)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,'importacao',NOW())
       ON CONFLICT (cliente_id) DO UPDATE SET status=EXCLUDED.status, drive_pasta_id=EXCLUDED.drive_pasta_id, titulo=EXCLUDED.titulo, pai=EXCLUDED.pai,
         duplicidade=EXCLUDED.duplicidade, documentos=EXCLUDED.documentos, origem='importacao', atualizado_em=NOW()
       WHERE reprotocolo_pasta_antiga.origem <> 'manual'`,
      [v.ok.cliente_id, v.ok.status, v.ok.drive_pasta_id, v.ok.titulo, v.ok.pai, JSON.stringify(v.ok.duplicidade), v.ok.documentos ? JSON.stringify(v.ok.documentos) : null]);
    if ((r?.rowCount ?? 0) > 0) saida.pastas.gravadas += 1; else saida.pastas.mantidas_manuais += 1;
  }
  for (const [i, l] of oficiais.entries()) {
    const v = validarOficial(l);
    if (v.erro) { saida.oficiais.recusadas.push({ linha: i, erro: v.erro }); continue; }
    saida.oficiais.validas += 1;
    if (dryRun) continue;
    const r = await conexao.execute(
      `INSERT INTO reprotocolo_conferencia_oficial (tarefa_id, resultado, conferido_em)
       SELECT $1, $2::jsonb, NOW() WHERE EXISTS (SELECT 1 FROM tarefas WHERE id = $1)
       ON CONFLICT (tarefa_id) DO UPDATE SET resultado = EXCLUDED.resultado, conferido_em = NOW()`, [v.ok.tarefa_id, JSON.stringify(v.ok.resultado)]);
    if ((r?.rowCount ?? 0) > 0) saida.oficiais.gravadas += 1; else saida.oficiais.recusadas.push({ linha: i, erro: 'tarefa não existe' });
  }
  return saida;
}
