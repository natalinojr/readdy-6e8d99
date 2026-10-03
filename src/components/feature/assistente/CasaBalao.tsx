// Peças da tela de abertura do balão (2026-10-03), iguais no chat do dono (AssistenteChat) e no das
// demais pessoas (AcoesRapidasFlutuante). Pedido do dono: o balão é para conversar, perguntar e agir
// rápido — não uma segunda caixa de pendências. Por isso o "o que precisa de você" é UMA linha com o
// número da Hoje (o mesmo do topo), que leva à Hoje. Protótipo: docs/prototipos/balao-assistente-proposta.html.
import { useEffect, useRef, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { rotaForcada } from '@/lib/acessoRota';
import { useContagemHoje, usePendenciasHoje } from '@/pages/hoje/hojeStore';
import type { AcaoDef } from './acoes';

export function TituloBloco({ texto, extra }: { texto: string; extra?: ReactNode }) {
  return (
    <p className="flex items-center gap-1.5 px-1 pb-2 text-[11px] font-black uppercase tracking-wide text-zinc-400">
      {texto}{extra}
    </p>
  );
}

/** "N coisas precisam de você → Abrir Hoje". Some na própria Hoje, sem número e para papel sem a Hoje. */
// A contagem é a da própria Hoje (hojeStore: a mesma leitura da tela e do número do topo) — nunca uma
// terceira conta. Sem leitura ainda (ou erro com zero), não mostra nada: nunca "tudo em dia" sem certeza.
export function LinhaNumeroHoje({ onAbrir }: { onAbrir: () => void }) {
  const { itens, erro } = usePendenciasHoje();
  const { agora: n } = useContagemHoje();
  const { pathname } = useLocation();
  const { user } = useAuth();
  // Papel preso a uma área (Financeiro, Contabilidade, Tarefas…) não tem a Hoje.
  if (itens === null || (erro && n === 0) || pathname === '/hoje' || rotaForcada(user?.perfil, '/hoje')) return null;
  const ok = n === 0;
  return (
    <div className="px-3 pt-3">
      <button onClick={onAbrir}
        className={`w-full flex items-center gap-3 rounded-2xl border bg-white px-3 py-2.5 text-left cursor-pointer hover:bg-zinc-50 ${ok ? 'border-emerald-200' : 'border-red-200'}`}
        aria-label={ok ? 'Tudo em dia. Abrir a tela Hoje' : `${n} ${n === 1 ? 'coisa precisa' : 'coisas precisam'} de você. Abrir a tela Hoje`}>
        <span className={`min-w-[38px] h-[38px] px-1.5 flex-shrink-0 flex items-center justify-center rounded-xl text-white text-lg font-black ${ok ? 'bg-emerald-600' : 'bg-red-600'}`}>
          {ok ? <i className="ri-check-line" /> : n > 99 ? '99+' : n}
        </span>
        <span className="flex-1 min-w-0 leading-tight">
          <span className="block text-sm font-black text-zinc-900">{ok ? 'Tudo em dia ✓' : `${n === 1 ? 'coisa precisa' : 'coisas precisam'} de você`}</span>
          <span className="block text-xs text-zinc-500">{ok ? 'Nada precisa de você agora' : 'O mesmo número da tela Hoje'}</span>
        </span>
        <span className={`flex-shrink-0 text-xs font-black ${ok ? 'text-emerald-700' : 'text-red-600'}`}>{ok ? 'Hoje ›' : 'Abrir Hoje ›'}</span>
      </button>
    </div>
  );
}

/** As 6 ações que a pessoa mais usa + "Todas as ações (N)". */
export function FazerRapido({ acoes, total, onAbrir, onTodas }: {
  acoes: AcaoDef[]; total: number; onAbrir: (id: string) => void; onTodas: () => void;
}) {
  if (!total) return null;
  return (
    <div className="px-3 pt-4">
      <TituloBloco texto="Fazer rápido" extra={<span className="font-semibold normal-case tracking-normal">· sem custo de IA</span>} />
      <div className="grid grid-cols-3 gap-2">
        {acoes.map((a) => (
          <button key={a.id} onClick={() => onAbrir(a.id)}
            className="flex flex-col items-start gap-2 min-h-[80px] p-2.5 rounded-2xl border border-zinc-200 bg-white text-[12px] font-bold leading-tight text-zinc-800 hover:bg-zinc-50 cursor-pointer text-left">
            <span className={`w-8 h-8 flex-shrink-0 flex items-center justify-center rounded-xl ${a.cor}`}><i className={`${a.icone} text-lg`} /></span>
            <span>{a.label}</span>
          </button>
        ))}
      </div>
      <button onClick={onTodas}
        className="w-full mt-2 h-10 flex items-center justify-center gap-1.5 rounded-xl border border-dashed border-violet-300 bg-white text-sm font-bold text-violet-700 hover:bg-violet-50 cursor-pointer">
        <i className="ri-flashlight-line" /> Todas as ações ({total})
      </button>
    </div>
  );
}

/** "Novidades para você": as conversas com mensagem nova, no topo da abertura. Sem nenhuma, não aparece. */
export function Novidades({ children }: { children: ReactNode[] }) {
  const itens = children.filter(Boolean);
  if (!itens.length) return null;
  return (
    <div className="px-3 pt-4">
      <TituloBloco texto="Novidades para você" />
      <div className="rounded-2xl border border-zinc-200 bg-white overflow-hidden [&>*:last-child]:border-b-0" aria-label="Novidades para você">{itens}</div>
    </div>
  );
}

export function LinhaNovidade({ icone, titulo, hora, previa, n, onClick }: {
  icone: ReactNode; titulo: string; hora?: string | null; previa: string; n: number; onClick: () => void;
}) {
  return (
    <button onClick={onClick} className="w-full flex items-center gap-3 px-3 py-2.5 border-b border-zinc-100 hover:bg-zinc-50 cursor-pointer text-left">
      {icone}
      <span className="flex-1 min-w-0">
        <span className="flex items-baseline gap-2">
          <span className="flex-1 text-sm font-bold text-zinc-900 truncate">{titulo}</span>
          {hora && <span className="text-[11px] flex-shrink-0 text-violet-600 font-bold">{hora}</span>}
        </span>
        <span className="flex items-center gap-2">
          <span className="flex-1 text-xs truncate text-zinc-700 font-semibold">{previa}</span>
          {n > 0 && (
            <span className="flex-shrink-0 min-w-[20px] h-5 px-1.5 flex items-center justify-center rounded-full bg-violet-600 text-white text-[11px] font-black" aria-label={`${n} nova(s)`}>
              {n > 99 ? '99+' : n}
            </span>
          )}
        </span>
      </span>
    </button>
  );
}

export interface ItemMenuMais { icone: string; cor: string; titulo: string; detalhe?: string; onClick: () => void }

/** Menu "⋯" do balão: o que é de vez em quando (PIN, caixa completa, avisos bloqueados…). */
export function MenuMais({ itens, onFechar }: { itens: ItemMenuMais[]; onFechar: () => void }) {
  const caixa = useRef<HTMLDivElement>(null);
  const fechar = useRef(onFechar);
  fechar.current = onFechar;
  useEffect(() => {
    caixa.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    const tecla = (e: KeyboardEvent) => { if (e.key === 'Escape') fechar.current(); };
    document.addEventListener('keydown', tecla);
    return () => document.removeEventListener('keydown', tecla);
  }, []);
  return (
    <div className="absolute inset-0 z-30 flex items-end sm:items-center justify-center bg-black/30 p-0 sm:p-3" onClick={onFechar} data-sem-arrasto>
      <div ref={caixa} onClick={(e) => e.stopPropagation()} role="menu" aria-label="Mais opções"
        className="w-full sm:max-w-sm rounded-t-2xl sm:rounded-2xl bg-white p-2 pb-4 sm:pb-2 shadow-xl">
        {itens.map((it) => (
          <button key={it.titulo} role="menuitem" onClick={() => { onFechar(); it.onClick(); }}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left hover:bg-zinc-50 cursor-pointer">
            <span className={`w-9 h-9 flex-shrink-0 flex items-center justify-center rounded-xl ${it.cor}`}><i className={`${it.icone} text-lg`} /></span>
            <span className="flex-1 min-w-0 leading-tight">
              <span className="block text-sm font-bold text-zinc-900">{it.titulo}</span>
              {it.detalhe && <span className="block text-xs text-zinc-500">{it.detalhe}</span>}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
