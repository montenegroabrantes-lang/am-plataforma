-- ═══════════════════════════════════════════════════════════════
--  AM Advogados — Schema do Banco de Dados PostgreSQL
--  Versão 1.2 · Maio 2026
--  Infra: Railway (PostgreSQL + Redis + Node.js + Next.js)
--  Domínio: app.amadvogados.com.br
--  Executar na ordem: extensões → tabelas base → tabelas dependentes
-- ═══════════════════════════════════════════════════════════════

-- Extensões
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
-- pgvector: instalado na Fase IV (RAG). Ignorar erro se não disponível.
DO $$ BEGIN
  CREATE EXTENSION IF NOT EXISTS "vector";
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pgvector não disponível — instalar na Fase IV';
END $$;

-- ─────────────────────────────────────────────
--  USUÁRIOS
-- ─────────────────────────────────────────────
CREATE TABLE usuarios (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  nome          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  senha_hash    TEXT NOT NULL,
  perfil        TEXT NOT NULL CHECK (perfil IN ('master','junior')),
  master_id     UUID REFERENCES usuarios(id),       -- Junior vinculado a qual Master
  pode_marcar_restrito BOOLEAN NOT NULL DEFAULT false, -- true apenas para Master 01
  ativo         BOOLEAN NOT NULL DEFAULT true,
  totp_secret   TEXT,                                -- 2FA secret (criptografado)
  totp_ativo    BOOLEAN NOT NULL DEFAULT false,
  totp_codigos_recuperacao TEXT[],                   -- 8 códigos de emergência
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ultimo_acesso TIMESTAMPTZ
);

-- ─────────────────────────────────────────────
--  CONFIGURAÇÕES DO SISTEMA
-- ─────────────────────────────────────────────
CREATE TABLE configuracoes (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  categoria      TEXT NOT NULL,   -- 'ia' | 'backup' | 'notificacao' | 'limites'
  chave          TEXT NOT NULL,
  valor          TEXT NOT NULL,
  atualizado_por UUID REFERENCES usuarios(id),
  atualizado_em  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (categoria, chave)
);

-- Configurações padrão de limites de IA
INSERT INTO configuracoes (categoria, chave, valor) VALUES
  ('limites',  'claude_limite_mensal_reais',       '150'),
  ('limites',  'openai_limite_mensal_reais',        '50'),
  ('limites',  'alerta_percentual',                 '80'),
  ('ia',       'claude_habilitado',                'true'),
  ('ia',       'openai_habilitado',                'true'),
  ('ia',       'claude_modelo',                    'claude-sonnet-4-6'),
  ('ia',       'rota_diagnostico',                 'claude'),
  ('ia',       'rota_peticao',                     'claude'),
  ('digisac',  'account',                          'abrantesemontenegroadv'),
  ('digisac',  'token_enc',                        ''),   -- preenchido nas Configurações
  ('digisac',  'service_id',                       ''),   -- preenchido nas Configurações
  ('sheets',   'processos_camila_id',              '');   -- ID da planilha processos_camila

