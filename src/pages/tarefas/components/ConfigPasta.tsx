import { useState } from 'react';
import { X, Waypoints, SlidersHorizontal, Share2, FolderInput, ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { useToast } from '@/contexts/ToastContext';
import type { TaskList } from '../hooks/useTarefas';
import { useVoltarFecha } from '@/lib/voltarAndroid';

interface ConfigPastaProps {
  list: TaskList;
  /** Pasta-mãe, pra mostrar onde ela fica (null = pasta principal). */
  pai: TaskList | null;
  cores: string[];
  write: (action: string, payload?: Record<string, unknown>) => Promise<{ success: boolean; id?: string; error?: string }>;
  onClose: () => void;
  /** Atalhos: fecham esta janela e abrem a do ajuste (quem chama já seleciona a pasta). */
  onStatus: () => void;
  onCampos: () => void;
  onCompartilhar: () => void;
  onMover: () => void;
}

/** Configurações da pasta (só o dono): nome e cor, mais atalhos para o resto dos ajustes dela. */
export default function ConfigPasta({ list, pai, cores, write, onClose, onStatus, onCampos, onCompartilhar, onMover }: ConfigPastaProps) {
  useVoltarFecha(true, onClose, 'tarefas-config-pasta');
  const toast = useToast();
  const [nome, setNome] = useState(list.name);
  const [cor, setCor] = useState(list.color);
  const [salvando, setSalvando] = useState(false);

  const mudou = nome.trim() !== list.name || cor !== list.color;
  // Pasta com cor antiga fora da paleta: continua aparecendo pra poder manter.
  const paleta = cores.includes(list.color) ? cores : [list.color, ...cores];

  const salvar = async () => {
    const nomeLimpo = nome.trim();
    if (!nomeLimpo || !mudou || salvando) return;
    setSalvando(true);
    const res = await write('update_list', { list_id: list.id, name: nomeLimpo, color: cor });
    setSalvando(false);
    if (!res.success) {
      toast.error('Erro ao salvar a pasta', res.error);
      return;
    }
    toast.success('Pasta atualizada');
    onClose();
  };

  const atalho = (icone: ReactNode, rotulo: string, acao: () => void) => (
    <button
      type="button"
      onClick={() => { onClose(); acao(); }}
      className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm text-slate-600 hover:bg-slate-50 hover:text-indigo-600 text-left"
    >
      <span className="shrink-0 text-slate-400">{icone}</span>
      <span className="flex-1">{rotulo}</span>
      <ChevronRight size={14} className="shrink-0 text-slate-300" />
    </button>
  );

  return (
    <div className="fixed inset-0 z-[55] flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-sm max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-slate-800">Configurações da pasta</h3>
            <p className="text-xs text-slate-400 truncate">{pai ? `Dentro de "${pai.name}"` : 'Pasta principal'}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded hover:bg-slate-100 text-slate-500" aria-label="Fechar">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          <label className="block">
            <span className="text-xs text-slate-500">Nome</span>
            <input
              autoFocus
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') salvar(); }}
              className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm outline-none focus:border-indigo-300"
            />
          </label>

          <div>
            <span className="text-xs text-slate-500">Cor</span>
            <div className="mt-1.5 flex items-center gap-2 flex-wrap">
              {paleta.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCor(c)}
                  className={`w-7 h-7 rounded-full transition ${cor === c ? 'ring-2 ring-offset-2 ring-slate-400' : ''}`}
                  style={{ backgroundColor: c }}
                  aria-label={`Cor ${c}`}
                  aria-pressed={cor === c}
                />
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="px-3 py-2 rounded-lg text-sm text-slate-500 hover:bg-slate-100">
              Cancelar
            </button>
            <button
              type="button"
              onClick={salvar}
              disabled={!nome.trim() || !mudou || salvando}
              className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-40"
            >
              {salvando ? 'Salvando…' : 'Salvar'}
            </button>
          </div>

          <div className="border-t border-slate-100 pt-3 -mx-2">
            <p className="px-2 pb-1 text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Mais ajustes desta pasta</p>
            {atalho(<Waypoints size={15} />, 'Status da pasta', onStatus)}
            {atalho(<SlidersHorizontal size={15} />, 'Campos personalizados', onCampos)}
            {atalho(<Share2 size={15} />, 'Compartilhar', onCompartilhar)}
            {atalho(<FolderInput size={15} />, 'Mover para outra pasta', onMover)}
          </div>
        </div>
      </div>
    </div>
  );
}
