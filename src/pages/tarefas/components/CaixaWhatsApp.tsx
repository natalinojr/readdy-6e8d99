import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pin, ChevronDown, ChevronUp, Image as ImageIcon, FileText, Mic, Video, Plus, MessageSquarePlus, X, Loader2 } from 'lucide-react';
import { supabase, invokeWithAuth } from '@/lib/supabase';
import { useToast } from '@/contexts/ToastContext';
import type { TaskRow } from '../hooks/useTarefas';
import { modoDemo } from '../demo/modoDemo';

/**
 * Caixa do WhatsApp da pasta (2026-09-24): mensagens que alguém marcou com 📌 no grupo ligado a
 * esta pasta (tela Assistente › Grupos). Nada vira tarefa sozinho — quem pode editar a pasta decide:
 * tarefa nova, anotação numa tarefa que já existe, ou descarta. Backend: task_whatsapp_items,
 * assistente-webhook › pinParaTarefa e task-write › wa_item_*.
 */
export interface ItemCaixa {
  id: string;
  list_id: string;
  group_name: string | null;
  sender_name: string | null;
  kind: string;
  content: string | null;
  sent_at: string | null;
  media_mime: string | null;
  media_name: string | null;
  has_media: boolean;
  pinned_by_name: string | null;
  pinned_at: string;
}

type Write = (action: string, payload?: Record<string, unknown>) => Promise<{ success: boolean; id?: string; error?: string }>;

interface Props {
  listId: string;
  tasks: TaskRow[];
  write: Write;
  onOpenTask: (id: string) => void;
  /** Quantos itens a caixa tem agora (o aviso da barra de cima usa). */
  onCount?: (listId: string, n: number) => void;
}

