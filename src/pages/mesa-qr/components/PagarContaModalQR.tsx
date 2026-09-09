import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { savePixMemo, loadPixMemo, clearPixMemo } from '../pixMemo';

// ── Pagar a conta no celular (Pix dinâmico via Mercado Pago) ─────────────────
// Fluxo: conta → escolhe "meus pedidos" ou "mesa inteira" → gera Pix → copia o
// código → o cliente SAI para o app do banco → volta. Nada aqui marca pago: só a
// Edge `online-payments` quando o provedor aprova.
//
// A volta do app do banco é o ponto delicado: o Android congela timers e derruba
// o WebSocket da aba em segundo plano, então além do Realtime + polling temos um
// gatilho em `visibilitychange`/`focus` e um botão manual de verificação.

function formatMoney(v: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);
}

interface PagamentoFeito {
  id: string;
  amount: number;
  at: string;
  method: string;
  orders: string[];
}

interface BillOrder {
  id: string;
  number: string | null;
  participant_id: string | null;
  participant_name: string | null;
  status: string;
  total_amount: number;
  paid_amount: number;
  remaining: number;
  is_paid: boolean;
  paid_at: string | null;
  locked: boolean;
  items: { name: string; quantity: number; price: number }[];
}

interface PixInfo {
  id: string;
  status: 'pending' | 'confirmed' | 'expired' | 'cancelled' | 'failed';
  amount: number;
  scope: 'mine' | 'all';
  qr_code: string;
  qr_code_base64: string | null;
  ticket_url: string | null;
  expires_at: string;
  allocation: { order_id: string; amount: number; number: string | null }[] | null;
  error: string | null;
}

interface Props {
  qrToken: string;
  tenantId: string;
  participantId: string;
  participantName: string;
  accessToken: string;
  onClose: () => void;
}

type Scope = 'mine' | 'all';

function functionsUrl() {
  return (import.meta.env.VITE_PUBLIC_SUPABASE_URL as string || '').replace(/\/$/, '') + '/functions/v1/online-payments';
}

