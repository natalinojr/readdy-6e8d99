import type { CarrinhoItem, DestinoInfo } from '../../../../contexts/PDVContext';
import { sendToPrinter, type TicketPayload, type TicketItem, type PrintResult } from '@/lib/printUtils';
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

    const obsItemsSet = new Set<string>();
    const obsItems: string[] = [];
    const addObsItem = (text: string | undefined | null) => {
      const t = text?.trim();
      if (!t) return;
      if (obsItemsSet.has(t)) return;
      obsItemsSet.add(t);
      obsItems.push(t);
    };

    addObsItem(item.observacaoLivre);
    item.observacoes?.forEach((obs) => addObsItem(obs));

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

function buildTicketPayload(
  numeroPedido: number,
  carrinho: CarrinhoItem[],
  destino: DestinoInfo | null,
  impressora?: Impressora,
): TicketPayload {
  const destinoStr = descrDestino(destino);
  const mesaStr = destino?.tipo === 'mesa' ? String(destino.mesaNumero ?? '') : undefined;

  const itens: TicketItem[] = carrinho.map((item) => {
    const opcoes = item.opcoes?.map((o) => o.opcaoNome) ?? [];

    const observacoesSet = new Set<string>();
    const observacoes: string[] = [];
    const addObs = (text: string | undefined | null) => {
      const t = text?.trim();
      if (!t) return;
      if (observacoesSet.has(t)) return;
      observacoesSet.add(t);
      observacoes.push(t);
    };

    addObs(item.observacaoLivre);
    item.observacoes?.forEach((obs) => addObs(obs));
    item.obsUnidades?.forEach((obs, idx) => {
      if (obs?.trim()) observacoes.push(`Un.${idx + 1}: ${obs.trim()}`);
    });

    return {
      quantidade: item.quantidade,
      nome: item.nome,
      opcoes: opcoes.length > 0 ? opcoes : undefined,
      observacoes: observacoes.length > 0 ? observacoes : undefined,
    };
  });

  return {
    numero: numeroPedido,
    destino: destinoStr,
    origem: 'caixa',
    impressora_id: impressora?.id || 'cozinha',
    itens,
    data_hora: fmtData(),
    ...(mesaStr ? { mesa: mesaStr } : {}),
    ...(destino?.observacaoPedido ? { observacao_geral: destino.observacaoPedido } : {}),
  };
}

function buildKitchenHTML(
  numeroPedido: number,
  carrinho: CarrinhoItem[],
  destino: DestinoInfo | null,
  impressora?: Impressora,
): string {
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

  return `<!DOCTYPE html>
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
  <div style="text-align:center;border:3px solid #000;padding:8px;margin-bottom:10px;">
    <div style="font-size:11px;font-weight:700;letter-spacing:2px;color:#555;">VIA COZINHA</div>
    <div style="font-size:32px;font-weight:900;letter-spacing:-1px;">PEDIDO #${numStr}</div>
    <div style="font-size:12px;color:#444;margin-top:2px;">${dataHora}</div>
  </div>
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
  ${itensHTML}
  <div style="border-top:2px dashed #000;margin-top:6px;padding-top:6px;text-align:center;font-size:10px;color:#777;">
    Impresso em ${dataHora}
  </div>
</body>
</html>`;
}

/**
 * Imprime o ticket de cozinha.
 * 1. SEMPRE tenta enviar JSON estruturado pro agente local primeiro (silencioso).
 *    O agente formata ESC/POS sozinho. Se nao responder, continua o fluxo.
 * 2. Se tiver impressora com IP: usa sendToPrinter com fallback automatico.
 * 3. Se nao tiver impressora: fallback navegador (se nao suprimido).
 */
export async function printKitchenTicket(
  numeroPedido: number,
  carrinho: CarrinhoItem[],
  destino: DestinoInfo | null,
  impressora?: Impressora,
  suppressBrowserFallback = false,
): Promise<PrintResult> {
  console.log('[CozinhaTicketPrint] printKitchenTicket chamado. Pedido:', numeroPedido, 'Itens:', carrinho.length, 'suppressFallback:', suppressBrowserFallback);
  console.log('[CozinhaTicketPrint] impressora:', impressora ? `${impressora.nome} (id=${impressora.id}, ip=${impressora.ip || 'n/a'})` : 'NENHUMA');

  // SEMPRE monta o payload JSON — mesmo sem impressora configurada
  // O agente local resolve o IP pelo config.json usando impressora_id
  const payload = buildTicketPayload(numeroPedido, carrinho, destino, impressora);
  console.log('[CozinhaTicketPrint] payload montado:', JSON.stringify(payload, null, 2));

  const html = buildKitchenHTML(numeroPedido, carrinho, destino, impressora);

  // SEMPRE passa orderData (payload) pro sendToPrinter
  // sendToPrinter tenta agente local com JSON primeiro, antes de qualquer fallback
  const result = await sendToPrinter(html, impressora, payload, { suppressBrowserFallback });

  if (result.fallbackToBrowser) {
    console.warn('[CozinhaTicketPrint] Caiu no fallback do navegador. Motivo:', result.error);
    return {
      ...result,
      fallbackToBrowser: true,
      error: result.error || 'Agente local nao respondeu. Abrindo janela do navegador.',
    };
  }

  return result;
}

