import type { KDSPedido, KDSItem, KDSItemStatus } from '@/types/kds';
import { printHTML } from '@/lib/printUtils';

const ORIGEM_LABELS: Record<string, { label: string; cor: string }> = {
  caixa:           { label: 'Caixa',    cor: 'bg-violet-100 text-violet-700 border border-violet-200' },
  garcom:          { label: 'Garçom',   cor: 'bg-sky-100 text-sky-700 border border-sky-200' },
  autoatendimento: { label: 'Kiosk',    cor: 'bg-pink-100 text-pink-700 border border-pink-200' },
  mesa_qr:         { label: 'QR Code',  cor: 'bg-teal-100 text-teal-700 border border-teal-200' },
  mesa:            { label: 'Mesa QR',  cor: 'bg-teal-100 text-teal-700 border border-teal-200' },
  delivery:        { label: 'Delivery', cor: 'bg-orange-100 text-orange-700 border border-orange-200' },
};

const STATUS_CONFIG: Record<KDSItemStatus, { label: string; cls: string; icon: string }> = {
  novo:     { label: 'Aguardando', cls: 'bg-zinc-100 text-zinc-600 border-zinc-200',      icon: 'ri-time-line' },
  preparo:  { label: 'Em Preparo', cls: 'bg-amber-100 text-amber-700 border-amber-200',   icon: 'ri-fire-line' },
  pronto:   { label: 'Pronto',     cls: 'bg-emerald-100 text-emerald-700 border-emerald-200', icon: 'ri-check-double-line' },
  entregue: { label: 'Entregue',   cls: 'bg-zinc-100 text-zinc-400 border-zinc-200',      icon: 'ri-checkbox-circle-fill' },
};

const ORDER_STATUS_CONFIG: Record<string, { label: string; cls: string; icon: string }> = {
  novo:     { label: 'Aguardando',  cls: 'bg-zinc-100 text-zinc-600',      icon: 'ri-time-line' },
  preparo:  { label: 'Em Preparo',  cls: 'bg-amber-100 text-amber-700',    icon: 'ri-fire-line' },
  pronto:   { label: 'Pronto',      cls: 'bg-emerald-100 text-emerald-700',icon: 'ri-check-double-line' },
  entregue: { label: 'Entregue',    cls: 'bg-zinc-100 text-zinc-400',      icon: 'ri-checkbox-circle-fill' },
  em_rota:  { label: 'Em Rota',     cls: 'bg-sky-100 text-sky-600',        icon: 'ri-motorbike-line' },
};

