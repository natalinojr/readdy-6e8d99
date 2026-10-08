// Financeiro › Contas (2026-10-08, pedido do dono: "bater o olho e entender; o detalhe só ao clicar").
// Substitui as abas Pagamentos, Contas Vencidas e Trilha (os links antigos caem aqui) e absorve Contas a Pagar
// (a lista completa com nova conta, exportar e despesa fixa fica em "Lista completa").
// Uma chamada só (fn_contas_painel); as regras ficam em src/lib/contasPainel.ts (testadas).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { usePermissoes } from '@/hooks/usePermissoes';
import { supabase, invokeWithAuth } from '@/lib/supabase';
import { DONO_EMAIL } from '../../../../../supabase/functions/_shared/pendencia-visivel';
import {
  linhasAbertas, linhaPaga, numeros, saldosPorLinha, ORDEM_GRUPOS,
  type DadosPainel, type Linha, type Grupo, type Janela, type Passo, type SaldoLinha,
} from '@/lib/contasPainel';
import { AcoesPagar } from '../pagamentos/comum';
import LinhaExtratoModal from '../conciliacao/LinhaExtratoModal';
import ContasPagarTab from '../ContasPagarTab';
import FixasDaLoja from './FixasDaLoja';

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const nb = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const sinal = (v: number) => `${v < 0 ? '−' : ''}${nb(Math.abs(v))}`;
const ddmm = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const SEM = ['', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'];
const dsem = (d: string) => { const w = new Date(`${d}T12:00:00Z`).getUTCDay(); return SEM[w === 0 ? 7 : w]; };
const hora = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }) : null);

const NOME_GRUPO: Record<Grupo, string> = {
  semexp: 'Saiu do banco sem explicação', sem_conta: 'Notas com boleto que não viraram conta', venc: 'Vencidas',
  sem: 'Esta semana', prox: 'Próxima semana', dep: 'Depois', pagas: 'Pagas',
};
const COR_GRUPO: Partial<Record<Grupo, string>> = { semexp: 'text-orange-700', sem_conta: 'text-orange-700', venc: 'text-red-600' };
const JANELAS: { j: Janela; t: string }[] = [{ j: 1, t: 'mês passado' }, { j: 2, t: '2 meses' }, { j: 3, t: '3 meses' }, { j: 6, t: '6 meses' }];
const JANELA_KEY = 'erpos.contas.janela';
const lerJanela = (): Janela => { try { const v = Number(localStorage.getItem(JANELA_KEY)); return ([1, 2, 3, 6] as number[]).includes(v) ? (v as Janela) : 3; } catch { return 3; } };

