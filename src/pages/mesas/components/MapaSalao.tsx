import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import type { Mesa } from '../../../contexts/MesasContext';

interface KDSStatusMesa {
  prontos: number;
  emPreparo: number;
  novos: number;
}

interface Props {
  mesas: Mesa[];
  mesaSelecionada: string | null;
  onSelect: (id: string) => void;
  mesaKDSMap?: Record<number, KDSStatusMesa>;
}

interface ReservationToday {
  table_id: string;
  customer_name: string;
  reservation_time: string;
  party_size: number;
  status: string;
}

type VisualStatus = 'livre' | 'ocupada' | 'reservada' | 'bloqueada';

const STATUS_COLORS: Record<VisualStatus, { bg: string; border: string; text: string; dot: string }> = {
  livre:     { bg: 'bg-green-50',  border: 'border-green-400',  text: 'text-green-800',  dot: 'bg-green-400' },
  ocupada:   { bg: 'bg-amber-50',  border: 'border-amber-500',  text: 'text-amber-900',  dot: 'bg-amber-500' },
  reservada: { bg: 'bg-zinc-100',  border: 'border-zinc-400',   text: 'text-zinc-600',   dot: 'bg-zinc-400' },
  bloqueada: { bg: 'bg-red-50',    border: 'border-red-300',    text: 'text-red-400',    dot: 'bg-red-300' },
};

