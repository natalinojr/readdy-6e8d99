import { useState, useEffect } from 'react';
import { usePaymentMethods } from '@/hooks/usePaymentMethods';
import { invokeWithAuth } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { useKDS } from '@/contexts/KDSContext';

const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

interface Props {
  orderId: string;
  numeroDisplay: number;
  total: number;
  destinoDisplay: string;
  onClose: () => void;
  onSuccess: (orderId: string, paymentMethodId: string) => void;
}

export default function PagamentoRapidoModal({ orderId, numeroDisplay, total, destinoDisplay, onClose, onSuccess }: Props) {
  const { formasAtivas, loading: loadingFormas } = usePaymentMethods();
  const { user } = useAuth();
  const { success: toastSuccess, error: toastError } = useToast();
  const { setPedidos } = useKDS();

  const [formaId, setFormaId] = useState('');
  const [valorInput, setValorInput] = useState('');
  const [pagamentos, setPagamentos] = useState<{ formaId: string; formaNome: string; valor: number; troco?: number }[]>([]);
  const [confirmando, setConfirmando] = useState(false);
  const [sucesso, setSucesso] = useState(false);

  // Seleciona a primeira forma ao carregar
  useEffect(() => {
    if (formasAtivas.length > 0 && !formaId) {
      setFormaId(formasAtivas[0].id);
    }
  }, [formasAtivas, formaId]);

  const totalPago = pagamentos.reduce((acc, p) => acc + p.valor, 0);
  const restante = Math.max(0, total - totalPago);
  const troco = totalPago > total ? totalPago - total : 0;

  const handleAddPagamento = () => {
    const v = parseFloat(valorInput.replace(',', '.'));
    if (isNaN(v) || v <= 0) return;
    const forma = formasAtivas.find((f) => f.id === formaId);
    if (!forma) return;
    const valorReal = Math.min(v, restante + (forma.exigeTroco && v > restante ? v - restante : 0));
    const trocoCalc = forma.exigeTroco && v > restante ? v - restante : undefined;
    setPagamentos((prev) => [
      ...prev,
      { formaId: forma.id, formaNome: forma.nome, valor: valorReal, troco: trocoCalc },
    ]);
    setValorInput('');
  };

  const handleFinalizar = async () => {
    // Auto-adicionar pagamento se o valor está preenchido mas não foi clicado no '+'
    let pagamentosFinais = pagamentos;
    if (pagamentos.length === 0 && formaId) {
      const v = parseFloat(valorInput.replace(',', '.'));
      const forma = formasAtivas.find((f) => f.id === formaId);
      if (forma && !isNaN(v) && v >= total) {
        const trocoCalc = forma.exigeTroco && v > total ? v - total : undefined;
        pagamentosFinais = [{ formaId: forma.id, formaNome: forma.nome, valor: total, troco: trocoCalc }];
        setPagamentos(pagamentosFinais);
      } else if (forma && restante <= 0.01) {
        pagamentosFinais = [{ formaId: forma.id, formaNome: forma.nome, valor: total }];
        setPagamentos(pagamentosFinais);
      }
    }

    if (pagamentosFinais.length === 0) return;

    const restanteCheck = total - pagamentosFinais.reduce((acc, p) => acc + p.valor, 0);
    if (restanteCheck > 0.01) return;

    setConfirmando(true);
    try {
      const primaryPayment = pagamentosFinais[0];
      if (!primaryPayment) return;

      const trocoFinal = pagamentosFinais.reduce((acc, p) => acc + (p.troco ?? 0), 0)
        || (pagamentosFinais.reduce((acc, p) => acc + p.valor, 0) > total
          ? pagamentosFinais.reduce((acc, p) => acc + p.valor, 0) - total
          : 0);

      await invokeWithAuth('order-write', {
        body: {
          action: 'record_payment',
          order_id: orderId,
          tenant_id: user?.tenantId,
          payment_method_id: primaryPayment.formaId,
          amount: total,
          change_amount: trocoFinal > 0 ? trocoFinal : 0,
          operator_name: user?.nome ?? null,
          paid_by_pdv: 'waiter',
        },
      });

      // Atualiza o estado local do KDS para refletir isPaid = true
      setPedidos((prev) =>
        prev.map((p) =>
          p.id === orderId ? { ...p, isPaid: true } : p
        )
      );

      toastSuccess('Pagamento registrado!', `#${String(numeroDisplay).padStart(4, '0')} · ${fmt(total)}`);
      setSucesso(true);
      onSuccess(orderId, primaryPayment.formaId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toastError('Erro ao registrar pagamento', msg);
    } finally {
      setConfirmando(false);
    }
  };

  const ICON_MAP: Record<string, string> = {
    dinheiro: 'ri-money-dollar-circle-line',
    credito:  'ri-bank-card-line',
    debito:   'ri-bank-card-2-line',
    pix:      'ri-qr-code-line',
    vale:     'ri-coupon-line',
  };

  if (sucesso) {
    return (
      <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl w-full max-w-sm p-8 flex flex-col items-center text-center">
          <div className="w-16 h-16 flex items-center justify-center bg-emerald-100 rounded-full mb-4">
            <i className="ri-check-double-line text-3xl text-emerald-500" />
          </div>
          <h2 className="text-xl font-bold text-zinc-900 mb-1">Pagamento Registrado!</h2>
          <p className="text-zinc-500 text-sm mb-1">#{String(numeroDisplay).padStart(4, '0')} · {destinoDisplay}</p>
          <p className="text-2xl font-black text-emerald-600 mt-2">{fmt(total)}</p>
          {troco > 0 && (
            <div className="mt-4 w-full bg-emerald-50 border border-emerald-200 rounded-xl p-3">
              <p className="text-emerald-700 font-bold text-lg">{fmt(troco)}</p>
              <p className="text-emerald-600 text-xs">Troco para o cliente</p>
            </div>
          )}
          <button
            onClick={onClose}
            className="mt-6 w-full py-3 bg-zinc-900 hover:bg-black text-white font-bold rounded-xl cursor-pointer whitespace-nowrap transition-colors"
          >
            Fechar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-100 bg-zinc-50 flex-shrink-0">
          <div>
            <p className="font-bold text-zinc-900">Registrar Pagamento</p>
            <p className="text-xs text-zinc-500 mt-0.5">
              #{String(numeroDisplay).padStart(4, '0')} · {destinoDisplay}
            </p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-zinc-200 cursor-pointer text-zinc-400 transition-colors">
            <i className="ri-close-line text-lg" />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 p-5 space-y-5">
          {/* Total */}
          <div className="flex items-center justify-between bg-zinc-50 rounded-xl px-4 py-3 border border-zinc-200">
            <span className="text-sm font-semibold text-zinc-600">Total do pedido</span>
            <span className="text-xl font-black text-zinc-900">{fmt(total)}</span>
          </div>

          {/* Formas de pagamento */}
          {loadingFormas ? (
            <div className="flex items-center justify-center py-6">
              <i className="ri-loader-4-line animate-spin text-zinc-400 text-xl" />
            </div>
          ) : (
            <div>
              <p className="text-xs font-bold text-zinc-400 uppercase tracking-wider mb-3">Forma de Pagamento</p>
              <div className="grid grid-cols-4 gap-2 mb-4">
                {formasAtivas.map((forma) => (
                  <button
                    key={forma.id}
                    onClick={() => setFormaId(forma.id)}
                    className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border-2 transition-all cursor-pointer ${
                      formaId === forma.id
                        ? 'border-amber-500 bg-amber-50'
                        : 'border-zinc-200 hover:border-zinc-300 bg-white'
                    }`}
                  >
                    <div className={`w-8 h-8 flex items-center justify-center rounded-lg ${formaId === forma.id ? 'bg-amber-100' : 'bg-zinc-100'}`}>
                      <i className={`${ICON_MAP[forma.tipo] ?? 'ri-wallet-line'} text-base ${formaId === forma.id ? 'text-amber-600' : 'text-zinc-500'}`} />
                    </div>
                    <span className={`text-[9px] font-bold text-center leading-tight ${formaId === forma.id ? 'text-amber-700' : 'text-zinc-500'}`}>
                      {forma.nome}
                    </span>
                  </button>
                ))}
              </div>

              {/* Valor */}
              <div className="flex gap-2">
                <div className="flex-1 relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 text-sm font-medium pointer-events-none">R$</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={valorInput}
                    onChange={(e) => setValorInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleAddPagamento()}
                    placeholder={restante.toFixed(2).replace('.', ',')}
                    className="w-full pl-10 pr-4 py-2.5 border border-zinc-200 rounded-lg text-sm focus:outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-200"
                  />
                </div>
                <button
                  onClick={() => setValorInput(restante.toFixed(2))}
                  className="px-3 py-2.5 border border-zinc-200 rounded-lg text-xs font-semibold text-zinc-600 hover:bg-zinc-50 cursor-pointer whitespace-nowrap transition-colors"
                >
                  Exato
                </button>
                <button
                  onClick={handleAddPagamento}
                  disabled={!valorInput || restante <= 0}
                  className="px-4 py-2.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-bold rounded-lg cursor-pointer whitespace-nowrap transition-colors"
                >
                  <i className="ri-add-line" />
                </button>
              </div>
            </div>
          )}

          {/* Pagamentos adicionados */}
          {pagamentos.length > 0 && (
            <div>
              <p className="text-xs font-bold text-zinc-400 uppercase tracking-wider mb-2">Pagamentos</p>
              <div className="space-y-2">
                {pagamentos.map((p, idx) => (
                  <div key={idx} className="flex items-center justify-between bg-zinc-50 rounded-lg px-3 py-2 border border-zinc-100">
                    <span className="text-sm text-zinc-700 font-medium">{p.formaNome}</span>
                    <div className="flex items-center gap-2.5">
                      <span className="text-sm font-black text-zinc-900">{fmt(p.valor)}</span>
                      {p.troco && p.troco > 0 && (
                        <span className="text-[10px] text-emerald-600 font-semibold">troco {fmt(p.troco)}</span>
                      )}
                      <button
                        onClick={() => setPagamentos((prev) => prev.filter((_, i) => i !== idx))}
                        className="w-5 h-5 flex items-center justify-center text-zinc-300 hover:text-red-400 cursor-pointer transition-colors"
                      >
                        <i className="ri-close-line text-sm" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Restante / Troco */}
          {restante > 0.01 && (
            <div className="flex items-center justify-between bg-red-50 border border-red-200 rounded-xl px-4 py-3">
              <span className="text-sm font-semibold text-red-600">Restante</span>
              <span className="text-lg font-black text-red-600">{fmt(restante)}</span>
            </div>
          )}
          {restante <= 0.01 && troco > 0 && (
            <div className="flex items-center justify-between bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3">
              <span className="text-sm font-semibold text-emerald-600">Troco</span>
              <span className="text-lg font-black text-emerald-600">{fmt(troco)}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-zinc-100 flex-shrink-0">
          <button
            onClick={handleFinalizar}
            disabled={confirmando || (
              pagamentos.length === 0
                ? (() => {
                    const v = parseFloat(valorInput.replace(',', '.'));
                    return !formaId || isNaN(v) || v < total;
                  })()
                : restante > 0.01
            )}
            className="w-full py-3.5 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold rounded-xl transition-colors cursor-pointer whitespace-nowrap flex items-center justify-center gap-2 text-sm"
          >
            {confirmando ? (
              <>
                <i className="ri-loader-4-line animate-spin" />
                Registrando...
              </>
            ) : (
              <>
                <i className="ri-check-double-line" />
                Confirmar Pagamento · {fmt(total)}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
