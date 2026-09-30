import express from 'express';

// `application/x-www-form-urlencoded` só onde é necessário (S-01): o formulário do próprio
// /oauth/authorize e o /oauth/token. Antes o parser era global e um formulário HTML de outro
// site conseguia enviar corpo às rotas autenticadas por cookie. Precisa ser montado antes do
// oauthRouter.
export function montarUrlencodedOauth(app) {
  const parser = express.urlencoded({ extended: false, limit: '32kb' });
  app.post(['/oauth/authorize', '/oauth/token'], parser);
}
