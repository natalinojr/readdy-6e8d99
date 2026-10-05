import { Colunas, PaginaDelivery } from '../ui';
import SituacaoAgora from './inicio/SituacaoAgora';
import EntregasAgora from './inicio/EntregasAgora';
import EsperandoPix from './inicio/EsperandoPix';
import FaltaArrumar from './inicio/FaltaArrumar';
import Ultimos30Dias from './inicio/Ultimos30Dias';

// Início do Delivery (é por onde a tela abre): como está agora e o que falta arrumar.
// Esquerda: situação (abrir/pausar/fechar, o mesmo botão do caixa) + entregas em aberto + Pix esperando.
// Direita: o que falta arrumar (cada item leva à aba que resolve) + os números dos últimos 30 dias.
// No celular as duas colunas viram uma, nessa ordem.
export default function InicioAba() {
  return (
    <PaginaDelivery>
      <Colunas>
        <div className="space-y-5 min-w-0">
          <SituacaoAgora />
          <EntregasAgora />
          <EsperandoPix />
        </div>
        <div className="space-y-5 min-w-0">
          <FaltaArrumar />
          <Ultimos30Dias />
        </div>
      </Colunas>
    </PaginaDelivery>
  );
}
