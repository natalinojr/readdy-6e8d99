// Aba Promoções de Clientes & Marketing.
//
// Mostra DUAS coisas diferentes, e a tela deixa isso explícito:
//  1. Preço promocional do Cardápio (item_promotions) — é o que o caixa, o garçom,
//     o QR da mesa e o delivery cobram de verdade (promoAtivaHoje).
//  2. Regras de desconto (promotion_rules) — cupom, % no pedido, compre X ganhe Y…
//     O motor existe na Edge (`order-write › apply_promotions`), mas NENHUMA tela de
//     venda chama essa ação ainda: a regra fica cadastrada e não desconta nada.
//     Em 2026-09-26 havia 1 regra ativa com 0 usos. Ligar o motor no PDV/delivery é
//     decisão do dono (mexe no valor cobrado) — até lá a tela avisa.
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase, invokeWithAuth } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useAuditoria } from '@/contexts/AuditoriaContext';
import { useCardapio } from '@/contexts/CardapioContext';
import { usePermissoes } from '@/hooks/usePermissoes';
import { promoAtivaHoje } from '@/lib/promoUtils';
import type { PromotionRule, PromoType } from '@/types/promotions';
import PromocaoModal from '@/pages/promocoes/components/PromocaoModal';
import { confirmar } from '@/components/base/Dialogos';

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
const CH_LABELS: Record<string, string> = { cashier: 'Caixa', waiter: 'Garçom', delivery: 'Delivery', self_service: 'Autoatendimento', table_qr: 'QR Mesa' };

