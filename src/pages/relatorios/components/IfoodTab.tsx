import { useEffect, useMemo, useState } from 'react';
import {
  ComposedChart, Bar, Line, BarChart, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, Legend,
} from 'recharts';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { getPeriodDates, getPeriodoAnterior, labelPeriodoAnterior } from '@/lib/dateUtils';
import { useSalesReport } from '@/hooks/useSalesReport';
import {
  fetchPedidosIfood, fetchOperacaoIfood, fetchCardapioIfood, resumir, mediana, motivoCurto, culpaCancelamento,
  type PedidoIfood, type OperacaoPedido, type MenuLinha, type Logistica,
} from '@/lib/ifoodDashboard';

// Relatórios › iFood (2026-09-25). Tudo sai do que já foi importado em Financeiro › iFood
// (conciliação por pedido; API de Vendas p/ tempos; relatório de Cardápio p/ produtos).

interface Props { periodo: string }

const IFOOD = '#ea1d2c';
const brl = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);
const brl0 = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(v);
const pct = (v: number, casas = 1) => `${v.toFixed(casas).replace('.', ',')}%`;
const min = (v: number | null) => (v == null ? '—' : `${Math.round(v)} min`);
const SEMANA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const SEMANA_LONGA = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
const LOGISTICA: Record<Logistica, { label: string; cor: string; dica: string }> = {
  ifood: { label: 'Entregador iFood', cor: IFOOD, dica: 'comissão maior, sem motoboy próprio' },
  propria: { label: 'Entrega própria', cor: '#f59e0b', dica: 'motoboy da loja (custo fora do iFood)' },
  sob_demanda: { label: 'Sob demanda', cor: '#8b5cf6', dica: 'loja chamou entregador iFood avulso' },
};

type Dados = { pedidos: PedidoIfood[]; error: string | null };

function variacao(atual: number, ant: number): number | null {
  return ant > 0 ? ((atual - ant) / ant) * 100 : null;
}

function Delta({ v, inverso, pp }: { v: number | null; inverso?: boolean; pp?: boolean }) {
  if (v == null || !Number.isFinite(v)) return null;
  const bom = inverso ? v <= 0 : v >= 0;
  return (
    <span className={`inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full ${bom ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600'}`}>
      <i className={v >= 0 ? 'ri-arrow-up-line' : 'ri-arrow-down-line'} />
      {pp ? `${Math.abs(v).toFixed(1).replace('.', ',')} p.p.` : pct(Math.abs(v))}
    </span>
  );
}

function Kpi({ label, value, sub, icon, cor, delta }: { label: string; value: string; sub?: string; icon: string; cor: string; delta?: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl border border-zinc-100 p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="w-8 h-8 flex items-center justify-center rounded-lg" style={{ background: cor + '14', color: cor }}>
          <i className={icon + ' text-sm'} />
        </div>
        {delta}
      </div>
      <p className="text-xl md:text-2xl font-black text-zinc-800 leading-tight tracking-tight">{value}</p>
      <p className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wide mt-0.5">{label}</p>
      {sub ? <p className="text-xs text-zinc-400 mt-0.5">{sub}</p> : null}
    </div>
  );
}

