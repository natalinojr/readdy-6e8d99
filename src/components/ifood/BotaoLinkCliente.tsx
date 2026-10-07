import { useEffect, useState } from 'react';
import { copiarLinkCliente } from '@/lib/ifoodLinkCliente';

// "Copiar link do cliente" no pedido do iFood (/ifood e Gestor de Entregas › Pedidos do iFood).
// Copia "Acompanhe seu pedido: <link>" para colar no chat do iFood. Se o navegador não deixar copiar,
// mostra o texto para selecionar à mão.

export default function BotaoLinkCliente({ ifoodOrderId, compacto }: { ifoodOrderId: string; compacto?: boolean }) {
  const [estado, setEstado] = useState<'livre' | 'busy' | 'copiado'>('livre');
  const [erro, setErro] = useState<{ t: string; texto?: string } | null>(null);

  useEffect(() => {
    if (estado !== 'copiado') return;
    const id = setTimeout(() => setEstado('livre'), 4000);
    return () => clearTimeout(id);
  }, [estado]);

  const copiar = async () => {
    setEstado('busy');
    setErro(null);
    const r = await copiarLinkCliente(ifoodOrderId);
    if (r.ok) { setEstado('copiado'); return; }
    setEstado('livre');
    setErro({ t: r.erro, texto: r.texto });
  };

  const base = compacto
    ? 'px-2.5 py-1.5 rounded-lg text-xs font-semibold'
    : 'min-h-[34px] px-3 rounded-xl text-[12.5px] font-bold';
  const cor = estado === 'copiado'
    ? 'bg-emerald-50 border border-emerald-200 text-emerald-700'
    : 'bg-white border border-zinc-200 text-zinc-700 hover:bg-zinc-50';

  return (
    <>
      <button type="button" disabled={estado === 'busy'} onClick={copiar}
        title="Copia “Acompanhe seu pedido: <link>” para colar no chat do iFood"
        className={`inline-flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50 whitespace-nowrap ${base} ${cor}`}>
        {estado === 'busy' ? '…' : estado === 'copiado'
          ? <><i className="ri-check-line" /> Copiado — cole no chat do iFood</>
          : <><i className="ri-links-line" /> Copiar link do cliente</>}
      </button>
      {erro && (
        <div className="basis-full text-[12px] rounded-xl p-2 border text-red-600 bg-red-50 border-red-100">
          {erro.t}
          {erro.texto && <input readOnly value={erro.texto} onFocus={(e) => e.currentTarget.select()} className="mt-1.5 block w-full px-2 py-1 rounded-lg border border-zinc-200 bg-white text-zinc-800 text-[12px]" />}
        </div>
      )}
    </>
  );
}
