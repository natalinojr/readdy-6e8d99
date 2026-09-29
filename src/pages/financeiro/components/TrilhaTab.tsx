// Trilha das despesas (2026-09-29) — versão D: tarefas + esteira + matriz numa tela só.
// "Essa despesa está certa?": cada compra/despesa é um caso com 6 fases (nota fiscal → compra ou
// despesa → estoque → conta a pagar → pagamento → extrato do banco). A tela mostra o que falta
// fazer (Tarefas), onde o dinheiro está parado (Esteira) e tudo fase a fase (Matriz).
// Montagem em src/lib/trilhaDespesas.ts; dados pela RPC fin_trilha_dados. As ações dos botões são
// só as que já existem (abrir a tela certa ou a janela que resolve) — nada novo é gravado daqui.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useEstoque } from '@/contexts/EstoqueContext';
import { supabase } from '@/lib/supabase';
import { todayBrasilia } from '@/lib/dateUtils';
import { avisar } from '@/components/base/Dialogos';
import { ASSISTENTE_OWNER_EMAIL } from '@/components/feature/AssistenteChat';
import type { BillPayable, Purchase } from '@/types/financeiro';
import { MonthNav, mesExtenso } from './dreUi';
import LinhaExtratoModal from './conciliacao/LinhaExtratoModal';
import DetalhePurchaseModal from './compras/DetalhePurchaseModal';
import ContasPagarDREModal from './ContasPagarDREModal';
import {
  montarTrilha, ruim, grave, NOMES_ETAPA,
  type Atalho, type CasoTrilha, type EstadoEtapa, type EtapaId, type GrupoTarefa, type TrExtrato, type TrilhaDados,
} from '@/lib/trilhaDespesas';
import { GRUPOS, GRUPO_POR_ID, ETAPAS_FUNIL, ICONE_ETAPA, fmtBRL, type AcoesTrilha, type TarefaComCaso } from './trilha/comum';
import TarefaCard from './trilha/TarefaCard';
import Esteira from './trilha/Esteira';
import Matriz from './trilha/Matriz';
import Gaveta from './trilha/Gaveta';
import type { BoletoInfo } from './trilha/api';

const limitesMes = (ano: number, mes: number) => {
  const de = `${ano}-${String(mes + 1).padStart(2, '0')}-01`;
  const ult = new Date(ano, mes + 1, 0).getDate();
  return { de, ate: `${ano}-${String(mes + 1).padStart(2, '0')}-${String(ult).padStart(2, '0')}` };
};

type Modo = 'tarefas' | 'esteira' | 'matriz';
interface Resolvido { key: string; titulo: string; grupo: GrupoTarefa; rotulo: string; desfazer?: () => Promise<void> }
interface CompraAberta { purchase: Purchase; installments: BillInst[]; loading: boolean }
interface BillInst { id: string; installment_number: number; installments: number; amount: number; due_date: string; status: string; paid_date?: string; paid_amount?: number }

const LIMITE_TAREFAS = 30;
const estadoDa = (c: CasoTrilha, id: EtapaId): EstadoEtapa => c.etapas.find((e) => e.id === id)!.estado;

