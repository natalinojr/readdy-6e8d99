import Folha from '../inicio/Folha';
import type { FiltroArrumar } from '../../EstoqueTela';

// "Arrumar a lista" (layout novo): cadastro um por um, só o que falta. ESQUELETO — preenchido na etapa da ficha.
export default function ArrumarFolha({ aberta, filtro, insumoId, onFechar }: {
  aberta: boolean;
  filtro?: FiltroArrumar;
  insumoId?: string;
  onFechar: () => void;
}) {
  void filtro; void insumoId;
  return (
    <Folha aberta={aberta} titulo="Arrumar a lista" onFechar={onFechar}>
      <p className="text-sm text-zinc-500 py-4">Carregando…</p>
    </Folha>
  );
}
