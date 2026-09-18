// Chat com o assistente dentro do ERPOS (2026-09-15) — só o dono. Mesma conversa do Telegram
// (Edge assistente-app usa o histórico do chat do Telegram), então dá para começar num e
// continuar no outro. A tela aberta vai junto em cada mensagem ("paga essa", "esse candidato").
//
// variant 'floating': botão redondo no canto + painel (tela cheia no celular).
// variant 'embedded': dentro da página Assistente › Conversa.
import { Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { SHARE_KEY, type SharePayload } from '@/lib/shareIntake';
import { EVENTO_ASSISTENTE, getFoco, limparFocoItem, resumirFoco, setFocoItem, type PedidoAbrir } from '@/lib/assistenteFoco';
import { useVoltarFecha } from '@/lib/voltarAndroid';
import BotaoAvisos from '@/components/feature/BotaoAvisos';
import { ACOES, GRUPOS } from '@/components/feature/assistente/acoes';
import ItensClassificarCard from '@/components/feature/assistente/ItensClassificarCard';
import PendenciasChat, { type PendenciaChat } from '@/components/feature/assistente/PendenciasChat';

export const ASSISTENTE_OWNER_EMAIL = 'natalinojr.engel@gmail.com';

interface Msg { id: number; role: 'user' | 'assistant'; content: string; channel: string; created_at: string; temp?: boolean }
interface Poll { type: 'poll'; question: string; options: string[] }
// Resposta com botão que LEVA à tela (ferramenta abrir_tela do assistente-brain). Só rota interna
// do ERPOS: o botão chama navigate(), não abre nada de fora.
interface Abrir { type: 'abrir'; rota: string; label: string }
interface TopicoResumo { topic: string; unread: number; last: { role: string; content: string; created_at: string } | null }
// Grupo do WhatsApp como conversa (2026-09-17): tudo que veio daquele grupo (pedido, cupom, resposta).
interface GrupoResumo { group_jid: string; name: string; unread: number; last: { role: string; content: string; created_at: string } | null }
// A conversa aberta é '' (todas), um assunto ('pagamentos'...) ou 'grupo:<jid>'. Vira o filtro da Edge.
const PREFIXO_GRUPO = 'grupo:';
const filtroConversa = (aba: string): Record<string, string> =>
  aba.startsWith(PREFIXO_GRUPO) ? { group_jid: aba.slice(PREFIXO_GRUPO.length) } : aba ? { topic: aba } : {};

// Os assuntos, na ordem em que aparecem na lista de conversas. 'geral' primeiro: é a conversa do
// dia a dia. O id vazio não entra aqui — "Todas as mensagens" é uma linha à parte.
const ASSUNTOS = [
  { id: 'geral', label: 'Geral', icon: 'ri-message-2-line', cor: 'bg-zinc-100 text-zinc-600' },
  { id: 'pagamentos', label: 'Financeiro', icon: 'ri-money-dollar-circle-line', cor: 'bg-emerald-50 text-emerald-600' },
  { id: 'compras', label: 'Compras e estoque', icon: 'ri-shopping-cart-2-line', cor: 'bg-amber-50 text-amber-600' },
  { id: 'curriculos', label: 'Currículos', icon: 'ri-file-user-line', cor: 'bg-rose-50 text-rose-600' },
  { id: 'avisos', label: 'Avisos', icon: 'ri-notification-3-line', cor: 'bg-sky-50 text-sky-600' },
];
const rotuloAssunto = (id: string) => ASSUNTOS.find((a) => a.id === id)?.label ?? 'Todas as mensagens';
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
function limparUser(content: string): { text: string; audio: boolean; arquivo: string | null; citado: string | null } {
  let t = content.replace(/^\[Pelo ERPOS[^\]]*\]\n?/, '');
  // Resposta a uma mensagem: o trecho citado viaja no próprio texto (assim o assistente entende
  // igual pelo Telegram) e aqui volta a ser um bloquinho acima do balão.
  let citado: string | null = null;
  const cm = t.match(/^\[Respondendo a: "([^"]*)"\]\n?/);
  if (cm) { citado = cm[1]; t = t.slice(cm[0].length); }
  let arquivo: string | null = null;
  const fm = t.match(/^\[(Foto|PDF)\]\s*/);
  if (fm) { arquivo = fm[1]; t = t.slice(fm[0].length); }
  t = t.replace(/^\[(Foto|PDF) sem legenda\]$/, '');
  const audio = /^\[Áudio\]\s*/.test(t);
  if (audio) t = t.replace(/^\[Áudio\]\s*/, '');
  return { text: t.replace(/^\[Pelo ERPOS[^\]]*\]\n?/, '').trim(), audio, arquivo, citado };
}

// "[Sistema] Mensagem no grupo … <mensagem_do_grupo grupo=… autor=…>texto</mensagem_do_grupo> …"
// → "Thati no grupo Financeiro loja - EP MALL: Referente ao dia 15/09". Null = não é gatilho do sistema.
function resumoSistema(content: string): string | null {
  const t = content.replace(/^\[Pelo ERPOS[^\]]*\]\n?/, '');
  if (!t.startsWith('[Sistema]')) return null;
  const tag = t.match(/<mensagem_do_grupo([^>]*)>([\s\S]*?)<\/mensagem_do_grupo>/);
  if (tag) {
    const attr = (k: string) => tag[1].match(new RegExp(`${k}="([^"]*)"`))?.[1]?.trim() || null;
    const autor = attr('autor');
    const grupo = attr('grupo');
    const texto = tag[2].replace(/\s+/g, ' ').trim().slice(0, 140);
    return `${autor ?? 'Alguém'}${grupo ? ` no grupo ${grupo}` : ''}${texto ? `: ${texto}` : ''}`;
  }
  return t.split('\n')[0].replace(/^\[Sistema\]\s*/, '').slice(0, 160);
}

// Marcadores que o brain grava no histórico para saber o que já mandou ("[Botão enviado: …]").
// São anotação do sistema: o balão mostra a coisa em si (o botão, o cartão), não a anotação.
// O modelo às vezes IMITA o marcador na própria resposta (visto em 2026-09-16), então a limpeza
// vale para o histórico e para a prévia da barra pequena.
const MARCADORES = /\n?\[(Enquete enviada|Localização enviada|Contato enviado|Pedido de pagamento enviado|Botão enviado|Botão:)[^\n]*\]/g;
const semMarcadores = (t: string) => t.replace(MARCADORES, '').trim();
// Linha de sistema "[Pagamento pix de R$ 100,00 para Fulano: ✅ pago] id <uuid>" → só a frase.
// O id é para o modelo achar o pagamento; na tela (balão e prévia da lista) não diz nada — e no
// celular a prévia chegou a mostrar SÓ o id (2026-09-18).
const linhaSistema = (t: string): string | null => {
  const m = t.match(/^\[((?:Pagamento|PIN|Leitura)[^\]]*)\]/);
  return m ? m[1].trim() : null;
};
// O marcador de botão também É o botão (2026-09-16). Antes o botão só existia na resposta da hora
// (vinha nas `actions` do send) e sumia ao recarregar; avisos que chegam sozinhos (contratação, cron)
// nem passam pelo send — só pelo histórico. Lendo o marcador, o botão aparece em qualquer mensagem.
// Só rota interna: começa com "/", sem "//" nem espaço (é navigate(), não link de fora).
const MARCADOR_BOTAO = /\[Botão(?: enviado)?: "([^"\n]{1,80})" → (\/[^\s\]]*)\]/g;
function botoesDoTexto(t: string): Abrir[] {
  const out: Abrir[] = [];
  for (const m of t.matchAll(MARCADOR_BOTAO)) {
    if (m[2].startsWith('//')) continue;
    out.push({ type: 'abrir', label: m[1], rota: m[2].slice(0, 300) });
  }
  return out;
}

