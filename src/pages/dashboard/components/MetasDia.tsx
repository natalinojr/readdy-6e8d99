import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';

interface Meta {
  id: string;
  label: string;
  atual: number;
  meta: number;
  formato: 'moeda' | 'numero';
  icon: string;
  cor: string;
  corBg: string;
}

interface Props {
  faturamentoHoje: number;
  pedidosHoje: number;
  ticketMedio: number;
}

const fmt = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

// Chave por tenant — evita que a meta de uma loja apareça em outra no mesmo navegador
const storageKey = (tenantId: string | null | undefined) =>
  `dashboard_metas_dia:${tenantId ?? 'default'}`;

function loadMetas(tenantId: string | null | undefined): { faturamento: number; pedidos: number; ticket: number } {
  try {
    const raw = localStorage.getItem(storageKey(tenantId));
    if (raw) return JSON.parse(raw);
  } catch {
    // ignore
  }
  return { faturamento: 3000, pedidos: 50, ticket: 60 };
}

function saveMetas(tenantId: string | null | undefined, m: { faturamento: number; pedidos: number; ticket: number }) {
  localStorage.setItem(storageKey(tenantId), JSON.stringify(m));
}

export default function MetasDia({ faturamentoHoje, pedidosHoje, ticketMedio }: Props) {
  const { user } = useAuth();
  const tenantId = user?.tenantId;
  const [editando, setEditando] = useState(false);
  const [metas, setMetas] = useState(() => loadMetas(tenantId));
  const [draft, setDraft] = useState(metas);

  const salvarMetas = () => {
    setMetas(draft);
    saveMetas(tenantId, draft);
    setEditando(false);
  };

  const items: Meta[] = [
    {
      id: 'faturamento',
      label: 'Faturamento',
      atual: faturamentoHoje,
      meta: metas.faturamento,
      formato: 'moeda',
      icon: 'ri-money-dollar-circle-line',
      cor: 'text-amber-600',
      corBg: 'bg-amber-500',
    },
    {
      id: 'pedidos',
      label: 'Pedidos',
      atual: pedidosHoje,
      meta: metas.pedidos,
      formato: 'numero',
      icon: 'ri-shopping-bag-line',
      cor: 'text-emerald-600',
      corBg: 'bg-emerald-500',
    },
    {
      id: 'ticket',
      label: 'Ticket Médio',
      atual: ticketMedio,
      meta: metas.ticket,
      formato: 'moeda',
      icon: 'ri-receipt-line',
      cor: 'text-sky-600',
      corBg: 'bg-sky-500',
    },
  ];

  const atingidas = items.filter(m => m.atual >= m.meta).length;

  return (
    <div className="bg-white border border-zinc-100 rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-bold text-zinc-800">Metas do Dia</h3>
          <p className="text-xs text-zinc-400 mt-0.5">
            {atingidas === 0
              ? 'Nenhuma meta atingida ainda'
              : atingidas === items.length
              ? 'Todas as metas atingidas!'
              : `${atingidas} de ${items.length} metas atingidas`}
          </p>
        </div>
        <button
          onClick={() => { setDraft(metas); setEditando(true); }}
          className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-600 transition-colors cursor-pointer px-2.5 py-1.5 rounded-lg hover:bg-zinc-50"
        >
          <i className="ri-settings-3-line text-sm" />
          Configurar
        </button>
      </div>

      <div className="space-y-4">
        {items.map((item) => {
          const pct = item.meta > 0 ? Math.min((item.atual / item.meta) * 100, 100) : 0;
          const atingiu = item.atual >= item.meta;
          const falta = item.meta - item.atual;

          return (
            <div key={item.id}>
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-2">
                  <i className={`${item.icon} text-sm ${item.cor}`} />
                  <span className="text-xs font-semibold text-zinc-700">{item.label}</span>
                  {atingiu && (
                    <span className="flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
                      <i className="ri-check-line text-[9px]" /> Meta!
                    </span>
                  )}
                </div>
                <div className="text-right">
                  <span className="text-xs font-bold text-zinc-800">
                    {item.formato === 'moeda' ? fmt(item.atual) : item.atual}
                  </span>
                  <span className="text-[10px] text-zinc-400 ml-1">
                    / {item.formato === 'moeda' ? fmt(item.meta) : item.meta}
                  </span>
                </div>
              </div>

              <div className="h-2 bg-zinc-100 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-700 ${atingiu ? 'bg-emerald-500' : item.corBg}`}
                  style={{ width: `${pct}%` }}
                />
              </div>

              <div className="flex items-center justify-between mt-1">
                <span className="text-[10px] text-zinc-400">{pct.toFixed(0)}% concluído</span>
                {!atingiu && falta > 0 && (
                  <span className="text-[10px] text-zinc-400">
                    Faltam {item.formato === 'moeda' ? fmt(falta) : falta}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Barra de progresso geral */}
      <div className="mt-4 pt-4 border-t border-zinc-100">
        <div className="flex items-center gap-3">
          <div className="flex-1 h-1.5 bg-zinc-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-amber-400 rounded-full transition-all duration-700"
              style={{ width: `${(atingidas / items.length) * 100}%` }}
            />
          </div>
          <span className="text-xs font-bold text-zinc-600 whitespace-nowrap">
            {atingidas}/{items.length} metas
          </span>
        </div>
      </div>

      {/* Modal de configuração */}
      {editando && (
        <>
          <div className="fixed inset-0 bg-black/30 z-40" onClick={() => setEditando(false)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl w-full max-w-sm p-6">
              <div className="flex items-center justify-between mb-5">
                <h3 className="text-sm font-bold text-zinc-900">Configurar Metas do Dia</h3>
                <button
                  onClick={() => setEditando(false)}
                  className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-zinc-100 text-zinc-400 cursor-pointer"
                >
                  <i className="ri-close-line" />
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="text-xs font-semibold text-zinc-600 block mb-1.5">
                    Meta de Faturamento (R$)
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={draft.faturamento}
                    onChange={(e) => setDraft((d) => ({ ...d, faturamento: Number(e.target.value) }))}
                    className="w-full border border-zinc-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-amber-400 text-zinc-800"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-zinc-600 block mb-1.5">
                    Meta de Pedidos
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={draft.pedidos}
                    onChange={(e) => setDraft((d) => ({ ...d, pedidos: Number(e.target.value) }))}
                    className="w-full border border-zinc-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-amber-400 text-zinc-800"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-zinc-600 block mb-1.5">
                    Meta de Ticket Médio (R$)
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={draft.ticket}
                    onChange={(e) => setDraft((d) => ({ ...d, ticket: Number(e.target.value) }))}
                    className="w-full border border-zinc-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-amber-400 text-zinc-800"
                  />
                </div>
              </div>

              <div className="flex gap-2 mt-6">
                <button
                  onClick={() => setEditando(false)}
                  className="flex-1 py-2.5 text-sm font-semibold border border-zinc-200 rounded-xl text-zinc-600 hover:bg-zinc-50 cursor-pointer transition-colors"
                >
                  Cancelar
                </button>
                <button
                  onClick={salvarMetas}
                  className="flex-1 py-2.5 text-sm font-semibold bg-amber-500 text-white rounded-xl hover:bg-amber-600 cursor-pointer transition-colors"
                >
                  Salvar Metas
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
