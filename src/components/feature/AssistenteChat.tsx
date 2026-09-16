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
import { SHARE_KEY, type SharePayload } from '@/lib/shareIntake';

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

// Notificação no celular (Web Push do PWA): os avisos do assistente chegam e abrem este chat.
// Some quando já está ativa; lib/push carregada só aqui (import dinâmico).
function BotaoNotificacao({ tenantId }: { tenantId: string | undefined }) {
  const [estado, setEstado] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  // Dentro do app Android (Capacitor) o Web Push não existe: usa a notificação nativa (Firebase),
  // e só quando o servidor diz que o Firebase está configurado (send-push › fcm_status).
  type PN = { [k: string]: (a?: unknown, b?: unknown) => Promise<unknown> };
  const pn = (window as unknown as { Capacitor?: { Plugins?: Record<string, PN> } }).Capacitor?.Plugins?.PushNotifications;
  useEffect(() => {
    if (!pn) {
      import('@/lib/push').then((m) => m.estadoPush()).then(setEstado).catch(() => setEstado('nao-suportado'));
      return;
    }
    (async () => {
      try {
        const { data } = await supabase.functions.invoke('send-push', { body: { action: 'fcm_status' } });
        if (!(data as { configured?: boolean } | null)?.configured) { setEstado('nao-suportado'); return; }
        // Tocar na notificação abre a tela que veio no aviso (ex.: /assistente).
        await pn.addListener('pushNotificationActionPerformed', (ev: unknown) => {
          const url = (ev as { notification?: { data?: { url?: string } } })?.notification?.data?.url;
          if (url && url.startsWith('/')) window.location.assign(url);
        });
        const perm = (await pn.checkPermissions()) as { receive?: string };
        let ok = false;
        try { ok = localStorage.getItem('erpos-fcm-ok') === '1'; } catch { /* sem storage */ }
        setEstado(perm?.receive === 'granted' && ok ? 'ativo' : perm?.receive === 'denied' ? 'negado' : 'inativo');
      } catch { setEstado('nao-suportado'); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!estado || estado === 'ativo' || estado === 'nao-suportado') return null;
  const ativar = async () => {
    if (!tenantId) return;
    if (pn) {
      try {
        const perm = (await pn.requestPermissions()) as { receive?: string };
        if (perm?.receive !== 'granted') { setEstado('negado'); return; }
        await pn.createChannel({ id: 'erpos', name: 'Avisos do ERPOS', importance: 5, visibility: 1 }).catch(() => {});
        await pn.addListener('registration', async (t: unknown) => {
          const token = String((t as { value?: string })?.value ?? '');
          if (!token) return;
          const { data } = await supabase.functions.invoke('send-push', {
            body: { action: 'subscribe', active_tenant_id: tenantId, subscription: { endpoint: `fcm:${token}`, keys: { p256dh: 'fcm', auth: 'fcm' } } },
          });
          if ((data as { success?: boolean } | null)?.success) {
            try { localStorage.setItem('erpos-fcm-ok', '1'); } catch { /* sem storage */ }
            setEstado('ativo');
          } else setMsg('Não deu para registrar o aparelho.');
        });
        await pn.addListener('registrationError', () => setMsg('O Firebase recusou o registro deste aparelho.'));
        await pn.register();
      } catch (e) { setMsg(e instanceof Error ? e.message : 'Não deu para ativar.'); }
      return;
    }
    const m = await import('@/lib/push');
    const r = await m.ativarPush(tenantId);
    if (r.ok) setEstado('ativo'); else setMsg(r.erro ?? 'Não deu para ativar.');
  };
  return (
    <button
      onClick={ativar}
      title={msg ?? (estado === 'negado' ? 'Notificações bloqueadas: libere nas configurações do navegador' : 'Receber os avisos do assistente no celular')}
      className={`flex items-center gap-1 px-2.5 h-8 rounded-lg text-[11px] font-bold cursor-pointer ${msg || estado === 'negado' ? 'text-red-600 bg-red-50' : 'text-violet-700 bg-violet-50 hover:bg-violet-100'}`}
    >
      <i className="ri-notification-3-line" /> {estado === 'negado' ? 'Bloqueadas' : msg ? 'Tentar de novo' : 'Ativar avisos'}
    </button>
  );
}

export default function AssistenteChat({ variant }: { variant: 'floating' | 'embedded' }) {
  const { user } = useAuth();
  const location = useLocation();
  // Três estágios no modo flutuante (pedido do dono, 2026-09-16): botão redondo → barra pequena
  // (digitar rápido, sem cobrir a tela) → conversa inteira. Arrastar a barra para cima abre a
  // conversa. `open` = carrega histórico e fica sincronizando (vale para barra e conversa).
  type Modo = 'fab' | 'mini' | 'full';
  const [modo, setModo] = useState<Modo>(variant === 'embedded' ? 'full' : 'fab');
  const open = modo !== 'fab';
  const setOpen = (v: boolean) => setModo(v ? 'full' : 'fab');
  const arrasteY = useRef(0);
  // Abertura da conversa: sobe deslizando (translate-y) em vez de aparecer de uma vez, e já entra
  // no fim do histórico — pedido do dono (2026-09-16).
  const [subindo, setSubindo] = useState(false);
  useEffect(() => {
    if (modo !== 'full') { setSubindo(false); return; }
    setSubindo(false); // começa embaixo…
    const r = requestAnimationFrame(() => {
      setSubindo(true); // …e sobe no quadro seguinte (transição CSS)
      stick.current = true;
      toBottom(); // abre sempre no fim da conversa
    });
    return () => cancelAnimationFrame(r);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modo]);
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
  // Aba de assunto ('' = tudo). A conversa é uma só; a aba só filtra (asst_messages.topic).
  const [aba, setAba] = useState('');
  const abaRef = useRef('');

  // "Compartilhar" do Android: quem recebe é o src/lib/shareIntake, no início do app (main.tsx) —
  // o app abre na última rota usada, às vezes sem chat nenhum na tela, e o conteúdo se perdia
  // (2026-09-15). Ele guarda no sessionStorage e manda para /assistente; aqui só consumimos.
  useEffect(() => {
    if (user?.email?.toLowerCase() !== ASSISTENTE_OWNER_EMAIL) return;
    const consumir = () => {
      let cru: string | null = null;
      try { cru = sessionStorage.getItem(SHARE_KEY); } catch { return; }
      if (!cru) return;
      try { sessionStorage.removeItem(SHARE_KEY); } catch { /* sem storage */ }
      let p: SharePayload;
      try { p = JSON.parse(cru) as SharePayload; } catch { return; }
      setOpen(true);
      if (p.kind === 'texto') { setText((prev) => (prev ? `${prev}\n${p.texto}` : p.texto)); return; }
      try {
        const bin = atob(p.base64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        escolherArquivo(new File([bytes], p.nome, { type: p.media_type }));
      } catch { setErro('Não consegui abrir o arquivo compartilhado.'); }
    };
    consumir();
    // App já aberto na tela do assistente: o shareIntake avisa por evento.
    window.addEventListener('erpos-share', consumir);
    return () => window.removeEventListener('erpos-share', consumir);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.email]);
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
    try { merge((await call<{ messages: Msg[] }>('history', { after_id: lastId.current, topic: abaRef.current || undefined })).messages); } catch { /* tenta no próximo ciclo */ }
  }, [merge]);

  // Trocou de aba: recomeça a lista com o filtro novo.
  useEffect(() => {
    if (abaRef.current === aba) return;
    abaRef.current = aba;
    lastId.current = 0;
    setMsgs([]); setPolls({}); setLoaded(false);
  }, [aba]);

  // Primeira carga ao abrir (e a cada troca de aba)
  const isOwner = user?.email?.toLowerCase() === ASSISTENTE_OWNER_EMAIL;
  useEffect(() => {
    // Sem ser o dono não chama nada (o componente já não aparece; o servidor também recusa).
    if (!open || loaded || !isOwner) return;
    (async () => {
      try {
        const h = await call<{ messages: Msg[]; has_more: boolean }>('history', { topic: abaRef.current || undefined });
        setMsgs(h.messages); setHasMore(h.has_more);
        lastId.current = h.messages.length ? h.messages[h.messages.length - 1].id : 0;
        setLoaded(true); setErro(null); toBottom();
      } catch (e) { setErro(e instanceof Error ? e.message : String(e)); }
      carregarPagamentos();
    })();
  }, [open, loaded, isOwner, carregarPagamentos]); // isOwner: o login pode chegar depois do 1º render

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
      const h = await call<{ messages: Msg[]; has_more: boolean }>('history', { before_id: primeiro.id, topic: abaRef.current || undefined });
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
        topic: abaRef.current || undefined,
        ...(anexo ? { attachment: { base64: anexo.base64, media_type: anexo.media_type } } : {}),
        ...(audio ? { audio } : {}),
        contexto: { rota: location.pathname + location.search, titulo: document.title, loja: user?.loja ?? null },
      });
      // Mostra a resposta na hora: esperar a ida extra ao servidor (history) para acertar os ids
      // atrasava a resposta em ~1 s no celular. O merge() descarta os provisórios logo depois.
      setMsgs((p) => [...p, { id: -Date.now(), role: 'assistant', channel: 'app', created_at: new Date().toISOString(), content: out.reply, temp: true }]);
      stick.current = true; toBottom();
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

  // Digital no lugar do PIN (só no app Android, plugin NativeBiometric): depois do 1º pagamento com
  // o PIN digitado, o PIN fica no Keystore do aparelho protegido pela biometria (BIOMETRY_ANY). O
  // servidor continua conferindo o PIN — a digital só destrava o PIN guardado no próprio celular.
  type Bio = { [k: string]: (a?: unknown) => Promise<unknown> };
  const bio = (): Bio | undefined => (window as unknown as { Capacitor?: { Plugins?: Record<string, Bio> } }).Capacitor?.Plugins?.NativeBiometric;
  const BIO_SERVER = 'erpos-pay-pin';
  const [bioDisponivel, setBioDisponivel] = useState(false);
  const [guardarBio, setGuardarBio] = useState(true);

  const pagarComPin = async (p: Payment, pinValue: string, daDigital: boolean) => {
    setPaying(true); setPinErr(null);
    try {
      const out = await call<{ payment: Payment }>('pay', { id: p.id, op: 'ok', pin: pinValue });
      setPays((prev) => prev.map((x) => (x.id === p.id ? out.payment : x)));
      setPinFor(null); setPin('');
      if (!daDigital && bioDisponivel && guardarBio) {
        await bio()?.setCredentials({ username: 'pin', password: pinValue, server: BIO_SERVER, accessControl: 2, title: 'Usar a digital nos pagamentos' }).catch(() => {});
      }
      sincronizar();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // PIN guardado não confere mais (trocado pelo /pin no Telegram): esquece e pede digitado.
      if (daDigital && /PIN errado/i.test(msg)) await bio()?.deleteCredentials({ server: BIO_SERVER }).catch(() => {});
      setPinErr(daDigital && /PIN errado/i.test(msg) ? 'O PIN guardado mudou. Digite o PIN novo.' : msg);
      setPin('');
    } finally { setPaying(false); }
  };

  const acaoPagamento = async (p: Payment, op: 'ok' | 'no' | 'st') => {
    if (op === 'ok') {
      setPin(''); setPinErr(null); setPinFor(p);
      const b = bio();
      if (!b) return;
      try {
        const disp = (await b.isAvailable({ useFallback: false })) as { isAvailable?: boolean };
        setBioDisponivel(!!disp?.isAvailable);
        if (!disp?.isAvailable) return;
        const salvo = (await b.isCredentialsSaved({ server: BIO_SERVER })) as { isSaved?: boolean };
        if (!salvo?.isSaved) return;
        const cred = (await b.getSecureCredentials({
          server: BIO_SERVER, title: 'Confirmar pagamento', negativeButtonText: 'Digitar PIN',
          reason: `${p.kind === 'pix' ? 'Pix' : 'Boleto'} de ${brl(p.amount)}${p.beneficiary_name ? ` para ${p.beneficiary_name}` : ''}`,
        })) as { password?: string };
        if (cred?.password) await pagarComPin(p, cred.password, true);
      } catch { /* cancelou a digital: fica o PIN digitado */ }
      return;
    }
    try {
      const out = await call<{ payment: Payment }>('pay', { id: p.id, op });
      setPays((prev) => prev.map((x) => (x.id === p.id ? out.payment : x)));
      if (op === 'no') sincronizar();
    } catch (e) { setErro(e instanceof Error ? e.message : String(e)); }
  };

  const confirmarPin = async () => {
    if (!pinFor || !/^\d{4,8}$/.test(pin) || paying) return;
    await pagarComPin(pinFor, pin, false);
  };

  if (user?.email?.toLowerCase() !== ASSISTENTE_OWNER_EMAIL) return null;

  // Rodapé = só o que espera decisão ou está em andamento. Concluído (pago, cancelado, recusado)
  // sai do rodapé: o resultado fica registrado na conversa. Antes, pago ficava fixo por 24 h e
  // tomava a tela (2026-09-16).
  const EM_ABERTO = ['draft', 'awaiting_pin', 'sending', 'sent', 'pending_approval', 'approved', 'scheduled'];
  const pagamentosVisiveis = pays.filter((p) => EM_ABERTO.includes(p.status));
  // Caixa de digitação: a MESMA na barra pequena e na conversa inteira.
  const entrada = (
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
        {/* Campo de UMA linha, igual aos do delivery: em <textarea> o Android abre o "editor em
            tela cheia" do teclado quando o espaço é apertado (16/09/2026). Enter envia. */}
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); enviar(); } }}
          placeholder={recording ? 'Gravando… toque no microfone para enviar' : 'Mensagem'}
          disabled={!!recording}
          lang="pt-BR"
          inputMode="text"
          enterKeyHint="send"
          autoCapitalize="sentences"
          autoCorrect="on"
          autoComplete="off"
          spellCheck
          className="flex-1 min-w-0 px-3 py-2.5 rounded-xl border border-zinc-200 text-sm focus:outline-none focus:border-violet-400"
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
  );

  const painel = (
    <div className={variant === 'floating'
      ? `fixed z-[60] inset-0 sm:inset-auto sm:bottom-5 sm:right-5 sm:w-[420px] sm:h-[min(720px,calc(100vh-40px))] flex flex-col bg-white sm:rounded-2xl sm:border sm:border-zinc-200 shadow-2xl overflow-hidden
         transition-transform duration-200 ease-out sm:translate-y-0 ${subindo ? 'translate-y-0' : 'translate-y-full'}`
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
        <BotaoNotificacao tenantId={user?.tenantId} />
        {variant === 'floating' && (
          <>
            <button onClick={() => setModo('mini')} className="w-9 h-9 flex items-center justify-center rounded-xl text-zinc-400 hover:bg-zinc-100 cursor-pointer" aria-label="Recolher a conversa">
              <i className="ri-arrow-down-s-line text-xl" />
            </button>
            <button onClick={() => setModo('fab')} className="w-9 h-9 flex items-center justify-center rounded-xl text-zinc-400 hover:bg-zinc-100 cursor-pointer" aria-label="Fechar chat">
              <i className="ri-close-line text-xl" />
            </button>
          </>
        )}
      </div>

      {/* Assuntos: filtram a mesma conversa; escrever numa aba já marca a mensagem com o assunto */}
      <div className="flex gap-1 px-2.5 py-1.5 border-b border-zinc-100 overflow-x-auto flex-shrink-0">
        {[
          { id: '', label: 'Tudo', icon: 'ri-chat-3-line' },
          { id: 'pagamentos', label: 'Pagamentos', icon: 'ri-money-dollar-circle-line' },
          { id: 'curriculos', label: 'Currículos', icon: 'ri-file-user-line' },
          { id: 'compras', label: 'Compras', icon: 'ri-shopping-cart-2-line' },
          { id: 'avisos', label: 'Avisos', icon: 'ri-notification-3-line' },
          { id: 'geral', label: 'Geral', icon: 'ri-message-2-line' },
        ].map((t) => (
          <button
            key={t.id || 'tudo'}
            onClick={() => setAba(t.id)}
            disabled={sending}
            className={`flex items-center gap-1 px-2.5 h-7 rounded-lg text-xs font-bold whitespace-nowrap cursor-pointer disabled:opacity-50 ${aba === t.id ? 'bg-zinc-900 text-white' : 'text-zinc-500 hover:bg-zinc-100'}`}
          >
            <i className={t.icon} /> {t.label}
          </button>
        ))}
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

      {entrada}

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
            {bioDisponivel && (
              <label className="flex items-center justify-center gap-2 mt-3 text-xs text-zinc-600 cursor-pointer">
                <input type="checkbox" checked={guardarBio} onChange={(e) => setGuardarBio(e.target.checked)} className="accent-violet-600" />
                Usar a digital nas próximas vezes
              </label>
            )}
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
  if (modo === 'full') return <div className="relative">{painel}</div>;

  // Barra pequena: digitar sem cobrir a tela. Arrastar para cima (ou tocar na alça) abre a conversa.
  if (modo === 'mini') {
    return (
      <div
        className="fixed z-[60] bottom-3 left-3 right-3 sm:left-auto sm:right-5 sm:w-[420px] rounded-2xl border border-zinc-200 bg-white shadow-2xl overflow-hidden"
        onTouchStart={(e) => { arrasteY.current = e.touches[0].clientY; }}
        onTouchMove={(e) => { if (arrasteY.current - e.touches[0].clientY > 24) setModo('full'); }}
      >
        <div className="flex items-center gap-2 px-2 pt-1.5">
          <button onClick={() => setModo('full')} className="flex-1 flex flex-col items-center cursor-pointer" aria-label="Abrir a conversa">
            <span className="w-10 h-1 rounded-full bg-zinc-300" />
          </button>
          <button onClick={() => setModo('fab')} className="w-7 h-7 flex items-center justify-center rounded-lg text-zinc-400 hover:bg-zinc-100 cursor-pointer" aria-label="Fechar chat">
            <i className="ri-close-line" />
          </button>
        </div>
        {sending && <p className="px-3.5 pt-1 pb-0.5 text-[11px] text-zinc-400">pensando…</p>}
        {pagamentosVisiveis.length > 0 && (
          <button onClick={() => setModo('full')} className="block w-full text-left px-3.5 py-1.5 text-xs font-bold text-violet-700 cursor-pointer" aria-label="Ver pagamentos">
            <i className="ri-money-dollar-circle-line" /> {pagamentosVisiveis.length === 1 ? '1 pagamento esperando você' : `${pagamentosVisiveis.length} pagamentos esperando você`}
          </button>
        )}
        {entrada}
      </div>
    );
  }

  return (
    <button
      onClick={() => setModo('mini')}
      className="fixed z-[55] bottom-5 right-5 w-14 h-14 rounded-full bg-violet-600 hover:bg-violet-500 text-white shadow-lg flex items-center justify-center cursor-pointer"
      aria-label="Falar com o assistente"
    >
      <i className="ri-robot-2-line text-2xl" />
      {pagamentosVisiveis.some((p) => p.status === 'draft') && <span className="absolute top-1 right-1 w-3 h-3 rounded-full bg-red-500 border-2 border-white" />}
    </button>
  );
}
