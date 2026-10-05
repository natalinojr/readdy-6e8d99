// Barra de baixo do celular (casca nova): 4 botões por papel + "Mais". O "+" do meio é o Lançar.
// Some com o teclado aberto. Enquanto aparece, marca <html data-casca-barra> para o balão do assistente subir.
import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Menu, Plus } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import type { Tela } from '@/constants/telas';
import { montarBarra, telaDaRota } from '@/lib/casca';
import { useTecladoAberto } from './useCasca';

interface Props {
  telas: Tela[];
  numeroHoje: number;
  maisAberto: boolean;
  onMais: () => void;
}

export default function BarraInferior({ telas, numeroHoje, maisAberto, onMais }: Props) {
  const { user } = useAuth();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const teclado = useTecladoAberto();
  const botoes = montarBarra(user?.perfil, telas);
  const ativa = maisAberto ? null : telaDaRota(pathname, telas);

  useEffect(() => {
    const html = document.documentElement;
    if (teclado) delete html.dataset.cascaBarra;
    else html.dataset.cascaBarra = '1';
    return () => { delete html.dataset.cascaBarra; };
  }, [teclado]);

  if (teclado) return null;

  const base = 'flex-1 min-w-0 flex flex-col items-center justify-center gap-0.5 text-[10.5px] font-bold relative cursor-pointer';
  return (
    <nav
      aria-label="Atalhos"
      className="md:hidden flex-shrink-0 flex bg-white border-t border-[#EEE6DA]"
      style={{ height: 'calc(62px + env(safe-area-inset-bottom))', paddingBottom: 'calc(4px + env(safe-area-inset-bottom))' }}
    >
      {botoes.map((b) => {
        const on = ativa?.id === b.tela.id;
        if (b.meio) {
          return (
            <button key={b.tela.id} type="button" onClick={() => navigate(b.tela.rota)} className={`${base} text-[#9A9086]`} aria-label="Lançar">
              <span className="w-11 h-11 -mt-4 rounded-[15px] flex items-center justify-center text-white bg-gradient-to-br from-[#f59e0b] to-[#d97706] shadow-[0_6px_16px_rgba(217,119,6,.35)]">
                <Plus size={22} />
              </span>
              <span className="truncate max-w-full">Lançar</span>
            </button>
          );
        }
        const n = b.tela.selo === 'hoje' ? numeroHoje : 0;
        return (
          <button key={b.tela.id} type="button" onClick={() => navigate(b.tela.rota)}
            className={`${base} ${on ? 'text-[#C2700A]' : 'text-[#9A9086]'}`} aria-current={on ? 'page' : undefined}>
            <b.tela.icone size={21} />
            <span className="truncate max-w-full px-0.5">{b.rotulo}</span>
            {n > 0 && (
              <span className="absolute top-1.5 left-1/2 ml-1.5 bg-[#DC2626] text-white text-[9.5px] font-extrabold rounded-full px-[5px] leading-[1.3]">
                {n > 99 ? '99+' : n}
              </span>
            )}
          </button>
        );
      })}
      <button type="button" onClick={onMais} className={`${base} ${maisAberto ? 'text-[#C2700A]' : 'text-[#9A9086]'}`} aria-expanded={maisAberto}>
        <Menu size={21} />
        <span>Mais</span>
      </button>
    </nav>
  );
}
