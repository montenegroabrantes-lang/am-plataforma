// Destinos externos permitidos para abrir o sistema judicial. A lista explícita evita
// open redirect baseado em valores livres do banco. O AM nunca envia senha, cookie ou
// certificado: a autenticação continua no navegador do usuário, diretamente no tribunal.
const PJE_POR_TRIBUNAL = {
  TJPB: {
    '1': 'https://pje.tjpb.jus.br/pje/',
    '2': 'https://pjesg.tjpb.jus.br/pje2g/',
  },
  TJPE: {
    '1': 'https://pje.cloud.tjpe.jus.br/1g/',
    '2': 'https://pje.cloud.tjpe.jus.br/2g/',
  },
};

const ID_PROCESSO_PJE = /^[1-9]\d{0,19}$/;

function configuracaoPje(processo = {}) {
  const tribunal = String(processo.tribunal || '').trim().toUpperCase();
  const grau = String(processo.grau || '1') === '2' ? '2' : '1';
  return { tribunal, grau, raiz: PJE_POR_TRIBUNAL[tribunal]?.[grau] || null };
}

// Aceita o ID puro ou uma URL copiada da tela de autos. Somente o identificador
// numérico é persistido: tokens efêmeros de sessão como `ca` são descartados.
export function extrairIdProcessoPje(valor, processo = {}) {
  const entrada = String(valor ?? '').trim();
  if (!entrada) return null;

  const { raiz } = configuracaoPje(processo);
  if (!raiz) throw new Error('Este tribunal ainda não possui acesso PJe direto configurado.');
  if (ID_PROCESSO_PJE.test(entrada)) return entrada;

  let url;
  try { url = new URL(entrada); } catch { throw new Error('Informe o ID numérico ou copie a URL dos autos no PJe.'); }
  const raizUrl = new URL(raiz);
  if (url.protocol !== 'https:' || url.origin !== raizUrl.origin || !url.pathname.startsWith(raizUrl.pathname)) {
    throw new Error('A URL não pertence ao PJe oficial deste tribunal e grau.');
  }

  const telaValida = /\/(?:listAutosDigitais|listProcessoCompletoAdvogado)\.seam$/i.test(url.pathname);
  const id = url.searchParams.get('idProcesso') || url.searchParams.get('id');
  if (!telaValida || !ID_PROCESSO_PJE.test(id || '')) {
    throw new Error('Abra os autos do processo no PJe e copie a URL completa da barra do navegador.');
  }
  return id;
}

const PORTAIS_OFICIAIS = {
  TJRN: 'https://www.tjrn.jus.br/',
  TJAL: 'https://www.tjal.jus.br/',
  TJBA: 'https://www.tjba.jus.br/',
  TJCE: 'https://www.tjce.jus.br/',
  TJMA: 'https://www.tjma.jus.br/',
  TJPI: 'https://www.tjpi.jus.br/',
  TJSE: 'https://www.tjse.jus.br/',
  TRF1: 'https://portal.trf1.jus.br/',
  TRF3: 'https://www.trf3.jus.br/',
  TRF4: 'https://www.trf4.jus.br/',
  TRF5: 'https://www.trf5.jus.br/',
  TRF6: 'https://portal.trf6.jus.br/',
};

export function obterAcessoTribunal(processo = {}) {
  const { tribunal, grau, raiz: urlPje } = configuracaoPje(processo);

  if (urlPje) {
    const idProcesso = ID_PROCESSO_PJE.test(String(processo.pje_id_processo || ''))
      ? String(processo.pje_id_processo)
      : null;
    const url = idProcesso
      ? `${urlPje}Processo/ConsultaProcesso/Detalhe/listAutosDigitais.seam?idProcesso=${encodeURIComponent(idProcesso)}`
      : urlPje;
    return {
      disponivel: true,
      url,
      rotulo: idProcesso ? `Abrir autos no PJe · ${grau}º grau` : `Ir ao PJe e pesquisar · ${grau}º grau`,
      destino: 'pje',
      direto_aos_autos: Boolean(idProcesso),
      copiar_numero: true,
      aviso: idProcesso
        ? 'Abre diretamente os autos usando o identificador interno do PJe. A autenticação continua no tribunal.'
        : 'O vínculo direto ainda não foi configurado. O número será copiado para a pesquisa do PJe.',
    };
  }

  const urlPortal = PORTAIS_OFICIAIS[tribunal];
  if (urlPortal) {
    return {
      disponivel: true,
      url: urlPortal,
      rotulo: `Abrir portal ${tribunal}`,
      destino: 'portal',
      direto_aos_autos: false,
      copiar_numero: true,
      aviso: 'O número será copiado. Selecione o sistema e cole-o na consulta do tribunal.',
    };
  }

  return {
    disponivel: false,
    url: null,
    rotulo: 'Copiar número CNJ',
    destino: 'indisponivel',
    direto_aos_autos: false,
    copiar_numero: true,
    aviso: 'Tribunal ainda sem destino externo validado. Use o número CNJ na consulta oficial.',
  };
}