function elapsedStr(criadoEm: number): string {
  const s = Math.floor((Date.now() - criadoEm) / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${String(m % 60).padStart(2, '0')}m`;
  return `${m}m ${String(s % 60).padStart(2, '0')}s`;
}

function destinoLabel(p: KDSPedido): string {
  if (p.destino === 'mesa') return `Mesa ${p.mesaNumero}${p.nomeCliente ? ` · ${p.nomeCliente}` : ''}`;
  if (p.destino === 'delivery' && p.nomeCliente) return `Delivery · ${p.nomeCliente}`;
  if (p.destino === 'delivery') return 'Delivery';
  if (p.nomeCliente) return p.nomeCliente;
  if (p.senha) return `Senha ${p.senha}`;
  return 'Balcão';
}

interface ItemRowProps {
  item: KDSItem;
}
function ItemDetailRow({ item }: ItemRowProps) {
  const isSkip = item.semPreparo || item.skip_kds;
  const statusCfg = STATUS_CONFIG[item.status] ?? STATUS_CONFIG.novo;

  return (
    <div className={`p-3 rounded-xl border ${isSkip ? 'bg-zinc-50 border-zinc-100' : 'bg-white border-zinc-100'}`}>
      <div className="flex items-start gap-3">
        {/* Status */}
        <div className={`mt-0.5 flex items-center gap-1 px-2 py-1 rounded-full border text-[10px] font-bold flex-shrink-0 ${isSkip ? 'bg-zinc-100 text-zinc-400 border-zinc-200' : statusCfg.cls}`}>
          <i className={`${isSkip ? 'ri-subtract-line' : statusCfg.icon} text-[10px]`} />
          {isSkip ? 'Direto' : statusCfg.label}
        </div>

        <div className="flex-1 min-w-0">
          {/* Nome + qty */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-black text-zinc-500 flex-shrink-0">{item.quantidade}x</span>
            <span className={`text-sm font-bold flex-1 min-w-0 ${isSkip ? 'text-zinc-400' : 'text-zinc-800'}`}>
              {item.nome}
            </span>
            {item.item_price != null && item.item_price > 0 && (
              <span className="text-xs font-bold text-zinc-500 ml-auto flex-shrink-0 whitespace-nowrap">
                {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(item.item_price * item.quantidade)}
              </span>
            )}
          </div>

          {/* Categoria + estação */}
          <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
            {item.categoriaNome && (
              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-zinc-100 text-zinc-500 border border-zinc-200">
                {item.categoriaNome}
              </span>
            )}
            {!isSkip && (
              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200">
                <i className="ri-store-2-line text-[9px] mr-0.5" />{item.estacao}
              </span>
            )}
          </div>

          {/* Opções */}
          {item.opcoes && item.opcoes.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {item.opcoes.map((o, i) => (
                <span key={i} className="inline-flex items-center gap-0.5 text-[10px] font-bold px-2 py-0.5 rounded-full bg-orange-50 text-orange-700 border border-orange-200 whitespace-nowrap">
                  <i className="ri-add-line text-[9px]" />{o.opcaoNome}
                </span>
              ))}
            </div>
          )}

          {/* Observações */}
          {item.observacoes && item.observacoes.length > 0 && (
            <div className="mt-1.5 space-y-1">
              {item.observacoes.map((obs, i) => (
                <div key={i} className="flex items-start gap-1.5 text-[11px] font-semibold text-amber-800 bg-amber-50 border border-amber-200 px-2.5 py-1.5 rounded-lg">
                  <i className="ri-alert-fill text-amber-500 text-[10px] flex-shrink-0 mt-0.5" />
                  <span>{obs}</span>
                </div>
              ))}
            </div>
          )}

          {/* Unidades individuais */}
          {item.unidades && item.unidades.length > 1 && (
            <div className="mt-2 flex flex-wrap gap-1">
              <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wide w-full">Unidades</span>
              {item.unidades.map((u, idx) => {
                const uCfg = STATUS_CONFIG[u.status] ?? STATUS_CONFIG.novo;
                return (
                  <span key={u.id} className={`flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-bold ${uCfg.cls}`}>
                    <span className="font-black">{idx + 1}</span>
                    <i className={`${uCfg.icon} text-[9px]`} />
                    {uCfg.label}
                  </span>
                );
              })}
            </div>
          )}

          {/* Timestamps */}
          {!isSkip && (
            <div className="mt-1.5 flex flex-wrap gap-2">
              {item.iniciouPreparoEm && (
                <span className="text-[10px] text-zinc-400">
                  <i className="ri-play-fill text-[9px] mr-0.5 text-amber-500" />
                  {new Date(item.iniciouPreparoEm).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                </span>
              )}
              {item.ficouProntoEm && (
                <span className="text-[10px] text-zinc-400">
                  <i className="ri-check-line text-[9px] mr-0.5 text-emerald-500" />
                  {new Date(item.ficouProntoEm).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                </span>
              )}
              {item.operadorPreparo && (
                <span className="text-[10px] text-zinc-400">
                  <i className="ri-user-line text-[9px] mr-0.5" />{item.operadorPreparo}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

interface Props {
  pedido: KDSPedido;
  onClose: () => void;
  onCancelar?: () => void;
}

export default function PedidoDetailModal({ pedido, onClose, onCancelar }: Props) {
  const origemInfo = ORIGEM_LABELS[pedido.origem] ?? { label: pedido.origem, cor: 'bg-zinc-100 text-zinc-700 border border-zinc-200' };
  const statusCfg = ORDER_STATUS_CONFIG[pedido.status] ?? ORDER_STATUS_CONFIG.novo;
  const kitchenItens = pedido.itens.filter((i) => !i.semPreparo && !i.skip_kds);
  const directItens = pedido.itens.filter((i) => i.semPreparo || i.skip_kds);
  const totalComItens = pedido.itens.reduce((acc, i) => acc + (i.item_price ?? 0) * i.quantidade, 0);
  const displayTotal = pedido.totalAmount > 0 ? pedido.totalAmount : totalComItens;

  const handlePrint = () => {
    printHTML(`<html><head><title>Pedido #${pedido.numero}</title>
      <style>body{font-family:monospace;font-size:12px;padding:16px}h2{margin:0 0 4px}hr{border:1px dashed #000}.item{margin:4px 0}.obs{color:red;font-weight:bold;font-size:11px}p{margin:2px 0;font-size:11px}</style>
      </head><body>
      <h2>Pedido #${String(pedido.numero).padStart(4, '0')}</h2>
      <p>${destinoLabel(pedido)} &mdash; ${origemInfo.label}</p>
      ${pedido.garcomNome ? `<p>Gar&ccedil;om: ${pedido.garcomNome}</p>` : ''}
      <hr/>
      ${pedido.itens.map((i) => `
        <div class="item"><strong>${i.quantidade}x ${i.nome}</strong>
        ${i.opcoes?.length ? `<div style="padding-left:10px;font-size:11px">${i.opcoes.map((o) => `+ ${o.opcaoNome}`).join(', ')}</div>` : ''}
        ${i.observacoes?.length ? `<div class="obs">${i.observacoes.map((o) => `&#9888; ${o}`).join('<br/>')}</div>` : ''}
        </div>`).join('')}
      <hr/>
      ${displayTotal > 0 ? `<p>Total: ${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(displayTotal)}</p>` : ''}
      <small>${new Date().toLocaleString('pt-BR')}</small>
      </body></html>`);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-lg sm:mx-4 overflow-hidden max-h-[92vh] sm:max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Drag handle no mobile */}
        <div className="flex justify-center pt-2 pb-0 sm:hidden">
          <div className="w-10 h-1 rounded-full bg-zinc-200" />
        </div>
        {/* Header */}
        <div className="bg-zinc-50 border-b border-zinc-100 px-5 py-4 flex items-start gap-3 flex-shrink-0">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-lg font-black text-zinc-900 tracking-tight">
                #{String(pedido.numero).padStart(4, '0')}
              </span>
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${origemInfo.cor}`}>
                {origemInfo.label}
              </span>
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1 ${statusCfg.cls}`}>
                <i className={`${statusCfg.icon} text-[9px]`} />{statusCfg.label}
              </span>
              {pedido.isCancelled && (
                <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-red-100 text-red-700 border border-red-200">
                  <i className="ri-close-circle-line text-[9px] mr-0.5" />Cancelado
                </span>
              )}
              {pedido.isPaid && (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 border border-emerald-200">
                  <i className="ri-check-line text-[9px] mr-0.5" />Pago
                </span>
              )}
            </div>

            <div className="flex items-center gap-1.5 mt-1.5">
              <i className={`text-xs text-zinc-400 ${pedido.destino === 'mesa' ? 'ri-table-line' : pedido.destino === 'delivery' ? 'ri-motorbike-line' : 'ri-user-line'}`} />
              <span className="text-sm font-semibold text-zinc-700 truncate">{destinoLabel(pedido)}</span>
            </div>

            {pedido.garcomNome && (
              <div className="flex items-center gap-1 mt-1">
                <i className="ri-walk-line text-zinc-400 text-xs" />
                <span className="text-xs text-zinc-500">Garçom: <strong className="text-zinc-700">{pedido.garcomNome}</strong></span>
              </div>
            )}

            <div className="flex items-center gap-3 mt-1.5 flex-wrap">
              <span className="text-xs text-zinc-400">
                <i className="ri-calendar-line text-[10px] mr-0.5" />
                {new Date(pedido.criadoEm).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
              </span>
              <span className="text-xs text-zinc-400">
                <i className="ri-timer-line text-[10px] mr-0.5" />{elapsedStr(pedido.criadoEm)}
              </span>
              {displayTotal > 0 && (
                <span className="text-sm font-black text-zinc-700">
                  {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(displayTotal)}
                </span>
              )}
            </div>

            {pedido.isCancelled && pedido.cancelReason && (
              <div className="mt-2 flex items-start gap-2 p-2 bg-red-50 border border-red-200 rounded-lg">
                <i className="ri-information-line text-red-500 text-xs flex-shrink-0 mt-0.5" />
                <p className="text-[11px] text-red-700 font-medium">
                  Motivo: <strong>{pedido.cancelReason}</strong>
                </p>
              </div>
            )}
          </div>

          <div className="flex items-center gap-1.5 flex-shrink-0">
            <button
              onClick={handlePrint}
              title="Imprimir comanda"
              className="w-8 h-8 flex items-center justify-center rounded-lg bg-zinc-100 hover:bg-zinc-200 text-zinc-500 cursor-pointer transition-colors"
            >
              <i className="ri-printer-line text-sm" />
            </button>
            <button
              onClick={onClose}
              className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-zinc-200 text-zinc-500 cursor-pointer transition-colors"
            >
              <i className="ri-close-line text-sm" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {kitchenItens.length > 0 && (
            <div>
              <p className="text-[10px] font-black text-zinc-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <i className="ri-fire-line text-amber-500" />
                Itens de Cozinha
                <span className="text-[9px] bg-zinc-100 px-1.5 py-0.5 rounded-full text-zinc-500 font-bold">{kitchenItens.length}</span>
              </p>
              <div className="space-y-2">
                {kitchenItens.map((item) => <ItemDetailRow key={item.id} item={item} />)}
              </div>
            </div>
          )}

          {directItens.length > 0 && (
            <div>
              <p className="text-[10px] font-black text-zinc-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <i className="ri-cup-line text-zinc-400" />
                Direto (sem preparo)
                <span className="text-[9px] bg-zinc-100 px-1.5 py-0.5 rounded-full text-zinc-500 font-bold">{directItens.length}</span>
              </p>
              <div className="space-y-2">
                {directItens.map((item) => <ItemDetailRow key={item.id} item={item} />)}
              </div>
            </div>
          )}

          {/* Totais */}
          {displayTotal > 0 && (
            <div className="border-t border-zinc-100 pt-3 flex items-center justify-between">
              <span className="text-xs font-bold text-zinc-500">Total do Pedido</span>
              <span className="text-base font-black text-zinc-800">
                {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(displayTotal)}
              </span>
            </div>
          )}
        </div>

        {/* Footer */}
        {!pedido.isCancelled && pedido.status !== 'entregue' && onCancelar && (
          <div className="border-t border-zinc-100 px-5 py-4 flex-shrink-0">
            <button
              onClick={() => { onClose(); onCancelar(); }}
              className="w-full flex items-center justify-center gap-2 py-2.5 border border-red-200 text-red-600 text-sm font-bold rounded-xl cursor-pointer hover:bg-red-50 transition-colors whitespace-nowrap"
            >
              <i className="ri-close-circle-line text-sm" />
              Cancelar este Pedido
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
