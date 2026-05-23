import { useModoFaturamento } from '@/contexts/ModoFaturamentoContext';

interface Props {
  size?: 'sm' | 'md';
  showLabel?: boolean;
}

export default function ModoFaturamentoToggle({ size = 'md', showLabel = true }: Props) {
  const { modo, setModo } = useModoFaturamento();

  const isCalendario = modo === 'calendario';
  const isSessao = modo === 'sessao';

  const base = size === 'sm'
    ? 'px-2.5 py-1.5 text-[10px] md:text-xs'
    : 'px-3 py-2 text-xs';

  return (
    <div className="flex items-center gap-2 flex-shrink-0">
      {showLabel && (
        <span className="text-xs text-zinc-400 font-medium whitespace-nowrap hidden sm:block">
          Faturamento por:
        </span>
      )}
      <div className="flex bg-zinc-100 rounded-lg p-0.5 gap-0.5 flex-shrink-0">
        <button
          onClick={() => setModo('calendario')}
          className={`${base} flex items-center gap-1 rounded-md font-semibold cursor-pointer transition-all whitespace-nowrap ${
            isCalendario
              ? 'bg-white text-zinc-800 shadow-sm'
              : 'text-zinc-500 hover:text-zinc-700'
          }`}
          title="Agrupar faturamento por data do calendário"
        >
          <i className="ri-calendar-line text-xs" />
          <span className="hidden sm:inline">Calendário</span>
        </button>
        <button
          onClick={() => setModo('sessao')}
          className={`${base} flex items-center gap-1 rounded-md font-semibold cursor-pointer transition-all whitespace-nowrap ${
            isSessao
              ? 'bg-amber-500 text-white shadow-sm'
              : 'text-zinc-500 hover:text-zinc-700'
          }`}
          title="Agrupar faturamento pela sessão em que a venda foi registrada"
        >
          <i className="ri-store-2-line text-xs" />
          <span className="hidden sm:inline">Sessão</span>
        </button>
      </div>
    </div>
  );
}
