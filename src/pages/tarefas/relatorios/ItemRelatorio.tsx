/**
 * Um item do relatório com a sequência de respostas e a caixa de resposta.
 * Usado pelo dono (dentro de Tarefas) e por quem abre o link (/r/:token).
 */
import { useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ImagePlus, Loader2, Send, X, PencilLine, CheckCircle2, RotateCcw, MessageCircle, Plus } from 'lucide-react';
import { STATUS_INFO, dataHora, type ImagemRel, type ItemRel, type StatusItem } from './api';

export function StatusBadge({ status }: { status: StatusItem }) {
  const s = STATUS_INFO[status];
  return <span className={`shrink-0 text-[11px] font-medium px-2 py-0.5 rounded-full ${s.cor}`}>{s.label}</span>;
}

export function GradeImagens({ imagens, onRemover }: { imagens: ImagemRel[]; onRemover?: (i: number) => void }) {
  const [aberta, setAberta] = useState<string | null>(null);
  if (!imagens.length) return null;
  return (
    <>
      <div className="flex flex-wrap gap-2 mt-2">
        {imagens.map((img, i) => (
          <div key={img.path} className="relative">
            {img.url ? (
              <button type="button" onClick={() => setAberta(img.url!)} className="block">
                <img src={img.url} alt={img.name} className="w-20 h-20 md:w-24 md:h-24 object-cover rounded-lg border border-slate-200" loading="lazy" />
              </button>
            ) : (
              <div className="w-20 h-20 rounded-lg border border-dashed border-slate-300 text-[10px] text-slate-400 flex items-center justify-center p-1 text-center break-all">
                {img.name}
              </div>
            )}
            {onRemover && (
              <button
                type="button"
                onClick={() => onRemover(i)}
                className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-slate-800 text-white flex items-center justify-center"
                title="Tirar imagem"
              >
                <X size={13} />
              </button>
            )}
          </div>
        ))}
      </div>
      {aberta && createPortal(
        <div className="fixed inset-0 z-[100] bg-black/85 flex items-center justify-center p-3" onClick={() => setAberta(null)}>
          <img src={aberta} alt="" className="max-w-full max-h-full object-contain rounded" />
          <button className="absolute top-3 right-3 w-10 h-10 rounded-full bg-white/15 text-white flex items-center justify-center" onClick={() => setAberta(null)}>
            <X size={20} />
          </button>
        </div>,
        document.body,
      )}
    </>
  );
}

/** Campo de texto + anexar imagens (usado na resposta e no item novo). */
export function useAnexos(enviar: (f: File) => Promise<ImagemRel | null>) {
  const [imagens, setImagens] = useState<ImagemRel[]>([]);
  const [enviando, setEnviando] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const escolher = async (files: FileList | null) => {
    if (!files?.length) return;
    const lista = Array.from(files).slice(0, 8);
    setEnviando((n) => n + lista.length);
    for (const f of lista) {
      const img = await enviar(f);
      if (img) setImagens((a) => [...a, { ...img, url: URL.createObjectURL(f) }]);
      setEnviando((n) => n - 1);
    }
    if (input.current) input.current.value = '';
  };
  const botao = (
    <>
      <input ref={input} type="file" accept="image/*" multiple className="hidden" onChange={(e) => escolher(e.target.files)} />
      <button
        type="button"
        onClick={() => input.current?.click()}
        disabled={enviando > 0 || imagens.length >= 8}
        className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm text-slate-600 border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-50"
      >
        {enviando > 0 ? <Loader2 size={16} className="animate-spin" /> : <ImagePlus size={16} />}
        {enviando > 0 ? 'Enviando…' : 'Imagem'}
      </button>
    </>
  );
  return {
    imagens, enviando: enviando > 0, botao,
    remover: (i: number) => setImagens((a) => a.filter((_, j) => j !== i)),
    limpar: () => setImagens([]),
    /** Para gravar: sem a URL local de pré-visualização. */
    paraGravar: () => imagens.map(({ path, name }) => ({ path, name })),
  };
}

