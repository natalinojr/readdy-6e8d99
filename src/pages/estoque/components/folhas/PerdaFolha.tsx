import Folha from '../inicio/Folha';

// Registrar perda em 3 toques (layout novo). ESQUELETO — preenchido na etapa do Registrar.
export default function PerdaFolha({ aberta, insumoId, onFechar }: { aberta: boolean; insumoId?: string; onFechar: () => void }) {
  void insumoId;
  return (
    <Folha aberta={aberta} titulo="Registrar perda" onFechar={onFechar}>
      <p className="text-sm text-zinc-500 py-4">Carregando…</p>
    </Folha>
  );
}
