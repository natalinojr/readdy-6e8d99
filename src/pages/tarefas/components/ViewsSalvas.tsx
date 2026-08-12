import { useState } from 'react';
import { Bookmark, BookmarkPlus, Trash2, Users, Lock, Check } from 'lucide-react';
import { useToast } from '@/contexts/ToastContext';
import type { TaskList, TaskViewSalva } from '../hooks/useTarefas';
import type { Filtros, GroupBy } from '../lib/agrupamento';

interface ViewsSalvasProps {
  views: TaskViewSalva[];
  list: TaskList | null;
  viewAtual: string;
  groupBy: GroupBy;
  filtros: Filtros;
  meuId: string | null;
  write: (action: string, payload?: Record<string, unknown>) => Promise<{ success: boolean; id?: string; error?: string }>;
  onAplicar: (v: TaskViewSalva) => void;
}

/**
 * Salva e reaplica a combinação view + agrupamento + filtros.
 * Pessoal (só eu) ou compartilhada com a equipe.
 */
export default function ViewsSalvas({
  views, list, viewAtual, groupBy, filtros, meuId, write, onAplicar,
}: ViewsSalvasProps) {
  const toast = useToast();
  const [aberto, setAberto] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [nome, setNome] = useState('');
  const [compartilhar, setCompartilhar] = useState(false);
  const [aplicadaId, setAplicadaId] = useState<string | null>(null);

  // Views globais (sem lista) + as da lista atual
  const visiveis = views.filter((v) => v.list_id === null || v.list_id === list?.id);

  const salvar = async () => {
    const nomeLimpo = nome.trim();
    if (!nomeLimpo) return;
    setSalvando(true);
    const res = await write('create_view', {
      name: nomeLimpo,
      list_id: list?.id ?? null,
      view_type: viewAtual,
      group_by: groupBy,
      filters: filtros,
      is_shared: compartilhar,
    });
    setSalvando(false);
    if (!res.success) {
      toast.error('Erro ao salvar view', res.error);
      return;
    }
    setNome('');
    setCompartilhar(false);
    setAberto(false);
    toast.success('View salva', compartilhar ? 'Visível para toda a equipe.' : 'Visível só para você.');
  };

  return (
    <div className="relative">
      <button
        onClick={() => setAberto((v) => !v)}
        className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border transition ${
          aplicadaId
            ? 'border-indigo-300 bg-indigo-50 text-indigo-700 font-medium'
            : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
        }`}
        title="Views salvas"
      >
        <Bookmark size={13} />
        {aplicadaId ? visiveis.find((v) => v.id === aplicadaId)?.name ?? 'Views' : 'Views'}
      </button>

      {aberto && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setAberto(false)} />
          <div className="absolute right-0 top-full mt-1 z-30 w-64 bg-white rounded-xl border border-slate-200 shadow-lg">
            <div className="max-h-56 overflow-y-auto">
              {visiveis.map((v) => (
                <div key={v.id} className="flex items-center gap-1.5 px-2 py-1.5 hover:bg-slate-50 group border-b border-slate-50">
                  <button
                    onClick={() => {
                      onAplicar(v);
                      setAplicadaId(v.id);
                      setAberto(false);
                    }}
                    className="flex-1 flex items-center gap-1.5 text-left min-w-0"
                  >
                    {v.is_shared ? (
                      <Users size={11} className="text-slate-400 shrink-0" />
                    ) : (
                      <Lock size={11} className="text-slate-400 shrink-0" />
                    )}
                    <span className="text-xs text-slate-700 truncate">{v.name}</span>
                    {aplicadaId === v.id && <Check size={11} className="text-indigo-500 shrink-0" />}
                  </button>
                  {(!v.user_id || v.user_id === meuId) && (
                    <button
                      onClick={async () => {
                        if (!confirm(`Excluir a view "${v.name}"?`)) return;
                        const res = await write('delete_view', { view_id: v.id });
                        if (!res.success) toast.error('Erro ao excluir', res.error);
                        else if (aplicadaId === v.id) setAplicadaId(null);
                      }}
                      className="p-1 text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition"
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
              ))}
              {visiveis.length === 0 && (
                <p className="text-[11px] text-slate-400 text-center py-4 px-3">
                  Nenhuma view salva ainda.
                </p>
              )}
            </div>

            {/* Salvar a combinação atual */}
            <div className="border-t border-slate-100 p-2 space-y-2">
              <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
                <BookmarkPlus size={12} /> Salvar filtros atuais
              </div>
              <input
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && salvar()}
                placeholder="Nome da view"
                className="w-full text-xs border border-slate-200 rounded-lg px-2 py-1.5 outline-none focus:border-indigo-300"
              />
              <label className="flex items-center gap-1.5 text-[11px] text-slate-600 cursor-pointer">
                <input
                  type="checkbox"
                  checked={compartilhar}
                  onChange={(e) => setCompartilhar(e.target.checked)}
                  className="rounded border-slate-300"
                />
                Compartilhar com a equipe
              </label>
              <button
                onClick={salvar}
                disabled={!nome.trim() || salvando}
                className="w-full py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-700 disabled:opacity-40"
              >
                {salvando ? 'Salvando…' : 'Salvar view'}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
