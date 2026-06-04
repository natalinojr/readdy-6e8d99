import { useState, useEffect, useCallback } from 'react';
import { supabase, invokeWithAuth } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import type { TableReservation, ReservationStatus } from '@/types/reservations';
import NovaReservaModal from './NovaReservaModal';

type FilterStatus = 'all' | ReservationStatus;

function formatDate(iso: string) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' });
}

function formatTime(time: string) {
  return time.slice(0, 5);
}

function statusConfig(status: ReservationStatus) {
  switch (status) {
    case 'pending':
      return { label: 'Pendente', bg: 'bg-amber-100', text: 'text-amber-700', icon: 'ri-time-line' };
    case 'confirmed':
      return { label: 'Confirmada', bg: 'bg-green-100', text: 'text-green-700', icon: 'ri-checkbox-circle-line' };
    case 'seated':
      return { label: 'Sentado', bg: 'bg-zinc-100', text: 'text-zinc-600', icon: 'ri-user-location-line' };
    case 'no_show':
      return { label: 'No-show', bg: 'bg-red-100', text: 'text-red-600', icon: 'ri-user-unfollow-line' };
    case 'cancelled':
      return { label: 'Cancelada', bg: 'bg-zinc-100', text: 'text-zinc-400', icon: 'ri-close-circle-line' };
    default:
      return { label: status, bg: 'bg-zinc-100', text: 'text-zinc-500', icon: 'ri-question-line' };
  }
}

function occasionLabel(occasion: string | null) {
  const map: Record<string, string> = {
    birthday: '🎂 Aniversário',
    anniversary: '💍 Aniversário de Casal',
    business: '💼 Negócios',
    other: '✨ Especial',
  };
  return occasion ? (map[occasion] ?? occasion) : null;
}

interface ReservationWithTable extends TableReservation {
  tables?: { number: number; area: string | null; capacity: number } | null;
}

