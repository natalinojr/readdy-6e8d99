import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase, invokeWithAuth } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { formatCurrency } from '@/lib/formatters';
import { todayBrasilia } from '@/lib/dateUtils';
import IfoodConfigModal from './conciliacao/IfoodConfigModal';

// Aba iFood: o relatório de conciliação do iFood (fin_ifood_entries, gravado pela edge
// ifood-financial) por competência — vendas, comissões/taxas, promoções e repasses,
// com a conferência de cada repasse contra os créditos do iFood no extrato do Inter.

interface ImportRow {
  id: string; competence: string; source: 'api' | 'file'; file_name: string | null;
  lines: number; orders: number; gross: number; fees: number; net: number; updated_at: string;
}
interface EntryRow {
  fato_gerador: string | null; tipo_lancamento: string | null; descricao: string | null;
  valor: number; impacto_repasse: boolean; responsavel: string | null; order_id: string | null;
  data_repasse: string | null;
}
interface RepasseRow {
  data_repasse: string; esperado: number; depositos: number; recebido_inter: number; linhas_inter: number;
  detalhe: { ifood: { valor: number; metodo: string | null }[]; inter: { data: string; valor: number; descricao: string | null }[] };
}

const compLabel = (c: string) => {
  const nomes = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  return `${nomes[Number(c.slice(5, 7)) - 1]} de ${c.slice(0, 4)}`;
};
const dataBR = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
// Mesma regra da edge: receita = entradas e subsídios; taxas = cobranças e retenções.
const isRevenue = (e: EntryRow) => /entrada|subs[ií]dio/i.test(e.tipo_lancamento ?? '') || (!/cobran|reten/i.test(e.tipo_lancamento ?? '') && e.valor > 0);

function Kpi({ label, value, sub, tone = 'zinc' }: { label: string; value: string; sub?: string; tone?: 'zinc' | 'green' | 'red' | 'amber' }) {
  const color = { zinc: 'text-zinc-900', green: 'text-green-700', red: 'text-red-600', amber: 'text-amber-700' }[tone];
  return (
    <div className="bg-white rounded-xl border border-zinc-100 p-4">
      <p className="text-xs text-zinc-500">{label}</p>
      <p className={`text-xl font-bold mt-1 ${color}`}>{value}</p>
      {sub && <p className="text-[11px] text-zinc-400 mt-0.5">{sub}</p>}
    </div>
  );
}

