// Chat com o assistente dentro do ERPOS (2026-09-15) — só o dono. Mesma conversa do Telegram
// (Edge assistente-app usa o histórico do chat do Telegram), então dá para começar num e
// continuar no outro. A tela aberta vai junto em cada mensagem ("paga essa", "esse candidato").
//
// variant 'floating': botão redondo no canto + painel (tela cheia no celular).
// variant 'embedded': dentro da página Assistente › Conversa.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';

export const ASSISTENTE_OWNER_EMAIL = 'natalinojr.engel@gmail.com';

interface Msg { id: number; role: 'user' | 'assistant'; content: string; channel: string; created_at: string; temp?: boolean }
interface Poll { type: 'poll'; question: string; options: string[] }
interface Payment {
  id: string; kind: 'pix' | 'boleto'; amount: number; beneficiary_name: string | null; pix_key: string | null;
  due_date: string | null; description: string | null; status: string; status_label: string; error: string | null; created_at: string;
}
interface Attach { base64: string; media_type: string; name: string; preview: string | null }

async function call<T>(action: string, extra: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.functions.invoke('assistente-app', { body: { action, ...extra } });
  if (error) {
    let msg = error.message;
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === 'function') {
      try { const b = await ctx.json(); if (b?.error) msg = String(b.error); } catch { /* corpo não-JSON */ }
    }
    throw new Error(msg);
  }
  const resp = data as { success?: boolean; error?: string; data?: T } | null;
  if (!resp?.success) throw new Error(resp?.error || 'Falha na operação');
  return resp.data as T;
}

const blobToBase64 = (b: Blob) => new Promise<string>((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''));
  r.onerror = () => reject(r.error);
  r.readAsDataURL(b);
});

// Foto do celular chega com 4–8 MB: reduz para 1600 px (JPEG) antes de mandar — lê igual e sobe rápido.
async function shrinkImage(file: File): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image(); i.onload = () => resolve(i); i.onerror = reject; i.src = url;
    });
    const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
    if (scale === 1 && file.size < 1.5 * 1024 * 1024) return file;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.width * scale); canvas.height = Math.round(img.height * scale);
    canvas.getContext('2d')?.drawImage(img, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b ?? file), 'image/jpeg', 0.85));
  } finally { URL.revokeObjectURL(url); }
}

