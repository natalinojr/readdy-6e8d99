import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { X, Plus, LayoutTemplate, Pencil, Copy, Trash2, FolderPlus } from 'lucide-react';
import { useToast } from '@/contexts/ToastContext';
import type { TaskList } from '../../hooks/useTarefas';
import { filtrarModelo, resumirModelo } from '../../lib/modeloEstrutura';
import { carregarModelos, chamarModelos, textoResumo, type ModeloEstrutura } from './api';
import ModeloEditor, { type ModoEditor } from './ModeloEditor';
import AplicarModelo from './AplicarModelo';
import ConfirmDialog from '../ConfirmDialog';
import { useVoltarFecha } from '@/lib/voltarAndroid';

/** Por onde a pessoa entrou: a lista de modelos, "salvar esta pasta" ou "criar a partir de modelo". */
export type TelaModelos =
  | { tipo: 'lista' }
  | { tipo: 'salvar'; listId: string }
  | { tipo: 'aplicar'; parentId: string | null; modeloId?: string | null };

type Tela = TelaModelos | { tipo: 'editar'; modelo: ModeloEstrutura };

interface Props {
  inicial: TelaModelos;
  lists: TaskList[];
  tenantId: string | null;
  usuarios: Array<{ id: string; nome: string }>;
  /** Pasta aberta agora — atalho "Salvar esta pasta como modelo" na lista. */
  pastaAtualId: string | null;
  onCriado: (listId: string) => void;
  onFechar: () => void;
}

/**
 * Modelos de estrutura de pastas: listar, criar a partir de uma pasta, editar,
 * duplicar, excluir e aplicar. (Os templates de CHECKLIST são outra coisa —
 * TemplatesManager.)
 */
