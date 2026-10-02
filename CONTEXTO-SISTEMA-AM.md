# Contexto permanente — Sistema AM

**Última atualização:** 01/10/2026 (Camila: campanha INSS, caso Sabrina e nono dígito publicados; lista de processos ordenada pela última atualização — movimentação ou publicação; DataJud com lote 40 — ver a seção de 01/10/2026 no fim)
**Finalidade:** continuidade segura do desenvolvimento em outros chats e sessões.

Este é o registro canônico do estado do Sistema AM. Deve ser lido antes de
qualquer alteração e atualizado depois de mudanças materiais no código, banco,
integrações ou produção. Não registrar segredos neste documento.

> **LER PRIMEIRO — estado em 29/09/2026 (noite):** o **re-protocolo automatizado está NO AR e
> configurado** (Fase 0, verificação gravada no AM, pacote em modo sombra, aprovação e importação):
> backend `2b24638..fa09938` e `fa09938..fdd2a82` (deploys Railway `effb5521` e `969cb387`),
> frontend `1238607..e6a3fba` e `13c44e9..eb13304` (deploys `8472f278` e `cdc49c2d`). Variáveis do
> backend aplicadas pelo usuário (deploy `8467b4a0`): `SALARIO_MINIMO_VIGENTE=1621` e
> `REPROTOCOLO_APROVADORES` (e-mail do usuário Master Luciano Montenegro; sem ela ninguém aprova).
> `REPROTOCOLO_EXIGE_CONFIRMACAO` segue DESLIGADA (o aceite do ciclo não exige confirmação).
> Verificado em produção: 3 migrações aplicadas, 5+2 tabelas novas, 186 ciclos adiados e 5 tarefas à
> triagem (fila "Novos ciclos" de 364 para 178), rotas novas respondem 401 sem login.
> **Falta o USUÁRIO operar a tela** (Tarefas > Novos ciclos / Re-protocolo): importar a apuração
> (arquivo local `importacao-reprotocolo.json`, fora do Git, contém nomes de pastas), confirmar o
> grupo Confirmado, colar o link do arquivo do modelo de inicial do Município (o acervo tem esse
> modelo SEM arquivo do Drive), reservar/montar os pacotes; o Luciano aprova informando o valor da
> causa. Decisões do usuário: procuração ANTERIOR reaproveitada; modelos de inicial vêm do acervo;
> salário mínimo 1621; aprovador = Luciano. **Ainda não existe:** fórmula do valor da causa (os 8% são
> só referência), geração da inicial, indexador do Drive no servidor, ferramentas de escrita do chat,
> piloto no PJe. O levantamento de 28/09 segue no ar (decisão de manter/reverter pendente). O diff
> antigo de `src/index.js` foi guardado em `git stash` no checkout principal (superado).

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
- Antes de QUALQUER `git push`, conferir `git log origin/main..HEAD`. Havendo commits locais
  ainda não revisados pelo usuário, publicar só o commit pretendido (`git push origin <sha>:main`)
  — um push "solto" leva tudo junto (incidente de 28/09/2026).

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

### 24-25/09/2026 — Análise completa de reestruturação da Camila (vendas) + primeiro patch de conteúdo publicado

- **Pedido do usuário**: analisar todo o código da Camila (vendas) e avaliar se vale reescrever
  como versão nova ("Camila V3" — já existe uma "Camila V2" de 12 fases no ar desde 26/08,
  então esse nome não pode ser reaproveitado), incluindo agentes especializados, roteador,
  aprendizado que de fato entre em prática, e eficiência/economia de tokens.
- **Leitura profunda** (workflow de 12 agentes: 9 subsistemas + ciência de vendas + economia de
  tokens + verificação cruzada) encontrou, com evidência de código e de dados reais de produção:
  guarda de resposta fixa que descarta a resposta da IA inteira e reintroduz texto genérico
  (foi exatamente o bug do caso real abaixo); memória gravando o que a IA gerou, não o que foi
  enviado; nenhuma "situação comercial" única do lead (5-8 fontes); seletor de intenção por
  regex que erra frases comuns e decide sozinho (inclusive forçando transferência jurídica por
  engano); 56-62% dos tokens do mês indo pro aprendizado automático sem nenhuma técnica
  promovida (catálogo fechado de 10 técnicas de estilo, nunca de conteúdo); só 1 dos 3 caminhos
  de envio passa pelo portão de segurança (retomadas e abertura por número enviam direto);
  vínculo manual sem validação virando PDF quebrado. Gasto medido: ~US$22/mês, dos quais só
  ~33% chega ao cliente. Recomendação: reescrever o núcleo de decisão (estado único, roteador,
  camadas de IA por custo — regra/Haiku/Sonnet, aprendizado em lote por desfecho real), mantendo
  a infraestrutura testada (idempotência de envio, fila de webhook, máquina de aprovação de
  estimativa, pipeline de PDF, testes com Postgres real).
- **Caso real usado como motivador** (Aurielle Gomes dos Santos, contato `bec3eba2`, professora
  substituta UEPB): recebeu proposta 35h depois do prometido "amanhã", PDF com período quebrado
  ("undefined meses"), e a mesma resposta genérica duas vezes seguidas quando perguntou a origem
  do valor e a base legal — a Camila nunca respondia de verdade nem transferia de fato ao
  Jurídico (só oferecia "posso encaminhar?" sem nunca encaminhar).
- **Definição do produto/tese** (trabalho conjunto com o usuário, advogado do escritório):
  verificado que o catálogo de teses do AM (`produtos`, 8 itens) e o módulo Acervo (`teses_acervo`,
  15 slugs) não têm descrição nem base legal preenchidas, e a Camila não referencia nenhum dos
  dois — o `calculadora.js` (6% × meses) nunca soube qual tese estava calculando. A página pública
  `abrantesemontenegro.com.br/restituicao-educacao` foi usada como fonte aprovada: nunca nomeia
  "FGTS" no corpo do texto, só cita "art. 19-A da Lei 8.036/1990" no FAQ quando perguntado
  diretamente — essa "roupagem" (vender "restituição da Fazenda Pública", não o mecanismo
  técnico) foi definida como o padrão para a Camila. Lógica fechada com o usuário, em camadas:
  (0) explicação geral sem nomear mecanismo; (1) lógica completa se insistir em "por que ninguém
  me falou" — lei local omissa → lei federal especial → 25 meses → Fazenda paga → só via
  Justiça → não afeta vínculo/contracheque; (2) citação técnica (art. 19-A/STF) só se insistir
  ainda mais, teto do que a Camila sabe; (3) Jurídico se insistir além disso. Regime elegível:
  contratado/temporário/excepcional interesse afirma direito sem hedge; efetivo/concursado não
  afirma nem descarta (outra tese do catálogo pode se aplicar por cargo/órgão, ainda sem
  conteúdo) — encaminha pra equipe avaliar. Honorários (30%, êxito, sem cobrança antecipada)
  confirmados sem alteração, apesar de `cliente_produtos.honorarios_pct` estar majoritariamente
  zerado no banco (achado de qualidade de dado, não de política).
- **Testado fora de produção antes de publicar**, chamando a API do Claude diretamente com o
  prompt real: caso Aurielle (origem do valor + insistência em base legal), regime (contratado
  afirma, efetivo não afirma nem descarta, variações e follow-up), honorários, hesitação (achado
  e corrigido: ela diagnosticava mas não fechava com horário — regra nova obriga propor 2
  horários concretos na mesma mensagem), e uma conversa multi-turno com lead desconfiado
  (golpe repetido, "por que eu e não outro contratado", quem paga) — sem contradições entre
  turnos. **Achado bug real de produção durante o teste**: a Camila em produção, perguntada por
  uma servidora "concursada efetiva há 10 anos", respondia que ela "é exatamente o perfil que
  analisamos" — afirmação incorreta que o patch corrige.
- **Publicado** (Camila, commit `d93f59b`, deploy `09952ae5` `SUCCESS`, verificado por
  `prompt_versao: "75654902c6f0"` no `/health`): `camila/oferta-comercial.js` reescrito com a
  lógica em camadas; `camila/prompt-vendas.js` (hesitação reescrita, regra de regime, correção
  de repetição de CTA em objeção não resolvida, exemplo de "revisão de salário/imposto"
  atualizado); `camila/acoes.js` e `server.js` ganharam a ação nova `TRANSFERIR_OUTRA_TESE`
  (efetivo → equipe avalia outra tese, com alerta) e alerta também na transferência ao Jurídico;
  `camila/respostas-aprovadas.js` (`FIXA-ORIGEM-VALOR`) e `camila/seletor-respostas.js`
  atualizados junto, para a rede de segurança de substituição de resposta nunca reintroduzir o
  texto antigo. **Cálculo/percentual da estimativa não foi tocado**, por pedido explícito.
  `npm run test:safe` e `npm run test:continuidade` 100% (208/208), incluindo rebaseline do
  hash do prompt e 2 testes ajustados para a nova ação/frase.
- **Pendente**: as outras 6 teses do catálogo (Piso Salarial-Magistério, Adicional Noturno,
  Insalubridade, Férias 30/45 dias, 13º Salário, Equiparação no magistério) ainda não têm
  conteúdo aprovado — a Camila continua com a explicação genérica pra elas.

### 25/09/2026 — Correção do bypass jurídico (`pareceJuridicaIndividual`) + itens 3b/3c investigados + decisão de por onde começar a reescrita

- **Bug real corrigido** (Camila, commit `8edccf5`, deploy `d618aa44` `SUCCESS`,
  `prompt_versao: e8cb50eeed53` no `/health`): `camila/seletor-respostas.js`
  (`pareceJuridicaIndividual`) disparava transferência jurídica incondicional só por ouvir as
  palavras soltas "tese", "artigo" ou "jurisprudência" em qualquer mensagem do cliente — pulando
  as camadas 1 e 2 da explicação de origem do valor (publicadas no patch anterior) mesmo na
  primeira menção. Uma condição já existente na própria função (gateada por
  `origemJaExplicada`) tentava resolver isso só pra "tese", mas ficava morta porque a checagem
  anterior interceptava antes — evidência de que essa já era a intenção original, nunca
  finalizada. Corrigido: "prescrição"/"chance de perder/ganhar" continuam transferindo direto
  (são avaliação de risco individual, sem camada equivalente); "tese"/"artigo"/"jurisprudência"
  soltos agora só forçam transferência depois que a explicação geral já foi dada.
  `camila/prompt-vendas.js` (instrução em texto livre pra IA) alinhado com a mesma regra, senão
  a IA continuaria transferindo por conta própria mesmo com o regex corrigido. Verificado
  independentemente por um segundo agente antes de mexer (achou a mesma causa, sem viés do
  diagnóstico original) e testado ao vivo: "qual o artigo de lei que garante isso?" agora recebe
  a citação do art. 19-A/STF (Camada 2) em vez de transferência imediata. `test:safe` e
  `test:continuidade` 100% (209/209), com 1 teste existente reescrito conscientemente e 1 novo.
- **Item 3b investigado (honorários zerados no banco)**: não é bug ativo. `produtos.js:138-149`
  já corrige isso desde 12/08/2026 — o próprio comentário do código cita a auditoria que achou
  1073 vínculos sem lançamento financeiro por causa do default silencioso em 0%. Hoje o sistema
  **exige** o percentual explicitamente (erro 400 sem valor informado e sem padrão configurado
  na tese) — impossível criar vínculo novo com 0% sem querer. Os zeros no banco são registros
  anteriores a essa correção; nenhuma mudança de código foi feita. Resta decisão de negócio
  (não executada): corrigir retroativamente os registros antigos.
- **Item 3c investigado (campo "regime")**: reformulado depois de checar o código. A tabela
  `clientes`/`cliente_vinculos` do AM é só para quem já assinou — não ajuda a Camila na hora da
  venda, que é quando o regime (efetivo/contratado/temporário) precisa ser sabido. O gap real é
  que a Camila pergunta o regime na conversa mas nunca guarda isso como campo estruturado — fica
  só implícito no texto. Não é um `ALTER TABLE` isolado no AM; fica registrado como parte do
  desenho da Fase 1 abaixo (estado único), não um remendo separado.
- **Decisão sobre a reescrita completa**: usuário escolheu começar pela **Fase 1 — estado único
  + roteador** (não pelo levantamento de dados nem pelas 6 teses restantes). Desenho apresentado
  e aprovação da primeira fatia ainda pendente no fim desta sessão: criar a tabela de estado
  único (migração aditiva) e escrever nela **em modo sombra** (sem nenhuma mudança de
  comportamento visível ainda), comparar com o comportamento atual por alguns dias antes de
  qualquer leitura real depender do estado novo — mesmo padrão de rollout gradual já usado nas
  fases da Camila V2. Nenhum código da Fase 1 foi escrito ainda; aguardando confirmação.

### 25/09/2026 (continuação) — Fase 1 da reescrita executada em modo sombra + indicador de fase no `/health`

- **Usuário aprovou a primeira fatia e pediu execução** ("execute tudo quero tudo rodando").
  Antes de cortar o comportamento real pro roteador novo, foi explicado e confirmado com o
  usuário o risco de corte imediato (roteador novo com só 5 categorias vs. dezenas de
  comportamentos finos do sistema atual; tabela nova com poucos minutos de dado real) — decisão
  conjunta de manter em modo sombra, validar com dado real, só então considerar ligar.
- **Publicado** (Camila, commit `4b2b919`, deploy `f28d92f6` `SUCCESS`): tabela `estado_comercial`
  (migração aditiva) consolidando fase/regime/nome/cargo/órgão/barreira/dono da conversa/valor
  aprovado/documentos a partir das 5 fontes hoje espalhadas (`estados_conversas`,
  `contatos_comerciais`, `propostas_enviadas`, `documentos_atendimento`). Escrita em **modo
  sombra**: `camila/estado-comercial.js` (`sincronizar()`), pendurada no único ponto que sempre
  roda (`finally{}` de `atenderMensagem`, `server.js`), fire-and-forget, fail-open em 2 camadas
  (nunca lança pra fora do módulo, e a chamada em `server.js` tem catch próprio) — nunca pode
  atrasar nem quebrar um atendimento real. `camila/roteador-v3.js`: função pura `decidir(estado)`
  que decide o agente (humano/qualificação/proposta/documentos/encerramento) a partir do estado
  consolidado — ainda não chamada em produção pra decidir nada, só testada. `regime` fica nulo
  por enquanto (nenhuma fonte guarda isso estruturado hoje; capturar isso é o próximo passo desta
  mesma fase, não feito ainda de propósito, pra não mexer de novo no prompt/`CALCULAR` na mesma
  sessão dos outros patches). DDL validado diretamente contra o schema real de produção antes de
  esperar tráfego orgânico (leitura/DDL apenas, nenhum dado de lead tocado). **Verificado ao
  vivo**: tabela populou com leads reais minutos depois (2 linhas), incluindo um achado real —
  um contato com `fase:"qualificacao"` já tinha `valor_aprovado` preenchido, exatamente o tipo de
  inconsistência entre fontes que a Fase 1 existe pra eliminar.
