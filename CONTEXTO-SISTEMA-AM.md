# Contexto permanente — Sistema AM

**Última atualização:** 14/09/2026
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
- Último commit funcional verificado em 14/09/2026: `0da02a1`

### Camila

- Assistente de WhatsApp — repositório local:
  `/Users/ramonabrantes/Documents/Claude/Projects/camila-abrantes-montenegro` (correção de nota
  antiga: a cópia local existe e foi usada diretamente nesta sessão para análise e correções).
- GitHub: `montenegroabrantes-lang/camila-abrantes-montenegro`, branch `main`.
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

## Funcionalidades consolidadas nesta sessão — 09 a 11/09/2026

### Interface e produtividade

- O dashboard e a navegação lateral foram modernizados, com maior densidade de
  informação e foco no trabalho diário da equipe.
- Foram corrigidos o baixo contraste do topo da tela de login e a sobreposição
  do cabeçalho nas páginas internas.
- A lista de processos recebeu busca global, filtros operacionais e visual mais
  compacto para reduzir navegação desnecessária.
- Commits do frontend: `ea81ab3`, `5a6720f`, `a24b074` e `0d12ddb`.

### Classificação processual e cessão de crédito

- A aba `Classificação` da ficha do processo foi reorganizada em blocos de
  decisão, com orientação de preenchimento, revisão manual, urgência, momento
  atual, responsável pela próxima movimentação e salvamento unificado.
- A aba `Cessão` permite registrar cessionário, documento, valor de face, valor
  da cessão, percentual, data e observações.
- Ao registrar uma cessão, o processo passa a retornar `tem_cessao`, pode ser
  filtrado e exportado por essa condição e recebe o identificador financeiro
  amarelo `$` na lista, na busca global e na ficha.
- O registro também gera uma tarefa operacional para habilitação do
  cessionário. A remoção da cessão é restrita a usuário Master e auditada.
- Commits: backend `650bae0` e `b3c806d`; frontend `56ef0e7` e `b7d684c`.

### Publicações transformadas em central de prazos

- A tela exibe uma prévia do texto da publicação e agrupa os itens por
  processo, mantendo acesso ao conteúdo completo e à ficha correspondente.
- A visão padrão mostra apenas publicações com prazo aberto. Existem visões
  separadas para triagem, encerradas e todas, além das janelas `vencidos`,
  `hoje`, `semana`, `mês` e `futuros`.
- Marcar uma publicação como lida não remove nem oculta o prazo aberto.
- O prazo sugerido pode ser confirmado ou corrigido por Master, com responsável
  definido e sincronização com o Google Calendar. Publicações sem prazo ou
  irrelevantes precisam de triagem explícita.
- A extração automática considera dias úteis, começa a contagem no primeiro dia
  útil posterior à publicação e rejeita datas anteriores ou superiores a 180
  dias, evitando prazos manifestamente implausíveis.
- Commits: backend `67b5d09`; frontend `aff2f15` e `b2fcf29`.

### Fechamento de contrato, onboarding e tarefas

- Marcar um lead como `fechado` exige confirmação de contrato assinado, data da
  assinatura, ao menos um produto, honorários, responsáveis e prazos de cadastro
  e protocolo. A operação é idempotente para não duplicar o fluxo em tentativas
  repetidas.
- Se o cliente ainda não existe, o sistema cria onboarding em
  `cadastro_pendente`, uma tarefa de cadastro e tarefas de protocolo bloqueadas.
  A conclusão do cadastro exige CPF válido e consentimento LGPD, vincula os
  produtos, prepara a estrutura do cliente e libera os protocolos.
- Se o cliente já existe, o onboarding começa em `protocolo_pendente` e as
  tarefas de protocolo são criadas ou reaproveitadas por produto.
- O cockpit de tarefas possui filas para minhas tarefas, equipe, onboarding,
  protocolos, validação, triagem, prazos e concluídas; prioriza atrasadas e
  recalcula urgência conforme a proximidade do prazo.
- Protocolos sem o vínculo operacional necessário ficam bloqueados e não devem
  aparecer como trabalho liberado antes da triagem/ativação.
- Commits: backend `0460096` e `818b113`; frontend `ba3a582`, `ea37f2a` e
  `d5fc1a1`.

### Estimativas e referências oficiais estaduais

- A calculadora manual da Camila foi integrada à aba Estimativas; resultados não
  confirmados continuam identificados como referência, sem aprovação
  automática.
- Para vínculos estaduais, o backend consulta as fontes oficiais da Paraíba e de
  Pernambuco, limitado às últimas 60 competências (cinco anos).
- A consulta separa vínculos por matrícula, evita somar duplicidades mensais,
  informa meses indisponíveis e calcula uma referência de 8% sobre a remuneração
  oficial localizada. O usuário precisa escolher `Usar como referência`.
- Há cache local de seis horas e limite de concorrência em lotes. Indisponibilidade
  da fonte é apresentada como erro de referência, não como resultado negativo.
- Fontes usadas: API de Dados Abertos da Paraíba e consulta pública Pentaho do
  Portal da Transparência de Pernambuco.
- Commits: backend `b45fac5` e `0349745`; frontend `16b9e87` e `4ba7ff8`.

### Leads, Digisac e processos

- Leads podem exibir seus processos vinculados e abrir a ficha correspondente
  diretamente no AM.
- A conversa do lead continua abrindo no Digisac pelo deep-link
  `/?contactId=<uuid>`.
- Da ficha do processo, o acesso ao tribunal usa a configuração segura descrita
  na seção seguinte; o AM não compartilha credenciais com o PJe.
- Commits: backend `5fb1129`; frontend `eb80019`.

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
- Consolidado o histórico funcional desta sessão: interface, classificação,
  cessão de crédito, central de prazos, onboarding/tarefas, estimativas oficiais,
  leads, Digisac e acesso aos tribunais.
- Suíte atual do backend executada após a conferência: **49/49 testes passando**.
- Nenhum segredo foi registrado.

### 14/09/2026 — Reconhecimento de clientes pela Camila

- Um atendimento real mostrou que a Camila podia reiniciar a qualificação comercial de um
  cliente já cadastrado quando não existia `status_processual` local e o campo WhatsApp do
  cliente estava vazio no AM. A frase “tenho processo aí” também podia ser interpretada pelo
  modelo como processo com outro representante.
- O backend passou a expor `GET /api/integracoes/camila/cliente`, protegido pela chave
  compartilhada entre os serviços. A resposta contém somente nome, situação ativa do cadastro e
  do vínculo e quantidade/existência de processos; não expõe CPF, número de processo, anotações,
  IDs ou dados jurídicos.
- A identificação aceita telefone brasileiro com ou sem país e nono dígito. Quando o telefone
  não está cadastrado, compara o nome do contato do Digisac após remover o complemento operacional
  e partículas como “da/de/do”. Em caso de homônimos, não escolhe nenhum cadastro.
- A Camila consulta esse resumo nas entradas processuais e nas opções 1 e 2 do menu. Cliente com
  processo reconhecido segue para consulta processual, inclusive sem status publicado localmente;
  nesse caso solicita atualização à equipe em vez de abrir uma nova venda. Frases que indicam
  processo no próprio escritório são decididas antes da IA e não acionam a regra de conflito com
  advogado ou sindicato externo.
- A qualificação comercial agora presume o vínculo ativo e pergunta cargo e data de início. Data
  final só é solicitada quando a própria pessoa informa aposentadoria, desligamento, exoneração ou
  encerramento da atividade.
- Avisos do WhatsApp que chegam como `ciphertext` são concluídos silenciosamente, sem resposta e
  sem chamada à IA. Outras mídias inacessíveis recebem apenas um pedido institucional de reenvio,
  sem a antiga frase sobre conseguir ler somente mensagens escritas.
- Validação: backend **54/54 testes**; Camila `test:safe`, **166/166 testes de continuidade** e
  teste ponta a ponta do caso de cliente reconhecido. Em produção, a integração reconheceu o
  cadastro correto com dois processos e devolveu apenas os cinco campos permitidos; sem chave a
  rota respondeu `401`. Os health checks dos dois serviços responderam normalmente.
- Commits: backend `7f10bd0`; Camila `53e9707` e `5c3d1f2`.
- Deploys Railway `SUCCESS`: backend `06014146-237e-49f0-b02f-bb6f01b6a60a`; Camila
  `665bcfd9-3438-4897-af9e-e0f7e23d37b9`.
- Nenhuma mensagem de teste foi enviada a cliente e os atendimentos reais já assumidos pela equipe
  não foram reprocessados.

### 14/09/2026 — Fechamento completo de leads pelo quadro

- Corrigida a impossibilidade de mover um lead da coluna `Documentos` para `Fechado` no quadro.
  O quadro ainda excluía `Fechado` das colunas que aceitavam soltura e mantinha um formulário
  antigo que enviava somente valor e observação, incompatível com o onboarding obrigatório.
