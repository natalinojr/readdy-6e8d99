// Topo da casca nova. Computador: "Ir para…" (Ctrl K), avisos (treino, offline, fila, impressão), + Lançar,
// Hoje com o número, chip da loja (troca), hora pequena e o avatar. Celular: chip da loja + lupa + avatar.
import { useNavigate } from 'react-router-dom';
import { CloudOff, GraduationCap, Plus, Search, Sun, WifiOff, ChevronDown, UtensilsCrossed } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useModoTreino } from '@/contexts/ModoTreinoContext';
import PrintQueueBadge from '../PrintQueueBadge';
import type { Tela } from '@/constants/telas';
import { Bolinha, Selo, useAcoesConta, useEstadoLoja } from './partes';
import { useConexao, useHora } from './useCasca';
import MenuConta from './MenuConta';

interface Props {
  telas: Tela[];
  numeroHoje: number;
  onIrPara: () => void;
  onDesligarCasca: () => void;
}

// Uma vez só na tela (o auto-sync da fila offline e a fila de impressão não podem rodar em dobro).
// No celular o texto some e fica o ícone.
function Avisos() {
  const { isModoTreino } = useModoTreino();
  const { online, pendentes } = useConexao();
  const pill = 'flex items-center gap-1.5 text-white text-xs font-black px-2.5 py-1.5 rounded-lg whitespace-nowrap';
  return (
    <>
      {isModoTreino && (
        <div className={`${pill} bg-amber-400 text-amber-900`} title="Modo treino">
          <GraduationCap size={13} /><span className="hidden md:inline">TREINO</span>
        </div>
      )}
      {!online && (
        <div className={`${pill} bg-red-500 animate-pulse`} title="Sem internet">
          <WifiOff size={12} /><span className="hidden md:inline">OFFLINE</span>
        </div>
      )}
      {pendentes > 0 && (
        <div className={`${pill} bg-orange-500`} title={`${pendentes} pedido(s) aguardando sincronização`}>
          <CloudOff size={12} />{pendentes}<span className="hidden md:inline">{` pendente${pendentes > 1 ? 's' : ''}`}</span>
        </div>
      )}
      <PrintQueueBadge />
    </>
  );
}

function ChipLoja({ celular }: { celular?: boolean }) {
  const { user } = useAuth();
  const { aberta, texto } = useEstadoLoja();
  const acoes = useAcoesConta(() => {});
  const pode = acoes.canSwitchTenant;
  if (!user?.loja) return null;
  if (celular) {
    return (
      <button
        type="button"
        onClick={pode ? () => { void acoes.trocarLoja(); } : undefined}
        disabled={!pode}
        title={pode ? 'Trocar de loja' : undefined}
        className="flex items-center gap-[7px] min-w-0 flex-1 text-left disabled:cursor-default cursor-pointer"
      >
        <span className="w-8 h-8 rounded-[10px] flex items-center justify-center flex-shrink-0 text-white bg-gradient-to-br from-[#f59e0b] to-[#d97706]">
          <UtensilsCrossed size={16} />
        </span>
        <span className="min-w-0">
          <b className="block text-[13.5px] font-extrabold text-[#1F1A14] truncate">{user.loja}</b>
          <span className="flex items-center gap-1 text-[11px] font-bold text-[#9A9086]">
            <Bolinha aberta={aberta} />{texto}{pode && <ChevronDown size={13} />}
          </span>
        </span>
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={pode ? () => { void acoes.trocarLoja(); } : undefined}
      disabled={!pode}
      title={pode ? 'Trocar de loja' : texto}
      className="flex items-center gap-2 h-[38px] max-w-[240px] px-3 rounded-xl border border-[#EEE6DA] bg-white text-left enabled:hover:border-[#F7D9A6] enabled:cursor-pointer"
    >
      <Bolinha aberta={aberta} />
      <span className="min-w-0">
        <b className="block text-[12.5px] font-extrabold text-[#1F1A14] truncate leading-tight">{user.loja}</b>
        <small className="block text-[10.5px] font-semibold text-[#9A9086] leading-tight">{texto}</small>
      </span>
      {pode && <i className="ri-arrow-up-down-line text-[#9A9086] text-sm" />}
    </button>
  );
}

export default function TopoNovo({ telas, numeroHoje, onIrPara, onDesligarCasca }: Props) {
  const navigate = useNavigate();
  const hora = useHora();
  const temLancar = telas.some((t) => t.id === 'lancar');
  const temHoje = telas.some((t) => t.id === 'hoje');

  return (
    <header className="h-[54px] md:h-[58px] flex-shrink-0 bg-white border-b border-[#F1ECE4] flex items-center gap-2 md:gap-2.5 px-3 md:px-5">
      {/* Celular: a loja à esquerda */}
      <div className="md:hidden flex-1 min-w-0 flex"><ChipLoja celular /></div>

      {/* Computador: Ir para… */}
      <button
        type="button"
        onClick={onIrPara}
        className="hidden md:flex flex-1 max-w-[520px] min-w-[160px] h-10 rounded-xl border border-[#EEE6DA] bg-[#FAF7F2] items-center gap-2 px-3 text-[#9A9086] text-[13px] text-left cursor-pointer hover:border-[#E3D7C4] overflow-hidden whitespace-nowrap"
      >
        <Search size={17} className="flex-shrink-0" />
        <span className="truncate">Ir para… tela ou assunto</span>
        <kbd className="ml-auto font-sans text-[11px] font-bold border border-[#EEE6DA] rounded-md px-1.5 py-px bg-white">Ctrl K</kbd>
      </button>
      <div className="hidden md:block flex-1" />

      <div className="flex items-center gap-1.5 md:gap-2"><Avisos /></div>

      {temLancar && (
        <button
          type="button"
          onClick={() => navigate('/lancar')}
          className="hidden md:flex h-[34px] px-2.5 rounded-[10px] bg-[#F59E0B] hover:bg-[#EA9A0A] text-[#1F1A14] text-[12.5px] font-bold items-center gap-1.5 cursor-pointer whitespace-nowrap"
        >
          <Plus size={15} />Lançar
        </button>
      )}
      {temHoje && (
        <button
          type="button"
          onClick={() => navigate('/hoje')}
          title="O que precisa de você"
          className="hidden md:flex h-[38px] px-[11px] rounded-xl border border-[#EEE6DA] bg-white text-[13px] font-extrabold text-[#1F1A14] items-center gap-1.5 cursor-pointer hover:border-[#F7D9A6]"
        >
          <Sun size={16} className="text-[#C2700A]" />Hoje<Selo n={numeroHoje} />
        </button>
      )}
      <div className="hidden md:flex"><ChipLoja /></div>
      <span className="hidden md:inline text-[12.5px] font-bold text-[#9A9086] tabular-nums">{hora}</span>

      {/* Celular: lupa */}
      <button
        type="button"
        onClick={onIrPara}
        aria-label="Ir para…"
        className="md:hidden w-[38px] h-[38px] rounded-xl border border-[#EEE6DA] bg-[#FAF7F2] flex items-center justify-center text-[#5B5248] flex-shrink-0 cursor-pointer"
      >
        <Search size={18} />
      </button>
      <MenuConta onDesligarCasca={onDesligarCasca} />
    </header>
  );
}
