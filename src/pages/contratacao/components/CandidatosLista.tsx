// Lista de candidatos em cards ou em tabela (visão do todo, ordenável).
import { useMemo, useState } from 'react';
import {
  type Candidate, type Company, type Interview, type Stage, colorOf, stageOf, fmtMonths, fmtDate, fmtDateTime, companyName, avgScore,
} from '../shared';

type SortKey = 'nome' | 'empresa' | 'cargo' | 'idade' | 'local' | 'exp' | 'fase' | 'nota' | 'entrevista' | 'recebido';

interface Props {
  view: 'cards' | 'tabela';
  items: Candidate[];
  companies: Company[];
  stages: Stage[];
  mostrarEmpresa: boolean;
  proximaEntrevista: Map<string, Interview>;
  ultimaAvaliacao: Map<string, Interview>;
  onOpen: (id: string) => void;
}

export default function CandidatosLista(props: Props) {
  const { view, items, companies, stages, mostrarEmpresa, proximaEntrevista, onOpen } = props;
  if (view === 'cards') {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {items.map((c) => (
          <CandidateCard key={c.id} c={c} stage={stageOf(stages, c.stage_id)} empresa={mostrarEmpresa ? companyName(companies, c.company_id) : null}
            entrevista={proximaEntrevista.get(c.id) ?? null} onOpen={() => onOpen(c.id)} />
        ))}
      </div>
    );
  }
  return <Tabela {...props} />;
}

