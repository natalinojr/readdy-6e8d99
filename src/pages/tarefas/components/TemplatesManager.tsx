import { useState } from 'react';
import { X, Plus, Trash2, ListChecks } from 'lucide-react';
import { useToast } from '@/contexts/ToastContext';
import type { ChecklistTemplate } from '../hooks/useTarefas';

interface TemplatesManagerProps {
  templates: ChecklistTemplate[];
  write: (action: string, payload?: Record<string, unknown>) => Promise<{ success: boolean; id?: string; error?: string }>;
  onClose: () => void;
}

const EXEMPLO = 'Ex.: Abertura da loja\n\nConferir troco do caixa\nLigar fritadeira\nChecar validade dos insumos\nLimpar bancadas';

export default function TemplatesManager({ templates, write, onClose }: TemplatesManagerProps) {
  const toast = useToast();
  const [criando, setCriando] = useState(false);
  const [nome, setNome] = useState('');
  const [itensTexto, setItensTexto] = useState('');
  const [salvando, setSalvando] = useState(false);

  const criar = async () => {
    const nomeLimpo = nome.trim();
    const itens = itensTexto.split('\n').map((l) => l.trim()).filter(Boolean);
    if (!nomeLimpo || itens.length === 0) {
      toast.error('Preencha nome e ao menos um item');
      return;
    }
    setSalvando(true);
    const res = await write('create_checklist_template', { name: nomeLimpo, items: itens });
    setSalvando(false);
    if (!res.success) {
      toast.error('Erro ao criar template', res.error);
      return;
    }
    setCriando(false);
    setNome('');
    setItensTexto('');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200">
          <div>
            <h3 className="text-sm font-semibold text-slate-800">Templates de checklist</h3>
            <p className="text-xs text-slate-400">Rotinas que se repetem, aplicadas em 1 clique</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded hover:bg-slate-100 text-slate-500">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-2">
          {templates.map((tpl) => (
            <div key={tpl.id} className="px-3 py-2 rounded-lg border border-slate-200 group">
              <div className="flex items-center gap-2">
                <ListChecks size={14} className="text-indigo-400 shrink-0" />
                <span className="text-sm text-slate-700 flex-1 truncate">{tpl.name}</span>
                <span className="text-[11px] text-slate-400">{tpl.items.length} itens</span>
                <button
                  onClick={async () => {
                    if (!confirm(`Excluir o template "${tpl.name}"?`)) return;
                    const res = await write('delete_checklist_template', { template_id: tpl.id });
                    if (!res.success) toast.error('Erro ao excluir', res.error);
                  }}
                  className="p-1 text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition"
                >
                  <Trash2 size={13} />
                </button>
              </div>
              <p className="text-[11px] text-slate-400 truncate mt-0.5 pl-6">
                {tpl.items.slice(0, 4).join(' · ')}{tpl.items.length > 4 ? '…' : ''}
              </p>
            </div>
          ))}

          {templates.length === 0 && !criando && (
            <p className="text-xs text-slate-400 text-center py-6">
              Nenhum template ainda.<br />
              Crie um para rotinas como abertura e fechamento da loja.
            </p>
          )}

          {criando && (
            <div className="border border-indigo-200 bg-indigo-50/40 rounded-xl p-3 space-y-2">
              <input
                autoFocus
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                placeholder="Nome do template"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-indigo-300"
              />
              <textarea
                value={itensTexto}
                onChange={(e) => setItensTexto(e.target.value)}
                rows={6}
                placeholder={EXEMPLO}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-indigo-300 resize-y"
              />
              <p className="text-[11px] text-slate-400">Um item por linha.</p>
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => { setCriando(false); setNome(''); setItensTexto(''); }}
                  className="px-3 py-1.5 rounded-lg text-sm text-slate-500 hover:bg-white"
                >
                  Cancelar
                </button>
                <button
                  onClick={criar}
                  disabled={salvando}
                  className="px-4 py-1.5 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-40"
                >
                  {salvando ? 'Criando…' : 'Criar template'}
                </button>
              </div>
            </div>
          )}
        </div>

        {!criando && (
          <div className="px-5 py-3 border-t border-slate-200">
            <button
              onClick={() => setCriando(true)}
              className="w-full py-2 rounded-lg border border-dashed border-slate-300 text-sm text-slate-500 hover:border-indigo-300 hover:text-indigo-600 flex items-center justify-center gap-1.5"
            >
              <Plus size={14} /> Novo template
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