- A coluna `Fechado` agora aceita o card e abre o mesmo formulário completo usado na Lista:
  confirmação da assinatura, data, valor, cliente existente ou novo cadastro, produtos e
  honorários, responsáveis e prazos de cadastro/protocolo.
- A interface apenas alerta quando encontra possível cliente pelo nome; não seleciona
  automaticamente, evitando vínculo indevido por homônimo. Soltar um card na própria coluna não
  executa ação.
- Em caso de validação ou erro da API, o formulário permanece aberto e nenhum fechamento aparente
  é mostrado. Somente a confirmação bem-sucedida fecha o modal e inicia o onboarding.
- Validação: build completo do Next.js 14 em cópia isolada, com as 19 rotas compiladas. O `.next`
  do repositório principal não foi usado no build.
- Produção verificada em navegador com um lead real da coluna `Documentos`: a soltura em
  `Fechado` abriu o formulário completo, com produtos, responsáveis, prazos e confirmação de
  assinatura. A verificação foi cancelada antes do envio e não alterou o lead.
- Commit do frontend: `0da02a1`.
- Deploy Railway `SUCCESS`: `96d1ed8e-297c-449a-acfa-a51ed37660e7`.

### 14/09/2026 — Ativação operacional de contratos assinados

- Separadas no quadro as situações `Assinado` e `Fechado`. `Assinado` é a confirmação externa
  recebida da Camila; `Fechado` passa a representar contrato já ativado no AM com onboarding
  local. Isso evita mostrar como operacionalizado um contrato que ainda não gerou cadastro e
  protocolo.
- A nova coluna `Assinado · ativar` possui a ação `Ativar contrato`. A confirmação reaproveita o
  formulário completo de fechamento e já reconhece a assinatura, mas exige conferência da data,
  produtos, honorários, responsáveis, prazos e vínculo do cliente antes de gravar. Para manter o
  quadro compacto, a coluna só é exibida quando existe ao menos um contrato aguardando ativação;
  a etapa e todas as proteções continuam ativas quando a coluna está oculta.
- O caminho pela Lista também ficou contínuo: ao escolher `Assinatura confirmada` em `Fase da
  contratação`, o botão passa a dizer `Confirmar assinatura e ativar`; depois que a fase é salva,
  o formulário de ativação abre imediatamente. Se o operador interromper o procedimento, o lead
  permanece na fila `Assinado · ativar` e pode ser retomado depois.
- A seleção de cliente existente ganhou filtro por nome/CPF, mas mostra apenas os quatro últimos
  dígitos do CPF nas opções, reduzindo exposição desnecessária de dados. O cruzamento aproximado
  por nome continua sendo apenas uma sugestão: o operador deve confirmar o vínculo; caso prossiga
  como cliente novo apesar de uma possível correspondência, recebe uma confirmação adicional
  para reduzir cadastros duplicados e vínculos por homônimo.
- A criação do onboarding já era restrita a Master no backend. A interface agora acompanha essa
  autorização: somente Master carrega produtos/usuários/clientes e pode ativar ou soltar um card
  em `Fechado`. Outros perfis podem registrar a assinatura, mas veem `Aguardando ativação do
  Master` e não recebem os dados auxiliares do formulário.
- Antes de ativar, a interface explica o fluxo: cliente novo cria tarefa de cadastro e mantém os
  protocolos bloqueados até CPF e consentimento LGPD; cliente já cadastrado é vinculado e libera
  as tarefas de protocolo imediatamente.
- Depois de uma ativação bem-sucedida, o AM abre automaticamente o onboarding. Assim o cadastro
  pode ser concluído no mesmo fluxo e, ao final, o sistema libera os protocolos e encaminha o
  usuário para Tarefas.
- Um lead com onboarding local ativo aparece em `Fechado` mesmo se a sincronização externa ainda
  devolver `assinado`. Os resumos diários também deixaram de contar assinatura pendente de
  ativação como fechamento concluído.
- Validação: build completo do Next.js 14 em cópia isolada, com 19 rotas compiladas; health checks
  do frontend e backend responderam `200`. Em produção, o quadro exibiu a nova coluna separada e
  os onboardings ativos na coluna `Fechado`. Também foram conferidos o comando `Confirmar
  assinatura e ativar` e a exibição `CPF final`; as seleções foram revertidas sem salvar. No
  momento havia zero leads em `Assinado · ativar`, portanto nenhuma operação real foi submetida.
- Commits do frontend: `96a12e9`, `68aa870`, `a315f72`, `6abaa5d` e `7e9c76a`.
- Deploy Railway final `SUCCESS`: `e317a49d-a6cd-496c-a7a3-4080ac71dc48`.

### 15/09/2026 — Fila de pendências processuais recorrentes

- Criado um fluxo determinístico para clientes que voltam a pedir atualização processual quando
  a Camila ainda não possui `status_processual` publicado. A primeira solicitação recebe uma única
  confirmação e vai para `CAMILA - PENDÊNCIAS PROCESSUAIS`; a segunda cobrança ganha prioridade
  alta; a terceira, espera de 48 horas, frustração ou pedido direto de advogado ganha prioridade
  crítica e segue uma única vez ao `JURÍDICO`.
- Saudações, agradecimentos e despedidas não aumentam a contagem. A confirmação de acompanhamento
  tem intervalo mínimo de 24 horas. Resposta humana muda o caso para `em_atendimento`, mas a
  pendência só termina quando a equipe registra um novo status ou usa `Resolver` no AM.
- O Digisac recebeu o departamento `CAMILA - PENDÊNCIAS PROCESSUAIS`, ID
  `f29ccc99-fb07-47b2-988a-47ce8f94013c`. O robô `CAMILA INTEGRADA` foi republicado na versão
  `22c657f0-2136-4b7d-9d6b-f21bb8d145d6` com a nova fila incluída na condição que suprime o menu
  automático dentro das filas da Camila.
- A Plataforma AM ganhou a aba `Estimativas > Processual`, com contadores, filtros, prioridade,
  número de cobranças, tempo de espera, busca por nome/telefone/UUID, conversa integrada do
  Digisac e ações Master de priorizar, resolver e reabrir.
- A migração inicial identificou silenciosamente cinco contatos recorrentes dos últimos 14 dias,
  todos críticos: quatro com atendimento humano posterior e um aguardando a equipe. Ela não envia
  mensagens nem transfere chamados históricos.
- O contato `51e0ff3f-3c29-4672-9cc5-2ba0aa7a1efb` foi encontrado em prioridade crítica, com
  quatro cobranças e estado `em_atendimento`; o chamado atual está no `JURÍDICO` com responsável
  humano, portanto a Camila fica bloqueada e não interfere.
- Validação: Camila **201/201 testes de continuidade**, `test:safe` integral e cinco testes
  específicos; backend AM **54/54**; frontend Next.js com 19 rotas compiladas em cópia isolada.
  Produção confirmou API `200`, os cinco contadores, busca pelo UUID e abertura da conversa.
- Commits: Camila `351b73d`, `9498ffe` e `2951145`; backend AM `99e9f3b`; frontend AM `973dd6c`.
  Deploys Railway `SUCCESS`: Camila `20db23f2-d23a-48cb-aad9-907c64c0b47f`, backend
  `97c1f928-859b-4ad8-9e32-3707d146945b` e frontend
  `00bdb820-61ee-4025-84c2-10acb4657034`.
- Nenhuma mensagem foi enviada a clientes durante diagnóstico, migração, testes ou validação.

### 15/09/2026 — Tese contratada na classificação do processo

- Corrigida a seção `Classificação interna` da ficha do processo. Ela usava a tabela paralela
  `classificacoes_processuais`, que podia aparecer vazia e gravava apenas texto livre em
  `processos.classificacao`; selecionar ou criar uma opção ali não vinculava a tese real, o
  contrato, as tarefas nem os honorários.
- A seção 4 agora se chama `Tese jurídica do processo` e usa o relacionamento canônico
  `processos.produto_id -> produtos`, limitado às teses de `cliente_produtos` efetivamente
  contratadas pelo cliente. Exibe também o percentual de honorários do vínculo.
- O Master pode, dentro da própria ficha, vincular ao contrato uma tese já existente no catálogo,
  informando os honorários, e depois aplicar a tese ao processo no mesmo salvamento da
  classificação. Teses novas continuam sendo criadas em
  `Configurações > Produtos Jurídicos`; o atalho da ficha abre diretamente essa aba.
- Alterar a tese do processo passou a exigir perfil Master, produto ativo, UUID válido, cliente
  vinculado e vínculo contratual prévio. A mudança sincroniza o campo legado `classificacao`, é
  registrada em `logs_auditoria` e usa a nova tese no cálculo automático de honorários quando a
  situação de pagamento muda no mesmo pedido.
- O endpoint de vínculo `POST /api/produtos/clientes/:clienteId` também passou a validar cliente
  ativo, produto ativo e percentual entre 0 e 100. A classificação manual ganhou a mesma proteção
  de visibilidade dos processos restritos já aplicada na leitura da ficha.
