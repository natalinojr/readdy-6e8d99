import type { CarrinhoItem, DestinoInfo, PagamentoItem } from '../../../../contexts/PDVContext';
import { sendToPrinter } from '@/lib/printUtils';
import type { Impressora } from '@/contexts/ImpressorasContext';

export interface PedidoVinculadoComprovante {
  numero: number;
  numeroStr?: string;
  itens: { nome: string; quantidade: number; preco: number }[];
  total: number;
  destino?: DestinoInfo | null;
}

interface Props {
  numero: number;
  carrinho: CarrinhoItem[];
  total: number;
  desconto: number;
  destino: DestinoInfo | null;
  pagamentos: PagamentoItem[];
  operador: string;
  loja: string;
  impressora?: Impressora;
  onClose: () => void;
  /** Pedidos vinculados pagos juntos — exibidos no comprovante como seção separada */
  pedidosVinculados?: PedidoVinculadoComprovante[];
}

function fmtPreco(v: number) {
  // Remove o espaço não-quebrável (U+00A0) do toLocaleString: a térmica (CP860)
  // o imprime como "á" (ex.: "R$á8,00").
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }).replace(/\u00A0/g, ' ');
}

function fmtData() {
  return new Date().toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function descrDestino(destino: DestinoInfo | null, numero?: number): string {
  if (!destino) return 'Balcão';
  if (destino.tipo === 'mesa') return `Mesa ${destino.mesaNumero}`;
  if (destino.tipo === 'nome') return destino.nomeCliente ?? '';
  if (destino.tipo === 'senha') return `Senha: ${destino.senha}`;
  if (destino.tipo === 'delivery') return numero != null ? `Pedido #${String(numero).padStart(4, '0')}` : `Delivery · ${destino.nomeCliente}`;
  if (destino.tipo === 'hora') return 'Fechar na Hora';
  return 'Balcão';
}

function buildItensHTML(carrinho: CarrinhoItem[]): string {
  return carrinho.map((item) => {
    const opcoesHTML = (item.opcoes ?? [])
      .map((o) => `<div style="padding-left:12px;font-size:10px;color:#555;">${o.obrigatorio ? '' : '+ '}${o.opcaoNome}${o.precoAdicional > 0 ? ` (+${fmtPreco(o.precoAdicional)})` : ''}</div>`)
      .join('');
    const obsHTML = item.observacaoLivre
      ? `<div style="padding-left:12px;font-size:10px;color:#777;">Obs: ${item.observacaoLivre}</div>`
      : '';
    const obsListHTML = (item.observacoes ?? []).length > 0
      ? `<div style="padding-left:12px;font-size:10px;color:#777;">${item.observacoes.join(' · ')}</div>`
      : '';
    return `
      <div style="margin-bottom:6px;">
        <div style="display:flex;justify-content:space-between;">
          <span style="flex:1;">${item.quantidade}x ${item.nome}</span>
          <span style="font-weight:bold;">${fmtPreco(item.precoTotal * item.quantidade)}</span>
        </div>
        ${opcoesHTML}${obsListHTML}${obsHTML}
      </div>`;
  }).join('');
}

function buildPedidosVinculadosHTML(pedidos: PedidoVinculadoComprovante[]): string {
  if (pedidos.length === 0) return '';

  return pedidos.map((pedido) => {
    const numStr = pedido.numeroStr || String(pedido.numero).padStart(4, '0');
    const itensHTML = pedido.itens.map((item) => `
      <div style="margin-bottom:4px;">
        <div style="display:flex;justify-content:space-between;">
          <span style="flex:1;">${item.quantidade}x ${item.nome}</span>
          <span style="font-weight:bold;">${fmtPreco(item.preco * item.quantidade)}</span>
        </div>
      </div>`).join('');

    return `
      <div style="margin-bottom:8px;">
        <div style="font-weight:bold;font-size:11px;color:#000;margin-bottom:4px;padding:4px 0;border-bottom:1px dashed #ccc;">
          Pedido #${numStr} · ${descrDestino(pedido.destino ?? null, pedido.numero)} · ${fmtPreco(pedido.total)}
        </div>
        ${itensHTML}
      </div>`;
  }).join('');
}

function buildReceiptHTML(props: Omit<Props, 'onClose'>): string {
  const { numero, carrinho, total, desconto, destino, pagamentos, operador, loja, pedidosVinculados } = props;
  const subtotal = carrinho.reduce((acc, i) => acc + i.precoTotal * i.quantidade, 0);
  const troco = pagamentos.reduce((acc, p) => acc + (p.troco ?? 0), 0);
  const dataHora = fmtData();
  const numStr = String(numero).padStart(4, '0');
  const temVinculados = (pedidosVinculados ?? []).length > 0;
  const totalVinculados = (pedidosVinculados ?? []).reduce((s, p) => s + p.total, 0);
  // total = total FINAL (já inclui carrinho + vinculados - desconto)
  // pedidosVinculados é só para exibir itens separados no comprovante
  const totalGeral = total;

  const itensHTML = buildItensHTML(carrinho);
  const pedidosVinculadosHTML = buildPedidosVinculadosHTML(pedidosVinculados ?? []);

  const pagamentosHTML = pagamentos.map((p) => `
    <div style="display:flex;justify-content:space-between;margin-bottom:3px;">
      <span>${p.formaNome}</span>
      <span>${fmtPreco(p.valor)}</span>
    </div>`).join('');

  const descontoHTML = desconto > 0 ? `
    <div style="display:flex;justify-content:space-between;margin-bottom:3px;">
      <span>Desconto</span>
      <span>- ${fmtPreco(desconto)}</span>
    </div>` : '';

  const trocoHTML = troco > 0 ? `
    <div style="display:flex;justify-content:space-between;font-weight:bold;margin-bottom:3px;">
      <span>Troco</span>
      <span>${fmtPreco(troco)}</span>
    </div>` : '';

  const vinculadosHeader = temVinculados ? `
    <div style="display:flex;justify-content:space-between;margin-bottom:3px;">
      <span>Pedidos vinculados (${pedidosVinculados!.length})</span>
      <span>${fmtPreco(totalVinculados)}</span>
    </div>` : '';

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8"/>
  <title>Comprovante #${numStr}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Courier New', Courier, monospace;
      font-size: 12px;
      color: #000;
      background: #fff;
      padding: 16px;
      width: 300px;
    }
    .divider {
      border: none;
      border-top: 1px dashed #000;
      margin: 8px 0;
    }
    @media print {
      body { padding: 8px; }
      button { display: none !important; }
    }
  </style>
</head>
<body>
  <div style="text-align:center;font-size:15px;font-weight:bold;margin-bottom:2px;">${loja}</div>
  <div style="text-align:center;font-size:10px;margin-bottom:2px;">
    ${temVinculados ? 'Pagamento Unificado' : `Pedido #${numStr}`} · ${dataHora}
  </div>
  <div style="text-align:center;font-size:10px;margin-bottom:4px;">Operador: ${operador}</div>

  <hr class="divider"/>

  ${!temVinculados ? `
  <div style="display:flex;justify-content:space-between;margin-bottom:3px;">
    <span>Destino:</span>
    <span style="font-weight:bold;">${descrDestino(destino, numero)}</span>
  </div>
  <hr class="divider"/>
  ` : ''}

  ${!temVinculados ? itensHTML : `
  <div style="font-weight:bold;font-size:11px;margin-bottom:4px;padding:4px 0;border-bottom:1px dashed #ccc;">
    Pedido #${numStr} · ${descrDestino(destino, numero)} · ${fmtPreco(subtotal)}
  </div>
  ${itensHTML}
  `}

  ${temVinculados ? `
  <hr class="divider"/>
  ${pedidosVinculadosHTML}
  ` : ''}

  <hr class="divider"/>

  <div style="display:flex;justify-content:space-between;margin-bottom:3px;">
    <span>Subtotal</span>
    <span>${fmtPreco(subtotal)}</span>
  </div>
  ${vinculadosHeader}
  ${descontoHTML}
  <div style="display:flex;justify-content:space-between;font-size:14px;font-weight:bold;margin-bottom:3px;">
    <span>TOTAL GERAL</span>
    <span>${fmtPreco(totalGeral)}</span>
  </div>

  <hr class="divider"/>

  ${pagamentosHTML}
  ${trocoHTML}

  <hr class="divider"/>

  <div style="text-align:center;font-size:10px;margin-top:4px;">Obrigado pela preferência!</div>
  <div style="text-align:center;font-size:10px;">Volte sempre 🙂</div>
</body>
</html>`;
}

export default function ComprovantePrint({
  numero, carrinho, total, desconto, destino, pagamentos, operador, loja, impressora, onClose,
  pedidosVinculados,
}: Props) {
  const troco = pagamentos.reduce((acc, p) => acc + (p.troco ?? 0), 0);
  const subtotal = carrinho.reduce((acc, i) => acc + i.precoTotal * i.quantidade, 0);
  const temVinculados = (pedidosVinculados ?? []).length > 0;
  const totalVinculados = (pedidosVinculados ?? []).reduce((s, p) => s + p.total, 0);
  // total = total FINAL (já inclui carrinho + vinculados - desconto)
  const totalGeral = total;

  const handlePrint = () => {
    const html = buildReceiptHTML({ numero, carrinho, total, desconto, destino, pagamentos, operador, loja, pedidosVinculados });
    sendToPrinter(html, impressora);
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-100">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 flex items-center justify-center text-amber-500">
              <i className="ri-receipt-line text-xl" />
            </div>
            <div>
              <p className="text-sm font-bold text-zinc-900">
                {temVinculados ? 'Comprovante Unificado' : `Comprovante #${String(numero).padStart(4, '0')}`}
              </p>
              <p className="text-xs text-zinc-500">{fmtData()}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center text-zinc-400 hover:text-zinc-600 rounded-lg cursor-pointer"
          >
            <i className="ri-close-line text-lg" />
          </button>
        </div>

        {/* Preview do comprovante */}
        <div className="p-5 max-h-80 overflow-y-auto">
          <div className="font-mono text-xs text-zinc-800 leading-relaxed space-y-1">
            <div className="text-center font-bold text-sm">{loja}</div>
            <div className="text-center text-zinc-500 text-[10px]">
              {temVinculados ? 'Pagamento Unificado' : `Pedido #${String(numero).padStart(4, '0')}`} · {fmtData()}
            </div>
            <div className="text-center text-zinc-500 text-[10px]">Operador: {operador}</div>
            <div className="border-t border-dashed border-zinc-400 my-2" />

            {!temVinculados && (
              <div className="flex justify-between">
                <span className="text-zinc-500">Destino:</span>
                <span className="font-bold">{descrDestino(destino, numero)}</span>
              </div>
            )}
            {!temVinculados && <div className="border-t border-dashed border-zinc-400 my-2" />}

            {/* Pedido principal */}
            <div className="mb-1">
              {temVinculados && (
                <div className="font-bold text-[10px] text-zinc-700 mb-1 pb-1 border-b border-dashed border-zinc-300">
                  Pedido #{String(numero).padStart(4, '0')} · {descrDestino(destino, numero)} · {fmtPreco(subtotal)}
                </div>
              )}
              {carrinho.map((item, idx) => (
                <div key={idx} className="mb-1">
                  <div className="flex justify-between">
                    <span className="flex-1">{item.quantidade}x {item.nome}</span>
                    <span className="font-bold">{fmtPreco(item.precoTotal * item.quantidade)}</span>
                  </div>
                  {(item.opcoes ?? []).map((o, i) => (
                    <div key={i} className="pl-3 text-[10px] text-zinc-400">{o.obrigatorio ? '' : '+ '}{o.opcaoNome}</div>
                  ))}
                  {item.observacaoLivre && (
                    <div className="pl-3 text-[10px] text-amber-500">Obs: {item.observacaoLivre}</div>
                  )}
                </div>
              ))}
            </div>

            {/* Pedidos vinculados */}
            {temVinculados && (
              <>
                <div className="border-t border-dashed border-zinc-400 my-2" />
                {(pedidosVinculados ?? []).map((pedido, pidx) => (
                  <div key={pidx} className="mb-2">
                    <div className="font-bold text-[10px] text-zinc-700 mb-1 pb-1 border-b border-dashed border-zinc-300">
                      Pedido #{pedido.numeroStr || String(pedido.numero).padStart(4, '0')} · {descrDestino(pedido.destino ?? null, pedido.numero)} · {fmtPreco(pedido.total)}
                    </div>
                    {pedido.itens.map((item, idx) => (
                      <div key={idx} className="mb-0.5">
                        <div className="flex justify-between">
                          <span className="flex-1">{item.quantidade}x {item.nome}</span>
                          <span className="font-bold">{fmtPreco(item.preco * item.quantidade)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                ))}
              </>
            )}

            <div className="border-t border-dashed border-zinc-400 my-2" />
            <div className="flex justify-between text-zinc-500">
              <span>Subtotal</span>
              <span>{fmtPreco(subtotal)}</span>
            </div>
            {temVinculados && (
              <div className="flex justify-between text-zinc-500">
                <span>Pedidos vinculados ({pedidosVinculados!.length})</span>
                <span>{fmtPreco(totalVinculados)}</span>
              </div>
            )}
            {desconto > 0 && (
              <div className="flex justify-between text-green-600">
                <span>Desconto</span>
                <span>-{fmtPreco(desconto)}</span>
              </div>
            )}
            <div className="flex justify-between font-bold">
              <span>TOTAL GERAL</span>
              <span>{fmtPreco(totalGeral)}</span>
            </div>
            <div className="border-t border-dashed border-zinc-400 my-2" />
            {pagamentos.map((p, idx) => (
              <div key={idx} className="flex justify-between text-zinc-500">
                <span>{p.formaNome}</span>
                <span>{fmtPreco(p.valor)}</span>
              </div>
            ))}
            {troco > 0 && (
              <div className="flex justify-between font-bold text-zinc-800">
                <span>Troco</span>
                <span>{fmtPreco(troco)}</span>
              </div>
            )}
            <div className="border-t border-dashed border-zinc-400 my-2" />
            <div className="text-center text-zinc-400 text-[10px]">Obrigado pela preferência!</div>
            <div className="text-center text-zinc-400 text-[10px]">Volte sempre</div>
          </div>
        </div>

        {/* Actions */}
        <div className="px-5 py-4 border-t border-zinc-100 flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 border border-zinc-200 text-zinc-600 text-sm font-medium rounded-xl hover:bg-zinc-50 cursor-pointer transition-colors whitespace-nowrap"
          >
            Fechar
          </button>
          <button
            onClick={handlePrint}
            className="flex-1 py-2.5 bg-amber-500 hover:bg-amber-600 text-white text-sm font-bold rounded-xl cursor-pointer transition-colors whitespace-nowrap flex items-center justify-center gap-2"
          >
            <i className="ri-printer-line" />
            {impressora ? `Imprimir (${impressora.nome})` : 'Imprimir'}
          </button>
        </div>
      </div>
    </div>
  );
}