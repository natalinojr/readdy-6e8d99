/**
 * Um item do relatório com a sequência de respostas e a caixa de resposta.
 * Usado pela equipe (dentro de Tarefas) e por quem abre o link (/r/:token).
 */
import { useRef, useState, type ClipboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ImagePlus, Loader2, Send, X, PencilLine, CheckCircle2, RotateCcw, MessageCircle, Plus, ArrowRight } from 'lucide-react';
import { STATUS_INFO, dataHora, type CampoRel, type ImagemRel, type ItemRel, type StatusItem, type ValorCampo } from './api';
import { EditorCampos, PreencherCampos, erroPreenchimento, formatarValor, limparCampos, respostasMudadas, valoresAtuais } from './CamposResposta';

export function StatusBadge({ status }: { status: StatusItem }) {
  const s = STATUS_INFO[status];
  return <span className={`shrink-0 text-[11px] font-medium px-2 py-0.5 rounded-full ${s.cor}`}>{s.label}</span>;
}

/** Miniaturas. Com `onLegenda`, cada imagem ganha um campo de legenda (rascunho). */
export function GradeImagens({ imagens, onRemover, onLegenda }: {
  imagens: ImagemRel[];
  onRemover?: (i: number) => void;
  onLegenda?: (i: number, legenda: string) => void;
}) {
  const [aberta, setAberta] = useState<ImagemRel | null>(null);
  if (!imagens.length) return null;
  return (
    <>
      <div className="flex flex-wrap gap-3 mt-2">
        {imagens.map((img, i) => (
          <figure key={img.path} className={`relative ${onLegenda ? 'w-36' : 'w-20 md:w-24'}`}>
            {img.url ? (
              <button type="button" onClick={() => setAberta(img)} className="block w-full">
                <img src={img.url} alt={img.caption || img.name} className={`w-full ${onLegenda ? 'h-28' : 'h-20 md:h-24'} object-cover rounded-lg border border-slate-200`} loading="lazy" />
              </button>
            ) : (
              <div className="w-full h-20 rounded-lg border border-dashed border-slate-300 text-[10px] text-slate-400 flex items-center justify-center p-1 text-center break-all">
                {img.name}
              </div>
            )}
            {onLegenda ? (
              <input
                value={img.caption ?? ''}
                onChange={(e) => onLegenda(i, e.target.value)}
                maxLength={300}
                placeholder="Legenda"
                className="mt-1 w-full rounded border border-slate-200 px-2 py-1 text-base md:text-xs"
              />
            ) : img.caption ? (
              <figcaption className="mt-0.5 text-[11px] leading-tight text-slate-500 line-clamp-2 break-words" title={img.caption}>{img.caption}</figcaption>
            ) : null}
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
          </figure>
        ))}
      </div>
      {aberta?.url && createPortal(
        <div className="fixed inset-0 z-[100] bg-black/85 flex flex-col items-center justify-center p-3 gap-3" onClick={() => setAberta(null)}>
          <img src={aberta.url} alt="" className="max-w-full max-h-[85vh] object-contain rounded" />
          {aberta.caption && <p className="text-white text-sm text-center max-w-2xl whitespace-pre-wrap">{aberta.caption}</p>}
          <button className="absolute top-3 right-3 w-10 h-10 rounded-full bg-white/15 text-white flex items-center justify-center" onClick={() => setAberta(null)}>
            <X size={20} />
          </button>
        </div>,
        document.body,
      )}
    </>
  );
}

/**
 * Anexar imagens: botão, Ctrl+V (print colado) e legenda por imagem.
 * `aoColar` vai no onPaste do bloco do formulário — o evento sobe do campo de texto.
 */
