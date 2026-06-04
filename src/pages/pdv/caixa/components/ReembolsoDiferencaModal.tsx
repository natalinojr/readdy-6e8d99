import { useState } from 'react';
import { invokeWithAuth, supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import AutorizacaoGerenteModal from '@/components/feature/AutorizacaoGerenteModal';

const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

interface Props {
  orderId: string;
  orderNumber: string | number;
  valorReembolso: number;
  onConfirmado: () => void;
  onCancelar: () => void;
}

type Etapa = 'selecionar' | 'autorizar';
type FormaPagamento = 'cash' | 'pix';

export default function ReembolsoDiferencaModal({ orderId, orderNumber, valorReembolso, onConfirmado, onCancelar }: Props) {
  const { user } = useAuth();
  const [etapa, setEtapa] = useState<Etapa>('selecionar');
  const [forma, setForma] = useState<FormaPagamento | null>(null);
  const [pixKey, setPixKey] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const handleContinuar = () => {
    if (!forma) {
      setErro('Selecione a forma de reembolso.');
      return;
    }
    if (forma === 'pix' && !pixKey.trim()) {
      setErro('Informe a chave PIX do cliente.');
      return;
    }
    setErro(null);
    setEtapa('autorizar');
  };

  const handleAutorizado = async (autorizadoPor: string) => {
    if (!forma) return;
    setSalvando(true);
    setErro(null);

    try {
      const tenantId = user?.tenantId;

      // 1. Registrar broadcast order_saving
      if (tenantId) {
        supabase.channel(`order-updates-${tenantId}`).send({
          type: 'broadcast',
          event: 'order_saving',
          payload: { order_id: orderId },
        }).catch(() => {});
      }

      // 2. Registrar reembolso parcial
      const { error } = await invokeWithAuth('order-write', {
        body: {
          action: 'register_partial_refund',
          order_id: orderId,
          tenant_id: tenantId,
          refund_amount: Math.abs(valorReembolso),
          refund_method: forma,
          pix_key: forma === 'pix' ? pixKey.trim() : null,
          authorized_by: autorizadoPor,
          reason: 'Ajuste de quantidade após pagamento',
        },
      });

      if (error) throw new Error(error.message);

      // 3. Chamar onConfirmado → EditarItemCaixaModal salva a edição normalmente
      onConfirmado();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao registrar reembolso');
      setSalvando(false);
      setEtapa('selecionar');
    }
  };

  // Etapa de autorização do gerente
  if (etapa === 'autorizar') {
    return (
      <AutorizacaoGerenteModal
        titulo="Autorizar Reembolso"
        descricao={`Reembolso de ${fmt(Math.abs(valorReembolso))} — Pedido #${String(orderNumber).padStart(4, '0')}`}
        tenantId={user?.tenantId ?? ''}
        onAutorizado={handleAutorizado}
        onCancelar={() => setEtapa('selecionar')}
      />
    );
  }

  return (
    <div className="fixed inset-0 z-[55] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="bg-sky-50 border-b border-sky-100 px-5 py-4 flex items-center gap-3">
          <div className="w-10 h-10 flex items-center justify-center rounded-xl bg-sky-100 flex-shrink-0">
            <i className="ri-refund-2-line text-sky-600 text-xl" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-black text-sky-800 leading-none">Reembolso ao Cliente</h2>
            <p className="text-xs text-sky-600 mt-0.5 leading-snug">
              Pedido #{String(orderNumber).padStart(4, '0')} já estava pago
            </p>
          </div>
          <button
            onClick={onCancelar}
            className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-sky-100 text-sky-400 cursor-pointer transition-colors flex-shrink-0"
          >
            <i className="ri-close-line text-base" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {/* Valor a reembolsar */}
          <div className="flex items-center justify-between bg-sky-50 border border-sky-200 rounded-xl px-4 py-3">
            <span className="text-sm font-semibold text-sky-700">Valor a devolver ao cliente</span>
            <span className="text-xl font-black text-sky-700">{fmt(Math.abs(valorReembolso))}</span>
          </div>

          {/* Selecionar forma */}
          <div>
            <p className="text-[11px] font-bold text-zinc-500 uppercase tracking-wider mb-3">Forma de devolução</p>
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => { setForma('cash'); setErro(null); }}
                className={`flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all cursor-pointer ${
                  forma === 'cash'
                    ? 'border-sky-500 bg-sky-50'
                    : 'border-zinc-200 hover:border-zinc-300 bg-white'
                }`}
              >
                <div className={`w-10 h-10 flex items-center justify-center rounded-xl ${forma === 'cash' ? 'bg-sky-100' : 'bg-zinc-100'}`}>
                  <i className={`ri-money-dollar-circle-line text-xl ${forma === 'cash' ? 'text-sky-600' : 'text-zinc-500'}`} />
                </div>
                <span className={`text-xs font-bold ${forma === 'cash' ? 'text-sky-700' : 'text-zinc-600'}`}>Dinheiro</span>
              </button>

              <button
                onClick={() => { setForma('pix'); setErro(null); }}
                className={`flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all cursor-pointer ${
                  forma === 'pix'
                    ? 'border-sky-500 bg-sky-50'
                    : 'border-zinc-200 hover:border-zinc-300 bg-white'
                }`}
              >
                <div className={`w-10 h-10 flex items-center justify-center rounded-xl ${forma === 'pix' ? 'bg-sky-100' : 'bg-zinc-100'}`}>
                  <i className={`ri-qr-code-line text-xl ${forma === 'pix' ? 'text-sky-600' : 'text-zinc-500'}`} />
                </div>
                <span className={`text-xs font-bold ${forma === 'pix' ? 'text-sky-700' : 'text-zinc-600'}`}>PIX</span>
              </button>
            </div>
          </div>

          {/* Chave PIX */}
          {forma === 'pix' && (
            <div>
              <label className="block text-[11px] font-bold text-zinc-500 uppercase tracking-wider mb-1.5">
                Chave PIX do cliente
              </label>
              <input
                type="text"
                value={pixKey}
                onChange={(e) => { setPixKey(e.target.value); setErro(null); }}
                placeholder="CPF, celular, e-mail ou chave aleatória"
                className="w-full border border-zinc-200 rounded-xl px-3 py-2.5 text-sm text-zinc-800 focus:outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
              />
            </div>
          )}

          {/* Erro */}
          {erro && (
            <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-xl">
              <i className="ri-error-warning-line text-red-500 text-sm flex-shrink-0 mt-0.5" />
              <p className="text-xs text-red-700 font-medium">{erro}</p>
            </div>
          )}

          {/* Aviso gerente */}
          <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-xl">
            <i className="ri-shield-keyhole-line text-amber-500 text-sm flex-shrink-0 mt-0.5" />
            <p className="text-xs text-amber-700 font-medium leading-snug">
              Será necessário a autorização de um gerente para prosseguir.
            </p>
          </div>

          {/* Botões */}
          <div className="flex gap-2.5">
            <button
              onClick={onCancelar}
              disabled={salvando}
              className="flex-1 py-2.5 border border-zinc-200 text-zinc-600 text-sm font-semibold rounded-xl cursor-pointer hover:bg-zinc-50 transition-colors whitespace-nowrap disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              onClick={handleContinuar}
              disabled={salvando || !forma}
              className="flex-1 py-2.5 bg-sky-600 hover:bg-sky-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-bold rounded-xl cursor-pointer whitespace-nowrap transition-colors flex items-center justify-center gap-1.5"
            >
              {salvando ? (
                <><i className="ri-loader-4-line animate-spin text-sm" />Processando...</>
              ) : (
                <><i className="ri-arrow-right-line text-sm" />Continuar</>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}