- A API da ficha devolve `teses_cliente`, evitando chamadas e estados paralelos no frontend. Erro
  nessa consulta principal não é mais mascarado como uma lista vazia; o catálogo auxiliar exibe
  uma mensagem própria quando não puder ser carregado.
- Produção conferida na ficha do processo `0856094-44.2026.8.15.2001`, sem gravar alterações: o
  sistema identificou que `FERIAS 45 DIAS` era a tese atual sem vínculo contratual e ofereceu as
  teses contratadas `FGTS` e `PISO SALARIAL - MAGISTÉRIO`, ambas com o percentual exibido. O
  formulário de novo vínculo abriu corretamente e permaneceu sem envio.
- Há dois produtos ativos com o nome `Equiparação salarial no magistério` no catálogo; nenhum foi
  excluído ou mesclado automaticamente porque podem possuir vínculos históricos distintos. Esse
  dado deve ser revisado pelo Master em Produtos Jurídicos antes de uma futura consolidação.
- Validação: backend **54/54 testes**, verificação sintática das rotas alteradas e build completo
  do Next.js 14 em cópia isolada, com as 19 rotas compiladas. Health checks de backend e frontend
  responderam `200` após a publicação.
- Commits: backend `f0e4928`; frontend `c1f3135`. Deploys Railway `SUCCESS`: backend
  `09214b7c-1eed-44cf-8e66-ee76255ffb57`; frontend
  `c1b1de08-42fa-4275-87d5-50aef9638a63`.

### 15/09/2026 — Edição de honorários das teses contratadas

- Corrigida a ausência de edição do percentual em vínculos já existentes de
  `cliente_produtos`. Antes, o honorário só podia ser informado ao criar o vínculo; depois disso
  a interface apenas exibia o valor.
- O Master agora pode editar o percentual tanto na seção `Tese jurídica do processo` quanto em
  `Cliente > Teses e Protocolos`, sem remover ou recriar a tese. A edição da ficha processual
  acompanha a tese selecionada no campo.
- Criado `PATCH /api/produtos/clientes/:clienteId/:cpId`, restrito a Master. A rota valida os dois
  UUIDs, confirma que o vínculo pertence ao cliente, aceita somente percentual entre 0 e 100 e
  registra valor anterior e novo em `logs_auditoria`.
- A tela informa expressamente que a alteração vale para os próximos cálculos automáticos. Os
  lançamentos financeiros já gerados são históricos e não são recalculados silenciosamente.
- Validação: backend **54/54 testes**, verificação sintática, build completo do Next.js 14 em
  cópia isolada com as 19 rotas compiladas e health checks `200` nos dois serviços. A inspeção
  visual pelo navegador não foi concluída porque o Mac estava bloqueado; nenhum contrato real foi
  alterado durante os testes.
- Commits: backend `16b7e8f`; frontend `b61d258`. Deploys Railway `SUCCESS`: backend
  `2c68851c-ae69-42f1-8483-39caf21843ec`; frontend
  `944a9237-61aa-4ebd-b8c4-d19d7f557334`.

### 15/09/2026 — Tese visível nas tarefas e triagem por pendência

- A API de tarefas passou a resolver a tese efetiva nesta ordem: vínculo específico da tarefa,
  produto do onboarding e produto já vinculado ao processo. A pesquisa e o filtro por tese usam
  a mesma regra, corrigindo tarefas de prazo que apareciam sem tese apesar de o processo estar
  classificado.
- Os cartões exibem a tese como informação operacional destacada logo abaixo do título. Quando
  um processo não tem tese, mostram `TESE NÃO DEFINIDA`; o botão abre diretamente a aba
  `Classificação` da ficha para correção.
- A fila `Triagem` ganhou filtros por motivo: sem responsável, sem prazo, sem tese e sinalizadas.
  Cada cartão apresenta todos os motivos aplicáveis. Ausência de prazo só gera triagem para tipos
  que realmente exigem data (`prazo`, `prazo_pagamento`, `protocolar`, `demanda` e `assinatura`),
  evitando misturar tarefas administrativas sem data.
- O CPF deixou de aparecer integralmente nos cartões e agora é mascarado, reduzindo exposição de
  dado pessoal e ruído visual.
- Validação local: backend **54/54 testes**, `node --check`, `git diff --check`; frontend com build
  completo do Next.js em cópia isolada, com as 19 rotas compiladas. O comando `next build` não foi
  executado no diretório usado pelo servidor de desenvolvimento.
- Commits: backend `cad7f87`; frontend `1ae6899`. Deploys Railway `SUCCESS`: backend
  `3b2ea271-8348-4a1a-b3e3-6ecd6b00acfd`; frontend
  `b4df0d59-5d98-4825-a438-2d3ec4829c89`. Health checks responderam `200` nos dois serviços.

### 16/09/2026 — Filtros operacionais e carga de atividades por tese

- A tela de tarefas ganhou filtros combináveis de origem (`Publicações`, `Processos`, `Novos
  contratos`, `Administrativas` e `Criadas manualmente`), horizonte (`Vencidas`, `Vencem hoje`,
  próximos 3 ou 7 dias e `Sem prazo`) e tese, incluindo a opção `Sem tese`.
- As combinações funcionam dentro das filas existentes e aparecem como caminho de contexto, por
  exemplo `Minha fila › Publicações › Férias 45 dias › Vencidas`, com limpeza em uma ação.
- A origem `Publicações` considera apenas tarefas efetivamente criadas a partir de publicação
  (`tarefas.publicacao_id`); publicações que não geraram providência continuam fora da execução.
- Criado `GET /api/tarefas/resumo-teses`, que calcula no banco a carga completa da fila por tese,
  sem depender dos 100 cartões da página. O quadro apresenta a fazer, em andamento, validação,
  originadas de publicação, vencidas e total, e cada linha funciona como filtro.
- O backend passou a aceitar `origem`, `horizonte` e `produto_id=sem_tese`, validando opções e UUIDs.
  A API também devolve `origem_tarefa` em cada cartão para futuras visualizações.
- Validação local: backend **54/54 testes**, verificação sintática e `git diff --check`; frontend
  compilado em cópia isolada, com as 19 rotas do Next.js geradas sem executar `next build` no
  diretório utilizado pelo desenvolvimento.
- Produção confirmou `200` tanto na listagem combinada `Equipe + Publicações + próximos 7 dias`
  quanto no resumo completo por tese para publicações. Commits: backend `2776fda`; frontend
  `2d61ab8`. Deploys Railway `SUCCESS`: backend `5587eef8-73dd-4609-91ae-7e9a826caaf6`;
  frontend `74157b72-274a-4703-9931-09d2f00bef3c`.

### 16/09/2026 — Pré-preenchimento seguro do cadastro pela calculadora

- O fechamento comercial passou a transportar para o onboarding o período informado pela
  calculadora, além de nome, WhatsApp, cargo e órgão, que já acompanhavam o fluxo. Os valores são
  gravados localmente no fechamento para o cadastro não depender da disponibilidade posterior da
  Camila.
- Foram adicionados `vinculo_inicio_informado`, `vinculo_fim_informado` e `dados_origem` em
  `onboardings_contrato`. `dados_origem` registra quais campos vieram da calculadora, sem guardar
  CPF, e-mail ou consentimento que não tenham sido efetivamente fornecidos.
- A tela `Completar cadastro` identifica visualmente os campos pré-preenchidos, mantém todos
  editáveis e exige uma confirmação humana específica de revisão. Essa confirmação é separada do
  consentimento LGPD, que continua obrigatório e nunca é marcado automaticamente.
- Datas completas recebidas podem preencher o vínculo. Quando a origem traz apenas mês e ano, a
  competência é exibida como referência e o funcionário precisa confirmar as datas exatas; o
  sistema não inventa o primeiro ou o último dia do mês.
- O backend também exige a confirmação dos dados da calculadora antes de criar/vincular o cliente,
  preserva a validação real do CPF e continua verificando duplicidade pelo CPF dentro da transação.
- Validação local: backend **54/54 testes**, verificação sintática e `git diff --check`; frontend
  compilado em cópia isolada com as 19 rotas geradas, sem executar `next build` no diretório de
  desenvolvimento.
- Produção confirmou a criação das três colunas de origem/período. Commits: backend `a969bc8`;
  frontend `d63a9f6`. Deploys Railway `SUCCESS`: backend
  `0c6e94a4-2dab-4efd-8f55-23b98750d5d7`; frontend
  `e6863246-ddc0-4aa3-8d48-925d1e86d7e7`.

### 16/09/2026 — Protocolo confirmado e diligências judiciais

- Separada a cadeia `prazo → elaboração/juntada → assinatura → protocolo`. Assinar uma peça não
  encerra mais o prazo judicial: a tarefa passa para `aguardando_protocolo`, e somente a ação
  explícita `Confirmar protocolo` conclui a assinatura e o prazo de origem.
- A confirmação aceita referência/comprovante e pode criar imediatamente uma diligência posterior,
  herdando processo e tese. O sistema impede outra diligência aberta do mesmo subtipo no processo.
