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
    <div className="flex bg-zinc-100 p-1 rounded-xl flex-shrink-0">
      {/* Hoje */}
      <button
        onClick={() => setModo('calendario')}
        className={`px-3 py-1.5 text-xs font-semibold rounded-lg cursor-pointer transition-all whitespace-nowrap flex items-center gap-1.5 ${
          isHoje ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500 hover:text-zinc-800'
        }`}
        title="Ver dados de hoje"
      >
        <i className="ri-sun-line text-sm" />
        Hoje
      </button>

      {/* Sessão atual */}
      <button
        onClick={() => !sessaoDisabled && setModo('sessao')}
        disabled={sessaoDisabled}
        className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all whitespace-nowrap flex items-center gap-1.5 ${
          sessaoDisabled
            ? 'text-zinc-300 cursor-not-allowed'
            : isSessao
              ? 'bg-white text-zinc-900 shadow-sm cursor-pointer'
              : 'text-zinc-500 hover:text-zinc-800 cursor-pointer'
        }`}
        title={sessaoDisabled ? 'Nenhuma sessão aberta' : `Sessão ${sessao?.numero}`}
      >
        <i className="ri-store-2-line text-sm" />
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