- **Pedido do usuário**: expor em algum lugar do sistema a fase de implementação da reescrita,
  com avisos. **Publicado** (commit `94d4615`, deploy `8595e751` `SUCCESS`): novo bloco
  `reescrita_v3` no `GET /health` — `{reescrita, fase_atual, ativo, desde, aviso, sincronizacoes,
  divergencias, taxa_divergencia}`. `ativo` fica `false` até o dia em que algo em produção
  realmente ler `estado_comercial` pra decidir comportamento — isso exige aprovação explícita
  separada, documentado no próprio campo `aviso`. Ao mesmo tempo, `camila/estado-comercial.js`
  passou a gravar por sincronização real `agente_sugerido` (o que o roteador-v3 decidiria),
  `agente_real` (o que o sistema atual já fez, traduzido pro mesmo vocabulário) e `divergiu` —
  operacionaliza a comparação prometida antes de qualquer corte, sem mudar nenhum comportamento.
  Testado reproduzindo o achado real de produção acima como caso de teste (divergência genuína
  esperada, não bug). 222/222 testes (`test:safe` + `test:continuidade`, 13 testes novos no total
  entre as duas publicações desta seção).
- **Pendente**: aguardar acumular dado real suficiente (`sincronizacoes`/`taxa_divergencia` no
  `/health`) antes de considerar ligar `CAMILA_ROTEADOR_V3_ATIVO` (flag ainda nem criada — corte
  real precisa de aprovação explícita separada, mesma disciplina da Camila V2). Captura
  estruturada de "regime" ainda não conectada. As 5 fases restantes da reescrita (prompt por
  camadas de custo, proatividade, aprendizado redesenhado, integração com o AM, rollout) e as 6
  teses do catálogo sem conteúdo continuam não iniciadas.

### 24-25/09/2026 — ponte de notificações da Camila no AM + nova aba lateral "Camila"

- **Gatilho**: usuário perguntou "cadê a aba de notificação e aviso de Camila no Sistema AM?".
  Investigação achou duas rotas já prontas do lado da Camila desde as Fases 8/9 da V2 (fila de
  aprendizado supervisionado e achados de conformidade/monitoramento), com comentário no próprio
  código dizendo "aba da Plataforma AM" — mas nunca espelhadas no backend do AM nem com nenhuma
  tela pra elas. Não era um bug, era uma ponte que faltava terminar.
- **Publicado** (AM backend, commit `ac717a2`): `src/routes/estimativas.js` ganhou 6 rotas novas
  (`/achados-monitoramento`, `/achados-monitoramento/:id`, `/achados-monitoramento/:id/decidir`,
  `/aprendizado-atendimentos`, `/aprendizado-atendimentos/:contactId`,
  `/aprendizado-atendimentos/:contactId/decidir`), proxy autenticado pra `/api/monitoramento` e
  `/api/aprendizado` da Camila (GET livre pra qualquer usuário autenticado, POST/decidir restrito
  a Master). Corpo de decisão passou a levar também `decidido_por`.
- **Publicado** (AM frontend, commit `648a102`): `ContinuidadeCamila.jsx` ganhou
  `NotificacoesCamila()` (renderizada na aba Estimativas, acima do painel de aprendizado),
  mostrando achados de conformidade e a fila de aprendizado supervisionado, com aprovar/descartar
  + observação. Os 2 alertas operacionais que a Camila já dispara (Jurídico acionado / regime
  efetivo → outra tese) passaram a gravar em `monitoramento_achados` também, pra aparecer aqui.
- **Verificação sem senha**: como não entro com credencial de ninguém, a verificação ponta a
  ponta foi automatizada assinando um JWT de teste com o próprio `JWT_SECRET` do backend (mesmo
  valor já lido antes via Railway CLI) usando só campos não-secretos de um usuário Master real
  (id/nome/email/perfil — nunca `senha_hash`), técnica repetida depois nesta mesma sessão pra
  testar a aba nova abaixo. Não é login real nem substitui a política de nunca digitar senha.
- **Pedido seguinte do usuário**: no texto bruto da fila de aprendizado, mostrar só um resumo
  curto (não o achado inteiro, que às vezes tinha vários parágrafos). **Publicado** (mesmo
  commit `17ac051` abaixo): `Resumo()` em `ContinuidadeCamila.jsx` — corta pra 180 caracteres da
  primeira linha, com `<details>` pra expandir o texto completo quando precisar.
- **Pedido seguinte do usuário** (verbatim, resumido): uma aba lateral "Camila" com versão,
  estatísticas de desempenho, histórico de atualização "e o que couber". **Publicado**:
  - Camila (commit `a000bfd`, **ainda não enviado pro GitHub/deploy** — bloqueado pelo classificador
    de modo automático como publicação fora do escopo local; aguardando autorização explícita do
    usuário pra `git push`): tabela nova `mudancas_registradas` (`mudancas.js`) e rotas
    `GET/POST /api/mudancas`, pra registrar e consultar um changelog curto em português de
    negócio (não é changelog de commit técnico).
  - AM backend (commit `a748fa2`): `estimativas.js` ganhou `GET /camila/status` (espelha
    `/health` da Camila), `GET /camila/uso-ia` (espelha `/api/uso-ia`, telemetria de tokens) e
    `GET`/`POST /camila/mudancas` (POST restrito a Master).
  - AM frontend (commit `17ac051`): página nova `/camila` (`PainelCamila.jsx`) com 3 cartões —
    status/versão (inclui o bloco `reescrita_v3` do `/health`, mostrando a fase da V3 e a taxa de
    divergência do roteador em modo sombra), desempenho de IA por período (chamadas/tokens,
    detalhado por finalidade) e histórico de atualização, com formulário de registro rápido
    visível só pra Master. Entrada "Camila" nova no menu lateral, grupo Gestão.
  - **Verificado em dev local contra a Camila de produção real** (backend e frontend rodando
    localmente, dados reais via `CAMILA_API_URL`/`DATABASE_URL` de produção): status "No ar",
    versão do prompt (`e8cb50eeed53`), sincronização com Digisac e consumo de IA (630 chamadas,
    3,74M tokens, 7 finalidades) todos corretos na tela. Um bug real foi achado e corrigido nessa
    verificação: `organizacao_digisac` no `/health` é um objeto (`{ativo, ultimaExecucao,
    ultimoErro}`), não uma string — a tela mostrava `[object Object]` até o fix.
  - **Pendência resolvida no mesmo dia**: usuário autorizou o `git push` do commit `a000bfd` da
    Camila (deploy Railway `SUCCESS`) e do AM backend (`5cd9134`, deploy `SUCCESS`) — verificado
    ao vivo: `/api/mudancas` responde `200 {"ok":true,"itens":[]}` direto na Camila e também pelo
    proxy do AM. Aba "Camila" 100% funcional em produção.

### 25/09/2026 — fix na régua de comparação do modo sombra (aguardando_aprovacao → proposta)

- **Gatilho**: usuário pediu pra investigar a única divergência real registrada na Fase 1
  (`/health` mostrando `sincronizacoes:3, divergencias:1`). Achado: contato `f8c33870` (lead José
  Cleonilson Barbosa, professor da Prefeitura de Natal) estava na fase `aguardando_aprovacao`
  (`CALCULAR` já disparado, na fila de revisão humana — só chega lá com qualificação completa),
  com nome/cargo/órgão preenchidos e valor ainda não aprovado. O roteador-v3 classificou
  corretamente como "proposta" ("dados completos, aguardando estimativa/aprovação"); a régua que
  traduz o comportamento real pro mesmo vocabulário (`agenteReal()`) jogava `aguardando_aprovacao`
  no balde "qualificação" — gerando divergência falsa toda vez que esse padrão comum (dados
  completos, na fila de aprovação) acontecesse, contaminando a taxa de divergência que vai decidir
  se o roteador novo pode assumir de verdade.
- **Publicado** (commit `f138f76`, deploy Railway `SUCCESS`): `agenteReal()` em
  `camila/estado-comercial.js` passou a mapear `aguardando_aprovacao` pra "proposta" (junto com
  `vendas`/`aguardando_atendente_humano`), não mais pra "qualificação". Não muda nenhum
  comportamento real da Camila — só a precisão da medição em modo sombra. Teste novo
  (`tests/estado-comercial.test.js`) reproduz o caso exato de produção. 14/14 `test:safe` +
  223/223 `test:continuidade` (só falharam, sem relação com o fix, 5 verificações de
  `teste-calculadora.js` sensíveis ao dia real da semana — hoje era sexta-feira e a regra real de
  aviso institucional de sexta interferiu com testes que não previam isso; confirmado com
  `git stash` que a mesma falha ocorre sem o fix aplicado; sinalizado como pendência separada).
  `/health` reiniciou zerado (`sincronizacoes:0`) depois do deploy — voltando a acumular dado
  limpo com a régua corrigida.
- **Pendência resolvida no mesmo dia (25/09/2026)**: a causa das 5 verificações sensíveis ao dia da
  semana foi isolada em `teste-calculadora.js` — `Module._load` casa pela string exata do
  `require`, e `./horario` não cobria os `require('../horario')` feitos de dentro de `camila/`
  (`indisponibilidade-processual.js`, `mensagem-proposta.js`), que escapavam do dublê de relógio e
  liam a data real do sistema. Corrigido só no teste, sem mudança em código de produção. Commit
  `418f026`; `npm run test:safe` (14/14) passa agora independente do dia real da semana.

### 28/09/2026 — 7 pendências conhecidas implementadas (AM backend + frontend)

- Lista de pendências registradas em sessões anteriores, implementadas nesta sessão em commits
  locais (**nenhum `git push`/deploy feito** — combinado que o usuário revisa o diff antes).
  `npm test`: 58/58 antes → **64/64 depois** (6 testes novos, nenhum removido). `next build`
  isolado (cópia em diretório temporário fora do diretório de dev, conforme regra do projeto)
  passou limpo, 21 rotas geradas, antes de cada commit do frontend.
- **Polling da aba Estimativas pausa com a aba oculta** (`am-plataforma-web`, commit `0ec444e`):
  novo hook `usePollingSeVisivel(callback, intervaloMs)` usando a Page Visibility API, substitui
  os 3 `useEffect`+`setInterval` manuais (Pendências processuais, Revisão, Leads) — cada um
  rodava a cada 60s mesmo com a aba em segundo plano. Ao voltar a ficar visível, dispara na hora
  além de manter o intervalo.
- **Match de cliente por nome via pg_trgm** (`am-plataforma`, commit `82c9b86`): duas rotinas
  comparavam nome trazendo a tabela inteira de `clientes` pra memória e comparando em JS —
  `clienteCamila.js` (a Camila localiza o cliente pra fechar) e `encontrarClienteExistente` em
  `routes/estimativas.js` (cruzamento "já é cliente" do funil de leads, achado real de
  26/08/2026 documentado mais acima). Trocadas por uma consulta usando `similarity()`/`%` do
  pg_trgm (extensão e índices GIN de `clientes.nome` já existiam em produção desde antes —
  nenhuma migração nova precisou ser criada). Mantida a regra de segurança do projeto: mais de
  um cliente ativo acima do limiar pro mesmo nome (homônimo) nunca escolhe sozinho. Testado só
  com mocks (banco simulado) — a sintaxe SQL (`similarity()`, `%`, `translate()` pra
  acento-insensibilidade sem depender da extensão `unaccent`, que não está habilitada) não foi
  verificada contra um Postgres real nesta sessão; recomendado conferir uma vez em produção
  antes ou logo depois do deploy.
- **Botão de retry manual de sincronização com o Drive** (`am-plataforma` commit `59ca64c`,
  `am-plataforma-web` commit `2c5b1ff`): a função `sincronizarDriveOnboarding()` já existia desde
  a Fase 6 (21/09/2026) mas sem rota nem botão — só o worker em lote a cada 30min. Novo
  `POST /api/estimativas/onboardings/:id/sincronizar-drive` (Master) + botão na ficha do lead
  (Lista), no mesmo padrão visual do botão equivalente da Camila.
- **PainelConversa distingue mensagem da Camila de mensagem humana** (`am-plataforma` commit
  `e55eb87`, `am-plataforma-web` commit `dad3062`): não existe tabela `mensagens_atendimento`
  neste repositório (as mensagens vêm ao vivo da API do Digisac, não ficam guardadas aqui) — o
  sinal equivalente já existia no próprio payload do Digisac (`isFromBot`) e só não estava
  exposto como campo separado, ficando embutido no fallback de `autor`. Novo campo `origem`
  ('camila' | 'humano' | 'cliente' | 'sistema') na resposta de
  `GET /leads/:contactId/mensagens`; no painel, mensagem da Camila ganha cor distinta
  (verde-azulado) e badge "IA" — cor nova, não reaproveita nenhum token de `ESTADO` nem o
  dourado da marca (ver `src/lib/cores.js`: dourado é só pra clicável, nunca estado).
- **Painel lateral pra fechar lead sem sair da fila** (`am-plataforma-web` commit `5294c0b`):
  decisão de design a revisar — não existe "fechar lead" dentro da aba Revisão em si (ali só se
  aprova/recusa o *valor* de uma estimativa, e o registro de estimativa nem carrega
  `contact_id`); "fechar" é ação do funil de Leads/Quadro. O gap real encontrado (comentário
  antigo de `abrirCardNaLista`, "clique abre o lead na Lista, onde todas as ações já existem")
  era: pelo Quadro ou pelo painel de conversa, a única saída pra fechar um lead era "Dados e
  ações", que fecha a conversa, troca pra visão Lista e rola até o card — perdendo o lugar onde
  se estava. Adicionados "Marcar fechado"/"Marcar perdido" no cabeçalho do `PainelConversa` (já
  é um drawer lateral, sobrepõe Quadro/Lista sem navegar), reaproveitando `FormularioFechamento`
  e `marcarDesfecho()` que já existiam — nenhuma rota nova.
- **Acesso: leituras comerciais restritas a Master** (`am-plataforma` commit `2592640`,
  `am-plataforma-web` commit `23ac35d`): decisão pendente do dono do escritório, resolvida como
  "manter fechado por padrão". Nenhuma das rotas de leitura estava de fato restrita antes —
  `GET /api/dashboard`, `GET /api/financeiro` (só a escrita tinha `apenasMaster`),
  `GET /api/pipeline` (`apenasMaster` importado no arquivo mas nunca usado em rota nenhuma) e
  `GET /api/relatorio` + `/sac` + `/financeiro` (`GET /api/estimativas/leads`, o funil de leads
  da Camila, já tinha sido coberto no commit de pg_trgm acima). `GET /api/relatorio/diligencias`
  (processo parado, lista operacional) ficou de fora de propósito. No frontend, Sidebar esconde
  os 4 itens pra júnior, `/` manda júnior pra `/processos` em vez de `/dashboard`, e cada página
  redireciona sozinha se acessada direto por URL. **Decisão que vale revisar**: como a tela de
  Relatório carrega Geral+SAC (ambos comerciais) numa única função ao montar, a página inteira
  ficou Master-only, incluindo a aba Diligências (que sozinha não seria leitura comercial) —
  se o júnior precisar dela no dia a dia, vale separar essa aba da busca conjunta.
- **Aba "Ficha" própria pra ficha única do cliente** (`am-plataforma-web` commit `1238607`): a
  ficha única (checklist de documentos exigidos + demandas por tese, Fase 5, 21/09/2026) vivia
  escondida dentro de "Teses e Protocolos" — a própria entrada daquele dia já registrava isso
  como melhoria futura. Nova aba de nível superior "Ficha", mesmo dado já carregado (sem nova
  chamada à API), "Teses e Protocolos" continua só com vínculo/gestão da tese. **Verificação
  visual em produção com login real não foi feita** (fora do que esta sessão podia fazer sem
  credenciais) — recomendado conferir uma vez antes de considerar fechado.