export function useAnexos(enviar: (f: File) => Promise<ImagemRel | null>, iniciais: ImagemRel[] = []) {
  const [imagens, setImagens] = useState<ImagemRel[]>(iniciais);
  const [enviando, setEnviando] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const subir = async (arquivos: File[]) => {
    const lista = arquivos.slice(0, Math.max(0, 8 - imagens.length));
    if (!lista.length) return;
    setEnviando((n) => n + lista.length);
    for (const f of lista) {
      const img = await enviar(f);
      if (img) setImagens((a) => [...a, { ...img, url: URL.createObjectURL(f) }]);
      setEnviando((n) => n - 1);
    }
    if (input.current) input.current.value = '';
  };
  const aoColar = (e: ClipboardEvent) => {
    const arquivos = Array.from(e.clipboardData?.items ?? [])
      .filter((it) => it.kind === 'file' && it.type.startsWith('image/'))
      .map((it) => it.getAsFile())
      .filter((f): f is File => !!f)
      // Print colado vem como "image.png": um nome com hora ajuda a achar depois.
      .map((f) => (f.name && f.name !== 'image.png' ? f : new File([f], `print-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.png`, { type: f.type })));
    if (!arquivos.length) return; // texto colado segue normal
    e.preventDefault();
    subir(arquivos);
  };
  const botao = (
    <>
      <input ref={input} type="file" accept="image/*" multiple className="hidden" onChange={(e) => subir(Array.from(e.target.files ?? []))} />
      <button
        type="button"
        onClick={() => input.current?.click()}
        disabled={enviando > 0 || imagens.length >= 8}
        title="Também dá para colar uma imagem com Ctrl+V"
        className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm text-slate-600 border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-50"
      >
        {enviando > 0 ? <Loader2 size={16} className="animate-spin" /> : <ImagePlus size={16} />}
        {enviando > 0 ? 'Enviando…' : 'Imagem'}
      </button>
    </>
  );
  return {
    imagens, enviando: enviando > 0, botao, aoColar,
    remover: (i: number) => setImagens((a) => a.filter((_, j) => j !== i)),
    legendar: (i: number, legenda: string) => setImagens((a) => a.map((x, j) => (j === i ? { ...x, caption: legenda } : x))),
    limpar: () => setImagens([]),
    /** Para gravar: sem a URL de pré-visualização. */
    paraGravar: () => imagens.map(({ path, name, caption }) => ({ path, name, ...(caption?.trim() ? { caption: caption.trim() } : {}) })),
  };
}

const DICA_COLAR = <p className="text-[11px] text-slate-400 hidden md:block">Dica: cole uma imagem com Ctrl+V.</p>;

interface Props {
  item: ItemRel;
  numero: number;
  podeResponder: boolean;
  /** id do convidado atual (link) — as respostas dele aparecem como "você". */
  meuGuestId?: string | null;
  /** Na tela da equipe: meu id de usuário — as minhas respostas aparecem como "você". */
  meuUserId?: string | null;
  onResponder: (body: string, imagens: ImagemRel[], novoStatus: StatusItem | null, answers: Record<string, ValorCampo> | null) => Promise<boolean>;
  onEnviarImagem: (f: File) => Promise<ImagemRel | null>;
  /** Ações da equipe (editar/excluir) no cabeçalho do item. */
  acoes?: ReactNode;
}

