import { useEffect, useMemo, useState } from 'react';
import { getPeriodDates, getPeriodoAnterior } from '@/lib/dateUtils';
import { fetchPedidosIfood, resumir, type PedidoIfood } from '@/lib/ifoodDashboard';
import { useSalesReport } from '@/hooks/useSalesReport';
import { brl, brlInteiro, CartaoBarra, Nota, SecaoTitulo, Vazio } from '@/components/kit';
import RelatorioIfood from '@/pages/relatorios/components/IfoodTab';
import { nomeLoja, type AbaProps } from '../lib/tipos';
import { dividirDescontos } from '../lib/dinheiro';
import { rotuloPeriodo } from './PeriodoFolha';

// Aba Resultados da área iFood (protótipo docs/prototipos/ifood-proposta.html › Resultados).
// Em cima, a frase e poucos números; embaixo, o relatório completo de antes (Relatórios › iFood) inteiro.

const pct = (v: number, casas = 0) => `${v.toFixed(casas).replace('.', ',')}%`;
/** O iFood pagando muita promoção da própria loja: se ele parar, a loja sente. */
const LIMITE_PROMO_IFOOD = 15;

function inicioDaFrase(periodo: string): string {
  if (periodo === '30 dias' || periodo === '30d') return 'Últimos 30 dias';
  if (periodo === '7 dias' || periodo === '7d') return 'Últimos 7 dias';
  const t = rotuloPeriodo(periodo);
  return t.startsWith('custom') ? 'No período' : t;
}

const variacao = (atual: number, ant: number): number | null => (ant > 0 ? ((atual - ant) / ant) * 100 : null);

/** Seta com a variação contra o período anterior. `pp` = diferença em pontos percentuais; `inverso` = cair é bom. */
function Variacao({ v, pp, inverso }: { v: number | null; pp?: boolean; inverso?: boolean }) {
  if (v == null || !Number.isFinite(v) || Math.abs(v) < (pp ? 0.05 : 0.5)) return null;
  const bom = inverso ? v < 0 : v > 0;
  return (
    <em className={`not-italic text-[11px] font-extrabold ${bom ? 'text-emerald-600' : 'text-red-600'}`}>
      {v > 0 ? '▲' : '▼'} {pp ? `${Math.abs(v).toFixed(1).replace('.', ',')} p.p.` : pct(Math.abs(v))}
    </em>
  );
}

function Numero({ valor, rotulo, variacao: v }: { valor: string; rotulo: string; variacao?: React.ReactNode }) {
  return (
    <div className="bg-white border border-zinc-200 rounded-2xl px-3 py-2.5 md:px-4">
      <p className="text-[19px] md:text-2xl font-extrabold leading-tight tabular-nums text-zinc-900 truncate">{valor}</p>
      <p className="text-[11px] font-semibold text-zinc-400 mt-0.5 flex items-center gap-1.5 flex-wrap">{rotulo} {v}</p>
    </div>
  );
}

