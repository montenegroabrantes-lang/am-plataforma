# Contexto permanente — Sistema AM

**Última atualização:** 11/09/2026  
**Finalidade:** continuidade segura do desenvolvimento em outros chats e sessões.

Este é o registro canônico do estado do Sistema AM. Deve ser lido antes de
qualquer alteração e atualizado depois de mudanças materiais no código, banco,
integrações ou produção. Não registrar segredos neste documento.

## Estrutura do sistema

### Backend/API

- Repositório local: `/Users/ramonabrantes/am-plataforma`
- GitHub: `montenegroabrantes-lang/am-plataforma`
- Branch: `main`
- Entrada: `src/index.js`
- Stack: Node ESM, Express, PostgreSQL/pgvector, BullMQ e Redis
- Desenvolvimento: `npm run dev`, porta `3001`
- Produção: `https://am-plataforma-production.up.railway.app`
- Último commit funcional verificado em 11/09/2026: `6ca612e`

### Frontend

- Repositório local: `/Users/ramonabrantes/am-plataforma-web`
- GitHub: `montenegroabrantes-lang/am-plataforma-web`
- Branch: `main`
- Layout principal: `src/app/(dashboard)/layout.js`
- Stack: Next.js 14, App Router
- Desenvolvimento: `npm run dev`, normalmente porta `3000`; já foi usado `3050`
- Produção: `https://am-plataforma-web-production.up.railway.app`
- Último commit funcional verificado em 11/09/2026: `b26e9d0`

### Camila

- Assistente de WhatsApp sem cópia local neste Mac.
- Produção: `https://camila-abrantes-montenegro-production.up.railway.app`
- O backend se comunica por proxy usando `CAMILA_API_URL` e `CAMILA_API_KEY`.
- Rota principal da integração: `src/routes/estimativas.js`.

### Digisac

- Produção: `https://abrantesemontenegroadv.digisac.chat`
- O deep-link de conversa funciona com `/?contactId=<uuid>`.

## Regras operacionais permanentes

- Nunca executar `next build` no mesmo diretório enquanto `next dev` estiver
  ativo; isso pode corromper `.next`. Para validar build, usar uma cópia isolada.
- Preservar alterações e arquivos do usuário que não pertençam à tarefa.
- O arquivo `emlur_desligados_2022_2026.csv` é particular, está fora do Git e não
  deve ser incluído em commits sem ordem expressa.
- `.env` e `.env.local` são arquivos secretos e nunca devem ir para o GitHub.
- Validar mudanças proporcionalmente ao risco antes de fazer deploy.

## Acesso direto aos processos judiciais

### Implementação

- O backend mantém o ID interno estável do PJe em
  `processos.pje_id_processo`.
- A construção e validação dos destinos oficiais fica em
  `src/services/acessoTribunal.js`.
- O AM persiste apenas o ID numérico; parâmetros temporários de sessão, como
  `ca`, são descartados.
- A abertura direta usa a rota oficial:
  `Processo/ConsultaProcesso/Detalhe/listAutosDigitais.seam?idProcesso=<id>`.
- A autenticação, certificado e cookies continuam exclusivamente no navegador e
  no domínio do tribunal.
- Tribunais com raiz PJe configurada: TJPB, TJPE e TRF1, em 1º e 2º graus.
- Na ficha do processo, o campo de vínculo fica em `Editar` →
  `Link direto ou ID interno do PJe`.

### Estado da base em produção — 11/09/2026

- TJPB 1º grau: **791 ativos; 790 vinculados; 1 pendente**.
- TJPB 2º grau: **8 ativos; 8 vinculados; nenhum pendente**.
- Total TJPB: **798 processos com abertura direta configurada**.
- O único TJPB pendente possui número inválido no cadastro:
  `0819815-08.2301.2.22.2026`, processo AM
  `e2eed9dd-75df-47c7-ad46-8900ba51dcd9`. Não corrigir por suposição; conferir a
  fonte antes de editar.
- Existe 1 processo ativo do TRF5 sem abertura direta configurada.
- O 2º grau possui autenticação própria. Sem sessão ativa, o PJe redireciona
  primeiro para o SSO; isso não é falha do link.

### Como foi validado

- Processo `0853409-64.2026.8.15.2001`, ID interno TJPB `3533650`, abriu os
  autos diretamente no 1º grau.
- Processo `0853384-51.2026.8.15.2001`, ID interno `3532134`, retornou no AM
  com `direto_aos_autos: true`.
- Processo `0810384-74.2021.8.15.2001` ficou vinculado ao PJe de 2º grau; sem
  sessão 2G ativa, o clique corretamente direciona ao login próprio do 2G.

### Limitação conhecida e procedimento futuro

- O ID interno do PJe não pode ser calculado a partir do número CNJ.
- O endpoint REST genérico documentado pelo PJe não está exposto na instalação
  do TJPB testada; a consulta retorna página não encontrada.
- A consulta pública do TJPB fornece o ID, mas aplica proteção Cloudflare contra
  automação de servidor. Não tentar varredura agressiva pelo Railway.
- Novos processos sem ID devem ser vinculados pelo campo da ficha ou por coleta
  assistida em navegador real, sempre cruzando CNJ exato, tribunal e grau.
- Outros tribunais serão tratados separadamente, começando pelo TRF5, depois
  TJPE e TRF1, porque cada instalação possui IDs e domínios próprios.

## Migrações, testes e deploy

- A coluna `pje_id_processo` já existe em produção.
- A migração tolera registros preexistentes e concluiu com sucesso após a
  correção registrada no commit `d97672c`.
- Backend: 49 testes estavam passando após a integração.
- Commits relacionados:
  - Backend `f6638b4`: abertura direta dos autos do PJe.
  - Backend `d97672c`: continuidade segura das migrações.
  - Backend `6ca612e`: acesso direto ao PJe do TRF1.
  - Frontend `b26e9d0`: interface de configuração e abertura direta.
- Os deploys correspondentes no Railway estavam com status `SUCCESS`.
- Health check verificado: backend respondeu com aplicação e banco operantes.

## Registro de alterações

### 11/09/2026 — Vínculos PJe em produção

- Corrigido o vínculo do processo `0853409-64.2026.8.15.2001`.
- Coletados e associados em lote os IDs válidos do TJPB.
- Resultado final: 790/791 no 1º grau e 8/8 no 2º grau.
- Nenhum vínculo existente divergente foi sobrescrito.
- O único registro não associado foi preservado por ter número CNJ inválido.
- Não houve alteração de código ou novo deploy nesta operação; a mudança foi de
  dados no banco de produção.

### 11/09/2026 — Continuidade entre chats

- Criado este registro canônico do Sistema AM.
- Adicionado `AGENTS.md` nos dois repositórios para obrigar a leitura e a
  atualização deste contexto em trabalhos futuros.
- Nenhum segredo foi registrado.