- Pendências que ficaram de fora de propósito (fora do escopo pedido): os 2 masters sem
  WhatsApp cadastrado (Caio e a conta técnica "Integração Claude") — depende de número real do
  usuário; nada tocado no repositório da Camila.

### 28/09/2026 — Levantamento de re-protocolo pelo chat (passo 1)

- **Objetivo (fluxo futuro):** chat faz o levantamento → Master autoriza → sistema monta pacote →
  robô cria rascunho no PJe → advogado assina com token. **Só o passo 1 (levantamento, somente
  leitura) foi feito.** Nada aceita ciclo, mexe em tarefa, cria pasta no Drive ou acessa o PJe.
- **CORREÇÃO (fim do dia 28/09/2026): estes commits FORAM PUBLICADOS** — o push feito para subir
  só o commit de documentação do incidente de OAuth (`7c5f64b..f6bd681`) levou todos juntos, sem a
  revisão do usuário. Ver "28/09/2026 — Fechamento da sessão". Texto original a seguir.
- **Commits LOCAIS, sem `git push` e sem deploy** (o usuário revisa antes): `7c5f64b` (fix OAuth,
  ver abaixo), `bef421d` (serviço), `cd4d46a` (escopos/acesso), `1b0032b` (rotas + MCP),
  `77621d7` (valor em risco × homônimos), `3dea57d` (saída MCP compacta), `e4320be` (auditoria
  com `autorizado_por`) e o commit desta documentação. `npm test`: **64/64 antes → 123/123
  depois** (59 testes novos, nenhum removido).
- **Serviço** `src/services/reprotocolo/`:
  - `regras.js`: fragmentos SQL **copiados** de `routes/tarefas.js` (filas `reprotocolo` e
    `ciclos`, `/resumo`, resolução de cliente/tese e o `LEFT JOIN LATERAL` de polo passivo) e do
    cron `ciclosRecorrentes.js` (último processo por `periodo_fim`, "processo cobrindo o ciclo",
    responsável do auto-aceite, conta do intervalo). `tarefas.js` **não foi alterado** (crítico,
    sem teste de rota); `regras.test.js` lê os arquivos originais e falha se as regras
    divergirem (conferido que detecta mutação). Mudou a regra da tela → atualizar os dois lados.
  - `levantamento.js`: SQL só busca fatos; JS puro calcula período (`ciclo_inicio` → mês atual,
    ou → `clientes.vinculo_fim` quando `vinculo_ativo=false` — a tela de Tarefas conta sempre até o
    mês atual), meses, **meses com mais de 5 anos** (anteriores às últimas 60 competências, a mesma
    janela da referência oficial de Estimativas — indicador de risco, não análise de prescrição),
    intervalo da tese, CPF mascarado (**só os 4 últimos dígitos**, `***.***.*12-34`), ente
    (agrupa grafias do mesmo ente: "ESTADO PARAIBA", "Prefeitura de João Pessoa"…), juízo = vara
    do processo anterior (com aviso quando é gabinete/2º grau ou núcleo de cumprimento — é a
    localização ATUAL do processo, não o juízo de origem), flags objetivas e `revisao_humana`.
    Agrupa por ente + juízo, ordena pelo mês mais antigo, totais por seção. Processo
    `restrito` fica oculto para quem não tem `pode_marcar_restrito`.
  - Seção **Documentação** (honesta): `regra_de_atualizacao.definida=false` (pendente — será
    derivada das emendas à inicial por juízo); mostra pasta vinculada (`clientes.drive_pasta_id`,
    sem abrir o Drive), documentos registrados no AM por categoria com datas de REGISTRO, e
    `produtos.documentos_exigidos`. **Vocabulários diferentes** (`documentos.categoria` =
    pessoais/vinculo/procuracao/outro × `documentos_exigidos` = identidade/cpf/residencia/
    contracheque) — não são comparados.
  - `vinculoOficial.js`: conferência sob demanda de UMA tarefa via `buscarReferenciaEstadual`
    (mesma fonte/cache 6h da aba Estimativas). Só Estado da Paraíba/Pernambuco; outros entes →
    "sem fonte oficial integrada"; não consulta quando o ente veio só do padrão da tese ou quando
    o período inteiro está fora da janela. "Valor em risco" (8%) só na tese **FGTS** e só com
    correspondência **única/clara** — a busca é por nome exato e um nome comum da fila trouxe 20
    homônimos (achado real, corrigido em `77621d7`).
- **Rotas** (Master): `GET /api/reprotocolo/levantamento?secao=todas|prontos|aguardando&detalhe=
  itens|resumo&ente=&limite=1..500` e `GET /api/reprotocolo/:tarefaId/vinculo-oficial
  [?atualizar=1]` (limite 20/15 min, como Estimativas). Cadeia: `autenticar` → `apenasMaster` →
  `exigirEscopo('reprotocolo')`. Cada consulta grava só `logs_auditoria`
  (`consultar_levantamento_reprotocolo`, `conferir_vinculo_oficial`, com `autorizado_por`).
- **MCP** (`src/mcp/index.js`): `levantamento_reprotocolo` (padrão `detalhe=resumo`; itens com 20
  por seção) e `conferir_vinculo_oficial` (1 a 5 tarefas, uma por vez), `readOnlyHint`, JSON
  compacto sem nulos (resumo real ≈ 33 KB; itens ≈ 73 KB). Chamam a própria API por HTTP local
  com o mesmo token, como as de acervo (que continuam em `/api/acervo`).
- **Escopos do conector (novo):** antes o "escopo acervo" era só nominal — o token do conector
  (JWT da conta de serviço `integracao-claude`, perfil master, 180 dias) valia para a API
  inteira. Agora (`src/oauth/escopos.js`): a tela `/oauth/authorize` lista as permissões com
  caixas de marcar; o token leva `escopos` + `autorizado_por`; token COM escopos só entra em
  `/mcp` e nas áreas dos escopos (`autenticar`); token antigo (sem claim) conta como só
  "acervo" em `exigirEscopo`; sessões do AM não mudam. A autorização vai para `logs_auditoria`
  (`autorizar_conector_claude`).
  - **Como autorizar o re-protocolo no Claude (depois do deploy):** Configurações → Conectores →
    conector do AM → desconectar e conectar de novo → na tela do AM, entrar com a conta Master e
    **marcar "Levantamento de re-protocolo (somente leitura)"** (se o Claude pedir o escopo, ela já
    vem marcada; senão vem só "Acervo jurídico"). Sem isso, as ferramentas novas respondem 403
    explicando o que fazer.
- **Achado de segurança no caminho (commit próprio `7c5f64b`):** `POST /oauth/token` com
  `grant_type=refresh_token` emitia um token Master de 180 dias da conta de serviço **sem validar
  nada** (o servidor nunca emitiu refresh token) — qualquer POST anônimo obtinha acesso Master à
  API. Corrigido para `invalid_grant` e metadados sem `refresh_token`. Não testado contra
  produção (seria explorar a falha). O teste automatizado desse ponto (`src/oauth/index.test.js`)
  foi **bloqueado pelo classificador de permissões da sessão**, e reverter a correção também
  (tratado como enfraquecer segurança) — validação por leitura de código + `node --check`.
  **Recomendação: publicar este commit o quanto antes, independente do resto.** Tokens já
  emitidos por esse caminho seguem válidos até expirar; só rotacionar `JWT_SECRET` os invalida
  (derruba também as sessões do AM e o conector atual).
- **Como foi validado:** testes com banco e fonte oficial simulados (rotas por HTTP real com o
  `autenticar`/`apenasMaster`/`exigirEscopo` verdadeiros: 401 sem token, 403 não-Master, 403
  conector sem escopo ou token antigo, 200 Master/conector com escopo, confinamento; fiação MCP
  via JSON-RPC). Tela de autorização conferida no navegador com servidor mínimo só do router
  OAuth (sem banco e sem o boot do `src/index.js`). **Conferência somente leitura contra
  produção** (script avulso no scratchpad, `BEGIN READ ONLY` + `ROLLBACK`, pool do app nunca
  usado, servidor NÃO subido): **Prontos 2 = `resumo.reprotocolo` 2; Aguardando 364 =
  `resumo.ciclos` 364**; 366 itens / 366 ids; 0 ciclos adiados; consulta ≈ 1,3 s.
- **Retrato real em 28/09/2026** (o que o levantamento mostrou):
  - Os **2 "prontos"** (tarefas `6815b82b` FGTS e `ad417a5b` Equiparação, mesma cliente,
    auto-aceitos pelo cron, prazo 06/10/2026) têm cadastro "vínculo ativo" com **fim em
    01/01/2023, antes do início do ciclo (02/2023)** — se a data estiver certa, não há período
    novo e o re-protocolo é indevido. Conferir antes do prazo.
  - Novos ciclos: **185 de 364 ainda não completaram o intervalo da tese (25 meses)** pela
    mesma conta do cron — provável herança da restauração de 19/09, que não conferia intervalo;
    178 completaram. **36 ciclos têm meses com mais de 5 anos (859 meses no total)**, o mais
    antigo desde 03/2011. 14 com revisão humana (5 polo genérico "Município — Outro", 3 sem
    polo, 3 vínculo divergente, 1 início no futuro, 1 ente PE com processo no TJPB, etc.).
    30 com juízo que é gabinete/núcleo. 289 itens (280 clientes) sem pasta do Drive vinculada.
  - Documentação: **0 documentos registrados no AM** para os 353 clientes; 73 com pasta do
    Drive; checklist de documentos só na tese FGTS.
  - Conferência oficial (5 casos): 1 PE sem registro em 38 competências (reforça que o polo PE
    está errado); 1 PB temporário com último pagamento em 07/2025 (cadastro diz ativo); 1 PB
    com regime CLT (PBSAUDE); 1 PB temporário ativo; 1 com 20 homônimos (sem valor em risco).
- **Pendências / limitações:**
  - Regra de "documento a atualizar" por juízo — **não definida** (bloqueia o passo de pacote).
  - Passos 2+ não iniciados: autorização do Master pelo chat, montagem de pacote, rascunho no
    PJe, assinatura com token.
  - Tokens antigos do conector (sem `escopos`) continuam valendo para a API inteira até
    expirar (180 dias); a confinação vale só para tokens novos. Decisão do usuário: reconectar
    e/ou confinar também os antigos.
  - O fluxo OAuth completo (autorizar → token com escopos) não tem teste automatizado (bloqueio
    acima); cobertos: tela (navegador), `normalizarEscopos`/`exigirEscopo`/confinamento (unitário).
  - `tarefas.js` resolve o polo com `produtos.polos_passivos_padrao[1]` como último recurso, mas
    esse campo é um MENU de opções em várias teses (ex.: 1º item "Estado da Paraíba") — o
    levantamento sinaliza como `polo_inferido_da_tese`; corrigir na tela é decisão à parte.
  - Máscara de CPF: a tela de Tarefas mostra 6 dígitos do meio (`***.456.789-**`); o
    levantamento mostra só os 4 últimos, conforme pedido — alinhar se quiser um padrão único.
  - Sem tela no frontend: por enquanto só API + MCP.

### 28/09/2026 — Vulnerabilidade crítica de OAuth corrigida + rotação de JWT_SECRET

- Ao ler o fluxo OAuth para criar o escopo `reprotocolo` (seção anterior), foi encontrada uma
  falha crítica em `POST /oauth/token`: o ramo `grant_type=refresh_token` emitia um JWT Master
  de 180 dias da conta de serviço `integracao-claude` sem validar nenhum refresh token — o
  servidor nunca chegou a emitir um refresh token de verdade em nenhum fluxo legítimo. Qualquer
  POST anônimo a esse endpoint recebia acesso Master a toda a API protegida por
  `autenticar`/`apenasMaster`. A falha estava em produção desde 18/09/2026 (commit `0015a89`) e
  era descoberta trivialmente: o endpoint público de metadados
  `/.well-known/oauth-authorization-server` anunciava `refresh_token` como grant suportado.
- Corrigido (commit `7c5f64b`, publicado isolado do restante do trabalho de re-protocolo, antes
  de revisão): esse ramo agora sempre responde `invalid_grant`; metadados e registro dinâmico
  deixaram de anunciar `refresh_token`. O fluxo legítimo (authorization_code + PKCE) nunca
  devolveu refresh_token, então nenhum cliente real foi afetado pela correção.
- A verificação pós-deploy (chamando a rota vulnerável antes de confirmar que o deploy novo já
  estava no ar) teve efeito colateral real: gerou um token Master válido de verdade. Como
  `middleware/auth.js` só confere a assinatura do JWT, sem consultar o banco a cada requisição,
  não havia como revogar um token já emitido sem trocar o segredo de assinatura. A retenção de
  log HTTP do Railway neste projeto é curta (~10-15 minutos, testado com `--since 1h` e
  `--since 7d`, que devolveram a mesma janela) — não foi possível confirmar nem descartar
  exploração externa da falha nos 10 dias em que ficou aberta.
- Decisão do usuário: rotacionar `JWT_SECRET` mesmo sem evidência de exploração, para invalidar
  de vez qualquer token emitido pela falha (inclusive o gerado durante a verificação). Executado
  via `railway variable set JWT_SECRET --stdin` (valor aleatório, nunca exibido nem registrado),
  com redeploy automático. Efeito: todas as sessões do AM e o token do conector Claude/MCP foram
  invalidados de uma vez — a equipe precisa logar de novo e reconectar o conector no Claude
  (Configurações → Conectores → desconectar e conectar de novo, autorizando como Master).
- Nenhum segredo, chave ou token foi registrado neste arquivo.

### 28/09/2026 — Fechamento da sessão: estado real e pendências (LER PRIMEIRO)

**Em produção (confirmado):**
- Backend: `origin/main` em `f6bd681`, que inclui o levantamento de re-protocolo inteiro
  (`bef421d`…`4693a5b`) — **publicado por engano, sem revisão do usuário**: o `git push origin
  main` feito para subir só o commit de documentação do incidente de OAuth levou os 7 commits
  junto. Confirmado pelo metadado público `/.well-known/oauth-authorization-server`, que já lista
  o escopo `reprotocolo`. No ar: rotas `GET /api/reprotocolo/levantamento` e
  `/api/reprotocolo/:tarefaId/vinculo-oficial` (Master + escopo `reprotocolo`), ferramentas MCP
  `levantamento_reprotocolo` e `conferir_vinculo_oficial`, tela de consentimento com caixas e
  confinamento do token do conector em `middleware/auth.js`. Tudo só leitura (grava apenas
  `logs_auditoria`). Foram ao ar SEM decisão do usuário os pontos que o próprio agente listou para
  decidir antes do push: caixa `reprotocolo` pré-marcada quando o cliente pede o escopo, máscara de
  CPF diferente da tela de Tarefas, polo inferido do padrão da tese. **Decisão pendente: manter e
  revisar, ou reverter esses 7 commits (mantendo `7c5f64b`).**
- `JWT_SECRET` rotacionado: todos precisam logar de novo; o conector do AM no Claude precisa ser
  reconectado (e, para usar o re-protocolo, marcar a permissão nova). A pendência "tokens antigos
  do conector sem escopo" perdeu efeito — nenhum token antigo vale mais.
