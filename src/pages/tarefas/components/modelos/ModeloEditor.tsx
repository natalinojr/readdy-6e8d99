import { useEffect, useMemo, useState } from 'react';
import { X, History, RefreshCw } from 'lucide-react';
import { useToast } from '@/contexts/ToastContext';
import type { TaskList } from '../../hooks/useTarefas';
import { montarArvorePastas, achatarArvore } from '../../lib/pastas';
import {
  OPCOES_PADRAO, resumirModelo, filtrarModelo, lerExibicaoPastas,
  type ModeloConteudo, type OpcoesModelo,
} from '../../lib/modeloEstrutura';
import { chamarModelos, textoResumo, type ModeloEstrutura } from './api';
import ArvoreModelo from './ArvoreModelo';
import OpcoesModeloForm from './OpcoesModeloForm';
import ConfirmDialog from '../ConfirmDialog';

export type ModoEditor = { tipo: 'novo'; listId: string } | { tipo: 'editar'; modelo: ModeloEstrutura };

interface Props {
  modo: ModoEditor;
  lists: TaskList[];
  modelos: ModeloEstrutura[];
  tenantId: string | null;
  nomeUsuario: (id: string) => string | null;
  onSalvo: () => void;
  onFechar: () => void;
}

/** Ids da pasta e de todas as subpastas (pra levar o agrupamento/colunas de cada uma). */
function idsDaSubarvore(lists: TaskList[], listId: string): string[] {
  const no = achatarArvore(montarArvorePastas(lists)).find((n) => n.id === listId);
  return no ? [no.id, ...achatarArvore(no.filhas).map((f) => f.id)] : [listId];
}

/**
 * Salvar uma pasta como modelo (novo ou substituindo um existente) e editar um
 * modelo: nome, descrição, o que entra (opções + árvore), regravar a partir de
 * uma pasta e voltar a uma versão anterior.
 */
