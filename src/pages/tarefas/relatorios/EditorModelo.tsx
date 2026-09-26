/**
 * Editar um modelo de relatório: nome, explicação, links e itens (texto,
 * imagens, campos de resposta, condições entre itens) — as mesmas peças do
 * relatório, sem respostas. Nada vai para o banco até "Salvar modelo".
 * Os relatórios já criados com o modelo não mudam.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ChevronDown, ChevronUp, CornerDownRight, LayoutTemplate, Loader2, Pencil, Trash2 } from 'lucide-react';
import { useToast } from '@/contexts/ToastContext';
import ItemRelatorio, { FormItem, NovoItem } from './ItemRelatorio';
import LinksRelatorio from './LinksRelatorio';
import { descreverCondicao } from './condicaoItem';
import {
  chamarDono, enviarImagemModelo,
  type CampoRel, type CondicaoItem, type ImagemRel, type ItemRel, type LinkRel, type ModeloCompleto,
} from './api';

let seq = 0;
const novoId = () => `m${Date.now().toString(36)}${(seq++).toString(36)}`;

/** Item do modelo no formato do relatório (id local, sem respostas), para reaproveitar as telas. */
function comoItem(it: { title: string; body: string | null; images: ImagemRel[]; fields?: CampoRel[]; links?: LinkRel[] }, id: string, show_if: CondicaoItem | null = null): ItemRel {
  const agora = new Date().toISOString();
  return {
    id, position: 0, title: it.title, body: it.body, images: it.images, fields: it.fields ?? [], links: it.links ?? [], show_if,
    status: 'open', created_by_guest_name: null, created_at: agora, updated_at: agora, responses: [],
  };
}

