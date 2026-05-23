import { useState } from 'react';
import type { KDSPedido } from '@/types/kds';
import AutorizacaoGerenteModal from '@/components/feature/AutorizacaoGerenteModal';

const MOTIVOS_RAPIDOS = [
  'Solicitação do cliente',
  'Erro no pedido',
  'Produto indisponível',
  'Demora excessiva',
  'Problema de pagamento',
];

interface Props {
  pedido: KDSPedido;
  loading?: boolean;
  /** Perfil do usuário logado — se for cozinha ou garçom, exige autorização */
  perfilUsuario?: string;
  tenantId?: string;
  onConfirm: (reason: string, autorizadoPor?: string) => void;
  onCancel: () => void;
}

function destinoStr(p: KDSPedido): string {
  if (p.destino === 'mesa') return `Mesa ${p.mesaNumero}${p.nomeCliente ? ` · ${p.nomeCliente}` : ''}`;
  if (p.destino === 'delivery' && p.nomeCliente) return `Delivery · ${p.nomeCliente}`;
  if (p.destino === 'delivery') return 'Delivery';
  if (p.nomeCliente) return p.nomeCliente;
  return 'Balcão';
}

/** Perfis que precisam de autorização para cancelar */
const PERFIS_RESTRITOS = ['cozinha', 'garcom'];

type Passo = 'motivo' | 'autorizacao';