function quando(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

/** Texto sem o rótulo técnico ("[Áudio] ", "[Foto] "). */
function textoLimpo(c: string | null): string {
  return String(c ?? '').replace(/^\[(Áudio|Foto|Arquivo|Vídeo|Encaminhada)\]\s*/i, '').trim();
}

/** Título sugerido: a primeira linha da mensagem, até 120 caracteres. */
function tituloSugerido(item: ItemCaixa): string {
  const linha = textoLimpo(item.content).split('\n').find((l) => l.trim()) ?? '';
  if (linha) return linha.length > 120 ? `${linha.slice(0, 117).trimEnd()}…` : linha;
  return item.kind === 'image' ? 'Foto do grupo' : item.kind === 'audio' ? 'Áudio do grupo' : 'Mensagem do grupo';
}

function origem(item: ItemCaixa): string {
  return `📌 WhatsApp · ${item.group_name ?? 'grupo'} · ${item.sender_name ?? 'alguém'}${item.sent_at ? `, ${quando(item.sent_at)}` : ''}`;
}

const ICONE_MIDIA: Record<string, typeof ImageIcon> = { image: ImageIcon, audio: Mic, video: Video, document: FileText };

// Modo demonstração (/dev/tarefas): mensagens de exemplo em memória, sem servidor.
const ITENS_DEMO: ItemCaixa[] = [
  { id: 'demo-wa-1', list_id: '', group_name: 'Obra Vila Leste', sender_name: 'João (mestre de obra)', kind: 'text', content: 'Falta trocar o disjuntor do QD2 antes de ligar a câmara fria. Consegue ver com o eletricista até sexta?', sent_at: new Date(Date.now() - 3 * 3600_000).toISOString(), media_mime: null, media_name: null, has_media: false, pinned_by_name: 'Natalino', pinned_at: new Date().toISOString() },
  { id: 'demo-wa-2', list_id: '', group_name: 'Obra Vila Leste', sender_name: 'Carlos', kind: 'audio', content: '[Áudio] Chegou o piso da cozinha, mas veio duas caixas a menos. Já avisei o fornecedor.', sent_at: new Date(Date.now() - 3600_000).toISOString(), media_mime: 'audio/ogg', media_name: null, has_media: true, pinned_by_name: 'João (mestre de obra)', pinned_at: new Date().toISOString() },
];
let demoRestantes = ITENS_DEMO.map((i) => i.id);

async function chamar<T = { success?: boolean; error?: string; warning?: string | null }>(body: Record<string, unknown>) {
  if (modoDemo()) {
    if (body.action === 'wa_item_sign') return { ok: false as const, error: 'No modo demonstração não há arquivo de verdade.' };
    demoRestantes = demoRestantes.filter((id) => id !== body.item_id);
    return { ok: true as const, data: { success: true } as unknown as T & { success?: boolean; error?: string; warning?: string | null } };
  }
  const { data, error } = await invokeWithAuth<T & { success?: boolean; error?: string; warning?: string | null }>('task-write', { body });
  if (error || !data?.success) return { ok: false as const, error: data?.error ?? error?.message ?? 'Erro desconhecido' };
  return { ok: true as const, data };
}

export default function CaixaWhatsApp({ listId, tasks, write, onOpenTask, onCount }: Props) {
  const toast = useToast();
  const [itens, setItens] = useState<ItemCaixa[]>([]);
  const [aberta, setAberta] = useState(true);

  const carregar = useCallback(async () => {
    if (modoDemo()) {
      setItens(ITENS_DEMO.filter((i) => demoRestantes.includes(i.id)).map((i) => ({ ...i, list_id: listId })));
      return;
    }
    const { data, error } = await supabase.rpc('fn_get_task_whatsapp_items', { p_list_id: listId });
    if (error) { console.error('[CaixaWhatsApp]', error.message); return; }
    setItens((data as ItemCaixa[]) ?? []);
  }, [listId]);

  useEffect(() => {
    setItens([]);
    carregar();
    // Chega 📌 novo enquanto a tela está aberta: confere ao voltar para a aba e a cada minuto.
    const aoVoltar = () => { if (document.visibilityState === 'visible') carregar(); };
    document.addEventListener('visibilitychange', aoVoltar);
    const t = setInterval(aoVoltar, 60_000);
    return () => { document.removeEventListener('visibilitychange', aoVoltar); clearInterval(t); };
  }, [carregar]);

  const tirar = (id: string) => setItens((prev) => prev.filter((i) => i.id !== id));
  // O número da barra de cima acompanha a caixa (fora do render: efeito, não dentro do setState).
  useEffect(() => { onCount?.(listId, itens.length); }, [itens, listId, onCount]);

  // Tarefas abertas desta pasta (destino da anotação).
  const abertas = useMemo(
    () => tasks.filter((t) => t.list_id === listId && t.status_category !== 'done' && t.status_category !== 'cancelled'),
    [tasks, listId],
  );

  if (!itens.length) return null;

  return (
    <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50/60">
      <button
        onClick={() => setAberta((a) => !a)}
        className="w-full flex items-center gap-2 px-3 py-2.5 text-left"
      >
        <Pin size={15} className="text-emerald-600 shrink-0" />
        <span className="text-sm font-semibold text-emerald-900">
          {itens.length === 1 ? '1 mensagem do WhatsApp para decidir' : `${itens.length} mensagens do WhatsApp para decidir`}
        </span>
        <span className="ml-auto text-emerald-700">{aberta ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</span>
      </button>
      {aberta && (
        <ul className="px-3 pb-3 space-y-2">
          {itens.map((item) => (
            <CartaoItem
              key={item.id}
              item={item}
              listId={listId}
              abertas={abertas}
              write={write}
              onOpenTask={onOpenTask}
              onFeito={() => tirar(item.id)}
              onErro={(titulo, msg) => { toast.error(titulo, msg); carregar(); }}
              onOk={(titulo, aviso) => (aviso ? toast.error(titulo, aviso) : toast.success(titulo))}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function CartaoItem({ item, listId, abertas, write, onOpenTask, onFeito, onErro, onOk }: {
  item: ItemCaixa;
  listId: string;
  abertas: TaskRow[];
  write: Write;
  onOpenTask: (id: string) => void;
  onFeito: () => void;
  onErro: (titulo: string, msg?: string) => void;
  onOk: (titulo: string, aviso?: string | null) => void;
}) {
  const [modo, setModo] = useState<'nada' | 'tarefa' | 'anotacao' | 'descartar'>('nada');
  const [titulo, setTitulo] = useState(() => tituloSugerido(item));
  const [busca, setBusca] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [midia, setMidia] = useState<string | null>(null);
  const [expandido, setExpandido] = useState(false);

  const texto = textoLimpo(item.content);
  const Icone = ICONE_MIDIA[item.kind];

  const verMidia = async () => {
    const r = await chamar<{ url: string }>({ action: 'wa_item_sign', item_id: item.id });
    if (!r.ok) { onErro('Não consegui abrir o arquivo', r.error); return; }
    if (item.kind === 'image' || item.kind === 'audio' || item.kind === 'video') setMidia(r.data.url);
    else window.open(r.data.url, '_blank', 'noopener');
  };

  const criarTarefa = async () => {
    const t = titulo.trim();
    if (!t) return;
    setOcupado(true);
    const descricao = [texto, `— ${origem(item)}`].filter(Boolean).join('\n\n');
    const res = await write('create_task', { list_id: listId, title: t, description: descricao });
    if (!res.success || !res.id) { setOcupado(false); onErro('Erro ao criar a tarefa', res.error); return; }
    const r = await chamar({ action: 'wa_item_resolve', item_id: item.id, mode: 'tarefa', task_id: res.id });
    setOcupado(false);
    if (!r.ok) {
      // Outra pessoa resolveu a mensagem no meio do caminho: não deixa tarefa em dobro.
      await write('delete_task', { task_id: res.id });
      onErro('Não virou tarefa', r.error);
      return;
    }
    onFeito();
    onOk('Tarefa criada', r.data.warning);
    onOpenTask(res.id);
  };

  const anotar = async (taskId: string) => {
    setOcupado(true);
    const r = await chamar({ action: 'wa_item_resolve', item_id: item.id, mode: 'anotacao', task_id: taskId });
    setOcupado(false);
    if (!r.ok) { onErro('Não consegui anotar', r.error); return; }
    onFeito();
    onOk('Anotado na tarefa', r.data.warning);
  };

  const descartar = async () => {
    setOcupado(true);
    const r = await chamar({ action: 'wa_item_discard', item_id: item.id });
    setOcupado(false);
    if (!r.ok) { onErro('Não consegui descartar', r.error); return; }
    onFeito();
  };

  const filtradas = abertas
    .filter((t) => !busca.trim() || t.title.toLowerCase().includes(busca.trim().toLowerCase()))
    .slice(0, 8);

  return (
    <li className="rounded-lg bg-white border border-slate-200 p-3">
      <p className="text-[11px] text-slate-500 flex flex-wrap gap-x-1.5">
        <span className="font-semibold text-slate-700">{item.sender_name ?? 'Alguém'}</span>
        {item.sent_at && <span>· {quando(item.sent_at)}</span>}
        {item.group_name && <span className="truncate">· {item.group_name}</span>}
        {item.pinned_by_name && <span>· 📌 por {item.pinned_by_name}</span>}
      </p>

      {texto && (
        <p
          onClick={() => setExpandido((e) => !e)}
          className={`mt-1 text-sm text-slate-800 whitespace-pre-wrap break-words cursor-pointer ${expandido ? '' : 'line-clamp-5'}`}
        >
          {texto}
        </p>
      )}

      {item.has_media && (
        midia ? (
          item.kind === 'image' ? (
            <a href={midia} target="_blank" rel="noopener noreferrer"><img src={midia} alt="" className="mt-2 max-h-64 rounded-lg border border-slate-200" /></a>
          ) : item.kind === 'audio' ? (
            <audio src={midia} controls className="mt-2 w-full" />
          ) : (
            <video src={midia} controls className="mt-2 max-h-64 rounded-lg" />
          )
        ) : (
          <button onClick={verMidia} className="mt-2 inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-md bg-slate-100 text-slate-700 hover:bg-slate-200">
            {Icone && <Icone size={13} />}
            {item.kind === 'image' ? 'Ver foto' : item.kind === 'audio' ? 'Ouvir áudio' : item.kind === 'video' ? 'Ver vídeo' : (item.media_name ?? 'Abrir arquivo')}
          </button>
        )
      )}

      {modo === 'nada' && (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          <button onClick={() => setModo('tarefa')} className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700">
            <Plus size={13} /> Criar tarefa
          </button>
          <button
            onClick={() => setModo('anotacao')}
            disabled={!abertas.length}
            title={abertas.length ? undefined : 'Esta pasta não tem tarefa aberta'}
            className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 disabled:opacity-40"
          >
            <MessageSquarePlus size={13} /> Anotar numa tarefa
          </button>
          <button onClick={() => setModo('descartar')} className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg text-slate-500 hover:bg-slate-100">
            <X size={13} /> Descartar
          </button>
        </div>
      )}

      {modo === 'tarefa' && (
        <div className="mt-2.5 flex flex-col sm:flex-row gap-1.5">
          <input
            autoFocus
            value={titulo}
            onChange={(e) => setTitulo(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') criarTarefa(); if (e.key === 'Escape') setModo('nada'); }}
            placeholder="Título da tarefa"
            autoComplete="off"
            className="flex-1 min-w-0 text-sm px-2.5 py-1.5 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-200"
          />
          <div className="flex gap-1.5">
            <button onClick={criarTarefa} disabled={ocupado || !titulo.trim()} className="inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg bg-indigo-600 text-white font-medium disabled:opacity-50">
              {ocupado && <Loader2 size={13} className="animate-spin" />} Criar
            </button>
            <button onClick={() => setModo('nada')} className="text-xs px-2.5 py-1.5 rounded-lg text-slate-500 hover:bg-slate-100">Voltar</button>
          </div>
        </div>
      )}

      {modo === 'anotacao' && (
        <div className="mt-2.5">
          <div className="flex gap-1.5">
            <input
              autoFocus
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape') setModo('nada'); }}
              placeholder="Procurar tarefa desta pasta…"
              autoComplete="off"
              className="flex-1 min-w-0 text-sm px-2.5 py-1.5 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-200"
            />
            <button onClick={() => setModo('nada')} className="text-xs px-2.5 py-1.5 rounded-lg text-slate-500 hover:bg-slate-100">Voltar</button>
          </div>
          <ul className="mt-1.5 max-h-56 overflow-y-auto divide-y divide-slate-100 rounded-lg border border-slate-200">
            {filtradas.map((t) => (
              <li key={t.id}>
                <button
                  onClick={() => anotar(t.id)}
                  disabled={ocupado}
                  className="w-full text-left text-sm px-2.5 py-2 hover:bg-indigo-50 disabled:opacity-50 truncate"
                >
                  {t.parent_task_id ? '↳ ' : ''}{t.title}
                </button>
              </li>
            ))}
            {!filtradas.length && <li className="text-xs text-slate-400 px-2.5 py-2">Nenhuma tarefa aberta com esse nome.</li>}
          </ul>
        </div>
      )}

      {modo === 'descartar' && (
        <div className="mt-2.5 flex items-center gap-1.5 text-xs">
          <span className="text-slate-600">Descartar esta mensagem? O arquivo também é apagado.</span>
          <button onClick={descartar} disabled={ocupado} className="px-2.5 py-1.5 rounded-lg bg-red-600 text-white font-medium disabled:opacity-50">Descartar</button>
          <button onClick={() => setModo('nada')} className="px-2.5 py-1.5 rounded-lg text-slate-500 hover:bg-slate-100">Voltar</button>
        </div>
      )}
    </li>
  );
}
