import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import type { PromotionRule, PromoType, PromotionChannels } from '@/types/promotions';

interface Props {
  rule: PromotionRule | null;
  onClose: () => void;
  onSaved: () => void;
}

const PROMO_TYPES: { value: PromoType; label: string; desc: string }[] = [
  { value: 'item_percent', label: '% em item', desc: 'Desconto percentual em um item específico' },
  { value: 'item_fixed', label: 'R$ em item', desc: 'Desconto fixo em um item específico' },
  { value: 'category_percent', label: '% em categoria', desc: 'Desconto em todos os itens de uma categoria' },
  { value: 'order_percent', label: '% no pedido', desc: 'Desconto percentual no total do pedido' },
  { value: 'order_fixed', label: 'R$ no pedido', desc: 'Desconto fixo no total do pedido' },
  { value: 'buy_x_get_y', label: 'Compre X Ganhe Y', desc: 'Compre X unidades e ganhe Y de brinde' },
  { value: 'free_item', label: 'Item grátis', desc: 'Item grátis a partir de um valor mínimo' },
];

const DAYS_LABELS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

const DEFAULT_CHANNELS: PromotionChannels = {
  cashier: true,
  waiter: true,
  delivery: false,
  self_service: false,
  table_qr: false,
};

export default function PromocaoModal({ rule, onClose, onSaved }: Props) {
  const { user } = useAuth();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const [form, setForm] = useState({
    name: '',
    description: '',
    promo_type: 'order_percent' as PromoType,
    discount_value: '' as string | number,
    special_price: '' as string | number,
    buy_quantity: '' as string | number,
    get_quantity: '' as string | number,
    min_order_amount: '' as string | number,
    valid_from: '',
    valid_until: '',
    days_of_week: [] as number[],
    time_from: '',
    time_until: '',
    channels: { ...DEFAULT_CHANNELS } as PromotionChannels,
    max_uses_total: '' as string | number,
    max_uses_per_customer: '' as string | number,
    coupon_code: '',
    priority: 10,
    is_stackable: false,
    is_active: true,
  });

  useEffect(() => {
    if (rule) {
      setForm({
        name: rule.name,
        description: rule.description ?? '',
        promo_type: rule.promo_type,
        discount_value: rule.discount_value ?? '',
        special_price: rule.special_price ?? '',
        buy_quantity: rule.buy_quantity ?? '',
        get_quantity: rule.get_quantity ?? '',
        min_order_amount: rule.min_order_amount ?? '',
        valid_from: rule.valid_from ?? '',
        valid_until: rule.valid_until ?? '',
        days_of_week: rule.days_of_week ?? [],
        time_from: rule.time_from ? rule.time_from.slice(0, 5) : '',
        time_until: rule.time_until ? rule.time_until.slice(0, 5) : '',
        channels: rule.channels ?? { ...DEFAULT_CHANNELS },
        max_uses_total: rule.max_uses_total ?? '',
        max_uses_per_customer: rule.max_uses_per_customer ?? '',
        coupon_code: rule.coupon_code ?? '',
        priority: rule.priority,
        is_stackable: rule.is_stackable,
        is_active: rule.is_active,
      });
    }
  }, [rule]);

  function set(field: string, value: unknown) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function toggleDay(day: number) {
    setForm((prev) => ({
      ...prev,
      days_of_week: prev.days_of_week.includes(day)
        ? prev.days_of_week.filter((d) => d !== day)
        : [...prev.days_of_week, day].sort(),
    }));
  }

  function toggleChannel(ch: keyof PromotionChannels) {
    setForm((prev) => ({
      ...prev,
      channels: { ...prev.channels, [ch]: !prev.channels[ch] },
    }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) { setError('Nome é obrigatório'); return; }
    setSaving(true);
    setError('');

    const payload = {
      action: rule ? 'update_promotion_rule' : 'create_promotion_rule',
      active_tenant_id: user?.tenantId,
      ...(rule ? { promotion_id: rule.id } : {}),
      name: form.name.trim(),
      description: form.description.trim() || null,
      promo_type: form.promo_type,
      discount_value: form.discount_value !== '' ? Number(form.discount_value) : null,
      special_price: form.special_price !== '' ? Number(form.special_price) : null,
      buy_quantity: form.buy_quantity !== '' ? Number(form.buy_quantity) : null,
      get_quantity: form.get_quantity !== '' ? Number(form.get_quantity) : null,
      min_order_amount: form.min_order_amount !== '' ? Number(form.min_order_amount) : null,
      valid_from: form.valid_from || null,
      valid_until: form.valid_until || null,
      days_of_week: form.days_of_week.length > 0 ? form.days_of_week : null,
      time_from: form.time_from ? form.time_from + ':00' : null,
      time_until: form.time_until ? form.time_until + ':00' : null,
      channels: form.channels,
      max_uses_total: form.max_uses_total !== '' ? Number(form.max_uses_total) : null,
      max_uses_per_customer: form.max_uses_per_customer !== '' ? Number(form.max_uses_per_customer) : null,
      coupon_code: form.coupon_code.trim().toUpperCase() || null,
      priority: form.priority,
      is_stackable: form.is_stackable,
      is_active: form.is_active,
    };

    try {
      const { error: fnErr } = await supabase.functions.invoke('menu-write', { body: payload });
      if (fnErr) throw fnErr;
      onSaved();
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  }

  const needsDiscount = ['item_percent', 'item_fixed', 'category_percent', 'order_percent', 'order_fixed'].includes(form.promo_type);
  const needsBuyXGetY = form.promo_type === 'buy_x_get_y';
  const needsSpecialPrice = form.promo_type === 'combo_price';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl w-full max-w-2xl mx-4 overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-100 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 flex items-center justify-center bg-rose-50 rounded-lg">
              <i className="ri-price-tag-3-line text-rose-600" />
            </div>
            <h2 className="text-base font-bold text-zinc-900">{rule ? 'Editar Promoção' : 'Nova Promoção'}</h2>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-zinc-100 text-zinc-400 cursor-pointer transition-colors">
            <i className="ri-close-line text-lg" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-5">
          {error && (
            <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              <i className="ri-error-warning-line" />{error}
            </div>
          )}

          {/* Nome e descrição */}
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-semibold text-zinc-600 mb-1">Nome da promoção *</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => set('name', e.target.value)}
                placeholder="Ex: Happy Hour, Desconto de Aniversário..."
                className="w-full px-3 py-2 text-sm border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-rose-400"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-zinc-600 mb-1">Descrição (opcional)</label>
              <input
                type="text"
                value={form.description}
                onChange={(e) => set('description', e.target.value)}
                placeholder="Descrição curta para exibir ao operador"
                className="w-full px-3 py-2 text-sm border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-rose-400"
              />
            </div>
          </div>

          {/* Tipo de promoção */}
          <div>
            <label className="block text-xs font-semibold text-zinc-600 mb-2">Tipo de promoção *</label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {PROMO_TYPES.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => set('promo_type', t.value)}
                  className={`flex flex-col items-start p-3 rounded-xl border text-left cursor-pointer transition-all ${form.promo_type === t.value ? 'border-rose-400 bg-rose-50' : 'border-zinc-200 hover:border-zinc-300'}`}
                >
                  <span className={`text-xs font-bold mb-0.5 ${form.promo_type === t.value ? 'text-rose-700' : 'text-zinc-700'}`}>{t.label}</span>
                  <span className="text-[10px] text-zinc-400 leading-tight">{t.desc}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Valor do desconto */}
          <div className="grid grid-cols-2 gap-3">
            {needsDiscount && (
              <div>
                <label className="block text-xs font-semibold text-zinc-600 mb-1">
                  {form.promo_type.includes('percent') ? 'Percentual (%)' : 'Valor (R$)'}
                </label>
                <input
                  type="number"
                  min={0}
                  max={form.promo_type.includes('percent') ? 100 : undefined}
                  step="0.01"
                  value={form.discount_value}
                  onChange={(e) => set('discount_value', e.target.value)}
                  placeholder={form.promo_type.includes('percent') ? '20' : '10.00'}
                  className="w-full px-3 py-2 text-sm border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-rose-400"
                />
              </div>
            )}
            {needsSpecialPrice && (
              <div>
                <label className="block text-xs font-semibold text-zinc-600 mb-1">Preço especial (R$)</label>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={form.special_price}
                  onChange={(e) => set('special_price', e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-rose-400"
                />
              </div>
            )}
            {needsBuyXGetY && (
              <>
                <div>
                  <label className="block text-xs font-semibold text-zinc-600 mb-1">Compre (qtd)</label>
                  <input type="number" min={1} value={form.buy_quantity} onChange={(e) => set('buy_quantity', e.target.value)} className="w-full px-3 py-2 text-sm border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-rose-400" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-zinc-600 mb-1">Ganhe (qtd)</label>
                  <input type="number" min={1} value={form.get_quantity} onChange={(e) => set('get_quantity', e.target.value)} className="w-full px-3 py-2 text-sm border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-rose-400" />
                </div>
              </>
            )}
            <div>
              <label className="block text-xs font-semibold text-zinc-600 mb-1">Pedido mínimo (R$)</label>
              <input
                type="number"
                min={0}
                step="0.01"
                value={form.min_order_amount}
                onChange={(e) => set('min_order_amount', e.target.value)}
                placeholder="Opcional"
                className="w-full px-3 py-2 text-sm border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-rose-400"
              />
            </div>
          </div>

          {/* Período de validade */}
          <div>
            <label className="block text-xs font-semibold text-zinc-600 mb-2">Período de validade</label>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] text-zinc-400 mb-1">De</label>
                <input type="date" value={form.valid_from} onChange={(e) => set('valid_from', e.target.value)} className="w-full px-3 py-2 text-sm border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-rose-400 cursor-pointer" />
              </div>
              <div>
                <label className="block text-[10px] text-zinc-400 mb-1">Até</label>
                <input type="date" value={form.valid_until} onChange={(e) => set('valid_until', e.target.value)} className="w-full px-3 py-2 text-sm border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-rose-400 cursor-pointer" />
              </div>
            </div>
          </div>

          {/* Dias da semana */}
          <div>
            <label className="block text-xs font-semibold text-zinc-600 mb-2">Dias da semana (vazio = todos)</label>
            <div className="flex items-center gap-1.5 flex-wrap">
              {DAYS_LABELS.map((d, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => toggleDay(i)}
                  className={`w-10 h-10 flex items-center justify-center rounded-lg text-xs font-bold cursor-pointer transition-colors ${form.days_of_week.includes(i) ? 'bg-rose-500 text-white' : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200'}`}
                >
                  {d}
                </button>
              ))}
            </div>
          </div>

          {/* Horário */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-zinc-600 mb-1">Horário início</label>
              <input type="time" value={form.time_from} onChange={(e) => set('time_from', e.target.value)} className="w-full px-3 py-2 text-sm border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-rose-400 cursor-pointer" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-zinc-600 mb-1">Horário fim</label>
              <input type="time" value={form.time_until} onChange={(e) => set('time_until', e.target.value)} className="w-full px-3 py-2 text-sm border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-rose-400 cursor-pointer" />
            </div>
          </div>

          {/* Canais */}
          <div>
            <label className="block text-xs font-semibold text-zinc-600 mb-2">Canais válidos</label>
            <div className="flex items-center gap-2 flex-wrap">
              {(Object.keys(DEFAULT_CHANNELS) as (keyof PromotionChannels)[]).map((ch) => {
                const labels: Record<keyof PromotionChannels, string> = { cashier: 'Caixa', waiter: 'Garçom', delivery: 'Delivery', self_service: 'Autoatendimento', table_qr: 'QR Mesa' };
                return (
                  <button
                    key={ch}
                    type="button"
                    onClick={() => toggleChannel(ch)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer transition-colors ${form.channels[ch] ? 'bg-rose-500 text-white' : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200'}`}
                  >
                    {labels[ch]}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Limites e cupom */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-semibold text-zinc-600 mb-1">Usos totais</label>
              <input type="number" min={0} value={form.max_uses_total} onChange={(e) => set('max_uses_total', e.target.value)} placeholder="Ilimitado" className="w-full px-3 py-2 text-sm border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-rose-400" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-zinc-600 mb-1">Usos por cliente</label>
              <input type="number" min={0} value={form.max_uses_per_customer} onChange={(e) => set('max_uses_per_customer', e.target.value)} placeholder="Ilimitado" className="w-full px-3 py-2 text-sm border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-rose-400" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-zinc-600 mb-1">Código cupom</label>
              <input type="text" value={form.coupon_code} onChange={(e) => set('coupon_code', e.target.value.toUpperCase())} placeholder="PROMO10" className="w-full px-3 py-2 text-sm border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-rose-400 font-mono" />
            </div>
          </div>

          {/* Prioridade e opções */}
          <div className="flex items-center gap-4 flex-wrap">
            <div>
              <label className="block text-xs font-semibold text-zinc-600 mb-1">Prioridade (menor = maior)</label>
              <input type="number" min={1} max={100} value={form.priority} onChange={(e) => set('priority', Number(e.target.value))} className="w-24 px-3 py-2 text-sm border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-rose-400" />
            </div>
            <label className="flex items-center gap-2 cursor-pointer mt-4">
              <input type="checkbox" checked={form.is_stackable} onChange={(e) => set('is_stackable', e.target.checked)} className="w-4 h-4 accent-rose-500 cursor-pointer" />
              <span className="text-sm text-zinc-600 font-medium">Acumulável com outras promoções</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer mt-4">
              <input type="checkbox" checked={form.is_active} onChange={(e) => set('is_active', e.target.checked)} className="w-4 h-4 accent-rose-500 cursor-pointer" />
              <span className="text-sm text-zinc-600 font-medium">Ativa imediatamente</span>
            </label>
          </div>
        </form>

        {/* Footer */}
        <div className="flex items-center gap-3 px-6 py-4 border-t border-zinc-100 flex-shrink-0">
          <button type="button" onClick={onClose} className="flex-1 py-2.5 rounded-lg text-sm font-semibold text-zinc-600 bg-zinc-100 hover:bg-zinc-200 cursor-pointer transition-colors">
            Cancelar
          </button>
          <button
            onClick={handleSubmit as unknown as React.MouseEventHandler}
            disabled={saving}
            className="flex-1 py-2.5 rounded-lg text-sm font-semibold text-white bg-rose-500 hover:bg-rose-600 cursor-pointer transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {saving ? (
              <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Salvando...</>
            ) : (
              <><i className="ri-save-line" /> {rule ? 'Salvar alterações' : 'Criar promoção'}</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
