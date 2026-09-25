import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Share2, Paperclip, Loader2, Plus, MessageSquarePlus, X } from 'lucide-react';
import type { TaskList, TaskRow } from '../hooks/useTarefas';
import { montarArvorePastas, achatarArvore } from '../lib/pastas';
import { useVoltarFecha } from '@/lib/voltarAndroid';
import { useToast } from '@/contexts/ToastContext';

/**
 * "Compartilhar → ERPOS" no Android (2026-09-24): o service worker (public/sw.js ›
 * receberCompartilhado) guarda o texto e os arquivos no cache 'erpos-compartilhado' e abre
 * /tarefas?compartilhado=1. Aqui a pessoa escolhe: tarefa nova numa pasta, ou juntar a uma
 * tarefa que já existe (comentário + anexos). Nada é gravado antes do clique.
 */
const SHARE_CACHE = 'erpos-compartilhado';
const CHAVE_PASTA = 'erpos_tarefas_pasta_compartilhar';

interface Meta {
  title: string;
  text: string;
  url: string;
  arquivos: { chave: string; nome: string; tipo: string }[];
}

type Write = (action: string, payload?: Record<string, unknown>) => Promise<{ success: boolean; id?: string; error?: string }>;

interface Props {
  lists: TaskList[];
  tasks: TaskRow[];
  write: Write;
  enviarAnexo: (file: File, taskId: string) => Promise<{ success: boolean; error?: string }>;
  onOpenTask: (id: string) => void;
  onClose: () => void;
}

async function lerCompartilhado(): Promise<{ meta: Meta; arquivos: File[] } | null> {
  if (!('caches' in window)) return null;
  const cache = await caches.open(SHARE_CACHE);
  const r = await cache.match('/__compartilhado/meta');
  if (!r) return null;
  const meta = (await r.json()) as Meta;
  const arquivos: File[] = [];
  for (const a of meta.arquivos ?? []) {
    const f = await cache.match(a.chave);
    if (f) arquivos.push(new File([await f.blob()], a.nome, { type: a.tipo }));
  }
  return { meta, arquivos };
}

async function limparCompartilhado() {
  try { await caches.delete(SHARE_CACHE); } catch { /* sem Cache API */ }
}

/** Texto do compartilhamento: WhatsApp manda a mensagem em `text`; outros apps usam título/link. */
function textoDe(meta: Meta): string {
  return [meta.title, meta.text, meta.url].map((s) => (s ?? '').trim()).filter(Boolean)
    .filter((s, i, a) => a.indexOf(s) === i).join('\n');
}