// ───────── pedaços visuais ─────────
const ICONE_PASSO = ['ri-file-text-line', 'ri-truck-line', 'ri-bank-line'];
const NOME_PASSO = ['Nota', 'Chegou', 'Pago'];
const ESTADO_PASSO: Record<Passo, string> = { ok: 'feito', esp: 'ainda não', no: 'atrasado', amb: 'falta explicar', na: 'não precisa', meio: 'aguardando', unk: 'sem como saber' };
function No({ p, i, doc }: { p: Passo; i: number; doc?: boolean }) {
  const ic = p === 'ok' || p === 'esp' ? (i === 0 && doc ? 'ri-mail-line' : ICONE_PASSO[i]) : p === 'no' ? 'ri-close-line' : p === 'amb' ? 'ri-error-warning-line' : p === 'meio' ? 'ri-time-line' : p === 'unk' ? 'ri-question-mark' : 'ri-subtract-line';
  const cls = {
    ok: 'bg-emerald-50 text-emerald-700', esp: 'bg-white border-[1.5px] border-zinc-400 text-zinc-400', no: 'bg-red-600 text-white',
    amb: 'bg-orange-600 text-white', na: 'bg-white text-zinc-300', meio: 'bg-blue-50 text-blue-700 border-[1.5px] border-blue-600', unk: 'bg-zinc-100 text-zinc-600',
  }[p];
  return <span title={`${NOME_PASSO[i]}: ${ESTADO_PASSO[p]}`} aria-label={`${NOME_PASSO[i]}: ${ESTADO_PASSO[p]}`} className={`w-[22px] h-[22px] rounded-full grid place-items-center text-xs shrink-0 ${cls}`}><i className={ic} /></span>;
}
function Andamento({ l }: { l: Linha }) {
  const doc = !!l.conta?.fixa && !l.conta?.nf && !!l.conta?.tem_boleto;
  const seg = (i: number) => { const a = l.passos[i], b = l.passos[i + 1]; const c = b === 'no' ? 'bg-red-300' : a === 'ok' && (b === 'ok' || b === 'meio') ? 'bg-emerald-300' : 'bg-zinc-200'; return <span className={`flex-1 h-0.5 mx-0.5 rounded ${c}`} />; };
  return <div className="flex items-center w-[112px]"><No p={l.passos[0]} i={0} doc={doc} />{seg(0)}<No p={l.passos[1]} i={1} />{seg(1)}<No p={l.passos[2]} i={2} /></div>;
}
function Situacao({ l }: { l: Linha }) {
  const acao = (t: string, cor: string) => <span className={`text-xs font-extrabold whitespace-nowrap rounded-full px-2.5 py-0.5 border-[1.5px] bg-white ${cor}`}>{t}</span>;
  switch (l.situacao) {
    case 'venc_pagar': return acao('Pagar', 'text-red-600 border-red-600');
    case 'venc_cobrar': case 'cobrar': return acao('Cobrar loja', 'text-orange-700 border-orange-700');
    case 'semexp': return acao('Explicar', 'text-orange-700 border-orange-700');
    case 'sem_conta': return acao('Lançar', 'text-orange-700 border-orange-700');
    case 'cartao': return <span className="text-xs font-bold text-blue-700 whitespace-nowrap"><i className="ri-bank-card-line" /> no cartão</span>;
    case 'pago': return <span className="text-xs font-bold text-emerald-700 whitespace-nowrap">✓ conferido</span>;
    case 'pago_sem_banco': return <span className="text-xs font-semibold text-zinc-500 whitespace-nowrap">sem extrato</span>;
    default: return <span className="text-xs font-semibold text-zinc-500 whitespace-nowrap">{l.dias === 0 ? 'vence hoje' : `em ${l.dias} dia${l.dias > 1 ? 's' : ''}`}</span>;
  }
}
function Explica({ children, rotulo, alinhar = 'right' }: { children: React.ReactNode; rotulo: React.ReactNode; alinhar?: 'left' | 'right' }) {
  return (
    <span tabIndex={0} className="relative inline-flex items-center gap-1 cursor-help outline-none group">
      {rotulo}
      <span className={`hidden group-hover:block group-focus:block absolute top-[calc(100%+6px)] ${alinhar === 'right' ? 'right-0' : 'left-0'} z-30 w-[330px] bg-zinc-900 text-zinc-200 rounded-xl p-3.5 text-xs font-medium leading-relaxed text-left shadow-xl whitespace-normal`}>{children}</span>
    </span>
  );
}
const LinhaTip = ({ a, b, cls = '' }: { a: React.ReactNode; b: string; cls?: string }) => (
  <span className={`flex justify-between gap-3 mt-1.5 ${cls}`}><span>{a}</span><b className="text-white whitespace-nowrap tabular-nums">{b}</b></span>
);
function ContaDoProjetado({ l, s }: { l: Linha; s: SaldoLinha }) {
  const dias = s.dias;
  const porSemana = dias.length > 7;
  const blocos = porSemana
    ? Object.values(dias.reduce<Record<string, typeof dias>>((m, d) => { const k = String(Math.floor(Date.parse(`${d.d}T12:00:00Z`) / 604800000 - 4 / 7)); (m[k] = m[k] || []).push(d); return m; }, {}))
    : dias.map((d) => [d]);
  return (
    <>
      <b className="block text-white">{l.nome} · {ddmm(l.data)}</b>
      <LinhaTip a="Saldo depois de pagar as contas até aqui" b={brl(s.real)} />
      <LinhaTip a={dias.length ? `+ vendas previstas de ${ddmm(dias[0].d)} até ${ddmm(s.ate)}` : '+ vendas previstas (nenhuma: é hoje)'} b={brl(s.vendas)} />
      {blocos.map((g) => (
        <LinhaTip key={g[0].d} cls="!mt-0.5 pl-2 text-zinc-400"
          a={g.length > 1 ? `${ddmm(g[0].d)} a ${ddmm(g[g.length - 1].d)}${g.some((x) => x.estimado) ? ' *' : ''}` : `${ddmm(g[0].d)} · ${g[0].nome}${g[0].estimado ? ' *' : ''}`}
          b={brl(g.reduce((t, x) => t + x.entra, 0))} />
      ))}
      <LinhaTip a="+ repasses de aplicativos" b={brl(s.apps)} />
      <LinhaTip a="= Projetado" b={brl(s.proj)} cls="border-t border-zinc-700 pt-1.5 font-bold" />
      <span className="block mt-2 text-[11px] text-zinc-500">Vendas já sem taxas. Cada dia usa a média do mesmo dia da semana na mesma semana do mês.
        {dias.some((x) => x.estimado) && <><br />* a média inclui dias sem todas as formas de pagamento registradas; nesses dias a venda foi estimada pela parte do cartão.</>}</span>
    </>
  );
}
const REGRA = (janela: Janela) => (
  <>
    <b className="block text-white">Como o projetado é calculado</b>
    <span className="block mt-1.5"><b className="text-white">1.</b> Saldo depois: saldo de hoje em todas as contas menos as contas lançadas até aquela data. As vencidas contam como pagas hoje.</span>
    <span className="block mt-1.5"><b className="text-white">2.</b> + vendas que ainda vão acontecer: para cada dia, a média {janela === 1 ? 'do mês passado' : `dos últimos ${janela} meses`} do <b className="text-white">mesmo dia da semana na mesma semana do mês</b>. Ex.: a 2ª quinta usa a média das 2ªs quintas.</span>
    <span className="block mt-1.5"><b className="text-white">3.</b> Cada venda conta no dia em que acontece, já sem as taxas.</span>
    <span className="block mt-1.5"><b className="text-white">4.</b> + repasses já informados pelos aplicativos de entrega.</span>
  </>
);

