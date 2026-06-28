import { useState, useRef, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import AutorizacaoGerenteModal from './AutorizacaoGerenteModal';
import { useAprovacoes } from '@/contexts/AprovacoesContext';
import { useAuditoria } from '@/contexts/AuditoriaContext';
import { useAuth } from '@/contexts/AuthContext';
import type { PagamentoPedido } from '@/types/pdv';
import { useToast } from '@/contexts/ToastContext';

type Etapa = 'motivo' | 'senha' | 'aprovacao' | 'aguardando' | 'estorno' | 'executando' | 'erro' | 'sucesso';

interface Props {
  tipo: 'pedido' | 'item';
  orderId: string;
  orderNumber: string | number;
  orderItemId?: string;
  itemNome?: string;
  pagamentos?: PagamentoPedido[];
  onConcluido: () => void;
  onFechar: () => void;
}

const MOTIVOS = [
  'Erro no pedido',
  'Cliente desistiu',
  'Item indisponível',
  'Outro',
];

function formatPrice(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export default function CancelamentoModal({
  tipo,
  orderId,
  orderNumber,
  orderItemId,
  itemNome,
  pagamentos,
  onConcluido,
  onFechar,
}: Props) {
  const [etapa, setEtapa] = useState<Etapa>('motivo');
  const [motivo, setMotivo] = useState('');
  const [motivoOutro, setMotivoOutro] = useState('');
  const [autorizadorNome, setAutorizadorNome] = useState('');
  const [erro, setErro] = useState('');
  const [executando, setExecutando] = useState(false);
  const [restockItems, setRestockItems] = useState(true);
  const [refundResult, setRefundResult] = useState<{ refundAmount: number; paymentsRefunded: number } | null>(null);
  const { addSolicitacao } = useAprovacoes();
  const { registrarEvento } = useAuditoria();
  const { user } = useAuth();
  const { success } = useToast();

  const tenantId = user?.tenantId ?? '';
  const motivoFinal = motivo === 'Outro' ? motivoOutro : motivo;
  const inputRef = useRef<HTMLInputElement>(null);

  // Pagamentos não reembolsados (apenas para pedido)
  const pagamentosAtivos = (pagamentos ?? []).filter((pg) => !pg.is_refunded);
  const totalEstornar = pagamentosAtivos.reduce((s, pg) => s + pg.amount, 0);
  const pedidoTemPagamento = tipo === 'pedido' && pagamentosAtivos.length > 0;

  useEffect(() => {
    if (etapa === 'motivo') {
      setTimeout(() => inputRef.current?.focus(), 80);
    }
  }, [etapa]);

  const executarCancelamento = async (nomeGerente: string) => {
    setExecutando(true);
    setErro('');
    try {
      if (tipo === 'pedido') {
        if (pedidoTemPagamento) {
          // Cancela + estorna pagamentos
          const { data: rpcData, error: rpcError } = await supabase.rpc('fn_cancel_and_refund_order', {
            p_order_id: orderId,
            p_user_id: user?.id,
            p_reason: motivoFinal,
            p_restock: restockItems,
          });
          if (rpcError) throw rpcError;
          const result = rpcData as { cancelled: boolean; refund_amount: number; payments_refunded: number } | null;
          if (result) {
            setRefundResult({ refundAmount: result.refund_amount, paymentsRefunded: result.payments_refunded });
          }
          // Devolve estoque se solicitado
          if (restockItems) {
            try {
              await supabase.rpc('fn_restock_order', { p_order_id: orderId, p_user_id: user?.id });
            } catch (stockErr) {
              console.warn('[CancelamentoModal] restock error:', stockErr);
            }
          }
          // Registrar auditoria de estorno
          if (result && result.refund_amount > 0) {
            registrarEvento({
              tipo: 'estorno_realizado',
              severidade: 'critico',
              usuario: user?.nome ?? 'Operador',
              perfil: user?.perfil ?? 'caixa',
              descricao: `Estorno automático de ${formatPrice(result.refund_amount)} — Pedido #${orderNumber} cancelado. Motivo: ${motivoFinal}. Autorizado por: ${nomeGerente}`,
              entidade: 'Pedido',
              entidadeId: orderId,
              detalhes: `Pagamentos estornados: ${result.payments_refunded}. Reestoque: ${restockItems ? 'Sim' : 'Não'}.`,
            });
          }
        } else {
          // Cancela sem estorno
          const { error: rpcError } = await supabase.rpc('fn_cancel_order_bypass', {
            p_order_id: orderId,
            p_user_id: user?.id,
            p_reason: motivoFinal,
          });
          if (rpcError) throw rpcError;
        }
      } else {
        // Cancelamento de item
        if (!orderItemId) throw new Error('ID do item não fornecido');
        const { error: rpcError } = await supabase.rpc('fn_cancel_order_item', {
          p_order_item_id: orderItemId,
          p_user_id: user?.id,
          p_reason: motivoFinal,
        });
        if (rpcError) throw rpcError;
      }

      registrarEvento({
        tipo: 'pedido_cancelado',
        severidade: 'aviso',
        usuario: user?.nome ?? 'Operador',
        perfil: user?.perfil ?? 'caixa',
        descricao:
          tipo === 'pedido'
            ? `Pedido #${orderNumber} cancelado. Motivo: ${motivoFinal}. Autorizado por: ${nomeGerente}`
            : `Item "${itemNome}" cancelado do pedido #${orderNumber}. Motivo: ${motivoFinal}. Autorizado por: ${nomeGerente}`,
        entidade: 'Pedido',
        entidadeId: orderId,
      });

      success(
        tipo === 'pedido' ? 'Pedido cancelado' : 'Item cancelado',
        tipo === 'pedido'
          ? `Pedido #${orderNumber} cancelado com sucesso`
          : `Item "${itemNome}" cancelado do pedido #${orderNumber}`
      );

      setEtapa('sucesso');
      onConcluido();
    } catch (e) {
      const msg =
        e instanceof Error
          ? e.message
          : typeof e === 'object' && e !== null && 'message' in e && typeof (e as { message: unknown }).message === 'string'
            ? (e as { message: string }).message
            : 'Erro ao cancelar';
      setErro(msg);
      setEtapa('erro');
    } finally {
      setExecutando(false);
    }
  };

  const handleSolicitarAprovacao = () => {
    if (!motivoFinal) {
      setErro('Informe o motivo do cancelamento');
      return;
    }

    addSolicitacao({
      tipo: 'cancelamento',
      mesaNome: `Pedido #${orderNumber}`,
      garcomNome: user?.nome ?? 'Operador',
      itemNome: tipo === 'item' ? (itemNome ?? 'Item') : `Pedido #${orderNumber}`,
      descricao:
        tipo === 'pedido'
          ? `Cancelamento do pedido #${orderNumber}. Motivo: ${motivoFinal}`
          : `Cancelamento do item "${itemNome}" do pedido #${orderNumber}. Motivo: ${motivoFinal}`,
      urgente: true,
      onApproved: (approverName: string) => {
        if (pedidoTemPagamento) {
          setAutorizadorNome(approverName);
          setEtapa('estorno');
        } else {
          executarCancelamento(approverName);
        }
      },
      onDenied: () => {
        setErro('Aprovação rejeitada pelo gerente');
        setEtapa('erro');
      },
    });

    setEtapa('aguardando');
  };

  const handleSenhaAprovada = (nome: string) => {
    setAutorizadorNome(nome);
    if (pedidoTemPagamento) {
      setEtapa('estorno');
    } else {
      executarCancelamento(nome);
    }
  };

  const handleSenhaRejeitada = () => {
    setErro('Autorização rejeitada. Tente novamente ou solicite aprovação remota.');
    setEtapa('motivo');
  };

  const handleConfirmarEstorno = () => {
    executarCancelamento(autorizadorNome);
  };

  const podeAvancar = motivoFinal.length >= 2;

  if (etapa === 'senha') {
    return (
      <AutorizacaoGerenteModal
        titulo={tipo === 'pedido' ? 'Autorizar Cancelamento de Pedido' : 'Autorizar Cancelamento de Item'}
        descricao={`Este cancelamento requer autorização de um gerente ou administrador.`}
        tenantId={tenantId}
        onAutorizado={handleSenhaAprovada}
        onCancelar={handleSenhaRejeitada}
      />
    );
  }

  if (etapa === 'sucesso') {
    return (
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
        <div className="bg-white rounded-2xl w-full max-w-sm p-8 text-center shadow-2xl">
          <div className="w-16 h-16 flex items-center justify-center bg-green-100 rounded-full mx-auto mb-4">
            <i className="ri-check-double-line text-3xl text-green-500" />
          </div>
          <h3 className="font-black text-zinc-900 text-lg mb-1">
            {tipo === 'pedido' ? 'Pedido Cancelado' : 'Item Cancelado'}
          </h3>
          <p className="text-sm text-zinc-500 mb-2">
            {tipo === 'pedido'
              ? `Pedido #${orderNumber} foi cancelado com sucesso`
              : `Item "${itemNome}" cancelado do pedido #${orderNumber}`}
          </p>
          {refundResult && refundResult.refundAmount > 0 && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 mb-4">
              <p className="text-sm font-bold text-emerald-700">
                {formatPrice(refundResult.refundAmount)} estornado
              </p>
              <p className="text-xs text-emerald-600">
                {refundResult.paymentsRefunded} pagamento{refundResult.paymentsRefunded !== 1 ? 's' : ''} reembolsado{refundResult.paymentsRefunded !== 1 ? 's' : ''}
              </p>
            </div>
          )}
          <p className="text-xs text-zinc-400 mb-6">Registrado no log de auditoria</p>
          <button
            onClick={onFechar}
            className="w-full py-3 bg-zinc-800 hover:bg-zinc-900 text-white font-bold rounded-xl cursor-pointer transition-colors whitespace-nowrap"
          >
            Fechar
          </button>
        </div>
      </div>
    );
  }

  if (etapa === 'erro') {
    return (
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
        <div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden">
          <div className="bg-red-50 border-b border-red-100 px-5 py-4 flex items-center gap-3">
            <div className="w-10 h-10 flex items-center justify-center rounded-xl bg-red-100 flex-shrink-0">
              <i className="ri-close-circle-line text-red-600 text-xl" />
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-sm font-black text-red-800 leading-none">Erro no Cancelamento</h2>
            </div>
            <button
              onClick={onFechar}
              className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-red-100 text-red-400 cursor-pointer transition-colors flex-shrink-0"
            >
              <i className="ri-close-line text-base" />
            </button>
          </div>
          <div className="p-5 space-y-4">
            <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-xl">
              <i className="ri-error-warning-line text-red-500 text-sm flex-shrink-0 mt-0.5" />
              <p className="text-xs text-red-700 font-medium leading-snug">{erro}</p>
            </div>
            <div className="flex gap-2.5">
              <button
                onClick={() => setEtapa('motivo')}
                className="flex-1 py-2.5 border border-zinc-200 text-zinc-600 text-sm font-semibold rounded-xl cursor-pointer hover:bg-zinc-50 transition-colors whitespace-nowrap"
              >
                Voltar
              </button>
              <button
                onClick={onFechar}
                className="flex-1 py-2.5 bg-zinc-800 hover:bg-zinc-900 text-white text-sm font-bold rounded-xl cursor-pointer transition-colors whitespace-nowrap"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (etapa === 'aguardando') {
    return (
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
        <div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden">
          <div className="bg-amber-50 border-b border-amber-100 px-5 py-4 flex items-center gap-3">
            <div className="w-10 h-10 flex items-center justify-center rounded-xl bg-amber-100 flex-shrink-0">
              <i className="ri-time-line text-amber-600 text-xl" />
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-sm font-black text-amber-800 leading-none">Aguardando Aprovação</h2>
              <p className="text-xs text-amber-600 mt-0.5 leading-snug">Solicitação enviada ao gerente</p>
            </div>
            <button
              onClick={onFechar}
              className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-amber-100 text-amber-400 cursor-pointer transition-colors flex-shrink-0"
            >
              <i className="ri-close-line text-base" />
            </button>
          </div>
          <div className="p-5 space-y-4">
            <div className="flex flex-col items-center gap-3 py-4">
              <div className="w-12 h-12 flex items-center justify-center">
                <i className="ri-loader-4-line animate-spin text-amber-500 text-3xl" />
              </div>
              <p className="text-sm font-semibold text-zinc-700 text-center">Aguardando aprovação do gerente...</p>
              <p className="text-xs text-zinc-400 text-center">{tipo === 'pedido' ? `Pedido #${orderNumber}` : `Item "${itemNome}"`}</p>
              <p className="text-xs text-zinc-400 text-center">Motivo: {motivoFinal}</p>
            </div>
            <button
              onClick={onFechar}
              className="w-full py-2.5 border border-zinc-200 text-zinc-600 text-sm font-semibold rounded-xl cursor-pointer hover:bg-zinc-50 transition-colors whitespace-nowrap"
            >
              Cancelar solicitação
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (etapa === 'estorno') {
    return (
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
        <div className="bg-white rounded-2xl w-full max-w-md flex flex-col shadow-2xl" style={{ maxHeight: 'calc(100vh - 2rem)' }}>
          <div className="flex items-start justify-between px-5 py-4 border-b border-zinc-100 flex-shrink-0">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 flex items-center justify-center rounded-xl bg-red-100 flex-shrink-0">
                <i className="ri-refund-2-line text-lg text-red-500" />
              </div>
              <div>
                <h3 className="font-bold text-zinc-900 text-sm">Confirmar Estorno</h3>
                <p className="text-xs text-zinc-400 mt-0.5">Pedido #{orderNumber}</p>
              </div>
            </div>
            <button
              onClick={onFechar}
              className="w-7 h-7 flex items-center justify-center text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 rounded-lg cursor-pointer transition-colors"
            >
              <i className="ri-close-line text-base" />
            </button>
          </div>

          <div className="px-5 py-4 space-y-4 overflow-y-auto flex-1">
            {/* Alerta de estorno obrigatório */}
            <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-xl">
              <i className="ri-alert-line text-amber-500 text-sm flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-xs text-amber-700 font-semibold">Este pedido já foi pago</p>
                <p className="text-xs text-amber-600 mt-0.5">O cancelamento irá estornar automaticamente os pagamentos registrados.</p>
              </div>
            </div>

            {/* Valor total a estornar */}
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4">
              <p className="text-xs text-emerald-600 font-semibold mb-1">Total a estornar</p>
              <p className="text-2xl font-black text-emerald-700">{formatPrice(totalEstornar)}</p>
            </div>

            {/* Lista de pagamentos */}
            {pagamentosAtivos.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-zinc-600 mb-2">Pagamentos a serem estornados</p>
                <div className="space-y-1.5">
                  {pagamentosAtivos.map((pg, idx) => (
                    <div key={idx} className="flex items-center justify-between px-3 py-2 bg-zinc-50 rounded-lg border border-zinc-100">
                      <div className="flex items-center gap-2">
                        <i className="ri-bank-card-line text-zinc-400 text-xs" />
                        <span className="text-xs font-medium text-zinc-700">{pg.payment_method_name ?? 'Pagamento'}</span>
                      </div>
                      <span className="text-xs font-bold text-zinc-800">{formatPrice(pg.amount)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Devolver estoque */}
            <div
              className="flex items-center gap-3 p-3 bg-zinc-50 border border-zinc-200 rounded-xl cursor-pointer"
              onClick={() => setRestockItems((v) => !v)}
            >
              <div className={`w-5 h-5 flex items-center justify-center rounded border transition-all ${restockItems ? 'bg-emerald-500 border-emerald-500' : 'border-zinc-300'}`}>
                {restockItems && <i className="ri-check-line text-white text-xs" />}
              </div>
              <div className="flex-1">
                <p className="text-xs font-semibold text-zinc-700">Devolver itens ao estoque</p>
                <p className="text-[10px] text-zinc-400">Reverte a baixa de ingredientes dos itens cancelados</p>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="px-5 py-3 border-t border-zinc-100 space-y-2 flex-shrink-0">
            <button
              onClick={handleConfirmarEstorno}
              disabled={executando}
              className="w-full py-3 bg-red-500 hover:bg-red-600 disabled:opacity-50 text-white font-bold rounded-xl cursor-pointer transition-colors whitespace-nowrap flex items-center justify-center gap-2"
            >
              {executando ? (
                <>
                  <i className="ri-loader-4-line animate-spin text-sm" />
                  Processando...
                </>
              ) : (
                <>
                  <i className="ri-refund-2-line text-sm" />
                  Confirmar Cancelamento e Estorno
                </>
              )}
            </button>
            <button
              onClick={() => setEtapa('motivo')}
              disabled={executando}
              className="w-full py-2.5 border border-zinc-200 text-zinc-600 text-sm font-semibold rounded-xl cursor-pointer hover:bg-zinc-50 transition-colors whitespace-nowrap"
            >
              Voltar
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Etapa === 'motivo'
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl w-full max-w-md flex flex-col shadow-2xl" style={{ maxHeight: 'calc(100vh - 2rem)' }}>
        {/* Header */}
        <div className="flex items-start justify-between px-5 py-4 border-b border-zinc-100 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 flex items-center justify-center rounded-xl bg-red-100 flex-shrink-0">
              <i className="ri-close-circle-line text-lg text-red-500" />
            </div>
            <div>
              <h3 className="font-bold text-zinc-900 text-sm">
                {tipo === 'pedido' ? 'Cancelar Pedido' : 'Cancelar Item'}
              </h3>
              <p className="text-xs text-zinc-400 mt-0.5">
                {tipo === 'pedido' ? `Pedido #${orderNumber}` : `Item "${itemNome}" do pedido #${orderNumber}`}
              </p>
            </div>
          </div>
          <button
            onClick={onFechar}
            className="w-7 h-7 flex items-center justify-center text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 rounded-lg cursor-pointer transition-colors"
          >
            <i className="ri-close-line text-base" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4 overflow-y-auto flex-1">
          {/* Alerta de estorno */}
          {pedidoTemPagamento && (
            <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-xl">
              <i className="ri-refund-2-line text-amber-500 text-sm flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-xs text-amber-700 font-semibold">Pedido com pagamento registrado</p>
                <p className="text-xs text-amber-600 mt-0.5">{formatPrice(totalEstornar)} serão estornados automaticamente após autorização.</p>
              </div>
            </div>
          )}

          {/* Erro */}
          {erro && (
            <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-xl">
              <i className="ri-error-warning-line text-red-500 text-sm flex-shrink-0 mt-0.5" />
              <p className="text-xs text-red-700 font-medium leading-snug">{erro}</p>
            </div>
          )}

          {/* Motivo */}
          <div>
            <p className="text-xs font-semibold text-zinc-600 mb-2">Motivo do cancelamento *</p>
            <div className="grid grid-cols-1 gap-1.5">
              {MOTIVOS.map((m) => (
                <button
                  key={m}
                  onClick={() => { setMotivo(m); setErro(''); }}
                  className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border text-sm font-medium text-left cursor-pointer transition-all ${
                    motivo === m
                      ? 'border-red-400 bg-red-50 text-red-700'
                      : 'border-zinc-200 hover:border-zinc-300 text-zinc-700'
                  }`}
                >
                  <div
                    className={`w-4 h-4 flex items-center justify-center rounded-full border-2 flex-shrink-0 ${
                      motivo === m ? 'border-red-500 bg-red-500' : 'border-zinc-300'
                    }`}
                  >
                    {motivo === m && <div className="w-2 h-2 bg-white rounded-full" />}
                  </div>
                  {m}
                </button>
              ))}
            </div>
          </div>

          {/* Motivo Outro */}
          {motivo === 'Outro' && (
            <div>
              <p className="text-xs font-semibold text-zinc-600 mb-1.5">Descreva o motivo *</p>
              <input
                ref={inputRef}
                type="text"
                value={motivoOutro}
                onChange={(e) => { setMotivoOutro(e.target.value); setErro(''); }}
                placeholder="Digite o motivo..."
                className="w-full border border-zinc-200 rounded-xl px-3 py-2.5 text-sm text-zinc-800 focus:outline-none focus:border-red-400 focus:ring-2 focus:ring-red-100"
                maxLength={100}
              />
              <p className="text-[10px] text-zinc-400 text-right mt-0.5">{motivoOutro.length}/100</p>
            </div>
          )}

          {/* Modo de autorização */}
          <div className="space-y-2 pt-1">
            <p className="text-xs font-semibold text-zinc-600 mb-1">Autorização</p>
            <button
              onClick={() => {
                if (!podeAvancar) {
                  setErro('Selecione ou informe o motivo do cancelamento');
                  return;
                }
                setErro('');
                setEtapa('senha');
              }}
              disabled={executando}
              className="w-full flex items-center gap-3 px-3 py-3 rounded-xl border border-amber-200 bg-amber-50 hover:bg-amber-100 text-amber-800 text-sm font-semibold cursor-pointer transition-colors whitespace-nowrap"
            >
              <div className="w-8 h-8 flex items-center justify-center rounded-lg bg-amber-100 flex-shrink-0">
                <i className="ri-shield-keyhole-line text-amber-600" />
              </div>
              <div className="flex-1 text-left">
                <p className="text-sm font-bold">Inserir senha do gerente agora</p>
                <p className="text-[10px] text-amber-600 font-medium">Cancelamento imediato após aprovação</p>
              </div>
              <i className="ri-arrow-right-s-line text-amber-400" />
            </button>

            <button
              onClick={() => {
                if (!podeAvancar) {
                  setErro('Selecione ou informe o motivo do cancelamento');
                  return;
                }
                setErro('');
                handleSolicitarAprovacao();
              }}
              disabled={executando}
              className="w-full flex items-center gap-3 px-3 py-3 rounded-xl border border-zinc-200 bg-white hover:bg-zinc-50 text-zinc-700 text-sm font-semibold cursor-pointer transition-colors whitespace-nowrap"
            >
              <div className="w-8 h-8 flex items-center justify-center rounded-lg bg-zinc-100 flex-shrink-0">
                <i className="ri-send-plane-line text-zinc-500" />
              </div>
              <div className="flex-1 text-left">
                <p className="text-sm font-bold">Solicitar aprovação ao gerente</p>
                <p className="text-[10px] text-zinc-400 font-medium">Aguarde aprovação remota</p>
              </div>
              <i className="ri-arrow-right-s-line text-zinc-300" />
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-zinc-100 flex-shrink-0">
          <button
            onClick={onFechar}
            className="w-full py-2.5 border border-zinc-200 text-zinc-600 text-sm font-semibold rounded-xl cursor-pointer hover:bg-zinc-50 transition-colors whitespace-nowrap"
          >
            Voltar
          </button>
        </div>
      </div>
    </div>
  );
}