export default function IfoodTab() {
  const { user } = useAuth();
  const [imports, setImports] = useState<ImportRow[]>([]);
  const [competence, setCompetence] = useState<string>('');
  const [entries, setEntries] = useState<EntryRow[]>([]);
  const [repasses, setRepasses] = useState<RepasseRow[]>([]);
  const [postToLedger, setPostToLedger] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showConfig, setShowConfig] = useState(false);
  const [togglingLedger, setTogglingLedger] = useState(false);
  const [openRepasse, setOpenRepasse] = useState<string | null>(null);

  const loadImports = useCallback(async () => {
    if (!user?.tenantId) return;
    const [{ data, error: err }, cfg] = await Promise.all([
      supabase.from('fin_ifood_imports')
        .select('id, competence, source, file_name, lines, orders, gross, fees, net, updated_at')
        .eq('tenant_id', user.tenantId).order('competence', { ascending: false }),
      invokeWithAuth<{ config?: { post_to_ledger?: boolean } | null }>('ifood-financial', { body: { action: 'get_config', tenant_id: user.tenantId } }),
    ]);
    if (err) { setError(err.message); setLoading(false); return; }
    const rows = (data ?? []) as ImportRow[];
    setImports(rows);
    setPostToLedger(cfg.data?.config?.post_to_ledger === true);
    setCompetence((c) => (c && rows.some((r) => r.competence === c) ? c : rows[0]?.competence ?? ''));
    if (rows.length === 0) setLoading(false);
  }, [user?.tenantId]);

  const loadCompetence = useCallback(async () => {
    if (!user?.tenantId || !competence) return;
    setLoading(true);
    const { data, error: err } = await supabase.from('fin_ifood_entries')
      .select('fato_gerador, tipo_lancamento, descricao, valor, impacto_repasse, responsavel, order_id, data_repasse')
      .eq('tenant_id', user.tenantId).eq('competence', competence).limit(20000);
    if (err) { setError(err.message); setLoading(false); return; }
    const rows = ((data ?? []) as EntryRow[]).map((e) => ({ ...e, valor: Number(e.valor) }));
    setEntries(rows);
    const datas = rows.map((e) => e.data_repasse).filter(Boolean).sort() as string[];
    if (datas.length > 0) {
      const { data: rep, error: rErr } = await supabase.rpc('fin_ifood_repasses', { p_tenant: user.tenantId, p_from: datas[0], p_to: datas[datas.length - 1] });
      if (rErr) setError(rErr.message);
      setRepasses(((rep ?? []) as RepasseRow[]).map((r) => ({ ...r, esperado: Number(r.esperado), recebido_inter: Number(r.recebido_inter) })));
    } else setRepasses([]);
    setError(null);
    setLoading(false);
  }, [user?.tenantId, competence]);

  useEffect(() => { loadImports(); }, [loadImports]);
  useEffect(() => { loadCompetence(); }, [loadCompetence]);

  const resumo = useMemo(() => {
    const sig = entries.filter((e) => e.impacto_repasse);
    const vendas = sig.filter(isRevenue).reduce((s, e) => s + e.valor, 0);
    const taxasMap = new Map<string, number>();
    for (const e of sig.filter((x) => !isRevenue(x))) {
      const k = e.descricao || e.tipo_lancamento || 'Outros';
      taxasMap.set(k, (taxasMap.get(k) ?? 0) - e.valor);
    }
    const taxas = [...taxasMap.values()].reduce((s, v) => s + v, 0);
    const promoLoja = -entries.filter((e) => !e.impacto_repasse && /promo/i.test(e.descricao ?? '')).reduce((s, e) => s + e.valor, 0);
    const promoIfood = entries.filter((e) => e.impacto_repasse && /promo[çc][ãa]o custeada pelo ifood/i.test(e.descricao ?? '')).reduce((s, e) => s + e.valor, 0);
    const recebidoLoja = entries.filter((e) => !e.impacto_repasse && (e.responsavel ?? '').toUpperCase() === 'LOJA' && e.valor > 0).reduce((s, e) => s + e.valor, 0);
    const pedidos = new Set(entries.filter((e) => e.fato_gerador === 'Venda' && e.order_id).map((e) => e.order_id)).size;
    const cancelados = new Set(entries.filter((e) => /cancelamento/i.test(e.fato_gerador ?? '') && e.order_id).map((e) => e.order_id)).size;
    return {
      vendas, taxas, liquido: vendas - taxas, promoLoja, promoIfood, recebidoLoja, pedidos, cancelados,
      ticket: pedidos > 0 ? vendas / pedidos : 0,
      taxaEfetiva: vendas > 0 ? (taxas / vendas) * 100 : 0,
      taxasLista: [...taxasMap.entries()].filter(([, v]) => Math.abs(v) > 0.004).sort((a, b) => b[1] - a[1]),
    };
  }, [entries]);

  const toggleLedger = async () => {
    if (!user?.tenantId) return;
    setTogglingLedger(true);
    const r = await invokeWithAuth<{ success?: boolean; error?: string }>('ifood-financial', { body: { action: 'set_options', tenant_id: user.tenantId, post_to_ledger: !postToLedger } });
    setTogglingLedger(false);
    if (r.data?.error || r.error) { setError(r.data?.error ?? r.error?.message ?? 'Falhou'); return; }
    setPostToLedger(!postToLedger);
  };

  const hoje = todayBrasilia();
  const imp = imports.find((i) => i.competence === competence);

  return (
    <div className="p-4 md:p-6 space-y-4 md:space-y-5">
      {/* Cabeçalho */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 flex items-center justify-center rounded-xl bg-red-100">
            <i className="ri-restaurant-2-line text-red-600" />
          </div>
          <div>
            <h2 className="text-base font-bold text-zinc-900">iFood</h2>
            <p className="text-xs text-zinc-500">Relatório de conciliação do iFood, por mês de venda</p>
          </div>
        </div>
        <div className="flex-1" />
        {imports.length > 0 && (
          <select value={competence} onChange={(e) => setCompetence(e.target.value)}
            className="border border-zinc-200 rounded-lg px-3 py-2 text-sm bg-white capitalize">
            {imports.map((i) => <option key={i.competence} value={i.competence}>{compLabel(i.competence)}</option>)}
          </select>
        )}
        <button onClick={() => setShowConfig(true)}
          className="flex items-center gap-1.5 px-3 py-2 bg-red-600 text-white rounded-lg text-sm font-semibold hover:bg-red-700 cursor-pointer whitespace-nowrap">
          <i className="ri-upload-2-line" /> Importar / configurar
        </button>
      </div>

      {/* Onde entra no resto do financeiro */}
      <div className={`flex flex-wrap items-start gap-2 rounded-lg border px-3 py-2 text-xs ${postToLedger ? 'bg-green-50 border-green-200 text-green-800' : 'bg-amber-50 border-amber-200 text-amber-800'}`}>
        <i className={`${postToLedger ? 'ri-checkbox-circle-line' : 'ri-information-line'} mt-0.5`} />
        <span className="flex-1 min-w-[220px]">
          {postToLedger
            ? <>As vendas do iFood entram em <strong>Receitas</strong>, <strong>DRE</strong> ("Vendas iFood") e <strong>Fluxo de Caixa</strong> na data de cada repasse já pago; as comissões e taxas entram em "Taxas de cartão, Pix e iFood". Receitas e DRE só mostram com a fonte "Conciliação iFood" ligada em Receitas › Fontes.</>
            : <>Os números abaixo ainda <strong>não entram</strong> na DRE nem em Receitas. Ligue o lançamento para as vendas e as taxas de cada repasse já pago irem para o financeiro.</>}
        </span>
        <button onClick={toggleLedger} disabled={togglingLedger || imports.length === 0}
          className={`px-2.5 py-1 rounded-md border font-semibold cursor-pointer whitespace-nowrap disabled:opacity-50 ${postToLedger ? 'border-green-300 hover:bg-green-100' : 'border-amber-300 hover:bg-amber-100'}`}>
          {togglingLedger ? 'Salvando...' : postToLedger ? 'Parar de lançar' : 'Lançar no financeiro'}
        </button>
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">Falha ao carregar: {error}</div>
      )}

      {!loading && imports.length === 0 ? (
        <div className="bg-white rounded-xl border border-zinc-100 p-8 text-center space-y-2">
          <i className="ri-file-excel-2-line text-3xl text-zinc-300" />
          <p className="text-sm font-semibold text-zinc-700">Nenhum relatório do iFood importado</p>
          <p className="text-xs text-zinc-500 max-w-md mx-auto">No Portal do Parceiro: Financeiro › Exportar, depois Relatórios › Exportações › Baixar (página cinza → Ctrl+S). Suba o arquivo em "Importar / configurar". Com a API conectada, entra sozinho todo dia às 07h20.</p>
        </div>
      ) : loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="w-6 h-6 border-2 border-red-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Kpi label="Vendas (base do repasse)" value={formatCurrency(resumo.vendas)} sub={`${resumo.pedidos} pedido(s) · ticket ${formatCurrency(resumo.ticket)}`} />
            <Kpi label="Comissões e taxas" value={formatCurrency(resumo.taxas)} sub={`${resumo.taxaEfetiva.toFixed(1)}% das vendas`} tone="red" />
            <Kpi label="Líquido (repasses)" value={formatCurrency(resumo.liquido)} sub={`${repasses.length} data(s) de repasse`} tone="green" />
            <Kpi label="Promoções pagas pela loja" value={formatCurrency(resumo.promoLoja)} sub={`iFood bancou ${formatCurrency(resumo.promoIfood)}${resumo.cancelados ? ` · ${resumo.cancelados} cancelado(s)` : ''}`} tone="amber" />
          </div>
          {resumo.recebidoLoja > 0 && (
            <p className="text-xs text-zinc-500">
              Além disso, {formatCurrency(resumo.recebidoLoja)} foram pagos direto à loja na entrega (fora do repasse — entram pela maquininha/Pix).
            </p>
          )}

          {/* Repasses */}
          <div className="bg-white rounded-xl border border-zinc-100 overflow-hidden">
            <div className="px-4 py-3 border-b border-zinc-100">
              <p className="text-sm font-semibold text-zinc-800">Repasses</p>
              <p className="text-xs text-zinc-500">O que o iFood diz que paga × créditos com "iFood" no extrato do Inter (na data e no dia seguinte). O cartão chega como "Crédito domicílio cartão", em valores próprios, então compare o total do dia.</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-zinc-50 text-xs text-zinc-500">
                  <tr>
                    <th className="text-left px-4 py-2">Data</th>
                    <th className="text-right px-4 py-2">iFood informa</th>
                    <th className="text-right px-4 py-2">Caiu no Inter</th>
                    <th className="text-right px-4 py-2">Diferença</th>
                    <th className="text-left px-4 py-2">Situação</th>
                  </tr>
                </thead>
                <tbody>
                  {repasses.map((r) => {
                    const futuro = r.data_repasse > hoje;
                    const diff = r.recebido_inter - r.esperado;
                    const status = futuro ? { t: 'Previsto', c: 'bg-zinc-100 text-zinc-600' }
                      : r.linhas_inter === 0 ? { t: 'Não achado no Inter', c: 'bg-red-100 text-red-700' }
                      : Math.abs(diff) <= 0.05 ? { t: 'Conferido', c: 'bg-green-100 text-green-700' }
                      : { t: 'Caiu com diferença', c: 'bg-amber-100 text-amber-700' };
                    const aberto = openRepasse === r.data_repasse;
                    return (
                      <>
                        <tr key={r.data_repasse} onClick={() => setOpenRepasse(aberto ? null : r.data_repasse)} className="border-t border-zinc-100 hover:bg-zinc-50 cursor-pointer">
                          <td className="px-4 py-2 whitespace-nowrap"><i className={`${aberto ? 'ri-arrow-down-s-line' : 'ri-arrow-right-s-line'} text-zinc-400 mr-1`} />{dataBR(r.data_repasse)}</td>
                          <td className="px-4 py-2 text-right font-mono">{formatCurrency(r.esperado)}</td>
                          <td className="px-4 py-2 text-right font-mono">{futuro && r.linhas_inter === 0 ? '—' : formatCurrency(r.recebido_inter)}</td>
                          <td className={`px-4 py-2 text-right font-mono ${futuro ? 'text-zinc-300' : Math.abs(diff) <= 0.05 ? 'text-zinc-400' : diff < 0 ? 'text-red-600' : 'text-amber-700'}`}>{futuro && r.linhas_inter === 0 ? '—' : formatCurrency(diff)}</td>
                          <td className="px-4 py-2"><span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${status.c}`}>{status.t}</span></td>
                        </tr>
                        {aberto && (
                          <tr key={r.data_repasse + '-d'} className="bg-zinc-50/60">
                            <td colSpan={5} className="px-4 py-3">
                              <div className="grid md:grid-cols-2 gap-4 text-xs">
                                <div>
                                  <p className="font-semibold text-zinc-700 mb-1">Depósitos no relatório do iFood</p>
                                  {r.detalhe.ifood.map((d, i) => (
                                    <div key={i} className="flex justify-between border-t border-zinc-100 py-0.5"><span>{d.metodo || '—'}</span><span className="font-mono">{formatCurrency(Number(d.valor))}</span></div>
                                  ))}
                                </div>
                                <div>
                                  <p className="font-semibold text-zinc-700 mb-1">Créditos iFood no Inter</p>
                                  {r.detalhe.inter.length === 0 && <p className="text-zinc-400">Nenhum{futuro ? ' ainda (repasse futuro)' : ''}.</p>}
                                  {r.detalhe.inter.map((d, i) => (
                                    <div key={i} className="flex justify-between gap-2 border-t border-zinc-100 py-0.5"><span className="truncate">{dataBR(d.data)} · {d.descricao}</span><span className="font-mono">{formatCurrency(Number(d.valor))}</span></div>
                                  ))}
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </>
                    );
                  })}
                  {repasses.length === 0 && (
                    <tr><td colSpan={5} className="px-4 py-6 text-center text-xs text-zinc-400">Sem repasses neste mês.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Taxas */}
          <div className="bg-white rounded-xl border border-zinc-100 overflow-hidden">
            <div className="px-4 py-3 border-b border-zinc-100">
              <p className="text-sm font-semibold text-zinc-800">Para onde foi o dinheiro</p>
              <p className="text-xs text-zinc-500">Comissões, taxas e ajustes descontados do repasse.</p>
            </div>
            <table className="w-full text-sm">
              <tbody>
                {resumo.taxasLista.map(([desc, v]) => (
                  <tr key={desc} className="border-t border-zinc-100">
                    <td className="px-4 py-2">{desc}</td>
                    <td className="px-4 py-2 text-right text-xs text-zinc-400">{resumo.vendas > 0 ? `${((v / resumo.vendas) * 100).toFixed(1)}%` : ''}</td>
                    <td className={`px-4 py-2 text-right font-mono ${v < 0 ? 'text-green-700' : 'text-red-600'}`}>{formatCurrency(v)}</td>
                  </tr>
                ))}
                <tr className="border-t border-zinc-200 font-semibold">
                  <td className="px-4 py-2">Total</td>
                  <td className="px-4 py-2 text-right text-xs text-zinc-500">{resumo.taxaEfetiva.toFixed(1)}%</td>
                  <td className="px-4 py-2 text-right font-mono text-red-600">{formatCurrency(resumo.taxas)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {imp && (
            <p className="text-[11px] text-zinc-400">
              Fonte: {imp.source === 'api' ? 'API do iFood' : `arquivo ${imp.file_name ?? ''}`} · {imp.lines} linha(s) · atualizado em {new Date(imp.updated_at).toLocaleString('pt-BR')}
            </p>
          )}
        </>
      )}

      {showConfig && (
        <IfoodConfigModal onClose={() => setShowConfig(false)} onImported={() => { loadImports(); loadCompetence(); }} />
      )}
    </div>
  );
}