// Posição do botão redondo (2026-09-16): arrasta para onde quiser e ele fica lá — antes era fixo no
// canto e "voltava para baixo" toda vez. Guardada como FRAÇÃO da tela (centro do botão), para
// sobreviver a girar o celular e a janela de tamanhos diferentes. É conveniência deste aparelho:
// fica no localStorage, e sem storage o botão só volta ao canto.
const FAB_KEY = 'erpos-assistente-fab';
const FAB_R = 28; // metade dos 56 px do botão
const FAB_MARGEM = 8;
type PosFab = { fx: number; fy: number };
function lerPosFab(): PosFab | null {
  try {
    const v = JSON.parse(localStorage.getItem(FAB_KEY) ?? 'null') as PosFab | null;
    return v && Number.isFinite(v.fx) && Number.isFinite(v.fy) ? v : null;
  } catch { return null; }
}
// Centro em px, sempre inteiro dentro da tela (a tela pode ter encolhido desde que foi salvo).
function centroFab(x: number, y: number) {
  const w = window.innerWidth, h = window.innerHeight, min = FAB_R + FAB_MARGEM;
  return { x: Math.min(Math.max(x, min), w - min), y: Math.min(Math.max(y, min), h - min) };
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

export default function AssistenteChat({ variant }: { variant: 'floating' | 'embedded' }) {
  const { user, selectTenant } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  // Três estágios no modo flutuante (pedido do dono, 2026-09-16): botão redondo → barra pequena
  // (digitar rápido, sem cobrir a tela) → conversa inteira. Arrastar a barra para cima abre a
  // conversa. `open` = carrega histórico e fica sincronizando (vale para barra e conversa).
  type Modo = 'fab' | 'mini' | 'full';
  const [modo, setModo] = useState<Modo>(variant === 'embedded' ? 'full' : 'fab');
  const open = modo !== 'fab';
  const setOpen = (v: boolean) => setModo(v ? 'full' : 'fab');
  // null = este toque não conta como "puxar para abrir" (começou numa lista que rola, campo, botão).
  const arrasteY = useRef<number | null>(null);
  // Arrastar o botão redondo: só vira arrasto depois de 8 px, senão um toque tremido não abriria.
  const [posFab, setPosFab] = useState<PosFab | null>(() => lerPosFab());
  const [arrastandoFab, setArrastandoFab] = useState<{ x: number; y: number } | null>(null);
  const arrastoFab = useRef<{ x0: number; y0: number; moveu: boolean } | null>(null);
  const ignorarCliqueFab = useRef(false);
  const [, setTamanhoTela] = useState(0);
  useEffect(() => {
    // Girou o celular / redimensionou: recalcula para o botão não sair da tela.
    const r = () => setTamanhoTela((n) => n + 1);
    window.addEventListener('resize', r);
    return () => window.removeEventListener('resize', r);
  }, []);
  // Abertura da conversa: sobe deslizando (translate-y) em vez de aparecer de uma vez, e já entra
  // no fim do histórico — pedido do dono (2026-09-16).
  const [subindo, setSubindo] = useState(false);
  // Barra pequena: depois de enviar, mostra a pergunta e a resposta ali mesmo (dono, 2026-09-16).
  // Some ao fechar (volta ao botão); na conversa inteira não é usada.
  const [troca, setTroca] = useState<{ pergunta: string; resposta?: string } | null>(null);
  useEffect(() => { if (modo === 'fab') setTroca(null); }, [modo]);
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
  const [links, setLinks] = useState<Record<number, Abrir[]>>({});
  const [pays, setPays] = useState<Payment[]>([]);
  // Badge do botão fechado: mensagens que ele mandou sozinho (cron, conciliação, avisos) e que
  // você ainda não viu. Fechado o chat não carrega histórico nenhum — só este contador.
  const [naoLidas, setNaoLidas] = useState<{ count: number; topic: string | null; previa: string | null }>({ count: 0, topic: null, previa: null });
  // Responder/copiar uma mensagem (2026-09-16): toque longo no celular, botão direito no desktop.
  const [menuMsg, setMenuMsg] = useState<{ msg: Msg; texto: string } | null>(null);
  const [citacao, setCitacao] = useState<{ texto: string } | null>(null);
  const [copiado, setCopiado] = useState(false);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pinFor, setPinFor] = useState<Payment | null>(null);
  const [pin, setPin] = useState('');
  const [pinErr, setPinErr] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  // Aba de assunto ('' = tudo). A conversa é uma só; a aba só filtra (asst_messages.topic).
  const [aba, setAba] = useState('');
  const abaRef = useRef('');
  // Ações rápidas (2026-09-16): roteiros fixos que rodam no sistema, sem o modelo (custo zero).
  const [menuAcoes, setMenuAcoes] = useState(false);
  const [acao, setAcao] = useState<string | null>(null);
  const abrirAcao = (id: string) => { setMenuAcoes(false); setAcao(id); setVista('conversa'); setModo('full'); };
  // Lista de conversas (2026-09-16): o painel abre na LISTA de assuntos, com cara de WhatsApp —
  // última mensagem, hora e não lidas por assunto. Toca num, entra na conversa; a seta volta.
  const [vista, setVista] = useState<'lista' | 'conversa'>('lista');
  const [conversas, setConversas] = useState<TopicoResumo[]>([]);
  const [grupos, setGrupos] = useState<GrupoResumo[]>([]);
  // Caixa de pendências no chat (2026-09-18): saiu do sino. Abre pelo botão ao lado das ações
  // rápidas, no painel inteiro (dono: a faixa fixa no topo tomava a conversa). `pendVersao`
  // recarrega a caixa depois de um pagamento (o trigger fecha a pendência quando o Inter confirma).
  const [pendAberta, setPendAberta] = useState(false);
  const [pendVersao, setPendVersao] = useState(0);
  const [pendNovas, setPendNovas] = useState(0);

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
      setVista('conversa'); // compartilhou algo: é para mandar, não para escolher assunto
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
  const camRef = useRef<HTMLInputElement>(null);
  const lastId = useRef(0);
  const stick = useRef(true);

  const toBottom = () => requestAnimationFrame(() => { const el = scrollRef.current; if (el) el.scrollTop = el.scrollHeight; });
  // Abrir uma conversa SEMPRE mostra a última mensagem (pedido do dono, 2026-09-17). O toBottom() logo
  // depois de carregar rodava antes de a tela desenhar as mensagens (rolava o fim de uma lista vazia),
  // e botões/cartões que crescem depois empurravam o fim para baixo. Agora: 1) ao entrar, marca que
  // falta ir ao fim; 2) depois que as mensagens estão NA TELA (layout effect), rola; 3) enquanto você
  // não rolar para cima, o que crescer depois continua grudado no fim (ResizeObserver).
  const fimPendente = useRef(true);
  const conteudoRef = useRef<HTMLDivElement>(null);

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

  const carregarConversas = useCallback(async () => {
    try {
      const r = await call<{ topics: TopicoResumo[]; groups?: GrupoResumo[] }>('topics');
      setConversas(r.topics);
      setGrupos(r.groups ?? []);
    } catch { /* lista é extra: a conversa continua */ }
  }, []);

  // Entra num assunto (ou em "Todas as mensagens", com id vazio).
  const abrirConversa = useCallback((topic: string) => {
    fimPendente.current = true; stick.current = true;
    setAba(topic);
    setVista('conversa');
  }, []);

  // Depois que a conversa está desenhada: vai ao fim ao entrar, ao trocar de conversa ou de tamanho
  // (barra pequena ↔ tela toda). Layout effect roda antes da pintura, então não pisca no topo.
  const chaveTela = useRef('');
  useLayoutEffect(() => {
    if (vista !== 'conversa' || !loaded) return;
    const el = scrollRef.current;
    if (!el) return;
    const chave = `${modo}|${aba}`;
    if (fimPendente.current || chaveTela.current !== chave) {
      el.scrollTop = el.scrollHeight;
      stick.current = true;
      fimPendente.current = false;
    }
    chaveTela.current = chave;
  }, [vista, loaded, msgs, modo, aba]);

  // O que cresce depois (botões, cartões, texto longo) continua no fim — enquanto você não rolou para cima.
  useEffect(() => {
    const alvo = conteudoRef.current;
    const el = scrollRef.current;
    if (!alvo || !el || typeof ResizeObserver === 'undefined') return;
    const aoFim = () => { if (stick.current) el.scrollTop = el.scrollHeight; };
    const ro = new ResizeObserver(aoFim);
    ro.observe(alvo);
    // A JANELA das mensagens também encolhe depois de abrir: os cartões de pagamento em aberto chegam
    // e ocupam o espaço de baixo, e no celular o teclado encolhe a tela. O navegador mantém a rolagem
    // e as últimas mensagens somem por baixo (o "não deu certo" de 2026-09-18). Observar só o conteúdo
    // não pegava isso: observa a área rolável e a tela visível também.
    ro.observe(el);
    const vv = window.visualViewport;
    vv?.addEventListener('resize', aoFim);
    return () => { ro.disconnect(); vv?.removeEventListener('resize', aoFim); };
  }, [vista, loaded, modo]);

  const sincronizar = useCallback(async () => {
    if (!lastId.current) return;
    try { merge((await call<{ messages: Msg[] }>('history', { after_id: lastId.current, ...filtroConversa(abaRef.current) })).messages); } catch { /* tenta no próximo ciclo */ }
  }, [merge]);

  // Trocou de aba: recomeça a lista com o filtro novo.
  useEffect(() => {
    if (abaRef.current === aba) return;
    abaRef.current = aba;
    lastId.current = 0;
    setMsgs([]); setPolls({}); setLinks({}); setLoaded(false);
  }, [aba]);

  const isOwner = user?.email?.toLowerCase() === ASSISTENTE_OWNER_EMAIL;

  // ── Badge do botão fechado (2026-09-16) ──
  // O assistente fala sozinho: cron das 7h, conciliação, conta vencendo, currículo novo. Com o
  // chat fechado nada disso chegava até você abrir. 'unread' é uma consulta leve (só conta), roda
  // de 45 em 45 s e não carrega mensagem nenhuma. Ver 'seen' no assistente-app.
  const verificarNaoLidas = useCallback(async () => {
    try {
      const u = await call<{ count: number; topic: string | null; previa: string | null }>('unread');
      setNaoLidas({ count: u.count ?? 0, topic: u.topic ?? null, previa: u.previa ?? null });
    } catch { /* contador é extra: nunca atrapalha o chat */ }
  }, []);

  // Número no botão de pendências (e bolinha do botão fechado): só as que ninguém tocou ainda.
  // Roda aberto ou fechado — na barra pequena o botão também aparece.
  const contarPendencias = useCallback(async () => {
    try {
      const { count } = await supabase.from('pendencias').select('id', { count: 'exact', head: true }).eq('status', 'aberta');
      setPendNovas(count ?? 0);
    } catch { /* contador é extra */ }
  }, []);

  useEffect(() => {
    if (!isOwner || open) return;
    verificarNaoLidas();
    const t = setInterval(() => { if (!document.hidden) verificarNaoLidas(); }, 45000);
    return () => clearInterval(t);
  }, [isOwner, open, verificarNaoLidas]);

  // Leu uma conversa: só ELA deixa de ser novidade (igual ao WhatsApp). Ficar na lista não marca
  // nada — o servidor guarda o "visto" por assunto (assistente-app › seen).
  useEffect(() => {
    if (!open || !isOwner || vista !== 'conversa' || !lastId.current) return;
    const topic = abaRef.current;
    setNaoLidas((n) => (topic && n.topic && n.topic !== topic ? n : { count: 0, topic: null, previa: null }));
    const grupoAberto = topic.startsWith(PREFIXO_GRUPO) ? topic.slice(PREFIXO_GRUPO.length) : null;
    if (grupoAberto) setGrupos((prev) => prev.map((g) => (g.group_jid === grupoAberto ? { ...g, unread: 0 } : g)));
    else {
      setConversas((prev) => prev.map((c) => (!topic || c.topic === topic ? { ...c, unread: 0 } : c)));
      if (!topic) setGrupos((prev) => prev.map((g) => ({ ...g, unread: 0 })));
    }
    call('seen', { id: lastId.current, ...filtroConversa(topic) }).catch(() => { /* marca de novo no próximo ciclo */ });
  }, [open, isOwner, vista, msgs.length]);

  // Pagamentos esperando decisão aparecem na lista, na conversa e na barra pequena: a carga é
  // do painel aberto, não da conversa.
  useEffect(() => {
    if (!open || !isOwner) return;
    carregarPagamentos();
  }, [open, isOwner, carregarPagamentos]);

  // Lista aberta: carrega os assuntos e vai atualizando (o assistente fala sozinho).
  useEffect(() => {
    if (!open || !isOwner || vista !== 'lista') return;
    carregarConversas();
    const t = setInterval(() => { if (!document.hidden) carregarConversas(); }, 15000);
    return () => clearInterval(t);
  }, [open, isOwner, vista, carregarConversas]);

  // Botão "voltar" do Android (2026-09-16): com o chat aberto ele SAÍA DO APP, porque o painel é
  // um overlay e não mexia no histórico. Duas camadas, desfeitas na ordem: primeiro a conversa
  // volta para a lista, depois o painel fecha. No chat embutido (página Assistente) não vale — lá
  // o voltar tem de sair da página, como em qualquer tela.
  useVoltarFecha(variant === 'floating' && open, () => setModo('fab'), 'assistente-painel');
  useVoltarFecha(open && vista === 'conversa', () => setVista('lista'), 'assistente-conversa');
  // Ações rápidas em tela cheia são mais uma camada: o voltar fecha só elas.
  useVoltarFecha(open && menuAcoes && (modo === 'full' || variant === 'embedded'), () => setMenuAcoes(false), 'assistente-acoes');
  useVoltarFecha(open && pendAberta, () => setPendAberta(false), 'assistente-pendencias');
  useEffect(() => {
    if (!isOwner) return;
    contarPendencias();
    const t = setInterval(() => { if (!document.hidden) contarPendencias(); }, 45000);
    return () => clearInterval(t);
  }, [isOwner, contarPendencias, pendVersao]);

  // Telas pedindo o chat: botão "perguntar ao assistente" (PerguntarAoAssistente) e atalhos.
  useEffect(() => {
    if (!isOwner) return;
    const abrir = (e: Event) => {
      const p = (e as CustomEvent<PedidoAbrir>).detail;
      setFocoItem(p?.item ?? null);
      // Veio de uma tela: é para falar, não para escolher assunto — cai direto na conversa.
      setVista('conversa');
      if (variant === 'floating') setModo(p?.conversa ? 'full' : 'mini');
      if (p?.texto) setText(p.texto);
    };
    window.addEventListener(EVENTO_ASSISTENTE, abrir);
    return () => window.removeEventListener(EVENTO_ASSISTENTE, abrir);
  }, [isOwner, variant]);

  // Primeira carga ao abrir (e a cada troca de aba)
  useEffect(() => {
    // Sem ser o dono não chama nada (o componente já não aparece; o servidor também recusa).
    if (!open || loaded || !isOwner || vista !== 'conversa') return;
    (async () => {
      try {
        const h = await call<{ messages: Msg[]; has_more: boolean }>('history', { ...filtroConversa(abaRef.current) });
        setMsgs(h.messages); setHasMore(h.has_more);
        lastId.current = h.messages.length ? h.messages[h.messages.length - 1].id : 0;
        fimPendente.current = true; stick.current = true;
        setLoaded(true); setErro(null);
      } catch (e) { setErro(e instanceof Error ? e.message : String(e)); }
    })();
  }, [open, loaded, isOwner, vista, carregarPagamentos]); // isOwner: o login pode chegar depois do 1º render

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
      const h = await call<{ messages: Msg[]; has_more: boolean }>('history', { before_id: primeiro.id, ...filtroConversa(abaRef.current) });
      setMsgs((prev) => [...h.messages, ...prev]); setHasMore(h.has_more);
      requestAnimationFrame(() => { if (el) el.scrollTop = el.scrollHeight - h0; });
    } catch { /* ignora */ }
  };

  // Toque longo (celular) e botão direito (desktop) abrem as ações da mensagem.
  const abrirMenu = (m: Msg, texto: string) => { if (texto.trim()) setMenuMsg({ msg: m, texto: texto.trim() }); };
  const pressStart = (m: Msg, texto: string) => {
    pressTimer.current = setTimeout(() => abrirMenu(m, texto), 450);
  };
  const pressEnd = () => { if (pressTimer.current) { clearTimeout(pressTimer.current); pressTimer.current = null; } };

  const copiarMsg = async (texto: string) => {
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 1500);
    } catch { setErro('Não consegui copiar (o navegador bloqueou).'); }
    setMenuMsg(null);
  };

  const enviar = async (override?: string, audio?: { base64: string; media_type: string }) => {
    const t = (override ?? text).trim();
    if ((!t && !attach && !audio) || sending) return;
    const foco = getFoco();
    // Responder a uma mensagem: o trecho vai no texto, então o assistente entende igual no
    // Telegram e a citação continua no histórico (sem coluna nova no banco).
    const cit = citacao;
    const prefixoCit = cit ? `[Respondendo a: "${cit.texto.slice(0, 120).replace(/"/g, "'")}"]
` : '';
    const temp: Msg = {
      id: -Date.now(), role: 'user', channel: 'app', created_at: new Date().toISOString(), temp: true,
      content: audio ? '[Áudio] (transcrevendo…)' : `${prefixoCit}${attach ? `[${attach.media_type === 'application/pdf' ? 'PDF' : 'Foto'}] ` : ''}${t}`,
    };
    setMsgs((p) => [...p, temp]); stick.current = true; toBottom();
    const anexo = attach; setText(''); setAttach(null); setCitacao(null); setSending(true); setErro(null);
    setTroca({ pergunta: t || (audio ? 'Áudio' : anexo?.media_type === 'application/pdf' ? 'PDF' : 'Foto') });
    try {
      const out = await call<{ reply: string; actions: Array<{ type: string } & Record<string, unknown>>; transcricao?: string | null }>('send', {
        text: `${prefixoCit}${t}`,
        topic: abaRef.current && !abaRef.current.startsWith(PREFIXO_GRUPO) ? abaRef.current : undefined,
        ...(anexo ? { attachment: { base64: anexo.base64, media_type: anexo.media_type } } : {}),
        ...(audio ? { audio } : {}),
        // A tela vai junto em três níveis: a rota, o que a tela mostra (filtros, totais) e o
        // registro que você apontou pelo botão "perguntar ao assistente" (ver assistenteFoco).
        contexto: {
          rota: location.pathname + location.search, titulo: document.title, loja: user?.loja ?? null,
          tela: resumirFoco(foco.tela), item: resumirFoco(foco.item),
        },
      });
      limparFocoItem(); // o item apontado vale para UMA mensagem
      // Mostra a resposta na hora: esperar a ida extra ao servidor (history) para acertar os ids
      // atrasava a resposta em ~1 s no celular. O merge() descarta os provisórios logo depois.
      setMsgs((p) => [...p, { id: -Date.now(), role: 'assistant', channel: 'app', created_at: new Date().toISOString(), content: out.reply, temp: true }]);
      // Barra pequena: a troca (pergunta + resposta). No áudio, a pergunta vira a transcrição.
      setTroca({ pergunta: out.transcricao || t || (audio ? 'Áudio' : anexo?.media_type === 'application/pdf' ? 'PDF' : 'Foto'), resposta: semMarcadores(out.reply) });
      stick.current = true; toBottom();
      const antes = lastId.current;
      const h = await call<{ messages: Msg[] }>('history', { after_id: antes });
      merge(h.messages);
      const ultimaResp = [...h.messages].reverse().find((m) => m.role === 'assistant');
      const enquetes = out.actions.filter((a) => a.type === 'poll') as unknown as Poll[];
      if (ultimaResp && enquetes.length) setPolls((p) => ({ ...p, [ultimaResp.id]: enquetes }));
      const aberturas = out.actions.filter((a) => a.type === 'abrir') as unknown as Abrir[];
      if (ultimaResp && aberturas.length) setLinks((p) => ({ ...p, [ultimaResp.id]: aberturas }));
      if (out.actions.some((a) => a.type === 'payment')) carregarPagamentos();
    } catch (e) {
      setMsgs((p) => p.filter((m) => m.id !== temp.id));
      if (!override && !audio) { setText(t); setAttach(anexo); setCitacao(cit); }
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
      setPendVersao((v) => v + 1);
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
      if (op === 'no') { sincronizar(); setPendVersao((v) => v + 1); }
    } catch (e) { setErro(e instanceof Error ? e.message : String(e)); }
  };

  // Pagar pela pendência: o assistente-app prepara de novo o que venceu e devolve os cartões.
  // Um só em aberto → já pede o PIN; vários → ficam no rodapé, cada um com o seu Pagar.
  const pagarPendencia = async (pd: PendenciaChat) => {
    const out = await call<{ payments: Payment[]; erros: string[] }>('pendencia_pagar', { id: pd.id });
    setPays((prev) => [...out.payments, ...prev.filter((x) => !out.payments.some((n) => n.id === x.id))]);
    if (out.erros?.length) setErro(`Alguns não deu para preparar: ${out.erros.join(' · ')}`);
    const prontos = out.payments.filter((p) => ['draft', 'awaiting_pin'].includes(p.status));
    // Fecha a caixa: os cartões (e o PIN) aparecem no chat, embaixo.
    setPendAberta(false);
    if (prontos.length === 1) await acaoPagamento(prontos[0], 'ok');
  };

  // Abrir a tela que resolve. Pendência de outra loja: troca de loja antes (o chat vê todas).
  const abrirPendencia = async (pd: PendenciaChat) => {
    if (!pd.rota) return;
    setPendAberta(false);
    if (pd.tenantId !== user?.tenantId) await selectTenant(pd.tenantId);
    navigate(pd.rota);
    if (variant === 'floating') setModo('mini');
  };

  // Sem pagamento preparado: o texto vai para a caixa de digitação e você completa.
  const pedirPendencia = (texto: string) => {
    setPendAberta(false);
    abrirConversa('pagamentos');
    setText(texto);
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
  // Ações rápidas: o menu e o botão ⚡ ficam fora da caixa de digitação para aparecer também na LISTA
  // de conversas (tela toda), onde a caixa não é mostrada (pedido do dono, 2026-09-16). O painel é
  // data-sem-arrasto: rolar a lista dele não conta como "puxar para abrir a conversa".
  // Lista de ações: compacta no cartão da barra pequena, grande quando o chat está na tela toda.
  const listaAcoes = (grande: boolean) => GRUPOS.map((g) => {
    const doGrupo = ACOES.filter((a) => a.grupo === g);
    if (!doGrupo.length) return null;
    return (
      <div key={g} className={grande ? 'pt-3' : 'pt-1'}>
        <p className={grande ? 'px-1 pb-1.5 text-xs font-bold uppercase tracking-wide text-zinc-400' : 'px-2 pb-0.5 text-[11px] font-semibold text-zinc-500'}>{g}</p>
        <div className={grande ? 'grid grid-cols-2 sm:grid-cols-3 gap-2' : 'grid grid-cols-1 sm:grid-cols-2 gap-0.5'}>
          {doGrupo.map((a) => (
            <button key={a.id} onClick={() => abrirAcao(a.id)}
              className={grande
                ? 'flex flex-col items-start gap-2 p-3 rounded-2xl border border-zinc-200 bg-white text-sm font-semibold text-zinc-800 hover:bg-zinc-50 cursor-pointer text-left'
                : 'w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-[13px] font-semibold text-zinc-700 hover:bg-zinc-50 cursor-pointer text-left'}>
              <span className={`${grande ? 'w-10 h-10 text-lg' : 'w-7 h-7'} flex-shrink-0 flex items-center justify-center rounded-xl ${a.cor}`}><i className={a.icone} /></span>
              <span className={grande ? 'leading-tight' : 'truncate'}>{a.label}</span>
            </button>
          ))}
        </div>
      </div>
    );
  });
  const menuAcoesPainel = (
        <div data-sem-arrasto className="mb-2 rounded-xl border border-zinc-200 bg-white p-1.5 shadow-sm max-h-[50vh] overflow-y-auto">
          <p className="px-2 pt-1 pb-1 text-[11px] font-bold text-zinc-400 uppercase">Ações rápidas · sem custo de IA</p>
          {listaAcoes(false)}
        </div>
  );
  // Tela toda (pedido do dono, 2026-09-17): as ações ocupam o painel inteiro, não um cartão sobre a caixa.
  const acoesTelaCheia = modo === 'full' || variant === 'embedded';
  const menuAcoesTelaCheia = (
    <div data-sem-arrasto className="absolute inset-0 z-10 flex flex-col bg-zinc-50">
      <div className="flex items-center gap-2.5 px-4 h-14 border-b border-zinc-100 bg-white flex-shrink-0">
        <div className="w-8 h-8 flex items-center justify-center rounded-xl bg-violet-50 border border-violet-200">
          <i className="ri-flashlight-line text-violet-600" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-black text-zinc-900 leading-tight">Ações rápidas</p>
          <p className="text-[11px] text-zinc-400 leading-tight">Sem custo de IA</p>
        </div>
        <button onClick={() => setMenuAcoes(false)} className="w-9 h-9 flex items-center justify-center rounded-xl text-zinc-400 hover:bg-zinc-100 cursor-pointer" aria-label="Fechar ações rápidas">
          <i className="ri-close-line text-xl" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-3 pb-4">{listaAcoes(true)}</div>
    </div>
  );
  const botaoAcoes = (
    <>
        <button onClick={() => setMenuAcoes((v) => !v)} disabled={sending || !!recording} className={`w-10 h-10 flex-shrink-0 flex items-center justify-center rounded-xl disabled:opacity-40 cursor-pointer ${menuAcoes ? 'bg-violet-100 text-violet-700' : 'text-violet-600 hover:bg-violet-50'}`} aria-label="Ações rápidas">
          <i className="ri-flashlight-line text-xl" />
        </button>
        {/* Pendências (2026-09-18): o que ficou para trás, ao lado das ações rápidas. */}
        <button onClick={() => { setMenuAcoes(false); setPendAberta(true); if (modo === 'mini') setModo('full'); }} disabled={sending || !!recording}
          className={`relative w-10 h-10 flex-shrink-0 flex items-center justify-center rounded-xl disabled:opacity-40 cursor-pointer ${pendAberta ? 'bg-indigo-100 text-indigo-700' : 'text-indigo-600 hover:bg-indigo-50'}`}
          aria-label={pendNovas ? `Pendências: ${pendNovas} nova${pendNovas > 1 ? 's' : ''}` : 'Pendências'}>
          <i className="ri-inbox-archive-line text-xl" />
          {pendNovas > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 flex items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-black border-2 border-white">
              {pendNovas > 9 ? '9+' : pendNovas}
            </span>
          )}
        </button>
    </>
  );
  const entrada = (
    <div className="border-t border-zinc-100 p-2.5 bg-white flex-shrink-0">
      {erro && <p className="text-xs text-red-600 px-1 pb-1.5">{erro}</p>}
      {citacao && (
        <div className="flex items-start gap-2 mb-2 px-2 py-1.5 rounded-xl bg-violet-50 border-l-2 border-violet-400">
          <i className="ri-reply-line text-violet-500 text-sm mt-0.5" />
          <span className="flex-1 text-xs text-zinc-600 line-clamp-2">{citacao.texto}</span>
          <button onClick={() => setCitacao(null)} className="text-zinc-400 hover:text-red-500 cursor-pointer" aria-label="Cancelar resposta">
            <i className="ri-close-line" />
          </button>
        </div>
      )}
      {attach && (
        <div className="flex items-center gap-2 mb-2 px-2 py-1.5 rounded-xl bg-zinc-50 border border-zinc-200">
          {attach.preview ? <img src={attach.preview} alt="" className="w-10 h-10 rounded-lg object-cover" /> : <i className="ri-file-pdf-2-line text-2xl text-red-500" />}
          <span className="flex-1 text-xs text-zinc-600 truncate">{attach.name}</span>
          <button onClick={() => setAttach(null)} className="text-zinc-400 hover:text-red-500 cursor-pointer" aria-label="Tirar anexo"><i className="ri-close-line" /></button>
        </div>
      )}
      {menuAcoes && !acoesTelaCheia && menuAcoesPainel}
      <div className="flex items-end gap-1.5">
        <input ref={fileRef} type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => { escolherArquivo(e.target.files?.[0]); e.target.value = ''; }} />
        {/* Câmera direta (2026-09-16): `capture` abre a câmera traseira sem passar pela galeria —
            é o caminho da notinha de balcão no meio do serviço. No desktop o navegador ignora o
            capture e cai no seletor normal, então o botão não estorva. */}
        <input ref={camRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { escolherArquivo(e.target.files?.[0]); e.target.value = ''; }} />
        {botaoAcoes}
        <button onClick={() => camRef.current?.click()} disabled={sending || !!recording} className="w-10 h-10 flex-shrink-0 flex items-center justify-center rounded-xl text-zinc-500 hover:bg-zinc-100 disabled:opacity-40 cursor-pointer" aria-label="Tirar foto da nota">
          <i className="ri-camera-line text-xl" />
        </button>
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

  // Lista de conversas: uma linha por assunto, com a última mensagem e as não lidas. A conversa
  // continua sendo UMA só no banco — a linha é um filtro por `asst_messages.topic`.
  // Uma linha da lista, igual para assunto e grupo: ícone, nome, hora, prévia e o NÚMERO de não lidas
  // (a bolinha roxa, como no WhatsApp/Telegram).
  const linhaConversa = (o: { chave: string; icone: string; cor: string; titulo: string; unread: number; last: TopicoResumo['last']; abrir: () => void }) => {
    const previa = o.last
      ? (resumoSistema(o.last.content) ?? linhaSistema(o.last.content) ?? `${o.last.role === 'user' ? 'Você: ' : ''}${semMarcadores(o.last.content)}`)
      : 'Nada por aqui ainda';
    return (
      <button key={o.chave} onClick={o.abrir} className="w-full flex items-center gap-3 px-4 py-3 border-b border-zinc-100 hover:bg-zinc-50 cursor-pointer text-left">
        <span className={`w-11 h-11 flex-shrink-0 flex items-center justify-center rounded-full ${o.cor}`}>
          <i className={`${o.icone} text-xl`} />
        </span>
        <span className="flex-1 min-w-0">
          <span className="flex items-baseline gap-2">
            <span className="flex-1 text-sm font-bold text-zinc-900 truncate">{o.titulo}</span>
            {o.last && <span className={`text-[11px] flex-shrink-0 ${o.unread ? 'text-violet-600 font-bold' : 'text-zinc-400'}`}>{hora(o.last.created_at)}</span>}
          </span>
          <span className="flex items-center gap-2">
            <span className={`flex-1 text-xs truncate ${o.unread ? 'text-zinc-700 font-semibold' : 'text-zinc-400'}`}>{previa}</span>
            {o.unread > 0 && (
              <span className="flex-shrink-0 min-w-[20px] h-5 px-1.5 flex items-center justify-center rounded-full bg-violet-600 text-white text-[11px] font-black" aria-label={`${o.unread} não lida(s)`}>
                {o.unread > 99 ? '99+' : o.unread}
              </span>
            )}
          </span>
        </span>
      </button>
    );
  };

  const listaConversas = (
    <div className="flex-1 overflow-y-auto bg-white">
      <button
        onClick={() => abrirConversa('')}
        className="w-full flex items-center gap-3 px-4 py-3 border-b border-zinc-100 hover:bg-zinc-50 cursor-pointer text-left"
      >
        <span className="w-11 h-11 flex-shrink-0 flex items-center justify-center rounded-full bg-violet-50 text-violet-600 border border-violet-100">
          <i className="ri-chat-3-line text-xl" />
        </span>
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-black text-zinc-900">Todas as mensagens</span>
          <span className="block text-xs text-zinc-400 truncate">A conversa inteira, sem separar por assunto</span>
        </span>
      </button>
      {ASSUNTOS.map((a) => {
        const c = conversas.find((x) => x.topic === a.id);
        return linhaConversa({ chave: a.id, icone: a.icon, cor: a.cor, titulo: a.label, unread: c?.unread ?? 0, last: c?.last ?? null, abrir: () => abrirConversa(a.id) });
      })}
      {/* Grupos do WhatsApp (2026-09-17): cada grupo é uma conversa, com tudo que veio dele. */}
      {grupos.length > 0 && (
        <p className="px-4 pt-3 pb-1 text-[11px] font-bold uppercase tracking-wide text-zinc-400">Grupos do WhatsApp</p>
      )}
      {grupos.map((g) => linhaConversa({
        chave: `${PREFIXO_GRUPO}${g.group_jid}`, icone: 'ri-whatsapp-line', cor: 'bg-emerald-50 text-emerald-600', titulo: g.name,
        unread: g.unread, last: g.last, abrir: () => abrirConversa(`${PREFIXO_GRUPO}${g.group_jid}`),
      }))}
    </div>
  );

  const painel = (
    <div className={variant === 'floating'
      ? `fixed z-[60] inset-0 sm:inset-auto sm:bottom-5 sm:right-5 sm:w-[420px] sm:h-[min(720px,calc(100vh-40px))] flex flex-col bg-white sm:rounded-2xl sm:border sm:border-zinc-200 shadow-2xl overflow-hidden
         transition-transform duration-200 ease-out sm:translate-y-0 ${subindo ? 'translate-y-0' : 'translate-y-full'}`
      : 'flex flex-col h-[70vh] rounded-2xl border border-zinc-200 bg-white overflow-hidden'}>
      {/* Cabeçalho */}
      <div className="flex items-center gap-2.5 px-4 h-14 border-b border-zinc-100 flex-shrink-0">
        {vista === 'conversa' ? (
          <button onClick={() => setVista('lista')} className="w-8 h-8 flex items-center justify-center rounded-xl text-zinc-500 hover:bg-zinc-100 cursor-pointer" aria-label="Voltar para as conversas">
            <i className="ri-arrow-left-line text-xl" />
          </button>
        ) : (
          <div className="w-8 h-8 flex items-center justify-center rounded-xl bg-violet-50 border border-violet-200">
            <i className="ri-robot-2-line text-violet-600" />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-black text-zinc-900 leading-tight">{vista === 'conversa' ? (aba.startsWith(PREFIXO_GRUPO) ? (grupos.find((g) => `${PREFIXO_GRUPO}${g.group_jid}` === aba)?.name ?? 'Grupo do WhatsApp') : rotuloAssunto(aba)) : 'Assistente'}</p>
          {/* Subtítulo só enquanto responde: "Mesma conversa do Telegram" saiu a pedido do dono (2026-09-16). */}
          {sending && <p className="text-[11px] text-zinc-400 leading-tight truncate">pensando…</p>}
        </div>
        <BotaoAvisos tenantId={user?.tenantId} />
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

      {/* Lista de conversas ou a conversa aberta */}
      {vista === 'lista' ? listaConversas : (
      <div
        ref={scrollRef}
        onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }}
        className="flex-1 overflow-y-auto px-3 py-3 bg-zinc-50/60"
      >
        <div ref={conteudoRef} className="space-y-2">
        {!loaded && !erro && <div className="mx-auto my-16 w-6 h-6 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />}
        {hasMore && (
          <button onClick={maisAntigas} className="block mx-auto text-xs text-violet-600 font-semibold py-1 cursor-pointer">Carregar mensagens anteriores</button>
        )}
        {loaded && msgs.length === 0 && <p className="text-sm text-zinc-400 text-center py-10">Pode falar: texto, áudio, foto ou PDF.</p>}
        {msgs.map((m) => {
          if (m.role === 'user') {
            // Gatilho do sistema (triagem de grupo, dias de freelancer, entrada de compra) é gravado
            // como mensagem "do dono" para o assistente ter contexto — mas não foi você que escreveu.
            // Vira uma linha curta com quem mandou, onde e o quê (visto no celular em 2026-09-16).
            const sis = resumoSistema(m.content);
            if (sis) {
              return (
                <p key={m.id} className="text-center text-[11px] text-zinc-500 px-6">
                  <i className="ri-inbox-archive-line" /> {sis} · {hora(m.created_at)}
                </p>
              );
            }
            const u = limparUser(m.content);
            return (
              <div key={m.id} className="flex justify-end">
                <div
                  onContextMenu={(e) => { e.preventDefault(); abrirMenu(m, u.text); }}
                  onTouchStart={() => pressStart(m, u.text)}
                  onTouchEnd={pressEnd}
                  onTouchMove={pressEnd}
                  className={`max-w-[85%] rounded-2xl rounded-br-md px-3.5 py-2 text-sm whitespace-pre-wrap break-words bg-violet-600 text-white select-none ${m.temp ? 'opacity-70' : ''}`}
                >
                  {u.citado && (
                    <span className="block mb-1 pl-2 border-l-2 border-violet-300 text-[11px] text-violet-100 line-clamp-2">{u.citado}</span>
                  )}
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
                {/* Sem texto sobrando (a resposta era só a ação), o balão não aparece: antes
                    ficava um balão vazio com a hora. O botão embaixo já diz tudo. */}
                {semMarcadores(m.content) && (
                  <div
                    onContextMenu={(e) => { e.preventDefault(); abrirMenu(m, semMarcadores(m.content)); }}
                    onTouchStart={() => pressStart(m, semMarcadores(m.content))}
                    onTouchEnd={pressEnd}
                    onTouchMove={pressEnd}
                    className="rounded-2xl rounded-bl-md px-3.5 py-2 text-sm whitespace-pre-wrap break-words bg-white border border-zinc-200 text-zinc-800 select-none"
                  >
                    {formatar(semMarcadores(m.content))}
                    <div className="text-[10px] mt-1 text-zinc-400">{hora(m.created_at)}{m.channel !== 'app' ? ` · ${CANAL[m.channel] ?? m.channel}` : ''}</div>
                  </div>
                )}
                {/* Botão que LEVA à tela: a resposta deixa de terminar em "vá em Financeiro › ..."
                    No flutuante recolhe para a barra, senão o painel cobriria a tela que abriu. */}
                {[...(links[m.id] ?? []), ...botoesDoTexto(m.content)]
                  .filter((lk, i, todos) => todos.findIndex((x) => x.rota === lk.rota) === i)
                  .map((lk, i) => (
                  <button
                    key={`lk${i}`}
                    onClick={() => { navigate(lk.rota); if (variant === 'floating') setModo('mini'); }}
                    className="mt-1.5 flex items-center gap-1.5 px-3 py-2 rounded-xl border border-violet-200 bg-white text-sm text-violet-700 font-semibold hover:bg-violet-50 cursor-pointer"
                  >
                    <i className="ri-arrow-right-up-line" /> {lk.label}
                  </button>
                ))}
                {/* Aviso de itens a classificar (assistente-cron › item_classify): classifica aqui mesmo. */}
                {m.content.includes('→ /financeiro?tab=itens]') && <ItensClassificarCard call={call} />}
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
      </div>
      )}

      {/* Pagamentos esperando decisão */}
      {pagamentosVisiveis.length > 0 && (
        <div className="max-h-[38%] overflow-y-auto border-t border-zinc-100 px-3 py-2 space-y-2 bg-white flex-shrink-0">
          {pagamentosVisiveis.map((p) => <PaymentCard key={p.id} p={p} onAction={acaoPagamento} />)}
        </div>
      )}

      {vista === 'conversa' && entrada}
      {/* Na lista não há caixa de digitação, mas as ações rápidas continuam à mão (pedido do dono). */}
      {vista === 'lista' && (
        <div className="border-t border-zinc-100 p-2.5 bg-white flex-shrink-0">
          {menuAcoes && !acoesTelaCheia && menuAcoesPainel}
          <div className="flex items-center gap-2">
            <button onClick={() => setMenuAcoes((v) => !v)} className={`flex-1 h-10 flex items-center justify-center gap-1.5 rounded-xl text-sm font-semibold cursor-pointer ${menuAcoes ? 'bg-violet-100 text-violet-700' : 'text-violet-700 hover:bg-violet-50'}`}>
              <i className="ri-flashlight-line text-lg" /> Ações rápidas
            </button>
            <button onClick={() => { setMenuAcoes(false); setPendAberta(true); }} className={`relative flex-1 h-10 flex items-center justify-center gap-1.5 rounded-xl text-sm font-semibold cursor-pointer ${pendAberta ? 'bg-indigo-100 text-indigo-700' : 'text-indigo-700 hover:bg-indigo-50'}`}>
              <i className="ri-inbox-archive-line text-lg" /> Pendências
              {pendNovas > 0 && (
                <span className="min-w-[18px] h-[18px] px-1 flex items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-black">
                  {pendNovas > 9 ? '9+' : pendNovas}
                </span>
              )}
            </button>
          </div>
        </div>
      )}

      {acao && (() => {
        const def = ACOES.find((a) => a.id === acao);
        if (!def) return null;
        const C = def.Componente;
        return (
          <Suspense fallback={<div className="absolute inset-0 z-20 flex items-center justify-center bg-zinc-50"><span className="w-6 h-6 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" /></div>}>
            <C
              onFechar={() => setAcao(null)}
              irPara={(rota) => { setAcao(null); navigate(rota); if (variant === 'floating') setModo('mini'); }}
            />
          </Suspense>
        );
      })()}

      {/* Ações da mensagem: responder e copiar (toque longo ou botão direito) */}
      {menuMsg && (
        <div className="absolute inset-0 z-10 flex items-end sm:items-center justify-center bg-black/30 p-3" onClick={() => setMenuMsg(null)}>
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-xs rounded-2xl bg-white p-2 shadow-xl">
            <p className="px-3 py-2 text-xs text-zinc-400 line-clamp-2">{menuMsg.texto}</p>
            <button
              onClick={() => { setCitacao({ texto: menuMsg.texto }); setMenuMsg(null); }}
              className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-semibold text-zinc-700 hover:bg-zinc-50 cursor-pointer"
            >
              <i className="ri-reply-line text-violet-600" /> Responder
            </button>
            <button
              onClick={() => copiarMsg(menuMsg.texto)}
              className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-semibold text-zinc-700 hover:bg-zinc-50 cursor-pointer"
            >
              <i className="ri-file-copy-line text-violet-600" /> Copiar
            </button>
          </div>
        </div>
      )}
      {copiado && (
        <div className="absolute bottom-24 left-1/2 -translate-x-1/2 z-20 px-3 py-1.5 rounded-full bg-zinc-900 text-white text-xs font-semibold">Copiado</div>
      )}

      {menuAcoes && acoesTelaCheia && menuAcoesTelaCheia}

      {pendAberta && (
        <PendenciasChat
          onFechar={() => setPendAberta(false)}
          versao={pendVersao}
          onMudou={contarPendencias}
          onPagar={pagarPendencia}
          onAbrir={abrirPendencia}
          onPedir={pedirPendencia}
        />
      )}

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
        // Puxar para cima abre a conversa — mas só quando o toque começa FORA de área rolável ou de
        // controle. Rolar o menu de ações rápidas abria o chat na tela toda (visto em 2026-09-16).
        onTouchStart={(e) => {
          const alvo = e.target as HTMLElement;
          arrasteY.current = alvo.closest('[data-sem-arrasto], input, textarea, select') ? null : e.touches[0].clientY;
        }}
        onTouchMove={(e) => { if (arrasteY.current != null && arrasteY.current - e.touches[0].clientY > 24) { arrasteY.current = null; setModo('full'); } }}
        onTouchEnd={() => { arrasteY.current = null; }}
      >
        <div className="flex items-center gap-2 px-2 pt-1.5">
          <button onClick={() => setModo('full')} className="flex-1 flex flex-col items-center cursor-pointer" aria-label="Abrir a conversa">
            <span className="w-10 h-1 rounded-full bg-zinc-300" />
          </button>
          <button onClick={() => setModo('fab')} className="w-7 h-7 flex items-center justify-center rounded-lg text-zinc-400 hover:bg-zinc-100 cursor-pointer" aria-label="Fechar chat">
            <i className="ri-close-line" />
          </button>
        </div>
        {(troca || sending) && (
          <button onClick={() => setModo('full')} className="block w-full text-left px-3.5 pt-1 pb-1 cursor-pointer" aria-label="Ver a conversa">
            {troca && <span className="block text-[12px] text-zinc-500 truncate">Você: {troca.pergunta}</span>}
            {sending
              ? <span className="block text-[11px] text-zinc-400">pensando…</span>
              : troca?.resposta && <span className="block text-sm text-zinc-800 line-clamp-3 whitespace-pre-wrap">{troca.resposta}</span>}
          </button>
        )}
        {pendNovas > 0 && (
          <button onClick={() => { setPendAberta(true); setModo('full'); }} className="block w-full text-left px-3.5 py-1.5 text-xs font-bold text-indigo-700 cursor-pointer" aria-label="Ver pendências">
            <i className="ri-inbox-archive-line" /> {pendNovas === 1 ? '1 pendência esperando você' : `${pendNovas} pendências esperando você`}
          </button>
        )}
        {pagamentosVisiveis.length > 0 && (
          <button onClick={() => setModo('full')} className="block w-full text-left px-3.5 py-1.5 text-xs font-bold text-violet-700 cursor-pointer" aria-label="Ver pagamentos">
            <i className="ri-money-dollar-circle-line" /> {pagamentosVisiveis.length === 1 ? '1 pagamento esperando você' : `${pagamentosVisiveis.length} pagamentos esperando você`}
          </button>
        )}
        {entrada}
      </div>
    );
  }

  // Botão fechado. Com mensagem nova ele abre a CONVERSA (você vai ler) e já na aba do assunto;
  // sem novidade abre a barra pequena (você vai escrever), que é o de sempre.
  const temNovidade = naoLidas.count > 0;
  // Onde desenhar: durante o arrasto segue o dedo; depois, a posição salva; sem nada, o canto.
  const centro = arrastandoFab
    ? centroFab(arrastandoFab.x, arrastandoFab.y)
    : posFab ? centroFab(posFab.fx * window.innerWidth, posFab.fy * window.innerHeight) : null;
  return (
    <button
      onPointerDown={(e) => {
        arrastoFab.current = { x0: e.clientX, y0: e.clientY, moveu: false };
        try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* sem captura: segue igual */ }
      }}
      onPointerMove={(e) => {
        const a = arrastoFab.current;
        // Coordenada inválida (alguns navegadores/eventos sintéticos) nunca vira arrasto.
        if (!a || !Number.isFinite(e.clientX) || !Number.isFinite(e.clientY)) return;
        if (!a.moveu && Math.hypot(e.clientX - a.x0, e.clientY - a.y0) < 8) return;
        a.moveu = true;
        setArrastandoFab({ x: e.clientX, y: e.clientY });
      }}
      onPointerUp={(e) => {
        const a = arrastoFab.current;
        arrastoFab.current = null;
        if (!a?.moveu) return;
        const c = centroFab(e.clientX, e.clientY);
        const nova = { fx: c.x / window.innerWidth, fy: c.y / window.innerHeight };
        setPosFab(nova);
        setArrastandoFab(null);
        try { localStorage.setItem(FAB_KEY, JSON.stringify(nova)); } catch { /* sem storage */ }
        // O navegador ainda dispara o click depois de soltar: esse não abre o chat.
        ignorarCliqueFab.current = true;
      }}
      onPointerCancel={() => { arrastoFab.current = null; setArrastandoFab(null); }}
      onClick={() => {
        if (ignorarCliqueFab.current) { ignorarCliqueFab.current = false; return; }
        if (temNovidade && naoLidas.topic) { setAba(naoLidas.topic); setVista('conversa'); }
        else if (temNovidade) setVista('lista'); // veio de assuntos diferentes: escolha na lista
        // Pendência esperando: abre na lista, com a caixa aberta no topo.
        const irPendencias = !temNovidade && pendNovas > 0;
        if (irPendencias) setPendAberta(true);
        setModo(temNovidade || irPendencias ? 'full' : 'mini');
      }}
      style={centro ? { left: centro.x - FAB_R, top: centro.y - FAB_R, touchAction: 'none' } : { touchAction: 'none' }}
      className={`fixed z-[55] ${centro ? '' : 'bottom-5 right-5'} w-14 h-14 rounded-full bg-violet-600 hover:bg-violet-500 text-white shadow-lg flex items-center justify-center ${arrastandoFab ? 'cursor-grabbing scale-110' : 'cursor-pointer'} select-none`}
      aria-label={temNovidade ? `Assistente: ${naoLidas.count} ${naoLidas.count === 1 ? 'mensagem nova' : 'mensagens novas'}` : 'Falar com o assistente'}
      title={naoLidas.previa ?? undefined}
    >
      <i className="ri-robot-2-line text-2xl" />
      {temNovidade && (
        <span className="absolute -top-1 -right-1 min-w-[22px] h-[22px] px-1 flex items-center justify-center rounded-full bg-red-500 text-white text-xs font-black border-2 border-white">
          {naoLidas.count > 9 ? '9+' : naoLidas.count}
        </span>
      )}
      {!temNovidade && (pendNovas > 0 || pagamentosVisiveis.some((p) => p.status === 'draft')) && <span className="absolute top-1 right-1 w-3 h-3 rounded-full bg-red-500 border-2 border-white" />}
    </button>
  );
}
