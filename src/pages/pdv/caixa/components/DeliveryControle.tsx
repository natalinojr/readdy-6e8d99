import { useState } from 'react';
import { type DeliveryOp, type UseDeliveryStateReturn } from '@/hooks/useDeliveryState';

interface DeliveryControleProps {
  /** Estilo compacto p/ a barra mobile (só ícone + status curto). */
  compact?: boolean;
  /**
   * Estado de delivery vindo do `useDeliveryState` (chamado UMA vez no
   * caixa/page.tsx e compartilhado entre as variantes desktop/mobile, que ficam
   * as duas montadas no DOM). Evita dois polls/canais em paralelo.
   */
  ctl: UseDeliveryStateReturn;
}

function fmtHora(iso: string | null): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  return new Date(t).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function minutosAteFimDoDia(): number {
  const now = new Date();
  const end = new Date(now);
  end.setHours(23, 59, 0, 0);
  return Math.max(15, Math.round((end.getTime() - now.getTime()) / 60000));
}

const PAUSAS_RAPIDAS: { label: string; minutos: number }[] = [
  { label: '30 min', minutos: 30 },
  { label: '1 hora', minutos: 60 },
  { label: '2 horas', minutos: 120 },
  { label: '4 horas', minutos: 240 },
];

export default function DeliveryControle({ compact = false, ctl }: DeliveryControleProps) {
  const { state, loading, acting, refresh, setOp } = ctl;
  const [modalOpen, setModalOpen] = useState(false);
  const [erro, setErro] = useState('');
  const [customHoras, setCustomHoras] = useState('');

  const aberto = state?.open_now === true;
  const semSessao = state?.has_session === false;

  function statusTexto(): string {
    if (!state) return 'Carregando…';
    switch (state.reason) {
      case 'horario': return 'Aberto pelo horário programado';
      case 'manual': return 'Aberto manualmente';
      case 'pausado': return 'Pausado até ' + fmtHora(state.paused_until);
      case 'fora_horario': return 'Fechado — fora do horário programado';
      case 'fechado_manual': return 'Fechado';
      case 'sem_sessao': return 'Caixa fechado — abra o caixa para usar o delivery';
      default: return aberto ? 'Aberto' : 'Fechado';
    }
  }

  async function doOp(op: DeliveryOp, minutes?: number) {
    setErro('');
    const r = await setOp(op, minutes);
    if (r && r.error) { setErro(r.error); return; }
    setModalOpen(false);
  }

  function abrirModal() {
    setErro('');
    setCustomHoras('');
    refresh();
    setModalOpen(true);
  }

  // ── Botão de status (na barra do caixa) ──
  const dotColor = aberto ? 'bg-green-500' : 'bg-zinc-400';
  const btnBase = 'flex items-center gap-2 rounded-xl border cursor-pointer transition-colors ' +
    (aberto ? 'border-green-200 bg-green-50 text-green-700 hover:bg-green-100'
            : 'border-zinc-200 bg-zinc-50 text-zinc-500 hover:bg-zinc-100');

  return (
    <>
      <button
        type="button"
        onClick={abrirModal}
        title="Controle do delivery"
        className={btnBase + (compact ? ' px-2.5 py-2 text-xs' : ' px-3 py-2 text-sm font-semibold')}
      >
        <span className="relative flex h-2.5 w-2.5">
          {aberto ? <span className="absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-60 animate-ping" /> : null}
          <span className={'relative inline-flex rounded-full h-2.5 w-2.5 ' + dotColor} />
        </span>
        <i className="ri-e-bike-2-line" />
        {!compact && <span>Delivery {loading && !state ? '…' : (aberto ? 'aberto' : 'fechado')}</span>}
      </button>

      {modalOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setModalOpen(false)}>
          <div className="bg-white rounded-2xl w-full max-w-md overflow-hidden" onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-100">
              <div className="flex items-center gap-3">
                <div className={'w-9 h-9 flex items-center justify-center rounded-xl ' + (aberto ? 'bg-green-100' : 'bg-zinc-100')}>
                  <i className={'ri-e-bike-2-line text-lg ' + (aberto ? 'text-green-600' : 'text-zinc-500')} />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-zinc-800">Delivery</h3>
                  <p className={'text-xs ' + (aberto ? 'text-green-600' : 'text-zinc-500')}>{statusTexto()}</p>
                </div>
              </div>
              <button onClick={() => setModalOpen(false)} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-zinc-100 cursor-pointer text-zinc-400">
                <i className="ri-close-line text-lg" />
              </button>
            </div>

            <div className="px-5 py-4 space-y-4">
              {semSessao ? (
                <div className="flex items-start gap-2 px-3 py-3 bg-amber-50 rounded-xl border border-amber-100">
                  <i className="ri-information-line text-amber-500 text-sm mt-0.5" />
                  <p className="text-xs text-amber-700">Abra uma sessão de caixa para abrir o delivery. Sem caixa aberto, o delivery fica sempre fechado.</p>
                </div>
              ) : aberto ? (
                <>
                  <button
                    type="button"
                    disabled={acting}
                    onClick={() => doOp('close')}
                    className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-red-500 text-white text-sm font-semibold hover:bg-red-600 cursor-pointer transition-colors disabled:opacity-60"
                  >
                    <i className="ri-stop-circle-line" /> Fechar delivery
                  </button>
                  {state?.schedule_enabled && state?.within_schedule && (
                    <p className="text-[11px] text-zinc-400 text-center -mt-2">Dentro do horário programado: ao fechar, pausa até o fim da janela de hoje e reabre na próxima.</p>
                  )}

                  <div className="pt-1">
                    <p className="text-xs font-semibold text-zinc-500 mb-2">Pausar por um tempo</p>
                    <div className="grid grid-cols-3 gap-2">
                      {PAUSAS_RAPIDAS.map((p) => (
                        <button
                          key={p.minutos}
                          type="button"
                          disabled={acting}
                          onClick={() => doOp('pause', p.minutos)}
                          className="py-2 px-2 text-xs font-medium rounded-lg bg-zinc-100 text-zinc-700 hover:bg-zinc-200 cursor-pointer transition-colors disabled:opacity-60"
                        >
                          {p.label}
                        </button>
                      ))}
                      <button
                        type="button"
                        disabled={acting}
                        onClick={() => doOp('pause', minutosAteFimDoDia())}
                        className="py-2 px-2 text-xs font-medium rounded-lg bg-zinc-100 text-zinc-700 hover:bg-zinc-200 cursor-pointer transition-colors disabled:opacity-60"
                      >
                        Resto do dia
                      </button>
                    </div>
                    <div className="flex items-center gap-2 mt-2">
                      <input
                        type="number"
                        min="0"
                        step="0.5"
                        value={customHoras}
                        onChange={(e) => setCustomHoras(e.target.value)}
                        placeholder="Horas"
                        className="w-24 px-3 py-2 text-sm border border-zinc-200 rounded-lg text-zinc-800 focus:outline-none focus:border-amber-400"
                      />
                      <button
                        type="button"
                        disabled={acting}
                        onClick={() => {
                          const h = parseFloat(customHoras.replace(',', '.'));
                          if (!Number.isFinite(h) || h <= 0) { setErro('Informe um número de horas válido.'); return; }
                          doOp('pause', Math.round(h * 60));
                        }}
                        className="flex-1 py-2 text-sm font-semibold rounded-lg bg-amber-500 text-white hover:bg-amber-600 cursor-pointer transition-colors disabled:opacity-60"
                      >
                        Pausar por X horas
                      </button>
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    disabled={acting}
                    onClick={() => doOp('open')}
                    className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-green-500 text-white text-sm font-semibold hover:bg-green-600 cursor-pointer transition-colors disabled:opacity-60"
                  >
                    <i className="ri-play-circle-line" /> Abrir delivery
                  </button>
                  {state?.reason === 'pausado' && (
                    <button
                      type="button"
                      disabled={acting}
                      onClick={() => doOp('resume')}
                      className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-zinc-200 text-zinc-600 text-sm font-semibold hover:bg-zinc-50 cursor-pointer transition-colors disabled:opacity-60"
                    >
                      <i className="ri-restart-line" /> Retomar (cancelar pausa)
                    </button>
                  )}
                  {state?.schedule_enabled && state?.reason === 'fora_horario' && (
                    <p className="text-[11px] text-zinc-400 text-center">Abrir agora ativa o delivery fora do horário programado até você fechar de novo.</p>
                  )}
                </>
              )}

              {erro && <p className="text-xs text-red-500 text-center">{erro}</p>}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