function formatPrice(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function getShape(capacidade: number): 'redonda' | 'quadrada' | 'retangular' {
  if (capacidade <= 2) return 'redonda';
  if (capacidade <= 4) return 'quadrada';
  return 'retangular';
}

function getPos(mesa: Mesa, index: number, total: number) {
  if (mesa.posX != null && mesa.posY != null && (mesa.posX > 0 || mesa.posY > 0)) {
    return { x: mesa.posX, y: mesa.posY };
  }
  const cols = Math.min(Math.ceil(Math.sqrt(total)), 6);
  const col = index % cols;
  const row = Math.floor(index / cols);
  return { x: 4 + col * (88 / cols), y: 8 + row * 28 };
}

// Calcula tempo de ocupação a partir de abertaEm (formato "HH:MM")
function calcularTempoOcupacao(abertaEm: string | undefined): { minutos: number; label: string; urgente: boolean } | null {
  if (!abertaEm) return null;
  try {
    const [h, m] = abertaEm.split(':').map(Number);
    const agora = new Date();
    const abertura = new Date();
    abertura.setHours(h, m, 0, 0);
    // Se a hora de abertura for maior que agora, assume que foi ontem
    if (abertura > agora) abertura.setDate(abertura.getDate() - 1);
    const minutos = Math.floor((agora.getTime() - abertura.getTime()) / 60000);
    if (minutos < 0) return null;
    const horas = Math.floor(minutos / 60);
    const mins = minutos % 60;
    const label = horas > 0 ? `${horas}h${mins > 0 ? `${mins}m` : ''}` : `${mins}m`;
    return { minutos, label, urgente: minutos > 90 };
  } catch {
    return null;
  }
}

function MesaShape({ mesa, selecionada, onClick, index, total, tick, reserva, kdsStatus }: {
  mesa: Mesa;
  selecionada: boolean;
  onClick: () => void;
  index: number;
  total: number;
  tick: number;
  reserva: ReservationToday | null;
  kdsStatus?: KDSStatusMesa;
}) {
  const status = (mesa.status as VisualStatus) in STATUS_COLORS ? mesa.status as VisualStatus : 'livre';
  const c = STATUS_COLORS[status];
  const shape = getShape(mesa.capacidade);
  const pos = getPos(mesa, index, total);
  const tempo = mesa.status === 'ocupada' ? calcularTempoOcupacao(mesa.abertaEm) : null;

  const isRetangular = shape === 'retangular';
  const isRedonda = shape === 'redonda';
  const w = isRetangular ? 'w-24' : 'w-16';
  const h = isRetangular ? 'h-14' : 'h-16';
  const rounded = isRedonda ? 'rounded-full' : isRetangular ? 'rounded-xl' : 'rounded-lg';

  const timerColor = tempo
    ? tempo.urgente ? 'text-red-600 font-bold' : tempo.minutos > 60 ? 'text-amber-600 font-semibold' : 'text-zinc-500'
    : '';

  // Reserva próxima (dentro de 2h)
  const reservaProxima = reserva && ['pending', 'confirmed'].includes(reserva.status) && (() => {
    const [h, m] = reserva.reservation_time.split(':').map(Number);
    const agora = new Date();
    const horario = new Date();
    horario.setHours(h, m, 0, 0);
    const diffMin = (horario.getTime() - agora.getTime()) / 60000;
    return diffMin >= -30 && diffMin <= 120; // mostra se está entre -30min e +2h
  })();

  return (
    <button
      onClick={onClick}
      style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
      className={`absolute flex flex-col items-center justify-center border-2 transition-all cursor-pointer ${w} ${h} ${rounded} ${c.bg} ${c.border} ${c.text}
        ${selecionada ? 'ring-2 ring-offset-2 ring-amber-500 scale-110 z-10' : 'hover:scale-105 hover:z-10'}
        ${mesa.status === 'bloqueada' ? 'opacity-50 cursor-not-allowed' : ''}
        ${tempo?.urgente ? 'animate-pulse' : ''}`}
    >
      <div className="flex items-center gap-1">
        <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${c.dot} ${mesa.status === 'ocupada' ? 'animate-pulse' : ''}`} />
        <span className="text-xs font-bold">{mesa.numero}</span>
      </div>
      <span className="text-[8px] opacity-60">{mesa.capacidade} lug.</span>
      {tempo && (
        <span className={`text-[9px] ${timerColor} flex items-center gap-0.5`}>
          <i className="ri-time-line text-[8px]" />{tempo.label}
        </span>
      )}
      {mesa.clienteNome && (
        <span className="text-[8px] font-semibold truncate px-1 text-zinc-600 max-w-full leading-tight">
          {mesa.clienteNome.length > 10 ? mesa.clienteNome.slice(0, 9) + '…' : mesa.clienteNome}
        </span>
      )}
      {mesa.totalConsumo != null && mesa.totalConsumo > 0 && (
        <span className="text-[8px] font-semibold truncate px-1 text-amber-700">
          {formatPrice(mesa.totalConsumo)}
        </span>
      )}
      {tempo?.urgente && (
        <div className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-red-500 rounded-full flex items-center justify-center">
          <i className="ri-alarm-warning-line text-white text-[8px]" />
        </div>
      )}

      {/* Badge KDS: pedido pronto para entregar */}
      {!tempo?.urgente && kdsStatus && kdsStatus.prontos > 0 && (
        <div
          className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 bg-green-500 rounded-full flex items-center justify-center animate-bounce"
          title={`${kdsStatus.prontos} pedido${kdsStatus.prontos !== 1 ? 's' : ''} pronto${kdsStatus.prontos !== 1 ? 's' : ''} para entregar`}
        >
          <span className="text-white text-[8px] font-black leading-none">{kdsStatus.prontos}</span>
        </div>
      )}

      {/* Badge KDS: em preparo (sem pronto) */}
      {!tempo?.urgente && kdsStatus && kdsStatus.prontos === 0 && kdsStatus.emPreparo > 0 && (
        <div
          className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 bg-amber-500 rounded-full flex items-center justify-center"
          title={`${kdsStatus.emPreparo} pedido${kdsStatus.emPreparo !== 1 ? 's' : ''} em preparo`}
        >
          <span className="text-white text-[8px] font-black leading-none">
            <i className="ri-fire-line text-[7px]" />
          </span>
        </div>
      )}

      {/* Badge de reserva hoje */}
      {reserva && ['pending', 'confirmed'].includes(reserva.status) && (
        <div
          className={`absolute -bottom-1 -right-1 flex items-center justify-center rounded-full text-white text-[7px] font-bold
            ${reservaProxima ? 'w-4 h-4 bg-violet-500 animate-pulse' : 'w-3.5 h-3.5 bg-violet-400'}`}
          title={`Reserva: ${reserva.customer_name} às ${reserva.reservation_time.slice(0, 5)} (${reserva.party_size} pax)`}
        >
          <i className="ri-calendar-check-fill text-[7px]" />
        </div>
      )}
    </button>
  );
}

export default function MapaSalao({ mesas, mesaSelecionada, onSelect, mesaKDSMap = {} }: Props) {
  const { user } = useAuth();
  const statusEntries = Object.entries(STATUS_COLORS) as [VisualStatus, typeof STATUS_COLORS[VisualStatus]][];
  const [tick, setTick] = useState(0);
  const [reservasHoje, setReservasHoje] = useState<ReservationToday[]>([]);

  useEffect(() => {
    const interval = setInterval(() => setTick(t => t + 1), 60000);
    return () => clearInterval(interval);
  }, []);

  // Carrega reservas de hoje
  useEffect(() => {
    if (!user?.tenantId) return;
    const today = new Date().toISOString().slice(0, 10);
    supabase
      .from('table_reservations')
      .select('table_id, customer_name, reservation_time, party_size, status')
      .eq('reservation_date', today)
      .in('status', ['pending', 'confirmed', 'seated'])
      .then(({ data }) => {
        setReservasHoje((data ?? []) as ReservationToday[]);
      });
  }, [user?.tenantId, tick]);

  // Mapa de table_id → reserva (pega a mais próxima)
  const reservasPorMesa = reservasHoje.reduce<Record<string, ReservationToday>>((acc, r) => {
    if (!r.table_id) return acc;
    if (!acc[r.table_id]) {
      acc[r.table_id] = r;
    } else {
      // Mantém a mais próxima do horário atual
      const existTime = acc[r.table_id].reservation_time;
      if (r.reservation_time < existTime) acc[r.table_id] = r;
    }
    return acc;
  }, {});

  const mesasOcupadas = mesas.filter(m => m.status === 'ocupada');
  const totalConsumo = mesasOcupadas.reduce((s, m) => s + (m.totalConsumo ?? 0), 0);
  const mesasAlerta = mesasOcupadas.filter(m => {
    const t = calcularTempoOcupacao(m.abertaEm);
    return t?.urgente;
  });
  const totalReservasHoje = Object.keys(reservasPorMesa).length;

  return (
    <div className="flex flex-col h-full">
      {/* Legenda + stats */}
      <div className="flex items-center gap-4 px-4 py-2 border-b border-zinc-200 bg-white flex-shrink-0 flex-wrap">
        {statusEntries.map(([status, c]) => (
          <div key={status} className="flex items-center gap-1.5">
            <div className={`w-2.5 h-2.5 rounded-full ${c.dot}`} />
            <span className="text-xs text-zinc-600 capitalize">{status}</span>
          </div>
        ))}

        {/* Legenda reserva */}
        <div className="flex items-center gap-1.5">
          <div className="w-3.5 h-3.5 rounded-full bg-violet-400 flex items-center justify-center">
            <i className="ri-calendar-check-fill text-white text-[7px]" />
          </div>
          <span className="text-xs text-zinc-600">Reserva hoje</span>
        </div>

        <div className="ml-auto flex items-center gap-4 text-xs">
          <span className="text-zinc-500">{mesas.filter(m => m.status === 'livre').length} livres</span>
          <span className="text-amber-600 font-semibold">{mesasOcupadas.length} ocupadas</span>
          {totalReservasHoje > 0 && (
            <span className="flex items-center gap-1 text-violet-600 font-semibold">
              <i className="ri-calendar-check-line text-xs" />
              {totalReservasHoje} reserva{totalReservasHoje !== 1 ? 's' : ''} hoje
            </span>
          )}
          {totalConsumo > 0 && (
            <span className="font-bold text-zinc-700 border-l border-zinc-200 pl-3">
              Em aberto: <span className="text-amber-600">{formatPrice(totalConsumo)}</span>
            </span>
          )}
          {mesasAlerta.length > 0 && (
            <span className="flex items-center gap-1 bg-red-50 border border-red-200 text-red-600 px-2 py-0.5 rounded-full font-semibold">
              <i className="ri-alarm-warning-line text-xs" />
              {mesasAlerta.length} mesa{mesasAlerta.length > 1 ? 's' : ''} &gt;90min
            </span>
          )}
          <div className="flex items-center gap-1 text-zinc-400">
            <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
            <span>ao vivo</span>
          </div>
        </div>
      </div>

      {/* Área das mesas */}
      <div className="flex-1 overflow-auto p-4">
        <div
          className="relative bg-zinc-50 rounded-2xl border-2 border-dashed border-zinc-200 overflow-hidden"
          style={{ minHeight: '520px', minWidth: '680px' }}
        >
          <div className="absolute top-3 left-4 text-[10px] font-bold text-zinc-300 uppercase tracking-widest">
            Área Principal
          </div>
          <div className="absolute top-3 left-[56%] text-[10px] font-bold text-zinc-300 uppercase tracking-widest">
            Varanda / VIP
          </div>
          <div className="absolute top-0 bottom-0 border-l-2 border-dashed border-zinc-200" style={{ left: '55%' }} />

          {mesas.map((mesa, index) => (
            <MesaShape
              key={mesa.id}
              mesa={mesa}
              selecionada={mesaSelecionada === mesa.id}
              onClick={() => mesa.status !== 'bloqueada' && onSelect(mesa.id)}
              index={index}
              total={mesas.length}
              tick={tick}
              reserva={reservasPorMesa[mesa.id] ?? null}
              kdsStatus={mesaKDSMap[mesa.numero]}
            />
          ))}
        </div>
      </div>

      {/* Painel de reservas do dia (se houver) */}
      {totalReservasHoje > 0 && (
        <div className="px-4 py-3 border-t border-zinc-200 bg-white flex-shrink-0">
          <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-2">
            Reservas de hoje
          </p>
          <div className="flex items-center gap-2 overflow-x-auto pb-1">
            {reservasHoje
              .filter((r) => ['pending', 'confirmed'].includes(r.status))
              .sort((a, b) => a.reservation_time.localeCompare(b.reservation_time))
              .map((r) => (
                <div
                  key={r.table_id + r.reservation_time}
                  className="flex-shrink-0 flex items-center gap-2 px-3 py-1.5 bg-violet-50 border border-violet-200 rounded-lg"
                >
                  <div className="w-4 h-4 flex items-center justify-center text-violet-500">
                    <i className="ri-calendar-check-line text-xs" />
                  </div>
                  <div>
                    <p className="text-[10px] font-bold text-violet-700">{r.reservation_time.slice(0, 5)} · {r.customer_name}</p>
                    <p className="text-[9px] text-violet-400">{r.party_size} pax</p>
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
