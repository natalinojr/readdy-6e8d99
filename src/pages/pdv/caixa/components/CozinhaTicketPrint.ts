import type { CarrinhoItem, DestinoInfo } from '../../../../contexts/PDVContext';
import { sendToPrinter } from '@/lib/printUtils';
import type { Impressora } from '@/contexts/ImpressorasContext';

function fmtData() {
  return new Date().toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

function descrDestino(destino: DestinoInfo | null): string {
  if (!destino) return 'Balcao';
  if (destino.tipo === 'mesa') return `Mesa ${destino.mesaNumero}`;
  if (destino.tipo === 'nome') return destino.nomeCliente ?? 'Cliente';
  if (destino.tipo === 'senha') return `Senha: ${destino.senha}`;
  if (destino.tipo === 'delivery') return `DELIVERY — ${destino.nomeCliente}`;
  return 'Balcao';
}

function buildItensHTML(carrinho: CarrinhoItem[]): string {
  return carrinho.map((item) => {
    const opcoesHTML = (item.opcoes ?? [])
      .map(
        (o) =>
          `<div style="margin-left:0;font-size:13px;color:#444;padding:2px 0;">
            &nbsp;&nbsp;+ ${o.opcaoNome}
          </div>`,
      )
      .join('');

    const obsItems = [...(item.observacoes ?? [])];
    if (item.observacaoLivre) obsItems.push(item.observacaoLivre);

    // Observacoes por unidade (se houver)
    const obsUnidadesHTML = (item.obsUnidades ?? [])
      .map((obs, idx) => {
        if (!obs || !obs.trim()) return '';
        return `<div style="margin-left:0;font-size:13px;color:#b91c1c;padding:2px 0;">
            &nbsp;&nbsp;&#9679; Un.${idx + 1}: ${obs}
          </div>`;
      })
      .filter(Boolean)
      .join('');

    const allObsItems = [...obsItems];
    if (obsUnidadesHTML) allObsItems.push('__obs_unidades__');

    const obsHTML =
      allObsItems.length > 0
        ? allObsItems
            .map((obs) => {
              if (obs === '__obs_unidades__') return obsUnidadesHTML;
              return `<div style="
                  background:#000;
                  color:#fff;
                  font-weight:bold;
                  font-size:12px;
                  padding:3px 8px;
                  margin-top:4px;
                  display:inline-block;
                  border-radius:2px;
                  letter-spacing:0.5px;
                ">&#9654; ${obs}</div>`;
            })
            .join('<br/>')
        : '';

    return `
      <div style="
        border: 2px solid #000;
        border-radius: 4px;
        margin-bottom: 12px;
        overflow: hidden;
      ">
        <!-- Qty + Nome -->
        <div style="display:flex;align-items:stretch;">
          <div style="
            background:#000;
            color:#fff;
            font-size:28px;
            font-weight:900;
            min-width:64px;
            display:flex;
            align-items:center;
            justify-content:center;
            padding:10px 8px;
            flex-shrink:0;
            letter-spacing:-1px;
          ">${item.quantidade}x</div>
          <div style="padding:10px 12px;flex:1;">
            <div style="font-size:17px;font-weight:800;line-height:1.2;">${item.nome}</div>
            ${item.categoriaNome ? `<div style="font-size:10px;color:#777;letter-spacing:0.5px;text-transform:uppercase;margin-top:2px;">${item.categoriaNome}</div>` : ''}
            ${opcoesHTML}
          </div>
        </div>
        ${
          obsHTML
            ? `<div style="
                background:#f5f5f5;
                border-top:2px solid #000;
                padding:6px 10px;
              ">
                <div style="font-size:10px;font-weight:700;color:#000;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">OBSERVACOES</div>
                ${obsHTML}
              </div>`
            : ''
        }
      </div>`;
  }).join('');
}

/**
 * Imprime o ticket de cozinha.
 * - Se a impressora for de REDE (tem IP): envia silenciosamente via Edge Function printer-raw
 * - Se a impressora for USB/Windows (sem IP): abre a janela de impressao do navegador
 * - Se nao houver impressora: fallback para janela do navegador
 */
export async function printKitchenTicket(
  numeroPedido: number,
  carrinho: CarrinhoItem[],
  destino: DestinoInfo | null,
  impressora?: Impressora,
): Promise<{ success: boolean; error?: string }> {
  const numStr = String(numeroPedido).padStart(4, '0');
  const dataHora = fmtData();
  const destinoStr = descrDestino(destino);
  const itensHTML = buildItensHTML(carrinho);

  const impressoraHTML = impressora
    ? `<div style="
        display:flex;align-items:center;justify-content:center;gap:6px;
        background:#f5f5f5;border:1px solid #ddd;
        font-size:10px;color:#666;font-weight:bold;
        padding:4px 8px;margin-bottom:10px;border-radius:3px;
        letter-spacing:0.5px;
      ">&#128424; ${impressora.nome}</div>`
    : '';

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8"/>
  <title>VIA COZINHA — PEDIDO #${numStr}</title>
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body {
      font-family: Arial, Helvetica, sans-serif;
      background: #fff;
      color: #000;
      padding: 12px;
      width: 320px;
    }
    @media print {
      body { padding: 6px; width: 100%; }
    }
  </style>
</head>
<body>

  <!-- Header -->
  <div style="text-align:center;border:3px solid #000;padding:8px;margin-bottom:10px;">
    <div style="font-size:11px;font-weight:700;letter-spacing:2px;color:#555;">VIA COZINHA</div>
    <div style="font-size:32px;font-weight:900;letter-spacing:-1px;">PEDIDO #${numStr}</div>
    <div style="font-size:12px;color:#444;margin-top:2px;">${dataHora}</div>
  </div>

  <!-- Destino -->
  <div style="
    background:#000;
    color:#fff;
    font-size:16px;
    font-weight:900;
    text-align:center;
    padding:7px;
    margin-bottom:12px;
    letter-spacing:1px;
    text-transform:uppercase;
  ">${destinoStr}</div>

  ${impressoraHTML}

  <!-- Itens -->
  ${itensHTML}

  <!-- Footer -->
  <div style="border-top:2px dashed #000;margin-top:6px;padding-top:6px;text-align:center;font-size:10px;color:#777;">
    Impresso em ${dataHora}
  </div>

</body>
</html>`;

  return sendToPrinter(html, impressora);
}

function fmtPreco2(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function printSimpleReceipt(
  numeroPedido: number,
  carrinho: CarrinhoItem[],
  total: number,
  desconto: number,
  pagamentos: { formaNome: string; valor: number; troco?: number }[],
  destino: DestinoInfo | null,
): void {
  const numStr = String(numeroPedido).padStart(4, '0');
  const dataHora = fmtData();
  const destinoStr = descrDestino(destino);
  const subtotal = carrinho.reduce((acc, i) => acc + i.precoTotal * i.quantidade, 0);
  const troco = pagamentos.reduce((acc, p) => acc + (p.troco ?? 0), 0);
  const temDinheiro = pagamentos.some(p => /dinheiro/i.test(p.formaNome));

  const itensHTML = carrinho.map((item) => {
    const precoUnit = item.precoTotal;
    const precoLinha = item.precoTotal * item.quantidade;

    // Observacoes por unidade (se houver)
    const obsUnidadesHTML = (item.obsUnidades ?? [])
      .map((obs, idx) => {
        if (!obs || !obs.trim()) return '';
        return `<div style="font-size:10px;color:#b91c1c;margin-left:0;padding:1px 0;">&#9679; Un.${idx + 1}: ${obs}</div>`;
      })
      .filter(Boolean)
      .join('');

    return `
      <div style="margin-bottom:10px;border-bottom:1px dashed #ddd;padding-bottom:8px;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;">
          <div style="flex:1;min-width:0;">
            <div style="font-size:14px;font-weight:700;line-height:1.2;">${item.quantidade}x ${item.nome}</div>
            ${item.categoriaNome ? `<div style="font-size:10px;color:#777;letter-spacing:0.5px;text-transform:uppercase;margin-top:1px;">${item.categoriaNome}</div>` : ''}
            ${obsUnidadesHTML}
          </div>
          <div style="text-align:right;flex-shrink:0;margin-left:8px;">
            <div style="font-size:14px;font-weight:800;">${fmtPreco2(precoLinha)}</div>
            <div style="font-size:10px;color:#888;">un. ${fmtPreco2(precoUnit)}</div>
          </div>
        </div>
      </div>`;
  }).join('');

  const pagamentosHTML = pagamentos.map((p) => `
    <div style="display:flex;justify-content:space-between;margin-bottom:4px;font-size:14px;">
      <span>${p.formaNome}</span>
      <span style="font-weight:bold;">${fmtPreco2(p.valor)}</span>
    </div>`).join('');

  const trocoHTML = troco > 0 && temDinheiro ? `
    <div style="
      background:#000;color:#fff;
      display:flex;justify-content:space-between;
      padding:8px 12px;border-radius:4px;
      font-size:16px;font-weight:900;margin-top:10px;
    ">
      <span>TROCO</span><span>${fmtPreco2(troco)}</span>
    </div>` : '';

  const descontoHTML = desconto > 0 ? `
    <div style="display:flex;justify-content:space-between;margin-bottom:4px;font-size:13px;">
      <span>Desconto</span>
      <span style="color:#c00;">- ${fmtPreco2(desconto)}</span>
    </div>` : '';

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8"/>
  <title>Via Balcao — Pedido #${numStr}</title>
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family: Arial, Helvetica, sans-serif; background:#fff; color:#000; padding:12px; width:300px; }
    @media print { body { padding:6px; width:100%; } }
  </style>
