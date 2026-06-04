import { useState, useEffect } from 'react';
import type { KDSItem } from '@/types/kds';
import { useObsPorItemId } from '@/hooks/useObsPorItemId';
import { useOrderEditLock } from '@/hooks/useOrderEditLock';
import { invokeWithAuth, supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';

const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

interface Props {
  item: KDSItem;
  orderId: string;
  onSalvo: () => void;
  onClose: () => void;
}

export default function EditarItemPedidoAtivoModal({ item, orderId, onSalvo, onClose }: Props) {
  const { user } = useAuth();
  const { lockOrder, unlockOrder } = useOrderEditLock();

  const [quantidade, setQuantidade] = useState(item.quantidade);
  const [obs, setObs] = useState(item.observacaoLivre || '');
  const [obsSelecionadas, setObsSelecionadas] = useState<string[]>(item.observacoes ?? []);
  const [salvando, setSalvando] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [lockLoading, setLockLoading] = useState(true);
  const [lockError, setLockError] = useState<string | null>(null);

  const todasObsDisponiveis = useObsPorItemId(item.menuItemId ?? '');

  // Tenta dar lock ao abrir
  useEffect(() => {
    let cancelled = false;
    lockOrder(orderId).then((result) => {
      if (cancelled) return;
      setLockLoading(false);
      if (!result.ok) {
        setLockError(result.lockedBy
          ? `Pedido sendo editado por ${result.lockedBy}`
          : result.error ?? 'Não foi possível editar agora');
      }
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId]);

  // Garante unlock ao desmontar
  useEffect(() => {
    return () => { unlockOrder(orderId, false); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId]);

  const toggleObsTag = (obsTexto: string) => {
    setObsSelecionadas((prev) =>
      prev.includes(obsTexto) ? prev.filter((o) => o !== obsTexto) : [...prev, obsTexto]
    );
  };

  const handleSetQuantidade = (q: number) => {
    setQuantidade(Math.max(0, q));
  };

  const handleSalvar = async () => {
    if (salvando) return;
    setErro(null);
    setSalvando(true);

    // Emitir broadcast de "salvando" antes da chamada
    const tenantId = user?.tenantId;
    if (tenantId) {
      supabase.channel(`order-updates-${tenantId}`).send({
        type: 'broadcast',
        event: 'order_saving',
        payload: { order_id: orderId },
      }).catch(() => { /* silently ignore broadcast errors */ });
    }

    try {
      if (quantidade === 0) {
        await invokeWithAuth('order-write', {
          body: {
            action: 'update_order_item_status',
            order_id: orderId,
            order_item_id: item.id,
            status: 'cancelled',
            tenant_id: user?.tenantId,
          },
        });
        // Item cancelado: ainda precisa chamar unlock separado (cancel não tem finish_edit)
        await unlockOrder(orderId, true, `Item ${item.nome} cancelado`);
      } else {
        const todasObservacoes = [
          ...obsSelecionadas.map((t) => ({ text: t, is_checked: true })),
          ...(obs.trim() ? [{ text: obs.trim(), is_checked: false }] : []),
        ];

        await invokeWithAuth('order-write', {
          body: {
            action: 'update_order_item',
            order_id: orderId,
            order_item_id: item.id,
            tenant_id: user?.tenantId,
            quantity: quantidade,
            notes: obs.trim() || null,
            observations: todasObservacoes,
            // Mudança 1: unlock + save atomico numa única chamada
            finish_edit: true,
          },
        });
        // Não é mais necessário chamar unlockOrder separado: finish_edit:true já fez o unlock
      }

      onSalvo();
      onClose();
    } catch (e) {
      console.error('[EditarItemPedidoAtivoModal] erro:', e);
      setErro('Não foi possível salvar. Tente novamente.');
    } finally {
      setSalvando(false);
    }
  };

  const handleClose = async () => {
    await unlockOrder(orderId, false);
    onClose();
  };

  const precoUnit = item.item_price ?? 0;
  const totalItem = precoUnit * quantidade;

  // Locked by another user
  if (!lockLoading && lockError) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={(e) => e.target === e.currentTarget && onClose()}>
        <div className="bg-white rounded-2xl w-full max-w-sm shadow-xl overflow-hidden p-6 text-center">
          <div className="w-12 h-12 flex items-center justify-center bg-orange-100 rounded-2xl mx-auto mb-4">
            <i className="ri-lock-2-line text-2xl text-orange-500" />
          </div>
          <h3 className="text-sm font-bold text-zinc-900 mb-2">Pedido em edição</h3>
          <p className="text-xs text-zinc-600 mb-5">{lockError}</p>
          <button
            onClick={onClose}
            className="w-full py-3 bg-zinc-900 text-white font-bold rounded-xl cursor-pointer whitespace-nowrap text-sm"
          >
            Fechar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={(e) => e.target === e.currentTarget && handleClose()}>
      <div className="bg-white rounded-2xl w-full max-w-sm shadow-xl overflow-hidden flex flex-col" style={{ maxHeight: 'min(90dvh, 90vh)' }}>

        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-zinc-100">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-zinc-900 truncate">{item.nome}</p>
            <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
              {item.opcoes.length > 0 && (
                <p className="text-[11px] text-zinc-400 truncate">
                  {item.opcoes.map((o) => o.opcaoNome).join(' · ')}
                </p>
              )}
            </div>
          </div>
          {!lockLoading && (
            <div className="flex items-center gap-1 px-2 py-0.5 bg-orange-100 border border-orange-200 rounded-full flex-shrink-0">
              <i className="ri-edit-2-line text-orange-500 text-xs animate-pulse" />
              <span className="text-[9px] font-bold text-orange-600">KDS pausado</span>
            </div>
          )}
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
            <span className="text-xs text-zinc-500">Pausando pedido na cozinha...</span>
          </div>
        )}

        {!lockLoading && !lockError && (
          <>
            <div className="px-4 py-4 space-y-4 max-h-[70vh] overflow-y-auto">

              {/* Aviso */}
              <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5">
                <i className="ri-information-line text-amber-500 text-sm flex-shrink-0 mt-0.5" />
                <p className="text-xs text-amber-700">
                  O pedido está pausado na cozinha enquanto você edita. Confirme ou cancele para retomar.
                </p>
              </div>

              {/* Quantidade */}
              <div>
                <p className="text-[11px] font-bold text-zinc-500 uppercase tracking-wider mb-2">Quantidade</p>
                <div className="flex items-center gap-4">
                  <button
                    onClick={() => handleSetQuantidade(quantidade - 1)}
                    className={`w-10 h-10 flex items-center justify-center rounded-xl border-2 cursor-pointer transition-colors font-bold text-lg
                      ${quantidade <= 1 ? 'border-red-200 text-red-400 hover:bg-red-50' : 'border-zinc-200 text-zinc-600 hover:bg-zinc-100'}`}
                  >
                    {quantidade <= 1
                      ? <i className="ri-delete-bin-line text-base" />
                      : <i className="ri-subtract-line text-base" />
                    }
                  </button>
                  <div className="flex-1 text-center">
                    <span className="text-3xl font-black text-zinc-900">{quantidade}</span>
                    {precoUnit > 0 && (
                      <p className="text-xs text-zinc-400 mt-0.5">{fmt(precoUnit)} / un</p>
                    )}
                  </div>
                  <button
                    onClick={() => handleSetQuantidade(quantidade + 1)}
                    className="w-10 h-10 flex items-center justify-center rounded-xl border-2 border-zinc-200 text-zinc-600 hover:bg-zinc-100 cursor-pointer transition-colors"
                  >
                    <i className="ri-add-line text-base" />
                  </button>
                </div>
                {quantidade > 0 && precoUnit > 0 && (
                  <div className="mt-2 text-center">
                    <span className="text-sm font-bold text-amber-600">{fmt(totalItem)}</span>
                  </div>
                )}
                {quantidade === 0 && (
                  <div className="mt-2 text-center">
                    <span className="text-xs font-semibold text-red-500">Item será cancelado</span>
                  </div>
                )}
              </div>

              {/* Observações */}
              <div>
                <p className="text-[11px] font-bold text-zinc-500 uppercase tracking-wider mb-2">Observações</p>

                {todasObsDisponiveis.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-2">
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

                <textarea
                  value={obs}
                  onChange={(e) => setObs(e.target.value.slice(0, 150))}
                  placeholder="Ex: sem cebola, mal passado..."
                  rows={2}
                  className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2.5 text-sm text-zinc-800 placeholder-zinc-400 outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100 resize-none"
                />
                <p className="text-[10px] text-zinc-400 text-right mt-0.5">{obs.length}/150</p>
              </div>

              {erro && (
                <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-3 py-2.5">
                  <i className="ri-error-warning-line text-red-500 text-sm" />
                  <p className="text-xs text-red-700">{erro}</p>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-4 pb-5 pt-2 space-y-2.5">
              {!confirmDelete ? (
                <>
                  <button
                    onClick={handleSalvar}
                    disabled={salvando}
                    className="w-full py-3 bg-amber-500 hover:bg-amber-600 disabled:opacity-60 text-white font-bold rounded-xl cursor-pointer whitespace-nowrap transition-colors text-sm flex items-center justify-center gap-2"
                  >
                    {salvando ? (
                      <><i className="ri-loader-4-line animate-spin" />Salvando...</>
                    ) : (
                      <><i className="ri-check-line" />{quantidade === 0 ? 'Cancelar item' : 'Salvar alterações'}</>
                    )}
                  </button>
                  <button
                    onClick={() => setConfirmDelete(true)}
                    className="w-full py-2.5 border-2 border-red-200 text-red-500 hover:bg-red-50 font-semibold rounded-xl cursor-pointer whitespace-nowrap transition-colors text-sm"
                  >
                    <i className="ri-delete-bin-line mr-1.5" />
                    Cancelar item
                  </button>
                </>
              ) : (
                <div className="bg-red-50 border border-red-200 rounded-xl p-3 space-y-2.5">
                  <p className="text-sm font-semibold text-red-700 text-center">
                    Cancelar &quot;{item.nome}&quot; do pedido?
                  </p>
                  <p className="text-xs text-zinc-500 text-center">
                    O item será removido e a cozinha não irá prepará-lo.
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setConfirmDelete(false)}
                      className="flex-1 py-2 bg-white border border-zinc-200 text-zinc-600 font-semibold rounded-lg cursor-pointer text-sm whitespace-nowrap"
                    >
                      Voltar
                    </button>
                    <button
                      onClick={handleSalvar}
                      disabled={salvando}
                      className="flex-1 py-2 bg-red-500 hover:bg-red-600 disabled:opacity-60 text-white font-bold rounded-lg cursor-pointer text-sm whitespace-nowrap transition-colors flex items-center justify-center gap-2"
                    >
                      {salvando ? (
                        <><i className="ri-loader-4-line animate-spin text-xs" />...</>
                      ) : (
                        <>Confirmar</>
                      )}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}