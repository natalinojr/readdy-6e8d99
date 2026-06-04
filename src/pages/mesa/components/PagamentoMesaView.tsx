import { useState, useEffect, useCallback } from 'react';
import { SUPABASE_URL } from '@/lib/supabase';

const TABLE_WRITE_URL = `${SUPABASE_URL}/functions/v1/table-write`;

interface Props {
  totalGeral: number;
  mesaNumero: number;
  clienteNome: string;
  tableSessionId?: string | null;
  onSolicitarEncerramento?: () => void;
}

export default function PagamentoMesaView({
  totalGeral,
  mesaNumero,
  clienteNome,
  tableSessionId,
  onSolicitarEncerramento,
}: Props) {
  const [podeEncerrar, setPodeEncerrar] = useState(false);
  const [verificandoEncerramento, setVerificandoEncerramento] = useState(false);

  const verificarEncerramento = useCallback(async () => {
    if (!tableSessionId) return;
    setVerificandoEncerramento(true);
    try {
      const res = await fetch(TABLE_WRITE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'check_close_conditions', table_session_id: tableSessionId }),
      });
      const data = await res.json();
      setPodeEncerrar(data.can_close === true);
    } catch {
      setPodeEncerrar(false);
    } finally {
      setVerificandoEncerramento(false);
    }
  }, [tableSessionId]);

  useEffect(() => {
    verificarEncerramento();
  }, [verificarEncerramento]);

  const fmt = (v: number) =>
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

  return (
    <div className="flex flex-col items-center justify-center h-full px-6 py-12 text-center gap-6">
      <div className="w-20 h-20 flex items-center justify-center bg-amber-50 rounded-full">
        <i className="ri-store-2-line text-4xl text-amber-500" />
      </div>
      <div>
        <h2 className="text-xl font-bold text-zinc-800 mb-2">Hora de pagar!</h2>
        <p className="text-zinc-500 text-sm leading-relaxed">
          Dirija-se ao caixa para realizar o pagamento.
          <br />
          Apresente o número da sua mesa:
        </p>
        <div className="mt-4 px-8 py-4 bg-amber-500 rounded-2xl inline-block">
          <p className="text-white text-4xl font-black">Mesa {mesaNumero}</p>
        </div>
      </div>

      <div className="bg-zinc-50 border border-zinc-200 rounded-2xl p-4 w-full">
        <p className="text-xs text-zinc-500 mb-1">Total da conta</p>
        <p className="text-lg font-black text-zinc-900">{fmt(totalGeral)}</p>
        <p className="text-xs text-zinc-400 mt-0.5">Cliente: {clienteNome}</p>
      </div>

      <p className="text-xs text-zinc-400">
        Aceitamos dinheiro, cartão de crédito, débito e PIX no caixa.
      </p>

      {verificandoEncerramento && (
        <div className="flex items-center justify-center gap-2 py-2">
          <i className="ri-loader-4-line animate-spin text-zinc-400 text-sm" />
          <span className="text-xs text-zinc-400">Verificando condições...</span>
        </div>
      )}

      {podeEncerrar && onSolicitarEncerramento && (
        <button
          onClick={onSolicitarEncerramento}
          className="mt-4 px-6 py-3 bg-green-500 text-white font-bold rounded-xl cursor-pointer hover:bg-green-600 transition-colors whitespace-nowrap"
        >
          <div className="flex items-center justify-center gap-2">
            <i className="ri-door-open-line" />
            Encerrar Mesa
          </div>
        </button>
      )}
    </div>
  );
}