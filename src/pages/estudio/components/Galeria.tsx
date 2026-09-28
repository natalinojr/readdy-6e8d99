// Estúdio de Criação › Galeria — todas as artes já geradas, com decisão e download.
import { useMemo, useState } from 'react';
import { Images, Download, Check, X, Trash2, Loader2, AlertTriangle } from 'lucide-react';
import { invokeWithAuth } from '@/lib/supabase';
import { confirmar } from '@/components/base/Dialogos';
import { dataHora } from '../../trafego-pago/shared';
import { EstadoVazio, STATUS_LABEL, STATUS_CLS, FORMATO_LABEL, type Creative, type CreativeStatus } from '../shared';

interface Props {
  tenantId: string;
  creatives: Creative[];
  loading: boolean;
  error: string | null;
  isManager: boolean;
  onChanged: (c: Creative) => void;
  onDeleted: (id: string) => void;
}

const FILTROS: { id: CreativeStatus | 'todas'; label: string }[] = [
  { id: 'todas', label: 'Todas' },
  { id: 'rascunho', label: 'Rascunho' },
  { id: 'aprovada', label: 'Aprovada' },
  { id: 'reprovada', label: 'Reprovada' },
];

export default function GaleriaTab({ tenantId, creatives, loading, error, isManager, onChanged, onDeleted }: Props) {
  const [filtro, setFiltro] = useState<CreativeStatus | 'todas'>('todas');
  const [ocupado, setOcupado] = useState<string | null>(null);

  const lista = useMemo(
    () => (filtro === 'todas' ? creatives : creatives.filter((c) => c.status === filtro)),
    [creatives, filtro],
  );

  const decidir = async (c: Creative, status: 'aprovada' | 'reprovada') => {
    setOcupado(c.id);
    const { data, error: err } = await invokeWithAuth<{ success: boolean; creative: Creative; error?: string }>('estudio', {
      body: { action: 'decide', tenant_id: tenantId, creative_id: c.id, status },
    });
    setOcupado(null);
    if (!err && data?.success) onChanged(data.creative);
  };

  const excluir = async (c: Creative) => {
    if (!(await confirmar({ titulo: 'Excluir esta arte?', mensagem: 'Não dá para desfazer.', confirmarLabel: 'Excluir', perigo: true }))) return;
    setOcupado(c.id);
    const { error: err } = await invokeWithAuth('estudio', { body: { action: 'delete_creative', tenant_id: tenantId, creative_id: c.id } });
    setOcupado(null);
    if (!err) onDeleted(c.id);
  };

  if (loading) {
    return <div className="flex items-center justify-center py-20 text-zinc-400"><Loader2 size={24} className="animate-spin text-fuchsia-500" /></div>;
  }
  if (error) {
    return <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-600 flex items-start gap-2"><AlertTriangle size={16} className="mt-0.5 flex-shrink-0" /><span>{error}</span></div>;
  }
  if (creatives.length === 0) {
    return <EstadoVazio icon={Images} titulo="Nenhuma arte gerada ainda" texto="Vá até a aba Criar, escolha um item e um modelo, e gere a primeira arte." />;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-1.5 flex-wrap">
        {FILTROS.map((f) => (
          <button key={f.id} onClick={() => setFiltro(f.id)}
            className={`px-3 py-1.5 text-xs font-bold rounded-full border cursor-pointer ${filtro === f.id ? 'bg-fuchsia-600 text-white border-fuchsia-600' : 'bg-white text-zinc-600 border-zinc-200 hover:bg-zinc-50'}`}>
            {f.label}
          </button>
        ))}
      </div>

      {lista.length === 0 ? (
        <p className="text-xs text-zinc-400 py-8 text-center">Nenhuma arte com esse status.</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {lista.map((c) => (
            <div key={c.id} className="bg-white border border-zinc-200 rounded-xl overflow-hidden flex flex-col">
              <div className="aspect-square bg-zinc-50 relative">
                <img src={c.url} alt="" className="w-full h-full object-cover" />
                <span className={`absolute top-1.5 left-1.5 text-[10px] font-bold px-2 py-0.5 rounded-full border ${STATUS_CLS[c.status]}`}>{STATUS_LABEL[c.status]}</span>
              </div>
              <div className="p-2.5 flex-1 flex flex-col gap-1">
                <p className="text-xs font-bold text-zinc-800 truncate">{c.item_name ?? '—'}</p>
                <p className="text-[10px] text-zinc-400">{FORMATO_LABEL[c.formato] ?? c.formato}</p>
                <p className="text-[10px] text-zinc-400">{dataHora(c.created_at)}{c.created_by_name ? ` · ${c.created_by_name}` : ''}</p>
                <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                  <a href={c.url} download className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-zinc-100 text-zinc-600 hover:bg-zinc-200 cursor-pointer" title="Baixar">
                    <Download size={13} />
                  </a>
                  {isManager && c.status !== 'aprovada' && (
                    <button onClick={() => decidir(c, 'aprovada')} disabled={ocupado === c.id} className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-emerald-50 text-emerald-600 hover:bg-emerald-100 cursor-pointer disabled:opacity-50" title="Aprovar">
                      <Check size={13} />
                    </button>
                  )}
                  {isManager && c.status !== 'reprovada' && (
                    <button onClick={() => decidir(c, 'reprovada')} disabled={ocupado === c.id} className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-red-50 text-red-500 hover:bg-red-100 cursor-pointer disabled:opacity-50" title="Reprovar">
                      <X size={13} />
                    </button>
                  )}
                  {isManager && (
                    <button onClick={() => excluir(c)} disabled={ocupado === c.id} className="ml-auto inline-flex items-center justify-center w-7 h-7 rounded-lg bg-white border border-red-200 text-red-500 hover:bg-red-50 cursor-pointer disabled:opacity-50" title="Excluir">
                      {ocupado === c.id ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
