// Calendário mensal das entrevistas + listas "próximas" e "aguardando registro".
import { useMemo, useState } from 'react';
import {
  type Candidate, type Interview, type Loja, interviewStatusInfo, fmtTime, fmtDateTime, dayKey, lojaNome, firstName,
} from '../shared';

interface Props {
  interviews: Interview[];
  candidates: Candidate[];
  lojas: Loja[];
  mostrarLoja: boolean;
  onOpenInterview: (iv: Interview) => void;
  onNew: (date: string | null) => void;
}

const WEEK = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

export default function AgendaEntrevistas({ interviews, candidates, lojas, mostrarLoja, onOpenInterview, onNew }: Props) {
  const [cursor, setCursor] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const byId = useMemo(() => new Map(candidates.map((c) => [c.id, c])), [candidates]);
  const nome = (iv: Interview) => byId.get(iv.candidate_id)?.full_name ?? 'Candidato removido';

  const byDay = useMemo(() => {
    const m = new Map<string, Interview[]>();
    for (const iv of interviews) {
      const k = dayKey(new Date(iv.scheduled_at));
      m.set(k, [...(m.get(k) ?? []), iv]);
    }
    for (const list of m.values()) list.sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at));
    return m;
  }, [interviews]);

  const cells = useMemo(() => {
    const start = new Date(cursor);
    start.setDate(1 - start.getDay());
    return Array.from({ length: 42 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d; });
  }, [cursor]);

  const now = new Date();
  const hoje = dayKey(now);
  const proximas = interviews.filter((iv) => iv.status === 'agendada' && new Date(iv.scheduled_at) >= now)
    .sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at)).slice(0, 8);
  const pendentes = interviews.filter((iv) => iv.status === 'agendada' && new Date(iv.scheduled_at) < now)
    .sort((a, b) => b.scheduled_at.localeCompare(a.scheduled_at));

  const mesLabel = cursor.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr,280px] gap-4">
      <div className="rounded-2xl border border-zinc-200 bg-white overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-zinc-100">
          <button onClick={() => setCursor((c) => new Date(c.getFullYear(), c.getMonth() - 1, 1))} className="w-8 h-8 rounded-lg hover:bg-zinc-100 cursor-pointer"><i className="ri-arrow-left-s-line" /></button>
          <p className="font-black text-zinc-900 capitalize min-w-[150px] text-center">{mesLabel}</p>
          <button onClick={() => setCursor((c) => new Date(c.getFullYear(), c.getMonth() + 1, 1))} className="w-8 h-8 rounded-lg hover:bg-zinc-100 cursor-pointer"><i className="ri-arrow-right-s-line" /></button>
          <button onClick={() => { const d = new Date(); setCursor(new Date(d.getFullYear(), d.getMonth(), 1)); }} className="px-3 h-8 rounded-lg border border-zinc-200 text-xs font-bold text-zinc-600 cursor-pointer">Hoje</button>
          <button onClick={() => onNew(null)} className="ml-auto flex items-center gap-1.5 px-3 h-8 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-bold cursor-pointer">
            <i className="ri-add-line" /> Agendar
          </button>
        </div>
        <div className="grid grid-cols-7 border-b border-zinc-100 bg-zinc-50">
          {WEEK.map((w) => <div key={w} className="px-2 py-1.5 text-[10px] font-bold uppercase text-zinc-400 text-center">{w}</div>)}
        </div>
        <div className="grid grid-cols-7">
          {cells.map((d) => {
            const k = dayKey(d);
            const list = byDay.get(k) ?? [];
            const fora = d.getMonth() !== cursor.getMonth();
            return (
              <div key={k} onClick={() => onNew(k)}
                className={`min-h-[92px] border-b border-r border-zinc-100 p-1 cursor-pointer hover:bg-violet-50/40 ${fora ? 'bg-zinc-50/60' : ''}`}>
                <p className={`text-[11px] font-bold mb-0.5 w-6 h-6 flex items-center justify-center rounded-full ${
                  k === hoje ? 'bg-violet-600 text-white' : fora ? 'text-zinc-300' : 'text-zinc-600'}`}>{d.getDate()}</p>
                <div className="space-y-0.5">
                  {list.slice(0, 3).map((iv) => (
                    <button key={iv.id} onClick={(e) => { e.stopPropagation(); onOpenInterview(iv); }}
                      className={`w-full text-left truncate text-[10px] font-semibold px-1.5 py-0.5 rounded border cursor-pointer ${interviewStatusInfo(iv.status).cls}`}>
                      {fmtTime(iv.scheduled_at)} {firstName(nome(iv))}
                    </button>
                  ))}
                  {list.length > 3 && <p className="text-[10px] text-zinc-400 px-1">+{list.length - 3}</p>}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="space-y-4">
        {pendentes.length > 0 && (
          <Lista titulo="Aguardando registro" cor="text-orange-600" vazia="" itens={pendentes} nome={nome}
            extra={(iv) => mostrarLoja ? lojaNome(lojas, iv.tenant_id) : null} onOpen={onOpenInterview} />
        )}
        <Lista titulo="Próximas entrevistas" cor="text-violet-600" vazia="Nenhuma entrevista agendada." itens={proximas} nome={nome}
          extra={(iv) => mostrarLoja ? lojaNome(lojas, iv.tenant_id) : null} onOpen={onOpenInterview} />
        <div className="flex flex-wrap gap-1.5">
          {(['agendada', 'realizada', 'faltou', 'cancelada'] as const).map((s) => (
            <span key={s} className={`text-[10px] font-semibold px-2 py-0.5 rounded border ${interviewStatusInfo(s).cls}`}>{interviewStatusInfo(s).label}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

function Lista({ titulo, cor, vazia, itens, nome, extra, onOpen }: {
  titulo: string; cor: string; vazia: string; itens: Interview[];
  nome: (iv: Interview) => string; extra: (iv: Interview) => string | null; onOpen: (iv: Interview) => void;
}) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white">
      <p className={`px-4 py-2.5 border-b border-zinc-100 text-xs font-black uppercase tracking-wider ${cor}`}>{titulo} {itens.length > 0 && <span className="text-zinc-400">{itens.length}</span>}</p>
      {itens.length === 0 ? <p className="px-4 py-4 text-xs text-zinc-400">{vazia}</p> : (
        <ul className="divide-y divide-zinc-50">
          {itens.map((iv) => (
            <li key={iv.id}>
              <button onClick={() => onOpen(iv)} className="w-full text-left px-4 py-2 hover:bg-zinc-50 cursor-pointer">
                <p className="text-sm font-semibold text-zinc-800 truncate">{nome(iv)}</p>
                <p className="text-[11px] text-zinc-500">{fmtDateTime(iv.scheduled_at)}{extra(iv) ? ` · ${extra(iv)}` : ''}</p>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
