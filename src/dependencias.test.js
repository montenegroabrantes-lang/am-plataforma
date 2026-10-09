import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

// Lote S / S-15 e S-16 — trava o que o contêiner e as dependências não podem perder:
// Node 22, processo sem root, backup (pg_dump) funcionando sem o Chromium, instalação pelo
// lockfile. Não roda docker nem npm: lê os arquivos do repositório.
const require = createRequire(import.meta.url);
const semver = require('semver'); // já vem com jsonwebtoken e nodemon; não é dependência direta

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ler = (rel) => readFileSync(path.join(RAIZ, rel), 'utf8');
const dockerfile = ler('Dockerfile');
const pkg = JSON.parse(ler('package.json'));
const lock = JSON.parse(ler('package-lock.json'));

// Só as instruções do Dockerfile, sem comentários (os comentários citam "chromium" de propósito).
const instrucoes = dockerfile.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');

function arquivosJs(dir, saida = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) arquivosJs(p, saida);
    else if (/\.(m?js|cjs)$/.test(e.name)) saida.push(p);
  }
  return saida;
}
const fontes = arquivosJs(path.join(RAIZ, 'src')).filter((f) => !/\.test\.m?js$/.test(f));

// ── Dockerfile ────────────────────────────────────────────────────────────────

test('Dockerfile: Node 22 com Debian fixo em bookworm (nada de Node 20, nada de "slim" solto)', () => {
  const froms = instrucoes.split('\n').filter((l) => /^FROM\s/i.test(l.trim()));
  assert.deepEqual(froms, ['FROM node:22-bookworm-slim']);
});

test('Dockerfile: mantém o cliente PostgreSQL do PGDG (o pg_dump do backup vive nele)', () => {
  assert.match(instrucoes, /postgresql-common/);
  assert.match(instrucoes, /apt\.postgresql\.org\.sh/);
  assert.match(instrucoes, /apt-get install[^\n]*postgresql-client/);
  // O repositório PGDG tem de ser registrado ANTES de instalar o cliente, senão vem o pg_dump 15.
  assert.ok(instrucoes.indexOf('apt.postgresql.org.sh') < instrucoes.indexOf('postgresql-client'));
});

test('Dockerfile: sem Chromium nem bibliotecas de navegador', () => {
  assert.doesNotMatch(instrucoes, /chromium/i);
  assert.doesNotMatch(instrucoes, /PUPPETEER|CHROMIUM_PATH/);
  assert.doesNotMatch(instrucoes, /libnss3|libatk|libcups/);
});

test('Dockerfile: LibreOffice Writer sem interface + fontes Liberation para gerar os PDFs das peças', () => {
  assert.match(instrucoes, /libreoffice-writer-nogui/);
  assert.match(instrucoes, /fonts-liberation/);
  assert.doesNotMatch(instrucoes, /libreoffice(?!-writer-nogui)[\w-]*\s/, 'só o Writer sem interface, não a suíte inteira');
});

test('Dockerfile: instala pelo lockfile (npm ci --omit=dev), não por npm install', () => {
  assert.match(instrucoes, /^COPY package\.json package-lock\.json \.\/$/m);
  assert.match(instrucoes, /npm ci --omit=dev/);
  assert.doesNotMatch(instrucoes, /npm install/);
});

test('Dockerfile: o processo roda como "node", e não como root', () => {
  const linhas = instrucoes.split('\n').map((l) => l.trim()).filter(Boolean);
  const iUser = linhas.findIndex((l) => l === 'USER node');
  assert.ok(iUser > -1, 'falta USER node');
  const iCmd = linhas.findIndex((l) => /^CMD\s/.test(l));
  assert.ok(iUser < iCmd, 'USER node precisa vir antes do CMD');
  // Todo passo que precisa de root (apt, npm ci) vem antes do USER.
  const depois = linhas.slice(iUser + 1);
  assert.equal(depois.filter((l) => /^(RUN|COPY)\s/.test(l)).length, 0, 'nada de RUN/COPY depois do USER node');
  assert.match(instrucoes, /^COPY --chown=node:node \. \.$/m);
  assert.doesNotMatch(instrucoes, /^USER\s+root/m);
});

test('.dockerignore: node_modules local e .env ficam fora da imagem', () => {
  assert.ok(existsSync(path.join(RAIZ, '.dockerignore')));
  const linhas = ler('.dockerignore').split('\n').map((l) => l.trim());
  for (const item of ['node_modules', '.git', '.env', '.env.*']) assert.ok(linhas.includes(item), `falta ${item}`);
});

test('railway.json: build por Dockerfile e pré-deploy do migrate.js continuam (rodam como "node")', () => {
  const railway = JSON.parse(ler('railway.json'));
  assert.equal(railway.build.builder, 'DOCKERFILE');
  assert.equal(railway.deploy.preDeployCommand, 'node migrate.js');
  assert.equal(railway.deploy.startCommand, 'node src/index.js');
  assert.ok(existsSync(path.join(RAIZ, 'migrate.js')));
});

// ── Usuário "node" e disco ────────────────────────────────────────────────────

