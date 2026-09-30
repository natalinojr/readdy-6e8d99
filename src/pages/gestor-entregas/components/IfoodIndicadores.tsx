import { useCallback, useEffect, useState } from 'react';
import { ifoodShipping } from '@/lib/ifoodShipping';

// Indicadores do iFood (módulo Analytics do app ERPOS PDV): KPIs históricos D-1, sempre agregados por loja/dia.
// Critérios de homologação atendidos aqui: período visível e escolhível, aviso D-1, GMV/ticket/pedidos/cancelamento,
// distribuições por canal/status/pagamento/logística e mensagens de erro claras. Regras na edge (ifood-shipping/analytics.ts).

interface Resumo {
  gmv: number | null; gmvSemEntrega: number | null; taxaEntrega: number | null; ticket: number | null;
  pedidosConcluidos: number; pedidosCancelados: number; taxaCancelamento: number | null;
  porStatus: Record<string, number>; porCanal: Record<string, number>; porLogistica: Record<string, number>;
  porPagamento: Record<string, number>; porDiaSemana: Record<string, number>;
  porCanalEntrega: Linha[];
}
interface Linha { canal: string | null; logistica: string | null; pedidos: number; gmv: number | null; ticket: number | null }
interface Periodo { de: string; ate: string; dias: number; ajustado: boolean; homologacao: boolean }

