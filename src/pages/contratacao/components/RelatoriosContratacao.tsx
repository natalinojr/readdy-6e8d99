// Relatórios da contratação: funil por fase, entradas por semana, cargos, bairros,
// comparecimento, média da ficha por critério, quadro por empresa e ranking.
import { useMemo } from 'react';
import {
  type Candidate, type Company, type Interview, type Settings, type Stage, RECOMMENDATIONS, avgScore, companyName, norm, colorOf, stageOf,
} from '../shared';

interface Props {
  candidates: Candidate[];
  interviews: Interview[];
  companies: Company[];
  stages: Stage[];
  settings: Settings;
  mostrarEmpresa: boolean;
  onOpen: (id: string) => void;
}

const titleCase = (s: string) => s.toLowerCase().replace(/(^|\s)(\p{L})/gu, (_m, sp, l) => sp + l.toUpperCase());

function topCounts(values: (string | null)[], n = 8) {
  const m = new Map<string, { label: string; count: number }>();
  for (const v of values) {
    const raw = (v ?? '').trim();
    if (!raw) continue;
    const k = norm(raw);
    const cur = m.get(k);
    if (cur) cur.count++; else m.set(k, { label: titleCase(raw), count: 1 });
  }
  return [...m.values()].sort((a, b) => b.count - a.count).slice(0, n);
}

