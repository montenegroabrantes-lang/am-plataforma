// Fechamento automático do relatório mensal do acervo (etapa 3, 24/11/2026). Spec "AM - Spec Relatorio
// Mensal do Acervo.md": no 1º dia útil do mês, às 08h (Brasília), fecha o mês anterior (grava o retrato,
// se ainda não houver) e avisa por WhatsApp cada Master ativo que não desligou os avisos do acervo.
//
// O agendamento roda às 08h dos dias 1 a 7 (o cron não sabe o que é dia útil); a checagem do 1º dia útil,
// com feriados nacionais, fica aqui. Repetir no mesmo dia não duplica nada: o retrato já existe e o aviso
// tem chave única por mês e Master. Banco, fechamento, envio e relógio são injetáveis para teste.

import { db } from '../db/index.js';
import { ehDiaUtil, hojeEscritorio } from '../utils/feriadosNacionais.js';
import { enfileirarAviso, despacharAvisos, montarAvisoRelatorio } from './avisosAcervo.js';
import { enviarAlerta } from './digisac/index.js';

export function ehPrimeiroDiaUtilDoMes(iso) {
  if (!ehDiaUtil(iso)) return false;
  const [a, m, d] = iso.split('-').map(Number);
  for (let dia = 1; dia < d; dia++) if (ehDiaUtil(`${a}-${String(m).padStart(2, '0')}-${String(dia).padStart(2, '0')}`)) return false;
  return true;
}
const mesAnterior = mes => { const [a, m] = mes.split('-').map(Number); return m === 1 ? `${a - 1}-12` : `${a}-${String(m - 1).padStart(2, '0')}`; };

// `fechar(mes)` grava o retrato e devolve os dados (em produção, fecharRelatorio da rota do acervo).
export async function fecharMesSeForPrimeiroDiaUtil({ fechar, banco = db, enviar = enviarAlerta, agora = new Date() }) {
  const hoje = hojeEscritorio(agora);
  if (!ehPrimeiroDiaUtilDoMes(hoje)) return { ignorado: `${hoje} não é o 1º dia útil do mês` };
  const mes = mesAnterior(hoje.slice(0, 7));
  const existente = await banco.queryOne('SELECT dados FROM acervo_relatorios_mensais WHERE mes=$1', [mes]);
  const dados = existente ? existente.dados : await fechar(mes);
  const masters = await banco.query(`SELECT id FROM usuarios WHERE perfil='master' AND ativo=true`);
  const texto = montarAvisoRelatorio({ mes, resumo: dados.resumo, anterior: dados.anterior, atencao: dados.atencao });
  let enfileirados = 0;
  for (const m of masters) {
    const a = await enfileirarAviso(banco, { tipo: 'acervo_relatorio', chaveEvento: `relatorio:${mes}:${m.id}`, usuarioId: m.id, texto, enviarApos: agora });
    if (a) enfileirados++;
  }
  const despacho = await despacharAvisos({ banco, enviar, agora, tipos: ['acervo_relatorio'] });
  console.log(`[RelatorioAcervo] ${mes}: ${existente ? 'retrato já existia' : 'fechado agora'}; ${enfileirados} aviso(s) na fila; ${despacho.enviados ?? 0} enviado(s).`);
  return { mes, fechadoAgora: !existente, enfileirados, enviados: despacho.enviados ?? 0 };
}
