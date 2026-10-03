import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { initMercadoPago, CardPayment } from '@mercadopago/sdk-react';
import { supabase } from '@/lib/supabase';

// ── Painel de cobrança no CARTÃO DE CRÉDITO (Mercado Pago) reutilizável ──────
// Irmão do PixCobrancaPanel: o cliente paga no próprio celular, sem passar pelo caixa
// (delivery e QR). O formulário é o Card Payment Brick do Mercado Pago — os dados do
// cartão ficam no MP; daqui só sai um token de uso único para a Edge `online-payments`
// (`create_card`), que cobra pela API de Orders. Só crédito e só à vista (decisão do dono,
// 2026-10-03) — o servidor recusa o resto de qualquer jeito.
//
// Resultado da cobrança: aprovado na hora · recusado (motivo traduzido, tenta outro cartão)
// · desafio do banco (3DS, abre dentro da página num iframe; o status final vem do servidor
// por Realtime + polling, nunca do iframe). Nada aqui marca pago: só a Edge, quando o MP aprova.

function formatMoney(v: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);
}

interface Cobranca {
  id: string;
  status: 'pending' | 'confirmed' | 'expired' | 'cancelled' | 'failed';
  amount: number;
  ticket_url: string | null;
  card_brand: string | null;
  card_last4: string | null;
  reject_message: string | null;
}

interface BillResumo {
  enabled: boolean;
  card_enabled?: boolean;
  participant?: { id: string } | null;
  orders: { id: string; remaining: number; total_amount: number; locked?: boolean; participant_id?: string | null }[];
  pending_card: Cobranca | null;
  payments_history?: { amount: number }[];
  mode?: 'table' | 'queue' | 'delivery';
}

interface Props {
  /** Identidade do cliente para a Edge: {participant_id, access_token} ou {order_id, order_token} */
  auth: Record<string, unknown>;
  /** Public Key da loja (vem de online-payments › public_status / get_bill) */
  publicKey: string;
  /** Mesa numerada: 'mine' (meus pedidos) ou 'all' (mesa inteira). Delivery/senha: sempre 'mine'. */
  scope?: 'mine' | 'all';
  /** CPF/CNPJ na nota (opcional) — vai junto, igual ao Pix */
  customerCpf?: string;
  /** Chamado uma vez quando o pagamento é confirmado (ou já estava pago ao abrir) */
  onPago?: () => void;
  /** Linha abaixo de "Pagamento aprovado" (ex.: "Seu pedido foi para a cozinha") */
  textoPago?: string;
}

function functionsUrl() {
  return (import.meta.env.VITE_PUBLIC_SUPABASE_URL as string || '').replace(/\/$/, '') + '/functions/v1/online-payments';
}