-- ─────────────────────────────────────────────
--  PRODUTOS JURÍDICOS (catálogo)
-- ─────────────────────────────────────────────
CREATE TABLE produtos (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  nome                  TEXT NOT NULL,
  codigo_assunto_pje    TEXT,            -- código CNJ para matching automático
  polo_passivo_padrao   TEXT,
  tribunais_padrao      TEXT[],          -- ['TJPB','TRF5']
  cargos_elegiveis      TEXT[],
  orgaos_elegiveis      TEXT[],
  ativo                 BOOLEAN NOT NULL DEFAULT true,
  criado_em             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────
--  CLIENTES
-- ─────────────────────────────────────────────
CREATE TABLE clientes (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  nome                  TEXT NOT NULL,
  cpf                   TEXT NOT NULL UNIQUE,
  whatsapp              TEXT,
  email                 TEXT,
  cargo                 TEXT,
  orgao                 TEXT,
  periodo_vinculo       TEXT,               -- ex: '2016-2019'
  polo_passivo          TEXT,
  drive_pasta_id        TEXT,               -- ID da pasta no Google Drive
  drive_pasta_url       TEXT,
  lgpd_consentimento    BOOLEAN DEFAULT false,
  lgpd_data             TIMESTAMPTZ,
  ativo                 BOOLEAN NOT NULL DEFAULT true,
  master_responsavel_id UUID REFERENCES usuarios(id),
  cadastrado_por        UUID REFERENCES usuarios(id),
  criado_em             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Produtos contratados por cada cliente
CREATE TABLE cliente_produtos (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cliente_id    UUID NOT NULL REFERENCES clientes(id),
  produto_id    UUID NOT NULL REFERENCES produtos(id),
  honorarios_pct NUMERIC(5,2) NOT NULL,  -- percentual ex: 20.00
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (cliente_id, produto_id)
);

-- ─────────────────────────────────────────────
--  CREDENCIAIS PJe / eProc (por usuário Master)
-- ─────────────────────────────────────────────
CREATE TABLE credenciais_tribunal (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  usuario_id    UUID NOT NULL REFERENCES usuarios(id),
  tribunal      TEXT NOT NULL,           -- 'TJPB' | 'TRF5' | etc.
  sistema       TEXT NOT NULL CHECK (sistema IN ('pje','eproc')),
  cpf           TEXT NOT NULL,
  senha_enc     TEXT NOT NULL,           -- AES-256
  totp_secret   TEXT,                    -- secret do TOTP do tribunal (NULL se o tribunal não usa TOTP)
  sessao_cookie TEXT,                    -- cookie de sessão ativa
  sessao_expira TIMESTAMPTZ,
  ativo         BOOLEAN NOT NULL DEFAULT true,
  UNIQUE (usuario_id, tribunal)
);

-- ─────────────────────────────────────────────
--  PROCESSOS
-- ─────────────────────────────────────────────
CREATE TABLE processos (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  numero                TEXT NOT NULL UNIQUE,  -- 0001234-56.2023.8.15.0001
  tribunal              TEXT NOT NULL,
  sistema               TEXT NOT NULL CHECK (sistema IN ('pje','eproc')),
  grau                  TEXT NOT NULL DEFAULT '1' CHECK (grau IN ('1','2')),
  vara                  TEXT,
  juiz                  TEXT,
  cliente_id            UUID REFERENCES clientes(id),
  produto_id            UUID REFERENCES produtos(id),
  polo_passivo          TEXT,
  master_responsavel_id UUID REFERENCES usuarios(id),
  habilitados_pje       TEXT[],
  compartilhado         BOOLEAN NOT NULL DEFAULT false,
  visibilidade          TEXT NOT NULL DEFAULT 'normal'
                        CHECK (visibilidade IN ('normal','restrito')),
  status          TEXT NOT NULL DEFAULT 'em_andamento'
                  CHECK (status IN ('aprovado','aguardando_protocolo','protocolado','em_andamento','encerrado')),
  tipo_execucao   TEXT,                  -- 'rpv' | 'precatorio' | NULL
  valor_causa     NUMERIC(14,2),
  valor_rpv       NUMERIC(14,2),
  importado_pje   BOOLEAN DEFAULT false,
  criado_em       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────
--  MOVIMENTAÇÕES PROCESSUAIS
-- ─────────────────────────────────────────────
CREATE TABLE movimentacoes (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  processo_id      UUID NOT NULL REFERENCES processos(id),
  data_movimentacao TIMESTAMPTZ NOT NULL,
  tipo             TEXT,
  texto            TEXT NOT NULL,
  -- Diagnóstico IA
  diagnostico_significado  TEXT,
  diagnostico_proxima_acao TEXT,
  diagnostico_urgencia     TEXT CHECK (diagnostico_urgencia IN ('CRITICO','ALTO','MEDIO','BAIXO')),
  diagnostico_prazo_dias   INTEGER,
  diagnostico_provedor     TEXT,         -- 'claude' | 'openai'
  diagnostico_em           TIMESTAMPTZ,
  -- Controle
  processada      BOOLEAN DEFAULT false,
  criado_em       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (processo_id, data_movimentacao, texto)  -- evita duplicatas
);

-- ─────────────────────────────────────────────
--  TAREFAS
-- ─────────────────────────────────────────────
CREATE TABLE tarefas (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  processo_id     UUID REFERENCES processos(id),
  movimentacao_id UUID REFERENCES movimentacoes(id),
  tipo            TEXT NOT NULL,         -- 'protocolar' | 'ciente' | 'ligar_cliente' | 'audiencia' | 'peticao'
  descricao       TEXT NOT NULL,
  instrucao       TEXT,                  -- instrução ao Junior
  atribuido_a     UUID REFERENCES usuarios(id),    -- Junior
  validado_por    UUID REFERENCES usuarios(id),    -- Master
  status          TEXT NOT NULL DEFAULT 'pendente'
                  CHECK (status IN ('pendente','em_execucao','aguardando_validacao','concluida','devolvida','nao_verificada')),
  urgencia        TEXT CHECK (urgencia IN ('CRITICO','ALTO','MEDIO','BAIXO')),
  prazo_data      DATE,
  concluida_em    TIMESTAMPTZ,
  verificada_pje  BOOLEAN,               -- resultado da verificação soberana
  verificada_em   TIMESTAMPTZ,
  observacao_devolucao TEXT,
  criado_em       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────
--  PRAZOS
-- ─────────────────────────────────────────────
CREATE TABLE prazos (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  processo_id  UUID NOT NULL REFERENCES processos(id),
  tarefa_id    UUID REFERENCES tarefas(id),
  descricao    TEXT NOT NULL,
  data_prazo   DATE NOT NULL,
  dias_uteis_restantes INTEGER,          -- calculado e atualizado pelo worker
  cumprido     BOOLEAN DEFAULT false,
  criado_em    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────
--  AUDIÊNCIAS
-- ─────────────────────────────────────────────
CREATE TABLE audiencias (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  processo_id      UUID NOT NULL REFERENCES processos(id),
  data_hora        TIMESTAMPTZ NOT NULL,
  tipo             TEXT,                 -- 'instrucao' | 'conciliacao' | 'julgamento'
  vara             TEXT,
  advogado_id      UUID REFERENCES usuarios(id),
  google_event_id  TEXT,                 -- ID do evento no Google Calendar
  alerta_48h_enviado BOOLEAN DEFAULT false,
  alerta_2h_enviado  BOOLEAN DEFAULT false,
  resultado        TEXT,
  criado_em        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────
--  PEÇAS JURÍDICAS
-- ─────────────────────────────────────────────
CREATE TABLE pecas (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  processo_id     UUID NOT NULL REFERENCES processos(id),
  tarefa_id       UUID REFERENCES tarefas(id),
  tipo            TEXT NOT NULL,         -- 'impugnacao_contestacao' | 'ciente_despacho' | etc.
  texto_gerado    TEXT,
  provedor_ia     TEXT,                  -- 'claude' | 'openai'
  status          TEXT NOT NULL DEFAULT 'gerada'
                  CHECK (status IN ('gerada','aprovada','protocolada','rejeitada')),
  aprovada_por    UUID REFERENCES usuarios(id),
  aprovada_em     TIMESTAMPTZ,
  drive_pdf_url   TEXT,                  -- PDF final no Drive
  pje_protocolo   TEXT,                  -- número do protocolo no tribunal
  criado_em       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Banco de peças (RAG) — embeddings das petições do Drive
CREATE TABLE banco_pecas (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  nome        TEXT NOT NULL,
  tipo        TEXT,
  produto_id  UUID REFERENCES produtos(id),
  drive_id    TEXT NOT NULL UNIQUE,
  texto       TEXT NOT NULL,
  embedding   vector(1536),              -- text-embedding-3-small (OpenAI)
  criado_em   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX ON banco_pecas USING ivfflat (embedding vector_cosine_ops);

-- ─────────────────────────────────────────────
--  FINANCEIRO — HONORÁRIOS
-- ─────────────────────────────────────────────
CREATE TABLE honorarios (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  processo_id           UUID NOT NULL REFERENCES processos(id),
  master_responsavel_id UUID REFERENCES usuarios(id),
  tipo                  TEXT CHECK (tipo IN ('rpv','precatorio')),
  valor_bruto           NUMERIC(14,2) NOT NULL,
  percentual            NUMERIC(5,2)  NOT NULL,
  valor_honorario       NUMERIC(14,2) NOT NULL,
  status                TEXT NOT NULL DEFAULT 'a_receber'
                        CHECK (status IN ('a_receber','recebido_parcial','recebido','em_disputa')),
  valor_recebido        NUMERIC(14,2) DEFAULT 0,
  data_recebimento      TIMESTAMPTZ,
  registrado_por        UUID REFERENCES usuarios(id),
  criado_em             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────
--  NOTAS INTERNAS
-- ─────────────────────────────────────────────
CREATE TABLE notas (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  processo_id UUID NOT NULL REFERENCES processos(id),
  autor_id    UUID NOT NULL REFERENCES usuarios(id),
  tipo        TEXT NOT NULL DEFAULT 'observacao'
              CHECK (tipo IN ('observacao','urgente','instrucao')),
  texto       TEXT NOT NULL,
  mencoes     UUID[],                    -- IDs dos usuários mencionados com @
  arquivada   BOOLEAN DEFAULT false,
  criado_em   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────
--  DOCUMENTOS DO CLIENTE
-- ─────────────────────────────────────────────
CREATE TABLE documentos (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cliente_id      UUID NOT NULL REFERENCES clientes(id),
  categoria       TEXT NOT NULL          -- 'pessoais' | 'vinculo' | 'procuracao'
                  CHECK (categoria IN ('pessoais','vinculo','procuracao')),
  nome            TEXT NOT NULL,
  drive_file_id   TEXT NOT NULL,
  drive_url       TEXT NOT NULL,
  enviado_por     UUID REFERENCES usuarios(id),
  criado_em       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────
--  PIPELINE DE LIDES (leads)
-- ─────────────────────────────────────────────
CREATE TABLE leads (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  nome                  TEXT,
  whatsapp              TEXT,
  cpf                   TEXT,
  origem                TEXT DEFAULT 'camila',
  produto_id            UUID REFERENCES produtos(id),
  etapa                 TEXT NOT NULL DEFAULT 'contato_feito'
                        CHECK (etapa IN ('contato_feito','docs_solicitados','docs_recebidos','cadastro_pendente','convertido','perdido')),
  observacao            TEXT,
  master_responsavel_id UUID REFERENCES usuarios(id),
  atribuido_a           UUID REFERENCES usuarios(id),
  cliente_id            UUID REFERENCES clientes(id),
  criado_em             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────
--  SAC — CACHE DE DADOS DO DIGISAC
--  Worker lê Digisac API + Google Sheets processos_camila
--  periodicamente e armazena aqui para o módulo Relatório
-- ─────────────────────────────────────────────
CREATE TABLE eventos_sac (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tipo        TEXT NOT NULL,             -- 'atendimento' | 'proposta_enviada' | 'doc_recebido' | 'lead_qualificado' | 'travado'
  lead_id     UUID REFERENCES leads(id),
  cliente_id  UUID REFERENCES clientes(id),
  payload     JSONB,                     -- dados brutos lidos do Digisac API
  processado  BOOLEAN DEFAULT false,
  criado_em   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────
--  CUSTOS DE API
-- ─────────────────────────────────────────────
CREATE TABLE custos_api (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  provedor    TEXT NOT NULL CHECK (provedor IN ('claude','openai')),
  tarefa      TEXT NOT NULL,             -- 'diagnostico' | 'peticao'
  tokens_in   INTEGER,
  tokens_out  INTEGER,
  custo_usd   NUMERIC(10,6),
  custo_brl   NUMERIC(10,4),
  referencia  TEXT,                      -- ID do processo/lead relacionado
  criado_em   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────
--  LOG DE AUDITORIA (imutável)
-- ─────────────────────────────────────────────
CREATE TABLE logs_auditoria (
  id          BIGSERIAL PRIMARY KEY,
  usuario_id  UUID REFERENCES usuarios(id),
  acao        TEXT NOT NULL,             -- 'criar' | 'editar' | 'excluir' | 'login' | 'exportar'
  entidade    TEXT NOT NULL,             -- 'cliente' | 'processo' | 'honorario' | etc.
  entidade_id UUID,
  valor_antes JSONB,
  valor_depois JSONB,
  ip          TEXT,
  criado_em   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Log é append-only: sem UPDATE nem DELETE permitidos via aplicação

-- ─────────────────────────────────────────────
--  ÍNDICES PRINCIPAIS
-- ─────────────────────────────────────────────
CREATE INDEX ON processos (cliente_id);
CREATE INDEX ON processos (tribunal);
CREATE INDEX ON processos (status);
CREATE INDEX ON processos (master_responsavel_id);
CREATE INDEX ON processos (visibilidade);
CREATE INDEX ON movimentacoes (processo_id, data_movimentacao DESC);
CREATE INDEX ON movimentacoes (diagnostico_urgencia);
CREATE INDEX ON tarefas (atribuido_a, status);
CREATE INDEX ON tarefas (prazo_data);
CREATE INDEX ON prazos (data_prazo);
CREATE INDEX ON leads (etapa);
CREATE INDEX ON leads (master_responsavel_id);
CREATE INDEX ON honorarios (master_responsavel_id);
CREATE INDEX ON clientes (master_responsavel_id);
CREATE INDEX ON eventos_sac (processado, criado_em);
CREATE INDEX ON custos_api (provedor, criado_em);
CREATE INDEX ON logs_auditoria (entidade, entidade_id);
CREATE INDEX ON clientes USING gin (nome gin_trgm_ops);
