// Aba Histórico da ficha do candidato: linha do tempo de hiring_candidate_events + anotação manual.
// Bloco movido verbatim de CandidatoDrawer.tsx (pré-Fase 2).
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { type Application, type Candidate, type CandidateEvent, type Interview } from '../../shared';
import { avisar } from '../../dialog';

interface Props { c: Candidate; applications: Application[]; interviews: Interview[] }

// EV_STYLE/quemFez/quando: mesmos de CandidatoDrawer.tsx:493-507 (pré-Fase 2), movidos em T05.
const EV_STYLE: Record<string, { icon: string; cls: string }> = {
  criado: { icon: 'ri-file-user-line', cls: 'bg-sky-100 text-sky-700' },
  fase: { icon: 'ri-git-commit-line', cls: 'bg-indigo-100 text-indigo-700' },
  decisao: { icon: 'ri-scales-3-line', cls: 'bg-emerald-100 text-emerald-700' },
  loja: { icon: 'ri-store-2-line', cls: 'bg-zinc-100 text-zinc-600' },
  avaliacao: { icon: 'ri-star-line', cls: 'bg-amber-100 text-amber-700' },
  ficha: { icon: 'ri-checkbox-circle-line', cls: 'bg-teal-100 text-teal-700' },
  ia: { icon: 'ri-robot-2-line', cls: 'bg-violet-100 text-violet-700' },
  vaga: { icon: 'ri-briefcase-4-line', cls: 'bg-rose-100 text-rose-700' },
  entrevista: { icon: 'ri-calendar-event-line', cls: 'bg-violet-100 text-violet-700' },
  registro: { icon: 'ri-file-list-3-line', cls: 'bg-emerald-100 text-emerald-700' },
  anotacao: { icon: 'ri-sticky-note-line', cls: 'bg-yellow-100 text-yellow-800' },
};
const quemFez = (a: string | null) => (!a || a === 'sistema' ? 'sistema' : a === 'assistente' ? 'assistente (WhatsApp/IA)' : a.split('@')[0]);
const quando = (iso: string) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });

export default function FichaHistorico({ c, applications, interviews }: Props) {
  const refreshKey = [c.stage_id, c.decision, c.rating, c.company_id, applications.length,
    ...interviews.map((iv) => `${iv.status}|${iv.scheduled_at}|${iv.recommendation}|${Object.keys(iv.answers ?? {}).length}`)].join('~');
  return <HistoricoCandidato c={c} refreshKey={refreshKey} />;
}

function HistoricoCandidato({ c, refreshKey }: { c: Candidate; refreshKey: string }) {
  const [evs, setEvs] = useState<CandidateEvent[] | null>(null);
  const [todos, setTodos] = useState(false);
  const [nota, setNota] = useState('');
  const [salvando, setSalvando] = useState(false);
  const carregar = useCallback(async () => {
    const { data } = await supabase.from('hiring_candidate_events').select('*').eq('candidate_id', c.id)
      .order('at', { ascending: false }).order('id', { ascending: false }).limit(300);
    setEvs((data ?? []) as CandidateEvent[]);
  }, [c.id]);
  useEffect(() => { setTodos(false); setNota(''); }, [c.id]);
  // Gatilhos gravam logo depois de cada mudança: recarrega quando a ficha muda.
  useEffect(() => { const t = setTimeout(carregar, 400); return () => clearTimeout(t); }, [carregar, refreshKey]);

  const registrar = async () => {
    const t = nota.trim();
    if (!t) return;
    setSalvando(true);
    const { data: u } = await supabase.auth.getUser();
    const { error } = await supabase.from('hiring_candidate_events').insert({ candidate_id: c.id, kind: 'anotacao', title: 'Anotação', detail: t, actor: u.user?.email ?? null });
    setSalvando(false);
    if (error) { avisar(`Não foi possível registrar: ${error.message}`); return; }
    setNota('');
    carregar();
  };
  const apagar = async (ev: CandidateEvent) => {
    const { error } = await supabase.from('hiring_candidate_events').delete().eq('id', ev.id);
    if (error) { avisar(`Não foi possível apagar: ${error.message}`); return; }
    carregar();
  };

  const lista = todos ? evs ?? [] : (evs ?? []).slice(0, 8);
  return (
    <Section title={`Histórico do candidato${evs?.length ? ` · ${evs.length}` : ''}`}>
      <div className="flex gap-2 mb-3">
        <input value={nota} onChange={(e) => setNota(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && registrar()}
          placeholder="Registrar algo no histórico (ligação, referência, recado…)"
          className="flex-1 min-w-0 h-9 px-3 rounded-lg border border-zinc-200 text-sm focus:outline-none focus:border-rose-300" />
        <button onClick={registrar} disabled={salvando || !nota.trim()}
          className="px-3 h-9 rounded-lg bg-zinc-900 hover:bg-zinc-800 disabled:opacity-40 text-white text-xs font-bold cursor-pointer whitespace-nowrap">
          {salvando ? 'Salvando…' : 'Registrar'}
        </button>
      </div>
      {evs === null ? <p className="text-xs text-zinc-400">Carregando…</p> : evs.length === 0 ? <p className="text-xs text-zinc-400">Nada registrado ainda.</p> : (
        <ol className="relative border-l-2 border-zinc-100 ml-3 space-y-3">
          {lista.map((ev) => {
            const st = EV_STYLE[ev.kind] ?? EV_STYLE.loja;
            return (
              <li key={ev.id} className="relative pl-5 group">
                <span className={`absolute -left-[13px] top-0 w-6 h-6 rounded-full flex items-center justify-center text-xs ${st.cls}`}><i className={st.icon} /></span>
                <div className="flex items-start gap-2">
                  <p className="flex-1 text-sm font-semibold text-zinc-800">{ev.title}</p>
                  {ev.kind === 'anotacao' && (
                    <button onClick={() => apagar(ev)} title="Apagar anotação" className="opacity-0 group-hover:opacity-100 text-zinc-400 hover:text-red-500 cursor-pointer"><i className="ri-close-line" /></button>
                  )}
                </div>
                {ev.detail && <p className={`text-xs mt-0.5 whitespace-pre-wrap ${ev.kind === 'anotacao' ? 'text-zinc-800' : 'text-zinc-500'}`}>{ev.detail}</p>}
                <p className="text-[10px] text-zinc-400 mt-0.5">{quando(ev.at)} · {quemFez(ev.actor)}</p>
              </li>
            );
          })}
        </ol>
      )}
      {(evs?.length ?? 0) > 8 && (
        <button onClick={() => setTodos((v) => !v)} className="mt-2 text-xs font-semibold text-sky-700 cursor-pointer">
          {todos ? 'Mostrar só os últimos' : `Ver tudo (${evs!.length})`}
        </button>
      )}
    </Section>
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