test('sem root: só o backup e a conversão de peças gravam em disco, e ambos em /tmp (gravável por qualquer usuário)', () => {
  const gravadores = fontes.filter((f) => /\b(writeFile|writeFileSync|appendFile|appendFileSync|createWriteStream|mkdirSync|mkdir)\s*\(/.test(readFileSync(f, 'utf8')));
  assert.deepEqual(
    gravadores.map((f) => path.relative(RAIZ, f)).sort(),
    ['src/services/drive/pecas.js', 'src/workers/backup.worker.js'],
    'código novo que grava em disco precisa apontar para /tmp (o processo é o usuário node, /app não é dele)',
  );
  assert.match(readFileSync(path.join(RAIZ, 'src/workers/backup.worker.js'), 'utf8'), /BACKUP_DIR\s*=\s*process\.env\.BACKUP_DIR \|\| '\/tmp\/am-backups'/);
  // A conversão de peças grava só num diretório temporário do sistema (mkdtemp em tmpdir()) e o apaga.
  const pecas = readFileSync(path.join(RAIZ, 'src/services/drive/pecas.js'), 'utf8');
  assert.match(pecas, /mkdtemp\(join\(tmpdir\(\), 'am-peca-'\)\)/);
  assert.match(pecas, /rm\(dir, \{ recursive: true, force: true \}\)/);
});

// ── package.json ──────────────────────────────────────────────────────────────

test('package.json: Puppeteer e plugins fora, engines pede Node 22 ou mais novo', () => {
  const todas = { ...pkg.dependencies, ...pkg.devDependencies };
  for (const nome of Object.keys(todas)) assert.doesNotMatch(nome, /puppeteer|chromium/i, nome);
  assert.ok(semver.intersects(pkg.engines.node, '>=22'));
  assert.ok(!semver.satisfies('20.19.0', pkg.engines.node), 'engines ainda aceita Node 20');
  assert.ok(semver.satisfies('22.11.0', pkg.engines.node));
});

test('src/ e scripts: nenhum arquivo importa Puppeteer nem lê CHROMIUM_PATH', () => {
  const alvos = [...fontes, path.join(RAIZ, 'migrate.js'), path.join(RAIZ, 'reset-senha.js')];
  for (const f of alvos) {
    const codigo = readFileSync(f, 'utf8');
    assert.doesNotMatch(codigo, /(from|require\(|import\()\s*['"]puppeteer/, path.relative(RAIZ, f));
    assert.doesNotMatch(codigo, /CHROMIUM_PATH/, path.relative(RAIZ, f));
  }
});

// ── package-lock.json ─────────────────────────────────────────────────────────

test('package-lock.json: a árvore do Puppeteer saiu do lockfile', () => {
  const nomes = Object.keys(lock.packages);
  for (const p of ['puppeteer', 'puppeteer-core', 'puppeteer-extra', 'puppeteer-extra-plugin-stealth', '@puppeteer/browsers', 'chromium-bidi', 'tar-fs']) {
    assert.ok(!nomes.includes(`node_modules/${p}`), `${p} ainda está no lockfile`);
  }
});

function divergenciasDoLock() {
  const divergentes = new Set();
  const raiz = lock.packages[''];
  for (const secao of ['dependencies', 'devDependencies']) {
    for (const [nome, faixa] of Object.entries(pkg[secao] ?? {})) {
      const travado = lock.packages[`node_modules/${nome}`];
      if (!travado || !semver.satisfies(travado.version, faixa, { includePrerelease: true })) divergentes.add(nome);
    }
    // O inverso: sobra no lockfile o que o package.json já tirou.
    for (const nome of Object.keys(raiz[secao] ?? {})) if (!(nome in (pkg[secao] ?? {}))) divergentes.add(nome);
  }
  return [...divergentes].sort();
}

test('package-lock.json em sincronia com o package.json (npm ci não pode recusar o build)', () => {
  assert.deepEqual(divergenciasDoLock(), [], 'o lockfile não acompanha o package.json: rode "npm install --package-lock-only" na pasta do backend e commite o package-lock.json');
});

test('lockfile: bcrypt 6 e multer 2 (sem a árvore node-pre-gyp/tar do bcrypt 5 e sem o multer 1.x avisado)', () => {
  const p = (nome) => lock.packages[`node_modules/${nome}`];
  assert.ok(semver.satisfies(p('bcrypt').version, '^6'), `bcrypt ${p('bcrypt').version}`);
  assert.ok(semver.satisfies(p('multer').version, '^2'), `multer ${p('multer').version}`);
  assert.equal(p('multer').deprecated, undefined, 'multer 1.x vem marcado como deprecated por vulnerabilidades');
  assert.equal(p('@mapbox/node-pre-gyp'), undefined);
  assert.equal(p('tar'), undefined);
  assert.ok(p('node-gyp-build'), 'bcrypt 6 usa binários pré-compilados via node-gyp-build');
});

test('lockfile: axios e express nos pisos pedidos pelo package.json', () => {
  assert.ok(semver.satisfies(lock.packages['node_modules/axios'].version, pkg.dependencies.axios));
  assert.ok(semver.satisfies(lock.packages['node_modules/express'].version, pkg.dependencies.express));
  assert.ok(semver.gte(lock.packages['node_modules/express'].version, '4.21.2'), 'express antes de 4.21.2 tem path-to-regexp vulnerável');
});
