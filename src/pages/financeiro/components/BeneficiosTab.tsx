// RH / Folha › Benefícios (2026-09-30, pedido do dono): vale alimentação pago pela empresa, por
// funcionário. O VA de agosto costuma ser pago no fim de julho, então o lançamento tem COMPETÊNCIA
// (o mês escolhido no topo) e vencimento/pagamento próprios: DRE competência = mês do benefício,
// caixa = data da baixa.
//
// fn_beneficio_lancar cria a conta a pagar (1 para a operadora, ou 1 Pix por funcionário) na
// categoria da DRE (padrão: Pessoal, que a DRE soma à folha) e grava hr_beneficios (quanto de cada
// funcionário). "Já está pago" dá a baixa pelo pay_bill (caixa + saldo do banco, como qualquer conta).
// O "Vale Refeição" da folha é outra coisa: é o DESCONTO no salário do funcionário.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase, invokeWithAuth } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { formatCurrency } from '@/lib/formatters';
import { useBankAccounts } from '@/hooks/useFinanceiro';
import { isGrupoDespesa } from '@/hooks/useDreGroups';
import { KpiCard, MonthNav, addMeses, mesExtenso } from './dreUi';

interface Func { id: string; name: string; role: string | null; status: string | null; va_valor_mensal: number | null }
interface Linha {
  id: string; lote_id: string; employee_id: string; employee_name: string; valor: number;
  valor_fixo: number | null; faltas: number; dias_base: number | null; bill_id: string;
  fin_accounts_payable: { id: string; supplier: string | null; amount: number; due_date: string; status: string; paid_date: string | null; payment_method: string | null } | null;
}
interface Cat { id: string; name: string; group_type: string; system_key: string | null }
interface Item { on: boolean; fixo: string; faltas: string; valor: string; manual: boolean }
const ITEM_VAZIO: Item = { on: false, fixo: '', faltas: '0', valor: '', manual: false };

const hojeSP = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
const fmtData = (iso: string | null | undefined) => (iso ? new Date(`${iso}T12:00:00`).toLocaleDateString('pt-BR') : '—');
const num = (s: string) => { const n = Number(String(s).replace(',', '.')); return Number.isFinite(n) ? n : 0; };
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Dias de segunda a sábado no mês (base para descontar faltas). */
function diasUteis(mes: string): number {
  const [y, m] = mes.split('-').map(Number);
  const fim = new Date(y, m, 0).getDate();
  let n = 0;
  for (let d = 1; d <= fim; d++) if (new Date(y, m - 1, d).getDay() !== 0) n++;
  return n;
}
/** Último dia do mês anterior à competência (quando o VA costuma ser pago). */
function fimMesAnterior(mes: string): string {
  const [y, m] = mes.split('-').map(Number);
  return new Date(y, m - 1, 0).toLocaleDateString('en-CA');
}
const lerLS = (k: string) => { try { return localStorage.getItem(k) ?? ''; } catch { return ''; } };
const gravarLS = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* sem storage */ } };

