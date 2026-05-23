import { useModoFaturamento } from '@/contexts/ModoFaturamentoContext';
import { useSessao } from '@/contexts/SessaoContext';
import { formatOrderTime } from '@/lib/dateUtils';

export default function DashboardModoToggle() {
  const { modo, setModo } = useModoFaturamento();
  const { sessao } = useSessao();

  const isHoje = modo === 'calendario';
  const isSessao = modo === 'sessao';

  const sessaoLabel = sessao
    ? `${sessao.numero} · ${formatOrderTime(sessao.dataRef)}`
    : 'Sem sessão';

  const sessaoDisabled = !sessao;

  return (
    <div className="flex items-center bg-zinc-100 rounded-xl p-1 gap-1 flex-shrink-0">
      {/* Hoje */}
      <button
        onClick={() => setModo('calendario')}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer whitespace-nowrap ${
          isHoje
            ? 'bg-white text-zinc-800 shadow-sm'
            : 'text-zinc-500 hover:text-zinc-700'
        }`}
        title="Ver dados de hoje"
      >
        <i className="ri-sun-line text-xs" />
        Hoje
      </button>

      {/* Sessão atual */}
      <button
        onClick={() => !sessaoDisabled && setModo('sessao')}
        disabled={sessaoDisabled}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all whitespace-nowrap ${
          sessaoDisabled
            ? 'text-zinc-300 cursor-not-allowed'
            : isSessao
              ? 'bg-amber-500 text-white shadow-sm cursor-pointer'
              : 'text-zinc-500 hover:text-zinc-700 cursor-pointer'
        }`}
        title={sessaoDisabled ? 'Nenhuma sessão aberta' : `Sessão ${sessao?.numero}`}
      >
        <i className="ri-store-2-line text-xs" />
        <span className="hidden sm:inline">
          {isSessao && sessao ? sessaoLabel : 'Sessão'}
        </span>
        <span className="sm:hidden">Sessão</span>

        {/* Dot de sessão aberta */}
        {sessao && !isSessao && (
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 flex-shrink-0" />
        )}
      </button>
    </div>
  );
}