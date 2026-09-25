import { useMemo, useState } from 'react';
import { X, LayoutTemplate } from 'lucide-react';
import { useToast } from '@/contexts/ToastContext';
import type { TaskList } from '../../hooks/useTarefas';
import { montarArvorePastas, achatarArvore } from '../../lib/pastas';
import { diaLocal, filtrarModelo, resumirModelo, gravarExibicaoPastas, type ExibicaoModelo } from '../../lib/modeloEstrutura';
import { chamarModelos, textoResumo, type ModeloEstrutura } from './api';
import ArvoreModelo from './ArvoreModelo';
import { useVoltarFecha } from '@/lib/voltarAndroid';

interface Props {
  modelos: ModeloEstrutura[];
  modeloIdInicial: string | null;
  /** Pasta onde criar (null = na raiz). */
  parentIdInicial: string | null;
  lists: TaskList[];
  tenantId: string | null;
  nomeUsuario: (id: string) => string | null;
  onCriado: (listId: string) => void;
  onFechar: () => void;
}

/** Cria uma pasta nova (com tudo o que o modelo tem) a partir de um modelo. */
export default function AplicarModelo({ modelos, modeloIdInicial, parentIdInicial, lists, tenantId, nomeUsuario, onCriado, onFechar }: Props) {
  useVoltarFecha(true, onFechar, 'tarefas-aplicar-modelo');
  const toast = useToast();
  const [modeloId, setModeloId] = useState(modeloIdInicial ?? modelos[0]?.id ?? '');
  const modelo = modelos.find((m) => m.id === modeloId) ?? null;
  const [nome, setNome] = useState(modelo?.content.raiz.name ?? '');
  const [destino, setDestino] = useState(parentIdInicial ?? '');
  const [dataBase, setDataBase] = useState(() => diaLocal(new Date().toISOString()));
  const [criando, setCriando] = useState(false);

  // Só dá pra criar dentro de pasta própria ou compartilhada com "editar"
  const destinos = useMemo(
    () => achatarArvore(montarArvorePastas(lists)).filter((p) => (p.access ?? 'owner') !== 'view'),
    [lists],
  );
  const resumo = useMemo(() => (modelo ? resumirModelo(filtrarModelo(modelo.content, modelo.options)) : null), [modelo]);

  const trocarModelo = (id: string) => {
    setModeloId(id);
    const m = modelos.find((x) => x.id === id);
    if (m) setNome(m.content.raiz.name);
  };

  const criar = async () => {
    if (!modelo) return;
    setCriando(true);
    const r = await chamarModelos(tenantId, 'apply_structure_template', {
      template_id: modelo.id,
      parent_list_id: destino || null,
      name: nome.trim() || null,
      data_base: dataBase,
    });
    setCriando(false);
    if (!r.ok || !r.data.id) {
      toast.error('Não foi possível criar a partir do modelo', r.ok ? undefined : r.error);
      return;
    }
    gravarExibicaoPastas(r.data.exibicao as Record<string, ExibicaoModelo> | undefined);
    toast.success('Pasta criada a partir do modelo', r.data.resumo ? textoResumo(r.data.resumo) : undefined);
    onCriado(r.data.id);
  };

  return (
    <div className="fixed inset-0 z-[56] flex items-center justify-center bg-black/30 p-2 sm:p-4" onClick={onFechar}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[92vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200">
          <div>
            <h3 className="text-sm font-semibold text-slate-800 flex items-center gap-1.5">
              <LayoutTemplate size={15} className="text-indigo-500" /> Criar pasta a partir de modelo
            </h3>
            <p className="text-xs text-slate-400">Cria a pasta com tudo o que o modelo tem</p>
          </div>
          <button onClick={onFechar} className="p-1.5 rounded hover:bg-slate-100 text-slate-500"><X size={18} /></button>
        </div>

        {modelos.length === 0 ? (
          <p className="px-5 py-10 text-sm text-slate-400 text-center">
            Você ainda não tem modelos.<br />Abra uma pasta e use o ícone de modelo no topo para salvar a primeira.
          </p>
        ) : (
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label htmlFor="modelo-escolhido" className="block text-xs text-slate-500 mb-1">Modelo</label>
                <select
                  id="modelo-escolhido"
                  value={modeloId}
                  onChange={(e) => trocarModelo(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-indigo-300 bg-white"
                >
                  {modelos.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="modelo-nome-pasta" className="block text-xs text-slate-500 mb-1">Nome da pasta nova</label>
                <input
                  id="modelo-nome-pasta"
                  value={nome}
                  onChange={(e) => setNome(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-indigo-300"
                />
              </div>
              <div>
                <label htmlFor="modelo-destino" className="block text-xs text-slate-500 mb-1">Onde criar</label>
                <select
                  id="modelo-destino"
                  value={destino}
                  onChange={(e) => setDestino(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-indigo-300 bg-white"
                >
                  <option value="">Na raiz (pasta principal)</option>
                  {destinos.map((p) => (
                    <option key={p.id} value={p.id}>{'  '.repeat(p.profundidade)}Dentro de “{p.name}”</option>
                  ))}
                </select>
              </div>
              {resumo?.com_data && (
                <div>
                  <label htmlFor="modelo-data-base" className="block text-xs text-slate-500 mb-1">Data de início (dia 0)</label>
                  <input
                    id="modelo-data-base"
                  type="date"
                    value={dataBase}
                    onChange={(e) => setDataBase(e.target.value || diaLocal(new Date().toISOString()))}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-indigo-300"
                  />
                </div>
              )}
            </div>

            {modelo?.description && <p className="text-xs text-slate-500 whitespace-pre-line">{modelo.description}</p>}
            {resumo && <p className="text-xs text-slate-500">Vai criar: {textoResumo(resumo)}</p>}
            {modelo && (
              <div className="border border-slate-100 rounded-xl px-3 py-2 max-h-[45vh] overflow-y-auto">
                <ArvoreModelo
                  conteudo={{ ...modelo.content, raiz: { ...modelo.content.raiz, name: nome.trim() || modelo.content.raiz.name } }}
                  opcoes={modelo.options}
                  somenteLeitura
                  dataBase={dataBase}
                  nomeUsuario={nomeUsuario}
                />
              </div>
            )}
          </div>
        )}

        <div className="px-5 py-3 border-t border-slate-200 flex justify-end gap-2">
          <button onClick={onFechar} className="px-3 py-2 rounded-lg text-sm text-slate-500 hover:bg-slate-100">Cancelar</button>
          <button
            onClick={criar}
            disabled={!modelo || criando}
            className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-40"
          >
            {criando ? 'Criando…' : 'Criar pasta'}
          </button>
        </div>
      </div>
    </div>
  );
}
