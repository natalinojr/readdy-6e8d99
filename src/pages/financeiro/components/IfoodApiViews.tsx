import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { formatCurrency } from '@/lib/formatters';

// Visões das APIs do módulo Financial do iFood (gravadas pela edge ifood-financial na
// busca diária): Pedidos (Sales), Repasses (Settlements + Anticipations) e Eventos
// (Financial Events). Mês = competência escolhida na aba iFood.

export type IfoodApiView = 'pedidos' | 'repasses' | 'eventos';

interface Props { tenantId: string; competence: string; view: IfoodApiView }

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
};
const pt = (s?: string | null) => (s ? STATUS_PT[s.toUpperCase()] ?? s : '—');
// Nomes técnicos que a API devolve em lançamentos, eventos e formas de pagamento.
const NOME_PT: Record<string, string> = {
  ORDER_COMMISSION: 'Comissão iFood', COMMISSION: 'Comissão iFood', PAYMENT_TRANSACTION_FEE: 'Taxa de transação', SERVICE_FEE: 'Taxa de serviço',
  SERVICE_FEE_IFOOD: 'Taxa de serviço iFood', ORDER_PAYMENT: 'Pagamento do pedido', IN_APP_PAYMENT_CREDIT: 'Pago no app (crédito)',
  EXTERNAL_PAYMENT: 'Pago fora do app', IFOOD_SUBSIDY: 'Promoção paga pelo iFood', MERCHANT_SUBSIDY: 'Promoção paga pela loja',
  DELIVERY_REQUEST: 'Entrega iFood', ON_DEMAND_ON_PLATFORM: 'Entrega sob demanda', DELIVERY_FEE: 'Taxa de entrega',
  REFUND_SERVICE_FEE: 'Estorno da taxa de serviço', REFUND: 'Estorno', ORDER_CONCLUDED: 'Pedido concluído',
  LOGISTIC_SHIPPING_CHARGE: 'Cobrança de entrega', SINGLE_OCCURRENCE: 'Lançamento avulso', ORDER_CANCELLED: 'Pedido cancelado',
  PIX: 'Pix', CREDIT: 'Crédito', DEBIT: 'Débito', MEAL_VOUCHER: 'Vale-refeição', FOOD_VOUCHER: 'Vale-alimentação', CASH: 'Dinheiro',
  BANK_PAY: 'Pagamento bancário', DIGITAL_WALLET: 'Carteira digital', ONLINE: 'Online', OFFLINE: 'Na entrega',
};
const nm = (s?: string | null) => (s ? NOME_PT[s.toUpperCase()] ?? s : '');
const TIPO_PT: Record<string, string> = { REPASSE: 'Repasse', BOLETO: 'Boleto (loja deve ao iFood)', REGISTRO_RECEBIVEIS: 'Registro de recebíveis' };

function Empty() {
  return (
    <div className="bg-white rounded-xl border border-zinc-100 p-8 text-center space-y-2">
      <i className="ri-plug-line text-3xl text-zinc-300" />
      <p className="text-sm font-semibold text-zinc-700">Sem dados da API do iFood neste mês</p>
      <p className="text-xs text-zinc-500 max-w-md mx-auto">Esta visão vem da API do iFood (busca diária às 07h20). Ela só funciona com o app conectado: em teste, com o app de teste e o modo homologação ligados; na loja real, depois da homologação.</p>
    </div>
  );
}