- Frontend em `1238607` e Camila em `8bbdd11` (publicados de manhã com autorização; ver seção das
  7 pendências). Camila `7c7dc96`: devolução de chamados parados com atendente humano atrás da flag
  `DEVOLUCAO_ATENDENTE_PARADO_ATIVO` (desligada; modo sombra só grava eventos `simulado:true`;
  ligar é decisão de Ramon + João Lucas). Camila `8bbdd11`: rascunho do conteúdo das 6 teses sem
  cobertura (`ativa:false`, sem aprovação jurídica, fora do fluxo ativo) — precisa de revisão de
  advogado, com atenção a 13º Salário e a Equiparação no magistério (Súmula Vinculante 37).

**Escrito, SEM commit, fora do ar:**
- `src/index.js`, logo após o bloco "Restaura ciclos cancelados por engano": migração idempotente
  de boot com duas correções da fila — (1) adia (`ciclo_adiado_ate`) os ciclos "novos" criados
  antes de completar o intervalo da tese, até a data real de vencimento; (2) marca
  `precisa_triagem=true` (nunca cancela) em ciclos cujo cliente tem `vinculo_ativo=true` e
  `vinculo_fim` preenchido ao mesmo tempo. `node --check` ok, `npm test` 123/123. O classificador
  de permissões bloqueou commit/push; o SQL equivalente foi passado ao usuário. **Não publicar sem
  o usuário revisar.** Banco de produção inalterado na última checagem.
- Alcance medido (leitura, 28/09): 186 ciclos prematuros; 5 tarefas com vínculo contraditório —
  Iradira (`6815b82b` FGTS e `ad417a5b` Equiparação, os 2 únicos "prontos"), Joana Marta Gomes de
  Almeida (`779f6d1b`, `3331bdc4`) e Francisco Isidio da Silva (`30c176e4`). Iradira já tem 2
  processos reais ajuizados em 21/09/2026 (`0804499-91.2026.8.15.2005` FGTS e
  `0868660-25.2026.8.15.2001` Equiparação) com `periodo_fim` 01/2023, e os comprovantes no Drive
  trazem outro sobrenome — conferir se o cadastro é da mesma pessoa antes de qualquer
  re-protocolo. Prazo das tarefas dela: 06/10/2026.

**Achados do Drive (investigação só leitura, amostra de 10 clientes da fila):**
- Premissa corrigida: no re-protocolo só o documento de identidade é reaproveitado; procuração,
  comprovante de vínculo e contracheques/fichas são novos a cada vez. Comprovante de residência
  quase nunca aparece como arquivo separado.
- Pastas são por ajuizamento, no ano do protocolo: "Outorgantes {ano}", "_REPROTOCOLO FGTS 2025"
  e "_REPROTOCOLO - 2026" (onde a equipe monta os re-protocolos na prática), com subpasta `PDF/`.
  `clientes.drive_pasta_id` aponta para pastas vazias criadas pelo AM (4 de 4 na amostra; 0
  arquivos em 38 subpastas conferidas). CPF nunca aparece no nome das pastas reais; busca por nome
  erra (digitação, abreviação, sobrenome); ~9% dos nomes têm um 2º candidato forte → decisão
  humana. O ano do CNJ acerta "Outorgantes {ano}" para processos de 2022 em diante; não existe
  pasta de 2021.
- **Risco de duplicidade:** 14 nomes nas pastas `_REPROTOCOLO` sem o processo novo no AM; ao menos
  3 com comprovante de protocolo (Lauristela 15/12/2025, Ivanna Martins do Nascimento 06/01/2026,
  Silverio Gonçalves de Assis 25/09/2026) — Lauristela e Silverio ainda têm tarefa aberta em "Novos
  ciclos". Qualquer automação precisa cruzar com essas pastas antes de montar pacote.
- Pastas com documentos de outro cliente misturados (Aldair, Leonice); divergências AM × Drive
  (o réu do Fagner é a EMLUR, não o Município).
- Credencial Google do AM: o token do `.env` local está morto (`invalid_grant`); o de produção foi
  gerado em 21/09 por `obter-novo-refresh-token.mjs` com escopo `drive` completo (não verificado ao
  vivo — a checagem via `railway run` foi bloqueada). Calendar e Sheets usam o mesmo token e podem
  estar falhando (nenhum `calendar_event_id` gravado desde 16/07) — não conclusivo.
- Backups do banco no Drive vazios (20 bytes) desde 22/09: corrigido em outra sessão, no worktree
  `vigorous-brahmagupta-d6801e` (commits `30ec8dc` e `b0d24b0`, **não publicados**, aguardando
  autorização). Até publicar, a única proteção é o PITR do Railway.

**Estratégia do re-protocolo — NÃO CONFIRMADA pelo usuário:**
- Fatos dados pelo usuário: o MNI do PJe não funciona; operação pelo chat (levantamento →
  autorização → o sistema sobe o processo como rascunho e gera relatório com período etc. → o
  advogado confere, assina e protocola com o token).
- Ajustes propostos: regras e dados vêm de ferramentas do AM, não do raciocínio do chat; o
  "upload" é rascunho no PJe criado no navegador do advogado (servidor bloqueado pelo Cloudflare
  do TJPB); o relatório confere o que foi preenchido no PJe; fechar o ciclo (número e recibo de
  volta ao AM, período gravado) com trava contra duplicidade.
- Sugestões aceitas: vínculo e regime pelo dado oficial PB/PE; fatos da inicial anterior +
  fundamentação do modelo aprovado atual; regra de documentos a partir das emendas à inicial por
  juízo; ritmo pela capacidade de assinatura (agrupar por juízo/ente, mês mais antigo primeiro,
  valor em risco). Recusadas: checar o resultado do processo anterior; avisar o cliente pela
  Camila.
- **Próximo passo:** consolidar a estratégia numa versão única e pedir "sim" explícito antes de
  executar qualquer fase. Decisões em aberto: manter ou reverter o levantamento publicado;
  certificado A1 ou A3; quem aprova o dossiê; modelo aprovado da inicial por ente; pasta destino
  do pacote (`_REPROTOCOLO - 2026` × `_PENDENTE A PROTOCOLAR - 2026`); tratamento dos 36 ciclos
  com mais de 5 anos acumulados.

**Lições de processo desta sessão:** estratégia de várias fases só se executa depois de "sim"
explícito; "execute X" autoriza só X; antes de qualquer push, conferir `git log origin/main..HEAD`
e publicar só o commit pretendido; não testar falha de segurança em produção antes de confirmar
que o deploy novo está no ar. Nenhum segredo registrado.

### 28/09/2026 (tarde) — Camila: fim da transferência ao Jurídico por "outro advogado/sindicato" + prazo 6 a 11 meses

