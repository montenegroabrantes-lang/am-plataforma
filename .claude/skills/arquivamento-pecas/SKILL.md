---
name: "arquivamento-pecas"
description: "Mapa do Google Drive do escritório AM Advogados e regra de arquivamento e indexação. Use ao localizar modelos, teses, procurações ou documentos de clientes, ao concluir qualquer peça e ao receber acórdão ou sentença favorável."
---

# Drive, arquivamento e indexação — AM Advogados

Substitui a skill `drive-am-advogados`, cujo conteúdo está integralmente incorporado aqui. Duas funções: **encontrar** o que já existe no Drive e **guardar** o que se produz. A redação das peças segue `peticao-elite` e as skills de matéria.

**Princípio do arquivamento:** peça guardada por nome de cliente não serve depois. Guardada por tese, órgão julgador e resultado, serve. Toda decisão responde a uma pergunta futura: "o que já usamos nessa tese, contra esse ente, nesse órgão, e no que deu?"

---

# PARTE I — MAPA DO DRIVE

A pasta **A _M _ ABRANTES E MONTENEGRO ADVOGADOS** é o banco de dados de trabalho do escritório.

**ID da pasta-mãe:** `1Wvb-U-bm5yOwSxNioq0zgY17e-xRfftO`

## Como usar

Listar o conteúdo de qualquer pasta com o conector do Google Drive:

```
search_files: parentId = '<ID>'
```

Só subpastas:

```
search_files: parentId = '<ID>' and mimeType = 'application/vnd.google-apps.folder'
```

Buscar por nome em todo o Drive:

```
search_files: title contains 'piso'
```

Sempre use `excludeContentSnippets: true` ao mapear estrutura — economiza muito contexto.

**Não confie em listas de arquivos memorizadas.** Os IDs de pasta abaixo são estáveis; os arquivos dentro delas mudam. Liste a pasta na hora.

## Nível 1 — o que cada ramo guarda

| Pasta | ID | Conteúdo |
|---|---|---|
| RAIZ | `1-P-TpYMKua4tNyF4GGGbzyE1NJuI-905` | Modelos por tipo de peça (~60 subpastas) |
| OUTORGANTES | `1ZG9iIXMxKsSFMInemfcSV9erZsVwtk8X` | Clientes e procurações por ano, filas de protocolo |
| PRODUTOS E TESES | `19yxyZvtx7mWtaIf-opPoMBr9WBvH42tU` | Teses por matéria |
| ATIVIDADE PROCESSUAL | `1-1YbARZMa0Zfqjs-X9r63onZi5rBzXbY` | Controle de demandas, movimentações, bases de servidores |
| JURISPRUDÊNCIA E LEGISLAÇÃO — CONTRATAÇÃO POR EXCEPCIONAL INTERESSE PÚBLICO | `1ARERx-EQCO7a7f2CryMMdQeyPu7fJtHZ` | |
| LEGISLAÇÃO | `1Qx_CzJmkmEVSUD7a3QIqcUN7rbbmbkA1` | |
| ESTUDO | `1AK_LlZBhosjKIt850XTviJIBSz_NIg8g` | |
| ACORDO PRECATÓRIO ESTADO 2026 | `1t07ZfJh_xhLWenxMWxrxK2ejs7ABpxnw` | |
| Crédito Preferencial — PRECATÓRIO | `1jmw2pr41c2_ki74OnXQ5LZNbMe9VriMh` | |
| DESPACHAR — RPV | `1C6vV3CZFliKmAjuUfzon7LkQOfg3kDXE` | |
| PASEP | `1776UfxpgzaU6nYrTMcr7ZiFOkRCn9yPb` | |
| INSS | `19dGRFaQbo8n1VIc32CwljpAPWXsCdOSd` | |
| HONORÁRIOS EXTRAJUDICIAIS — COBRANÇA ILEGAL | `1hkvAZWZ5dvmSyQhSOWVs3WsKZCo4HOBG` | |
| DOCUMENTOS SOCIETÁRIOS | `1e-YnFq9AN3nrWStBqVxFpb6xWQGdPnbQ` | |
| CAPTAÇÃO | `1TAjnz2z_SEWnNysk4_PDyZnFCRooqi6w` | |
| NOTAS FISCAIS | `1LZXjdv4D7PgbhmXS4rWoX2DIWj_iFS-C` | |

