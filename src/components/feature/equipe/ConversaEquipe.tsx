// Uma conversa com alguém da loja (2026-09-23). Cobre o painel do chat inteiro (absolute inset-0),
// com cabeçalho próprio: o chat do dono e o das demais pessoas usam o mesmo componente.
// Igual ao WhatsApp (2026-09-24): vistos ✓ / ✓✓ cinza / ✓✓ azul atualizando na hora, e responder uma
// mensagem específica (arrastar o balão para a direita, ou segurar / botão direito › Responder).
// Pesquisa na conversa (lupa no cabeçalho): a conversa inteira no servidor; tocar no resultado leva
// até a mensagem — se for antiga, carrega o trecho em volta dela (e "Mais recentes" volta ao fim).
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useVoltarFecha } from '@/lib/voltarAndroid';
import { chatEquipe, EVENTO_MSG_EQUIPE, EVENTO_VISTO_EQUIPE, iniciais, type CitacaoEquipe, type MensagemEquipe, type PessoaEquipe } from './api';

export function AvatarPessoa({ pessoa, tamanho = 'w-11 h-11' }: { pessoa: PessoaEquipe | null; tamanho?: string }) {
  if (pessoa?.foto) return <img src={pessoa.foto} alt="" className={`${tamanho} flex-shrink-0 rounded-full object-cover`} />;
  return (
    <span className={`${tamanho} flex-shrink-0 flex items-center justify-center rounded-full bg-sky-100 text-sky-700 text-sm font-black`}>
      {iniciais(pessoa?.nome ?? '?')}
    </span>
  );
}

export type EstadoVisto = 'enviando' | 'enviada' | 'entregue' | 'lida' | 'falhou';
/** ✓ enviada · ✓✓ cinza entregue (chegou no aparelho) · ✓✓ azul lida — como no WhatsApp. */
export function Vistos({ estado, className = '' }: { estado: EstadoVisto; className?: string }) {
  if (estado === 'falhou') return <i className={`ri-error-warning-line text-red-500 ${className}`} aria-label="Não enviada" />;
  if (estado === 'enviando') return <i className={`ri-time-line text-zinc-400 ${className}`} aria-label="Enviando" />;
  if (estado === 'enviada') return <i className={`ri-check-line text-zinc-400 ${className}`} aria-label="Enviada" />;
  return (
    <i className={`ri-check-double-line ${estado === 'lida' ? 'text-sky-500' : 'text-zinc-400'} ${className}`}
      aria-label={estado === 'lida' ? 'Lida' : 'Entregue'} />
  );
}
export function estadoVisto(id: number, entregue: number, lida: number): EstadoVisto {
  return id <= lida ? 'lida' : id <= entregue ? 'entregue' : 'enviada';
}

const diaDe = (iso: string) => new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'long', day: '2-digit', month: '2-digit' });
const horaDe = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
const ARRASTE_RESPONDE = 60; // px para a direita que viram "responder"
const semAcento = (t: string) => t.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

/** Texto com o termo pesquisado em destaque (sem ligar para acento e maiúscula). */
function Destacado({ texto, termo }: { texto: string; termo: string }) {
  const t = semAcento(termo.trim());
  if (!t) return <>{texto}</>;
  // Normalizar sem acento não muda o tamanho de letras latinas comuns: dá para cortar pelo índice.
  const base = semAcento(texto);
  const partes: Array<{ s: string; ok: boolean }> = [];
  let i = 0;
  for (let j = base.indexOf(t); j >= 0; j = base.indexOf(t, j + t.length)) {
    if (j > i) partes.push({ s: texto.slice(i, j), ok: false });
    partes.push({ s: texto.slice(j, j + t.length), ok: true });
    i = j + t.length;
  }
  if (i < texto.length) partes.push({ s: texto.slice(i), ok: false });
  return <>{partes.map((x, k) => (x.ok ? <mark key={k} className="bg-amber-200 text-zinc-900 rounded px-0.5">{x.s}</mark> : <span key={k}>{x.s}</span>))}</>;
}

