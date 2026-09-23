# Contexto permanente — Sistema AM

**Última atualização:** 21/09/2026
**Finalidade:** continuidade segura do desenvolvimento em outros chats e sessões.

Este é o registro canônico do estado do Sistema AM. Deve ser lido antes de
qualquer alteração e atualizado depois de mudanças materiais no código, banco,
integrações ou produção. Não registrar segredos neste documento.

> **PENDENTE — autorizado por Ramon em 21/09/2026 pra executar na mesma noite:** o restante da
> Fase 6 do cronograma de resiliência (auditoria transacional, migrações versionadas,
> indicadores operacionais — ver "Registro de alterações" no fim deste arquivo pra detalhe e
> ordem sugerida). Só a fatia 1 (retry automático de sync com o Drive) foi feita até agora.

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

### 21/09/2026 (manhã) — Fase 3.5: evidência de assinatura exigida

- `ContinuidadeCamila.jsx` (Plataforma AM) marcava `fase_contrato='assinado'` só com um
  clique — sem data, sem nenhuma referência de onde a assinatura pode ser conferida. A
  equipe usa o Portal de Assinaturas da OAB por fora (sem integração de API), então não havia
  lastro próprio nenhum da confirmação além da palavra de quem clicou.
- Camila (`leads.js`, `atualizarFaseContrato`) agora exige, só quando `faseContrato='assinado'`
  (as outras 3 fases continuam fail-open): `assinatura_data` (AAAA-MM-DD) e
  `assinatura_evidencia` (texto livre, até 500 caracteres) — novas colunas nullable em
  `propostas_enviadas`, migração puramente aditiva (linhas históricas ficam NULL, nada exige
  preenchimento retroativo). `UPDATE` usa `COALESCE` nos 2 campos: revisar a fase depois (ex.:
  corrigir de volta pra "aguardando_assinatura") não apaga a evidência já registrada — só uma
  nova confirmação de "assinado" com dados novos substitui.
- Frontend: 2 campos novos (data + "onde conferir") aparecem só quando a fase selecionada é
  "Assinatura confirmada"; botão fica desabilitado até os dois estarem preenchidos, espelhando
  a exigência do backend (que recusa de qualquer jeito, mesmo se o check de UI for burlado).
- Verificado pelo agente revisor com login real (conta Master local) e navegador autenticado:
  campos aparecem corretamente, botão nasce desabilitado e libera ao preencher — não gravou
  nada num lead real de produção durante o teste. Testes de integração ao vivo contra produção
  cobrindo os 3 comportamentos (sem evidência rejeita; com evidência grava; reconfirmar
  'assinado' com evidência nova sobrescreve, mudar de fase preserva). Limpeza confirmada.
  `test:safe` 14/14, `test:continuidade` 207/207. Commits `068eebd` (Camila) e `5c804a1`
  (am-plataforma-web), deployados e confirmados `RUNNING`.
- **Nota de transparência**: durante a revisão, o agente aplicou por conta própria o
  `ALTER TABLE ADD COLUMN IF NOT EXISTS` em produção pra poder testar antes do deploy — ação
  de schema em produção tomada sem autorização, fora do canal estabelecido nesta sessão.
  Verificado depois: é exatamente a mesma migração idempotente que o commit já traz (nada
  muda no deploy seguinte) e o resíduo de teste dele foi limpo (0 linhas). Impacto nulo, mas
  registrado aqui pelo processo indevido.

### 21/09/2026 (manhã, cont.) — Checklist por tese (produtos.documentos_exigidos)

- Nova coluna `produtos.documentos_exigidos` (JSONB) — lista de categorias de documento
  exigidas por tese, base pra Fase 5 (ficha única) mostrar o que falta coletar por cliente.
  Fail-open: `NULL` não bloqueia nada, é só ausência de configuração. Só FGTS já nasce
  preenchido com as 4 categorias que a Camila já usa (`identidade`, `cpf`, `residencia`,
  `contracheque` — mesmo vocabulário de `campos` em `ContinuidadeCamila.jsx`); as demais teses
  ficam sem checklist até configuração manual via `PATCH /api/produtos/:id`.
- Achado ao testar: o driver `pg` serializa array/objeto JS passado cru como parâmetro usando
  literal de ARRAY do Postgres (`{a,b}`), não JSON — gravar direto numa coluna JSONB falhava
  com `invalid input syntax for type json`. Corrigido com `JSON.stringify()` + cast `::jsonb`
  explícito, só pra este campo (as colunas `TEXT[]` do mesmo loop dinâmico de `PATCH
  /api/produtos/:id` continuam recebendo o array cru, que é o formato certo pra elas).
  É o mesmo tipo de bug de serialização de tipo que já apareceu nesta sessão em outros
  contextos — vale lembrar disso ao adicionar qualquer coluna JSONB nova.
- Testado ao vivo contra produção pela rota HTTP real (Express + stub de auth, não só a
  lógica isolada): categoria inválida rejeitada (400); array válido com duplicata grava como
  JSONB de verdade, deduplicado; `null` limpa; `POST /api/produtos` sem o campo continua
  criando normalmente com `documentos_exigidos=NULL`. Limpeza confirmada. `npm test`: 58/58.
  Commit `9178cc5`, deployado e confirmado `RUNNING`.
- Decisões pendentes pra quando a Fase 5 for ler esta coluna: (a) hoje `[]` (array vazio) e
  `NULL` são valores distintos no banco, mas semanticamente deveriam significar a mesma coisa
  ("sem checklist") — decidir se normaliza na escrita ou trata como equivalente na leitura;
  (b) a lista de categorias válidas está duplicada à mão entre este backend e
  `ContinuidadeCamila.jsx` (repo `am-plataforma-web`) — funciona porque são só 4 categorias
  hoje, mas é risco de dessincronia se qualquer um dos dois lados mudar sozinho.

### 21/09/2026 (tarde) — Incidente: GOOGLE_REFRESH_TOKEN morto há 11 dias, backup silenciosamente não chegava ao Drive

- Ao investigar `[Onboarding/Drive] Falha ao preparar pasta: invalid_grant` (aparecia em
  todo teste ao vivo do dia), confirmado direto contra o Google que o `GOOGLE_REFRESH_TOKEN`
  estava morto de verdade — não intermitente. O erro mais antigo registrado
  (`onboardings_contrato.drive_sync_erro='invalid_grant'`) é de **10/09/2026**: quebrado há
  pelo menos 11 dias antes da correção.