export default function TrilhaTab() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { reloadInsumos, reloadMovimentacoes } = useEstoque();
  const hoje = todayBrasilia();
  const [ano, setAno] = useState(Number(hoje.slice(0, 4)));
  const [mes, setMes] = useState(Number(hoje.slice(5, 7)) - 1);
  const [dados, setDados] = useState<TrilhaDados | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [modo, setModo] = useState<Modo>('tarefas');
  const [grupo, setGrupo] = useState<GrupoTarefa | null>(null);
  const [etapaF, setEtapaF] = useState<EtapaId | null>(null);
  const [soUrg, setSoUrg] = useState(false);
  const [busca, setBusca] = useState('');
  const [expandidos, setExpandidos] = useState<Set<string>>(new Set());
  const [gavetaKey, setGavetaKey] = useState<string | null>(null);
  const [limite, setLimite] = useState(LIMITE_TAREFAS);
  const [resolvidos, setResolvidos] = useState<Resolvido[]>([]);
  // Janelas abertas aqui mesmo
  const [linha, setLinha] = useState<TrExtrato | null>(null);
  const [compra, setCompra] = useState<CompraAberta | null>(null);
  const [billsDRE, setBillsDRE] = useState<BillPayable[] | null>(null);
  const [boletos, setBoletos] = useState<Map<string, BoletoInfo>>(new Map());
  const rotuloRef = useRef<string>('');
  const desfazerRef = useRef<(() => Promise<void>) | undefined>(undefined);
  const dono = user?.email?.toLowerCase() === ASSISTENTE_OWNER_EMAIL;
  const antesRef = useRef<Map<string, { titulo: string; grupo: GrupoTarefa }>>(new Map());
  const { de, ate } = limitesMes(ano, mes);

  const carregar = useCallback(async (comRastro = false) => {
    if (!user?.tenantId) return;
    setCarregando(true);
    setErro(null);
    const { data, error } = await supabase.rpc('fin_trilha_dados', { p_tenant: user.tenantId, p_start: de, p_end: ate });
    setCarregando(false);
    if (error) { setErro(error.message); setDados(null); return; }
    const d = data as TrilhaDados;
    if (comRastro) {
      // "Resolvido agora": tarefas que existiam antes da ação e não existem mais
      const novas = new Set(montarTrilha(d, de, ate, todayBrasilia()).flatMap((c) => c.tarefas.map((t) => t.key)));
      const somem = [...antesRef.current].filter(([k]) => !novas.has(k));
      if (somem.length) {
        const rotulo = rotuloRef.current || 'Resolvido pela Trilha';
        const desfazer = desfazerRef.current;
        setResolvidos((prev) => [...somem.map(([key, v]) => ({ key, ...v, rotulo, desfazer })), ...prev.filter((r) => !somem.some(([k]) => k === r.key))]);
      }
      desfazerRef.current = undefined;
    }
    setDados(d);
  }, [user?.tenantId, de, ate]);

  useEffect(() => { void carregar(); }, [carregar]);
  // Trocou de mês (ou de loja): recomeça a sessão de "resolvido agora"
  useEffect(() => { setResolvidos([]); antesRef.current = new Map(); setGavetaKey(null); setLimite(LIMITE_TAREFAS); }, [de, user?.tenantId]);
  useEffect(() => { setLimite(LIMITE_TAREFAS); }, [grupo, etapaF, soUrg, busca]);

  const casos = useMemo(() => (dados ? montarTrilha(dados, de, ate, hoje) : []), [dados, de, ate, hoje]);
  const todasTarefas = useMemo<TarefaComCaso[]>(() => casos.flatMap((caso) => caso.tarefas.map((tarefa) => ({ tarefa, caso }))), [casos]);
  useEffect(() => {
    antesRef.current = new Map(todasTarefas.map(({ tarefa, caso }) => [tarefa.key, { titulo: caso.titulo, grupo: tarefa.grupo }]));
  }, [todasTarefas]);

  // Boleto/Pix guardado das contas vencidas — só o dono paga por aqui, então só ele carrega.
  const idsVencidas = useMemo(() => (dono ? [...new Set(todasTarefas.filter((x) => x.tarefa.grupo === 'vencidas')
    .flatMap((x) => x.caso.contas.filter((c) => c.status !== 'paid' && (c.status === 'overdue' || String(c.due_date ?? '').slice(0, 10) < hoje)).map((c) => c.id)))] : []), [dono, todasTarefas, hoje]);
  const chaveVencidas = idsVencidas.join(',');
  useEffect(() => {
    if (!user?.tenantId || idsVencidas.length === 0) { setBoletos(new Map()); return; }
    let vivo = true;
    (async () => {
      const mapa = new Map<string, BoletoInfo>();
      for (let i = 0; i < idsVencidas.length; i += 150) {
        const { data } = await supabase.from('fin_accounts_payable')
          .select('id, boleto_digitavel, boleto_barcode, boleto_pix_copia, boleto_origem')
          .eq('tenant_id', user.tenantId).in('id', idsVencidas.slice(i, i + 150));
        for (const b of (data ?? []) as BoletoInfo[]) mapa.set(b.id, b);
      }
      if (vivo) setBoletos(mapa);
    })();
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.tenantId, chaveVencidas]);

  // ── filtros ────────────────────────────────────────────────────────────────
  const q = busca.trim().toLowerCase();
  const bate = useCallback((c: CasoTrilha) => !q
    || `${c.titulo} ${c.subtitulo} ${c.notas.map((n) => n.numero).join(' ')} ${c.compra?.invoice_number ?? ''} ${c.valor.toFixed(2).replace('.', ',')}`.toLowerCase().includes(q), [q]);
  const casosFiltrados = useMemo(() => casos.filter((c) =>
    (!soUrg || c.situacao === 'atencao') && (!etapaF || ruim(estadoDa(c, etapaF))) && bate(c)), [casos, soUrg, etapaF, bate]);
  const tarefasFiltradas = useMemo(() => todasTarefas.filter(({ tarefa, caso }) =>
    (!soUrg || tarefa.urgente) && (!etapaF || tarefa.etapas.includes(etapaF)) && bate(caso)), [todasTarefas, soUrg, etapaF, bate]);

  // ── topo ───────────────────────────────────────────────────────────────────
  const completos = casos.filter((c) => c.situacao === 'ok').length;
  const pct = casos.length ? Math.round((completos / casos.length) * 100) : 0;
  const urgentes = todasTarefas.filter((x) => x.tarefa.urgente).length;
  const funil = useMemo(() => ETAPAS_FUNIL.map((id) => {
    let ok = 0, amarelo = 0, vermelho = 0, n = 0;
    for (const c of casos) {
      const e = estadoDa(c, id);
      if (e === 'na' || e === 'espera') continue;
      if (e === 'ok') ok += c.valor;
      else if (grave(e)) { vermelho += c.valor; n++; }
      else { amarelo += c.valor; if (ruim(e)) n++; }
    }
    const tot = ok + amarelo + vermelho;
    return { id, ok, amarelo, vermelho, tot, n, pct: tot ? Math.round((ok / tot) * 100) : 100, grave: vermelho > 0 };
  }), [casos]);

  const mesStr = `${ano}-${String(mes + 1).padStart(2, '0')}`;
  const mesAtualStr = hoje.slice(0, 7);
  const trocarMes = (m: string) => { setAno(Number(m.slice(0, 4))); setMes(Number(m.slice(5, 7)) - 1); };
  const trocarModo = (m: Modo) => { setGavetaKey(null); setModo(m); };

  // ── ações (donas das janelas) ─────────────────────────────────────────────
  const abrirCompra = useCallback(async (id: string, rotulo: string) => {
    if (!user?.tenantId) return;
    rotuloRef.current = rotulo;
    const { data, error } = await supabase.from('fin_purchases')
      .select('*, items:fin_purchase_items(*), cost_center:fin_cost_centers(id,name,color,icon)')
      .eq('tenant_id', user.tenantId).eq('id', id).maybeSingle();
    if (error || !data) { void avisar('Não consegui abrir a compra. Tente de novo ou abra pela aba Compras.', { erro: true }); return; }
    const p = data as Purchase;
    setCompra({ purchase: p, installments: [], loading: p.payment_status !== 'paid' });
    if (p.payment_status === 'paid') return;
    // parcelas pelo VÍNCULO da compra (mesmo critério da aba Compras)
    const { data: parcelas } = await supabase.from('fin_accounts_payable')
      .select('id,installment_number,installments,amount,due_date,status,paid_date,paid_amount')
      .eq('tenant_id', user.tenantId).eq('reference_id', p.id).eq('reference_type', 'purchase').order('installment_number');
    setCompra({ purchase: p, installments: (parcelas ?? []) as BillInst[], loading: false });
  }, [user?.tenantId]);

  const abrirClassificar = useCallback(async (caso: CasoTrilha, rotulo: string) => {
    if (!user?.tenantId) return;
    rotuloRef.current = rotulo;
    const ids = caso.contas.map((c) => c.id);
    const { data, error } = await supabase.from('fin_accounts_payable').select('*').eq('tenant_id', user.tenantId).in('id', ids);
    if (error || !data?.length) { void avisar('Não consegui carregar as contas a pagar desta despesa.', { erro: true }); return; }
    setBillsDRE(data as BillPayable[]);
  }, [user?.tenantId]);

  const ir = useCallback((a: Atalho) => {
    if (a.extrato) { rotuloRef.current = 'Ligou o extrato'; setLinha(a.extrato); return; }
    navigate('/financeiro?tab=' + a.tab + (a.param && a.valor ? '&' + a.param + '=' + encodeURIComponent(a.valor) : ''));
  }, [navigate]);

  const acoes = useMemo<AcoesTrilha>(() => ({
    ir,
    rota: (path) => navigate(path),
    extrato: (e, rotulo) => { rotuloRef.current = rotulo; setLinha(e); },
    compra: (id, rotulo) => { void abrirCompra(id, rotulo); },
    classificar: (c, rotulo) => { void abrirClassificar(c, rotulo); },
    dono, tenantId: user?.tenantId ?? '', hoje, boletos,
    concluir: async (rotulo, desfazer) => { rotuloRef.current = rotulo; desfazerRef.current = desfazer; await carregar(true); },
    recarregar: async () => { await carregar(); },
  }), [ir, navigate, abrirCompra, abrirClassificar, dono, user?.tenantId, hoje, boletos, carregar]);

  const desfazerResolvido = async (r: Resolvido) => {
    if (!r.desfazer) return;
    try {
      await r.desfazer();
      setResolvidos((prev) => prev.filter((x) => x.key !== r.key));
      await carregar();
    } catch (e) {
      void avisar(e instanceof Error ? e.message : String(e), { erro: true, titulo: 'Não deu para desfazer' });
    }
  };

  const aposCompra = () => {
    setCompra(null);
    reloadInsumos();
    reloadMovimentacoes();
    void carregar(true);
  };

  const alternarFases = (key: string) => setExpandidos((s) => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n; });

  const casoDaGaveta = gavetaKey ? casos.find((c) => c.key === gavetaKey) ?? null : null;
  const algumaJanela = !!(linha || compra || billsDRE);
  useEffect(() => {
    if (!casoDaGaveta) return;
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape' && !algumaJanela) setGavetaKey(null); };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [casoDaGaveta, algumaJanela]);

  // ── Tarefas: menu + cards por grupo ───────────────────────────────────────
  const listaPorGrupo = GRUPOS.map((g) => {
    const ts = tarefasFiltradas.filter((x) => x.tarefa.grupo === g.id)
      .sort((a, b) => Number(b.tarefa.urgente) - Number(a.tarefa.urgente) || b.caso.valor - a.caso.valor);
    return { g, ts, total: todasTarefas.filter((x) => x.tarefa.grupo === g.id).length };
  });
  const visiveis = listaPorGrupo.filter(({ g, ts }) => ts.length > 0 && (!grupo || grupo === g.id));
  const resolvidosVisiveis = resolvidos.filter((r) => !todasTarefas.some((x) => x.tarefa.key === r.key));

  const MODOS: { id: Modo; label: string; icone: string; n?: number }[] = [
    { id: 'tarefas', label: 'Tarefas', icone: 'ri-checkbox-multiple-line', n: todasTarefas.length },
    { id: 'esteira', label: 'Esteira', icone: 'ri-layout-column-line' },
    { id: 'matriz', label: 'Matriz', icone: 'ri-grid-line' },
  ];

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-[1400px] mx-auto overflow-x-hidden">
      {/* ── Topo: placar + funil ── */}
      <div className="bg-white rounded-2xl border border-zinc-200 p-4 md:p-5">
        <div className="flex flex-col xl:flex-row gap-5">
          <div className="flex items-center gap-4 xl:w-[380px] shrink-0">
            <div className="relative w-24 h-24 shrink-0">
              <svg viewBox="0 0 36 36" className="w-24 h-24 -rotate-90">
                <circle cx="18" cy="18" r="15.9" fill="none" stroke="#f4f4f5" strokeWidth="3.4" />
                <circle cx="18" cy="18" r="15.9" fill="none" stroke={pct >= 70 ? '#10b981' : '#f59e0b'} strokeWidth="3.4" strokeLinecap="round" strokeDasharray={`${pct} 100`} style={{ transition: 'stroke-dasharray .5s' }} />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-xl font-bold tabular-nums">{carregando && !dados ? '…' : pct + '%'}</span>
                <span className="text-[10px] text-zinc-400">fechado</span>
              </div>
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-bold text-zinc-900 flex items-center gap-1.5"><i className="ri-route-line text-amber-500" />Trilha de {mesExtenso(mesStr).split(' de ')[0].toLowerCase()}</h2>
              <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                <MonthNav mes={mesStr} onChange={trocarMes} canGoNext={mesStr < mesAtualStr} />
                {mesStr !== mesAtualStr && (
                  <button onClick={() => trocarMes(mesAtualStr)} className="text-xs font-semibold px-2.5 py-2 bg-amber-50 text-amber-700 border border-amber-200 rounded-xl hover:bg-amber-100 cursor-pointer whitespace-nowrap">Mês atual</button>
                )}
                <button onClick={() => void carregar()} aria-label="Atualizar" title="Atualizar" className="flex items-center gap-1.5 px-2.5 py-2 border border-zinc-200 bg-white hover:bg-zinc-50 rounded-xl text-xs font-semibold text-zinc-600 cursor-pointer whitespace-nowrap shadow-sm">
                  <i className={`ri-refresh-line ${carregando ? 'animate-spin' : ''}`} />Atualizar
                </button>
              </div>
              <p className="text-xs text-zinc-500 mt-2">
                {!dados ? '' : todasTarefas.length ? (
                  <>
                    <strong>{todasTarefas.length} {todasTarefas.length === 1 ? 'tarefa' : 'tarefas'}</strong> para fechar o mês
                    {urgentes > 0 && <> · <span className="text-red-600 font-semibold">{urgentes} {urgentes === 1 ? 'urgente' : 'urgentes'}</span></>}
                    {' '}· {completos} de {casos.length} casos completos
                  </>
                ) : casos.length ? (
                  <><span className="text-emerald-700 font-semibold">Nada a fazer agora</span> — {completos} de {casos.length} casos completos; o resto depende do prazo.</>
                ) : 'Nenhuma compra ou despesa neste mês.'}
              </p>
            </div>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline justify-between gap-2 mb-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Quanto do dinheiro do mês já passou por cada fase</p>
              {etapaF && <button onClick={() => setEtapaF(null)} className="text-xs text-zinc-500 underline cursor-pointer">limpar fase</button>}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-2">
              {funil.map((f) => (
                <button key={f.id} onClick={() => setEtapaF(etapaF === f.id ? null : f.id)}
                  className={`text-left rounded-xl border p-2.5 transition cursor-pointer min-w-0 ${etapaF === f.id ? 'border-amber-400 ring-2 ring-amber-100 bg-amber-50/40' : 'border-zinc-200 hover:border-zinc-300'}`}>
                  <div className="flex items-start justify-between gap-1">
                    <span className="flex items-start gap-1.5 text-[11px] font-semibold text-zinc-600 leading-tight min-w-0"><i className={`${ICONE_ETAPA[f.id]} mt-px`} /><span className="min-w-0 break-words">{NOMES_ETAPA[f.id]}</span></span>
                    {f.n > 0
                      ? <span className={`text-[10px] font-bold px-1.5 rounded-md ${f.grave ? 'bg-red-50 text-red-600' : 'bg-amber-50 text-amber-700'}`}>{f.n}</span>
                      : <i className="ri-check-double-line text-emerald-500 text-xs" />}
                  </div>
                  <p className={`text-lg font-bold tabular-nums mt-1 ${f.pct === 100 ? 'text-emerald-700' : ''}`}>{f.pct}%</p>
                  <div className="flex h-1.5 rounded-full overflow-hidden bg-zinc-100 gap-px">
                    <div className="bg-emerald-500" style={{ width: `${f.tot ? (f.ok / f.tot) * 100 : 100}%` }} />
                    <div className="bg-amber-400" style={{ width: `${f.tot ? (f.amarelo / f.tot) * 100 : 0}%` }} />
                    <div className="bg-red-500" style={{ width: `${f.tot ? (f.vermelho / f.tot) * 100 : 0}%` }} />
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── Barra: formas de ver + filtros ── */}
      <div className="flex flex-wrap items-center gap-2 lg:gap-3">
        <div className="flex gap-1 bg-zinc-100/80 rounded-xl p-1">
          {MODOS.map((m) => (
            <button key={m.id} onClick={() => trocarModo(m.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap cursor-pointer transition-colors ${modo === m.id ? 'bg-white text-amber-600 shadow-sm' : 'text-zinc-500 hover:text-zinc-800'}`}>
              <i className={m.icone} />{m.label}
              {!!m.n && <span className="text-[10px] bg-amber-500 text-white rounded-full px-1.5">{m.n}</span>}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-xs text-zinc-600 cursor-pointer select-none">
          <input type="checkbox" checked={soUrg} onChange={(e) => setSoUrg(e.target.checked)} className="accent-amber-500" /> só urgentes
        </label>
        <div className="relative sm:ml-auto w-full sm:w-72">
          <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 text-sm" />
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Fornecedor, nº da nota, valor…"
            className="w-full h-10 pl-9 pr-3 text-sm border border-zinc-200 rounded-xl shadow-sm focus:outline-none focus:border-amber-400 bg-white" />
        </div>
      </div>

      {erro && <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-xs text-red-800">Não foi possível carregar a trilha: {erro}</div>}
      {carregando && !dados && <div className="rounded-2xl border border-zinc-200 bg-white py-14 text-center text-sm text-zinc-400">Montando a trilha…</div>}

      {dados && modo === 'tarefas' && (
        <div className="grid grid-cols-1 lg:grid-cols-[290px_minmax(0,1fr)] gap-4 items-start">
          <div className="space-y-3 lg:sticky lg:top-4 min-w-0">
            <nav className="bg-white rounded-2xl border border-zinc-200 p-2">
              <button onClick={() => setGrupo(null)} className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-left cursor-pointer ${!grupo ? 'bg-amber-50 text-amber-700' : 'hover:bg-zinc-50'}`}>
                <i className="ri-inbox-line" /><span className="flex-1 text-sm font-semibold">Todas</span><span className="text-xs font-bold tabular-nums">{tarefasFiltradas.length}</span>
              </button>
              {listaPorGrupo.map(({ g, ts, total }) => total === 0 ? (
                <div key={g.id} className="flex items-center gap-2.5 px-3 py-2 text-zinc-300">
                  <i className={g.icone} /><span className="flex-1 text-sm line-through">{g.nome}</span><i className="ri-check-line text-emerald-400" />
                </div>
              ) : (
                <button key={g.id} onClick={() => setGrupo(g.id)}
                  className={`w-full flex items-start gap-2.5 px-3 py-2.5 rounded-xl text-left cursor-pointer ${grupo === g.id ? 'bg-amber-50 text-amber-700' : 'hover:bg-zinc-50'} ${ts.length ? '' : 'opacity-50'}`}>
                  <i className={`${g.icone} mt-0.5 ${g.cor === 'red' ? 'text-red-500' : 'text-amber-500'}`} />
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-semibold leading-snug">{g.nome}</span>
                    <span className="block text-[11px] text-zinc-400 leading-snug mt-0.5">{g.desc}</span>
                  </span>
                  <span className={`text-[11px] font-bold px-1.5 py-0.5 rounded-md ${g.cor === 'red' ? 'bg-red-50 text-red-600' : 'bg-amber-50 text-amber-700'}`}>{ts.length}</span>
                </button>
              ))}
            </nav>
            <div className="bg-white rounded-2xl border border-zinc-200 p-4">
              <h3 className="text-sm font-bold text-zinc-800">Resolvido agora</h3>
              <ul className="mt-2 space-y-1.5 text-xs max-h-48 overflow-y-auto">
                {resolvidosVisiveis.length === 0 && <li className="text-zinc-400">Nada ainda — comece pelos urgentes.</li>}
                {resolvidosVisiveis.map((r) => (
                  <li key={r.key} className="flex items-start gap-1.5">
                    <i className="ri-check-line text-emerald-500 mt-px" />
                    <span className="flex-1 min-w-0"><strong className="text-zinc-700">{r.titulo}</strong><br /><span className="text-zinc-400">{r.rotulo}</span></span>
                    {r.desfazer
                      ? <button onClick={() => void desfazerResolvido(r)} className="shrink-0 text-[11px] font-semibold text-zinc-400 hover:text-zinc-800 px-1.5 py-0.5 rounded-md hover:bg-zinc-100 cursor-pointer" title="Voltar esta tarefa para a lista"><i className="ri-arrow-go-back-line" /> desfazer</button>
                      : <button onClick={() => navigate(GRUPO_POR_ID[r.grupo].origem)} className="shrink-0 text-[11px] font-semibold text-zinc-400 hover:text-zinc-800 px-1.5 py-0.5 rounded-md hover:bg-zinc-100 cursor-pointer" title="Abrir a tela de origem">Abrir <i className="ri-arrow-right-up-line" /></button>}
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <section className="space-y-3 min-w-0">
            {visiveis.map(({ g, ts }) => {
              const mostrar = ts.slice(0, limite);
              return (
                <div key={g.id} className="bg-white rounded-2xl border border-zinc-200 overflow-hidden">
                  <div className="flex items-center gap-2.5 px-4 md:px-5 py-3 border-b border-zinc-100 min-w-0">
                    <span className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${g.cor === 'red' ? 'bg-red-50 text-red-600' : 'bg-amber-50 text-amber-600'}`}><i className={g.icone} /></span>
                    <div className="min-w-0">
                      <h3 className="text-sm font-bold text-zinc-800">{g.nome} <span className="text-zinc-400 font-normal">· {ts.length}</span></h3>
                      <p className="text-xs text-zinc-400">{g.desc} · {fmtBRL(ts.reduce((s, x) => s + x.caso.valor, 0))}</p>
                    </div>
                  </div>
                  <div className="p-3 space-y-2">
                    {mostrar.map(({ tarefa, caso }) => (
                      <TarefaCard key={tarefa.key} caso={caso} tarefa={tarefa} expandido={expandidos.has(tarefa.key)} onToggle={() => alternarFases(tarefa.key)} acoes={acoes} />
                    ))}
                    {ts.length > limite && (
                      <button onClick={() => setLimite(limite + LIMITE_TAREFAS)} className="w-full py-2 text-xs font-semibold text-zinc-600 border border-zinc-200 rounded-xl bg-white hover:bg-zinc-50 cursor-pointer">
                        Mostrar mais ({ts.length - limite} restantes)
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
            {visiveis.length === 0 && (
              <div className="bg-white rounded-2xl border border-emerald-200 py-16 text-center">
                <i className="ri-checkbox-circle-fill text-5xl text-emerald-400 block mb-2" />
                <p className="font-semibold">Nada pendente{etapaF || busca || soUrg ? ' com esses filtros' : ''}</p>
              </div>
            )}
          </section>
        </div>
      )}

      {dados && modo === 'esteira' && <Esteira casos={casosFiltrados} onAbrir={(c) => setGavetaKey(c.key)} />}
      {dados && modo === 'matriz' && <Matriz casos={casosFiltrados} onAbrir={(c) => setGavetaKey(c.key)} />}

      {casoDaGaveta && (
        <Gaveta caso={casoDaGaveta} expandidos={expandidos} onToggle={alternarFases} acoes={acoes} onFechar={() => setGavetaKey(null)} />
      )}

      {/* ── Janelas que já existem no sistema, abertas aqui mesmo ── */}
      {linha && <LinhaExtratoModal linha={linha} onClose={() => setLinha(null)} onChanged={() => void carregar(true)} />}
      {compra && (
        <DetalhePurchaseModal
          purchase={compra.purchase}
          installments={compra.installments}
          loadingInstallments={compra.loading}
          onClose={() => setCompra(null)}
          onDeliveryConfirmed={aposCompra}
          onDeleted={aposCompra}
          onItemsChanged={aposCompra}
        />
      )}
      {billsDRE && <ContasPagarDREModal bills={billsDRE} onClose={() => setBillsDRE(null)} onSaved={() => void carregar(true)} />}
    </div>
  );
}
