// Estúdio de Criação › Biblioteca — fotos do cardápio com nota de qualidade da IA.
import { useState } from 'react';
import { Images, Sparkles, Loader2, ChevronDown, ChevronUp, ImageOff, Wand2 } from 'lucide-react';
import { brl } from '../../trafego-pago/shared';
import { NotaBadge, EstadoVazio, type LibItem } from '../shared';

interface Props {
  tenantId: string;
  items: LibItem[];
  loading: boolean;
  error: string | null;
  isManager: boolean;
  onAnalisar: () => Promise<void>;
  onCriarArte: (itemId: string) => void;
}

export default function BibliotecaTab({ items, loading, error, isManager, onAnalisar, onCriarArte }: Props) {
  const [analisando, setAnalisando] = useState(false);
  const [aberto, setAberto] = useState<string | null>(null);

  const analisar = async () => {
    setAnalisando(true);
    try { await onAnalisar(); } finally { setAnalisando(false); }
  };

  if (loading) {
    return <div className="flex items-center justify-center py-20 text-zinc-400"><Loader2 size={24} className="animate-spin text-fuchsia-500" /></div>;
  }

  if (error) {
    return <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-600">{error}</div>;
  }

  if (items.length === 0) {
    return <EstadoVazio icon={Images} titulo="Nada no cardápio ainda" texto="Cadastre itens com foto no Cardápio para eles aparecerem aqui." />;
  }

  const comFoto = items.filter((i) => i.photo_url);
  const semFoto = items.filter((i) => !i.photo_url);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <p className="text-xs text-zinc-400">{comFoto.length} item(ns) com foto{semFoto.length ? `, ${semFoto.length} sem foto` : ''}</p>
        {isManager && (
          <button onClick={analisar} disabled={analisando}
            className="ml-auto inline-flex items-center gap-1.5 px-3 py-2 text-sm font-bold rounded-xl bg-fuchsia-600 text-white hover:bg-fuchsia-700 cursor-pointer disabled:opacity-50">
            {analisando ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
            {analisando ? 'Avaliando fotos...' : 'Avaliar fotos com IA'}
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {comFoto.map((item) => {
          const exp = aberto === item.item_id;
          const temAnalise = !!item.analise && ((item.analise.pontos_fortes?.length ?? 0) > 0 || (item.analise.problemas?.length ?? 0) > 0);
          return (
            <div key={item.item_id} className="bg-white border border-zinc-200 rounded-xl overflow-hidden flex flex-col">
              <div className="aspect-square bg-zinc-50 relative">
                <img src={item.photo_url ?? ''} alt={item.name} className="w-full h-full object-cover" />
                <div className="absolute top-1.5 left-1.5">
                  <NotaBadge nota={item.nota_qualidade} />
                </div>
              </div>
              <div className="p-2.5 flex-1 flex flex-col gap-1.5">
                <p className="text-xs font-bold text-zinc-800 truncate" title={item.name}>{item.name}</p>
                <p className="text-xs text-zinc-500">{brl(item.price)}</p>
                {temAnalise && (
                  <button onClick={() => setAberto(exp ? null : item.item_id)} className="inline-flex items-center gap-1 text-[10px] font-semibold text-fuchsia-600 cursor-pointer w-fit">
                    {exp ? <ChevronUp size={11} /> : <ChevronDown size={11} />} {exp ? 'Esconder' : 'Ver avaliação'}
                  </button>
                )}
                {exp && item.analise && (
                  <div className="text-[10px] text-zinc-500 leading-relaxed space-y-1">
                    {(item.analise.pontos_fortes ?? []).length > 0 && (
                      <p><span className="text-emerald-600 font-semibold">Pontos fortes:</span> {item.analise.pontos_fortes!.join(', ')}</p>
                    )}
                    {(item.analise.problemas ?? []).length > 0 && (
                      <p><span className="text-red-500 font-semibold">Problemas:</span> {item.analise.problemas!.join(', ')}</p>
                    )}
                  </div>
                )}
                <button onClick={() => onCriarArte(item.item_id)}
                  className="mt-auto inline-flex items-center justify-center gap-1.5 px-2 py-1.5 text-xs font-bold rounded-lg bg-amber-500 text-white hover:bg-amber-600 cursor-pointer">
                  <Wand2 size={12} /> Criar arte
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {semFoto.length > 0 && (
        <div>
          <p className="text-xs font-bold text-zinc-500 mb-2 flex items-center gap-1.5"><ImageOff size={13} /> Sem foto — não entram em arte</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {semFoto.map((item) => (
              <div key={item.item_id} className="bg-zinc-50 border border-dashed border-zinc-200 rounded-xl p-3 flex flex-col gap-1">
                <div className="aspect-square bg-zinc-100 rounded-lg flex items-center justify-center"><ImageOff size={22} className="text-zinc-300" /></div>
                <p className="text-xs font-semibold text-zinc-500 truncate mt-1" title={item.name}>{item.name}</p>
                <p className="text-[10px] text-zinc-400">{brl(item.price)}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