const ROTULO: Record<string, string> = {
  IFOOD: 'iFood', DIGITAL_CATALOG: 'Cardápio digital', POS: 'Balcão (POS)', EMBEDDED_UBER: 'Uber (iFood no app da Uber)',
  IFOOD_DELIVERY: 'Entrega iFood', MERCHANT_DELIVERY: 'Entrega própria', DINE_IN: 'Consumo no local',
  CONCLUDED: 'Concluídos', CANCELLED: 'Cancelados',
  CREDIT: 'Crédito', DEBIT: 'Débito', PIX: 'Pix', CASH: 'Dinheiro', MEAL_VOUCHER: 'Vale-refeição', FOOD_VOUCHER: 'Vale-alimentação',
  DIGITAL_WALLET: 'Carteira digital', ONLINE: 'Online', VOUCHER: 'Voucher', OTHER_VOUCHER: 'Outros vouchers', BANK_PAY: 'Pagamento pelo banco', OTHER: 'Outros',
};
const DIA_SEMANA: Record<string, string> = { 1: 'Seg', 2: 'Ter', 3: 'Qua', 4: 'Qui', 5: 'Sex', 6: 'Sáb', 7: 'Dom' };
const rot = (k: string | null) => (k ? ROTULO[k] ?? k : '—');
const brl = (v: number | null | undefined) => (v === null || v === undefined ? '—' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
const br = (iso: string) => iso.split('-').reverse().join('/');
const inp = 'px-2 py-1.5 rounded-lg border border-zinc-200 focus:border-red-400 outline-none text-xs';

// Datas em São Paulo (os dados do iFood fecham por dia).
const hoje = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
const somaDias = (iso: string, n: number) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const ONTEM = () => somaDias(hoje(), -1);

function Distribuicao({ titulo, dados, ordem }: { titulo: string; dados: Record<string, number>; ordem?: (a: [string, number], b: [string, number]) => number }) {
  const itens = Object.entries(dados).sort(ordem ?? ((a, b) => b[1] - a[1]));
  const total = itens.reduce((s, [, n]) => s + n, 0);
  return (
    <div className="rounded-xl border border-zinc-200 p-3 space-y-1.5">
      <p className="font-bold text-zinc-700">{titulo}</p>
      {itens.length === 0 && <p className="text-zinc-400">Sem pedidos no período.</p>}
      {itens.map(([k, n]) => (
        <div key={k}>
          <div className="flex justify-between text-zinc-600"><span>{titulo === 'Dia da semana' ? DIA_SEMANA[k] ?? k : rot(k)}</span><span className="font-semibold">{n} <span className="text-zinc-400 font-normal">({total ? Math.round((n / total) * 100) : 0}%)</span></span></div>
          <div className="h-1.5 bg-zinc-100 rounded-full overflow-hidden"><div className="h-full bg-red-400" style={{ width: `${total ? (n / total) * 100 : 0}%` }} /></div>
        </div>
      ))}
    </div>
  );
}

export default function IfoodIndicadores({ tenantId, merchantId }: { tenantId: string; merchantId: string }) {
  const [de, setDe] = useState(() => somaDias(ONTEM(), -6));
  const [ate, setAte] = useState(ONTEM);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState('');
  const [periodo, setPeriodo] = useState<Periodo | null>(null);
  const [resumo, setResumo] = useState<Resumo | null>(null);
  const [payload, setPayload] = useState<string>('');
  const [gerando, setGerando] = useState(false);
  const [copiado, setCopiado] = useState(false);

  const consultar = useCallback(async (d = de, a = ate) => {
    if (!merchantId) return;
    setCarregando(true); setErro('');
    const r = await ifoodShipping<{ periodo: Periodo; resumo: Resumo }>('analytics_kpis', tenantId, { merchant_id: merchantId, de: d, ate: a });
    setCarregando(false);
    if (!r.success) { setErro(r.error ?? 'Não foi possível consultar os indicadores.'); setResumo(null); return; }
    setPeriodo(r.periodo); setResumo(r.resumo);
    if (r.periodo.ajustado) { setAte(r.periodo.ate); }
  }, [tenantId, merchantId, de, ate]);

  useEffect(() => { consultar(); }, [merchantId]); // eslint-disable-line react-hooks/exhaustive-deps

  const atalho = (dias: number) => { const a = ONTEM(); const d = somaDias(a, -(dias - 1)); setDe(d); setAte(a); consultar(d, a); };
  const mesPassado = () => {
    const h = hoje(); const ini = `${h.slice(0, 7)}-01`; const a = somaDias(ini, -1); const d = `${a.slice(0, 7)}-01`;
    setDe(d); setAte(a); consultar(d, a);
  };

  const gerarPayload = async () => {
    setGerando(true); setErro(''); setCopiado(false);
    const r = await ifoodShipping<{ request: unknown; response: unknown }>('analytics_kpis', tenantId, { merchant_id: merchantId, de, ate, homologacao: true });
    setGerando(false);
    if (!r.success) { setErro(r.error ?? 'Falhou.'); return; }
    setPayload(JSON.stringify(r.response, null, 2));
  };
  const copiar = async () => { try { await navigator.clipboard.writeText(payload); setCopiado(true); } catch { setCopiado(false); } };

  const cards: [string, string, string][] = resumo ? [
    ['Faturamento (GMV)', brl(resumo.gmv), 'Pedidos concluídos: produtos + taxa de entrega, já sem taxa de serviço e subsídios da loja.'],
    ['GMV sem entrega', brl(resumo.gmvSemEntrega), 'O mesmo faturamento sem a taxa de entrega paga pelo cliente.'],
    ['Ticket médio', brl(resumo.ticket), 'Faturamento ÷ pedidos concluídos.'],
    ['Pedidos concluídos', String(resumo.pedidosConcluidos), 'Pedidos entregues/finalizados no período.'],
    ['Pedidos cancelados', String(resumo.pedidosCancelados), 'Cancelados por qualquer motivo (loja, cliente, iFood).'],
    ['Taxa de cancelamento', resumo.taxaCancelamento === null ? '—' : `${(resumo.taxaCancelamento * 100).toFixed(1).replace('.', ',')}%`, 'Cancelados ÷ (concluídos + cancelados).'],
  ] : [];

  return (
    <div className="space-y-4">
      <div className="rounded-lg p-2.5 bg-amber-50 border border-amber-100 text-amber-800 flex gap-2">
        <i className="ri-history-line text-base leading-none mt-0.5" />
        <p><b>Dados históricos (D-1):</b> o iFood fecha os números do dia depois da meia-noite, então os indicadores vão até <b>ontem</b>. Pedidos de hoje ainda não aparecem aqui. Os valores são sempre somados por loja e dia (nunca pedido a pedido).</p>
      </div>

      <section className="space-y-2">
        <div className="flex flex-wrap items-end gap-2">
          <label className="space-y-0.5"><span className="block text-zinc-500">De</span><input type="date" value={de} max={ONTEM()} onChange={(e) => setDe(e.target.value)} className={inp} /></label>
          <label className="space-y-0.5"><span className="block text-zinc-500">Até</span><input type="date" value={ate} max={ONTEM()} onChange={(e) => setAte(e.target.value)} className={inp} /></label>
          <button onClick={() => consultar()} disabled={carregando} className="px-3 py-1.5 rounded-lg bg-zinc-800 text-white font-semibold disabled:opacity-50"><i className="ri-search-line" /> Consultar</button>
        </div>
        <div className="flex flex-wrap gap-1">
          <button onClick={() => atalho(7)} className="px-2 py-1 rounded-lg bg-zinc-100 text-zinc-600">Últimos 7 dias</button>
          <button onClick={() => atalho(30)} className="px-2 py-1 rounded-lg bg-zinc-100 text-zinc-600">Últimos 30 dias</button>
          <button onClick={mesPassado} className="px-2 py-1 rounded-lg bg-zinc-100 text-zinc-600">Mês passado</button>
        </div>
        {periodo && !carregando && (
          <p className="text-zinc-600"><i className="ri-calendar-line" /> Período consultado: <b>{br(periodo.de)} a {br(periodo.ate)}</b> ({periodo.dias} {periodo.dias === 1 ? 'dia' : 'dias'})
            {periodo.ajustado && <span className="text-amber-700"> — o fim foi ajustado para ontem (D-1).</span>}
            {periodo.homologacao && <span className="ml-1 px-1.5 py-0.5 rounded bg-violet-100 text-violet-700 font-semibold">ambiente de teste do iFood</span>}
          </p>
        )}
      </section>

      {erro && <p className="rounded-lg p-2 border text-red-600 bg-red-50 border-red-100"><i className="ri-error-warning-line" /> {erro}</p>}
      {carregando && <div className="flex justify-center py-6"><div className="w-5 h-5 border-2 border-red-500 border-t-transparent rounded-full animate-spin" /></div>}

      {resumo && !carregando && (
        <>
          <section className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {cards.map(([t, v, dica]) => (
              <div key={t} className="rounded-xl border border-zinc-200 p-3" title={dica}>
                <p className="text-zinc-500">{t}</p>
                <p className="text-base font-bold text-zinc-800">{v}</p>
                <p className="text-[10px] text-zinc-400 leading-tight mt-0.5">{dica}</p>
              </div>
            ))}
          </section>

          <section className="grid sm:grid-cols-2 gap-2">
            <Distribuicao titulo="Canal de venda" dados={resumo.porCanal} />
            <Distribuicao titulo="Status do pedido" dados={resumo.porStatus} />
            <Distribuicao titulo="Forma de pagamento" dados={resumo.porPagamento} />
            <Distribuicao titulo="Quem entrega" dados={resumo.porLogistica} />
            <Distribuicao titulo="Dia da semana" dados={resumo.porDiaSemana} ordem={(a, b) => Number(a[0]) - Number(b[0])} />
          </section>

          <section className="rounded-xl border border-zinc-200 overflow-x-auto">
            <p className="font-bold text-zinc-700 px-3 pt-3">Faturamento por canal e entrega (pedidos concluídos)</p>
            <table className="w-full mt-2">
              <thead className="text-zinc-500 bg-zinc-50"><tr><th className="text-left px-3 py-1.5">Canal</th><th className="text-left px-3 py-1.5">Entrega</th><th className="text-right px-3 py-1.5">Pedidos</th><th className="text-right px-3 py-1.5">GMV</th><th className="text-right px-3 py-1.5">Ticket</th></tr></thead>
              <tbody>
                {resumo.porCanalEntrega.length === 0 && <tr><td colSpan={5} className="px-3 py-2 text-zinc-400">Sem pedidos concluídos no período.</td></tr>}
                {resumo.porCanalEntrega.map((l, i) => (
                  <tr key={i} className="border-t border-zinc-100"><td className="px-3 py-1.5">{rot(l.canal)}</td><td className="px-3 py-1.5">{rot(l.logistica)}</td><td className="px-3 py-1.5 text-right">{l.pedidos}</td><td className="px-3 py-1.5 text-right">{brl(l.gmv)}</td><td className="px-3 py-1.5 text-right">{brl(l.ticket)}</td></tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}

      {periodo?.homologacao && (
        <section className="rounded-xl border border-violet-200 bg-violet-50/50 p-3 space-y-2">
          <p className="font-bold text-violet-800">Homologação do iFood (Analytics)</p>
          <p className="text-violet-700">Gera a chamada do exemplo da documentação com <code>x-request-homologation: true</code> e mostra a resposta — é o payload que o wizard do Portal do Desenvolvedor (Homologação › Nova homologação) pede.</p>
          <div className="flex gap-2">
            <button onClick={gerarPayload} disabled={gerando} className="px-3 py-1.5 rounded-lg bg-violet-600 text-white font-semibold disabled:opacity-50">{gerando ? 'Consultando…' : 'Gerar payload de homologação'}</button>
            {payload && <button onClick={copiar} className="px-3 py-1.5 rounded-lg bg-white border border-violet-200 text-violet-700 font-semibold"><i className="ri-file-copy-line" /> {copiado ? 'Copiado!' : 'Copiar'}</button>}
          </div>
          {payload && <pre className="max-h-64 overflow-auto rounded-lg bg-zinc-900 text-zinc-100 p-2 text-[10px]">{payload}</pre>}
        </section>
      )}
    </div>
  );
}