export default function CompartilhadoParaTarefa({ lists, tasks, write, enviarAnexo, onOpenTask, onClose }: Props) {
  const toast = useToast();
  const fechar = () => { limparCompartilhado(); onClose(); };
  useVoltarFecha(true, fechar, 'tarefas-compartilhado');

  const [carregando, setCarregando] = useState(true);
  const [texto, setTexto] = useState('');
  const [arquivos, setArquivos] = useState<File[]>([]);
  const [modo, setModo] = useState<'tarefa' | 'juntar'>('tarefa');
  const [titulo, setTitulo] = useState('');
  const [pastaId, setPastaId] = useState('');
  const [busca, setBusca] = useState('');
  const [ocupado, setOcupado] = useState(false);

  const pastas = useMemo(() => {
    const editaveis = lists.filter((l) => (l.access ?? 'owner') === 'owner' || l.access === 'edit');
    return achatarArvore(montarArvorePastas(editaveis));
  }, [lists]);

  useEffect(() => {
    lerCompartilhado().then((r) => {
      setCarregando(false);
      if (!r) return;
      const t = textoDe(r.meta);
      setTexto(t);
      setArquivos(r.arquivos);
      const linha = t.split('\n').find((l) => l.trim()) ?? '';
      setTitulo(linha ? (linha.length > 120 ? `${linha.slice(0, 117).trimEnd()}…` : linha) : (r.arquivos[0]?.name ?? ''));
    }).catch(() => setCarregando(false));
  }, []);

  // Pasta: a última usada aqui, se ainda existir; senão a primeira.
  useEffect(() => {
    if (pastaId || !pastas.length) return;
    let salva = '';
    try { salva = localStorage.getItem(CHAVE_PASTA) ?? ''; } catch { /* sem localStorage */ }
    setPastaId(pastas.some((p) => p.id === salva) ? salva : pastas[0].id);
  }, [pastas, pastaId]);

  const anexarTodos = async (taskId: string): Promise<number> => {
    let falhas = 0;
    for (const f of arquivos) {
      const r = await enviarAnexo(f, taskId);
      if (!r.success) falhas++;
    }
    return falhas;
  };

  const criar = async () => {
    const t = titulo.trim();
    if (!t || !pastaId) return;
    setOcupado(true);
    const res = await write('create_task', { list_id: pastaId, title: t, description: texto || null });
    if (!res.success || !res.id) { setOcupado(false); toast.error('Erro ao criar a tarefa', res.error); return; }
    try { localStorage.setItem(CHAVE_PASTA, pastaId); } catch { /* sem localStorage */ }
    const falhas = await anexarTodos(res.id);
    setOcupado(false);
    if (falhas) toast.error('Tarefa criada', `${falhas} arquivo(s) não foram anexados. Anexe de novo pela tarefa.`);
    else toast.success('Tarefa criada');
    await limparCompartilhado();
    onClose();
    onOpenTask(res.id);
  };

  const juntar = async (taskId: string) => {
    setOcupado(true);
    if (texto) {
      const r = await write('add_comment', { task_id: taskId, body: texto, mentions: [] });
      if (!r.success) { setOcupado(false); toast.error('Não consegui juntar à tarefa', r.error); return; }
    }
    const falhas = await anexarTodos(taskId);
    setOcupado(false);
    if (falhas) toast.error('Juntado à tarefa', `${falhas} arquivo(s) não foram anexados.`);
    else toast.success('Juntado à tarefa');
    await limparCompartilhado();
    onClose();
    onOpenTask(taskId);
  };

  const abertas = tasks
    .filter((t) => t.status_category !== 'done' && t.status_category !== 'cancelled')
    .filter((t) => !busca.trim() || t.title.toLowerCase().includes(busca.trim().toLowerCase()))
    .slice(0, 12);
  const vazio = !carregando && !texto && !arquivos.length;

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center bg-slate-900/30 sm:p-4" onClick={fechar}>
      <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-xl w-full max-w-md max-h-[92vh] overflow-y-auto p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 mb-3">
          <Share2 size={16} className="text-indigo-600" />
          <h3 className="text-sm font-semibold text-slate-800 flex-1">Compartilhado com o ERPOS</h3>
          <button onClick={fechar} className="p-1 rounded-lg text-slate-400 hover:bg-slate-100" aria-label="Fechar"><X size={16} /></button>
        </div>

        {carregando && <p className="text-sm text-slate-400 flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Lendo o que foi compartilhado…</p>}
        {vazio && <p className="text-sm text-slate-500">Não chegou nada do compartilhamento. Tente compartilhar de novo.</p>}

        {!carregando && !vazio && (
          <>
            {texto && <p className="text-sm text-slate-700 whitespace-pre-wrap break-words bg-slate-50 rounded-lg p-2.5 max-h-40 overflow-y-auto">{texto}</p>}
            {arquivos.length > 0 && (
              <ul className="mt-2 space-y-1">
                {arquivos.map((f, i) => (
                  <li key={i} className="flex items-center gap-1.5 text-xs text-slate-600">
                    <Paperclip size={12} className="text-slate-400 shrink-0" />
                    <span className="truncate">{f.name}</span>
                    <span className="text-slate-400 shrink-0">({Math.max(1, Math.round(f.size / 1024))} KB)</span>
                  </li>
                ))}
              </ul>
            )}

            <div className="mt-4 grid grid-cols-2 gap-1 p-1 bg-slate-100 rounded-xl text-xs">
              <button onClick={() => setModo('tarefa')} className={`flex items-center justify-center gap-1 py-1.5 rounded-lg ${modo === 'tarefa' ? 'bg-white shadow-sm text-indigo-600 font-semibold' : 'text-slate-500'}`}>
                <Plus size={13} /> Tarefa nova
              </button>
              <button onClick={() => setModo('juntar')} className={`flex items-center justify-center gap-1 py-1.5 rounded-lg ${modo === 'juntar' ? 'bg-white shadow-sm text-indigo-600 font-semibold' : 'text-slate-500'}`}>
                <MessageSquarePlus size={13} /> Juntar a uma tarefa
              </button>
            </div>

            {modo === 'tarefa' && (
              <div className="mt-3 space-y-2">
                <label className="block text-xs text-slate-500">
                  Título
                  <input
                    value={titulo}
                    onChange={(e) => setTitulo(e.target.value)}
                    autoComplete="off"
                    className="mt-1 w-full text-sm px-2.5 py-2 rounded-lg border border-slate-300 text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-200"
                  />
                </label>
                <label className="block text-xs text-slate-500">
                  Pasta
                  <select
                    value={pastaId}
                    onChange={(e) => setPastaId(e.target.value)}
                    className="mt-1 w-full text-sm px-2 py-2 rounded-lg border border-slate-300 bg-white text-slate-800"
                  >
                    {pastas.map((p) => (
                      <option key={p.id} value={p.id}>{`${'  '.repeat(p.profundidade)}${p.profundidade ? '↳ ' : ''}${p.name}`}</option>
                    ))}
                  </select>
                </label>
                {!pastas.length && <p className="text-xs text-amber-600">Você não tem pasta em que possa criar tarefa. Crie uma pasta primeiro.</p>}
                <button
                  onClick={criar}
                  disabled={ocupado || !titulo.trim() || !pastaId}
                  className="w-full flex items-center justify-center gap-1.5 text-sm py-2.5 rounded-xl bg-indigo-600 text-white font-semibold disabled:opacity-50"
                >
                  {ocupado && <Loader2 size={14} className="animate-spin" />} Criar tarefa
                </button>
              </div>
            )}

            {modo === 'juntar' && (
              <div className="mt-3">
                <input
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  placeholder="Procurar tarefa…"
                  autoComplete="off"
                  className="w-full text-sm px-2.5 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-200"
                />
                <ul className="mt-1.5 max-h-64 overflow-y-auto divide-y divide-slate-100 rounded-lg border border-slate-200">
                  {abertas.map((t) => (
                    <li key={t.id}>
                      <button onClick={() => juntar(t.id)} disabled={ocupado} className="w-full text-left px-2.5 py-2 hover:bg-indigo-50 disabled:opacity-50">
                        <span className="block text-sm text-slate-800 truncate">{t.title}</span>
                        {t.list_name && <span className="block text-[11px] text-slate-400 truncate">{t.list_name}</span>}
                      </button>
                    </li>
                  ))}
                  {!abertas.length && <li className="text-xs text-slate-400 px-2.5 py-2">Nenhuma tarefa aberta com esse nome.</li>}
                </ul>
                <p className="mt-1.5 text-[11px] text-slate-400">O texto entra como comentário e os arquivos como anexos da tarefa.</p>
              </div>
            )}
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
