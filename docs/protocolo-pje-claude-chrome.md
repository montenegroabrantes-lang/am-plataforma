# Protocolo no PJe com o Claude no Chrome

Rotina para levar ao PJe (TJPB) as peças que o AM grava nas pastas dos clientes. O advogado faz login com
o próprio certificado, e o Claude no Chrome cadastra os processos e para antes de cada assinatura. Quem
confere, assina e protocola é sempre o advogado.

## Antes (sessão do Claude com o conector do AM)

1. Gravar as peças na pasta do cliente com `salvar_peca_drive`.
2. Rodar `preparar_protocolo` com o ID da pasta. A ferramenta devolve uma ficha por processo: foro, juízo,
   classe, partes, valor da causa, gratuidade e anexos na ordem certa. Os processos vêm marcados como
   `pronto` ou `bloqueado`.
3. Processo `bloqueado` não vai ao PJe: primeiro resolva a pendência indicada.
4. Baixe para o Mac os PDFs listados nos anexos (uma pasta por cliente). Arquivos que não são PDF não
   vão ao PJe.

## No Chrome (PJe aberto e logado pelo advogado)

Abra a extensão do Claude e cole o texto abaixo, seguido das fichas devolvidas por `preparar_protocolo`:

> No PJe do TJPB (já logado), cadastre um processo novo para cada ficha abaixo, sem assinar nem
> protocolar. Use exatamente os dados da ficha: foro, juízo, classe, autor (com CPF, RG e endereço da
> qualificação da inicial), réu, valor da causa e pedido de justiça gratuita. Sem pedido de liminar. Os
> advogados são Ramon Oliveira Abrantes (OAB/PB 23.395) e Luciano Montenegro L. R. Carvalho
> (OAB/PB 23.176). Anexe os PDFs da pasta indicada na ordem da lista de anexos. A inicial vai como
> "Petição inicial", a planilha como "Planilha de cálculos", a procuração como "Procuração" e os demais
> como documento de identificação ou documento comprobatório. Se algum assunto, classe ou tipo de
> documento não existir com esse nome exato, escolha o mais próximo e me diga qual escolheu. Pare na tela
> de assinatura de cada processo e me mostre um resumo do cadastro para conferência.

## Depois

Com os números dos processos, registre cada peça no acervo do AM (`criar_peca`) e mova a pasta do
cliente para a de protocolados.
