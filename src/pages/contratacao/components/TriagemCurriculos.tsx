// Triagem de currículos novos (2026-09-30): um por vez, decide em 1 clique.
//  • Chamar p/ entrevista → fase nativa "agendar" (a IA convida pelo WhatsApp quando a vaga tem o
//    agendamento ligado; senão a pessoa fica nessa fase esperando alguém agendar) ou "Agendar eu mesmo".
//  • Guardar → decisão R (quadro de reserva), continua no banco e sai da triagem.
//  • Descartar → fase nativa "descartado".
//  • Pular → vai para o fim da pilha só nesta sessão.
// A fila vem pronta (fila.ts › triar). A ordem aqui: melhor nota da IA primeiro, depois o mais novo.
import { useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import {
  type Application, type Candidate, type Company, type Distance, type FichaCfg, type Job, type Stage,
  BUCKET, FIT, ageOf, avisoIdade, companyName, faltasFicha, fitOf, fmtKm, distCls, stageByKind, fmtDate,
} from '../shared';
import { avisar } from '../dialog';

interface Props {
  fila: Candidate[];
  stages: Stage[]; companies: Company[]; jobs: Job[]; applications: Application[]; ficha: FichaCfg;
  distancia: (c: Candidate) => Distance | null;
  /** false = não gravou (ex.: recusou mover com ficha incompleta). */
  onUpdate: (id: string, patch: Partial<Candidate>) => Promise<boolean>;
  onAgendar: (candidateId: string) => void;
  onOpenFicha: (candidateId: string) => void;
  onClose: () => void;
}

type Feito = { id: string; nome: string; antes: Pick<Candidate, 'stage_id' | 'decision'>; acao: string };

export default function TriagemCurriculos({ fila, stages, companies, jobs, applications, ficha, distancia, onUpdate, onAgendar, onOpenFicha, onClose }: Props) {
  const appsDe = useMemo(() => {
    const m = new Map<string, Application[]>();
    for (const a of applications) m.set(a.candidate_id, [...(m.get(a.candidate_id) ?? []), a]);
    return m;
  }, [applications]);
  const melhor = (c: Candidate) => Math.max(-1, ...(appsDe.get(c.id) ?? []).map((a) => a.score ?? -1));
  // A ordem é fixada ao abrir (a lista não pode pular enquanto a pessoa decide).
  const [ordem] = useState(() => [...fila].sort((a, b) => melhor(b) - melhor(a) || b.created_at.localeCompare(a.created_at)).map((c) => c.id));
  const [pulados, setPulados] = useState<string[]>([]);
  const [feitos, setFeitos] = useState<Feito[]>([]);
  const [busy, setBusy] = useState(false);
  const total = ordem.length;

  const porId = new Map(fila.map((c) => [c.id, c]));
  const decididos = new Set(feitos.map((f) => f.id));
  // Ainda na fila: não decidido aqui e ainda na triagem (pode ter saído por fora, ex.: realtime).
  const restantes = [...ordem.filter((id) => !pulados.includes(id)), ...pulados].filter((id) => !decididos.has(id) && porId.has(id));
  const c = restantes.length ? porId.get(restantes[0])! : null;

  const agendarStage = stageByKind(stages, 'agendar');
  const descartadoStage = stageByKind(stages, 'descartado');

  const agir = async (acao: 'chamar' | 'guardar' | 'descartar') => {
    if (!c || busy) return;
    const patch: Partial<Candidate> = acao === 'chamar' ? { stage_id: agendarStage?.id }
      : acao === 'descartar' ? { stage_id: descartadoStage?.id } : { decision: 'r' };
    if ((acao === 'chamar' && !agendarStage) || (acao === 'descartar' && !descartadoStage)) { avisar('Fase nativa não encontrada em Configurações › Fases.'); return; }
    setBusy(true);
    const gravou = await onUpdate(c.id, patch);
    setBusy(false);
    if (!gravou) return;
    setPulados((p) => p.filter((x) => x !== c.id));
    setFeitos((f) => [...f, { id: c.id, nome: c.full_name.split(' ')[0], antes: { stage_id: c.stage_id, decision: c.decision }, acao }]);
  };
  const desfazer = async () => {
    const ult = feitos[feitos.length - 1];
    if (!ult || busy) return;
    setBusy(true);
    await onUpdate(ult.id, ult.antes);
    setBusy(false);
    setFeitos((f) => f.slice(0, -1));
  };
  const pular = () => { if (c) setPulados((p) => [...p.filter((x) => x !== c.id), c.id]); };

  const verCurriculo = async (cand: Candidate) => {
    if (!cand.file_path) return;
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(cand.file_path, 300);
    if (error || !data?.signedUrl) { avisar('Não foi possível abrir o currículo.'); return; }
    window.open(data.signedUrl, '_blank', 'noopener');
  };

  const ult = feitos[feitos.length - 1];
  const rotuloAcao: Record<string, string> = { chamar: 'chamado para entrevista', guardar: 'guardado (reserva)', descartar: 'descartado' };

  return (
    <div className="fixed inset-0 z-[55] bg-zinc-50 flex flex-col">
      <div className="bg-white border-b border-zinc-200 px-4 py-3 flex items-center gap-3">
        <i className="ri-inbox-2-line text-xl text-zinc-600" />
        <div className="flex-1 min-w-0">
          <p className="font-black text-zinc-900">Triagem de currículos</p>
          <div className="flex items-center gap-2 mt-1">
            <div className="flex-1 max-w-xs h-1.5 bg-zinc-200 rounded-full overflow-hidden">
              <div className="h-full bg-zinc-900 transition-all" style={{ width: `${total ? (feitos.length / total) * 100 : 100}%` }} />
            </div>
            <span className="text-[11px] font-bold text-zinc-500">{feitos.length} de {total}</span>
          </div>
        </div>
        <button onClick={onClose} className="px-3 h-9 rounded-lg border border-zinc-200 text-sm font-semibold text-zinc-700 hover:bg-zinc-50 cursor-pointer">Fechar</button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 sm:p-6">
        <div className="max-w-2xl mx-auto">
          {ult && (
            <div className="mb-3 flex items-center gap-2 text-xs text-zinc-600 bg-white border border-zinc-200 rounded-xl px-3 py-2">
              <i className="ri-check-line text-emerald-600" /> <span className="flex-1"><b>{ult.nome}</b> {rotuloAcao[ult.acao]}.</span>
              <button onClick={desfazer} disabled={busy} className="font-bold text-violet-700 disabled:opacity-40 cursor-pointer">Desfazer</button>
            </div>
          )}

          {!c ? (
            <div className="text-center py-16">
              <i className="ri-checkbox-circle-line text-5xl text-emerald-500" />
              <h2 className="text-xl font-black text-zinc-900 mt-2">Triagem concluída</h2>
              <p className="text-sm text-zinc-500 mt-1">Quem você chamou já está com a IA (ou na fase "{agendarStage?.name ?? 'Chamar p/ entrevista'}").</p>
              <button onClick={onClose} className="mt-5 px-4 h-10 rounded-lg bg-zinc-900 text-white text-sm font-bold cursor-pointer">Voltar para a fila</button>
            </div>
          ) : (() => {
            const idade = ageOf(c);
            const aviso = avisoIdade(idade);
            const dist = distancia(c);
            const faltam = faltasFicha(c, ficha);
            const apps = (appsDe.get(c.id) ?? []).slice().sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
            return (
              <article key={c.id} className="rounded-2xl bg-white border border-zinc-200 shadow-sm overflow-hidden">
                <div className="p-5 flex gap-4 items-start">
                  <div className="w-14 h-14 rounded-full bg-rose-100 text-rose-700 text-xl font-black flex items-center justify-center flex-shrink-0">
                    {(c.full_name || '?').charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h2 className="text-xl font-black text-zinc-900">{c.full_name}</h2>
                    <p className="text-sm text-zinc-500">
                      {[c.desired_role, idade != null ? `${idade} anos` : null, [c.neighborhood, c.city].filter(Boolean).join(', ') || null].filter(Boolean).join(' · ') || '—'}
                    </p>
                    <div className="flex flex-wrap gap-1.5 mt-1.5">
                      {aviso && <span title={aviso.dica} className={`text-[10px] font-bold px-2 py-0.5 rounded border ${aviso.cls}`}>{aviso.texto}</span>}
                      {dist && <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${distCls(dist.km)}`}><i className="ri-car-line" /> {fmtKm(dist.km)}{dist.minutes != null ? ` · ${dist.minutes} min` : ''}</span>}
                      {c.company_id && <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full border bg-zinc-50 text-zinc-600 border-zinc-200"><i className="ri-building-line" /> {companyName(companies, c.company_id)}</span>}
                      <span className="text-[10px] text-zinc-400 self-center">recebido {fmtDate(c.created_at)}</span>
                    </div>
                  </div>
                </div>

                <div className="px-5 pb-4 space-y-3">
                  {apps.map((a) => {
                    const job = jobs.find((j) => j.id === a.job_id);
                    const fit = a.fit ?? fitOf(a.score);
                    return (
                      <div key={a.id} className="rounded-xl border border-zinc-200 p-3">
                        <p className="text-sm">
                          <i className="ri-briefcase-4-line text-zinc-400" /> <b>{job?.title ?? 'Vaga removida'}</b>
                          {a.score != null && <> · <b>{a.score}</b><span className="text-[10px] text-zinc-400">/100</span></>}
                          {fit && <span className={`ml-2 text-[10px] font-bold px-2 py-0.5 rounded-full border ${FIT[fit].cls}`}>{FIT[fit].label}</span>}
                        </p>
                        {a.analysis?.resumo && <p className="text-xs text-zinc-600 mt-1">{a.analysis.resumo}</p>}
                      </div>
                    );
                  })}
                  {c.summary && <p className="text-sm text-zinc-700 leading-relaxed">{c.summary}</p>}
                  {!c.summary && !c.ai_processed && <p className="text-xs text-zinc-400">Leitura simples do currículo (sem resumo da IA). Abra a ficha para organizar com IA.</p>}
                  {(c.strengths.length > 0 || c.concerns.length > 0) && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                      {c.strengths.length > 0 && <div className="rounded-lg bg-emerald-50 border border-emerald-100 p-2.5 text-emerald-900"><b>Fortes:</b> {c.strengths.slice(0, 4).join(' · ')}</div>}
                      {c.concerns.length > 0 && <div className="rounded-lg bg-orange-50 border border-orange-100 p-2.5 text-orange-900"><b>Atenção:</b> {c.concerns.slice(0, 4).join(' · ')}</div>}
                    </div>
                  )}
                  {c.experiences.length > 0 && (
                    <ul className="text-xs text-zinc-700 space-y-0.5">
                      {c.experiences.slice(0, 3).map((e, i) => <li key={i}>• {[e.cargo, e.empresa].filter(Boolean).join(' — ') || e.descricao}</li>)}
                    </ul>
                  )}
                  {faltam.length > 0 && (
                    <p className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                      <i className="ri-error-warning-line" /> Faltam: {faltam.map((f) => f.label.toLowerCase()).join(', ')}.
                      {c.source?.startsWith('whatsapp_link') ? ' O atendente do WhatsApp está perguntando.' : ' Ao chamar, o sistema pergunta se move mesmo assim.'}
                    </p>
                  )}
                  <div className="flex flex-wrap gap-3 text-xs font-semibold">
                    <button onClick={() => onOpenFicha(c.id)} className="text-violet-700 cursor-pointer"><i className="ri-user-line" /> Ficha completa</button>
                    {c.file_path && <button onClick={() => verCurriculo(c)} className="text-violet-700 cursor-pointer"><i className="ri-file-text-line" /> Currículo original</button>}
                    <button onClick={() => onAgendar(c.id)} className="text-violet-700 cursor-pointer"><i className="ri-calendar-event-line" /> Agendar eu mesmo</button>
                    <button onClick={pular} className="ml-auto text-zinc-500 hover:text-zinc-800 cursor-pointer">Pular <i className="ri-skip-forward-line" /></button>
                  </div>
                </div>

                <div className="grid grid-cols-3 border-t border-zinc-100">
                  <button onClick={() => agir('descartar')} disabled={busy}
                    className="h-16 text-sm font-bold text-zinc-600 hover:bg-zinc-50 disabled:opacity-50 flex flex-col items-center justify-center cursor-pointer">
                    <i className="ri-close-circle-line text-xl" /> Descartar
                  </button>
                  <button onClick={() => agir('guardar')} disabled={busy}
                    className="h-16 text-sm font-bold text-amber-700 hover:bg-amber-50 border-x border-zinc-100 disabled:opacity-50 flex flex-col items-center justify-center cursor-pointer">
                    <i className="ri-archive-line text-xl" /> Guardar
                  </button>
                  <button onClick={() => agir('chamar')} disabled={busy}
                    className="h-16 text-sm font-bold text-white bg-violet-600 hover:bg-violet-500 disabled:opacity-50 flex flex-col items-center justify-center cursor-pointer">
                    <i className="ri-chat-smile-2-line text-xl" /> Chamar p/ entrevista
                  </button>
                </div>
              </article>
            );
          })()}
          {c && (
            <p className="text-center text-[11px] text-zinc-400 mt-3 px-4">
              "Chamar" põe a pessoa em "{agendarStage?.name ?? 'Chamar p/ entrevista'}": a IA convida pelo WhatsApp quando a vaga tem o agendamento ligado.
              "Guardar" marca R (quadro de reserva) e mantém no banco.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