// ───────── tela ─────────
export default function ContasTab({ onNavigateToCompras }: { onNavigateToCompras?: (purchaseId?: string) => void }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const dono = (user?.email ?? '').toLowerCase() === DONO_EMAIL;
  const financeiro = dono || ['admin', 'gerente', 'financeiro'].includes(String(user?.perfil ?? ''));
  // A aba abre para quem tinha Contas a Pagar, Pagamentos ou Contas Vencidas; a lista completa (criar,
  // excluir, exportar) continua só com Contas a Pagar, e as fixas com Contas a Pagar ou Pagamentos.
  const { hasPermissao } = usePermissoes();
  const podeLista = hasPermissao('fin_pagar');
  const podeFixas = podeLista || hasPermissao('fin_pagamentos');

  // Links antigos: ?abrir=nova|email (Contas a Pagar) abrem a lista completa; ?ver=fixas as contas fixas.
  // Busca vinda de outra tela (?busca=, às vezes com ?mes=) procura em todos os meses: abre a lista completa.
  const querLista = (p: URLSearchParams) => p.get('abrir') === 'nova' || p.get('abrir') === 'email' || p.get('lista') === '1' || !!p.get('busca');
  const visaoUrl = podeLista && querLista(params) ? 'lista' : podeFixas && params.get('ver') === 'fixas' ? 'fixas' : 'contas';
  const [visao, setVisao] = useState<'contas' | 'lista' | 'fixas'>(visaoUrl);
  const [dados, setDados] = useState<DadosPainel | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [atualizando, setAtualizando] = useState(false);
  const [versao, setVersao] = useState(0);
  const [aba, setAba] = useState<'abertas' | 'pagas'>('abertas');
  const [filtro, setFiltro] = useState<Grupo | null>(params.get('aberto') === 'vencidas' ? 'venc' : params.get('aberto') === 'semana' || params.get('ver') === 'pacote' ? 'sem' : null);
  const [busca, setBusca] = useState('');
  const [buscaCel, setBuscaCel] = useState(false);
  const [janela, setJanelaSt] = useState<Janela>(lerJanela);
  const setJanela = (j: Janela) => { setJanelaSt(j); try { localStorage.setItem(JANELA_KEY, String(j)); } catch { /* sem storage */ } };
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [aberta, setAberta] = useState<Linha | null>(null);
  const [extrato, setExtrato] = useState<{ id: string; transaction_date: string; bank_account_id?: string | null } | null>(null);
  const [abreDep, setAbreDep] = useState(false);

  // Links que chegam depois de a tela abrir (ex.: ?tab=contas-vencidas vira ?tab=pagar&aberto=vencidas):
  useEffect(() => {
    const v = params.get('ver'), a = params.get('aberto');
    if (podeLista && querLista(params)) setVisao('lista');
    else if (podeFixas && v === 'fixas') setVisao('fixas');
    if (a === 'vencidas') setFiltro('venc'); else if (a === 'semana' || v === 'pacote') setFiltro('sem');
  }, [params, podeLista, podeFixas]); // eslint-disable-line react-hooks/exhaustive-deps

  // Troca de loja: descarta resposta atrasada da loja anterior e limpa o que estava marcado/aberto.
  const lojaAtual = useRef(user?.tenantId);
  useEffect(() => { lojaAtual.current = user?.tenantId; setSel(new Set()); setAberta(null); setExtrato(null); setFiltro(null); }, [user?.tenantId]);
  const carregar = useCallback(async () => {
    const t = user?.tenantId;
    if (!t) return;
    const { data, error } = await supabase.rpc('fn_contas_painel', { p_tenant: t });
    if (lojaAtual.current !== t) return;
    if (error) { setErro(error.message); return; }
    setErro(null); setDados(data as DadosPainel);
  }, [user?.tenantId]);

  // Busca no banco (Inter e Mercado Pago) e recarrega — a mesma busca do Painel. Ao abrir, pula se outra
  // busca rodou há menos de 2 min; o botão Atualizar força.
  const atualizar = useCallback(async (forcar: boolean) => {
    if (!user?.tenantId) return;
    setAtualizando(true);
    const maxAge = forcar ? {} : { max_age_min: 2 };
    await Promise.all([
      invokeWithAuth('inter-bank', { body: { action: 'sync', tenant_id: user.tenantId, ...maxAge } }),
      invokeWithAuth('mp-conciliation', { body: { action: 'sync', tenant_id: user.tenantId, ...maxAge } }),
    ]).catch(() => null);
    await carregar();
    setAtualizando(false);
  }, [user?.tenantId, carregar]);
  useEffect(() => { setDados(null); carregar().then(() => atualizar(false)); }, [carregar]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (versao) carregar(); }, [versao, carregar]);
  const recarregar = () => setVersao((v) => v + 1);

  const linhas = useMemo(() => (dados ? linhasAbertas(dados) : []), [dados]);
  const pagas = useMemo(() => (dados ? dados.pagas.map((p) => linhaPaga(p, dados.hoje)) : []), [dados]);
  const nums = useMemo(() => (dados ? numeros(dados, linhas) : null), [dados, linhas]);
  const saldos = useMemo(() => (dados && nums ? saldosPorLinha(linhas, nums.saldo.v, dados, janela) : new Map<string, SaldoLinha>()), [dados, nums, linhas, janela]);
  const primeiroNeg = useMemo(() => [...linhas].filter((l) => (saldos.get(l.id)?.proj ?? 0) < 0).sort((a, b) => a.data.localeCompare(b.data))[0], [linhas, saldos]);
  const ondeAcaba = useMemo(() => [...linhas].filter((l) => l.tipo !== 'saida').sort((a, b) => a.data.localeCompare(b.data) || a.id.localeCompare(b.id)).find((l) => (saldos.get(l.id)?.real ?? 0) < 0)?.id, [linhas, saldos]);

  const visiveis = useMemo(() => {
    let L = aba === 'pagas' ? pagas : linhas;
    if (busca.trim()) {
      const q = busca.trim(); const num = q.replace(/[R$\s]/g, ''); const ehNum = /^[\d.,]+$/.test(num);
      const v = ehNum ? parseFloat(num.replace(/\./g, '').replace(',', '.')) : NaN;
      L = [...linhas, ...pagas].filter((l) => (ehNum ? Math.abs(l.valor - v) < 0.005 : `${l.nome} ${l.sub}`.toLowerCase().includes(q.toLowerCase())));
    } else if (aba === 'abertas' && filtro) L = L.filter((l) => l.grupo === filtro);
    return L;
  }, [aba, pagas, linhas, busca, filtro]);

  const irPara = (rota: string) => navigate(rota);
  const toggleSel = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const somaSel = [...linhas, ...pagas].filter((l) => sel.has(l.id)).reduce((t, l) => t + l.valor, 0);

  if (visao === 'lista') {
    return (
      <div>
        <div className="px-4 md:px-6 pt-4"><button onClick={() => { setVisao('contas'); const n = new URLSearchParams(params); n.delete('abrir'); n.delete('lista'); n.delete('busca'); n.delete('mes'); setParams(n, { replace: true }); }} className="text-sm font-semibold text-amber-700 flex items-center gap-1"><i className="ri-arrow-left-line" />Voltar para Contas</button></div>
        <ContasPagarTab onNavigateToCompras={onNavigateToCompras} />
      </div>
    );
  }
  if (visao === 'fixas' && user?.tenantId) {
    return (
      <div className="p-4 md:p-6 max-w-[1100px]">
        <button onClick={() => { setVisao('contas'); const n = new URLSearchParams(params); n.delete('ver'); setParams(n, { replace: true }); }} className="text-sm font-semibold text-amber-700 flex items-center gap-1 mb-3"><i className="ri-arrow-left-line" />Voltar para Contas</button>
        <FixasDaLoja tenantId={user.tenantId} dono={dono} financeiro={financeiro} />
      </div>
    );
  }

  const kpi = (k: Grupo | null, rotulo: string, valor: string, sub: string, tom: '' | 'red' | 'amb' | 'ok', grande = false) => (
    <button onClick={() => { setFiltro(filtro === k ? null : k); setAba('abertas'); setBusca(''); }}
      className={`text-left rounded-2xl border px-3.5 py-2.5 min-w-[150px] snap-start ${grande ? 'md:flex-[1.5]' : 'md:flex-1'} ${filtro === k && k ? 'bg-zinc-900 border-zinc-900 [&_*]:!text-white' : tom === 'red' ? 'bg-red-50 border-red-200' : tom === 'amb' ? 'bg-orange-50 border-orange-200' : 'bg-white border-zinc-200'}`}>
      <div className={`text-xs font-bold ${tom === 'red' ? 'text-red-700' : 'text-zinc-500'}`}>{rotulo}</div>
      <div className={`text-lg md:text-xl font-extrabold tabular-nums whitespace-nowrap ${tom === 'red' ? 'text-red-600' : tom === 'amb' ? 'text-orange-700' : tom === 'ok' ? 'text-emerald-700' : 'text-zinc-900'}`}>{valor}</div>
      <div className="text-xs text-zinc-500 font-semibold whitespace-nowrap">{sub}</div>
      {grande && nums && nums.aPagar.v > 0 && (
        <div className="flex h-1.5 rounded-full overflow-hidden bg-zinc-100 mt-1.5">
          <span style={{ width: `${(nums.vencidas.v / nums.aPagar.v) * 100}%` }} className="bg-red-500" />
          <span style={{ width: `${(nums.semana.v / nums.aPagar.v) * 100}%` }} className="bg-amber-400" />
        </div>
      )}
    </button>
  );

  return (
    <div className="p-4 md:p-6 max-w-[1200px] pb-24">
      {/* topo */}
      <div className="flex items-center gap-2 mb-3">
        <h2 className="text-lg font-extrabold text-zinc-900">Contas</h2>
        <div className="ml-auto flex items-center gap-2">
          {podeFixas && <button onClick={() => setVisao('fixas')} title="Contas fixas" className="text-xs font-bold text-zinc-600 bg-white border border-zinc-200 rounded-lg px-2.5 py-1.5"><i className="ri-repeat-line" /> <span className="hidden sm:inline">Contas fixas</span></button>}
          {podeLista && <button onClick={() => setVisao('lista')} className="text-xs font-bold text-zinc-600 bg-white border border-zinc-200 rounded-lg px-2.5 py-1.5"><i className="ri-list-check" /> <span className="hidden sm:inline">Lista completa</span></button>}
          <button onClick={() => atualizar(true)} disabled={atualizando} className="text-xs font-extrabold bg-zinc-900 text-white rounded-lg px-3 py-1.5 flex items-center gap-1.5 disabled:opacity-70">
            <i className={`ri-refresh-line ${atualizando ? 'animate-spin' : ''}`} /><span className="hidden sm:inline">{atualizando ? 'Buscando…' : 'Atualizar'}</span>
          </button>
        </div>
      </div>
      {erro && <div className="mb-3 rounded-xl bg-red-50 text-red-700 text-sm px-3 py-2">Não consegui carregar as contas: {erro}</div>}
      {!dados || !nums ? (
        <div className="flex flex-col gap-2">{[0, 1, 2].map((i) => <div key={i} className="h-14 rounded-xl bg-zinc-100 animate-pulse" />)}</div>
      ) : (
        <>
          {/* números */}
          <div className="flex gap-2 overflow-x-auto snap-x md:overflow-visible -mx-4 px-4 md:mx-0 md:px-0 mb-4 [scrollbar-width:none]">
            {kpi(null, 'A pagar', brl(nums.aPagar.v), `${nums.aPagar.n} contas`, '', true)}
            {nums.vencidas.n ? kpi('venc', 'Vencidas', brl(nums.vencidas.v), `${nums.vencidas.n} contas`, 'red') : kpi('venc', 'Vencidas', '✓ nenhuma', 'tudo em dia', 'ok')}
            {kpi('sem', 'Esta semana', brl(nums.semana.v), `até dom ${ddmm(somarAteDomingo(dados.hoje))} · ${nums.semana.n} contas`, '')}
            <div className="hidden md:block w-px bg-zinc-200 mx-1" />
            <div className="rounded-2xl px-3.5 py-2.5 min-w-[150px] snap-start">
              <div className="text-xs font-bold text-zinc-500"><i className="ri-bank-line" /> Saldo · {dados.saldos.length} conta{dados.saldos.length === 1 ? '' : 's'}</div>
              <div className="text-lg md:text-xl font-extrabold tabular-nums whitespace-nowrap text-zinc-900">{brl(nums.saldo.v)}</div>
              <div className="text-xs text-zinc-500 font-semibold whitespace-nowrap">{nums.saldo.atualizado_em ? `atualizado às ${hora(nums.saldo.atualizado_em)}` : 'sem banco integrado'}</div>
            </div>
            {nums.saidas.n ? kpi('semexp', 'Saiu sem explicação', brl(nums.saidas.v), `${nums.saidas.n} saída${nums.saidas.n > 1 ? 's' : ''} do banco`, 'amb')
              : <div className="rounded-2xl border border-zinc-200 bg-white px-3.5 py-2.5 min-w-[150px] snap-start"><div className="text-xs font-bold text-zinc-500">Banco confere</div><div className="text-lg md:text-xl font-extrabold text-emerald-700">✓</div><div className="text-xs text-zinc-500 font-semibold">toda saída explicada</div></div>}
          </div>

          {/* barra */}
          <div className="flex items-center gap-2 mb-2.5 flex-wrap">
            <div className="inline-flex bg-white border border-zinc-200 rounded-xl p-0.5">
              {(['abertas', 'pagas'] as const).map((a) => (
                <button key={a} onClick={() => { setAba(a); setFiltro(null); setSel(new Set()); }} className={`px-3 py-1.5 rounded-lg text-xs font-bold ${aba === a ? 'bg-zinc-900 text-white' : 'text-zinc-600'}`}>{a === 'abertas' ? 'Em aberto' : 'Pagas'}</button>
              ))}
            </div>
            <button onClick={() => setBuscaCel((v) => !v)} className="sm:hidden ml-auto w-8 h-8 rounded-lg bg-white border border-zinc-200 grid place-items-center text-zinc-600"><i className="ri-search-line" /></button>
            <label className={`${buscaCel ? 'flex' : 'hidden'} sm:flex sm:ml-auto w-full sm:w-60 items-center gap-1.5 bg-white border border-zinc-200 rounded-xl px-2.5 py-1.5`}>
              <i className="ri-search-line text-zinc-400" /><input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Valor ou fornecedor" className="flex-1 min-w-0 text-sm outline-none bg-transparent" />
              {busca && <button onClick={() => setBusca('')} className="text-zinc-400"><i className="ri-close-line" /></button>}
            </label>
          </div>
          {aba === 'abertas' && !busca && (
            <div className="flex items-center gap-2 flex-wrap mb-2.5 text-xs text-zinc-600">
              <span className="font-bold text-blue-900 flex items-center gap-1"><i className="ri-line-chart-line" />Projetado com as vendas médias de</span>
              <span className="inline-flex bg-white border border-zinc-200 rounded-lg p-0.5">
                {JANELAS.map((x) => <button key={x.j} onClick={() => setJanela(x.j)} className={`px-2.5 py-1 rounded-md font-bold ${janela === x.j ? 'bg-blue-900 text-white' : 'text-zinc-600'}`}>{x.t}</button>)}
              </span>
              <Explica alinhar="left" rotulo={<i className="ri-information-line text-blue-900 text-sm" />}>{REGRA(janela)}</Explica>
              <span className={`font-bold ${primeiroNeg ? 'text-red-600' : 'text-emerald-700'}`}>{primeiroNeg ? `⚠ fica negativo ${primeiroNeg.data <= dados.hoje ? 'hoje' : `em ${ddmm(primeiroNeg.data)}`}` : '✓ não fica negativo'}</span>
            </div>
          )}
          {filtro && !busca && aba === 'abertas' && <div className="text-xs text-zinc-600 mb-2">Mostrando: <b>{NOME_GRUPO[filtro].toLowerCase()}</b> <button onClick={() => setFiltro(null)} className="font-bold text-amber-700 ml-1">ver tudo</button></div>}
          {busca && <div className="text-xs mb-2">{visiveis.length ? <span className="text-zinc-600">{visiveis.length} resultado{visiveis.length > 1 ? 's' : ''} para <b>“{busca}”</b></span> : <span className="text-red-600 font-bold">Nada com “{busca}”. Não pague antes de conferir.</span>}</div>}

          {/* tabela */}
          <div className="bg-white border border-zinc-200 rounded-2xl">
            <div className="hidden md:grid grid-cols-[28px_70px_minmax(0,1fr)_88px_96px_96px_116px_104px_14px] gap-2 items-center px-3 py-2 text-xs font-bold text-zinc-500 border-b border-zinc-200 bg-zinc-50/60 rounded-t-2xl">
              <span /><span>{aba === 'pagas' ? 'Pago em' : 'Vence'}</span><span>Conta</span><span className="text-right">Valor (R$)</span>
              <span className="text-right">{aba === 'pagas' ? '' : 'Saldo depois'}</span>
              <span className="text-right text-blue-900">{aba === 'pagas' ? '' : <Explica rotulo={<>Projetado <i className="ri-information-line" /></>}>{REGRA(janela)}</Explica>}</span>
              <span className="flex justify-between px-0.5 text-[10.5px] leading-tight">{NOME_PASSO.map((n, i) => <span key={n} className="flex flex-col items-center w-[30px]"><i className={`${ICONE_PASSO[i]} text-sm`} />{n}</span>)}</span>
              <span className="text-right">Situação</span><span />
            </div>
            {(busca ? [null] : (aba === 'pagas' ? ['pagas' as Grupo] : ORDEM_GRUPOS)).map((g) => {
              const gl = (g ? visiveis.filter((l) => l.grupo === g) : visiveis).slice().sort((a, b) => (aba === 'pagas' ? b.data.localeCompare(a.data) : a.data.localeCompare(b.data) || a.id.localeCompare(b.id)));
              if (!gl.length) return null;
              const soma = gl.reduce((t, l) => t + l.valor, 0);
              if (g === 'dep' && !abreDep && !filtro) {
                return <button key={g} onClick={() => setAbreDep(true)} className="w-full flex justify-between px-4 md:pl-12 py-2.5 text-xs font-bold text-zinc-600 bg-zinc-50/60 border-b border-zinc-200">
                  <span>Depois · {gl.length} contas</span><span className="tabular-nums">{brl(soma)} <i className="ri-arrow-down-s-line" /></span></button>;
              }
              return (
                <div key={g ?? 'busca'}>
                  {g && <div className={`flex justify-between px-4 md:pl-12 pr-4 py-2 text-xs font-extrabold bg-zinc-50/60 border-b border-zinc-200 ${COR_GRUPO[g] ?? 'text-zinc-700'}`}><span>{NOME_GRUPO[g]} · {gl.length}</span><span className="tabular-nums">{brl(soma)}</span></div>}
                  {gl.map((l) => (
                    <div key={l.id}>
                      {l.id === ondeAcaba && aba === 'abertas' && !busca && (
                        <div className="flex items-center gap-2 px-4 md:pl-12 py-1 text-[11px] font-bold text-blue-700 bg-blue-50/60"><span className="flex-1 border-t border-dashed border-blue-300" />sem novas entradas, o saldo de hoje ({brl(nums.saldo.v)}) acaba aqui<span className="flex-1 border-t border-dashed border-blue-300" /></div>
                      )}
                      <LinhaTabela l={l} s={saldos.get(l.id)} sel={sel.has(l.id)} onSel={() => toggleSel(l.id)} onAbrir={() => setAberta(l)} />
                    </div>
                  ))}
                </div>
              );
            })}
            {!visiveis.length && !busca && <div className="py-6 text-center text-sm font-bold text-emerald-700">{filtro === 'venc' ? 'Nenhuma vencida ✓' : 'Nada aqui ✓'}</div>}
          </div>
        </>
      )}

      {sel.size > 0 && (
        <div className="fixed left-1/2 -translate-x-1/2 bottom-4 z-40 w-[min(560px,calc(100vw-24px))] bg-zinc-900 text-white rounded-2xl px-4 py-2.5 flex items-center gap-3 shadow-2xl">
          <span className="text-sm">{sel.size} selecionada{sel.size > 1 ? 's' : ''}</span><b className="tabular-nums">{brl(somaSel)}</b>
          <span className="flex-1" /><button onClick={() => setSel(new Set())} className="text-xs font-bold text-zinc-300">Limpar</button>
        </div>
      )}

      {aberta && dados && (
        <Gaveta l={aberta} hoje={dados.hoje} tenantId={user?.tenantId ?? ''} dono={dono} financeiro={financeiro}
          onFechar={() => setAberta(null)} onMudou={() => { setAberta(null); recarregar(); }}
          onExplicar={(e) => { setAberta(null); setExtrato(e); }} irPara={irPara} onLista={podeLista ? (q) => { setAberta(null); const n = new URLSearchParams(params); n.set('busca', q); n.set('lista', '1'); setParams(n, { replace: true }); setVisao('lista'); } : undefined} />
      )}
      {extrato && <LinhaExtratoModal linha={extrato} onClose={() => setExtrato(null)} onChanged={() => recarregar()} />}
    </div>
  );
}

