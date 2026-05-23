import { useState, useEffect } from 'react';
import { usePaymentMethods } from '@/hooks/usePaymentMethods';
import { useSystemSettings } from '@/hooks/useSystemSettings';
import { formatCurrency } from '@/lib/formatters';

interface Props {
  total: number;
  nomeCliente?: string;
  onConfirm: (pagamentos: Array<{ formaId: string; forma: string; valor: number; troco?: number }>) => void;
  onClose: () => void;
}

interface LinhaForma {
  id: string;
  formaId: string;
  valor: string;
}

let _lineCounter = 0;
const newLine = (formaId: string, valor: string): LinhaForma => ({
  id: `ln-${++_lineCounter}`,
  formaId,
  valor,
});

export default function DeliveryPagamentoModal({ total, nomeCliente, onConfirm, onClose }: Props) {
  const { formasAtivas: todasFormas, loading } = usePaymentMethods();
  const { settings } = useSystemSettings();
  const [linhas, setLinhas] = useState<LinhaForma[]>([]);
  const [valorRecebido, setValorRecebido] = useState('');

  // Filtra formas aceitas no delivery (null = todas)
  const deliveryPaymentIds = (settings as Record<string, unknown>).delivery_payment_methods as string[] | null | undefined;
  const formasAtivas = deliveryPaymentIds && deliveryPaymentIds.length > 0
    ? todasFormas.filter((f) => deliveryPaymentIds.includes(f.id))
    : todasFormas;

  // Inicializa as linhas assim que as formas de pagamento carregarem
  useEffect(() => {
    if (formasAtivas.length > 0 && linhas.length === 0) {
      setLinhas([newLine(formasAtivas[0].id, total.toFixed(2))]);
    }
  }, [formasAtivas, total]); // eslint-disable-line react-hooks/exhaustive-deps

  const formaAtualObj = formasAtivas.find((f) => f.id === linhas[0]?.formaId);
  const isDinheiro = formaAtualObj?.tipo === 'dinheiro';

  const somaPgto = linhas.reduce((acc, l) => acc + (parseFloat(l.valor) || 0), 0);
  const restante = Math.max(0, total - somaPgto);
  const recebido = parseFloat(valorRecebido) || 0;
  const troco = isDinheiro && recebido > 0 ? Math.max(0, recebido - total) : 0;

  // Válido: soma >= total (com tolerância de 1 centavo) e pelo menos uma linha
  const valid = linhas.length > 0 && somaPgto >= total - 0.005;

  const updateLinha = (id: string, field: 'formaId' | 'valor', val: string) => {
    setLinhas((prev) => prev.map((l) => l.id === id ? { ...l, [field]: val } : l));
  };

  const addLinha = () => {
    if (restante <= 0.005 || formasAtivas.length === 0) return;
    setLinhas((prev) => [...prev, newLine(formasAtivas[0].id, restante.toFixed(2))]);
  };

  const removeLinha = (id: string) => {
    setLinhas((prev) => {
      const next = prev.filter((l) => l.id !== id);
      // Redistribui o total para a primeira linha se sobrar apenas uma
      if (next.length === 1) {
        return [{ ...next[0], valor: total.toFixed(2) }];
      }
      return next;
    });
  };

  const handleConfirm = () => {
    if (!valid) return;
    const pagamentos = linhas.map((l, i) => {
      const formaObj = formasAtivas.find((x) => x.id === l.formaId);
      return {
        formaId: l.formaId,
        forma: formaObj?.nome ?? l.formaId,
        valor: parseFloat(l.valor) || 0,
        troco: i === 0 && isDinheiro && recebido > 0 ? troco : undefined,
      };
    });
    onConfirm(pagamentos);
  };

  // Atalhos de valor rápido para dinheiro
  const quickValues = isDinheiro
    ? [total, Math.ceil(total / 10) * 10, Math.ceil(total / 50) * 50, Math.ceil(total / 100) * 100]
        .filter((v, i, arr) => arr.indexOf(v) === i && v >= total)
        .slice(0, 4)
    : [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="bg-white rounded-2xl w-full max-w-sm mx-4 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 bg-zinc-800 flex items-center justify-between">
          <div>
            <h3 className="text-white font-bold text-sm">Pagamento Delivery</h3>
            {nomeCliente && <p className="text-zinc-400 text-xs mt-0.5">{nomeCliente}</p>}
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-white/10 text-zinc-400 cursor-pointer"
          >
            <i className="ri-close-line" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          {/* Total */}
          <div className="flex items-center justify-between py-3 bg-zinc-50 rounded-xl px-4">
            <span className="text-sm font-semibold text-zinc-600">Total do pedido</span>
            <span className="text-xl font-black text-zinc-900">{formatCurrency(total)}</span>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-6">
              <i className="ri-loader-4-line animate-spin text-zinc-400 text-xl" />
              <span className="ml-2 text-sm text-zinc-400">Carregando formas de pagamento...</span>
            </div>
          ) : formasAtivas.length === 0 ? (
            <div className="flex items-center gap-2 p-3 bg-amber-50 border border-amber-200 rounded-xl">
              <i className="ri-alert-line text-amber-500 text-sm" />
              <span className="text-xs text-amber-700">
                Nenhuma forma de pagamento configurada. Configure em Configurações &gt; Estações e Pagamentos.
              </span>
            </div>
          ) : (
            <>
              {/* Formas de pagamento */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-bold text-zinc-600">Forma de pagamento</p>
                  {restante > 0.005 && linhas.length > 0 && (
                    <button
                      onClick={addLinha}
                      className="text-[10px] font-semibold text-amber-600 hover:text-amber-700 cursor-pointer whitespace-nowrap"
                    >
                      <i className="ri-add-line mr-0.5" />Dividir pagamento
                    </button>
                  )}
                </div>

                {linhas.map((l) => {
                  const formaObj = formasAtivas.find((f) => f.id === l.formaId);
                  const isLineDinheiro = formaObj?.tipo === 'dinheiro';
                  return (
                    <div key={l.id} className="flex items-center gap-2">
                      <select
                        value={l.formaId}
                        onChange={(e) => updateLinha(l.id, 'formaId', e.target.value)}
                        className="flex-1 text-xs bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2.5 focus:outline-none focus:border-amber-400 cursor-pointer"
                      >
                        {formasAtivas.map((fm) => (
                          <option key={fm.id} value={fm.id}>{fm.nome}</option>
                        ))}
                      </select>
                      <div className={`flex items-center gap-1 border rounded-xl px-3 py-2 flex-shrink-0 transition-colors ${
                        parseFloat(l.valor) >= (total / linhas.length - 0.005)
                          ? 'bg-green-50 border-green-300'
                          : 'bg-zinc-50 border-zinc-200'
                      }`}>
                        <span className="text-[10px] text-zinc-400">R$</span>
                        <input
                          type="number"
                          value={l.valor}
                          min={0}
                          step={0.01}
                          onChange={(e) => updateLinha(l.id, 'valor', e.target.value)}
                          onFocus={(e) => e.target.select()}
                          className="w-16 text-xs font-bold text-zinc-800 bg-transparent focus:outline-none text-right"
                        />
                      </div>
                      {linhas.length > 1 && (
                        <button
                          onClick={() => removeLinha(l.id)}
                          className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-red-50 text-zinc-400 hover:text-red-500 cursor-pointer flex-shrink-0"
                        >
                          <i className="ri-close-line text-sm" />
                        </button>
                      )}
                      {isLineDinheiro && linhas.length === 1 && (
                        <div className="w-7 h-7 flex items-center justify-center text-zinc-300 flex-shrink-0">
                          <i className="ri-money-dollar-circle-line text-sm" />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Dinheiro: valor recebido + atalhos */}
              {isDinheiro && linhas.length === 1 && (
                <div className="space-y-2">
                  <label className="block text-xs font-bold text-zinc-600">Valor recebido (opcional)</label>
                  {quickValues.length > 1 && (
                    <div className="flex gap-1.5 flex-wrap">
                      {quickValues.map((v) => (
                        <button
                          key={v}
                          onClick={() => setValorRecebido(v.toFixed(2))}
                          className={`px-3 py-1.5 text-xs font-bold rounded-lg cursor-pointer transition-colors whitespace-nowrap ${
                            valorRecebido === v.toFixed(2)
                              ? 'bg-amber-500 text-white'
                              : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'
                          }`}
                        >
                          {formatCurrency(v)}
                        </button>
                      ))}
                    </div>
                  )}
                  <input
                    type="number"
                    value={valorRecebido}
                    placeholder={total.toFixed(2)}
                    min={0}
                    step={0.01}
                    onChange={(e) => setValorRecebido(e.target.value)}
                    onFocus={(e) => e.target.select()}
                    className="w-full text-sm bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2.5 focus:outline-none focus:border-amber-400 text-zinc-800"
                  />
                  {troco > 0 && (
                    <div className="flex items-center justify-between p-3 bg-green-50 border border-green-200 rounded-xl">
                      <span className="text-xs font-semibold text-green-700">Troco</span>
                      <span className="text-base font-black text-green-700">{formatCurrency(troco)}</span>
                    </div>
                  )}
                </div>
              )}

              {/* Status de pagamento */}
              {linhas.length > 0 && !valid && somaPgto > 0 && (
                <div className="flex items-center gap-2 p-2.5 bg-amber-50 border border-amber-200 rounded-xl">
                  <i className="ri-alert-line text-amber-500 text-sm flex-shrink-0" />
                  <span className="text-xs text-amber-700 font-medium">
                    Falta {formatCurrency(restante)} para cobrir o total
                  </span>
                </div>
              )}

              {valid && (
                <div className="flex items-center gap-2 p-2.5 bg-green-50 border border-green-200 rounded-xl">
                  <i className="ri-check-line text-green-500 text-sm flex-shrink-0" />
                  <span className="text-xs text-green-700 font-medium">
                    Pagamento completo — {formatCurrency(somaPgto)}
                    {somaPgto > total + 0.005 && (
                      <span className="ml-1 text-green-600">
                        (excedente: {formatCurrency(somaPgto - total)})
                      </span>
                    )}
                  </span>
                </div>
              )}
            </>
          )}
        </div>

        <div className="px-5 py-4 border-t border-zinc-100 flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 bg-zinc-100 hover:bg-zinc-200 text-zinc-600 text-sm font-semibold rounded-xl cursor-pointer whitespace-nowrap transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={handleConfirm}
            disabled={!valid || loading}
            className="flex-1 py-2.5 bg-zinc-800 hover:bg-zinc-900 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-bold rounded-xl cursor-pointer whitespace-nowrap transition-colors flex items-center justify-center gap-1.5"
          >
            <i className="ri-check-double-line" />
            Confirmar
          </button>
        </div>
      </div>
    </div>
  );
}