function Tabela({ items, companies, stages, mostrarEmpresa, proximaEntrevista, ultimaAvaliacao, onOpen }: Props) {
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'recebido', dir: -1 });

  const rows = useMemo(() => {
    const val = (c: Candidate): string | number => {
      switch (sort.key) {
        case 'nome': return c.full_name.toLowerCase();
        case 'empresa': return companyName(companies, c.company_id);
        case 'cargo': return (c.desired_role ?? '').toLowerCase() || '￿';
        case 'idade': return c.age ?? 999;
        case 'local': return `${c.city ?? ''} ${c.neighborhood ?? ''}`.toLowerCase() || '￿';
        case 'exp': return c.total_experience_months ?? -1;
        case 'fase': return stageOf(stages, c.stage_id)?.sort_order ?? 0;
        case 'nota': return avgScore(ultimaAvaliacao.get(c.id)?.scores) ?? c.rating ?? 0;
        case 'entrevista': return proximaEntrevista.get(c.id)?.scheduled_at ?? '￿';
        default: return c.created_at;
      }
    };
    return [...items].sort((a, b) => {
      const va = val(a); const vb = val(b);
      return (va < vb ? -1 : va > vb ? 1 : 0) * sort.dir;
    });
  }, [items, sort, companies, stages, proximaEntrevista, ultimaAvaliacao]);

  const Th = ({ k, children }: { k: SortKey; children: React.ReactNode }) => (
    <th onClick={() => setSort((s) => ({ key: k, dir: s.key === k ? (s.dir === 1 ? -1 : 1) : 1 }))}
      className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wider text-zinc-500 cursor-pointer select-none whitespace-nowrap hover:text-zinc-800">
      {children}{sort.key === k && <i className={`ml-0.5 ${sort.dir === 1 ? 'ri-arrow-up-s-fill' : 'ri-arrow-down-s-fill'}`} />}
    </th>
  );

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-zinc-50 border-b border-zinc-200">
          <tr>
            <Th k="nome">Nome</Th>
            {mostrarEmpresa && <Th k="empresa">Empresa</Th>}
            <Th k="cargo">Cargo pretendido</Th>
            <Th k="idade">Idade</Th>
            <Th k="local">Bairro / cidade</Th>
            <Th k="exp">Experiência</Th>
            <Th k="fase">Fase</Th>
            <Th k="nota">Nota</Th>
            <Th k="entrevista">Entrevista</Th>
            <Th k="recebido">Recebido</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100">
          {rows.map((c) => {
            const st = stageOf(stages, c.stage_id);
            const ent = proximaEntrevista.get(c.id);
            const media = avgScore(ultimaAvaliacao.get(c.id)?.scores);
            return (
              <tr key={c.id} onClick={() => onOpen(c.id)} className="hover:bg-rose-50/40 cursor-pointer">
                <td className="px-3 py-2">
                  <p className="font-semibold text-zinc-900 whitespace-nowrap">{c.full_name}</p>
                  {!c.ai_processed && <p className="text-[10px] text-sky-600">leitura simples</p>}
                </td>
                {mostrarEmpresa && <td className="px-3 py-2 text-xs text-zinc-600 whitespace-nowrap">{companyName(companies, c.company_id)}</td>}
                <td className="px-3 py-2 text-xs text-zinc-700 max-w-[180px] truncate">{c.desired_role ?? '—'}</td>
                <td className="px-3 py-2 text-xs text-zinc-700">{c.age ?? '—'}</td>
                <td className="px-3 py-2 text-xs text-zinc-700 max-w-[180px] truncate">{[c.neighborhood, c.city].filter(Boolean).join(', ') || '—'}</td>
                <td className="px-3 py-2 text-xs text-zinc-700 whitespace-nowrap">{fmtMonths(c.total_experience_months) ?? '—'}</td>
                <td className="px-3 py-2">{st && <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border whitespace-nowrap ${colorOf(st.color).cls}`}>{st.name}</span>}</td>
                <td className="px-3 py-2 text-xs whitespace-nowrap">
                  {media != null ? <span className="font-bold text-zinc-800">{media.toFixed(1)}</span> : null}
                  {c.rating ? <span className="text-amber-500 ml-1">{'★'.repeat(c.rating)}</span> : media == null ? <span className="text-zinc-300">—</span> : null}
                </td>
                <td className="px-3 py-2 text-xs text-violet-700 whitespace-nowrap">{ent ? fmtDateTime(ent.scheduled_at) : <span className="text-zinc-300">—</span>}</td>
                <td className="px-3 py-2 text-xs text-zinc-500 whitespace-nowrap">{fmtDate(c.created_at)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function CandidateCard({ c, stage, empresa, entrevista, onOpen, compact = false }: {
  c: Candidate; stage: Stage | null; empresa: string | null; entrevista: Interview | null; onOpen: () => void; compact?: boolean;
}) {
  const ultima = c.experiences[0];
  return (
    <button onClick={onOpen} className={`w-full text-left ${compact ? 'p-3' : 'p-4'} rounded-2xl border border-zinc-200 bg-white hover:border-rose-300 hover:shadow-sm transition-all cursor-pointer`}>
      <div className="flex items-start gap-3">
        {!compact && (
          <div className="w-10 h-10 rounded-full bg-rose-100 text-rose-700 font-black flex items-center justify-center flex-shrink-0">
            {(c.full_name || '?').charAt(0).toUpperCase()}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className={`font-bold text-zinc-900 truncate ${compact ? 'text-sm' : ''}`}>{c.full_name}</p>
            {c.rating ? <span className="text-amber-500 text-xs whitespace-nowrap">{'★'.repeat(c.rating)}</span> : null}
          </div>
          <p className="text-xs text-zinc-500 truncate">
            {[c.desired_role, c.age ? `${c.age} anos` : null, [c.neighborhood, c.city].filter(Boolean).join(', ') || null].filter(Boolean).join(' · ') || '—'}
          </p>
          {ultima && !compact && (
            <p className="text-xs text-zinc-400 truncate mt-0.5">
              <i className="ri-briefcase-line" /> {[ultima.cargo, ultima.empresa].filter(Boolean).join(' em ')}
            </p>
          )}
        </div>
        {stage && !compact && <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border whitespace-nowrap ${colorOf(stage.color).cls}`}>{stage.name}</span>}
      </div>
      <div className="flex flex-wrap gap-1.5 mt-2">
        {empresa && <Chip cls="bg-zinc-50 text-zinc-600 border-zinc-200"><i className="ri-building-line" /> {empresa}</Chip>}
        {entrevista && <Chip cls="bg-violet-50 text-violet-700 border-violet-200"><i className="ri-calendar-event-line" /> {fmtDateTime(entrevista.scheduled_at)}</Chip>}
        {c.total_experience_months != null && !compact && <Chip cls="bg-zinc-50 text-zinc-600 border-zinc-200">{fmtMonths(c.total_experience_months)} de experiência</Chip>}
        {c.concerns.length > 0 && !compact && <Chip cls="bg-orange-50 text-orange-700 border-orange-200">{c.concerns.length} ponto{c.concerns.length > 1 ? 's' : ''} de atenção</Chip>}
        {!c.ai_processed && <Chip cls="bg-sky-50 text-sky-700 border-sky-200">Leitura simples</Chip>}
        {!compact && <span className="ml-auto text-[10px] text-zinc-400 self-center">{fmtDate(c.created_at)}</span>}
      </div>
    </button>
  );
}

function Chip({ children, cls }: { children: React.ReactNode; cls: string }) {
  return <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${cls}`}>{children}</span>;
}
