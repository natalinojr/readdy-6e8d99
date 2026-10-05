// Menu do computador da casca nova: 6 grupos, só o da tela atual aberto (clique abre/fecha), Terminais
// recolhido dentro de "Loja agora" e "Todas as telas" no rodapé. Desenho: docs/prototipos/sistema-proposta.html.
import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ChevronDown, ChevronUp, Computer, LayoutGrid, UtensilsCrossed } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useAprovacoes } from '@/contexts/AprovacoesContext';
import { podeSair } from '@/lib/guardaSaida';
import { GRUPOS, type GrupoId, type Produto, type Tela } from '@/constants/telas';
import { grupoDaRota, telaDaRota } from '@/lib/casca';
import { Selo, SeletorProduto, perfilLabel } from './partes';

interface Props {
  telas: Tela[];
  produtos: Produto[];
  numeroHoje: number;
}

export default function MenuNovo({ telas, produtos, numeroHoje }: Props) {
  const { user } = useAuth();
  const { pendentesCount } = useAprovacoes();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const ativa = telaDaRota(pathname, telas);
  const grupoAtual = grupoDaRota(pathname, telas);
  // Grupo aberto à mão (null = o da tela atual; 'nenhum' = todos fechados). Volta ao da tela ao navegar.
  const [aberto, setAberto] = useState<GrupoId | 'nenhum' | null>(null);
  const [terminaisAbertos, setTerminaisAbertos] = useState(false);
  useEffect(() => { setAberto(null); setTerminaisAbertos(false); }, [pathname]);
  const grupoAberto = aberto ?? grupoAtual;

  const grupos = useMemo(() => GRUPOS
    .map((g) => ({ ...g, telas: telas.filter((t) => t.grupo === g.id) }))
    .filter((g) => g.telas.length > 0), [telas]);

  const selo = (t: Tela) => (t.selo === 'hoje' ? numeroHoje : t.selo === 'aprovacoes' ? pendentesCount : 0);

  const item = (t: Tela, sub = false) => {
    const on = ativa?.id === t.id;
    return (
      <Link
        key={t.id}
        to={t.rota}
        className={`w-full flex items-center gap-[9px] rounded-[10px] ${sub ? 'px-[9px] py-1.5 text-[12.5px]' : 'px-[9px] py-[7px] text-[13px]'} font-bold text-left transition-colors ${
          on ? 'bg-[#FFF4E0] text-[#C2700A]' : 'text-[#5B5248] hover:bg-[#F7F0E4]'
        }`}
      >
        <t.icone size={16} className={on ? 'text-[#C2700A] flex-shrink-0' : 'text-[#9A9086] flex-shrink-0'} />
        <span className="flex-1 min-w-0 truncate">{t.rotulo}</span>
        <Selo n={selo(t)} />
      </Link>
    );
  };

  const irTodas = async () => { if (!(await podeSair())) return; navigate('/modulos'); };

  return (
    <aside className="hidden md:flex w-[232px] flex-shrink-0 flex-col h-full overflow-hidden bg-[#FFFCF7] border-r border-[#EFE7DB]">
      <div className="flex items-center gap-[9px] px-3.5 pt-3.5 pb-2.5">
        <div className="w-[34px] h-[34px] rounded-[11px] flex items-center justify-center flex-shrink-0 text-white bg-gradient-to-br from-[#f59e0b] to-[#d97706]">
          <UtensilsCrossed size={17} />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-extrabold text-[#1F1A14] leading-tight">ERPOS</p>
          <p className="text-[11px] text-[#9A9086] truncate">
            {user?.nome?.split(' ')[0]}{user?.perfil ? ` · ${perfilLabel[user.perfil] ?? user.perfil}` : ''}
          </p>
        </div>
      </div>

      {produtos.length > 1 && (
        <div className="px-3 pb-2">
          <SeletorProduto produtos={produtos} telas={telas} compacto />
        </div>
      )}

      <nav className="flex-1 overflow-y-auto px-2.5 pt-1 pb-2.5" aria-label="Menu">
        {grupos.map((g) => {
          const on = g.id === grupoAberto;
          const n = g.id === 'hoje' ? numeroHoje : 0;
          const normais = g.telas.filter((t) => !t.terminal);
          const terminais = g.telas.filter((t) => t.terminal);
          const noTerminal = !!ativa?.terminal;
          const mostrarTerminais = terminaisAbertos || noTerminal;
          return (
            <div key={g.id}>
              <button
                type="button"
                onClick={() => setAberto(on ? 'nenhum' : g.id)}
                aria-expanded={on}
                className="w-full flex items-center gap-[9px] rounded-[10px] px-[9px] py-2 mt-0.5 text-[13px] font-extrabold text-[#1F1A14] text-left hover:bg-[#F7F0E4] cursor-pointer"
              >
                <g.icone size={17} className="text-[#5B5248] flex-shrink-0" />
                <span className="flex-1 min-w-0 truncate">{g.rotulo}</span>
                {!on && <Selo n={n} />}
                <ChevronDown size={15} className={`text-[#9A9086] transition-transform ${on ? 'rotate-180' : ''}`} />
              </button>
              {on && (
                <div className="pt-0.5 pb-1.5 pl-3 ml-[17px] mb-1 border-l-2 border-[#F1E6D3]">
                  {normais.map((t) => item(t))}
                  {terminais.length > 0 && (
                    <>
                      <button
                        type="button"
                        onClick={() => setTerminaisAbertos((v) => !v)}
                        aria-expanded={mostrarTerminais}
                        className="w-full flex items-center gap-[9px] rounded-[10px] px-[9px] py-[7px] text-[13px] font-bold text-[#5B5248] text-left hover:bg-[#F7F0E4] cursor-pointer"
                      >
                        <Computer size={16} className="text-[#9A9086] flex-shrink-0" />
                        <span className="flex-1">Terminais</span>
                        {mostrarTerminais ? <ChevronUp size={15} className="text-[#9A9086]" /> : <ChevronDown size={15} className="text-[#9A9086]" />}
                      </button>
                      {mostrarTerminais && <div className="pl-3.5">{terminais.map((t) => item(t, true))}</div>}
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
        <button
          type="button"
          onClick={irTodas}
          className="w-full flex items-center gap-[9px] mt-2.5 pt-3 px-[9px] pb-[7px] border-t border-[#EFE7DB] text-[13px] font-bold text-[#9A9086] hover:text-[#5B5248] text-left cursor-pointer"
        >
          <LayoutGrid size={16} className="flex-shrink-0" />
          Todas as telas
        </button>
      </nav>

      {user?.modoTreino && (
        <div className="mx-3 mb-3 px-3 py-1.5 bg-amber-100 rounded-lg border border-amber-300">
          <p className="text-amber-700 text-[10px] font-bold text-center tracking-wide">MODO TREINO ATIVO</p>
        </div>
      )}
    </aside>
  );
}
