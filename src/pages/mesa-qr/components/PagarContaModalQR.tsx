import { useState, useEffect, useRef, useCallback, useMemo, memo } from 'react';
import { isValidCpfCnpj as validaCpfCnpj, mascaraCpfCnpj as formatCpfCnpjQR } from '@/lib/cpfCnpj';
import { supabase } from '@/lib/supabase';
import CartaoCobrancaPanel from '@/components/feature/CartaoCobrancaPanel';
import { savePixMemo, loadPixMemo, clearPixMemo } from '../pixMemo';

// ── Pagar a conta no celular (Pix dinâmico via Mercado Pago) ─────────────────
// Fluxo: conta → escolhe "meus pedidos" ou "mesa inteira" → gera Pix → copia o
// código → o cliente SAI para o app do banco → volta. Nada aqui marca pago: só a
// Edge `online-payments` quando o provedor aprova.
//
// A volta do app do banco é o ponto delicado: o Android congela timers e derruba
// o WebSocket da aba em segundo plano, então além do Realtime + polling temos um
// gatilho em `visibilitychange`/`focus` e um botão manual de verificação.
//
// Cartão de crédito (quando a loja liga): o cliente escolhe Pix OU cartão na conta. O cartão
// usa o CartaoCobrancaPanel (Card Payment Brick do Mercado Pago, só crédito à vista). Gerar um
// Pix cancela o cartão pendente no servidor e vice-versa — por isso as duas cobranças nunca
// aparecem juntas e trocar de forma de pagamento é sempre um clique do cliente.

function formatMoney(v: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);
}

// O Brick do cartão é recriado a cada render do painel (apaga o que o cliente digitou):
// memo + props estáveis impedem que um re-render deste modal reinicie o formulário.
const PainelCartao = memo(CartaoCobrancaPanel);

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
  method?: string;
  card_last4?: string | null;
}

interface Props {
  qrToken: string;
  tenantId: string;
  participantId: string;
  participantName: string;
  accessToken: string;
  onClose: () => void;
  /** Chamado quando um pagamento (Pix ou cartão) é confirmado. */
  onPago?: () => void;
  /** Linha extra no aviso de pago (ex.: "Seu pedido foi para a cozinha"). */
  textoPago?: string;
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
  const { qrToken, participantId, participantName, accessToken, onClose, textoPago } = props;
  // Estável: vai como prop do painel do cartão (memo).
  const auth = useMemo(function () { return { participant_id: participantId, access_token: accessToken }; }, [participantId, accessToken]);
  const onPagoRef = useRef(props.onPago);
  onPagoRef.current = props.onPago;

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
  const [editandoCpf, setEditandoCpf] = useState(false);
  const [salvandoCpf, setSalvandoCpf] = useState(false);
  // Cartão de crédito (Mercado Pago): disponível quando a loja ligou; `pagandoCartao` troca a conta pelo formulário.
  const [cardEnabled, setCardEnabled] = useState(false);
  const [publicKey, setPublicKey] = useState('');
  const [pagandoCartao, setPagandoCartao] = useState(false);
  const [cartaoPago, setCartaoPago] = useState(false);
  const cargaInicialRef = useRef(true);
  const cpfDigits = cpfNota.replace(/\D/g, '');
  const cpfValido = cpfDigits.length === 0 || validaCpfCnpj(cpfDigits);

  const pixRef = useRef<PixInfo | null>(null);
  pixRef.current = pix;

