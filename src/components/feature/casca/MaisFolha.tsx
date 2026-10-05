// "Mais" do celular (casca nova): tela cheia com o seletor de produto, os 6 grupos em cartões de 2 colunas
// (tocar abre as telas do grupo), "Todas as telas" e a conta (perfil, atualizar, menu antigo, sair).
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, ChevronRight, HelpCircle, LayoutGrid, LogOut, RefreshCw, Store, Undo2, User, X } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useAprovacoes } from '@/contexts/AprovacoesContext';
import { podeSair } from '@/lib/guardaSaida';
import { GRUPOS, type GrupoId, type Produto, type Tela } from '@/constants/telas';
import { Selo, SeletorProduto, perfilLabel, useAcoesConta } from './partes';

interface Props {
  telas: Tela[];
  produtos: Produto[];
  numeroHoje: number;
  onFechar: () => void;
  onDesligarCasca: () => void;
}

export default function MaisFolha({ telas, produtos, numeroHoje, onFechar, onDesligarCasca }: Props) {
  const { user } = useAuth();
  const { pendentesCount } = useAprovacoes();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const acoes = useAcoesConta(onDesligarCasca);
  const [grupo, setGrupo] = useState<GrupoId | null>(null);

  // Navegou (por aqui ou por fora): a folha fecha.
  const [rota0] = useState(pathname);
  useEffect(() => { if (pathname !== rota0) onFechar(); }, [pathname, rota0, onFechar]);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onFechar(); };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [onFechar]);

  const grupos = useMemo(() => GRUPOS
    .map((g) => ({ ...g, telas: telas.filter((t) => t.grupo === g.id) }))
    .filter((g) => g.telas.length > 0), [telas]);
  const aberto = grupos.find((g) => g.id === grupo) ?? null;

  const selo = (t: Tela) => (t.selo === 'hoje' ? numeroHoje : t.selo === 'aprovacoes' ? pendentesCount : 0);
  const ir = (rota: string) => { onFechar(); navigate(rota); };
  const linhaConta = (icone: ReactNode, texto: string, onClick: () => void, perigo = false) => (
    <button type="button" onClick={onClick}
      className="w-full flex items-center gap-2.5 px-1 py-2.5 min-h-[48px] border-t border-[#F3EEE6] first:border-t-0 text-left cursor-pointer">
      <span className={`w-8 h-8 rounded-[10px] flex items-center justify-center flex-shrink-0 ${perigo ? 'bg-[#FEF1F1] text-[#DC2626]' : 'bg-[#F4EFE7] text-[#5B5248]'}`}>{icone}</span>
      <b className={`flex-1 text-[13.5px] font-extrabold ${perigo ? 'text-[#DC2626]' : 'text-[#1F1A14]'}`}>{texto}</b>
      {!perigo && <ChevronRight size={18} className="text-[#CFC6B8]" />}
    </button>
  );

  return (
    <div className="md:hidden fixed inset-x-0 top-0 z-[45] bg-[#FAF7F2] flex flex-col" role="dialog"
      style={{ bottom: 'calc(62px + env(safe-area-inset-bottom))' }} aria-label={aberto ? aberto.rotulo : 'Mais'}>
      <div className="h-[54px] flex-shrink-0 flex items-center gap-2 px-3 bg-white border-b border-[#F1ECE4]">
        {aberto ? (
          <button type="button" onClick={() => setGrupo(null)} aria-label="Voltar"
            className="w-[38px] h-[38px] rounded-xl flex items-center justify-center text-[#5B5248] cursor-pointer">
            <ArrowLeft size={20} />
          </button>
        ) : null}
        <b className="flex-1 text-[16px] font-extrabold text-[#1F1A14] truncate">{aberto ? aberto.rotulo : 'Mais'}</b>
        <button type="button" onClick={onFechar} aria-label="Fechar"
          className="w-[34px] h-[34px] rounded-full bg-[#F4EFE7] flex items-center justify-center text-[#5B5248] cursor-pointer">
          <X size={18} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pt-3 pb-6">
        {aberto ? (
          <div className="bg-white border border-[#EEE6DA] rounded-2xl px-3 py-1">
            {aberto.telas.map((t) => (
              <button key={t.id} type="button" onClick={() => ir(t.rota)}
                className="w-full flex items-center gap-2.5 px-1 py-2.5 min-h-[52px] border-t border-[#F3EEE6] first:border-t-0 text-left cursor-pointer">
                <span className="w-8 h-8 rounded-[10px] bg-[#F4EFE7] text-[#5B5248] flex items-center justify-center flex-shrink-0"><t.icone size={16} /></span>
                <span className="flex-1 min-w-0">
                  <b className="block text-[13.5px] font-extrabold text-[#1F1A14]">{t.rotulo}</b>
                  <small className="block text-[11.5px] text-[#9A9086] leading-snug">{t.descricao}</small>
                </span>
                <Selo n={selo(t)} />
                <ChevronRight size={18} className="text-[#CFC6B8] flex-shrink-0" />
              </button>
            ))}
          </div>
        ) : (
          <>
            <p className="text-[12px] font-semibold text-[#9A9086] mb-2">
              {user?.nome?.split(' ')[0]}{user?.perfil ? ` · ${perfilLabel[user.perfil] ?? user.perfil}` : ''} · toque num grupo para ver as telas dele
            </p>
            {produtos.length > 1 && (
              <div className="mb-3"><SeletorProduto produtos={produtos} telas={telas} onEscolher={onFechar} /></div>
            )}
            <div className="grid grid-cols-2 gap-2.5">
              {grupos.map((g) => {
                const n = g.id === 'hoje' ? numeroHoje : 0;
                return (
                  <button key={g.id} type="button" onClick={() => setGrupo(g.id)}
                    className="relative bg-white border border-[#EEE6DA] rounded-[18px] p-3 text-left flex flex-col gap-1 min-w-0 active:bg-[#FFFBF3] cursor-pointer">
                    <span className="w-[38px] h-[38px] rounded-xl bg-[#FFF4E0] text-[#C2700A] flex items-center justify-center mb-0.5"><g.icone size={20} /></span>
                    {n > 0 && <Selo n={n} className="absolute top-2.5 right-2.5 !h-[22px] !min-w-[22px] !text-[12px]" />}
                    <b className="text-[14px] font-extrabold text-[#1F1A14] leading-tight">{g.rotulo}</b>
                    <span className="text-[11px] text-[#9A9086] font-semibold leading-snug line-clamp-3">
                      {g.telas.map((t) => t.rotulo).join(' · ')}
                    </span>
                  </button>
                );
              })}
            </div>
            <button type="button" onClick={async () => { if (!(await podeSair())) return; ir('/modulos'); }}
              className="mt-3 w-full min-h-[42px] rounded-xl border border-[#EEE6DA] bg-white text-[13.5px] font-bold text-[#1F1A14] flex items-center justify-center gap-1.5 cursor-pointer">
              <LayoutGrid size={16} />Todas as telas
            </button>

            <h3 className="mt-5 mb-1.5 text-[11px] font-extrabold uppercase tracking-[.1em] text-[#9A9086]">Sua conta</h3>
            <div className="bg-white border border-[#EEE6DA] rounded-2xl px-3 py-0.5">
              {linhaConta(<User size={16} />, 'Meu perfil', () => { onFechar(); void acoes.perfil(); })}
              {linhaConta(<RefreshCw size={16} />, 'Atualizar o sistema', acoes.atualizar)}
              {linhaConta(<HelpCircle size={16} />, 'Ajuda', () => ir('/ajuda'))}
              {acoes.canSwitchTenant && linhaConta(<Store size={16} />, 'Trocar de loja', () => { onFechar(); void acoes.trocarLoja(); })}
              {linhaConta(<Undo2 size={16} />, 'Voltar ao menu antigo', () => { onFechar(); acoes.menuAntigo(); })}
              {linhaConta(<LogOut size={16} />, 'Sair', () => { onFechar(); void acoes.sair(); }, true)}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