export default function ReservasTab() {
  const { user } = useAuth();
  const [reservations, setReservations] = useState<ReservationWithTable[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('all');
  const [filterDate, setFilterDate] = useState('');
  const [search, setSearch] = useState('');
  const [novaReservaOpen, setNovaReservaOpen] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const loadReservations = useCallback(async () => {
    if (!user?.tenantId) return;
    setLoading(true);
    try {
      let query = supabase
        .from('table_reservations')
        .select(`
          *,
          tables (number, area, capacity)
        `)
        .order('reservation_date', { ascending: true })
        .order('reservation_time', { ascending: true });

      if (filterDate) query = query.eq('reservation_date', filterDate);
      if (filterStatus !== 'all') query = query.eq('status', filterStatus);

      const { data } = await query;
      setReservations((data ?? []) as ReservationWithTable[]);
    } finally {
      setLoading(false);
    }
  }, [user?.tenantId, filterDate, filterStatus]);

  useEffect(() => { loadReservations(); }, [loadReservations]);

  async function handleAction(reservationId: string, action: string, extra?: Record<string, unknown>) {
    setActionLoading(reservationId + action);
    try {
      await invokeWithAuth('reservation-write', {
        body: { action, reservation_id: reservationId, active_tenant_id: user?.tenantId, ...extra },
      });
      await loadReservations();
    } finally {
      setActionLoading(null);
    }
  }

  const filtered = reservations.filter((r) => {
    if (!search) return true;
    return (
      r.customer_name.toLowerCase().includes(search.toLowerCase()) ||
      r.customer_phone.includes(search)
    );
  });

  const counts = {
    pending: reservations.filter((r) => r.status === 'pending').length,
    confirmed: reservations.filter((r) => r.status === 'confirmed').length,
    seated: reservations.filter((r) => r.status === 'seated').length,
    no_show: reservations.filter((r) => r.status === 'no_show').length,
    cancelled: reservations.filter((r) => r.status === 'cancelled').length,
  };

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-100 bg-white flex-shrink-0 flex-wrap gap-3">
        <div className="flex items-center gap-3 flex-wrap">
          {/* Filtro de data */}
          <div className="flex items-center gap-1 bg-zinc-100 rounded-lg p-1">
            <button
              onClick={() => setFilterDate('')}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold cursor-pointer whitespace-nowrap transition-colors ${filterDate === '' ? 'bg-white text-zinc-900' : 'text-zinc-500 hover:text-zinc-700'}`}
            >
              Todas as datas
            </button>
            <button
              onClick={() => setFilterDate(today)}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold cursor-pointer whitespace-nowrap transition-colors ${filterDate === today ? 'bg-white text-zinc-900' : 'text-zinc-500 hover:text-zinc-700'}`}
            >
              Hoje
            </button>
            <button
              onClick={() => setFilterDate(new Date(Date.now() + 86400000).toISOString().slice(0, 10))}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold cursor-pointer whitespace-nowrap transition-colors ${filterDate === new Date(Date.now() + 86400000).toISOString().slice(0, 10) ? 'bg-white text-zinc-900' : 'text-zinc-500 hover:text-zinc-700'}`}
            >
              Amanhã
            </button>
          </div>

          <input
            type="date"
            value={filterDate}
            onChange={(e) => setFilterDate(e.target.value)}
            className="text-xs border border-zinc-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-amber-400 cursor-pointer"
          />

          {/* Filtro de status */}
          <div className="flex items-center gap-1 flex-wrap">
            {(['all', 'pending', 'confirmed', 'seated', 'no_show', 'cancelled'] as FilterStatus[]).map((s) => {
              const labels: Record<string, string> = { all: 'Todas', pending: `Pendentes (${counts.pending})`, confirmed: `Confirmadas (${counts.confirmed})`, seated: `Sentados (${counts.seated})`, no_show: `No-show (${counts.no_show})`, cancelled: `Canceladas (${counts.cancelled})` };
              return (
                <button
                  key={s}
                  onClick={() => setFilterStatus(s)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold cursor-pointer transition-colors whitespace-nowrap ${filterStatus === s ? 'bg-amber-500 text-white' : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200'}`}
                >
                  {labels[s]}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative">
            <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 text-sm" />
            <input
              type="text"
              placeholder="Buscar cliente..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 pr-3 py-2 text-sm border border-zinc-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-amber-400 w-48"
            />
          </div>
          <button
            onClick={loadReservations}
            className="w-8 h-8 flex items-center justify-center rounded-lg bg-zinc-100 hover:bg-zinc-200 text-zinc-500 cursor-pointer transition-colors"
          >
            <i className="ri-refresh-line text-sm" />
          </button>
          <button
            onClick={() => setNovaReservaOpen(true)}
            className="flex items-center gap-1.5 px-3 py-2 bg-amber-500 hover:bg-amber-600 text-white text-xs font-semibold rounded-lg cursor-pointer transition-colors whitespace-nowrap"
          >
            <i className="ri-add-line" />
            Nova Reserva
          </button>
        </div>
      </div>

      {/* Lista */}
      <div className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <div className="flex items-center justify-center h-48">
            <div className="w-6 h-6 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-zinc-400">
            <i className="ri-calendar-line text-4xl mb-2 text-zinc-300" />
            <p className="text-sm font-semibold text-zinc-500">Nenhuma reserva encontrada</p>
            <p className="text-xs text-zinc-400 mt-1">Crie uma nova reserva clicando no botão acima</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map((r) => {
              const cfg = statusConfig(r.status);
              const occ = occasionLabel(r.occasion);
              const isLoading = actionLoading?.startsWith(r.id);
              return (
                <div key={r.id} className={`bg-white rounded-xl border border-zinc-200 p-4 transition-all ${r.status === 'cancelled' ? 'opacity-60' : ''}`}>
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    {/* Info principal */}
                    <div className="flex items-start gap-4">
                      {/* Data/hora */}
                      <div className="flex-shrink-0 text-center bg-zinc-50 rounded-xl px-3 py-2 border border-zinc-100 min-w-[72px]">
                        <p className="text-xs text-zinc-400 font-medium capitalize">{formatDate(r.reservation_date)}</p>
                        <p className="text-lg font-black text-zinc-800">{formatTime(r.reservation_time)}</p>
                        <p className="text-[10px] text-zinc-400">{r.duration_minutes}min</p>
                      </div>

                      {/* Dados do cliente */}
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <p className="font-bold text-zinc-800">{r.customer_name}</p>
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${cfg.bg} ${cfg.text}`}>
                            <i className={`${cfg.icon} text-[10px]`} />
                            {cfg.label}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 text-xs text-zinc-500 flex-wrap">
                          <span className="flex items-center gap-1">
                            <i className="ri-phone-line text-[10px]" />
                            {r.customer_phone}
                          </span>
                          <span className="flex items-center gap-1">
                            <i className="ri-group-line text-[10px]" />
                            {r.party_size} pessoa{r.party_size !== 1 ? 's' : ''}
                          </span>
                          {r.tables && (
                            <span className="flex items-center gap-1">
                              <i className="ri-layout-grid-line text-[10px]" />
                              Mesa {r.tables.number}
                              {r.tables.area ? ` · ${r.tables.area}` : ''}
                            </span>
                          )}
                          {occ && (
                            <span className="font-medium text-amber-600">{occ}</span>
                          )}
                        </div>
                        {r.notes && (
                          <p className="text-xs text-zinc-400 mt-1 italic">&quot;{r.notes}&quot;</p>
                        )}
                        {r.cancellation_reason && (
                          <p className="text-xs text-red-400 mt-1">Motivo: {r.cancellation_reason}</p>
                        )}
                      </div>
                    </div>

                    {/* Ações */}
                    {!['cancelled', 'seated'].includes(r.status) && (
                      <div className="flex items-center gap-2 flex-shrink-0 flex-wrap">
                        {r.status === 'pending' && (
                          <button
                            onClick={() => handleAction(r.id, 'confirm_reservation')}
                            disabled={!!isLoading}
                            className="flex items-center gap-1 px-3 py-1.5 bg-green-500 hover:bg-green-600 text-white text-xs font-semibold rounded-lg cursor-pointer transition-colors whitespace-nowrap disabled:opacity-50"
                          >
                            <i className="ri-checkbox-circle-line" />
                            Confirmar
                          </button>
                        )}
                        {['pending', 'confirmed'].includes(r.status) && (
                          <button
                            onClick={() => handleAction(r.id, 'seat_reservation')}
                            disabled={!!isLoading}
                            className="flex items-center gap-1 px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white text-xs font-semibold rounded-lg cursor-pointer transition-colors whitespace-nowrap disabled:opacity-50"
                          >
                            <i className="ri-user-location-line" />
                            Sentar
                          </button>
                        )}
                        {['pending', 'confirmed'].includes(r.status) && (
                          <button
                            onClick={() => handleAction(r.id, 'mark_no_show')}
                            disabled={!!isLoading}
                            className="flex items-center gap-1 px-3 py-1.5 bg-zinc-100 hover:bg-zinc-200 text-zinc-600 text-xs font-semibold rounded-lg cursor-pointer transition-colors whitespace-nowrap disabled:opacity-50"
                          >
                            <i className="ri-user-unfollow-line" />
                            No-show
                          </button>
                        )}
                        <button
                          onClick={() => {
                            const reason = window.prompt('Motivo do cancelamento (opcional):');
                            if (reason !== null) handleAction(r.id, 'cancel_reservation', { cancellation_reason: reason || null });
                          }}
                          disabled={!!isLoading}
                          className="flex items-center gap-1 px-3 py-1.5 bg-red-50 hover:bg-red-100 text-red-600 text-xs font-semibold rounded-lg cursor-pointer transition-colors whitespace-nowrap disabled:opacity-50"
                        >
                          <i className="ri-close-circle-line" />
                          Cancelar
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {novaReservaOpen && (
        <NovaReservaModal
          onClose={() => setNovaReservaOpen(false)}
          onSaved={() => { setNovaReservaOpen(false); loadReservations(); }}
        />
      )}
    </div>
  );
}
