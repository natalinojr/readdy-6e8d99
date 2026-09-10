import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/lib/supabase';

// ── Painel de cobrança Pix (Mercado Pago) reutilizável ───────────────────────
// Usado onde o cliente paga no próprio celular sem passar pelo caixa: hoje no
// delivery (pedido recém-criado), amanhã em qualquer tela. Fala só com a Edge
// `online-payments`; quem é o cliente vem em `auth` — participante da mesa/senha
// ({participant_id, access_token}) ou pedido de delivery ({order_id, order_token}).
//
// Sequência: get_bill → já pago? mostra "Pago" · tem Pix pendente? retoma ·
// senão create_pix. Acompanha por Realtime + polling (reconcilia no provedor) +
// volta do app do banco (visibilitychange/focus — o Android congela timers).
// Nada aqui marca pago: só a Edge, quando o provedor aprova.

function formatMoney(v: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);
}

interface PixInfo {
  id: string;
  status: 'pending' | 'confirmed' | 'expired' | 'cancelled' | 'failed';
  amount: number;
  qr_code: string;
  qr_code_base64: string | null;
  expires_at: string;
}

interface BillResumo {
  enabled: boolean;
  orders: { id: string; remaining: number; total_amount: number }[];
  pending_pix: PixInfo | null;
  payments_history?: { amount: number }[];
}

interface Props {
  /** Identidade do cliente para a Edge: {participant_id, access_token} ou {order_id, order_token} */
  auth: Record<string, unknown>;
  /** Chamado uma vez quando o pagamento é confirmado (ou já estava pago ao abrir) */
  onPago?: () => void;
  /** Título curto do bloco (ex.: "Pague agora com Pix") */
  titulo?: string;
  /** Linha abaixo de "Pagamento confirmado" (ex.: "Seu pedido foi para a cozinha") */
  textoPago?: string;
}

function functionsUrl() {
  return (import.meta.env.VITE_PUBLIC_SUPABASE_URL as string || '').replace(/\/$/, '') + '/functions/v1/online-payments';
}

