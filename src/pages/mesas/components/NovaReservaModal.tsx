import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import type { ReservationOccasion } from '@/types/reservations';

interface Props {
  onClose: () => void;
  onSaved: () => void;
}

interface TableOption {
  id: string;
  number: number;
  area: string | null;
  capacity: number;
}

export default function NovaReservaModal({ onClose, onSaved }: Props) {
  const { user } = useAuth();
  const [tables, setTables] = useState<TableOption[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const [form, setForm] = useState({
    customer_name: '',
    customer_phone: '',
    party_size: 2,
    reservation_date: new Date().toISOString().slice(0, 10),
    reservation_time: '19:00',
    duration_minutes: 90,
    table_id: '',
    occasion: '' as ReservationOccasion | '',
    notes: '',
    status: 'confirmed' as 'pending' | 'confirmed',
  });

  useEffect(() => {
    supabase
      .from('tables')
      .select('id, number, area, capacity')
      .order('number')
      .then(({ data }) => setTables((data ?? []) as TableOption[]));
  }, []);

  function set(field: string, value: unknown) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.customer_name.trim() || !form.customer_phone.trim()) {
      setError('Nome e telefone são obrigatórios');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const { error: fnErr } = await supabase.functions.invoke('reservation-write', {
        body: {
          action: 'create_reservation',
          active_tenant_id: user?.tenantId,
          customer_name: form.customer_name.trim(),
          customer_phone: form.customer_phone.trim(),
          party_size: form.party_size,
          reservation_date: form.reservation_date,
          reservation_time: form.reservation_time + ':00',
          duration_minutes: form.duration_minutes,
          table_id: form.table_id || null,
          occasion: form.occasion || null,
          notes: form.notes.trim() || null,
          status: form.status,
        },
      });
      if (fnErr) throw fnErr;
      onSaved();
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl w-full max-w-lg mx-4 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-100">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 flex items-center justify-center bg-amber-50 rounded-lg">
              <i className="ri-calendar-check-line text-amber-600" />
            </div>
            <h2 className="text-base font-bold text-zinc-900">Nova Reserva</h2>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-zinc-100 text-zinc-400 cursor-pointer transition-colors">
            <i className="ri-close-line text-lg" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4 overflow-y-auto max-h-[70vh]">
          {error && (
            <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              <i className="ri-error-warning-line" />
              {error}
            </div>
          )}

          {/* Cliente */}
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="block text-xs font-semibold text-zinc-600 mb-1">Nome do cliente *</label>
              <input
                type="text"
                value={form.customer_name}
                onChange={(e) => set('customer_name', e.target.value)}
                placeholder="Ex: João Silva"
                className="w-full px-3 py-2 text-sm border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-zinc-600 mb-1">Telefone *</label>
              <input
                type="tel"
                value={form.customer_phone}
                onChange={(e) => set('customer_phone', e.target.value)}
                placeholder="(11) 99999-9999"
                className="w-full px-3 py-2 text-sm border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-zinc-600 mb-1">Nº de pessoas *</label>
              <input
                type="number"
                min={1}
                max={50}
                value={form.party_size}
                onChange={(e) => set('party_size', Number(e.target.value))}
                className="w-full px-3 py-2 text-sm border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400"
              />
            </div>
          </div>

          {/* Data e hora */}
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-1">
              <label className="block text-xs font-semibold text-zinc-600 mb-1">Data *</label>
              <input
                type="date"
                value={form.reservation_date}
                onChange={(e) => set('reservation_date', e.target.value)}
                className="w-full px-3 py-2 text-sm border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400 cursor-pointer"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-zinc-600 mb-1">Horário *</label>
              <input
                type="time"
                value={form.reservation_time}
                onChange={(e) => set('reservation_time', e.target.value)}
                className="w-full px-3 py-2 text-sm border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400 cursor-pointer"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-zinc-600 mb-1">Duração (min)</label>
              <select
                value={form.duration_minutes}
                onChange={(e) => set('duration_minutes', Number(e.target.value))}
                className="w-full px-3 py-2 text-sm border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400 cursor-pointer"
              >
                {[60, 90, 120, 150, 180].map((d) => (
                  <option key={d} value={d}>{d} min</option>
                ))}
              </select>
            </div>
          </div>

          {/* Mesa e ocasião */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-zinc-600 mb-1">Mesa (opcional)</label>
              <select
                value={form.table_id}
                onChange={(e) => set('table_id', e.target.value)}
                className="w-full px-3 py-2 text-sm border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400 cursor-pointer"
              >
                <option value="">A definir na chegada</option>
                {tables.map((t) => (
                  <option key={t.id} value={t.id}>
                    Mesa {t.number}{t.area ? ` · ${t.area}` : ''} ({t.capacity} lug.)
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-zinc-600 mb-1">Ocasião</label>
              <select
                value={form.occasion}
                onChange={(e) => set('occasion', e.target.value)}
                className="w-full px-3 py-2 text-sm border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400 cursor-pointer"
              >
                <option value="">Nenhuma</option>
                <option value="birthday">🎂 Aniversário</option>
                <option value="anniversary">💍 Aniversário de Casal</option>
                <option value="business">💼 Negócios</option>
                <option value="other">✨ Especial</option>
              </select>
            </div>
          </div>

          {/* Status inicial */}
          <div>
            <label className="block text-xs font-semibold text-zinc-600 mb-1">Status inicial</label>
            <div className="flex items-center gap-2">
              {(['confirmed', 'pending'] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => set('status', s)}
                  className={`flex-1 py-2 rounded-lg text-xs font-semibold cursor-pointer transition-colors border ${form.status === s ? 'bg-amber-500 text-white border-amber-500' : 'bg-white text-zinc-500 border-zinc-200 hover:border-zinc-300'}`}
                >
                  {s === 'confirmed' ? 'Confirmada' : 'Pendente'}
                </button>
              ))}
            </div>
          </div>

          {/* Observações */}
          <div>
            <label className="block text-xs font-semibold text-zinc-600 mb-1">Observações</label>
            <textarea
              value={form.notes}
              onChange={(e) => set('notes', e.target.value)}
              placeholder="Preferências, alergias, pedidos especiais..."
              rows={2}
              maxLength={500}
              className="w-full px-3 py-2 text-sm border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400 resize-none"
            />
          </div>

          {/* Botões */}
          <div className="flex items-center gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 rounded-lg text-sm font-semibold text-zinc-600 bg-zinc-100 hover:bg-zinc-200 cursor-pointer transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 py-2.5 rounded-lg text-sm font-semibold text-white bg-amber-500 hover:bg-amber-600 cursor-pointer transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {saving ? (
                <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Salvando...</>
              ) : (
                <><i className="ri-calendar-check-line" /> Criar Reserva</>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
