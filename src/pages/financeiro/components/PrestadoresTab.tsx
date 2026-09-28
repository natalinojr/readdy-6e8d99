// RH / Folha › Prestadores MEI (2026-09-28, pedido do dono): quem trabalha pela loja com CNPJ de MEI
// (ex.: supervisor), fora da folha do Domínio — sem INSS, FGTS nem 13º.
//
// Cadastro aqui (fn_prestador_salvar). O pagamento vem do extrato: Conciliação › pagamento ›
// "Lançar a partir deste pagamento" › Prestador MEI (edge conciliacao-pagamentos, kind 'prestador'):
//   • Serviço do mês → despesa em RH na competência;
//   • Reembolso → despesa na categoria do que ele comprou para a loja (não é custo de pessoal).
// Cada lançamento fica em hr_prestador_pagamentos (some junto quando o lançamento é desfeito).
//
// Pagamento recorrente (2026-09-28): com "recorrente", no dia do pagamento nasce um PEDIDO DE PAGAMENTO
// (fn_prestador_gerar_pedidos, cron diário 08:10) com o valor combinado. O dono confere/muda o valor,
// aprova no 📥 ou em Recebimentos e pagamentos, e o Pix sai pelo Inter com o PIN (caminho normal).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { formatCurrency, lerValorBR } from '@/lib/formatters';

export interface Prestador {
  id: string; name: string; cpf: string | null; cnpj: string | null; role: string | null;
  valor_mensal: number | null; dia_pagamento: number | null; is_active: boolean; notes: string | null;
  recorrente: boolean; competencia_regra: 'same' | 'prev'; pix_favorecido_id: string | null;
}
interface Pagamento {
  id: string; prestador_id: string; tipo: 'servico' | 'reembolso'; competencia: string | null;
  amount: number; paid_date: string | null;
  fin_accounts_payable: { description: string | null; category: string | null; status: string | null; paid_date: string | null } | null;
}

const hojeSP = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const fmtData = (iso: string | null) => (iso ? new Date(`${iso}T12:00:00`).toLocaleDateString('pt-BR') : '—');
const pagoDe = (g: Pagamento) => g.paid_date ?? (g.fin_accounts_payable?.status === 'paid' ? g.fin_accounts_payable.paid_date : null);
const fmtCnpj =(c: string | null) => (c && c.length === 14 ? c.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : c ?? '');

