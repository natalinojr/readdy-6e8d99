/**
 * Lê a observação que o funil do iFood grava no pedido do ERPOS (supabase/functions/ifood-shipping/funnel.ts,
 * `notas`: partes separadas por " | "). Cada tela mostra só o que é dela:
 * cozinha = obs. do cliente; motoboy = como sai, cobrar ou não, obs. da entrega; o resto é do caixa/financeiro.
 * Retorna null quando o pedido não veio do iFood.
 */
export interface NotasIfood {
  displayId: string | null;
  /** delivered_by MERCHANT: quem entrega é o motoboy da loja. */
  entregaPelaLoja: boolean;
  /** Só serve quando o entregador do iFood retira na loja. */
  codigoColeta: string | null;
  agendado: string | null;
  cobrar: string | null;
  obsEntrega: string | null;
  /** O que não é do funil (extra_info do iFood = observação do cliente). */
  doCliente: string[];
}

/** Observação para a comanda impressa: iFood sem as linhas internas (estoque, repasse) e sem o código de coleta
 *  quando quem entrega é o motoboy da loja; outros pedidos, a observação como está. */
export function notasComanda(notes?: string | null): string {
  const n = lerNotasIfood(notes);
  if (!n) return (notes ?? '').trim();
  return [
    `iFood${n.displayId ? ` #${n.displayId}` : ''}${n.entregaPelaLoja ? ' · entrega da loja' : ''}`,
    n.agendado,
    !n.entregaPelaLoja && n.codigoColeta ? `Código de coleta: ${n.codigoColeta}` : null,
    n.cobrar ? `COBRAR NA ENTREGA: ${n.cobrar}` : null,
    n.obsEntrega ? `Obs. da entrega: ${n.obsEntrega}` : null,
    ...n.doCliente,
  ].filter(Boolean).join('\n');
}

export function lerNotasIfood(notes?: string | null): NotasIfood | null {
  const partes = (notes ?? '').split(' | ').map((p) => p.trim()).filter(Boolean);
  const m = partes[0]?.match(/^Pedido iFood\s*(#\S+)?\s*·\s*(.*)$/);
  if (!m) return null;
  const r: NotasIfood = {
    displayId: m[1] ? m[1].replace('#', '') : null,
    entregaPelaLoja: m[2] === 'Entrega pela loja',
    codigoColeta: null, agendado: null, cobrar: null, obsEntrega: null, doCliente: [],
  };
  for (const p of partes.slice(1)) {
    if (p.startsWith('Código de coleta:')) r.codigoColeta = p.slice(17).trim();
    else if (p.startsWith('AGENDADO para')) r.agendado = p;
    else if (p.startsWith('COBRAR NA ENTREGA:')) r.cobrar = p.slice(18).trim();
    else if (p.startsWith('Obs. da entrega:')) r.obsEntrega = p.slice(16).trim();
    else if (p === 'Pago no app do iFood' || p.startsWith('Desconto bancado pelo iFood') || p.startsWith('Sem vínculo com o cardápio')) continue;
    else r.doCliente.push(p);
  }
  return r;
}