  const carregarConta = useCallback(async function () {
    try {
      const data = await callOnlinePayments<{
        enabled: boolean; table_number: number | null; orders: BillOrder[]; customer_cpf?: string | null;
        pending_pix: PixInfo | null; last_pix: PixInfo | null; session_closed: boolean; mode?: string;
        payments_history?: PagamentoFeito[];
        card_enabled?: boolean; public_key?: string | null; pending_card?: PixInfo | null;
      }>({ action: 'get_bill', ...auth });

      if (data.error) {
        setErro(data.message || data.error);
        return;
      }
      setEnabled(Boolean(data.enabled));
      setOrders(data.orders || []);
      if (data.customer_cpf) setCpfNota(function (atual) { return atual || String(data.customer_cpf); });
      setTableNumber(data.table_number ?? null);
      setPagamentos(data.payments_history || []);
      if (data.mode === 'queue') { setQueueMode(true); setScope('mine'); }
      const cartaoLigado = Boolean(data.card_enabled && data.public_key);
      setCardEnabled(cartaoLigado);
      setPublicKey(data.public_key || '');

      if (data.pending_pix && !pixRef.current) {
        cargaInicialRef.current = false;
        setPix(data.pending_pix);
        setScope(data.pending_pix.scope || 'mine');
        return;
      }
      // Desafio do banco (3DS) em andamento: ao abrir, retoma direto no cartão.
      if (cargaInicialRef.current && cartaoLigado && data.pending_card && data.pending_card.status === 'pending') {
        cargaInicialRef.current = false;
        setScope(data.mode === 'queue' ? 'mine' : (data.pending_card.scope || 'mine'));
        setPagandoCartao(true);
        return;
      }
      cargaInicialRef.current = false;
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
            onPagoRef.current?.();
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

  // Informar/corrigir o CPF com o Pix já gerado (antes de o pagamento ser liquidado).
  async function salvarCpfDoPix() {
    if (!pix) return;
    if (cpfDigits && !cpfValido) return;
    setSalvandoCpf(true);
    setErro('');
    try {
      const data = await callOnlinePayments<{ ok?: boolean }>({ action: 'set_cpf', pix_payment_id: pix.id, customer_cpf: cpfDigits || null, ...auth });
      if (data.error) { setErro(data.message || data.error); return; }
      try { if (cpfDigits) sessionStorage.setItem('erpos_qr_cpf_nota', cpfDigits); else sessionStorage.removeItem('erpos_qr_cpf_nota'); } catch { /* sem storage */ }
      setEditandoCpf(false);
    } catch {
      setErro('Erro de conexão. Tente novamente.');
    } finally {
      setSalvandoCpf(false);
    }
  }

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
        if (data.pix.status === 'confirmed') { clearPixMemo(qrToken); carregarConta(); onPagoRef.current?.(); }
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

  // Cartão: o CPF já foi digitado na conta; no formulário ele só é lido (o painel guarda o valor do envio).
  function abrirCartao() {
    if (cpfDigits && !cpfValido) { setErro('CPF/CNPJ inválido. Confira os dígitos ou deixe em branco.'); return; }
    try { if (cpfDigits) sessionStorage.setItem('erpos_qr_cpf_nota', cpfDigits); else sessionStorage.removeItem('erpos_qr_cpf_nota'); } catch { /* sem storage */ }
    setErro('');
    setCartaoPago(false);
    setPagandoCartao(true);
  }

  function voltarDoCartao() {
    setPagandoCartao(false);
    setCartaoPago(false);
    setErro('');
    carregarConta(); // se o banco aprovou enquanto o cliente voltava, a conta já aparece paga
  }

  // Estável (o painel é memo): atualiza a conta/extrato e avisa quem abriu o modal.
  const aoCartaoPago = useCallback(function () {
    setCartaoPago(true);
    clearPixMemo(qrToken);
    carregarConta();
    onPagoRef.current?.();
  }, [qrToken, carregarConta]);

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
          <div className="w-14 h-14 flex items-center justify-center bg-stone-100 rounded-2xl mb-4">
            <i className="ri-bank-card-line text-stone-400 text-xl" />
          </div>
          <p className="text-sm font-semibold text-stone-700">Pagamento pelo celular indisponível</p>
          <p className="text-xs text-stone-400 mt-1">Por favor, pague no caixa ou chame um atendente.</p>
        </div>
      );
    }
    if (orders.length === 0) {
      return (
        <div className="flex flex-col items-center py-10 text-center px-4">
          <div className="w-14 h-14 flex items-center justify-center bg-stone-100 rounded-2xl mb-4">
            <i className="ri-receipt-line text-stone-300 text-xl" />
          </div>
          <p className="text-sm font-semibold text-stone-600">Nenhum pedido na mesa ainda</p>
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
        <div className={'grid grid-cols-2 gap-2 p-1 bg-stone-100 rounded-xl' + (queueMode || tudoPago ? ' hidden' : '')}>
          <button
            type="button"
            onClick={function () { setScope('mine'); }}
            className={'py-2.5 rounded-lg text-xs font-bold cursor-pointer transition-all whitespace-nowrap ' + (scope === 'mine' ? 'bg-white text-[var(--cor-loja,#C2410C)] shadow-sm' : 'text-stone-500')}
          >
            Meus pedidos
            <span className="block text-[10px] font-semibold opacity-80">{formatMoney(totalMeus)}</span>
          </button>
          <button
            type="button"
            onClick={function () { setScope('all'); }}
            className={'py-2.5 rounded-lg text-xs font-bold cursor-pointer transition-all whitespace-nowrap ' + (scope === 'all' ? 'bg-white text-[var(--cor-loja,#C2410C)] shadow-sm' : 'text-stone-500')}
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
              <div key={o.id} className={'border rounded-2xl overflow-hidden ' + (pago ? 'border-emerald-100 bg-emerald-50/40' : o.locked ? 'border-stone-200 bg-[var(--cor-loja-suave,#F9ECE7)]' : 'border-stone-200/80 bg-white')}>
                <button
                  type="button"
                  onClick={function () { setExpandido(aberto ? null : o.id); }}
                  className="w-full flex items-center justify-between px-3.5 py-3 text-left cursor-pointer"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="min-w-9 h-9 flex items-center justify-center bg-[var(--cor-loja-suave,#F9ECE7)] rounded-xl px-2">
                      <span className="text-xs font-black text-[var(--cor-loja,#C2410C)]">{shortNumber(o.number, o.id)}</span>
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-stone-800 truncate">
                        {o.participant_name || 'Mesa'}
                        <span className="text-stone-400 font-medium"> · {o.items.length} {o.items.length === 1 ? 'item' : 'itens'}</span>
                      </p>
                      {pago ? (
                        <p className="text-[10px] font-semibold text-emerald-600">
                          Pago{o.paid_at ? ' às ' + new Date(o.paid_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : ''}
                        </p>
                      ) : o.locked ? (
                        <p className="text-[10px] font-semibold text-[var(--cor-loja,#C2410C)]">Alguém está pagando…</p>
                      ) : o.paid_amount > 0 ? (
                        <p className="text-[10px] text-stone-400">Falta {formatMoney(o.remaining)}</p>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className={'text-sm font-bold ' + (pago ? 'text-emerald-600 line-through opacity-60' : 'text-stone-900')}>{formatMoney(o.total_amount)}</span>
                    <i className={'text-stone-400 text-sm ' + (aberto ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line')} />
                  </div>
                </button>
                {aberto ? (
                  <div className="border-t border-stone-100 px-3.5 py-2 divide-y divide-stone-50">
                    {o.items.map(function (it, i) {
                      return (
                        <div key={i} className="flex items-center justify-between py-1.5">
                          <p className="text-[11px] text-stone-700"><span className="text-stone-400">{it.quantity}x</span> {it.name}</p>
                          <p className="text-[11px] font-semibold text-stone-700">{formatMoney(it.price * it.quantity)}</p>
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
          <p className="text-[11px] text-stone-400 text-center">Você ainda não fez pedidos. Use "Mesa inteira" para pagar pelos outros.</p>
        ) : null}

        {/* Extrato: o que já foi pago (Pix pelo app ou recebido no caixa) */}
        {pagamentos.length > 0 ? (
          <div>
            <p className="text-[10px] uppercase tracking-wider font-bold text-stone-400 mb-2">Pagamentos</p>
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
                        <p className="text-xs font-bold text-stone-800 truncate">{pg.method}</p>
                        <p className="text-[10px] text-stone-400">
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
          <p className="text-lg font-black text-stone-800">Pagamento confirmado!</p>
          <p className="text-2xl font-black text-emerald-600 mt-1">{formatMoney(pix.amount)}</p>
          <p className="text-xs text-stone-500 mt-3">
            {pix.allocation ? pix.allocation.length : 1} {pix.allocation && pix.allocation.length > 1 ? 'pedidos pagos' : 'pedido pago'} {pix.method === 'credit_card' ? 'no cartão' : 'via Pix'}. Obrigado!
          </p>
          {textoPago ? <p className="text-xs font-bold text-emerald-700 mt-2">{textoPago}</p> : null}
          <button
            type="button"
            onClick={function () { setPix(null); carregarConta(); }}
            className="mt-6 px-5 py-2.5 bg-stone-100 hover:bg-stone-200 text-stone-700 text-xs font-bold rounded-xl cursor-pointer whitespace-nowrap"
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
          <div className="w-14 h-14 flex items-center justify-center bg-stone-100 rounded-2xl mb-4">
            <i className="ri-time-line text-stone-400 text-2xl" />
          </div>
          <p className="text-sm font-bold text-stone-700">{msg}</p>
          <p className="text-xs text-stone-400 mt-1">Se você já pagou, aguarde: a confirmação pode levar alguns segundos.</p>
          <button
            type="button"
            onClick={function () { setPix(null); clearPixMemo(qrToken); carregarConta(); }}
            className="mt-5 px-5 py-2.5 bg-[var(--cor-loja,#C2410C)] hover:bg-[var(--cor-loja-forte,#A5380A)] text-white text-xs font-bold rounded-xl cursor-pointer whitespace-nowrap"
          >
            Gerar um novo Pix
          </button>
        </div>
      );
    }
    return (
      <div className="flex flex-col items-center px-2">
        <p className="text-[10px] uppercase tracking-wider font-bold text-stone-400">Valor a pagar</p>
        <p className="text-3xl font-black text-stone-900 mt-0.5">{formatMoney(pix.amount)}</p>
        <p className="text-[11px] text-stone-400 mt-1">
          {pix.scope === 'all' ? 'Mesa inteira' : 'Meus pedidos'} · expira em <span className={'font-bold tabular-nums ' + (segundos < 60 ? 'text-red-500' : 'text-stone-600')}>{mm}:{ss}</span>
        </p>

        {pix.qr_code_base64 ? (
          <div className="mt-4 p-3 bg-white border border-stone-200 rounded-2xl">
            <img src={'data:image/png;base64,' + pix.qr_code_base64} alt="QR Code Pix" className="w-44 h-44" />
          </div>
        ) : null}

        {/* CPF na nota: dá para informar/corrigir enquanto o Pix não foi pago */}
        <div className="w-full mt-3">
          {editandoCpf ? (
            <div className="flex items-center gap-2">
              <input
                inputMode="numeric"
                autoFocus
                value={formatCpfCnpjQR(cpfDigits) || cpfNota}
                onChange={function (e) { setCpfNota(e.target.value.replace(/\D/g, '').slice(0, 14)); }}
                placeholder="CPF/CNPJ na nota (opcional)"
                className={'flex-1 text-sm border rounded-xl px-3 py-2 text-stone-800 focus:outline-none ' + (cpfDigits && !cpfValido ? 'border-red-300' : 'border-stone-200 focus:border-emerald-400')}
              />
              <button
                type="button"
                disabled={salvandoCpf || (cpfDigits.length > 0 && !cpfValido)}
                onClick={salvarCpfDoPix}
                className="px-3 py-2 text-xs font-bold bg-stone-900 text-white rounded-xl disabled:opacity-40 cursor-pointer whitespace-nowrap"
              >
                {salvandoCpf ? 'Salvando…' : 'Salvar'}
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={function () { setEditandoCpf(true); }}
              className="w-full flex items-center justify-center gap-1.5 text-[11px] text-stone-500 py-1.5 cursor-pointer"
            >
              <i className="ri-file-shield-2-line" />
              {cpfDigits && cpfValido ? 'Na nota: ' + formatCpfCnpjQR(cpfDigits) + ' · alterar' : 'Quer CPF/CNPJ na nota fiscal?'}
            </button>
          )}
        </div>

        <div className="w-full mt-4 space-y-2">
          <button
            type="button"
            onClick={copiarCodigo}
            className={'w-full flex items-center justify-center gap-2 py-3.5 rounded-xl text-sm font-bold cursor-pointer transition-colors whitespace-nowrap ' + (copiado ? 'bg-emerald-500 text-white' : 'bg-[var(--cor-loja,#C2410C)] text-white shadow-sm')}
          >
            <i className={copiado ? 'ri-check-line' : 'ri-file-copy-line'} />
            {copiado ? 'Código copiado!' : 'Copiar código Pix'}
          </button>
          <input id="pix-copia-cola" readOnly value={pix.qr_code} className="w-full text-[10px] text-stone-500 bg-stone-50 border border-stone-200 rounded-lg px-2 py-1.5 truncate" />
        </div>

        <ol className="w-full mt-4 space-y-1.5 text-[11px] text-stone-600">
          <li className="flex gap-2"><span className="w-4 h-4 flex items-center justify-center bg-[var(--cor-loja-suave,#F9ECE7)] text-[var(--cor-loja,#C2410C)] rounded-full text-[9px] font-bold shrink-0">1</span><span className="flex-1 min-w-0">Copie o código acima</span></li>
          <li className="flex gap-2"><span className="w-4 h-4 flex items-center justify-center bg-[var(--cor-loja-suave,#F9ECE7)] text-[var(--cor-loja,#C2410C)] rounded-full text-[9px] font-bold shrink-0">2</span><span className="flex-1 min-w-0">Abra o app do seu banco em <strong>Pix › Pix Copia e Cola</strong></span></li>
          <li className="flex gap-2"><span className="w-4 h-4 flex items-center justify-center bg-[var(--cor-loja-suave,#F9ECE7)] text-[var(--cor-loja,#C2410C)] rounded-full text-[9px] font-bold shrink-0">3</span><span className="flex-1 min-w-0">Cole, confirme e <strong>volte para esta tela</strong> — a confirmação aparece sozinha</span></li>
        </ol>

        <div className="flex items-center gap-2 mt-4 text-[11px] text-stone-400">
          <i className="ri-loader-4-line animate-spin text-[var(--cor-loja,#C2410C)]" />
          Aguardando o pagamento…
        </div>

        <button
          type="button"
          onClick={verificarAgora}
          disabled={verificando}
          className="mt-3 w-full flex items-center justify-center gap-2 py-2.5 bg-stone-100 hover:bg-stone-200 disabled:opacity-50 text-stone-700 text-xs font-bold rounded-xl cursor-pointer whitespace-nowrap"
        >
          <i className={verificando ? 'ri-loader-4-line animate-spin' : 'ri-refresh-line'} />
          {verificando ? 'Verificando…' : 'Já paguei — verificar agora'}
        </button>

        <button
          type="button"
          onClick={cancelarPix}
          className="mt-3 text-[11px] text-stone-400 underline cursor-pointer"
        >
          Cancelar este Pix
        </button>
      </div>
    );
  }

  function renderCartao() {
    return (
      <div className="space-y-3">
        {!cartaoPago ? (
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={voltarDoCartao}
              className="flex items-center gap-1 text-[11px] font-semibold text-stone-500 hover:text-stone-700 cursor-pointer whitespace-nowrap"
            >
              <i className="ri-arrow-left-s-line text-sm" />
              Voltar para a conta
            </button>
            {!queueMode ? <span className="text-[11px] text-stone-400">{scope === 'all' ? 'Mesa inteira' : 'Meus pedidos'}</span> : null}
          </div>
        ) : null}
        {!cartaoPago && cpfDigits && cpfValido ? (
          <p className="flex items-center justify-center gap-1.5 text-[11px] text-stone-500">
            <i className="ri-file-shield-2-line" />
            CPF/CNPJ na nota: {formatCpfCnpjQR(cpfDigits)}
          </p>
        ) : null}
        <PainelCartao
          auth={auth}
          publicKey={publicKey}
          scope={scope}
          customerCpf={cpfDigits && cpfValido ? cpfDigits : undefined}
          onPago={aoCartaoPago}
          textoPago={textoPago}
        />
        {cartaoPago ? (
          <button
            type="button"
            onClick={voltarDoCartao}
            className="w-full py-2.5 bg-stone-100 hover:bg-stone-200 text-stone-700 text-xs font-bold rounded-xl cursor-pointer whitespace-nowrap"
          >
            Ver a conta
          </button>
        ) : null}
      </div>
    );
  }

  const mostrandoPix = pix !== null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50">
      <div className="bg-white w-full max-w-sm rounded-t-3xl sm:rounded-2xl max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-stone-100 flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 flex items-center justify-center bg-emerald-100 rounded-xl">
              <i className={(!mostrandoPix && pagandoCartao ? 'ri-bank-card-line' : 'ri-qr-code-line') + ' text-emerald-600 text-base'} />
            </div>
            <div>
              <h2 className="text-base font-bold text-stone-900">{mostrandoPix ? 'Pagar com Pix' : pagandoCartao ? 'Pagar com cartão' : 'Pagar a conta'}</h2>
              <p className="text-[10px] text-stone-400">{queueMode ? 'Senha ' + accessToken + ' · ' : (tableNumber != null ? 'Mesa ' + tableNumber + ' · ' : '')}{participantName}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg bg-stone-100 hover:bg-stone-200 text-stone-500 cursor-pointer transition-colors"
          >
            <i className="ri-close-line text-base" />
          </button>
        </div>

        {/* Conteúdo */}
        <div className="flex-1 overflow-y-auto px-4 py-4">
          {carregando ? (
            <div className="flex flex-col items-center py-12">
              <i className="ri-loader-4-line text-2xl text-[var(--cor-loja,#C2410C)] animate-spin" />
              <p className="text-xs text-stone-400 mt-3">Buscando sua conta...</p>
            </div>
          ) : mostrandoPix ? renderPix() : pagandoCartao ? renderCartao() : renderConta()}

          {erro ? (
            <div className="mt-3 flex items-start gap-2 px-3 py-2.5 bg-red-50 border border-red-100 rounded-xl">
              <i className="ri-error-warning-line text-red-500 text-sm mt-0.5" />
              <p className="text-[11px] text-red-600">{erro}</p>
            </div>
          ) : null}
        </div>

        {/* Footer: só na tela da conta, com algo a pagar */}
        {!carregando && !mostrandoPix && !pagandoCartao && enabled && !tudoPago && orders.length > 0 ? (
          <div className="border-t border-stone-100 bg-white px-5 py-4 flex-shrink-0 rounded-b-2xl">
            {/* CPF na nota (opcional) — vai para a NFC-e emitida quando o Pix confirmar */}
            <div className="mb-3">
              <label className="flex items-center justify-between text-[11px] font-semibold text-stone-600 mb-1">
                <span><i className="ri-file-shield-2-line text-stone-400 mr-1" />CPF/CNPJ na nota fiscal <span className="font-normal text-stone-400">(opcional)</span></span>
                {cpfDigits && cpfValido ? <span className="text-emerald-600 font-bold">vai na nota</span> : null}
              </label>
              <input
                inputMode="numeric"
                autoComplete="off"
                value={formatCpfCnpjQR(cpfDigits) || cpfNota}
                onChange={function (e) { setCpfNota(e.target.value.replace(/\D/g, '').slice(0, 14)); }}
                placeholder="000.000.000-00"
                className={'w-full text-sm border rounded-xl px-3 py-2.5 text-stone-800 focus:outline-none ' + (cpfDigits && !cpfValido ? 'border-red-300 focus:border-red-400' : 'border-stone-200 focus:border-emerald-400')}
              />
              {cpfDigits && !cpfValido ? <p className="text-[10px] text-red-500 mt-1">{cpfDigits.length < 11 ? 'Faltam dígitos' : 'Documento inválido'}</p> : null}
            </div>
            <button
              type="button"
              disabled={gerando || alvo.length === 0 || temTravado || (cpfDigits.length > 0 && !cpfValido)}
              onClick={gerarPix}
              className="w-full flex items-center justify-between bg-gradient-to-br from-emerald-500 to-emerald-600 disabled:from-stone-300 disabled:to-stone-300 text-white px-5 py-3.5 rounded-xl cursor-pointer disabled:cursor-not-allowed transition-colors shadow-sm"
            >
              <span className="flex items-center gap-2 text-sm font-bold">
                {gerando ? <i className="ri-loader-4-line animate-spin" /> : <i className="ri-qr-code-line" />}
                {gerando ? 'Gerando Pix…' : 'Pagar com Pix'}
              </span>
              <span className="text-sm font-black">{formatMoney(totalAlvo)}</span>
            </button>
            {cardEnabled ? (
              <button
                type="button"
                disabled={gerando || alvo.length === 0 || temTravado || (cpfDigits.length > 0 && !cpfValido)}
                onClick={abrirCartao}
                className="mt-2 w-full flex items-center justify-between gap-2 bg-[var(--cor-loja,#C2410C)] disabled:from-stone-300 disabled:to-stone-300 text-white px-4 py-3.5 rounded-xl cursor-pointer disabled:cursor-not-allowed transition-colors shadow-sm"
              >
                <span className="flex items-center gap-2 text-[13px] font-bold text-left leading-tight min-w-0">
                  <i className="ri-bank-card-line shrink-0" />
                  Pagar com cartão de crédito
                </span>
                <span className="text-sm font-black shrink-0">{formatMoney(totalAlvo)}</span>
              </button>
            ) : null}
            {temTravado ? (
              <p className="text-[10px] text-[var(--cor-loja,#C2410C)] text-center mt-2">Outra pessoa está pagando parte desses pedidos. Aguarde um instante.</p>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