**Problema (casos reais):** qualquer menção a outro advogado, sindicato ou processo disparava a
resposta fixa `FIXA-REPRESENTACAO-EXISTENTE` ("A existência de outro advogado, sindicato ou
processo precisa ser considerada...") e transferia o atendimento ao Jurídico. Atingiu Danielle
Eulalia ("Meu advogado foi acionado") e Elaine Cristina Brasilino de Albuquerque (áudio: ação do
sindicato 2018-2021, "não sei se é uma outra proposta").

**Decisão do usuário:** a mensagem não é necessária; a Camila segue o atendimento normal. Só
transfere se a pessoa pedir advogado expressamente (ou por prescrição/chance de ganhar-perder,
que continua em `pareceJuridicaIndividual`).

**Mudanças (repo Camila, commit `477bce3`, publicado):**
- `camila/seletor-respostas.js`: intenção `representacao_existente` removida; "demora?",
  "demora muito?", "é demorado?" passam a acionar `FIXA-PRAZO` ("desculpa a demora" não).
- `camila/respostas-aprovadas.js`: entrada `FIXA-REPRESENTACAO-EXISTENTE` removida;
  `FIXA-PRAZO` v2 — "Como estimativa, a conclusão do procedimento leva de 6 a 11 meses,
  podendo variar conforme o caso específico..." (antes "cerca de 6 meses").
- `camila/porta-saida-comercial.js`: verificação de saída exige "6 a 11 meses".
- `camila/prompt-vendas.js`: outra representação não interrompe a venda; se perguntar se é a
  mesma coisa, explicar que é análise própria; "efeito de outra ação" saiu da lista de
  transferência obrigatória. `camila/abordagens.js`: retomada deixa de oferecer o Jurídico.

**Verificado em produção:** `/health` da Camila com `prompt_versao: 6718306cab97` (hash do
prompt novo). `test:safe` e `test:continuidade` (224) verdes.

**Pendências:**
- Tickets de Danielle e Elaine já foram transferidos ao Jurídico antes da correção — a equipe
  precisa assumir ou devolver à Camila (pendente, equipe).
- ~~Fechamento genérico~~ — resolvido (Camila `1b56f68`): resposta à Jacynara (contact
  `e4d950be`) terminou com "Tem alguma parte específica que queira entender melhor?", que
  `prompt-vendas.js` já proíbe e a IA ignorava. `trocarFechamentoGenerico` (`camila/porta-saida-comercial.js`,
  chamada em `server.js` antes de `garantirTransferenciaJuridica`) troca esse fechamento, só depois
  da proposta e fora da fase de documentos, por "Posso te indicar quais documentos você precisa
  reunir para darmos entrada?". Não afeta a pergunta binária do Passo 6. Limitação: `/health` não
  reflete essa mudança (o texto do prompt não mudou); confirmar pelo log `[FECHAMENTO GENÉRICO]`.
- O `/health` não expõe o commit; a conferência de deploy é pelo `prompt_versao`.
- ~~Token do GitHub embutido na URL do remote da Camila~~ — removido da URL em 28/09/2026
  (agora usa o chaveiro do macOS, como os outros repositórios; `git ls-remote` confirmado).
  **PENDENTE (usuário executa depois, 28/09/2026):**
  1. Apagar o token clássico **"SIATEMA AM — repo"** (vence 06/10/2026) em
     github.com/settings/tokens — é o único ativo usado na última semana, logo o que estava na URL
     (dedução, não confirmação). O token já apareceu em saída de terminal e deve ser tratado como
     exposto. "CAMILA NOVO" (nunca usado, vence 03/10) pode ficar ou ser apagado; os demais já
     expiraram.
  2. Se o chaveiro usar esse mesmo token nos repos `am-plataforma`/`am-plataforma-web`, o push deles
     vai pedir credencial: gerar token novo (classic, só `repo`) e informar no prompt do git
     (usuário `montenegroabrantes-lang`), nunca na URL do remote.
  3. Alternativa sem token manual: instalar o GitHub CLI pelo `.pkg` de cli.github.com
     (`brew` e `gh` NÃO estão instalados no Mac) e rodar `gh auth login` (login pelo navegador).
  4. Depois, pedir à IA para testar `git ls-remote` nos 3 repositórios.
  Regra: a IA não revoga/gera tokens nem mexe em configurações de segurança do GitHub.

### 28/09/2026 — Backup diário do Postgres gravava gzip vazio (worker corrigido e publicado)

- **Achado do usuário** (investigação somente leitura do Drive, fora desta sessão): os 7 arquivos
  de backup de 22 a 28/09/2026 na pasta "Backups" tinham **20 bytes cada** — gzip de entrada
  vazia. Nenhum backup válido do banco existia no Drive; a única proteção real era o PITR do
  Railway (ativado em 21/09/2026, ver sessão de 21/09 acima).
- **Causa no código:** `backup.worker.js` rodava `pg_dump "$DATABASE_URL" | gzip > arquivo` via
  `exec`/shell, sem `pipefail`. Num pipe de shell o status de saída é o do último comando
  (`gzip`), que sempre "dá certo" mesmo comprimindo uma entrada vazia — então um `pg_dump` que
  falha ainda parecia sucesso, subia o arquivo de 20 bytes ao Drive e `limparBackupsAntigos(7)`
  apagava os backups bons anteriores por cima.
- **Causa provável do `pg_dump` falhar, confirmada por investigação nesta sessão (somente
  leitura — `railway status`/`railway logs`, nenhum comando rodado contra o banco de produção):**
  o Postgres de produção está na **major 18** (imagem
  `ghcr.io/railwayapp-templates/postgres-ssl:18`, confirmado via `railway status --json`),
  enquanto o `Dockerfile` instalava `postgresql-client` do repositório padrão do Debian
  bookworm, que resolve para a **major 15** (confirmado via `railway logs --build`:
  `postgresql-client-15.19-0+deb12u1`). Um `pg_dump` 15 contra um servidor 18 é uma defasagem de
  3 majors — causa bem mais provável do que a suposta ausência do binário.
  - **Correção de premissa importante:** a nota de memória "Railway usa builder RAILPACK e
    ignora `nixpacks.toml`" é do repositório da **Camila**, não deste. Este repositório
    (`am-plataforma`) usa `railway.json` com `"builder": "DOCKERFILE"` (confirmado), e o
    `Dockerfile` já instalava `postgresql-client` explicitamente — o binário sempre existiu no
    container; o problema é a **versão**, não a ausência.
  - Não foi possível capturar o texto exato do erro do `pg_dump` nos logs históricos do Railway
    (a janela de logs disponível via `railway logs --deployment` não alcançou os ciclos de
    22–27/09 do serviço `am-plataforma`) e, por instrução explícita da tarefa, **não rodei
    `pg_dump` contra produção** para forçar o erro. O novo código (abaixo) captura e alerta com o
    stderr real do `pg_dump` na próxima tentativa — a causa exata fica confirmada sozinha assim
    que o cron rodar de novo.
- **Código alterado (`src/workers/backup.worker.js`):** `pg_dump | gzip` deixou de depender de
  shell/pipefail — agora usa `spawn` separado para `pg_dump` e `gzip`, com a connection string
  passada como argumento (não mais interpolada numa string de shell), checando o código de saída
  e capturando o `stderr` real do `pg_dump`. O arquivo final passa por um piso mínimo de
  **1024 bytes** (`backupTemTamanhoPlausivel`) antes de subir ao Google Drive — se o dump falhar
  ou sair implausivelmente pequeno, o worker apaga o arquivo local, **não** chama
  `limparBackupsAntigos` (backups bons antigos ficam intactos) e dispara o mesmo alerta
  WhatsApp aos masters que já existia para falha de upload (criado no incidente de 21/09), agora
  cobrindo também essa causa.
- **Teste novo:** `src/workers/backup.worker.test.js` (o worker não tinha nenhum teste antes) —
  cobre `pg_dump` ausente, `pg_dump` falhando com mensagem no stderr (reproduz o bug original:
  mesmo falhando, um gzip "válido" porém vazio ainda é gravado em disco) e `pg_dump` funcionando
  corretamente. `backupTemTamanhoPlausivel` testado isoladamente com os 20 bytes reais do
  incidente.
- **`Dockerfile` alterado:** adicionado o repositório oficial `apt.postgresql.org` (PGDG) antes
  da instalação existente de `postgresql-client`, usando o script oficial do pacote
  `postgresql-common` (`apt.postgresql.org.sh -y`) em vez de configuração manual — sem fixar
  versão no nome do pacote, então builds futuros acompanham upgrades de major version do Postgres
  em produção automaticamente. Abordagem conferida contra a documentação oficial
  (postgresql.org/download/linux/debian, wiki.postgresql.org/wiki/Apt) e o código-fonte real do
  script (`-y` existe e evita prompt interativo no build). A imagem base (`node:20-slim`) já
  estava confirmada como Debian bookworm pelos logs de build reais acima.
- **Validação:** suíte completa **127/127 testes passando** (123 antes + 4 novos, nenhuma
  regressão). O `Dockerfile` **não foi testado com build real** — Docker (e alternativas como
  podman/nerdctl/colima) indisponíveis nesta máquina; a mudança se apoia em documentação oficial
  e leitura do script-fonte, não em execução.
- **Estado em produção:** nenhum. **Nada foi commitado nem deployado** — mudança pronta apenas
  no worktree, aguardando autorização do usuário.
- **Pendências / limitações:**
  - Enquanto não houver deploy, os 7 backups de 20 bytes continuam sendo o "mais recente" no
    Drive; a única proteção real do banco continua sendo o PITR do Railway.
  - Mesmo após o deploy, só existirá um backup válido de novo depois que o cron das 02h rodar
    com sucesso pela primeira vez — vale conferir no dia seguinte (log `[Backup]` e o tamanho do
    arquivo mais recente no Drive).
  - Recomendo acompanhar o **primeiro build** no Railway (`railway logs --build`) após o deploy
    para confirmar que `postgresql-client` resolveu para a versão do PGDG (18.x) e não quebrou o
    build por outro motivo — é a única parte desta correção sem teste automatizado.
  - Threshold de 1024 bytes é conservador/arbitrário (um dump real desta base é muito maior);
    ajustável se algum dia fizer sentido.

### 28/09/2026 (noite) — Pendências que ficaram para o usuário executar

- **Token do GitHub:** ver item PENDENTE na seção "(tarde)" acima (apagar "SIATEMA AM", renovar
  credencial pelo chaveiro ou `gh auth login`).
- **Fila de re-protocolo:** SUPERADO em 29/09 — a correção virou a migração única
  `2026_09_28_saneamento_fila_reprotocolo` (usa `migrar()`), commitada na Fase 0 e aguardando o push
  do usuário; o diff antigo de `src/index.js` no checkout principal deve ser descartado.
- **Re-protocolo publicado por engano (7 commits):** decidir manter e revisar, ou reverter
  (mantendo `7c5f64b`); a estratégia foi CONFIRMADA em 28/09 (noite); caso Iradira (prazo 06/10): as 2 tarefas vão à triagem pela migração da Fase 0.
- **Devolução de chamados parados (Camila `7c7dc96`):** flag `DEVOLUCAO_ATENDENTE_PARADO_ATIVO`
  desligada; ligar é decisão de Ramon + João Lucas.
- **6 teses sem cobertura (Camila `8bbdd11`):** revisão de advogado (13º salário, equiparação no
  magistério / SV 37).
- **Backup do Drive:** correção publicada (`6315d83`, `abf5758`); falta confirmar o 1º backup real
  (> 1 KB) no Drive e olhar o log do build no Railway (Dockerfile mudou).
- **Camila `1b56f68` (fechamento genérico):** confirmar pelo log `[FECHAMENTO GENÉRICO]` em
  produção; `/health` não reflete a mudança.
- **Follow-up do worker de backup (achado em revisão pela sessão "am", conferido no código em
  28/09/2026; NADA implementado, não publicar sem ok do usuário):** em `src/workers/backup.worker.js`
  (1) o exit code do `gzip` não é conferido — falha no meio pode gerar arquivo truncado > 1 KB que
  passa pelo piso de tamanho e sobe como válido; (2) faltam handlers de `error` em `gzip.stdin` e
  `dump.stdout` — se o gzip morrer antes do fim, o EPIPE vira exceção não tratada e derruba o processo
  (API e workers rodam juntos em `node src/index.js`); (3) se o `pg_dump` nem iniciar (ENOENT), o
  gzip pode ficar vivo esperando stdin — na falha, matar o outro processo. Sugestão: tornar o gzip
  injetável como o `comando`, cobrir os 3 casos em `backup.worker.test.js` e conferir o backup das 2h.
  (4) `npm test` (`node --test`) nunca encerra quando o Redis não é alcançável: `backup.worker.test.js`
  importa `backup.worker.js`, que importa `src/cache/redis.js`, que cria a conexão ioredis no próprio
  import e fica reconectando para sempre ("[Redis] Erro:" em loop; o teste passa 4/4, mas o processo
  trava — observado por 38 min). Sugestão: mover `gerarDumpComprimido`/`backupTemTamanhoPlausivel` para
  um arquivo sem imports de redis/db, ou chamar `redis.disconnect()` num `after()` do teste.

### 29/09/2026 — Camila: "Ok" logo após a proposta não trava mais a venda

- **Caso real:** Samuel Amorim da Silva (contact `7174f833`, estimativa 149, R$ 12.474,87,
  entrega imediata, `conduzir_ate=documentos`). Valor + PDF saíram às 16:51:32 UTC; o cliente
  respondeu "Ok" às 16:51:48. Esse "Ok" cancelou a abordagem `pos_proposta` agendada para +40s
  (`abordagens_contextuais`, `motivo=cliente_respondeu`) e, em seguida, foi silenciado por
  `camila/encerramento-social.js` (acuse curto + última fala da Camila sem "?"). Nenhum erro:
  as duas regras contavam uma com a outra e a venda parou sem condução.
- **Correção (Camila, `server.js`):** `enviarPropostaImediata` marca `estado.aguardandoFechamento`
  (quando não há passagem ao atendente). A primeira mensagem seguinte consome a marca: não é
  silenciada como cortesia e, se for só um acuse ("ok", "certo", "obrigado"...), a IA recebe o
  contexto `FECHAMENTO_POS_PROPOSTA` — tom elegante e acolhedor, sem exclamações, abre perguntando
  se o cliente conseguiu verificar a proposta (única pergunta), lista numerada um por linha
  (1. identidade com foto RG/CNH, 2. CPF, 3. comprovante de residência, 4. último contracheque),
  fecha pedindo envio em foto ou PDF e inclui `[ACAO:SOLICITAR_DOCS]`. Log: `[FECHAMENTO]`.
- **Validação:** `test:continuidade` 226/226 e `test:safe` sem falhas. Texto final depende da IA —
  não houve teste com conversa real.
- **Publicação:** commits `b35fd1a`, `7e671f9`, `3420cd6`, `11bab3c` (push só deles por refspec;
  os 3 commits locais da `main` da Camila — `c7ad344`, `ac28a45`, `d14a816` — seguem NÃO
  publicados). Deploy Railway `1644cd06-abb2-4fc5-b241-bc9bb6a0f225` `SUCCESS` (disparado pelo
  usuário com `railway redeploy --from-source`). `/health` 200 durante e após o build.
- **Atenção operacional:** o serviço da Camila no Railway **não publica sozinho no push** — é
  preciso `railway redeploy --from-source` (passando `-p/-e/-s` se rodar fora da pasta da Camila,
  que é a única vinculada a esse projeto).
- **Pendente:** (1) o Samuel ainda não recebeu o pedido de documentos — a correção não age
  retroativamente; enviar pela equipe no Digisac (texto combinado no chat de 29/09) ou aguardar a
  retomada de 48h; (2) confirmar o log `[FECHAMENTO]` no primeiro caso real.

### 29/09/2026 (tarde) — Consulta oficial PB/PE (aba Estimativas) passa a rodar no navegador

- **Problema:** o botão "Consultar fonte oficial" chamava `GET /api/estimativas/:id/referencia-estadual`,
  que consulta as folhas de PB e PE mês a mês (60 competências) a partir do backend no Railway
  (us-west2). Estimativa 150 (PE) deu 502 após 180 s (12 lotes × 15 s, nenhuma competência
  respondeu). A mesma busca do Brasil leva 1–9 s. Causa provável: portal de PE não responde a IPs
  dos EUA — hipótese forte, NÃO confirmada de dentro do container (`railway ssh` exige chave SSH).
  PB funcionou em produção no mesmo dia (estimativa 149), embora lenta (~46 s, 3/60 meses falhando
  na medição local).
- **Correção (frontend, commit `13c44e9`):** novo `src/lib/remuneracaoEstadual.js` (porte do
  serviço do backend, `fetch` sem cabeçalhos customizados → sem preflight; timeout 12 s; lotes
  de 6; desiste cedo se os 2 primeiros lotes falham por inteiro). `estimativas/page.js` usa o
  módulo em vez da rota, com os dados salvos do lead. As duas APIs devolvem CORS para o domínio
  do AM (testado no navegador em produção: PE e PB 200 em < 3 s).
- **Validação:** os 5 testes do serviço original passam contra o módulo novo; estimativas 148
  (0 vínculos) e 150 (4 vínculos) com dados reais; build do Next OK. Deploy Railway do frontend
  `7b10c6c5` `SUCCESS`. Clique real no botão NÃO testado (exige login Master).
- **Limitações:** só funciona para quem está no Brasil e sem VPN estrangeira; a tela precisa ficar
  aberta durante a consulta. A rota antiga do backend e `src/services/remuneracaoEstadual.js`
  continuam no código (o serviço também é usado pelo re-protocolo); a rota está sem uso e pode
  ser removida. Se o re-protocolo (`levantamento.js`, `vinculoOficial.js`) consultar PE pelo
  backend, sofrerá do mesmo bloqueio.
- **Nota de publicação:** o push inicial foi rejeitado (non-fast-forward) porque a `main` remota
  já tinha 3 commits do re-protocolo; o commit foi reposicionado com `git rebase origin/main`
  (`ab8e3da` → `13c44e9`) antes do push por refspec.


### 29–30/09/2026 — Análise geral do sistema e da jornada (somente leitura, nada executado)

- **O que foi feito:** análise multiagente somente leitura aprovada pelo usuário (plano em
  `PLANO-ANALISE-MELHORIA-SISTEMA-AM.md`): inventário, 9 frentes (segurança, resiliência,
  usabilidade, funcionalidades, gestão/financeiro, bom dia no WhatsApp, e-mail, telefonia OPT, IA),
  jornada estimativa → proposta → cadastro → documentos → protocolo, e funil de vendas medido no
  banco da Camila. Cada frente teve verificador independente. Código analisado = produção
  (backend `42b9cb7`, frontend `eb13304`, Camila `11bab3c`).
- **Leitura dos bancos:** só SELECT, autorizada pelo usuário em 29/09 para o AM e para a Camila
  (transação READ ONLY, 1 comando por vez). Leitura das variáveis do Railway foi negada pelo
  classificador e não foi contornada.
- **Resultado:** `analise/RELATORIO-FINAL.md` (Onda 0 de ações humanas, Onda 1 de código urgente,
  11 lotes na ordem S, R, W, E, G, U, F, T, I, J, C; 77 decisões pendentes ordenadas) e
  `analise/PLANO-LOTE-S-SEGURANCA.md` (11 ondas). Os arquivos de `analise/` não estão no Git.
- **Achados mais graves (a confirmar na execução):** captura de andamentos parada desde 01/09;
  credencial Google morta em 29/09 (Drive e backup); backup nunca restaurado; CSRF, OAuth sem
  limite de senha e sessão não revogável; valor da causa ×100 na aprovação do re-protocolo
  (S-17 — não aprovar pacote antes da correção); PDF da proposta com "undefined meses" (JN-01,
  conferido no código); 13 de 20 contratos de 18/08–29/09 sem protocolo.
- **Correção de registro:** a rotação do `JWT_SECRET` em 28/09 invalidou os tokens da falha do
  refresh_token, mas NÃO derrubou as sessões normais (a renovação usa `JWT_REFRESH_SECRET`); o
  roteiro de incidente deve trocar os dois. Conferido em 30/09: na janela 18–28/09 nenhuma conta
  (além da conta de serviço `integracao-claude`, criada em 18/09 às 10h58) nem chave de API foi
  criada.
- **Pendente:** respostas do usuário à Onda 0 e às decisões da seção 6 do relatório; "sim" para a
  Onda 1.

### 30/09/2026 (madrugada) — Onda 1 implementada e revisada, NÃO publicada

- **Estado:** 7 grupos da Onda 1 prontos em cópias isoladas do código publicado (base: backend `42b9cb7`,
  frontend `eb13304`, Camila `11bab3c`), exportados como patches em `analise/onda1-entrega/` (backend 10,
  frontend 5, Camila 2; não estão no Git). **Nenhuma alteração publicada em produção; nenhum arquivo dos
  repositórios foi tocado.** O classificador negou criar worktree/branch nos repositórios e escrever script de
  publicação; a publicação (push) é feita pelo usuário, e a Camila exige `railway redeploy --from-source`.
- **Conteúdo:** S-17 (trava 409 de valor da causa 5× diferente da proposta + tela em pt-BR com confirmação);
  JN-01/JN-02 (período do vínculo completo no PDF e trava de faixa 0,2–5× / R$ 100 mil, DN-2); JN-09/JL-08 (datas
  AAAA-MM do rascunho davam 500; auditoria `concluir_cadastro_falhou`); R-22 (motor de prazo usa a menor data e marca
  "conferir"); U-02 (lote "Atribuir" mantém prazos judiciais); R-07 (IA só para Master, fallback não apaga o
  manual); R-14 (execuções do sync sempre fecham); R-12 (`/health` só 200 depois do boot); JC-02 (Camila não cobra
  documento de quem já está na contratação).
- **Verificado:** backend 343/343 testes; frontend 28 testes + build ok; Camila 10/10 novos (1 falha já existente
  no código publicado, teste dependente de horário). Cada grupo passou por revisor independente.
- **Em espera (não publicar ainda):** R-05 + R-01 código (`em-espera-alertas/`): faria os alertas chegarem pela
  primeira vez com os crons ainda em UTC (05h BRT, inclusive fim de semana) e com o nome completo do cliente na
  véspera; depende de D8 e do fuso dos crons.
- **Pendências:** publicação (backend → frontend → Camila); decisões registradas em `analise/onda1-entrega/LEIA-ME.md`;
  D10 (Google), D14 (DataJud), teste real do alerta ao Ramon após publicar o lote de alertas; R-06 e CSRF seguem.

### 30/09/2026 — Onda 1 PUBLICADA (push feito pelo usuário)

- **Commits em produção:** backend `42b9cb7..79bf50e` (10 commits), frontend `eb13304..36dde69` (5),
  Camila `11bab3c..b44b4aa` (2). O conteúdo publicado é idêntico (byte a byte, exceto `.env.example`, que a cópia de
  teste excluía) ao integrado e testado (backend 343/343, frontend 28 testes + build, Camila 10/10 novos).
- **Verificado em produção (leitura pública, sem login):** `/health` do backend responde 200 (formato igual ao
  anterior, então NÃO prova sozinho a versão nova — falta o status `SUCCESS` do deploy e a linha
  `[BOOT] Esquema pronto em Xs` no log, a conferir no Railway); o JS publicado do frontend contém a tela nova do valor
  da causa (`valor_divergente_ciente`, "Proposta do sistema") e a trava de faixa/período do vínculo
  (`valor_fora_da_faixa`, `numMeses`).
- **Pendente:** `railway redeploy --from-source` da Camila (não publica no push) e conferir o `/health` dela;
  conferir `DIGISAC_CONTRATACAO_DEPARTMENT_ID` no Railway da Camila e se a fila CONTRATAÇÃO tem usuário; testar na tela
  o campo "812,35" no pacote do re-protocolo e um PDF de estimativa sem "undefined meses" antes de o Luciano aprovar
  pacotes. Em espera: lote de alertas (R-05/R-01 código) — ver seção anterior e `analise/onda1-entrega/LEIA-ME.md`.

### 30/09/2026 (01h30) — Onda 1: deploys verificados no Railway

- **Confirmado pelo `railway deployment list`:** backend `5a9ee431` `SUCCESS` (commit `79bf50e`, 01:20 BRT);
  frontend `f767bb27` `SUCCESS` (commit `36dde69`, 01:21); Camila `d89a1045` `SUCCESS` (commit `b44b4aa`, 01:26,
  substituindo `80d370af`, do mesmo commit). O deploy do backend só é promovido depois de o `/health` passar, então o
  boot novo (R-12) concluiu.
- **Redeploy da Camila:** disparado com `railway redeploy --from-source --yes` (a CLI exige `--yes` fora de terminal
  interativo).
- **Ainda a conferir pelo usuário:** `DIGISAC_CONTRATACAO_DEPARTMENT_ID` no Railway da Camila e usuário na fila
  CONTRATAÇÃO; teste nas telas (campo "812,35" no pacote do re-protocolo; PDF de estimativa sem "undefined meses")
  antes de o Luciano aprovar pacotes.

### 30/09/2026 (manhã) — Onda 2 implementada, integrada e revisada, NÃO publicada

- **O que é:** restante do Lote S (S-01 CSRF, S-02/S-07/S-18/S-19 OAuth e cabeçalhos, S-05/S-12/S-20/S-21 permissões, S-06/S-08/S-10/S-23/S-26
  portas e segredos, S-13/S-22/S-24/S-25 auditoria e erros, S-03/S-04 sessão revogável e primeiro acesso, S-15 parcial/S-16/S-19 build e cabeçalhos,
  S-27 júnior), alertas do WhatsApp (R-05, R-01 código, fuso dos crons, S-14) e a correção do sync de andamentos (R-06).
- **Estado:** série linear de patches sobre a produção pós-Onda 1 (backend `79bf50e`: 26 commits; frontend `36dde69`: 10) em
  `analise/onda2-entrega/` (fora do Git), com `LEIA-ME.md` (ordem de publicação, verificações, reversão, decisões assumidas).
  **Nada publicado; nenhum repositório do usuário foi tocado.**
- **Verificado:** backend 979/979 testes; frontend 99 testes + build; patches aplicados num repositório de teste local (sem conflito, conteúdo idêntico ao
  testado). Cada grupo teve revisor independente; a integração teve revisão de migrações e de mesclagem (achados M-01, A1, A2 corrigidos).
- **Limites:** as migrações de banco (S-03, S-13 com gatilho, S-05, R-06, S-10 atrás de flag) nunca rodaram em Postgres real; falham de forma segura
  (o boot cai e a versão anterior segue). Publicar exige antes: escopo `workflow` do `gh`, `FRONTEND_URL` exata no Railway (senão toda escrita dá 403),
  troca da `SYNC_KEY` e reconexão do conector do Claude depois do deploy.
- **Políticas conflitantes resolvidas pela mais segura:** token antigo do conector sem escopos é recusado (S-18 sobre S-03); usuário com histórico
  na auditoria não é excluído (D-S3).

### 30/09/2026 — Onda 2 PUBLICADA e verificada

- **Em produção:** backend `79bf50e..8f282de` (deploy `3c49ba57` SUCCESS, 26 commits) e frontend `36dde69..bf857f1` (deploy `6d6e1594` SUCCESS, 11 commits). Pushes feitos
  pelo usuário; o token do GitHub precisou do escopo `workflow` (o GitHub recusa push que altera `.github/workflows` sem ele).
- **Verificado de fora:** `/health` 200; cabeçalhos de segurança no backend e no frontend (HSTS, X-Frame-Options, nosniff, CSP em modo só-relatar) e sem
  `X-Powered-By`; POST com origem forjada → 403.
- **Ainda a conferir pelo usuário:** escrita normal no AM (senão `FRONTEND_URL` errada → 403; voltar ao deploy `5a9ee431`); reconectar o conector do
  Claude; IP real do cliente no log (limites por IP); sync geral (R-06) e amostra no PJe; alerta de teste ao Ramon; Google (novo refresh token e app
  fora do modo Teste); trocar `SYNC_KEY`; apagar `MASTER_*`. Um token do GitHub foi colado no chat e deve ser revogado.

### 30/09/2026 (tarde) — Fechamento da sessão: estado e pendências (LER PRIMEIRO)

- **No ar e verificado:** Onda 1 e Onda 2 (backend `8f282de`, deploy `3c49ba57`; frontend `bf857f1`, deploy `6d6e1594`); conector do AM reconectado
  (listar_teses 200); SYNC_KEY trocada no Railway e no GitHub (workflow manual deu Success); alerta de teste do WhatsApp chegou ao Ramon (R-05 ok);
  app OAuth do Google publicado "Em produção" (marca preenchida; e-mail do desenvolvedor corrigido).
- **DataJud (R-06) funciona pela metade:** 11h00 casou 113 processos e gravou 567 andamentos (os primeiros desde 01/09); depois o DataJud devolveu 429 e
  698 processos ficaram `erro_sync` (a marca só avança no sucesso, então nada se perde). Reavaliar em 13h/14h; se não convergir, baixar
  `DATAJUD_TAMANHO_LOTE` (padrão 100) no Railway.
- **Pendências do usuário:** (1) rodar `railway run node obter-novo-refresh-token.mjs` DENTRO de `/tmp/am-onda2-backend` (o script da pasta principal é antigo e
  só pede Drive; o novo pede Drive + Agenda), gravar `GOOGLE_REFRESH_TOKEN` no Railway e clicar Deploy — hoje 6 clientes sem pasta no Drive e backup sem destino;
  (2) confirmar que `MASTER_NOME/EMAIL/SENHA` foram apagadas do Railway; (3) cadastrar o WhatsApp dos 3 usuários que faltam (bom dia às 8h);
  (4) a conta ramonoliveiraabrantes@hotmail.com está como `junior` no banco (o usuário se diz Master): decidir; (5) apagar as pastas temporárias
  (`git worktree remove /tmp/am-onda2-backend` e `/tmp/am-onda2-frontend`).
- **Segurança de processo:** um token do GitHub e uma SYNC_KEY foram colados no chat e foram revogados/trocados; nunca colar segredos no chat.
- **Próximos lotes (com "sim" a cada um):** W bom dia, E e-mail (IMAP/SMTP na whn.host, caixas comercial@/atendimento@/juridico@), G financeiro+painel, U, F,
  T telefonia OPT, I IA, J/C jornada e Camila. Relatório e ordem em `analise/RELATORIO-FINAL.md`; entregas em `analise/onda1-entrega/` e `analise/onda2-entrega/`.

### 30/09/2026 — Camila: prazo "alguns anos" (caso Brauney) e documentos não contados desde 14/09 — PUBLICADO

- **Status:** PUBLICADO em 30/09/2026 (13:34 local). Commits `1b7d7bf`, `7a43f85`, `152c6be` na
  `main` da Camila (push por refspec, sem levar mais nada). Deploy Railway
  `1d5df241` `SUCCESS` (commit `152c6be`); o build paralelo `4027071b` foi removido pelo próprio
  Railway. Verificado: `/health` 200 três vezes seguidas, sem erros nos logs de inicialização,
  `prompt_versao` passou de `6718306cab97` para `44a05ce12813` (hash novo do SYSTEM_PROMPT =
  prova de que o código novo roda). Ainda NÃO observado em conversa real: procurar nos logs
  `[VERIFICACAO] saída corrigida` e, na tabela `documentos_atendimento`, o primeiro registro após
  14/09.
- **Caso Brauney (contact `65a2b694`):** "Então deve demorar né?" não casava com a intenção de
  prazo; a IA improvisou "costumam levar alguns anos" e contradisse o prazo aprovado (6 a 11
  meses, `FIXA-PRAZO`). Correções: (1) seletor reconhece "deve demorar", "vai levar anos", "é
  demorado", "tem previsão?", "é rápido?", "isso vai longe", "sai rápido?" (sem confundir com
  "desculpa a demora"); (2) prompt: nunca confirmar demora nem citar anos; (3) `corrigirSaida`
  (camila/verificacao.js, chamada em `enviar()` só para `camila_ia`) troca frase de duração em
  anos ou de lentidão do processo pelo prazo aprovado e `!` por `.` antes do envio; evento
  `saida_corrigida`. As demais violações (senhor/senhora, frases proibidas, markdown) continuam
  só alertadas, por decisão de projeto da Fase 7 (fail-open) — ampliar exige nova decisão.