async function call<T>(body: Record<string, unknown>): Promise<T & { error?: string; message?: string }> {
  const res = await fetch(functionsUrl(), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return res.json();
}

// O SDK guarda uma instância global: inicializa uma vez por chave.
let mpIniciadoCom: string | null = null;
function garantirMercadoPago(publicKey: string) {
  if (mpIniciadoCom === publicKey) return;
  initMercadoPago(publicKey, { locale: 'pt-BR' });
  mpIniciadoCom = publicKey;
}

// O CardPayment do SDK recria o formulário (apagando o que o cliente digitou) sempre que
// initialization/customization/callbacks mudam de REFERÊNCIA — por isso ficam fixos aqui.
const CUSTOMIZACAO_CARTAO = {
  paymentMethods: { minInstallments: 1, maxInstallments: 1, types: { included: ['credit_card' as const] } },
  visual: { hideFormTitle: true, style: { theme: 'default' } },
};
function erroDoBrick(e: unknown) { console.warn('[CartaoCobrancaPanel] brick', e); }

type Fase = 'carregando' | 'form' | 'desafio' | 'processando' | 'recusado' | 'pago' | 'indisponivel' | 'erro';

export default function CartaoCobrancaPanel(props: Props) {
  const { auth, publicKey, scope = 'mine', customerCpf, onPago, textoPago } = props;
  const authKey = JSON.stringify(auth);

  const [fase, setFase] = useState<Fase>('carregando');
  const [valor, setValor] = useState(0);
  const [cobranca, setCobranca] = useState<Cobranca | null>(null);
  const [mensagem, setMensagem] = useState('');
  const [formKey, setFormKey] = useState(0);
  const [verificando, setVerificando] = useState(false);
  // "Tentar de novo" na tela de erro: refaz a leitura da conta
  const [tentativa, setTentativa] = useState(0);

  const onPagoRef = useRef(onPago);
  onPagoRef.current = onPago;
  const avisouRef = useRef(false);

  function marcarPago(c: Cobranca | null, v: number) {
    setCobranca(c);
    setValor(v);
    setFase('pago');
    if (!avisouRef.current) { avisouRef.current = true; onPagoRef.current?.(); }
  }

  // Aplica o estado de uma cobrança vinda do servidor.
  const aplicar = useCallback(function (c: Cobranca, challengeUrl?: string | null) {
    setCobranca(c);
    if (c.status === 'confirmed') { marcarPago(c, c.amount); return; }
    if (c.status === 'failed') { setMensagem(c.reject_message || 'O pagamento não foi aprovado.'); setFase('recusado'); return; }
    if (c.status === 'expired') { setMensagem('A confirmação do banco não foi concluída a tempo. Se o valor aparecer no seu cartão, não pague de novo: a loja recebe a confirmação sozinha.'); setFase('recusado'); return; }
    if (c.status === 'cancelled') { setFase('form'); setFormKey((k) => k + 1); return; }
    const url = challengeUrl || c.ticket_url;
    setFase(url ? 'desafio' : 'processando');
  }, []);

  // Estado inicial: pago? desafio do banco em andamento? senão, formulário.
  useEffect(function () {
    let cancelled = false;
    (async function () {
      try {
        const bill = await call<BillResumo>({ action: 'get_bill', ...auth });
        if (cancelled) return;
        if (bill.error) { setMensagem(bill.message || bill.error); setFase('erro'); return; }
        if (!bill.enabled || !bill.card_enabled) { setFase('indisponivel'); return; }
        // Inicializa já: qualquer caminho abaixo pode acabar no formulário (ex.: cobrança anterior cancelada).
        garantirMercadoPago(publicKey);
        const orders = bill.orders || [];
        const restanteTotal = orders.reduce(function (s, o) { return s + o.remaining; }, 0);
        if (orders.length > 0 && restanteTotal <= 0) {
          const pago = (bill.payments_history || []).reduce(function (s, p) { return s + p.amount; }, 0)
            || orders.reduce(function (s, o) { return s + o.total_amount; }, 0);
          marcarPago(null, pago);
          return;
        }
        // Valor mostrado no formulário (o servidor recalcula na cobrança de qualquer jeito).
        const meu = bill.mode !== 'table' || scope === 'all'
          ? orders
          : orders.filter(function (o) { return !bill.participant || o.participant_id === bill.participant.id; });
        const aPagar = Math.round(meu.filter(function (o) { return !o.locked; }).reduce(function (s, o) { return s + o.remaining; }, 0) * 100) / 100;
        setValor(aPagar);
        if (bill.pending_card) { aplicar(bill.pending_card); return; }
        // Tudo travado por outra cobrança em andamento: o formulário com R$ 0,00 nunca carrega
        if (aPagar < 0.01) {
          setMensagem('Já tem um pagamento desta conta em andamento. Espere um instante e toque em "Tentar de novo".');
          setFase('erro');
          return;
        }
        garantirMercadoPago(publicKey);
        setFase('form');
      } catch {
        if (!cancelled) { setMensagem('Erro de conexão. Tente novamente.'); setFase('erro'); }
      }
    })();
    return function () { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authKey, scope, publicKey, tentativa]);

  // Acompanha a cobrança pendente (desafio do banco ou processamento): Realtime + polling
  // que reconcilia no MP + volta para a aba. O iframe só avisa "terminei" — quem decide é o MP.
  useEffect(function () {
    if (!cobranca || cobranca.status !== 'pending') return;
    const id = cobranca.id;
    let cancelled = false;

    async function checar(reconcile: boolean) {
      if (cancelled) return;
      try {
        const data = await call<{ pix: Cobranca }>({ action: 'get_pix_status', pix_payment_id: id, reconcile, ...auth });
        if (cancelled || !data.pix) return;
        if (data.pix.status !== 'pending') aplicar(data.pix);
      } catch { /* próximo ciclo */ }
    }

    const channel = supabase.channel('pix-payment:' + id)
      .on('broadcast', { event: 'pix_change' }, function () { checar(false); })
      .subscribe();
    const poll = setInterval(function () { checar(true); }, 5000);
    function aoVoltar() { if (document.visibilityState === 'visible') checar(true); }
    function aoMensagem(e: MessageEvent) {
      const st = (e.data && typeof e.data === 'object') ? (e.data as { status?: string }).status : undefined;
      if (st === 'COMPLETE') { setFase('processando'); checar(true); }
    }
    document.addEventListener('visibilitychange', aoVoltar);
    window.addEventListener('focus', aoVoltar);
    window.addEventListener('message', aoMensagem);

    return function () {
      cancelled = true;
      clearInterval(poll);
      document.removeEventListener('visibilitychange', aoVoltar);
      window.removeEventListener('focus', aoVoltar);
      window.removeEventListener('message', aoMensagem);
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cobranca?.id, cobranca?.status, authKey]);

  async function enviarCartao(formData: { token: string; payment_method_id: string; payer?: { email?: string; identification?: { type?: string; number?: string } } }, extra?: { lastFourDigits?: string; paymentTypeId?: string }) {
    setMensagem('');
    try {
      const deviceId = (window as unknown as { MP_DEVICE_SESSION_ID?: string }).MP_DEVICE_SESSION_ID;
      const data = await call<{ pix: Cobranca; challenge_url?: string | null }>({
        action: 'create_card', ...auth, scope,
        card_token: formData.token,
        payment_method_id: formData.payment_method_id,
        payment_type: extra?.paymentTypeId || 'credit_card',
        card_last4: extra?.lastFourDigits || null,
        payer: formData.payer || {},
        device_id: deviceId || null,
        ...(customerCpf ? { customer_cpf: customerCpf } : {}),
      });
      if (data.error === 'nothing_to_pay') {
        const bill = await call<BillResumo>({ action: 'get_bill', ...auth });
        const orders = bill.orders || [];
        if (orders.length > 0 && orders.reduce(function (s, o) { return s + o.remaining; }, 0) <= 0) { marcarPago(null, valor); return; }
        setMensagem('Não encontramos o valor a pagar. Tente de novo ou fale com a loja.');
        setFase('recusado');
        return;
      }
      if (data.error === 'card_in_progress') {
        // Já existe uma cobrança no cartão em andamento (duplo toque, outra aba): retoma ela.
        const bill = await call<BillResumo>({ action: 'get_bill', ...auth });
        if (bill.pending_card) { aplicar(bill.pending_card); return; }
      }
      if (data.error || !data.pix) {
        setMensagem(data.message || 'Não foi possível processar o cartão agora. Tente de novo ou pague com Pix.');
        setFase('recusado');
        return;
      }
      aplicar(data.pix, data.challenge_url);
    } catch {
      setMensagem('Erro de conexão. Se o valor aparecer no seu cartão, não pague de novo: aguarde a confirmação.');
      setFase('recusado');
    }
  }

  async function verificarAgora() {
    if (!cobranca || verificando) return;
    setVerificando(true);
    try {
      const data = await call<{ pix: Cobranca }>({ action: 'get_pix_status', pix_payment_id: cobranca.id, reconcile: true, ...auth });
      if (data.pix) aplicar(data.pix);
    } catch { /* mantém a tela */ }
    finally { setVerificando(false); }
  }

  // Desistir do desafio do banco / tentar outro cartão.
  async function outroCartao() {
    if (cobranca && cobranca.status === 'pending') {
      try {
        const r = await call<{ status?: string }>({ action: 'cancel_pix', pix_payment_id: cobranca.id, ...auth });
        // O banco pode ter aprovado no mesmo instante: o servidor confere e lança.
        if (r.status === 'confirmed') { marcarPago(cobranca, cobranca.amount); return; }
      } catch { /* segue para o formulário */ }
    }
    setCobranca(null);
    setMensagem('');
    garantirMercadoPago(publicKey);
    setFormKey((k) => k + 1);
    setFase('form');
  }

  // Referências estáveis para o formulário do MP (ver CUSTOMIZACAO_CARTAO).
  const enviarRef = useRef(enviarCartao);
  enviarRef.current = enviarCartao;
  const onSubmitCartao = useCallback(function (formData: Parameters<typeof enviarCartao>[0], extra?: Parameters<typeof enviarCartao>[1]) {
    return enviarRef.current(formData, extra);
  }, []);
  const inicializacao = useMemo(function () { return { amount: valor }; }, [valor]);

  // ── Render ────────────────────────────────────────────────────────────────
  if (fase === 'indisponivel') return null;

  if (fase === 'carregando') {
    return (
      <div className="flex items-center justify-center gap-2 py-6 text-xs text-zinc-400">
        <i className="ri-loader-4-line animate-spin text-amber-500" />
        Preparando o pagamento com cartão…
      </div>
    );
  }

  if (fase === 'pago') {
    const final = cobranca?.card_last4 ? ` · cartão final ${cobranca.card_last4}` : '';
    return (
      <div className="flex items-center gap-3 px-4 py-3 bg-emerald-50 border border-emerald-200 rounded-2xl">
        <div className="w-10 h-10 flex items-center justify-center bg-emerald-100 rounded-full shrink-0">
          <i className="ri-checkbox-circle-fill text-emerald-500 text-xl" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-black text-emerald-800">Pagamento aprovado</p>
          <p className="text-[11px] text-emerald-600">{valor > 0 ? formatMoney(valor) + final + ' · ' : ''}{textoPago || 'Obrigado!'}</p>
        </div>
      </div>
    );
  }

  if (fase === 'erro') {
    return (
      <div className="px-4 py-3 bg-red-50 border border-red-100 rounded-2xl">
        <div className="flex items-start gap-2">
          <i className="ri-error-warning-line text-red-500 text-sm mt-0.5" />
          <p className="text-[11px] text-red-600 flex-1">{mensagem || 'Não foi possível preparar o pagamento.'}</p>
        </div>
        <button type="button" onClick={function () { setMensagem(''); setFase('carregando'); setTentativa(function (t) { return t + 1; }); }}
          className="mt-2 w-full py-2.5 bg-white border border-red-200 hover:bg-red-50 text-red-700 text-xs font-bold rounded-xl cursor-pointer whitespace-nowrap">
          Tentar de novo
        </button>
      </div>
    );
  }

  if (fase === 'recusado') {
    return (
      <div className="px-4 py-4 bg-red-50 border border-red-100 rounded-2xl text-center">
        <i className="ri-bank-card-line text-red-400 text-2xl" />
        <p className="text-sm font-bold text-red-700 mt-1">Pagamento não aprovado</p>
        <p className="text-xs text-red-600 mt-1">{mensagem}</p>
        <button type="button" onClick={outroCartao}
          className="mt-3 px-5 py-2.5 bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold rounded-xl cursor-pointer whitespace-nowrap">
          Tentar de novo
        </button>
      </div>
    );
  }

  if (fase === 'desafio' || fase === 'processando') {
    const url = cobranca?.ticket_url;
    return (
      <div className="px-3 py-3 bg-white border border-amber-200 rounded-2xl">
        <p className="text-[10px] uppercase tracking-wider font-bold text-amber-600 text-center">Confirmação do seu banco</p>
        <p className="text-[11px] text-zinc-500 text-center mt-0.5">{formatMoney(cobranca?.amount ?? valor)} no cartão de crédito</p>
        {fase === 'desafio' && url ? (
          <iframe src={url} title="Confirmação do banco" className="w-full mt-2 rounded-xl border border-zinc-200 bg-white" style={{ height: 520 }} />
        ) : (
          <div className="flex items-center justify-center gap-2 py-6 text-[11px] text-zinc-500">
            <i className="ri-loader-4-line animate-spin text-amber-500" />
            Aguardando a resposta do banco…
          </div>
        )}
        <div className="flex gap-2 mt-2">
          <button type="button" onClick={verificarAgora} disabled={verificando}
            className="flex-1 flex items-center justify-center gap-1.5 py-2.5 bg-zinc-100 hover:bg-zinc-200 disabled:opacity-50 text-zinc-700 text-xs font-bold rounded-xl cursor-pointer whitespace-nowrap">
            <i className={verificando ? 'ri-loader-4-line animate-spin' : 'ri-refresh-line'} />
            {verificando ? 'Verificando…' : 'Já confirmei'}
          </button>
          <button type="button" onClick={outroCartao}
            className="flex-1 py-2.5 bg-white border border-zinc-200 hover:bg-zinc-50 text-zinc-600 text-xs font-bold rounded-xl cursor-pointer whitespace-nowrap">
            Usar outro cartão
          </button>
        </div>
      </div>
    );
  }

  // Formulário do cartão (Card Payment Brick)
  return (
    <div className="bg-white border border-amber-200 rounded-2xl px-2 py-3">
      <p className="text-[10px] uppercase tracking-wider font-bold text-amber-600 text-center">Pague com cartão de crédito</p>
      <p className="text-3xl font-black text-zinc-900 text-center mt-0.5">{formatMoney(valor)}</p>
      <p className="text-[11px] text-zinc-400 text-center mt-0.5">À vista · os dados do cartão ficam com o Mercado Pago</p>
      <div className="mt-2">
        <CardPayment
          key={formKey}
          locale="pt-BR"
          initialization={inicializacao}
          customization={CUSTOMIZACAO_CARTAO}
          onSubmit={onSubmitCartao}
          onError={erroDoBrick}
        />
      </div>
    </div>
  );
}