function fmtMoeda(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatDiscount(rule: PromotionRule): string {
  if (rule.discount_value != null) {
    if (rule.promo_type.includes('percent')) return `${rule.discount_value}% off`;
    return fmtMoeda(rule.discount_value) + ' off';
  }
  if (rule.special_price != null) return `Por ${fmtMoeda(rule.special_price)}`;
  if (rule.buy_quantity && rule.get_quantity) return `Compre ${rule.buy_quantity} Ganhe ${rule.get_quantity}`;
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
  const fmt = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  if (rule.valid_from && rule.valid_until) parts.push(`${fmt(rule.valid_from)} a ${fmt(rule.valid_until)}`);
  else if (rule.valid_until) parts.push(`até ${fmt(rule.valid_until)}`);
  else if (rule.valid_from) parts.push(`a partir de ${fmt(rule.valid_from)}`);
  return parts.join(' · ') || 'Todos os dias';
}

function hojeISO(agora = new Date()) {
  return `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, '0')}-${String(agora.getDate()).padStart(2, '0')}`;
}

type Situacao = { label: string; cls: string };

/** Por que a regra vale (ou não) AGORA — mesma ordem de checagem do motor (isRuleActiveNow). */
function situacaoDaRegra(rule: PromotionRule, agora = new Date()): Situacao {
  if (!rule.is_active) return { label: 'Desligada', cls: 'bg-zinc-100 text-zinc-500' };
  const hoje = hojeISO(agora);
  if (rule.valid_until && hoje > rule.valid_until) return { label: 'Encerrada', cls: 'bg-zinc-100 text-zinc-500' };
  if (rule.valid_from && hoje < rule.valid_from) return { label: 'Agendada', cls: 'bg-sky-50 text-sky-700' };
  if (rule.max_uses_total != null && rule.current_uses >= rule.max_uses_total) return { label: 'Esgotada', cls: 'bg-zinc-100 text-zinc-500' };
  if (rule.days_of_week && rule.days_of_week.length > 0 && !rule.days_of_week.includes(agora.getDay())) {
    return { label: 'Fora do dia', cls: 'bg-amber-50 text-amber-700' };
  }
  const min = agora.getHours() * 60 + agora.getMinutes();
  const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  if ((rule.time_from && min < toMin(rule.time_from)) || (rule.time_until && min > toMin(rule.time_until))) {
    return { label: 'Fora do horário', cls: 'bg-amber-50 text-amber-700' };
  }
  return { label: 'No período', cls: 'bg-green-50 text-green-700' };
}

export default function PromocoesAba() {
  const { user } = useAuth();
  const { registrarEvento } = useAuditoria();
  const { itens, loading: cardapioLoading } = useCardapio();
  const { hasPermissao } = usePermissoes();
  const navigate = useNavigate();
  const [rules, setRules] = useState<PromotionRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState('');
  const [filterActive, setFilterActive] = useState<'all' | 'active' | 'inactive'>('all');
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editRule, setEditRule] = useState<PromotionRule | null>(null);
  const [duplicar, setDuplicar] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const podeCardapio = hasPermissao('cardapio_editar');

  const loadRules = useCallback(async () => {
    if (!user?.tenantId) return;
    setLoading(true);
    try {
      // Filtro explícito pela loja ativa: o RLS usa a última membership do
      // usuário, e um admin com várias lojas via as regras da loja errada.
      const { data, error } = await supabase
        .from('promotion_rules')
        .select('*')
        .eq('tenant_id', user.tenantId)
        .order('priority', { ascending: true })
        .order('created_at', { ascending: false });
      if (error) setErro(error.message);
      setRules((data ?? []) as PromotionRule[]);
    } finally {
      setLoading(false);
    }
  }, [user?.tenantId]);

  useEffect(() => { loadRules(); }, [loadRules]);

  // Preço promocional por item (o que vale no caixa/delivery hoje).
  const promosCardapio = useMemo(() => {
    const out: { id: string; nome: string; preco: number; promo: number; quando: string; hoje: boolean; ativo: boolean }[] = [];
    itens.forEach((item) => {
      if (item.status === 'inativo') return;
      const valeHoje = promoAtivaHoje(item.promocoes);
      item.promocoes.forEach((p) => {
        const quando = p.tipo === 'pontual'
          ? (p.dataEspecifica ? `Só em ${new Date(p.dataEspecifica.slice(0, 10) + 'T00:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}` : 'Data única')
          : (!p.diasSemana || p.diasSemana.length === 0 || p.diasSemana.length === 7 ? 'Todos os dias' : p.diasSemana.map((d) => DAYS[d]).join(', '));
        // Pontual de data passada não interessa mais.
        if (p.tipo === 'pontual' && p.dataEspecifica && p.dataEspecifica.slice(0, 10) < hojeISO()) return;
        out.push({ id: p.id, nome: item.nome, preco: item.preco, promo: p.precoPromocional, quando, hoje: valeHoje?.id === p.id, ativo: p.ativo });
      });
    });
    return out.filter((p) => p.ativo).sort((a, b) => Number(b.hoje) - Number(a.hoje) || a.nome.localeCompare(b.nome, 'pt-BR'));
  }, [itens]);
  const valendoHoje = promosCardapio.filter((p) => p.hoje).length;

  async function toggleActive(rule: PromotionRule) {
    setTogglingId(rule.id);
    try {
      const { error } = await invokeWithAuth('order-write', {
        body: {
          action: 'update_promotion_rule',
          promotion_id: rule.id,
          active_tenant_id: user?.tenantId,
          is_active: !rule.is_active,
        },
      });
      if (error) { setErro(error.message); return; }
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
    if (!(await confirmar({ titulo: `Excluir a promoção "${rule.name}"?`, confirmarLabel: 'Excluir', perigo: true }))) return;
    const { error } = await invokeWithAuth('order-write', {
      body: { action: 'delete_promotion_rule', promotion_id: rule.id, active_tenant_id: user?.tenantId },
    });
    if (error) { setErro(error.message); return; }
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

  const abrirModal = (rule: PromotionRule | null, comoCopia = false) => {
    setEditRule(rule);
    setDuplicar(comoCopia);
    setModalOpen(true);
  };

  const filtered = rules.filter((r) => {
    const matchActive = filterActive === 'all' || (filterActive === 'active' ? r.is_active : !r.is_active);
    const matchSearch = !search || r.name.toLowerCase().includes(search.toLowerCase()) || (r.coupon_code ?? '').toLowerCase().includes(search.toLowerCase());
    return matchActive && matchSearch;
  });

  const activeCount = rules.filter((r) => r.is_active).length;

  return (
    <div className="p-4 md:p-6 space-y-6">
      {erro && <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700">{erro}</div>}

      {/* ── Preço promocional do cardápio ── */}
      <section className="space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-2">
          <div>
            <h2 className="text-sm font-bold text-zinc-900 flex items-center gap-2">
              <i className="ri-restaurant-line text-rose-500" /> Preço promocional do cardápio
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-green-50 text-green-700">vale no caixa, garçom, QR e delivery</span>
            </h2>
            <p className="text-xs text-zinc-400 mt-0.5">
              {cardapioLoading ? 'Carregando o cardápio…' : `${valendoHoje} valendo hoje · ${promosCardapio.length} cadastrada${promosCardapio.length !== 1 ? 's' : ''}`}
            </p>
          </div>
          {podeCardapio && (
            <button
              onClick={() => navigate('/cardapio')}
              className="self-start sm:self-auto flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold cursor-pointer border border-zinc-200 bg-white hover:bg-zinc-50 text-zinc-600 whitespace-nowrap"
            >
              <i className="ri-edit-line" /> Editar no Cardápio
            </button>
          )}
        </div>

        {!cardapioLoading && promosCardapio.length === 0 ? (
          <div className="bg-white border border-dashed border-zinc-200 rounded-xl px-4 py-6 text-center">
            <p className="text-xs text-zinc-500">Nenhum item com preço promocional.</p>
            <p className="text-[11px] text-zinc-400 mt-0.5">No Cardápio, abra o item e cadastre a promoção (por dia da semana ou numa data).</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
            {promosCardapio.map((p) => {
              const desconto = p.preco > 0 ? Math.round((1 - p.promo / p.preco) * 100) : 0;
              return (
                <div key={p.id} className={`bg-white border rounded-xl px-3 py-2.5 flex items-center gap-3 ${p.hoje ? 'border-green-200' : 'border-zinc-100'}`}>
                  <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 text-xs font-black ${p.hoje ? 'bg-green-50 text-green-700' : 'bg-zinc-50 text-zinc-400'}`}>
                    {desconto > 0 ? `-${desconto}%` : <i className="ri-price-tag-3-line" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-zinc-800 truncate">{p.nome}</p>
                    <p className="text-[11px] text-zinc-400 truncate">{p.quando}</p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-sm font-bold text-zinc-800">{fmtMoeda(p.promo)}</p>
                    <p className="text-[10px] text-zinc-400 line-through">{fmtMoeda(p.preco)}</p>
                  </div>
                  {p.hoje && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-green-500 text-white flex-shrink-0">hoje</span>}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ── Regras de desconto ── */}
      <section className="space-y-3">
        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold text-zinc-900 flex items-center gap-2">
              <i className="ri-price-tag-3-line text-rose-500" /> Regras de desconto e cupons
            </h2>
            <p className="text-xs text-zinc-400 mt-0.5">{activeCount} ligada{activeCount !== 1 ? 's' : ''} de {rules.length} regra{rules.length !== 1 ? 's' : ''}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[160px] sm:flex-none">
              <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 text-sm" />
              <input
                type="text"
                placeholder="Nome ou cupom..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 pr-3 py-2 text-sm border border-zinc-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-rose-400 w-full sm:w-48"
              />
            </div>
            <div className="flex items-center gap-1 bg-zinc-100 rounded-lg p-1">
              {(['all', 'active', 'inactive'] as const).map((f) => {
                const labels = { all: 'Todas', active: 'Ligadas', inactive: 'Desligadas' };
                return (
                  <button
                    key={f}
                    onClick={() => setFilterActive(f)}
                    className={`px-3 py-1.5 rounded-md text-xs font-semibold cursor-pointer whitespace-nowrap transition-colors ${filterActive === f ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500 hover:text-zinc-700'}`}
                  >
                    {labels[f]}
                  </button>
                );
              })}
            </div>
            <button
              onClick={() => abrirModal(null)}
              className="flex items-center gap-1.5 px-3 py-2 bg-rose-500 hover:bg-rose-600 text-white text-sm font-semibold rounded-lg cursor-pointer transition-colors whitespace-nowrap"
            >
              <i className="ri-add-line" /> Nova regra
            </button>
          </div>
        </div>

        <div className="flex items-start gap-2 px-3 py-2.5 bg-amber-50 border border-amber-200 rounded-xl">
          <i className="ri-error-warning-line text-amber-600 text-sm mt-0.5" />
          <p className="text-[11px] text-amber-800">
            <strong>Atenção:</strong> estas regras ficam cadastradas, mas o caixa e o delivery <strong>ainda não aplicam</strong> o
            desconto sozinhos (nem pelo cupom). Para baixar o preço de um item, use o preço promocional do Cardápio acima;
            para um desconto para um cliente, emita um voucher na aba Vouchers.
          </p>
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-32">
            <div className="w-6 h-6 border-2 border-rose-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="bg-white border border-dashed border-zinc-200 rounded-xl px-4 py-8 text-center">
            <i className="ri-price-tag-3-line text-3xl text-zinc-200" />
            <p className="text-xs text-zinc-500 mt-1">{rules.length === 0 ? 'Nenhuma regra cadastrada.' : 'Nenhuma regra com esse filtro.'}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
            {filtered.map((rule) => {
              const sit = situacaoDaRegra(rule);
              return (
                <div
                  key={rule.id}
                  className={`bg-white rounded-xl border p-4 transition-all ${rule.is_active ? 'border-zinc-200' : 'border-zinc-100 opacity-70'}`}
                >
                  <div className="flex items-start gap-3">
                    <button
                      onClick={() => toggleActive(rule)}
                      disabled={togglingId === rule.id}
                      title={rule.is_active ? 'Desligar' : 'Ligar'}
                      className={`relative flex-shrink-0 w-10 h-6 rounded-full transition-colors cursor-pointer mt-0.5 ${rule.is_active ? 'bg-rose-500' : 'bg-zinc-200'} disabled:opacity-50`}
                    >
                      <span className={`absolute left-0 top-1 w-4 h-4 bg-white rounded-full transition-transform ${rule.is_active ? 'translate-x-5' : 'translate-x-1'}`} />
                    </button>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <p className="font-bold text-zinc-800 text-sm">{rule.name}</p>
                        <span className={`px-2 py-0.5 text-[10px] font-semibold rounded-full ${sit.cls}`}>{sit.label}</span>
                      </div>
                      {rule.description && <p className="text-xs text-zinc-500 mt-0.5">{rule.description}</p>}

                      <div className="flex items-center gap-1.5 flex-wrap mt-2">
                        <span className="px-2 py-0.5 bg-rose-50 text-rose-600 text-xs font-bold rounded-md">{formatDiscount(rule)}</span>
                        <span className="px-2 py-0.5 bg-zinc-100 text-zinc-600 text-[11px] font-semibold rounded-md">{PROMO_TYPE_LABELS[rule.promo_type]}</span>
                        {rule.coupon_code && (
                          <span className="px-2 py-0.5 bg-zinc-900 text-white text-[11px] font-mono rounded-md">{rule.coupon_code}</span>
                        )}
                      </div>

                      <div className="flex items-center gap-x-3 gap-y-1 text-[11px] text-zinc-500 flex-wrap mt-2">
                        <span className="flex items-center gap-1"><i className="ri-calendar-line" />{formatSchedule(rule)}</span>
                        {rule.min_order_amount != null && (
                          <span className="flex items-center gap-1"><i className="ri-shopping-cart-line" />Mín. {fmtMoeda(rule.min_order_amount)}</span>
                        )}
                        {rule.max_uses_total != null && (
                          <span className="flex items-center gap-1"><i className="ri-bar-chart-line" />{rule.current_uses}/{rule.max_uses_total} usos</span>
                        )}
                        {!rule.is_stackable && <span className="flex items-center gap-1"><i className="ri-stack-line" />Não acumula</span>}
                      </div>

                      <div className="flex items-center gap-1 mt-2 flex-wrap">
                        {Object.entries(rule.channels ?? {}).filter(([, on]) => on).map(([ch]) => (
                          <span key={ch} className="px-1.5 py-0.5 bg-zinc-50 border border-zinc-100 text-zinc-500 text-[10px] font-semibold rounded">
                            {CH_LABELS[ch] ?? ch}
                          </span>
                        ))}
                      </div>
                    </div>

                    <div className="flex flex-col sm:flex-row items-center gap-0.5 flex-shrink-0">
                      <button
                        onClick={() => abrirModal(rule)}
                        className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-zinc-100 text-zinc-400 hover:text-zinc-700 cursor-pointer transition-colors"
                        title="Editar"
                      >
                        <i className="ri-edit-line text-sm" />
                      </button>
                      <button
                        onClick={() => abrirModal(rule, true)}
                        className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-zinc-100 text-zinc-400 hover:text-zinc-700 cursor-pointer transition-colors"
                        title="Duplicar"
                      >
                        <i className="ri-file-copy-line text-sm" />
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
              );
            })}
          </div>
        )}
      </section>

      {modalOpen && (
        <PromocaoModal
          rule={editRule}
          duplicar={duplicar}
          onClose={() => setModalOpen(false)}
          onSaved={() => { setModalOpen(false); loadRules(); }}
        />
      )}
    </div>
  );
}
