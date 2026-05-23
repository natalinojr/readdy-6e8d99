import { useState, useEffect, useRef, useCallback } from 'react';
import type { Chamado } from '../types';

interface Props {
  chamados: Chamado[];
  onAtender: (id: string) => void;
  onClose: () => void;
}

const TIPO_CONFIG = {
  atendimento: { label: 'Atendimento', icon: 'ri-hand-heart-line', cor: 'bg-amber-100 text-amber-700 border-amber-300' },
  pagamento: { label: 'Pagamento', icon: 'ri-money-dollar-circle-line', cor: 'bg-green-100 text-green-700 border-green-300' },
  pedido: { label: 'Pedido', icon: 'ri-restaurant-line', cor: 'bg-sky-100 text-sky-700 border-sky-300' },
};

// Limiar de alerta em minutos
const LEMBRETE_MINUTOS = 5;

function playBeep(urgent = false) {
  try {
    const ctx = new AudioContext();
    const freqs = urgent ? [880, 1100, 880] : [880, 1100];
    freqs.forEach((freq, i) => {
      setTimeout(() => {
        const gain = ctx.createGain();
        gain.connect(ctx.destination);
        gain.gain.setValueAtTime(0, ctx.currentTime);
        gain.gain.linearRampToValueAtTime(urgent ? 0.35 : 0.25, ctx.currentTime + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, ctx.currentTime);
        osc.connect(gain);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.5);
      }, i * 280);
    });
  } catch {
    // blocked
  }
}

function getElapsedSec(ts: number) {
  return Math.floor((Date.now() - ts) / 1000);
}

function formatElapsed(sec: number): string {
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m < 60) return s > 0 ? `${m}min ${s}s` : `${m}min`;
  return `${Math.floor(m / 60)}h${(m % 60).toString().padStart(2, '0')}m`;
}

function ElapsedBadge({ timestamp, isUrgente }: { timestamp: number; isUrgente: boolean }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);
  const sec = getElapsedSec(timestamp);
  return (
    <span className={`text-xs font-bold tabular-nums ${isUrgente ? 'text-red-600' : 'text-zinc-500'}`}>
      {isUrgente && <i className="ri-alarm-warning-line mr-0.5 text-[11px]" />}
      há {formatElapsed(sec)}
    </span>
  );
}

function CountdownReminder({ timestamp }: { timestamp: number }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);
  const totalSec = LEMBRETE_MINUTOS * 60;
  const elapsed = getElapsedSec(timestamp);
  const remaining = Math.max(0, totalSec - elapsed);
  const progress = Math.min(1, elapsed / totalSec);

  if (elapsed >= totalSec) {
    return (
      <div className="mt-1.5 flex items-center gap-1.5">
        <div className="flex-1 h-1 bg-red-200 rounded-full overflow-hidden">
          <div className="h-full bg-red-500 w-full" />
        </div>
        <span className="text-[9px] font-bold text-red-600 whitespace-nowrap">LEMBRETE!</span>
      </div>
    );
  }

  const rem_m = Math.floor(remaining / 60);
  const rem_s = remaining % 60;
  return (
    <div className="mt-1.5 flex items-center gap-1.5">
      <div className="flex-1 h-1 bg-zinc-200 rounded-full overflow-hidden">
        <div
          className="h-full bg-amber-400 rounded-full transition-all duration-1000"
          style={{ width: `${progress * 100}%` }}
        />
      </div>
      <span className="text-[9px] text-zinc-400 whitespace-nowrap">
        lembrete em {rem_m > 0 ? `${rem_m}:${rem_s.toString().padStart(2, '0')}` : `${rem_s}s`}
      </span>
    </div>
  );
}

