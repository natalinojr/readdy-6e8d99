import { useState, useEffect } from 'react';
import { invokeWithAuth, supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useObsPorItemId } from '@/hooks/useObsPorItemId';
import { useOrderEditLock } from '@/hooks/useOrderEditLock';
import ReembolsoDiferencaModal from './ReembolsoDiferencaModal';
import type { PedidoItemDetalhe } from '@/types/pdv';

const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

interface OrderBasic {
  isPaid?: boolean;
  numero?: number;
  pago?: boolean;
}

interface Props {
  item: PedidoItemDetalhe;
  orderId: string;
  /** Dados básicos do pedido — usado para detectar se está pago e exibir aviso de diferença */
  order?: OrderBasic;
  onSalvar: () => void;
  onClose: () => void;
  /** Chamado antes de salvar quando diferença > 0 e pedido já pago */
  onAbrirPagamentoDiferenca?: (diferenca: number) => void;
}

export default function EditarItemCaixaModal({ item, orderId, order, onSalvar, onClose, onAbrirPagamentoDiferenca }: Props) {
  const { user } = useAuth();
  const { lockOrder, unlockOrder } = useOrderEditLock();
  const [quantidade, setQuantidade] = useState(item.quantidade);
  const [obs, setObs] = useState(item.observacao || '');
  const [abaObs, setAbaObs] = useState<'todas' | number>('todas');
  const [obsUnidades, setObsUnidades] = useState<string[]>(() => {
    if (item.unidades.length > 1) {
      return item.unidades.map((_, idx) => (idx === 0 ? item.observacao || '' : ''));
    }
    return item.observacao ? [item.observacao] : [];
  });
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [lockLoading, setLockLoading] = useState(true);
  const [lockError, setLockError] = useState<string | null>(null);
  const [showReembolsoModal, setShowReembolsoModal] = useState(false);
  const [pendingSaveAfterReembolso, setPendingSaveAfterReembolso] = useState(false);

  // Observações disponíveis: globais + específicas do item
  const todasObsDisponiveis = useObsPorItemId(item.menuItemId ?? '');

  // Inicializa seleção com obs que já estavam no item (se baterem com as disponíveis)
  const [obsSelecionadas, setObsSelecionadas] = useState<string[]>(() => {
    if (!item.observacao) return [];
    const parts = item.observacao.split(' · ').map((s) => s.trim());
    return parts.filter((p) => todasObsDisponiveis.includes(p));
  });

  // ── Cálculo de diferença de valor (pedido pago) ──────────────────────────
  const pedidoPago = order?.isPaid === true || order?.pago === true;
  const precoUnitario = item.preco;
  const qtdOriginal = item.quantidade;
  const totalOriginal = precoUnitario * qtdOriginal;
  const totalNovo = precoUnitario * quantidade;
  const diferenca = totalNovo - totalOriginal; // positivo = cobrar mais; negativo = reembolsar

  // Tenta dar lock ao abrir o modal
  useEffect(() => {
    let cancelled = false;
    setLockLoading(true);
    lockOrder(orderId).then((result) => {
      if (cancelled) return;
      setLockLoading(false);
      if (!result.ok) {
        setLockError(result.lockedBy
          ? `Pedido sendo editado por ${result.lockedBy}`
          : result.error ?? 'Não foi possível editar agora');
      }
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId]);

  // Garante unlock ao desmontar (caso o usuário feche de outra forma)
  useEffect(() => {
    return () => {
      unlockOrder(orderId, false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId]);

  const toggleObsTag = (obsTexto: string) => {
    setObsSelecionadas((prev) =>
      prev.includes(obsTexto) ? prev.filter((o) => o !== obsTexto) : [...prev, obsTexto],
    );
  };

  const totalItem = precoUnitario * quantidade;

  const handleSetQuantidade = (novaQtd: number) => {
    const q = Math.max(0, novaQtd);
    setQuantidade(q);
    setObsUnidades((prev) => Array.from({ length: q }, (_, i) => prev[i] ?? ''));
    if (typeof abaObs === 'number' && abaObs >= q) setAbaObs('todas');
    if (q === 1) setAbaObs('todas');
  };

  /** Executa o save efetivo no backend */
  const executarSave = async () => {
    setErro(null);
    setSalvando(true);

    const tenantId = user?.tenantId;
    if (tenantId) {
      supabase.channel(`order-updates-${tenantId}`).send({
        type: 'broadcast',
        event: 'order_saving',
        payload: { order_id: orderId },
      }).catch(() => {});
    }

    try {
      const partes: string[] = [];
      if (obsSelecionadas.length > 0) partes.push(...obsSelecionadas);
      if (obs.trim()) partes.push(obs.trim());
      const notaFinal = partes.join(' · ') || null;

      const observations = obsSelecionadas.map((t) => ({ text: t, is_checked: true }));
      if (obs.trim()) observations.push({ text: obs.trim(), is_checked: false });

      const body: Record<string, unknown> = {
        action: 'update_order_item',
        order_id: orderId,
        order_item_id: item.id,
        quantity: quantidade,
        notes: notaFinal,
        observations,
        tenant_id: user?.tenantId ?? null,
        finish_edit: true,
      };

      if (obsUnidades.some((o) => (o ?? '').trim())) {
        const unitObs = obsUnidades
          .map((u, idx) => ((u ?? '').trim() ? `Un.${idx + 1}: ${(u ?? '').trim()}` : ''))
          .filter(Boolean);
        if (unitObs.length > 0) {
          const obsExistentes = observations;
          body.observations = [
            ...obsExistentes,
            ...unitObs.map((t) => ({ text: t, is_checked: false })),
          ];
          const todasPartes = [...partes, ...unitObs];
          body.notes = todasPartes.join(' · ') || null;
        }
      }

      const { error } = await invokeWithAuth('order-write', { body });
      if (error) throw new Error(error.message);

      onSalvar();
      onClose();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao salvar');
    } finally {
      setSalvando(false);
      setPendingSaveAfterReembolso(false);
    }
  };

  const handleSalvar = async () => {
    // Se pedido está pago e há diferença de valor → fluxo especial
    if (pedidoPago && Math.abs(diferenca) > 0.005) {
      if (diferenca < 0) {
        // Reembolso: abrir modal de reembolso
        setShowReembolsoModal(true);
        return;
      } else {
        // Cobrança adicional: salvar primeiro, depois abrir pagamento da diferença
        setSalvando(true);
        setErro(null);

        const tenantId = user?.tenantId;
        if (tenantId) {
          supabase.channel(`order-updates-${tenantId}`).send({
            type: 'broadcast',
            event: 'order_saving',
            payload: { order_id: orderId },
          }).catch(() => {});
        }

        try {
          const partes: string[] = [];
          if (obsSelecionadas.length > 0) partes.push(...obsSelecionadas);
          if (obs.trim()) partes.push(obs.trim());
          const notaFinal = partes.join(' · ') || null;
          const observations = obsSelecionadas.map((t) => ({ text: t, is_checked: true }));
          if (obs.trim()) observations.push({ text: obs.trim(), is_checked: false });
          const body: Record<string, unknown> = {
            action: 'update_order_item',
            order_id: orderId,
            order_item_id: item.id,
            quantity: quantidade,
            notes: notaFinal,
            observations,
            tenant_id: user?.tenantId ?? null,
            finish_edit: true,
          };
          const { error } = await invokeWithAuth('order-write', { body });
          if (error) throw new Error(error.message);
          onSalvar();
          // Abrir modal de pagamento de diferença sem fechar ainda
          onAbrirPagamentoDiferenca?.(diferenca);
          onClose();
        } catch (e) {
          setErro(e instanceof Error ? e.message : 'Erro ao salvar');
        } finally {
          setSalvando(false);
        }
        return;
      }
    }

    // Caso normal: sem diferença de valor ou pedido não pago
    await executarSave();
  };

  const handleClose = async () => {
    await unlockOrder(orderId, false);
    onClose();
  };

  const temObsUnidade = obsUnidades.some(Boolean);

  // Reembolso confirmado → agora executa o save da edição
  const handleReembolsoConfirmado = async () => {
    setShowReembolsoModal(false);
    setPendingSaveAfterReembolso(true);
    await executarSave();
  };

  // Se lock falhou, mostra mensagem e não permite edição
  if (!lockLoading && lockError) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
        <div className="bg-white rounded-2xl w-full max-w-sm shadow-xl overflow-hidden p-6 text-center">
          <div className="w-12 h-12 flex items-center justify-center bg-orange-100 rounded-2xl mx-auto mb-4">
            <i className="ri-lock-2-line text-2xl text-orange-500" />
          </div>
          <h3 className="text-sm font-bold text-zinc-900 mb-2">Pedido em edição</h3>
          <p className="text-xs text-zinc-600 mb-5">{lockError}</p>
          <button
            onClick={() => onClose()}
            className="w-full py-3 bg-zinc-900 text-white font-bold rounded-xl cursor-pointer whitespace-nowrap text-sm"
          >
            Fechar
          </button>
        </div>
      </div>
    );
  }

  const orderNumber = order?.numero ?? 0;

  return (
    <>
      {showReembolsoModal && (
        <ReembolsoDiferencaModal
          orderId={orderId}
          orderNumber={orderNumber}
          valorReembolso={diferenca}
          onConfirmado={handleReembolsoConfirmado}
          onCancelar={() => setShowReembolsoModal(false)}
        />
      )}

      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
        <div className="bg-white rounded-2xl w-full max-w-sm shadow-xl overflow-hidden" style={{ maxHeight: 'min(90dvh, 90vh)' }}>
          {/* Header */}
          <div className="flex items-center gap-3 px-4 py-3 border-b border-zinc-100">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-zinc-900 truncate">{item.nome}</p>
              {item.opcoes.length > 0 && (
                <p className="text-[11px] text-zinc-400 truncate mt-0.5">
                  {item.opcoes.join(' · ')}
                </p>
              )}
            </div>
            {/* Badge "em edição" */}
            <div className="flex items-center gap-1 px-2 py-0.5 bg-orange-100 border border-orange-200 rounded-full flex-shrink-0">
              <i className="ri-edit-2-line text-orange-500 text-xs animate-pulse" />
              <span className="text-[9px] font-bold text-orange-600">Bloqueado KDS</span>
            </div>
            <button
              onClick={handleClose}
              className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-zinc-100 cursor-pointer text-zinc-400 transition-colors"
            >
              <i className="ri-close-line text-base" />
            </button>
          </div>

          {lockLoading && (
            <div className="flex items-center justify-center py-8">
              <div className="w-6 h-6 border-2 border-orange-400 border-t-transparent rounded-full animate-spin mr-2" />
              <span className="text-xs text-zinc-500">Bloqueando pedido na cozinha...</span>
            </div>
          )}

          {!lockLoading && !lockError && (
            <>
              <div className="px-4 py-4 space-y-4 overflow-y-auto" style={{ maxHeight: 'calc(min(90dvh, 90vh) - 130px)' }}>

                {/* Indicador visual de diferença (Parte 5) */}
                {pedidoPago && Math.abs(diferenca) > 0.005 && (
                  <div className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold ${
                    diferenca < 0
                      ? 'bg-sky-50 text-sky-700 border border-sky-200'
                      : 'bg-amber-50 text-amber-700 border border-amber-200'
                  }`}>
                    <div className={`w-4 h-4 flex items-center justify-center flex-shrink-0 ${diferenca < 0 ? 'text-sky-600' : 'text-amber-600'}`}>
                      <i className={diferenca < 0 ? 'ri-refund-2-line' : 'ri-secure-payment-line'} />
                    </div>
                    {diferenca < 0
                      ? `Reembolso ao cliente: ${fmt(Math.abs(diferenca))} (Dinheiro ou PIX)`
                      : `Valor adicional a cobrar: ${fmt(diferenca)}`
                    }
                  </div>
                )}

                {/* Quantidade */}
                <div>
                  <p className="text-[11px] font-bold text-zinc-500 uppercase tracking-wider mb-2">Quantidade</p>
                  <div className="flex items-center gap-4">
                    <button
                      onClick={() => handleSetQuantidade(quantidade - 1)}
                      className={`w-10 h-10 flex items-center justify-center rounded-xl border-2 cursor-pointer transition-colors font-bold text-lg
                        ${quantidade <= 1 ? 'border-red-200 text-red-400 hover:bg-red-50' : 'border-zinc-200 text-zinc-600 hover:bg-zinc-100'}`}
                    >
                      {quantidade <= 1 ? <i className="ri-delete-bin-line text-base" /> : <i className="ri-subtract-line text-base" />}
                    </button>
                    <div className="flex-1 text-center">
                      <span className="text-3xl font-black text-zinc-900">{quantidade}</span>
                      <p className="text-xs text-zinc-400 mt-0.5">{fmt(precoUnitario)} / un</p>
                    </div>
                    <button
                      onClick={() => handleSetQuantidade(quantidade + 1)}
                      className="w-10 h-10 flex items-center justify-center rounded-xl border-2 border-zinc-200 text-zinc-600 hover:bg-zinc-100 cursor-pointer transition-colors"
                    >
                      <i className="ri-add-line text-base font-bold" />
                    </button>
                  </div>
                  {quantidade > 0 && (
                    <div className="mt-2 text-center">
                      <span className="text-sm font-bold text-amber-600">{fmt(totalItem)}</span>
                    </div>
                  )}
                  {quantidade === 0 && (
                    <div className="mt-2 text-center">
                      <span className="text-xs font-semibold text-red-500">Item será removido</span>
                    </div>
                  )}
                </div>

                {/* Observação */}
                <div>
                  <p className="text-[11px] font-bold text-zinc-500 uppercase tracking-wider mb-2">Observação</p>

                  {todasObsDisponiveis.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mb-3">
                      {todasObsDisponiveis.map((obsTexto) => {
                        const sel = obsSelecionadas.includes(obsTexto);
                        return (
                          <button
                            key={obsTexto}
                            onClick={() => toggleObsTag(obsTexto)}
                            className={`text-xs px-3 py-1.5 rounded-full border transition-colors cursor-pointer whitespace-nowrap ${
                              sel
                                ? 'bg-amber-500 border-amber-500 text-white'
                                : 'bg-white border-zinc-200 text-zinc-600 hover:border-amber-300'
                            }`}
                          >
                            {obsTexto}
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {quantidade > 1 && (
                    <div className="flex gap-1 mb-2 flex-wrap">
                      <button
                        onClick={() => setAbaObs('todas')}
                        className={`px-2.5 py-1 rounded-full text-xs font-semibold cursor-pointer whitespace-nowrap transition-colors ${
                          abaObs === 'todas' ? 'bg-amber-500 text-white' : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'
                        }`}
                      >
                        Todas
                      </button>
                      {Array.from({ length: quantidade }, (_, i) => (
                        <button
                          key={i}
                          onClick={() => setAbaObs(i)}
                          className={`px-2.5 py-1 rounded-full text-xs font-semibold cursor-pointer whitespace-nowrap transition-colors relative ${
                            abaObs === i ? 'bg-amber-500 text-white' : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'
                          }`}
                        >
                          Un. {i + 1}
                          {obsUnidades[i] && (
                            <span className="ml-1 inline-block w-1.5 h-1.5 rounded-full bg-amber-300 align-middle" />
                          )}
                        </button>
                      ))}
                    </div>
                  )}

                  {abaObs === 'todas' || quantidade <= 1 ? (
                    <textarea
                      value={obs}
                      onChange={(e) => setObs(e.target.value.slice(0, 150))}
                      placeholder={quantidade > 1 ? 'Obs. para todas as unidades...' : 'Ex: sem cebola, mal passado...'}
                      rows={2}
                      className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2.5 text-sm text-zinc-800 placeholder-zinc-400 outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100 resize-none"
                    />
                  ) : (
                    <textarea
                      value={obsUnidades[abaObs as number] ?? ''}
                      onChange={(e) => {
                        const val = e.target.value.slice(0, 150);
                        setObsUnidades((prev) => {
                          const next = [...prev];
                          next[abaObs as number] = val;
                          return next;
                        });
                      }}
                      placeholder={`Obs. só para unidade ${(abaObs as number) + 1}...`}
                      rows={2}
                      className="w-full border border-amber-200 rounded-xl px-3 py-2.5 text-sm text-zinc-800 placeholder-zinc-400 outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100 resize-none bg-amber-50"
                    />
                  )}
                  <p className="text-[10px] text-zinc-400 text-right mt-0.5">
                    {abaObs === 'todas' ? obs.length : (obsUnidades[abaObs as number]?.length ?? 0)}/150
                  </p>

                  {temObsUnidade && quantidade > 1 && (
                    <div className="mt-2 space-y-1">
                      {obsUnidades.map((u, i) => u ? (
                        <div key={i} className="flex items-start gap-1.5 text-[10px] text-amber-700 bg-amber-50 border border-amber-100 px-2 py-1 rounded-lg">
                          <span className="font-black flex-shrink-0">Un.{i + 1}:</span>
                          <span className="truncate">{u}</span>
                        </div>
                      ) : null)}
                    </div>
                  )}
                </div>

                {erro && (
                  <div className="bg-red-50 border border-red-200 rounded-xl p-3">
                    <p className="text-xs font-semibold text-red-600 flex items-center gap-1">
                      <i className="ri-error-warning-line" />{erro}
                    </p>
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="px-4 pb-5 pt-2 space-y-2.5 flex-shrink-0 border-t border-zinc-100">
                <button
                  onClick={handleSalvar}
                  disabled={salvando || pendingSaveAfterReembolso || quantidade === 0}
                  className="w-full py-3 bg-amber-500 hover:bg-amber-600 disabled:opacity-40 text-white font-bold rounded-xl cursor-pointer whitespace-nowrap transition-colors text-sm flex items-center justify-center gap-2"
                >
                  {salvando || pendingSaveAfterReembolso ? (
                    <><i className="ri-loader-4-line animate-spin" />Salvando...</>
                  ) : pedidoPago && diferenca > 0.005 ? (
                    <><i className="ri-check-line mr-1.5" />Salvar e cobrar {fmt(diferenca)}</>
                  ) : pedidoPago && diferenca < -0.005 ? (
                    <><i className="ri-check-line mr-1.5" />Salvar e reembolsar {fmt(Math.abs(diferenca))}</>
                  ) : (
                    <><i className="ri-check-line mr-1.5" />Salvar alterações</>
                  )}
                </button>
                <button
                  onClick={handleClose}
                  className="w-full py-2.5 border-2 border-zinc-200 text-zinc-600 hover:bg-zinc-50 font-semibold rounded-xl cursor-pointer whitespace-nowrap transition-colors text-sm"
                >
                  Cancelar
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}