## RAIZ — modelos por tipo de peça

É aqui que estão os modelos, e é aqui que as peças novas são gravadas. Principais subpastas:

| Peça | ID |
|---|---|
| INICIAL | `11Aw0OChO92-nnstH2UbJBM6nQXGzjhzg` |
| EMENDA À INICIAL | `11HcHq295nFWgq_1gzePubxRE-kiqfS_3` |
| IMPUGNAÇÃO À CONTESTAÇÃO | `11DhI1cgxokBJ13gykZlbxjtdHq2qUnOY` |
| RECURSOS | `11obtuF-2HPbdG-wpANCFrg_TrbVabnCv` |
| EMBARGOS DE DECLARAÇÃO | `1RzQeCGBkQU3idOXIzBya4bRdYi9l5x1s` |
| CUMPRIMENTO DE SENTENÇA | `1-PKtc5WiPHzPqNWoRA98947ofI2XjLvm` |
| PRODUÇÃO DE PROVAS | `11qR5VkqKP0CHwIjFjKl__0IYUxjKN4GH` |
| _PETIÇÃO — REQUERIMENTOS DIVERSOS | `1OnJW6RrhwcOY0YXDKiMk5ikvbtsXClya` |
| CESSÃO DE CRÉDITOS JUDICIAIS | `1RWQpN-Y5ooA96tG4_cWwONZdCbSMgvEQ` |
| ALVARÁ DE LEVANTAMENTO | `1-ipetnVSOx2cii1sjElwqhV3xF483_gV` |
| PRECATÓRIO | `1TQAF08tjH4j7gubHkCITmvGv72SNRy54` |
| PROCURAÇÃO | `10twcd0JqvAkMgGFvRlX6vfwmU99m5zQJ` |
| CUSTAS | `11IrWhQpcfemOhCN6-4ogBe2oSjGj4nE7` |
| DESISTÊNCIA | `1XyHzuqfusZV5WJWo6jyQ1_VEG-BXXwcc` |
| HABILITAÇÃO NOS AUTOS | `1X-6XLDPbY6tV2tS5hFuSVOuk1CBGBPrR` |
| DECLARAÇÃO DE HIPOSSUFICIÊNCIA | `1Ywhb91fajVhCssj0e5VyPg4elJMTVP9K` |
| MANDADO DE SEGURANÇA | `1m_x1xFUGmrV0XSQ6WnW5c3XO9VNVwIPW` |
| LITIGÂNCIA DE MÁ-FÉ | `1Bg67SJVgfQCD8x47atqMfJJpz6xAIf1q` |
| SEQUESTRO DE VALORES | `11xdvykgvIswYHoNMVbengMU-dBLYMtg7` |
| PENHORA | `1Ok7w6N0CtffpF1v7_6TDngJ5fjQb6zXD` |
| ANÁLISES | `1OFmCj8ac64Eog2nDvEW6mKpxZECa6zwM` |

Há ainda cerca de quinze subpastas de contrarrazões, separadas por tipo de recurso e por tese (FGTS, apelação, progressão funcional, recurso especial, embargos). Liste a RAIZ para ver todas.

## PRODUTOS E TESES — por matéria

| Tese | ID |
|---|---|
| _PISO SALARIAL | `1UiWoxLbEYd7NfIU4_zD6YDQtPZLC7bA6` |
| _PISO SALARIAL — MAGISTÉRIO X PB | `1hwV3uvXyaYGDOzM0EI8t5i7g3pwiLQk4` |
| EDUCAÇÃO — PROFESSORES | `16fY71c3NmaRPq1jeL-kKO4eFdVbog9rf` |
| _ADICIONAL NOTURNO — 25% | `1PAFNxb_SUtsAFKlMpdAwLtNXC-988MRn` |
| INSALUBRIDADE | `1v9eBIzCm-R3quTU3_u2uDrgl6rZIPl9E` |
| INSALUBRIDADE — PROFISSIONAL DE SAÚDE | `1WxIerAxfZsZ1Krv-Ku3AhkEmYFVjicme` |
| 13º E FÉRIAS SOBRE 45 DIAS | `1uh1vwuDvy6zMLocsdfm8IB3wjzRQtvZe` |
| PROGRESSÃO FUNCIONAL | `1jCXOMBKqvvS9GmhMcY6zALxUWtBYEkjJ` |

