// Versão 2.0, etapa 2 (25/11/2026): precatório como entidade própria, ligado ao processo de origem (o processo
// de conhecimento que gerou o crédito). Até aqui o precatório era só um par de campos em `processos`
// (tipo_requisicao / status_precatorio), sem número do TJPB 2º grau, exercício nem habilitação dos sócios.
//
// Uso em src/index.js (dentro de iniciar()), numa transação:
//   await migrar('2026_11_25_precatorios', () => db.transaction(tx => aplicarPrecatorios(tx)));
//
// Só acrescenta: duas tabelas novas. Nada em `processos` muda; os campos antigos continuam valendo.
import { ETAPAS, PRIORIDADES, HABILITACOES } from '../../services/precatorios/regras.js';

const lista = valores => valores.map(v => `'${v}'`).join(',');

export async function aplicarPrecatorios(conexao) {
  await conexao.execute(`CREATE TABLE IF NOT EXISTS precatorios (
    id                     UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    numero                 TEXT NOT NULL,
    credor_nome            TEXT NOT NULL,
    devedor                TEXT NOT NULL,
    cliente_id             UUID REFERENCES clientes(id) ON DELETE SET NULL,
    processo_origem_id     UUID REFERENCES processos(id) ON DELETE SET NULL,
    numero_origem          TEXT,
    regime_especial        BOOLEAN NOT NULL DEFAULT false,
    exercicio              INTEGER CHECK (exercicio BETWEEN 2000 AND 2100),
    etapa                  TEXT NOT NULL DEFAULT 'autuado' CHECK (etapa IN (${lista(ETAPAS.map(e => e.chave))})),
    valor_requisitado      NUMERIC(14,2) CHECK (valor_requisitado > 0),
    honorarios_percentual  NUMERIC(5,2) CHECK (honorarios_percentual BETWEEN 0 AND 100),
    prioridade             TEXT NOT NULL DEFAULT 'nenhuma' CHECK (prioridade IN (${lista(Object.keys(PRIORIDADES))})),
    habilitacao_ramon      TEXT NOT NULL DEFAULT 'pendente' CHECK (habilitacao_ramon IN (${lista(HABILITACOES)})),
    habilitacao_luciano    TEXT NOT NULL DEFAULT 'pendente' CHECK (habilitacao_luciano IN (${lista(HABILITACOES)})),
    observacao             TEXT,
    criado_por             UUID REFERENCES usuarios(id),
    criado_em              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    atualizado_em          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT precatorios_numero_unico UNIQUE (numero)
  )`);
  await conexao.execute(`CREATE INDEX IF NOT EXISTS idx_precatorios_origem ON precatorios (processo_origem_id) WHERE processo_origem_id IS NOT NULL`);
  await conexao.execute(`CREATE TABLE IF NOT EXISTS precatorio_eventos (
    id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    precatorio_id  UUID NOT NULL REFERENCES precatorios(id) ON DELETE CASCADE,
    campo          TEXT NOT NULL,
    de             TEXT,
    para           TEXT,
    usuario_id     UUID REFERENCES usuarios(id),
    criado_em      TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await conexao.execute(`CREATE INDEX IF NOT EXISTS idx_precatorio_eventos ON precatorio_eventos (precatorio_id, criado_em DESC)`);
}