function somarAteDomingo(hoje: string) { const w = new Date(`${hoje}T12:00:00Z`).getUTCDay(); const d = new Date(`${hoje}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + (w === 0 ? 0 : 7 - w)); return d.toISOString().slice(0, 10); }

function LinhaTabela({ l, s, sel, onSel, onAbrir }: { l: Linha; s?: SaldoLinha; sel: boolean; onSel: () => void; onAbrir: () => void }) {
  const dataTxt = l.atrasada && l.tipo === 'conta' ? `há ${-l.dias} dia${-l.dias > 1 ? 's' : ''}` : ddmm(l.data);
  const sub2 = l.atrasada && l.tipo === 'conta' ? ddmm(l.data) : dsem(l.data);
  const temSaldo = !!s && l.tipo !== 'paga';
  return (
    <div onClick={onAbrir} role="button"
      className={`group relative grid grid-cols-[minmax(0,1fr)_auto] md:grid-cols-[28px_70px_minmax(0,1fr)_88px_96px_96px_116px_104px_14px] gap-x-2 gap-y-1.5 items-center px-4 md:px-3 py-2.5 border-b border-zinc-100 last:border-b-0 cursor-pointer hover:bg-amber-50/30 ${sel ? 'bg-amber-50/60' : ''}`}>
      {(l.atrasada || l.tipo === 'saida') && <span className={`absolute left-0 top-0 bottom-0 w-[3px] ${l.tipo === 'saida' ? 'bg-orange-600' : 'bg-red-600'}`} />}
      <span onClick={(e) => { e.stopPropagation(); onSel(); }} className={`hidden md:grid w-[18px] h-[18px] rounded-[5px] border-[1.5px] place-items-center text-[13px] ${sel ? 'bg-zinc-900 border-zinc-900 text-white opacity-100' : 'border-zinc-400 opacity-0 group-hover:opacity-100'}`}>{sel && <i className="ri-check-line" />}</span>
      <span className={`hidden md:block text-xs font-bold ${l.atrasada ? 'text-red-600' : 'text-zinc-700'}`}>{dataTxt}<small className="block font-semibold text-zinc-500">{sub2}</small></span>
      <span className="min-w-0"><b className="block text-[13.5px] truncate">{l.nome}</b><span className="block text-xs text-zinc-500 truncate">{l.sub}</span></span>
      <span className="text-right text-[13.5px] font-extrabold tabular-nums whitespace-nowrap">{nb(l.valor)}</span>
      <span className={`hidden md:block text-right text-[13px] font-bold tabular-nums ${temSaldo && s!.real < 0 ? 'text-red-600' : 'text-zinc-600'}`}>{temSaldo ? sinal(s!.real) : <span className="text-zinc-300">—</span>}</span>
      <span className={`hidden md:block text-right text-[13px] font-bold tabular-nums ${temSaldo && s!.proj < 0 ? 'text-red-600' : 'text-blue-900'}`} onClick={(e) => e.stopPropagation()}>
        {temSaldo ? <Explica rotulo={sinal(s!.proj)}><ContaDoProjetado l={l} s={s!} /></Explica> : <span className="text-zinc-300">—</span>}
      </span>
      {/* celular: data + andamento + situação numa linha */}
      <span className="md:hidden flex items-center gap-2"><span className={`text-xs font-bold ${l.atrasada ? 'text-red-600' : 'text-zinc-600'}`}>{dataTxt}</span><Andamento l={l} /></span>
      <span className="hidden md:block"><Andamento l={l} /></span>
      <span className="justify-self-end"><Situacao l={l} /></span>
      <i className="hidden md:block ri-arrow-right-s-line text-zinc-300" />
      {temSaldo && (
        <span className="md:hidden col-span-2 flex justify-between text-[11.5px] text-zinc-500 tabular-nums border-t border-dashed border-zinc-200 pt-1.5">
          <span>saldo depois <b className={s!.real < 0 ? 'text-red-600' : 'text-zinc-700'}>{sinal(s!.real)}</b></span>
          <span>projetado <b className={s!.proj < 0 ? 'text-red-600' : 'text-blue-900'}>{sinal(s!.proj)}</b></span>
        </span>
      )}
    </div>
  );
}

function Gaveta({ l, hoje, tenantId, dono, financeiro, onFechar, onMudou, onExplicar, irPara, onLista }: {
  l: Linha; hoje: string; tenantId: string; dono: boolean; financeiro: boolean; onFechar: () => void; onMudou: () => void;
  onExplicar: (e: { id: string; transaction_date: string; bank_account_id?: string | null }) => void; irPara: (r: string) => void; onLista?: (q: string) => void;
}) {
  const c = l.conta, p = l.paga;
  const passos: { p: Passo; t: string; d: string; link?: { t: string; r: string } }[] = [];
  if (l.tipo === 'saida') {
    passos.push({ p: 'amb', t: 'Nota', d: 'Ninguém disse o que foi esta saída.' }, { p: 'ok', t: 'Saiu do banco', d: `${ddmm(l.data)} · ${l.extrato?.descricao ?? ''}` });
  } else if (l.tipo === 'nota') {
    passos.push({ p: 'ok', t: 'Nota', d: `NF ${l.nota?.numero ?? ''} · emitida ${ddmm(String(l.nota?.emitida).slice(0, 10))}`, link: { t: 'lançar a nota', r: `/financeiro?tab=notas-entrada&nota=${l.nota?.doc_id}` } },
      { p: 'unk', t: 'Chegou', d: 'Só dá para confirmar depois que a nota virar compra.' }, { p: l.passos[2], t: 'Pago', d: `Vence ${ddmm(l.data)}` });
  } else {
    const nf = c?.nf ?? p?.nf; const chegou = c?.chegou_em ?? p?.chegou_em; const compra = c?.compra_id;
    passos.push({ p: l.passos[0], t: c?.fixa && !nf ? 'Boleto' : 'Nota', d: nf ? `NF ${nf}${c?.nf_emitida ? ` · emitida ${ddmm(String(c.nf_emitida).slice(0, 10))}` : ''}` : c?.fixa && c?.tem_boleto ? 'Conta fixa · boleto recebido' : 'Não precisa',
      link: nf ? { t: 'ver nota', r: `/financeiro?tab=notas-entrada&busca=${encodeURIComponent(nf)}` } : undefined });
    passos.push({ p: l.passos[1], t: 'Chegou', d: chegou ? `${ddmm(String(chegou).slice(0, 10))} · confirmado pela loja` : l.passos[1] === 'na' ? 'Não tem entrega para confirmar' : 'A loja ainda não confirmou a entrega',
      link: compra ? { t: chegou ? 'ver recebimento' : 'conferir agora', r: `/receber?abrir=compra:${compra}` } : undefined });
    passos.push({ p: l.passos[2], t: 'Pago', d: p ? (p.banco ? `${ddmm(l.data)} · o banco confirmou` : `${ddmm(l.data)} · sem linha do extrato (dinheiro ou outro banco)`) : l.atrasada ? `Venceu ${ddmm(l.data)}` : `Vence ${ddmm(l.data)} (${dsem(l.data)})` });
  }
  const ICN: Record<Passo, string> = { ok: 'ri-check-line', esp: 'ri-time-line', no: 'ri-close-line', amb: 'ri-error-warning-line', na: 'ri-subtract-line', meio: 'ri-time-line', unk: 'ri-question-mark' };
  return (
    <>
      <div className="fixed inset-0 bg-zinc-900/30 z-40" onClick={onFechar} />
      <aside className="fixed top-0 right-0 bottom-0 w-full sm:w-[440px] bg-white z-50 shadow-2xl overflow-y-auto p-5">
        <button onClick={onFechar} className="absolute right-4 top-4 text-xl text-zinc-400"><i className="ri-close-line" /></button>
        <h3 className="text-lg font-extrabold pr-8">{l.nome}</h3>
        <div className="text-sm text-zinc-500">{l.sub}</div>
        <div className="text-3xl font-extrabold tabular-nums mt-3 mb-1">{brl(l.valor)}</div>
        <Situacao l={l} />
        <div className="mt-5 flex flex-col">
          {passos.map((x, i) => (
            <div key={i} className="flex gap-3 relative pb-4">
              {i < passos.length - 1 && <span className="absolute left-[11px] top-7 bottom-0 w-0.5 bg-zinc-100" />}
              <span className={`w-6 h-6 rounded-full grid place-items-center text-xs shrink-0 z-[1] ${x.p === 'ok' ? 'bg-emerald-50 text-emerald-700' : x.p === 'no' ? 'bg-red-600 text-white' : x.p === 'amb' ? 'bg-orange-600 text-white' : x.p === 'meio' ? 'bg-blue-50 text-blue-700' : 'bg-zinc-100 text-zinc-500'}`}><i className={ICN[x.p]} /></span>
              <div className="text-sm"><b className="block">{x.t}</b><span className="text-zinc-600">{x.d}</span>
                {x.link && <button onClick={() => irPara(x.link!.r)} className="block text-xs font-bold text-amber-700 mt-0.5">{x.link.t} →</button>}</div>
            </div>
          ))}
        </div>
        <div className="flex flex-col gap-2 mt-2">
          {l.tipo === 'saida' && l.extrato && <button onClick={() => onExplicar({ id: l.extrato!.id, transaction_date: l.extrato!.data, bank_account_id: l.extrato!.bank_account_id ?? null })} className="bg-zinc-900 text-white font-extrabold rounded-xl py-3 text-sm">Dizer o que foi</button>}
          {l.tipo === 'nota' && <button onClick={() => irPara(`/financeiro?tab=notas-entrada&nota=${l.nota?.doc_id}`)} className="bg-zinc-900 text-white font-extrabold rounded-xl py-3 text-sm">Lançar a nota</button>}
          {l.tipo === 'conta' && c && (
            <>
              {(l.passos[1] === 'esp' || l.passos[1] === 'no') && c.compra_id && <button onClick={() => irPara(`/receber?abrir=compra:${c.compra_id}`)} className="bg-orange-600 text-white font-extrabold rounded-xl py-3 text-sm">Chegou: conferir agora</button>}
              {!l.cartao && <AcoesPagar tenantId={tenantId} billId={c.id} dono={dono} financeiro={financeiro} onMudou={onMudou} rotuloPagar="Pagar com PIN" />}
              {onLista && <button onClick={() => onLista(c.nome)} className="text-xs font-semibold text-zinc-500 py-1">Abrir na lista completa (editar, excluir)</button>}
            </>
          )}
          {l.tipo === 'paga' && <div className="text-xs text-zinc-500">Paga e {p?.banco ? 'conferida no extrato.' : 'sem linha do extrato ligada.'}</div>}
        </div>
      </aside>
    </>
  );
}

