// Uma conversa com alguém da loja (2026-09-23). Cobre o painel do chat inteiro (absolute inset-0),
// com cabeçalho próprio: o chat do dono e o das demais pessoas usam o mesmo componente.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useVoltarFecha } from '@/lib/voltarAndroid';
import { chatEquipe, EVENTO_MSG_EQUIPE, iniciais, type MensagemEquipe, type PessoaEquipe } from './api';

export function AvatarPessoa({ pessoa, tamanho = 'w-11 h-11' }: { pessoa: PessoaEquipe | null; tamanho?: string }) {
  if (pessoa?.foto) return <img src={pessoa.foto} alt="" className={`${tamanho} flex-shrink-0 rounded-full object-cover`} />;
  return (
    <span className={`${tamanho} flex-shrink-0 flex items-center justify-center rounded-full bg-sky-100 text-sky-700 text-sm font-black`}>
      {iniciais(pessoa?.nome ?? '?')}
    </span>
  );
}

const diaDe = (iso: string) => new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'long', day: '2-digit', month: '2-digit' });
const horaDe = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });

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
  const [texto, setTexto] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const noFim = useRef(true);
  const ultimoLido = useRef(0);
  // Em ref: callback novo a cada render do pai não pode recarregar a conversa.
  const mudou = useRef(onMudou);
  mudou.current = onMudou;

  useVoltarFecha(true, onVoltar, 'chat-equipe-conversa');

  const marcarLido = useCallback((lista: MensagemEquipe[]) => {
    const ultima = [...lista].reverse().find((m) => !m.temp && m.sender_id !== eu);
    if (!ultima || ultima.id <= ultimoLido.current) return;
    ultimoLido.current = ultima.id;
    chatEquipe('lido', { thread_id: threadId, id: ultima.id }).then(() => mudou.current?.()).catch(() => null);
  }, [eu, threadId]);

  useEffect(() => {
    let vivo = true;
    setCarregado(false); setMsgs([]); setErro(null); ultimoLido.current = 0; noFim.current = true;
    chatEquipe<{ mensagens: MensagemEquipe[]; has_more: boolean; lido_pelo_outro: number }>('mensagens', { thread_id: threadId })
      .then((r) => {
        if (!vivo) return;
        setMsgs(r.mensagens); setHasMore(r.has_more); setLidoPeloOutro(r.lido_pelo_outro);
        marcarLido(r.mensagens);
      })
      .catch((e) => { if (vivo) setErro(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (vivo) setCarregado(true); });
    return () => { vivo = false; };
  }, [threadId, marcarLido]);

  // Chegou pelo Realtime (useConversasEquipe dispara o evento).
  useEffect(() => {
    const aoChegar = (ev: Event) => {
      const m = (ev as CustomEvent).detail as MensagemEquipe & { thread_id: string };
      if (m.thread_id !== threadId) return;
      setMsgs((prev) => {
        if (prev.some((x) => x.id === m.id)) return prev;
        // A minha voltando pelo Realtime antes da resposta do envio: troca a provisória.
        const iTemp = m.sender_id === eu ? prev.findIndex((x) => x.temp && !x.falhou && x.body === m.body) : -1;
        const nova = { id: m.id, sender_id: m.sender_id, body: m.body, created_at: m.created_at };
        const lista = iTemp >= 0 ? prev.map((x, i) => (i === iTemp ? nova : x)) : [...prev, nova];
        if (m.sender_id !== eu && document.visibilityState === 'visible') marcarLido(lista);
        return lista;
      });
    };
    window.addEventListener(EVENTO_MSG_EQUIPE, aoChegar);
    return () => window.removeEventListener(EVENTO_MSG_EQUIPE, aoChegar);
  }, [threadId, eu, marcarLido]);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && noFim.current) el.scrollTop = el.scrollHeight;
  }, [msgs, carregado]);

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

  const enviar = async (reenviar?: MensagemEquipe) => {
    const body = reenviar ? reenviar.body : texto.trim();
    if (!body) return;
    const clientId = crypto.randomUUID();
    const tempId = reenviar?.id ?? -Date.now();
    const temp: MensagemEquipe = { id: tempId, sender_id: eu, body, created_at: new Date().toISOString(), temp: true };
    noFim.current = true;
    setMsgs((prev) => (reenviar ? prev.map((m) => (m.id === tempId ? temp : m)) : [...prev, temp]));
    if (!reenviar) setTexto('');
    setErro(null);
    try {
      const r = await chatEquipe<{ mensagem: MensagemEquipe }>('enviar', { thread_id: threadId, text: body, client_id: clientId });
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

  return (
    <div data-no-pull className="absolute inset-0 z-30 flex flex-col bg-white">
      <div className="flex items-center gap-2.5 px-3 h-14 border-b border-zinc-100 flex-shrink-0">
        <button onClick={onVoltar} className="w-9 h-9 flex items-center justify-center rounded-xl text-zinc-500 hover:bg-zinc-100 cursor-pointer" aria-label="Voltar para as conversas">
          <i className="ri-arrow-left-line text-xl" />
        </button>
        <AvatarPessoa pessoa={pessoa} tamanho="w-9 h-9" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-black text-zinc-900 leading-tight truncate">{pessoa?.nome ?? 'Conversa'}</p>
          {loja && <p className="text-[11px] text-zinc-400 leading-tight truncate">{loja}</p>}
        </div>
        {onFechar && (
          <button onClick={onFechar} className="w-9 h-9 flex items-center justify-center rounded-xl text-zinc-400 hover:bg-zinc-100 cursor-pointer" aria-label="Fechar chat">
            <i className="ri-close-line text-xl" />
          </button>
        )}
      </div>

      <div
        ref={scrollRef}
        onScroll={(e) => { const el = e.currentTarget; noFim.current = el.scrollHeight - el.scrollTop - el.clientHeight < 16; }}
        className="flex-1 overflow-y-auto px-3 py-3 bg-zinc-50/60"
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
            return (
              <div key={m.id}>
                {novoDia && <p className="text-center text-[11px] text-zinc-400 font-semibold py-2 capitalize">{diaDe(m.created_at)}</p>}
                <div className={`flex ${minha ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap break-words ${minha ? 'bg-sky-600 text-white rounded-br-md' : 'bg-white border border-zinc-200 text-zinc-800 rounded-bl-md'} ${m.falhou ? 'opacity-60' : ''}`}>
                    {m.body}
                    <span className={`flex items-center justify-end gap-1 mt-0.5 text-[10px] ${minha ? 'text-sky-100' : 'text-zinc-400'}`}>
                      {horaDe(m.created_at)}
                      {minha && !m.temp && <i className={m.id <= lidoPeloOutro ? 'ri-check-double-line' : 'ri-check-line'} aria-label={m.id <= lidoPeloOutro ? 'Lida' : 'Enviada'} />}
                      {minha && m.temp && !m.falhou && <i className="ri-time-line" aria-label="Enviando" />}
                    </span>
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

      {erro && <p className="px-3 py-1.5 text-xs text-red-600 bg-red-50 border-t border-red-100">{erro}</p>}

      <div className="border-t border-zinc-100 p-2.5 bg-white flex-shrink-0">
        <div className="flex items-end gap-1.5">
          {/* Uma linha, como o chat do assistente: <textarea> abre o editor em tela cheia do teclado do Android. */}
          <input
            type="text"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); enviar(); } }}
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
    </div>
  );
}