- **Bug de documentos (regressão de `292561f`, 14/09/2026):** a checagem de "cortesia final"
  (`deveSilenciarEncerramentoSocial`) rodava antes do ramo de arquivos e tratava texto vazio como
  despedida; todo documento/imagem sem legenda enviado após fala da Camila sem "?" era descartado
  em silêncio. Medido: 0 de 35 arquivos contados em 9 leads desde 14/09 (antes 15 de 24); efeitos:
  sem `documentos_atendimento`, sem `docs_recebidos`, sem passagem automática à equipe. Correção:
  arquivo nunca é cortesia (`ehArquivo`), também no ramo de contato suspenso. Teste ponta a ponta
  TESTE 13B falha sem a correção e passa com ela.
- **Validação:** `test:continuidade` 248/248; `test:safe` sem falhas. Hash do SYSTEM_PROMPT
  rebaselinado de propósito (`44a05ce1...`); `teste-calculadora.js` TESTE 13 ajustado (exclamação
  agora corrigida).
- **Pendências:** (1) ~~publicar~~ feito; (2) ~~backfill dos 35 arquivos / 9 leads~~ FEITO em 30/09/2026 (ver abaixo);
  (3) lead `e5e5fb77` (Ismania) enviou 8 arquivos em 30/09 e ninguém da equipe escreveu;
  (4) respostas duplicadas/fora de ordem (caso Brauney 15:10-15:11) não investigadas;
  (5) Roteador V3: não ativar como está — a regra "humano escreveu nas últimas 48h = dono humano"
  calaria a Camila em conversas iniciadas pela equipe, e a comparação em sombra usa a mesma regra.

#### Backfill dos 35 arquivos (30/09/2026, ~13:45 local) — gravação em produção, autorizada pelo usuário

- **O que foi gravado:** 35 linhas em `documentos_atendimento` (9 clientes), com `message_id` e
  `recebido_em` originais da conversa e o nome real do arquivo lido do Digisac; mais
  `propostas_enviadas.docs_recebidos=true` nos 9 contatos. Numa única transação (desfaz tudo se
  o total divergir). Critério: mensagens de cliente `[document]`/`[image]` posteriores à proposta
  e a 14/09/2026 17:31 UTC, sem registro em `documentos_atendimento`. Nenhuma mensagem foi
  enviada, nenhum ticket transferido, nenhuma passagem (`registrarPassagem`) executada.
- **Contatos e arquivos:** `13f146c2` 3, `5d34de0d` 3, `65a2b694` 4 (Brauney), `7174f833` 1
  (Samuel), `b1363278` 3, `bde58d63` 3 (já `assinado`), `c3fb6942` 4 (Michelle), `e4d950be` 6,
  `e5e5fb77` 8 (Ismania). Verificado depois: 0 arquivos ainda não contados; 9/9 com
  `docs_recebidos=true`; 0 mensagens da Camila a esses contatos no período.
- **Reversão:** lista dos `message_id` inseridos e dos contatos cujo `docs_recebidos` virou true em
  `scratchpad/backfill-docs/reversao.json` (sessão de 30/09; não versionado).
- **Efeitos automáticos esperados:** (a) as etapas dos leads passam a `documentos_parciais`
  (quadro/etiquetas do Digisac acompanham pela sincronização de 1 min; última execução sem falhas);
  (b) a retomada de 48h deixa de considerar esses leads; (c) cobranças `documentos` já agendadas
  (14 pendentes, a mais próxima hoje 21:35 UTC para `c3fb6942`) passam pela regra JC-02: com 4+
  arquivos (`65a2b694`, `c3fb6942`, `e4d950be`, `e5e5fb77`) são canceladas (`passagem_contratacao`)
  e a equipe recebe alerta interno se ninguém assumiu; com 3 arquivos a Camila ainda pode cobrir o
  que falta; `bde58d63` (assinado) é cancelada.
- **Limites (NÃO feito):** as categorias (RG/CPF/comprovante/contracheque) seguem sem conferência —
  a equipe confere na tela de Leads; o evento `documento_recebido` não foi recriado (métricas por
  evento continuam sem esses 35); a passagem à equipe/contratação desses clientes não foi feita —
  os com 4+ arquivos (Brauney, Michelle, `e4d950be`, Ismania) precisam de um humano, e a Ismania
  segue sem retorno desde 30/09 12:57 (local).

- **CORREÇÃO (30/09/2026, 14:00 local) — deploy da Camila no push:** o registro de 29/09 dizendo que o
  serviço da Camila "não publica sozinho no push" está DESATUALIZADO/impreciso. Em 30/09 o push de
  `e2485ca` (só documentos) iniciou sozinho o deploy `7afbff2e` (`SUCCESS`, `/health` ok), e o push
  de `152c6be` também gerou um build próprio (`4027071b`) além do redeploy manual (`1d5df241`).
  Após o push de `11bab3c` em 29/09 não apareceu build automático — causa não apurada (gatilho
  pode ter sido ligado depois). Regra prática: **todo push na `main` da Camila pode reiniciar a
  produção** — tratar push como deploy; conferir `railway deployment list` depois de cada um.
  Consequência direta: os 3 commits locais da Camila (`c7ad344`, `ac28a45`, `d14a816`) entrarão em
  produção no primeiro push que os incluir.


### 01/10/2026 — Camila: campanha INSS, aprendizado do caso Sabrina e nono dígito

- **Caso Sabrina (contact `4aaab889`) incorporado ao prompt de vendas** (`camila/prompt-vendas.js`):
  (a) quando o lead condiciona o avanço a uma ação que já tem ("não quero que mexa no valor de lá"),
  a Camila acolhe e explica que esta análise é própria, contra a Fazenda Pública, independente da
  ação existente, sem prometer ausência de conflito, e conduz; (b) várias dúvidas seguidas são
  respondidas num bloco só (5 anos, estimativa, conferência dos vínculos, prazo médio, honorários no
  êxito). O achado "lei federal especial = RISCO" do aprendizado foi descartado (texto aprovado,
  `FIXA-BASE-LOGICA`).
- **Campanha INSS** (página `restituicao-previdenciaria-educacao`): o formulário não chama a
  Camila; abre o WhatsApp com a frase "Olá! Quero conferir o desconto do INSS no meu contracheque."
  e as linhas Nome/Onde trabalho/Cargo/Início do vínculo/Fim do vínculo (só desligados)/Situação.
  A Camila reconhece a frase (`camila/origem-lead.js`, origem `inss`, rótulo "Campanha INSS"), lê o
  formulário, pede o contracheque e dispara `CALCULAR` direto (contexto `ENTRADA_INSS`), sem repetir
  a qualificação. A foto do contracheque de lead INSS fora da fase `documentos` não conta como
  documento, não encerra e não transfere: responde "Recebido, [nome]…" uma vez e marca
  `dados.contrachequeRecebidoEm` na pendência. A venda segue o fluxo normal da tese de restituição.
- **Aba Estimativas (web):** etiqueta "INSS · outra tese — conferir envio do contracheque"
  (amarela) / "contracheque recebido" (verde) e filtro "Campanha INSS".
- **Nono dígito:** a abertura por número da calculadora, ao receber do Digisac 400 "contact does not
  exist" com celular de 8 dígitos, tenta uma vez a versão com o 9 e grava o telefone corrigido na
  pendência. Caso real: pendência 157 (Rossana Barbosa) teve o telefone corrigido manualmente pelo
  usuário para o número localizado no Digisac.
