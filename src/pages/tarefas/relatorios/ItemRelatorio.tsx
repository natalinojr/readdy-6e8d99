/**
 * Um item do relatório com a sequência de respostas e a caixa de resposta.
 * Usado pela equipe (dentro de Tarefas) e por quem abre o link (/r/:token).
 */
import { useRef, useState, type ClipboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ImagePlus, Loader2, Send, X, PencilLine, CheckCircle2, RotateCcw, MessageCircle, Plus, ArrowRight, Reply, CornerDownRight } from 'lucide-react';
import { STATUS_INFO, dataHora, type CampoRel, type CondicaoItem, type ImagemRel, type ItemRel, type LinkRel, type RespostaRel, type StatusItem, type ValorCampo } from './api';
import { candidatosCondicao } from './condicaoItem';
import { ChipsLinks, useLinks } from './LinksRelatorio';
import { EditorCampos, PreencherCampos, camposVisiveis, condicionavel, respostasPossiveis, erroPreenchimento, formatarValor, limparCampos, respostasMudadas, valoresAtuais } from './CamposResposta';
import { useVoltarFecha } from '@/lib/voltarAndroid';

/** Faixa colorida na lateral do item, pela situação. */
const COR_LATERAL: Record<StatusItem, string> = {
  open: 'border-l-amber-300',
  answered: 'border-l-sky-400',
  resolved: 'border-l-emerald-500',
};

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
  useVoltarFecha(aberta !== null, () => setAberta(null), 'relatorio-imagem');
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
  /** `parentId`: resposta a uma resposta (só texto/imagem/link). */
  onResponder: (body: string, imagens: ImagemRel[], novoStatus: StatusItem | null, answers: Record<string, ValorCampo> | null, links: LinkRel[], parentId?: string | null) => Promise<boolean>;
  onEnviarImagem: (f: File) => Promise<ImagemRel | null>;
  /** Pode preencher/alterar os campos do item: quem responde pelo link e quem criou o relatório. O resto da equipe só comenta. */
  podeAlterarCampos?: boolean;
  /** Faixa no topo do item (equipe: "aparece só se…"). */
  faixa?: ReactNode;
  /** Ações da equipe (editar/excluir) no cabeçalho do item. */
  acoes?: ReactNode;
}