export default function BeneficiosTab() {
  const { user } = useAuth();
  const tenantId = user?.tenantId;
  const [mes, setMes] = useState(hojeSP().slice(0, 7));
  const [funcs, setFuncs] = useState<Func[]>([]);
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [cats, setCats] = useState<Cat[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [aberto, setAberto] = useState(false);
  const [desfazendo, setDesfazendo] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    const [f, l, c] = await Promise.all([
      supabase.from('hr_employees').select('id, name, role, status, va_valor_mensal').eq('tenant_id', tenantId).order('name'),
      supabase.from('hr_beneficios')
        .select('id, lote_id, employee_id, employee_name, valor, valor_fixo, faltas, dias_base, bill_id, fin_accounts_payable(id, supplier, amount, due_date, status, paid_date, payment_method)')
        .eq('tenant_id', tenantId).eq('competencia', `${mes}-01`).order('employee_name'),
      supabase.from('fin_dre_categories').select('id, name, group_type, system_key').eq('tenant_id', tenantId)
        .is('deleted_at', null).eq('is_active', true).order('name'),
    ]);
    if (f.error || l.error) setErro((f.error ?? l.error)?.message ?? 'Erro ao carregar');
    else setErro(null);
    setFuncs((f.data ?? []) as Func[]);
    setLinhas((l.data ?? []) as unknown as Linha[]);
    setCats(((c.data ?? []) as Cat[]).filter(x => isGrupoDespesa(x.group_type) || x.system_key === 'pessoal'));
    setLoading(false);
  }, [tenantId, mes]);
  useEffect(() => { carregar(); }, [carregar]);

  // Um card por lançamento (lote): 1 conta para a operadora ou 1 conta por funcionário
  const lotes = useMemo(() => {
    const m = new Map<string, Linha[]>();
    for (const l of linhas) m.set(l.lote_id, [...(m.get(l.lote_id) ?? []), l]);
    return [...m.entries()].map(([id, ls]) => {
      const contas = [...new Map(ls.map(l => [l.bill_id, l.fin_accounts_payable])).values()].filter(Boolean) as NonNullable<Linha['fin_accounts_payable']>[];
      return {
        id, linhas: ls, contas,
        total: ls.reduce((s, l) => s + Number(l.valor), 0),
        pix: contas.length > 1 || (contas.length === 1 && ls.length === 1 && contas[0].supplier === ls[0].employee_name),
        pagas: contas.filter(c => c.status === 'paid').length,
        podeDesfazer: contas.every(c => c.status === 'pending'),
      };
    });
  }, [linhas]);
  const totalMes = linhas.reduce((s, l) => s + Number(l.valor), 0);
  const jaLancados = useMemo(() => new Set(linhas.map(l => l.employee_id)), [linhas]);

  const desfazer = async (lote: string) => {
    if (!tenantId) return;
    setDesfazendo(lote);
    const { error } = await supabase.rpc('fn_beneficio_desfazer', { p_tenant: tenantId, p_lote: lote });
    setDesfazendo(null);
    if (error) { setErro(error.message); return; }
    carregar();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <MonthNav mes={mes} onChange={setMes} canGoNext={mes <= hojeSP().slice(0, 7)} />
        <p className="text-xs text-zinc-500">Competência: o mês a que o benefício pertence (pode ter sido pago no mês anterior).</p>
        <button onClick={() => setAberto(true)} disabled={loading}
          className="ml-auto disabled:opacity-50 flex items-center gap-1.5 bg-amber-500 hover:bg-amber-600 text-white px-4 py-2 rounded-xl text-xs font-semibold cursor-pointer whitespace-nowrap shadow-sm">
          <i className="ri-add-line" /> Lançar vale alimentação
        </button>
      </div>

      <div className="grid grid-cols-2 max-sm:[&>*:last-child:nth-child(odd)]:col-span-2 sm:grid-cols-3 gap-3">
        <KpiCard label="Vale alimentação do mês" icon="ri-restaurant-line" value={formatCurrency(totalMes)} sub={mesExtenso(mes)} atual={totalMes} semVariacao />
        <KpiCard label="Funcionários com VA" icon="ri-team-line" value={String(jaLancados.size)} sub={`${funcs.filter(f => f.status === 'active').length} ativos`} atual={jaLancados.size} semVariacao />
        <KpiCard label="Pago" icon="ri-checkbox-circle-line" value={`${lotes.reduce((s, l) => s + l.pagas, 0)} de ${lotes.reduce((s, l) => s + l.contas.length, 0)}`} sub="contas deste mês" atual={lotes.reduce((s, l) => s + l.pagas, 0)} semVariacao />
      </div>

      {erro && <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{erro}</p>}

      {loading ? (
        <p className="text-sm text-zinc-400 py-8 text-center">Carregando...</p>
      ) : lotes.length === 0 ? (
        <div className="bg-white border border-zinc-200 rounded-xl p-8 text-center">
          <i className="ri-restaurant-line text-3xl text-zinc-300" />
          <p className="text-sm font-semibold text-zinc-700 mt-2">Nenhum vale alimentação lançado para {mesExtenso(mes)}</p>
          <p className="text-xs text-zinc-400 mt-1">Use "Lançar vale alimentação": gera a conta a pagar com a competência deste mês e guarda o valor de cada funcionário.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {lotes.map(l => (
            <div key={l.id} className="bg-white border border-zinc-200 rounded-xl overflow-hidden">
              <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-zinc-100">
                <div className="min-w-0">
                  <p className="text-sm font-bold text-zinc-800">
                    {l.pix ? 'Pix para cada funcionário' : `Operadora: ${l.contas[0]?.supplier ?? '—'}`}
                  </p>
                  <p className="text-xs text-zinc-500">
                    Vencimento {fmtData(l.contas[0]?.due_date)} · {l.linhas.length} funcionário{l.linhas.length === 1 ? '' : 's'}
                    {' · '}{l.pagas === l.contas.length
                      ? <span className="text-emerald-700 font-semibold">pago{l.contas[0]?.paid_date ? ` em ${fmtData(l.contas[0].paid_date)}` : ''}</span>
                      : l.pagas > 0 ? <span className="text-amber-700 font-semibold">{l.pagas} de {l.contas.length} pagas</span>
                        : <span className="text-amber-700 font-semibold">a pagar (Contas a Pagar)</span>}
                  </p>
                </div>
                <p className="ml-auto text-base font-bold text-zinc-900 tabular-nums">{formatCurrency(l.total)}</p>
                {l.podeDesfazer && (
                  <button onClick={() => desfazer(l.id)} disabled={desfazendo === l.id}
                    className="text-xs font-semibold px-3 py-1.5 border border-zinc-200 rounded-lg text-zinc-600 hover:bg-zinc-50 disabled:opacity-50 cursor-pointer">
                    {desfazendo === l.id ? 'Desfazendo...' : 'Desfazer'}
                  </button>
                )}
              </div>
              <div className="divide-y divide-zinc-50">
                {l.linhas.map(x => (
                  <div key={x.id} className="flex items-center gap-2 px-4 py-2 text-sm">
                    <span className="flex-1 min-w-0 truncate text-zinc-700">{x.employee_name}</span>
                    {x.faltas > 0 && <span className="text-xs text-zinc-400 whitespace-nowrap">{x.faltas} falta{x.faltas === 1 ? '' : 's'} (fixo {formatCurrency(Number(x.valor_fixo ?? 0))})</span>}
                    <span className="tabular-nums font-semibold text-zinc-800">{formatCurrency(Number(x.valor))}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {aberto && tenantId && (
        <LancarModal tenantId={tenantId} mes={mes} funcs={funcs.filter(f => f.status === 'active')} jaLancados={jaLancados} cats={cats}
          onClose={() => setAberto(false)} onDone={(aviso) => { setAberto(false); setErro(aviso ?? null); carregar(); }} />
      )}
    </div>
  );
}

function LancarModal({ tenantId, mes, funcs, jaLancados, cats, onClose, onDone }: {
  tenantId: string; mes: string; funcs: Func[]; jaLancados: Set<string>; cats: Cat[];
  onClose: () => void; onDone: (aviso?: string) => void;
}) {
  const { accounts } = useBankAccounts();
  const [modo, setModo] = useState<'operadora' | 'pix'>('operadora');
  const [operadora, setOperadora] = useState(() => lerLS('erpos.va.operadora') || 'VR');
  const [venc, setVenc] = useState(() => fimMesAnterior(mes));
  const [catId, setCatId] = useState('');
  const [base, setBase] = useState(String(diasUteis(mes)));
  const [jaPago, setJaPago] = useState(false);
  const [conta, setConta] = useState('');
  const [forma, setForma] = useState('Pix');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [itens, setItens] = useState<Record<string, Item>>(() => Object.fromEntries(funcs.map(f => {
    const fixo = f.va_valor_mensal ? String(f.va_valor_mensal) : '';
    return [f.id, { on: !!f.va_valor_mensal && !jaLancados.has(f.id), fixo, faltas: '0', valor: fixo, manual: false }];
  })));

  useEffect(() => {
    if (!catId && cats.length) setCatId(cats.find(c => c.system_key === 'pessoal')?.id ?? '');
  }, [cats, catId]);
  useEffect(() => {
    if (!conta && accounts.length) setConta(accounts[0].id);
  }, [accounts, conta]);

  // Valor do mês = fixo × (base − faltas) / base, até alguém digitar o valor na mão
  const calc = (it: Item, b = num(base)) => (b > 0 ? String(r2(Math.max(0, num(it.fixo) * (b - num(it.faltas)) / b))) : it.fixo);
  const mudar = (id: string, p: Partial<Item>) => setItens(prev => {
    const it: Item = { ...(prev[id] ?? ITEM_VAZIO), ...p };
    if (!it.manual && ('fixo' in p || 'faltas' in p)) it.valor = calc(it);
    return { ...prev, [id]: it };
  });
  const mudarBase = (v: string) => {
    setBase(v);
    setItens(prev => Object.fromEntries(Object.entries(prev).map(([k, it]) => [k, it.manual ? it : { ...it, valor: calc(it, num(v)) }])));
  };

  const marcados = funcs.filter(f => itens[f.id]?.on);
  const total = r2(marcados.reduce((s, f) => s + num(itens[f.id].valor), 0));

  const lancar = async () => {
    setErro(null);
    if (marcados.length === 0) { setErro('Marque pelo menos um funcionário'); return; }
    if (marcados.some(f => num(itens[f.id].valor) <= 0)) { setErro('Todo funcionário marcado precisa de valor'); return; }
    if (modo === 'operadora' && !operadora.trim()) { setErro('Informe a operadora (ex.: VR, Alelo)'); return; }
    if (!venc) { setErro('Informe o vencimento'); return; }
    if (jaPago && !conta) { setErro('Escolha de qual conta saiu o dinheiro'); return; }
    setSalvando(true);
    const { data, error } = await supabase.rpc('fn_beneficio_lancar', {
      p_tenant: tenantId, p_competencia: `${mes}-01`, p_modo: modo, p_fornecedor: modo === 'operadora' ? operadora.trim() : null,
      p_vencimento: venc, p_dre_category_id: catId || null,
      p_itens: marcados.map(f => {
        const it = itens[f.id];
        return { employee_id: f.id, valor: num(it.valor), valor_fixo: num(it.fixo) || null, faltas: Math.max(0, Math.round(num(it.faltas))), dias_base: Math.max(0, Math.round(num(base))) || null };
      }),
    });
    if (error) { setSalvando(false); setErro(error.message); return; }
    if (modo === 'operadora') gravarLS('erpos.va.operadora', operadora.trim());

    // "Já está pago": baixa de cada conta pelo caminho normal (caixa + saldo do banco)
    if (jaPago) {
      const ids = ((data as { bill_ids?: string[] })?.bill_ids ?? []);
      const { data: contas } = await supabase.from('fin_accounts_payable').select('id, amount').in('id', ids);
      const falhas: string[] = [];
      for (const c of (contas ?? []) as Array<{ id: string; amount: number }>) {
        const { data: r, error: e } = await invokeWithAuth<{ error?: string }>('financial-write', {
          body: { action: 'pay_bill', tenant_id: tenantId, payload: { id: c.id, paid_date: venc, paid_amount: Number(c.amount), payment_method: forma, bank_account_id: conta, registro: true } },
        });
        if (e || r?.error) falhas.push(e?.message ?? String(r?.error));
      }
      if (falhas.length) {
        // O lançamento JÁ foi gravado: fecha e recarrega (lançar de novo duplicaria o VA)
        setSalvando(false);
        onDone(`Vale lançado, mas ${falhas.length} baixa(s) não deram certo: ${falhas[0]}. Dê a baixa em Contas a Pagar.`);
        return;
      }
    }
    setSalvando(false);
    onDone();
  };

  const inputCls = 'w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400';
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div className="bg-white w-full sm:max-w-2xl max-h-[92vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-100 sticky top-0 bg-white z-10">
          <div>
            <h3 className="text-base font-bold text-zinc-900">Vale alimentação — {mesExtenso(mes)}</h3>
            <p className="text-xs text-zinc-500">Na DRE por competência entra em {mesExtenso(mes).toLowerCase()}; no caixa, na data do pagamento.</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-zinc-100 cursor-pointer"><i className="ri-close-line text-lg text-zinc-500" /></button>
        </div>

        <div className="p-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {([['operadora', 'Boleto/Pix para a operadora', 'uma conta no total (VR, Alelo…)'], ['pix', 'Pix para cada funcionário', 'uma conta por pessoa']] as const).map(([k, t, s]) => (
              <button key={k} onClick={() => setModo(k)}
                className={`text-left px-3 py-2.5 rounded-xl border cursor-pointer ${modo === k ? 'border-amber-400 bg-amber-50' : 'border-zinc-200 hover:bg-zinc-50'}`}>
                <span className="block text-sm font-semibold text-zinc-800">{t}</span>
                <span className="block text-xs text-zinc-500">{s}</span>
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {modo === 'operadora' && (
              <div>
                <label className="text-xs font-semibold text-zinc-600 block mb-1">Operadora</label>
                <input value={operadora} onChange={e => setOperadora(e.target.value)} placeholder="VR, Alelo, Pluxee..." className={inputCls} />
              </div>
            )}
            <div>
              <label className="text-xs font-semibold text-zinc-600 block mb-1">{jaPago ? 'Pago em' : 'Vencimento'}</label>
              <input type="date" value={venc} onChange={e => setVenc(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className="text-xs font-semibold text-zinc-600 block mb-1">Categoria DRE</label>
              <select value={catId} onChange={e => setCatId(e.target.value)} className={inputCls}>
                {cats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          </div>

          <label className="flex items-start gap-2 text-sm text-zinc-700 cursor-pointer">
            <input type="checkbox" checked={jaPago} onChange={e => setJaPago(e.target.checked)} className="mt-0.5" />
            <span>Já está pago <span className="text-xs text-zinc-400">(dá a baixa agora; sem marcar, fica em Contas a Pagar e a Conciliação casa com o extrato)</span></span>
          </label>
          {jaPago && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-zinc-600 block mb-1">Saiu da conta</label>
                <select value={conta} onChange={e => setConta(e.target.value)} className={inputCls}>
                  {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold text-zinc-600 block mb-1">Forma</label>
                <select value={forma} onChange={e => setForma(e.target.value)} className={inputCls}>
                  {['Pix', 'Boleto', 'Transferência'].map(f => <option key={f} value={f}>{f}</option>)}
                </select>
              </div>
            </div>
          )}

          <div className="border border-zinc-200 rounded-xl overflow-hidden">
            <div className="flex flex-wrap items-center gap-2 px-3 py-2 bg-zinc-50 border-b border-zinc-200">
              <p className="text-xs font-semibold text-zinc-600 flex-1">Funcionários ativos</p>
              <label className="text-xs text-zinc-500 flex items-center gap-1.5" title="Dias de trabalho do mês, para descontar as faltas">
                Dias no mês
                <input type="number" min={1} max={31} value={base} onChange={e => mudarBase(e.target.value)}
                  className="w-14 border border-zinc-200 rounded-md px-1.5 py-1 text-xs text-right bg-white" />
              </label>
            </div>
            {funcs.length === 0 ? (
              <p className="text-sm text-zinc-400 p-4 text-center">Nenhum funcionário ativo (cadastre em RH › Funcionários).</p>
            ) : (
              <div className="divide-y divide-zinc-100">
                <div className="hidden sm:grid grid-cols-[1fr_96px_64px_104px] gap-2 px-3 py-1.5 text-[11px] font-semibold text-zinc-400 uppercase">
                  <span>Funcionário</span><span className="text-right">Valor fixo</span><span className="text-right">Faltas</span><span className="text-right">Valor do mês</span>
                </div>
                {funcs.map(f => {
                  const it = itens[f.id] ?? ITEM_VAZIO;
                  return (
                    <div key={f.id} className={`grid grid-cols-[1fr_auto] sm:grid-cols-[1fr_96px_64px_104px] gap-2 items-center px-3 py-2 ${it.on ? '' : 'opacity-60'}`}>
                      <label className="flex items-center gap-2 min-w-0 cursor-pointer col-span-2 sm:col-span-1">
                        <input type="checkbox" checked={it.on} onChange={e => mudar(f.id, { on: e.target.checked })} />
                        <span className="text-sm text-zinc-800 truncate">{f.name}</span>
                        {jaLancados.has(f.id) && <span className="text-[10px] font-semibold text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded whitespace-nowrap">já lançado no mês</span>}
                      </label>
                      <label className="text-[11px] text-zinc-400 sm:contents">
                        <span className="sm:hidden">Fixo </span>
                        <input type="number" step="0.01" min={0} value={it.fixo} onChange={e => mudar(f.id, { fixo: e.target.value })} placeholder="0,00"
                          className="w-24 sm:w-full border border-zinc-200 rounded-md px-2 py-1 text-sm text-right" />
                      </label>
                      <label className="text-[11px] text-zinc-400 sm:contents">
                        <span className="sm:hidden">Faltas </span>
                        <input type="number" min={0} max={31} value={it.faltas} onChange={e => mudar(f.id, { faltas: e.target.value })}
                          className="w-16 sm:w-full border border-zinc-200 rounded-md px-2 py-1 text-sm text-right" />
                      </label>
                      <label className="text-[11px] text-zinc-400 sm:contents">
                        <span className="sm:hidden">Mês </span>
                        <input type="number" step="0.01" min={0} value={it.valor} onChange={e => mudar(f.id, { valor: e.target.value, manual: true })}
                          className="w-24 sm:w-full border border-zinc-200 rounded-md px-2 py-1 text-sm text-right font-semibold" />
                      </label>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          <p className="text-[11px] text-zinc-400">O valor fixo usado fica guardado no funcionário e vem preenchido no próximo mês. Com faltas, o valor do mês é proporcional aos dias; dá para digitar outro valor.</p>

          {erro && <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{erro}</p>}
        </div>

        <div className="flex gap-2 px-5 py-4 border-t border-zinc-100 sticky bottom-0 bg-white">
          <button onClick={onClose} className="flex-1 py-2.5 border border-zinc-200 rounded-xl text-sm font-semibold text-zinc-600 hover:bg-zinc-50 cursor-pointer">Cancelar</button>
          <button onClick={lancar} disabled={salvando || marcados.length === 0}
            className="flex-1 py-2.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white rounded-xl text-sm font-bold cursor-pointer">
            {salvando ? 'Lançando...' : `Lançar ${formatCurrency(total)} (${marcados.length})`}
          </button>
        </div>
      </div>
    </div>
  );
}