interface Props {
  item: ItemRel;
  numero: number;
  podeResponder: boolean;
  /** id do convidado atual (link) — as respostas dele aparecem como "você". */
  meuGuestId?: string | null;
  souDono?: boolean;
  onResponder: (body: string, imagens: ImagemRel[], novoStatus: StatusItem | null) => Promise<boolean>;
  onEnviarImagem: (f: File) => Promise<ImagemRel | null>;
  /** Ações do dono (editar/excluir) no cabeçalho do item. */
  acoes?: ReactNode;
}

export default function ItemRelatorio({ item, numero, podeResponder, meuGuestId, souDono, onResponder, onEnviarImagem, acoes }: Props) {
  const [texto, setTexto] = useState('');
  const [gravando, setGravando] = useState(false);
  const [aberto, setAberto] = useState(false);
  const anexos = useAnexos(onEnviarImagem);

  const enviar = async (novoStatus: StatusItem | null) => {
    if (gravando || anexos.enviando) return;
    if (!texto.trim() && !anexos.imagens.length && !novoStatus) return;
    setGravando(true);
    const ok = await onResponder(texto.trim(), anexos.paraGravar(), novoStatus);
    setGravando(false);
    if (ok) {
      setTexto('');
      anexos.limpar();
      setAberto(false);
    }
  };

  const respostas = item.responses;
  const temRascunho = !!texto.trim() || anexos.imagens.length > 0;

  return (
    <article className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <header className="px-4 pt-4 flex items-start gap-3">
        <span className="shrink-0 w-7 h-7 rounded-full bg-indigo-50 text-indigo-600 text-sm font-semibold flex items-center justify-center">{numero}</span>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold text-slate-800 break-words">{item.title}</h3>
            <StatusBadge status={item.status} />
          </div>
          {item.created_by_guest_name && (
            <p className="text-xs text-slate-400 mt-0.5">Incluído por {item.created_by_guest_name} · {dataHora(item.created_at)}</p>
          )}
        </div>
        {acoes}
      </header>
      <div className="px-4 pb-3 pl-14">
        {item.body && <p className="text-sm text-slate-600 whitespace-pre-wrap break-words mt-1">{item.body}</p>}
        <GradeImagens imagens={item.images} />
      </div>

      {respostas.length > 0 && (
        <ol className="border-t border-slate-100 bg-slate-50/60 px-4 py-3 space-y-3">
          {respostas.map((r) => {
            const minha = (meuGuestId && r.author_guest_id === meuGuestId) || (souDono && r.author_type === 'owner');
            const quem = <strong className="font-semibold text-slate-700">{r.author_name}{minha ? ' (você)' : ''}</strong>;
            if (r.kind === 'edit') {
              return (
                <li key={r.id} className="text-xs text-slate-500 flex gap-2">
                  <PencilLine size={14} className="shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    {quem} editou o item · {dataHora(r.created_at)}
                    {r.body && <details className="mt-0.5"><summary className="cursor-pointer">ver como era</summary><p className="whitespace-pre-wrap mt-1">{r.body}</p></details>}
                  </div>
                </li>
              );
            }
            return (
              <li key={r.id} className="flex gap-2">
                <span className={`shrink-0 w-7 h-7 rounded-full text-xs font-semibold flex items-center justify-center ${r.author_type === 'owner' ? 'bg-indigo-100 text-indigo-700' : 'bg-amber-100 text-amber-800'}`}>
                  {r.author_name.trim().charAt(0).toUpperCase()}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-slate-500">
                    {quem}
                    {r.author_type === 'owner' && <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-600">autor do relatório</span>}
                    <span className="ml-1">· {dataHora(r.created_at)}</span>
                  </p>
                  {r.body && <p className="text-sm text-slate-700 whitespace-pre-wrap break-words mt-0.5">{r.body}</p>}
                  <GradeImagens imagens={r.images} />
                  {r.new_status && (
                    <p className="text-xs text-slate-500 mt-1 flex items-center gap-1">
                      {r.new_status === 'resolved' ? <CheckCircle2 size={13} className="text-emerald-600" /> : <RotateCcw size={13} />}
                      marcou como <strong>{STATUS_INFO[r.new_status].label.toLowerCase()}</strong>
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {podeResponder && (
        <div className="border-t border-slate-100 px-4 py-3">
          {!aberto && !temRascunho ? (
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setAberto(true)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-indigo-600 text-white hover:bg-indigo-700"
              >
                <MessageCircle size={16} /> Responder
              </button>
              {item.status !== 'resolved' ? (
                <button
                  onClick={() => enviar('resolved')}
                  disabled={gravando}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm text-emerald-700 border border-emerald-200 hover:bg-emerald-50 disabled:opacity-50"
                >
                  <CheckCircle2 size={16} /> Marcar resolvido
                </button>
              ) : (
                <button
                  onClick={() => enviar('open')}
                  disabled={gravando}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm text-slate-600 border border-slate-200 hover:bg-slate-50 disabled:opacity-50"
                >
                  <RotateCcw size={16} /> Reabrir
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              <textarea
                value={texto}
                onChange={(e) => setTexto(e.target.value)}
                autoFocus
                rows={3}
                maxLength={5000}
                placeholder="Escreva sua resposta…"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-base md:text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200"
              />
              <GradeImagens imagens={anexos.imagens} onRemover={anexos.remover} />
              <div className="flex flex-wrap items-center gap-2">
                {anexos.botao}
                <div className="flex-1" />
                <button
                  onClick={() => { setAberto(false); setTexto(''); anexos.limpar(); }}
                  className="px-3 py-2 rounded-lg text-sm text-slate-500 hover:bg-slate-100"
                >
                  Cancelar
                </button>
                {item.status !== 'resolved' && (
                  <button
                    onClick={() => enviar('resolved')}
                    disabled={gravando || anexos.enviando}
                    className="px-3 py-2 rounded-lg text-sm text-emerald-700 border border-emerald-200 hover:bg-emerald-50 disabled:opacity-50"
                  >
                    Enviar e resolver
                  </button>
                )}
                <button
                  onClick={() => enviar(null)}
                  disabled={gravando || anexos.enviando || !temRascunho}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                  {gravando ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />} Enviar
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </article>
  );
}

/** Formulário de item novo (título, descrição, imagens). */
export function NovoItem({ onCriar, onEnviarImagem }: {
  onCriar: (title: string, body: string, images: ImagemRel[]) => Promise<boolean>;
  onEnviarImagem: (f: File) => Promise<ImagemRel | null>;
}) {
  const [aberto, setAberto] = useState(false);
  const [titulo, setTitulo] = useState('');
  const [corpo, setCorpo] = useState('');
  const [gravando, setGravando] = useState(false);
  const anexos = useAnexos(onEnviarImagem);

  if (!aberto) {
    return (
      <button
        onClick={() => setAberto(true)}
        className="w-full flex items-center justify-center gap-1.5 py-3 rounded-xl border-2 border-dashed border-slate-300 text-sm text-slate-500 hover:border-indigo-300 hover:text-indigo-600"
      >
        <Plus size={16} /> Incluir item
      </button>
    );
  }
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-2">
      <input
        value={titulo}
        onChange={(e) => setTitulo(e.target.value)}
        autoFocus
        maxLength={300}
        placeholder="Título do item"
        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-base md:text-sm font-medium focus:outline-none focus:ring-2 focus:ring-indigo-200"
      />
      <textarea
        value={corpo}
        onChange={(e) => setCorpo(e.target.value)}
        rows={3}
        maxLength={5000}
        placeholder="Descrição (opcional)"
        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-base md:text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200"
      />
      <GradeImagens imagens={anexos.imagens} onRemover={anexos.remover} />
      <div className="flex items-center gap-2">
        {anexos.botao}
        <div className="flex-1" />
        <button onClick={() => { setAberto(false); setTitulo(''); setCorpo(''); anexos.limpar(); }} className="px-3 py-2 rounded-lg text-sm text-slate-500 hover:bg-slate-100">Cancelar</button>
        <button
          disabled={!titulo.trim() || gravando || anexos.enviando}
          onClick={async () => {
            setGravando(true);
            const ok = await onCriar(titulo.trim(), corpo.trim(), anexos.paraGravar());
            setGravando(false);
            if (ok) { setAberto(false); setTitulo(''); setCorpo(''); anexos.limpar(); }
          }}
          className="px-4 py-2 rounded-lg text-sm font-medium bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          Incluir
        </button>
      </div>
    </div>
  );
}