export default function ItemRelatorio({ item, numero, podeResponder, meuGuestId, meuUserId, onResponder, onEnviarImagem, acoes, podeAlterarCampos = true, faixa }: Props) {
  const [texto, setTexto] = useState('');
  const [gravando, setGravando] = useState(false);
  const [aberto, setAberto] = useState(false);
  const [rascunho, setRascunho] = useState<Record<string, ValorCampo>>({});
  const [erro, setErro] = useState<string | null>(null);
  const anexos = useAnexos(onEnviarImagem);
  const lk = useLinks();

  const campos = item.fields ?? [];
  const preenche = podeAlterarCampos && campos.length > 0;
  const [respondendoA, setRespondendoA] = useState<string | null>(null);
  const atuais = valoresAtuais(item);
  const valorAtual = Object.fromEntries(Object.entries(atuais).map(([k, v]) => [k, v.valor]));
  const mudancas = respostasMudadas(campos, valorAtual, rascunho);
  const temMudancas = Object.keys(mudancas).length > 0;

  const abrir = () => {
    setRascunho(podeAlterarCampos ? valorAtual : {});
    setAberto(true);
  };
  const fechar = () => { setAberto(false); setTexto(''); setRascunho({}); setErro(null); anexos.limpar(); lk.limpar(); };

  // Trava por ref: dois cliques no mesmo instante passariam pelo estado `gravando` (ainda não re-renderizou).
  const enviandoRef = useRef(false);
  const enviar = async (novoStatus: StatusItem | null) => {
    if (enviandoRef.current || gravando || anexos.enviando) return;
    if (!texto.trim() && !anexos.imagens.length && !lk.links.length && !novoStatus && !temMudancas) return;
    const e = erroPreenchimento(campos, mudancas);
    setErro(e);
    if (e) return;
    enviandoRef.current = true;
    setGravando(true);
    try {
      const ok = await onResponder(texto.trim(), anexos.paraGravar(), novoStatus, temMudancas ? mudancas : null, lk.links);
      if (ok) fechar();
    } finally {
      enviandoRef.current = false;
      setGravando(false);
    }
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
  const temRascunho = !!texto.trim() || anexos.imagens.length > 0 || lk.links.length > 0 || temMudancas;

  return (
    <article className={`bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden border-l-4 ${COR_LATERAL[item.status]}`}>
      {faixa}
      <header className="px-4 pt-4 flex items-start gap-3">
        <span className="shrink-0 w-7 h-7 rounded-lg bg-slate-100 text-slate-600 text-sm font-semibold flex items-center justify-center">{numero}</span>
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
        <ChipsLinks links={item.links ?? []} />
        {campos.length > 0 && (
          <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50/50 px-3 py-2.5">
            <dl className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-2.5">
              {/* Só o que vale para as respostas atuais (campo condicional escondido não entra). */}
              {camposVisiveis(campos, valorAtual).map((c) => {
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
          {respostas.filter((r) => !r.parent_id).map((r) => {
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
            return (
              <li key={r.id}>
              <div className="flex gap-2">
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
                  {/* O que a pessoa respondeu nesta vez — fica no histórico mesmo que o valor mude depois. */}
                  {respondidos.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {respondidos.map((c) => {
                        const novo = r.answers![c.id];
                        const anterior = antes[c.id];
                        return (
                          <span key={c.id} className="inline-flex flex-wrap items-center gap-1 rounded-lg bg-white border border-slate-200 px-2 py-0.5 text-xs">
                            <span className="text-slate-500">{c.label}:</span>
                            {!vazio(anterior) && (
                              <>
                                <span className="text-slate-400 line-through">{formatarValor(c, anterior ?? null)}</span>
                                <ArrowRight size={11} className="text-slate-400" />
                              </>
                            )}
                            {vazio(novo)
                              ? <span className="italic text-slate-400">apagou</span>
                              : <strong className="font-medium text-slate-800">{formatarValor(c, novo)}</strong>}
                          </span>
                        );
                      })}
                    </div>
                  )}
                  {r.body && <p className="text-sm text-slate-700 whitespace-pre-wrap break-words mt-0.5">{r.body}</p>}
                  <GradeImagens imagens={r.images} />
                  <ChipsLinks links={r.links ?? []} />
                  {r.new_status && (
                    <p className="text-xs text-slate-500 mt-1 flex items-center gap-1">
                      {r.new_status === 'resolved' ? <CheckCircle2 size={13} className="text-emerald-600" /> : <RotateCcw size={13} />}
                      marcou como <strong>{STATUS_INFO[r.new_status].label.toLowerCase()}</strong>
                    </p>
                  )}
                </div>
              </div>
              {r.kind === 'reply' && (
                <Conversa
                  filhas={respostas.filter((x) => x.parent_id === r.id)}
                  aberta={respondendoA === r.id}
                  podeResponder={podeResponder}
                  eMinha={(x) => (!!meuGuestId && x.author_guest_id === meuGuestId) || (!!meuUserId && x.author_user_id === meuUserId)}
                  onAbrir={() => setRespondendoA(r.id)}
                  onFechar={() => setRespondendoA(null)}
                  onEnviar={(body, imgs) => onResponder(body, imgs, null, null, [], r.id)}
                  onEnviarImagem={onEnviarImagem}
                />
              )}
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
              {campos.length > 0 && !podeAlterarCampos && (
                <p className="text-xs text-slate-500">As respostas dos campos são de quem responde pelo link — só quem criou o relatório altera. Aqui você comenta.</p>
              )}
              {preenche && (
                <PreencherCampos
                  campos={campos}
                  valores={rascunho}
                  onChange={(cid, v) => setRascunho((r) => ({ ...r, [cid]: v }))}
                />
              )}
              <textarea
                value={texto}
                onChange={(e) => setTexto(e.target.value)}
                autoFocus={!preenche}
                rows={3}
                maxLength={5000}
                placeholder={preenche ? 'Comentário (opcional)…' : podeAlterarCampos ? 'Escreva sua resposta…' : 'Escreva um comentário…'}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-base md:text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200"
              />
              <GradeImagens imagens={anexos.imagens} onRemover={anexos.remover} onLegenda={anexos.legendar} />
              {lk.chips}
              {lk.painel}
              {DICA_COLAR}
              {erro && <p className="text-sm text-red-600">{erro}</p>}
              <div className="flex flex-wrap items-center gap-2">
                {anexos.botao}
                {lk.botao}
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

/** Respostas a uma resposta (um nível só) + caixa para responder ela. */
function Conversa({ filhas, aberta, podeResponder, eMinha, onAbrir, onFechar, onEnviar, onEnviarImagem }: {
  filhas: RespostaRel[];
  aberta: boolean;
  podeResponder: boolean;
  eMinha: (r: RespostaRel) => boolean;
  onAbrir: () => void;
  onFechar: () => void;
  onEnviar: (body: string, imagens: ImagemRel[]) => Promise<boolean>;
  onEnviarImagem: (f: File) => Promise<ImagemRel | null>;
}) {
  const [texto, setTexto] = useState('');
  const [gravando, setGravando] = useState(false);
  const anexos = useAnexos(onEnviarImagem);
  const enviandoRef = useRef(false);
  const fechar = () => { setTexto(''); anexos.limpar(); onFechar(); };
  const enviar = async () => {
    if (enviandoRef.current || anexos.enviando || (!texto.trim() && !anexos.imagens.length)) return;
    enviandoRef.current = true;
    setGravando(true);
    try {
      if (await onEnviar(texto.trim(), anexos.paraGravar())) fechar();
    } finally {
      enviandoRef.current = false;
      setGravando(false);
    }
  };
  if (!filhas.length && !aberta && !podeResponder) return null;
  return (
    <div className="ml-9 mt-1.5 space-y-2">
      {filhas.length > 0 && (
        <ol className="border-l-2 border-slate-200 pl-3 space-y-2">
          {filhas.map((f) => (
            <li key={f.id} className="flex gap-2">
              <span className={`shrink-0 w-6 h-6 rounded-full text-[11px] font-semibold flex items-center justify-center ${f.author_type === 'owner' ? 'bg-indigo-100 text-indigo-700' : 'bg-amber-100 text-amber-800'}`}>
                {f.author_name.trim().charAt(0).toUpperCase()}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-slate-500">
                  <strong className="font-semibold text-slate-700">{f.author_name}{eMinha(f) ? ' (você)' : ''}</strong>
                  {f.author_type === 'owner' && (
                    <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-600">{f.author_is_creator ? 'autor do relatório' : 'equipe'}</span>
                  )}
                  <span className="ml-1">· {dataHora(f.created_at)}</span>
                </p>
                {f.body && <p className="text-sm text-slate-700 whitespace-pre-wrap break-words mt-0.5">{f.body}</p>}
                <GradeImagens imagens={f.images} />
                <ChipsLinks links={f.links ?? []} />
              </div>
            </li>
          ))}
        </ol>
      )}
      {podeResponder && !aberta && (
        <button type="button" onClick={onAbrir} className="flex items-center gap-1 text-xs text-indigo-600 hover:underline">
          <Reply size={13} /> Responder{filhas.length ? '' : ' esta resposta'}
        </button>
      )}
      {podeResponder && aberta && (
        <div className="space-y-2" onPaste={anexos.aoColar}>
          <textarea
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            autoFocus
            rows={2}
            maxLength={5000}
            placeholder="Responder esta resposta…"
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-base md:text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-200"
          />
          <GradeImagens imagens={anexos.imagens} onRemover={anexos.remover} onLegenda={anexos.legendar} />
          <div className="flex flex-wrap items-center gap-2">
            {anexos.botao}
            <div className="flex-1" />
            <button onClick={fechar} className="px-3 py-1.5 rounded-lg text-sm text-slate-500 hover:bg-slate-100">Cancelar</button>
            <button
              onClick={enviar}
              disabled={gravando || anexos.enviando || (!texto.trim() && !anexos.imagens.length)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {gravando ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />} Enviar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Formulário de item (novo ou edição): título, descrição, imagens com legenda e, para a equipe, campos de resposta. */
export function FormItem({ inicial, comCampos, rotuloSalvar, aviso, onSalvar, onCancelar, onEnviarImagem, itens }: {
  inicial?: { id?: string; title: string; body: string | null; images: ImagemRel[]; fields?: CampoRel[]; links?: LinkRel[]; show_if?: CondicaoItem | null };
  comCampos: boolean;
  /** Itens do relatório (equipe): permite pôr este item condicionado a outro. */
  itens?: ItemRel[];
  rotuloSalvar: string;
  aviso?: ReactNode;
  onSalvar: (title: string, body: string, images: ImagemRel[], fields: CampoRel[], links: LinkRel[], showIf?: CondicaoItem | null) => Promise<boolean>;
  onCancelar: () => void;
  onEnviarImagem: (f: File) => Promise<ImagemRel | null>;
}) {
  const [titulo, setTitulo] = useState(inicial?.title ?? '');
  const [corpo, setCorpo] = useState(inicial?.body ?? '');
  const [campos, setCampos] = useState<CampoRel[]>(inicial?.fields ?? []);
  // Condição quebrada (o outro item ou a pergunta dele foi apagada) sai ao abrir — a edge recusaria.
  const [condicao, setCondicao] = useState<CondicaoItem | null>(() => {
    const c = inicial?.show_if;
    const campo = c && itens?.find((x) => x.id === c.item_id)?.fields?.find((f) => f.id === c.field_id);
    if (!c || !campo) return null;
    const existem = new Set(respostasPossiveis(campo).map((o) => o.id));
    return { ...c, values: c.values.filter((v) => existem.has(v)) };
  });
  const [erro, setErro] = useState<string | null>(null);
  const [gravando, setGravando] = useState(false);
  const anexos = useAnexos(onEnviarImagem, inicial?.images ?? []);
  const lk = useLinks(inicial?.links ?? []);

  const salvar = async () => {
    const { campos: limpos, erro: e } = limparCampos(campos);
    if (e) { setErro(e); return; }
    if (condicao && !condicao.values.length) { setErro('Escolha com qual resposta este item aparece'); return; }
    setErro(null);
    setGravando(true);
    await onSalvar(titulo.trim(), corpo.trim(), anexos.paraGravar(), limpos, lk.links, itens ? condicao : undefined);
    setGravando(false);
  };

  return (
    <div className={`bg-white rounded-2xl border shadow-sm p-4 space-y-2 ${inicial ? 'border-2 border-indigo-200' : 'border-indigo-200'}`} onPaste={anexos.aoColar}>
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
      {lk.chips}
      {lk.painel}
      {DICA_COLAR}
      {comCampos && (
        <div className="pt-1">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">O que quem responde preenche</p>
          <EditorCampos campos={campos} onChange={setCampos} />
        </div>
      )}
      {itens && <EditorCondicaoItem itemId={inicial?.id ?? null} itens={itens} condicao={condicao} onChange={setCondicao} />}
      {aviso}
      {erro && <p className="text-sm text-red-600">{erro}</p>}
      <div className="flex flex-wrap items-center gap-2 pt-1">
        {anexos.botao}
        {lk.botao}
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
export function NovoItem({ onCriar, onEnviarImagem, comCampos = false, itens }: {
  onCriar: (title: string, body: string, images: ImagemRel[], fields: CampoRel[], links: LinkRel[], showIf?: CondicaoItem | null) => Promise<boolean>;
  onEnviarImagem: (f: File) => Promise<ImagemRel | null>;
  comCampos?: boolean;
  itens?: ItemRel[];
}) {
  const [aberto, setAberto] = useState(false);
  // A chave zera o formulário depois de incluir.
  const [chave, setChave] = useState(0);
  if (!aberto) {
    return (
      <button
        onClick={() => setAberto(true)}
        className="w-full flex items-center justify-center gap-1.5 py-3.5 rounded-2xl border-2 border-dashed border-slate-300 text-sm font-medium text-slate-500 hover:border-indigo-300 hover:text-indigo-600 hover:bg-indigo-50/40 transition"
      >
        <Plus size={16} /> Incluir item
      </button>
    );
  }
  return (
    <FormItem
      key={chave}
      comCampos={comCampos}
      itens={itens}
      rotuloSalvar="Incluir"
      onEnviarImagem={onEnviarImagem}
      onCancelar={() => setAberto(false)}
      onSalvar={async (t, b, imgs, f, links, showIf) => {
        const ok = await onCriar(t, b, imgs, f, links, showIf);
        if (ok) { setAberto(false); setChave((k) => k + 1); }
        return ok;
      }}
    />
  );
}

/** "Este item só aparece se [2 · Item] › [pergunta] for [A] [B]" — no formulário do item (equipe). */
function EditorCondicaoItem({ itemId, itens, condicao, onChange }: {
  itemId: string | null;
  itens: ItemRel[];
  condicao: CondicaoItem | null;
  onChange: (c: CondicaoItem | null) => void;
}) {
  const candidatos = candidatosCondicao(itemId, itens);
  const perguntas = (it?: ItemRel) => (it?.fields ?? []).filter((f) => condicionavel(f.type));
  const numero = (it: ItemRel) => itens.indexOf(it) + 1;
  const escolherItem = (id: string) => onChange({ item_id: id, field_id: perguntas(itens.find((x) => x.id === id))[0]?.id ?? '', values: [] });
  if (!condicao) {
    if (!candidatos.length) return null;
    return (
      <button
        type="button"
        onClick={() => escolherItem(candidatos[0].id)}
        className="flex items-center gap-1 text-left text-xs text-slate-500 hover:text-indigo-600 pt-1"
      >
        <CornerDownRight size={13} /> Mostrar este item só se outro item tiver certa resposta…
      </button>
    );
  }
  const pai = itens.find((x) => x.id === condicao.item_id);
  const campo = pai?.fields?.find((f) => f.id === condicao.field_id);
  return (
    <div className="rounded-lg border border-indigo-200 bg-indigo-50/60 px-3 py-2 space-y-1.5 text-xs text-slate-600">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <CornerDownRight size={14} className="text-indigo-500 shrink-0" />
        <span className="font-medium">Este item só aparece se o item</span>
        <select
          value={condicao.item_id}
          onChange={(e) => escolherItem(e.target.value)}
          className="max-w-[220px] rounded-full border-0 bg-indigo-100 text-indigo-800 px-2 py-0.5 text-base md:text-xs font-medium"
        >
          {candidatos.map((x) => <option key={x.id} value={x.id}>{numero(x)} · {x.title}</option>)}
          {pai && !candidatos.includes(pai) && <option value={pai.id}>{numero(pai)} · {pai.title}</option>}
        </select>
        <button type="button" onClick={() => onChange(null)} className="ml-auto p-0.5 text-slate-400 hover:text-red-500" title="Mostrar sempre (tirar a condição)"><X size={14} /></button>
      </div>
      {pai && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 pl-5">
          <span>na pergunta</span>
          <select
            value={condicao.field_id}
            onChange={(e) => onChange({ ...condicao, field_id: e.target.value, values: [] })}
            className="max-w-[220px] rounded-full border-0 bg-indigo-100 text-indigo-800 px-2 py-0.5 text-base md:text-xs font-medium"
          >
            {perguntas(pai).map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
          </select>
          {campo && (
            <>
              <span>{campo.type === 'multipla' ? 'tiver marcado' : 'for'}</span>
              {respostasPossiveis(campo).map((o) => {
                const marcado = condicao.values.includes(o.id);
                return (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => onChange({ ...condicao, values: marcado ? condicao.values.filter((v) => v !== o.id) : [...condicao.values, o.id] })}
                    className={`px-2 py-0.5 rounded-full border ${marcado ? 'bg-indigo-600 border-indigo-600 text-white' : 'bg-white border-slate-200 text-slate-500'}`}
                  >
                    {o.label}
                  </button>
                );
              })}
              {condicao.values.length > 1 && <span className="text-slate-400">(qualquer uma)</span>}
            </>
          )}
        </div>
      )}
      {!condicao.values.length && <p className="pl-5 text-amber-700">Clique na resposta que faz este item aparecer.</p>}
      <p className="pl-5 text-slate-400">A condição usa as perguntas já salvas do outro item.</p>
    </div>
  );
}