export default function IfoodApiViews({ tenantId, competence, view }: Props) {
  const [rows, setRows] = useState<any[]>([]);
  const [antecip, setAntecip] = useState<any[]>([]);
  // Conferência entre fontes, por data de repasse: eventos × relatório de conciliação × liquidação.
  const [conf, setConf] = useState<{ data: string; eventos: number | null; conciliacao: number | null; liquidado: number | null }[]>([]);
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
    supabase.from(tabela).select(col).eq('tenant_id', tenantId).not(col, 'is', null).order(col, { ascending: false }).limit(1).then(({ data }) => {
      const ultimo = (data?.[0] as Record<string, string> | undefined)?.[col];
      if (ultimo && ultimo.slice(0, 7) !== mes) setMes(ultimo.slice(0, 7));
    });
  }, [loading, pulou, rows.length, antecip.length, view, tenantId, mes]);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setError(null);
      let res: { data: any[] | null; error: { message: string } | null };
      if (view === 'pedidos') {
        res = await supabase.from('fin_ifood_sales').select('*').eq('tenant_id', tenantId)
          .gte('sale_created_at', `${start}T00:00:00-03:00`).lte('sale_created_at', `${end}T23:59:59-03:00`).order('sale_created_at', { ascending: false }).limit(3000);
      } else if (view === 'repasses') {
        const [s, a, ev, rec] = await Promise.all([
          supabase.from('fin_ifood_settlements').select('*').eq('tenant_id', tenantId).gte('payment_date', start).lte('payment_date', end).order('payment_date'),
          supabase.from('fin_ifood_anticipations').select('*').eq('tenant_id', tenantId).gte('anticipated_date', start).lte('anticipated_date', end).order('anticipated_date'),
          supabase.from('fin_ifood_events').select('expected_settlement, amount').eq('tenant_id', tenantId).eq('has_transfer_impact', true).gte('expected_settlement', start).lte('expected_settlement', end).limit(20000),
          supabase.from('fin_ifood_entries').select('data_repasse, valor').eq('tenant_id', tenantId).eq('impacto_repasse', true).gte('data_repasse', start).lte('data_repasse', end).limit(50000),
        ]);
        res = s;
        if (alive) {
          setAntecip(a.data ?? []);
          const mapa = new Map<string, { eventos: number | null; conciliacao: number | null; liquidado: number | null }>();
          const soma = (d: string | null, k: 'eventos' | 'conciliacao' | 'liquidado', v: number) => {
            if (!d) return;
            const x = mapa.get(d) ?? { eventos: null, conciliacao: null, liquidado: null };
            x[k] = (x[k] ?? 0) + v;
            mapa.set(d, x);
          };
          for (const e of ev.data ?? []) soma(e.expected_settlement, 'eventos', n(e.amount));
          for (const e of rec.data ?? []) soma(e.data_repasse, 'conciliacao', n(e.valor));
          for (const r of s.data ?? []) if (String(r.type ?? '').toUpperCase() === 'REPASSE') soma(r.payment_date, 'liquidado', n(r.amount));
          setConf([...mapa.entries()].sort(([x], [y]) => x.localeCompare(y)).map(([data, v]) => ({ data, ...v })));
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
  }, [tenantId, start, end, view]);

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
      className="px-1.5 py-0.5 rounded border border-zinc-200 font-mono text-[11px] text-zinc-500 hover:text-red-600 hover:border-red-300">{'{ }'}</button>
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
        <pre className="p-4 overflow-auto text-xs font-mono text-zinc-700 bg-zinc-50 rounded-b-xl">{JSON.stringify(json, null, 2)}</pre>
      </div>
    </div>
  );
  if (loading) return <div className="space-y-3">{seletor}<div className="flex items-center justify-center py-12"><div className="w-6 h-6 border-2 border-red-500 border-t-transparent rounded-full animate-spin" /></div></div>;
  if (error) return <div className="space-y-3">{seletor}<div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">Falha ao carregar: {error}</div></div>;
  return <div className="space-y-3">{seletor}{conteudo()}{modal}</div>;

  function conteudo() {

  if (view === 'pedidos') {
    if (rows.length === 0) return <Empty />;
    // Bruto = itens + entrega. A taxa de serviço (cobrada do cliente e repassada ao iFood) vem negativa
    // da API e aparece na composição do líquido — somá-la aqui reduzia o bruto indevidamente.
    const bruto = rows.reduce((s, r) => s + n(r.gross_bag) + n(r.delivery_fee), 0);
    const saldo = rows.reduce((s, r) => s + n(r.sale_balance), 0);
    return (
      <div className="bg-white rounded-xl border border-zinc-100 overflow-hidden">
        <div className="px-4 py-3 border-b border-zinc-100 flex flex-wrap gap-4 text-xs text-zinc-600">
          <span><strong className="text-zinc-900">{rows.length}</strong> pedido(s)</span>
          <span>Bruto <strong className="text-zinc-900">{formatCurrency(bruto)}</strong></span>
          <span>Líquido para a loja <strong className="text-green-700">{formatCurrency(saldo)}</strong></span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[760px]">
            <thead className="bg-zinc-50 text-xs text-zinc-500">
              <tr>
                <th className="text-left px-3 py-2">Pedido</th><th className="text-left px-3 py-2">Data</th><th className="text-left px-3 py-2">Situação</th>
                <th className="text-left px-3 py-2">Pagamento</th><th className="text-right px-3 py-2">Bruto</th><th className="text-right px-3 py-2">Promoções</th>
                <th className="text-left px-3 py-2">Composição do líquido</th><th className="text-right px-3 py-2">Líquido</th><th className="px-3 py-2">API</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const metodos = (r.payment_methods ?? []) as any[];
                // Créditos (pagamento, promoção paga pelo iFood) primeiro; depois os descontos.
                const taxas = ((r.billing_entries ?? []) as any[]).filter((b) => Number(b.value) !== 0).sort((a, b) => Number(b.value) - Number(a.value));
                // Quem bancou as promoções do pedido (iFood, loja…), a partir do JSON original da venda.
                const patrocinios = ((r.raw?.benefits?.benefits ?? []) as any[]).flatMap((bf) => (bf?.sponsorships ?? []) as any[]).filter((sp) => Number(sp?.value) !== 0);
                const lojaPagou = patrocinios.some((sp) => /merchant|loja/i.test(String(sp?.name ?? '')));
                const quem = [...new Set(patrocinios.map((sp) => (/ifood/i.test(String(sp?.name ?? '')) ? 'iFood' : /merchant|loja/i.test(String(sp?.name ?? '')) ? 'loja' : String(sp?.name ?? ''))))].filter(Boolean).join(' + ');
                return (
                  <tr key={r.id} className="border-t border-zinc-100 align-top">
                    <td className="px-3 py-2 font-mono text-xs">#{r.short_id ?? String(r.sale_id).slice(0, 8)}</td>
                    <td className="px-3 py-2 text-xs whitespace-nowrap">{r.sale_created_at ? new Date(r.sale_created_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—'}</td>
                    <td className="px-3 py-2 text-xs">{pt(r.current_status)}</td>
                    <td className="px-3 py-2 text-xs">
                      {metodos.map((m, i) => (
                        <div key={i}>{[nm(m.method), m.card?.brand, m.wallet?.name, nm(m.type)].filter(Boolean).join(' · ')} <span className="text-zinc-400">({m.liability === 'IFOOD' ? 'pago ao iFood' : m.liability === 'MERCHANT' ? 'pago à loja' : m.liability ?? '—'})</span></div>
                      ))}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">{formatCurrency(n(r.gross_bag) + n(r.delivery_fee))}</td>
                    <td className={`px-3 py-2 text-right font-mono ${lojaPagou ? 'text-red-600' : 'text-zinc-700'}`}>
                      {n(r.benefits_total) ? formatCurrency(n(r.benefits_total)) : '—'}
                      {n(r.benefits_total) !== 0 && quem && <span className="block text-[11px] font-sans text-zinc-400">pago por {quem}</span>}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {taxas.map((b, i) => (
                        <div key={i} className="flex justify-between gap-2">
                          <span>{nm(b.name)}</span>
                          <span className={`font-mono ${Number(b.value) < 0 ? 'text-red-600' : 'text-green-700'}`}>{Number(b.value) > 0 ? '+' : ''}{formatCurrency(Number(b.value))}</span>
                        </div>
                      ))}
                      {taxas.length > 0 && (
                        <div className="flex justify-between gap-2 border-t border-zinc-200 mt-1 pt-1 font-semibold">
                          <span>= Líquido</span>
                          <span className="font-mono">{formatCurrency(taxas.reduce((s, b) => s + Number(b.value), 0))}</span>
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-green-700">{formatCurrency(n(r.sale_balance))}</td>
                    <td className="px-3 py-2 text-center">{verApi(r.raw)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  if (view === 'repasses') {
    if (rows.length === 0 && antecip.length === 0 && conf.length === 0) return <Empty />;
    // Fontes batem se as disponíveis diferem até R$ 0,05 entre si.
    const situacao = (c: { eventos: number | null; conciliacao: number | null; liquidado: number | null }) => {
      const vals = [c.eventos, c.conciliacao, c.liquidado].filter((v): v is number => v !== null);
      if (vals.length < 2) return { t: 'Só uma fonte', c: 'bg-zinc-100 text-zinc-600' };
      return Math.max(...vals) - Math.min(...vals) <= 0.05 ? { t: 'Conferido', c: 'bg-green-100 text-green-700' } : { t: 'Diferença', c: 'bg-amber-100 text-amber-700' };
    };
    const conta = (a: any) => (a ? `${a.bankName ?? a.bankNumber ?? ''} ag. ${a.branchCode ?? ''} c/c ${String(a.accountNumber ?? '').replace(/.(?=.{4})/g, '•')}${a.accountDigit ? '-' + a.accountDigit : ''}` : '—');
    return (
      <div className="space-y-4">
        {conf.length > 0 && (
          <div className="bg-white rounded-xl border border-zinc-100 overflow-hidden">
            <div className="px-4 py-3 border-b border-zinc-100">
              <p className="text-sm font-semibold text-zinc-800">Conferência entre fontes do iFood</p>
              <p className="text-xs text-zinc-500">Por data de repasse: soma dos eventos financeiros que afetam o repasse × relatório de conciliação × valor liquidado (tipo Repasse). As três devem bater.</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[640px]">
                <thead className="bg-zinc-50 text-xs text-zinc-500">
                  <tr><th className="text-left px-3 py-2">Repasse</th><th className="text-right px-3 py-2">Eventos</th><th className="text-right px-3 py-2">Conciliação</th><th className="text-right px-3 py-2">Liquidado</th><th className="text-left px-3 py-2">Situação</th></tr>
                </thead>
                <tbody>
                  {conf.map((c) => {
                    const st = situacao(c);
                    const cel = (v: number | null) => (v === null ? <span className="text-zinc-300">—</span> : formatCurrency(v));
                    return (
                      <tr key={c.data} className="border-t border-zinc-100">
                        <td className="px-3 py-2 whitespace-nowrap">{dBR(c.data)}</td>
                        <td className="px-3 py-2 text-right font-mono">{cel(c.eventos)}</td>
                        <td className="px-3 py-2 text-right font-mono">{cel(c.conciliacao)}</td>
                        <td className="px-3 py-2 text-right font-mono">{cel(c.liquidado)}</td>
                        <td className="px-3 py-2"><span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${st.c}`}>{st.t}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="bg-white rounded-xl border border-zinc-100 overflow-hidden">
          <div className="px-4 py-3 border-b border-zinc-100">
            <p className="text-sm font-semibold text-zinc-800">Liquidações do iFood</p>
            <p className="text-xs text-zinc-500">Total: <strong>{formatCurrency(rows.reduce((s, r) => s + n(r.amount), 0))}</strong> · repasses, boletos e registro de recebíveis com data de pagamento neste mês.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[700px]">
              <thead className="bg-zinc-50 text-xs text-zinc-500">
                <tr><th className="text-left px-3 py-2">Pagamento</th><th className="text-left px-3 py-2">Tipo</th><th className="text-left px-3 py-2">Período apurado</th><th className="text-right px-3 py-2">Valor</th><th className="text-left px-3 py-2">Situação</th><th className="text-left px-3 py-2">Conta</th><th className="px-3 py-2">API</th></tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t border-zinc-100">
                    <td className="px-3 py-2 whitespace-nowrap">{dBR(r.payment_date)}</td>
                    <td className="px-3 py-2 text-xs">{TIPO_PT[String(r.type ?? '').toUpperCase()] ?? r.type ?? '—'}{r.product ? <span className="text-zinc-400"> · {r.product}</span> : null}</td>
                    <td className="px-3 py-2 text-xs">{dBR(r.calc_begin)} a {dBR(r.calc_end)}</td>
                    <td className={`px-3 py-2 text-right font-mono ${n(r.amount) < 0 || String(r.type).toUpperCase() === 'BOLETO' ? 'text-red-600' : 'text-green-700'}`}>{formatCurrency(n(r.amount))}</td>
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

        <div className="bg-white rounded-xl border border-zinc-100 overflow-hidden">
          <div className="px-4 py-3 border-b border-zinc-100">
            <p className="text-sm font-semibold text-zinc-800">Antecipações</p>
            <p className="text-xs text-zinc-500">Recebimentos adiantados pelo iFood, quantos dias antes e quanto isso custou — compare com esperar o prazo normal (D+30), que não tem taxa.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[760px]">
              <thead className="bg-zinc-50 text-xs text-zinc-500">
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
                      <td className="px-3 py-2 text-right font-mono">{formatCurrency(n(a.original_amount))}</td>
                      <td className="px-3 py-2 text-right font-mono text-red-600">{formatCurrency(n(a.fee_amount))} <span className="text-xs text-zinc-400">({pct.toFixed(2)}%)</span></td>
                      <td className="px-3 py-2 text-right font-mono text-green-700">{formatCurrency(n(a.anticipated_amount))}</td>
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
    <div className="bg-white rounded-xl border border-zinc-100 overflow-hidden">
      <div className="px-4 py-3 border-b border-zinc-100 flex flex-wrap items-center gap-4 text-xs text-zinc-600">
        <span><strong className="text-zinc-900">{eventos.length}</strong> evento(s)</span>
        <span>Efeito no repasse <strong className={saldo < 0 ? 'text-red-600' : 'text-green-700'}>{formatCurrency(saldo)}</strong></span>
        <label className="flex items-center gap-1.5 cursor-pointer ml-auto">
          <input type="checkbox" checked={soImpacto} onChange={(e) => setSoImpacto(e.target.checked)} className="rounded" /> Só o que afeta o repasse
        </label>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[760px]">
          <thead className="bg-zinc-50 text-xs text-zinc-500">
            <tr><th className="text-left px-3 py-2">Data</th><th className="text-left px-3 py-2">Evento</th><th className="text-left px-3 py-2">Gatilho</th><th className="text-left px-3 py-2">Pagamento</th><th className="text-right px-3 py-2">Valor</th><th className="text-left px-3 py-2">Repasse previsto</th><th className="px-3 py-2">API</th></tr>
          </thead>
          <tbody>
            {eventos.map((e) => (
              <tr key={e.id} className={`border-t border-zinc-100 ${e.has_transfer_impact ? '' : 'text-zinc-400'}`}>
                <td className="px-3 py-2 text-xs whitespace-nowrap">{e.event_at ? new Date(e.event_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—'}</td>
                <td className="px-3 py-2 text-xs">{nm(e.name)}{e.description && nm(e.description) !== nm(e.name) ? <span className="text-zinc-400"> · {nm(e.description)}</span> : null}{e.fee_percentage ? <span className="text-zinc-400"> · {(n(e.fee_percentage) <= 1 ? n(e.fee_percentage) * 100 : n(e.fee_percentage)).toFixed(1)}% de {formatCurrency(n(e.base_value))}</span> : null}</td>
                <td className="px-3 py-2 text-xs">{nm(e.trigger) || '—'}</td>
                <td className="px-3 py-2 text-xs">{[nm(e.payment_method), e.payment_brand].filter(Boolean).join(' · ') || '—'}{e.payment_liability ? <span className="text-zinc-400"> ({e.payment_liability === 'IFOOD' ? 'iFood' : e.payment_liability === 'MERCHANT' ? 'loja' : e.payment_liability})</span> : null}</td>
                <td className={`px-3 py-2 text-right font-mono ${n(e.amount) < 0 ? 'text-red-600' : 'text-green-700'}`}>{formatCurrency(n(e.amount))}</td>
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