export default function RelatoriosContratacao({ candidates, interviews, companies, stages, settings, mostrarEmpresa, onOpen }: Props) {
  const r = useMemo(() => {
    const ids = new Set(candidates.map((c) => c.id));
    const ivs = interviews.filter((iv) => ids.has(iv.candidate_id));
    const faseDe = (c: Candidate) => stageOf(stages, c.stage_id)?.id ?? null;
    const now = Date.now();
    const d7 = now - 7 * 864e5;
    const total = candidates.length;
    const novos7 = candidates.filter((c) => new Date(c.created_at).getTime() >= d7).length;
    const porFase = stages.map((s) => ({ ...s, count: candidates.filter((c) => faseDe(c) === s.id).length }));
    const realizadas = ivs.filter((i) => i.status === 'realizada').length;
    const faltas = ivs.filter((i) => i.status === 'faltou').length;
    const agendadasFuturas = ivs.filter((i) => i.status === 'agendada' && new Date(i.scheduled_at).getTime() >= now).length;
    const comparecimento = realizadas + faltas ? realizadas / (realizadas + faltas) : null;
    const aprovadoId = stages.find((s) => s.native_kind === 'aprovado')?.id;
    const descartadoId = stages.find((s) => s.native_kind === 'descartado')?.id;
    const aprovados = candidates.filter((c) => faseDe(c) === aprovadoId).length;

    // Entradas por semana (últimas 8, semana começando no domingo).
    const semanas: { label: string; count: number }[] = [];
    const inicio = new Date(); inicio.setHours(0, 0, 0, 0); inicio.setDate(inicio.getDate() - inicio.getDay());
    for (let i = 7; i >= 0; i--) {
      const a = new Date(inicio); a.setDate(a.getDate() - i * 7);
      const b = new Date(a); b.setDate(b.getDate() + 7);
      semanas.push({
        label: a.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }),
        count: candidates.filter((c) => { const t = new Date(c.created_at); return t >= a && t < b; }).length,
      });
    }

    const realizadasList = ivs.filter((i) => i.status === 'realizada');
    const criterios = settings.criteria.map((cr) => {
      const vals = realizadasList.map((i) => i.scores?.[cr.id]).filter((v): v is number => typeof v === 'number' && v > 0);
      return { ...cr, media: vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null };
    });
    const recs = RECOMMENDATIONS.map((rc) => ({ ...rc, count: realizadasList.filter((i) => i.recommendation === rc.id).length }));

    // Ranking: melhor média da ficha (última entrevista realizada) ou estrelas; sem descartados.
    const ultima = new Map<string, Interview>();
    for (const i of realizadasList) {
      const cur = ultima.get(i.candidate_id);
      if (!cur || i.scheduled_at > cur.scheduled_at) ultima.set(i.candidate_id, i);
    }
    const ranking = candidates
      .filter((c) => faseDe(c) !== descartadoId)
      .map((c) => ({ c, media: avgScore(ultima.get(c.id)?.scores), rec: ultima.get(c.id)?.recommendation ?? null }))
      .filter((x) => x.media != null || x.c.rating)
      .sort((a, b) => (b.media ?? (b.c.rating ?? 0)) - (a.media ?? (a.c.rating ?? 0)))
      .slice(0, 10);

    const porEmpresa = mostrarEmpresa
      ? [...new Set(candidates.map((c) => c.company_id))].map((cid) => ({
          nome: companyName(companies, cid),
          counts: stages.map((s) => candidates.filter((c) => c.company_id === cid && faseDe(c) === s.id).length),
          total: candidates.filter((c) => c.company_id === cid).length,
        })).sort((a, b) => b.total - a.total)
      : [];

    return {
      total, novos7, porFase, realizadas, faltas, agendadasFuturas, comparecimento, aprovados, semanas,
      criterios, recs, ranking, porEmpresa,
      cargos: topCounts(candidates.map((c) => c.desired_role)),
      locais: topCounts(candidates.map((c) => c.neighborhood || c.city)),
    };
  }, [candidates, interviews, companies, stages, settings, mostrarEmpresa]);

  if (r.total === 0) return <p className="py-16 text-center text-sm text-zinc-400">Sem candidatos no filtro atual.</p>;

  const maxSemana = Math.max(1, ...r.semanas.map((s) => s.count));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Kpi label="Candidatos" value={r.total} />
        <Kpi label="Recebidos em 7 dias" value={r.novos7} />
        <Kpi label="Entrevistas marcadas" value={r.agendadasFuturas} />
        <Kpi label="Comparecimento" value={r.comparecimento != null ? `${Math.round(r.comparecimento * 100)}%` : '—'}
          hint={r.realizadas + r.faltas ? `${r.realizadas} vieram, ${r.faltas} faltaram` : 'sem entrevistas registradas'} />
        <Kpi label="Aprovados" value={r.aprovados} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card titulo="Funil por fase">
          <div className="space-y-2">
            {r.porFase.map((s) => <Bar key={s.id} label={s.name} count={s.count} total={r.total} cls={colorOf(s.color).bar} />)}
          </div>
        </Card>

        <Card titulo="Currículos recebidos por semana">
          <div className="flex items-end gap-2 h-36">
            {r.semanas.map((s) => (
              <div key={s.label} className="flex-1 flex flex-col items-center justify-end h-full">
                <span className="text-[10px] font-bold text-zinc-600 mb-0.5">{s.count || ''}</span>
                <div className="w-full rounded-t bg-rose-400" style={{ height: `${(s.count / maxSemana) * 100}%`, minHeight: s.count ? 3 : 0 }} />
                <span className="text-[9px] text-zinc-400 mt-1">{s.label}</span>
              </div>
            ))}
          </div>
        </Card>

        <Card titulo="Cargos mais procurados">
          {r.cargos.length === 0 ? <Vazio /> : <div className="space-y-2">{r.cargos.map((x) => <Bar key={x.label} label={x.label} count={x.count} total={r.total} cls="bg-violet-400" />)}</div>}
        </Card>

        <Card titulo="De onde vêm (bairro ou cidade)">
          {r.locais.length === 0 ? <Vazio /> : <div className="space-y-2">{r.locais.map((x) => <Bar key={x.label} label={x.label} count={x.count} total={r.total} cls="bg-sky-400" />)}</div>}
        </Card>

        <Card titulo="Entrevistas realizadas: média por critério">
          {r.realizadas === 0 ? <Vazio texto="Registre entrevistas com a ficha para ver as médias." /> : (
            <>
              <div className="space-y-2">
                {r.criterios.map((cr) => (
                  <div key={cr.id} className="flex items-center gap-2 text-sm">
                    <span className="flex-1 text-zinc-700">{cr.label}</span>
                    <div className="w-28 h-2 rounded-full bg-zinc-100 overflow-hidden"><div className="h-full bg-amber-400" style={{ width: `${((cr.media ?? 0) / 5) * 100}%` }} /></div>
                    <span className="w-8 text-right text-xs font-bold text-zinc-700">{cr.media != null ? cr.media.toFixed(1) : '—'}</span>
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap gap-2 mt-3">
                {r.recs.map((rc) => <span key={rc.id} className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${rc.cls}`}>{rc.label}: {rc.count}</span>)}
              </div>
            </>
          )}
        </Card>

        {r.porEmpresa.length > 1 && (
          <Card titulo="Por empresa">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-[10px] uppercase tracking-wider text-zinc-400">
                  <th className="text-left py-1.5 pr-3">Empresa</th>
                  {stages.map((s) => <th key={s.id} className="text-right py-1.5 px-2 whitespace-nowrap">{s.name}</th>)}
                  <th className="text-right py-1.5 pl-2">Total</th>
                </tr></thead>
                <tbody className="divide-y divide-zinc-100">
                  {r.porEmpresa.map((l) => (
                    <tr key={l.nome}>
                      <td className="py-1.5 pr-3 font-semibold text-zinc-800 whitespace-nowrap">{l.nome}</td>
                      {l.counts.map((n, i) => <td key={i} className="text-right py-1.5 px-2 tabular-nums text-zinc-600">{n || '·'}</td>)}
                      <td className="text-right py-1.5 pl-2 font-bold tabular-nums">{l.total}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>

      <Card titulo="Mais bem avaliados (fora os descartados)">
        {r.ranking.length === 0 ? <Vazio texto="Dê estrelas ou registre entrevistas para montar o ranking." /> : (
          <ol className="divide-y divide-zinc-100">
            {r.ranking.map(({ c, media, rec }, i) => {
              const st = stageOf(stages, c.stage_id);
              const recInfo = RECOMMENDATIONS.find((x) => x.id === rec);
              return (
                <li key={c.id}>
                  <button onClick={() => onOpen(c.id)} className="w-full flex items-center gap-3 py-2 text-left hover:bg-zinc-50 rounded-lg px-2 cursor-pointer">
                    <span className="w-5 text-xs font-black text-zinc-400">{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-zinc-900 truncate">{c.full_name}</p>
                      <p className="text-[11px] text-zinc-500 truncate">{[c.desired_role, mostrarEmpresa ? companyName(companies, c.company_id) : null].filter(Boolean).join(' · ')}</p>
                    </div>
                    {recInfo && <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${recInfo.cls}`}>{recInfo.label}</span>}
                    {st && <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${colorOf(st.color).cls}`}>{st.name}</span>}
                    <span className="w-16 text-right text-xs">
                      {media != null ? <b className="text-zinc-800">{media.toFixed(1)}</b> : null}
                      {c.rating ? <span className="text-amber-500 ml-1">{'★'.repeat(c.rating)}</span> : null}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        )}
      </Card>
    </div>
  );
}

function Kpi({ label, value, hint }: { label: string; value: number | string; hint?: string }) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-4">
      <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">{label}</p>
      <p className="text-2xl font-black text-zinc-900 tabular-nums mt-1">{value}</p>
      {hint && <p className="text-[10px] text-zinc-400 mt-0.5">{hint}</p>}
    </div>
  );
}
function Card({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-4">
      <p className="text-xs font-black uppercase tracking-wider text-zinc-500 mb-3">{titulo}</p>
      {children}
    </section>
  );
}
function Bar({ label, count, total, cls }: { label: string; count: number; total: number; cls: string }) {
  const pct = total ? (count / total) * 100 : 0;
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="w-40 truncate text-zinc-700">{label}</span>
      <div className="flex-1 h-2.5 rounded-full bg-zinc-100 overflow-hidden"><div className={`h-full ${cls}`} style={{ width: `${pct}%` }} /></div>
      <span className="w-16 text-right text-xs tabular-nums text-zinc-600"><b>{count}</b> · {Math.round(pct)}%</span>
    </div>
  );
}
function Vazio({ texto = 'Sem dados ainda.' }: { texto?: string }) {
  return <p className="text-xs text-zinc-400">{texto}</p>;
}
