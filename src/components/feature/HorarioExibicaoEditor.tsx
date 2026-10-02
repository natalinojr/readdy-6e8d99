import {
  DIAS_CURTOS, erroHorario, resumoHorario, temHorario,
  type FaixaHorario, type HorarioExibicao,
} from '@/lib/horarioExibicao';

interface Props {
  value: HorarioExibicao | undefined;
  onChange: (h: HorarioExibicao) => void;
  /** Rótulo da opção sem horário (ex.: "Sempre" ou "Segue o horário do item"). */
  labelSempre?: string;
  /** Texto de ajuda abaixo das opções. */
  ajuda?: string;
  disabled?: boolean;
}

const novaFaixa = (): FaixaHorario => ({ days: [0, 1, 2, 3, 4, 5, 6], start: '11:00', end: '15:00' });

/** Editor de horário de exibição no cardápio (item, categoria e destaque). */
export default function HorarioExibicaoEditor({ value, onChange, labelSempre = 'Sempre', ajuda, disabled }: Props) {
  const definido = temHorario(value);
  const faixas = value ?? [];
  const erro = erroHorario(value);

  const setFaixa = (idx: number, patch: Partial<FaixaHorario>) =>
    onChange(faixas.map((f, i) => (i === idx ? { ...f, ...patch } : f)));
  const toggleDia = (idx: number, dia: number) => {
    const f = faixas[idx];
    const days = f.days.includes(dia) ? f.days.filter((d) => d !== dia) : [...f.days, dia].sort();
    setFaixa(idx, { days });
  };
  const remover = (idx: number) => {
    const resto = faixas.filter((_, i) => i !== idx);
    onChange(resto.length ? resto : null);
  };

  return (
    <div className="space-y-2">
      <div className="inline-flex rounded-lg border border-gray-200 overflow-hidden">
        {[
          { on: false, label: labelSempre, icon: 'ri-infinity-line' },
          { on: true, label: 'Só em horários definidos', icon: 'ri-time-line' },
        ].map((op) => {
          const sel = definido === op.on;
          return (
            <button
              key={String(op.on)}
              type="button"
              disabled={disabled}
              onClick={() => onChange(op.on ? (definido ? faixas : [novaFaixa()]) : null)}
              className={`flex items-center gap-1.5 px-3 py-2 text-xs font-semibold transition-colors cursor-pointer disabled:opacity-50 ${
                sel ? 'bg-orange-500 text-white' : 'bg-white text-gray-500 hover:bg-orange-50 hover:text-orange-600'
              }`}
            >
              <i className={op.icon} />
              {op.label}
            </button>
          );
        })}
      </div>

      {ajuda && <p className="text-[11px] text-gray-500">{ajuda}</p>}

      {definido && (
        <div className="space-y-2">
          {faixas.map((f, idx) => {
            const passaMeiaNoite = f.start && f.end && f.end < f.start;
            const diaTodo = f.start && f.start === f.end;
            return (
              <div key={idx} className="border border-gray-200 rounded-xl p-3 bg-gray-50/60">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="flex flex-wrap gap-1">
                    {DIAS_CURTOS.map((d, dia) => (
                      <button
                        key={d}
                        type="button"
                        disabled={disabled}
                        onClick={() => toggleDia(idx, dia)}
                        className={`px-2 py-1 text-[11px] font-semibold rounded-md transition-colors cursor-pointer disabled:opacity-50 ${
                          f.days.includes(dia) ? 'bg-orange-500 text-white' : 'bg-white border border-gray-200 text-gray-500 hover:bg-gray-100'
                        }`}
                      >
                        {d}
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => remover(idx)}
                    title="Remover este horário"
                    className="w-7 h-7 flex items-center justify-center text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors cursor-pointer flex-shrink-0"
                  >
                    <i className="ri-delete-bin-line text-sm" />
                  </button>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs text-gray-500">Das</span>
                  <input
                    type="time"
                    disabled={disabled}
                    value={f.start}
                    onChange={(e) => setFaixa(idx, { start: e.target.value })}
                    className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm bg-white focus:outline-none focus:border-orange-400"
                  />
                  <span className="text-xs text-gray-500">às</span>
                  <input
                    type="time"
                    disabled={disabled}
                    value={f.end}
                    onChange={(e) => setFaixa(idx, { end: e.target.value })}
                    className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm bg-white focus:outline-none focus:border-orange-400"
                  />
                  {passaMeiaNoite && (
                    <span className="text-[11px] text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full">
                      <i className="ri-moon-line mr-1" />passa da meia-noite
                    </span>
                  )}
                  {diaTodo && (
                    <span className="text-[11px] text-gray-600 bg-gray-100 px-2 py-0.5 rounded-full">dia todo</span>
                  )}
                </div>
              </div>
            );
          })}
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <button
              type="button"
              disabled={disabled}
              onClick={() => onChange([...faixas, novaFaixa()])}
              className="flex items-center gap-1 text-xs font-semibold text-orange-600 hover:text-orange-700 cursor-pointer disabled:opacity-50"
            >
              <i className="ri-add-line" /> Adicionar outro horário
            </button>
            {!erro && (
              <span className="text-[11px] text-gray-500">
                <i className="ri-time-line mr-1" />{resumoHorario(value)} (horário de Brasília)
              </span>
            )}
          </div>
          {erro && (
            <p className="text-xs text-red-500 flex items-center gap-1">
              <i className="ri-error-warning-line" />{erro}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
