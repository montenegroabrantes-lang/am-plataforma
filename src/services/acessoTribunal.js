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
  const tribunal = String(processo.tribunal || '').trim().toUpperCase();
  const grau = String(processo.grau || '1') === '2' ? '2' : '1';
  const urlPje = PJE_POR_TRIBUNAL[tribunal]?.[grau];

  if (urlPje) {
    return {
      disponivel: true,
      url: urlPje,
      rotulo: `Abrir no PJe · ${grau}º grau`,
      destino: 'pje',
      direto_aos_autos: false,
      copiar_numero: true,
      aviso: 'O número será copiado. Se a sessão não localizar os autos automaticamente, cole-o na pesquisa do PJe.',
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
