// Importa o "Extrato Mensal" da folha do Domínio (PDF salvo pelo próprio Domínio).
// Leitura 100% local, sem IA: pdf.js extrai o texto com posição e src/lib/dominioExtrato
// monta funcionário por funcionário. Nada é gravado antes da conferência.
//
// Ao confirmar: cadastra/atualiza o funcionário (CPF > nome), substitui lançamentos
// PENDENTES do mesmo mês para essas pessoas e grava a folha como pendente — o pagamento
// segue pelo "Fechar e Pagar" de sempre (que lança no fluxo de caixa).
import { Fragment, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { callFinancialWrite, type Employee } from '@/hooks/useRH';
import { parseExtratoDominio, pdfWords, refHoras, type ExtratoDominio, type FuncionarioExtrato, type Rubrica } from '@/lib/dominioExtrato';

const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
const mesLabel = (ym: string) => {
  const [y, m] = ym.split('-');
  const nomes = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  return y && m ? `${nomes[Number(m) - 1]} de ${y}` : ym;
};
const fmtCpf = (d: string | null) => (d && d.length === 11 ? `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}` : d ?? undefined);

type ModoImport = 'completa' | 'inss' | 'nao';
const INSS_RE = /I\.?N\.?S\.?S/;
/** INSS da pessoa no extrato (rubricas de desconto de INSS). */
const inssDe = (f: FuncionarioExtrato) => round2(f.rubricas.filter((r) => r.tipo === 'D' && INSS_RE.test(r.descricao)).reduce((s, r) => s + r.valor, 0));

interface ExistingPay { id: string; employee_id: string | null; employee_name: string; status: string }

/** Rubricas do Domínio → campos da folha do ERPOS. Tudo que não tem campo próprio
 *  vai para "outros proventos/descontos"; a lista completa fica nas observações. */
function mapearFolha(f: FuncionarioExtrato, modo: ModoImport = 'completa') {
  // Sócio que não retira pró-labore: o Domínio calcula o pró-labore mínimo só para recolher
  // o INSS. Entra na folha apenas o INSS (é o que sai do caixa); o "salário" não foi pago.
  if (modo === 'inss') {
    const v = inssDe(f);
    const reais = (n: number) => n.toFixed(2).replace('.', ',');
    return {
      base_salary: 0, overtime_50: 0, overtime_50_hours: 0, overtime_100: 0, overtime_100_hours: 0,
      overtime_night_hours: 0, overtime: 0, overtime_percent: 50,
      night_shift_value: 0, night_shift_hours: 0, dsr_value: 0, bonuses: 0, other_bonuses: v,
      inss: 0, irrf: 0, fgts: 0, vale_transporte: 0, vale_transporte_uses: false, vale_refeicao: 0,
      desconto_faltas: 0, horas_faltantes: 0, dias_faltas: 0, other_deductions: 0,
      deductions: 0, total_proventos: v, total_descontos: 0, gross_salary: v, net_salary: v,
      custom_proventos: [], custom_descontos: [], dependentes: 0, status: 'pending', entry_type: 'regular',
      notes: `Importado do Domínio — só o INSS${f.tipo === 'contribuinte' ? ' do pró-labore' : ''}: R$ ${reais(v)}. O valor de R$ ${reais(f.salario)} que aparece no extrato não foi pago.`,
    };
  }
  const soma = (rs: Rubrica[]) => round2(rs.reduce((s, r) => s + r.valor, 0));
  const horas = (rs: Rubrica[]) => round2(rs.reduce((s, r) => s + refHoras(r.referencia), 0));
  const P = f.rubricas.filter((r) => r.tipo === 'P');
  const D = f.rubricas.filter((r) => r.tipo === 'D');
  const pega = (rs: Rubrica[], re: RegExp, usados: Set<Rubrica>) => {
    const out = rs.filter((r) => !usados.has(r) && re.test(r.descricao));
    out.forEach((r) => usados.add(r));
    return out;
  };
  const uP = new Set<Rubrica>();
  const base = pega(P, /DIAS NORMAIS|PRO-?LABORE|SALDO DE SALARIO|SALARIO BASE|MENSALISTA/, uP);
  const dsr = pega(P, /DSR/, uP);
  const heNot = pega(P, /EXTRAS? NOTURNA/, uP);
  const he100 = pega(P, /EXTRAS?.*100\s*%/, uP);
  const he50 = pega(P, /EXTRAS?.*(50|60|70|75|80)\s*%/, uP);
  const adicNot = pega(P, /ADIC(IONAL|\.)?\s*NOTURNO/, uP);
  const outrosP = P.filter((r) => !uP.has(r));
  const uD = new Set<Rubrica>();
  const inss = pega(D, /I\.?N\.?S\.?S/, uD);
  const irrf = pega(D, /I\.?R\.?R\.?F|IMPOSTO DE RENDA/, uD);
  const faltas = pega(D, /FALTA|ATRASO/, uD);
  const vt = pega(D, /VALE[\s.-]*TRANSP|\bV\.?T\.?\b/, uD);
  const vr = pega(D, /VALE[\s.-]*REFEI|VALE[\s.-]*ALIMENT|\bV\.?R\.?\b/, uD);
  const outrosD = D.filter((r) => !uD.has(r));
  const heTotal = round2(soma(he50) + soma(he100) + soma(heNot));
  const he50pct = he50.map((r) => Number(r.descricao.match(/(\d+)\s*%/)?.[1] ?? 50))[0] ?? 50;

  const linhas = f.rubricas.map((r) => `${r.tipo} ${r.codigo} ${r.descricao}${r.referencia ? ` (${r.referencia})` : ''}: ${r.valor.toFixed(2).replace('.', ',')}`);
  const notas = [
    `Importado do Domínio — extrato mensal.`,
    f.demissao ? `RESCISÃO em ${f.demissao.data?.split('-').reverse().join('/') ?? '?'}: ${f.demissao.motivo}.` : '',
    f.tipo === 'contribuinte' ? `Pró-labore (${f.vinculo || 'sócio'}).` : '',
    `Base INSS ${f.baseInss.toFixed(2)} · Base FGTS ${f.baseFgts.toFixed(2)} · Base IRRF ${f.baseIrrf.toFixed(2)}.`,
    'Rubricas:', ...linhas,
  ].filter(Boolean).join('\n');

  return {
    base_salary: f.salario || soma(base),
    overtime_50: soma(he50), overtime_50_hours: horas(he50),
    overtime_100: soma(he100), overtime_100_hours: horas(he100),
    overtime_night_hours: horas(heNot),
    overtime: heTotal, overtime_percent: he50pct,
    night_shift_value: soma(adicNot), night_shift_hours: horas(adicNot),
    dsr_value: soma(dsr),
    bonuses: 0, other_bonuses: soma(outrosP),
    inss: soma(inss), irrf: soma(irrf), fgts: f.valorFgts,
    vale_transporte: soma(vt), vale_transporte_uses: vt.length > 0, vale_refeicao: soma(vr),
    desconto_faltas: soma(faltas), horas_faltantes: horas(faltas), dias_faltas: 0,
    other_deductions: soma(outrosD),
    deductions: f.descontos, total_proventos: f.proventos, total_descontos: f.descontos,
    gross_salary: f.proventos, net_salary: f.liquido,
    custom_proventos: [], custom_descontos: [], dependentes: 0,
    status: 'pending', entry_type: 'regular', notes: notas,
  };
}

export default function ImportarFolhaDominioModal({ tenantId, employees, onClose, onImported }: {
  tenantId: string;
  employees: Employee[];
  onClose: () => void;
  onImported: (month: string, resumo: string) => void;
}) {
  const [lendo, setLendo] = useState(false);
  const [gravando, setGravando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [arquivo, setArquivo] = useState<string>('');
  const [ext, setExt] = useState<ExtratoDominio | null>(null);
  const [existentes, setExistentes] = useState<ExistingPay[]>([]);
  const [modo, setModo] = useState<Record<number, ModoImport>>({});
  const [aberto, setAberto] = useState<number | null>(null);

  const matchEmp = (f: FuncionarioExtrato, lista: Employee[] = employees): Employee | undefined => {
    if (f.cpf) {
      const byCpf = lista.find((e) => (e.cpf ?? '').replace(/\D/g, '') === f.cpf);
      if (byCpf) return byCpf;
    }
    return lista.find((e) => norm(e.name) === norm(f.nome));
  };
  const payDe = (f: FuncionarioExtrato) => {
    const emp = matchEmp(f);
    return existentes.filter((p) => (emp && p.employee_id === emp.id) || norm(p.employee_name) === norm(f.nome));
  };

  const ler = async (file: File) => {
    setErro(null); setExt(null); setArquivo(file.name); setLendo(true);
    try {
      const pdfjs = await import('pdfjs-dist');
      const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
      const words = await pdfWords(pdfjs, await file.arrayBuffer());
      const r = parseExtratoDominio(words);
      if (r.funcionarios.length === 0) { setErro(r.avisos.join(' ') || 'Não consegui ler este PDF.'); return; }
      if (r.competencia) {
        const { data } = await supabase.from('hr_payroll').select('id, employee_id, employee_name, status')
          .eq('tenant_id', tenantId).eq('reference_month', r.competencia);
        setExistentes((data ?? []) as ExistingPay[]);
      }
      setExt(r);
      // Sócio (contribuinte) começa em "só o INSS"; dá para trocar na linha.
      setModo(Object.fromEntries(r.funcionarios.map((f, i) => [i, f.tipo === 'contribuinte' ? 'inss' : 'completa'])));
    } catch (e) {
      setErro(`Não consegui abrir o PDF: ${String((e as Error)?.message ?? e)}`);
    } finally { setLendo(false); }
  };

  const selecionados = useMemo(() => (ext?.funcionarios ?? []).filter((_, i) => (modo[i] ?? 'completa') !== 'nao'), [ext, modo]);
  const bloqueados = selecionados.filter((f) => payDe(f).some((p) => p.status === 'paid'));
  const totalSel = round2((ext?.funcionarios ?? []).reduce((s, f, i) => {
    const m = modo[i] ?? 'completa';
    if (m === 'nao' || payDe(f).some((p) => p.status === 'paid')) return s;
    return s + (m === 'inss' ? inssDe(f) : f.liquido);
  }, 0));
  const avisosLeitura = [...(ext?.avisos ?? []), ...(ext?.funcionarios ?? []).flatMap((f) => f.avisos.map((a) => `${f.nome}: ${a}`))];

  const importar = async () => {
    if (!ext || !ext.competencia) return;
    setGravando(true); setErro(null);
    const registros: Record<string, unknown>[] = [];
    const substituir: string[] = [];
    let novos = 0; let atualizados = 0;
    try {
      const { data: frescos, error: fErr } = await supabase.from('hr_employees').select('*').eq('tenant_id', tenantId);
      if (fErr) throw new Error(`Cadastro de funcionários: ${fErr.message}`);
      const lista = (frescos ?? []) as Employee[];
      for (const [i, f] of ext.funcionarios.entries()) {
        const m = modo[i] ?? 'completa';
        if (m === 'nao') continue;
        const pays = payDe(f);
        if (pays.some((p) => p.status === 'paid')) continue; // já pago: não mexe
        const emp = matchEmp(f, lista);
        const status = /DEMITID/i.test(f.situacao) ? 'inactive' : /F[EÉ]RIAS/i.test(f.situacao) ? 'vacation' : /AFAST|LICEN/i.test(f.situacao) ? 'leave' : 'active';
        const cadastro: Record<string, unknown> = {
          name: f.nome, role: f.cargo || f.vinculo || 'Funcionário', salary: m === 'inss' ? 0 : f.salario, status,
          ...(f.cpf ? { cpf: fmtCpf(f.cpf) } : {}),
          ...(f.admissao ? { hire_date: f.admissao } : {}),
          ...(emp ? { id: emp.id } : { department: f.tipo === 'contribuinte' ? 'Sócios' : 'Geral' }),
          ...(f.demissao ? { notes: [emp?.notes, `Demitido em ${f.demissao.data?.split('-').reverse().join('/')}: ${f.demissao.motivo}`].filter(Boolean).join('\n') } : {}),
        };
        const r = await callFinancialWrite('upsert_employee', tenantId, cadastro);
        if (r.error) throw new Error(`Cadastro de ${f.nome}: ${r.error}`);
        const empId = emp?.id ?? (r.data as { id?: string } | null)?.id ?? null;
        if (emp) atualizados++; else novos++;
        substituir.push(...pays.filter((p) => p.status !== 'paid').map((p) => p.id));
        registros.push({
          employee_id: empId, employee_name: f.nome, role: f.cargo || f.vinculo || 'Funcionário',
          department: emp?.department || (f.tipo === 'contribuinte' ? 'Sócios' : 'Geral'),
          reference_month: ext.competencia, ...mapearFolha(f, m),
        });
      }
      for (const id of substituir) {
        const d = await callFinancialWrite('delete_payroll', tenantId, { id });
        if (d.error) throw new Error(`Não consegui substituir um lançamento antigo: ${d.error}`);
      }
      if (registros.length > 0) {
        const b = await callFinancialWrite('bulk_insert_payroll', tenantId, { records: registros });
        if (b.error) throw new Error(`Folha: ${b.error}`);
      }
      const partes = [`${registros.length} lançamento(s) de ${mesLabel(ext.competencia)}`];
      if (novos) partes.push(`${novos} funcionário(s) novo(s)`);
      if (atualizados) partes.push(`${atualizados} atualizado(s)`);
      if (substituir.length) partes.push(`${substituir.length} pendente(s) substituído(s)`);
      if (bloqueados.length) partes.push(`${bloqueados.length} já pago(s) mantido(s)`);
      onImported(ext.competencia, partes.join(' · '));
    } catch (e) {
      setErro(String((e as Error)?.message ?? e));
    } finally { setGravando(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-4xl max-h-[92vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-100">
          <div>
            <h2 className="text-base font-bold text-zinc-900">Importar folha do Domínio</h2>
            <p className="text-xs text-zinc-500">PDF do "Extrato Mensal" salvo pelo Domínio. A leitura é feita aqui no navegador, sem custo.</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-zinc-100 cursor-pointer">
            <i className="ri-close-line text-zinc-500" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          <label className="flex items-center gap-3 border-2 border-dashed border-zinc-200 hover:border-amber-400 rounded-xl px-4 py-4 cursor-pointer">
            <i className="ri-file-pdf-2-line text-2xl text-red-500" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-zinc-800 truncate">{arquivo || 'Escolher o PDF do extrato'}</p>
              <p className="text-xs text-zinc-400">{lendo ? 'Lendo…' : 'Clique para selecionar'}</p>
            </div>
            <input type="file" accept="application/pdf,.pdf" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) ler(f); e.target.value = ''; }} />
          </label>

          {erro && <div className="bg-red-50 border border-red-100 text-red-700 text-xs rounded-lg px-3 py-2">{erro}</div>}

          {ext && (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="bg-zinc-50 rounded-xl p-3"><p className="text-[10px] uppercase text-zinc-400">Empresa</p><p className="text-xs font-semibold text-zinc-800 truncate">{ext.empresa || '—'}</p></div>
                <div className="bg-zinc-50 rounded-xl p-3"><p className="text-[10px] uppercase text-zinc-400">Competência</p><p className="text-xs font-semibold text-zinc-800 capitalize">{mesLabel(ext.competencia)}</p></div>
                <div className="bg-zinc-50 rounded-xl p-3"><p className="text-[10px] uppercase text-zinc-400">Líquido geral</p><p className="text-xs font-semibold text-zinc-800">{ext.totais.liquido != null ? brl(ext.totais.liquido) : '—'}</p></div>
                <div className="bg-zinc-50 rounded-xl p-3"><p className="text-[10px] uppercase text-zinc-400">FGTS · INSS do mês</p><p className="text-xs font-semibold text-zinc-800">{brl(ext.totais.fgts ?? 0)} · {brl(ext.totais.inss ?? 0)}</p></div>
              </div>

              {avisosLeitura.length > 0
                ? <div className="bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 text-xs text-amber-800 space-y-0.5">{avisosLeitura.map((a, i) => <p key={i}>⚠ {a}</p>)}</div>
                : <p className="text-xs text-green-700"><i className="ri-checkbox-circle-line" /> Conferido: as rubricas somam os totais de cada pessoa e os líquidos somam o líquido geral.</p>}

              <div className="border border-zinc-200 rounded-xl overflow-x-auto">
                <table className="w-full text-sm min-w-[640px]">
                  <thead className="bg-zinc-50 text-[11px] uppercase text-zinc-500">
                    <tr>
                      <th className="px-3 py-2 text-left">Importar</th>
                      <th className="px-3 py-2 text-left">Funcionário</th>
                      <th className="px-3 py-2 text-right">Proventos</th>
                      <th className="px-3 py-2 text-right">Descontos</th>
                      <th className="px-3 py-2 text-right">Líquido</th>
                      <th className="px-3 py-2 text-right">FGTS</th>
                      <th className="px-3 py-2 text-left">No ERPOS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ext.funcionarios.map((f, i) => {
                      const emp = matchEmp(f);
                      const pays = payDe(f);
                      const pago = pays.some((p) => p.status === 'paid');
                      return (
                        <Fragment key={i}>
                          <tr className="border-t border-zinc-100 align-top">
                            <td className="px-3 py-2.5">
                              <select value={pago ? 'nao' : (modo[i] ?? 'completa')} disabled={pago}
                                onChange={(e) => setModo((m) => ({ ...m, [i]: e.target.value as ModoImport }))}
                                className="text-xs border border-zinc-200 rounded-md px-1.5 py-1 bg-white cursor-pointer disabled:opacity-50">
                                <option value="completa">Folha completa</option>
                                <option value="inss">Só o INSS</option>
                                <option value="nao">Não importar</option>
                              </select>
                            </td>
                            <td className="px-3 py-2.5">
                              <button onClick={() => setAberto(aberto === i ? null : i)} className="text-left cursor-pointer">
                                <p className="font-semibold text-zinc-800">{f.nome} <i className={`ri-arrow-${aberto === i ? 'up' : 'down'}-s-line text-zinc-400`} /></p>
                                <p className="text-[11px] text-zinc-500">{f.cargo}{f.tipo === 'contribuinte' ? ' · pró-labore' : ''}</p>
                              </button>
                              {f.demissao && <span className="inline-block mt-1 text-[10px] font-bold px-1.5 py-0.5 rounded bg-red-50 text-red-600">Rescisão {f.demissao.data?.split('-').reverse().join('/')}</span>}
                            </td>
                            <td className="px-3 py-2.5 text-right text-zinc-700">{brl(f.proventos)}</td>
                            <td className="px-3 py-2.5 text-right text-red-600">{brl(f.descontos)}</td>
                            <td className="px-3 py-2.5 text-right font-bold text-zinc-900">{brl(f.liquido)}</td>
                            <td className="px-3 py-2.5 text-right text-zinc-600">{brl(f.valorFgts)}</td>
                            <td className="px-3 py-2.5 text-[11px]">
                              {emp ? <span className="text-zinc-600">Cadastrado</span> : <span className="text-sky-700 font-semibold">Novo cadastro</span>}
                              {!pago && modo[i] === 'inss' && <p className="text-violet-700 font-semibold">Entra só o INSS: {brl(inssDe(f))}</p>}
                              {!pago && modo[i] === 'nao' && <p className="text-zinc-400">Fica de fora</p>}
                              {pago && <p className="text-green-700 font-semibold">Folha do mês já paga: mantida</p>}
                              {!pago && pays.length > 0 && <p className="text-amber-700">Substitui {pays.length} pendente(s)</p>}
                            </td>
                          </tr>
                          {aberto === i && (
                            <tr className="bg-zinc-50/60">
                              <td />
                              <td colSpan={6} className="px-3 pb-3">
                                <div className="grid sm:grid-cols-2 gap-x-6 text-xs">
                                  {(['P', 'D'] as const).map((t) => (
                                    <div key={t}>
                                      <p className={`font-bold mt-2 mb-1 ${t === 'P' ? 'text-green-700' : 'text-red-600'}`}>{t === 'P' ? 'Proventos' : 'Descontos'}</p>
                                      {f.rubricas.filter((r) => r.tipo === t).map((r, k) => (
                                        <div key={k} className="flex justify-between gap-2 py-0.5 border-b border-zinc-100">
                                          <span className="text-zinc-600 truncate">{r.codigo} {r.descricao}{r.referencia ? <span className="text-zinc-400"> ({r.referencia})</span> : null}</span>
                                          <span className="text-zinc-800 whitespace-nowrap">{brl(r.valor)}</span>
                                        </div>
                                      ))}
                                    </div>
                                  ))}
                                </div>
                                <p className="text-[11px] text-zinc-400 mt-2">Admissão {f.admissao?.split('-').reverse().join('/') ?? '—'} · Salário {brl(f.salario)} · Base INSS {brl(f.baseInss)} · Base IRRF {brl(f.baseIrrf)}</p>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="text-[11px] text-zinc-400">A folha entra como <strong>pendente</strong>. O pagamento segue pelo "Fechar e Pagar", que lança a saída no fluxo de caixa. Guias de FGTS e INSS não são lançadas aqui.</p>
            </>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-zinc-100">
          <p className="text-xs text-zinc-500">{ext ? `${selecionados.length - bloqueados.length} selecionado(s) · líquido ${brl(totalSel)}` : ''}</p>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 text-sm font-semibold text-zinc-600 hover:bg-zinc-100 rounded-lg cursor-pointer">Cancelar</button>
            <button onClick={importar} disabled={!ext || !ext.competencia || gravando || selecionados.length - bloqueados.length === 0}
              className="px-4 py-2 text-sm font-semibold bg-amber-500 hover:bg-amber-600 text-white rounded-lg cursor-pointer disabled:opacity-40">
              {gravando ? 'Importando…' : ext ? `Importar folha de ${mesLabel(ext.competencia)}` : 'Importar'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
