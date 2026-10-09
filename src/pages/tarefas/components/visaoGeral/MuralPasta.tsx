import { useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react';
import {
  Pin, PinOff, Link2, Mail, Phone, StickyNote, Paperclip, FileText, FileSpreadsheet, FileImage, FileArchive,
  File as IconeArquivo, MoreHorizontal, Pencil, Trash2, ArrowLeft, ArrowRight, X, Info, Loader2, Upload,
} from 'lucide-react';
import { useToast } from '@/contexts/ToastContext';
import ConfirmDialog from '../ConfirmDialog';
import { useVoltarFecha } from '../../lib/mobile';
import {
  CORES_NOTA, ordenarMural, pareceLink, hrefSeguro, rotuloLink, tamanhoArquivo,
  listarMural, criarItemMural, atualizarItemMural, excluirItemMural, enviarArquivoMural,
  type ItemMural, type TipoMural,
} from './muralApi';

/**
 * Mural da pasta (2026-10-09): notas, links e arquivos que a equipe da pasta
 * quer ter à mão. Escrever e Enter cria uma nota; colar um link cria um link;
 * arrastar/colar um arquivo (foto, PDF, planilha) guarda o arquivo. Fixados
 * ficam na frente. Quem só pode ver a pasta só vê o mural.
 */

/** Lista guardada por pasta: voltar para a Visão geral não pisca vazio. */
const cache = new Map<string, { itens: ItemMural[]; podeEditar: boolean }>();
/** Quantos aparecem antes do "Ver todos" (uma fileira no computador, 4 linhas no celular). */
const VISIVEIS = 4;

type Janela =
  | { modo: 'ver'; item: ItemMural }
  | { modo: 'editar'; item: ItemMural }
  | { modo: 'novo'; kind: 'note' | 'link' };

function quando(iso: string): string {
  const d = new Date(iso);
  const dias = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (dias < 1) {
    const h = Math.floor((Date.now() - d.getTime()) / 3600000);
    return h < 1 ? 'agora há pouco' : `há ${h} h`;
  }
  if (dias === 1) return 'ontem';
  if (dias < 7) return `há ${dias} dias`;
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
}

/** Texto com os endereços clicáveis (http(s) e www.). */
function ComLinks({ texto }: { texto: string }) {
  const partes = texto.split(/((?:https?:\/\/|www\.)[^\s<>"]+)/gi);
  return (
    <>
      {partes.map((p, i) => {
        if (i % 2 === 0) return p;
        const href = /^www\./i.test(p) ? `https://${p}` : p;
        return (
          <a key={i} href={href} target="_blank" rel="noopener noreferrer" className="text-indigo-600 underline break-all" onClick={(e) => e.stopPropagation()}>
            {p}
          </a>
        );
      })}
    </>
  );
}

function iconeArquivo(item: ItemMural): { Icone: typeof IconeArquivo; cor: string } {
  const mime = item.file_mime ?? '';
  const nome = (item.file_name ?? '').toLowerCase();
  if (mime.startsWith('image/')) return { Icone: FileImage, cor: 'text-sky-500 bg-sky-50' };
  if (mime === 'application/pdf' || nome.endsWith('.pdf')) return { Icone: FileText, cor: 'text-red-500 bg-red-50' };
  if (/sheet|excel|csv/.test(mime) || /\.(xlsx?|csv|ods)$/.test(nome)) return { Icone: FileSpreadsheet, cor: 'text-emerald-600 bg-emerald-50' };
  if (/zip|rar|7z|compressed/.test(mime) || /\.(zip|rar|7z)$/.test(nome)) return { Icone: FileArchive, cor: 'text-amber-600 bg-amber-50' };
  return { Icone: IconeArquivo, cor: 'text-slate-500 bg-slate-100' };
}

export default function MuralPasta({ listId }: { listId: string }) {
  const toast = useToast();
  const guardado = cache.get(listId);
  const [itens, setItens] = useState<ItemMural[] | null>(guardado?.itens ?? null);
  const [podeEditar, setPodeEditar] = useState(guardado?.podeEditar ?? false);
  const [erro, setErro] = useState<string | null>(null);
  const [texto, setTexto] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [enviando, setEnviando] = useState(0);
  const [verTodos, setVerTodos] = useState(false);
  const [janela, setJanela] = useState<Janela | null>(null);
  const [excluindo, setExcluindo] = useState<ItemMural | null>(null);
  const [arrastando, setArrastando] = useState(false);
  const [verDica, setVerDica] = useState(false);
  const inputArquivo = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let vivo = true;
    listarMural(listId).then((r) => {
      if (!vivo) return;
      if (!r.ok) { setErro(r.error); return; }
      setErro(null);
      const lista = ordenarMural(r.data.items);
      setItens(lista);
      setPodeEditar(r.data.can_edit);
      cache.set(listId, { itens: lista, podeEditar: r.data.can_edit });
    });
    return () => { vivo = false; };
  }, [listId]);

  const mudarLista = (f: (atual: ItemMural[]) => ItemMural[]) => {
    setItens((atual) => {
      const nova = ordenarMural(f(atual ?? []));
      cache.set(listId, { itens: nova, podeEditar });
      return nova;
    });
  };
  const trocarItem = (item: ItemMural) => mudarLista((l) => l.map((i) => (i.id === item.id ? item : i)));

  const adicionarRapido = async () => {
    const t = texto.trim();
    if (!t || salvando) return;
    setSalvando(true);
    const r = pareceLink(t)
      ? await criarItemMural(listId, { kind: 'link', url: t })
      : await criarItemMural(listId, { kind: 'note', body: t });
    setSalvando(false);
    if (!r.ok) { toast.error('Não deu para adicionar', r.error); return; }
    setTexto('');
    mudarLista((l) => [...l, r.data.item]);
  };

  const enviarArquivos = async (arquivos: File[]) => {
    if (!arquivos.length || !podeEditar) return;
    setEnviando(arquivos.length);
    for (const f of arquivos) {
      const r = await enviarArquivoMural(listId, f);
      if (r.ok) mudarLista((l) => [...l, r.data.item]);
      else toast.error('Arquivo não foi guardado', r.error);
      setEnviando((n) => Math.max(0, n - 1));
    }
  };

  const salvarAlteracao = async (item: ItemMural, patch: Parameters<typeof atualizarItemMural>[1]) => {
    const r = await atualizarItemMural(item.id, patch);
    if (!r.ok) { toast.error('Não deu para salvar', r.error); return null; }
    trocarItem(r.data.item);
    return r.data.item;
  };

  /** Anda uma casa para a esquerda/direita dentro do mesmo grupo (fixados × não fixados). */
  const mover = (item: ItemMural, direcao: -1 | 1) => {
    const grupo = (itens ?? []).filter((i) => i.pinned === item.pinned);
    const idx = grupo.findIndex((i) => i.id === item.id);
    const alvo = idx + direcao;
    if (alvo < 0 || alvo >= grupo.length) return;
    const vizinho = grupo[alvo];
    const alem = grupo[alvo + direcao];
    const posicao = alem ? (vizinho.position + alem.position) / 2 : vizinho.position + direcao;
    trocarItem({ ...item, position: posicao }); // otimista
    atualizarItemMural(item.id, { position: posicao }).then((r) => {
      if (!r.ok) { toast.error('Não deu para mover', r.error); trocarItem(item); }
    });
  };

  const confirmarExclusao = async () => {
    const item = excluindo;
    setExcluindo(null);
    if (!item) return;
    const r = await excluirItemMural(item.id);
    if (!r.ok) { toast.error('Não deu para excluir', r.error); return; }
    mudarLista((l) => l.filter((i) => i.id !== item.id));
  };

  const aoArrastar = (e: DragEvent) => {
    if (!podeEditar || !e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    setArrastando(true);
  };
  const aoSoltar = (e: DragEvent) => {
    if (!podeEditar) return;
    e.preventDefault();
    setArrastando(false);
    enviarArquivos([...e.dataTransfer.files]);
  };

  const lista = itens ?? [];
  const visiveis = verTodos ? lista : lista.slice(0, VISIVEIS);

  return (
    <section
      className="relative bg-white rounded-xl border border-slate-200 p-4 min-w-0"
      onDragOver={aoArrastar}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setArrastando(false); }}
      onDrop={aoSoltar}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-2 mb-3">
        <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-1.5">
          <StickyNote size={15} className="text-amber-500" /> Mural da pasta
          {lista.length > 0 && <span className="text-xs font-normal text-slate-400">{lista.length}</span>}
        </h3>
        <button
          type="button"
          onClick={() => setVerDica((v) => !v)}
          className={`p-0.5 rounded ${verDica ? 'text-indigo-500' : 'text-slate-300 hover:text-slate-500'}`}
          aria-label="Sobre o mural"
          title="Quem tem acesso à pasta vê o mural"
        >
          <Info size={13} />
        </button>
        {podeEditar && (
          <div className="ml-auto flex items-center gap-1">
            <BotaoAdd icone={<StickyNote size={13} />} rotulo="Nota" onClick={() => setJanela({ modo: 'novo', kind: 'note' })} />
            <BotaoAdd icone={<Link2 size={13} />} rotulo="Link" onClick={() => setJanela({ modo: 'novo', kind: 'link' })} />
            <BotaoAdd icone={<Paperclip size={13} />} rotulo="Arquivo" onClick={() => inputArquivo.current?.click()} />
            <input
              ref={inputArquivo}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => { enviarArquivos([...(e.target.files ?? [])]); e.target.value = ''; }}
            />
          </div>
        )}
      </div>
      {verDica && (
        <p className="-mt-1 mb-3 text-xs text-slate-500 bg-slate-50 rounded-lg px-3 py-2">
          Notas, links e arquivos desta pasta, para ter tudo à mão. Quem tem acesso à pasta vê o mural; quem pode editar a pasta também
          adiciona, fixa e exclui. Escreva e aperte Enter para criar uma nota; cole um endereço para criar um link; arraste ou cole um
          arquivo (até 20 MB). Não guarde senhas nem dados de cartão aqui.
        </p>
      )}

      {podeEditar && (
        <div className="flex items-center gap-2 mb-3">
          <input
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); adicionarRapido(); } }}
            onPaste={(e) => {
              const arquivos = [...e.clipboardData.files];
              if (arquivos.length) { e.preventDefault(); enviarArquivos(arquivos); }
            }}
            placeholder="Escreva uma nota ou cole um link…"
            className="flex-1 min-w-0 border border-slate-200 rounded-lg px-3 py-2 text-base md:text-sm outline-none focus:border-indigo-300 bg-slate-50/60 focus:bg-white"
          />
          {texto.trim() && (
            <button
              type="button"
              onClick={adicionarRapido}
              disabled={salvando}
              className="shrink-0 px-3 py-2 rounded-lg bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-700 disabled:opacity-50"
            >
              {salvando ? <Loader2 size={14} className="animate-spin" /> : pareceLink(texto) ? 'Guardar link' : 'Guardar nota'}
            </button>
          )}
        </div>
      )}

      {erro && !itens && <p className="text-sm text-red-500 py-2">Não deu para abrir o mural: {erro}</p>}
      {!itens && !erro && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
          {[0, 1, 2, 3].map((i) => <div key={i} className="h-[72px] sm:h-20 rounded-xl bg-slate-100 animate-pulse" />)}
        </div>
      )}
      {itens && lista.length === 0 && enviando === 0 && (
        <p className="text-sm text-slate-500 py-2">
          {podeEditar
            ? 'Guarde aqui o que a equipe precisa ter à mão: combinados, links de planilhas, contatos, fotos e PDFs.'
            : 'O mural desta pasta está vazio.'}
        </p>
      )}

      {(lista.length > 0 || enviando > 0) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
          {visiveis.map((item) => (
            <CartaoItem
              key={item.id}
              item={item}
              podeEditar={podeEditar}
              onVer={() => setJanela({ modo: 'ver', item })}
              onEditar={() => setJanela({ modo: 'editar', item })}
              onFixar={() => salvarAlteracao(item, { pinned: !item.pinned })}
              onMover={(d) => mover(item, d)}
              onExcluir={() => setExcluindo(item)}
            />
          ))}
          {Array.from({ length: enviando }, (_, i) => (
            <div key={`env-${i}`} className="h-[72px] sm:h-20 rounded-xl border border-dashed border-indigo-200 bg-indigo-50/50 flex items-center justify-center gap-2 text-xs text-indigo-600">
              <Loader2 size={14} className="animate-spin" /> Enviando…
            </div>
          ))}
        </div>
      )}
      {lista.length > VISIVEIS && (
        <button type="button" onClick={() => setVerTodos((v) => !v)} className="mt-2.5 text-xs text-indigo-600 hover:underline">
          {verTodos ? 'Mostrar menos' : `Ver todos (${lista.length})`}
        </button>
      )}

      {arrastando && (
        <div className="absolute inset-0 z-10 rounded-xl border-2 border-dashed border-indigo-400 bg-indigo-50/90 flex flex-col items-center justify-center gap-1 text-sm text-indigo-700 pointer-events-none">
          <Upload size={20} /> Solte para guardar no mural
        </div>
      )}

      {janela && (
        <JanelaItem
          key={janela.modo === 'novo' ? `novo-${janela.kind}` : janela.item.id}
          janela={janela}
          podeEditar={podeEditar}
          onFechar={() => setJanela(null)}
          onEditar={(item) => setJanela({ modo: 'editar', item })}
          onCriar={async (dados) => {
            const r = await criarItemMural(listId, dados);
            if (!r.ok) { toast.error('Não deu para adicionar', r.error); return false; }
            mudarLista((l) => [...l, r.data.item]);
            return true;
          }}
          onSalvar={async (item, patch) => !!(await salvarAlteracao(item, patch))}
          onExcluir={(item) => { setJanela(null); setExcluindo(item); }}
        />
      )}
      {excluindo && (
        <ConfirmDialog
          titulo={`Excluir ${excluindo.kind === 'note' ? 'a nota' : excluindo.kind === 'link' ? 'o link' : 'o arquivo'}?`}
          descricao={excluindo.kind === 'file' ? 'O arquivo é apagado do mural para todos.' : 'Sai do mural para todos que têm acesso à pasta.'}
          textoConfirmar="Excluir"
          perigo
          onConfirmar={confirmarExclusao}
          onCancelar={() => setExcluindo(null)}
        />
      )}
    </section>
  );
}

