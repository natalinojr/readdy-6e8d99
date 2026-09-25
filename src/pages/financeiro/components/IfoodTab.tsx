import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase, invokeWithAuth } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { formatCurrency } from '@/lib/formatters';
import { todayBrasilia } from '@/lib/dateUtils';
import IfoodConfigModal from './conciliacao/IfoodConfigModal';
import IfoodApiViews, { type IfoodApiView } from './IfoodApiViews';
import IfoodProdutos from './IfoodProdutos';
import { portalBucket } from '@/lib/ifoodVendas';

// Aba iFood: o relatório de conciliação do iFood (fin_ifood_entries, gravado pela edge
// ifood-financial) por competência — vendas, comissões/taxas, promoções e repasses,
// com a conferência de cada repasse contra os créditos do iFood no extrato do Inter.

interface ImportRow {
  id: string; merchant_id: string; merchant_short: string | null;
  competence: string; source: 'api' | 'file'; file_name: string | null;
  lines: number; orders: number; gross: number; fees: number; net: number; updated_at: string;
  expected_lines?: number | null; expected_orders?: number | null; integrity_ok?: boolean | null;
}
interface EntryRow {
  fato_gerador: string | null; tipo_lancamento: string | null; descricao: string | null;
  valor: number; impacto_repasse: boolean; responsavel: string | null; order_id: string | null;
  data_repasse: string | null;
}
interface RepasseRow {
  data_repasse: string; esperado: number; depositos: number; recebido_inter: number; linhas_inter: number;
  detalhe: { ifood: { valor: number; metodo: string | null }[]; inter: { data: string; valor: number; descricao: string | null }[]; bruto?: number; antecipacao?: number; sem_conta?: boolean };
}

const compLabel = (c: string) => {
  const nomes = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  return `${nomes[Number(c.slice(5, 7)) - 1]} de ${c.slice(0, 4)}`;
};
const dataBR = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
// Mesma regra da edge: receita = entradas e subsídios; taxas = cobranças e retenções.
// Divisão igual ao Portal do Parceiro — compartilhada com os Relatórios (Origem e Calendário).

function Kpi({ label, value, sub, icon, tone = 'zinc' }: { label: string; value: string; sub?: string; icon?: string; tone?: 'zinc' | 'green' | 'red' | 'amber' }) {
  const color = { zinc: 'text-zinc-900', green: 'text-green-700', red: 'text-red-600', amber: 'text-amber-700' }[tone];
  const iconBg = { zinc: 'bg-zinc-100 text-zinc-600', green: 'bg-green-50 text-green-600', red: 'bg-red-50 text-red-500', amber: 'bg-amber-50 text-amber-600' }[tone];
  return (
    <div className="bg-white rounded-2xl border border-zinc-100 p-3 sm:p-4">
      <div className="flex items-center gap-2">
        {icon && <span className={`hidden sm:flex w-7 h-7 shrink-0 items-center justify-center rounded-lg ${iconBg}`}><i className={`${icon} text-sm`} /></span>}
        <p className="text-xs font-medium text-zinc-500 leading-tight">{label}</p>
      </div>
      <p className={`text-lg sm:text-xl font-bold mt-2 whitespace-nowrap ${color}`}>{value}</p>
      {sub && <p className="text-[11px] text-zinc-400 mt-0.5">{sub}</p>}
    </div>
  );
}

