// Aba Freelancers (2026-09-16, pedido do dono): quem trabalhou em quais dias e quanto custou.
//
// Como os dados nascem: o assistente paga o freela (pedido no grupo ou pelo Telegram) e chama
// fn_freelancer_registrar_pagamento — uma conta a pagar por Pix (categoria RH, baixa pela conciliação)
// e uma DIÁRIA por dia trabalhado (hr_freelancer_shifts). Sem os dias, fica "aguardando os dias" e o
// assistente pergunta no grupo; aqui dá para informar à mão. Escrita só pelas funções do banco
// (fn_freelancer_informar_dias, fn_freelancer_salvar) — a mesma regra do assistente.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { formatCurrency } from '@/lib/formatters';

interface Freelancer {
  id: string; name: string; role: string | null; phone: string | null; cpf: string | null;
  daily_rate: number | null; is_active: boolean; notes: string | null;
}
interface Diaria {
  id: string; freelancer_id: string; work_date: string | null; amount: number; status: 'registrada' | 'aguardando_dias';
  payment_id: string | null; created_at: string;
  hr_freelancers: { name: string; role: string | null } | null;
}

const hojeSP = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
const fmtDia = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' });
const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

export default function FreelancersTab() {
  const { user } = useAuth();
  const tenantId = user?.tenantId;
  const [mes, setMes] = useState(() => hojeSP().slice(0, 7)); // AAAA-MM
  const [freelancers, setFreelancers] = useState<Freelancer[]>([]);
  const [diarias, setDiarias] = useState<Diaria[]>([]);
  const [pendentes, setPendentes] = useState<Diaria[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [editando, setEditando] = useState<Freelancer | null>(null);

  const carregar = useCallback(async () => {
    if (!tenantId) return;
    setCarregando(true); setErro(null);
    const [y, m] = mes.split('-').map(Number);
    const ini = `${mes}-01`;
    const fim = new Date(y, m, 0).toLocaleDateString('en-CA'); // último dia do mês
    const sel = 'id, freelancer_id, work_date, amount, status, payment_id, created_at, hr_freelancers(name, role)';
    const [f, d, p] = await Promise.all([
      supabase.from('hr_freelancers').select('*').eq('tenant_id', tenantId).order('name'),
      supabase.from('hr_freelancer_shifts').select(sel).eq('tenant_id', tenantId).eq('status', 'registrada').gte('work_date', ini).lte('work_date', fim).order('work_date'),
      supabase.from('hr_freelancer_shifts').select(sel).eq('tenant_id', tenantId).eq('status', 'aguardando_dias').order('created_at', { ascending: false }),
    ]);
    const falha = f.error ?? d.error ?? p.error;
    // Falha é falha: não mostrar "nenhum freelancer" quando a leitura não veio (FINANCEIRO_MAP §7c).
    if (falha) setErro(falha.message);
    setFreelancers((f.data ?? []) as Freelancer[]);
    setDiarias((d.data ?? []) as unknown as Diaria[]);
    setPendentes((p.data ?? []) as unknown as Diaria[]);
    setCarregando(false);
  }, [tenantId, mes]);
  useEffect(() => { carregar(); }, [carregar]);

  // Resumo por freelancer no mês: dias trabalhados e total.
  const porFreelancer = useMemo(() => {
    const m = new Map<string, { dias: string[]; total: number }>();
    for (const d of diarias) {
      const r = m.get(d.freelancer_id) ?? { dias: [], total: 0 };
      if (d.work_date) r.dias.push(d.work_date);
      r.total += Number(d.amount);
      m.set(d.freelancer_id, r);
    }
    return m;
  }, [diarias]);
  const totalMes = diarias.reduce((s, d) => s + Number(d.amount), 0);
  const [ano, mm] = mes.split('-').map(Number);
  const trocarMes = (delta: number) => {
    const d = new Date(ano, mm - 1 + delta, 1);
    setMes(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  };

  if (!tenantId) return <p className="p-6 text-sm text-zinc-400">Escolha uma loja.</p>;

  return (
    <div className="p-4 md:p-6 space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => trocarMes(-1)} className="w-9 h-9 rounded-lg border border-zinc-200 hover:bg-zinc-50 cursor-pointer" aria-label="Mês anterior"><i className="ri-arrow-left-s-line" /></button>
        <p className="text-sm font-bold text-zinc-800 min-w-[120px] text-center">{MESES[mm - 1]} {ano}</p>
        <button onClick={() => trocarMes(1)} className="w-9 h-9 rounded-lg border border-zinc-200 hover:bg-zinc-50 cursor-pointer" aria-label="Próximo mês"><i className="ri-arrow-right-s-line" /></button>
        <div className="ml-auto text-right">
          <p className="text-[11px] text-zinc-400">Diárias no mês</p>
          <p className="text-lg font-black text-zinc-900">{formatCurrency(totalMes)} <span className="text-xs font-semibold text-zinc-400">· {diarias.length} dia(s)</span></p>
        </div>
      </div>

      {erro && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">Não consegui carregar: {erro}</p>}

      {/* Aguardando os dias: o que precisa de ação */}
      {pendentes.length > 0 && (
        <section className="rounded-2xl border border-amber-200 bg-amber-50/60 p-4">
          <h3 className="text-sm font-black text-amber-900"><i className="ri-time-line" /> Aguardando os dias trabalhados ({pendentes.length})</h3>
          <p className="text-xs text-amber-800 mt-0.5">Pagos, mas ainda não se sabe a que dias se referem. O assistente pergunta no grupo; você também pode informar aqui.</p>
          <div className="mt-3 space-y-2">
            {pendentes.map((p) => <InformarDias key={p.id} diaria={p} onFeito={carregar} />)}
          </div>
        </section>
      )}

      {/* Freelancers */}
      <section className="rounded-2xl border border-zinc-200 bg-white overflow-hidden">
        <h3 className="px-4 py-3 text-sm font-black text-zinc-900 border-b border-zinc-100">Freelancers</h3>
        {carregando ? (
          <p className="p-6 text-center text-sm text-zinc-400">Carregando…</p>
        ) : freelancers.length === 0 ? (
          <p className="p-6 text-center text-sm text-zinc-400">Nenhum freelancer ainda. Eles aparecem aqui quando o assistente paga uma diária.</p>
        ) : (
          <ul className="divide-y divide-zinc-100">
            {freelancers.map((f) => {
              const r = porFreelancer.get(f.id);
              return (
                <li key={f.id} className={`px-4 py-3 flex items-center gap-3 ${f.is_active ? '' : 'opacity-50'}`}>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-zinc-800 truncate">{f.name}</p>
                    <p className="text-[11px] text-zinc-500 truncate">
                      {[f.role, f.daily_rate != null ? `diária ${formatCurrency(Number(f.daily_rate))}` : null, f.is_active ? null : 'inativo'].filter(Boolean).join(' · ') || 'sem função cadastrada'}
                    </p>
                    {r?.dias.length ? (
                      <p className="text-[11px] text-emerald-700 mt-0.5">Trabalhou: {r.dias.map((d) => fmtDia(d)).join(', ')}</p>
                    ) : null}
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-bold text-zinc-900">{r ? formatCurrency(r.total) : '—'}</p>
                    <p className="text-[10px] text-zinc-400">{r ? `${r.dias.length} dia(s)` : 'no mês'}</p>
                  </div>
                  <button onClick={() => setEditando(f)} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-zinc-100 text-zinc-400 cursor-pointer" aria-label={`Editar ${f.name}`}><i className="ri-edit-line" /></button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Diárias do mês, dia a dia */}
      {diarias.length > 0 && (
        <section className="rounded-2xl border border-zinc-200 bg-white overflow-hidden">
          <h3 className="px-4 py-3 text-sm font-black text-zinc-900 border-b border-zinc-100">Diárias de {MESES[mm - 1].toLowerCase()}</h3>
          <table className="w-full text-sm">
            <tbody className="divide-y divide-zinc-100">
              {diarias.map((d) => (
                <tr key={d.id}>
                  <td className="px-4 py-2 text-zinc-600 whitespace-nowrap capitalize">{d.work_date ? fmtDia(d.work_date) : '—'}</td>
                  <td className="px-4 py-2 text-zinc-800">{d.hr_freelancers?.name ?? 'Freelancer'}{d.hr_freelancers?.role ? <span className="text-zinc-400"> · {d.hr_freelancers.role}</span> : null}</td>
                  <td className="px-4 py-2 text-right font-semibold text-zinc-900 whitespace-nowrap">{formatCurrency(Number(d.amount))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {editando && <EditarFreelancer f={editando} onFechar={() => setEditando(null)} onSalvo={() => { setEditando(null); carregar(); }} />}
    </div>
  );
}

// Pagamento sem os dias: escolhe as datas e grava (o valor é dividido igualmente pelos dias).
function InformarDias({ diaria, onFeito }: { diaria: Diaria; onFeito: () => void }) {
  const [dias, setDias] = useState<string[]>([]);
  const [novo, setNovo] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const adicionar = () => {
    if (!novo || dias.includes(novo)) return;
    setDias([...dias, novo].sort()); setNovo('');
  };
  const salvar = async () => {
    if (!diaria.payment_id || !dias.length) return;
    setSalvando(true); setErro(null);
    const { error } = await supabase.rpc('fn_freelancer_informar_dias', { p_payment_id: diaria.payment_id, p_dias: dias });
    setSalvando(false);
    if (error) { setErro(error.message); return; }
    onFeito();
  };
  return (
    <div className="rounded-xl bg-white border border-amber-200 p-3">
      <div className="flex flex-wrap items-baseline gap-2">
        <p className="text-sm font-semibold text-zinc-800">{diaria.hr_freelancers?.name ?? 'Freelancer'}</p>
        <p className="text-xs text-zinc-500">{formatCurrency(Number(diaria.amount))} · pago em {new Date(diaria.created_at).toLocaleDateString('pt-BR')}</p>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 mt-2">
        {dias.map((d) => (
          <span key={d} className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 capitalize">
            {fmtDia(d)}
            <button onClick={() => setDias(dias.filter((x) => x !== d))} className="text-emerald-600 hover:text-red-500 cursor-pointer" aria-label={`Tirar ${d}`}><i className="ri-close-line" /></button>
          </span>
        ))}
        <input type="date" value={novo} max={hojeSP()} onChange={(e) => setNovo(e.target.value)} className="h-8 px-2 rounded-lg border border-zinc-200 text-sm" aria-label="Dia trabalhado" />
        <button onClick={adicionar} disabled={!novo} className="h-8 px-2.5 rounded-lg border border-zinc-200 text-xs font-bold text-zinc-700 hover:bg-zinc-50 disabled:opacity-40 cursor-pointer">+ Dia</button>
        <button onClick={salvar} disabled={!dias.length || salvando} className="h-8 px-3 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold disabled:opacity-40 cursor-pointer">
          {salvando ? 'Salvando…' : dias.length > 1 ? `Salvar ${dias.length} dias (${formatCurrency(Number(diaria.amount) / dias.length)} cada)` : 'Salvar'}
        </button>
      </div>
      {erro && <p className="text-xs text-red-600 mt-1">{erro}</p>}
    </div>
  );
}

function EditarFreelancer({ f, onFechar, onSalvo }: { f: Freelancer; onFechar: () => void; onSalvo: () => void }) {
  const [role, setRole] = useState(f.role ?? '');
  const [phone, setPhone] = useState(f.phone ?? '');
  const [cpf, setCpf] = useState(f.cpf ?? '');
  const [rate, setRate] = useState(f.daily_rate != null ? String(f.daily_rate) : '');
  const [ativo, setAtivo] = useState(f.is_active);
  const [notes, setNotes] = useState(f.notes ?? '');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const salvar = async () => {
    setSalvando(true); setErro(null);
    const valor = rate.trim() ? Number(rate.replace(',', '.')) : null;
    const { error } = await supabase.rpc('fn_freelancer_salvar', {
      p_id: f.id, p_role: role, p_phone: phone, p_cpf: cpf, p_daily_rate: Number.isFinite(valor) ? valor : null, p_is_active: ativo, p_notes: notes,
    });
    setSalvando(false);
    if (error) { setErro(error.message); return; }
    onSalvo();
  };
  const inp = 'w-full h-9 px-3 rounded-lg border border-zinc-200 text-sm focus:outline-none focus:border-amber-300';
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-3" onClick={onFechar}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md rounded-2xl bg-white p-5 space-y-3">
        <p className="text-base font-black text-zinc-900">{f.name}</p>
        <label className="block"><span className="text-xs font-semibold text-zinc-500">Função</span><input value={role} onChange={(e) => setRole(e.target.value)} placeholder="Garçom, cozinha, entregador…" className={inp} /></label>
        <div className="grid grid-cols-2 gap-2">
          <label className="block"><span className="text-xs font-semibold text-zinc-500">Diária (R$)</span><input value={rate} onChange={(e) => setRate(e.target.value)} inputMode="decimal" className={inp} /></label>
          <label className="block"><span className="text-xs font-semibold text-zinc-500">Telefone</span><input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" className={inp} /></label>
        </div>
        <label className="block"><span className="text-xs font-semibold text-zinc-500">CPF</span><input value={cpf} onChange={(e) => setCpf(e.target.value)} inputMode="numeric" className={inp} /></label>
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
