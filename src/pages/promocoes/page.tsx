import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useAuditoria } from '@/contexts/AuditoriaContext';
import type { PromotionRule, PromoType } from '@/types/promotions';
import PromocaoModal from './components/PromocaoModal';

const PROMO_TYPE_LABELS: Record<PromoType, string> = {
  item_percent: '% em item',
  item_fixed: 'R$ em item',
  category_percent: '% em categoria',
  order_percent: '% no pedido',
  order_fixed: 'R$ no pedido',
  buy_x_get_y: 'Compre X Ganhe Y',
  combo_price: 'Preço especial combo',
  free_item: 'Item grátis',
};

const DAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

function formatDiscount(rule: PromotionRule): string {
  if (rule.discount_value != null) {
    if (rule.promo_type.includes('percent') || rule.promo_type === 'category_percent') {
      return `${rule.discount_value}% off`;
    }
    return rule.discount_value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) + ' off';
  }
  if (rule.special_price != null) {
    return `Por ${rule.special_price.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`;
  }
  if (rule.buy_quantity && rule.get_quantity) {
    return `Compre ${rule.buy_quantity} Ganhe ${rule.get_quantity}`;
  }
  return '—';
}

function formatSchedule(rule: PromotionRule): string {
  const parts: string[] = [];
  if (rule.days_of_week && rule.days_of_week.length > 0 && rule.days_of_week.length < 7) {
    parts.push(rule.days_of_week.map((d) => DAYS[d]).join(', '));
  }
  if (rule.time_from && rule.time_until) {
    parts.push(`${rule.time_from.slice(0, 5)} – ${rule.time_until.slice(0, 5)}`);
  }
  if (rule.valid_from && rule.valid_until) {
    const from = new Date(rule.valid_from + 'T00:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
    const until = new Date(rule.valid_until + 'T00:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
    parts.push(`${from} a ${until}`);
  }
  return parts.join(' · ') || 'Sempre ativa';
}

export default function PromocoesPage() {
  const { user } = useAuth();
  const { registrarEvento } = useAuditoria();
  const [rules, setRules] = useState<PromotionRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterActive, setFilterActive] = useState<'all' | 'active' | 'inactive'>('all');
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editRule, setEditRule] = useState<PromotionRule | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const loadRules = useCallback(async () => {
    if (!user?.tenantId) return;
    setLoading(true);
    try {
      const { data } = await supabase
        .from('promotion_rules')
        .select('*')
        .order('priority', { ascending: true })
        .order('created_at', { ascending: false });
      setRules((data ?? []) as PromotionRule[]);
    } finally {
      setLoading(false);
    }
  }, [user?.tenantId]);

  useEffect(() => { loadRules(); }, [loadRules]);

  async function toggleActive(rule: PromotionRule) {
    setTogglingId(rule.id);
    try {
      await supabase.functions.invoke('menu-write', {
        body: {
          action: 'update_promotion_rule',
          promotion_id: rule.id,
          active_tenant_id: user?.tenantId,
          is_active: !rule.is_active,
        },
      });
      registrarEvento({
        tipo: 'item_editado',
        severidade: 'info',
        usuario: user?.nome ?? 'Operador',
        perfil: user?.perfil ?? '—',
        descricao: `Promoção "${rule.name}" ${!rule.is_active ? 'ativada' : 'desativada'}`,
        entidade: 'Promoção',
        entidadeId: rule.id.slice(0, 8),
      });
      await loadRules();
    } finally {
      setTogglingId(null);
    }
  }

  async function deleteRule(rule: PromotionRule) {
    if (!window.confirm(`Excluir a promoção "${rule.name}"?`)) return;
    await supabase.functions.invoke('menu-write', {
      body: { action: 'delete_promotion_rule', promotion_id: rule.id, active_tenant_id: user?.tenantId },
    });
    registrarEvento({
      tipo: 'item_editado',
      severidade: 'aviso',
      usuario: user?.nome ?? 'Operador',
      perfil: user?.perfil ?? '—',
      descricao: `Promoção "${rule.name}" excluída permanentemente`,
      entidade: 'Promoção',
      entidadeId: rule.id.slice(0, 8),
    });
    await loadRules();
  }

  const filtered = rules.filter((r) => {
    const matchActive = filterActive === 'all' || (filterActive === 'active' ? r.is_active : !r.is_active);
    const matchSearch = !search || r.name.toLowerCase().includes(search.toLowerCase());
    return matchActive && matchSearch;
  });

  const activeCount = rules.filter((r) => r.is_active).length;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 py-4" style={{ background: '#ffffff', borderBottom: '1px solid #f4f4f5' }}>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 flex items-center justify-center bg-rose-50 rounded-lg">
              <i className="ri-price-tag-3-line text-rose-600" />
            </div>
            <div>
              <h1 className="text-base font-bold text-zinc-900">Promoções</h1>
              <p className="text-xs text-zinc-400">{activeCount} ativa{activeCount !== 1 ? 's' : ''} de {rules.length} regra{rules.length !== 1 ? 's' : ''}</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="relative">
              <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 text-sm" />
              <input
                type="text"
                placeholder="Buscar promoção..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 pr-3 py-2 text-sm border border-zinc-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-rose-400 w-48"
              />
            </div>

            <div className="flex items-center gap-1 bg-zinc-100 rounded-lg p-1">
              {(['all', 'active', 'inactive'] as const).map((f) => {
                const labels = { all: 'Todas', active: 'Ativas', inactive: 'Inativas' };
                return (
                  <button
                    key={f}
                    onClick={() => setFilterActive(f)}
                    className={`px-3 py-1.5 rounded-md text-xs font-semibold cursor-pointer whitespace-nowrap transition-colors ${filterActive === f ? 'bg-white text-zinc-900' : 'text-zinc-500 hover:text-zinc-700'}`}
                  >
                    {labels[f]}
                  </button>
                );
              })}
            </div>

            <button
              onClick={() => { setEditRule(null); setModalOpen(true); }}
              className="flex items-center gap-1.5 px-3 py-2 bg-rose-500 hover:bg-rose-600 text-white text-sm font-semibold rounded-lg cursor-pointer transition-colors whitespace-nowrap"
            >
              <i className="ri-add-line" />
              Nova Promoção
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <div className="flex items-center justify-center h-48">
            <div className="w-6 h-6 border-2 border-rose-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-zinc-400">
            <i className="ri-price-tag-3-line text-5xl mb-3 text-zinc-300" />
            <p className="text-sm font-semibold text-zinc-500 mb-1">Nenhuma promoção encontrada</p>
            <p className="text-xs text-zinc-400 mb-4">Crie promoções para atrair mais clientes</p>
            <button
              onClick={() => { setEditRule(null); setModalOpen(true); }}
              className="flex items-center gap-1.5 px-4 py-2 bg-rose-500 hover:bg-rose-600 text-white text-sm font-semibold rounded-lg cursor-pointer transition-colors"
            >
              <i className="ri-add-line" />
              Criar primeira promoção
            </button>
          </div>
        ) : (
          <div className="space-y-3 max-w-4xl">
            {filtered.map((rule) => (
              <div
                key={rule.id}
                className={`bg-white rounded-xl border transition-all ${rule.is_active ? 'border-zinc-200' : 'border-zinc-100 opacity-60'}`}
              >
                <div className="flex items-start gap-4 p-4">
                  {/* Toggle ativo */}
                  <button
                    onClick={() => toggleActive(rule)}
                    disabled={togglingId === rule.id}
                    className={`relative flex-shrink-0 w-10 h-6 rounded-full transition-colors cursor-pointer mt-0.5 ${rule.is_active ? 'bg-rose-500' : 'bg-zinc-200'} disabled:opacity-50`}
                  >
                    <span className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-transform ${rule.is_active ? 'translate-x-5' : 'translate-x-1'}`} />
                  </button>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div>
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <p className="font-bold text-zinc-800">{rule.name}</p>
                          <span className="px-2 py-0.5 bg-rose-50 text-rose-600 text-xs font-semibold rounded-full">
                            {PROMO_TYPE_LABELS[rule.promo_type]}
                          </span>
                          {rule.coupon_code && (
                            <span className="px-2 py-0.5 bg-zinc-100 text-zinc-600 text-xs font-mono rounded-full">
                              {rule.coupon_code}
                            </span>
                          )}
                          {!rule.is_stackable && (
                            <span className="px-2 py-0.5 bg-amber-50 text-amber-600 text-xs font-semibold rounded-full">
                              Não acumulável
                            </span>
                          )}
                        </div>
                        {rule.description && (
                          <p className="text-xs text-zinc-500 mb-2">{rule.description}</p>
                        )}
                        <div className="flex items-center gap-4 text-xs text-zinc-500 flex-wrap">
                          <span className="flex items-center gap-1 font-semibold text-rose-600">
                            <i className="ri-discount-percent-line text-[10px]" />
                            {formatDiscount(rule)}
                          </span>
                          <span className="flex items-center gap-1">
                            <i className="ri-calendar-line text-[10px]" />
                            {formatSchedule(rule)}
                          </span>
                          {rule.max_uses_total != null && (
                            <span className="flex items-center gap-1">
                              <i className="ri-bar-chart-line text-[10px]" />
                              {rule.current_uses}/{rule.max_uses_total} usos
                            </span>
                          )}
                          {rule.min_order_amount != null && (
                            <span className="flex items-center gap-1">
                              <i className="ri-shopping-cart-line text-[10px]" />
                              Mín. {rule.min_order_amount.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                            </span>
                          )}
                        </div>

                        {/* Canais */}
                        <div className="flex items-center gap-1 mt-2 flex-wrap">
                          {Object.entries(rule.channels ?? {}).map(([ch, active]) => {
                            if (!active) return null;
                            const chLabels: Record<string, string> = { cashier: 'Caixa', waiter: 'Garçom', delivery: 'Delivery', self_service: 'Autoatendimento', table_qr: 'QR Mesa' };
                            return (
                              <span key={ch} className="px-1.5 py-0.5 bg-zinc-100 text-zinc-500 text-[10px] font-semibold rounded">
                                {chLabels[ch] ?? ch}
                              </span>
                            );
                          })}
                        </div>
                      </div>

                      {/* Ações */}
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <span className="text-xs text-zinc-400 mr-2">Prioridade {rule.priority}</span>
                        <button
                          onClick={() => { setEditRule(rule); setModalOpen(true); }}
                          className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-zinc-100 text-zinc-400 hover:text-zinc-700 cursor-pointer transition-colors"
                          title="Editar"
                        >
                          <i className="ri-edit-line text-sm" />
                        </button>
                        <button
                          onClick={() => deleteRule(rule)}
                          className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-red-50 text-zinc-400 hover:text-red-500 cursor-pointer transition-colors"
                          title="Excluir"
                        >
                          <i className="ri-delete-bin-line text-sm" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {modalOpen && (
        <PromocaoModal
          rule={editRule}
          onClose={() => setModalOpen(false)}
          onSaved={() => { setModalOpen(false); loadRules(); }}
        />
      )}
    </div>
  );
}
