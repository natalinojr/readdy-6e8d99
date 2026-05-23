import { useState, useRef, useEffect } from 'react';
import { useSessions, type SessionInfo } from '@/hooks/useSessions';

const fmt = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

const TZ = 'America/Sao_Paulo';

function formatOpenedAt(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: TZ,
  }) + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: TZ });
}

interface Props {
  selectedId: string | null;
  onSelect: (session: SessionInfo) => void;
  size?: 'sm' | 'md';
}

export default function SessaoSelector({ selectedId, onSelect, size = 'md' }: Props) {
  const { sessions, loading } = useSessions(30);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const selected = sessions.find((s) => s.id === selectedId) ?? sessions[0] ?? null;

  // Auto-seleciona a primeira sessão (mais recente) quando carrega
  useEffect(() => {
    if (!selectedId && sessions.length > 0) {
      onSelect(sessions[0]);
    }
  }, [sessions, selectedId, onSelect]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const isSm = size === 'sm';

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        disabled={loading}
        className={`flex items-center gap-2 border border-zinc-200 bg-white rounded-lg cursor-pointer hover:border-amber-400 transition-colors whitespace-nowrap ${
          isSm ? 'px-2.5 py-1.5 text-xs' : 'px-3 py-2 text-xs'
        }`}
      >
        {loading ? (
          <div className="w-3.5 h-3.5 flex items-center justify-center">
            <div className="w-3 h-3 border border-amber-400 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <div className="w-3.5 h-3.5 flex items-center justify-center">
            <i className="ri-store-2-line text-amber-500" />
          </div>
        )}
        <span className="font-semibold text-zinc-700 truncate max-w-[160px]">
          {selected
            ? `${selected.numero} · ${new Date(selected.opened_at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: TZ })}`
            : 'Selecionar sessão'}
        </span>
        {selected && (
          <span
            className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-bold ${
              selected.status === 'open'
                ? 'bg-emerald-100 text-emerald-700'
                : 'bg-zinc-100 text-zinc-500'
            }`}
          >
            {selected.status === 'open' ? 'Aberta' : 'Fechada'}
          </span>
        )}
        <div className="w-3.5 h-3.5 flex items-center justify-center">
          <i className={open ? 'ri-arrow-up-s-line text-zinc-400' : 'ri-arrow-down-s-line text-zinc-400'} />
        </div>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1.5 z-50 w-80 bg-white border border-zinc-200 rounded-xl overflow-hidden">
          <div className="px-3 py-2 border-b border-zinc-100 flex items-center gap-2">
            <i className="ri-store-2-line text-zinc-400 text-xs" />
            <span className="text-xs font-semibold text-zinc-600">Selecionar sessão</span>
            <span className="text-[10px] text-zinc-400 ml-auto">{sessions.length} sessões</span>
          </div>
          <div className="max-h-72 overflow-y-auto">
            {sessions.length === 0 && (
              <div className="px-4 py-6 text-center text-xs text-zinc-400">
                Nenhuma sessão encontrada
              </div>
            )}
            {sessions.map((s) => (
              <button
                key={s.id}
                onClick={() => { onSelect(s); setOpen(false); }}
                className={`w-full text-left px-3 py-2.5 flex items-start gap-3 transition-colors cursor-pointer hover:bg-zinc-50 border-b border-zinc-50 last:border-0 ${
                  selectedId === s.id ? 'bg-amber-50' : ''
                }`}
              >
                {/* Status dot */}
                <div className="flex-shrink-0 mt-0.5">
                  <div
                    className={`w-2 h-2 rounded-full mt-1 ${
                      s.status === 'open' ? 'bg-emerald-500' : 'bg-zinc-300'
                    }`}
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className={`text-xs font-bold ${selectedId === s.id ? 'text-amber-700' : 'text-zinc-800'}`}>
                      {s.numero}
                    </span>
                    <span
                      className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${
                        s.status === 'open'
                          ? 'bg-emerald-100 text-emerald-700'
                          : 'bg-zinc-100 text-zinc-500'
                      }`}
                    >
                      {s.status === 'open' ? 'Aberta' : 'Fechada'}
                    </span>
                  </div>
                  {/* Data de abertura — sempre visível */}
                  <p className="text-[10px] text-zinc-500 mt-0.5">
                    <i className="ri-time-line mr-0.5" />
                    Aberta em {formatOpenedAt(s.opened_at)}
                  </p>
                  {s.operador && (
                    <p className="text-[10px] text-zinc-400">
                      <i className="ri-user-line mr-0.5" />
                      {s.operador}
                    </p>
                  )}
                  <div className="flex items-center gap-3 mt-1">
                    <span className="text-[10px] font-semibold text-zinc-700">
                      {fmt(s.faturamento)}
                    </span>
                    <span className="text-[10px] text-zinc-400">
                      {s.num_pedidos} pedido{s.num_pedidos !== 1 ? 's' : ''}
                    </span>
                  </div>
                </div>
                {selectedId === s.id && (
                  <div className="w-4 h-4 flex items-center justify-center flex-shrink-0">
                    <i className="ri-check-line text-amber-500 text-xs" />
                  </div>
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