Há mais de vinte outras matérias (GPD, PB PREV, vale-transporte, FGTS de outros estados, repetição de indébito do INSS, equiparação de técnico e auxiliar de enfermagem). Liste a pasta.

## OUTORGANTES — clientes e filas

| Pasta | ID |
|---|---|
| AM Advogados — Clientes | `1IwJwYBzCygeYDLFGX_PoPSPwAw98qXfC` |
| Outorgantes 2026 | `1i0NJ6i4GWESXcmN_6CTjXyDOgop83jMr` |
| Outorgantes 2025 | `1S6IMMEkOnW2VbWAdweLbJMUAznwPQEBG` |
| Outorgantes 2024 | `1zjPQhXIXiVUJG8_vMo1vw8Mgv1caM4GZ` |
| Outorgantes 2023 | `11_QxGWZTOq2ZjRw7awxTJBREg3RemTFO` |
| Outorgantes 2022 | `11YF8lok30JTUqzdcp7SM4hmQY9obctXy` |
| _PENDENTE A PROTOCOLAR — 2026 | `1VMrQLxLQtSek5KM6dOyNoRDVHJOethyN` |

## Fora da pasta-mãe

**BANCO DE DADOS** — `12WhiYEoTkJu2yWED3pzn-FbDW78l06t8`. Planilhas de servidores dos municípios da PB, landing pages, material de campanha e as pastas _CLAUDE CODE e _OBSIDIAN.

**LAYOUT - PETICOES** (dentro de BANCO DE DADOS) — `11nVK-xAAQ3qyxrBmSLWkzypmGCv83QyT`. Layout oficial das peças do escritório: modelo "PADRAO __2_AMOSTRA - NOVO LAYOUT - INICIAL EMLUR.docx" (cabeçalho, rodapé, títulos e fecho). As especificações estão na skill `peticao-elite-am`, seção "Formatação — layout do escritório".

## Onde procurar cada coisa

- Modelo de petição inicial por ente ou por tese → RAIZ › INICIAL
- Modelo de qualquer outra peça → RAIZ, subpasta com o nome da peça
- Fundamentos e jurisprudência de uma matéria → PRODUTOS E TESES
- Procuração, contrato ou documento de um cliente → OUTORGANTES, pasta do ano
- Layout (papel timbrado) das peças → BANCO DE DADOS › LAYOUT - PETICOES
- Bases de servidores para prospecção → BANCO DE DADOS
- Situação e andamento de um processo → AM Plataforma, não o Drive

---

# PARTE II — ARQUIVAMENTO E INDEXAÇÃO

## 1. Acionar ao concluir uma peça

Entregue a peça ao usuário e, na mesma resposta, ofereça o arquivamento em uma linha. Não arquive sem confirmação, salvo se o usuário já tiver autorizado no início da conversa.

Confirmado, execute os três passos abaixo na ordem.

## 2. Passo 1 — Gravar a peça no Drive

### Nome do arquivo

```
<TIPO DE PEÇA> - <NOME DO CLIENTE> - <Nº DO PROCESSO>.docx
```

Tipo em caixa alta, sem abreviar: INICIAL, IMPUGNAÇÃO, RECURSO INOMINADO, CONTRARRAZÕES, EMBARGOS DE DECLARAÇÃO, MEMORIAL, APELAÇÃO, CUMPRIMENTO DE SENTENÇA, PETIÇÃO. Cliente com nome completo, como consta da procuração. Processo no formato CNJ completo.

Versões sucessivas da mesma peça não geram arquivo novo com sufixo `_1`, `_2`. Substitua o anterior. Se houver motivo para preservar a versão antiga, acrescente ` - v<n>` ao final.

### Destino