function fmtPreco2(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export async function printSimpleReceipt(
  numeroPedido: number,
  carrinho: CarrinhoItem[],
  total: number,
  desconto: number,
  pagamentos: { formaNome: string; valor: number; troco?: number }[],
  destino: DestinoInfo | null,
  impressora?: Impressora,
  suppressBrowserFallback = false,
  /** Pedidos vinculados para exibir no comprovante unificado */
  pedidosVinculados?: { numero: number; numeroStr?: string; itens: { nome: string; quantidade: number; preco: number }[]; total: number; destino?: DestinoInfo | null }[],
): Promise<PrintResult> {
  const numStr = String(numeroPedido).padStart(4, '0');
  const dataHora = fmtData();
  const destinoStr = descrDestino(destino);
  const subtotal = carrinho.reduce((acc, i) => acc + i.precoTotal * i.quantidade, 0);
  const troco = pagamentos.reduce((acc, p) => acc + (p.troco ?? 0), 0);
  const temDinheiro = pagamentos.some(p => /dinheiro/i.test(p.formaNome));
  const temVinculados = (pedidosVinculados ?? []).length > 0;
  const totalVinculados = (pedidosVinculados ?? []).reduce((s, p) => s + p.total, 0);
  // total = total FINAL (já inclui carrinho + vinculados - desconto)
  const totalGeral = total;

  const itensHTML = carrinho.map((item) => {
    const precoUnit = item.precoTotal;
    const precoLinha = item.precoTotal * item.quantidade;

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

  const pedidosVinculadosHTML = (pedidosVinculados ?? []).map((pedido) => {
    const pNumStr = pedido.numeroStr || String(pedido.numero).padStart(4, '0');
    const pItensHTML = pedido.itens.map((item) => `
      <div style="margin-bottom:8px;border-bottom:1px dashed #eee;padding-bottom:6px;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;">
          <div style="flex:1;min-width:0;">
            <div style="font-size:14px;font-weight:700;line-height:1.2;">${item.quantidade}x ${item.nome}</div>
          </div>
          <div style="text-align:right;flex-shrink:0;margin-left:8px;">
            <div style="font-size:14px;font-weight:800;">${fmtPreco2(item.preco * item.quantidade)}</div>
          </div>
        </div>
      </div>`).join('');
    return `
      <div style="margin-bottom:12px;">
        <div style="background:#000;color:#fff;text-align:center;padding:6px;font-size:12px;font-weight:900;margin-bottom:8px;border-radius:3px;letter-spacing:0.5px;">
          PEDIDO #${pNumStr} · ${descrDestino(pedido.destino ?? null)}
        </div>
        ${pItensHTML}
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

  const vinculadosSummary = temVinculados ? `
    <div style="display:flex;justify-content:space-between;margin-bottom:4px;font-size:13px;">
      <span>Pedidos vinculados (${pedidosVinculados!.length})</span>
      <span>${fmtPreco2(totalVinculados)}</span>
    </div>` : '';

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8"/>
  <title>${temVinculados ? 'Pagamento Unificado' : `Via Balcao — Pedido #${numStr}`}</title>
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family: Arial, Helvetica, sans-serif; background:#fff; color:#000; padding:12px; width:300px; }
    @media print { body { padding:6px; width:100%; } }
  </style>
</head>
<body>
  <div style="text-align:center;margin-bottom:10px;">
    <div style="font-size:11px;color:#666;letter-spacing:1px;">${temVinculados ? 'COMPROVANTE UNIFICADO' : 'VIA BALCAO'}</div>
    <div style="font-size:40px;font-weight:900;letter-spacing:-2px;">#${temVinculados ? 'UNIF' : numStr}</div>
    <div style="font-size:11px;color:#444;">${dataHora}</div>
  </div>
  ${!temVinculados ? `
  <div style="background:#000;color:#fff;text-align:center;padding:8px;font-size:15px;font-weight:900;margin-bottom:12px;border-radius:3px;letter-spacing:0.5px;">
    ${destinoStr}
  </div>
  ` : ''}
  <div style="margin-bottom:10px;">
    ${temVinculados ? `
    <div style="background:#000;color:#fff;text-align:center;padding:6px;font-size:12px;font-weight:900;margin-bottom:8px;border-radius:3px;letter-spacing:0.5px;">
      PEDIDO #${numStr} · ${destinoStr}
    </div>
    ` : ''}
    ${itensHTML}
  </div>
  ${temVinculados ? `
  <div style="border-top:2px dashed #000;margin:10px 0;padding-top:10px;">
    ${pedidosVinculadosHTML}
  </div>
  ` : ''}
  <div style="border-top:2px solid #000;padding-top:10px;margin-bottom:10px;">
    <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px;">
      <span>Subtotal</span>
      <span>${fmtPreco2(subtotal)}</span>
    </div>
    ${vinculadosSummary}
    ${descontoHTML}
    <div style="display:flex;justify-content:space-between;font-size:22px;font-weight:900;margin-bottom:10px;margin-top:6px;">
      <span>TOTAL GERAL</span>
      <span>${fmtPreco2(totalGeral)}</span>
    </div>
  </div>
  <div style="border-top:1px dashed #000;margin-bottom:10px;padding-top:8px;">
    ${pagamentosHTML}
    ${trocoHTML}
  </div>
  <div style="text-align:center;font-size:10px;color:#888;margin-top:6px;border-top:1px dashed #ccc;padding-top:6px;">
    ${temVinculados ? `${pedidosVinculados!.length + 1} pedidos pagos em unico pagamento` : 'Obrigado!'}
  </div>
</body>
</html>`;

  return sendToPrinter(html, impressora, undefined, { suppressBrowserFallback });
}