export default function PrestadoresTab() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const tenantId = user?.tenantId;
  const [mes, setMes] = useState(() => hojeSP().slice(0, 7));
  const [prestadores, setPrestadores] = useState<Prestador[]>([]);
  const [pagamentos, setPagamentos] = useState<Pagamento[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [editando, setEditando] = useState<Partial<Prestador> | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [pedindo, setPedindo] = useState<string | null>(null);
  // Gera já o pedido do mês (mesmo antes do dia), para aprovar no 📥 ou em Recebimentos e pagamentos
  const pedirAgora = async (pr: Prestador) => {
    if (!tenantId) return;
    setPedindo(pr.id); setAviso(null); setErro(null);
    const { data, error } = await supabase.rpc('fn_prestador_gerar_pedidos', { p_tenant: tenantId, p_prestador: pr.id, p_forcar: true });
    setPedindo(null);
    if (error) { setErro(error.message); return; }
    setAviso(Number(data) > 0
      ? `Pedido de pagamento de ${pr.name} criado. Confira o valor e aprove no 📥 do chat ou em Recebimentos e pagamentos › Aprovar.`
      : `${pr.name} já tem pedido deste mês em aberto, ou o serviço do mês já foi lançado.`);
  };

  const carregar = useCallback(async () => {
    if (!tenantId) return;
    setCarregando(true); setErro(null);
    const [y, m] = mes.split('-').map(Number);
    const ini = `${mes}-01`;
    const fim = new Date(y, m, 0).toLocaleDateString('en-CA');
    const [p, g] = await Promise.all([
      supabase.from('hr_prestadores').select('*').eq('tenant_id', tenantId).order('name'),
      // Do mês = competência no mês (ou, sem competência, pago no mês)
      supabase.from('hr_prestador_pagamentos')
        .select('id, prestador_id, tipo, competencia, amount, paid_date, fin_accounts_payable(description, category, status, paid_date)')
        .eq('tenant_id', tenantId)
        .or(`competencia.eq.${ini},and(competencia.is.null,paid_date.gte.${ini},paid_date.lte.${fim})`)
        .order('paid_date'),
    ]);
    const falha = p.error ?? g.error;
    if (falha) setErro('Não consegui carregar: ' + falha.message);
    setPrestadores((p.data ?? []) as Prestador[]);
    setPagamentos((g.data ?? []) as unknown as Pagamento[]);
    setCarregando(false);
  }, [tenantId, mes]);
  useEffect(() => { carregar(); }, [carregar]);

  const porPrestador = useMemo(() => {
    const m = new Map<string, { servico: number; reembolso: number; pagoEm: string[]; aPagar: number }>();
    for (const g of pagamentos) {
      const r = m.get(g.prestador_id) ?? { servico: 0, reembolso: 0, pagoEm: [], aPagar: 0 };
      // Pago = data do extrato (lançado pela Conciliação) ou baixa da conta (pedido aprovado e pago)
      const pagoEm = pagoDe(g);
      if (g.tipo === 'servico') { r.servico += Number(g.amount); if (pagoEm) r.pagoEm.push(pagoEm); else r.aPagar += Number(g.amount); }
      else r.reembolso += Number(g.amount);
      m.set(g.prestador_id, r);
    }
    return m;
  }, [pagamentos]);
  const totalServico = pagamentos.filter((g) => g.tipo === 'servico').reduce((s, g) => s + Number(g.amount), 0);
  const totalReembolso = pagamentos.filter((g) => g.tipo === 'reembolso').reduce((s, g) => s + Number(g.amount), 0);
  const nomeDe = (id: string) => prestadores.find((p) => p.id === id)?.name ?? 'Prestador';
  const [ano, mm] = mes.split('-').map(Number);
  const trocarMes = (delta: number) => {
    const d = new Date(ano, mm - 1 + delta, 1);
    setMes(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  };

  if (!tenantId) return <p className="p-6 text-sm text-zinc-400">Escolha uma loja.</p>;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => trocarMes(-1)} className="w-9 h-9 rounded-lg border border-zinc-200 bg-white hover:bg-zinc-50 cursor-pointer" aria-label="Mês anterior"><i className="ri-arrow-left-s-line" /></button>
        <p className="text-sm font-bold text-zinc-800 min-w-[120px] text-center">{MESES[mm - 1]} {ano}</p>
        <button onClick={() => trocarMes(1)} className="w-9 h-9 rounded-lg border border-zinc-200 bg-white hover:bg-zinc-50 cursor-pointer" aria-label="Próximo mês"><i className="ri-arrow-right-s-line" /></button>
        <div className="ml-auto flex gap-5 text-right">
          <div>
            <p className="text-[11px] text-zinc-400">Serviços (RH)</p>
            <p className="text-lg font-black text-zinc-900">{formatCurrency(totalServico)}</p>
          </div>
          <div>
            <p className="text-[11px] text-zinc-400">Reembolsos</p>
            <p className="text-lg font-black text-zinc-500">{formatCurrency(totalReembolso)}</p>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-sky-100 bg-sky-50/60 px-4 py-3 text-xs text-sky-900 flex flex-wrap items-center gap-2">
        <i className="ri-information-line" />
        <span className="flex-1 min-w-[240px]">
          O pagamento é lançado pelo extrato: <b>Conciliação</b> › abra o Pix › <b>Lançar a partir deste pagamento</b> › <b>Prestador MEI</b>, e diga se é o <b>serviço do mês</b> ou um <b>reembolso</b>.
        </span>
        <button onClick={() => navigate('/financeiro?tab=conciliacao')} className="px-2.5 py-1 rounded-lg border border-sky-200 bg-white text-sky-800 font-semibold hover:bg-sky-50 cursor-pointer">Abrir Conciliação</button>
      </div>

      {erro && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{erro}</p>}
      {aviso && <p className="text-sm text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">{aviso}</p>}

      <section className="rounded-2xl border border-zinc-200 bg-white overflow-hidden">
        <div className="px-4 py-3 border-b border-zinc-100 flex items-center justify-between gap-2">
          <h3 className="text-sm font-black text-zinc-900">Prestadores MEI</h3>
          <button onClick={() => setEditando({})} className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-xs font-semibold cursor-pointer">
            <i className="ri-add-line" /> Novo prestador
          </button>
        </div>
        {carregando ? (
          <p className="p-6 text-center text-sm text-zinc-400">Carregando…</p>
        ) : prestadores.length === 0 ? (
          <p className="p-6 text-center text-sm text-zinc-400">Nenhum prestador MEI cadastrado.</p>
        ) : (
          <ul className="divide-y divide-zinc-100">
            {prestadores.map((p) => {
              const r = porPrestador.get(p.id);
              const combinado = p.valor_mensal != null ? Number(p.valor_mensal) : null;
              const falta = combinado != null && p.is_active && (r?.servico ?? 0) + 0.005 < combinado;
              return (
                <li key={p.id} className={`px-4 py-3 flex items-center gap-3 ${p.is_active ? '' : 'opacity-50'}`}>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-zinc-800 truncate">{p.name}</p>
                    <p className="text-[11px] text-zinc-500 truncate">
                      {[p.role, p.cnpj ? `CNPJ ${fmtCnpj(p.cnpj)}` : null, combinado != null ? `combinado ${formatCurrency(combinado)}/mês` : null,
                        p.dia_pagamento ? `paga dia ${p.dia_pagamento}` : null, p.is_active ? null : 'inativo'].filter(Boolean).join(' · ') || 'sem dados'}
                    </p>
                    {p.recorrente && p.is_active && (
                      <p className="text-[11px] text-sky-700 mt-0.5"><i className="ri-repeat-line" /> Recorrente: no dia {p.dia_pagamento} chega o pedido para você confirmar o valor e pagar{p.pix_favorecido_id ? '' : ' (sem chave Pix: paga pelo app do banco)'}</p>
                    )}
                    {r?.aPagar ? <p className="text-[11px] text-amber-700 mt-0.5">Aprovado, aguardando o Pix: {formatCurrency(r.aPagar)}</p> : null}
                    {r?.pagoEm.length ? (
                      <p className="text-[11px] text-emerald-700 mt-0.5">Serviço pago em {r.pagoEm.map(fmtData).join(', ')}</p>
                    ) : combinado != null && p.is_active ? (
                      <p className="text-[11px] text-amber-700 mt-0.5">Serviço de {MESES[mm - 1].toLowerCase()} ainda não lançado</p>
                    ) : null}
                    {falta && r?.servico ? <p className="text-[11px] text-amber-700">Faltam {formatCurrency(combinado! - r.servico)} do combinado</p> : null}
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-bold text-zinc-900">{r ? formatCurrency(r.servico) : '—'}</p>
                    <p className="text-[10px] text-zinc-400">{r?.reembolso ? `+ ${formatCurrency(r.reembolso)} reembolso` : 'serviço no mês'}</p>
                  </div>
                  {combinado != null && p.is_active && (
                    <button onClick={() => pedirAgora(p)} disabled={pedindo === p.id} title="Criar agora o pedido de pagamento do mês"
                      className="flex items-center gap-1 px-2.5 h-8 rounded-lg border border-amber-200 text-amber-700 text-xs font-semibold hover:bg-amber-50 disabled:opacity-50 cursor-pointer">
                      <i className="ri-send-plane-line" /><span className="hidden sm:inline">{pedindo === p.id ? 'Pedindo…' : 'Pedir pagamento'}</span>
                    </button>
                  )}
                  <button onClick={() => setEditando(p)} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-zinc-100 text-zinc-400 cursor-pointer" aria-label={`Editar ${p.name}`}><i className="ri-edit-line" /></button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {pagamentos.length > 0 && (
        <section className="rounded-2xl border border-zinc-200 bg-white overflow-hidden">
          <h3 className="px-4 py-3 text-sm font-black text-zinc-900 border-b border-zinc-100">Pagamentos de {MESES[mm - 1].toLowerCase()}</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <tbody className="divide-y divide-zinc-100">
                {pagamentos.map((g) => (
                  <tr key={g.id}>
                    <td className="px-4 py-2 text-zinc-600 whitespace-nowrap">{pagoDe(g) ? fmtData(pagoDe(g)) : <span className="text-amber-700">a pagar</span>}</td>
                    <td className="px-4 py-2 text-zinc-800">
                      {nomeDe(g.prestador_id)}
                      <span className={`ml-2 text-[10px] font-bold px-1.5 py-0.5 rounded ${g.tipo === 'servico' ? 'bg-amber-50 text-amber-700' : 'bg-zinc-100 text-zinc-600'}`}>
                        {g.tipo === 'servico' ? 'SERVIÇO' : 'REEMBOLSO'}
                      </span>
                      {g.tipo === 'reembolso' && g.fin_accounts_payable?.category ? <span className="text-zinc-400 text-xs"> · {g.fin_accounts_payable.category}</span> : null}
                    </td>
                    <td className="px-4 py-2 text-right font-semibold text-zinc-900 whitespace-nowrap">{formatCurrency(Number(g.amount))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {editando && <EditarPrestador tenantId={tenantId} p={editando} onFechar={() => setEditando(null)} onSalvo={() => { setEditando(null); carregar(); }} />}
    </div>
  );
}

function EditarPrestador({ tenantId, p, onFechar, onSalvo }: { tenantId: string; p: Partial<Prestador>; onFechar: () => void; onSalvo: () => void }) {
  const [nome, setNome] = useState(p.name ?? '');
  const [role, setRole] = useState(p.role ?? '');
  const [cnpj, setCnpj] = useState(p.cnpj ?? '');
  const [cpf, setCpf] = useState(p.cpf ?? '');
  const [valor, setValor] = useState(p.valor_mensal != null ? String(p.valor_mensal) : '');
  const [dia, setDia] = useState(p.dia_pagamento != null ? String(p.dia_pagamento) : '');
  const [ativo, setAtivo] = useState(p.is_active ?? true);
  const [notes, setNotes] = useState(p.notes ?? '');
  const [recorrente, setRecorrente] = useState(p.recorrente ?? false);
  const [regra, setRegra] = useState<'same' | 'prev'>(p.competencia_regra ?? 'prev');
  const [favId, setFavId] = useState(p.pix_favorecido_id ?? '');
  const [favs, setFavs] = useState<Array<{ id: string; name: string; chave: string }> | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  // Pix permitidos da loja (a lista branca só se edita no Assistente, com PIN)
  useEffect(() => {
    supabase.rpc('fn_pix_favorecidos_opcoes', { p_tenant: tenantId })
      .then(({ data }) => setFavs((data ?? []) as Array<{ id: string; name: string; chave: string }>));
  }, [tenantId]);
  const salvar = async () => {
    if (!nome.trim()) { setErro('Informe o nome.'); return; }
    // "1.450,00" (formato brasileiro) ou "1450.00"
    const t = valor.trim();
    const v = t ? lerValorBR(t) : null;
    if (v != null && !Number.isFinite(v)) { setErro('Valor mensal inválido.'); return; }
    const d = dia.trim() ? Number(dia) : null;
    if (d != null && !(Number.isInteger(d) && d >= 1 && d <= 31)) { setErro('Dia de pagamento entre 1 e 31.'); return; }
    if (recorrente && (!(v != null && v > 0) || d == null)) { setErro('Para pagamento recorrente, informe o valor mensal e o dia do pagamento.'); return; }
    setSalvando(true); setErro(null);
    const { error } = await supabase.rpc('fn_prestador_salvar', {
      p_tenant: tenantId, p_id: p.id ?? null, p_name: nome, p_cpf: cpf, p_cnpj: cnpj, p_role: role,
      p_valor_mensal: v, p_dia_pagamento: d, p_is_active: ativo, p_notes: notes,
      p_recorrente: recorrente, p_competencia_regra: regra, p_pix_favorecido_id: favId || null,
    });
    setSalvando(false);
    if (error) { setErro(error.message); return; }
    onSalvo();
  };
  const inp = 'w-full h-9 px-3 rounded-lg border border-zinc-200 text-sm focus:outline-none focus:border-amber-300';
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-3" onClick={onFechar}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md rounded-2xl bg-white p-5 space-y-3 max-h-[92vh] overflow-y-auto">
        <p className="text-base font-black text-zinc-900">{p.id ? 'Editar prestador MEI' : 'Novo prestador MEI'}</p>
        <label className="block"><span className="text-xs font-semibold text-zinc-500">Nome *</span><input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Como aparece no Pix" className={inp} /></label>
        <label className="block"><span className="text-xs font-semibold text-zinc-500">Função</span><input value={role} onChange={(e) => setRole(e.target.value)} placeholder="Ex.: supervisor" className={inp} /></label>
        <div className="grid grid-cols-2 gap-2">
          <label className="block"><span className="text-xs font-semibold text-zinc-500">CNPJ do MEI</span><input value={cnpj} onChange={(e) => setCnpj(e.target.value)} inputMode="numeric" className={inp} /></label>
          <label className="block"><span className="text-xs font-semibold text-zinc-500">CPF</span><input value={cpf} onChange={(e) => setCpf(e.target.value)} inputMode="numeric" className={inp} /></label>
        </div>
        <p className="text-[11px] text-zinc-400 -mt-1">CPF e CNPJ ajudam a Conciliação a reconhecer os Pix dele.</p>
        <div className="grid grid-cols-2 gap-2">
          <label className="block"><span className="text-xs font-semibold text-zinc-500">Valor mensal (R$)</span><input value={valor} onChange={(e) => setValor(e.target.value)} inputMode="decimal" className={inp} /></label>
          <label className="block"><span className="text-xs font-semibold text-zinc-500">Dia do pagamento</span><input value={dia} onChange={(e) => setDia(e.target.value)} inputMode="numeric" placeholder="1 a 31" className={inp} /></label>
        </div>
        <div className="rounded-xl border border-sky-100 bg-sky-50/50 p-3 space-y-2">
          <label className="flex items-start gap-2 text-sm text-zinc-800 cursor-pointer">
            <input type="checkbox" checked={recorrente} onChange={(e) => setRecorrente(e.target.checked)} className="accent-amber-500 mt-0.5" />
            <span><b>Pagamento recorrente</b><span className="block text-[11px] text-zinc-500">No dia do pagamento chega o pedido com o valor do mês: você confirma (ou muda) e paga o Pix com o PIN. Começa no próximo dia de pagamento.</span></span>
          </label>
          {recorrente && (
            <>
              <label className="block"><span className="text-xs font-semibold text-zinc-500">O pagamento é de qual mês?</span>
                <select value={regra} onChange={(e) => setRegra(e.target.value as 'same' | 'prev')} className={inp}>
                  <option value="prev">Do mês anterior (paga em outubro o serviço de setembro)</option>
                  <option value="same">Do próprio mês</option>
                </select>
              </label>
              <label className="block"><span className="text-xs font-semibold text-zinc-500">Chave Pix (dos Pix permitidos)</span>
                <select value={favId} onChange={(e) => setFavId(e.target.value)} className={inp}>
                  <option value="">{favs === null ? 'Carregando…' : 'Sem chave: pago pelo app do banco'}</option>
                  {(favs ?? []).map((f) => <option key={f.id} value={f.id}>{f.name} · {f.chave}</option>)}
                </select>
                <span className="block text-[11px] text-zinc-400 mt-0.5">Não está na lista? Cadastre em Assistente › Configurações › Pix permitidos (com o seu PIN).</span>
              </label>
            </>
          )}
        </div>
        <label className="block"><span className="text-xs font-semibold text-zinc-500">Observações</span><textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="w-full px-3 py-2 rounded-lg border border-zinc-200 text-sm focus:outline-none focus:border-amber-300" /></label>
        <label className="flex items-center gap-2 text-sm text-zinc-700 cursor-pointer"><input type="checkbox" checked={ativo} onChange={(e) => setAtivo(e.target.checked)} className="accent-amber-500" /> Ativo</label>
        {erro && <p className="text-xs text-red-600">{erro}</p>}
        <div className="flex gap-2 pt-1">
          <button onClick={onFechar} className="flex-1 h-10 rounded-xl border border-zinc-200 text-sm font-bold text-zinc-600 cursor-pointer">Cancelar</button>
          <button onClick={salvar} disabled={salvando} className="flex-1 h-10 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-sm font-bold disabled:opacity-40 cursor-pointer">{salvando ? 'Salvando…' : 'Salvar'}</button>
        </div>
      </div>
    </div>
  );
}
