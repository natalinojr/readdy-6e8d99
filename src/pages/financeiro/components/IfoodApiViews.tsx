import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { supabase } from '@/lib/supabase';
import { formatCurrency } from '@/lib/formatters';

// Visões das APIs do módulo Financial do iFood (gravadas pela edge ifood-financial na
// busca diária): Pedidos (Sales), Repasses (Settlements + Anticipations) e Eventos
// (Financial Events). Mês = competência escolhida na aba iFood; loja = filtro de loja da aba
// (vazio = todas as lojas iFood desta loja do ERPOS).

export type IfoodApiView = 'pedidos' | 'repasses' | 'eventos';

interface Props { tenantId: string; competence: string; view: IfoodApiView; merchantId?: string; nomes?: Record<string, string> }

const dBR = (d?: string | null) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '—');
const n = (v: unknown) => Number(v ?? 0);
const monthRange = (c: string) => {
  const [y, m] = c.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { start: `${c}-01`, end: `${c}-${String(last).padStart(2, '0')}` };
};
const STATUS_PT: Record<string, string> = {
  SUCCEED: 'Pago', SUCCESS: 'Pago', PAID: 'Pago', FAILED: 'Falhou', PENDING: 'Pendente', SCHEDULED: 'Agendado', CANCELLED: 'Cancelado',
  CONCLUDED: 'Concluído', CANCELED: 'Cancelado', DISPATCHED: 'Despachado', CONFIRMED: 'Confirmado',
  CLOSED: 'Fechado', COMPENSATED: 'Compensado',
};
const pt = (s?: string | null) => (s ? STATUS_PT[s.toUpperCase()] ?? s : '—');
// Nomes técnicos que a API devolve em lançamentos, eventos e formas de pagamento.
const NOME_PT: Record<string, string> = {
  // Lançamentos do pedido (billingEntries) e eventos financeiros
  ORDER_COMMISSION: 'Comissão iFood', COMMISSION: 'Comissão iFood', EXCLUSIVITY_COMMISSION: 'Comissão iFood (plano)',
  PARTIAL_AREA_MARKETPLACE_COMMISSION: 'Comissão iFood (área parcial)', PARTIAL_AREA_FULL_SERVICE_COMMISSION: 'Comissão de entrega (área parcial)',
  PAYMENT_TRANSACTION_FEE: 'Taxa de transação', SERVICE_FEE: 'Taxa de serviço', SERVICE_FEE_IFOOD: 'Taxa de serviço',
  REFUND_SERVICE_FEE: 'Estorno da taxa de serviço', CONVENIENCE_FEE: 'Taxa de conveniência',
  ORDER_PAYMENT: 'Pago pelo cliente', IN_APP_PAYMENT_CREDIT: 'Pago pelo cliente no app', EXTERNAL_PAYMENT: 'Pago fora do app',
  IFOOD_SUBSIDY: 'Promoção paga pelo iFood', STORE_SUBSIDY: 'Promoção paga pela loja', MERCHANT_SUBSIDY: 'Promoção paga pela loja',
  IFOOD_SUBSIDY_TARGET_ITEM: 'Promoção do iFood no item', IFOOD_SUBSIDY_TARGET_CART: 'Promoção do iFood no pedido', IFOOD_SUBSIDY_TARGET_DELIVERY_FEE: 'Frete grátis pago pelo iFood',
  STORE_SUBSIDY_TARGET_ITEM: 'Promoção da loja no item', STORE_SUBSIDY_TARGET_CART: 'Promoção da loja no pedido', STORE_SUBSIDY_TARGET_DELIVERY_FEE: 'Frete grátis pago pela loja',
  DELIVERY_FEE_IFOOD: 'Entrega feita pelo iFood', DELIVERY_FEE: 'Taxa de entrega', DELIVERY_REQUEST: 'Entrega sob demanda',
  ON_DEMAND_ON_PLATFORM: 'Entrega sob demanda', ON_DEMAND_OFF_PLATFORM: 'Entrega sob demanda (pedido de fora do iFood)',
  STORE_REFUND: 'Reembolso ao cliente pela loja', REFUND: 'Estorno', BENEFIT_OWN: 'Benefício próprio', ADDITIONAL_ORDER_ENTRY: 'Lançamento adicional',
  // Gatilhos
  ORDER_CONCLUDED: 'Pedido concluído', ORDER_CANCELLED: 'Pedido cancelado', NO_CONCLUDED_STATUS: 'Pedido não concluído',
  PARTIAL_CANCELLATION_ORDER: 'Cancelamento parcial', LOGISTIC_SHIPPING_CHARGE: 'Cobrança de entrega', SINGLE_OCCURRENCE: 'Lançamento avulso',
  STORE_REFUND_REQUEST: 'Reembolso pedido pela loja',
  // Formas de pagamento, bandeiras e carteiras
  PIX: 'Pix', CREDIT: 'Crédito', DEBIT: 'Débito', MEAL_VOUCHER: 'Vale-refeição', FOOD_VOUCHER: 'Vale-alimentação', VOUCHER: 'Vale',
  CASH: 'Dinheiro', BANK_PAY: 'NuPay', DIGITAL_WALLET: 'Carteira digital', EXTERNAL: 'Pago fora do iFood', ONLINE: 'Online', OFFLINE: 'Na entrega',
  MASTERCARD: 'Mastercard', MASTERCARD_MAESTRO: 'Maestro', VISA: 'Visa', VISA_ELECTRON: 'Visa Electron', ELO: 'Elo', AMEX: 'Amex', HIPERCARD: 'Hipercard',
  NUBANK: 'Nubank', VR: 'VR', IFOOD_MEAL_VOUCHER: 'Vale iFood', ALELO: 'Alelo', SODEXO: 'Pluxee', TICKET: 'Ticket',
  APPLE_PAY: 'Apple Pay', GOOGLE_PAY: 'Google Pay', SAMSUNG_PAY: 'Samsung Pay',
};
// Código desconhecido (ex.: NOVO_TIPO_X) vira "Novo tipo x"; texto comum passa como veio.
export const nm = (s?: string | null) => {
  if (!s) return '';
  const k = s.toUpperCase();
  if (NOME_PT[k]) return NOME_PT[k];
  if (/^[A-Z0-9_]+$/.test(s)) { const t = s.toLowerCase().replace(/_/g, ' '); return t.charAt(0).toUpperCase() + t.slice(1); }
  return s;
};
const TIPO_PT: Record<string, string> = {
  REPASSE: 'Repasse', BOLETO: 'Boleto (loja deve ao iFood)', REGISTRO_RECEBIVEIS: 'Registro de recebíveis',
  'SALDO POSITIVO': 'Saldo positivo do fechamento', 'SALDO NEGATIVO': 'Saldo negativo do fechamento',
};
// Só REPASSE e BOLETO movimentam dinheiro; "saldo positivo/negativo" (CLOSED/COMPENSATED) é a composição
// do fechamento — somá-los junto com o repasse inflava o total (ex.: 23/09: 989,74 virava 2.603,74).
const movimentaDinheiro = (t: unknown) => ['REPASSE', 'BOLETO'].includes(String(t ?? '').toUpperCase());

