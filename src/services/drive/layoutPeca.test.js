import test from 'node:test';
import assert from 'node:assert/strict';
import { inflateRawSync } from 'node:zlib';
import { montarDocxPeca, PADRAO } from './layoutPeca.js';

// Lê uma entrada do .docx (zip) sem dependência extra: diretório central → cabeçalho local → deflate.
function entrada(buf, nome) {
  let eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  let p = buf.readUInt32LE(eocd + 16);
  for (let i = 0, n = buf.readUInt16LE(eocd + 10); i < n; i++) {
    const metodo = buf.readUInt16LE(p + 10), tam = buf.readUInt32LE(p + 20);
    const lNome = buf.readUInt16LE(p + 28), lExtra = buf.readUInt16LE(p + 30), lCom = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    if (buf.toString('utf8', p + 46, p + 46 + lNome) === nome) {
      const ini = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const dados = buf.subarray(ini, ini + tam);
      return (metodo === 8 ? inflateRawSync(dados) : dados).toString('utf8');
    }
    p += 46 + lNome + lExtra + lCom;
  }
  return null;
}
const texto = xml => xml.replace(/<[^>]+>/g, '');

const PECA = [
  { tipo: 'enderecamento' },
  { tipo: 'paragrafo', texto: '**FULANO DE TAL**, brasileiro, por seus advogados, vem propor' },
  { tipo: 'titulo_acao', texto: 'Ação de cobrança' },
  { tipo: 'secao', numero: '1', texto: 'Dos fatos' },
  { tipo: 'citacao', texto: '“Texto citado.”', fonte: '(CF, art. 7º)' },
  { tipo: 'tabela', cabecalho: ['Ano', 'Valor'], linhas: [['2024', 'R$ 1,00']] },
  { tipo: 'alinea', texto: 'a) pedido;' },
  { tipo: 'fecho' },
];

test('montarDocxPeca: A4 com margens ABNT, cabeçalho, rodapé centralizado e "Página X de Y"', async () => {
  const buf = await montarDocxPeca(PECA);
  const doc = entrada(buf, 'word/document.xml');
  assert.match(doc, /<w:pgSz w:w="11906" w:h="16838"/);
  assert.match(doc, /w:top="1701"[^>]*w:right="1134"[^>]*w:bottom="1134"[^>]*w:left="1701"/);
  const corpo = texto(doc);
  assert.ok(corpo.includes(PADRAO.enderecamento));
  assert.ok(corpo.includes('AÇÃO DE COBRANÇA'));
  assert.ok(corpo.includes('1  DOS FATOS'));
  assert.ok(corpo.includes('Pede deferimento.'));
  for (const a of PADRAO.advogados) { assert.ok(corpo.includes(a.nome)); assert.ok(corpo.includes(a.oab)); }
  assert.ok(!corpo.includes('**'), 'marcação de negrito não pode vazar para o texto');
  const rodape = entrada(buf, 'word/footer1.xml');
  assert.match(rodape, /<w:jc w:val="center"\/>/);
  assert.match(rodape, /PAGE/); assert.match(rodape, /NUMPAGES/);
  assert.ok(texto(rodape).includes('atendimento@abrantesemontenegro.com.br'));
  assert.ok(texto(entrada(buf, 'word/header1.xml')).includes('ABRANTES &amp; MONTENEGRO'));
});

test('montarDocxPeca: recusa bloco inválido, peça vazia e tabela com colunas desiguais', async () => {
  await assert.rejects(montarDocxPeca([]), { status: 422 });
  await assert.rejects(montarDocxPeca([{ tipo: 'rodape', texto: 'x' }]), { status: 422 });
  await assert.rejects(montarDocxPeca([{ tipo: 'paragrafo', texto: '  ' }]), { status: 422 });
  await assert.rejects(montarDocxPeca([{ tipo: 'tabela', cabecalho: ['A', 'B'], linhas: [['1']] }]), { status: 422 });
});