- Criado o tipo próprio `diligencia`, com fila `Diligências` e subtipos como solicitar conclusão,
  verificar apreciação, contatar secretaria, cobrar cumprimento, acompanhar alvará/RPV/precatório
  e certificar decurso. Diligência não é mais confundida com a demanda de preparar uma peça.
- A conclusão exige canal e resultado. Pode registrar atendente e comprovante; quando há retorno
  pendente, exige data de nova verificação e mantém a tarefa em `aguardando_retorno`.
- Foram adicionados os campos auditáveis de protocolo e diligência em `tarefas`, e os novos estados
  `aguardando_protocolo` e `aguardando_retorno` ao domínio de status.
- Validação local: backend **54/54 testes**, verificação sintática e `git diff --check`; frontend
  compilado em cópia isolada com as 19 rotas geradas, sem executar `next build` no diretório de
  desenvolvimento.
- Produção confirmou as sete novas colunas e a fila `diligencias` respondeu `200`. Commits:
  backend `0f4f760`; frontend `8aaaa81`. Deploys Railway `SUCCESS`: backend
  `85125a90-5e4b-4a0a-ae88-5267bf5c3444`; frontend
  `65ce15e8-5353-4857-8f10-698effe2faf7`.

### 17/09/2026 — Administração de chaves de integração externa

- Criada a área **Configurações → Integrações e API**, restrita a Masters, para criar e revogar
  chaves destinadas a sistemas externos. Não confundir com segredos de infraestrutura, Camila,
  Digisac ou Railway: estes continuam somente nas variáveis de ambiente.
- Cada chave recebe nome, finalidade, permissões mínimas (`leitura`, `clientes`, `processos`,
  `estimativas`, `tarefas`) e expiração opcional. A chave completa é mostrada exclusivamente uma
  vez após a criação; depois a interface apresenta apenas um identificador mascarado.
- A tabela `chaves_api_externas` conserva apenas SHA-256 do segredo e registra uso mais recente,
  IP, criação e revogação. Criação e revogação também entram em `logs_auditoria`.
- `src/routes/chavesApi.js` exporta `autenticarChaveExterna` para as futuras rotas públicas de
  integração, usando `X-AM-API-Key` (ou Bearer) e rejeitando chaves revogadas ou expiradas. Não
  existe ainda uma rota de negócio externa genérica: ela deve ser criada com escopo explícito e
  checagem da permissão necessária, sem conceder acesso administrativo.
- A chave pode ser editada posteriormente quanto a nome, finalidade, permissões e expiração. O
  segredo não é editável nem recuperável; para trocar credencial usa-se rotação (nova chave e
  revogação da anterior), preservando a segurança e o histórico de auditoria.

### 17/09/2026 — Primeiro endpoint público para contato pela Camila

- A permissão `camila` foi adicionada às chaves externas. Ela habilita somente dois caminhos que
  reutilizam o fluxo já existente da Camila: mensagem a um `contactId` existente e reabordagem.
  Ambos registram auditoria e não permitem acesso administrativo ao AM.
- Endpoints: `POST /api/integracoes/v1/camila/leads/:contactId/mensagem` (corpo `mensagem`, até
  2.000 caracteres) e `POST /api/integracoes/v1/camila/leads/:contactId/reabordar`. Ambos exigem
  `X-AM-API-Key` com permissão `camila` e encaminham à Camila pela credencial interna do Railway.
- Não foi criada falsa integração de valor/tese de honorários: o contrato atual da API da Camila
  para estimativa manual não confirma esses campos. Para disponibilizá-los corretamente será
  preciso alterar/consultar o serviço Camila no Railway ou obter sua especificação.

### 17/09/2026 — Operações seguras em lote nas tarefas

- A tela de tarefas agora oferece filtro de vencimento `Vence até`, preserva itens selecionados
  entre páginas e permite selecionar/desmarcar somente a página atual sem perder a seleção das
  demais páginas. A seleção é limpa quando muda o contexto da busca/fila/filtros.
- Masters podem, em lote, atribuir, alterar prazo, concluir tarefas elegíveis, cancelar com
  justificativa e restaurar tarefas canceladas com motivo. Há uma prévia antes da confirmação,
  exibindo quantidade elegível, período filtrado e itens que ficaram de fora.
- A conclusão em lote bloqueia deliberadamente `protocolar`, `cadastro_cliente`, `assinatura` e
  `diligencia`, pois cada uma possui exigência própria (CNJ/comprovante, onboarding, protocolo ou
  resultado). O backend registra auditoria e remove eventos do Calendar das tarefas concluídas.
- Rotas: `POST /api/tarefas/lote/previsualizar`, `POST /api/tarefas/lote/concluir` e
  `POST /api/tarefas/lote/restaurar`; `PATCH /api/tarefas/lote` continua responsável por
  atribuição, prazo e cancelamento. Todas são exclusivas de Master e limitadas a 200 tarefas.

### 17/09/2026 — Acervo jurídico de peças e precedentes

- Criado o módulo `Acervo jurídico`, separado das tabelas operacionais `pecas` e `banco_pecas`
  já existentes. As novas tabelas `acervo_pecas`, `acervo_precedentes`, `teses_acervo` e suas
  relações de teses preservam o histórico mesmo que o processo de origem seja excluído.
- O catálogo inicial contém teses normalizadas e permite várias teses por peça ou precedente.
  Peças e precedentes preservam a visibilidade original do processo; registros restritos não
  aparecem para quem não tem a permissão específica de processo restrito.
- A tela `/acervo` inclui busca, filtros por tese/ente/instância, abas de peças, precedentes,
  pendências de organização e arquivados, lista com painel de detalhes, acesso à fonte no Drive,
  cadastro de Master, conferência explícita de fonte primária, arquivamento/restauração e
  auditoria. O Drive continua sendo o arquivo de origem; não há ainda cópia ou versionamento de
  arquivos.
- A consulta de precedente só recebe selo de conferido com fonte primária e usuário/data de
  conferência. Resultado formal e favorabilidade são registrados separadamente.

### 18/09/2026 — Fluxo contínuo entre contrato e cadastro

- O fechamento de contrato agora leva os vínculos revisados para o onboarding como rascunho,
  sem presumir CPF, consentimento LGPD ou confirmação humana. Assim, o cadastro deixa de pedir
  novamente cargo, órgão e período já conferidos na estimativa.
- A ficha de onboarding ganhou salvamento real de rascunho no servidor. O acesso é limitado ao
  Master ou aos responsáveis pelo onboarding; o rascunho é apagado quando o cadastro é concluído.
- A ativação permite definir uma única pessoa para cadastro e protocolo quando ela executará as
  duas etapas. A busca de cliente existente consulta toda a base por nome ou CPF, sem depender da
  primeira página carregada na tela.
- A ficha apresenta as pendências que impedem a liberação e o botão de tarefas abre somente as
  tarefas daquele contrato.
- Validação: verificação sintática do backend, suíte **54/54** e build isolado do Next.js
  com as 20 rotas compiladas. Em produção, o health check do backend respondeu `200` com banco
  operante, a rota de rascunho respondeu `401` sem credencial e a rota do frontend respondeu
  `200`. Nenhum cadastro real foi criado ou alterado durante a verificação.
- Commits: backend `0bd3ee6`; frontend `2de65ef`.

### 19/09/2026 — Polo passivo seguro no protocolo inicial

- `GET /api/tarefas` passou a agregar, via `LEFT JOIN LATERAL` em `cliente_vinculos`, os campos
  `vinculos_ativos` (lista completa), `polos_passivos` (distintos) e `polo_passivo` (resolvido).
  Prioridade: `processos.polo_passivo` já existente > vínculo ativo único > `clientes.polo_passivo`
  > padrão da tese (`produtos.polos_passivos_padrao[1]`). Com 2+ vínculos ativos, nunca escolhe
  um polo arbitrário — o campo fica vazio e a UI exige seleção humana.
- Nova coluna `tarefas.cliente_vinculo_id` (FK para `cliente_vinculos`, `ON DELETE SET NULL`),
  migrada de forma aditiva em `src/index.js`. Já aplicada manualmente no banco de produção
  (Railway) antes do deploy do código, sem impacto em dados existentes.
- `src/utils/vinculos.js` (novo): `vinculoUnicoAtivo(clienteId)` resolve automaticamente o vínculo
  quando o cliente tem exatamente 1 vínculo ativo; com 0 ou 2+ retorna `null`. Usado tanto na
  criação manual de tarefa (`POST /api/tarefas`) quanto na criação automática de protocolo pelo
  onboarding (`src/services/onboarding.js`).
