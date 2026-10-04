import Folha from '../inicio/Folha';

// Ficha do insumo (layout novo): tudo de um insumo num lugar só. ESQUELETO — preenchido na etapa da ficha.
export default function FichaInsumoFolha({ insumoId, onFechar }: { insumoId: string | null; onFechar: () => void }) {
  return (
    <Folha aberta={!!insumoId} titulo="Insumo" onFechar={onFechar}>
      <p className="text-sm text-zinc-500 py-4">Carregando…</p>
    </Folha>
  );
}