async function callOnlinePayments<T>(body: Record<string, unknown>): Promise<T & { error?: string; message?: string }> {
  const res = await fetch(functionsUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

function shortNumber(n: string | null, id: string) {
  return n ? n.slice(-3) : '#' + id.slice(0, 6);
}

export default function PagarContaModalQR(props: Props) {
  const { qrToken, participantId, participantName, accessToken, onClose } = props;
  const auth = { participant_id: participantId, access_token: accessToken };

  const [carregando, setCarregando] = useState(true);
  const [enabled, setEnabled] = useState(true);
  const [orders, setOrders] = useState<BillOrder[]>([]);
  const [tableNumber, setTableNumber] = useState<number | null>(null);
  // Fila por senha (QR universal): a conta é só do cliente, não existe "mesa inteira".
  const [queueMode, setQueueMode] = useState(false);
  const [scope, setScope] = useState<Scope>('mine');
  const [pix, setPix] = useState<PixInfo | null>(null);
  const [gerando, setGerando] = useState(false);
  const [verificando, setVerificando] = useState(false);
  const [erro, setErro] = useState('');
  const [copiado, setCopiado] = useState(false);
  const [segundos, setSegundos] = useState(0);
  const [expandido, setExpandido] = useState<string | null>(null);
  const [pagamentos, setPagamentos] = useState<PagamentoFeito[]>([]);
  // CPF/CNPJ na nota (opcional): o cliente digita antes de gerar o Pix.
  const [cpfNota, setCpfNota] = useState<string>(function () {
    try { return sessionStorage.getItem('erpos_qr_cpf_nota') || ''; } catch { return ''; }
  });
  const cpfDigits = cpfNota.replace(/\D/g, '');
  const cpfValido = cpfDigits.length === 0 || validaCpfCnpj(cpfDigits);

  const pixRef = useRef<PixInfo | null>(null);
  pixRef.current = pix;

  const carregarConta = useCallback(async function () {
    try {
      const data = await callOnlinePayments<{
        enabled: boolean; table_number: number | null; orders: BillOrder[];
        pending_pix: PixInfo | null; last_pix: PixInfo | null; session_closed: boolean; mode?: string;
        payments_history?: PagamentoFeito[];
      }>({ action: 'get_bill', ...auth });

      if (data.error) {
        setErro(data.message || data.error);
        return;
      }
      setEnabled(Boolean(data.enabled));
      setOrders(data.orders || []);
      setTableNumber(data.table_number ?? null);
      setPagamentos(data.payments_history || []);
      if (data.mode === 'queue') { setQueueMode(true); setScope('mine'); }

      if (data.pending_pix && !pixRef.current) {
        setPix(data.pending_pix);
        setScope(data.pending_pix.scope || 'mine');
        return;
      }
      // Voltou do app do banco depois de a tela ter sido recarregada: mostra o comprovante
      // do Pix que ESTE aparelho gerou (o memo local evita exibir cobrança de outra pessoa).
      const memo = loadPixMemo(qrToken);
      if (!pixRef.current && data.last_pix && memo && memo.pixId === data.last_pix.id) {
        setPix(data.last_pix);
      }
    } catch {
      setErro('Erro de conexão. Tente novamente.');
    } finally {
      setCarregando(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [participantId, accessToken, qrToken]);

  useEffect(function () { carregarConta(); }, [carregarConta]);

  // ── Acompanhamento do Pix ────────────────────────────────────────────────
  // Realtime (instantâneo) + polling de 6 s (webhook perdido) + volta do app do
  // banco (timers congelados em segundo plano não disparam sozinhos).
  useEffect(function () {
    if (!pix || pix.status !== 'pending') return;
    const pixId = pix.id;
    let cancelled = false;

    async function checar(reconcile: boolean) {
      if (cancelled) return;
      try {
        const data = await callOnlinePayments<{ pix: PixInfo }>({ action: 'get_pix_status', pix_payment_id: pixId, reconcile, ...auth });
        if (cancelled || !data.pix) return;
        if (data.pix.status !== 'pending') {
          setPix(data.pix);
          if (data.pix.status === 'confirmed') {
            clearPixMemo(qrToken);
            carregarConta();
          }
        }
      } catch { /* tenta de novo no próximo ciclo */ }
    }

    const channel = supabase
      .channel('pix-payment:' + pixId)
      .on('broadcast', { event: 'pix_change' }, function () { checar(false); })
      .subscribe();

    const poll = setInterval(function () { checar(true); }, 6000);

    function aoVoltar() {
      if (document.visibilityState === 'visible') checar(true);
    }
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
  }, [pix?.id, pix?.status, qrToken]);

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

  async function gerarPix() {
    setGerando(true);
    setErro('');
    try {
      if (cpfDigits && !cpfValido) { setErro('CPF/CNPJ inválido. Confira os dígitos ou deixe em branco.'); return; }
      try { if (cpfDigits) sessionStorage.setItem('erpos_qr_cpf_nota', cpfDigits); else sessionStorage.removeItem('erpos_qr_cpf_nota'); } catch { /* sem storage */ }
      const data = await callOnlinePayments<{ pix: PixInfo }>({ action: 'create_pix', scope, customer_cpf: cpfDigits || null, ...auth });
      if (data.error || !data.pix) {
        setErro(data.message || data.error || 'Não foi possível gerar o Pix');
        return;
      }
      setPix(data.pix);
      savePixMemo(qrToken, { pixId: data.pix.id, participantId, accessToken, amount: data.pix.amount });
    } catch {
      setErro('Erro de conexão. Tente novamente.');
    } finally {
      setGerando(false);
    }
  }

  async function verificarAgora() {
    if (!pix || verificando) return;
    setVerificando(true);
    setErro('');
    try {
      const data = await callOnlinePayments<{ pix: PixInfo }>({ action: 'get_pix_status', pix_payment_id: pix.id, reconcile: true, ...auth });
      if (data.pix) {
        setPix(data.pix);
        if (data.pix.status === 'confirmed') { clearPixMemo(qrToken); carregarConta(); }
        else if (data.pix.status === 'pending') setErro('O banco ainda não avisou o pagamento. Se você acabou de pagar, aguarde alguns segundos.');
      }
    } catch {
      setErro('Erro de conexão. Tente novamente.');
    } finally {
      setVerificando(false);
    }
  }

  async function cancelarPix() {
    if (!pix) return;
    const id = pix.id;
    setPix(null);
    clearPixMemo(qrToken);
    try { await callOnlinePayments({ action: 'cancel_pix', pix_payment_id: id, ...auth }); } catch { /* silencioso */ }
    carregarConta();
  }

  async function copiarCodigo() {
    if (!pix?.qr_code) return;
    try {
      await navigator.clipboard.writeText(pix.qr_code);
      setCopiado(true);
      setTimeout(function () { setCopiado(false); }, 2500);
    } catch {
      const el = document.getElementById('pix-copia-cola') as HTMLInputElement | null;
      if (el) { el.focus(); el.select(); }
    }
  }

  // ── Derivados ──────────────────────────────────────────────────────────────
  const meus = orders.filter(function (o) { return o.participant_id === participantId; });
  const pendentesMeus = meus.filter(function (o) { return o.remaining > 0; });
  const pendentesTodos = orders.filter(function (o) { return o.remaining > 0; });
  const totalMeus = pendentesMeus.reduce(function (s, o) { return s + o.remaining; }, 0);
  const totalTodos = pendentesTodos.reduce(function (s, o) { return s + o.remaining; }, 0);
  const alvo = scope === 'mine' ? pendentesMeus : pendentesTodos;
  const totalAlvo = scope === 'mine' ? totalMeus : totalTodos;
  const temTravado = alvo.some(function (o) { return o.locked; });
  const tudoPago = orders.length > 0 && pendentesTodos.length === 0;
  const totalPagoGeral = pagamentos.reduce(function (s, p) { return s + p.amount; }, 0);
  const listaVisivel = scope === 'mine' ? meus : orders;

  const mm = String(Math.floor(segundos / 60)).padStart(2, '0');
  const ss = String(segundos % 60).padStart(2, '0');

  // ── Render ─────────────────────────────────────────────────────────────────
  function renderConta() {
    if (!enabled) {
      return (
        <div className="flex flex-col items-center py-10 text-center px-4">
          <div className="w-14 h-14 flex items-center justify-center bg-zinc-100 rounded-2xl mb-4">
            <i className="ri-bank-card-line text-zinc-400 text-xl" />
          </div>
          <p className="text-sm font-semibold text-zinc-700">Pagamento pelo celular indisponível</p>
          <p className="text-xs text-zinc-400 mt-1">Por favor, pague no caixa ou chame um atendente.</p>
        </div>
      );
    }
    if (orders.length === 0) {
      return (
        <div className="flex flex-col items-center py-10 text-center px-4">
          <div className="w-14 h-14 flex items-center justify-center bg-zinc-100 rounded-2xl mb-4">
            <i className="ri-receipt-line text-zinc-300 text-xl" />
          </div>
          <p className="text-sm font-semibold text-zinc-600">Nenhum pedido na mesa ainda</p>
        </div>
      );
    }
    return (
      <div className="space-y-4">
        {tudoPago ? (
          <div className="flex items-center gap-3 px-4 py-3 bg-emerald-50 border border-emerald-200 rounded-2xl">
            <div className="w-10 h-10 flex items-center justify-center bg-emerald-100 rounded-full shrink-0">
              <i className="ri-checkbox-circle-fill text-emerald-500 text-xl" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-black text-emerald-800">Conta toda paga</p>
              <p className="text-[11px] text-emerald-600">
                {totalPagoGeral > 0 ? formatMoney(totalPagoGeral) + ' · ' : ''}
                {orders.length} {orders.length === 1 ? 'pedido' : 'pedidos'} · obrigado!
              </p>
            </div>
          </div>
        ) : null}

        {/* Escopo — só faz sentido quando há mesa compartilhada e ainda há o que pagar */}
        <div className={'grid grid-cols-2 gap-2 p-1 bg-zinc-100 rounded-xl' + (queueMode || tudoPago ? ' hidden' : '')}>
          <button
            type="button"
            onClick={function () { setScope('mine'); }}
            className={'py-2.5 rounded-lg text-xs font-bold cursor-pointer transition-all whitespace-nowrap ' + (scope === 'mine' ? 'bg-white text-amber-600 shadow-sm' : 'text-zinc-500')}
          >
            Meus pedidos
            <span className="block text-[10px] font-semibold opacity-80">{formatMoney(totalMeus)}</span>
          </button>
          <button
            type="button"
            onClick={function () { setScope('all'); }}
            className={'py-2.5 rounded-lg text-xs font-bold cursor-pointer transition-all whitespace-nowrap ' + (scope === 'all' ? 'bg-white text-amber-600 shadow-sm' : 'text-zinc-500')}
          >
            Mesa inteira
            <span className="block text-[10px] font-semibold opacity-80">{formatMoney(totalTodos)}</span>
          </button>
        </div>

        {/* Lista */}
        <div className="space-y-2">
          {listaVisivel.map(function (o) {
            const aberto = expandido === o.id;
            const pago = o.remaining <= 0;
            return (
              <div key={o.id} className={'border rounded-2xl overflow-hidden ' + (pago ? 'border-emerald-100 bg-emerald-50/40' : o.locked ? 'border-amber-200 bg-amber-50/40' : 'border-zinc-200/80 bg-white')}>
                <button
                  type="button"
                  onClick={function () { setExpandido(aberto ? null : o.id); }}
                  className="w-full flex items-center justify-between px-3.5 py-3 text-left cursor-pointer"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="min-w-9 h-9 flex items-center justify-center bg-amber-50 rounded-xl px-2">
                      <span className="text-xs font-black text-amber-600">{shortNumber(o.number, o.id)}</span>
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-zinc-800 truncate">
                        {o.participant_name || 'Mesa'}
                        <span className="text-zinc-400 font-medium"> · {o.items.length} {o.items.length === 1 ? 'item' : 'itens'}</span>
                      </p>
                      {pago ? (
                        <p className="text-[10px] font-semibold text-emerald-600">
                          Pago{o.paid_at ? ' às ' + new Date(o.paid_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : ''}
                        </p>
                      ) : o.locked ? (
                        <p className="text-[10px] font-semibold text-amber-600">Alguém está pagando…</p>
                      ) : o.paid_amount > 0 ? (
                        <p className="text-[10px] text-zinc-400">Falta {formatMoney(o.remaining)}</p>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className={'text-sm font-bold ' + (pago ? 'text-emerald-600 line-through opacity-60' : 'text-zinc-900')}>{formatMoney(o.total_amount)}</span>
                    <i className={'text-zinc-400 text-sm ' + (aberto ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line')} />
                  </div>
                </button>
                {aberto ? (
                  <div className="border-t border-zinc-100 px-3.5 py-2 divide-y divide-zinc-50">
                    {o.items.map(function (it, i) {
                      return (
                        <div key={i} className="flex items-center justify-between py-1.5">
                          <p className="text-[11px] text-zinc-700"><span className="text-zinc-400">{it.quantity}x</span> {it.name}</p>
                          <p className="text-[11px] font-semibold text-zinc-700">{formatMoney(it.price * it.quantity)}</p>
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>

        {!queueMode && scope === 'mine' && meus.length === 0 ? (
          <p className="text-[11px] text-zinc-400 text-center">Você ainda não fez pedidos. Use "Mesa inteira" para pagar pelos outros.</p>
        ) : null}

        {/* Extrato: o que já foi pago (Pix pelo app ou recebido no caixa) */}
        {pagamentos.length > 0 ? (
          <div>
            <p className="text-[10px] uppercase tracking-wider font-bold text-zinc-400 mb-2">Pagamentos</p>
            <div className="space-y-1.5">
              {pagamentos.map(function (pg) {
                const hora = new Date(pg.at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
                return (
                  <div key={pg.id} className="flex items-center justify-between px-3.5 py-2.5 bg-emerald-50/60 border border-emerald-100 rounded-xl">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-7 h-7 flex items-center justify-center bg-emerald-100 rounded-lg shrink-0">
                        <i className="ri-check-line text-emerald-600 text-sm" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-zinc-800 truncate">{pg.method}</p>
                        <p className="text-[10px] text-zinc-400">
                          {hora}
                          {pg.orders.length > 0 ? ' · pedido' + (pg.orders.length > 1 ? 's ' : ' ') + pg.orders.map(function (n) { return n.slice(-3); }).join(', ') : ''}
                        </p>
                      </div>
                    </div>
                    <span className="text-sm font-bold text-emerald-700 shrink-0">{formatMoney(pg.amount)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  function renderPix() {
    if (!pix) return null;
    if (pix.status === 'confirmed') {
      return (
        <div className="flex flex-col items-center py-8 text-center px-4">
          <div className="w-20 h-20 flex items-center justify-center bg-emerald-100 rounded-full mb-4">
            <i className="ri-checkbox-circle-fill text-emerald-500 text-4xl" />
          </div>
          <p className="text-lg font-black text-zinc-800">Pagamento confirmado!</p>
          <p className="text-2xl font-black text-emerald-600 mt-1">{formatMoney(pix.amount)}</p>
          <p className="text-xs text-zinc-500 mt-3">
            {pix.allocation ? pix.allocation.length : 1} {pix.allocation && pix.allocation.length > 1 ? 'pedidos pagos' : 'pedido pago'} via Pix. Obrigado!
          </p>
          <button
            type="button"
            onClick={function () { setPix(null); carregarConta(); }}
            className="mt-6 px-5 py-2.5 bg-zinc-100 hover:bg-zinc-200 text-zinc-700 text-xs font-bold rounded-xl cursor-pointer whitespace-nowrap"
          >
            Ver a conta
          </button>
        </div>
      );
    }
    if (pix.status !== 'pending') {
      const msg = pix.status === 'expired' ? 'Este Pix expirou.' : pix.status === 'cancelled' ? 'Este Pix foi cancelado.' : 'Não foi possível gerar o Pix.';
      return (
        <div className="flex flex-col items-center py-8 text-center px-4">
          <div className="w-14 h-14 flex items-center justify-center bg-zinc-100 rounded-2xl mb-4">
            <i className="ri-time-line text-zinc-400 text-2xl" />
          </div>
          <p className="text-sm font-bold text-zinc-700">{msg}</p>
          <p className="text-xs text-zinc-400 mt-1">Se você já pagou, aguarde: a confirmação pode levar alguns segundos.</p>
          <button
            type="button"
            onClick={function () { setPix(null); clearPixMemo(qrToken); carregarConta(); }}
            className="mt-5 px-5 py-2.5 bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold rounded-xl cursor-pointer whitespace-nowrap"
          >
            Gerar um novo Pix
          </button>
        </div>
      );
    }
    return (
      <div className="flex flex-col items-center px-2">
        <p className="text-[10px] uppercase tracking-wider font-bold text-zinc-400">Valor a pagar</p>
        <p className="text-3xl font-black text-zinc-900 mt-0.5">{formatMoney(pix.amount)}</p>
        <p className="text-[11px] text-zinc-400 mt-1">
          {pix.scope === 'all' ? 'Mesa inteira' : 'Meus pedidos'} · expira em <span className={'font-bold tabular-nums ' + (segundos < 60 ? 'text-red-500' : 'text-zinc-600')}>{mm}:{ss}</span>
        </p>

        {pix.qr_code_base64 ? (
          <div className="mt-4 p-3 bg-white border border-zinc-200 rounded-2xl">
            <img src={'data:image/png;base64,' + pix.qr_code_base64} alt="QR Code Pix" className="w-44 h-44" />
          </div>
        ) : null}

        <div className="w-full mt-4 space-y-2">
          <button
            type="button"
            onClick={copiarCodigo}
            className={'w-full flex items-center justify-center gap-2 py-3.5 rounded-xl text-sm font-bold cursor-pointer transition-colors whitespace-nowrap ' + (copiado ? 'bg-emerald-500 text-white' : 'bg-gradient-to-br from-amber-500 to-orange-500 text-white shadow-sm')}
          >
            <i className={copiado ? 'ri-check-line' : 'ri-file-copy-line'} />
            {copiado ? 'Código copiado!' : 'Copiar código Pix'}
          </button>
          <input id="pix-copia-cola" readOnly value={pix.qr_code} className="w-full text-[10px] text-zinc-500 bg-zinc-50 border border-zinc-200 rounded-lg px-2 py-1.5 truncate" />
        </div>

        <ol className="w-full mt-4 space-y-1.5 text-[11px] text-zinc-600">
          <li className="flex gap-2"><span className="w-4 h-4 flex items-center justify-center bg-amber-100 text-amber-700 rounded-full text-[9px] font-bold shrink-0">1</span>Copie o código acima</li>
          <li className="flex gap-2"><span className="w-4 h-4 flex items-center justify-center bg-amber-100 text-amber-700 rounded-full text-[9px] font-bold shrink-0">2</span>Abra o app do seu banco em <strong>Pix › Pix Copia e Cola</strong></li>
          <li className="flex gap-2"><span className="w-4 h-4 flex items-center justify-center bg-amber-100 text-amber-700 rounded-full text-[9px] font-bold shrink-0">3</span>Cole, confirme e <strong>volte para esta tela</strong> — a confirmação aparece sozinha</li>
        </ol>

        <div className="flex items-center gap-2 mt-4 text-[11px] text-zinc-400">
          <i className="ri-loader-4-line animate-spin text-amber-500" />
          Aguardando o pagamento…
        </div>

        <button
          type="button"
          onClick={verificarAgora}
          disabled={verificando}
          className="mt-3 w-full flex items-center justify-center gap-2 py-2.5 bg-zinc-100 hover:bg-zinc-200 disabled:opacity-50 text-zinc-700 text-xs font-bold rounded-xl cursor-pointer whitespace-nowrap"
        >
          <i className={verificando ? 'ri-loader-4-line animate-spin' : 'ri-refresh-line'} />
          {verificando ? 'Verificando…' : 'Já paguei — verificar agora'}
        </button>

        <button
          type="button"
          onClick={cancelarPix}
          className="mt-3 text-[11px] text-zinc-400 underline cursor-pointer"
        >
          Cancelar este Pix
        </button>
      </div>
    );
  }

  const mostrandoPix = pix !== null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50">
      <div className="bg-white w-full max-w-sm rounded-t-3xl sm:rounded-2xl max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-100 flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 flex items-center justify-center bg-emerald-100 rounded-xl">
              <i className="ri-qr-code-line text-emerald-600 text-base" />
            </div>
            <div>
              <h2 className="text-base font-bold text-zinc-900">{mostrandoPix ? 'Pagar com Pix' : 'Pagar a conta'}</h2>
              <p className="text-[10px] text-zinc-400">{queueMode ? 'Senha ' + accessToken + ' · ' : (tableNumber != null ? 'Mesa ' + tableNumber + ' · ' : '')}{participantName}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg bg-zinc-100 hover:bg-zinc-200 text-zinc-500 cursor-pointer transition-colors"
          >
            <i className="ri-close-line text-base" />
          </button>
        </div>

        {/* Conteúdo */}
        <div className="flex-1 overflow-y-auto px-4 py-4">
          {carregando ? (
            <div className="flex flex-col items-center py-12">
              <i className="ri-loader-4-line text-2xl text-amber-500 animate-spin" />
              <p className="text-xs text-zinc-400 mt-3">Buscando sua conta...</p>
            </div>
          ) : mostrandoPix ? renderPix() : renderConta()}

          {erro ? (
            <div className="mt-3 flex items-start gap-2 px-3 py-2.5 bg-red-50 border border-red-100 rounded-xl">
              <i className="ri-error-warning-line text-red-500 text-sm mt-0.5" />
              <p className="text-[11px] text-red-600">{erro}</p>
            </div>
          ) : null}
        </div>

        {/* Footer: só na tela da conta, com algo a pagar */}
        {!carregando && !mostrandoPix && enabled && !tudoPago && orders.length > 0 ? (
          <div className="border-t border-zinc-100 bg-white px-5 py-4 flex-shrink-0 rounded-b-2xl">
            {/* CPF na nota (opcional) — vai para a NFC-e emitida quando o Pix confirmar */}
            <div className="mb-3">
              <label className="flex items-center justify-between text-[11px] font-semibold text-zinc-600 mb-1">
                <span><i className="ri-file-shield-2-line text-zinc-400 mr-1" />CPF na nota fiscal <span className="font-normal text-zinc-400">(opcional)</span></span>
                {cpfDigits && cpfValido ? <span className="text-emerald-600 font-bold">vai na nota</span> : null}
              </label>
              <input
                inputMode="numeric"
                autoComplete="off"
                value={formatCpfCnpjQR(cpfDigits) || cpfNota}
                onChange={function (e) { setCpfNota(e.target.value.replace(/\D/g, '').slice(0, 14)); }}
                placeholder="000.000.000-00"
                className={'w-full text-sm border rounded-xl px-3 py-2.5 text-zinc-800 focus:outline-none ' + (cpfDigits && !cpfValido ? 'border-red-300 focus:border-red-400' : 'border-zinc-200 focus:border-emerald-400')}
              />
              {cpfDigits && !cpfValido ? <p className="text-[10px] text-red-500 mt-1">{cpfDigits.length < 11 ? 'Faltam dígitos' : 'Documento inválido'}</p> : null}
            </div>
            <button
              type="button"
              disabled={gerando || alvo.length === 0 || temTravado || (cpfDigits.length > 0 && !cpfValido)}
              onClick={gerarPix}
              className="w-full flex items-center justify-between bg-gradient-to-br from-emerald-500 to-emerald-600 disabled:from-zinc-300 disabled:to-zinc-300 text-white px-5 py-3.5 rounded-xl cursor-pointer disabled:cursor-not-allowed transition-colors shadow-sm"
            >
              <span className="flex items-center gap-2 text-sm font-bold">
                {gerando ? <i className="ri-loader-4-line animate-spin" /> : <i className="ri-qr-code-line" />}
                {gerando ? 'Gerando Pix…' : 'Pagar com Pix'}
              </span>
              <span className="text-sm font-black">{formatMoney(totalAlvo)}</span>
            </button>
            {temTravado ? (
              <p className="text-[10px] text-amber-600 text-center mt-2">Outra pessoa está pagando parte desses pedidos. Aguarde um instante.</p>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ── CPF/CNPJ (validação de dígito verificador + máscara) ─────────────────────
function validaCpfCnpj(d: string): boolean {
  if (d.length === 11) {
    if (/^(\d)\1{10}$/.test(d)) return false;
    const calc = function (len: number) { let s = 0; for (let i = 0; i < len; i++) s += Number(d[i]) * (len + 1 - i); const r = (s * 10) % 11; return r === 10 ? 0 : r; };
    return calc(9) === Number(d[9]) && calc(10) === Number(d[10]);
  }
  if (d.length === 14) {
    if (/^(\d)\1{13}$/.test(d)) return false;
    const calc = function (len: number) { const w = len === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]; let s = 0; for (let i = 0; i < len; i++) s += Number(d[i]) * w[i]; const r = s % 11; return r < 2 ? 0 : 11 - r; };
    return calc(12) === Number(d[12]) && calc(13) === Number(d[13]);
  }
  return false;
}
function formatCpfCnpjQR(d: string): string {
  if (d.length <= 11) return d.replace(/^(\d{3})(\d)/, '$1.$2').replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3').replace(/\.(\d{3})(\d{1,2})$/, '.$1-$2');
  return d.replace(/^(\d{2})(\d)/, '$1.$2').replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3').replace(/\.(\d{3})(\d)/, '.$1/$2').replace(/(\d{4})(\d{1,2})$/, '$1-$2');
}