- `PATCH /api/tarefas/:id/concluir-com-numero` reforçado: valida que o `vinculo_id` pertence ao
  cliente e está ativo (400/409 quando não), exige seleção explícita quando há 2+ vínculos ativos
  sem `vinculo_id` informado, grava `cliente_vinculo_id` na tarefa e copia o polo escolhido para
  `processos.polo_passivo` (sem sobrescrever um valor já preenchido) — tudo na mesma transação.
  A transação agora também trava a linha da tarefa (`SELECT ... FOR UPDATE`) e reconfirma o status
  dentro dela, para que um duplo clique nunca crie dois processos. Auditoria passou a registrar
  `cliente_vinculo_id` e `polo_passivo` usados.
- Frontend (`am-plataforma-web/src/app/(dashboard)/tarefas/page.js`): o card de tarefas de
  protocolo (`tipo='protocolar'`) ganhou o bloco **CONTRA**, com três estados — polo resolvido,
  "polo a confirmar" com a lista de vínculos quando há 2+, ou alerta "polo não informado" com
  atalho para completar o vínculo no cadastro do cliente. O modal de conclusão só lista/exige
  seleção de vínculos **ativos** (antes contava também vínculos inativos) e o botão de submissão
  passou a mostrar "Registrando protocolo..." durante a requisição.
- Testes: `src/utils/vinculos.test.js` (novo) cobre único vínculo, nenhum vínculo e múltiplos
  vínculos ativos. Suíte completa do backend: **58/58**. A query agregada foi validada
  diretamente contra o banco de produção (leitura), e a migração aditiva da coluna foi aplicada
  e confirmada sem erros. Não foi possível validar o endpoint via HTTP fim a fim nesta sessão sem
  resetar a senha de um usuário real — evitado por ser uma ação irreversível sobre uma conta de
  produção; a validação ficou nos níveis de SQL direto e suíte automatizada.
- Pendente para quem continuar: testes de frontend (responsividade, teclado, contraste) e o menu
  de ações secundárias (`⋯` com abrir cliente/contrato, observação, cancelar) não foram
  implementados nesta sessão — o cancelamento já existia como botão próprio com justificativa
  obrigatória e foi mantido como está.

### 19/09/2026 (tarde) — Ciclos recorrentes separados da fila de protocolo inicial

- Diagnóstico: 159 das 171 tarefas em "Protocolar inicial" eram ciclos de FGTS remanescente
  (cron `src/services/ciclosRecorrentes.js`, intervalo 25 meses), todas criadas em 19/09, sem
  responsável/prazo. A migração de boot que marca `precisa_triagem` em protocolos com processo
  anterior as quarentenava (158/159) com o rótulo errado "CONFERIR CONTRATAÇÃO". O texto
  "Período a solicitar" usava `ref → ref+24 meses` (janela futura, 2027/2028) em 84 delas.
- Modelo novo: `tarefas.subtipo='ciclo'` (pendente de aceite) → `'ciclo_aceito'` (virou
  protocolo). `tarefas.ciclo_inicio DATE` (mês seguinte ao `periodo_fim` do último processo;
  sem processo, `clientes.vinculo_inicio`), `tarefas.ciclo_adiado_ate DATE`. O período acumulado
  é sempre `ciclo_inicio → mês atual`; `ciclo_meses` calculado no `GET /api/tarefas`.
- Backfill de boot (aditivo, idempotente): as 159 recebem `subtipo='ciclo'`,
  `precisa_triagem=false`, `ciclo_inicio` e descrição "Novo ciclo — TESE — NOME". A migração
  de triagem passa a ignorar tarefas com `ciclo_inicio`. A antiga reescrita de "Período a
  solicitar" foi removida do boot.
- Filas: `NAO_CICLO` exclui `subtipo='ciclo'` de minha/equipe/protocolar_inicial/protocolos/
  triagem (GET, resumo e resumo-teses). Nova fila `ciclos` (só Master na UI), ordenada por
  `ciclo_inicio` (mais atrasado primeiro), respeitando `ciclo_adiado_ate`. `resumo.ciclos` novo.
- Endpoints (Master): `PATCH /api/tarefas/:id/ciclo/aceitar` {atribuido_a, prazo_data} —
  vira `ciclo_aceito`, urgência ALTO, auto-vínculo único, entra em Protocolar inicial;
  `PATCH /api/tarefas/:id/ciclo/adiar` {adiar_ate, justificativa}. Descartar = cancelar com
  justificativa (rota existente). O cron não recria um ciclo cancelado com o mesmo
  `ciclo_inicio` (dedup considera `ciclo_inicio` além de status aberto).
- Frontend: aba "🔁 Novos ciclos" + card no cockpit; card do ciclo com badge NOVO CICLO,
  "PERÍODO ACUMULADO · MM/AAAA → MM/AAAA (N meses)", CONTRA, ações Aceitar ciclo / Adiar /
  Descartar; modal de aceite exige responsável + prazo. Tarefas `ciclo_aceito` seguem
  mostrando o período acumulado no card de protocolo.
- Pendente (item D da análise): polo passivo dos vínculos ainda é texto livre — 4 nomes fora
  do catálogo `polos_passivos` (ESTADO PERNANBUCO, ESTADO PARAIBA, Governo de Pernambuco,
  MUNICIPIO DE NATAL) e 6 nulos.
- `GET /api/tarefas/ciclos/previsao?meses=3|6|12|24` (Master): projeção calculada (sem criar
  tarefa) dos ciclos que vencem na janela — mesma regra do cron, excluindo quem já tem tarefa
  de protocolo aberta ou processo cobrindo o período — mais a lista de ciclos adiados com a
  data de retorno. Exibida no topo da aba "Novos ciclos" (seção "Próximos ciclos a vencer").
  Em 19/09/2026: 6 vencem em 3 meses, 15 em 6, 39 em 12, 196 em 24.

### 19/09/2026 (noite) — Ciclo entra automaticamente como RE-PROTOCOLO + restauração

- **Restauração**: 204 tarefas de ciclo canceladas por engano antes de existir a fila "Novos
  ciclos" (justificativas majoritariamente "ERRO") foram restauradas via migração idempotente
  em `index.js`: só quando o vínculo do cliente segue ativo, não há outra tarefa de protocolo já
  aberta pro mesmo cliente_produto e nenhum processo cobre o período recalculado. Descartou
  duplicatas históricas (19 grupos, ficou a mais recente de cada — o índice único
  `uq_tarefa_protocolo_ativa` barra 2 tarefas 'protocolar' ativas pro mesmo par). Registrado em
  `logs_auditoria` (usuário "Integração Claude"). Rodado e commitado em produção: 204 restauradas.
- **RE-PROTOCOLO automático**: `produtos.responsavel_reprotocolo_id` e
  `produtos.prazo_reprotocolo_dias_uteis` (default 10) novos, editáveis via `PATCH /api/produtos/:id`.
  O cron (`ciclosRecorrentes.js`) só entra direto em Protocolar inicial (`subtipo='ciclo_aceito'`,
  sem passar por "Aceitar ciclo") quando: existe processo anterior real (é de fato continuação),
  o polo é resolvido sem ambiguidade (vínculo único ativo, ou `clientes.polo_passivo`) e há um
  responsável ativo (1º a configuração da tese, 2º fallback o `master_responsavel_id` do processo
  anterior). Sem alguma dessas condições, cai como sempre em "Novos ciclos". Urgência ALTO, prazo
  por `somarDiasUteis`. Não se aplica retroativamente ao backlog (as 159+204 continuam manuais).
- Badge **RE-PROTOCOLO** (com marca "AUTOMÁTICO" quando `validado_por` é nulo) substitui
  "PROTOCOLO INICIAL" no card sempre que `t.ciclo_inicio` existe e a tarefa não está mais em
  `subtipo='ciclo'` — vale tanto pro aceite manual quanto pro automático.
- `PATCH /api/tarefas/:id/ciclo/devolver` (Master): desfaz um re-protocolo ainda não protocolado
  e volta pra "Novos ciclos"; botão "Devolver p/ ciclos" no card.
- `PATCH /api/tarefas/ciclos/aceitar-lote` (Master): aceita vários ciclos pendentes de uma vez com
  um responsável e prazos escalonados por semana (do `ciclo_inicio` mais antigo pro mais recente,
  N por semana configurável) em vez de despejar todo o backlog na mesma data. Barra roxa própria
  na aba "Novos ciclos" quando há seleção, reaproveitando o checkbox de seleção já existente.

### 19/09/2026 (noite, cont.) — Fila própria para Re-protocolo

- Nova fila `reprotocolo`: `tipo='protocolar' AND processo_id IS NULL AND ciclo_inicio IS NOT NULL
  AND subtipo<>'ciclo'` — ciclo já aceito (manual, em lote ou automático), pronto pra protocolar.
  `protocolar_inicial` passou a exigir `ciclo_inicio IS NULL`, ficando só com cliente
  genuinamente novo (cadastro pendente ou protocolo sem processo e sem origem em ciclo).
  Verificado contra produção: 11 protocolar_inicial + 1 reprotocolo + 362 novos ciclos = 374,
  bate exato com o total de tarefas 'protocolar' sem processo (sem sobreposição nem lacuna).
  `resumo.reprotocolo` novo; mesmo split espelhado em `/resumo-teses`.
