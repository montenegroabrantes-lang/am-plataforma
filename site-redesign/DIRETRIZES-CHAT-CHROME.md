# Diretrizes: redesign do site abrantesemontenegro.com.br (para o Claude no Chrome)

Cole este texto inteiro no início da conversa com o Claude no Chrome, com o wp-admin já logado em uma aba.

## 1. Objetivo
Deixar o site do escritório Abrantes & Montenegro Advogados mais profissional, moderno e que converta em contato por WhatsApp, usando como inspiração visual o site nwadv.com.br (botões retangulares de cantos retos, dourados, em caixa alta; fundo escuro; cartões grandes com foto). O vídeo da tela inicial do escritório deve ser mantido: muda só a forma de exibição.

## 2. Estado atual (já feito)
- Backup completo do UpdraftPlus feito em 14/10 (guardado só no servidor).
- WP Staging instalado; cópia de teste em `/cerritos/` (exige login, noindex).
- Página de rascunho **ID 3597** com o topo novo: vídeo ao fundo (`.mov` no computador, `.mp4` vertical no celular), título, botão verde de WhatsApp, botão dourado sólido, faixa de confiança e WhatsApp flutuante. O vídeo foi conferido pelo usuário e toca.
- Página inicial atual: **ID 19**, intacta.
- Código-base do topo no repositório: `site-redesign/home-topo-am.html` (PR draft `montenegroabrantes-lang/am-plataforma#10`).

## 3. Regras de segurança (inegociáveis)
1. Edite **somente a página 3597**. Nunca edite a página 19, o tema, os menus globais nem as configurações do site sem pedir.
2. **Não clique em Publicar** e não troque a página inicial em Configurações → Leitura sem o usuário dizer "publique" naquele momento. Salvar como rascunho é sempre permitido.
3. Não peça, não digite e não registre senhas. Use só a sessão já logada.
4. Antes de qualquer mudança grande, confirme que existe backup recente. Se não houver, avise.
5. Não apague nada: oculte (o vídeo antigo está oculto, não apagado).
6. Não instale nem atualize plugins, nem mude a versão do PHP, sem pedir.
7. Se algo falhar ou não estiver claro, pare e pergunte. Não improvise.

## 4. Identidade visual
- Variáveis CSS declaradas **dentro de `.am-srv {}`**, nunca em `:root` (o Elementor isola o widget).
- Cores: `--night:#181E28; --deep:#1B212D; --coal:#2C3338; --gold:#B9A13F; --gold2:#8A7729; --gold3:#d4b854; --panel:#F4F8FA; --border:#E5E7EB; --muted:#69727D; --wa:#25D366; --wa2:#1ebe5d`.
- Títulos: Baskervville (serif), peso 400. Corpo: Roboto.
- Botões: retangulares, `border-radius:0`, caixa alta, `letter-spacing:.08em`, padding 14px 40px. Primário dourado sólido (texto escuro); secundário vazado dourado; WhatsApp verde. No hover o dourado inverte para fundo escuro com texto dourado.
- Fragmentos HTML puros (sem `<html>`, `<head>`, `<body>`), com `<style>` primeiro, dentro de um widget HTML, em seção de largura total. Incluir o CSS de escape do container e o ajuste do menu (como em `home-topo-am.html`).
- Texto sempre alinhado à esquerda (o tema justifica por padrão; corrigir).

## 5. Estratégia: ordem das seções (uma por vez, sempre no rascunho 3597)
1. **Topo** (feito). Ajustar só o que o usuário pedir.
2. **Áreas de atuação**: cards grandes com foto, estilo NW ("Atuação" + subtítulo). Começar por Direito Administrativo e ações contra a Fazenda Pública, e Advocacia para Servidores Públicos. Cada card com botão "Saiba mais". Criar o identificador `id="areas-de-atuacao"` nesta seção, porque o botão do topo aponta para ele.
3. **Quem somos**: texto curto (aproveitar o atual: atuação em defesa dos servidores públicos, assessoria preventiva, contenciosa e consultiva, atendimento personalizado), com foto.
4. **Profissionais**: Ramon (OAB/PB 23.395) e Luciano (OAB/PB 23.176), com foto. Pedir as fotos ao usuário.
5. **Provas de confiança**: avaliações do Google (5 estrelas, já há widget Trustindex), números reais apenas se o usuário fornecer.
6. **Blog** (3 últimos posts, cartões de altura igual) e **rodapé** com identificação completa.
7. Revisão final de celular, velocidade e SEO.

## 6. Conteúdo e conformidade (Provimento CFOAB 205/2021)
- Sem promessa de resultado, sem garantia de êxito, sem a palavra "gratuito", sem captação agressiva. Tom sóbrio e informativo.
- Não nomear verbas específicas nos textos de captação. Honorários discutidos no atendimento.
- Identificação visível: Abrantes & Montenegro Advogados, Sociedade de Advogados, OAB/PB 2300244, CNPJ 52.160.310/0001-77, Av. Cabo Branco, 1780, Cabo Branco, João Pessoa/PB, CEP 58045-010, telefone/WhatsApp (83) 3142-9844, e-mail atendimento@abrantesemontenegro.com.br, Instagram @abrantesemontenegro.
- Link do WhatsApp: `https://wa.me/558331429844?text=Ol%C3%A1%2C%20gostaria%20de%20falar%20com%20um%20dos%20advogados.`
- Revisar os posts do blog com tom de promessa ("tem direito", "garantido") antes de destacá-los.

## 7. SEO e desempenho
- Um único H1 na página ("Advocacia especializada em servidores públicos").
- `<title>` e meta description da página (hoje o título é só "advogados"). Sugestão de título: "Abrantes & Montenegro Advogados | Advocacia para servidores públicos em João Pessoa".
- Texto alternativo (alt) em todas as imagens. Imagens em WebP.
- **Vídeo:** o atual é pesado (`.mov` de 16,5 MB e `.mp4` de 31 MB). Plano: gerar `.mp4` H.264 de cerca de 5 MB para o computador e uma versão vertical para o celular, mais um poster (imagem de capa). Pedir o arquivo original ao usuário. Não trocar o vídeo sem ele enviar o original.
- Dados estruturados `LegalService` (schema) com endereço, telefone e OAB.
- Pendências técnicas só para sugerir ao usuário (não executar): atualizar PHP 7.4, ativar cache, reduzir scripts, WP-Cron desligado via `DISABLE_WP_CRON`.

## 8. Como trabalhar a cada etapa
1. Dizer o que vai fazer antes de fazer.
2. Fazer **uma seção por vez** na 3597, salvar como rascunho.
3. Abrir a prévia (`?page_id=3597&preview=true`) com a janela visível, no tamanho de computador e de celular, e **mandar prints** ao usuário.
4. Conferir que a página 19 continua sem alteração.
5. Só avançar para a próxima seção depois do "ok" do usuário.

## 9. Publicação (somente quando o usuário mandar)
1. Confirmar backup e baixar uma cópia do UpdraftPlus para o computador do usuário.
2. Publicar a 3597 e, se pedido, definir como página inicial em Configurações → Leitura (página inicial antiga = ID 19, para poder voltar).
3. Limpar o cache do WP Rocket.
4. Testar em janela anônima, no computador e no celular: vídeo, botões, WhatsApp, menu e o botão "Áreas de atuação".
5. Avisar o usuário e pedir que ele atualize o `CONTEXTO-SISTEMA-AM.md` no outro chat com o resultado.

## 10. Rollback
Configurações → Leitura → voltar a página inicial para a ID 19 → limpar o cache. O backup do UpdraftPlus de 14/10 permite restaurar o banco e os arquivos.