Pasta RAIZ correspondente ao tipo de peça, conforme a tabela da Parte I. Se a peça for de uma tese com pasta própria em PRODUTOS E TESES, grave também ali quando ela servir de modelo reaproveitável.

Na dúvida entre duas pastas, pergunte. Não crie pasta nova sem autorização.

### Como gravar

- **Peça que vai ao PJe** (inicial, impugnação, recurso, contrarrazões, embargos, petição): `salvar_peca_drive` do conector ACERVO JURIDICO. Ele monta a peça no layout oficial do escritório (cabeçalho, rodapé, títulos numerados, fecho e assinaturas) e grava na pasta do cliente. Enviar `pasta_id` da pasta do cliente, `nome` no padrão `TIPO - CLIENTE - PROCESSO` sem extensão e o conteúdo em `blocos` (enderecamento, paragrafo, acao, titulo, subtitulo, citacao, pedido, tabela, fecho, assinaturas). Formato padrão PDF (o PJe só aceita PDF); acrescentar `docx` em `formatos` quando o usuário quiser editar. Arquivo de mesmo nome é substituído. Se a ferramenta devolver erro, nada foi gravado: relate e não siga como se a peça estivesse salva.
- **Peça com recortes de imagem dos autos** (prints de documentos no corpo): `salvar_peca_drive` não aceita imagens. Montar localmente no layout do escritório (seção "Formatação" da `peticao-elite-am`) e subir o arquivo pelo conector do Google Drive.
- **Planilha, memória de cálculo ou documento que não é peça**: `salvar_documento_drive`, com o conteúdo em HTML simples e `orientacao` "paisagem" para tabelas largas.
- **Limite de destino das duas ferramentas**: só gravam em _PENDENTE A PROTOCOLAR, OUTORGANTES, AM Advogados — Clientes e subpastas diretas. A cópia de modelo na RAIZ (ou em PRODUTOS E TESES) é feita pelo conector do Google Drive, copiando o arquivo já gravado na pasta do cliente.

## 3. Passo 2 — Curar o precedente, se houver

Acórdão, sentença ou decisão favorável é o ativo mais valioso do arquivamento, e o que mais se perde. Sempre que a peça nascer de um julgado favorável, ou o caso produzir um, registre-o.

Grave o PDF na pasta da tese em PRODUTOS E TESES, com o nome:

```
ACÓRDÃO <ÓRGÃO> - <Nº DO PROCESSO> - <RESULTADO>.pdf
```

E acrescente à skill de matéria correspondente (`magisterio-piso`, `temas-551-916-stf`, `adicional-noturno-insalubridade-jp` e as demais) uma entrada compacta, propondo a atualização pelo fluxo de skills:

```
- <Órgão>, proc. <número>, Rel. <nome>, j. <data>: <razão de decidir em uma ou duas linhas>. <Resultado>. PDF: <pasta>
```

**Limite:** no máximo seis paradigmas por tese na skill. Ao chegar ao sétimo, substitua o mais fraco ou o mais antigo. Skill de matéria é acervo curado, não repositório — o PDF fica no Drive, a skill guarda a razão de decidir.

Nunca registre paradigma sem ter conferido a ementa na fonte. Número de acórdão não conferido não entra.

## 4. Passo 3 — Indexar no AM Plataforma

O controle processual do escritório é o **AM Plataforma**. É nele que a peça arquivada vira acervo consultável — não planilha solta no Drive.

O conector MCP **ACERVO JURIDICO** está vinculado e disponível nesta conta: as chamadas abaixo executam de verdade, sem intervenção manual.

Antes de redigir qualquer peça, chame `buscar_acervo` com a tese, o ente e, quando souber, o órgão julgador. O que já foi usado e o que já venceu naquela tese devem informar a redação.

### Fecho da peça no AM — depois do protocolo

Só quando o usuário disser que a peça foi **protocolada** (peça entregue mas não protocolada não atualiza o AM). Siga na ordem:

1. **Registrar a peça.** Chame `criar_peca` com todos os campos disponíveis (tipo de peça, tese, ente, instância, data de protocolo, link do Drive) e **sempre com `processo_numero`** no formato CNJ. O AM liga a peça ao processo e ao cliente pelo número; ela aparece na aba **Peças** da ficha do processo. Se a chamada indicar duplicidade, use `atualizar_resultado_peca` com o id devolvido em vez de criar de novo. Guarde o `id` devolvido (peca_id).
2. **Consultar o processo.** Chame `consultar_processo_peca` com o número (só leitura).
3. **Peça com prazo** (contestação, impugnação, recurso, contrarrazões, embargos, especificação de provas, manifestação com prazo): se houver prazos abertos, mostre ao usuário a lista (descrição e data) e pergunte qual prazo a peça cumpre. Só depois do "sim" dele chame `cumprir_prazo` com o `tarefa_id` escolhido e o `peca_id`. Nunca escolha sozinho entre dois prazos; sem prazo aberto, apenas informe.
4. **Petição inicial protocolada** (o número ainda não existe no AM): chame `consultar_processo_peca` com o número e o `cliente_nome`. Se vier mais de um cliente em `clientes_encontrados`, confirme com o usuário qual é e consulte de novo com o `cliente_id`. Mostre ao usuário a tarefa de protocolo aberta (tese e situação) e confirme com ele o número CNJ e o período pedido na inicial (mês/ano de fim e, se houver, de início). Só então chame `registrar_protocolo_inicial`: ele conclui a tarefa e cria o processo já com cliente, tese, polo passivo e tribunal. Se o cliente tiver mais de um vínculo ativo, pergunte qual e envie `vinculo_id`. Sem tarefa de protocolo aberta, não crie nada: avise o usuário para cadastrar o processo pela tela Processos. Depois do processo criado, faça o passo 1 (`criar_peca`) para a inicial ficar ligada a ele.
5. **Confirme ao usuário** o que foi atualizado (peça registrada, prazo cumprido, processo criado), com o link `https://am-plataforma-web-production.up.railway.app/processos/<processo_id>?aba=pecas`.

Erro em qualquer passo: relate a mensagem do AM e não repita a escrita às cegas.

Ao obter decisão favorável, chame `criar_precedente`, sempre com a razão de decidir em uma a três linhas no campo `ratio`. Só chame `conferir_precedente` depois de ter checado a ementa em fonte primária — nunca marque como conferido por presunção.

Em dúvida sobre valor de enum (tese, ente, instância, resultado, tipo de peça), chame `listar_teses` ou consulte os enums fixos desta skill antes de inventar um valor novo.

Se as ferramentas `mcp__ACERVO_JURIDICO__*` não aparecerem disponíveis nesta sessão (conector caiu ou não foi carregado), não finja que o lançamento foi feito: entregue os campos prontos em bloco para lançamento manual e registre o mesmo conteúdo no arquivo de área do caso na memória.

## 5. O que NÃO se arquiva

- Rascunhos, versões intermediárias e minutas descartadas.
- Peças da parte adversária, salvo quando contiverem tese nova que valha estudar.
- PDFs de autos completos baixados do PJe: são volumosos e recuperáveis a qualquer tempo no sistema. Guarde apenas o trecho ou a decisão que interessa.
- Documentos pessoais de clientes fora das pastas de OUTORGANTES.
- Cópia de peça gerada para caso que não foi protocolado.

## 6. Checklist antes de encerrar

```
☐ Nome do arquivo no padrão TIPO - CLIENTE - PROCESSO?
☐ Gravado na pasta do cliente com salvar_peca_drive (PDF) e, se for modelo, copiado para a pasta RAIZ do tipo correto?
☐ Há julgado favorável no caso? Foi curado na skill de matéria e gravado na tese?
☐ Ementa do precedente conferida em fonte primária?
☐ criar_peca (e, se houver, criar_precedente) chamado no AM Plataforma via conector ACERVO JURIDICO, com processo_numero?
☐ Peça com prazo: prazo cumprido com cumprir_prazo, depois da confirmação do usuário?
☐ Inicial protocolada: tarefa de protocolo concluída com registrar_protocolo_inicial, depois da confirmação?
☐ Nenhum rascunho ou autos completos subiu junto?
```