export default function ConversaEquipe({ threadId, pessoa, loja, onVoltar, onFechar, onMudou }: {
  threadId: string;
  pessoa: PessoaEquipe | null;
  loja?: string;
  onVoltar: () => void;
  onFechar?: () => void;
  /** Mandou ou leu: a lista de conversas recarrega (prévia e não lidas). */
  onMudou?: () => void;
}) {
  const { user } = useAuth();
  const eu = user?.id ?? '';
  const [msgs, setMsgs] = useState<MensagemEquipe[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [carregado, setCarregado] = useState(false);
  const [lidoPeloOutro, setLidoPeloOutro] = useState(0);
  const [entregueAoOutro, setEntregueAoOutro] = useState(0);
  const [texto, setTexto] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [respondendo, setRespondendo] = useState<CitacaoEquipe | null>(null);
  const [menu, setMenu] = useState<MensagemEquipe | null>(null);
  const [destaque, setDestaque] = useState<number | null>(null);
  const [arraste, setArraste] = useState<{ id: number; dx: number } | null>(null);
  const [copiado, setCopiado] = useState(false);
  // Janela da pesquisa: há mensagens mais novas depois da última carregada.
  const [hasNewer, setHasNewer] = useState(false);
  const [busca, setBusca] = useState<string | null>(null); // null = pesquisa fechada
  const [resultados, setResultados] = useState<MensagemEquipe[] | null>(null);
  const [buscando, setBuscando] = useState(false);
  const irDepois = useRef<number | null>(null);
  const hasNewerRef = useRef(false);
  hasNewerRef.current = hasNewer;
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const noFim = useRef(true);
  const ultimoLido = useRef(0);
  const toque = useRef<{ id: number; x: number; y: number; timer: ReturnType<typeof setTimeout> | null; longo: boolean } | null>(null);
  // Em ref: callback novo a cada render do pai não pode recarregar a conversa.
  const mudou = useRef(onMudou);
  mudou.current = onMudou;

  useVoltarFecha(true, onVoltar, 'chat-equipe-conversa');
  useVoltarFecha(!!menu, () => setMenu(null), 'chat-equipe-menu');
  useVoltarFecha(busca !== null, () => fecharBusca(), 'chat-equipe-busca');

  const nomeDe = (senderId: string) => (senderId === eu ? 'Você' : (pessoa?.nome ?? 'Pessoa'));

  const marcarLido = useCallback((lista: MensagemEquipe[]) => {
    const ultima = [...lista].reverse().find((m) => !m.temp && m.sender_id !== eu);
    if (!ultima || ultima.id <= ultimoLido.current) return;
    ultimoLido.current = ultima.id;
    chatEquipe('lido', { thread_id: threadId, id: ultima.id }).then(() => mudou.current?.()).catch(() => null);
  }, [eu, threadId]);

  type Janela = { mensagens: MensagemEquipe[]; has_more: boolean; has_newer?: boolean; lido_pelo_outro: number; entregue_ao_outro?: number };
  const aplicarJanela = useCallback((r: Janela) => {
    setMsgs(r.mensagens); setHasMore(r.has_more); setHasNewer(!!r.has_newer);
    setLidoPeloOutro(r.lido_pelo_outro); setEntregueAoOutro(Math.max(r.entregue_ao_outro ?? 0, r.lido_pelo_outro));
  }, []);

  // As últimas mensagens (abrir a conversa, "Mais recentes", ou mandar estando numa janela antiga).
  const carregarRecentes = useCallback(async () => {
    const r = await chatEquipe<Janela>('mensagens', { thread_id: threadId });
    noFim.current = true;
    aplicarJanela(r);
    marcarLido(r.mensagens);
  }, [threadId, aplicarJanela, marcarLido]);

  useEffect(() => {
    let vivo = true;
    setCarregado(false); setMsgs([]); setErro(null); setRespondendo(null); ultimoLido.current = 0; noFim.current = true;
    chatEquipe<Janela>('mensagens', { thread_id: threadId })
      .then((r) => {
        if (!vivo) return;
        aplicarJanela(r);
        marcarLido(r.mensagens);
      })
      .catch((e) => { if (vivo) setErro(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (vivo) setCarregado(true); });
    return () => { vivo = false; };
  }, [threadId, marcarLido, aplicarJanela]);

  // Pesquisa: espera parar de digitar (300 ms) e pergunta ao servidor (a conversa inteira).
  useEffect(() => {
    if (busca === null) return;
    const termo = busca.trim();
    if (termo.length < 2) { setResultados(null); return; }
    let vivo = true;
    setBuscando(true);
    const t = setTimeout(() => {
      chatEquipe<{ resultados: MensagemEquipe[] }>('buscar', { thread_id: threadId, q: termo })
        .then((r) => { if (vivo) setResultados(r.resultados); })
        .catch((e) => { if (vivo) setErro(e instanceof Error ? e.message : String(e)); })
        .finally(() => { if (vivo) setBuscando(false); });
    }, 300);
    return () => { vivo = false; clearTimeout(t); };
  }, [busca, threadId]);

  // Chegou pelo Realtime (useConversasEquipe dispara o evento).
  useEffect(() => {
    const aoChegar = (ev: Event) => {
      const m = (ev as CustomEvent).detail as MensagemEquipe & { thread_id: string };
      if (m.thread_id !== threadId) return;
      // Olhando um trecho antigo (pesquisa): a nova fica para quando voltar às mais recentes.
      if (hasNewerRef.current) return;
      setMsgs((prev) => {
        if (prev.some((x) => x.id === m.id)) return prev;
        // O Realtime traz só o reply_to_id: a citação sai da própria conversa carregada.
        const orig = m.reply_to_id ? prev.find((x) => x.id === m.reply_to_id) : undefined;
        const nova: MensagemEquipe = {
          id: m.id, sender_id: m.sender_id, body: m.body, created_at: m.created_at, reply_to_id: m.reply_to_id ?? null,
          resposta: orig ? { id: orig.id, sender_id: orig.sender_id, body: orig.body } : (m.reply_to_id ? { id: m.reply_to_id, sender_id: '', body: 'Mensagem anterior' } : null),
        };
        // A minha voltando pelo Realtime antes da resposta do envio: troca a provisória.
        const iTemp = m.sender_id === eu ? prev.findIndex((x) => x.temp && !x.falhou && x.body === m.body) : -1;
        const lista = iTemp >= 0 ? prev.map((x, i) => (i === iTemp ? nova : x)) : [...prev, nova];
        if (m.sender_id !== eu && document.visibilityState === 'visible') marcarLido(lista);
        return lista;
      });
    };
    const aoVer = (ev: Event) => {
      const r = (ev as CustomEvent).detail as { thread_id: string; last_read_id: number; last_delivered_id: number };
      if (r.thread_id !== threadId) return;
      setLidoPeloOutro((v) => Math.max(v, Number(r.last_read_id ?? 0)));
      setEntregueAoOutro((v) => Math.max(v, Number(r.last_delivered_id ?? 0), Number(r.last_read_id ?? 0)));
    };
    window.addEventListener(EVENTO_MSG_EQUIPE, aoChegar);
    window.addEventListener(EVENTO_VISTO_EQUIPE, aoVer);
    return () => {
      window.removeEventListener(EVENTO_MSG_EQUIPE, aoChegar);
      window.removeEventListener(EVENTO_VISTO_EQUIPE, aoVer);
    };
  }, [threadId, eu, marcarLido]);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    // Veio da pesquisa: vai até a mensagem encontrada, não para o fim.
    if (irDepois.current != null) {
      const id = irDepois.current;
      irDepois.current = null;
      destacar(id);
      return;
    }
    if (el && noFim.current) el.scrollTop = el.scrollHeight;
  }, [msgs, carregado]); // eslint-disable-line react-hooks/exhaustive-deps

  const maisAntigas = async () => {
    const primeira = msgs.find((m) => !m.temp);
    if (!primeira) return;
    const el = scrollRef.current;
    const alturaAntes = el?.scrollHeight ?? 0;
    try {
      const r = await chatEquipe<{ mensagens: MensagemEquipe[]; has_more: boolean }>('mensagens', { thread_id: threadId, before_id: primeira.id });
      noFim.current = false;
      setMsgs((prev) => [...r.mensagens, ...prev]);
      setHasMore(r.has_more);
      requestAnimationFrame(() => { if (el) el.scrollTop = el.scrollHeight - alturaAntes; });
    } catch (e) { setErro(e instanceof Error ? e.message : String(e)); }
  };

  const responder = (m: MensagemEquipe) => {
    setMenu(null);
    setRespondendo({ id: m.id, sender_id: m.sender_id, body: m.body });
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const destacar = (id: number) => {
    const alvo = scrollRef.current?.querySelector(`[data-msg-id="${id}"]`);
    if (!alvo) return false;
    noFim.current = false;
    (alvo as HTMLElement).scrollIntoView?.({ block: 'center', behavior: 'smooth' });
    setDestaque(id);
    setTimeout(() => setDestaque((d) => (d === id ? null : d)), 1800);
    return true;
  };
  // Tocar na citação ou num resultado da pesquisa leva até a mensagem e pisca ela (como no WhatsApp).
  // Fora do que está carregado: busca o trecho em volta dela.
  const irPara = async (id: number) => {
    if (destacar(id)) return;
    try {
      const r = await chatEquipe<Janela>('mensagens', { thread_id: threadId, around_id: id });
      irDepois.current = id;
      noFim.current = false;
      aplicarJanela(r);
    } catch (e) { setErro(e instanceof Error ? e.message : String(e)); }
  };
  const fecharBusca = () => { setBusca(null); setResultados(null); setBuscando(false); };
  const abrirResultado = (id: number) => { fecharBusca(); irPara(id); };
  const irParaRecentes = async () => {
    try { await carregarRecentes(); } catch (e) { setErro(e instanceof Error ? e.message : String(e)); }
  };

  const enviar = async (reenviar?: MensagemEquipe) => {
    const body = reenviar ? reenviar.body : texto.trim();
    if (!body) return;
    if (hasNewer && !reenviar) { try { await carregarRecentes(); } catch { /* manda assim mesmo */ } }
    const citacao = reenviar ? (reenviar.resposta ?? null) : respondendo;
    const clientId = crypto.randomUUID();
    const tempId = reenviar?.id ?? -Date.now();
    const temp: MensagemEquipe = {
      id: tempId, sender_id: eu, body, created_at: new Date().toISOString(), temp: true,
      reply_to_id: citacao?.id ?? null, resposta: citacao,
    };
    noFim.current = true;
    setMsgs((prev) => (reenviar ? prev.map((m) => (m.id === tempId ? temp : m)) : [...prev, temp]));
    if (!reenviar) { setTexto(''); setRespondendo(null); }
    setErro(null);
    try {
      const r = await chatEquipe<{ mensagem: MensagemEquipe }>('enviar', {
        thread_id: threadId, text: body, client_id: clientId, ...(citacao ? { reply_to: citacao.id } : {}),
      });
      // A provisória vira a gravada (ou some, se o Realtime já trouxe a mesma).
      setMsgs((prev) => (prev.some((m) => m.id === r.mensagem.id)
        ? prev.filter((m) => m.id !== tempId)
        : prev.map((m) => (m.id === tempId ? r.mensagem : m))));
      mudou.current?.();
    } catch (e) {
      setMsgs((prev) => prev.map((m) => (m.id === tempId ? { ...m, falhou: true } : m)));
      setErro(e instanceof Error ? e.message : String(e));
    }
  };

  // Toque: segurar ~0,5 s abre o menu; arrastar para a direita responde.
  const inicioToque = (m: MensagemEquipe, e: React.TouchEvent) => {
    if (m.temp) return;
    const t = e.touches[0];
    const ref = { id: m.id, x: t.clientX, y: t.clientY, timer: null as ReturnType<typeof setTimeout> | null, longo: false };
    ref.timer = setTimeout(() => {
      ref.longo = true;
      // O Android começa a selecionar o texto no mesmo toque longo (barra Traduzir/Copiar por cima
      // do menu — visto no Galaxy em 2026-09-24): limpa a seleção e abre só o nosso menu.
      window.getSelection()?.removeAllRanges();
      setMenu(m);
    }, 500);
    toque.current = ref;
  };
  const moveToque = (e: React.TouchEvent) => {
    const r = toque.current;
    if (!r) return;
    const t = e.touches[0];
    const dx = t.clientX - r.x;
    const dy = t.clientY - r.y;
    if (Math.abs(dx) > 8 || Math.abs(dy) > 8) { if (r.timer) clearTimeout(r.timer); r.timer = null; }
    // Rolagem vertical ganha: só vira arraste quando o dedo anda mais para o lado.
    if (dx > 0 && Math.abs(dx) > Math.abs(dy)) setArraste({ id: r.id, dx: Math.min(dx, 90) });
  };
  const fimToque = (m: MensagemEquipe) => {
    const r = toque.current;
    toque.current = null;
    if (r?.timer) clearTimeout(r.timer);
    if (arraste && arraste.id === m.id && arraste.dx >= ARRASTE_RESPONDE) responder(m);
    setArraste(null);
  };

  const copiar = async (m: MensagemEquipe) => {
    setMenu(null);
    try { await navigator.clipboard.writeText(m.body); setCopiado(true); setTimeout(() => setCopiado(false), 1500); } catch { /* sem permissão */ }
  };

  return (
    <div data-no-pull className="absolute inset-0 z-30 flex flex-col bg-white">
      {busca !== null ? (
        <div className="flex items-center gap-2 px-3 h-14 border-b border-zinc-100 flex-shrink-0">
          <button onClick={fecharBusca} className="w-9 h-9 flex items-center justify-center rounded-xl text-zinc-500 hover:bg-zinc-100 cursor-pointer" aria-label="Fechar pesquisa">
            <i className="ri-arrow-left-line text-xl" />
          </button>
          <input
            autoFocus type="search" value={busca} onChange={(e) => setBusca(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') fecharBusca(); if (e.key === 'Enter' && resultados?.length) abrirResultado(resultados[0].id); }}
            placeholder="Pesquisar na conversa…" aria-label="Pesquisar na conversa" autoComplete="off" enterKeyHint="search"
            className="flex-1 min-w-0 h-10 px-3 text-sm rounded-xl border border-zinc-200 focus:outline-none focus:border-sky-400"
          />
          {buscando && <span className="w-4 h-4 border-2 border-sky-500 border-t-transparent rounded-full animate-spin" />}
        </div>
      ) : (
      <div className="flex items-center gap-2.5 px-3 h-14 border-b border-zinc-100 flex-shrink-0">
        <button onClick={onVoltar} className="w-9 h-9 flex items-center justify-center rounded-xl text-zinc-500 hover:bg-zinc-100 cursor-pointer" aria-label="Voltar para as conversas">
          <i className="ri-arrow-left-line text-xl" />
        </button>
        <AvatarPessoa pessoa={pessoa} tamanho="w-9 h-9" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-black text-zinc-900 leading-tight truncate">{pessoa?.nome ?? 'Conversa'}</p>
          {loja && <p className="text-[11px] text-zinc-400 leading-tight truncate">{loja}</p>}
        </div>
        <button onClick={() => setBusca('')} className="w-9 h-9 flex items-center justify-center rounded-xl text-zinc-500 hover:bg-zinc-100 cursor-pointer" aria-label="Pesquisar na conversa">
          <i className="ri-search-line text-lg" />
        </button>
        {onFechar && (
          <button onClick={onFechar} className="w-9 h-9 flex items-center justify-center rounded-xl text-zinc-400 hover:bg-zinc-100 cursor-pointer" aria-label="Fechar chat">
            <i className="ri-close-line text-xl" />
          </button>
        )}
      </div>
      )}

      {/* Resultados da pesquisa: por cima das mensagens, mais novas primeiro. */}
      {busca !== null && busca.trim().length >= 2 && resultados && (
        <div className="absolute inset-x-0 top-14 bottom-0 z-10 bg-white overflow-y-auto">
          <p className="px-4 pt-3 pb-1 text-[11px] font-bold uppercase tracking-wide text-zinc-400">
            {resultados.length ? `${resultados.length === 50 ? '50+' : resultados.length} ${resultados.length === 1 ? 'mensagem' : 'mensagens'}` : 'Nenhuma mensagem com esse texto'}
          </p>
          {resultados.map((r) => (
            <button key={r.id} onClick={() => abrirResultado(r.id)}
              className="w-full text-left px-4 py-2.5 border-b border-zinc-100 hover:bg-zinc-50 cursor-pointer">
              <span className="flex items-baseline gap-2">
                <span className={`flex-1 text-xs font-bold ${r.sender_id === eu ? 'text-emerald-700' : 'text-sky-700'}`}>{nomeDe(r.sender_id)}</span>
                <span className="text-[11px] text-zinc-400">{diaDe(r.created_at).split(',').pop()?.trim()} {horaDe(r.created_at)}</span>
              </span>
              <span className="block text-sm text-zinc-700 line-clamp-2"><Destacado texto={r.body} termo={busca} /></span>
            </button>
          ))}
        </div>
      )}

      <div
        ref={scrollRef}
        onScroll={(e) => { const el = e.currentTarget; noFim.current = el.scrollHeight - el.scrollTop - el.clientHeight < 16; }}
        className="flex-1 overflow-y-auto overflow-x-hidden px-3 py-3 bg-zinc-50/60"
      >
        {!carregado && <div className="mx-auto my-16 w-6 h-6 border-2 border-sky-500 border-t-transparent rounded-full animate-spin" />}
        {hasMore && (
          <button onClick={maisAntigas} className="block mx-auto text-xs text-sky-700 font-semibold py-1 cursor-pointer">Carregar mensagens anteriores</button>
        )}
        {carregado && msgs.length === 0 && !erro && (
          <p className="text-sm text-zinc-400 text-center py-10">Nenhuma mensagem ainda. Diga um oi 👋</p>
        )}
        <div className="space-y-1.5">
          {msgs.map((m, i) => {
            const minha = m.sender_id === eu;
            const novoDia = i === 0 || diaDe(msgs[i - 1].created_at) !== diaDe(m.created_at);
            const dx = arraste?.id === m.id ? arraste.dx : 0;
            const estado: EstadoVisto = m.falhou ? 'falhou' : m.temp ? 'enviando' : estadoVisto(m.id, entregueAoOutro, lidoPeloOutro);
            return (
              <div key={m.id} data-msg-id={m.id}>
                {novoDia && <p className="text-center text-[11px] text-zinc-400 font-semibold py-2 capitalize">{diaDe(m.created_at)}</p>}
                <div className={`relative flex ${minha ? 'justify-end' : 'justify-start'}`}>
                  {dx > 0 && (
                    <span className={`absolute left-0 top-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center rounded-full ${dx >= ARRASTE_RESPONDE ? 'bg-sky-100 text-sky-700' : 'text-zinc-400'}`}>
                      <i className="ri-reply-line" />
                    </span>
                  )}
                  <div
                    onContextMenu={(e) => { if (!m.temp) { e.preventDefault(); setMenu(m); } }}
                    onTouchStart={(e) => inicioToque(m, e)}
                    onTouchMove={moveToque}
                    onTouchEnd={() => fimToque(m)}
                    onTouchCancel={() => { toque.current = null; setArraste(null); }}
                    // Sem seleção nativa nem menu do sistema no toque longo: copiar é pelo nosso menu.
                    style={{ WebkitTouchCallout: 'none', ...(dx ? { transform: `translateX(${dx}px)` } : {}) }}
                    className={`group relative max-w-[80%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap break-words select-none transition-colors
                      ${minha ? 'bg-emerald-100 text-zinc-800 rounded-br-md' : 'bg-white border border-zinc-200 text-zinc-800 rounded-bl-md'}
                      ${destaque === m.id ? 'ring-2 ring-sky-400' : ''} ${m.falhou ? 'opacity-60' : ''}`}
                  >
                    {m.resposta && (
                      <button onClick={() => irPara(m.resposta!.id)}
                        className={`block w-full text-left mb-1 px-2 py-1 rounded-lg border-l-4 cursor-pointer ${minha ? 'bg-emerald-50 border-emerald-500' : 'bg-zinc-50 border-sky-500'}`}>
                        <span className={`block text-[11px] font-bold ${m.resposta.sender_id === eu ? 'text-emerald-700' : 'text-sky-700'}`}>
                          {m.resposta.sender_id ? nomeDe(m.resposta.sender_id) : 'Resposta'}
                        </span>
                        <span className="block text-xs text-zinc-500 line-clamp-2">{m.resposta.body}</span>
                      </button>
                    )}
                    {m.body}
                    <span className="flex items-center justify-end gap-1 mt-0.5 text-[10px] text-zinc-500">
                      {horaDe(m.created_at)}
                      {minha && <Vistos estado={estado} className="text-sm leading-none" />}
                    </span>
                    {/* No computador: responder pelo botão que aparece ao passar o mouse. */}
                    {!m.temp && (
                      <button onClick={() => responder(m)} aria-label="Responder"
                        className={`hidden sm:group-hover:flex absolute top-1/2 -translate-y-1/2 ${minha ? '-left-9' : '-right-9'} w-7 h-7 items-center justify-center rounded-full bg-white border border-zinc-200 text-zinc-500 hover:text-sky-700 cursor-pointer`}>
                        <i className="ri-reply-line" />
                      </button>
                    )}
                  </div>
                </div>
                {m.falhou && (
                  <button onClick={() => enviar(m)} className="block ml-auto mt-0.5 text-[11px] font-semibold text-red-600 cursor-pointer">
                    <i className="ri-error-warning-line" /> Não foi. Tocar para tentar de novo
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {hasNewer && (
        <button onClick={irParaRecentes} className="mx-auto -mt-12 mb-2 relative z-10 flex items-center gap-1 h-8 px-3 rounded-full bg-white border border-zinc-200 shadow text-xs font-bold text-sky-700 cursor-pointer">
          <i className="ri-arrow-down-line" /> Mais recentes
        </button>
      )}
      {erro && <p className="px-3 py-1.5 text-xs text-red-600 bg-red-50 border-t border-red-100">{erro}</p>}
      {copiado && <p className="px-3 py-1.5 text-xs text-emerald-700 bg-emerald-50 border-t border-emerald-100">Mensagem copiada.</p>}

      <div className="border-t border-zinc-100 p-2.5 bg-white flex-shrink-0">
        {respondendo && (
          <div className="flex items-start gap-2 mb-2 px-2 py-1.5 rounded-xl bg-zinc-50 border-l-4 border-sky-500">
            <div className="flex-1 min-w-0">
              <p className="text-[11px] font-bold text-sky-700">Respondendo {respondendo.sender_id === eu ? 'a você' : `a ${pessoa?.nome ?? 'pessoa'}`}</p>
              <p className="text-xs text-zinc-500 truncate">{respondendo.body}</p>
            </div>
            <button onClick={() => setRespondendo(null)} className="text-zinc-400 hover:text-red-500 cursor-pointer" aria-label="Cancelar resposta">
              <i className="ri-close-line" />
            </button>
          </div>
        )}
        <div className="flex items-end gap-1.5">
          {/* Uma linha, como o chat do assistente: <textarea> abre o editor em tela cheia do teclado do Android. */}
          <input
            ref={inputRef}
            type="text"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); enviar(); }
              else if (e.key === 'Escape' && respondendo) setRespondendo(null);
            }}
            placeholder={`Mensagem para ${pessoa?.nome?.split(' ')[0] ?? 'a pessoa'}`}
            lang="pt-BR" inputMode="text" enterKeyHint="send" autoCapitalize="sentences" autoCorrect="on" autoComplete="off" spellCheck
            aria-label="Mensagem"
            className="flex-1 min-w-0 px-3 py-2.5 rounded-xl border border-zinc-200 text-sm focus:outline-none focus:border-sky-400"
          />
          <button onClick={() => enviar()} disabled={!texto.trim()} className="w-10 h-10 flex-shrink-0 flex items-center justify-center rounded-xl bg-sky-600 hover:bg-sky-500 text-white disabled:opacity-40 cursor-pointer" aria-label="Enviar">
            <i className="ri-send-plane-2-fill" />
          </button>
        </div>
      </div>

      {/* Segurar a mensagem (ou botão direito): Responder / Copiar */}
      {menu && (
        <div className="absolute inset-0 z-40 flex items-end sm:items-center justify-center bg-black/30 p-3" onClick={() => setMenu(null)}>
          <div className="w-full max-w-sm rounded-2xl bg-white shadow-xl overflow-hidden select-none" style={{ WebkitTouchCallout: 'none' }} onClick={(e) => e.stopPropagation()} role="menu">
            <p className="px-4 pt-3 pb-2 text-xs text-zinc-500 line-clamp-3">{menu.body}</p>
            <button role="menuitem" onClick={() => responder(menu)} className="w-full flex items-center gap-3 px-4 py-3 border-t border-zinc-100 text-sm font-semibold text-zinc-800 hover:bg-zinc-50 cursor-pointer">
              <i className="ri-reply-line text-lg text-sky-600" /> Responder
            </button>
            <button role="menuitem" onClick={() => copiar(menu)} className="w-full flex items-center gap-3 px-4 py-3 border-t border-zinc-100 text-sm font-semibold text-zinc-800 hover:bg-zinc-50 cursor-pointer">
              <i className="ri-file-copy-line text-lg text-zinc-500" /> Copiar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