export default function CancelOrderModal({
  pedido, loading, perfilUsuario, tenantId, onConfirm, onCancel,
}: Props) {
  const [motivo, setMotivo] = useState('');
  const [motivoCustom, setMotivoCustom] = useState('');
  const [passo, setPasso] = useState<Passo>('motivo');

  const motivoFinal = motivo === '__custom' ? motivoCustom.trim() : motivo;
  const precisaAutorizacao = perfilUsuario ? PERFIS_RESTRITOS.includes(perfilUsuario) : false;
  const canSubmit = motivoFinal.length > 0 && !loading;

  const handleAvancar = () => {
    if (!canSubmit) return;
    if (precisaAutorizacao) {
      setPasso('autorizacao');
    } else {
      onConfirm(motivoFinal);
    }
  };

  const handleAutorizado = (autorizadoPor: string) => {
    onConfirm(motivoFinal, autorizadoPor);
  };

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm">
        <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md sm:mx-4 overflow-hidden max-h-[92vh] overflow-y-auto">
          {/* Drag handle no mobile */}
          <div className="flex justify-center pt-2 pb-0 sm:hidden">
            <div className="w-10 h-1 rounded-full bg-zinc-200" />
          </div>

          {/* Header */}
          <div className="bg-red-50 border-b border-red-100 px-5 py-4 flex items-center gap-3">
            <div className="w-10 h-10 flex items-center justify-center rounded-xl bg-red-100 flex-shrink-0">
              <i className="ri-close-circle-line text-red-600 text-lg" />
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-sm font-black text-red-700 leading-none">Cancelar Pedido</h2>
              <p className="text-xs text-red-500 mt-0.5">
                #{String(pedido.numero).padStart(4, '0')} &mdash; {destinoStr(pedido)}
              </p>
            </div>
            <button
              onClick={onCancel}
              className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-red-100 text-red-400 cursor-pointer transition-colors"
            >
              <i className="ri-close-line text-base" />
            </button>
          </div>

          <div className="p-5 space-y-4">
            {/* Indicador de passos — só mostra se precisar de autorização */}
            {precisaAutorizacao && (
              <div className="flex items-center gap-2">
                <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold ${passo === 'motivo' ? 'bg-red-600 text-white' : 'bg-zinc-100 text-zinc-400 line-through'}`}>
                  <span>1</span>
                  <span>Motivo</span>
                </div>
                <i className="ri-arrow-right-line text-zinc-300 text-xs" />
                <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold ${passo === 'autorizacao' ? 'bg-amber-500 text-white' : 'bg-zinc-100 text-zinc-400'}`}>
                  <span>2</span>
                  <i className="ri-shield-keyhole-line" />
                  <span>Autorização</span>
                </div>
              </div>
            )}

            {/* Aviso */}
            <div className="flex items-start gap-2.5 p-3 bg-amber-50 border border-amber-200 rounded-xl">
              <i className="ri-alert-line text-amber-600 text-sm flex-shrink-0 mt-0.5" />
              <p className="text-xs text-amber-700 font-medium leading-relaxed">
                Esta ação <strong>não pode ser desfeita</strong>. O pedido será marcado como
                cancelado e ficará visível com destaque no histórico da sessão.
                {precisaAutorizacao && (
                  <span className="block mt-1 text-amber-800 font-bold">
                    <i className="ri-shield-keyhole-line mr-0.5" />
                    Requer autorização de gerente ou administrador.
                  </span>
                )}
              </p>
            </div>

            {/* Motivos rápidos */}
            <div>
              <p className="text-xs font-bold text-zinc-600 uppercase tracking-wider mb-2.5">
                Motivo do cancelamento
              </p>
              <div className="flex flex-wrap gap-2 mb-3">
                {MOTIVOS_RAPIDOS.map((m) => (
                  <button
                    key={m}
                    onClick={() => { setMotivo(m); setMotivoCustom(''); }}
                    className={`text-xs font-semibold px-3 py-1.5 rounded-full border transition-all cursor-pointer whitespace-nowrap ${
                      motivo === m
                        ? 'bg-red-600 text-white border-red-600'
                        : 'bg-zinc-50 text-zinc-600 border-zinc-200 hover:border-zinc-300 hover:bg-zinc-100'
                    }`}
                  >
                    {m}
                  </button>
                ))}
                <button
                  onClick={() => setMotivo('__custom')}
                  className={`text-xs font-semibold px-3 py-1.5 rounded-full border transition-all cursor-pointer whitespace-nowrap ${
                    motivo === '__custom'
                      ? 'bg-zinc-800 text-white border-zinc-800'
                      : 'bg-zinc-50 text-zinc-600 border-zinc-200 hover:border-zinc-300 hover:bg-zinc-100'
                  }`}
                >
                  <i className="ri-edit-line text-xs mr-1" />
                  Outro
                </button>
              </div>

              {motivo === '__custom' && (
                <textarea
                  autoFocus
                  value={motivoCustom}
                  onChange={(e) => setMotivoCustom(e.target.value)}
                  placeholder="Descreva o motivo do cancelamento..."
                  maxLength={200}
                  rows={3}
                  className="w-full text-xs border border-zinc-200 rounded-xl px-3 py-2.5 text-zinc-800 resize-none focus:outline-none focus:border-red-400 bg-zinc-50"
                />
              )}
            </div>
          </div>

          {/* Footer */}
          <div className="px-5 pb-5 flex items-center gap-2.5">
            <button
              onClick={onCancel}
              disabled={loading}
              className="flex-1 py-2.5 border border-zinc-200 text-zinc-600 text-sm font-semibold rounded-xl cursor-pointer hover:bg-zinc-50 transition-colors whitespace-nowrap"
            >
              Voltar
            </button>
            <button
              onClick={handleAvancar}
              disabled={!canSubmit}
              className={`flex-1 py-2.5 text-sm font-bold rounded-xl transition-colors whitespace-nowrap flex items-center justify-center gap-2 ${
                canSubmit
                  ? precisaAutorizacao
                    ? 'bg-amber-500 hover:bg-amber-600 text-white cursor-pointer'
                    : 'bg-red-600 hover:bg-red-700 text-white cursor-pointer'
                  : 'bg-zinc-100 text-zinc-400 cursor-not-allowed'
              }`}
            >
              {loading ? (
                <>
                  <i className="ri-loader-4-line animate-spin text-sm" />
                  Cancelando...
                </>
              ) : precisaAutorizacao ? (
                <>
                  <i className="ri-shield-keyhole-line text-sm" />
                  Solicitar Autorização
                </>
              ) : (
                <>
                  <i className="ri-close-circle-line text-sm" />
                  Confirmar Cancelamento
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Modal de autorização — aparece sobre o CancelOrderModal */}
      {passo === 'autorizacao' && tenantId && (
        <AutorizacaoGerenteModal
          titulo="Autorizar Cancelamento"
          descricao="Informe as credenciais de um gerente ou administrador para cancelar este pedido."
          tenantId={tenantId}
          onAutorizado={handleAutorizado}
          onCancelar={() => setPasso('motivo')}
        />
      )}
    </>
  );
}