- Frontend: aba "🔁 Re-protocolo" e card no cockpit, visíveis pra todos (não só Master, já que
  quem foi atribuído ao re-protocolo precisa achar a tarefa). Card/badge/ações não mudaram —
  já eram calculados por campo (`ciclo_inicio`), só a fila que lista passou a separar.

### 19-20/09/2026 (noite) — Cadastro manual de cliente novo direto da fila de Tarefas

- Pedido: cadastrar cliente novo (com ou sem lead prévio no Digisac) direto da aba
  "Protocolar inicial · novos clientes", vinculando ao Kanban de Leads quando houver lead.
- **Dois bugs pré-existentes achados e corrigidos em `src/services/onboarding.js`** (já em
  produção desde o commit `3cfccc9` de hoje, sem relação com esta tarefa):
  1. `let cliente = null` era declarado DENTRO do bloco `try` de `criarOnboardingContrato` mas
     lido DEPOIS dele (na sincronização do Drive) — `ReferenceError` em toda chamada
     bem-sucedida, sempre depois da transação já ter commitado. Corrigido: declarado antes do
     `try`. Nenhum onboarding foi perdido (o erro só impedia o Drive de sincronizar e fazia a
     tela mostrar "erro" mesmo com tudo já gravado), mas explica os 5 registros com
     `drive_sync_status='erro'` vistos no banco — 3 deles com `invalid_grant` (credencial do
     Google expirada, problema à parte, não corrigido aqui) e possivelmente mascarando outros.
  2. `criarOnboardingContrato` fazia `String(contactId)` sem tratar `null` — viraria a string
     literal `"null"`, e como `camila_contact_id` é `NOT NULL UNIQUE`, o segundo cadastro sem
     lead sobrescreveria o primeiro via `ON CONFLICT`. Corrigido com um `contactId` sintético
     único (`manual-<uuid>`) gerado dentro da função quando não há lead. `buscarOnboardingPorContato`
     ganhou guarda pra `null`; o retorno final da função passou a buscar por `id` do registro
     (novo helper `buscarOnboardingPorId`), não mais por `contactId` — o método antigo sempre
     devolvia vazio pra cadastros sem lead. Testado de ponta a ponta contra produção (2 cadastros
     seguidos sem lead, IDs diferentes, sem colisão) e limpo depois.
- Nova rota `POST /api/estimativas/onboarding-manual` (Master): mesmo motor de
  `POST /leads/:contactId/desfecho` (chama `criarOnboardingContrato`), sem contactId real e sem
  chamar a Camila — não existe card de lead pra mover quando não há lead.
- Frontend: `FormularioFechamento` (o formulário completo de fechar contrato — produtos,
  honorários, responsáveis, prazos, busca de cliente já existente) foi extraído de
  `(dashboard)/estimativas/page.js` para `src/components/FormularioFechamento.js`, self-contained,
  **sem alterar uma linha da página de Estimativas** (arquivo de 2242 linhas, crítico pra receita
  — risco zero de regressão ali). Reaproveitado agora também em Tarefas.
- Botão **"+ Cadastrar cliente novo"** na aba "Protocolar inicial", com modal de duas entradas:
  **vincular a lead existente** (busca em `GET /api/estimativas/leads?busca=`, mesma API do
  Kanban; ao confirmar chama a rota já existente `/leads/:contactId/desfecho`, que também move o
  card do lead pra "Fechado" no Kanban via Camila automaticamente — nenhuma mudança de backend
  necessária pra isso) ou **cadastro direto sem lead** (campos nome/telefone/cargo/órgão/vínculo,
  chama a rota nova `onboarding-manual`). Sem indicador novo no Dashboard — o cadastro já entra
  nos números existentes (`resumo.protocolar_inicial`, contadores de clientes) como qualquer
  outro onboarding.

### 20/09/2026 — Fase 0 do cronograma de reconciliação executada

- **Luã Henrique Nóbrega Lopes**: confirmado pela equipe que não assinou (a Camila já tinha
  registrado `perdido`). Onboarding `ace6b566` cancelado + as 2 tarefas de protocolo canceladas,
  com justificativa e auditoria. A tarefa de cadastro (já concluída antes) foi preservada.
