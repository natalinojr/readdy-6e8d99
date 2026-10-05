// Peças da página de Módulos nova: moldura (fundo creme, modo treino, aviso de acesso negado), topo e o
// selo de estado dos terminais. Kit visual aprovado: '@/components/kit'.
import { useEffect, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useModoTreino } from '@/contexts/ModoTreinoContext';
import { cliqueParaNovaAba } from '@/lib/novaJanela';

export function Moldura({ children }: { children: ReactNode }) {
  const { isModoTreino } = useModoTreino();
  const location = useLocation();
  const navigate = useNavigate();
  const [acessoNegado, setAcessoNegado] = useState<string | null>(null);

  // Mesmo aviso da página de antes (quem ainda manda para /modulos com { acessoNegado }).
  useEffect(() => {
    const state = location.state as { acessoNegado?: boolean; rota?: string } | null;
    if (!state?.acessoNegado) return;
    setAcessoNegado(`Você não tem permissão para acessar ${state.rota ?? 'esta página'}`);
    navigate('/modulos', { replace: true, state: {} });
    const t = setTimeout(() => setAcessoNegado(null), 5000);
    return () => clearTimeout(t);
  }, [location.state, navigate]);

  return (
    <div className="min-h-screen bg-[#FAF7F2] text-[#1F1A14] overflow-x-hidden">
      {isModoTreino && (
        <div className="bg-amber-400 px-4 py-2 flex items-center justify-center gap-2">
          <i className="ri-graduation-cap-fill text-amber-900" />
          <p className="text-amber-900 text-xs font-black tracking-wide text-center">MODO TREINO ATIVO — Dados não afetam o sistema real</p>
        </div>
      )}
      {acessoNegado && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 bg-red-600 text-white text-sm font-semibold px-5 py-3 rounded-2xl w-[90vw] max-w-sm">
          <i className="ri-shield-keyhole-line text-lg flex-shrink-0" />
          <span className="flex-1">{acessoNegado}</span>
          <button type="button" onClick={() => setAcessoNegado(null)} aria-label="Fechar" className="text-red-200 hover:text-white cursor-pointer">
            <i className="ri-close-line" />
          </button>
        </div>
      )}
      {children}
    </div>
  );
}

/** Topo da página: logo, nome e uma linha de apoio; ações à direita. */
export function Topo({ icone = 'ri-restaurant-2-line', titulo, linha, direita }: {
  icone?: string;
  titulo: string;
  linha?: ReactNode;
  direita?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-2.5 px-4 md:px-8 pt-4 pb-2 max-w-6xl mx-auto">
      <div className="w-[38px] h-[38px] rounded-xl bg-gradient-to-br from-amber-400 to-amber-600 text-white flex items-center justify-center flex-shrink-0">
        <i className={`${icone} text-[19px]`} />
      </div>
      <div className="min-w-0 flex-1">
        <b className="block text-[15px] font-extrabold leading-tight truncate">{titulo}</b>
        {linha && <span className="flex items-center gap-1.5 text-[12px] text-[#9A9086] font-semibold min-w-0">{linha}</span>}
      </div>
      {direita && <div className="flex items-center gap-2 flex-shrink-0">{direita}</div>}
    </div>
  );
}

export type TomEstado = 'g' | 'a' | 'r' | 'b' | 'n';

/** Selo do estado de agora num terminal (12px: este é um painel de operação). */
export function Estado({ tom = 'n', children }: { tom?: TomEstado; children: ReactNode }) {
  const cor = {
    g: 'bg-emerald-50 text-emerald-700',
    a: 'bg-amber-50 text-amber-800',
    r: 'bg-red-50 text-red-600',
    b: 'bg-blue-50 text-blue-700',
    n: 'bg-zinc-100 text-zinc-600',
  }[tom];
  return <span className={`inline-flex items-center gap-1 text-[12px] font-bold rounded-lg px-2 py-0.5 ${cor}`}>{children}</span>;
}

/** Link de verdade (rodinha / Ctrl+clique abrem em outra aba); clique normal navega na mesma. */
export function LinkRota({ rota, className, children, onAbrir }: {
  rota: string;
  className?: string;
  children: ReactNode;
  onAbrir?: () => void;
}) {
  const navigate = useNavigate();
  return (
    <a
      href={rota}
      onClick={(e) => {
        if (cliqueParaNovaAba(e)) return;
        e.preventDefault();
        onAbrir?.();
        navigate(rota);
      }}
      className={className}
    >
      {children}
    </a>
  );
}
