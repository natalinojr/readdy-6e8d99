// Aba Entrevistas da ficha do candidato: lista de entrevistas + registro (leitura do que foi
// respondido no questionário). Bloco movido verbatim de CandidatoDrawer.tsx (pré-Fase 2).
import { useState } from 'react';
import { type Interview, type Settings, decisionOf, withEmpresa, interviewStatusInfo, avgScore, FORMATS, fmtDateTime } from '../../shared';

interface Props {
  interviews: Interview[]; settings: Settings; empresa: string;
  onOpenInterview: (iv: Interview) => void; onAgendar: () => void;
}

export default function FichaEntrevistas({ interviews, settings, empresa, onOpenInterview, onAgendar }: Props) {
  const minhas = [...interviews].sort((a, b) => b.scheduled_at.localeCompare(a.scheduled_at));
  return (
    <Section title="Entrevistas">
      {minhas.length > 0 && (
        <ul className="space-y-1.5 mb-2">
          {minhas.map((iv) => {
            const st = interviewStatusInfo(iv.status);
            const media = avgScore(iv.scores);
            const rec = decisionOf(iv.recommendation);
            return (
              <li key={iv.id}>
                <button onClick={() => onOpenInterview(iv)} className="w-full text-left rounded-xl border border-zinc-200 hover:border-violet-300 p-2.5 cursor-pointer">
                  <div className="flex items-center gap-2">
                    <i className={`${FORMATS.find((f) => f.id === iv.format)?.icon} text-zinc-400`} />
                    <span className="text-sm font-semibold text-zinc-800">{fmtDateTime(iv.scheduled_at)}</span>
                    <span className={`ml-auto text-[10px] font-bold px-2 py-0.5 rounded-full border ${st.cls}`}>{st.label}</span>
                  </div>
                  {(media != null || rec || iv.notes) && (
                    <p className="text-xs text-zinc-500 mt-1 line-clamp-2">
                      {media != null && <b className="text-zinc-700">Nota {media.toFixed(1)} · </b>}
                      {rec && <b className="text-zinc-700">{rec.sigla} · </b>}
                      {iv.notes}
                    </p>
                  )}
                </button>
                <RegistroEntrevista iv={iv} settings={settings} empresa={empresa} />
              </li>
            );
          })}
        </ul>
      )}
      <button onClick={onAgendar} className="flex items-center gap-1.5 px-3 h-8 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-bold cursor-pointer">
        <i className="ri-calendar-event-line" /> Agendar entrevista
      </button>
    </Section>
  );
}

// Registro da entrevista (o que foi escrito no questionário), dentro do card da entrevista na ficha.
function RegistroEntrevista({ iv, settings, empresa }: { iv: Interview; settings: Settings; empresa: string }) {
  const [aberto, setAberto] = useState(false);
  const answers = (iv.answers ?? {}) as Record<string, string>;
  const respondidas = Object.keys(answers).filter((k) => String(answers[k] ?? '').trim());
  const notas = Object.entries(iv.scores ?? {}).filter(([, v]) => typeof v === 'number' && v > 0);
  const dec = decisionOf(iv.recommendation);
  if (!respondidas.length && !iv.notes && !dec && !notas.length) return null;
  // Ordem das perguntas das Configurações; respostas de perguntas apagadas vão no fim.
  const ordem = [...settings.questions.map((q) => q.id).filter((id) => respondidas.includes(id)), ...respondidas.filter((k) => !settings.questions.some((q) => q.id === k))];
  const labelQ = (id: string) => withEmpresa(settings.questions.find((q) => q.id === id)?.label ?? 'Pergunta removida das Configurações', empresa);
  const labelC = (id: string) => settings.criteria.find((q) => q.id === id)?.label ?? id;
  return (
    <div className="mt-1 rounded-xl bg-zinc-50 border border-zinc-100">
      <button onClick={() => setAberto((a) => !a)} className="w-full flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-bold text-zinc-600 cursor-pointer">
        <i className={aberto ? 'ri-arrow-down-s-line' : 'ri-arrow-right-s-line'} /> Registro da entrevista
        <span className="font-normal text-zinc-400">
          {[respondidas.length ? `${respondidas.length} resposta${respondidas.length > 1 ? 's' : ''}` : null, dec?.sigla].filter(Boolean).join(' · ')}
        </span>
      </button>
      {aberto && (
        <div className="px-3 pb-3 space-y-2.5">
          {ordem.map((id) => (
            <div key={id}>
              <p className="text-[11px] font-semibold text-zinc-500">{labelQ(id)}</p>
              <p className="text-sm text-zinc-800 whitespace-pre-wrap">{answers[id]}</p>
            </div>
          ))}
          {notas.length > 0 && (
            <div>
              <p className="text-[11px] font-semibold text-zinc-500">Avaliação</p>
              <div className="flex flex-wrap gap-1.5 mt-0.5">
                {notas.map(([k, v]) => <span key={k} className="text-xs px-2 py-0.5 rounded-full bg-white border border-zinc-200">{labelC(k)}: <b>{v}</b>/5</span>)}
              </div>
            </div>
          )}
          {iv.notes && (
            <div>
              <p className="text-[11px] font-semibold text-zinc-500">Considerações adicionais</p>
              <p className="text-sm text-zinc-800 whitespace-pre-wrap">{iv.notes}</p>
            </div>
          )}
          {dec && (
            <p className="text-xs text-zinc-700 flex items-center gap-2">
              <span className={`font-black px-2 py-0.5 rounded border ${dec.cls}`}>{dec.sigla}</span> {withEmpresa(dec.label, empresa)}
            </p>
          )}
        </div>
      )}
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
