import { useRef } from 'react';
import type { PedidoRecente } from '@/types/pdv';
import { printHTML } from '@/lib/printUtils';

interface Props {
  pedido: PedidoRecente;
  onClose: () => void;
}

function fmt(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function destinoLabel(p: PedidoRecente) {
  if (p.destino === 'mesa') return `Mesa ${p.mesaNumero}`;
  if (p.destino === 'nome') return p.nomeCliente ?? 'Balcão';
  if (p.destino === 'senha') return `Senha: ${p.senha}`;
  if (p.destino === 'delivery') return `Delivery · ${p.nomeCliente}`;
  return 'Balcão';
}

const ORIGEM_LABEL: Record<string, string> = {
  caixa: 'Caixa', garcom: 'Garçom', mesa: 'Mesa (cliente)',
  autoatendimento: 'Autoatendimento',
};

const STATUS_LABEL: Record<string, string> = {
  aberto: 'Em Preparo', pronto: 'Pronto p/ Entregar',
  entregue: 'Entregue', cancelado: 'Cancelado',
};

export default function ImprimirPedidoModal({ pedido, onClose }: Props) {
  const printRef = useRef<HTMLDivElement>(null);

  const handlePrint = () => {
    const conteudo = printRef.current?.innerHTML ?? '';
    printHTML(`<!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8"/>
        <title>Pedido #${String(pedido.numero).padStart(4, '0')}</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { font-family: 'Courier New', monospace; font-size: 12px; color: #000; padding: 16px; width: 300px; }
          .center { text-align: center; }
          .bold { font-weight: bold; }
          .divider { border-top: 1px dashed #000; margin: 8px 0; }
          .row { display: flex; justify-content: space-between; margin-bottom: 4px; }
          .small { font-size: 10px; color: #555; }
          .total-line { font-size: 13px; font-weight: bold; }
          .tag { display: inline-block; border: 1px solid #000; padding: 1px 4px; font-size: 9px; border-radius: 3px; }
          @media print { button { display: none !important; } }
        </style>
      </head>
      <body>${conteudo}</body>
      </html>`);
  };

  const subtotal = pedido.itensDetalhes.reduce((acc, i) => acc + i.preco * i.quantidade, 0);

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden flex flex-col max-h-[90vh]">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-zinc-100 flex-shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 flex items-center justify-center text-amber-500">
              <i className="ri-receipt-line text-xl" />
            </div>
            <div>
              <p className="text-sm font-bold text-zinc-900">
                Pedido #{String(pedido.numero).padStart(4, '0')}
              </p>
              <p className="text-xs text-zinc-400">{pedido.criadoEm} · {ORIGEM_LABEL[pedido.origem] ?? pedido.origem}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
              pedido.status === 'pronto'    ? 'bg-green-100 text-green-700 border-green-200'
              : pedido.status === 'aberto'  ? 'bg-amber-100 text-amber-700 border-amber-200'
              : pedido.status === 'entregue'? 'bg-zinc-100 text-zinc-500 border-zinc-200'
              : 'bg-red-100 text-red-600 border-red-200'
            }`}>
              {STATUS_LABEL[pedido.status]}
            </span>
            <button
              onClick={onClose}
              className="w-7 h-7 flex items-center justify-center rounded-lg bg-zinc-100 hover:bg-zinc-200 text-zinc-500 cursor-pointer transition-colors"
            >
              <i className="ri-close-line text-sm" />
            </button>
          </div>
        </div>

        {/* Preview comprovante */}
        <div className="flex-1 overflow-y-auto p-5">
          <div
            ref={printRef}
            className="font-mono text-xs text-zinc-800 leading-relaxed"
          >
            {/* Cabeçalho */}
            <div className="center bold" style={{ fontSize: 14 }}>COMPROVANTE DE PEDIDO</div>
            <div className="center small">#{String(pedido.numero).padStart(4, '0')} · {pedido.criadoEm}</div>
            <div className="divider" style={{ borderTop: '1px dashed #999', margin: '6px 0' }} />

            <div className="row">
              <span>Destino:</span>
              <span className="bold">{destinoLabel(pedido)}</span>
            </div>
            <div className="row">
              <span>Origem:</span>
              <span>{ORIGEM_LABEL[pedido.origem] ?? pedido.origem}</span>
            </div>
            {pedido.garcomNome && (
              <div className="row">
                <span>Garçom:</span>
                <span>{pedido.garcomNome}</span>
              </div>
            )}
            <div className="row">
              <span>Status:</span>
              <span className="bold">{STATUS_LABEL[pedido.status]}</span>
            </div>

            <div className="divider" style={{ borderTop: '1px dashed #999', margin: '6px 0' }} />

            {/* Itens */}
            {pedido.itensDetalhes.map((item) => (
              <div key={item.id} className="mb-2">
                <div className="row">
                  <span style={{ flex: 1 }}>
                    {item.quantidade > 1 ? `${item.quantidade}x ` : ''}{item.nome}
                  </span>
                  <span className="bold" style={{ marginLeft: 8 }}>
                    {fmt(item.preco * item.quantidade)}
                  </span>
                </div>
                {item.opcoes.length > 0 && (
                  <div className="small" style={{ paddingLeft: 12 }}>
                    {item.opcoes.join(' · ')}
                  </div>
                )}
                {item.observacao && (
                  <div className="small" style={{ paddingLeft: 12 }}>
                    Obs: {item.observacao}
                  </div>
                )}
                {/* Status de preparo por item */}
                <div className="small" style={{ paddingLeft: 12 }}>
                  Cozinha: {item.estacao} ·{' '}
                  {item.unidades.filter(u => u.status === 'entregue').length}/{item.quantidade} entregue(s)
                </div>
              </div>
            ))}

            <div className="divider" style={{ borderTop: '1px dashed #999', margin: '6px 0' }} />

            <div className="row">
              <span>Subtotal</span>
              <span>{fmt(subtotal)}</span>
            </div>
            <div className="row total-line" style={{ fontSize: 13 }}>
              <span className="bold">TOTAL</span>
              <span className="bold">{fmt(pedido.total)}</span>
            </div>

            <div className="divider" style={{ borderTop: '1px dashed #999', margin: '6px 0' }} />
            <div className="center small">
              {pedido.itensProntos}/{pedido.itensTotal} itens prontos
            </div>
            <div className="divider" style={{ borderTop: '1px dashed #999', margin: '6px 0' }} />
            <div className="center small">Via do Cliente</div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 border-t border-zinc-100 flex gap-3 flex-shrink-0">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 border border-zinc-200 text-zinc-600 text-sm font-semibold rounded-xl hover:bg-zinc-50 cursor-pointer transition-colors whitespace-nowrap"
          >
            Fechar
          </button>
          <button
            onClick={handlePrint}
            className="flex-1 py-2.5 bg-zinc-900 hover:bg-zinc-800 text-white text-sm font-bold rounded-xl cursor-pointer transition-colors whitespace-nowrap flex items-center justify-center gap-2"
          >
            <i className="ri-printer-line text-base text-amber-400" />
            Imprimir
          </button>
        </div>
      </div>
    </div>
  );
}