const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const hora = (iso: string) => {
  const d = new Date(iso);
  const hoje = new Date().toDateString() === d.toDateString();
  return d.toLocaleString('pt-BR', hoje ? { hour: '2-digit', minute: '2-digit' } : { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
};
const CANAL: Record<string, string> = { telegram: 'Telegram', app: 'ERPOS', whatsapp: 'WhatsApp', cron: 'Automático' };

// O modelo escreve no estilo WhatsApp (*negrito*, _itálico_). Sem HTML: só quebra em pedaços.
function formatar(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(^|[\s(])(\*[^*\n]+\*|_[^_\n]+_)(?=[\s).,;:!?]|$)/g;
  let last = 0; let m: RegExpExecArray | null; let k = 0;
  while ((m = re.exec(text))) {
    const start = m.index + m[1].length;
    if (start > last) out.push(text.slice(last, start));
    const inner = m[2].slice(1, -1);
    out.push(m[2][0] === '*' ? <b key={k++}>{inner}</b> : <i key={k++}>{inner}</i>);
    last = start + m[2].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
// O que o ERPOS/Telegram acrescenta à mensagem do dono não precisa aparecer no balão.
function limparUser(content: string): { text: string; audio: boolean; arquivo: string | null } {
  let t = content.replace(/^\[Pelo ERPOS[^\]]*\]\n?/, '');
  let arquivo: string | null = null;
  const fm = t.match(/^\[(Foto|PDF)\]\s*/);
  if (fm) { arquivo = fm[1]; t = t.slice(fm[0].length); }
  t = t.replace(/^\[(Foto|PDF) sem legenda\]$/, '');
  const audio = /^\[Áudio\]\s*/.test(t);
  if (audio) t = t.replace(/^\[Áudio\]\s*/, '');
  return { text: t.replace(/^\[Pelo ERPOS[^\]]*\]\n?/, '').trim(), audio, arquivo };
}

function PaymentCard({ p, onAction }: { p: Payment; onAction: (p: Payment, op: 'ok' | 'no' | 'st') => void }) {
  const aberto = ['draft', 'awaiting_pin'].includes(p.status);
  const andamento = ['sending', 'sent', 'pending_approval', 'approved', 'scheduled'].includes(p.status);
  const cor = p.status === 'paid' ? 'border-emerald-200 bg-emerald-50' : ['failed', 'rejected'].includes(p.status) ? 'border-red-200 bg-red-50' : ['cancelled', 'expired'].includes(p.status) ? 'border-zinc-200 bg-zinc-50 opacity-70' : 'border-violet-200 bg-white';
  return (
    <div className={`rounded-2xl border px-3.5 py-3 text-sm ${cor}`}>
      <div className="flex items-start gap-2">
        <i className={`${p.kind === 'pix' ? 'ri-qr-code-line' : 'ri-barcode-line'} text-violet-600 mt-0.5`} />
        <div className="flex-1 min-w-0">
          <p className="font-bold text-zinc-900">{p.kind === 'pix' ? 'Pix' : 'Boleto'} de {brl(p.amount)}</p>
          {p.beneficiary_name && <p className="text-xs text-zinc-600 truncate">Para: {p.beneficiary_name}{p.pix_key ? ` · ${p.pix_key}` : ''}</p>}
          {p.due_date && <p className="text-xs text-zinc-500">Vence {p.due_date.slice(0, 10).split('-').reverse().join('/')}</p>}
          {p.description && <p className="text-xs text-zinc-500 truncate">{p.description}</p>}
          <p className="text-[11px] font-semibold text-zinc-500 mt-1">{p.status_label}{p.error ? ` — ${p.error}` : ''}</p>
          {p.status === 'pending_approval' && <p className="text-[11px] text-amber-700">Abra o app do Inter › Aprovações para liberar.</p>}
        </div>
      </div>
      {(aberto || andamento) && (
        <div className="flex gap-2 mt-2.5">
          {aberto && (
            <button onClick={() => onAction(p, 'ok')} className="flex-1 h-9 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-sm font-bold cursor-pointer">
              <i className="ri-check-line" /> Pagar
            </button>
          )}
          {andamento && (
            <button onClick={() => onAction(p, 'st')} className="flex-1 h-9 rounded-xl border border-zinc-200 text-zinc-700 text-sm font-bold hover:bg-zinc-50 cursor-pointer">
              <i className="ri-refresh-line" /> Ver status
            </button>
          )}
          <button onClick={() => onAction(p, 'no')} className="px-3 h-9 rounded-xl border border-zinc-200 text-zinc-500 text-sm font-bold hover:bg-zinc-50 cursor-pointer">
            Cancelar
          </button>
        </div>
      )}
    </div>
  );
}

export default function AssistenteChat({ variant }: { variant: 'floating' | 'embedded' }) {
  const { user } = useAuth();
  const location = useLocation();
  const [open, setOpen] = useState(variant === 'embedded');
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [attach, setAttach] = useState<Attach | null>(null);
  const [sending, setSending] = useState(false);
  const [recording, setRecording] = useState<MediaRecorder | null>(null);
  const [polls, setPolls] = useState<Record<number, Poll[]>>({});
  const [pays, setPays] = useState<Payment[]>([]);
  const [pinFor, setPinFor] = useState<Payment | null>(null);
  const [pin, setPin] = useState('');
  const [pinErr, setPinErr] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const lastId = useRef(0);
  const stick = useRef(true);

  const toBottom = () => requestAnimationFrame(() => { const el = scrollRef.current; if (el) el.scrollTop = el.scrollHeight; });

  const merge = useCallback((novas: Msg[]) => {
    if (!novas.length) return;
    lastId.current = Math.max(lastId.current, ...novas.map((m) => m.id));
    setMsgs((prev) => {
      const ids = new Set(prev.filter((m) => !m.temp).map((m) => m.id));
      return [...prev.filter((m) => !m.temp), ...novas.filter((m) => !ids.has(m.id))];
    });
    if (stick.current) toBottom();
  }, []);

  const carregarPagamentos = useCallback(async () => {
    try { setPays((await call<{ payments: Payment[] }>('payments')).payments); } catch { /* cartões são extra */ }
  }, []);

  const sincronizar = useCallback(async () => {
    if (!lastId.current) return;
    try { merge((await call<{ messages: Msg[] }>('history', { after_id: lastId.current })).messages); } catch { /* tenta no próximo ciclo */ }
  }, [merge]);

  // Primeira carga ao abrir
  useEffect(() => {
    if (!open || loaded) return;
    (async () => {
      try {
        const h = await call<{ messages: Msg[]; has_more: boolean }>('history');
        setMsgs(h.messages); setHasMore(h.has_more);
        lastId.current = h.messages.length ? h.messages[h.messages.length - 1].id : 0;
        setLoaded(true); setErro(null); toBottom();
      } catch (e) { setErro(e instanceof Error ? e.message : String(e)); }
      carregarPagamentos();
    })();
  }, [open, loaded, carregarPagamentos]);

  // Aberto: pega o que chegou por outro canal (Telegram, avisos automáticos) e o status dos pagamentos.
  useEffect(() => {
    if (!open || !loaded) return;
    const t = setInterval(() => {
      if (document.hidden || sending) return;
      sincronizar();
      carregarPagamentos();
    }, 8000);
    return () => clearInterval(t);
  }, [open, loaded, sending, sincronizar, carregarPagamentos]);

  const maisAntigas = async () => {
    const primeiro = msgs.find((m) => !m.temp);
    if (!primeiro) return;
    const el = scrollRef.current; const h0 = el?.scrollHeight ?? 0;
    try {
      const h = await call<{ messages: Msg[]; has_more: boolean }>('history', { before_id: primeiro.id });
      setMsgs((prev) => [...h.messages, ...prev]); setHasMore(h.has_more);
      requestAnimationFrame(() => { if (el) el.scrollTop = el.scrollHeight - h0; });
    } catch { /* ignora */ }
  };

  const enviar = async (override?: string, audio?: { base64: string; media_type: string }) => {
    const t = (override ?? text).trim();
    if ((!t && !attach && !audio) || sending) return;
    const temp: Msg = {
      id: -Date.now(), role: 'user', channel: 'app', created_at: new Date().toISOString(), temp: true,
      content: audio ? '[Áudio] (transcrevendo…)' : `${attach ? `[${attach.media_type === 'application/pdf' ? 'PDF' : 'Foto'}] ` : ''}${t}`,
    };
    setMsgs((p) => [...p, temp]); stick.current = true; toBottom();
    const anexo = attach; setText(''); setAttach(null); setSending(true); setErro(null);
    try {
      const out = await call<{ reply: string; actions: Array<{ type: string } & Record<string, unknown>> }>('send', {
        text: t,
        ...(anexo ? { attachment: { base64: anexo.base64, media_type: anexo.media_type } } : {}),
        ...(audio ? { audio } : {}),
        contexto: { rota: location.pathname + location.search, titulo: document.title, loja: user?.loja ?? null },
      });
      const antes = lastId.current;
      const h = await call<{ messages: Msg[] }>('history', { after_id: antes });
      merge(h.messages);
      const ultimaResp = [...h.messages].reverse().find((m) => m.role === 'assistant');
      const enquetes = out.actions.filter((a) => a.type === 'poll') as unknown as Poll[];
      if (ultimaResp && enquetes.length) setPolls((p) => ({ ...p, [ultimaResp.id]: enquetes }));
      if (out.actions.some((a) => a.type === 'payment')) carregarPagamentos();
    } catch (e) {
      setMsgs((p) => p.filter((m) => m.id !== temp.id));
      if (!override && !audio) { setText(t); setAttach(anexo); }
      setErro(e instanceof Error ? e.message : String(e));
    } finally { setSending(false); }
  };

  const escolherArquivo = async (f: File | undefined) => {
    if (!f) return;
    const isPdf = f.type === 'application/pdf';
    if (!isPdf && !f.type.startsWith('image/')) { setErro('Mande foto ou PDF.'); return; }
    try {
      const blob = isPdf ? f : await shrinkImage(f);
      if (blob.size > 10 * 1024 * 1024) { setErro('Arquivo grande demais (máx. 10 MB).'); return; }
      const media_type = isPdf ? 'application/pdf' : blob.type || 'image/jpeg';
      setAttach({ base64: await blobToBase64(blob), media_type, name: f.name, preview: isPdf ? null : URL.createObjectURL(blob) });
    } catch { setErro('Não consegui abrir esse arquivo.'); }
  };

  const gravar = async () => {
    if (recording) { recording.stop(); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((m) => MediaRecorder.isTypeSupported?.(m)) ?? '';
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      const parts: Blob[] = [];
      rec.ondataavailable = (e) => { if (e.data.size) parts.push(e.data); };
      rec.onstop = async () => {
        stream.getTracks().forEach((tr) => tr.stop());
        setRecording(null);
        const blob = new Blob(parts, { type: rec.mimeType || 'audio/webm' });
        if (blob.size < 2000) return; // toque sem fala
        enviar(text, { base64: await blobToBase64(blob), media_type: blob.type });
      };
      rec.start();
      setRecording(rec);
    } catch { setErro('Sem acesso ao microfone. Libere nas permissões do navegador.'); }
  };

  const acaoPagamento = async (p: Payment, op: 'ok' | 'no' | 'st') => {
    if (op === 'ok') { setPin(''); setPinErr(null); setPinFor(p); return; }
    try {
      const out = await call<{ payment: Payment }>('pay', { id: p.id, op });
      setPays((prev) => prev.map((x) => (x.id === p.id ? out.payment : x)));
      if (op === 'no') sincronizar();
    } catch (e) { setErro(e instanceof Error ? e.message : String(e)); }
  };

  const confirmarPin = async () => {
    if (!pinFor || !/^\d{4,8}$/.test(pin) || paying) return;
    setPaying(true); setPinErr(null);
    try {
      const out = await call<{ payment: Payment }>('pay', { id: pinFor.id, op: 'ok', pin });
      setPays((prev) => prev.map((x) => (x.id === pinFor.id ? out.payment : x)));
      setPinFor(null); setPin('');
      sincronizar();
    } catch (e) { setPinErr(e instanceof Error ? e.message : String(e)); setPin(''); }
    finally { setPaying(false); }
  };

  if (user?.email?.toLowerCase() !== ASSISTENTE_OWNER_EMAIL) return null;

  const pagamentosVisiveis = pays.filter((p) => !['cancelled', 'expired'].includes(p.status));

  const painel = (
    <div className={variant === 'floating'
      ? 'fixed z-[60] inset-0 sm:inset-auto sm:bottom-5 sm:right-5 sm:w-[420px] sm:h-[min(720px,calc(100vh-40px))] flex flex-col bg-white sm:rounded-2xl sm:border sm:border-zinc-200 shadow-2xl overflow-hidden'
      : 'flex flex-col h-[70vh] rounded-2xl border border-zinc-200 bg-white overflow-hidden'}>
      {/* Cabeçalho */}
      <div className="flex items-center gap-2.5 px-4 h-14 border-b border-zinc-100 flex-shrink-0">
        <div className="w-8 h-8 flex items-center justify-center rounded-xl bg-violet-50 border border-violet-200">
          <i className="ri-robot-2-line text-violet-600" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-black text-zinc-900 leading-tight">Assistente</p>
          <p className="text-[11px] text-zinc-400 leading-tight truncate">{sending ? 'pensando…' : 'Mesma conversa do Telegram'}</p>
        </div>
        {variant === 'floating' && (
          <button onClick={() => setOpen(false)} className="w-9 h-9 flex items-center justify-center rounded-xl text-zinc-400 hover:bg-zinc-100 cursor-pointer" aria-label="Fechar chat">
            <i className="ri-close-line text-xl" />
          </button>
        )}
      </div>

      {/* Mensagens */}
      <div
        ref={scrollRef}
        onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }}
        className="flex-1 overflow-y-auto px-3 py-3 space-y-2 bg-zinc-50/60"
      >
        {!loaded && !erro && <div className="mx-auto my-16 w-6 h-6 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />}
        {hasMore && (
          <button onClick={maisAntigas} className="block mx-auto text-xs text-violet-600 font-semibold py-1 cursor-pointer">Carregar mensagens anteriores</button>
        )}
        {loaded && msgs.length === 0 && <p className="text-sm text-zinc-400 text-center py-10">Pode falar: texto, áudio, foto ou PDF.</p>}
        {msgs.map((m) => {
          if (m.role === 'user') {
            const u = limparUser(m.content);
            return (
              <div key={m.id} className="flex justify-end">
                <div className={`max-w-[85%] rounded-2xl rounded-br-md px-3.5 py-2 text-sm whitespace-pre-wrap break-words bg-violet-600 text-white ${m.temp ? 'opacity-70' : ''}`}>
                  {u.arquivo && <span className="flex items-center gap-1 text-violet-100 text-xs mb-0.5"><i className={u.arquivo === 'PDF' ? 'ri-file-pdf-2-line' : 'ri-image-line'} /> {u.arquivo}</span>}
                  {u.audio && <i className="ri-mic-line mr-1 text-violet-200" />}
                  {u.text}
                  <div className="text-[10px] mt-1 text-violet-200 text-right">{hora(m.created_at)}{m.channel !== 'app' ? ` · ${CANAL[m.channel] ?? m.channel}` : ''}</div>
                </div>
              </div>
            );
          }
          const sistema = /^\[(Pagamento|PIN|Leitura)/.test(m.content);
          if (sistema) {
            return <p key={m.id} className="text-center text-[11px] text-zinc-400 px-6">{m.content.replace(/^\[|\]\s*id\s+\S+$/g, '').replace(/\]$/, '')} · {hora(m.created_at)}</p>;
          }
          return (
            <div key={m.id} className="flex justify-start">
              <div className="max-w-[85%]">
                <div className="rounded-2xl rounded-bl-md px-3.5 py-2 text-sm whitespace-pre-wrap break-words bg-white border border-zinc-200 text-zinc-800">
                  {formatar(m.content.replace(/\n\[(Enquete enviada|Localização enviada|Contato enviado|Pedido de pagamento enviado)[^\n]*\]/g, ''))}
                  <div className="text-[10px] mt-1 text-zinc-400">{hora(m.created_at)}{m.channel !== 'app' ? ` · ${CANAL[m.channel] ?? m.channel}` : ''}</div>
                </div>
                {(polls[m.id] ?? []).map((pl, i) => (
                  <div key={i} className="mt-1.5 space-y-1.5">
                    <p className="text-xs font-bold text-zinc-600">{pl.question}</p>
                    {pl.options.map((o) => (
                      <button
                        key={o}
                        disabled={sending}
                        onClick={() => { setPolls((p) => ({ ...p, [m.id]: [] })); enviar(`[Botão "${pl.question}"] Resposta: ${o}`); }}
                        className="block w-full text-left px-3 py-2 rounded-xl border border-violet-200 bg-white text-sm text-violet-700 font-semibold hover:bg-violet-50 disabled:opacity-50 cursor-pointer"
                      >{o}</button>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
        {sending && (
          <div className="flex justify-start">
            <div className="rounded-2xl rounded-bl-md px-4 py-3 bg-white border border-zinc-200 flex gap-1">
              {[0, 1, 2].map((i) => <span key={i} className="w-1.5 h-1.5 rounded-full bg-zinc-400 animate-bounce" style={{ animationDelay: `${i * 150}ms` }} />)}
            </div>
          </div>
        )}
      </div>

      {/* Pagamentos esperando decisão */}
      {pagamentosVisiveis.length > 0 && (
        <div className="max-h-[38%] overflow-y-auto border-t border-zinc-100 px-3 py-2 space-y-2 bg-white flex-shrink-0">
          {pagamentosVisiveis.map((p) => <PaymentCard key={p.id} p={p} onAction={acaoPagamento} />)}
        </div>
      )}

      {/* Entrada */}
      <div className="border-t border-zinc-100 p-2.5 bg-white flex-shrink-0">
        {erro && <p className="text-xs text-red-600 px-1 pb-1.5">{erro}</p>}
        {attach && (
          <div className="flex items-center gap-2 mb-2 px-2 py-1.5 rounded-xl bg-zinc-50 border border-zinc-200">
            {attach.preview ? <img src={attach.preview} alt="" className="w-10 h-10 rounded-lg object-cover" /> : <i className="ri-file-pdf-2-line text-2xl text-red-500" />}
            <span className="flex-1 text-xs text-zinc-600 truncate">{attach.name}</span>
            <button onClick={() => setAttach(null)} className="text-zinc-400 hover:text-red-500 cursor-pointer" aria-label="Tirar anexo"><i className="ri-close-line" /></button>
          </div>
        )}
        <div className="flex items-end gap-1.5">
          <input ref={fileRef} type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => { escolherArquivo(e.target.files?.[0]); e.target.value = ''; }} />
          <button onClick={() => fileRef.current?.click()} disabled={sending || !!recording} className="w-10 h-10 flex-shrink-0 flex items-center justify-center rounded-xl text-zinc-500 hover:bg-zinc-100 disabled:opacity-40 cursor-pointer" aria-label="Anexar foto ou PDF">
            <i className="ri-attachment-2 text-xl" />
          </button>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && window.matchMedia('(min-width: 640px)').matches) { e.preventDefault(); enviar(); } }}
            rows={1}
            placeholder={recording ? 'Gravando… toque no microfone para enviar' : 'Mensagem'}
            disabled={!!recording}
            className="flex-1 min-w-0 max-h-32 resize-none px-3 py-2.5 rounded-xl border border-zinc-200 text-sm focus:outline-none focus:border-violet-400 [field-sizing:content]"
          />
          {text.trim() || attach ? (
            <button onClick={() => enviar()} disabled={sending} className="w-10 h-10 flex-shrink-0 flex items-center justify-center rounded-xl bg-violet-600 hover:bg-violet-500 text-white disabled:opacity-40 cursor-pointer" aria-label="Enviar">
              <i className="ri-send-plane-2-fill" />
            </button>
          ) : (
            <button onClick={gravar} disabled={sending} className={`w-10 h-10 flex-shrink-0 flex items-center justify-center rounded-xl text-white disabled:opacity-40 cursor-pointer ${recording ? 'bg-red-500 animate-pulse' : 'bg-violet-600 hover:bg-violet-500'}`} aria-label={recording ? 'Parar e enviar áudio' : 'Gravar áudio'}>
              <i className={recording ? 'ri-stop-fill' : 'ri-mic-fill'} />
            </button>
          )}
        </div>
      </div>

      {/* PIN do pagamento — não passa pelo modelo nem fica no histórico */}
      {pinFor && (
        <div className="absolute inset-0 z-10 flex items-end sm:items-center justify-center bg-black/40 p-3" onClick={() => !paying && setPinFor(null)}>
          <form
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => { e.preventDefault(); confirmarPin(); }}
            className="w-full max-w-xs rounded-2xl bg-white p-5 text-center"
          >
            <i className="ri-lock-2-line text-2xl text-violet-600" />
            <p className="text-base font-black text-zinc-900 mt-1">{pinFor.kind === 'pix' ? 'Pix' : 'Boleto'} de {brl(pinFor.amount)}</p>
            {pinFor.beneficiary_name && <p className="text-xs text-zinc-500">para {pinFor.beneficiary_name}</p>}
            <input
              autoFocus
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
              inputMode="numeric"
              type="password"
              autoComplete="off"
              placeholder="PIN"
              className="mt-4 w-full h-12 text-center text-xl tracking-[0.4em] rounded-xl border border-zinc-200 focus:outline-none focus:border-violet-400"
            />
            {pinErr && <p className="text-xs text-red-600 mt-2">{pinErr}</p>}
            <p className="text-[11px] text-zinc-400 mt-2">Mesmo PIN do Telegram. Depois o Inter ainda pede a sua aprovação no app.</p>
            <div className="flex gap-2 mt-4">
              <button type="button" onClick={() => setPinFor(null)} disabled={paying} className="flex-1 h-10 rounded-xl border border-zinc-200 text-sm font-bold text-zinc-600 cursor-pointer">Voltar</button>
              <button type="submit" disabled={paying || pin.length < 4} className="flex-1 h-10 rounded-xl bg-violet-600 text-white text-sm font-bold disabled:opacity-40 cursor-pointer">
                {paying ? 'Enviando…' : 'Pagar'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );

  if (variant === 'embedded') return <div className="relative">{painel}</div>;
  return open ? (
    <div className="relative">{painel}</div>
  ) : (
    <button
      onClick={() => setOpen(true)}
      className="fixed z-[55] bottom-5 right-5 w-14 h-14 rounded-full bg-violet-600 hover:bg-violet-500 text-white shadow-lg flex items-center justify-center cursor-pointer"
      aria-label="Falar com o assistente"
    >
      <i className="ri-robot-2-line text-2xl" />
      {pagamentosVisiveis.some((p) => p.status === 'draft') && <span className="absolute top-1 right-1 w-3 h-3 rounded-full bg-red-500 border-2 border-white" />}
    </button>
  );
}