- **9 clientes fechados na Camila entre 21/08 e 08/09/2026 sem nenhum registro no AM** (achado
  do cruzamento AM×Camila, ver `ANALISE-ESTIMATIVA-A-CONTRATO-AM-2026-09-20.md`) — cadastrados
  via `criarOnboardingContrato` direto (mesmo motor da tela "+ Cadastrar cliente novo → vincular
  lead"), tese FGTS, honorários 45% (decisão do usuário), responsável de cadastro e protocolo
  João Gomes, período convertido de `MM/AAAA` (formato da Camila) para `AAAA-MM` manualmente
  (a conversão automática do sistema ainda não faz isso — ver achado 1 da análise). Todos os 9
  nasceram `cadastro_pendente`, com "Completar cadastro" e "Protocolar processo — FGTS" para
  João. Nomes: Aberlandio dos Santos, Walber dos Santos Gomes, Evandro Arruda Silva Junior,
  Edson Henrique, Edson Lima, Vinícius Felix dos Santos, Jairo Janailton Alves dos Santos,
  Gilcelia Telma de Holanda, Iradira Juvino Pereira da Silva.
- **Não corrigido** (decisão explícita: só editar pra frente, não mexer no histórico): 4 desses
  9 têm `valor_fechado` com erro de vírgula/ponto na Camila (ex: `540614` em vez de algo como
  `5.406,14`) — o valor foi herdado como está nos onboardings novos; correção de dado histórico
  fica para decisão futura, e a correção da validação de entrada (pra não acontecer de novo)
  é item pendente da Fase 1/2 do cronograma, não implementada ainda.
- Cronograma completo: `CRONOGRAMA-EXECUCAO-AM-2026-09-20.md` (fora do repositório, pasta de
  análise). Fases 1-7 seguem pendentes.

### 20/09/2026 — Fase 1 do cronograma (integridade imediata) — parcial

- **CNJ de outro atendimento não é mais reaproveitado** (`tarefas.js`, `concluir-com-numero`):
  ao encontrar um processo já cadastrado com o mesmo número, agora só reutiliza o ID se for
  do MESMO cliente e da MESMA tese; caso contrário, 409 "já está cadastrado para outro
  cliente ou outra tese". Testado contra dado real (processo + tarefa de clientes diferentes).
- **Tribunal resolvido pela tabela oficial do CNJ** (novo `src/utils/cnj.js`,
  `resolverTribunalCnj`): os 27 TJs (Res. CNJ 65/2008) e os 6 TRFs, não mais só
  TJPB/TRF5 com tudo mais caindo em TJPB por padrão. Combinação não reconhecida → 400 pedindo
  conferência do número, em vez de inventar destino.
- **Reatribuir tarefa de cadastro/protocolo agora sincroniza o responsável no onboarding**
  (`PATCH /:id/responsavel` e `/lote`): sem isso, quem recebia a tarefa não conseguia abrir o
  cadastro nem concluir o protocolo (a autorização em `onboardings.js`/`onboarding.js` olha
  `responsavel_cadastro_id`/`responsavel_protocolo_id`, não `tarefas.atribuido_a`).
- **`bloqueada → pendente` na rota genérica de status exige `cliente_id` preenchido** — antes
  liberava a tarefa mesmo sem cadastro nenhum por trás; agora espelha a condição real que o
  desbloqueio automático usa.
- **`cancelarOnboardingPendente` agora é atômico e revalida sob trava** (`SELECT...FOR UPDATE`)
  — antes eram 2 UPDATEs soltos, sem proteção contra corrida com o cadastro sendo concluído
  ao mesmo tempo.
- **Não feito nesta passada** (ficam pendentes do cronograma): 1.3 (identificador estável/
  idempotência de criação de contrato manual/lead — precisa de decisão de produto, não só
  código) e 1.7 (adoção de tarefa existente comparar vínculo/período, não só
  `cliente_produto_id` — está entrelaçado com a lógica de ciclo/re-protocolo já em produção,
  fica pra tratar junto da Fase 4, modelo de demanda).

### 20-21/09/2026 — Fase 3 do cronograma (comando único de desfecho) — parcial

- `src/services/camila.js` (novo): extraído o cliente HTTP da Camila de `estimativas.js` pra
  ser reaproveitado por outros pontos (ex: um futuro worker de reprocessamento).
- **`perdido` bloqueado com onboarding ativo** (`POST /leads/:contactId/desfecho`): antes de
  encaminhar `perdido` pra Camila, checa se há onboarding não-cancelado no AM; se houver, 409
  pedindo pra cancelar o onboarding primeiro. É exatamente o caso do Luã Henrique (19-20/09).
- **Desfazer fechamento reordenado** (`DELETE /leads/:contactId/desfecho`): cancela o
  onboarding local **antes** de avisar a Camila (era o contrário) — se a Camila falhar depois,
  o pior cenário agora é ela ficar temporariamente desatualizada, nunca o oposto (ela reabordar
  um cliente cujo onboarding no AM continua ativo).
- **`etapa_no_fechamento`** nova coluna em `onboardings_contrato`, preenchida com a etapa do
  lead no funil da Camila no momento da ativação (`lead.etapa`, ex: 'assinado',
  'documentos_completos'...) — permite distinguir depois quantos contratos foram ativados após
  assinatura confirmada vs. direto de outra etapa. Testado de ponta a ponta contra produção.
- **Não feito nesta passada**: 3.3 (fila BullMQ de reprocessamento automático de
  `camila_sync_status='erro'`) e 3.4 (badge/botão de sincronizar de novo na tela) — ficam pra
  uma próxima sessão; 3.5 (data de assinatura obrigatória + campo de evidência ao marcar
  "assinado") não foi implementado — mexe em `ContinuidadeCamila.jsx` na Camila e precisa de
  decisão de produto sobre o formato da evidência (link vs. upload).

### 21/09/2026 — Fase 3.3/3.4 (retry de sincronização com a Camila)

- Novo `src/services/reprocessarSyncCamila.js`: `reprocessarSincronizacaoCamila()` (roda a cada
  15 min via BullMQ, job `reprocessar-sync-camila` no worker `alertas`) reprocessa todo
  onboarding com `camila_sync_status='erro'`, exceto cadastros manuais (`camila_contact_id`
  começando com `manual-`, que não têm lead nenhum na Camila pra sincronizar).
  `sincronizarOnboardingComCamila(id)` é a versão de um só, usada pelo botão manual.
- `POST /api/estimativas/onboardings/:id/sincronizar-camila` (Master): botão "Sincronizar de
  novo" na tela de Leads, visível só quando `camila_sync_status='erro'` — ao lado de um badge
  vermelho "NÃO SINCRONIZADO COM A CAMILA".
- Testado de ponta a ponta contra produção: forcei `camila_sync_status='erro'` num onboarding
  real (Francisco Acioly), chamei a sincronização manual, confirmou volta pra 'sincronizado' e
  o `registrado_em` do lado da Camila ficou intacto (a chamada é idempotente — reconfirma
  'fechado', não duplica nem reseta a data).

### 21/09/2026 — Fase 1.3 (idempotência de criação de contrato)

- Nova coluna `onboardings_contrato.operacao_id UUID` (índice único parcial, permite múltiplos
  NULL) — identificador gerado uma vez pelo formulário (`FormularioFechamento.js`,
  `crypto.randomUUID()` por montagem) e reenviado em toda tentativa da mesma sessão de
  fechamento. Fecha a lacuna que o dedupe por `camila_contact_id` não cobria: cadastro manual
  sem lead gera um `contactId` sintético novo a cada chamada, então repetir depois de um
  timeout criava um segundo onboarding — agora `criarOnboardingContrato` devolve o registro já
  existente quando a `operacao_id` bate, antes mesmo de gerar um novo `contactId`.
  `operacao_id` inválido (não-UUID) retorna 400, não erro cru do Postgres.
  Testado de ponta a ponta contra produção: 2 chamadas com a mesma `operacao_id` → mesma linha;
  só 1 registro no banco; limpo depois.

### 21/09/2026 — Correção dos 4 valores com erro de vírgula (item "fora do cronograma")

- Corrigidos `onboardings_contrato.valor_fechado` (AM) e `leads_desfecho.valor_fechado`
  (Camila) dos 4 clientes cadastrados em 20/09 que tinham valor sem separador decimal:
  Vinícius Felix dos Santos (540614→5406.14), Jairo Janailton Alves dos Santos
  (915246→9152.46), Gilcelia Telma de Holanda (1155459→11554.59), Iradira Juvino Pereira da
  Silva (429256→4292.56). Autorizado pelo usuário — não é "editar o passado", é corrigir dado
  que tinha acabado de entrar num cadastro novo. Cada UPDATE foi guardado por
  `WHERE valor_fechado > 100000` + checagem de `rowCount` exato antes do COMMIT.

### 21/09/2026 — Camila: correção do bug de retry de sincronização apagando quem fechou

- Achado real de um agente revisor auditando (já em produção) o commit da Fase 3.3/3.4 (retry
  automático de sincronização com a Camila a cada 15 min): `registrarDesfecho()` (Camila,
  `leads.js`) usava um `ON CONFLICT (contact_id) DO UPDATE` incondicional — reenviar o MESMO
  desfecho (o próprio retry, reconfirmando um contrato já fechado) sobrescrevia
  `registrado_por`/`valor_fechado`/`motivo`/`telefone` com os dados da tentativa de retry,
  apagando o registro de quem realmente fechou o contrato. Só `registrado_em` tinha proteção
  condicional.
- Corrigido na raiz: o `UPDATE` agora só acontece quando o desfecho de fato muda
  (`WHERE leads_desfecho.desfecho IS DISTINCT FROM EXCLUDED.desfecho` no `ON CONFLICT`), e o
  evento `lead_fechado`/`lead_perdido` só dispara quando há mudança real (`rowCount > 0`) — uma
  reconfirmação por retry não gera evento nem toca a linha.
  Testado: TESTE 9 novo em `teste-leads.js`, suíte completa (`test:safe` 14/14,
  `test:continuidade` 207/207), revisão por agente com teste ao vivo contra produção (insere,
  retry com dados diferentes não muda nada, mudança real de desfecho atualiza tudo — limpo
  depois). Commit `230fe18` no repositório da Camila, deployado e confirmado rodando
  (`/health` 200).

### 21/09/2026 — Fase 1.7 (adoção de tarefa de protocolo por vínculo, não só produto)

- `criarOnboardingContrato` "adotava" (sobrescrevia) qualquer tarefa `protocolar` aberta para o
  mesmo `cliente_produto_id`, sem checar a qual vínculo/fechamento ela pertencia. Um índice
  único antigo em produção, `uq_tarefa_protocolo_ativa (cliente_produto_id, tipo)` — criado por
  um script `migrate.js` avulso, fora das migrações automáticas do `src/index.js` — reforçava
  isso no banco: no máximo 1 tarefa `protocolar` ativa por produto, sem noção de vínculo. Com 2
  vínculos elegíveis ao mesmo produto (ex.: 2 empregadores com FGTS), um 2º fechamento nem
  conseguia criar sua própria tarefa — o `INSERT` caía num `ON CONFLICT DO NOTHING` silencioso e
  o protocolo do 2º vínculo desaparecia sem erro nenhum. Reproduzido ao vivo antes da correção.
- Índice trocado por `uq_tarefa_protocolo_ativa_vinculo (cliente_produto_id, tipo,
  cliente_vinculo_id)` — como o Postgres nunca considera dois `NULL` iguais num índice único,
  isso continua bloqueando duplicata exata quando o vínculo já é conhecido e passa a permitir
  tarefas distintas quando o vínculo ainda é ambíguo (0 ou 2+ vínculos ativos). Relaxação pura,
  sem risco de dado existente violar a troca.
- `criarOnboardingContrato`: só adota uma tarefa que já pertence a ESTE onboarding (retry do
  mesmo fechamento) ou que ainda não foi reivindicada por nenhum onboarding — nunca mais
  sequestra a tarefa de um fechamento diferente.
- `concluirCadastroOnboarding` (achado do próprio agente revisor do commit acima, mesma classe
  de risco exposta pela relaxação do índice): a busca de tarefa "legado" pra fundir também
  passou a checar vínculo — vínculo confirmado igual sempre funde (mesma demanda); vínculo
  confirmado diferente nunca funde; vínculo ainda ambíguo só funde se esta conclusão não tiver
  tarefa própria em disputa (nada a perder).
- Testado ao vivo contra produção nos dois pontos (cliente de teste com 2 vínculos ativos, 2
  fechamentos/conclusões distintas pro mesmo produto — antes: 2ª tarefa sumia ou 1ª era
  sequestrada; depois: as duas coexistem, cada uma presa ao seu próprio onboarding), incluindo
  os 3 ramos do guard de `concluirCadastroOnboarding` (igual/divergente/ambíguo). Limpeza
  confirmada em todos os testes. `npm test`: 58/58. Commits `01c109d` e `41af708`, deployados e
  confirmados `RUNNING` no Railway.

### 21/09/2026 (noite) — Fase 4, fatia 1 (tabela `demandas`)

- Nova tabela `demandas (cliente_id, produto_id, cliente_vinculo_id, periodo_inicio,
  periodo_fim, status, processo_id)` — passa a ser a identidade explícita da demanda jurídica
  por trás de uma tarefa de protocolo, em vez de inferida por convenção a partir de campos
  espalhados na própria tarefa (`cliente_produto_id`/`cliente_vinculo_id`/`ciclo_inicio`). Base
  da Fase 5 (ficha única); evita remendar, um por um, cada ponto que hoje decide "essa tarefa é
  a mesma demanda de outra?" — como a Fase 1.7 teve que fazer em 2 lugares diferentes.
- Índice único `uq_demandas_identidade` usa a mesma lógica da Fase 1.7 (NULL nunca é igual a
  NULL num índice único do Postgres): bloqueia duplicata exata só quando vínculo e período já
  são conhecidos; demandas com vínculo ambíguo ficam isoladas, nunca fundidas por engano.
  Coluna `tarefas.demanda_id` + backfill idempotente (processado tarefa por tarefa, não em lote
  via SQL, pra não colapsar 2 tarefas de vínculo ambíguo na mesma demanda). Aplicado em
  produção: 372 tarefas vinculadas, 0 pendentes ao final, spot-check sem divergências.
- Novo helper compartilhado `src/utils/demandas.js` (`resolverDemanda`) — usado por
  `criarOnboardingContrato`, que agora grava `demanda_id` em toda tarefa 'protocolar' que cria
  ou adota.
- Achado ao testar: a checagem de adoção da Fase 1.7 (`onboarding_id IS NULL OR
  onboarding_id=$2`) era estrita demais — quando o vínculo de um 2º fechamento era CONFIRMADO
  IGUAL ao de uma tarefa de OUTRO onboarding, ela não era mais adotada por pertencer a outro
  onboarding_id, e a nova tarefa batia no índice único (produto+vínculo) e sumia num
  `ON CONFLICT DO NOTHING` silencioso — o mesmo tipo de perda que a Fase 1.7 existe pra evitar,
  disfarçado atrás de uma condição mais rara. Corrigido: a adoção agora também aceita uma
  tarefa de outro onboarding quando o vínculo bate de fato.
- Testado ao vivo contra produção: vínculo ambíguo entre 2 onboardings continua gerando 2
  tarefas distintas (não regrediu); vínculo confirmado igual entre 2 onboardings agora funde
  corretamente na mesma tarefa e mesma demanda; vínculo confirmado diferente nunca funde
  (testado por um agente revisor com cenário próprio). Limpeza confirmada em todos os testes.
  `npm test`: 58/58. Commit `b7f4b79`, deployado e confirmado `RUNNING` no Railway.
- Pendente pra continuar a Fase 4/5: ligar `demanda_id` também em `concluirCadastroOnboarding`
  e em `ciclosRecorrentes.js`; preencher `periodo_inicio`/`periodo_fim` de verdade (hoje sempre
  `NULL` nas demandas criadas por `criarOnboardingContrato`); e só então construir a ficha
  única (Fase 5) sobre `demandas` em vez de inferir tudo via `tarefas`.

### 21/09/2026 (madrugada) — Fase 4 continuação: demanda_id nos 2 pontos restantes

- `concluirCadastroOnboarding` (cliente só é conhecido aqui, no cadastro manual sem lead
  prévio se completando) e `ciclosRecorrentes.js` (cron diário de re-protocolo recorrente,
  ex.: FGTS a cada 25 meses) agora resolvem/criam `demanda_id` também — os 2 pontos que
  `criarOnboardingContrato` (fatia 1) tinha deixado de fora. `ciclosRecorrentes.js` é o
  primeiro lugar onde uma demanda nasce com `periodo_inicio` de verdade (o próprio início do
  ciclo acumulado), em vez de `NULL`.
- Achado do agente revisor, corrigido no mesmo commit: em `concluirCadastroOnboarding`, a
  resolução da demanda rodava ANTES de saber se algum dos 2 ramos (fundir com legado / manter
  a tarefa própria) ia de fato disparar — se nenhum disparasse, a demanda ficava órfã (sem
  nenhuma tarefa apontando pra ela, "aberta" pra sempre, invisível pra Fase 5). Movida pra
  dentro de cada ramo, só resolvida quando de fato vai ser usada.
- **Gap conhecido, registrado aqui a pedido do próprio revisor** (a mensagem do commit
  anterior dizia que isso já estava documentado, e não estava): `ciclosRecorrentes.js` ainda
  só considera os campos legados de vínculo único em `clientes` (`cargo`/`orgao`/
  `vinculo_inicio`/`polo_passivo`), não a tabela `cliente_vinculos` — não é vínculo-aware pra
  clientes com 2+ vínculos. É um gap maior, de escopo próprio, não corrigido nesta sessão.
- Testado ao vivo contra produção (cliente novo em `concluirCadastroOnboarding`; e
  `verificarCiclosRecorrentes()` rodado de ponta a ponta sobre a base real com 1 cliente de
  teste elegível — demanda criada com `periodo_inicio` batendo exatamente com `ciclo_inicio`
  da tarefa). Limpeza confirmada, incluindo auditoria de possíveis resíduos de execuções
  anteriores (0 encontrados). `npm test`: 58/58.

### 21/09/2026 (madrugada, cont.) — cadeia de correções: demandas órfãs

- Padrão de bug encontrado e corrigido 4 vezes seguidas, em cadeia de revisão por agentes, nos
  2 únicos pontos que criam/adotam tarefa 'protocolar' com `demanda_id`
  (`criarOnboardingContrato` e `concluirCadastroOnboarding`, ambos em `onboarding.js`):
  `resolverDemanda()` era chamada incondicionalmente, e o `UPDATE ... SET
  demanda_id=COALESCE(demanda_id,$N)` descartava silenciosamente a demanda recém-criada sempre
  que a tarefa alvo já tinha uma demanda de identidade diferente (ex.: vínculo que era
  ambíguo quando a tarefa nasceu e virou confirmado depois) — a nova ficava órfã pra sempre
  (`status='aberta'`, nenhuma tarefa apontando pra ela, invisível pra Fase 5).
- Corrigido nos 2 pontos: só resolve/cria uma demanda nova quando a tarefa alvo AINDA não tem
  `demanda_id` (`tarefaAdotada?.demanda_id || resolverDemanda(...)` /
  `legado.demanda_id || resolverDemanda(...)` / `onboardingTask.demanda_id ||
  resolverDemanda(...)`). Reproduzido ao vivo antes de cada correção (órfã real criada e
  confirmada), e re-testado depois (0 órfãs). Auditoria final de todo o banco
  (`demandas` sem nenhuma `tarefa.demanda_id` apontando pra ela): **0**. `npm test`: 58/58 em
  cada etapa. Commits `904e3a4`, `72b07cd`, `d7e81a5`, `65fcb44` — todos deployados e
  confirmados `RUNNING` no Railway.
- Melhoria estrutural sugerida por um dos agentes revisores, não bloqueante, pra considerar
  antes do próximo call-site que toque `demanda_id`: mover essa checagem "só resolve se ainda
  não tem" pra dentro do próprio `resolverDemanda()` (ou um `vincularDemanda(tarefaId, ...)`
  único), em vez de replicar o padrão em cada ponto novo.

