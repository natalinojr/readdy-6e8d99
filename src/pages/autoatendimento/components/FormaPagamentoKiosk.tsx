import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useKioskAuth } from '@/contexts/KioskAuthContext';

interface PaymentMethod {
  id: string;
  name: string;
  type: string;
}

interface FormaPagamentoKioskProps {
  total: number;
  onContinuar: (paymentMethodId: string, paymentMethodName: string) => void;
  onVoltar: () => void;
}

const fmt = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

const TYPE_ICON: Record<string, string> = {
  pix: 'ri-qr-code-line',
  cash: 'ri-money-dollar-circle-line',
  credit_card: 'ri-bank-card-line',
  debit_card: 'ri-bank-card-2-line',
};

const TYPE_LABEL: Record<string, string> = {
  pix: 'Aprovação instantânea',
  cash: 'Pague em dinheiro na entrega',
  credit_card: 'Cartão de crédito na entrega',
  debit_card: 'Cartão de débito na entrega',
};

export default function FormaPagamentoKiosk({ total, onContinuar, onVoltar }: FormaPagamentoKioskProps) {
  const { user } = useAuth();
  const { kioskSession } = useKioskAuth();
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [selected, setSelected] = useState<PaymentMethod | null>(null);

  const tenantId = kioskSession?.tenantId ?? user?.tenantId;

  useEffect(() => {
    if (!tenantId) return;
    supabase
      .from('payment_methods')
      .select('id, name, type')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .then(({ data }) => {
        if (data && data.length > 0) {
          setMethods(data as PaymentMethod[]);
        } else {
          setMethods([
            { id: 'pix', name: 'PIX', type: 'pix' },
            { id: 'credito', name: 'Cartão de Crédito', type: 'credit_card' },
            { id: 'debito', name: 'Cartão de Débito', type: 'debit_card' },
            { id: 'dinheiro', name: 'Dinheiro', type: 'cash' },
          ]);
        }
      });
  }, [tenantId]);

  return (
    <div className="flex flex-col items-center justify-start h-full gap-3 md:gap-4 p-4 md:p-6 overflow-y-auto">
      {/* Título + Total lado a lado */}
      <div className="flex items-center justify-between w-full max-w-2xl">
        <div>
          <h2 className="text-3xl md:text-6xl font-black text-white leading-tight">Como vai pagar?</h2>
          <p className="text-zinc-500 text-sm md:text-xl mt-1">
            Pagamento feito <span className="text-amber-400 font-semibold">na entrega</span> — não agora
          </p>
        </div>
        <div className="bg-zinc-800 rounded-xl md:rounded-2xl px-4 md:px-6 py-2 md:py-4 text-right flex-shrink-0">
          <p className="text-zinc-500 text-sm font-semibold">Total</p>
          <p className="text-amber-400 font-black text-xl md:text-4xl">{fmt(total)}</p>
        </div>
      </div>

      {/* Métodos — grid compacto */}
      <div className="grid grid-cols-2 gap-3 md:gap-4 w-full max-w-2xl">
        {methods.map((m) => {
          const isSel = selected?.id === m.id;
          return (
            <button
              key={m.id}
              onClick={() => setSelected(m)}
              className={`flex items-center gap-3 md:gap-4 p-4 md:p-6 rounded-xl md:rounded-2xl border-2 cursor-pointer active:scale-95 transition-all text-left ${
                isSel
                  ? 'border-amber-500 bg-amber-500/10'
                  : 'border-zinc-700 bg-zinc-800 hover:border-zinc-600'
              }`}
            >
              <div className={`w-12 h-12 md:w-14 md:h-14 flex items-center justify-center rounded-lg md:rounded-xl flex-shrink-0 ${isSel ? 'bg-amber-500/20' : 'bg-zinc-700'}`}>
                <i className={`${TYPE_ICON[m.type] ?? 'ri-wallet-line'} text-xl md:text-3xl ${isSel ? 'text-amber-400' : 'text-zinc-400'}`} />
              </div>
              <div className="flex-1 min-w-0">
                <p className={`text-base md:text-xl font-black truncate ${isSel ? 'text-amber-400' : 'text-white'}`}>{m.name}</p>
                <p className="text-zinc-500 text-sm mt-1 truncate hidden sm:block">{TYPE_LABEL[m.type] ?? 'Na entrega'}</p>
              </div>
              {isSel && (
                <div className="w-5 h-5 md:w-6 md:h-6 flex items-center justify-center bg-amber-500 rounded-full flex-shrink-0">
                  <i className="ri-check-line text-zinc-950 text-xs" />
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* Aviso compacto */}
      <div className="flex items-center gap-3 md:gap-4 bg-zinc-800/80 border border-zinc-700 rounded-lg md:rounded-xl px-4 md:px-6 py-3 md:py-4 max-w-2xl w-full">
        <i className="ri-information-line text-amber-400 text-base flex-shrink-0" />
        <p className="text-zinc-400 text-sm">
          Você <strong className="text-white">não precisa pagar agora</strong>. O atendente cobrará na entrega do pedido.
        </p>
      </div>

      {/* Botões */}
      <div className="flex gap-3 md:gap-4 w-full max-w-2xl">
        <button
          onClick={onVoltar}
          className="px-6 md:px-8 py-3 md:py-4 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 font-semibold rounded-lg md:rounded-xl cursor-pointer transition-colors whitespace-nowrap text-sm md:text-lg"
        >
          Voltar
        </button>
        <button
          onClick={() => selected && onContinuar(selected.id, selected.name)}
          disabled={!selected}
          className="flex-1 py-3 md:py-4 bg-amber-500 hover:bg-amber-400 disabled:opacity-40 disabled:cursor-not-allowed text-zinc-950 font-black text-sm md:text-xl rounded-lg md:rounded-xl cursor-pointer transition-colors whitespace-nowrap"
        >
          Confirmar pedido
        </button>
      </div>
    </div>
  );
}
