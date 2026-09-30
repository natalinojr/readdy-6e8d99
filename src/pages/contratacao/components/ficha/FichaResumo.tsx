// Aba "Visão geral" da ficha do candidato: empresa, dados mínimos, banner IA, vagas com nota,
// resumo, pontos fortes/atenção, anotações. Decisão e agendamento pela IA saíram daqui em 2026-09-30:
// a decisão fica no cabeçalho da ficha e o agendamento no quadro "Próximo passo". Estrelas saíram.
import { useEffect, useState } from 'react';
import {
  type Application, type Candidate, type Company, type Job, type Stage, FIT, fitOf,
  type FichaCfg, fieldsOf, faltasFicha, onlyDigits, companyName,
} from '../../shared';

interface Props {
  c: Candidate; companies: Company[]; stages: Stage[]; ficha: FichaCfg; jobs: Job[]; applications: Application[];
  analyzing: Set<string>;
  onApply: (jobId: string) => void; onOpenJob: (jobId: string) => void;
  onUpdate: (patch: Partial<Candidate>) => void; onOrganizar: () => Promise<void>;
}

export default function FichaResumo({ c, companies, stages, ficha, jobs, applications, analyzing, onApply, onOpenJob, onUpdate, onOrganizar }: Props) {
  const [notes, setNotes] = useState(c.notes ?? '');
  const [iaBusy, setIaBusy] = useState(false);
  const [iaErro, setIaErro] = useState<string | null>(null);
  useEffect(() => { setNotes(c.notes ?? ''); }, [c.id, c.notes]);
  useEffect(() => { setIaErro(null); }, [c.id]);
  const [editando, setEditando] = useState(false);
  // Já inscrita numa vaga: o seletor some atrás de um link discreto (inscrever em outra é raro).
  const [outraVaga, setOutraVaga] = useState(false);
  useEffect(() => { setOutraVaga(false); }, [c.id]);
  useEffect(() => { setEditando(false); }, [c.id]);

  const organizar = async () => {
    setIaBusy(true); setIaErro(null);
    try { await onOrganizar(); } catch (e) { setIaErro((e as Error).message); } finally { setIaBusy(false); }
  };

  const faltam = faltasFicha(c, ficha);
  const vagasAbertas = jobs.filter((j) => j.status !== 'fechada' && !applications.some((a) => a.job_id === j.id));

  return (
    <>
      {/* Empresa */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">Empresa</span>
        <select value={c.company_id ?? ''} onChange={(e) => onUpdate({ company_id: e.target.value || null })}
          className="flex-1 sm:flex-none sm:max-w-[240px] h-9 px-3 rounded-lg border border-zinc-200 text-sm cursor-pointer" title="Empresa da vaga (a distância é calculada até ela)">
          <option value="">Sem empresa</option>
          {companies.filter((x) => x.is_active || x.id === c.company_id).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
      </div>

      {/* Dados mínimos: aviso do que falta + edição */}
      {(faltam.length > 0 || editando) ? (
        <div className={`rounded-xl border p-3 ${faltam.length ? 'border-amber-200 bg-amber-50' : 'border-zinc-200 bg-zinc-50'}`}>
          {faltam.length > 0 ? (
            <p className="text-xs text-amber-900">
              <b><i className="ri-error-warning-line" /> Ficha incompleta.</b> Faltam: {faltam.map((f) => f.label.toLowerCase()).join(', ')}.
              {' '}Sem esses dados o candidato não sai de "{stages.find((s) => s.native_kind === 'novo')?.name ?? 'Novo'}".
              {c.source?.startsWith('whatsapp_link') && ' O atendente do WhatsApp está perguntando ao candidato.'}
            </p>
          ) : <p className="text-xs font-bold text-zinc-600">Dados mínimos</p>}
          <DadosMinimosForm key={c.id} c={c} campos={editando ? fieldsOf(ficha).filter((f) => ficha.required_fields.includes(f.id)) : faltam}
            onSave={(patch) => { onUpdate(patch); setEditando(false); }} onCancel={editando ? () => setEditando(false) : undefined} />
        </div>
      ) : ficha.required_fields.length > 0 && (
        <button onClick={() => setEditando(true)} className="text-xs font-semibold text-emerald-700 cursor-pointer">
          <i className="ri-checkbox-circle-line" /> Dados mínimos completos · editar
        </button>
      )}

      {!c.ai_processed && (
        <div className="rounded-xl border border-sky-200 bg-sky-50 p-3">
          <p className="text-xs text-sky-900">
            <b>Leitura simples (grátis):</b> só contato, cidade e o texto completo, com os campos adivinhados por regra.
            Para ver experiências, resumo e pontos fortes e de atenção, organize com IA (alguns centavos).
          </p>
          <button onClick={organizar} disabled={iaBusy}
            className="mt-2 flex items-center gap-1.5 px-3 h-8 rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-60 text-white text-xs font-bold cursor-pointer">
            {iaBusy ? <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <i className="ri-sparkling-line" />}
            {iaBusy ? 'Organizando…' : 'Organizar com IA'}
          </button>
          {iaErro && <p className="text-xs text-red-600 mt-1.5">{iaErro}</p>}
        </div>
      )}

      {/* Vagas em que está inscrito (com a aderência calculada pela IA) */}
      <Section title="Vagas">
        {applications.length > 0 && (
          <ul className="space-y-1.5 mb-2">
            {applications.map((a) => {
              const job = jobs.find((j) => j.id === a.job_id);
              const fit = a.fit ?? fitOf(a.score);
              const loading = analyzing.has(`${a.job_id}:${a.candidate_id}`);
              return (
                <li key={a.id}>
                  <button onClick={() => onOpenJob(a.job_id)} className="w-full text-left rounded-xl border border-zinc-200 hover:border-rose-300 p-2.5 cursor-pointer">
                    <div className="flex items-center gap-2">
                      <i className="ri-briefcase-4-line text-zinc-400" />
                      <span className="flex-1 text-sm font-semibold text-zinc-800 truncate">{job?.title ?? 'Vaga removida'}</span>
                      {loading ? <span className="text-[10px] text-zinc-400">analisando…</span>
                        : a.score != null ? <b className="text-sm text-zinc-900">{a.score}<span className="text-[10px] text-zinc-400">/100</span></b> : null}
                      {fit && !loading && <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${FIT[fit].cls}`}>{FIT[fit].label}</span>}
                    </div>
                    {a.analysis?.resumo && <p className="text-xs text-zinc-500 mt-1 line-clamp-2">{a.analysis.resumo}</p>}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {vagasAbertas.length > 0 && applications.length > 0 && !outraVaga ? (
          <button onClick={() => setOutraVaga(true)} className="text-xs font-semibold text-zinc-500 hover:text-zinc-800 cursor-pointer">
            + Inscrever também em outra vaga
          </button>
        ) : vagasAbertas.length > 0 ? (
          <select value="" onChange={(e) => { if (e.target.value) onApply(e.target.value); }}
            className="h-8 px-2 rounded-lg border border-zinc-200 text-xs font-semibold text-zinc-700 cursor-pointer">
            <option value="">+ Inscrever em uma vaga…</option>
            {vagasAbertas.map((j) => <option key={j.id} value={j.id}>{j.title}{j.company_id ? ` — ${companyName(companies, j.company_id)}` : ''}</option>)}
          </select>
        ) : applications.length === 0 && <p className="text-xs text-zinc-400">Nenhuma vaga aberta. Abra na aba Vagas.</p>}
      </Section>


      {c.summary && <Section title="Resumo"><p className="text-sm text-zinc-700 leading-relaxed">{c.summary}</p></Section>}

      {(c.strengths.length > 0 || c.concerns.length > 0) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {c.strengths.length > 0 && (
            <div className="rounded-xl bg-emerald-50 border border-emerald-100 p-3">
              <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-700 mb-1.5">Pontos fortes</p>
              <ul className="space-y-1 text-xs text-emerald-900">{c.strengths.map((s, i) => <li key={i}>• {s}</li>)}</ul>
            </div>
          )}
          {c.concerns.length > 0 && (
            <div className="rounded-xl bg-orange-50 border border-orange-100 p-3">
              <p className="text-[10px] font-bold uppercase tracking-wider text-orange-700 mb-1.5">Pontos de atenção</p>
              <ul className="space-y-1 text-xs text-orange-900">{c.concerns.map((s, i) => <li key={i}>• {s}</li>)}</ul>
            </div>
          )}
        </div>
      )}

      <Section title="Minhas anotações">
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)}
          onBlur={() => { if (notes !== (c.notes ?? '')) onUpdate({ notes: notes || null }); }}
          rows={4} placeholder="Referências, observações gerais, próximo passo…"
          className="w-full rounded-xl border border-zinc-200 p-3 text-sm focus:outline-none focus:border-rose-300" />
      </Section>
    </>
  );
}

// Campos dos dados mínimos. Escolaridade e experiências viram um item de texto livre (não apaga
// os itens lidos do currículo: quando já existem, só mostra quantos são).
function DadosMinimosForm({ c, campos, onSave, onCancel }: {
  c: Candidate; campos: { id: string; label: string; custom?: boolean }[];
  onSave: (patch: Partial<Candidate>) => void; onCancel?: () => void;
}) {
  const atual = (f: { id: string; custom?: boolean }): unknown =>
    (f.custom ? c.extra_fields?.[f.id] : (c as unknown as Record<string, unknown>)[f.id]) ?? null;
  const inicial = (f: { id: string; custom?: boolean }) => (f.id === 'education' || f.id === 'experiences' ? '' : String(atual(f) ?? ''));
  const [v, setV] = useState<Record<string, string>>(() => Object.fromEntries(campos.map((f) => [f.id, inicial(f)])));
  if (!campos.length) return null;
  const set = (k: string, x: string) => setV((o) => ({ ...o, [k]: x }));
  const salvar = () => {
    const patch: Record<string, unknown> = {};
    const extra: Record<string, string> = { ...(c.extra_fields ?? {}) };
    let extraMudou = false;
    for (const f of campos) {
      const x = (v[f.id] ?? '').trim();
      if (f.custom) { if (x !== (extra[f.id] ?? '')) { if (x) extra[f.id] = x; else delete extra[f.id]; extraMudou = true; } continue; }
      if (f.id === 'education') { if (x) patch.education = [...(c.education ?? []), { instituicao: null, curso: null, nivel: x, situacao: null }]; continue; }
      if (f.id === 'experiences') { if (x) patch.experiences = [...(c.experiences ?? []), { empresa: null, cargo: null, inicio: null, fim: null, atual: false, descricao: x }]; continue; }
      const val = f.id === 'phone' ? onlyDigits(x) || null : x || null;
      if (val !== atual(f)) patch[f.id] = f.id === 'full_name' ? (val ?? c.full_name) : val;
    }
    if (extraMudou) patch.extra_fields = extra;
    // Endereço mudou: a localização antiga deixa de valer (o "Recalcular" refaz).
    if (['address', 'neighborhood', 'city'].some((k) => k in patch)) Object.assign(patch, { lat: null, lng: null, geo_label: null, geo_precision: null });
    onSave(patch as Partial<Candidate>);
  };
  const inputCls = 'w-full h-9 px-3 rounded-lg border border-zinc-200 bg-white text-sm mt-0.5';
  return (
    <div className="mt-2 space-y-2">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {campos.map((f) => {
          const lista = f.id === 'education' ? c.education : f.id === 'experiences' ? c.experiences : null;
          const longo = lista != null;
          return (
            <label key={f.id} className={`block ${longo ? 'sm:col-span-2' : ''}`}>
              <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">{f.label}</span>
              {longo ? (
                <>
                  {lista!.length > 0 && <span className="block text-[10px] text-zinc-400">{lista!.length} já na ficha — escreva só para acrescentar</span>}
                  <textarea value={v[f.id] ?? ''} onChange={(e) => set(f.id, e.target.value)} rows={2}
                    placeholder={f.id === 'education' ? 'Ex.: Ensino médio completo' : 'Ex.: Atendente no Burger X, 1 ano (ou "sem experiência anterior")'}
                    className="w-full px-3 py-2 rounded-lg border border-zinc-200 bg-white text-sm mt-0.5" />
                </>
              ) : (
                <input type={f.id === 'birth_date' ? 'date' : f.id === 'email' ? 'email' : 'text'} value={v[f.id] ?? ''}
                  onChange={(e) => set(f.id, e.target.value)} className={inputCls} />
              )}
            </label>
          );
        })}
      </div>
      <div className="flex justify-end gap-2">
        {onCancel && <button onClick={onCancel} className="px-3 h-8 rounded-lg text-xs font-semibold text-zinc-500 hover:bg-zinc-100 cursor-pointer">Cancelar</button>}
        <button onClick={salvar} className="px-4 h-8 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-white text-xs font-bold cursor-pointer">Salvar dados</button>
      </div>
    </div>
  );
}

// Section: mesmo componente de CandidatoDrawer.tsx:702-709 (pré-Fase 2), duplicado para não fechar
// ciclo de import com o shell (T06) nem criar um 5º arquivo fora do Mapa desta fase.
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-400 mb-2">{title}</p>
      {children}
    </section>
  );
}