export default function ItemRelatorio({ item, numero, podeResponder, meuGuestId, meuUserId, onResponder, onEnviarImagem, acoes }: Props) {
  const [texto, setTexto] = useState('');
  const [gravando, setGravando] = useState(false);
  const [aberto, setAberto] = useState(false);
  const [rascunho, setRascunho] = useState<Record<string, ValorCampo>>({});
  const [erro, setErro] = useState<string | null>(null);
  const anexos = useAnexos(onEnviarImagem);

  const campos = item.fields ?? [];
  const atuais = valoresAtuais(item);
  const valorAtual = Object.fromEntries(Object.entries(atuais).map(([k, v]) => [k, v.valor]));
  const mudancas = respostasMudadas(campos, valorAtual, rascunho);
  const temMudancas = Object.keys(mudancas).length > 0;

  const abrir = () => {
    setRascunho(valorAtual);
    setAberto(true);
  };
  const fechar = () => { setAberto(false); setTexto(''); setRascunho({}); setErro(null); anexos.limpar(); };

  const enviar = async (novoStatus: StatusItem | null) => {
    if (gravando || anexos.enviando) return;
    if (!texto.trim() && !anexos.imagens.length && !novoStatus && !temMudancas) return;
    const e = erroPreenchimento(campos, mudancas);
    setErro(e);
    if (e) return;
    setGravando(true);
    const ok = await onResponder(texto.trim(), anexos.paraGravar(), novoStatus, temMudancas ? mudancas : null);
    setGravando(false);
    if (ok) fechar();
  };

  const respostas = item.responses;
  const anteriores = new Map<string, Record<string, ValorCampo>>();
  {
    const corrente: Record<string, ValorCampo> = {};
    for (const r of respostas) {
      anteriores.set(r.id, { ...corrente });
      for (const [cid, v] of Object.entries(r.answers ?? {})) corrente[cid] = v;
    }
  }
  // Quem preencheu o resumo: se foi uma pessoa só, num momento só, vira uma linha no rodapé.
  const autorias = Object.values(atuais).filter((a) => a.valor !== null);
  const autoriaUnica = autorias.length > 0 && autorias.every((a) => a.autor === autorias[0].autor && a.em === autorias[0].em);
  const temRascunho = !!texto.trim() || anexos.imagens.length > 0 || temMudancas;

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
        {campos.length > 0 && (
          <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50/50 px-3 py-2.5">
            <dl className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-2.5">
              {campos.map((c) => {
                const a = atuais[c.id];
                const vazio = !a || a.valor === null;
                return (
                  <div key={c.id} className="min-w-0" title={!vazio && !autoriaUnica ? `${a.autor} · ${dataHora(a.em)}` : undefined}>
                    <dt className="text-[11px] text-slate-500 truncate">{c.label}</dt>
                    <dd className={`text-sm font-medium break-words ${vazio ? 'text-slate-300' : 'text-slate-800'}`}>
                      {vazio ? 'sem resposta' : formatarValor(c, a.valor)}
                    </dd>
                    {!vazio && !autoriaUnica && <dd className="text-[10px] text-slate-400 truncate">{a.autor} · {dataHora(a.em)}</dd>}
                  </div>
                );
              })}
            </dl>
            {autoriaUnica && (
              <p className="mt-2 pt-2 border-t border-slate-200/70 text-[11px] text-slate-400">
                Respondido por {autorias[0].autor} · {dataHora(autorias[0].em)}
              </p>
            )}
          </div>
        )}
      </div>

      {respostas.length > 0 && (
        <ol className="border-t border-slate-100 bg-slate-50/60 px-4 py-3 space-y-3">
          {respostas.map((r) => {
            const minha = (meuGuestId && r.author_guest_id === meuGuestId) || (!!meuUserId && r.author_user_id === meuUserId);
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
            const antes = anteriores.get(r.id) ?? {};
            const respondidos = campos.filter((c) => r.answers && c.id in r.answers);
            const vazio = (x: ValorCampo | undefined) => x === null || x === undefined || x === '' || (Array.isArray(x) && !x.length);
            const preencheu = respondidos.filter((c) => vazio(antes[c.id]));
            const mudou = respondidos.filter((c) => !vazio(antes[c.id]));
            return (
              <li key={r.id} className="flex gap-2">
                <span className={`shrink-0 w-7 h-7 rounded-full text-xs font-semibold flex items-center justify-center ${r.author_type === 'owner' ? 'bg-indigo-100 text-indigo-700' : 'bg-amber-100 text-amber-800'}`}>
                  {r.author_name.trim().charAt(0).toUpperCase()}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-slate-500">
                    {quem}
                    {r.author_type === 'owner' && (
                      <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-600">
                        {r.author_is_creator ? 'autor do relatório' : 'equipe'}
                      </span>
                    )}
                    <span className="ml-1">· {dataHora(r.created_at)}</span>
                  </p>
                  {preencheu.length > 0 && (
                    <p className="text-xs text-slate-500 mt-0.5">
                      Preencheu {preencheu.length === campos.length && campos.length > 1 ? 'todos os campos' : preencheu.map((c) => c.label).join(', ')}
                    </p>
                  )}
                  {mudou.length > 0 && (
                    <ul className="mt-0.5 space-y-0.5">
                      {mudou.map((c) => (
                        <li key={c.id} className="text-sm text-slate-700 flex flex-wrap items-center gap-1">
                          <span className="text-slate-500">{c.label}:</span>
                          <span className="text-slate-400 line-through">{formatarValor(c, antes[c.id] ?? null)}</span>
                          <ArrowRight size={12} className="text-slate-400" />
                          <strong className="font-medium">{formatarValor(c, r.answers![c.id])}</strong>
                        </li>
                      ))}
                    </ul>
                  )}
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
                onClick={abrir}
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
            <div className="space-y-3" onPaste={anexos.aoColar}>
              {campos.length > 0 && (
                <PreencherCampos
                  campos={campos}
                  valores={rascunho}
                  onChange={(cid, v) => setRascunho((r) => ({ ...r, [cid]: v }))}
                />
              )}
              <textarea
                value={texto}
                onChange={(e) => setTexto(e.target.value)}
                autoFocus={campos.length === 0}
                rows={3}
                maxLength={5000}
                placeholder={campos.length ? 'Comentário (opcional)…' : 'Escreva sua resposta…'}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-base md:text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200"
              />
              <GradeImagens imagens={anexos.imagens} onRemover={anexos.remover} onLegenda={anexos.legendar} />
              {DICA_COLAR}
              {erro && <p className="text-sm text-red-600">{erro}</p>}
              <div className="flex flex-wrap items-center gap-2">
                {anexos.botao}
                <div className="flex-1" />
                <button onClick={fechar} className="px-3 py-2 rounded-lg text-sm text-slate-500 hover:bg-slate-100">
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

/** Formulário de item (novo ou edição): título, descrição, imagens com legenda e, para a equipe, campos de resposta. */
export function FormItem({ inicial, comCampos, rotuloSalvar, aviso, onSalvar, onCancelar, onEnviarImagem }: {
  inicial?: { title: string; body: string | null; images: ImagemRel[]; fields?: CampoRel[] };
  comCampos: boolean;
  rotuloSalvar: string;
  aviso?: ReactNode;
  onSalvar: (title: string, body: string, images: ImagemRel[], fields: CampoRel[]) => Promise<boolean>;
  onCancelar: () => void;
  onEnviarImagem: (f: File) => Promise<ImagemRel | null>;
}) {
  const [titulo, setTitulo] = useState(inicial?.title ?? '');
  const [corpo, setCorpo] = useState(inicial?.body ?? '');
  const [campos, setCampos] = useState<CampoRel[]>(inicial?.fields ?? []);
  const [erro, setErro] = useState<string | null>(null);
  const [gravando, setGravando] = useState(false);
  const anexos = useAnexos(onEnviarImagem, inicial?.images ?? []);

  const salvar = async () => {
    const { campos: limpos, erro: e } = limparCampos(campos);
    if (e) { setErro(e); return; }
    setErro(null);
    setGravando(true);
    await onSalvar(titulo.trim(), corpo.trim(), anexos.paraGravar(), limpos);
    setGravando(false);
  };

  return (
    <div className={`bg-white rounded-xl border p-4 space-y-2 ${inicial ? 'border-2 border-indigo-200' : 'border-slate-200'}`} onPaste={anexos.aoColar}>
      <input
        value={titulo}
        onChange={(e) => setTitulo(e.target.value)}
        autoFocus={!inicial}
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
      <GradeImagens imagens={anexos.imagens} onRemover={anexos.remover} onLegenda={anexos.legendar} />
      {DICA_COLAR}
      {comCampos && (
        <div className="pt-1">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">O que quem responde preenche</p>
          <EditorCampos campos={campos} onChange={setCampos} />
        </div>
      )}
      {aviso}
      {erro && <p className="text-sm text-red-600">{erro}</p>}
      <div className="flex items-center gap-2 pt-1">
        {anexos.botao}
        <div className="flex-1" />
        <button onClick={onCancelar} className="px-3 py-2 rounded-lg text-sm text-slate-500 hover:bg-slate-100">Cancelar</button>
        <button
          disabled={!titulo.trim() || gravando || anexos.enviando}
          onClick={salvar}
          className="px-4 py-2 rounded-lg text-sm font-medium bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {rotuloSalvar}
        </button>
      </div>
    </div>
  );
}

/** Botão "Incluir item" que abre o formulário. */
export function NovoItem({ onCriar, onEnviarImagem, comCampos = false }: {
  onCriar: (title: string, body: string, images: ImagemRel[], fields: CampoRel[]) => Promise<boolean>;
  onEnviarImagem: (f: File) => Promise<ImagemRel | null>;
  comCampos?: boolean;
}) {
  const [aberto, setAberto] = useState(false);
  // A chave zera o formulário depois de incluir.
  const [chave, setChave] = useState(0);
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
    <FormItem
      key={chave}
      comCampos={comCampos}
      rotuloSalvar="Incluir"
      onEnviarImagem={onEnviarImagem}
      onCancelar={() => setAberto(false)}
      onSalvar={async (t, b, imgs, f) => {
        const ok = await onCriar(t, b, imgs, f);
        if (ok) { setAberto(false); setChave((k) => k + 1); }
        return ok;
      }}
    />
  );
}