function Empty() {
  return (
    <div className="bg-white rounded-2xl border border-zinc-100 p-8 text-center space-y-2">
      <i className="ri-plug-line text-3xl text-zinc-300" />
      <p className="text-sm font-semibold text-zinc-700">Sem dados da API do iFood neste mês</p>
      <p className="text-xs text-zinc-500 max-w-md mx-auto">Esta visão vem da API do iFood (busca todo dia às 07h20 e ao abrir a Conciliação). Se a loja ainda não aparece, autorize-a em <strong>Configurar</strong> › "Autorizar outra loja".</p>
    </div>
  );
}

export default function IfoodApiViews({ tenantId, competence, view, merchantId, nomes = {} }: Props) {
  // Filtro de loja do iFood em todas as consultas (sem ele, duas lojas se misturavam).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const porLoja = (q: any) => (merchantId ? q.eq('merchant_id', merchantId) : q);
  const [rows, setRows] = useState<any[]>([]);
  const [antecip, setAntecip] = useState<any[]>([]);
  // Conferência entre fontes, por data de repasse: eventos × relatório de conciliação × liquidação.
  const [conf, setConf] = useState<{ merchant: string; data: string; eventos: number | null; conciliacao: number | null; liquidado: number | null }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [soImpacto, setSoImpacto] = useState(true);
  // Resposta original da API (coluna raw) aberta no botão { } de cada linha.
  const [json, setJson] = useState<unknown>(null);
  // Mês próprio: a API pode ter dados de meses sem relatório importado (a loja de teste devolve 2025).
  const [mes, setMes] = useState(competence);
  const [pulou, setPulou] = useState(false); // já saltou para o último mês com dados?
  useEffect(() => { setMes(competence); setPulou(false); }, [competence, view]);
  const { start, end } = monthRange(mes);

  // Mês sem dados → vai sozinho para o último mês que tem (uma vez por visão).
  useEffect(() => {
    if (loading || pulou || rows.length > 0 || antecip.length > 0) return;
    setPulou(true);
    const [tabela, col] = view === 'pedidos' ? ['fin_ifood_sales', 'sale_created_at'] : view === 'repasses' ? ['fin_ifood_settlements', 'payment_date'] : ['fin_ifood_events', 'event_at'];
    porLoja(supabase.from(tabela).select(col).eq('tenant_id', tenantId)).not(col, 'is', null).order(col, { ascending: false }).limit(1).then(({ data }: { data: Record<string, string>[] | null }) => {
      const ultimo = (data?.[0] as Record<string, string> | undefined)?.[col];
      if (ultimo && ultimo.slice(0, 7) !== mes) setMes(ultimo.slice(0, 7));
    });
  }, [loading, pulou, rows.length, antecip.length, view, tenantId, mes, merchantId]);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setError(null);
      let res: { data: any[] | null; error: { message: string } | null };
      if (view === 'pedidos') {
        res = await porLoja(supabase.from('fin_ifood_sales').select('*').eq('tenant_id', tenantId))
          .gte('sale_created_at', `${start}T00:00:00-03:00`).lte('sale_created_at', `${end}T23:59:59-03:00`).order('sale_created_at', { ascending: false }).limit(3000);
      } else if (view === 'repasses') {
        const [s, a, ev, rec] = await Promise.all([
          porLoja(supabase.from('fin_ifood_settlements').select('*').eq('tenant_id', tenantId)).gte('payment_date', start).lte('payment_date', end).order('payment_date'),
          porLoja(supabase.from('fin_ifood_anticipations').select('*').eq('tenant_id', tenantId)).gte('anticipated_date', start).lte('anticipated_date', end).order('anticipated_date'),
          porLoja(supabase.from('fin_ifood_events').select('merchant_id, expected_settlement, amount').eq('tenant_id', tenantId)).eq('has_transfer_impact', true).gte('expected_settlement', start).lte('expected_settlement', end).limit(20000),
          porLoja(supabase.from('fin_ifood_entries').select('merchant_id, data_repasse, valor').eq('tenant_id', tenantId)).eq('impacto_repasse', true).gte('data_repasse', start).lte('data_repasse', end).limit(50000),
        ]);
        res = s;
        if (alive) {
          setAntecip(a.data ?? []);
          // Por loja + data: cada loja do iFood tem o próprio repasse (somar lojas com fontes diferentes
          // — uma só por arquivo, outra pela API — dava "Diferença" falsa).
          const mapa = new Map<string, { eventos: number | null; conciliacao: number | null; liquidado: number | null }>();
          const soma = (m: string | null, d: string | null, k: 'eventos' | 'conciliacao' | 'liquidado', v: number) => {
            if (!d) return;
            const key = `${m ?? ''}|${d}`;
            const x = mapa.get(key) ?? { eventos: null, conciliacao: null, liquidado: null };
            x[k] = (x[k] ?? 0) + v;
            mapa.set(key, x);
          };
          for (const e of ev.data ?? []) soma(e.merchant_id, e.expected_settlement, 'eventos', n(e.amount));
          for (const e of rec.data ?? []) soma(e.merchant_id, e.data_repasse, 'conciliacao', n(e.valor));
          for (const r of s.data ?? []) if (String(r.type ?? '').toUpperCase() === 'REPASSE') soma(r.merchant_id, r.payment_date, 'liquidado', n(r.amount));
          setConf([...mapa.entries()]
            .map(([k, v]) => ({ merchant: k.split('|')[0], data: k.split('|')[1], ...v }))
            .sort((x, y) => x.data.localeCompare(y.data) || x.merchant.localeCompare(y.merchant)));
        }
      } else {
        res = await supabase.from('fin_ifood_events').select('*').eq('tenant_id', tenantId)
          .gte('event_at', `${start}T00:00:00-03:00`).lte('event_at', `${end}T23:59:59-03:00`).order('event_at', { ascending: false }).limit(5000);
      }
      if (!alive) return;
      if (res.error) setError(res.error.message);
      setRows(res.data ?? []);
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [tenantId, start, end, view, merchantId]);

  const eventos = useMemo(() => (soImpacto ? rows.filter((e) => e.has_transfer_impact) : rows), [rows, soImpacto]);

  const seletor = (
    <div className="flex items-center gap-2 text-xs text-zinc-500">
      <span>Mês:</span>
      <input type="month" value={mes} onChange={(e) => e.target.value && setMes(e.target.value)}
        className="border border-zinc-200 rounded-lg px-2 py-1 text-sm bg-white" />
    </div>
  );
  const verApi = (raw: unknown) => (
    <button type="button" onClick={() => setJson(raw ?? {})} title="Ver a resposta original da API do iFood"
      className="px-1.5 py-0.5 rounded border border-zinc-200 tabular-nums text-[11px] text-zinc-500 hover:text-red-600 hover:border-red-300">{'{ }'}</button>
  );
  const modal = json !== null && (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setJson(null)}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="px-4 py-3 border-b border-zinc-100 flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-zinc-800">Resposta original da API do iFood</p>
            <p className="text-xs text-zinc-500">JSON exatamente como veio na busca, sem alteração.</p>
          </div>
          <button type="button" onClick={() => setJson(null)} className="text-zinc-400 hover:text-zinc-700"><i className="ri-close-line text-xl" /></button>
        </div>
        <pre className="p-4 overflow-auto text-xs tabular-nums text-zinc-700 bg-zinc-50 rounded-b-xl">{JSON.stringify(json, null, 2)}</pre>
      </div>
    </div>
  );
  if (loading) return <div className="space-y-3">{seletor}<div className="flex items-center justify-center py-12"><div className="w-6 h-6 border-2 border-red-500 border-t-transparent rounded-full animate-spin" /></div></div>;
  if (error) return <div className="space-y-3">{seletor}<div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">Falha ao carregar: {error}</div></div>;
  return <div className="space-y-3">{seletor}{conteudo()}{modal}</div>;

  function conteudo() {

  if (view === 'pedidos') {
    if (rows.length === 0) return <Empty />;
    return <PedidosView rows={rows} nomes={nomes} verApi={verApi} />;
  }

  if (view === 'repasses') {
    if (rows.length === 0 && antecip.length === 0 && conf.length === 0) return <Empty />;
    // Fontes batem se as disponíveis diferem até R$ 0,05 entre si.
    const hoje = new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
    const situacao = (c: { data: string; eventos: number | null; conciliacao: number | null; liquidado: number | null }) => {
      const vals = [c.eventos, c.conciliacao, c.liquidado].filter((v): v is number => v !== null);
      if (vals.length < 2) return { t: 'Só uma fonte', c: 'bg-zinc-100 text-zinc-600' };
      if (Math.max(...vals) - Math.min(...vals) <= 0.05) return { t: 'Conferido', c: 'bg-green-100 text-green-700' };
      // Repasse ainda por vir: a API já tem as vendas novas e o relatório do mês foi gerado antes delas.
      const apiBate = c.eventos !== null && c.liquidado !== null && Math.abs(c.eventos - c.liquidado) <= 0.05;
      if (c.data >= hoje && apiBate) return { t: 'Relatório desatualizado', c: 'bg-blue-50 text-blue-700' };
      return { t: 'Diferença', c: 'bg-amber-100 text-amber-700' };
    };
    const variasLojas = new Set(conf.map((c) => c.merchant)).size > 1;
    const lojaNome = (id: string) => nomes[id] ?? `Loja ${id.slice(0, 8)}`;
    const conta = (a: any) => (a ? `${a.bankName ?? a.bankNumber ?? ''} ag. ${a.branchCode ?? ''} c/c ${String(a.accountNumber ?? '').replace(/.(?=.{4})/g, '•')}${a.accountDigit ? '-' + a.accountDigit : ''}` : '—');
    return (
      <div className="space-y-4">
        {conf.length > 0 && (
          <div className="bg-white rounded-2xl border border-zinc-100 overflow-hidden">
            <div className="px-4 py-3 border-b border-zinc-100">
              <p className="text-sm font-semibold text-zinc-800">Conferência entre fontes do iFood</p>
              <p className="text-xs text-zinc-500">Por loja e data de repasse: eventos financeiros que afetam o repasse × relatório de conciliação × valor liquidado. As três devem bater. Loja só pelo arquivo mostra "Só uma fonte"; "Relatório desatualizado" some com <strong>Atualizar do iFood</strong>.</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[640px]">
                <thead className="text-[11px] uppercase tracking-wide text-zinc-400 border-b border-zinc-100">
                  <tr><th className="text-left px-3 py-2">Repasse</th>{variasLojas && <th className="text-left px-3 py-2">Loja</th>}<th className="text-right px-3 py-2">Eventos</th><th className="text-right px-3 py-2">Conciliação</th><th className="text-right px-3 py-2">Liquidado</th><th className="text-left px-3 py-2">Situação</th></tr>
                </thead>
                <tbody>
                  {conf.map((c) => {
                    const st = situacao(c);
                    const cel = (v: number | null) => (v === null ? <span className="text-zinc-300">—</span> : formatCurrency(v));
                    return (
                      <tr key={`${c.merchant}|${c.data}`} className="border-t border-zinc-100">
                        <td className="px-3 py-2 whitespace-nowrap">{dBR(c.data)}</td>
                        {variasLojas && <td className="px-3 py-2 text-xs text-zinc-600">{lojaNome(c.merchant)}</td>}
                        <td className="px-3 py-2 text-right tabular-nums">{cel(c.eventos)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{cel(c.conciliacao)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{cel(c.liquidado)}</td>
                        <td className="px-3 py-2"><span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${st.c}`}>{st.t}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="bg-white rounded-2xl border border-zinc-100 overflow-hidden">
          <div className="px-4 py-3 border-b border-zinc-100">
            <p className="text-sm font-semibold text-zinc-800">Liquidações do iFood</p>
            <p className="text-xs text-zinc-500">
              Repasses do mês: <strong className="text-green-700">{formatCurrency(rows.filter((r) => String(r.type ?? '').toUpperCase() === 'REPASSE' && r.payment_date <= hoje).reduce((s, r) => s + n(r.amount), 0))}</strong> já pagos
              {rows.some((r) => String(r.type ?? '').toUpperCase() === 'REPASSE' && r.payment_date > hoje) && <> · <strong className="text-zinc-700">{formatCurrency(rows.filter((r) => String(r.type ?? '').toUpperCase() === 'REPASSE' && r.payment_date > hoje).reduce((s, r) => s + n(r.amount), 0))}</strong> previstos</>}
              . As linhas em cinza são a composição de cada fechamento (saldos compensados) e não somam.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[700px]">
              <thead className="text-[11px] uppercase tracking-wide text-zinc-400 border-b border-zinc-100">
                <tr><th className="text-left px-3 py-2">Pagamento</th><th className="text-left px-3 py-2">Tipo</th><th className="text-left px-3 py-2">Período apurado</th><th className="text-right px-3 py-2">Valor</th><th className="text-left px-3 py-2">Situação</th><th className="text-left px-3 py-2">Conta</th><th className="px-3 py-2">API</th></tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className={`border-t border-zinc-100 ${movimentaDinheiro(r.type) ? '' : 'text-zinc-400'}`}>
                    <td className="px-3 py-2 whitespace-nowrap">{dBR(r.payment_date)}</td>
                    <td className="px-3 py-2 text-xs">{TIPO_PT[String(r.type ?? '').toUpperCase()] ?? r.type ?? '—'}{r.product ? <span className="text-zinc-400"> · {r.product}</span> : null}{variasLojas && <span className="block text-[11px] text-zinc-400">{lojaNome(r.merchant_id)}</span>}</td>
                    <td className="px-3 py-2 text-xs">{dBR(r.calc_begin)} a {dBR(r.calc_end)}</td>
                    <td className={`px-3 py-2 text-right tabular-nums ${!movimentaDinheiro(r.type) ? 'text-zinc-400' : n(r.amount) < 0 || String(r.type).toUpperCase() === 'BOLETO' ? 'text-red-600' : 'text-green-700'}`}>{formatCurrency(n(r.amount))}</td>
                    <td className="px-3 py-2 text-xs">{pt(r.status)}</td>
                    <td className="px-3 py-2 text-xs text-zinc-500">{String(r.status ?? '').toUpperCase() === 'SUCCEED' ? conta(r.account_details) : '—'}</td>
                    <td className="px-3 py-2 text-center">{verApi(r.raw)}</td>
                  </tr>
                ))}
                {rows.length === 0 && <tr><td colSpan={7} className="px-3 py-4 text-center text-xs text-zinc-400">Nenhuma liquidação neste mês.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-zinc-100 overflow-hidden">
          <div className="px-4 py-3 border-b border-zinc-100">
            <p className="text-sm font-semibold text-zinc-800">Antecipações</p>
            <p className="text-xs text-zinc-500">Recebimentos adiantados pelo iFood, quantos dias antes e quanto isso custou — compare com esperar o prazo normal (D+30), que não tem taxa.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[760px]">
              <thead className="text-[11px] uppercase tracking-wide text-zinc-400 border-b border-zinc-100">
                <tr><th className="text-left px-3 py-2">Data original → antecipada</th><th className="text-right px-3 py-2">Valor original</th><th className="text-right px-3 py-2">Taxa</th><th className="text-right px-3 py-2">Recebido</th><th className="text-right px-3 py-2">Adiantou</th><th className="text-left px-3 py-2">Situação</th><th className="px-3 py-2">API</th></tr>
              </thead>
              <tbody>
                {antecip.map((a) => {
                  const dias = a.original_date && a.anticipated_date
                    ? Math.round((new Date(a.original_date + 'T12:00:00Z').getTime() - new Date(a.anticipated_date + 'T12:00:00Z').getTime()) / 86400000) : 0;
                  const pct = n(a.original_amount) > 0 ? (n(a.fee_amount) / n(a.original_amount)) * 100 : n(a.fee_percentage);
                  const aoMes = dias > 0 ? (pct / dias) * 30 : null;
                  return (
                    <tr key={a.id} className="border-t border-zinc-100">
                      <td className="px-3 py-2 text-xs whitespace-nowrap">{dBR(a.original_date)} → <strong>{dBR(a.anticipated_date)}</strong></td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(n(a.original_amount))}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-red-600">{formatCurrency(n(a.fee_amount))} <span className="text-xs text-zinc-400">({pct.toFixed(2)}%)</span></td>
                      <td className="px-3 py-2 text-right tabular-nums text-green-700">{formatCurrency(n(a.anticipated_amount))}</td>
                      <td className="px-3 py-2 text-right text-xs whitespace-nowrap">{dias > 0 ? `${dias} dia(s)` : '—'}{aoMes !== null && <span className="block text-zinc-400">custo ≈ {aoMes.toFixed(2)}% ao mês</span>}</td>
                      <td className="px-3 py-2 text-xs">{pt(a.status)}</td>
                      <td className="px-3 py-2 text-center">{verApi(a.raw)}</td>
                    </tr>
                  );
                })}
                {antecip.length === 0 && <tr><td colSpan={7} className="px-3 py-4 text-center text-xs text-zinc-400">Nenhuma antecipação neste mês.</td></tr>}
                {antecip.length > 0 && (() => {
                  const taxa = antecip.reduce((s, a) => s + n(a.fee_amount), 0);
                  return (
                    <tr className="border-t border-zinc-200 text-xs">
                      <td colSpan={7} className="px-3 py-2 text-zinc-600">
                        Neste mês a loja pagou <strong className="text-red-600">{formatCurrency(taxa)}</strong> para receber antes. Esperando o prazo normal (D+30), esse valor teria entrado inteiro no caixa.
                      </td>
                    </tr>
                  );
                })()}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }

  // eventos
  if (rows.length === 0) return <Empty />;
  const saldo = eventos.filter((e) => e.has_transfer_impact).reduce((s, e) => s + n(e.amount), 0);
  return (
    <div className="bg-white rounded-2xl border border-zinc-100 overflow-hidden">
      <div className="px-4 py-3 border-b border-zinc-100 flex flex-wrap items-center gap-4 text-xs text-zinc-600">
        <span><strong className="text-zinc-900">{eventos.length}</strong> evento(s)</span>
        <span>Efeito no repasse <strong className={saldo < 0 ? 'text-red-600' : 'text-green-700'}>{formatCurrency(saldo)}</strong></span>
        <label className="flex items-center gap-1.5 cursor-pointer ml-auto">
          <input type="checkbox" checked={soImpacto} onChange={(e) => setSoImpacto(e.target.checked)} className="rounded" /> Só o que afeta o repasse
        </label>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[760px]">
          <thead className="text-[11px] uppercase tracking-wide text-zinc-400 border-b border-zinc-100">
            <tr><th className="text-left px-3 py-2">Data</th><th className="text-left px-3 py-2">Evento</th><th className="text-left px-3 py-2">Gatilho</th><th className="text-left px-3 py-2">Pagamento</th><th className="text-right px-3 py-2">Valor</th><th className="text-left px-3 py-2">Repasse previsto</th><th className="px-3 py-2">API</th></tr>
          </thead>
          <tbody>
            {eventos.map((e) => (
              <tr key={e.id} className={`border-t border-zinc-100 ${e.has_transfer_impact ? '' : 'text-zinc-400'}`}>
                <td className="px-3 py-2 text-xs whitespace-nowrap">{e.event_at ? new Date(e.event_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—'}</td>
                <td className="px-3 py-2 text-xs">{nm(e.name)}{e.description && nm(e.description) !== nm(e.name) ? <span className="text-zinc-400"> · {nm(e.description)}</span> : null}{e.fee_percentage ? <span className="text-zinc-400"> · {(n(e.fee_percentage) <= 1 ? n(e.fee_percentage) * 100 : n(e.fee_percentage)).toFixed(1)}% de {formatCurrency(n(e.base_value))}</span> : null}</td>
                <td className="px-3 py-2 text-xs">{nm(e.trigger) || '—'}</td>
                <td className="px-3 py-2 text-xs">{[nm(e.payment_method), e.payment_brand].filter(Boolean).join(' · ') || '—'}{e.payment_liability ? <span className="text-zinc-400"> ({e.payment_liability === 'IFOOD' ? 'iFood' : e.payment_liability === 'MERCHANT' ? 'loja' : e.payment_liability})</span> : null}</td>
                <td className={`px-3 py-2 text-right tabular-nums ${n(e.amount) < 0 ? 'text-red-600' : 'text-green-700'}`}>{formatCurrency(n(e.amount))}</td>
                <td className="px-3 py-2 text-xs whitespace-nowrap">{dBR(e.expected_settlement)}{e.has_transfer_impact ? '' : ' (não afeta)'}</td>
                <td className="px-3 py-2 text-center">{verApi(e.raw)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
  }
}

// ── Pedidos (Sales) ─────────────────────────────────────────────────────────
// Linha enxuta (bruto, promoções por quem pagou, taxas, líquido); a composição do líquido abre ao clicar.
const somaPatrocinio = (r: any, quem: 'loja' | 'ifood' | 'industria') => {
  let v = 0;
  for (const bf of (r.raw?.benefits?.benefits ?? []) as any[]) {
    for (const sp of (bf?.sponsorships ?? []) as any[]) {
      const nome = String(sp?.name ?? '').toUpperCase();
      const grupo = nome === 'IFOOD' ? 'ifood' : nome === 'EXTERNAL' ? 'industria' : 'loja'; // MERCHANT e CHAIN = loja/rede
      if (grupo === quem) v += n(sp?.value);
    }
  }
  return v;
};
const pagamentoLabel = (m: any) => {
  const metodo = String(m?.method ?? '').toUpperCase();
  const carteira = m?.wallet?.name ? nm(m.wallet.name) : '';
  const bandeira = m?.card?.brand ? nm(m.card.brand) : '';
  if (carteira) return [carteira, bandeira].filter(Boolean).join(' · ');
  if (metodo === 'CREDIT' || metodo === 'DEBIT' || metodo === 'MEAL_VOUCHER' || metodo === 'VOUCHER') return [nm(metodo), bandeira].filter(Boolean).join(' ');
  return nm(metodo) || '—';
};

function PedidosView({ rows, nomes, verApi }: { rows: any[]; nomes: Record<string, string>; verApi: (raw: unknown) => ReactNode }) {
  const [busca, setBusca] = useState('');
  const [situacao, setSituacao] = useState<'todos' | 'concluidos' | 'cancelados'>('todos');
  const [aberto, setAberto] = useState<string | null>(null);
  const variasLojas = new Set(rows.map((r) => r.merchant_id)).size > 1;
  const cancelado = (r: any) => /CANCEL/i.test(String(r.current_status ?? ''));
  const lista = rows.filter((r) =>
    (situacao === 'todos' || (situacao === 'cancelados') === cancelado(r))
    && (!busca.trim() || String(r.short_id ?? r.sale_id).includes(busca.trim().replace(/^#/, ''))));
  const validos = rows.filter((r) => !cancelado(r));
  // Bruto = itens + entrega. A taxa de serviço (cobrada do cliente e repassada ao iFood) vem negativa
  // da API e aparece na composição do líquido — somá-la aqui reduzia o bruto indevidamente.
  const bruto = validos.reduce((s, r) => s + n(r.gross_bag) + n(r.delivery_fee), 0);
  const promoLoja = validos.reduce((s, r) => s + somaPatrocinio(r, 'loja'), 0);
  const promoIfood = validos.reduce((s, r) => s + somaPatrocinio(r, 'ifood'), 0);
  const liquido = rows.reduce((s, r) => s + n(r.sale_balance), 0);
  const taxasDe = (r: any) => ((r.billing_entries ?? []) as any[]).filter((b) => n(b.value) < 0 && !/SUBSIDY/i.test(String(b.name))).reduce((s, b) => s + n(b.value), 0);
  const taxas = rows.reduce((s, r) => s + taxasDe(r), 0);
  const nomeLoja = (id: string) => nomes[id] ?? `Loja ${String(id).slice(0, 8)}`;

  const Stat = ({ label, value, tone = 'text-zinc-900', sub }: { label: string; value: string; tone?: string; sub?: string }) => (
    <div className="min-w-0">
      <p className="text-[11px] font-medium text-zinc-500">{label}</p>
      <p className={`text-base font-bold tabular-nums whitespace-nowrap ${tone}`}>{value}</p>
      {sub && <p className="text-[11px] text-zinc-400 truncate">{sub}</p>}
    </div>
  );

  return (
    <div className="bg-white rounded-2xl border border-zinc-100 overflow-hidden">
      <div className="px-4 py-4 border-b border-zinc-100 grid grid-cols-2 sm:grid-cols-5 gap-4">
        <Stat label="Pedidos" value={String(validos.length)} sub={rows.length > validos.length ? `+ ${rows.length - validos.length} cancelado(s)` : undefined} />
        <Stat label="Vendido (itens + entrega)" value={formatCurrency(bruto)} />
        <Stat label="Promoções" value={formatCurrency(promoLoja + promoIfood)} sub={`loja ${formatCurrency(promoLoja)} · iFood ${formatCurrency(promoIfood)}`} />
        <Stat label="Taxas do iFood" value={formatCurrency(taxas)} tone="text-red-600" />
        <Stat label="Líquido para a loja" value={formatCurrency(liquido)} tone="text-green-700" />
      </div>
      <div className="px-4 py-2.5 border-b border-zinc-100 flex flex-wrap items-center gap-2 bg-zinc-50/60">
        <div className="relative">
          <i className="ri-search-line absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400 text-sm" />
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Nº do pedido"
            className="pl-8 pr-3 py-1.5 w-40 border border-zinc-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-red-300" />
        </div>
        <div className="flex gap-1 bg-white border border-zinc-200 rounded-lg p-0.5">
          {([['todos', 'Todos'], ['concluidos', 'Concluídos'], ['cancelados', 'Cancelados']] as const).map(([k, l]) => (
            <button key={k} onClick={() => setSituacao(k)}
              className={`px-2.5 py-1 rounded-md text-xs font-semibold cursor-pointer ${situacao === k ? 'bg-zinc-900 text-white' : 'text-zinc-500 hover:text-zinc-800'}`}>{l}</button>
          ))}
        </div>
        <span className="ml-auto text-xs text-zinc-400">{lista.length} de {rows.length}</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[720px]">
          <thead className="text-[11px] uppercase tracking-wide text-zinc-400">
            <tr className="border-b border-zinc-100">
              <th className="text-left font-semibold px-4 py-2.5">Pedido</th>
              <th className="text-left font-semibold px-3 py-2.5">Pagamento</th>
              <th className="text-right font-semibold px-3 py-2.5">Vendido</th>
              <th className="text-right font-semibold px-3 py-2.5">Promoções</th>
              <th className="text-right font-semibold px-3 py-2.5">Taxas</th>
              <th className="text-right font-semibold px-3 py-2.5">Líquido</th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {lista.map((r) => {
              const metodos = (r.payment_methods ?? []) as any[];
              const entradas = ((r.billing_entries ?? []) as any[]).filter((b) => n(b.value) !== 0).sort((a, b) => n(b.value) - n(a.value));
              const pLoja = somaPatrocinio(r, 'loja');
              const pIfood = somaPatrocinio(r, 'ifood');
              const pInd = somaPatrocinio(r, 'industria');
              const processando = entradas.length === 0 && n(r.sale_balance) === 0 && !cancelado(r);
              const isOpen = aberto === r.id;
              return (
                <>
                  <tr key={r.id} onClick={() => setAberto(isOpen ? null : r.id)}
                    className={`border-b border-zinc-100 cursor-pointer hover:bg-zinc-50 ${isOpen ? 'bg-zinc-50' : ''} ${cancelado(r) ? 'opacity-60' : ''}`}>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-zinc-900 tabular-nums">#{r.short_id ?? String(r.sale_id).slice(0, 8)}</span>
                        {cancelado(r) && <span className="px-1.5 py-0.5 rounded bg-red-50 text-red-600 text-[10px] font-semibold">Cancelado</span>}
                      </div>
                      <p className="text-xs text-zinc-400 tabular-nums">
                        {r.sale_created_at ? new Date(r.sale_created_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).replace(',', ' ·') : '—'}
                        {variasLojas && <span className="text-zinc-500"> · {nomeLoja(r.merchant_id)}</span>}
                      </p>
                    </td>
                    <td className="px-3 py-2.5">
                      {metodos.length === 0 ? <span className="text-zinc-300">—</span> : metodos.map((m, i) => (
                        <div key={i} className="text-sm text-zinc-700">
                          {pagamentoLabel(m)}
                          {(m.liability === 'MERCHANT' || m.type === 'OFFLINE') && <span className="ml-1.5 px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 text-[10px] font-semibold">recebido pela loja</span>}
                        </div>
                      ))}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-zinc-800">{formatCurrency(n(r.gross_bag) + n(r.delivery_fee))}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {pLoja + pIfood + pInd === 0 ? <span className="text-zinc-300">—</span> : (
                        <div className="text-xs leading-5">
                          {pLoja > 0 && <div className="text-red-600">loja {formatCurrency(pLoja)}</div>}
                          {pIfood > 0 && <div className="text-zinc-500">iFood {formatCurrency(pIfood)}</div>}
                          {pInd > 0 && <div className="text-zinc-500">indústria {formatCurrency(pInd)}</div>}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-red-600">{processando ? <span className="text-zinc-300">—</span> : formatCurrency(taxasDe(r))}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums font-semibold">
                      {processando ? <span className="text-xs font-normal text-zinc-400">em processamento</span> : <span className="text-green-700">{formatCurrency(n(r.sale_balance))}</span>}
                    </td>
                    <td className="px-2 text-zinc-400"><i className={isOpen ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'} /></td>
                  </tr>
                  {isOpen && (
                    <tr key={r.id + '-d'} className="bg-zinc-50 border-b border-zinc-100">
                      <td colSpan={7} className="px-4 pb-4 pt-1">
                        <div className="grid md:grid-cols-2 gap-4">
                          <div className="bg-white rounded-2xl border border-zinc-100 p-3">
                            <p className="text-xs font-semibold text-zinc-700 mb-2">Composição do líquido</p>
                            {entradas.length === 0 && <p className="text-xs text-zinc-400">O iFood ainda não fechou os valores deste pedido (costuma sair no dia seguinte).</p>}
                            {entradas.map((b, i) => (
                              <div key={i} className="flex justify-between gap-3 py-1 text-sm border-t border-zinc-50 first:border-0">
                                <span className="text-zinc-600">{nm(b.name)}</span>
                                <span className={`tabular-nums ${n(b.value) < 0 ? 'text-red-600' : 'text-green-700'}`}>{n(b.value) > 0 ? '+' : ''}{formatCurrency(n(b.value))}</span>
                              </div>
                            ))}
                            {entradas.length > 0 && (
                              <div className="flex justify-between gap-3 pt-2 mt-1 border-t border-zinc-200 text-sm font-semibold">
                                <span>Líquido</span><span className="tabular-nums">{formatCurrency(n(r.sale_balance))}</span>
                              </div>
                            )}
                          </div>
                          <div className="bg-white rounded-2xl border border-zinc-100 p-3 text-sm space-y-1.5">
                            <p className="text-xs font-semibold text-zinc-700 mb-1">Pedido</p>
                            <div className="flex justify-between"><span className="text-zinc-500">Itens</span><span className="tabular-nums">{formatCurrency(n(r.gross_bag))}</span></div>
                            <div className="flex justify-between"><span className="text-zinc-500">Taxa de entrega cobrada</span><span className="tabular-nums">{formatCurrency(n(r.delivery_fee))}</span></div>
                            {n(r.service_fee) !== 0 && <div className="flex justify-between"><span className="text-zinc-500">Taxa de serviço (cliente)</span><span className="tabular-nums">{formatCurrency(Math.abs(n(r.service_fee)))}</span></div>}
                            <div className="flex justify-between"><span className="text-zinc-500">Situação</span><span>{pt(r.current_status)}</span></div>
                            {variasLojas && <div className="flex justify-between"><span className="text-zinc-500">Loja</span><span>{nomeLoja(r.merchant_id)}</span></div>}
                            <div className="pt-1 flex items-center gap-2 text-xs text-zinc-400">Resposta original da API {verApi(r.raw)}</div>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              );
            })}
            {lista.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-sm text-zinc-400">Nenhum pedido com esse filtro.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
