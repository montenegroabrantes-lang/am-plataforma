---
name: protocolo-pje-am
description: Cadastro de processos novos no PJe do TJPB para o escritório AM Advogados (Abrantes & Montenegro), a partir das peças já gravadas na pasta do cliente no Drive e da ficha de protocolo do AM (ferramenta preparar_protocolo). Use SEMPRE que o usuário pedir para "protocolar", "subir no PJe", "cadastrar no PJe", "distribuir a inicial", "protocolar o cliente X", "protocolar a fila" ou "montar a ficha de protocolo", inclusive no Claude no Chrome com o PJe aberto. Também use para conferir se a pasta de um cliente está pronta para o protocolo. O cadastro para antes da assinatura, porque quem assina e protocola é sempre o advogado.
---

# Protocolo no PJe (TJPB) — AM Advogados

O escritório protocola em massa ações contra a Fazenda Pública (Estado da Paraíba e municípios). As peças
já saem prontas, em PDF e no layout do escritório, na pasta do cliente no Drive (normalmente dentro de
"_PENDENTE A PROTOCOLAR — 2026"). Esta skill leva essas peças ao PJe sem erro de cadastro e deixa o
processo parado na tela de assinatura para o advogado conferir.

## Regras que não mudam

- **Nunca assine nem clique em protocolar/enviar.** A assinatura com o certificado digital é ato do
  advogado. Pare na tela de assinatura de cada processo e mostre o resumo para conferência.
- **Nunca peça nem aceite senha, código do autenticador ou certificado.** O login no PJe é feito pelo
  advogado no próprio navegador. Se o PJe não estiver logado, peça para ele entrar e espere.
- **Só PDF vai ao PJe.** Arquivos .docx, Google Docs e afins ficam de fora, mesmo se estiverem na pasta.
- **Processo "bloqueado" não é cadastrado.** Informe o motivo e siga para o próximo.
- **Na dúvida, pergunte.** É melhor uma pergunta curta do que um cadastro errado num protocolo em massa.
  Se uma classe, assunto ou tipo de documento não existir com o nome exato, escolha o mais próximo e
  diga qual escolheu.

## Passo 1 — Ficha de protocolo

Se o conector do AM estiver disponível, rode `preparar_protocolo` com o ID da pasta do cliente. Cada PDF
"INICIAL - ..." vira um processo, e a ficha traz:

- foro;
- juízo: Juizado Especial da Fazenda Pública até 60 salários mínimos, Vara da Fazenda Pública acima disso;
- classe, autor, réu, ação, valor da causa e gratuidade;
- anexos na ordem certa;
- status `pronto` ou `bloqueado`, com as pendências.

Sem o conector (por exemplo, só no Chrome), monte a ficha à mão, com o mesmo critério:

| Campo | Regra |
|---|---|
| Foro | João Pessoa, salvo instrução diferente do usuário |
| Juízo | Valor da causa até 60 salários mínimos: Juizado Especial da Fazenda Pública; acima disso: Vara da Fazenda Pública. Confirme o salário mínimo vigente com o usuário se não souber. |
| Classe | Juizado: "Procedimento do Juizado Especial da Fazenda Pública". Vara: "Procedimento Comum Cível". |
| Partes | Autor: qualificação completa da inicial (nome, CPF, RG, estado civil, endereço). Réu: o ente "em face de" (ex.: Estado da Paraíba, CNPJ 08.761.124/0001-00). |
| Advogados | Ramon Oliveira Abrantes (OAB/PB 23.395) e Luciano Montenegro L. R. Carvalho (OAB/PB 23.176) |
| Valor da causa | O da frase "Dá-se à causa o valor de R$ ..." da inicial |
| Gratuidade | Sim, quando a inicial pede justiça gratuita |
| Liminar | Não, salvo se a inicial pedir |

Ordem dos anexos e tipo de documento no PJe:

1. Inicial — "Petição inicial"
2. Planilha da mesma tese, se houver — "Planilha de cálculos"
3. Procuração — "Procuração"
4. Documento pessoal (CNH/RG/CPF/residência) — "Documento de identificação"
5. Comprovante de vínculo / contracheque / ficha financeira — "Documento comprobatório"
6. Outros PDFs da pasta que não sejam inicial nem planilha de outra tese — "Documento comprobatório"

Uma pasta com duas iniciais (por exemplo, FGTS e Piso) gera **dois processos separados**. Cada um leva a
própria inicial e a planilha da mesma tese, e os documentos comuns vão nos dois.

Bloqueie e avise se faltar procuração, documento pessoal, comprovante de vínculo ou valor da causa.

## Passo 2 — Cadastro no PJe (Claude no Chrome, PJe logado)

Para cada processo `pronto`, nesta ordem:

1. Novo processo, com foro/jurisdição, órgão julgador e classe da ficha.
2. Assunto conforme a ação (ex.: FGTS / contratação temporária; piso salarial / magistério). Se houver
   mais de uma opção plausível, pergunte.
3. Partes: autor e réu pelo CPF/CNPJ. Confira o nome que o PJe trouxer com o da inicial.
4. Valor da causa, justiça gratuita e ausência de liminar.
5. Anexos na ordem da ficha, cada um com o tipo de documento indicado.
6. **Pare na tela de assinatura.**

Se os PDFs não puderem ser anexados direto do Drive, peça ao usuário para baixá-los numa pasta do
computador (uma por cliente) e use essa pasta.

## Passo 3 — Resumo para o advogado

Ao parar em cada processo, mostre:

```
Processo [n] de [total] — [AUTOR] x [RÉU] — [ação]
Foro/juízo: ...        Classe: ...        Assunto: ...
Valor da causa: R$ ...  Gratuidade: sim/não
Anexos: 1. ... 2. ... 3. ...
Escolhas feitas por aproximação: ... (ou "nenhuma")
Pronto para o advogado conferir e assinar.
```

No fim do lote, liste os processos cadastrados, os bloqueados (com o motivo) e as escolhas feitas por
aproximação.

## Depois do protocolo

Peça ao usuário os números dos processos. Com o conector do AM, registre cada peça no acervo
(`criar_peca`: tipo "inicial", ente, instância "1grau", número do processo, data do protocolo, teses e
link do PDF no Drive). Depois sugira mover a pasta do cliente para a de protocolados.