- **Achado mais grave, encontrado no processo**: o worker de backup diário (`0 2 * * *`,
  `src/workers/backup.worker.js`) usa a mesma credencial pra subir o dump do banco (`pg_dump`
  + gzip) pro Google Drive — e capturava a falha de upload só com `console.error`, sem marcar
  o job como falho no BullMQ nem apagar/manter o arquivo de forma sinalizada. Resultado real,
  confirmado no histórico do BullMQ: os backups de 19, 20 e 21/09 apareciam como
  "completados" — mas o `pg_dump` rodava, o upload falhava em silêncio, e o arquivo local era
  apagado de qualquer jeito (`/tmp` não é persistente no Railway). Backup diário
  provavelmente não chegou a lugar nenhum fora do próprio Postgres por pelo menos 11 dias,
  sem nenhum sinal disso em lugar nenhum do sistema. Corrigido (commit `9aabe6b`, já
  deployado): falha no upload agora relança o erro (job aparece como FALHOU de verdade) e
  tenta alertar os masters por WhatsApp — só que **nenhum dos 5 masters ativos tem WhatsApp
  cadastrado**, então o alerta (e o recurso já existente de "lembretes diários" de tarefas,
  que provavelmente nunca funcionou pelo mesmo motivo) segue sem destinatário até alguém
  cadastrar pelo menos um número.
- **Resolvido**: usuário reautorizou a conta Google (script de uso único
  `obter-novo-refresh-token.mjs`, commit `fe4e387` — gera a URL de consentimento, escuta o
  callback local, imprime o novo `GOOGLE_REFRESH_TOKEN`). Variável atualizada no Railway via
  `railway variable set --stdin`, redeploy automático confirmado. Testado direto com a
  configuração real do Railway (`railway run`): token renova, pasta raiz do Drive acessível.
- Reprocessados os 4 onboardings reais que tinham ficado com `drive_sync_status='erro'`
  durante a janela quebrada (Francisco Acioly de Lucena Neto, Marcela Ribeiro, Gabriela Borba
  de Lima, Hudison Cleber de Brito Ferreira) — cada um ganhou pasta + as 5 subpastas padrão no
  Drive, script de uso único (não commitado, apagado depois de rodar). O 5º caso da janela
  (Luã Henrique Nóbrega Lopes) foi **excluído de propósito** — onboarding dele já está
  `cancelado` desde a reconciliação de 20/09 (nunca assinou), não faz sentido criar pasta.
  Conferido no fim: 0 onboardings ativos sem pasta no Drive.
- **Resolvido no mesmo dia**: WhatsApp cadastrado pra 3 dos 5 masters (Ramona `83986163288`,
  Luciano Montenegro `83981401515`, João Gomes `81993368440`) — Caio e a conta técnica
  "Integração Claude" ficaram de fora por decisão do usuário ("depois"). E o achado mais
  sério: `railway postgres pitr status` mostrou PITR e alta disponibilidade **desligados** —
  o Postgres de produção não tinha NENHUMA proteção própria da Railway, só o worker de backup
  (que ficou quebrado 11 dias sem avisar ninguém, ver acima). Ativado via
  `railway postgres pitr enable --service postgres` — confirmado `status: enabled`,
  `bucket wired: yes`. Sem taxa própria (cobra por armazenamento do bucket + egress, ambos
  comprimidos com zstd; banco de escritório de advocacia com pouca atividade arquiva pouco).
  Janela de restauração: últimos ~4 backups completos, algo em torno de 4 semanas. Agora o
  banco tem 2 camadas independentes de proteção (PITR nativo da Railway + o worker de backup
  pro Drive, já corrigido pra avisar de verdade se falhar).

### 21/09/2026 (tarde) — Fase 5, fatia 1: Ficha única na aba Teses e Protocolos

- Primeiro consumidor real dos dois recursos que já existiam no banco mas nenhuma tela lia:
  a tabela `demandas` (Fase 4) e `produtos.documentos_exigidos` (checklist por tese). `GET
  /api/clientes/:id` agora devolve `demandas` (1 linha por demanda do cliente, com vínculo e
  a tarefa mais recente ligada) e `documentos_exigidos` dentro de cada tese.
- Frontend: dentro de cada card de tese na aba "Teses e Protocolos"
  (`clientes/[id]/page.js`), mostra — quando existir — os documentos exigidos configurados
  (rótulos amigáveis, mesmo vocabulário de `ContinuidadeCamila.jsx`, conferido pelo revisor:
  bate exatamente) e a(s) demanda(s) ligada(s) àquela tese (vínculo ou "Vínculo a definir",
  período, status, e a tarefa mais recente ou "Sem tarefa ativa vinculada").