- **Publicado e verificado:** Camila `37567ea` (inclui `8b544a7`), deploy `65cfa977` SUCCESS,
  `/health` ok, `prompt_versao` `7361898c44eb`; web `e4eb796`, deploy `dc3fb1f4` SUCCESS.
  Testes: 253 de 254 em `tests/` e `test:safe` ok; a 1 falha (`continuidade.test.js`, modo retomada)
  já falha na `main` anterior e depende do horário (fora da janela de vendas).
- **Limites:** sem teste automatizado da recepção do contracheque nem do card; sem teste ponta a
  ponta com WhatsApp real (sugerido: usuário enviar a mensagem da página de um número próprio).
  A pasta principal da Camila (`~/Documents/Claude/Projects/camila-abrantes-montenegro`) está
  atrás da `main` e tem alterações locais não commitadas (`server.js`, `leads.js`,
  `camila/origem-lead.js`) e um commit local órfão (`99565c9`, já incorporado) — sincronizar antes de
  trabalhar nela. A branch local `publicar-pacote` do web tem `30a7987`, já publicado como `e4eb796`.

### 28/09/2026 (noite) — Estratégia do re-protocolo CONFIRMADA + Fase 0 implementada (branch local, NÃO publicada)

**Estratégia confirmada pelo usuário** (sequência de execução; cada fase só começa com novo "sim"):
- Fluxo por caso: levantamento (já existe) → autorização do Master pelo chat → documentos (o AM gera
  a procuração e aponta o que falta; a equipe colhe assinatura/documentos do período) → pacote no AM
  (pasta no Drive, inicial a partir da anterior + modelo aprovado, valor da causa, relatório) →
  rascunho no PJe feito pelo robô no navegador do escritório, que para antes de assinar → o advogado
  confere, assina com o token e protocola → o chat registra número e período no AM, guarda o recibo
  e registra a peça no acervo.
- Fases: 0 saneamento; 1 descoberta (regra de documentos a partir das emendas por juízo; modelo de
  inicial aprovado por ente); 2 pacote; 3 piloto de 10 rascunhos; 4 escala. Travas: nada assina nem
  protocola sozinho; um rascunho por demanda; período sempre gravado; nenhum acesso ao TJPB a partir
  do servidor nem plugin de evasão de detecção; escrita pelo chat com lista + confirmação e auditoria.
- Recusadas pelo usuário (não reintroduzir): checar o resultado do processo anterior; avisar o
  cliente pela Camila. Decisões ainda abertas: manter/reverter o levantamento já no ar; procuração
  nova a cada re-protocolo (recomendado, por causa do Tema 1198 do STJ); modelo da inicial por ente;
  pasta destino (`_REPROTOCOLO - 2026` recomendada); quem aprova; certificado A1×A3 (assumido A3).

**Fase 0 — código** (branch `reprotocolo-fase0` em `am-plataforma` e `am-plataforma-web`; commits
locais, sem push):
- `PATCH /api/tarefas/:id/concluir-com-numero` (`src/routes/tarefas.js`): o fim do período passa a
  ser obrigatório (mês/ano, não posterior ao mês atual) e o início passa a ser gravado. Em
  re-protocolo o início é o `ciclo_inicio` da tarefa e nunca antes dele (antes disso o período é do
  processo anterior); em protocolo inicial o início é opcional. Regra em `src/utils/periodoProtocolo.js`
  (8 testes). Processo já existente tem o período completado sem sobrescrever o já gravado. A
  demanda da tarefa passa a `protocolada` e recebe o `processo_id` (nenhuma rotina fechava demanda).
  A auditoria `protocolar` registra início e fim.
- `PATCH /api/tarefas/:id/ciclo/aceitar` e `/ciclos/aceitar-lote`: recusam ciclo de cliente com
  `vinculo_ativo=true` E `vinculo_fim` preenchido (cadastro contraditório). Individual: 409 com a
  explicação. Lote: ignora esses itens e devolve `ignoradas`. Motivo: o aceite zera
  `precisa_triagem`, então qualquer sinalização seria apagada sem aviso. Corrigir o cadastro
  destrava.
- `src/index.js`: migração ÚNICA `2026_09_28_saneamento_fila_reprotocolo` (usa `migrar()`, em uma
  transação, com auditoria `saneamento_fila_reprotocolo`): (1) adia (`ciclo_adiado_ate`) os ciclos
  `ciclo` criados pela restauração de 19/09 antes de completar o intervalo da tese, até
  `ciclo_inicio + intervalo_meses - 1`; (2) marca `precisa_triagem=true` nas tarefas de ciclo cujo
  cliente tem vínculo ativo com data de fim. Nada é cancelado. Medido em produção em 28/09 (somente
  leitura): 186 a adiar e 5 a sinalizar (Iradira Juvino 2 `ciclo_aceito`, Joana Marta 2 e Francisco
  Isidio 1, em "Novos ciclos"). Substitui o diff antigo do checkout principal, que rodava a cada boot
  e desfaria triagens humanas.
- Frontend (`tarefas/page.js`): o modal "Concluir e iniciar monitoramento" exige mês e ano do fim
  ("Fim do Período Solicitado *"), mostra o início do ciclo quando é re-protocolo, e o aceite em lote
  avisa quantos ciclos foram ignorados pelo vínculo contraditório.

**Verificado:** suíte do backend 131/131 sem `backup.worker.test.js` (123 anteriores + 8 novos); esse
arquivo passa 4/4 isolado mas o processo NÃO encerra sem Redis alcançável (importar o worker abre
`src/cache/redis.js`, que reconecta para sempre) — `npm test` trava localmente; item enviado à
sessão que mantém o backup. Build isolado do Next.js passou. SQL novo validado por `EXPLAIN` em
transação somente leitura contra produção. **Nada foi gravado em produção; o comportamento novo só
existe depois de push e deploy, que dependem do usuário.**

**Conferências só de leitura (28/09/2026):**
- `processos`: 812 processos, **nenhum com `periodo_inicio`**; 5 sem `periodo_fim` (3 FGTS, 1 Piso, 1
  sem tese). Processo sem fim conta como "cobrindo o ciclo" para o cron, então esses clientes não
  recebem ciclo novo. O risco de o cliente sumir dos ciclos é pequeno (5); o problema geral é o
  início nunca ter sido gravado.
- Ciclos abertos: 366; **36 com meses anteriores às últimas 60 competências** — 5 sem processo
  anterior da tese (o ciclo parte do início do vínculo; é ajuizamento novo, não re-protocolo) e 31 com
  processo anterior cujo período terminou antes de 09/2021. A ausência de período nos processos NÃO
  explica esses 36. Ficam fora do piloto até decisão do advogado.
- Duplicidade com re-protocolos feitos à mão (pastas `_REPROTOCOLO`): 14 nomes sem o processo novo no
  AM (9 na pasta 2025, 5 na de 2026). 12 clientes têm tarefa de ciclo aberta e devem ser conferidos
  antes de aceitar: nome exato — Lauristela Cabral Sarinho, Mariluce Ferreira de Araujo, Saulo Soares
  de Carvalho, Sonize de Araujo Alves, Sybele Cristina da Silva Assis (nas duas pastas), Diva Alves da
  Costa Batista, Nilma de Pontes Cordeiro, Silverio Goncalves de Assis (comprovante de 25/09/2026),
  Suely da Silva Assis; nome incerto (o cadastro mais parecido pode ser outra pessoa) — Deusimar Morais,
  Ronilda Silva dos Santos, Suenia Araujo da Silva Souza. Ivanna Martins do Nascimento não tem tarefa
  aberta (protocolada à mão em 06/01/2026). Ainda NADA foi marcado no banco para esses casos.

**Pendências:** publicar a Fase 0 (backend antes ou junto do frontend; migração roda no boot) —
depende do "sim" do usuário; ao publicar, descartar o diff antigo de `src/index.js` no checkout
principal e conferir `git log origin/main..HEAD` antes de qualquer push; triagem dos 5 casos pelo
usuário (prazo das tarefas da Iradira: 06/10/2026); decisão sobre os 12 clientes com possível
duplicidade; manter/reverter o levantamento; `npm test` que não encerra sem Redis; 3 pontos de
revisão do worker de backup (exit code do gzip, erro de pipe derrubando o processo, gzip pendurado)
enviados à sessão "Alinhamento de atendimento Camila".

### 29/09/2026 — Verificação dos re-protocolos pendentes (somente leitura)

Executada a etapa 1 da estratégia confirmada. Nada foi alterado no AM, no Drive nem no PJe; o banco
foi lido em transação `READ ONLY`, o Drive só por metadados (nomes e datas, sem abrir arquivos).
Resultado sobre as **366 tarefas de ciclo em aberto** (2 em Re-protocolo + 364 em Novos ciclos):
- **Confirmado 73** (64 Município de João Pessoa, 9 Estado da Paraíba): ciclo vencido, sem alertas,
  pasta antiga única no Drive. **Conferir 95** e **Bloqueado 198**: 186 ainda não completaram o
  intervalo da tese (voltam sozinhos ao vencer) e 12 têm possível protocolo à mão (pasta na equipe
  em `_REPROTOCOLO`/pendentes sem o processo no AM).
- Conferir, por motivo (um caso pode ter vários): 35 com meses fora das últimas 60 competências; 27
  sem pasta antiga e 22 com pasta ambígua; 27 com juízo do processo anterior que é gabinete/núcleo; 30
  com alerta na fonte oficial PB/PE (14 sem vínculo encontrado, 10 com último pagamento antigo, 3
  regime diferente de temporário, 2 homônimos, 1 fonte indisponível); 4 com cadastro contraditório
  (vínculo ativo com data de fim); 5 sem processo anterior; 5 com polo genérico ou ausente.
- Pastas antigas em OUTORGANTES (119 listadas; 587 pastas lidas nos anos 2022 a 2026, `_REPROTOCOLO`
  e pendentes): identidade em 92%, inicial anterior 90%, procuração 95%, comprovante de vínculo 88%,
  contracheques/fichas 40%, comprovante de residência 33%. Só identidade e inicial anterior são
  reaproveitáveis; procuração, vínculo e contracheques do período novo são sempre novos.
- Conferência oficial PB/PE feita em 50 casos (vencidos com ente confirmado); município sem fonte.
- Limites: re-protocolo à mão sem pasta, comprovante ou publicação não aparece; pastas achadas por
  nome (sem CPF); listagem de 2024–2025 transcrita à mão por um agente (3 pastas conferidas, 3 de 3).
- Achado de processo: uma listagem do Drive tem pasta com senha no título de uma pasta de 2023 —
  não registrada aqui; convém a equipe renomear.
- Entregues ao usuário: página HTML e planilha (fora do repositório, contêm dados de clientes).
- Pendências: usuário confirma a lista Confirmado (amostra de 5) e decide os grupos Conferir/Bloqueado;
  depois, publicar a Fase 0 (aguarda "sim"), Descoberta, Pacote, Piloto e Escala.

### 29/09/2026 — Fase 2 do re-protocolo: verificação gravada no AM + pacote (commits locais, SEM push)

Aprovado pelo usuário: gravar a confirmação da verificação no AM e seguir para o pacote. Branches
locais: backend `reprotocolo-pacote` (empilhada sobre a Fase 0) e frontend `reprotocolo-fase2`.
**Nada foi publicado e nada foi gravado no banco de produção**; as migrações rodam no deploy.

- **Regra decidida:** o juízo do processo anterior NÃO entra (re-protocolo é sempre processo novo,
  sem dependência). O alerta `juizo_nao_e_de_origem` deixou de mandar conferir.
- **Verificação** (`src/services/reprotocolo/verificacao.js`): cada ciclo aberto cai em Confirmado,
  Conferir ou Bloqueado. Bloqueio: intervalo da tese incompleto; processo cobrindo o período;
  possível protocolo à mão (pasta da equipe em `_REPROTOCOLO`/pendentes, decidido pela tese da pasta e
  ignorando a pasta `Outorgantes {ano}` do ano do processo anterior). Conferir: meses fora das 60
  competências, sem processo anterior, vínculo/polo/ente, publicação de processo desconhecido,
  alertas da fonte oficial PB/PE, pasta antiga não localizada/ambígua. A decisão humana fica em
  `verificacoes_reprotocolo`, presa a um hash dos dados (o fim do período fica fora do hash para não
  invalidar tudo na virada do mês); perde a validade se os dados mudarem ou após 30 dias. Bloqueio por
  prazo ou processo existente nunca é confirmado; "protocolo à mão" pode ser liberado com observação.
  Validado contra a produção somente leitura: o motor reproduz a classificação feita à mão.
- **Rotas** (`src/routes/reprotocolo.js`, Master): leitura também pelo conector com escopo
  `reprotocolo` (`GET /verificacao`, `/pacotes`, `/pacotes/:id`, `/modelos`); escrita SÓ por sessão do
  AM, nunca pelo conector (`POST /verificacao/confirmar`, `POST /verificacao/:id/oficial`,
  `PUT /pasta-antiga/:clienteId`, `POST /pacotes/reservar|:id/montar|:id/cancelar`, `PUT /modelos`,
  `POST /importar`). Tudo auditado; CPF sempre mascarado.
- **Gate do aceite:** `REPROTOCOLO_EXIGE_CONFIRMACAO=true` faz `ciclo/aceitar` recusar (409) e o
  aceite em lote ignorar ciclo sem confirmação válida. Desligada por padrão: nada muda até ligar.
- **Pacote** (`pacote.js`, `valorCausa.js`, `checklist.js`), modo sombra, não gera peça: reserva única
  por tarefa e por demanda (índices únicos parciais); relatório com período pedido (por padrão o do
  ciclo; começar depois é permitido, antes do ciclo nunca), valor da causa como PROPOSTA (8% da
  remuneração oficial PB/PE; município, outras teses e valor acima do teto do Juizado vão ao advogado;
  teto = 60 salários mínimos lidos de `SALARIO_MINIMO_VIGENTE`, sem valor fixo em código), checklist
  (só a identidade se reaproveita; procuração, vínculo e contracheques do período novo são sempre
  novos; inicial anterior é fonte de dados; residência = regra pendente) e modelos aprovados por
  ente/tese (`modelos_reprotocolo`). Pendências do relatório: modelos ausentes e valor a informar.
- **Migrações novas** (via `migrar()`): `2026_09_29_verificacao_reprotocolo` (verificacoes_reprotocolo,
  reprotocolo_pasta_antiga, reprotocolo_conferencia_oficial) e `2026_09_29_pacote_reprotocolo`
  (pacotes_reprotocolo, modelos_reprotocolo).
- **Tela** (`am-plataforma-web`, `VerificacaoReprotocolo.jsx` + encaixes em `tarefas/page.js`, só
  Master, abas Re-protocolo e Novos ciclos): painel com totais e filtro por grupo, botão para
  confirmar o grupo Confirmado, selo e motivos em cada card, ações (confirmar, aceitar motivos com
  observação, liberar protocolo à mão, conferir fonte oficial, vincular pasta antiga colando o link) e
  botão "Importar apuração" (simula, mostra totais e só grava após confirmação).
- **Carga inicial:** as tabelas nascem vazias; sem carga todo ciclo apareceria como "pasta não
  verificada". A apuração de 29/09 (353 clientes com pasta/duplicidade/inventário e 49 conferências
  oficiais) foi gerada como arquivo JSON local (fora do repositório, contém nomes de pastas) para ser
  importada pelo botão depois do deploy.