export default function ModelosPastas({ inicial, lists, tenantId, usuarios, pastaAtualId, onCriado, onFechar }: Props) {
  useVoltarFecha(true, onFechar, 'tarefas-modelos');
  const toast = useToast();
  const [tela, setTela] = useState<Tela>(inicial);
  const [modelos, setModelos] = useState<ModeloEstrutura[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [excluindo, setExcluindo] = useState<ModeloEstrutura | null>(null);

  // useToast devolve um objeto novo a cada render: fica num ref pra não
  // recarregar a lista toda vez que aparece um aviso.
  const toastRef = useRef(toast);
  toastRef.current = toast;
  const recarregar = useCallback(async () => {
    try {
      setModelos(await carregarModelos());
    } catch (e) {
      toastRef.current.error('Erro ao carregar modelos', e instanceof Error ? e.message : undefined);
    } finally {
      setCarregando(false);
    }
  }, []);
  useEffect(() => { recarregar(); }, [recarregar]);

  const nomes = useMemo(() => new Map(usuarios.map((u) => [u.id, u.nome])), [usuarios]);
  const nomeUsuario = useCallback((id: string) => nomes.get(id) ?? null, [nomes]);
  const pastaAtual = lists.find((l) => l.id === pastaAtualId) ?? null;

  const duplicar = async (m: ModeloEstrutura) => {
    const r = await chamarModelos(tenantId, 'duplicate_structure_template', { template_id: m.id });
    if (!r.ok) toast.error('Erro ao duplicar', r.error);
    else recarregar();
  };

  const excluir = async () => {
    if (!excluindo) return;
    const r = await chamarModelos(tenantId, 'delete_structure_template', { template_id: excluindo.id });
    setExcluindo(null);
    if (!r.ok) toast.error('Erro ao excluir', r.error);
    else recarregar();
  };

  // Salvou pelo editor: volta pra lista, que mostra o modelo novo/atualizado
  const aposSalvar = () => {
    recarregar();
    setTela({ tipo: 'lista' });
  };

  if (tela.tipo === 'salvar' || tela.tipo === 'editar') {
    if (tela.tipo === 'editar' || !carregando) {
      const modo: ModoEditor = tela.tipo === 'salvar' ? { tipo: 'novo', listId: tela.listId } : { tipo: 'editar', modelo: tela.modelo };
      return (
        <ModeloEditor
          modo={modo}
          lists={lists}
          modelos={modelos}
          tenantId={tenantId}
          nomeUsuario={nomeUsuario}
          onSalvo={aposSalvar}
          onFechar={inicial.tipo === 'lista' ? () => setTela({ tipo: 'lista' }) : onFechar}
        />
      );
    }
    return null;
  }

  if (tela.tipo === 'aplicar') {
    if (carregando) return null;
    return (
      <AplicarModelo
        modelos={modelos}
        modeloIdInicial={tela.modeloId ?? null}
        parentIdInicial={tela.parentId}
        lists={lists}
        tenantId={tenantId}
        nomeUsuario={nomeUsuario}
        onCriado={onCriado}
        onFechar={inicial.tipo === 'lista' ? () => setTela({ tipo: 'lista' }) : onFechar}
      />
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onFechar}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200">
          <div>
            <h3 className="text-sm font-semibold text-slate-800">Modelos de pastas</h3>
            <p className="text-xs text-slate-400">Estruturas prontas: subpastas, status, campos e tarefas</p>
          </div>
          <button onClick={onFechar} className="p-1.5 rounded hover:bg-slate-100 text-slate-500"><X size={18} /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-2">
          {carregando && <p className="text-xs text-slate-400 text-center py-6">Carregando…</p>}

          {!carregando && modelos.map((m) => {
            const r = resumirModelo(filtrarModelo(m.content, m.options));
            return (
              <div key={m.id} className="px-3 py-2.5 rounded-lg border border-slate-200 group">
                <div className="flex items-center gap-2">
                  <LayoutTemplate size={14} className="text-indigo-400 shrink-0" />
                  <span className="text-sm text-slate-700 flex-1 truncate font-medium">{m.name}</span>
                  <button
                    onClick={() => setTela({ tipo: 'editar', modelo: m })}
                    className="p-1 text-slate-300 hover:text-indigo-500 md:opacity-0 md:group-hover:opacity-100 transition"
                    title="Editar, regravar ou ver versões"
                  >
                    <Pencil size={13} />
                  </button>
                  <button
                    onClick={() => duplicar(m)}
                    className="p-1 text-slate-300 hover:text-indigo-500 md:opacity-0 md:group-hover:opacity-100 transition"
                    title="Duplicar"
                  >
                    <Copy size={13} />
                  </button>
                  <button
                    onClick={() => setExcluindo(m)}
                    className="p-1 text-slate-300 hover:text-red-500 md:opacity-0 md:group-hover:opacity-100 transition"
                    title="Excluir"
                  >
                    <Trash2 size={13} />
                  </button>
                  <button
                    onClick={() => setTela({ tipo: 'aplicar', parentId: null, modeloId: m.id })}
                    className="ml-1 px-2.5 py-1 rounded-lg bg-indigo-50 text-indigo-600 text-xs font-medium hover:bg-indigo-100"
                  >
                    Usar
                  </button>
                </div>
                {m.description && <p className="text-[11px] text-slate-500 truncate mt-0.5 pl-6">{m.description}</p>}
                <p className="text-[11px] text-slate-400 truncate mt-0.5 pl-6">
                  {textoResumo(r)} · v{m.version}, {new Date(m.updated_at).toLocaleDateString('pt-BR')}
                  {m.source_list_name ? ` · da pasta “${m.source_list_name}”` : ''}
                </p>
              </div>
            );
          })}

          {!carregando && modelos.length === 0 && (
            <p className="text-xs text-slate-400 text-center py-6">
              Nenhum modelo ainda.<br />
              Monte uma pasta do jeito que você quer repetir (subpastas, status, tarefas)<br />
              e salve como modelo pelo botão abaixo ou pelo ícone de modelo no topo da pasta.
            </p>
          )}
        </div>

        <div className="px-5 py-3 border-t border-slate-200 space-y-2">
          {pastaAtual && (
            <button
              onClick={() => setTela({ tipo: 'salvar', listId: pastaAtual.id })}
              className="w-full py-2 rounded-lg border border-dashed border-slate-300 text-sm text-slate-500 hover:border-indigo-300 hover:text-indigo-600 flex items-center justify-center gap-1.5"
            >
              <Plus size={14} /> Salvar “{pastaAtual.name}” como modelo
            </button>
          )}
          {modelos.length > 0 && (
            <button
              onClick={() => setTela({ tipo: 'aplicar', parentId: null })}
              className="w-full py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 flex items-center justify-center gap-1.5"
            >
              <FolderPlus size={14} /> Criar pasta a partir de modelo
            </button>
          )}
        </div>
      </div>

      {excluindo && (
        <ConfirmDialog
          titulo={`Excluir o modelo "${excluindo.name}"?`}
          descricao="As pastas já criadas com ele não mudam. As versões guardadas do modelo também são apagadas."
          textoConfirmar="Excluir"
          onConfirmar={excluir}
          onCancelar={() => setExcluindo(null)}
        />
      )}
    </div>
  );
}
