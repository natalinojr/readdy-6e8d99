import { useState, useEffect, useRef, useCallback } from 'react';
import { invokeWithAuth } from '@/lib/supabase';
import { formatCurrency } from '@/lib/formatters';

// ── Cobrar cartão na maquininha, pelo caixa ─────────────────────────────────
// O valor sai do ERPOS e aparece na maquininha (Mercado Pago Point em modo PDV): o operador
// não digita nada, não erra crédito/débito e a venda já nasce com o número do pedido em
// external_reference — é isso que deixa a conciliação exata depois.
//
// Regra que não pode ser quebrada: SÓ o provedor diz que pagou. Aqui não existe botão de
// "confirmar na mão" — quem aprova é a maquininha (check_status pergunta ao Mercado Pago).
// Se o operador desistir, a cobrança é cancelada no provedor; se o Mercado Pago responder que
// já foi capturada no terminal, a cobrança continua valendo e o modal avisa.

const POLL_MS = 2000;

const MOTIVO: Record<string, string> = {
  cc_rejected_insufficient_amount: 'Cartão sem saldo/limite suficiente.',
  cc_rejected_bad_filled_security_code: 'Código de segurança incorreto.',
  cc_rejected_bad_filled_date: 'Data de validade incorreta.',
  cc_rejected_call_for_authorize: 'O banco pediu autorização. O cliente precisa liberar com o banco.',
  cc_rejected_card_disabled: 'Cartão bloqueado.',
  cc_rejected_high_risk: 'Recusado por segurança pelo banco.',
  cc_rejected_max_attempts: 'Muitas tentativas. Use outro cartão.',
  cc_rejected_other_reason: 'Recusado pelo banco do cliente.',
};

interface Props {
  tenantId: string;
  amount: number;
  method: 'credit_card' | 'debit_card';
  /** Pedido já existente (mesa/vínculo). Venda nova do carrinho ainda não tem id. */
  orderId?: string | null;
  orderNumber?: string | null;
  onAprovado: (info: { pixPaymentId: string; method: 'credit_card' | 'debit_card' }) => void;
  onCancelar: () => void;
}

type CreateResp = { pix_payment_id?: string; expires_at?: string; sandbox?: boolean; error?: string; code?: string; detail?: string };
type StatusResp = { status?: string; error?: string; method?: string; code?: string };