export default function IfoodTab() {
  const { user } = useAuth();
  const [imports, setImports] = useState<ImportRow[]>([]);
  const [competence, setCompetence] = useState<string>('');
  const [loja, setLoja] = useState<string>(''); // '' = todas as lojas iFood do tenant
  const [entries, setEntries] = useState<EntryRow[]>([]);
  const [repasses, setRepasses] = useState<RepasseRow[]>([]);
  const [postToLedger, setPostToLedger] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showConfig, setShowConfig] = useState(false);
  const [togglingLedger, setTogglingLedger] = useState(false);
  const [openRepasse, setOpenRepasse] = useState<string | null>(null);
  const [view, setView] = useState<'resumo' | 'produtos' | IfoodApiView>('resumo');
  const [apiOn, setApiOn] = useState(false);
  const [homolog, setHomolog] = useState(false);
  const [nomes, setNomes] = useState<Record<string, string>>({});
  // Lojas do iFood cadastradas (fin_ifood_merchants) e a situação da API (get_config).
  const [lojasCad, setLojasCad] = useState<{ id: string; curto: string | null }[]>([]);
  const [api, setApi] = useState<{ ligadas: number; total: number; lastSync: string | null; erro: string | null }>({ ligadas: 0, total: 0, lastSync: null, erro: null });
  const [editLoja, setEditLoja] = useState<{ id: string; curto: string; nome: string; pct: string; dias: string; salvando: boolean; erro: string | null } | null>(null);
  // Repasse antecipado por loja iFood (fin_ifood_merchants.anticipation_pct/days): o relatório traz a data
  // original e não traz a taxa; a edge aplica a data antecipada e a taxa (2026-09-19).
  const [antecip, setAntecip] = useState<Record<string, { pct: number; dias: number }>>({});
  const [ondemand, setOndemand] = useState<{ running: boolean; msg: string | null; error: boolean }>({ running: false, msg: null, error: false });

  const loadImports = useCallback(async () => {
    if (!user?.tenantId) return;
    const [{ data, error: err }, cfg, mer] = await Promise.all([
      supabase.from('fin_ifood_imports')
        .select('id, merchant_id, merchant_short, competence, source, file_name, lines, orders, gross, fees, net, updated_at, expected_lines, expected_orders, integrity_ok')
        .eq('tenant_id', user.tenantId).order('competence', { ascending: false }),
      invokeWithAuth<{ config?: { post_to_ledger?: boolean; authorized?: boolean; merchant_id?: string | null; last_sync_at?: string | null; last_sync_error?: string | null; merchants?: { merchant_id: string; api_sync: boolean; authorized: boolean }[] } | null }>('ifood-financial', { body: { action: 'get_config', tenant_id: user.tenantId } }),
      supabase.from('fin_ifood_merchants').select('merchant_id, merchant_short, name, anticipation_pct, anticipation_days').eq('tenant_id', user.tenantId),
    ]);
    const merRows = (mer.data ?? []) as { merchant_id: string; merchant_short: string | null; name: string | null; anticipation_pct: number | null; anticipation_days: number | null }[];
    setLojasCad(merRows.map((m) => ({ id: m.merchant_id, curto: m.merchant_short })));
    const cms = cfg.data?.config?.merchants ?? [];
    setApi({ ligadas: cms.filter((m) => m.api_sync && m.authorized).length, total: cms.length, lastSync: cfg.data?.config?.last_sync_at ?? null, erro: cfg.data?.config?.last_sync_error ?? null });
    setNomes(Object.fromEntries(merRows.filter((m) => m.name).map((m) => [m.merchant_id, m.name as string])));
    setAntecip(Object.fromEntries(merRows.filter((m) => Number(m.anticipation_pct) > 0).map((m) => [m.merchant_id, { pct: Number(m.anticipation_pct), dias: Number(m.anticipation_days ?? 21) }])));
    if (err) { setError(err.message); setLoading(false); return; }
    const rows = (data ?? []) as ImportRow[];
    setImports(rows);
    setPostToLedger(cfg.data?.config?.post_to_ledger === true);
    setApiOn(cfg.data?.config?.authorized === true && !!cfg.data?.config?.merchant_id);
    setHomolog((cfg.data?.config as { homologation_mode?: boolean } | null | undefined)?.homologation_mode === true);
    setCompetence((c) => (c && rows.some((r) => r.competence === c) ? c : rows[0]?.competence ?? ''));
    if (rows.length === 0) setLoading(false);
  }, [user?.tenantId]);

  const loadCompetence = useCallback(async () => {
    if (!user?.tenantId || !competence) return;
    setLoading(true);
    let q = supabase.from('fin_ifood_entries')
      .select('fato_gerador, tipo_lancamento, descricao, valor, impacto_repasse, responsavel, order_id, data_repasse')
      .eq('tenant_id', user.tenantId).eq('competence', competence);
    if (loja) q = q.eq('merchant_id', loja);
    const { data, error: err } = await q.limit(20000);
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
  }, [user?.tenantId, competence, loja]);

  useEffect(() => { loadImports(); }, [loadImports]);
  useEffect(() => { loadCompetence(); }, [loadCompetence]);

  const resumo = useMemo(() => {
    const z = { vendas: 0, taxas: 0, servicos: 0, ajustes: 0, loja: 0 };
    const custo = new Map<string, number>(); // "para onde foi o dinheiro": taxas + serviços − ajustes por descrição
    for (const e of entries) {
      const b = portalBucket(e);
      z.vendas += b.vendas; z.taxas += b.taxas; z.servicos += b.servicos; z.ajustes += b.ajustes; z.loja += b.loja;
      const c = b.taxas + b.servicos - b.ajustes;
      if (Math.abs(c) > 0.004) {
        const k = e.descricao || e.tipo_lancamento || 'Outros';
        custo.set(k, (custo.get(k) ?? 0) + c);
      }
    }
    const faturamento = z.vendas - z.taxas - z.servicos + z.ajustes;
    // `|| 0` evita o "-R$ 0,00" (zero negativo) quando não há promoção.
    const promoLoja = -entries.filter((e) => /custeada pela loja/i.test(e.descricao ?? '')).reduce((s, e) => s + e.valor, 0) || 0;
    const promoIfood = entries.filter((e) => /custeada pelo ifood|custeada pela ind[uú]stria/i.test(e.descricao ?? '')).reduce((s, e) => s + e.valor, 0) || 0;
    const pedidos = new Set(entries.filter((e) => e.fato_gerador === 'Venda' && e.order_id).map((e) => e.order_id)).size;
    const cancelados = new Set(entries.filter((e) => /cancelamento/i.test(e.fato_gerador ?? '') && e.order_id).map((e) => e.order_id)).size;
    return {
      ...z, faturamento, liquido: faturamento - z.loja, custoTotal: z.taxas + z.servicos - z.ajustes,
      promoLoja, promoIfood, pedidos, cancelados,
      ticket: pedidos > 0 ? z.vendas / pedidos : 0,
      taxaEfetiva: z.vendas > 0 ? ((z.taxas + z.servicos - z.ajustes) / z.vendas) * 100 : 0,
      taxasLista: [...custo.entries()].filter(([, v]) => Math.abs(v) > 0.004).sort((a, b) => b[1] - a[1]),
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

  // Exporta o relatório de conciliação da competência (colunas originais do iFood) em CSV.
  const exportCsv = async () => {
    if (!user?.tenantId || !competence) return;
    let q = supabase.from('fin_ifood_entries').select('raw').eq('tenant_id', user.tenantId).eq('competence', competence);
    if (loja) q = q.eq('merchant_id', loja);
    const { data, error: err } = await q.limit(50000);
    if (err) { setError(err.message); return; }
    const raws = ((data ?? []) as { raw: Record<string, unknown> | null }[]).map((r) => r.raw ?? {});
    if (raws.length === 0) return;
    const cols = Object.keys(raws[0]);
    const cell = (v: unknown) => { const s = v === null || v === undefined ? '' : String(v); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const csv = '﻿' + [cols.join(';'), ...raws.map((r) => cols.map((c) => cell(r[c])).join(';'))].join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url; a.download = `conciliacao-ifood-${competence}${loja ? '-' + loja.slice(0, 8) : ''}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Relatório sob demanda (API): pede ao iFood e consulta com backoff exponencial até ficar pronto.
  const gerarAgora = async () => {
    if (!user?.tenantId) return;
    const comp = competence || todayBrasilia().slice(0, 7);
    setOndemand({ running: true, msg: 'Pedindo o relatório ao iFood...', error: false });
    const r = await invokeWithAuth<{ success?: boolean; error?: string; request_id?: string }>('ifood-financial', { body: { action: 'request_ondemand', tenant_id: user.tenantId, competence: comp, merchant_id: loja || undefined } });
    const reqId = r.data?.request_id;
    if (!reqId) { setOndemand({ running: false, msg: r.data?.error ?? r.error?.message ?? 'Falhou.', error: true }); return; }
    for (let i = 0, wait = 3000; i < 8; i++, wait = Math.min(wait * 2, 60_000)) {
      setOndemand({ running: true, msg: `iFood gerando o relatório de ${compLabel(comp)}... (consulta ${i + 1}/8)`, error: false });
      await new Promise((res) => setTimeout(res, wait));
      const s = await invokeWithAuth<{ success?: boolean; error?: string; status?: string; imported?: unknown; error_message?: string | null }>('ifood-financial', { body: { action: 'ondemand_status', tenant_id: user.tenantId, request_id: reqId } });
      if (s.data?.error) { setOndemand({ running: false, msg: s.data.error, error: true }); return; }
      if (s.data?.error_message) {
        const original = s.data.error_message;
        const explicado = /no financial entries/i.test(original)
          ? `O iFood não tem lançamentos financeiros desta loja em ${compLabel(comp)}, então não há relatório para gerar.`
          : /timeout|timed out/i.test(original)
            ? 'O iFood demorou demais para gerar o relatório. Tente de novo em alguns minutos.'
            : 'O iFood não conseguiu gerar o relatório.';
        setOndemand({ running: false, msg: `${explicado} (mensagem do iFood: ${original})`, error: true });
        return;
      }
      if (s.data?.imported) { setOndemand({ running: false, msg: `Relatório de ${compLabel(comp)} atualizado agora (${new Date().toLocaleTimeString('pt-BR')}).`, error: false }); loadImports(); loadCompetence(); return; }
    }
    setOndemand({ running: false, msg: 'O iFood ainda está gerando. Clique de novo daqui a alguns minutos (o pedido é reaproveitado).', error: false });
  };

  const hoje = todayBrasilia();
  const competencias = [...new Set(imports.map((i) => i.competence))];
  // Lojas = as que têm relatório importado + as cadastradas (ex.: autorizada na API e ainda sem arquivo).
  const lojas = [...new Map([
    ...lojasCad.map((l) => [l.id, l.curto || l.id.slice(0, 8)] as [string, string]),
    ...imports.map((i) => [i.merchant_id, i.merchant_short || i.merchant_id.slice(0, 8)] as [string, string]),
  ]).entries()];
  const nomeCurto = (id: string, curto?: string | null) => nomes[id] ?? `Loja ${curto ?? id.slice(0, 8)}`;
  const nomeLoja = (id: string, curto?: string | null) => (nomes[id] ? `${nomes[id]} (${curto ?? id.slice(0, 8)})` : `Loja ${curto ?? id.slice(0, 8)}`);

  const renomearLoja = (id: string) => {
    const curto = lojas.find(([lid]) => lid === id)?.[1] ?? id.slice(0, 8);
    const a = antecip[id];
    setEditLoja({ id, curto, nome: nomes[id] ?? '', pct: a ? String(a.pct).replace('.', ',') : '', dias: String(a?.dias ?? 21), salvando: false, erro: null });
  };

  const salvarNomeLoja = async () => {
    if (!user?.tenantId || !editLoja) return;
    setEditLoja({ ...editLoja, salvando: true, erro: null });
    const nome = editLoja.nome.trim();
    const r = await invokeWithAuth<{ success?: boolean; error?: string }>('ifood-financial', { body: { action: 'set_merchant_name', tenant_id: user.tenantId, merchant_id: editLoja.id, name: nome } });
    if (r.data?.error || r.error) { setEditLoja({ ...editLoja, salvando: false, erro: r.data?.error ?? r.error?.message ?? 'Não foi possível salvar.' }); return; }
    setNomes((n) => { const x = { ...n }; if (nome) x[editLoja.id] = nome; else delete x[editLoja.id]; return x; });
    // Antecipação: só chama se mudou (a edge reaplica datas e relança o financeiro da loja).
    const pct = editLoja.pct.trim() ? Number(editLoja.pct.replace(',', '.')) : 0;
    const dias = Number(editLoja.dias) || 21;
    const antes = antecip[editLoja.id];
    if ((antes?.pct ?? 0) !== pct || (pct > 0 && (antes?.dias ?? 21) !== dias)) {
      const a = await invokeWithAuth<{ success?: boolean; error?: string }>('ifood-financial', { body: { action: 'set_anticipation', tenant_id: user.tenantId, merchant_id: editLoja.id, pct: pct > 0 ? pct : null, days: dias } });
      if (a.data?.error || a.error) { setEditLoja({ ...editLoja, salvando: false, erro: a.data?.error ?? a.error?.message ?? 'Não foi possível salvar a antecipação.' }); return; }
      await loadImports();
      await loadCompetence();
    }
    setEditLoja(null);
  };
  // Repasse da loja escolhida, por data (2026-09-19). A tabela compara com o Inter pelo TOTAL do dia
  // (o Inter recebe todas as lojas iFood na mesma conta), então "iFood informa" soma as lojas; esta
  // coluna mostra a parte da loja para bater com o relatório (xlsx) dela.
  const porLoja = !!loja && lojas.length > 1;
  const repasseDaLoja = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of entries) if (e.impacto_repasse && e.data_repasse) m.set(e.data_repasse, (m.get(e.data_repasse) ?? 0) + e.valor);
    // Loja com antecipação: mesmo "Valor" do portal (repasse − taxa de antecipação, arredondada como na RPC)
    const a = loja ? antecip[loja] : undefined;
    if (a) for (const [d, v] of m) m.set(d, v - Math.round(v * a.pct) / 100);
    return m;
  }, [entries, loja, antecip]);
  const impsMes = imports.filter((i) => i.competence === competence && (!loja || i.merchant_id === loja));

  return (
    <div className="p-4 md:p-6 space-y-4 md:space-y-5">
      {/* Cabeçalho: título + situação da API; embaixo, lojas (botões), mês e ações. */}
      <div className="bg-white rounded-2xl border border-zinc-100 p-4 md:p-5 space-y-4">
        <div className="flex flex-wrap items-start gap-3">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <div className="w-11 h-11 flex items-center justify-center rounded-xl bg-red-600 text-white shadow-sm shrink-0">
              <i className="ri-restaurant-2-line text-xl" />
            </div>
            <div className="min-w-0">
              <h2 className="text-lg font-bold text-zinc-900 leading-tight">iFood</h2>
              <p className="text-xs text-zinc-500">Vendas, taxas e repasses por mês de venda</p>
            </div>
          </div>
          {homolog ? (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-blue-50 text-blue-700 text-xs font-semibold"><i className="ri-flask-line" /> Modo homologação</span>
          ) : api.ligadas > 0 ? (
            <span title={api.erro ?? undefined}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold whitespace-nowrap ${api.erro ? 'bg-amber-50 text-amber-700' : 'bg-green-50 text-green-700'}`}>
              <span className={`w-2 h-2 rounded-full ${api.erro ? 'bg-amber-500' : 'bg-green-500'}`} />
              API {api.erro ? 'com aviso' : 'conectada'} · {api.ligadas} de {Math.max(api.total, lojas.length)} loja(s)
              {api.lastSync && <span className="hidden sm:inline font-normal opacity-80">· {new Date(api.lastSync).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-zinc-100 text-zinc-600 text-xs font-semibold"><span className="w-2 h-2 rounded-full bg-zinc-400" /> Só por arquivo</span>
          )}
        </div>

        <div className="flex flex-col lg:flex-row lg:items-center gap-3">
          {lojas.length > 0 && (
            <div className="flex items-center gap-1.5 overflow-x-auto -mx-1 px-1 min-w-0 lg:flex-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {lojas.length > 1 && (
                <button onClick={() => setLoja('')}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap border cursor-pointer ${loja === '' ? 'bg-zinc-900 border-zinc-900 text-white' : 'bg-white border-zinc-200 text-zinc-600 hover:border-zinc-300'}`}>
                  Todas as lojas
                </button>
              )}
              {lojas.map(([id, curto]) => {
                const ativo = loja === id || lojas.length === 1;
                return (
                  <span key={id} className={`inline-flex items-center rounded-full border whitespace-nowrap ${ativo ? 'bg-red-50 border-red-300 text-red-700' : 'bg-white border-zinc-200 text-zinc-600 hover:border-zinc-300'}`}>
                    <button onClick={() => setLoja(id)} title={`Código ${curto}`} className="pl-3 pr-1.5 py-1.5 text-xs font-semibold cursor-pointer">{nomeCurto(id, curto)}</button>
                    <button onClick={() => renomearLoja(id)} title="Nome e antecipação desta loja"
                      className="pr-2.5 pl-0.5 py-1.5 text-zinc-400 hover:text-red-600 cursor-pointer"><i className="ri-pencil-line text-xs" /></button>
                  </span>
                );
              })}
            </div>
          )}
          <div className="flex items-center gap-2 lg:justify-end">
            {competencias.length > 0 && (
              <select value={competence} onChange={(e) => setCompetence(e.target.value)} aria-label="Mês"
                className="flex-1 lg:flex-none min-w-0 border border-zinc-200 rounded-lg px-3 py-2 text-sm bg-white capitalize font-semibold text-zinc-800">
                {competencias.map((c) => <option key={c} value={c}>{compLabel(c)}</option>)}
              </select>
            )}
            {competence && (
              <button onClick={exportCsv} title="Baixar o relatório de conciliação deste mês em CSV"
                className="flex items-center gap-1.5 px-3 py-2 border border-zinc-200 text-zinc-700 rounded-lg text-sm font-semibold hover:bg-zinc-50 cursor-pointer whitespace-nowrap">
                <i className="ri-file-download-line" /><span className="hidden sm:inline">CSV</span>
              </button>
            )}
            {apiOn && (
              <button onClick={gerarAgora} disabled={ondemand.running} title="Pede ao iFood o relatório de conciliação atualizado deste mês"
                className="flex items-center gap-1.5 px-3 py-2 border border-red-200 text-red-700 rounded-lg text-sm font-semibold hover:bg-red-50 cursor-pointer whitespace-nowrap disabled:opacity-50">
                <i className={`ri-refresh-line ${ondemand.running ? 'animate-spin' : ''}`} /><span className="hidden sm:inline">Atualizar do iFood</span>
              </button>
            )}
            <button onClick={() => setShowConfig(true)}
              className="flex items-center gap-1.5 px-3 py-2 bg-red-600 text-white rounded-lg text-sm font-semibold hover:bg-red-700 cursor-pointer whitespace-nowrap">
              <i className="ri-settings-3-line" /><span className="hidden sm:inline">Importar e configurar</span><span className="sm:hidden">Configurar</span>
            </button>
          </div>
        </div>

        {ondemand.msg && (
          <div className={`rounded-lg border px-3 py-2 text-xs ${ondemand.error ? 'bg-red-50 border-red-200 text-red-700' : 'bg-blue-50 border-blue-200 text-blue-700'}`}>{ondemand.msg}</div>
        )}
      </div>

      {/* Subabas */}
      <div className="flex gap-1 overflow-x-auto bg-zinc-100/80 rounded-xl p-1 w-full sm:w-fit">
        {([['resumo', 'Resumo', 'ri-pie-chart-2-line'], ['produtos', 'Produtos', 'ri-shopping-bag-3-line'], ['pedidos', 'Pedidos', 'ri-file-list-3-line'], ['repasses', 'Repasses', 'ri-bank-line'], ['eventos', 'Eventos', 'ri-pulse-line']] as const).map(([k, label, icon]) => (
          <button key={k} onClick={() => setView(k)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap cursor-pointer transition-colors ${view === k ? 'bg-white text-red-600 shadow-sm' : 'text-zinc-500 hover:text-zinc-800'}`}>
            <i className={icon} /> {label}
          </button>
        ))}
      </div>

      {/* Onde entra no resto do financeiro (no modo homologação: dados de teste, nunca lançados) */}
      {view === 'resumo' && (homolog ? (
        <div className="flex items-start gap-2 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800">
          <i className="ri-flask-line mt-0.5" />
          <span><strong>Modo homologação:</strong> dados da loja de teste do iFood, buscados com o header de homologação. Eles aparecem aqui para conferência e <strong>não entram</strong> em Receitas, DRE nem Fluxo de Caixa.</span>
        </div>
      ) : (
        <div className={`flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 text-xs ${postToLedger ? 'bg-green-50/70 border-green-200 text-green-800' : 'bg-amber-50 border-amber-200 text-amber-800'}`}>
          <i className={postToLedger ? 'ri-checkbox-circle-fill text-green-600' : 'ri-information-line'} />
          <span className="flex-1 min-w-[220px]">
            {postToLedger
              ? <><strong>Lançando no financeiro:</strong> vendas em Receitas, DRE e Fluxo de Caixa, e taxas em &quot;Taxas de cartão, Pix e iFood&quot;, na data de cada repasse pago.</>
              : <><strong>Fora do financeiro:</strong> estes números ainda não entram na DRE nem em Receitas.</>}
            <span title="Receitas e DRE só mostram com a fonte &quot;Conciliação iFood&quot; ligada em Receitas › Fontes." className="ml-1 cursor-help opacity-70"><i className="ri-question-line" /></span>
          </span>
          <button onClick={toggleLedger} disabled={togglingLedger || imports.length === 0}
            className={`px-2.5 py-1 rounded-md border font-semibold cursor-pointer whitespace-nowrap disabled:opacity-50 ${postToLedger ? 'border-green-300 hover:bg-green-100' : 'border-amber-300 bg-white hover:bg-amber-100'}`}>
            {togglingLedger ? 'Salvando...' : postToLedger ? 'Parar de lançar' : 'Lançar no financeiro'}
          </button>
        </div>
      ))}

      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">Falha ao carregar: {error}</div>
      )}

      {view === 'produtos' ? (
        user?.tenantId ? <IfoodProdutos tenantId={user.tenantId} lojaShort={loja ? (lojas.find(([id]) => id === loja)?.[1] ?? null) : null} onImportar={() => setShowConfig(true)} /> : null
      ) : view !== 'resumo' ? (
        user?.tenantId ? <IfoodApiViews tenantId={user.tenantId} competence={competence || hoje.slice(0, 7)} view={view} merchantId={loja || undefined} nomes={nomes} /> : null
      ) : !loading && imports.length === 0 ? (
        <div className="bg-white rounded-xl border border-zinc-100 p-8 text-center space-y-2">
          <i className="ri-file-excel-2-line text-3xl text-zinc-300" />
          <p className="text-sm font-semibold text-zinc-700">{homolog ? 'A loja de teste do iFood não tem relatório de conciliação' : 'Nenhum relatório do iFood importado'}</p>
          {homolog && (
            <p className="text-xs text-blue-700 max-w-md mx-auto">O iFood não gera lançamentos financeiros para a loja de teste (o "Gerar relatório agora" devolve essa resposta). Os dados de teste estão nas abas <strong>Pedidos</strong> e <strong>Eventos</strong>.</p>
          )}
          <p className="text-xs text-zinc-500 max-w-md mx-auto">No Portal do Parceiro: Financeiro › Exportar, depois Relatórios › Exportações › Baixar (página cinza → Ctrl+S). Suba o arquivo em "Importar / configurar". Com a API conectada, entra sozinho todo dia às 07h20.</p>
        </div>
      ) : loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="w-6 h-6 border-2 border-red-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <>
          {/* Mesma conta do Portal do Parceiro › Financeiro › Faturamento, com a barra de cada real vendido. */}
          <div className="bg-white rounded-2xl border border-zinc-100 p-4 md:p-5">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">Total faturamento · {competence ? compLabel(competence) : ''}</p>
                <p className="text-3xl font-bold text-zinc-900 mt-1">{formatCurrency(resumo.faturamento)}</p>
                <p className="text-xs text-zinc-500 mt-1">
                  de <strong className="text-zinc-700">{formatCurrency(resumo.vendas)}</strong> vendidos · o iFood ficou com <strong className="text-red-600">{resumo.taxaEfetiva.toFixed(1)}%</strong>
                </p>
              </div>
              <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs">
                <span className="text-zinc-500">Cai no banco</span>
                <strong className="font-mono text-right text-green-700">{formatCurrency(resumo.liquido)}</strong>
                <span className="text-zinc-500" title="Pago na entrega: entra pela maquininha/Pix, não pelo iFood">Recebido direto pela loja</span>
                <strong className="font-mono text-right text-zinc-700">{formatCurrency(resumo.loja)}</strong>
              </div>
            </div>
            {resumo.vendas > 0 && (() => {
              const pct = (v: number) => Math.max(0, (v / resumo.vendas) * 100);
              const partes = [
                { k: 'Faturamento', v: resumo.faturamento, c: 'bg-green-500' },
                { k: 'Taxas e comissões', v: resumo.taxas, c: 'bg-red-500' },
                { k: 'Serviços e promoções', v: resumo.servicos - resumo.ajustes, c: 'bg-orange-400' },
              ].filter((p) => p.v > 0.004);
              return (
                <div className="mt-4">
                  <div className="flex h-3 rounded-full overflow-hidden bg-zinc-100">
                    {partes.map((p) => <div key={p.k} className={p.c} style={{ width: `${pct(p.v)}%` }} title={`${p.k}: ${formatCurrency(p.v)}`} />)}
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-[11px] text-zinc-500">
                    {partes.map((p) => (
                      <span key={p.k} className="inline-flex items-center gap-1.5"><span className={`w-2 h-2 rounded-full ${p.c}`} />{p.k} {pct(p.v).toFixed(1)}%</span>
                    ))}
                  </div>
                </div>
              );
            })()}
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Kpi icon="ri-shopping-bag-3-line" label="Pedidos" value={String(resumo.pedidos)} sub={`ticket médio ${formatCurrency(resumo.ticket)}${resumo.cancelados ? ` · ${resumo.cancelados} cancelado(s)` : ''}`} />
            <Kpi icon="ri-percent-line" label="Taxas e comissões" value={formatCurrency(-resumo.taxas || 0)} sub={`${resumo.vendas > 0 ? ((resumo.taxas / resumo.vendas) * 100).toFixed(1) : '0.0'}% das vendas`} tone="red" />
            <Kpi icon="ri-coupon-3-line" label="Serviços e promoções" value={formatCurrency(-resumo.servicos || 0)} sub={`promoções pagas pela loja ${formatCurrency(resumo.promoLoja)}`} tone="red" />
            <Kpi icon="ri-gift-line" label="Ajustes e ressarcimentos" value={formatCurrency(resumo.ajustes)} sub={`iFood bancou ${formatCurrency(resumo.promoIfood)} em promoções`} tone={resumo.ajustes < 0 ? 'red' : 'green'} />
          </div>

          {/* Repasses */}
          <div className="bg-white rounded-2xl border border-zinc-100 overflow-hidden">
            <div className="px-4 py-3 border-b border-zinc-100 flex items-start gap-2">
              <span className="w-7 h-7 flex items-center justify-center rounded-lg bg-green-50 text-green-600 shrink-0"><i className="ri-bank-line text-sm" /></span>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-zinc-800">Repasses × banco</p>
                <p className="text-xs text-zinc-500">
                  O que o iFood paga em cada data × créditos do iFood no extrato (no dia e no seguinte), somando todas as lojas iFood — o banco recebe todas na mesma conta.
                  <span className="ml-1 cursor-help opacity-70" title={'O cartão chega como "Crédito domicílio cartão", em valores próprios: compare o total do dia. Importe o relatório de cada loja para o total bater.'}><i className="ri-question-line" /></span>
                  {porLoja && <> A coluna <strong>Esta loja</strong> é o repasse só desta loja (bate com o "Valor" dos Repasses no Portal).</>}
                  {repasses.some((r) => r.detalhe.sem_conta) && <> Esta loja não tem conta de depósito do iFood em <strong>Conciliação › Como o dinheiro entra</strong>, então não há extrato para conferir.</>}
                </p>
              </div>
            </div>
            {/* Celular: um cartão por repasse — a tabela de 6 colunas não cabe em 375px. */}
            <ul className="md:hidden p-2 space-y-2 bg-zinc-50/60">
              {repasses.length === 0 && <li className="text-center text-xs text-zinc-400 py-4">Sem repasses neste mês.</li>}
              {repasses.map((r) => {
                const futuro = r.data_repasse > hoje || r.detalhe.sem_conta === true;
                const diff = r.recebido_inter - r.esperado;
                const status = r.detalhe.sem_conta ? { t: 'Sem extrato do banco', c: 'bg-zinc-100 text-zinc-500' }
                  : futuro ? { t: 'Previsto', c: 'bg-zinc-100 text-zinc-600' }
                  : r.linhas_inter === 0 ? { t: 'Não achado no Inter', c: 'bg-red-100 text-red-700' }
                  : Math.abs(diff) <= 0.05 ? { t: 'Conferido', c: 'bg-green-100 text-green-700' }
                  : { t: 'Caiu com diferença', c: 'bg-amber-100 text-amber-700' };
                const aberto = openRepasse === r.data_repasse;
                return (
                  <li key={r.data_repasse} onClick={() => setOpenRepasse(aberto ? null : r.data_repasse)}
                    className="rounded-xl border border-zinc-200 bg-white px-3 py-3 cursor-pointer">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-sm font-semibold text-zinc-800">
                        <i className={`${aberto ? 'ri-arrow-down-s-line' : 'ri-arrow-right-s-line'} text-zinc-400 mr-1`} />{dataBR(r.data_repasse)}
                      </span>
                      <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${status.c}`}>{status.t}</span>
                    </div>
                    <dl className="mt-2 space-y-0.5 text-xs">
                      {porLoja && (
                        <div className="flex justify-between"><dt className="text-zinc-500">Esta loja</dt><dd className="font-mono">{formatCurrency(repasseDaLoja.get(r.data_repasse) ?? 0)}</dd></div>
                      )}
                      <div className="flex justify-between"><dt className="text-zinc-500">{porLoja ? 'iFood informa (todas)' : 'iFood informa'}</dt><dd className="font-mono">{formatCurrency(r.esperado)}</dd></div>
                      <div className="flex justify-between"><dt className="text-zinc-500">Caiu no banco</dt><dd className="font-mono">{futuro && r.linhas_inter === 0 ? '—' : formatCurrency(r.recebido_inter)}</dd></div>
                      <div className="flex justify-between">
                        <dt className="text-zinc-500">Diferença</dt>
                        <dd className={`font-mono ${futuro ? 'text-zinc-300' : Math.abs(diff) <= 0.05 ? 'text-zinc-400' : diff < 0 ? 'text-red-600' : 'text-amber-700'}`}>
                          {futuro && r.linhas_inter === 0 ? '—' : formatCurrency(diff)}
                        </dd>
                      </div>
                    </dl>
                    {aberto && (
                      <div className="mt-2 pt-2 border-t border-zinc-100 text-xs space-y-2">
                        <div>
                          <p className="font-semibold text-zinc-700 mb-1">Depósitos no relatório do iFood</p>
                          {r.detalhe.ifood.map((d, i) => (
                            <div key={i} className="flex justify-between border-t border-zinc-100 py-0.5"><span>{d.metodo || '—'}</span><span className="font-mono">{formatCurrency(Number(d.valor))}</span></div>
                          ))}
                          {Number(r.detalhe.antecipacao ?? 0) > 0 && (
                            <>
                              <div className="flex justify-between border-t border-zinc-200 py-0.5 mt-1"><span>Subtotal do repasse</span><span className="font-mono">{formatCurrency(Number(r.detalhe.bruto ?? 0))}</span></div>
                              <div className="flex justify-between border-t border-zinc-100 py-0.5 text-red-600"><span>Taxa de antecipação</span><span className="font-mono">-{formatCurrency(Number(r.detalhe.antecipacao))}</span></div>
                              <div className="flex justify-between border-t border-zinc-100 py-0.5 font-semibold"><span>Valor que cai no banco</span><span className="font-mono">{formatCurrency(r.esperado)}</span></div>
                            </>
                          )}
                        </div>
                        <div>
                          <p className="font-semibold text-zinc-700 mb-1">Créditos iFood no banco</p>
                          {r.detalhe.inter.length === 0 && <p className="text-zinc-400">Nenhum{futuro ? ' ainda (repasse futuro)' : ''}.</p>}
                          {r.detalhe.inter.map((d, i) => (
                            <div key={i} className="flex justify-between gap-2 border-t border-zinc-100 py-0.5"><span className="break-words">{dataBR(d.data)} · {d.descricao}</span><span className="font-mono whitespace-nowrap">{formatCurrency(Number(d.valor))}</span></div>
                          ))}
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>

            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-zinc-50 text-xs text-zinc-500">
                  <tr>
                    <th className="text-left px-4 py-2">Data</th>
                    {porLoja && <th className="text-right px-4 py-2">Esta loja</th>}
                    <th className="text-right px-4 py-2">{porLoja ? 'iFood informa (todas as lojas)' : 'iFood informa'}</th>
                    <th className="text-right px-4 py-2">Caiu no banco</th>
                    <th className="text-right px-4 py-2">Diferença</th>
                    <th className="text-left px-4 py-2">Situação</th>
                  </tr>
                </thead>
                <tbody>
                  {repasses.map((r) => {
                    // Sem conta de depósito do iFood configurada (ex.: Vila Leste, Itaú sem API) não há extrato
                    // para conferir: "não achado" em vermelho seria falso.
                    const futuro = r.data_repasse > hoje || r.detalhe.sem_conta === true;
                    const diff = r.recebido_inter - r.esperado;
                    const status = r.detalhe.sem_conta ? { t: 'Sem extrato do banco', c: 'bg-zinc-100 text-zinc-500' }
                      : futuro ? { t: 'Previsto', c: 'bg-zinc-100 text-zinc-600' }
                      : r.linhas_inter === 0 ? { t: 'Não achado no Inter', c: 'bg-red-100 text-red-700' }
                      : Math.abs(diff) <= 0.05 ? { t: 'Conferido', c: 'bg-green-100 text-green-700' }
                      : { t: 'Caiu com diferença', c: 'bg-amber-100 text-amber-700' };
                    const aberto = openRepasse === r.data_repasse;
                    return (
                      <>
                        <tr key={r.data_repasse} onClick={() => setOpenRepasse(aberto ? null : r.data_repasse)} className="border-t border-zinc-100 hover:bg-zinc-50 cursor-pointer">
                          <td className="px-4 py-2 whitespace-nowrap"><i className={`${aberto ? 'ri-arrow-down-s-line' : 'ri-arrow-right-s-line'} text-zinc-400 mr-1`} />{dataBR(r.data_repasse)}</td>
                          {porLoja && <td className="px-4 py-2 text-right font-mono">{formatCurrency(repasseDaLoja.get(r.data_repasse) ?? 0)}</td>}
                          <td className="px-4 py-2 text-right font-mono">{formatCurrency(r.esperado)}</td>
                          <td className="px-4 py-2 text-right font-mono">{futuro && r.linhas_inter === 0 ? '—' : formatCurrency(r.recebido_inter)}</td>
                          <td className={`px-4 py-2 text-right font-mono ${futuro ? 'text-zinc-300' : Math.abs(diff) <= 0.05 ? 'text-zinc-400' : diff < 0 ? 'text-red-600' : 'text-amber-700'}`}>{futuro && r.linhas_inter === 0 ? '—' : formatCurrency(diff)}</td>
                          <td className="px-4 py-2"><span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${status.c}`}>{status.t}</span></td>
                        </tr>
                        {aberto && (
                          <tr key={r.data_repasse + '-d'} className="bg-zinc-50/60">
                            <td colSpan={porLoja ? 6 : 5} className="px-4 py-3">
                              <div className="grid md:grid-cols-2 gap-4 text-xs">
                                <div>
                                  <p className="font-semibold text-zinc-700 mb-1">Depósitos no relatório do iFood</p>
                                  {r.detalhe.ifood.map((d, i) => (
                                    <div key={i} className="flex justify-between border-t border-zinc-100 py-0.5"><span>{d.metodo || '—'}</span><span className="font-mono">{formatCurrency(Number(d.valor))}</span></div>
                                  ))}
                                  {Number(r.detalhe.antecipacao ?? 0) > 0 && (
                                    <>
                                      <div className="flex justify-between border-t border-zinc-200 py-0.5 mt-1"><span>Subtotal do repasse</span><span className="font-mono">{formatCurrency(Number(r.detalhe.bruto ?? 0))}</span></div>
                                      <div className="flex justify-between border-t border-zinc-100 py-0.5 text-red-600"><span>Taxa de antecipação</span><span className="font-mono">-{formatCurrency(Number(r.detalhe.antecipacao))}</span></div>
                                      <div className="flex justify-between border-t border-zinc-100 py-0.5 font-semibold"><span>Valor que cai no banco</span><span className="font-mono">{formatCurrency(r.esperado)}</span></div>
                                    </>
                                  )}
                                </div>
                                <div>
                                  <p className="font-semibold text-zinc-700 mb-1">Créditos iFood no banco</p>
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
                    <tr><td colSpan={porLoja ? 6 : 5} className="px-4 py-6 text-center text-xs text-zinc-400">Sem repasses neste mês.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Taxas */}
          <div className="bg-white rounded-2xl border border-zinc-100 overflow-hidden">
            <div className="px-4 py-3 border-b border-zinc-100 flex items-start gap-2">
              <span className="w-7 h-7 flex items-center justify-center rounded-lg bg-red-50 text-red-500 shrink-0"><i className="ri-pie-chart-line text-sm" /></span>
              <div>
                <p className="text-sm font-semibold text-zinc-800">Para onde foi o dinheiro</p>
                <p className="text-xs text-zinc-500">Comissões, taxas e ajustes descontados do repasse, em % das vendas.</p>
              </div>
            </div>
            <ul className="divide-y divide-zinc-100">
              {resumo.taxasLista.map(([desc, v]) => {
                const p = resumo.vendas > 0 ? (v / resumo.vendas) * 100 : 0;
                const maior = Math.max(...resumo.taxasLista.map(([, x]) => Math.abs(x)), 0.01);
                return (
                  <li key={desc} className="px-4 py-2.5">
                    <div className="flex items-baseline justify-between gap-3 text-sm">
                      <span className="text-zinc-700 min-w-0 flex-1 break-words">{desc}</span>
                      <span className="flex items-baseline gap-3 shrink-0">
                        <span className="text-xs text-zinc-400 w-11 text-right">{p.toFixed(1)}%</span>
                        <span className={`font-mono w-24 sm:w-28 text-right ${v < 0 ? 'text-green-700' : 'text-red-600'}`}>{formatCurrency(v)}</span>
                      </span>
                    </div>
                    <div className="mt-1.5 h-1.5 rounded-full bg-zinc-100 overflow-hidden">
                      <div className={`h-full rounded-full ${v < 0 ? 'bg-green-400' : 'bg-red-400'}`} style={{ width: `${(Math.abs(v) / maior) * 100}%` }} />
                    </div>
                  </li>
                );
              })}
              <li className="px-4 py-2.5 flex items-baseline justify-between gap-3 text-sm font-semibold bg-zinc-50/70">
                <span>Total</span>
                <span className="flex items-baseline gap-3">
                  <span className="text-xs text-zinc-500 w-12 text-right">{resumo.taxaEfetiva.toFixed(1)}%</span>
                  <span className="font-mono w-24 sm:w-28 text-right text-red-600">{formatCurrency(resumo.custoTotal)}</span>
                </span>
              </li>
            </ul>
          </div>

          {impsMes.map((imp) => (
            <p key={imp.id} className="text-[11px] text-zinc-400">
              {nomeLoja(imp.merchant_id, imp.merchant_short)}: {imp.source === 'api' ? 'API do iFood' : `arquivo ${imp.file_name ?? ''}`} · {imp.lines} linha(s) · atualizado em {new Date(imp.updated_at).toLocaleString('pt-BR')}
              {imp.integrity_ok === true && <span className="text-green-600"> · conferido com o iFood ({imp.expected_lines ?? '—'} linhas, {imp.expected_orders ?? '—'} pedidos)</span>}
              {imp.integrity_ok === false && <span className="text-red-600 font-semibold"> · ATENÇÃO: o arquivo difere do que o iFood informou ({imp.expected_lines ?? '—'} linhas e {imp.expected_orders ?? '—'} pedidos esperados) — gere o relatório de novo</span>}
            </p>
          ))}
          {lojas.length === 1 && api.ligadas === 0 && (
            <p className="text-[11px] text-amber-600">Só uma loja iFood importada. Se houver outra, baixe o relatório dela no Portal do Parceiro (troque a loja no topo do portal) e importe também.</p>
          )}
        </>
      )}

      {editLoja && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => !editLoja.salvando && setEditLoja(null)}>
          <div className="bg-white rounded-2xl w-full max-w-md shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-100">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 flex items-center justify-center rounded-xl bg-red-100">
                  <i className="ri-store-2-line text-red-600 text-lg" />
                </div>
                <div>
                  <h3 className="font-bold text-zinc-900">Nome da loja no iFood</h3>
                  <p className="text-xs text-zinc-500">Código {editLoja.curto}</p>
                </div>
              </div>
              <button onClick={() => setEditLoja(null)} disabled={editLoja.salvando}
                className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-zinc-100 cursor-pointer">
                <i className="ri-close-line text-zinc-500" />
              </button>
            </div>
            <form className="p-6 space-y-4" onSubmit={(e) => { e.preventDefault(); salvarNomeLoja(); }}>
              <div>
                <label className="block text-xs font-semibold text-zinc-700 mb-1.5">Nome</label>
                <input autoFocus type="text" value={editLoja.nome} maxLength={120}
                  onChange={(e) => setEditLoja({ ...editLoja, nome: e.target.value })}
                  onKeyDown={(e) => { if (e.key === 'Escape') setEditLoja(null); }}
                  placeholder="Ex.: El Patrón - Burritos e Nachos"
                  className="w-full border border-zinc-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-400" />
                <p className="text-[11px] text-zinc-400 mt-1.5">
                  Use o nome que aparece no topo do Portal do Parceiro ao escolher esta loja. Deixe em branco para voltar a mostrar só o código.
                </p>
              </div>
              <div>
                <label className="block text-xs font-semibold text-zinc-700 mb-1.5">Repasse antecipado</label>
                <div className="flex gap-2">
                  <div className="flex-1">
                    <div className="flex items-center border border-zinc-200 rounded-lg px-3 focus-within:ring-2 focus-within:ring-red-400">
                      <input type="text" inputMode="decimal" value={editLoja.pct} placeholder="Não antecipa"
                        onChange={(e) => setEditLoja({ ...editLoja, pct: e.target.value.replace(/[^\d,.]/g, '') })}
                        className="w-full py-2.5 text-sm focus:outline-none" />
                      <span className="text-sm text-zinc-400">%</span>
                    </div>
                    <p className="text-[11px] text-zinc-400 mt-1">Taxa de antecipação</p>
                  </div>
                  <div className="w-28">
                    <div className="flex items-center border border-zinc-200 rounded-lg px-3 focus-within:ring-2 focus-within:ring-red-400">
                      <input type="text" inputMode="numeric" value={editLoja.dias} disabled={!editLoja.pct.trim()}
                        onChange={(e) => setEditLoja({ ...editLoja, dias: e.target.value.replace(/\D/g, '').slice(0, 2) })}
                        className="w-full py-2.5 text-sm focus:outline-none disabled:bg-white disabled:text-zinc-300" />
                      <span className="text-sm text-zinc-400">dias</span>
                    </div>
                    <p className="text-[11px] text-zinc-400 mt-1">antes da data do relatório</p>
                  </div>
                </div>
                <p className="text-[11px] text-zinc-400 mt-1.5">
                  Se no Portal › Financeiro os repasses têm "Taxa de antecipação", informe o % (ex.: 1,59). O relatório de conciliação traz a data original e não traz essa taxa: o ERPOS passa cada repasse para a data antecipada (padrão 21 dias antes, a quarta-feira depois da semana de vendas) e desconta a taxa, igual ao "Valor" do portal.
                </p>
              </div>
              {editLoja.erro && (
                <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-xs text-red-700">{editLoja.erro}</div>
              )}
              <div className="flex gap-3 pt-1">
                <button type="button" onClick={() => setEditLoja(null)} disabled={editLoja.salvando}
                  className="flex-1 py-2.5 border border-zinc-200 rounded-lg text-sm font-semibold text-zinc-600 hover:bg-zinc-50 cursor-pointer">
                  Cancelar
                </button>
                <button type="submit" disabled={editLoja.salvando}
                  className="flex-1 py-2.5 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white rounded-lg text-sm font-semibold cursor-pointer flex items-center justify-center gap-2">
                  {editLoja.salvando ? <><div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" /> Salvando...</> : 'Salvar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showConfig && (
        <IfoodConfigModal onClose={() => setShowConfig(false)} onImported={() => { loadImports(); loadCompetence(); }} />
      )}
    </div>
  );
}
