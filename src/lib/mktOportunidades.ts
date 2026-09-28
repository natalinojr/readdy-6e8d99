// Oportunidades de marketing a partir dos fatos por canal (F5a do PLANO-TRAFEGO-PAGO-AGENTES.md, 2026-09-28).
// Entrada: o JSON de `fn_mkt_fatos_canais` (tudo já somado no banco). Aqui só regras determinísticas,
// cada uma com o número que a justifica e a fonte. Não gasta IA; o Estrategista (F5b) lê isto depois.

export type Canal = 'balcao' | 'mesa' | 'autoatendimento' | 'delivery_proprio' | 'whatsapp' | 'retirada' | 'ifood' | string;

export interface FatosCanais {
  periodo: { de: string; ate: string; dias: number };
  canais: Array<{ canal: Canal; pedidos: number; receita: number; ticket: number | null }>;
  vindos_da_meta: number;
  hora_dia: Array<{ dow: number; hora: number; pedidos: number; receita: number }>;
  itens: Array<{ canal: Canal; item_id: string | null; nome: string; qtd: number; receita: number; custo: number | null; receita_com_custo: number | null }>;
  cardapio: Array<{ item_id: string; nome: string; preco: number; tem_foto: boolean; nota_foto: number | null; destaque: boolean; categoria?: string | null }>;
  ifood_portal: { periodo_inicio: string; periodo_fim: string; itens: Array<{ nome: string; visitas: number; pedidos: number; qtd: number; receita: number; conversao: number | null }> } | null;
  estoque_critico: unknown[];
}

export type TipoOportunidade = 'migrar_ifood' | 'campeao_salao' | 'horario_fraco' | 'margem_alta' | 'foto_fraca' | 'delivery_pequeno' | 'estoque';

export interface Oportunidade {
  tipo: TipoOportunidade;
  prioridade: 1 | 2 | 3; // 1 = olhar primeiro
  titulo: string;
  porque: string; // os números que justificam
  fonte: string; // de onde vêm os números
  acao: string; // o que fazer
  itens?: string[];
}

export const CANAL_LABEL: Record<string, string> = {
  balcao: 'Balcão', mesa: 'Mesa', autoatendimento: 'Autoatendimento', delivery_proprio: 'Delivery próprio',
  whatsapp: 'WhatsApp', retirada: 'Retirada', ifood: 'iFood',
};
const SALAO = new Set(['balcao', 'mesa', 'autoatendimento']);
const PROPRIO = new Set(['delivery_proprio', 'whatsapp', 'retirada']);
export const DIA_LABEL = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const pct = (v: number) => `${Math.round(v * 100)}%`;
const num = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 1 });
const norm = (s: string) => s.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

function porItem(f: FatosCanais) {
  const m = new Map<string, { nome: string; item_id: string | null; salao: number; proprio: number; ifood: number; receita: number; custo: number; receitaComCusto: number }>();
  for (const i of f.itens) {
    const k = i.item_id ?? `nome:${norm(i.nome)}`;
    const cur = m.get(k) ?? { nome: i.nome, item_id: i.item_id, salao: 0, proprio: 0, ifood: 0, receita: 0, custo: 0, receitaComCusto: 0 };
    if (SALAO.has(i.canal)) cur.salao += i.qtd; else if (PROPRIO.has(i.canal)) cur.proprio += i.qtd; else if (i.canal === 'ifood') cur.ifood += i.qtd;
    cur.receita += i.receita;
    if (i.custo != null && i.receita_com_custo != null) { cur.custo += i.custo; cur.receitaComCusto += i.receita_com_custo; }
    m.set(k, cur);
  }
  return [...m.values()];
}

// Bebida/chope/adicional não é o que se anuncia como prato (e álcool tem regra própria na Meta).
const NAO_E_PRATO = /bebida|drink|chope|chopp|cerveja|refri|suco|agua|água|dose|vinho|caipirinha|extra|adiciona|molho|coca|guarana|guaraná|fanta|sprite|del valle/i;
function ePrato(nome: string, categoria?: string | null) { return !NAO_E_PRATO.test(norm(nome)) && !(categoria && NAO_E_PRATO.test(norm(categoria))); }