</head>
<body>
  <!-- Header -->
  <div style="text-align:center;margin-bottom:10px;">
    <div style="font-size:11px;color:#666;letter-spacing:1px;">VIA BALCAO</div>
    <div style="font-size:40px;font-weight:900;letter-spacing:-2px;">#${numStr}</div>
    <div style="font-size:11px;color:#444;">${dataHora}</div>
  </div>

  <!-- Destino / Identificacao -->
  <div style="background:#000;color:#fff;text-align:center;padding:8px;font-size:15px;font-weight:900;margin-bottom:12px;border-radius:3px;letter-spacing:0.5px;">
    ${destinoStr}
  </div>

  <!-- Itens -->
  <div style="margin-bottom:10px;">
    ${itensHTML}
  </div>

  <!-- Totais -->
  <div style="border-top:2px solid #000;padding-top:10px;margin-bottom:10px;">
    <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px;">
      <span>Subtotal</span>
      <span>${fmtPreco2(subtotal)}</span>
    </div>
    ${descontoHTML}
    <div style="display:flex;justify-content:space-between;font-size:22px;font-weight:900;margin-bottom:10px;margin-top:6px;">
      <span>TOTAL</span>
      <span>${fmtPreco2(total)}</span>
    </div>
  </div>

  <!-- Pagamentos -->
  <div style="border-top:1px dashed #000;margin-bottom:10px;padding-top:8px;">
    ${pagamentosHTML}
    ${trocoHTML}
  </div>

  <div style="text-align:center;font-size:10px;color:#888;margin-top:6px;border-top:1px dashed #ccc;padding-top:6px;">
    Obrigado!
  </div>
</body>
</html>`;

  import('@/lib/printUtils').then(({ printHTML }) => printHTML(html));
}