export default function CobrarMaquininhaModal({ tenantId, amount, method, orderId, orderNumber, onAprovado, onCancelar }: Props) {
  const [fase, setFase] = useState<'criando' | 'aguardando' | 'aprovado' | 'recusado' | 'encerrado' | 'erro'>('criando');
  const [chargeId, setChargeId] = useState<string | null>(null);
  const [sandbox, setSandbox] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [segundos, setSegundos] = useState(0);
  const [cancelando, setCancelando] = useState(false);
  const [metodoFinal, setMetodoFinal] = useState<'credit_card' | 'debit_card'>(method);
  // o callback de aprovado pode chegar de dentro do cancelamento: guarda a referência atual
  const onAprovadoRef = useRef(onAprovado);
  onAprovadoRef.current = onAprovado;
  // Enquanto viva, a cobrança fica no visor da maquininha. Se o modal sair do ar por fora
  // (tela fechada, troca de pedido), cancela mesmo assim — senão o valor continua lá.
  const vivaRef = useRef<string | null>(null);

  const criar = useCallback(async () => {
    setFase('criando');
    setMsg(null);
    setSegundos(0);
    const { data, error } = await invokeWithAuth<CreateResp>('pix-payment', {
      body: {
        action: 'create_card_charge', tenant_id: tenantId, amount, method,
        station: 'pdv', order_id: orderId ?? null, order_number: orderNumber ?? null,
      },
    });
    if (error || !data?.pix_payment_id) {
      setFase('erro');
      setMsg(data?.error || error?.message || 'Não foi possível enviar a cobrança para a maquininha.');
      return;
    }
    setChargeId(data.pix_payment_id);
    vivaRef.current = data.pix_payment_id;
    setSandbox(Boolean(data.sandbox));
    setFase('aguardando');
  }, [tenantId, amount, method, orderId, orderNumber]);

  useEffect(() => { criar(); }, [criar]);

  // Modal desmontado com cobrança viva: solta a maquininha em segundo plano.
  useEffect(() => () => {
    const id = vivaRef.current;
    if (!id) return;
    vivaRef.current = null;
    invokeWithAuth('pix-payment', { body: { action: 'cancel', pix_payment_id: id, tenant_id: tenantId } })
      .catch(() => { /* a cobrança expira sozinha em 15 min */ });
  }, [tenantId]);

  // Polling: o tablet fixo usa o mesmo padrão. O caixa fica com a tela aberta na frente do
  // operador, então não precisa de Realtime nem de recheck por visibilidade.
  useEffect(() => {
    if (fase !== 'aguardando' || !chargeId) return;
    let alive = true;
    const tick = async () => {
      const { data } = await invokeWithAuth<StatusResp>('pix-payment', {
        body: { action: 'check_status', pix_payment_id: chargeId, tenant_id: tenantId },
      });
      if (!alive) return;
      const st = data?.status;
      if (st === 'confirmed') {
        vivaRef.current = null;
        const m = data?.method === 'debit_card' ? 'debit_card' : data?.method === 'credit_card' ? 'credit_card' : method;
        setMetodoFinal(m);
        setFase('aprovado');
        setTimeout(() => onAprovadoRef.current({ pixPaymentId: chargeId, method: m }), 900);
      } else if (st === 'failed') {
        vivaRef.current = null;
        setFase('recusado');
        setMsg(MOTIVO[String(data?.error ?? '')] ?? (data?.error ? `Recusado pela maquininha (${data.error}).` : 'Recusado pela maquininha.'));
      } else if (st === 'expired' || st === 'cancelled') {
        vivaRef.current = null;
        setFase('encerrado');
        setMsg(st === 'expired' ? 'A cobrança expirou na maquininha.' : 'Cobrança cancelada.');
      }
    };
    const id = setInterval(tick, POLL_MS);
    const clock = setInterval(() => setSegundos((s) => s + 1), 1000);
    tick();
    return () => { alive = false; clearInterval(id); clearInterval(clock); };
  }, [fase, chargeId, tenantId, method]);

  const desistir = async () => {
    if (!chargeId) { onCancelar(); return; }
    setCancelando(true);
    const { data } = await invokeWithAuth<StatusResp>('pix-payment', {
      body: { action: 'cancel', pix_payment_id: chargeId, tenant_id: tenantId },
    });
    setCancelando(false);
    // O Mercado Pago recusa cancelar o que já foi capturado no terminal: nesse caso o
    // pagamento vale e não pode ser descartado.
    if (data?.code === 'at_terminal' || data?.status === 'pending') {
      setMsg('O cliente já passou o cartão na maquininha — aguarde a confirmação.');
      return;
    }
    if (data?.status === 'confirmed') { vivaRef.current = null; onAprovadoRef.current({ pixPaymentId: chargeId, method: metodoFinal }); return; }
    vivaRef.current = null;
    onCancelar();
  };

  const simular = async (outcome: 'approved_credit' | 'approved_debit' | 'declined') => {
    if (!chargeId) return;
    await invokeWithAuth('pix-payment', { body: { action: 'simulate_card', pix_payment_id: chargeId, tenant_id: tenantId, outcome } });
  };

  const rotulo = method === 'debit_card' ? 'débito' : 'crédito';

  return (
    <div className="fixed inset-0 z-[60] bg-black/60 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-md overflow-hidden">
        <div className="px-6 py-5 text-center border-b border-zinc-100">
          <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">Cartão de {rotulo}</p>
          <p className="text-3xl font-bold text-zinc-900 mt-1">{formatCurrency(amount)}</p>
          {orderNumber && <p className="text-xs text-zinc-400 mt-1">Pedido {orderNumber}</p>}
        </div>

        <div className="px-6 py-8 text-center">
          {fase === 'criando' && (
            <>
              <div className="w-12 h-12 mx-auto border-3 border-sky-500 border-t-transparent rounded-full animate-spin" />
              <p className="mt-4 text-sm text-zinc-600">Enviando para a maquininha…</p>
            </>
          )}

          {fase === 'aguardando' && (
            <>
              <div className="w-16 h-16 mx-auto flex items-center justify-center rounded-2xl bg-sky-100">
                <i className="ri-contactless-payment-line text-sky-600 text-3xl" />
              </div>
              <p className="mt-4 text-base font-bold text-zinc-900">Peça para o cliente passar o cartão</p>
              <p className="mt-1 text-sm text-zinc-500">O valor já está na maquininha. Não digite nada nela.</p>
              <p className="mt-3 text-xs text-zinc-400">Aguardando há {segundos}s · a cobrança expira em 15 min</p>
              {sandbox && (
                <div className="mt-5 pt-4 border-t border-dashed border-zinc-200">
                  <p className="text-[11px] font-semibold text-amber-700 mb-2">Modo teste (maquininha virtual)</p>
                  <div className="flex gap-2 justify-center flex-wrap">
                    <button onClick={() => simular('approved_credit')} className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-green-100 text-green-700 hover:bg-green-200 cursor-pointer">Aprovar crédito</button>
                    <button onClick={() => simular('approved_debit')} className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-green-100 text-green-700 hover:bg-green-200 cursor-pointer">Aprovar débito</button>
                    <button onClick={() => simular('declined')} className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-red-100 text-red-700 hover:bg-red-200 cursor-pointer">Recusar</button>
                  </div>
                </div>
              )}
            </>
          )}

          {fase === 'aprovado' && (
            <>
              <div className="w-16 h-16 mx-auto flex items-center justify-center rounded-2xl bg-green-100">
                <i className="ri-checkbox-circle-fill text-green-600 text-3xl" />
              </div>
              <p className="mt-4 text-base font-bold text-green-700">Pagamento aprovado</p>
              <p className="mt-1 text-sm text-zinc-500">
                {metodoFinal === 'debit_card' ? 'Débito' : 'Crédito'} · lançando no caixa…
              </p>
            </>
          )}

          {(fase === 'recusado' || fase === 'encerrado' || fase === 'erro') && (
            <>
              <div className={`w-16 h-16 mx-auto flex items-center justify-center rounded-2xl ${fase === 'recusado' ? 'bg-red-100' : 'bg-zinc-100'}`}>
                <i className={`${fase === 'recusado' ? 'ri-close-circle-fill text-red-600' : 'ri-time-line text-zinc-500'} text-3xl`} />
              </div>
              <p className="mt-4 text-base font-bold text-zinc-900">
                {fase === 'recusado' ? 'Cartão recusado' : fase === 'erro' ? 'Não deu para cobrar' : 'Cobrança encerrada'}
              </p>
              {msg && <p className="mt-1 text-sm text-zinc-600">{msg}</p>}
            </>
          )}

          {fase === 'aguardando' && msg && <p className="mt-3 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">{msg}</p>}
        </div>

        <div className="px-6 py-4 border-t border-zinc-100 flex items-center gap-3">
          {(fase === 'recusado' || fase === 'encerrado' || fase === 'erro') ? (
            <>
              <button onClick={onCancelar} className="flex-1 py-2.5 text-sm font-semibold text-zinc-600 rounded-lg hover:bg-zinc-100 cursor-pointer whitespace-nowrap">
                Escolher outra forma
              </button>
              <button onClick={criar} className="flex-1 py-2.5 text-sm font-semibold text-white bg-sky-600 rounded-lg hover:bg-sky-700 cursor-pointer whitespace-nowrap">
                Tentar de novo
              </button>
            </>
          ) : fase === 'aprovado' ? (
            <div className="flex-1 text-center text-xs text-zinc-400">Aguarde…</div>
          ) : (
            <button onClick={desistir} disabled={cancelando}
              className="flex-1 py-2.5 text-sm font-semibold text-zinc-600 rounded-lg hover:bg-zinc-100 cursor-pointer whitespace-nowrap disabled:opacity-50">
              {cancelando ? 'Cancelando na maquininha…' : 'Cancelar cobrança'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