function mediana(xs: number[]) {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b); const i = Math.floor(s.length / 2);
  return s.length % 2 ? s[i] : (s[i - 1] + s[i]) / 2;
}

export function gerarOportunidades(f: FatosCanais): Oportunidade[] {
  const out: Oportunidade[] = [];
  const itens = porItem(f);
  const totalReceita = f.canais.reduce((s, c) => s + c.receita, 0);
  const rec = (canais: Set<string> | string) => f.canais.filter((c) => (typeof canais === 'string' ? c.canal === canais : canais.has(c.canal))).reduce((s, c) => s + c.receita, 0);
  const dias = f.periodo.dias;

  // 1. Forte no iFood, fraco no delivery próprio → trazer para o canal próprio (sem comissão).
  const ifoodPortal = new Map((f.ifood_portal?.itens ?? []).map((x) => [norm(x.nome), x.qtd]));
  const migrar = itens
    .map((i) => ({ ...i, ifoodQtd: Math.max(i.ifood, ifoodPortal.get(norm(i.nome)) ?? 0) }))
    .filter((i) => i.ifoodQtd >= 5 && i.ifoodQtd >= 2 * Math.max(1, i.proprio) && ePrato(i.nome, i.item_id ? f.cardapio.find((c) => c.item_id === i.item_id)?.categoria : null))
    .sort((a, b) => b.ifoodQtd - a.ifoodQtd).slice(0, 5);
  // Itens do relatório do portal que não casaram com o cardápio do ERPOS também contam.
  const nomesCasados = new Set(itens.map((i) => norm(i.nome)));
  const soPortal = (f.ifood_portal?.itens ?? []).filter((x) => x.qtd >= 5 && !nomesCasados.has(norm(x.nome)) && ePrato(x.nome)).slice(0, 5 - migrar.length);
  if (migrar.length || soPortal.length) {
    const nomes = [...migrar.map((i) => `${i.nome} (${i.ifoodQtd} no iFood × ${i.proprio} no próprio)`), ...soPortal.map((x) => `${x.nome} (${x.qtd} no iFood)`)];
    out.push({
      tipo: 'migrar_ifood', prioridade: 1,
      titulo: 'Pratos fortes no iFood e fracos no delivery próprio',
      porque: nomes.join('; ') + '.',
      fonte: f.ifood_portal?.periodo_fim ? `pedidos do ERPOS (${dias} dias) + relatório do portal iFood ${f.ifood_portal.periodo_inicio} a ${f.ifood_portal.periodo_fim}` : `pedidos do ERPOS (${dias} dias)`,
      acao: 'Anúncio no raio de entrega com esses pratos e oferta "peça direto e pague menos" (a comissão do iFood que deixa de pagar banca o desconto).',
      itens: [...migrar.map((i) => i.nome), ...soPortal.map((x) => x.nome)],
    });
  }

  // 2. Campeão do salão que quase não sai no delivery → vira anúncio do delivery.
  const temDelivery = rec(PROPRIO) > 0;
  const salaoTotal = itens.reduce((s, i) => s + i.salao, 0);
  const propTotal = itens.reduce((s, i) => s + i.proprio, 0);
  const catDe = new Map(f.cardapio.map((c) => [c.item_id, c.categoria ?? null]));
  const prato = (i: { nome: string; item_id: string | null }) => ePrato(i.nome, i.item_id ? catDe.get(i.item_id) : null);
  if (salaoTotal > 0) {
    const campeoes = itens.filter((i) => i.salao >= 5 && prato(i)).sort((a, b) => b.salao - a.salao).slice(0, 10)
      .filter((i) => {
        const shareSalao = i.salao / salaoTotal; const shareProp = propTotal ? i.proprio / propTotal : 0;
        return shareProp < shareSalao * 0.4;
      }).slice(0, 4);
    if (campeoes.length && temDelivery) {
      out.push({
        tipo: 'campeao_salao', prioridade: 1,
        titulo: 'Campeões do salão que quase não saem no delivery',
        porque: campeoes.map((i) => `${i.nome}: ${i.salao} no salão × ${i.proprio} no delivery`).join('; ') + '.',
        fonte: `pedidos do ERPOS por canal (${dias} dias)`,
        acao: 'Quem já compra no salão gosta desses pratos; anunciar no delivery próprio (arte no Estúdio) e dar destaque no cardápio online.',
        itens: campeoes.map((i) => i.nome),
      });
    }
  }

  // 3. Horário fraco dentro do horário em que a loja vende → campanha só nesse horário.
  // Só horas em que a loja costuma vender (venda nessa hora em 3+ dias da semana): madrugada avulsa não conta.
  const diasPorHora = new Map<number, number>();
  for (const h of f.hora_dia) if (h.pedidos > 0) diasPorHora.set(h.hora, (diasPorHora.get(h.hora) ?? 0) + 1);
  const slots = f.hora_dia.filter((h) => h.pedidos > 0 && (diasPorHora.get(h.hora) ?? 0) >= 3);
  if (slots.length >= 8) {
    const med = mediana(slots.map((h) => h.pedidos));
    const fracos = slots.filter((h) => h.pedidos <= med * 0.35).sort((a, b) => a.pedidos - b.pedidos).slice(0, 4);
    const picos = [...slots].sort((a, b) => b.pedidos - a.pedidos).slice(0, 2);
    if (fracos.length && med >= 2) {
      out.push({
        tipo: 'horario_fraco', prioridade: 2,
        titulo: 'Horários com a cozinha ociosa',
        porque: `Mediana de ${num(med)} pedidos por dia/hora com venda; fracos: ${fracos.map((h) => `${DIA_LABEL[h.dow]} ${h.hora}h (${h.pedidos})`).join(', ')}. Picos: ${picos.map((h) => `${DIA_LABEL[h.dow]} ${h.hora}h (${h.pedidos})`).join(', ')}.`,
        fonte: `pedidos de todos os canais por dia da semana e hora (${dias} dias, horário de Brasília)`,
        acao: 'Campanha programada só nesses horários (ou combo do horário) em vez de verba o dia todo.',
      });
    }
  }

  // 4. Margem alta e venda baixa → vale testar anúncio; margem baixa e venda alta → não precisa de verba.
  const comCusto = itens.filter((i) => i.receitaComCusto > 0);
  if (comCusto.length >= 4) {
    const medQtd = mediana(comCusto.map((i) => i.salao + i.proprio + i.ifood));
    const margem = (i: typeof comCusto[number]) => 1 - i.custo / i.receitaComCusto;
    // Acima de 90% quase sempre é ficha técnica incompleta (custo faltando), não lucro: fica de fora e é avisado.
    const suspeitas = comCusto.filter((i) => margem(i) > 0.9);
    const altas = comCusto.filter((i) => margem(i) >= 0.65 && margem(i) <= 0.9 && i.salao + i.proprio + i.ifood <= medQtd).sort((a, b) => margem(b) - margem(a)).slice(0, 4);
    const ruins = comCusto.filter((i) => margem(i) < 0.4 && i.salao + i.proprio + i.ifood > medQtd).slice(0, 3);
    if (altas.length) {
      out.push({
        tipo: 'margem_alta', prioridade: 2,
        titulo: 'Pratos que dão lucro e vendem pouco',
        porque: altas.map((i) => `${i.nome}: margem ${pct(margem(i))}, ${i.salao + i.proprio + i.ifood} vendido${i.salao + i.proprio + i.ifood === 1 ? '' : 's'}`).join('; ') + '.'
          + (ruins.length ? ` Já vendem bem com margem baixa (não precisam de verba): ${ruins.map((i) => `${i.nome} (${pct(margem(i))})`).join(', ')}.` : '')
          + (suspeitas.length ? ` Margem acima de 90% (conferir a ficha técnica, custo parece faltar): ${suspeitas.slice(0, 5).map((i) => i.nome).join(', ')}.` : ''),
        fonte: `custo gravado na venda (ficha técnica) × preço, ${dias} dias; só itens com custo`,
        acao: 'Teste pequeno de anúncio com esses pratos (orçamento de teste, 7 dias) e medir pedidos.',
        itens: altas.map((i) => i.nome),
      });
    }
  }

  if (comCusto.length >= 4) {
    const suspeitas = comCusto.filter((i) => 1 - i.custo / i.receitaComCusto > 0.9);
    if (suspeitas.length && !out.some((o) => o.tipo === 'margem_alta')) {
      out.push({
        tipo: 'margem_alta', prioridade: 3,
        titulo: 'Fichas técnicas a conferir antes de usar a margem',
        porque: `Margem acima de 90% (custo parece faltar na ficha): ${suspeitas.slice(0, 6).map((i) => i.nome).join(', ')}.`,
        fonte: `custo gravado na venda (ficha técnica), ${dias} dias`,
        acao: 'Completar a ficha técnica desses itens; sem custo certo, a escolha do prato para anunciar fica no escuro.',
        itens: suspeitas.slice(0, 6).map((i) => i.nome),
      });
    }
  }

  // 5. Mais vendidos sem foto boa → o anúncio vai sair fraco.
  const cardapio = new Map(f.cardapio.map((c) => [c.item_id, c]));
  const topVendidos = itens.filter((i) => i.item_id && cardapio.has(i.item_id) && ePrato(i.nome, cardapio.get(i.item_id)!.categoria)).sort((a, b) => (b.salao + b.proprio + b.ifood) - (a.salao + a.proprio + a.ifood)).slice(0, 10);
  const semFotoBoa = topVendidos.filter((i) => { const c = cardapio.get(i.item_id!)!; return !c.tem_foto || (c.nota_foto != null && c.nota_foto < 7); });
  const semNota = topVendidos.filter((i) => { const c = cardapio.get(i.item_id!)!; return c.tem_foto && c.nota_foto == null; });
  if (semFotoBoa.length) {
    out.push({
      tipo: 'foto_fraca', prioridade: 2,
      titulo: 'Mais vendidos sem foto boa para anúncio',
      porque: semFotoBoa.map((i) => { const c = cardapio.get(i.item_id!)!; return `${i.nome} (${c.tem_foto ? `nota ${c.nota_foto}` : 'sem foto'})`; }).join('; ') + '.'
        + (semNota.length ? ` Ainda sem nota da IA: ${semNota.length} dos 10 mais vendidos (Estúdio › Biblioteca › Avaliar fotos).` : ''),
      fonte: 'mais vendidos do período × nota da foto no Estúdio de Criação',
      acao: 'Refazer a foto desses pratos (luz, fundo limpo, prato inteiro) antes de pôr verba neles.',
      itens: semFotoBoa.map((i) => i.nome),
    });
  }

  // 6. Delivery próprio pequeno perto do salão → espaço para anúncio local.
  const recSalao = rec(SALAO); const recProp = rec(PROPRIO); const recIfood = rec('ifood');
  if (totalReceita > 0 && recSalao > 0 && recProp / totalReceita < 0.15) {
    out.push({
      tipo: 'delivery_pequeno', prioridade: recProp === 0 ? 1 : 2,
      titulo: recProp === 0 ? 'Delivery próprio sem venda no período' : 'Delivery próprio pequeno perto do salão',
      porque: `Delivery próprio ${brl(recProp)} (${pct(recProp / totalReceita)} da receita) × salão ${brl(recSalao)}${recIfood ? ` × iFood ${brl(recIfood)}` : ''}. Pedidos vindos da Meta: ${f.vindos_da_meta}.`,
      fonte: `receita por canal no ERPOS (${dias} dias)`,
      acao: 'Quem conhece a loja pelo salão é o público mais fácil: anúncio no raio de entrega com o link do delivery próprio.',
    });
  }

  // 7. Estoque crítico → não anunciar prato que vai faltar.
  if (Array.isArray(f.estoque_critico) && f.estoque_critico.length) {
    out.push({
      tipo: 'estoque', prioridade: 3,
      titulo: 'Insumos em nível crítico',
      porque: `${f.estoque_critico.length} insumo(s) abaixo do mínimo`
        + (() => { const nomes = (f.estoque_critico as Array<{ nome?: string }>).map((x) => x?.nome).filter(Boolean).slice(0, 8); return nomes.length ? `: ${nomes.join(', ')}.` : '.'; })(),
      fonte: 'alertas de estoque do ERPOS',
      acao: 'Antes de anunciar, conferir se os pratos da campanha usam esses insumos.',
    });
  }

  return out.sort((a, b) => a.prioridade - b.prioridade);
}