export default function ChamadosPanel({ chamados, onAtender, onClose }: Props) {
  const prevCountRef = useRef(chamados.length);
  const lembretesDisparadosRef = useRef<Set<string>>(new Set());

  // Som quando novo chamado chega
  useEffect(() => {
    if (chamados.length > prevCountRef.current) {
      playBeep(false);
    }
    prevCountRef.current = chamados.length;
  }, [chamados.length]);

  // Verificar lembretes a cada segundo
  useEffect(() => {
    const id = setInterval(() => {
      chamados.filter((c) => !c.atendido).forEach((c) => {
        const elapsed = Math.floor((Date.now() - c.timestamp) / 60000);
        const key = `${c.id}-${Math.floor(elapsed / LEMBRETE_MINUTOS)}`;
        if (elapsed > 0 && elapsed % LEMBRETE_MINUTOS === 0 && !lembretesDisparadosRef.current.has(key)) {
          lembretesDisparadosRef.current.add(key);
          playBeep(true);
        }
      });
    }, 1000);
    return () => clearInterval(id);
  }, [chamados]);

  const pendentes = chamados.filter((c) => !c.atendido).sort((a, b) => a.timestamp - b.timestamp);
  const atendidos = chamados.filter((c) => c.atendido);

  const handleAtender = useCallback((id: string) => {
    onAtender(id);
  }, [onAtender]);

  const isUrgente = (ts: number) => Math.floor((Date.now() - ts) / 60000) >= LEMBRETE_MINUTOS;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-zinc-900/80" onClick={onClose}>
      <div
        className="mt-auto bg-white rounded-t-2xl flex flex-col max-h-[85vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-4 border-b border-zinc-100 flex-shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 flex items-center justify-center bg-red-100 rounded-xl">
              <i className="ri-notification-3-fill text-red-500 text-base" />
            </div>
            <div>
              <p className="text-sm font-bold text-zinc-900">Chamados de Clientes</p>
              <p className="text-xs text-zinc-400">
                {pendentes.length} pendente{pendentes.length !== 1 ? 's' : ''} · fila por ordem de chegada
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {pendentes.some((c) => isUrgente(c.timestamp)) && (
              <span className="flex items-center gap-1 text-[10px] font-bold px-2 py-1 bg-red-100 text-red-600 rounded-full border border-red-200 animate-pulse">
                <i className="ri-alarm-warning-fill text-[10px]" />
                Urgente!
              </span>
            )}
            <button
              onClick={onClose}
              className="w-8 h-8 flex items-center justify-center rounded-full bg-zinc-100 hover:bg-zinc-200 cursor-pointer text-zinc-500 transition-colors"
            >
              <i className="ri-close-line text-base" />
            </button>
          </div>
        </div>

        {/* Banner de lembrete urgente */}
        {pendentes.some((c) => isUrgente(c.timestamp)) && (
          <div className="flex items-center gap-2 px-4 py-2.5 bg-red-50 border-b border-red-200 flex-shrink-0 animate-pulse">
            <i className="ri-alarm-warning-fill text-red-500 text-base" />
            <p className="text-xs font-bold text-red-700 flex-1">
              Há chamados aguardando há mais de {LEMBRETE_MINUTOS} minutos sem resposta! Som de lembrete ativado.
            </p>
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
          {pendentes.length === 0 && (
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <div className="w-14 h-14 flex items-center justify-center bg-green-100 rounded-2xl mb-3">
                <i className="ri-check-double-line text-2xl text-green-500" />
              </div>
              <p className="text-sm font-semibold text-zinc-600">Nenhum chamado pendente</p>
              <p className="text-xs text-zinc-400 mt-1">Tudo em dia!</p>
            </div>
          )}

          {pendentes.map((c, idx) => {
            const urgente = isUrgente(c.timestamp);
            const cfg = TIPO_CONFIG[c.tipo as keyof typeof TIPO_CONFIG] ?? TIPO_CONFIG.atendimento;
            return (
              <div
                key={c.id}
                className={`rounded-xl border-2 overflow-hidden transition-all ${
                  urgente ? 'border-red-400 bg-red-50' : idx === 0 ? 'border-amber-300 bg-amber-50/50' : 'border-zinc-200 bg-white'
                }`}
              >
                <div className="flex items-start gap-3 px-3 py-3">
                  {/* Posição na fila */}
                  <div className={`w-7 h-7 flex items-center justify-center rounded-full flex-shrink-0 font-black text-sm mt-0.5 ${
                    urgente ? 'bg-red-500 text-white animate-pulse' : idx === 0 ? 'bg-amber-500 text-white' : 'bg-zinc-200 text-zinc-600'
                  }`}>
                    {urgente ? <i className="ri-alarm-warning-line text-sm" /> : idx + 1}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-bold text-zinc-900">Mesa {c.mesaNumero}</span>
                      {c.clienteNome && (
                        <span className="text-xs text-zinc-500 truncate">{c.clienteNome}</span>
                      )}
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${cfg.cor} flex items-center gap-1`}>
                        <i className={`${cfg.icon} text-[10px]`} />
                        {cfg.label}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      <span className="text-xs text-zinc-400">Chegou às {c.hora}</span>
                      <ElapsedBadge timestamp={c.timestamp} isUrgente={urgente} />
                    </div>
                    {/* Barra de countdown até lembrete */}
                    {!urgente && <CountdownReminder timestamp={c.timestamp} />}
                    {urgente && (
                      <div className="mt-1 text-[10px] font-bold text-red-600 flex items-center gap-1">
                        <i className="ri-notification-3-fill text-[10px]" />
                        Notificação de lembrete disparada
                      </div>
                    )}
                  </div>

                  {/* Botão atender */}
                  <button
                    onClick={() => handleAtender(c.id)}
                    className={`flex items-center gap-1.5 text-white text-xs font-bold px-3 py-2 rounded-xl cursor-pointer whitespace-nowrap transition-colors flex-shrink-0 ${
                      urgente ? 'bg-red-500 hover:bg-red-600' : 'bg-green-500 hover:bg-green-600'
                    }`}
                  >
                    <i className="ri-check-line" />
                    Atendi
                  </button>
                </div>

                {/* Número do pedido na fila */}
                {idx === 0 && !urgente && (
                  <div className="px-3 pb-2 flex items-center gap-1.5">
                    <i className="ri-arrow-right-circle-line text-amber-500 text-xs" />
                    <span className="text-[10px] font-semibold text-amber-600">Próximo na fila — atenda este primeiro</span>
                  </div>
                )}
              </div>
            );
          })}

          {atendidos.length > 0 && (
            <div className="mt-3">
              <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider mb-2">Já atendidos ({atendidos.length})</p>
              {atendidos.map((c) => {
                const cfg = TIPO_CONFIG[c.tipo as keyof typeof TIPO_CONFIG] ?? TIPO_CONFIG.atendimento;
                return (
                  <div key={c.id} className="flex items-center gap-2 px-3 py-2.5 bg-zinc-50 rounded-xl mb-1.5 opacity-60">
                    <i className="ri-checkbox-circle-fill text-green-400 text-base" />
                    <span className="text-xs font-semibold text-zinc-600">Mesa {c.mesaNumero}</span>
                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full border ${cfg.cor}`}>{cfg.label}</span>
                    <span className="text-[10px] text-zinc-400 ml-auto">{c.hora}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 pb-5 pt-2 border-t border-zinc-100 flex-shrink-0">
          <div className="flex items-center gap-2 justify-center">
            <div className="w-2 h-2 rounded-full bg-amber-400" />
            <p className="text-[10px] text-zinc-400">
              Som automático ao receber chamado · Lembrete após {LEMBRETE_MINUTOS} min sem atendimento
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