### 21/09/2026 (manhã) — Vínculo encerrado não bloqueia mais elegibilidade de ciclo recorrente

- Achado do mesmo padrão de dinheiro deixado na mesa: `ciclosRecorrentes.js` (cron diário de
  re-protocolo) e o painel `/ciclos/previsao` excluíam da varredura QUALQUER cliente com
  `vinculo_ativo=false`, mesmo quando havia período acumulado ANTES do desligamento ainda não
  cobrado — uma cobrança real e legítima ficava invisível pra sempre só porque o cliente já não
  trabalha mais lá.
- Corrigido como "warn, não block": vínculo encerrado com `vinculo_fim` registrado agora entra
  na varredura, mas só até o período que começou antes do desligamento
  (`cicloInicio <= vinculo_fim` — depois disso não há mais nada pendente, corretamente
  ignorado, não é ambiguidade). E nunca entra sozinho direto em "Protocolar inicial"
  (auto-aceito) mesmo com polo e responsável resolvidos — sempre cai em "Novos ciclos" com a
  descrição marcada "(vínculo encerrado — revisar período)", pra passar por um humano antes
  (pode ser a última cobrança antes de encerrar o relacionamento). Painel de previsão alinhado
  com a mesma regra.
- Testado ao vivo contra produção (2x, pelo implementador e por um agente revisor com CPFs
  diferentes), cobrindo os 3 cenários: período pendente real → tarefa criada pra revisão;
  já totalmente coberto → nada criado (correto); processo anterior + polo/responsável
  resolvíveis mas vínculo encerrado → **não** auto-aceita (o cenário mais arriscado, confirmado
  não regredir o comportamento de vínculo ativo). Limpeza confirmada nos dois testes.
  `npm test`: 58/58. Commit `9064fef`, deployado e confirmado `RUNNING`.
- Achados não-bloqueantes registrados pelos revisores, pendentes de decisão: (a)
  `elegibilidade.js::verificarElegibilidadeProduto` tem o mesmo hard-filter mas é **código
  morto** hoje (não é chamada por nenhuma rota) — candidato a remoção ou religação futura;
  (b) a migração de restauração de ciclos cancelados (`src/index.js`, evento de 19/09/2026)
  também tem `vinculo_ativo=true` hard-coded, mas é script de backfill histórico de escopo
  bem mais estreito, não tocado.
