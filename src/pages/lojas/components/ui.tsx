import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useAppMode } from '@/contexts/AppModeContext';
import { todayBrasilia } from '@/lib/dateUtils';
import type { LojaComparada } from '@/lib/lojasComparar';

export const brl = (v: number, centavos = true) => v.toLocaleString('pt-BR', {
  style: 'currency', currency: 'BRL', minimumFractionDigits: centavos ? 2 : 0, maximumFractionDigits: centavos ? 2 : 0,
});

export const horaCurta = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', {
  timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit',
});

const diaCurto = (dia: string) => `${dia.slice(8, 10)}/${dia.slice(5, 7)}`;

/** ▲ 12% / ▼ 8% / — sem base. Seta + texto (nunca só a cor). */
export function Variacao({ pct, escuro = false, titulo }: { pct: number | null; escuro?: boolean; titulo?: string }) {
  if (pct === null) {
    return (
      <span title={titulo ?? 'Sem base de comparação (a loja não vendia no período anterior)'}
        className={`inline-flex items-center gap-0.5 text-[11px] font-bold rounded-full px-2 py-0.5 whitespace-nowrap ${escuro ? 'bg-white/10 text-zinc-300' : 'bg-zinc-100 text-zinc-400'}`}>
        — sem base
      </span>
    );
  }
  const sobe = pct >= 0;
  const cor = escuro
    ? (sobe ? 'bg-emerald-400/15 text-emerald-300' : 'bg-red-400/15 text-red-300')
    : (sobe ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700');
  return (
    <span title={titulo} className={`inline-flex items-center gap-0.5 text-[11px] font-bold rounded-full px-2 py-0.5 whitespace-nowrap tabular-nums ${cor}`}>
      {sobe ? '▲' : '▼'} {Math.abs(pct).toFixed(0)}%
    </span>
  );
}

export function AoVivo() {
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-emerald-700">
      <span className="relative flex w-2 h-2">
        <span className="absolute inline-flex w-full h-full rounded-full bg-emerald-400 opacity-60 animate-ping" />
        <span className="relative inline-flex w-2 h-2 rounded-full bg-emerald-500" />
      </span>
      ao vivo
    </span>
  );
}

export function PontoLoja({ cor, className = '' }: { cor: string; className?: string }) {
  return <span className={`inline-block w-2.5 h-2.5 rounded-full flex-shrink-0 ${className}`} style={{ background: cor }} />;
}

export function EtiquetaDia({ loja }: { loja: LojaComparada }) {
  // Depois da meia-noite, com a sessão de ontem ainda aberta, o "hoje" da loja é o dia em que ela abriu.
  if (loja.dia === todayBrasilia()) return null;
  return (
    <span title="A sessão de caixa aberta é deste dia: os números contam no dia em que ela abriu"
      className="text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-1.5 py-px whitespace-nowrap">
      dia {diaCurto(loja.dia)}
    </span>
  );
}

export function MetaBarra({ loja, cor }: { loja: LojaComparada; cor: string }) {
  if (!loja.meta) return null;
  const p = (loja.atual.faturamento / loja.meta) * 100;
  return (
    <div className="h-1.5 bg-zinc-100 rounded-full overflow-hidden mt-2" title={`Meta ${brl(loja.meta, false)}`}>
      <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.min(100, p)}%`, background: p >= 100 ? '#16a34a' : cor }} />
    </div>
  );
}

export function MetaTexto({ loja }: { loja: LojaComparada }) {
  if (!loja.meta) return <span className="text-zinc-400">sem meta</span>;
  const p = (loja.atual.faturamento / loja.meta) * 100;
  return p >= 100
    ? <b className="text-emerald-700">✓ meta {p.toFixed(0)}%</b>
    : <span>meta {p.toFixed(0)}%</span>;
}

/** Caixa aberto/fechado, pedidos em aberto, mesas e atrasados — o "agora" da loja. */
export function AgoraTexto({ loja }: { loja: LojaComparada }) {
  const a = loja.agora;
  return (
    <>
      {a.caixa
        ? <span className="inline-flex items-center gap-1 font-semibold text-emerald-700"><i className="ri-checkbox-blank-circle-fill text-[7px]" />Caixa aberto desde {horaCurta(a.caixa.desde)}</span>
        : <span className="text-zinc-400">Caixa fechado</span>}
      {a.em_aberto.pedidos > 0 && <> · {a.em_aberto.pedidos} em aberto ({brl(a.em_aberto.valor, false)})</>}
      {a.caixa && a.mesas_total > 1 && <> · mesas {a.mesas_ocupadas}/{a.mesas_total}</>}
      {a.atrasados > 0 && <> · <b className="text-red-600">{a.atrasados} {a.atrasados === 1 ? 'atrasado' : 'atrasados'}</b></>}
    </>
  );
}

/** Entra no Dashboard da loja (troca a loja desta aba, se for outra). */
export function useAbrirLoja() {
  const { user, selectTenant } = useAuth();
  const { setMode } = useAppMode();
  const navigate = useNavigate();
  return async (tenantId: string) => {
    if (user?.tenantId !== tenantId) await selectTenant(tenantId);
    setMode('gestao');
    navigate('/dashboard');
  };
}

/** Escolher quais lojas aparecem (só para esta pessoa, em qualquer aparelho). */
export function EscolherLojasModal({ lojas, cores, onOcultar, onFechar }: {
  lojas: LojaComparada[];
  cores: Record<string, string>;
  onOcultar: (tenantId: string, oculta: boolean) => void;
  onFechar: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4" onClick={onFechar}>
      <div className="w-full sm:max-w-md bg-white rounded-t-3xl sm:rounded-3xl p-5 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 mb-1">
          <h2 className="text-base font-black text-zinc-900 flex-1">Escolher lojas</h2>
          <button onClick={onFechar} className="w-9 h-9 flex items-center justify-center rounded-xl hover:bg-zinc-100 text-zinc-500 cursor-pointer" aria-label="Fechar">
            <i className="ri-close-line text-lg" />
          </button>
        </div>
        <p className="text-xs text-zinc-500 mb-4">Marque as lojas que aparecem aqui e em Módulos. Vale só para você, em qualquer aparelho.</p>
        <div className="space-y-1">
          {lojas.map((l) => (
            <label key={l.tenantId} className="flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-zinc-50 cursor-pointer">
              <input type="checkbox" checked={!l.oculta} onChange={(e) => onOcultar(l.tenantId, !e.target.checked)}
                className="w-5 h-5 accent-amber-500 cursor-pointer" />
              <PontoLoja cor={cores[l.tenantId]} />
              <span className="flex-1 min-w-0 text-sm font-semibold text-zinc-800 truncate">{l.nome}</span>
              {l.parada && <span className="text-[10px] text-zinc-400 whitespace-nowrap">sem vendas em 30 dias</span>}
            </label>
          ))}
        </div>
        <button onClick={onFechar} className="mt-4 w-full py-3 rounded-xl bg-zinc-900 text-white text-sm font-bold cursor-pointer">Pronto</button>
      </div>
    </div>
  );
}
