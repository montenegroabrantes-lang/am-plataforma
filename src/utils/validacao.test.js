import { test } from 'node:test';
import assert from 'node:assert/strict';
import { urlHttpsOuNulo } from './validacao.js';

// S-23 — links gravados só com https://. O que não for https vira null (o chamador decide: 422 ou descartar).

test('urlHttpsOuNulo: aceita https com endereço e devolve o texto sem espaços nas pontas', () => {
  assert.equal(urlHttpsOuNulo('https://drive.google.com/file/d/abc/view'), 'https://drive.google.com/file/d/abc/view');
  assert.equal(urlHttpsOuNulo('  https://pje.tjpb.jus.br/pje/x?a=1&b=2#topo  '), 'https://pje.tjpb.jus.br/pje/x?a=1&b=2#topo');
  assert.equal(urlHttpsOuNulo('HTTPS://EXEMPLO.COM/A'), 'HTTPS://EXEMPLO.COM/A');
});

test('urlHttpsOuNulo: javascript:, data:, http:, file: e afins viram null', () => {
  for (const v of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,<script>alert(1)</script>', 'http://exemplo.com',
    'file:///etc/passwd', 'vbscript:x', 'ftp://exemplo.com', 'blob:https://exemplo.com/x', '//exemplo.com/x', 'exemplo.com']) {
    assert.equal(urlHttpsOuNulo(v), null, v);
  }
});

test('urlHttpsOuNulo: https sem endereço, barra invertida, espaço e caractere de controle viram null', () => {
  for (const v of ['https://', 'https:///', 'https:', 'https:exemplo.com', 'https:\\\\exemplo.com', 'https://exem plo.com',
    'https://exemplo.com/a b', 'https://exemplo.com/\nx', 'https://exemplo.com/\u0000', 'https:// exemplo.com']) {
    assert.equal(urlHttpsOuNulo(v), null, JSON.stringify(v));
  }
});

test('urlHttpsOuNulo: usuário/senha embutidos (https://claude.ai@outro.com) são recusados', () => {
  assert.equal(urlHttpsOuNulo('https://claude.ai@outro-site.com/x'), null);
  assert.equal(urlHttpsOuNulo('https://usuario:senha@exemplo.com'), null);
});

test('urlHttpsOuNulo: vazio, nulo e tipos que não são texto viram null', () => {
  for (const v of ['', '   ', null, undefined, 0, 5, {}, [], ['https://exemplo.com'], true]) {
    assert.equal(urlHttpsOuNulo(v), null, String(v));
  }
});