function BotaoAdd({ icone, rotulo, onClick }: { icone: ReactNode; rotulo: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1 text-xs px-2 py-1.5 rounded-lg text-slate-600 border border-slate-200 hover:border-indigo-200 hover:text-indigo-600 active:bg-slate-50"
      title={`Adicionar ${rotulo.toLowerCase()}`}
    >
      {icone} {rotulo}
    </button>
  );
}

function CartaoItem({ item, podeEditar, onVer, onEditar, onFixar, onMover, onExcluir }: {
  item: ItemMural;
  podeEditar: boolean;
  onVer: () => void;
  onEditar: () => void;
  onFixar: () => void;
  onMover: (d: -1 | 1) => void;
  onExcluir: () => void;
}) {
  const [menu, setMenu] = useState(false);
  const base = 'w-full h-[72px] sm:h-20 rounded-xl border text-left flex items-stretch overflow-hidden transition hover:shadow-sm';
  let conteudo: ReactNode;

  if (item.kind === 'note') {
    const cor = item.color ?? '#f59e0b';
    conteudo = (
      <button
        type="button"
        onClick={onVer}
        className={`${base} px-3 py-2 flex-col gap-0.5`}
        style={{ borderColor: `${cor}55`, backgroundColor: `${cor}12` }}
      >
        {item.title && <span className="text-sm font-medium text-slate-800 truncate pr-5">{item.title}</span>}
        {item.body && (
          <span className={`text-xs text-slate-600 whitespace-pre-line break-words ${item.title ? 'line-clamp-2' : 'line-clamp-3 pr-5'}`}>{item.body}</span>
        )}
      </button>
    );
  } else if (item.kind === 'link') {
    const href = hrefSeguro(item.url);
    const Icone = /^mailto:/i.test(item.url ?? '') ? Mail : /^tel:/i.test(item.url ?? '') ? Phone : Link2;
    conteudo = (
      <a
        href={href ?? undefined}
        target="_blank"
        rel="noopener noreferrer"
        title={[item.title, item.url, item.body].filter(Boolean).join('\n')}
        className={`${base} border-slate-200 bg-white hover:border-indigo-200 items-center gap-2.5 px-3`}
      >
        <span className="w-9 h-9 rounded-lg bg-indigo-50 text-indigo-500 flex items-center justify-center shrink-0"><Icone size={16} /></span>
        <span className="min-w-0 flex-1 pr-4">
          <span className="block text-sm font-medium text-slate-800 truncate">{item.title || rotuloLink(item.url ?? '')}</span>
          <span className="block text-[11px] text-slate-400 truncate">{item.body || rotuloLink(item.url ?? '')}</span>
        </span>
      </a>
    );
  } else {
    const imagem = (item.file_mime ?? '').startsWith('image/') && item.file_url;
    const { Icone, cor } = iconeArquivo(item);
    conteudo = (
      <a
        href={item.file_url ?? undefined}
        target="_blank"
        rel="noopener noreferrer"
        title={[item.title, item.file_name, item.body].filter(Boolean).join('\n')}
        className={`${base} border-slate-200 bg-white hover:border-indigo-200 items-center gap-2.5 ${imagem ? 'pr-3' : 'px-3'}`}
      >
        {imagem
          ? <img src={item.file_url!} alt="" loading="lazy" className="w-16 h-full object-cover shrink-0 bg-slate-100" />
          : <span className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${cor}`}><Icone size={16} /></span>}
        <span className="min-w-0 flex-1 pr-4">
          <span className="block text-sm font-medium text-slate-800 truncate">{item.title || item.file_name}</span>
          <span className="block text-[11px] text-slate-400 truncate">
            {item.body || [tamanhoArquivo(item.file_size), (item.file_name ?? '').split('.').pop()?.toUpperCase()].filter(Boolean).join(' · ')}
          </span>
        </span>
      </a>
    );
  }

  return (
    <div className="group relative min-w-0">
      {conteudo}
      {item.pinned && (
        <Pin size={11} className={`absolute top-1.5 ${podeEditar ? 'right-7' : 'right-2'} text-slate-400 fill-slate-300 pointer-events-none`} />
      )}
      {podeEditar && (
        <>
          <button
            type="button"
            onClick={() => setMenu((m) => !m)}
            className="absolute top-1 right-1 p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-white/80 md:opacity-0 md:group-hover:opacity-100 focus:opacity-100"
            aria-label="Opções"
          >
            <MoreHorizontal size={15} />
          </button>
          {menu && (
            <>
              <div className="fixed inset-0 z-20" onClick={() => setMenu(false)} />
              <ul className="absolute right-1 top-8 z-30 w-48 bg-white border border-slate-200 rounded-lg shadow-lg py-1 text-sm">
                <ItemMenu icone={<Pencil size={13} />} onClick={() => { setMenu(false); onEditar(); }}>
                  {item.kind === 'file' ? 'Renomear' : 'Editar'}
                </ItemMenu>
                <ItemMenu icone={item.pinned ? <PinOff size={13} /> : <Pin size={13} />} onClick={() => { setMenu(false); onFixar(); }}>
                  {item.pinned ? 'Desafixar' : 'Fixar na frente'}
                </ItemMenu>
                <ItemMenu icone={<ArrowLeft size={13} />} onClick={() => { setMenu(false); onMover(-1); }}>Mover para trás</ItemMenu>
                <ItemMenu icone={<ArrowRight size={13} />} onClick={() => { setMenu(false); onMover(1); }}>Mover para a frente</ItemMenu>
                <ItemMenu icone={<Trash2 size={13} />} perigo onClick={() => { setMenu(false); onExcluir(); }}>Excluir</ItemMenu>
              </ul>
            </>
          )}
        </>
      )}
    </div>
  );
}

function ItemMenu({ icone, children, onClick, perigo = false }: { icone: ReactNode; children: ReactNode; onClick: () => void; perigo?: boolean }) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className={`w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-slate-50 ${perigo ? 'text-red-600' : 'text-slate-700'}`}
      >
        {icone} {children}
      </button>
    </li>
  );
}

function JanelaItem({ janela, podeEditar, onFechar, onEditar, onCriar, onSalvar, onExcluir }: {
  janela: Janela;
  podeEditar: boolean;
  onFechar: () => void;
  onEditar: (item: ItemMural) => void;
  onCriar: (dados: { kind: 'note' | 'link'; title: string | null; body: string | null; url?: string | null; color?: string | null; pinned?: boolean }) => Promise<boolean>;
  onSalvar: (item: ItemMural, patch: Parameters<typeof atualizarItemMural>[1]) => Promise<boolean>;
  onExcluir: (item: ItemMural) => void;
}) {
  useVoltarFecha(true, onFechar, 'mural-item');
  const item = janela.modo === 'novo' ? null : janela.item;
  const kind: TipoMural = janela.modo === 'novo' ? janela.kind : janela.item.kind;
  const [titulo, setTitulo] = useState(item?.title ?? '');
  const [corpo, setCorpo] = useState(item?.body ?? '');
  const [url, setUrl] = useState(item?.url ?? '');
  const [cor, setCor] = useState(item?.color ?? CORES_NOTA[0].cor);
  const [fixar, setFixar] = useState(item?.pinned ?? false);
  const [salvando, setSalvando] = useState(false);

  const salvar = async () => {
    if (salvando) return;
    setSalvando(true);
    const t = titulo.trim() || null;
    const b = corpo.trim() || null;
    let ok: boolean;
    if (janela.modo === 'novo') {
      ok = await onCriar({ kind: janela.kind, title: t, body: b, ...(janela.kind === 'link' ? { url: url.trim() } : { color: cor }), pinned: fixar });
    } else {
      const it = janela.item;
      ok = await onSalvar(it, {
        title: t, body: b,
        ...(it.kind === 'link' ? { url: url.trim() } : {}),
        ...(it.kind === 'note' ? { color: cor } : {}),
        ...(fixar !== it.pinned ? { pinned: fixar } : {}),
      });
    }
    setSalvando(false);
    if (ok) onFechar();
  };

  const podeSalvar = kind === 'link' ? !!url.trim() : kind === 'note' ? !!(titulo.trim() || corpo.trim()) : true;
  const tituloJanela = janela.modo === 'novo'
    ? (kind === 'note' ? 'Nova nota' : 'Novo link')
    : janela.modo === 'editar' ? (kind === 'note' ? 'Editar nota' : kind === 'link' ? 'Editar link' : 'Arquivo') : null;

  return (
    <div className="fixed inset-0 z-[55] flex items-end md:items-center justify-center bg-black/30 md:p-4" onClick={onFechar}>
      <div
        className="bg-white w-full md:max-w-lg rounded-t-2xl md:rounded-2xl shadow-xl max-h-[88vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => { if (e.key === 'Escape') onFechar(); if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && janela.modo !== 'ver') salvar(); }}
      >
        {janela.modo === 'ver' ? (
          <>
            <div className="flex items-start gap-2 px-5 pt-5 pb-3" style={{ borderTop: `4px solid ${janela.item.color ?? '#f59e0b'}`, borderTopLeftRadius: 16, borderTopRightRadius: 16 }}>
              <h3 className="flex-1 text-base font-semibold text-slate-800 break-words">{janela.item.title || 'Nota'}</h3>
              <button type="button" onClick={onFechar} className="p-1 -mr-1 rounded-lg text-slate-400 hover:bg-slate-100" aria-label="Fechar"><X size={18} /></button>
            </div>
            <div className="px-5 pb-4 overflow-y-auto text-sm text-slate-700 whitespace-pre-wrap break-words leading-relaxed">
              {janela.item.body ? <ComLinks texto={janela.item.body} /> : <span className="text-slate-400">Sem texto.</span>}
            </div>
            <div className="px-5 py-3 border-t border-slate-100 flex items-center gap-2">
              <span className="text-[11px] text-slate-400 mr-auto">
                {janela.item.created_by_name ? `${janela.item.created_by_name.split(' ')[0]} · ` : ''}{quando(janela.item.created_at)}
                {janela.item.updated_by && janela.item.updated_at !== janela.item.created_at
                  ? ` · editada${janela.item.updated_by_name ? ` por ${janela.item.updated_by_name.split(' ')[0]}` : ''} ${quando(janela.item.updated_at)}`
                  : ''}
              </span>
              {podeEditar && (
                <button type="button" onClick={() => onEditar(janela.item)} className="flex items-center gap-1 px-3 py-2 rounded-lg text-sm text-indigo-600 hover:bg-indigo-50">
                  <Pencil size={13} /> Editar
                </button>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center gap-2 px-5 pt-5 pb-3">
              <h3 className="flex-1 text-base font-semibold text-slate-800">{tituloJanela}</h3>
              <button type="button" onClick={onFechar} className="p-1 -mr-1 rounded-lg text-slate-400 hover:bg-slate-100" aria-label="Fechar"><X size={18} /></button>
            </div>
            <div className="px-5 pb-4 space-y-3 overflow-y-auto">
              {kind === 'link' && (
                <Campo rotulo="Endereço">
                  <input
                    autoFocus
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="https://… , e-mail (mailto:…) ou telefone (tel:…)"
                    className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-base md:text-sm outline-none focus:border-indigo-300"
                  />
                </Campo>
              )}
              {kind === 'file' && item && (
                <p className="text-xs text-slate-500">Arquivo: <span className="text-slate-700">{item.file_name}</span> {item.file_size ? `· ${tamanhoArquivo(item.file_size)}` : ''}</p>
              )}
              <Campo rotulo={kind === 'note' ? 'Título (opcional)' : kind === 'link' ? 'Nome (opcional)' : 'Nome que aparece'}>
                <input
                  autoFocus={kind !== 'link'}
                  value={titulo}
                  onChange={(e) => setTitulo(e.target.value)}
                  maxLength={200}
                  placeholder={kind === 'note' ? 'Ex.: Combinado com o fornecedor' : kind === 'link' ? 'Ex.: Planilha do orçamento' : item?.file_name ?? ''}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-base md:text-sm outline-none focus:border-indigo-300"
                />
              </Campo>
              <Campo rotulo={kind === 'note' ? 'Texto' : 'Observação (opcional)'}>
                <textarea
                  value={corpo}
                  onChange={(e) => setCorpo(e.target.value)}
                  rows={kind === 'note' ? 8 : 2}
                  maxLength={20000}
                  placeholder={kind === 'note' ? 'Escreva à vontade. Endereços viram link.' : 'Para que serve, quem passou…'}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-base md:text-sm outline-none focus:border-indigo-300 resize-y"
                />
              </Campo>
              {kind === 'note' && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-500 mr-1">Cor</span>
                  {CORES_NOTA.map((c) => (
                    <button
                      key={c.cor}
                      type="button"
                      onClick={() => setCor(c.cor)}
                      title={c.nome}
                      aria-label={c.nome}
                      className={`w-6 h-6 rounded-full transition ${cor === c.cor ? 'ring-2 ring-offset-2 ring-slate-400' : ''}`}
                      style={{ backgroundColor: c.cor }}
                    />
                  ))}
                </div>
              )}
              <label className="flex items-center gap-2 text-sm text-slate-600">
                <input type="checkbox" checked={fixar} onChange={(e) => setFixar(e.target.checked)} className="rounded border-slate-300" />
                Fixar na frente do mural
              </label>
            </div>
            <div className="px-5 py-3 border-t border-slate-100 flex items-center gap-2">
              {item && (
                <button type="button" onClick={() => onExcluir(item)} className="mr-auto flex items-center gap-1 px-2 py-2 rounded-lg text-sm text-red-600 hover:bg-red-50">
                  <Trash2 size={13} /> Excluir
                </button>
              )}
              <button type="button" onClick={onFechar} className="ml-auto px-3 py-2 rounded-lg text-sm text-slate-500 hover:bg-slate-100">Cancelar</button>
              <button
                type="button"
                onClick={salvar}
                disabled={!podeSalvar || salvando}
                className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-40"
              >
                {salvando ? 'Salvando…' : 'Salvar'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Campo({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs text-slate-500 mb-1">{rotulo}</span>
      {children}
    </label>
  );
}