export default function ModeloEditor({ modo, lists, modelos, tenantId, nomeUsuario, onSalvo, onFechar }: Props) {
  const toast = useToast();
  const existente = modo.tipo === 'editar' ? modo.modelo : null;
  const [nome, setNome] = useState(existente?.name ?? lists.find((l) => modo.tipo === 'novo' && l.id === modo.listId)?.name ?? '');
  const [descricao, setDescricao] = useState(existente?.description ?? '');
  const [opcoes, setOpcoes] = useState<OpcoesModelo>(existente?.options ?? { ...OPCOES_PADRAO });
  const [conteudo, setConteudo] = useState<ModeloConteudo | null>(existente?.content ?? null);
  /** Pasta lida agora (novo, ou regravar). null = mantém o conteúdo guardado. */
  const [pastaOrigem, setPastaOrigem] = useState<string | null>(modo.tipo === 'novo' ? modo.listId : null);
  /** No "novo": gravar como modelo novo ('') ou por cima de um existente (id). */
  const [substituir, setSubstituir] = useState('');
  const [carregando, setCarregando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [restaurando, setRestaurando] = useState<{ id: string; version: number } | null>(null);

  const pastasOrdenadas = useMemo(() => achatarArvore(montarArvorePastas(lists)), [lists]);

  // Lê a pasta escolhida (pré-visualização, ainda sem gravar nada)
  useEffect(() => {
    if (!pastaOrigem) return;
    let vivo = true;
    setCarregando(true);
    chamarModelos(tenantId, 'preview_structure_template', {
      list_id: pastaOrigem,
      exibicao: lerExibicaoPastas(idsDaSubarvore(lists, pastaOrigem)),
    }).then((r) => {
      if (!vivo) return;
      setCarregando(false);
      if (!r.ok || !r.data.content) {
        toast.error('Não foi possível ler a pasta', r.ok ? undefined : r.error);
        return;
      }
      setConteudo(r.data.content);
    });
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pastaOrigem, tenantId]);

  const resumo = useMemo(() => (conteudo ? resumirModelo(filtrarModelo(conteudo, opcoes)) : null), [conteudo, opcoes]);

  const alternar = (ref: string) => setOpcoes((o) => ({
    ...o,
    excluidos: o.excluidos.includes(ref) ? o.excluidos.filter((x) => x !== ref) : [...o.excluidos, ref],
  }));

  const escolherSubstituir = (id: string) => {
    setSubstituir(id);
    const alvo = modelos.find((m) => m.id === id);
    if (alvo) {
      // Mantém nome, descrição e escolhas do modelo que vai ser substituído
      setNome(alvo.name);
      setDescricao(alvo.description ?? '');
      setOpcoes(alvo.options);
    }
  };

  const salvar = async () => {
    if (!nome.trim()) {
      toast.error('Dê um nome ao modelo');
      return;
    }
    setSalvando(true);
    const templateId = existente?.id ?? (substituir || undefined);
    const base = { name: nome.trim(), description: descricao.trim() || null, options: opcoes };
    const r = pastaOrigem
      ? await chamarModelos(tenantId, 'save_structure_template', {
        ...base, template_id: templateId, list_id: pastaOrigem,
        exibicao: lerExibicaoPastas(idsDaSubarvore(lists, pastaOrigem)),
      })
      : await chamarModelos(tenantId, 'update_structure_template', { ...base, template_id: templateId });
    setSalvando(false);
    if (!r.ok) {
      toast.error('Erro ao salvar o modelo', r.error);
      return;
    }
    toast.success(existente || substituir ? 'Modelo atualizado' : 'Modelo criado', templateId && pastaOrigem ? 'A versão anterior ficou guardada.' : undefined);
    onSalvo();
  };

  const restaurar = async () => {
    if (!existente || !restaurando) return;
    const r = await chamarModelos(tenantId, 'restore_structure_template_version', { template_id: existente.id, version_id: restaurando.id });
    setRestaurando(null);
    if (!r.ok) {
      toast.error('Erro ao restaurar', r.error);
      return;
    }
    toast.success(`Versão ${restaurando.version} restaurada`, 'O que estava antes também ficou guardado.');
    onSalvo();
  };

  const titulo = existente ? `Editar modelo` : 'Salvar pasta como modelo';

  return (
    <div className="fixed inset-0 z-[56] flex items-center justify-center bg-black/30 p-2 sm:p-4" onClick={onFechar}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-4xl max-h-[92vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-slate-800">{titulo}</h3>
            <p className="text-xs text-slate-400 truncate">
              Escolha o que entra. Dá pra mudar depois, sem regravar.
            </p>
          </div>
          <button onClick={onFechar} className="p-1.5 rounded hover:bg-slate-100 text-slate-500"><X size={18} /></button>
        </div>

        <div className="flex-1 overflow-y-auto md:overflow-hidden md:grid md:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
          {/* Esquerda: dados e opções */}
          <div className="px-5 py-4 space-y-4 md:overflow-y-auto md:border-r border-slate-100">
            {modo.tipo === 'novo' && modelos.length > 0 && (
              <div>
                <label className="block text-xs text-slate-500 mb-1">Salvar como</label>
                <select
                  value={substituir}
                  onChange={(e) => escolherSubstituir(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-indigo-300 bg-white"
                >
                  <option value="">Novo modelo</option>
                  {modelos.map((m) => <option key={m.id} value={m.id}>Atualizar “{m.name}”</option>)}
                </select>
              </div>
            )}
            <div>
              <label className="block text-xs text-slate-500 mb-1">Nome do modelo</label>
              <input
                autoFocus
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                maxLength={120}
                placeholder="Ex.: Inauguração de loja"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-indigo-300"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">Descrição (opcional)</label>
              <textarea
                value={descricao}
                onChange={(e) => setDescricao(e.target.value)}
                rows={2}
                maxLength={2000}
                placeholder="Quando usar este modelo"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-indigo-300 resize-y"
              />
            </div>

            {existente && (
              <div>
                <label className="block text-xs text-slate-500 mb-1 flex items-center gap-1"><RefreshCw size={12} /> Regravar a partir de uma pasta</label>
                <select
                  value={pastaOrigem ?? ''}
                  onChange={(e) => {
                    const v = e.target.value || null;
                    setPastaOrigem(v);
                    if (!v) setConteudo(existente.content);
                  }}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-indigo-300 bg-white"
                >
                  <option value="">Não — manter o conteúdo atual</option>
                  {pastasOrdenadas.map((p) => (
                    <option key={p.id} value={p.id}>
                      {'  '.repeat(p.profundidade)}{p.name}{p.id === existente.source_list_id ? ' (origem)' : ''}
                    </option>
                  ))}
                </select>
                {pastaOrigem && (
                  <p className="text-[11px] text-amber-600 mt-1">
                    O conteúdo vai ser trocado pelo da pasta escolhida. A versão atual fica guardada e dá pra voltar.
                  </p>
                )}
              </div>
            )}

            <OpcoesModeloForm opcoes={opcoes} onChange={setOpcoes} />

            {existente && existente.versions.length > 0 && (
              <div>
                <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-1 flex items-center gap-1">
                  <History size={11} /> Versões anteriores
                </p>
                <div className="space-y-1">
                  {existente.versions.map((v) => (
                    <div key={v.id} className="flex items-center gap-2 text-xs text-slate-600">
                      <span className="flex-1 truncate">
                        v{v.version} · {new Date(v.created_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })}
                        {v.name !== existente.name ? ` · “${v.name}”` : ''}
                      </span>
                      <button
                        onClick={() => setRestaurando({ id: v.id, version: v.version })}
                        className="px-2 py-0.5 rounded text-indigo-600 hover:bg-indigo-50"
                      >
                        Restaurar
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Direita: o que vai ser criado */}
          <div className="px-5 py-4 md:overflow-y-auto border-t md:border-t-0 border-slate-100">
            <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-1">O que o modelo cria</p>
            {resumo && <p className="text-xs text-slate-500 mb-2">{textoResumo(resumo)}</p>}
            {carregando && <p className="text-xs text-slate-400 py-6 text-center">Lendo a pasta…</p>}
            {!carregando && conteudo && (
              <ArvoreModelo conteudo={conteudo} opcoes={opcoes} onAlternar={alternar} nomeUsuario={nomeUsuario} />
            )}
            {!carregando && conteudo && opcoes.datas && conteudo.data_referencia && (
              <p className="text-[11px] text-slate-400 mt-2">
                Datas contadas a partir de {new Date(`${conteudo.data_referencia}T12:00:00Z`).toLocaleDateString('pt-BR')} (dia 0). Ao aplicar, você escolhe a nova data do dia 0.
              </p>
            )}
          </div>
        </div>

        <div className="px-5 py-3 border-t border-slate-200 flex justify-end gap-2">
          <button onClick={onFechar} className="px-3 py-2 rounded-lg text-sm text-slate-500 hover:bg-slate-100">Cancelar</button>
          <button
            onClick={salvar}
            disabled={salvando || carregando || !conteudo || !nome.trim()}
            className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-40"
          >
            {salvando ? 'Salvando…' : existente ? 'Salvar alterações' : substituir ? 'Atualizar modelo' : 'Criar modelo'}
          </button>
        </div>
      </div>

      {restaurando && (
        <ConfirmDialog
          titulo={`Voltar para a versão ${restaurando.version}?`}
          descricao="O conteúdo e as escolhas do modelo voltam como estavam nessa versão. O que está agora fica guardado como versão."
          textoConfirmar="Restaurar"
          perigo={false}
          onConfirmar={restaurar}
          onCancelar={() => setRestaurando(null)}
        />
      )}
    </div>
  );
}
