// Escolher currículos do banco para inscrever numa vaga (a IA analisa cada um).
import { useMemo, useState } from 'react';
import { type Candidate, type Company, type Job, type Stage, ageOf, companyName, norm, stageByKind } from '../shared';

interface Props {
  job: Job;
  candidates: Candidate[];
  companies: Company[];
  stages: Stage[];
  jaInscritos: Set<string>;
  onClose: () => void;
  onAdd: (ids: string[]) => void;
}

export default function AdicionarCandidatosModal({ job, candidates, companies, stages, jaInscritos, onClose, onAdd }: Props) {
  const [busca, setBusca] = useState('');
  const [soEmpresa, setSoEmpresa] = useState(!!job.company_id);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const descartado = stageByKind(stages, 'descartado')?.id;

  const lista = useMemo(() => {
    const q = norm(busca).trim();
    return candidates
      .filter((c) => !jaInscritos.has(c.id) && c.stage_id !== descartado)
      .filter((c) => !soEmpresa || c.company_id === job.company_id)
      .filter((c) => !q || q.split(/\s+/).every((t) => norm([c.full_name, c.desired_role, c.city, c.neighborhood, c.raw_text ?? '',
        c.experiences.map((e) => `${e.empresa} ${e.cargo}`).join(' ')].join(' ')).includes(t)));
  }, [candidates, jaInscritos, descartado, soEmpresa, job.company_id, busca]);

  const toggle = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-[60]" onClick={onClose} />
      <div className="fixed inset-x-0 bottom-0 sm:inset-auto sm:top-1/2 sm:left-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 z-[70] w-full sm:max-w-lg max-h-[90vh] bg-white sm:rounded-2xl rounded-t-2xl shadow-2xl flex flex-col">
        <div className="px-5 py-4 border-b border-zinc-100">
          <div className="flex items-center gap-3">
            <i className="ri-database-2-line text-xl text-rose-600" />
            <h2 className="flex-1 font-black text-zinc-900">Adicionar à vaga {job.title}</h2>
            <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-zinc-100 text-zinc-500 cursor-pointer"><i className="ri-close-line text-lg" /></button>
          </div>
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por nome, cargo, bairro, palavra do currículo…"
            className="w-full h-9 px-3 rounded-lg border border-zinc-200 text-sm mt-3 focus:outline-none focus:border-rose-300" autoFocus />
          {job.company_id && (
            <label className="flex items-center gap-2 text-xs text-zinc-600 mt-2 cursor-pointer select-none">
              <input type="checkbox" checked={soEmpresa} onChange={(e) => setSoEmpresa(e.target.checked)} className="accent-rose-600" />
              Só currículos de {companyName(companies, job.company_id)}
            </label>
          )}
        </div>
        <div className="flex-1 overflow-y-auto">
          {lista.length === 0 ? <p className="p-6 text-center text-sm text-zinc-400">Nenhum currículo disponível com esse filtro.</p> : (
            <ul className="divide-y divide-zinc-50">
              {lista.map((c) => {
                const idade = ageOf(c);
                return (
                  <li key={c.id}>
                    <label className="flex items-center gap-3 px-5 py-2.5 hover:bg-zinc-50 cursor-pointer">
                      <input type="checkbox" checked={sel.has(c.id)} onChange={() => toggle(c.id)} className="accent-rose-600 w-4 h-4" />
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm font-semibold text-zinc-900 truncate">{c.full_name}</span>
                        <span className="block text-xs text-zinc-500 truncate">{[c.desired_role, idade != null ? `${idade} anos` : null, c.neighborhood || c.city].filter(Boolean).join(' · ') || '—'}</span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <div className="flex items-center gap-2 px-5 py-3 border-t border-zinc-100">
          {lista.length > 0 && (
            <button onClick={() => setSel(sel.size === lista.length ? new Set() : new Set(lista.map((c) => c.id)))}
              className="text-xs font-bold text-zinc-500 hover:text-zinc-800 cursor-pointer">
              {sel.size === lista.length ? 'Limpar' : 'Marcar todos'}
            </button>
          )}
          <button onClick={onClose} className="ml-auto px-4 h-9 rounded-lg border border-zinc-200 text-sm font-semibold text-zinc-600 cursor-pointer">Cancelar</button>
          <button onClick={() => { onAdd([...sel]); onClose(); }} disabled={!sel.size}
            className="px-4 h-9 rounded-lg bg-rose-600 hover:bg-rose-500 disabled:opacity-40 text-white text-sm font-bold cursor-pointer">
            Adicionar {sel.size || ''} e analisar
          </button>
        </div>
      </div>
    </>
  );
}
