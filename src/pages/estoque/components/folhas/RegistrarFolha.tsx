import Folha from '../inicio/Folha';

// "+ Registrar" (layout novo): "o que aconteceu no estoque?". ESQUELETO — preenchido na etapa do Registrar.
export default function RegistrarFolha({ aberta, onFechar }: { aberta: boolean; onFechar: () => void }) {
  return (
    <Folha aberta={aberta} titulo="O que aconteceu no estoque?" onFechar={onFechar}>
      <p className="text-sm text-zinc-500 py-4">Carregando…</p>
    </Folha>
  );
}