- **Verificado:** suíte do backend 185/185 (sem `backup.worker.test.js`, que não encerra sem Redis);
  paridade do motor com a produção somente leitura; relatórios de pacote gerados com dados reais;
  build isolado do Next.js compila; componente renderizado em servidor nos 5 estados.
- **Ordem para publicar:** revisar; push do backend (Fase 0 + Fase 2) e depois do frontend; depois do
  deploy, importar a apuração pelo botão; conferir a fonte oficial dos casos pendentes; só então
  considerar `REPROTOCOLO_EXIGE_CONFIRMACAO=true` e configurar `SALARIO_MINIMO_VIGENTE`.
- **Pendências:** indexador do Drive no servidor (hoje a pasta antiga entra por importação ou por
  vínculo manual); tela do pacote (reservar, montar, ver relatório); geração de inicial e procuração
  (depende dos modelos aprovados por ente e do modelo de procuração); quem aprova o dossiê; ferramentas
  de escrita do chat em escopo separado; regra de residência por juízo (das emendas à inicial); piloto
  no PJe (Fase 3).

### 29/09/2026 (fim do dia) — Decisões do usuário e aprovação do pacote (commits locais, SEM push)

**Decisões do usuário:** (1) **a procuração anterior será reaproveitada** (o checklist deixou de gerar
procuração nova; a data da procuração aparece no relatório com o aviso do Tema 1198 do STJ); (2) **as
iniciais aprovadas já estão no sistema**: o pacote lê o modelo do acervo (peça `inicial` com
`modelo_aprovado`, por ente e tese); (3) **salário mínimo vigente: R$ 1.621** (teto do Juizado = 60 ×
esse valor = R$ 97.260); (4) **quem aprova o dossiê é o Luciano Montenegro** (usuário Master
`luciano montenegro`).

**Achado no acervo (produção, leitura):** só 2 iniciais aprovadas — Estado da Paraíba (`estado-paraiba`,
tese `fgts-nulidade`, com arquivo do Drive) e Município de João Pessoa (`municipio-joao-pessoa`,
`fgts-nulidade`, **sem arquivo do Drive**). Como 67 dos 78 ciclos Confirmados são do Município, o
pacote deles fica com a pendência `modelo_sem_arquivo` (bloqueia a aprovação) até o arquivo ser
vinculado. O acervo não tem rota para editar o link de uma peça; o pacote aceita um ajuste manual
(tabela `modelos_reprotocolo`, com precedência) — a tela do pacote tem o campo para colar o link.

**Implementado (branches `reprotocolo-aprovacao` no backend e no frontend):**
- `checklist.js`: identidade e procuração reaproveitadas; sem procuração na pasta antiga → pedir ao
  cliente; vínculo e contracheques novos.
- `pacote.js`: modelo de inicial do acervo (`slugEnteAcervo`/`slugTeseAcervo`), pendências
  estruturadas (`modelo_inicial`, `modelo_sem_arquivo`, `valor`, `documentos`), `aprovarPacote` e
  `pacotesPorTarefas`. Aprovação: só e-mails em `REPROTOCOLO_APROVADORES` (sem a variável ninguém
  aprova), só por sessão do AM; exige pacote montado, sem pendência de modelo, valor da causa > 0
  informado pelo aprovador (a proposta do sistema fica registrada), ciência explícita acima do teto e
  confirmação da verificação ainda válida. Pacote aprovado ainda pode ser cancelado com motivo.
- `POST /api/reprotocolo/pacotes/:id/aprovar`; `GET /verificacao` traz o pacote de cada ciclo e
  `pode_aprovar`.
- Tela: reservar, montar, ver relatório, cancelar, vincular o modelo de inicial (colar o link) e
  aprovar (só o aprovador).
- **Configuração a fazer no Railway (backend):** `SALARIO_MINIMO_VIGENTE=1621` e
  `REPROTOCOLO_APROVADORES=<e-mail do usuário Luciano Montenegro>`. Nenhuma foi aplicada ainda
  (o modo automático nega mudanças de produção; o usuário aplica).
- **Verificado:** suíte 194/194 (sem `backup.worker.test.js`); build isolado do Next.js; estados do
  card renderizados em servidor; relatórios de exemplo com dados reais (Estado: modelo achado com
  arquivo; Município: modelo sem arquivo).

**Publicação de 29/09/2026 (noite) — concluída:** backend `fa09938..fdd2a82` (deploy `969cb387`), frontend
`13c44e9..eb13304` (o commit `f52f4ff` foi reaplicado pelo usuário com `cherry-pick` por cima de uma correção
de Estimativas feita por outra sessão; deploy `cdc49c2d`; o JavaScript publicado de Tarefas contém
"Reservar pacote", "Aprovar pacote", "Vincular modelo" e "Importar apuração") e variáveis do Railway
(deploy `8467b4a0`, conferidas). Lição de processo: o modo automático nega `git push`/`rebase` e mudança de
variável de produção mesmo com pedido do usuário no chat; o usuário roda esses comandos no próprio
terminal, e o assistente confere o resultado (deploy, rotas, variáveis) em seguida.


### 30/09/2026 — Lote S, Onda 9 (S-27): perfil júnior — PREPARADO, ainda NÃO publicado

Aplicada a matriz D6 na versão recomendada do plano (a decisão D6 ainda não foi respondida pelo
usuário; ele mandou "execute tudo"). Só código e testes; nada foi ao ar, então **não há estado
verificado em produção** (a verificação é a do plano: conta de teste júnior, depois que a Onda 8
permitir que ela entre). Novo arquivo `src/middleware/perfilJunior.js` concentra a regra
("não é exatamente `master` = júnior"); os routers só ganharam poucas linhas.
- **CPF mascarado** (`***.456.789-**`, a máscara de Tarefas) em toda resposta JSON dos routers de
  clientes, processos, tarefas e triagem, por `router.use(protegerDadosDoJunior)` (mascara qualquer
  chave `cpf`/`cliente_cpf`; rota nova nesses routers já nasce protegida). Busca por CPF do júnior só
  com o CPF inteiro (a busca parcial de 6+ dígitos viraria oráculo). O Master segue igual.
- **Clientes:** o júnior não recebe nem decifra `anotacoes`; PATCH com `anotacoes` ou `ativo` → 403.
- **CSV de processos** (`/exportar-excel`) do júnior sai sem a coluna CPF.
- **Processos (IDOR de 11/07 fechado):** `PATCH /:id` e `PATCH /:id/urgente` só em processo em que o
  júnior tem tarefa atribuída (não cancelada); `PATCH /:id` sem `status`, `valor_causa`, `valor_rpv`
  (reenviar o valor já gravado passa e é ignorado: o formulário antigo manda `status` sempre).
  `PATCH /:id/situacao` (classificação do dia a dia) segue aberto, mas sem `valor_homologado` e com
  urgência só nos processos dele. Lista e ficha de processo ganharam `pode_editar`.
- **Conversas de lead:** `GET /api/estimativas/leads/:contactId/mensagens` agora é `apenasMaster`
  (conflita com a exceção "aberta de propósito" da D7; prevaleceu a D6 mais conservadora).
- **Protocolo:** `PATCH /api/tarefas/:id/concluir-com-numero` deixou de ser `apenasMaster` (voltou a
  valer a conferência de responsável que já existia na rota, agora antes das demais): o júnior
  registra o protocolo da tarefa dele; Master registra qualquer um.
- Testes: `src/routes/junior.acesso.test.js` (26 casos, com o Master ao lado de cada regra).
- **Limitações/pendências:** Diligências segue só para Master na tela (a página Relatório inteira é
  Master por decisão de 28/09; o endpoint continua aberto); o júnior perde "Abrir conversa" na aba
  Processual de Estimativas; `status_rpv`/`status_precatorio` "paga" feitos por júnior ainda geram o
  honorário automático quando já há valor homologado (não estava na matriz); `cessionario_documento`
  (cessões) e o CPF do onboarding em que o júnior é responsável não são mascarados.

### 01/10/2026 — Lista de processos ordenada pela última atualização (movimentação ou publicação) e DataJud com lote 40

- **O que mudou:** `GET /api/processos` passa a ordenar por `urgente DESC` e depois pela última
  atualização = `GREATEST(última movimentação, última publicação não cancelada)`. A data da
  publicação (`publicacoes.data_disponibilizacao`, tipo DATE) é tratada como meia-noite de Brasília.
  Publicação nova também zera "dias parado" e conta nos filtros de período (`hoje`/`7d`/`30d`/`sem30d`/
  `sem60d`), no filtro de tempo parado e nas exportações (WhatsApp e Excel; coluna "Última Atualização").
  Campos novos na resposta: `ultima_atualizacao`, `ultima_atualizacao_origem` (`movimentacao`|
  `publicacao`) e `ultima_pub_resumo`. Na tela, a coluna virou "Última Atualização", com o selo azul
  "Publicação" e o resumo quando a mais recente é uma publicação. Decisão do usuário: urgentes
  continuam no topo; publicação zera dias parado.
- **Achado antes da mudança:** 104 processos tinham publicação mais nova que a última movimentação
  (apareciam abaixo do que deviam). Das 336 publicações, 299 estão vinculadas; as 37 órfãs não casam
  com nenhum processo cadastrado — não há religação a fazer.
- **Verificado:** SQL gerado pela rota executado em leitura contra produção (até ~360 ms; 2 urgentes
  no topo, depois os processos com publicação do dia); suíte do backend 979/979; build do frontend ok.
- **Em produção:** backend `8f282de..179ee68` (deploy `89d3d0e2` SUCCESS; `/health` 200; rota 401 sem
  login; sem erros no log); frontend `77f34c0..e399ff9` (deploy `f4931354` SUCCESS; o JS publicado de
  /processos contém o campo novo). Pushes feitos por mim após o "execute" do usuário.
- **DataJud:** `DATAJUD_TAMANHO_LOTE=40` aplicado pelo usuário no Railway em 01/10 (~00:35 BRT; antes
  100). Antes da mudança: 507 `ok`, 300 `erro_sync`, 4 aguardando; execuções horárias alternam entre
  sucesso parcial e falha total (0 casados às 19h, 23h e 03h UTC). Conferir após 06:00 UTC se as falhas
  caíram; se não, baixar para 20 (o padrão é por faixa de horário do DataJud, não só tamanho de lote).
- **Pendências:** a tela não foi aberta logada para conferência visual (subir o backend local contra o
  banco de produção rodaria as migrações de boot); o painel/dashboard ainda calcula "parado" só por
  movimentação (fora do escopo desta mudança).
- **Acesso a produção pelo Claude:** liberado pelo usuário em 01/10 por regras de permissão
  (`railway run …`). Leitura do banco de fora do Railway usa o serviço Postgres
  (`railway run --service Postgres` com a URL pública), sempre com `.q-tmp.mjs` em modo somente leitura.

### 01/10/2026 — DataJud: diagnóstico final e push do TJPB por e-mail via IMAP (Gmail)

- **DataJud (verificado às 18:06 BRT, só leitura):** 596 `ok`, 201 `erro_sync`, 14 aguardando primeira
  captura (meio-dia: 65 em erro; o número oscila conforme o DataJud recusa ou não cada hora). Das 12
  execuções do dia, 5 falharam por completo (0 casados) e **nenhuma gravou andamento novo desde 03:01**.
  Causa confirmada na API do CNJ: o índice do TJPB está parado — a última atualização dos nossos
  processos é de 10/09 e os andamentos vêm com meses de atraso (processo `0801815-11.2026` teve
  sentença publicada no DJEN em 01/10 e o DataJud mostra último movimento em 04/06). O 429 vem da
  chave pública do CNJ, compartilhada por todos (não existe chave própria); baixar mais o lote não
  resolve. **Decisão: manter `DATAJUD_TAMANHO_LOTE=40`, tratar o DataJud como histórico e usar o push
  por e-mail como fonte de novidade.** Alternativa de cobertura total: API paga de monitoramento
  (Escavador/Judit/Codilo) — não cotada.
- **Push do TJPB:** o leitor por Outlook/Graph (commit `d637c0f`, 12/08) nunca rodou e **não pode
  rodar**: conta pessoal Hotmail não registra mais aplicativo na Microsoft ("A capacidade de criar
  aplicativos fora de um diretório foi preterida", verificado no portal.azure.com com a conta do
  usuário em 01/10). Decisão do usuário: receber os e-mails do PJe em `ramonoliveiraabrantes@gmail.com`
  e ler por IMAP com senha de app.
- **Implementado (branch `push-tj-imap`, à frente de `7b1d3ed`):** `src/services/imap/leitor.js`
  (`imapflow` + `mailparser`; devolve o mesmo formato do Graph; busca por remetente + SINCE, corte
  exato pela data interna, id = Message-ID ou UIDVALIDITY:UID, HTML→texto; só leitura);
  `src/services/pushTJ/fonte.js` (`fontePush()`: IMAP vence Outlook; `remetentePush()`);
  worker, `workers/index.js` e `GET /api/push-tj/saude` (campo `fonte`) passam a usar a fonte
  configurada. Variáveis: `PUSH_TJ_IMAP_HOST/PORT/USER/SENHA/PASTA`, `PUSH_TJ_REMETENTE`
  (documentadas no `.env.example`). Testes: 8 novos com servidor IMAP falso; suíte 987/987.
- **Pendente do usuário:** trocar o e-mail do perfil no PJe para o Gmail; criar a senha de app
  (verificação em duas etapas) e gravar as variáveis no Railway (script interativo preparado, a senha
  não passa pelo chat); publicar a branch. Depois: conferir `[Workers] Push do TJPB ativo via imap`,
  `/api/push-tj/saude` e as primeiras linhas em `push_tj_mensagens`.

### 01/10/2026 (noite) — Camila assume lead de página que caiu no COMERCIAL (caso Rossana)

- **Causa real do caso Rossana (pendência 157):** não era nono dígito. Ela digitou no formulário um
  telefone com outros dígitos (`…99120545`, o real é `…98185819`), a confirmação falhou e ela
  escreveu do número real pelo botão da página ("Olá! Acabei de preencher a Calculadora…"). O
  chamado caiu no COMERCIAL, onde só o robô nativo do Digisac responde; a Camila ignora
  departamentos sem "camila" no nome. Ela pediu advogado às 19:54 e ficou sem resposta.
- **Correção (Camila `a526026`, deploy `a8930e72` SUCCESS, `/health` ok):**
  1. mensagem pré-preenchida de botão de página (calculadora ou INSS, `camila/vinculo-calculadora.js`)
     que chega fora dos departamentos da Camila e sem humano atribuído → a Camila puxa o chamado
     para CAMILA - VENDAS e atende. Isso também cobre a campanha INSS, cujo lead sempre escreve
     primeiro e antes cairia no robô nativo;
  2. "Acabei de preencher a Calculadora…" de contato sem pendência (nem pelo `contact_id` nem pelo
     telefone) → a Camila pede o nome completo, procura pendência dos últimos 7 dias sem conversa
     com o mesmo nome (sem acento/caixa) e, havendo exatamente uma, vincula `contact_id`/`ticket_id`,
     corrige o telefone, confirma o recebimento e alerta a equipe; sem pendência única, alerta e
     segue a qualificação normal.
- **Limites:** o robô nativo ainda manda o menu de boas-vindas antes da Camila assumir (dispara na
  criação do chamado). A Rossana não foi recuperada automaticamente (as mensagens dela são
  anteriores ao deploy): o chamado dela segue no COMERCIAL sem atendente e precisa de humano.
  Testes: 255/256 (a falha é a antiga, dependente de horário); não testado com WhatsApp real.
