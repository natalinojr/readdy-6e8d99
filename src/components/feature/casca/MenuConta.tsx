// Menu do avatar da casca nova: Meu perfil, Atualizar o sistema, Abrir em outra janela, Ajuda, Trocar e criar
// loja (como no topo antigo), Voltar ao menu antigo e Sair.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AppWindow, ChevronDown, HelpCircle, LogOut, RefreshCw, Store, Undo2, User } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useModoTreino } from '@/contexts/ModoTreinoContext';
import { CriarLojaModal } from '../TopBar';
import { perfilLabel, useAcoesConta } from './partes';

export default function MenuConta({ onDesligarCasca }: { onDesligarCasca: () => void }) {
  const { user } = useAuth();
  const { isModoTreino } = useModoTreino();
  const acoes = useAcoesConta(onDesligarCasca);
  const [aberto, setAberto] = useState(false);
  const [criarLoja, setCriarLoja] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setAberto(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setAberto(false); };
    document.addEventListener('mousedown', fora);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', fora); document.removeEventListener('keydown', esc); };
  }, [aberto]);

  const linha = (icone: ReactNode, texto: string, onClick: () => void, cls = 'text-[#1F1A14] hover:bg-[#FAF7F2]', extra = '') => (
    <button
      type="button"
      onClick={() => { setAberto(false); onClick(); }}
      className={`w-full text-left px-4 py-2.5 text-[13px] font-semibold flex items-center gap-2.5 cursor-pointer transition-colors ${cls} ${extra}`}
    >
      <span className="w-4 h-4 flex items-center justify-center text-[#9A9086]">{icone}</span>
      {texto}
    </button>
  );

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        aria-label="Sua conta"
        aria-expanded={aberto}
        className="flex items-center gap-1 rounded-full pl-0.5 pr-1 py-0.5 hover:bg-[#F7F0E4] cursor-pointer"
      >
        <span className="w-[34px] h-[34px] rounded-full bg-[#F59E0B] text-[#1F1A14] text-[13px] font-extrabold flex items-center justify-center">
          {user?.nome?.charAt(0)}
        </span>
        <ChevronDown size={13} className="text-[#9A9086] hidden md:block" />
      </button>

      {aberto && (
        <div className="absolute right-0 top-full mt-1.5 w-64 bg-white border border-[#EEE6DA] rounded-xl py-1.5 z-50 overflow-hidden shadow-[0_10px_30px_rgba(31,26,20,.12)]">
          <div className="px-4 py-3 border-b border-[#F3EEE6]">
            <p className="text-sm font-extrabold text-[#1F1A14] truncate">{user?.nome}</p>
            <p className="text-[11px] text-[#9A9086] truncate">
              {user?.perfil ? perfilLabel[user.perfil] ?? user.perfil : ''}{user?.loja ? ` · ${user.loja}` : ''}
            </p>
            {isModoTreino && (
              <p className="mt-1.5 inline-block px-2 py-0.5 bg-amber-50 rounded border border-amber-100 text-[10px] font-black text-amber-700 uppercase tracking-wide">Modo Treino</p>
            )}
          </div>
          <div className="py-1">
            {linha(<User size={14} />, 'Meu perfil', () => { void acoes.perfil(); })}
            {linha(<RefreshCw size={14} />, 'Atualizar o sistema', acoes.atualizar)}
            {linha(<AppWindow size={14} />, 'Abrir em outra janela', acoes.outraJanela, undefined, 'hidden md:flex')}
            {linha(<HelpCircle size={14} />, 'Ajuda', acoes.ajuda)}
            {acoes.canSwitchTenant && linha(<Store size={14} />, 'Trocar de loja', () => { void acoes.trocarLoja(); })}
            {linha(<i className="ri-store-2-line text-sm text-amber-500" />, 'Criar nova loja', () => setCriarLoja(true), 'text-amber-700 hover:bg-amber-50')}
          </div>
          <div className="border-t border-[#F3EEE6] py-1">
            {linha(<Undo2 size={14} />, 'Voltar ao menu antigo', acoes.menuAntigo)}
            {linha(<LogOut size={14} />, 'Sair', () => { void acoes.sair(); }, 'text-red-500 hover:bg-red-50')}
          </div>
        </div>
      )}

      {criarLoja && <CriarLojaModal onClose={() => setCriarLoja(false)} />}
    </div>
  );
}
