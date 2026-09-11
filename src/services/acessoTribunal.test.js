import test from 'node:test';
import assert from 'node:assert/strict';
import { extrairIdProcessoPje, obterAcessoTribunal } from './acessoTribunal.js';

test('TJPB abre a instância PJe correspondente ao grau', () => {
  assert.equal(obterAcessoTribunal({ tribunal: 'TJPB', grau: '1' }).url, 'https://pje.tjpb.jus.br/pje/');
  assert.equal(obterAcessoTribunal({ tribunal: 'tjpb', grau: '2' }).url, 'https://pjesg.tjpb.jus.br/pje2g/');
});

test('TJPE abre o PJe Cloud no grau correto', () => {
  assert.equal(obterAcessoTribunal({ tribunal: 'TJPE', grau: '1' }).url, 'https://pje.cloud.tjpe.jus.br/1g/');
  assert.equal(obterAcessoTribunal({ tribunal: 'TJPE', grau: '2' }).url, 'https://pje.cloud.tjpe.jus.br/2g/');
});

test('demais tribunais usam portal oficial e nunca URL vinda do banco', () => {
  const trf5 = obterAcessoTribunal({ tribunal: 'TRF5', grau: '2', url: 'https://malicioso.invalid' });
  assert.equal(trf5.url, 'https://www.trf5.jus.br/');
  assert.equal(trf5.destino, 'portal');

  const desconhecido = obterAcessoTribunal({ tribunal: 'javascript:alert(1)' });
  assert.equal(desconhecido.disponivel, false);
  assert.equal(desconhecido.url, null);
});

test('ID interno gera link estável que abre diretamente os autos', () => {
  const acesso = obterAcessoTribunal({ tribunal: 'TJPB', grau: '1', pje_id_processo: '3422889' });
  assert.equal(acesso.url, 'https://pje.tjpb.jus.br/pje/Processo/ConsultaProcesso/Detalhe/listAutosDigitais.seam?idProcesso=3422889');
  assert.equal(acesso.direto_aos_autos, true);
  assert.match(acesso.rotulo, /Abrir autos/);
});

test('extrai somente o ID de URL oficial e descarta token de sessão', () => {
  const id = extrairIdProcessoPje(
    'https://pje.tjpb.jus.br/pje/Processo/ConsultaProcesso/Detalhe/listProcessoCompletoAdvogado.seam?id=3422889&ca=segredo-temporario',
    { tribunal: 'TJPB', grau: '1' }
  );
  assert.equal(id, '3422889');
  assert.equal(extrairIdProcessoPje('', { tribunal: 'TJPB', grau: '1' }), null);
});

test('recusa URL de outro domínio ou grau', () => {
  assert.throws(
    () => extrairIdProcessoPje('https://malicioso.invalid/pje/listAutosDigitais.seam?idProcesso=1', { tribunal: 'TJPB', grau: '1' }),
    /não pertence/
  );
  assert.throws(
    () => extrairIdProcessoPje('https://pjesg.tjpb.jus.br/pje2g/Processo/ConsultaProcesso/Detalhe/listAutosDigitais.seam?idProcesso=1', { tribunal: 'TJPB', grau: '1' }),
    /não pertence/
  );
});