export default function ResultadosAba({ tenantId, loja, lojas, periodo, dados }: AbaProps) {
  const { data: erp, loading: carregandoLoja } = useSalesReport(periodo);

  // Período anterior (mesma conta do relatório antigo: getPeriodoAnterior).
  const [anterior, setAnterior] = useState<PedidoIfood[] | null>(null);
  useEffect(() => {
    if (!tenantId) return;
    let vivo = true;
    setAnterior(null);
    const ant = getPeriodDates(getPeriodoAnterior(periodo));
    fetchPedidosIfood(tenantId, ant.from, ant.to).then((d) => { if (vivo) setAnterior(d.error ? [] : d.pedidos); });
    return () => { vivo = false; };
  }, [tenantId, periodo]);

  const fin = useMemo(() => dados.fin.filter((p) => !loja || p.loja === loja), [dados.fin, loja]);
  const finAnt = useMemo(() => (anterior ?? []).filter((p) => !loja || p.loja === loja), [anterior, loja]);
  const r = useMemo(() => resumir(fin), [fin]);
  const ra = useMemo(() => resumir(finAnt), [finAnt]);

  const chegaPct = r.vendas > 0 ? (r.liquido / r.vendas) * 100 : 0;
  const chegaPctAnt = ra.vendas > 0 ? (ra.liquido / ra.vendas) * 100 : null;
  const totalPed = r.pedidos + r.cancelados;
  const cancelPct = totalPed > 0 ? (r.cancelados / totalPed) * 100 : 0;
  const totalPedAnt = ra.pedidos + ra.cancelados;
  const cancelPctAnt = totalPedAnt > 0 ? (ra.cancelados / totalPedAnt) * 100 : null;

  // Peso no faturamento: MESMA conta do relatório antigo ("Peso no faturamento"): vendas do iFood ÷ (iFood +
  // vendas do PDV no período), só com todas as lojas do iFood e quando o PDV vendeu algo.
  const vendasLoja = erp?.total_revenue ?? 0;
  const peso = !loja && vendasLoja > 0 ? (r.vendas / (r.vendas + vendasLoja)) * 100 : null;

  // Lojas lado a lado: sempre as lojas do período (a escolha de loja no topo não esconde a comparação).
  const porLoja = useMemo(() => {
    const ids = [...new Set(dados.fin.map((p) => p.loja))];
    return ids.map((id) => {
      const x = resumir(dados.fin.filter((p) => p.loja === id));
      return { id, nome: nomeLoja(lojas, id), ...x, chegaPct: x.vendas > 0 ? (x.liquido / x.vendas) * 100 : 0, promoIfoodPct: x.vendas > 0 ? (x.promoIfood / x.vendas) * 100 : 0 };
    }).sort((a, b) => b.vendas - a.vendas);
  }, [dados.fin, lojas]);

  const descontos = useMemo(() => dividirDescontos(r), [r]);

  // Clientes: só pedidos que chegaram pelo módulo Pedidos (têm `order`) e trazem o contador do iFood.
  const clientes = useMemo(() => {
    const vendaPorId = new Map(fin.map((p) => [p.id, p.vendas]));
    const base = dados.orders.filter((o) => !o.teste && o.status !== 'cancelled' && (!loja || o.loja === loja) && o.pedidosAntes != null);
    const valor = (o: (typeof base)[number]) => vendaPorId.get(o.id) ?? o.subTotal;
    const novos = base.filter((o) => (o.pedidosAntes ?? 0) === 0);
    const voltam = base.filter((o) => (o.pedidosAntes ?? 0) > 0);
    const media = (xs: typeof base) => (xs.length ? xs.reduce((s, o) => s + valor(o), 0) / xs.length : 0);
    return {
      n: base.length, novos: novos.length, voltam: voltam.length,
      pctNovos: base.length ? (novos.length / base.length) * 100 : 0,
      ticketNovo: media(novos), ticketVoltam: media(voltam),
    };
  }, [dados.orders, fin, loja]);

  if (dados.carregando) {
    return <div className="flex items-center justify-center py-16"><div className="w-6 h-6 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" /></div>;
  }

  const semPedidos = fin.length === 0;

  return (
    <div className="space-y-4">
      {semPedidos ? (
        <Vazio icone="ri-line-chart-line" titulo="Nenhum pedido do iFood neste período">
          Escolha outro período. Os números vêm do relatório do iFood e dos pedidos que chegam ao ERPOS.
        </Vazio>
      ) : (
        <>
          {/* Frase */}
          <div>
            <h2 className="text-[22px] md:text-2xl font-extrabold tracking-tight text-zinc-900 leading-tight">
              {peso != null
                ? <>O iFood é {pct(peso)} do que a loja vende</>
                : loja
                  ? <>{nomeLoja(lojas, loja)} vendeu {brlInteiro(r.vendas)} no iFood</>
                  : <>O iFood vendeu {brlInteiro(r.vendas)}</>}
            </h2>
            <p className="text-sm text-zinc-500 mt-1">
              {inicioDaFrase(periodo)}: {brlInteiro(r.vendas)} no iFood
              {peso != null ? <> e {brlInteiro(vendasLoja)} na loja (totem, caixa, delivery próprio).</> : '.'}
              {carregandoLoja && !loja ? ' Conferindo as vendas da loja…' : ''}
            </p>
          </div>

          {/* 4 números */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
            <Numero valor={String(r.pedidos)} rotulo="pedidos" variacao={<Variacao v={variacao(r.pedidos, ra.pedidos)} />} />
            <Numero valor={brl(r.ticket)} rotulo="ticket médio" variacao={<Variacao v={variacao(r.ticket, ra.ticket)} />} />
            <Numero valor={pct(chegaPct)} rotulo="chega na loja" variacao={<Variacao pp v={chegaPctAnt == null ? null : chegaPct - chegaPctAnt} />} />
            <Numero valor={pct(cancelPct, 1)} rotulo="cancelados" variacao={<Variacao pp inverso v={cancelPctAnt == null ? null : cancelPct - cancelPctAnt} />} />
          </div>
          {anterior == null && <p className="text-[11px] text-zinc-400 -mt-2">Buscando o período anterior para comparar…</p>}

          {/* Lojas lado a lado */}
          {porLoja.length >= 2 && (
            <div>
              <SecaoTitulo titulo="Lojas lado a lado" />
              <div className="grid md:grid-cols-2 gap-2">
                {porLoja.map((l) => {
                  const forte = l.promoIfoodPct >= LIMITE_PROMO_IFOOD;
                  return (
                    <CartaoBarra key={l.id} cor={forte ? 'amber' : 'green'}>
                      <div className="flex items-baseline gap-2">
                        <b className="flex-1 min-w-0 truncate text-[14.5px] font-extrabold text-zinc-900">{l.nome}</b>
                        <span className="text-[15px] font-extrabold tabular-nums text-zinc-900">{brlInteiro(l.vendas)}</span>
                      </div>
                      <p className="text-[12.5px] text-zinc-600 mt-1 leading-relaxed">
                        {l.pedidos} pedidos · ticket <b>{brl(l.ticket)}</b> · chega <b>{pct(l.chegaPct)}</b>
                        {' '}· promoção paga pela loja <b>{brlInteiro(l.promoLoja)}</b>
                        {' '}· promoção paga pelo iFood <b>{brlInteiro(l.promoIfood)}</b> ({pct(l.promoIfoodPct, 1)} das vendas)
                      </p>
                      {forte && (
                        <p className="text-[12.5px] text-amber-800 bg-amber-50 rounded-lg px-2.5 py-1.5 mt-2 leading-snug">
                          <b>O iFood pagou {brlInteiro(l.promoIfood)} de promoção</b> ({pct(l.promoIfoodPct)} do que a {l.nome} vendeu).
                          {' '}Se o iFood parar essa promoção, a {l.nome} sente.
                        </p>
                      )}
                    </CartaoBarra>
                  );
                })}
              </div>
            </div>
          )}

          {/* Descontos */}
          <div>
            <SecaoTitulo titulo="Descontos" sub="dados aos clientes" />
            {descontos.total < 0.005 ? (
              <Nota>Nenhum desconto para clientes neste período.</Nota>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <CartaoBarra cor="amber">
                  <p className="text-[11px] font-bold text-zinc-400">Pago pela loja</p>
                  <p className="text-lg font-extrabold tabular-nums text-zinc-900">{brl(descontos.loja)}</p>
                  <p className="text-[11.5px] text-zinc-500">{pct(descontos.pctLoja, 1)} das vendas</p>
                </CartaoBarra>
                <CartaoBarra cor="green">
                  <p className="text-[11px] font-bold text-zinc-400">Pago pelo iFood</p>
                  <p className="text-lg font-extrabold tabular-nums text-zinc-900">{brl(descontos.ifood)}</p>
                  <p className="text-[11.5px] text-zinc-500">{pct(descontos.pctIfood, 1)} das vendas</p>
                </CartaoBarra>
              </div>
            )}
          </div>

          {/* Clientes */}
          <div>
            <SecaoTitulo titulo="Clientes" />
            {clientes.n > 0 && (
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 mb-2">
                <Numero valor={`${clientes.novos}`} rotulo={`novos (${pct(clientes.pctNovos)})`} />
                <Numero valor={`${clientes.voltam}`} rotulo="já pediam" />
                <Numero valor={clientes.novos ? brl(clientes.ticketNovo) : '—'} rotulo="ticket do novo" />
                <Numero valor={clientes.voltam ? brl(clientes.ticketVoltam) : '—'} rotulo="ticket de quem volta" />
              </div>
            )}
            {clientes.n === 0 && <p className="text-[13px] text-zinc-600 mb-2">Ainda não há pedidos neste período com a informação do cliente.</p>}
            <Nota>Começa a contar desde que os pedidos passaram a chegar no ERPOS (05/10/2026). O iFood não passa o telefone do cliente.</Nota>
          </div>
        </>
      )}

      <div>
        <SecaoTitulo titulo="Relatório completo" sub="tudo o que estava em Relatórios › iFood" />
        <RelatorioIfood periodo={periodo} />
      </div>
    </div>
  );
}