function Card({ titulo, sub, children, className = '' }: { titulo: string; sub?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-white rounded-2xl border border-zinc-100 p-4 md:p-5 min-w-0 ${className}`}>
      <div className="mb-3">
        <h3 className="text-sm font-bold text-zinc-800">{titulo}</h3>
        {sub ? <p className="text-xs text-zinc-400 mt-0.5">{sub}</p> : null}
      </div>
      {children}
    </div>
  );
}

function Insight({ icon, cor, titulo, texto }: { icon: string; cor: string; titulo: string; texto: string }) {
  return (
    <div className="flex gap-3 p-3 rounded-xl bg-white/70 border border-white">
      <div className="w-8 h-8 flex-shrink-0 flex items-center justify-center rounded-lg" style={{ background: cor + '1a', color: cor }}>
        <i className={icon} />
      </div>
      <div className="min-w-0">
        <p className="text-xs font-bold text-zinc-800">{titulo}</p>
        <p className="text-xs text-zinc-600 mt-0.5 leading-relaxed">{texto}</p>
      </div>
    </div>
  );
}

export default function IfoodTab({ periodo }: Props) {
  const { user } = useAuth();
  const tenantId = user?.tenantId;
  const [loja, setLoja] = useState<string>('');
  const [lojas, setLojas] = useState<{ merchant_id: string; merchant_short: string | null; name: string | null }[]>([]);
  const [atual, setAtual] = useState<Dados | null>(null);
  const [anterior, setAnterior] = useState<Dados | null>(null);
  const [operacao, setOperacao] = useState<OperacaoPedido[]>([]);
  const [cardapio, setCardapio] = useState<{ linhas: MenuLinha[]; doPeriodo: boolean }>({ linhas: [], doPeriodo: true });
  const [ultimaData, setUltimaData] = useState<string | null>(null);

  const { from, to } = getPeriodDates(periodo);
  const periodoAnt = getPeriodoAnterior(periodo);
  const { data: erp } = useSalesReport(periodo);

  useEffect(() => {
    if (!tenantId) return;
    let vivo = true;
    setAtual(null);
    const ant = getPeriodDates(periodoAnt);
    fetchPedidosIfood(tenantId, from, to).then((d) => { if (vivo) setAtual(d); });
    fetchPedidosIfood(tenantId, ant.from, ant.to).then((d) => { if (vivo) setAnterior(d); });
    fetchOperacaoIfood(tenantId, from, to).then((d) => { if (vivo) setOperacao(d); });
    fetchCardapioIfood(tenantId, from.slice(0, 10), to.slice(0, 10)).then((d) => { if (vivo) setCardapio(d); });
    return () => { vivo = false; };
  }, [tenantId, from, to, periodoAnt]);

  useEffect(() => {
    if (!tenantId) return;
    supabase.from('fin_ifood_merchants').select('merchant_id, merchant_short, name').eq('tenant_id', tenantId)
      .then(({ data }) => setLojas((data ?? []) as typeof lojas));
    supabase.from('fin_ifood_entries').select('order_created_at').eq('tenant_id', tenantId)
      .not('order_created_at', 'is', null).order('order_created_at', { ascending: false }).limit(1)
      .then(({ data }) => setUltimaData((data?.[0] as { order_created_at?: string } | undefined)?.order_created_at ?? null));
  }, [tenantId]);

  const nomeLoja = (id: string) => lojas.find((l) => l.merchant_id === id)?.name ?? lojas.find((l) => l.merchant_id === id)?.merchant_short ?? 'Loja iFood';
  const shortDaLoja = lojas.find((l) => l.merchant_id === loja)?.merchant_short ?? null;

  const pedidos = useMemo(() => (atual?.pedidos ?? []).filter((p) => !loja || p.loja === loja), [atual, loja]);
  const pedidosAnt = useMemo(() => (anterior?.pedidos ?? []).filter((p) => !loja || p.loja === loja), [anterior, loja]);
  const validos = useMemo(() => pedidos.filter((p) => !p.cancelado), [pedidos]);
  const r = useMemo(() => resumir(pedidos), [pedidos]);
  const ra = useMemo(() => resumir(pedidosAnt), [pedidosAnt]);
  const lojasNoPeriodo = useMemo(() => [...new Set((atual?.pedidos ?? []).map((p) => p.loja))], [atual]);

  // ── Série diária ───────────────────────────────────────────────────────────
  const diario = useMemo(() => {
    const m = new Map<string, { dia: string; vendas: number; liquido: number; pedidos: number }>();
    const ini = new Date(from.slice(0, 10) + 'T12:00:00Z');
    const fim = new Date(to.slice(0, 10) + 'T12:00:00Z');
    for (let d = new Date(ini); d <= fim && m.size < 400; d.setUTCDate(d.getUTCDate() + 1)) {
      const k = d.toISOString().slice(0, 10);
      m.set(k, { dia: k, vendas: 0, liquido: 0, pedidos: 0 });
    }
    for (const p of validos) {
      const x = m.get(p.dia) ?? { dia: p.dia, vendas: 0, liquido: 0, pedidos: 0 };
      x.vendas += p.vendas; x.liquido += p.liquido; x.pedidos += 1;
      m.set(p.dia, x);
    }
    return [...m.values()].sort((a, b) => a.dia.localeCompare(b.dia)).map((x) => ({
      ...x, label: `${x.dia.slice(8, 10)}/${x.dia.slice(5, 7)}`, vendas: Math.round(x.vendas * 100) / 100, liquido: Math.round(x.liquido * 100) / 100,
    }));
  }, [validos, from, to]);

  // ── Heatmap dia da semana × hora ───────────────────────────────────────────
  const heat = useMemo(() => {
    const g: { n: number; v: number }[][] = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => ({ n: 0, v: 0 })));
    for (const p of validos) { g[p.semana][p.hora].n += 1; g[p.semana][p.hora].v += p.vendas; }
    let horas = [...Array(24).keys()].filter((h) => g.some((l) => l[h].n > 0));
    if (horas.length) { const a = Math.min(...horas), b = Math.max(...horas); horas = [...Array(b - a + 1).keys()].map((i) => a + i); }
    const max = Math.max(1, ...g.flat().map((c) => c.n));
    let top = { s: 0, h: 0, n: 0, v: 0 };
    g.forEach((l, s) => l.forEach((c, h) => { if (c.n > top.n) top = { s, h, n: c.n, v: c.v }; }));
    const porSemana = g.map((l, s) => ({ s, n: l.reduce((a, c) => a + c.n, 0), v: l.reduce((a, c) => a + c.v, 0) }));
    return { g, horas, max, top, porSemana };
  }, [validos]);

  // ── Logística × custo ──────────────────────────────────────────────────────
  const porLogistica = useMemo(() => (Object.keys(LOGISTICA) as Logistica[]).map((k) => {
    const ps = validos.filter((p) => p.logistica === k);
    const vendas = ps.reduce((a, p) => a + p.vendas, 0);
    const custo = ps.reduce((a, p) => a + (p.vendas - p.liquido), 0);
    return { k, ...LOGISTICA[k], pedidos: ps.length, vendas, ticket: ps.length ? vendas / ps.length : 0, custoPct: vendas > 0 ? (custo / vendas) * 100 : 0, comissaoPct: vendas > 0 ? (ps.reduce((a, p) => a + p.comissao, 0) / vendas) * 100 : 0 };
  }).filter((x) => x.pedidos > 0), [validos]);

  // ── Formas de pagamento ────────────────────────────────────────────────────
  const porPagamento = useMemo(() => {
    const m = new Map<string, { nome: string; pedidos: number; vendas: number; transacao: number }>();
    for (const p of validos) {
      const x = m.get(p.pagamento) ?? { nome: p.pagamento, pedidos: 0, vendas: 0, transacao: 0 };
      x.pedidos += 1; x.vendas += p.vendas; x.transacao += p.transacao;
      m.set(p.pagamento, x);
    }
    return [...m.values()].map((x) => ({ ...x, taxaPct: x.vendas > 0 ? (x.transacao / x.vendas) * 100 : 0, share: r.vendas > 0 ? (x.vendas / r.vendas) * 100 : 0 }))
      .sort((a, b) => b.vendas - a.vendas);
  }, [validos, r.vendas]);

  // ── Promoções ──────────────────────────────────────────────────────────────
  const promo = useMemo(() => {
    const com = validos.filter((p) => p.promoLoja > 0.005 || p.promoIfood > 0.005);
    const sem = validos.filter((p) => !(p.promoLoja > 0.005 || p.promoIfood > 0.005));
    const comLoja = validos.filter((p) => p.promoLoja > 0.005);
    const t = (ps: PedidoIfood[]) => (ps.length ? ps.reduce((a, p) => a + p.vendas, 0) / ps.length : 0);
    return {
      com: com.length, sem: sem.length, ticketCom: t(com), ticketSem: t(sem),
      pctPedidos: validos.length ? (com.length / validos.length) * 100 : 0,
      vendasComLoja: comLoja.reduce((a, p) => a + p.vendas, 0), pedidosComLoja: comLoja.length,
    };
  }, [validos]);

  // ── Faixas de ticket ───────────────────────────────────────────────────────
  const faixas = useMemo(() => {
    const lim = [0, 30, 50, 70, 100, 150, Infinity];
    return lim.slice(0, -1).map((a, i) => {
      const b = lim[i + 1];
      const ps = validos.filter((p) => p.vendas >= a && p.vendas < b);
      return { faixa: b === Infinity ? `${a}+` : `${a}–${b}`, pedidos: ps.length, vendas: Math.round(ps.reduce((s, p) => s + p.vendas, 0)) };
    });
  }, [validos]);

  // ── Cancelamentos ──────────────────────────────────────────────────────────
  const cancel = useMemo(() => {
    const cs = pedidos.filter((p) => p.cancelado);
    const motivos = new Map<string, { motivo: string; n: number; valor: number; culpa: ReturnType<typeof culpaCancelamento> }>();
    const culpa = { loja: { n: 0, valor: 0 }, cliente: { n: 0, valor: 0 }, ifood: { n: 0, valor: 0 } };
    for (const p of cs) {
      const mt = p.motivo ? motivoCurto(p.motivo) : 'Sem motivo informado';
      const c = p.motivo ? culpaCancelamento(p.motivo) : 'ifood';
      const x = motivos.get(mt) ?? { motivo: mt, n: 0, valor: 0, culpa: c };
      x.n += 1; x.valor += p.bruto; motivos.set(mt, x);
      culpa[c].n += 1; culpa[c].valor += p.bruto;
    }
    const total = pedidos.length;
    return { n: cs.length, taxa: total ? (cs.length / total) * 100 : 0, motivos: [...motivos.values()].sort((a, b) => b.n - a.n), culpa, parciais: pedidos.filter((p) => p.parcial && !p.cancelado).length };
  }, [pedidos]);

  // ── Operação (API de Vendas) ───────────────────────────────────────────────
  const op = useMemo(() => {
    const os = operacao.filter((o) => (!loja || o.loja === loja) && !o.cancelado);
    const pronto = os.filter((o) => o.preparoMin != null);
    return {
      n: os.length,
      aceite: mediana(os.map((o) => o.aceiteMin)),
      preparo: mediana(os.map((o) => o.preparoMin)),
      rota: mediana(os.map((o) => o.rotaMin)),
      total: mediana(os.map((o) => o.totalMin)),
      pedidoEsperando: mediana(os.map((o) => o.esperaEntregadorMin)),
      entregadorEsperando: os.filter((o) => (o.entregadorEsperouMin ?? 0) > 5).length,
      preparoLongo: pronto.filter((o) => (o.preparoMin ?? 0) > 30).length,
      distPreparo: [[0, 10], [10, 15], [15, 20], [20, 30], [30, 45], [45, Infinity]].map(([a, b]) => ({
        faixa: b === Infinity ? `${a}+ min` : `${a}–${b}`, pedidos: pronto.filter((o) => o.preparoMin! >= a && o.preparoMin! < b).length,
      })),
    };
  }, [operacao, loja]);

  // ── Cardápio ───────────────────────────────────────────────────────────────
  const menu = useMemo(() => {
    const ls = cardapio.linhas.filter((l) => l.kind === 'item' && (!shortDaLoja || l.merchant_short === shortDaLoja));
    const m = new Map<string, { nome: string; visitas: number; pedidos: number; qtd: number; qtdPromo: number; valor: number }>();
    for (const l of ls) {
      const x = m.get(l.name) ?? { nome: l.name, visitas: 0, pedidos: 0, qtd: 0, qtdPromo: 0, valor: 0 };
      x.visitas += l.visits ?? 0; x.pedidos += l.orders ?? 0; x.qtd += Number(l.quantity ?? 0); x.qtdPromo += Number(l.promo_quantity ?? 0); x.valor += Number(l.total_value ?? 0);
      m.set(l.name, x);
    }
    const itens = [...m.values()].map((x) => ({ ...x, conv: x.visitas > 0 ? (x.pedidos / x.visitas) * 100 : 0 }));
    const totalValor = itens.reduce((a, x) => a + x.valor, 0);
    const top = [...itens].sort((a, b) => b.valor - a.valor).slice(0, 10);
    const convMedia = itens.reduce((a, x) => a + x.visitas, 0) > 0 ? (itens.reduce((a, x) => a + x.pedidos, 0) / itens.reduce((a, x) => a + x.visitas, 0)) * 100 : 0;
    const vitrine = itens.filter((x) => x.visitas >= 20 && x.conv < convMedia * 0.6).sort((a, b) => b.visitas - a.visitas).slice(0, 5);
    const periodos = [...new Set(ls.map((l) => `${l.period_start}|${l.period_end}`))].sort();
    return { top, totalValor, convMedia, vitrine, periodos, n: itens.length };
  }, [cardapio, shortDaLoja]);

  // ── Por loja ───────────────────────────────────────────────────────────────
  const porLoja = useMemo(() => lojasNoPeriodo.map((id) => {
    const ps = (atual?.pedidos ?? []).filter((p) => p.loja === id);
    return { id, nome: nomeLoja(id), ...resumir(ps) };
  }).sort((a, b) => b.vendas - a.vendas), [atual, lojasNoPeriodo, lojas]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Participação no faturamento total ──────────────────────────────────────
  const erpTotal = erp?.total_revenue ?? 0;
  // Sem venda no PDV no período (loja que não usa o caixa, ou mês sem movimento) o "peso" daria 100%: mostra cancelados.
  const share = !loja && erpTotal > 0 ? (r.vendas / (r.vendas + erpTotal)) * 100 : null;

  // ── Cascata "de cada R$ 100" ───────────────────────────────────────────────
  const cascata = useMemo(() => {
    if (r.vendas <= 0) return [];
    const k = 100 / r.vendas;
    const itens = [
      { nome: 'Comissão', v: r.comissao, cor: IFOOD },
      { nome: 'Taxa de transação', v: r.transacao, cor: '#f97316' },
      { nome: 'Promoção paga pela loja', v: r.promoLoja, cor: '#f59e0b' },
      { nome: 'Entrega sob demanda', v: r.entregaSobDemanda, cor: '#8b5cf6' },
      { nome: 'Outros serviços', v: r.outrosServicos, cor: '#94a3b8' },
      { nome: 'Ajustes / ressarcimentos', v: -r.ajustes, cor: '#06b6d4' },
    ].filter((x) => Math.abs(x.v) >= 0.01);
    return [...itens.map((x) => ({ ...x, por100: x.v * k })), { nome: 'Fica para a loja', v: r.liquido, por100: r.liquido * k, cor: '#10b981' }];
  }, [r]);

  // ── Insights automáticos ───────────────────────────────────────────────────
  const insights = useMemo(() => {
    const out: { icon: string; cor: string; titulo: string; texto: string }[] = [];
    if (heat.top.n > 0) {
      const melhorDia = [...heat.porSemana].sort((a, b) => b.v - a.v)[0];
      out.push({ icon: 'ri-fire-line', cor: IFOOD, titulo: 'Horário de pico', texto: `${SEMANA_LONGA[heat.top.s]} às ${heat.top.h}h é a janela mais forte (${heat.top.n} pedidos). No total, ${SEMANA_LONGA[melhorDia.s]} é o dia que mais vende (${brl0(melhorDia.v)}). Garanta equipe e insumo nessa janela.` });
    }
    if (r.vendas > 0) {
      const d = ra.vendas > 0 ? r.custoPct - ra.custoPct : null;
      out.push({ icon: 'ri-percent-line', cor: '#f97316', titulo: 'Quanto o iFood leva', texto: `De cada R$ 100 vendidos, R$ ${(100 - (r.liquido / r.vendas) * 100).toFixed(0)} ficam no caminho (comissão, taxas, promoções da loja e entregas).${d != null && Math.abs(d) >= 0.5 ? ` Isso ${d > 0 ? 'subiu' : 'caiu'} ${Math.abs(d).toFixed(1).replace('.', ',')} p.p. em relação ao período anterior.` : ''}` });
    }
    if (porLogistica.length > 1) {
      const [a, b] = [...porLogistica].sort((x, y) => x.custoPct - y.custoPct);
      out.push({ icon: 'ri-e-bike-2-line', cor: '#8b5cf6', titulo: 'Logística mais barata', texto: `${a.label} custa ${pct(a.custoPct)} das vendas contra ${pct(b.custoPct)} de ${b.label.toLowerCase()} (${pct(b.custoPct - a.custoPct)} de diferença). Na entrega própria, some o custo do motoboy antes de decidir.` });
    }
    if (r.promoLoja > 0 && promo.pedidosComLoja > 0) {
      out.push({ icon: 'ri-coupon-3-line', cor: '#f59e0b', titulo: 'Promoções da loja', texto: `A loja bancou ${brl(r.promoLoja)} em promoções (${pct((r.promoLoja / r.vendas) * 100)} das vendas) em ${promo.pedidosComLoja} pedidos. O iFood colocou ${brl(r.promoIfood)} do bolso dele. Pedidos com promoção têm ticket de ${brl(promo.ticketCom)} contra ${brl(promo.ticketSem)} sem.` });
    }
    if (cancel.culpa.loja.n > 0) {
      const top = cancel.motivos.find((m) => m.culpa === 'loja');
      out.push({ icon: 'ri-error-warning-line', cor: '#ef4444', titulo: 'Vendas perdidas por falha da loja', texto: `${cancel.culpa.loja.n} pedido(s) cancelados por motivo da loja, ${brl(cancel.culpa.loja.valor)} que não entraram.${top ? ` Principal: "${top.motivo}" (${top.n}).` : ''} Cancelamento da loja também derruba a loja no ranking do app.` });
    }
    if (porPagamento.length > 1) {
      const caro = [...porPagamento].filter((p) => p.pedidos >= 5).sort((a, b) => b.taxaPct - a.taxaPct)[0];
      if (caro && caro.taxaPct > 0) out.push({ icon: 'ri-bank-card-line', cor: '#06b6d4', titulo: 'Pagamento mais caro', texto: `${caro.nome} paga ${pct(caro.taxaPct, 2)} de taxa de transação e responde por ${pct(caro.share)} das vendas.` });
    }
    if (op.n >= 5 && op.preparo != null) {
      out.push({ icon: 'ri-timer-flash-line', cor: '#10b981', titulo: 'Tempo de cozinha', texto: `Preparo mediano de ${min(op.preparo)} (confirmar → pronto) e entrega completa em ${min(op.total)}.${op.entregadorEsperando > 0 ? ` Em ${op.entregadorEsperando} pedido(s) o entregador esperou mais de 5 min pelo pedido.` : ''}${op.preparoLongo > 0 ? ` ${op.preparoLongo} passaram de 30 min de preparo.` : ''}` });
    }
    if (menu.vitrine.length) {
      const v = menu.vitrine[0];
      out.push({ icon: 'ri-eye-line', cor: '#ec4899', titulo: 'Muita visita, pouca venda', texto: `"${v.nome}" teve ${v.visitas} visitas e converteu ${pct(v.conv)} (média do cardápio ${pct(menu.convMedia)}). Vale revisar foto, descrição ou preço.` });
    }
    return out;
  }, [heat, r, ra, porLogistica, promo, cancel, porPagamento, op, menu]);

  // ── Render ─────────────────────────────────────────────────────────────────
  if (!atual) {
    return (
      <div className="flex items-center justify-center py-20 text-zinc-400">
        <div className="w-5 h-5 border-2 border-t-transparent rounded-full animate-spin mr-3" style={{ borderColor: IFOOD, borderTopColor: 'transparent' }} />
        <span className="text-sm">Carregando iFood...</span>
      </div>
    );
  }

  const diasPeriodo = Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86_400_000) + 1;
  const ultimaFmt = ultimaData ? new Date(ultimaData).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : null;

  const filtroLoja = lojas.length > 1 && (
    <select value={loja} onChange={(e) => setLoja(e.target.value)}
      className="text-xs border border-zinc-200 rounded-lg px-2.5 py-1.5 bg-white text-zinc-700 cursor-pointer max-w-full">
      <option value="">Todas as lojas iFood</option>
      {lojas.map((l) => <option key={l.merchant_id} value={l.merchant_id}>{l.name ?? l.merchant_short}</option>)}
    </select>
  );

  if (atual.error || pedidos.length === 0) {
    return (
      <div className="space-y-4">
        {filtroLoja && <div className="flex justify-end">{filtroLoja}</div>}
        <div className="flex flex-col items-center justify-center py-20 text-zinc-400 text-center px-4">
          <div className="w-16 h-16 flex items-center justify-center rounded-2xl mb-4" style={{ background: IFOOD + '12' }}>
            <i className="ri-restaurant-2-line text-3xl" style={{ color: IFOOD }} />
          </div>
          <p className="text-sm font-semibold text-zinc-500">{atual.error ? `Erro ao carregar: ${atual.error}` : 'Nenhum pedido do iFood no período'}</p>
          <p className="text-xs text-zinc-400 mt-1 max-w-md">
            Os dados vêm do relatório de conciliação do iFood (Financeiro › iFood).
            {ultimaFmt ? ` Último pedido importado: ${ultimaFmt}.` : ' Nenhum relatório importado ainda.'}
            {diasPeriodo <= 1 ? ' Experimente o filtro de 30 dias.' : ''}
          </p>
        </div>
      </div>
    );
  }

  const alturaHeat = heat.horas.length;
  const labelAnt = labelPeriodoAnterior(periodo);

  return (
    <div className="space-y-5">
      {/* Cabeçalho da aba */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="w-7 h-7 flex items-center justify-center rounded-lg text-white text-xs font-black flex-shrink-0" style={{ background: IFOOD }}>iF</span>
          <p className="text-xs text-zinc-500 min-w-0">
            Pedidos pela data do pedido, divisão igual ao Portal do Parceiro.
            {ultimaFmt ? <> Dados até <b>{ultimaFmt}</b>.</> : null} Mensalidade fica de fora (não é de pedido).
          </p>
        </div>
        {filtroLoja}
      </div>

      {/* Insights */}
      {insights.length > 0 && (
        <div className="rounded-2xl p-4 md:p-5" style={{ background: 'linear-gradient(135deg, #fff1f2 0%, #fff7ed 100%)', border: '1px solid #fecdd3' }}>
          <div className="flex items-center gap-2 mb-3">
            <i className="ri-lightbulb-flash-line" style={{ color: IFOOD }} />
            <h3 className="text-sm font-bold text-zinc-800">O que os números dizem</h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2.5">
            {insights.map((i) => <Insight key={i.titulo} {...i} />)}
          </div>
        </div>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
        <Kpi label="Vendas iFood" value={brl(r.vendas)} sub={`vs ${labelAnt}: ${brl0(ra.vendas)}`} icon="ri-money-dollar-circle-line" cor={IFOOD} delta={<Delta v={variacao(r.vendas, ra.vendas)} />} />
        <Kpi label="Pedidos" value={String(r.pedidos)} sub={`${(r.pedidos / Math.max(1, diasPeriodo)).toFixed(1).replace('.', ',')} por dia`} icon="ri-shopping-bag-3-line" cor="#f97316" delta={<Delta v={variacao(r.pedidos, ra.pedidos)} />} />
        <Kpi label="Ticket médio" value={brl(r.ticket)} sub={`antes ${brl(ra.ticket)}`} icon="ri-receipt-line" cor="#f59e0b" delta={<Delta v={variacao(r.ticket, ra.ticket)} />} />
        <Kpi label="Líquido p/ loja" value={brl(r.liquido)} sub={`${pct(r.vendas > 0 ? (r.liquido / r.vendas) * 100 : 0)} das vendas`} icon="ri-wallet-3-line" cor="#10b981" delta={<Delta v={variacao(r.liquido, ra.liquido)} />} />
        <Kpi label="Custo do iFood" value={pct(r.custoPct)} sub={`${brl0(r.vendas - r.liquido)} no período`} icon="ri-scissors-cut-line" cor="#8b5cf6" delta={ra.vendas > 0 ? <Delta v={r.custoPct - ra.custoPct} inverso pp /> : null} />
        {share != null
          ? <Kpi label="Peso no faturamento" value={pct(share)} sub={`iFood + ${brl0(erpTotal)} do PDV`} icon="ri-pie-chart-2-line" cor="#06b6d4" />
          : <Kpi label="Cancelados" value={String(cancel.n)} sub={`${pct(cancel.taxa)} dos pedidos`} icon="ri-close-circle-line" cor="#ef4444" />}
      </div>

      {/* Dia a dia + cascata */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card titulo="Vendas e líquido por dia" sub="Barras = vendas · linha = o que sobra para a loja" className="xl:col-span-2">
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={diario} margin={{ top: 5, right: 5, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#a1a1aa' }} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={12} />
                <YAxis tick={{ fontSize: 10, fill: '#a1a1aa' }} axisLine={false} tickLine={false} tickFormatter={(v) => `${Math.round(v)}`} />
                <Tooltip formatter={(v: number, n: string) => [brl(v), n]} labelFormatter={(l, p) => { const d = p?.[0]?.payload; return d ? `${l} · ${d.pedidos} pedidos` : l; }} contentStyle={{ fontSize: 12, borderRadius: 10 }} />
                <Bar dataKey="vendas" name="Vendas" fill={IFOOD} fillOpacity={0.85} radius={[4, 4, 0, 0]} maxBarSize={28} />
                <Line dataKey="liquido" name="Líquido" stroke="#10b981" strokeWidth={2.5} dot={false} type="monotone" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card titulo="De cada R$ 100 vendidos" sub="Para onde vai o dinheiro de uma venda no iFood">
          <div className="space-y-2.5">
            {cascata.map((c) => (
              <div key={c.nome}>
                <div className="flex justify-between text-xs mb-1">
                  <span className={c.nome === 'Fica para a loja' ? 'font-bold text-zinc-800' : 'text-zinc-600'}>{c.nome}</span>
                  <span className="font-bold tabular-nums" style={{ color: c.cor }}>R$ {c.por100.toFixed(2).replace('.', ',')}</span>
                </div>
                <div className="h-2 rounded-full bg-zinc-100 overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${Math.min(100, Math.max(0, c.por100))}%`, background: c.cor }} />
                </div>
              </div>
            ))}
            <p className="text-[11px] text-zinc-400 pt-1">Total no período: {brl(r.vendas - r.liquido)} de custos sobre {brl(r.vendas)} de vendas.</p>
          </div>
        </Card>
      </div>

      {/* Heatmap */}
      <Card titulo="Quando o iFood vende" sub="Pedidos por dia da semana e hora — quanto mais escuro, mais pedidos">
        <div className="overflow-x-auto">
          <div className="inline-grid gap-[3px] min-w-full" style={{ gridTemplateColumns: `36px repeat(${alturaHeat}, minmax(26px, 1fr)) 70px` }}>
            <div />
            {heat.horas.map((h) => <div key={h} className="text-[10px] text-zinc-400 text-center">{h}h</div>)}
            <div className="text-[10px] text-zinc-400 text-right pr-1">Total</div>
            {heat.g.map((linha, s) => (
              <div key={s} className="contents">
                <div className="text-[11px] font-semibold text-zinc-500 flex items-center">{SEMANA[s]}</div>
                {heat.horas.map((h) => {
                  const c = linha[h];
                  const a = c.n / heat.max;
                  return (
                    <div key={h} title={`${SEMANA_LONGA[s]} ${h}h: ${c.n} pedidos · ${brl(c.v)}`}
                      className="h-7 rounded-md flex items-center justify-center text-[10px] font-bold"
                      style={{ background: c.n ? `rgba(234,29,44,${0.1 + a * 0.85})` : '#fafafa', color: a > 0.5 ? '#fff' : '#9f1239' }}>
                      {c.n || ''}
                    </div>
                  );
                })}
                <div className="text-[11px] text-zinc-600 font-semibold text-right pr-1 flex items-center justify-end tabular-nums">{brl0(heat.porSemana[s].v)}</div>
              </div>
            ))}
          </div>
        </div>
      </Card>

      {/* Logística + pagamentos */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card titulo="Tipo de entrega × custo" sub="Quanto cada modelo de entrega custa em % das vendas">
          <div className="space-y-3">
            {porLogistica.map((l) => (
              <div key={l.k} className="rounded-xl border border-zinc-100 p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: l.cor }} />
                    <span className="text-sm font-bold text-zinc-800 truncate">{l.label}</span>
                  </div>
                  <span className="text-lg font-black tabular-nums" style={{ color: l.cor }}>{pct(l.custoPct)}</span>
                </div>
                <div className="grid grid-cols-3 gap-2 mt-2 text-xs">
                  <div><p className="text-zinc-400">Pedidos</p><p className="font-bold text-zinc-700">{l.pedidos} <span className="font-normal text-zinc-400">({pct(validos.length ? (l.pedidos / validos.length) * 100 : 0, 0)})</span></p></div>
                  <div><p className="text-zinc-400">Ticket</p><p className="font-bold text-zinc-700">{brl(l.ticket)}</p></div>
                  <div><p className="text-zinc-400">Comissão</p><p className="font-bold text-zinc-700">{pct(l.comissaoPct)}</p></div>
                </div>
                <p className="text-[11px] text-zinc-400 mt-1.5">{l.dica}</p>
              </div>
            ))}
          </div>
        </Card>

        <Card titulo="Formas de pagamento" sub="Participação nas vendas e taxa de transação de cada uma">
          <div className="h-44">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={porPagamento} layout="vertical" margin={{ top: 0, right: 10, left: 0, bottom: 0 }}>
                <XAxis type="number" hide />
                <YAxis type="category" dataKey="nome" width={110} tick={{ fontSize: 10, fill: '#71717a' }} axisLine={false} tickLine={false} />
                <Tooltip formatter={(v: number) => brl(v)} contentStyle={{ fontSize: 12, borderRadius: 10 }} />
                <Bar dataKey="vendas" name="Vendas" radius={[0, 4, 4, 0]} maxBarSize={18}>
                  {porPagamento.map((_, i) => <Cell key={i} fill={['#ea1d2c', '#f97316', '#f59e0b', '#06b6d4', '#8b5cf6', '#10b981', '#94a3b8'][i % 7]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <table className="w-full text-xs mt-2">
            <thead><tr className="text-zinc-400 text-left"><th className="font-semibold py-1">Forma</th><th className="font-semibold text-right">Pedidos</th><th className="font-semibold text-right">% vendas</th><th className="font-semibold text-right">Taxa</th></tr></thead>
            <tbody>
              {porPagamento.map((p) => (
                <tr key={p.nome} className="border-t border-zinc-50">
                  <td className="py-1.5 text-zinc-700 truncate max-w-[140px]">{p.nome}</td>
                  <td className="text-right tabular-nums">{p.pedidos}</td>
                  <td className="text-right tabular-nums">{pct(p.share)}</td>
                  <td className="text-right tabular-nums font-semibold">{pct(p.taxaPct, 2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>

      {/* Promoções + faixas de ticket */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card titulo="Promoções" sub="Quem pagou o desconto e o efeito no ticket">
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl p-3" style={{ background: '#fff7ed' }}>
              <p className="text-[11px] font-semibold text-amber-700 uppercase">Loja pagou</p>
              <p className="text-xl font-black text-zinc-800">{brl(r.promoLoja)}</p>
              <p className="text-xs text-zinc-500">{pct(r.vendas > 0 ? (r.promoLoja / r.vendas) * 100 : 0)} das vendas · {promo.pedidosComLoja} pedidos</p>
            </div>
            <div className="rounded-xl p-3" style={{ background: '#fff1f2' }}>
              <p className="text-[11px] font-semibold uppercase" style={{ color: IFOOD }}>iFood pagou</p>
              <p className="text-xl font-black text-zinc-800">{brl(r.promoIfood)}</p>
              <p className="text-xs text-zinc-500">desconto bancado pelo app</p>
            </div>
          </div>
          <div className="mt-4">
            <div className="flex justify-between text-xs text-zinc-500 mb-1">
              <span>{promo.com} pedidos com promoção ({pct(promo.pctPedidos, 0)})</span>
              <span>{promo.sem} sem</span>
            </div>
            <div className="h-3 rounded-full bg-zinc-100 overflow-hidden flex">
              <div className="h-full" style={{ width: `${promo.pctPedidos}%`, background: IFOOD }} />
            </div>
            <div className="grid grid-cols-2 gap-3 mt-3 text-xs">
              <div><p className="text-zinc-400">Ticket com promoção</p><p className="text-base font-black text-zinc-800">{brl(promo.ticketCom)}</p></div>
              <div><p className="text-zinc-400">Ticket sem promoção</p><p className="text-base font-black text-zinc-800">{brl(promo.ticketSem)}</p></div>
            </div>
            {r.promoLoja > 0 && promo.vendasComLoja > 0 && (
              <p className="text-[11px] text-zinc-500 mt-3 bg-zinc-50 rounded-lg p-2">
                Cada R$ 1 de promoção da loja acompanhou <b>{brl(promo.vendasComLoja / r.promoLoja)}</b> em vendas nesses pedidos.
              </p>
            )}
          </div>
        </Card>

        <Card titulo="Faixas de ticket" sub="Quantos pedidos em cada faixa de valor (R$)">
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={faixas} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" vertical={false} />
                <XAxis dataKey="faixa" tick={{ fontSize: 10, fill: '#a1a1aa' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: '#a1a1aa' }} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip formatter={(v: number, n: string) => (n === 'Vendas' ? brl(v) : v)} contentStyle={{ fontSize: 12, borderRadius: 10 }} />
                <Bar dataKey="pedidos" name="Pedidos" fill="#f97316" radius={[4, 4, 0, 0]} maxBarSize={40} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      {/* Cancelamentos */}
      <Card titulo="Cancelamentos" sub={`${cancel.n} pedidos cancelados (${pct(cancel.taxa)})${cancel.parciais ? ` · ${cancel.parciais} cancelamento(s) parcial(is)` : ''}`}>
        {cancel.n === 0 ? (
          <p className="text-sm text-emerald-600 font-semibold"><i className="ri-checkbox-circle-line mr-1" />Nenhum pedido cancelado no período.</p>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="space-y-2">
              {([['loja', 'Por motivo da loja', '#ef4444'], ['cliente', 'Cliente / entregador', '#f59e0b'], ['ifood', 'Atendimento iFood / outros', '#94a3b8']] as const).map(([k, label, cor]) => (
                <div key={k} className="flex items-center justify-between rounded-xl border border-zinc-100 px-3 py-2">
                  <div className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full" style={{ background: cor }} /><span className="text-xs text-zinc-600">{label}</span></div>
                  <div className="text-right"><p className="text-sm font-black text-zinc-800">{cancel.culpa[k].n}</p><p className="text-[10px] text-zinc-400">{brl(cancel.culpa[k].valor)}</p></div>
                </div>
              ))}
            </div>
            <div className="lg:col-span-2">
              <table className="w-full text-xs">
                <thead><tr className="text-zinc-400 text-left"><th className="font-semibold py-1">Motivo</th><th className="font-semibold text-right">Pedidos</th><th className="font-semibold text-right">Valor</th></tr></thead>
                <tbody>
                  {cancel.motivos.slice(0, 8).map((m) => (
                    <tr key={m.motivo} className="border-t border-zinc-50">
                      <td className="py-1.5 pr-2 text-zinc-700">
                        <span className="inline-block w-1.5 h-1.5 rounded-full mr-1.5 align-middle" style={{ background: m.culpa === 'loja' ? '#ef4444' : m.culpa === 'cliente' ? '#f59e0b' : '#94a3b8' }} />
                        {m.motivo}
                      </td>
                      <td className="text-right tabular-nums">{m.n}</td>
                      <td className="text-right tabular-nums">{brl(m.valor)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Card>

      {/* Operação */}
      <Card titulo="Operação" sub={op.n ? `Tempos medianos de ${op.n} pedidos entregues (API do iFood — cobre só os últimos ~30 dias)` : 'API de vendas do iFood'}>
        {op.n === 0 ? (
          <p className="text-xs text-zinc-400">Sem dados de tempo neste período. Eles chegam pela API do iFood (lojas autorizadas) e cobrem os últimos ~30 dias.</p>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="grid grid-cols-2 gap-2 lg:col-span-1">
              {[
                ['Aceite', op.aceite, 'ri-check-double-line', 'recebido → confirmado'],
                ['Preparo', op.preparo, 'ri-fire-line', 'confirmado → pronto'],
                ['Rota', op.rota, 'ri-route-line', 'coletou → cliente'],
                ['Total', op.total, 'ri-timer-line', 'pedido → entregue'],
              ].map(([l, v, ic, d]) => (
                <div key={l as string} className="rounded-xl bg-zinc-50 p-3">
                  <p className="text-[10px] font-semibold text-zinc-400 uppercase"><i className={`${ic} mr-1`} />{l}</p>
                  <p className="text-lg font-black text-zinc-800">{min(v as number | null)}</p>
                  <p className="text-[10px] text-zinc-400">{d}</p>
                </div>
              ))}
            </div>
            <div className="lg:col-span-2">
              <p className="text-xs font-semibold text-zinc-500 mb-1">Distribuição do tempo de preparo</p>
              <div className="h-40">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={op.distPreparo} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" vertical={false} />
                    <XAxis dataKey="faixa" tick={{ fontSize: 10, fill: '#a1a1aa' }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 10, fill: '#a1a1aa' }} axisLine={false} tickLine={false} allowDecimals={false} />
                    <Tooltip contentStyle={{ fontSize: 12, borderRadius: 10 }} />
                    <Bar dataKey="pedidos" name="Pedidos" radius={[4, 4, 0, 0]} maxBarSize={40}>
                      {op.distPreparo.map((d, i) => <Cell key={i} fill={i >= 4 ? '#ef4444' : i === 3 ? '#f59e0b' : '#10b981'} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="flex flex-wrap gap-2 mt-2 text-[11px]">
                <span className="px-2 py-1 rounded-full bg-zinc-100 text-zinc-600">Pedido pronto esperando entregador: {min(op.pedidoEsperando)} (mediana)</span>
                <span className="px-2 py-1 rounded-full bg-amber-50 text-amber-700">Entregador esperou &gt; 5 min: {op.entregadorEsperando}</span>
                <span className="px-2 py-1 rounded-full bg-red-50 text-red-600">Preparo &gt; 30 min: {op.preparoLongo}</span>
              </div>
            </div>
          </div>
        )}
      </Card>

      {/* Cardápio */}
      <Card titulo="Produtos no iFood"
        sub={menu.periodos.length
          ? `Relatório de Cardápio do Portal · ${menu.periodos.map((p) => p.split('|').map((d) => d.slice(8, 10) + '/' + d.slice(5, 7)).join('–')).join(', ')}${cardapio.doPeriodo ? '' : ' (último importado — fora do período filtrado)'}`
          : 'Relatório de Cardápio do Portal do Parceiro'}>
        {menu.top.length === 0 ? (
          <p className="text-xs text-zinc-400">Nenhum relatório de Cardápio importado. Baixe em Portal do Parceiro › Relatórios › Cardápio e importe em Financeiro › iFood.</p>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2 overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr className="text-zinc-400 text-left"><th className="font-semibold py-1">Produto</th><th className="font-semibold text-right">Qtd</th><th className="font-semibold text-right">Valor</th><th className="font-semibold text-right">% total</th><th className="font-semibold text-right">Conversão</th></tr></thead>
                <tbody>
                  {menu.top.map((x, i) => (
                    <tr key={x.nome} className="border-t border-zinc-50">
                      <td className="py-1.5 pr-2 text-zinc-700"><span className="text-zinc-300 mr-1.5 tabular-nums">{i + 1}</span>{x.nome}</td>
                      <td className="text-right tabular-nums">{Math.round(x.qtd)}{x.qtdPromo > 0 ? <span className="text-zinc-400"> ({Math.round(x.qtdPromo)} promo)</span> : null}</td>
                      <td className="text-right tabular-nums font-semibold">{brl(x.valor)}</td>
                      <td className="text-right tabular-nums">{pct(menu.totalValor > 0 ? (x.valor / menu.totalValor) * 100 : 0)}</td>
                      <td className="text-right tabular-nums">
                        <span className={x.conv >= menu.convMedia ? 'text-emerald-600 font-semibold' : 'text-zinc-500'}>{x.visitas > 0 ? pct(x.conv) : '—'}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div>
              <p className="text-xs font-semibold text-zinc-500 mb-2"><i className="ri-eye-line mr-1" />Muita visita, pouca venda</p>
              {menu.vitrine.length === 0 ? <p className="text-xs text-zinc-400">Nenhum produto bem abaixo da conversão média ({pct(menu.convMedia)}).</p> : (
                <div className="space-y-1.5">
                  {menu.vitrine.map((v) => (
                    <div key={v.nome} className="rounded-lg bg-pink-50/60 px-2.5 py-1.5">
                      <p className="text-xs font-semibold text-zinc-700 truncate">{v.nome}</p>
                      <p className="text-[10px] text-zinc-500">{v.visitas} visitas · {v.pedidos} pedidos · conversão {pct(v.conv)}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </Card>

      {/* Comparativo por loja */}
      {!loja && porLoja.length > 1 && (
        <Card titulo="Lojas no iFood lado a lado" sub="Mesmo período, cada loja do iFood desta unidade">
          <div className="overflow-x-auto">
            <table className="w-full text-xs min-w-[560px]">
              <thead><tr className="text-zinc-400 text-left"><th className="font-semibold py-1">Loja</th><th className="font-semibold text-right">Pedidos</th><th className="font-semibold text-right">Vendas</th><th className="font-semibold text-right">Ticket</th><th className="font-semibold text-right">Custo iFood</th><th className="font-semibold text-right">Líquido</th><th className="font-semibold text-right">Cancel.</th></tr></thead>
              <tbody>
                {porLoja.map((l) => (
                  <tr key={l.id} className="border-t border-zinc-50 hover:bg-zinc-50 cursor-pointer" onClick={() => setLoja(l.id)}>
                    <td className="py-2 pr-2 font-semibold text-zinc-700">{l.nome}</td>
                    <td className="text-right tabular-nums">{l.pedidos}</td>
                    <td className="text-right tabular-nums font-semibold">{brl(l.vendas)}</td>
                    <td className="text-right tabular-nums">{brl(l.ticket)}</td>
                    <td className="text-right tabular-nums">{pct(l.custoPct)}</td>
                    <td className="text-right tabular-nums text-emerald-600 font-semibold">{brl(l.liquido)}</td>
                    <td className="text-right tabular-nums">{l.cancelados}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="h-44 mt-3">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={porLoja} margin={{ top: 5, right: 5, left: -10, bottom: 0 }}>
                <XAxis dataKey="nome" tick={{ fontSize: 10, fill: '#71717a' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: '#a1a1aa' }} axisLine={false} tickLine={false} />
                <Tooltip formatter={(v: number) => brl(v)} contentStyle={{ fontSize: 12, borderRadius: 10 }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="vendas" name="Vendas" fill={IFOOD} radius={[4, 4, 0, 0]} maxBarSize={36} />
                <Bar dataKey="liquido" name="Líquido" fill="#10b981" radius={[4, 4, 0, 0]} maxBarSize={36} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p className="text-[11px] text-zinc-400 mt-1">Clique numa loja para ver o dashboard só dela.</p>
        </Card>
      )}
    </div>
  );
}
