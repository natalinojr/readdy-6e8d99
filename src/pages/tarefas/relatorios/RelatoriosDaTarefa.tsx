/**
 * Seção "Relatórios" na janela da tarefa: os relatórios ligados a ela (que eu
 * enxergo) e o atalho para ligar a outro. O vínculo é o mesmo que o relatório
 * mostra em "Tarefas ligadas".
 */
import { useCallback, useEffect, useState } from 'react';
import { FileText, Plus, X, Loader2 } from 'lucide-react';
import { useToast } from '@/contexts/ToastContext';
import { chamarDono, podeEditar, type AcessoRelatorio, type ResumoRelatorio } from './api';

type Ligado = { id: string; title: string; status: 'open' | 'closed'; list_id: string | null; access: AcessoRelatorio };

export default function RelatoriosDaTarefa({ taskId, onAbrir }: {
  taskId: string;
  onAbrir: (reportId: string, listId: string | null) => void;
}) {
  const toast = useToast();
  const [ligados, setLigados] = useState<Ligado[] | null>(null);
  const [escolhendo, setEscolhendo] = useState(false);
  const [opcoes, setOpcoes] = useState<ResumoRelatorio[] | null>(null);

  const carregar = useCallback(async () => {
    const r = await chamarDono<{ reports: Ligado[] }>('task_links', { task_id: taskId });
    setLigados(r.ok ? r.data.reports : []);
  }, [taskId]);
  useEffect(() => { carregar(); }, [carregar]);

  const abrirEscolha = async () => {
    setEscolhendo(true);
    const r = await chamarDono<{ reports: ResumoRelatorio[] }>('list');
    setOpcoes(r.ok ? r.data.reports.filter((x) => podeEditar(x.access)) : []);
  };

  const ligar = async (reportId: string) => {
    const r = await chamarDono('link_task', { report_id: reportId, task_id: taskId });
    if (!r.ok) { toast.error('Não foi possível ligar', r.error); return; }
    setEscolhendo(false);
    carregar();
  };
  const desligar = async (reportId: string) => {
    const r = await chamarDono('unlink_task', { report_id: reportId, task_id: taskId });
    if (!r.ok) { toast.error('Não foi possível desligar', r.error); return; }
    carregar();
  };

  const idsLigados = new Set((ligados ?? []).map((l) => l.id));

  return (
    <section>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-slate-400"><FileText size={15} /></span>
        <h3 className="text-sm font-semibold text-slate-700">Relatórios</h3>
        {!!ligados?.length && <span className="text-[11px] font-medium text-slate-400 bg-slate-100 rounded-full px-1.5 py-px">{ligados.length}</span>}
        <div className="ml-auto">
          {!escolhendo && (
            <button onClick={abrirEscolha} className="text-xs text-indigo-600 hover:underline flex items-center gap-1"><Plus size={13} /> Ligar a relatório</button>
          )}
        </div>
      </div>
      {ligados === null && <Loader2 size={15} className="animate-spin text-slate-300" />}
      {ligados?.length === 0 && !escolhendo && <p className="text-xs text-slate-400">Nenhum relatório ligado a esta tarefa.</p>}
      {!!ligados?.length && (
        <ul className="space-y-1">
          {ligados.map((l) => (
            <li key={l.id} className="flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-200 hover:border-slate-300">
              <FileText size={14} className="text-indigo-400 shrink-0" />
              <button onClick={() => onAbrir(l.id, l.list_id)} className="flex-1 min-w-0 text-left text-sm text-slate-700 truncate hover:text-indigo-600">{l.title}</button>
              {l.status === 'closed' && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500 shrink-0">encerrado</span>}
              {podeEditar(l.access) && (
                <button onClick={() => desligar(l.id)} className="p-0.5 text-slate-300 hover:text-red-500" title="Desligar"><X size={14} /></button>
              )}
            </li>
          ))}
        </ul>
      )}
      {escolhendo && (
        <div className="mt-2 rounded-xl border border-slate-200">
          <div className="flex items-center px-3 py-1.5 border-b border-slate-100 text-xs text-slate-500">
            <span className="flex-1">Escolha o relatório</span>
            <button onClick={() => setEscolhendo(false)} className="p-0.5 text-slate-400"><X size={14} /></button>
          </div>
          {opcoes === null ? (
            <div className="p-3"><Loader2 size={15} className="animate-spin text-slate-300" /></div>
          ) : (
            <ul className="max-h-56 overflow-y-auto">
              {opcoes.filter((o) => !idsLigados.has(o.id)).map((o) => (
                <li key={o.id}>
                  <button onClick={() => ligar(o.id)} className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 flex items-center gap-2">
                    <span className="flex-1 min-w-0 truncate">{o.title}</span>
                    {o.list_name && <span className="text-xs text-slate-400 shrink-0">{o.list_name}</span>}
                  </button>
                </li>
              ))}
              {opcoes.filter((o) => !idsLigados.has(o.id)).length === 0 && (
                <li className="px-3 py-2 text-sm text-slate-400">Nenhum relatório disponível (crie um na aba Relatórios de uma pasta).</li>
              )}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