export default function EditorModelo({ modeloId, onFechar }: { modeloId: string; onFechar: (salvou: boolean) => void }) {
  const toast = useToast();
  const [carregado, setCarregado] = useState(false);
  const [nome, setNome] = useState('');
  const [descricao, setDescricao] = useState('');
  const [links, setLinks] = useState<LinkRel[]>([]);
  const [itens, setItens] = useState<ItemRel[]>([]);
  const [editando, setEditando] = useState<string | null>(null);
  const [mudou, setMudou] = useState(false);
  const [gravando, setGravando] = useState(false);

  // Carrega só ao abrir: o toast muda a cada aviso e não pode recarregar (apagaria o que foi editado).
  const toastRef = useRef(toast);
  toastRef.current = toast;
  const fecharRef = useRef(onFechar);
  fecharRef.current = onFechar;
  const carregar = useCallback(async () => {
    const r = await chamarDono<{ template: ModeloCompleto }>('get_template', { template_id: modeloId });
    if (!r.ok) { toastRef.current.error('Erro ao abrir o modelo', r.error); fecharRef.current(false); return; }
    const t = r.data.template;
    const ids = t.items.map(() => novoId());
    setNome(t.name);
    setDescricao(t.description ?? '');
    setLinks(t.links ?? []);
    setItens(t.items.map((it, i) => comoItem(it, ids[i], it.show_if && ids[it.show_if.item_idx]
      ? { item_id: ids[it.show_if.item_idx], field_id: it.show_if.field_id, values: it.show_if.values } : null)));
    setCarregado(true);
  }, [modeloId]);
  useEffect(() => { carregar(); }, [carregar]);

  const alterar = (fn: (atual: ItemRel[]) => ItemRel[]) => { setItens(fn); setMudou(true); };
  const mover = (i: number, d: -1 | 1) => alterar((a) => { const n = [...a]; [n[i], n[i + d]] = [n[i + d], n[i]]; return n; });
  // Item que sai leva junto as condições que apontavam para ele.
  const tirar = (id: string) => alterar((a) => a.filter((x) => x.id !== id).map((x) => (x.show_if?.item_id === id ? { ...x, show_if: null } : x)));
  const enviarImagem = async (f: File) => {
    const r = await enviarImagemModelo(modeloId, f);
    if (!r.ok) { toast.error('Imagem não enviada', r.error); return null; }
    return r.data;
  };

  const salvar = async () => {
    if (!nome.trim()) { toast.error('Informe o nome do modelo'); return; }
    setGravando(true);
    const idx = new Map(itens.map((it, i) => [it.id, i]));
    const r = await chamarDono('update_template', {
      template_id: modeloId, name: nome.trim(), description: descricao.trim() || null, links,
      items: itens.map((it) => ({
        title: it.title, body: it.body, fields: it.fields ?? [], links: it.links ?? [],
        images: it.images.map(({ path, name, caption }) => ({ path, name, ...(caption ? { caption } : {}) })),
        show_if: it.show_if && idx.has(it.show_if.item_id) ? { item_idx: idx.get(it.show_if.item_id), field_id: it.show_if.field_id, values: it.show_if.values } : null,
      })),
    });
    setGravando(false);
    if (!r.ok) { toast.error('Não foi possível salvar o modelo', r.error); return; }
    toast.success('Modelo salvo');
    onFechar(true);
  };

  if (!carregado) return <div className="py-16 flex justify-center"><Loader2 className="animate-spin text-slate-300" /></div>;

  return (
    <div className="max-w-3xl mx-auto space-y-3">
      <button onClick={() => onFechar(false)} className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-indigo-600">
        <ArrowLeft size={16} /> Voltar aos relatórios
      </button>

      <section className="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-4 space-y-2">
        <p className="text-xs font-semibold text-violet-600 flex items-center gap-1.5"><LayoutTemplate size={14} /> Editando modelo</p>
        <input
          value={nome}
          onChange={(e) => { setNome(e.target.value); setMudou(true); }}
          maxLength={200}
          placeholder="Nome do modelo"
          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-lg font-semibold text-slate-800"
        />
        <textarea
          value={descricao}
          onChange={(e) => { setDescricao(e.target.value); setMudou(true); }}
          rows={2}
          maxLength={5000}
          placeholder="Explicação para quem vai responder (opcional)"
          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-base md:text-sm"
        />
        <p className="text-xs text-slate-400">Os relatórios já criados com este modelo não mudam — vale para os próximos.</p>
      </section>

      <LinksRelatorio links={links} podeEditar onSalvar={async (l) => { setLinks(l); setMudou(true); return true; }} />

      <div className="flex items-center gap-2 px-1 pt-1">
        <h2 className="text-sm font-semibold text-slate-700">Itens</h2>
        <span className="text-xs text-slate-400">{itens.length}</span>
      </div>
      {itens.map((item, i) => editando === item.id ? (
        <FormItem
          key={item.id}
          inicial={item}
          comCampos
          itens={itens}
          rotuloSalvar="Aplicar"
          onEnviarImagem={enviarImagem}
          onCancelar={() => setEditando(null)}
          onSalvar={async (title, body, images, fields, l, show_if) => {
            alterar((a) => a.map((x) => (x.id === item.id ? { ...x, title, body: body || null, images, fields, links: l, show_if: show_if ?? null } : x)));
            setEditando(null);
            return true;
          }}
        />
      ) : (
        <ItemRelatorio
          key={item.id}
          item={item}
          numero={i + 1}
          podeResponder={false}
          onResponder={async () => false}
          onEnviarImagem={enviarImagem}
          faixa={(() => {
            const c = descreverCondicao(item, itens);
            return c && (
              <div className="px-4 py-1.5 flex flex-wrap items-center gap-x-1.5 text-xs bg-indigo-50 text-slate-600 border-b border-indigo-100">
                <CornerDownRight size={13} className="text-indigo-500 shrink-0" />
                Aparece só se no item <strong className="font-medium text-indigo-800">{c.numero} · {c.titulo}</strong>
                a pergunta <strong className="font-medium text-indigo-800">{c.pergunta}</strong> for <strong className="font-medium text-indigo-800">{c.respostas}</strong>
              </div>
            );
          })()}
          acoes={
            <div className="shrink-0 flex items-center">
              <button disabled={i === 0} onClick={() => mover(i, -1)} className="p-1 rounded-lg text-slate-400 hover:bg-slate-100 disabled:opacity-30" title="Subir"><ChevronUp size={16} /></button>
              <button disabled={i === itens.length - 1} onClick={() => mover(i, 1)} className="p-1 rounded-lg text-slate-400 hover:bg-slate-100 disabled:opacity-30" title="Descer"><ChevronDown size={16} /></button>
              <button onClick={() => setEditando(item.id)} className="p-1 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-indigo-600" title="Editar item"><Pencil size={15} /></button>
              <button onClick={() => tirar(item.id)} className="p-1 rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-500" title="Tirar item"><Trash2 size={15} /></button>
            </div>
          }
        />
      ))}
      <NovoItem
        comCampos
        itens={itens}
        onEnviarImagem={enviarImagem}
        onCriar={async (title, body, images, fields, l, show_if) => {
          alterar((a) => [...a, comoItem({ title, body: body || null, images, fields, links: l }, novoId(), show_if ?? null)]);
          return true;
        }}
      />

      {/* Barra de salvar sempre à mão */}
      <div className="sticky bottom-3 z-10 flex items-center gap-2 bg-white/95 backdrop-blur rounded-2xl border border-slate-200 shadow-lg px-4 py-3">
        <span className="flex-1 text-xs text-slate-500">{mudou ? 'Alterações ainda não salvas' : 'Sem alterações'}</span>
        <button onClick={() => onFechar(false)} className="px-3 py-2 rounded-lg text-sm text-slate-500 hover:bg-slate-100">Cancelar</button>
        <button
          onClick={salvar}
          disabled={gravando || !mudou || editando !== null}
          title={editando ? 'Termine a edição do item antes (Aplicar ou Cancelar)' : undefined}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50"
        >
          {gravando && <Loader2 size={15} className="animate-spin" />} Salvar modelo
        </button>
      </div>
    </div>
  );
}
