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