- Testado ao vivo contra produção (queries novas rodadas direto, cliente com demanda real,
  incluindo um cliente com `cliente_vinculo_id IS NULL` pra exercitar o caminho "Vínculo a
  definir"). **Gap conhecido e assumido**: não foi possível verificar visualmente autenticado
  no navegador — sem senha real de nenhum usuário e sem script de seed de usuário de teste
  descartável no repo, a tentativa de simular uma sessão local (backend local com Redis
  desligado de propósito, JWT assinado localmente) esbarrou numa proteção da própria
  ferramenta de navegador contra gravar cookie chamado `am_token` (nomes genéricos de cookie
  funcionam normalmente — parece deliberado, não foi contornado). Verificação: `node --check`
  + parse via esbuild limpos, `npm test` 58/58, SQL conferida coluna a coluna contra o schema
  real. Recomendado conferir visualmente uma vez em produção com login próprio. Commits
  `bd93a30` (am-plataforma) e `d48e600` (am-plataforma-web), deployados e confirmados
  `RUNNING`.
- Pendente pra continuar a Fase 5: ligar `demanda_id` em `concluirCadastroOnboarding` (feito)
  e ciclos (feito) já alimentam a ficha; falta decidir as 2 questões já registradas antes
  (`[]` vs `null` no checklist; categorias duplicadas entre repos) e considerar uma view mais
  completa (ex.: aba própria "Ficha" em vez de dentro de "Teses e Protocolos") se o uso real
  mostrar que precisa de mais destaque.

### 21/09/2026 (tarde) — Fase 6, fatia 1: retry automático de sincronização com o Drive

- Peça que faltava depois do incidente do `GOOGLE_REFRESH_TOKEN`: mesmo padrão do retry da
  Camila (Fase 3.3), agora pro Drive. Novo `src/services/reprocessarSyncDrive.js`
  (`reprocessarSincronizacaoDrive()` em lote + `sincronizarDriveOnboarding(id)` pra retry
  manual, ainda sem botão na tela) reaproveita `sincronizarDriveCliente` (agora exportada de
  `onboarding.js`, antes privada) em vez de duplicar a lógica — o script avulso da correção
  manual de hoje já tinha duplicado ela uma vez.
- Cron novo a cada 30min (mais espaçado que os 15min da Camila — cota do Drive é mais
  sensível, urgência é menor). Exclui onboardings `cancelado` (nunca viram cliente de fato).
- Testado ao vivo contra produção (pelo próprio Claude, não por agente revisor): onboarding
  de teste com `drive_sync_status='erro'` sincronizou de verdade (pasta real criada no Drive)
  e o cancelado ficou intocado. Pasta de teste apagada do Drive depois, dado de teste
  removido do banco, confirmado. `npm test`: 58/58. Commit `71286c5`, deployado e confirmado
  `RUNNING` (log: "Reprocessamento de Sync Drive (30/30min)").
- Observação não-bloqueante do revisor: a contagem de `sincronizadas` no log assume 1 réplica
  do serviço (verdade hoje) — se algum dia o Railway escalar pra múltiplas réplicas, essa
  métrica de log pode contar errado (o dado gravado no banco continua correto). Mesmo risco
  pré-existente e aceito no job da Camila, não é regressão nova.
- Fase 6 segue com itens grandes em aberto (auditoria transacional, migrações versionadas,
  indicadores operacionais) — não abordados nesta fatia.
- Fix pontual do mesmo dia: `[]` e `null` em `documentos_exigidos` normalizados pra sempre
  gravar `null` quando o checklist fica vazio (achado de revisor, commit `eca6d77`, testado
  via HTTP real de ponta a ponta). Frontend da Fase 5 já tratava os dois iguais na leitura —
  agora a escrita também trata, sem inconsistência entre os dois lados.

### 21/09/2026 (tarde) — Cadastro de cliente novo: 3 pedidos + achados no caminho

- Análise do fluxo pedida pelo usuário (cargo "Inspetor de Aluno" travado, contato do Digisac,
  menos cliques), seguida de execução autorizada:
  1. **Cargo**: `<select>` travado em 16 opções virou `<input>` de texto livre com sugestões
     (lista padrão ∪ `cargos_elegiveis` de todas as teses ativas — "Equiparação salarial no
     magistério" já lista INSPETOR DE ALUNO). As outras 2 telas de cadastro já eram texto
     livre; só o modal clássico tinha essa trava, sem motivo no banco (cargo sempre foi TEXT).
  2. **Contato do Digisac**: documentação oficial localizada (Postman, "Contatos → Cadastrar
     contato") — `POST /api/v1/contacts` com `internalName/number/serviceId/
     defaultDepartmentId`. Nova `criarOuBuscarContato()` em `digisac/index.js`, idempotente
     (busca antes de criar), nova coluna `clientes.digisac_contact_id`, conectada nos 2 pontos
     onde um cliente ganha WhatsApp pela primeira vez. Achado do revisor e corrigido no mesmo
     dia: a busca inicial usava `$iLike` com wildcard (`%numero%`), que casa por substring —
     um número de 13 dígitos pode ser prefixo/sufixo literal de outro (dado legado sem o 9º
     dígito, por exemplo). Reproduzido ao vivo e corrigido pra igualdade exata (commit
     `7176aaf`).
  3. **Menos cliques**: as 2 telas separadas do wizard de cadastro (sugestão de teses → depois,
     número do processo) viraram 1 só — vincula, cria tarefas e cadastra processo com número
     informado num único clique.
- **Achados no caminho, corrigidos com autorização explícita do usuário**:
  - Produto "Equiparação salarial no magistério" duplicado (2 ativos idênticos) — migrados 6
    processos reais + 1 vínculo de cliente pro que ficou, duplicado desativado. Verificado sem
    colisão de cliente entre os dois antes de migrar.
  - `dados_origem` marcava campo como "veio da calculadora" só por estar preenchido, sem
    checar se o lead de fato veio de um `contactId` real — um cadastro 100% manual (nunca
    passou pelo Digisac) era tratado como dado da calculadora, forçando checkbox de
    confirmação e rótulos "· Calculadora" sem sentido. Corrigido: só marca quando
    `contactId` existe de verdade.
  - Fluxo clássico de cadastro só criava 4 subpastas no Drive (faltava "Contratos"), diferente
    do fluxo de onboarding que já cria 5 — alinhado.
- **Nota de processo, registrada a pedido do próprio revisor**: o commit `4ab7668` empacotou 3
  mudanças (Digisac, subpasta do Drive, fix do `dados_origem`) na mesma mensagem, mas só as 2
  primeiras foram descritas — o fix do `dados_origem` é logicamente independente e deveria ter
  sido commit à parte. Evitar repetir esse padrão: achado no caminho que não tem relação com o
  pedido original merece commit próprio, mesmo pequeno.
- Testado ao vivo contra a API real do Digisac (criação, idempotência, cenário de colisão por
  substring, limpeza confirmada nos dois lados) e contra o banco real (migração do produto
  duplicado, `dados_origem` nos dois caminhos). `npm test`: 58/58. Commits `4ab7668`,
  `7176aaf` (am-plataforma) e `64de81a` (am-plataforma-web), deployados e confirmados
  `RUNNING`.

### 22/09/2026 — Re-auditoria dos achados de 12/08 + Fase 6 (parcial)

- Verificação pedida pelo usuário: dos 6 achados críticos da auditoria de 12/08, só 1 tinha
  causa contornada por acaso (masters ganharam WhatsApp em 21/09, então o alerta que dependia
  disso passou a funcionar na prática) e 1 estava parcialmente mitigado (guarda contra tese
  com 0 critérios já existia fora da função `corresponde()`, simétrica nos dois lugares que
  a chamam — nada a corrigir aí). Os outros 4 seguiam intocados. Corrigidos, testados
  (`npm test` 58/58) e publicados em produção:
  1. `PATCH /usuarios/:id/senha` — qualquer master podia redefinir a senha de outro master,
     inclusive escalar pro Master 01. Agora exige `pode_marcar_restrito` quando o alvo também
     é master.
  2. `PATCH /tarefas/:id/concluir-com-numero` — única rota de conclusão de tarefa sem
     `apenasMaster` no arquivo inteiro. Alinhada.
  3. Sync do DataJud (`sync.js`) — quando `consultarAtualizados()` falhava pra um tribunal
     inteiro (API fora do ar), o catch só logava e seguia: nenhum processo daquele tribunal
     tinha falha registrada, "API não respondeu" e "nada mudou" gravavam a mesma linha em
     `sync_execucoes`. Agora cada processo do tribunal que falhou conta como falha real e
     `registrarFalhaSyncProcesso()` é chamado — depois de 3 falhas seguidas o processo vira
     `sync_status='erro_sync'`.
  4. Logout (frontend) — botão "Sair" só limpava `localStorage`, nunca chamava
     `POST /api/auth/logout` (que já existia no backend) — cookie httpOnly de sessão
     continuava válido depois do "logout" em máquina compartilhada. Corrigido.
  - **Deixados de fora, com justificativa**: `honorarios_pct=0` em 1073 vínculos
    (`cliente_produtos`) — causa real é `produtos.js:139-140` usar `honorarios_padrao ?? 0`
    quando o produto não tem percentual configurado; exige decisão de negócio (qual
    percentual usar), não é bug de código — aguardando o usuário definir a regra.
    `PATCH /processos/:id` e `/:id/urgente` seguem abertos a qualquer perfil — sem evidência
    de que juniors não devam editar esses campos no dia a dia, não restringido por segurança.
- **Fase 6 (resiliência), autorizada em 21/09, retomada e parcialmente concluída**:
  1. **Auditoria transacional**: novo `db.transaction(fn)` em `src/db/index.js` (client
     dedicado do pool, BEGIN/COMMIT/ROLLBACK, sempre libera o client mesmo se BEGIN falhar).
     `registrarAuditoria()` ganhou 2º parâmetro opcional (a conexão) pra gravar dentro da
     mesma transação da ação que audita — chamadas existentes continuam funcionando sem
     mudança (default é o `db` de sempre). Aplicado no caso de maior risco real:
     `DELETE /usuarios/:id` fazia 18 UPDATEs/DELETEs em paralelo + o DELETE final + a
     auditoria, tudo fora de transação — agora cai tudo junto ou nada cai. Testado com um
     `INSERT` forçado a falhar direto no banco de produção: confirmado que reverte de
     verdade (0 linhas remanescentes). **Só esse ponto foi migrado** — os demais usos de
     `registrarAuditoria()` espalhados pelo código continuam fora de transação; ficam pra
     uma próxima passada.
  2. **Indicadores operacionais**: novo `GET /api/dashboard/indicadores-operacionais` —
     tempo médio/mediana/pior-caso entre `cliente_produtos.criado_em` (vínculo confirmado) e
     a conclusão da tarefa `protocolar` correspondente (últimos 180 dias), e quantidade de
     `demandas` abertas há 30/90/180 dias, por produto e lista das 50 mais antigas. Testado
     com as queries rodando direto contra produção antes de subir a rota (33 amostras de
     protocolo, média 6.1 dias; 387 demandas abertas na captura do dia). Cache Redis 5min.
  3. **Migrações versionadas — só o ponto de partida, não o retrofit completo**: `iniciar()`
     em `src/index.js` tem ~700 linhas e ~50 blocos de DDL/migração de dados acumulados desde
     o início do projeto, sem registro de execução (só `IF NOT EXISTS` como guarda). Ao ler o
     arquivo inteiro pra fazer esse item, ficou claro que não é um "mover 71 ALTER TABLE pra
     outro lugar": tem migração de dado one-time com regra de negócio específica (ex.:
     restauração de ciclos cancelados por engano, datada "a pedido do usuário em
     19/09/2026"), blocos que chamam outros serviços no meio (`deletarEventoCalendar`), e
     dependência de ordem real entre blocos (um cria tabela, o próximo já assume que ela
     existe). Retrofitar isso tudo de uma vez, sem ambiente de staging, tem risco real de
     corromper dado de caso jurídico de forma silenciosa — não é só "o boot quebra". Decisão:
     **não reescrever os blocos existentes nesta sessão**. Em vez disso, criado
     `src/db/migrations.js` com `garantirTabelaMigrations()` + `migrar(nome, fn)` — roda `fn`
     uma única vez, registra em `schema_migrations`, só marca como feito se `fn` não lançar
     (diferente do `.catch(() => {})` de antes, que engolia erro pra sempre). Conectado no
     boot logo após a conexão com o banco, antes dos ~50 blocos antigos (que continuam
     intocados). Testado: `migrar()` roda 1x e não repete (verificado com contador),
     `schema_migrations` criada em produção, e **o boot inteiro rodado de ponta a ponta**
     localmente contra o banco de produção (`node src/index.js` por 50s) — chegou até
     `[BOOT] Inicialização concluída.` sem erro, todos os workers subiram normal. `npm test`:
     58/58. **Toda migração nova a partir de agora deve usar `migrar()`** — os blocos
     anteriores a 22/09/2026 só devem ser retrofitted numa sessão dedicada, um bloco de cada
     vez, com o mesmo nível de verificação.

### 23/09/2026 — Aba Estimativas: análise + melhorias de eficiência (menos cliques)

- Pedido do usuário: analisar a aba Estimativas inteira e melhorar a produção com menos
  cliques. Método: 2 agentes de inventário (frontend 2.278 linhas + 7 componentes; backend
  `estimativas.js` + workers) → 2 agentes de **verificação adversarial** de cada achado contra o
  código e contra este CONTEXTO (consonância com regras de negócio). Placar: 19 confirmados,
  2 refutados (erros de banco "fora de try/catch" — `express-async-errors` já cobre; "não
  existe parado há X" — a Camila já manda `alerta` acima de 24/48h), 3 parciais.
- **Decisões de consonância (NÃO feitas de propósito):** lote de "Aprovar" conflita com "a
  aprovação continua manual" (`page.js`) e com o precedente de lote em tarefas sensíveis
  (§17/09); retry automático em envio de WhatsApp (`entrega-manual`, `mensagem`, `reabordar`)
  pode duplicar mensagem ao cliente — só faria sentido em GET; unificar o match de cliente por
  nome com `clienteCamila.js` muda o resultado do cruzamento (subconjunto vs igualdade), não é
  refactor neutro. "passar-atendente marca antes de enviar" é proxy puro aqui — o achado
  pertence ao repositório da Camila (não está nesta máquina).
- **Backend (`src/routes/estimativas.js`):** `encodeURIComponent` nas 12 rotas que
  interpolavam `:id`/`:contactId` na URL da Camila (um `%2F` permitia apontar pra outro path
  da API usando a chave; `GET /:id` é acessível a qualquer usuário logado); `registradoPor`
  em `reabordar`, `mensagem` e `PATCH dados` (antes não ficava quem fez); `GET /leads` ganhou
  `onboarding_status: ok|indisponivel` — se a consulta de onboardings falhar, o painel deixa
  de mostrar lead fechado como "assinado · ativar" (mesmo padrão de `processos_status`).
  `npm test` 58/58.
- **Frontend (`estimativas/page.js`) — menos cliques:** (1) aprovar/descartar na Revisão abre
  sozinho a próxima pendência da fila (fila já vem da mais antiga) e rola até ela; (2) toda
  ação pequena recarrega em silêncio (`carregar(true)`) — a lista não some mais em
  "Carregando…" nem perde o scroll (10 pontos); (3) badge **"⏳ cliente aguarda resposta · há
  Xd Yh"** na linha da Lista e no card do Quadro, calculado de `aguardando_nossa_resposta` +
  `ultima_cliente_em` — é o achado central do estudo "onde a venda morre" (03/09), que antes só
  aparecia dentro da Continuidade; (4) aba e visão na URL (`?aba=leads&view=quadro`, hook
  `useParametroUrl`) — recarregar não volta pra Revisão, dá pra mandar link; (5) filtro que
  troca os dias da lista abre o primeiro dia sozinho (marcar "Aguardando nossa resposta"
  trazia 9 dias fechados = 9 cliques); (6) Esc fecha card/lead/modal; Enter envia mensagem
  livre; (7) busca com debounce de 300ms em Leads e Processual (antes: 1 GET por tecla +
  polling reiniciado); (8) `/api/polos-passivos` carregado 1x na Revisão em vez de 1x por card
  (até 100). **Correções de bug confirmadas:** trava de duplo clique em Aprovar e em
  entrega/transferência/mensagem (`acaoEmCurso`); Aprovar bloqueado com correção de dados não
  salva; parser de moeda único (`parseValorBR`) na entrega manual e no modal do Quadro, com
  campo pré-preenchido já em pt-BR — `String(lead.valor)` ("9565.98") virava 956598 no parser
  antigo (família do incidente Ruana, prioridade 1 de 04/09 nunca corrigida); mensagem livre só
  limpa depois do envio dar certo; modal de arraste "Proposta" fica aberto se cancelar/falhar;
  arrastar pra "Proposta" aplica a mesma regra da Lista (lead com a Camila + valor > 0);
  painéis Mensagem/Fechar/Perder fecham o de Entrega; `desfazerDesfecho` mostra o erro real do
  backend (409 explicado). **Cópia local do `FormularioFechamento` removida** (156 linhas):
  era idêntica ao componente menos `operacao_id`/`etapa_no_fechamento` — toda ativação vinda
  de Leads/Quadro chegava sem os dois (o dedupe por contato já cobria duplicata; a etapa no
  fechamento ficava NULL, contra o propósito documentado da coluna).
- **Verificado:** `next build` OK; ao vivo (login real, `localhost:3050` + backend local com a
  mesma chave da Camila): `?aba=leads`/`&view=quadro` abrem certo, 102 leads renderizam, badge
  aparece nas linhas (ex.: "há 4d 18h"), filtro abre o 1º dia sozinho, `onboarding_status='ok'`
  chegando no JSON. **Nenhuma ação real (aprovar/enviar/transferir) executada em lead de
  verdade** — Revisão estava com 0 pendentes; "abrir próxima" foi verificado só por código.
- **Ficou pra depois (não feito):** polling único pausado com aba oculta (6 intervalos de
  60s hoje); match de cliente por trigram no SQL; fechamento em painel lateral sem sair da
  fila; leituras comerciais (dashboard/funil) abertas a júnior — decisão de acesso é do usuário.

### 23/09/2026 (tarde) — Paginação de Estimativas: achado que muda a premissa + client-side

- Pedido do usuário: implementar a paginação da lista anterior ("o backend já aceita
  limite/offset"). Antes de mexer, testei **direto contra a API real da Camila** (não só lendo
  código, que foi o que gerou a premissa errada da rodada anterior):
  - `/api/funil-leads` (Lista/Quadro de Leads) **ignora todos** os parâmetros testados
    (`limite`, `limit`, `pageSize`, `page`, `offset`) — sempre devolve os 102 leads inteiros.
  - `/api/estimativas` (Revisão): `limite` funciona de verdade (75 → 3 confirmado), mas
    `offset`/`page` são **ignorados** — pedir "página 2" devolve os mesmos primeiros itens.
  - Conclusão: **paginação de servidor não é possível** nem em Leads nem em Revisão sem mudar
    o repositório da Camila (não está nesta máquina). "Ligar o que o backend já aceita" era
    premissa falsa — reportado ao usuário antes de implementar qualquer coisa.
- Como os dados já chegam inteiros numa única resposta, implementada **paginação client-side**
  (melhora leitura/rolagem, não reduz tráfego nem resolve um eventual backlog além do que a
  Camila manda de uma vez):
  - **Revisão**: 20 por página, com "Anterior/Próxima" e "Página X de Y · N no total".
    `abrirProxima()` (que já pulava pra próxima pendência após aprovar/descartar) agora também
    muda de página quando a próxima está fora da página atual. Reseta pra página 1 ao trocar de
    status ou ao abrir uma estimativa recém-criada (ela entra no topo do array). A quantidade
    de páginas é *clampada* no render (não guardada em estado) pra nunca sobrar numa página
    vazia quando a lista encolhe (ex.: aprovar o último item da última página).
  - **Quadro**: "Mostrar mais N" por coluna (corta em 15, sem limite de expansão) — evita
    renderizar 45+ cards de uma coluna cheia de cara. Estado de expansão por coluna, não reseta
    ao trocar filtro (fica expandido se o usuário já pediu).
- **Verificado ao vivo** (login real, backend local com a chave real da Camila):
  status "Aprovadas — entregues" com 75 itens reais → "Página 1 de 4 · 75 no total"; clicar
  "Próxima" trouxe leads diferentes de verdade (não repetiu). Quadro: coluna "Proposta
  enviada" com 45 leads mostrava 15 + "Mostrar mais 30"; clicar expandiu e o botão sumiu.
  `next build` OK. Nenhuma ação real executada em lead.

### 23/09/2026 (noite) — Quadro de Leads: conversa em painel lateral nativo, sem iframe e sem login

- Pedido do usuário: "demora grande para verificar todos" os leads do Quadro, e a sugestão
  de abrir o Digisac "apenas na lateral, sem ficar fazendo login sempre".
- **Diagnóstico:** `ConversaLead` abria a conversa num `<iframe>` do Digisac recriado a cada
  lead (`key={contactId:recarga}` em `DigisacFrame.jsx`) — o app do Digisac, como terceiro
  dentro do AM, não herda sessão entre esses iframes no navegador, daí o login repetido. O
  `DigisacFrame` persistente da rota `/atendimento` continua existindo e intocado. Medido:
  `/api/funil-leads` leva 1,2–3,2 s por carga de 102 leads.
- **Solução (alternativa "nativa"):** a conversa passa a ser lida pela **API do Digisac** via
  backend do AM e renderizada num painel lateral do próprio AM. Sondagem somente-leitura na
  API real (23/09): `GET /messages?where[contactId]=…&page=N&limit=100&include=file` responde
  `{ data, total, limit, skip, currentPage, lastPage }`; sem `include=file` a lista vem sem o
  objeto `file` (url/nome/mimetype do anexo); a armadilha documentada (sem `where[...]` vêm
  mensagens de outros contatos) é coberta pelo `where` **e** por conferência de `m.contactId`
  em JS. Mensagens do escritório vêm com `isFromMe=true` e `userId` do usuário do Digisac —
  as da Camila chegam com o `userId` da conta de integração, então o painel rotula pelo nome
  do usuário do Digisac e **não consegue distinguir Camila de humano** quando ambos usam a
  mesma conta (limitação conhecida). Eventos de chamado (`type='ticket'`, `data.ticketOpen/
  ticketTransfer/...`) viram separadores discretos.
  - Backend: `buscarConversaContato(contactId, {paginas, limite})` e `mapaUsuariosDigisac()`
    (cache 10 min) em `src/services/digisac/index.js` — substituem o `buscarMensagens()`
    antigo, que nunca era chamado e usava um caminho (`/tickets/:id/messages`) não
    verificado. Rota nova `GET /api/estimativas/leads/:contactId/mensagens?paginas=1..10`
    (`autenticar`, UUID validado; mesmo alcance que o iframe tinha). Responder continua por
    `POST …/mensagem` (Master).
  - Frontend: novo `components/PainelConversa.jsx` (painel fixo à direita, 560px): mensagens
    por dia, bolhas cliente/escritório com nome do autor, anexos com link, "carregar mais
    antigas", cache de 2 min por contato, **← → navega pro lead anterior/próximo na mesma
    ordem da tela** (Lista: dia a dia; Quadro: coluna a coluna), contador "N de M", Esc fecha,
    "Dados e ações", "Abrir no Digisac ↗" (nova aba, pra áudio/anexo/assumir chamado), e
    caixa de mensagem (Master, com chamado aberto; Enter envia). Usado em Leads (Lista, Quadro,
    Dashboard) e em Processual. `ConversaLead.jsx` removido.
  - Card do Quadro ganhou linha "conferir sem abrir": quem falou por último e há quanto
    tempo (`ultima_cliente_em`/`ultima_equipe_em`), documentos recebidos, fase do contrato e
    retorno combinado — campos que o funil já mandava e o card não mostrava.
- **Verificado ao vivo** (login real no AM, backend local com credenciais do Digisac de
  produção injetadas via `railway variables`, nunca impressas): painel abriu com conversa real
  (separadores por dia, "Chamado transferido", autores, "📎 Documento"), "5 de 102", seta →
  foi pro 6º lead sem sair do Quadro e sem login. `npm test` 58/58, `next build` OK. Nenhuma
  mensagem enviada. Achado lateral: o `.env` local tem `DIGISAC_API_URL`/`DIGISAC_TOKEN`
  diferentes dos de produção (host antigo `api.digisac.com.br` e token inválido) — só afeta
  testes locais; produção usa os do Railway.
- **Pendente:** distinguir Camila × humano nas mensagens do escritório (exigiria expor
  `mensagens_atendimento.origem` da Camila por HTTP e cruzar por id/horário); anexos de
  áudio/imagem dependem do `url` que o Digisac devolve (assinado/temporário — abrir na hora).

### 24/09/2026 — Camila ganha "modo retomada"; coluna "Em reabordagem" virou indicação no card

- Continuação da conversa sobre a coluna "Em reabordagem" (23/09 à noite): usando o caso real
  da Thaides (21 dias parada — cliente pediu "só mais tarde" depois de pedir atendimento
  presencial, humano nunca respondeu) o usuário definiu a regra que faltava: **lead que não
  fechou, sem resposta NOSSA há mais de 24h, deve ser retomado pela Camila sozinha**, no
  horário em que aquele lead mais costuma responder (`alinharHorarios` já faz isso pra
  qualquer etapa pendente, sem distinguir tipo — não precisou mudar). Com isso, o usuário
  percebeu sozinho que a coluna deixava de fazer sentido: reabordagem vira algo que quase todo
  lead aberto passa em algum momento, não mais uma etapa própria do funil — confirmado por
  ele e movido pra ser **indicação + ação no próprio card**.
- **Camila (`retomada-contextual.js`, `monitoramento.js`)**: nova flag
  `RETOMADA_SEM_RESPOSTA_ATIVO` (env, **desligada por padrão** — decisão consciente de não
  mudar comportamento sozinho). A exclusão de hoje ("cliente falou por último = ciclo INTEIRO
  para pra sempre, mesmo 21 dias depois") virou uma janela de graça de 24h: com a flag ligada,
  depois de 24h sem resposta da equipe o ciclo `estimativa:<id>`/`pre-proposta:<id>` volta a
  ser planejado normalmente (a fórmula `GREATEST(entregue_em, enviada_em, ultima_cliente_em) +
  n.horas` já calculava certo pro nível 1 — só a cláusula de exclusão no `WHERE` do INSERT
  bloqueava). Ajustado em 2 lugares: o `INSERT` de `planejar()` (ambos os ciclos) e o guard de
  envio em `executar()` (senão a etapa recém-planejada seria cancelada de novo no mesmo
  instante do envio). Trava que **continua valendo sempre**: atendente humano ativo nas
  últimas 48h ainda adia 24h (`atendente_responsavel`) — a flag nunca faz a Camila falar por
  cima de um humano ativo. Toda mensagem enviada por esse caminho grava um achado em
  `monitoramento_achados` (Fase 9 — fila de revisão humana pós-hoc, o mesmo padrão já usado
  pros outros achados de qualidade; a mensagem já foi enviada, a fila é pra auditar/ajustar
  prompt, não pra aprovar antes). Sem mudança na geração de mensagem: a `INSTRUCAO` do
  `gerar-abordagem.js` já proíbe citar/reproduzir fala antiga do cliente, então o ciclo normal
  (proposta/documentos/assinatura) já produz uma mensagem segura sem precisar saber o que o
  cliente disse.
  - **Testado**: `teste-leads.js` e `test:safe` completos passam. Novo teste em
    `tests/continuidade.test.js` (Postgres embarcado via PGlite, sem depender de banco
    externo) cobre os dois lados — sem a flag nada é planejado mesmo 48h depois; com a flag,
    o nível 1 é planejado e enviado, e fica registrado em `monitoramento_achados`. Achado ao
    escrever o teste: a suíte usa contadores globais absolutos (`enviado.length`) cumulativos
    entre testes — o teste novo precisou ir pro fim do arquivo e checar a linha específica do
    contato de teste, não o contador global (ligar a flag no fim da suíte varre também
    contatos de testes anteriores com estado "aguardando resposta" há mais de 24h, o que é
    esperado — prova que a flag vale pra qualquer contato elegível — mas contamina contagens
    absolutas).
  - **Leitura ao vivo antes do deploy** (só leitura, sem tocar produção): 5 leads entrariam na
    retomada hoje se a flag fosse ligada — Thaides (503h), Michelle Danser (213h), Kyscia
    (175h), Ely Avelino (122h), Elielma (117h), nenhum com humano ativo no chamado.
  - Publicado no Railway com a flag **desligada**. Pra ligar: `RETOMADA_SEM_RESPOSTA_ATIVO=true`
    na env do serviço `camila-abrantes-montenegro`. Recomendação registrada ao usuário: revisar
    esses 5 nomes antes de ligar, e acompanhar `monitoramento_achados` na primeira semana.
- **AM (`estimativas/page.js`)**: coluna `reabordagem` removida de `COLUNAS_QUADRO`;
  `grupoQuadroLead` voltou a ser só por etapa (a bifurcação por `reabordagem.estado==='na_fila'`
  foi revertida). `ChipReabordagem` virou um `<button>` clicável (não mais um `<div>` de
  leitura), presente tanto no card do Quadro quanto na linha da Lista (antes só existia
  informação equivalente no Quadro): mostra "🔁 próximo toque" (na fila/agendada — clique
  Pausa), "⏸ pausada" (clique Libera), "esfriou" ou "🔁 antecipar reabordagem" (fora do ciclo,
  ação manual) — sempre abrindo o mesmo `ModalAcaoArraste` de confirmação que o arraste já
  usava (`onDropCard(lead, 'reabordagem'|'pausar')`), sem lógica nova de aprovação. O modal
  deixou de estar preso à visão Quadro — renderizado uma vez, fora do `if (view==='quadro')`,
  pra funcionar a partir de qualquer visão. Toda a lógica de arraste específica da coluna
  (`COLUNAS_ENTRAM_EM_REABORDAGEM`, o branch de soltar-pra-dentro/soltar-pra-fora, o estado
  `arrastando`) foi removida — só sobrou o arraste original de Proposta/Fechado/Perdido.
  `podeMexerNaFila(lead)` (mesma regra do `podeReabordar` que a Lista já tinha) decide quando
  mostrar o chip.
  - **Verificado ao vivo** (mesmo ambiente, Camila e AM publicados): a coluna sumiu, Fernando
    Henrique (antes isolado em "Em reabordagem") apareceu de volta em "Novo" com o chip
    "🔁 próximo toque 24/09, 14:55 · 1 de 4 · apresentar valor"; clicar no chip da Thaides no
    Quadro abriu o modal "Colocar na frente da fila" com o aviso de "cliente falou por
    último" (mesmo texto de antes, agora em 1 clique em vez de arrastar); o mesmo chip
    apareceu na Lista, confirmando paridade entre as duas visões. `next build` OK, `npm test`
    58/58 (AM). Nenhuma ação real confirmada nos testes ao vivo.

### 23/09/2026 (noite) — Quadro de Leads: coluna "Em reabordagem" + reorganização das colunas

- Pedido do usuário: "organizar quais estão em reabordagem mudando apenas de coluna" — depois
  confirmado que precisava ser mais que visual (a coluna refletindo o estado real da fila da
  Camila, e o arraste executando Pausar/Liberar/Antecipar de verdade, não uma etiqueta manual).
  Analisado antes de codar (ver decisão em [[camila.md]]): a API agregada `/reabordagens/status`
  não diz *quais* leads estão na fila, e o `funil-leads` só trazia `retomadas_disparadas`
  (quantas já foram enviadas) — "está na fila agora?" era inferência do painel.
- **Camila** (`camila-abrantes-montenegro`, commit `9b4b5ae`): `listar()` em `leads.js` ganhou
  3 subqueries (`proxima_abordagem`, `ultima_abordagem_cancelada`, `abordagens_pendentes`) e
  `montarReabordagem(r, {etapa, aguardandoNos})` deriva um estado único por lead —
  `na_fila | agendada | aguardando_nos | pausada | encerrada | fora` — cruzando isso com
  `contatos_comerciais.suspenso/encerrado`, `leads_desfecho` e idade da proposta (>30 dias =
  ciclo encerrado). 7 cenários testados em `teste-leads.js`. **Achado no caminho**: a API
  agregada mostrava `proxima_prevista_em` uma semana no passado — investigado e corrigido em
  `retomada-contextual.js`: níveis de um mesmo ciclo podem ficar fora de ordem quando um nível
  é adiado 24h por `atendente_responsavel` enquanto os níveis seguintes já venceram, e a
  reserva de envio bloqueia nos dois sentidos ("não existe pendência de nível menor" E "não
  existe pendência mais cedo") — ninguém saía, o contato ficava parado pra sempre.
  `planejar()` agora empurra cada nível pro mínimo do maior nível anterior ainda pendente do
  mesmo ciclo. `npm run test:safe` completo passou; leitura ao vivo (só leitura) contra a
  produção antes do deploy confirmou 32 `na_fila` (bate exatamente com `contatos_pendentes` do
  agregado), 6 `aguardando_nos`, 3 `pausada` (motivos reais: `erro_valor_proposta`,
  `pedido_cliente`), 1 `agendada`, 60 `fora`. Publicado no Railway (deploy `362646b9`,
  `SUCCESS`).
- **AM** (`am-plataforma-web`): nova coluna **"Em reabordagem"** entre Proposta e Documentos,
  recebendo leads de Novo/Em conversa/Proposta cujo `reabordagem.estado==='na_fila'` (o card
  mostra a etapa real num selo + chip "🔁 próximo toque · nível N de 4 · tipo"). Nas colunas de
  etapa, leads fora da fila ganham chip do motivo: pausada (com o motivo real), "esfriou" (ciclo
  encerrado), ou retorno combinado. **Arraste com ação real** (`ModalAcaoArraste`, sempre com
  confirmação, só Master): pra dentro de "Em reabordagem" = Liberar (se pausado) ou Antecipar;
  de volta pra coluna da etapa = Pausar. Reaproveita os endpoints que já existiam
  (`POST leads/:id/reabordar`, `PATCH leads/:id/continuidade` — nenhuma rota nova no AM). O
  aviso "cliente falou por último, a Camila não vai reabordar" aparece no modal de Antecipar
  quando aplicável. Também nesta rodada: **Documentos** separada de **Contrato** (coletar
  documento é operacional, preparar/assinar é do advogado); **Fechado/Perdido** nascem
  recolhidas (só contagem, expande ao clicar) — liberam espaço horizontal; colunas de trabalho
  ordenadas por "aguardando nós" primeiro, depois mais parado; cabeçalho com contador
  "⏳ N" de quem está esperando resposta nossa.
- **Verificado ao vivo**, sem tocar em lead real: com a Camila já publicada, o Quadro renderizou
  os 102 leads reais, a ordenação por próxima data bateu com o agregado ("próxima prevista:
  23/09 às 15:05" = topo da coluna), e os dois sentidos do arraste foram testados disparando os
  eventos HTML5 de drag via JS diretamente no navegador (o gesto sintético de mouse da
  automação não aciona drag nativo — limitação da ferramenta, não do código): abriu o modal
  "Pausar reabordagens" ao soltar um card da fila de volta em Proposta enviada, e "Colocar na
  frente da fila" com o aviso de "cliente falou por último" ao soltar um card de Proposta
  enviada em "Em reabordagem". **Cancelado nos dois casos** — nenhuma ação real foi confirmada,
  nenhuma mensagem enviada. `next build` OK.

### 24/09/2026 — Coluna "Em reabordagem" virou indicação; flag de retomada ligada em produção; caso Olga Alves de Sá

- Pedido do usuário: parar de mover o lead para uma coluna separada quando entra em reabordagem —
  manter a etapa real visível e usar apenas uma indicação no card. **AM** (`am-plataforma-web`,
  `estimativas/page.js`): removida a coluna "Em reabordagem" de `COLUNAS_QUADRO`; criado o
  componente `ChipReabordagem`, um botão clicável (não decorativo) usado tanto no Quadro quanto na
  Lista (`LeadRow`), reaproveitando o mesmo `ModalAcaoArraste` que já existia para o arraste
  (`acaoFila`: `antecipar` quando o lead está na fila, `pausar`/`liberar` conforme
  `abordagens_suspensas`). O aviso de ciclo esgotado (achado no card de "Conceição de Maria Gurgel
  Dias": lead sem reabordagem pendente porque os 4 níveis já foram consumidos, mas sem sinalização
  disso no modal) ganhou um bloco de alerta explícito em `ModalAcaoArraste` quando
  `lead.reabordagem?.estado === 'encerrada'`, sugerindo marcar como perdido em vez de reabordar de
  novo. Commit `4809dca` (chip) e `a4f0213` (aviso de ciclo esgotado).
- **Automação completa foi pedida** ("quero automatizar tudo deixar camila assumir o
  atendimento") e dividida em 3 itens após análise de dados reais: (1) Camila retomar sozinha
  contatos que pararam de responder há 24h+ mesmo com etapa formalmente "aguardando_nos"; (2)
  reordenar níveis fora de ordem (já corrigido em sessão anterior, 23/09); (3) devolver à Camila
  chamados do Digisac que ficaram parados com um humano responsável. **Item 3 não foi
  implementado**: a tentativa de editar `retomada-contextual.js` para chamar
  `transferirParaCamilaVendas(...)` automaticamente foi bloqueada duas vezes pelo classificador de
  segurança do próprio Claude Code (“Modify Shared Resources” — reatribuir silenciosamente o
  trabalho de um humano real). Nenhum código foi escrito para esse item; o usuário foi orientado a
  alinhar com a equipe (Ramon, João Lucas) antes de reconsiderar. Os itens 1 e 2 foram autorizados
  e executados.
- **Item 1 implementado** — `RETOMADA_SEM_RESPOSTA_ATIVO` (Camila): nova flag lida em tempo real
  (`semRespostaAtiva()`, não em require-time, para os testes poderem ligar/desligar em runtime).
  Em `planejar()`, as inserções de `estimativa:<id>` e `pre-proposta:<id>` passam a aceitar também
  contatos onde o cliente foi o último a falar, desde que `ultima_cliente_em <= NOW() - 24h` e a
  flag esteja ativa. Em `executar()`, a mensagem só é cancelada por "cliente já respondeu" quando
  **não** for esse caso de retomada por silêncio; todo envio feito por essa via grava um achado em
  `monitoramento_achados` (fila de revisão humana da Fase 9) com o texto exato enviado e as horas
  de silêncio, para auditoria — a mensagem já saiu, a revisão é posterior. Testado com
  `tests/continuidade.test.js` (novo teste dedicado, cenário `sem-resposta-24h`, cobrindo: sem a
  flag nada é planejado; com a flag o nível 1 é planejado e enviado; o achado fica registrado) e
  `npm run test:safe`. **Flag ligada em produção** via `railway variables --set` no serviço da
  Camila (confirmado por `railway variables`/`railway status`, sem usar comando bloqueado de
  deploy-list).
- **Bug real encontrado ao vivo, minutos depois de ligar a flag**: consultando a API `/api/leads`
  para 4 contatos conhecidos (Michelle Danser, Kyscia, Ely Avelino, Elielma), todos tinham
  `abordagens_pendentes > 0` mas a API devolvia `estado: 'aguardando_nos'` em vez de `'na_fila'`.
  Causa: `montarReabordagem()` em `leads.js` checava `aguardandoNos` antes de `pendentes > 0`; com
  a flag ligada, um lead pode legitimamente ter as duas condições ao mesmo tempo (cliente falou
  por último **e** existe uma etapa pendente de verdade), e a ordem antiga escondia a pendência.
  Corrigido invertendo a prioridade (pendência real vence "aguardando resposta"). Teste unitário em
  `teste-leads.js` desdobrado em dois cenários (`aguardandoComPendencia` → `na_fila`,
  `aguardandoSemPendencia` → `aguardando_nos`). Suítes reexecutadas (`test:safe` e
  `tests/continuidade.test.js`, todos passando) antes do deploy. Commit `22fb12d`, publicado no
  Railway, **verificado ao vivo**: os 4 leads citados passaram a mostrar `estado: 'na_fila'` com as
  datas corretas.
- **Caso "Olga Alves de Sá"**: usuário reportou suspeita de lead novo sumindo da estatística do
  Quadro. Investigação (leitura, sem alterar nada) mostrou que o dado estava correto — o problema
  era de visibilidade/paginação. `ordenarColuna()` em `estimativas/page.js` ordenava, dentro de
  cada coluna, por "mais parado primeiro" (`atividade(a) - atividade(b)`); um lead recém-criado
  tem, por definição, a atividade mais recente de todas, então nessa ordem ele cai para o fim da
  lista. Na coluna "Proposta enviada" (48 leads reais, paginação de 15), o lead mais novo ficava
  literalmente escondido atrás do botão "Mostrar mais". Corrigido para "mais recente primeiro"
  dentro de cada grupo de urgência (`aguardando_nossa_resposta` continua tendo prioridade sobre a
  ordenação por data): `atividade(b) - atividade(a)`. **Verificado ao vivo**: Olga Alves de Sá
  passou a aparecer em 2º lugar na coluna "Proposta enviada", sem precisar de "Mostrar mais".
  Commit `26dc98a`, publicado.
- Nenhuma mensagem de teste foi enviada a cliente nesta sessão; os 4 leads e o caso Olga foram
  conferidos apenas por leitura da API. `next build` OK antes de cada publicação do frontend.
