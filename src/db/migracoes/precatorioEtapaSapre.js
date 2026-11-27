// 26/11/2026: etapa "Enviado ao SAPRE" na ficha do precatório. A ordem real é minuta → certidão do cartório de
// que enviou ao SAPRE → juiz assina; antes a ficha pulava da minuta para "Assinado".
//
// Uso em src/index.js: await migrar('2026_11_26_precatorio_etapa_sapre', () => db.transaction(tx => aplicarEtapaSapre(tx)));
//
// Só troca a trava de valores aceitos em `precatorios.etapa` pela lista atual de ETAPAS. Nenhuma linha muda:
// a lista nova contém todos os valores da antiga, então a troca nunca rejeita um registro existente.
import { ETAPAS } from '../../services/precatorios/regras.js';

export async function aplicarEtapaSapre(conexao) {
  const lista = ETAPAS.map(e => `'${e.chave}'`).join(',');
  await conexao.execute('ALTER TABLE precatorios DROP CONSTRAINT IF EXISTS precatorios_etapa_check');
  await conexao.execute(`ALTER TABLE precatorios ADD CONSTRAINT precatorios_etapa_check CHECK (etapa IN (${lista}))`);
}
