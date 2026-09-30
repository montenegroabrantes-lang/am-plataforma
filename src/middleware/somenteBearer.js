// Rotas isentas da checagem de Origin (S-01) não podem aceitar o cookie de sessão, senão um
// site externo aproveitaria o cookie do navegador do usuário. O /mcp é chamado só pelo conector
// (Authorization: Bearer): exige o cabeçalho e esconde os cookies do `autenticar`, que lê o
// cookie antes do Bearer.
export function somenteBearer(req, res, next) {
  if (!/^Bearer \S/.test(req.headers?.authorization || '')) {
    return res.status(401).json({ ok: false, erro: 'Token não fornecido.' });
  }
  req.cookies = {};
  next();
}