async function call<T>(body: Record<string, unknown>): Promise<T & { error?: string; message?: string }> {
  const res = await fetch(functionsUrl(), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return res.json();
}

type Fase = 'carregando' | 'pix' | 'pago' | 'indisponivel' | 'erro';

export default function PixCobrancaPanel(props: Props) {
  const { auth, onPago, titulo, textoPago } = props;
  const authKey = JSON.stringify(auth);

  const [fase, setFase] = useState<Fase>('carregando');
  const [pix, setPix] = useState<PixInfo | null>(null);
  const [valorPago, setValorPago] = useState(0);
  const [erro, setErro] = useState('');
  const [gerando, setGerando] = useState(false);
  const [verificando, setVerificando] = useState(false);
  const [copiado, setCopiado] = useState(false);
  const [segundos, setSegundos] = useState(0);

  const onPagoRef = useRef(onPago);
  onPagoRef.current = onPago;
  const avisouRef = useRef(false);

  function marcarPago(valor: number) {
    setValorPago(valor);
    setFase('pago');
    setPix(null);
    if (!avisouRef.current) { avisouRef.current = true; onPagoRef.current?.(); }
  }

  const gerarPix = useCallback(async function () {
    setGerando(true);
    setErro('');
    try {
      const data = await call<{ pix: PixInfo }>({ action: 'create_pix', ...auth });
      if (data.error === 'nothing_to_pay') { marcarPago(0); return; }
      if (data.error || !data.pix) { setErro(data.message || data.error || 'Não foi possível gerar o Pix'); setFase('erro'); return; }
      setPix(data.pix);
      setFase('pix');
    } catch {
      setErro('Erro de conexão. Tente novamente.');
      setFase('erro');
    } finally {
      setGerando(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authKey]);

  // Estado inicial: pago? pendente? senão gera.
  useEffect(function () {
    let cancelled = false;
    (async function () {
      try {
        const bill = await call<BillResumo>({ action: 'get_bill', ...auth });
        if (cancelled) return;
        if (bill.error) { setErro(bill.message || bill.error); setFase('erro'); return; }
        if (!bill.enabled) { setFase('indisponivel'); return; }
        const orders = bill.orders || [];
        const restante = orders.reduce(function (s, o) { return s + o.remaining; }, 0);
        if (orders.length > 0 && restante <= 0) {
          const pago = (bill.payments_history || []).reduce(function (s, p) { return s + p.amount; }, 0)
            || orders.reduce(function (s, o) { return s + o.total_amount; }, 0);
          marcarPago(pago);
          return;
        }
        if (bill.pending_pix) { setPix(bill.pending_pix); setFase('pix'); return; }
        await gerarPix();
      } catch {
        if (!cancelled) { setErro('Erro de conexão. Tente novamente.'); setFase('erro'); }
      }
    })();
    return function () { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authKey]);

  // Acompanhamento do Pix pendente
  useEffect(function () {
    if (!pix || pix.status !== 'pending') return;
    const pixId = pix.id;
    let cancelled = false;

    async function checar(reconcile: boolean) {
      if (cancelled) return;
      try {
        const data = await call<{ pix: PixInfo }>({ action: 'get_pix_status', pix_payment_id: pixId, reconcile, ...auth });
        if (cancelled || !data.pix) return;
        if (data.pix.status === 'confirmed') marcarPago(data.pix.amount);
        else if (data.pix.status !== 'pending') setPix(data.pix);
      } catch { /* próximo ciclo */ }
    }

    const channel = supabase.channel('pix-payment:' + pixId)
      .on('broadcast', { event: 'pix_change' }, function () { checar(false); })
      .subscribe();
    const poll = setInterval(function () { checar(true); }, 6000);
    function aoVoltar() { if (document.visibilityState === 'visible') checar(true); }
    document.addEventListener('visibilitychange', aoVoltar);
    window.addEventListener('focus', aoVoltar);

    return function () {
      cancelled = true;
      clearInterval(poll);
      document.removeEventListener('visibilitychange', aoVoltar);
      window.removeEventListener('focus', aoVoltar);
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pix?.id, pix?.status, authKey]);

  // Contador de expiração
  useEffect(function () {
    if (!pix || pix.status !== 'pending') return;
    const expiraEm = new Date(pix.expires_at).getTime();
    function tick() {
      const diff = Math.max(0, Math.floor((expiraEm - Date.now()) / 1000));
      setSegundos(diff);
      if (diff <= 0) setPix(function (p) { return p && p.status === 'pending' ? Object.assign({}, p, { status: 'expired' as const }) : p; });
    }
    tick();
    const t = setInterval(tick, 1000);
    return function () { clearInterval(t); };
  }, [pix]);

  async function verificarAgora() {
    if (!pix || verificando) return;
    setVerificando(true);
    setErro('');
    try {
      const data = await call<{ pix: PixInfo }>({ action: 'get_pix_status', pix_payment_id: pix.id, reconcile: true, ...auth });
      if (data.pix?.status === 'confirmed') marcarPago(data.pix.amount);
      else if (data.pix && data.pix.status !== 'pending') setPix(data.pix);
      else setErro('O banco ainda não avisou o pagamento. Se você acabou de pagar, aguarde alguns segundos.');
    } catch {
      setErro('Erro de conexão. Tente novamente.');
    } finally {
      setVerificando(false);
    }
  }

  async function copiarCodigo() {
    if (!pix?.qr_code) return;
    try {
      await navigator.clipboard.writeText(pix.qr_code);
      setCopiado(true);
      setTimeout(function () { setCopiado(false); }, 2500);
    } catch {
      const el = document.getElementById('pix-cobranca-copia-cola') as HTMLInputElement | null;
      if (el) { el.focus(); el.select(); }
    }
  }

  const mm = String(Math.floor(segundos / 60)).padStart(2, '0');
  const ss = String(segundos % 60).padStart(2, '0');

  // ── Render ────────────────────────────────────────────────────────────────
  if (fase === 'indisponivel') return null;

  if (fase === 'carregando') {
    return (
      <div className="flex items-center justify-center gap-2 py-6 text-xs text-zinc-400">
        <i className="ri-loader-4-line animate-spin text-amber-500" />
        Preparando o Pix…
      </div>
    );
  }

  if (fase === 'pago') {
    return (
      <div className="flex items-center gap-3 px-4 py-3 bg-emerald-50 border border-emerald-200 rounded-2xl">
        <div className="w-10 h-10 flex items-center justify-center bg-emerald-100 rounded-full shrink-0">
          <i className="ri-checkbox-circle-fill text-emerald-500 text-xl" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-black text-emerald-800">Pagamento confirmado</p>
          <p className="text-[11px] text-emerald-600">{valorPago > 0 ? formatMoney(valorPago) + ' via Pix · ' : ''}{textoPago || 'Obrigado!'}</p>
        </div>
      </div>
    );
  }

  if (fase === 'erro' || !pix) {
    return (
      <div className="px-4 py-3 bg-red-50 border border-red-100 rounded-2xl">
        <div className="flex items-start gap-2">
          <i className="ri-error-warning-line text-red-500 text-sm mt-0.5" />
          <p className="text-[11px] text-red-600 flex-1">{erro || 'Não foi possível preparar o Pix.'}</p>
        </div>
        <button type="button" onClick={gerarPix} disabled={gerando}
          className="mt-2 w-full py-2 bg-white border border-red-200 text-red-700 text-xs font-bold rounded-xl cursor-pointer disabled:opacity-50 whitespace-nowrap">
          {gerando ? 'Tentando…' : 'Tentar de novo'}
        </button>
      </div>
    );
  }

  if (pix.status !== 'pending') {
    const msg = pix.status === 'expired' ? 'Este Pix expirou.' : pix.status === 'cancelled' ? 'Este Pix foi cancelado.' : 'Não foi possível gerar o Pix.';
    return (
      <div className="px-4 py-4 bg-zinc-50 border border-zinc-200 rounded-2xl text-center">
        <p className="text-sm font-bold text-zinc-700">{msg}</p>
        <p className="text-xs text-zinc-400 mt-1">Se você já pagou, aguarde: a confirmação pode levar alguns segundos.</p>
        <button type="button" onClick={gerarPix} disabled={gerando}
          className="mt-3 px-5 py-2.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white text-xs font-bold rounded-xl cursor-pointer whitespace-nowrap">
          {gerando ? 'Gerando…' : 'Gerar um novo Pix'}
        </button>
      </div>
    );
  }

  return (
    <div className="px-4 py-4 bg-white border border-amber-200 rounded-2xl">
      <div className="flex flex-col items-center">
        <p className="text-[10px] uppercase tracking-wider font-bold text-amber-600">{titulo || 'Pague agora com Pix'}</p>
        <p className="text-3xl font-black text-zinc-900 mt-0.5">{formatMoney(pix.amount)}</p>
        <p className="text-[11px] text-zinc-400 mt-1">
          expira em <span className={'font-bold tabular-nums ' + (segundos < 60 ? 'text-red-500' : 'text-zinc-600')}>{mm}:{ss}</span>
        </p>

        {pix.qr_code_base64 ? (
          <div className="mt-3 p-2.5 bg-white border border-zinc-200 rounded-2xl">
            <img src={'data:image/png;base64,' + pix.qr_code_base64} alt="QR Code Pix" className="w-40 h-40" />
          </div>
        ) : null}

        <div className="w-full mt-3 space-y-2">
          <button type="button" onClick={copiarCodigo}
            className={'w-full flex items-center justify-center gap-2 py-3.5 rounded-xl text-sm font-bold cursor-pointer transition-colors whitespace-nowrap ' + (copiado ? 'bg-emerald-500 text-white' : 'bg-gradient-to-br from-amber-500 to-orange-500 text-white shadow-sm')}>
            <i className={copiado ? 'ri-check-line' : 'ri-file-copy-line'} />
            {copiado ? 'Código copiado!' : 'Copiar código Pix'}
          </button>
          <input id="pix-cobranca-copia-cola" readOnly value={pix.qr_code} className="w-full text-[10px] text-zinc-500 bg-zinc-50 border border-zinc-200 rounded-lg px-2 py-1.5 truncate" />
        </div>

        <ol className="w-full mt-3 space-y-1.5 text-[11px] text-zinc-600">
          <li className="flex gap-2"><span className="w-4 h-4 flex items-center justify-center bg-amber-100 text-amber-700 rounded-full text-[9px] font-bold shrink-0">1</span>Copie o código acima</li>
          <li className="flex gap-2"><span className="w-4 h-4 flex items-center justify-center bg-amber-100 text-amber-700 rounded-full text-[9px] font-bold shrink-0">2</span>Abra o app do seu banco em <strong>Pix › Pix Copia e Cola</strong></li>
          <li className="flex gap-2"><span className="w-4 h-4 flex items-center justify-center bg-amber-100 text-amber-700 rounded-full text-[9px] font-bold shrink-0">3</span>Cole, confirme e <strong>volte para esta tela</strong> — a confirmação aparece sozinha</li>
        </ol>

        <div className="flex items-center gap-2 mt-3 text-[11px] text-zinc-400">
          <i className="ri-loader-4-line animate-spin text-amber-500" />
          Aguardando o pagamento…
        </div>

        <button type="button" onClick={verificarAgora} disabled={verificando}
          className="mt-3 w-full flex items-center justify-center gap-2 py-2.5 bg-zinc-100 hover:bg-zinc-200 disabled:opacity-50 text-zinc-700 text-xs font-bold rounded-xl cursor-pointer whitespace-nowrap">
          <i className={verificando ? 'ri-loader-4-line animate-spin' : 'ri-refresh-line'} />
          {verificando ? 'Verificando…' : 'Já paguei — verificar agora'}
        </button>

        {erro ? <p className="mt-2 text-[11px] text-red-600 text-center">{erro}</p> : null}
      </div>
    </div>
  );
}
