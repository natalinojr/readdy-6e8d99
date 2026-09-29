// Trilha das despesas (2026-09-29) — Financeiro › Trilha.
// Junta as peças que moram em abas diferentes (nota de entrada, pedido de pagamento, compra,
// estoque, conta a pagar, baixa e extrato do banco) num "caso" por despesa e diz, etapa por
// etapa, o que já aconteceu e o que falta. Os dados vêm da RPC fin_trilha_dados; aqui é só
// montagem (pura, testada em src/test/lib/trilhaDespesas.test.ts).

export interface TrCompra {
  id: string; supplier: string | null; invoice_number: string | null; total_amount: number;
  payment_method: string | null; payment_status: string | null; purchase_date: string | null;
  delivery_confirmed_at: string | null; stock_applied_at: string | null; is_bonus: boolean;
  created_at: string | null; itens: number; itens_estoque: number;
}
export interface TrConta {
  id: string; description: string | null; supplier: string | null; category: string | null;
  dre_category_id: string | null; amount: number; paid_amount: number | null;
  due_date: string | null; paid_date: string | null; status: string | null;
  installments: number | null; installment_number: number | null; parent_id: string | null;
  reference_id: string | null; reference_type: string | null; payment_method: string | null;
  competence_month: string | null; created_at: string | null;
}
export interface TrNota {
  id: string; numero: number | null; serie: string | null; modelo: number | null;
  emitente_nome: string | null; valor_total: number; emitted_at: string | null; status: string;
  import_type: string | null; purchase_id: string | null; payable_ids: string[]; auto_imported: boolean;
}
export interface TrExtrato {
  id: string; transaction_date: string; amount: number; description: string | null;
  counterpart_name: string | null; status: string; match_kind: string | null; reconciled: boolean;
  bill_id: string | null; juros_bill_id: string | null; purchase_id: string | null; source: string | null;
}
export interface TrCaixa { id: string; date: string | null; amount: number; reference_id: string | null }
export interface TrPedido {
  id: string; tipo: string; status: string; descricao: string | null; valor: number;
  favorecido_nome: string | null; purchase_id: string | null; bill_id: string | null;
  data_gasto: string | null; created_at: string | null; solicitado_por_nome: string | null;
}
export interface TrilhaDados {
  compras: TrCompra[]; contas: TrConta[]; notas: TrNota[]; extrato: TrExtrato[];
  caixa: TrCaixa[]; pedidos: TrPedido[];
}

export type EtapaId = 'documento' | 'lancamento' | 'estoque' | 'conta' | 'pagamento' | 'banco';
/** ok = feito · pendente = falta alguém fazer · atrasado/problema = precisa de atenção ·
 *  espera = etapa ainda não chegou (depende da anterior) · na = não se aplica a este caso */
export type EstadoEtapa = 'ok' | 'pendente' | 'atrasado' | 'problema' | 'espera' | 'na';
export interface Atalho { tab: string; param?: string; valor?: string | null }
export interface EtapaTrilha {
  id: EtapaId; nome: string; estado: EstadoEtapa; resumo: string; detalhe?: string; atalho?: Atalho;
}
export type TipoCaso = 'compra' | 'despesa' | 'nota' | 'pedido' | 'pagamento';
export type SituacaoCaso = 'ok' | 'andamento' | 'atencao';
export interface CasoTrilha {
  key: string; tipo: TipoCaso; titulo: string; subtitulo: string; valor: number; data: string;
  etapas: EtapaTrilha[]; situacao: SituacaoCaso; avisos: string[];
  // peças, para o detalhe
  compra: TrCompra | null; contas: TrConta[]; juros: TrConta[]; notas: TrNota[];
  extrato: TrExtrato[]; pedidos: TrPedido[]; caixa: TrCaixa[];
}

export const NOMES_ETAPA: Record<EtapaId, string> = {
  documento: 'Documento', lancamento: 'Lançamento', estoque: 'Estoque',
  conta: 'Conta a pagar', pagamento: 'Pagamento', banco: 'Banco',
};

const d10 = (s: string | null | undefined) => (s ? String(s).slice(0, 10) : '');
export const diaBR = (s: string | null | undefined) => {
  const d = d10(s);
  return d ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : '—';
};
const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const round2 = (v: number) => Math.round(v * 100) / 100;
const pago = (c: TrConta) => c.status === 'paid';
const dinheiro = (m: string | null | undefined) => /dinheiro|esp[eé]cie|cash/i.test(String(m ?? ''));

const TIPO_PEDIDO: Record<string, string> = {
  reembolso: 'Reembolso', freelancer: 'Freelancer', fornecedor: 'Fornecedor sem nota',
  compra_online: 'Compra online', prestador: 'Prestador MEI',
};

interface Rascunho {
  key: string; compra: TrCompra | null; contas: TrConta[]; juros: TrConta[]; notas: TrNota[];
  extrato: TrExtrato[]; pedidos: TrPedido[]; caixa: TrCaixa[];
}

/** Agrupa as peças em casos. Uma peça pertence a um caso só. */
export function agruparCasos(dados: TrilhaDados): Rascunho[] {
  const casos = new Map<string, Rascunho>();
  const novo = (key: string): Rascunho => {
    let c = casos.get(key);
    if (!c) { c = { key, compra: null, contas: [], juros: [], notas: [], extrato: [], pedidos: [], caixa: [] }; casos.set(key, c); }
    return c;
  };
  const casoDaConta = new Map<string, string>();
  const usadasNotas = new Set<string>();
  const usadosPedidos = new Set<string>();
  const usadoExtrato = new Set<string>();
  const contaPorId = new Map(dados.contas.map((c) => [c.id, c]));
  const jurosIds = new Set(dados.extrato.map((e) => e.juros_bill_id).filter(Boolean) as string[]);

  // 1) compras: cada compra é um caso
  for (const p of dados.compras) novo('p:' + p.id).compra = p;
  const temCompra = (id: string | null) => !!id && casos.has('p:' + id);

  // 2) contas a pagar
  for (const c of dados.contas) {
    if (c.reference_type === 'conciliacao_juros' || jurosIds.has(c.id)) continue; // vão junto do pagamento
    let key: string;
    if (c.reference_type === 'purchase' && c.reference_id) key = 'p:' + c.reference_id;
    else if (c.reference_type === 'nfe_entrada' && c.reference_id) key = 'n:' + c.reference_id;
    else if (c.reference_type === 'pedido_pagamento' && c.reference_id) key = 'r:' + c.reference_id;
    else if (c.parent_id) key = 'a:' + c.parent_id;
    else key = 'a:' + c.id;
    // nota-despesa: a nota aponta para as contas que gerou
    if (!key.startsWith('p:') && !key.startsWith('n:')) {
      const n = dados.notas.find((x) => x.payable_ids?.includes(c.id));
      if (n) key = n.purchase_id && temCompra(n.purchase_id) ? 'p:' + n.purchase_id : 'n:' + n.id;
    }
    novo(key).contas.push(c);
    casoDaConta.set(c.id, key);
  }

  // 3) notas de entrada
  for (const n of dados.notas) {
    let key: string | null = null;
    if (n.purchase_id && temCompra(n.purchase_id)) key = 'p:' + n.purchase_id;
    else if (casos.has('n:' + n.id)) key = 'n:' + n.id;
    else {
      const k = (n.payable_ids ?? []).map((id) => casoDaConta.get(id)).find(Boolean);
      if (k) key = k;
      else if (n.status === 'new') key = 'n:' + n.id; // chegou e ninguém lançou
    }
    if (!key) continue; // ignorada ou lançada fora da janela
    novo(key).notas.push(n);
    usadasNotas.add(n.id);
  }

  // 4) pedidos de pagamento
  for (const r of dados.pedidos) {
    let key: string | null = null;
    if (r.purchase_id && temCompra(r.purchase_id)) key = 'p:' + r.purchase_id;
    else if (r.bill_id && casoDaConta.get(r.bill_id)) key = casoDaConta.get(r.bill_id)!;
    else if (casos.has('r:' + r.id)) key = 'r:' + r.id;
    else if (r.status === 'aprovada' || r.status === 'pendente') key = 'r:' + r.id;
    if (!key) continue; // recusada/cancelada sem lançamento
    novo(key).pedidos.push(r);
    usadosPedidos.add(r.id);
  }

  // 5) caixa (compra paga na hora)
  for (const cx of dados.caixa) if (temCompra(cx.reference_id)) casos.get('p:' + cx.reference_id)!.caixa.push(cx);

  // 6) extrato: pela conta baixada, pela compra lançada do extrato, ou pela conta lançada do extrato
  const contaDoExtrato = new Map<string, string>();
  for (const c of dados.contas) if (c.reference_type === 'conciliacao_extrato' && c.reference_id) contaDoExtrato.set(c.reference_id, c.id);
  for (const e of dados.extrato) {
    let key: string | null = null;
    if (e.bill_id && casoDaConta.get(e.bill_id)) key = casoDaConta.get(e.bill_id)!;
    else if (e.purchase_id && temCompra(e.purchase_id)) key = 'p:' + e.purchase_id;
    else if (contaDoExtrato.get(e.id) && casoDaConta.get(contaDoExtrato.get(e.id)!)) key = casoDaConta.get(contaDoExtrato.get(e.id)!)!;
    else if (e.status === 'pending') key = 'x:' + e.id; // saiu do banco e ninguém lançou
    if (!key) continue;
    const caso = novo(key);
    caso.extrato.push(e);
    usadoExtrato.add(e.id);
    if (e.juros_bill_id) {
      const j = contaPorId.get(e.juros_bill_id);
      if (j && !caso.juros.some((x) => x.id === j.id)) caso.juros.push(j);
    }
  }

  return [...casos.values()].filter((c) => c.compra || c.contas.length || c.notas.length || c.pedidos.length || c.extrato.length);
}

function tipoDo(r: Rascunho): TipoCaso {
  if (r.compra) return 'compra';
  if (r.contas.length) return 'despesa';
  if (r.notas.length) return 'nota';
  if (r.pedidos.length) return 'pedido';
  return 'pagamento';
}

function dataDo(r: Rascunho): string {
  if (r.compra?.purchase_date) return d10(r.compra.purchase_date);
  if (r.notas[0]?.emitted_at) return d10(r.notas[0].emitted_at);
  if (r.pedidos[0]) return d10(r.pedidos[0].data_gasto ?? r.pedidos[0].created_at);
  const venc = r.contas.map((c) => d10(c.due_date)).filter(Boolean).sort();
  if (venc[0]) return venc[0];
  return d10(r.extrato[0]?.transaction_date);
}

/** Monta as etapas e a situação de um caso. `temExtrato` = a loja tem extrato automático. */
export function montarCaso(r: Rascunho, hoje: string, temExtrato: boolean): CasoTrilha {
  const tipo = tipoDo(r);
  const p = r.compra;
  const nota = r.notas[0] ?? null;
  const pedido = r.pedidos[0] ?? null;
  const avisos: string[] = [];
  const etapas: EtapaTrilha[] = [];
  const add = (id: EtapaId, estado: EstadoEtapa, resumo: string, detalhe?: string, atalho?: Atalho) =>
    etapas.push({ id, nome: NOMES_ETAPA[id], estado, resumo, detalhe, atalho });

  const totalContas = round2(r.contas.reduce((s, c) => s + Number(c.amount || 0), 0));
  const valor = p ? Number(p.total_amount || 0)
    : r.contas.length ? totalContas
    : nota ? Number(nota.valor_total || 0)
    : pedido ? Number(pedido.valor || 0)
    : Number(r.extrato[0]?.amount || 0);

  // ── 1. Documento ─────────────────────────────────────────────────────────────
  if (nota) {
    const nome = Number(nota.modelo) === 10 || nota.import_type === 'bill' ? 'Nota de serviço' : 'Nota fiscal';
    add('documento', 'ok', `${nome} nº ${nota.numero ?? '?'}`,
      `${nota.emitente_nome ?? ''} · emitida ${diaBR(nota.emitted_at)} · ${brl(Number(nota.valor_total))}${nota.auto_imported ? ' · lançada pela conciliação' : ''}`,
      { tab: 'notas-entrada', param: 'busca', valor: String(nota.numero ?? nota.emitente_nome ?? '') });
    if (p && !p.is_bonus && Math.abs(Number(nota.valor_total) - Number(p.total_amount)) > 1)
      avisos.push(`Valor da nota (${brl(Number(nota.valor_total))}) diferente da compra (${brl(Number(p.total_amount))})`);
  } else if (pedido) {
    add('documento', 'ok', `Pedido: ${TIPO_PEDIDO[pedido.tipo] ?? pedido.tipo}`,
      `${pedido.solicitado_por_nome ? 'por ' + pedido.solicitado_por_nome + ' · ' : ''}${pedido.status}`,
      { tab: 'pagar' });
  } else if (p?.invoice_number) {
    add('documento', 'ok', `NF ${p.invoice_number}`, 'número digitado na compra (sem o XML da nota)');
  } else {
    add('documento', 'na', 'Sem nota fiscal', r.extrato.length && !p && !r.contas.length ? 'só o pagamento no banco' : undefined);
  }

  // ── 2. Lançamento (compra ou despesa) ────────────────────────────────────────
  const semClassif = r.contas.filter((c) => c.reference_type !== 'purchase' && !c.dre_category_id && !c.category);
  if (p) {
    add('lancamento', 'ok', p.is_bonus ? 'Bonificação lançada' : 'Compra lançada',
      `${diaBR(p.purchase_date)} · ${brl(Number(p.total_amount))}${p.payment_method ? ' · ' + p.payment_method : ''}`,
      { tab: 'compras', param: 'foco', valor: p.id });
  } else if (r.contas.length) {
    const cat = r.contas[0].category;
    if (semClassif.length)
      add('lancamento', 'pendente', 'Despesa sem classificação', 'falta escolher a categoria do DRE', { tab: 'pagar', param: 'busca', valor: r.contas[0].description });
    else
      add('lancamento', 'ok', 'Despesa lançada', cat ? 'Categoria: ' + cat : undefined, { tab: 'pagar', param: 'busca', valor: r.contas[0].description });
  } else if (nota && nota.status === 'new') {
    add('lancamento', 'pendente', 'Nota ainda não lançada', 'lance como compra ou despesa em Notas de entrada',
      { tab: 'notas-entrada', param: 'busca', valor: String(nota.numero ?? '') });
  } else if (pedido) {
    add('lancamento', 'pendente',
      pedido.status === 'pendente' ? 'Pedido aguardando aprovação' : 'Pedido aprovado, sem lançamento', undefined, { tab: 'pagar' });
  } else {
    add('lancamento', 'problema', 'Pagamento sem lançamento', 'saiu do banco e não virou compra nem despesa', { tab: 'conciliacao' });
  }

  // ── 3. Estoque (só compra) ───────────────────────────────────────────────────
  if (!p) {
    add('estoque', 'na', 'Não vai ao estoque');
  } else if (Number(p.itens_estoque) === 0) {
    add('estoque', 'na', 'Nenhum item ligado a insumo',
      Number(p.itens) > 0 ? `${p.itens} ite${Number(p.itens) === 1 ? 'm' : 'ns'} sem insumo — não mexe no estoque` : undefined,
      { tab: 'compras', param: 'foco', valor: p.id });
  } else if (p.stock_applied_at) {
    const parcial = Number(p.itens_estoque) < Number(p.itens);
    add('estoque', 'ok', `Entrou no estoque`,
      `${diaBR(p.delivery_confirmed_at ?? p.stock_applied_at)} · ${p.itens_estoque} de ${p.itens} ite${Number(p.itens) === 1 ? 'm' : 'ns'}${parcial ? ' (os outros sem insumo)' : ''}`,
      { tab: 'compras', param: 'foco', valor: p.id });
  } else if (p.delivery_confirmed_at) {
    add('estoque', 'problema', 'Recebida, estoque não entrou', `recebida ${diaBR(p.delivery_confirmed_at)}`, { tab: 'compras', param: 'foco', valor: p.id });
  } else {
    add('estoque', 'pendente', 'Aguardando recebimento', 'confirme o recebimento para entrar no estoque', { tab: 'compras', param: 'foco', valor: p.id });
  }

  // ── 4. Conta a pagar ─────────────────────────────────────────────────────────
  const aVista = !!p && (r.caixa.length > 0 || (r.contas.length === 0 && p.payment_status === 'paid'));
  if (r.contas.length) {
    const n = r.contas.length;
    add('conta', 'ok', n > 1 ? `${n} parcelas` : 'Conta criada', `${brl(totalContas)}${n === 1 ? ' · vence ' + diaBR(r.contas[0].due_date) : ''}`,
      { tab: 'pagar', param: 'busca', valor: r.contas[0].description });
    if (p && !p.is_bonus && Math.abs(totalContas - Number(p.total_amount)) > 0.05)
      avisos.push(`Contas somam ${brl(totalContas)}, a compra é ${brl(Number(p.total_amount))}`);
  } else if (p?.is_bonus) {
    add('conta', 'na', 'Bonificação', 'não gera conta');
  } else if (aVista) {
    add('conta', 'na', 'Paga à vista', 'sem conta a pagar');
  } else if (p) {
    add('conta', 'problema', 'Compra sem conta a pagar', 'não está paga e não há conta para pagar', { tab: 'compras', param: 'foco', valor: p.id });
  } else if (r.extrato.length) {
    add('conta', 'na', '—');
  } else {
    add('conta', 'espera', 'Ainda não criada');
  }

  // ── 5. Pagamento ─────────────────────────────────────────────────────────────
  let estaPago = false;
  if (r.contas.length) {
    const abertas = r.contas.filter((c) => !pago(c));
    if (!abertas.length) {
      estaPago = true;
      const ult = r.contas.map((c) => d10(c.paid_date)).filter(Boolean).sort().pop();
      add('pagamento', 'ok', r.contas.length > 1 ? 'Todas pagas' : 'Paga', ult ? 'em ' + diaBR(ult) : undefined, { tab: 'pagar', param: 'busca', valor: r.contas[0].description });
    } else {
      const vencidas = abertas.filter((c) => c.status === 'overdue' || (d10(c.due_date) && d10(c.due_date) < hoje));
      const prox = abertas.map((c) => d10(c.due_date)).filter(Boolean).sort()[0];
      const pagas = r.contas.length - abertas.length;
      const falta = round2(abertas.reduce((s, c) => s + Number(c.amount || 0) - Number(c.paid_amount || 0), 0));
      if (vencidas.length)
        add('pagamento', 'atrasado', vencidas.length > 1 ? `${vencidas.length} vencidas` : 'Vencida',
          `desde ${diaBR(vencidas.map((c) => d10(c.due_date)).sort()[0])} · falta ${brl(falta)}`, { tab: 'pagar', param: 'busca', valor: vencidas[0].description });
      else
        add('pagamento', 'pendente', pagas ? `${pagas} de ${r.contas.length} pagas` : 'Em aberto',
          `vence ${diaBR(prox)} · ${brl(falta)}`, { tab: 'pagar', param: 'busca', valor: abertas[0].description });
    }
  } else if (p?.is_bonus) {
    add('pagamento', 'na', 'Sem pagamento');
  } else if (aVista) {
    estaPago = true;
    add('pagamento', 'ok', 'Paga na hora', `${diaBR(r.caixa[0]?.date ?? p?.purchase_date)}${p?.payment_method ? ' · ' + p.payment_method : ''}`);
  } else if (!p && !r.contas.length && r.extrato.length) {
    estaPago = true;
    add('pagamento', 'ok', 'Saiu do banco', diaBR(r.extrato[0].transaction_date));
  } else {
    add('pagamento', 'espera', 'Aguardando conta');
  }

  // ── 6. Banco (extrato) ───────────────────────────────────────────────────────
  const meio = p?.payment_method ?? r.contas.find((c) => c.payment_method)?.payment_method ?? null;
  const conciliado = r.extrato.filter((e) => e.status === 'matched' || e.reconciled);
  if (conciliado.length) {
    const soma = round2(conciliado.reduce((s, e) => s + Number(e.amount || 0), 0));
    add('banco', 'ok', conciliado.length > 1 ? `${conciliado.length} saídas no extrato` : 'Achado no extrato',
      `${diaBR(conciliado[0].transaction_date)} · ${brl(soma)}${conciliado[0].counterpart_name ? ' · ' + conciliado[0].counterpart_name : ''}`,
      { tab: 'conciliacao' });
    if (r.contas.length && !estaPago) avisos.push('Saiu do banco, mas a conta ainda está em aberto');
  } else if (r.extrato.length) {
    add('banco', 'problema', 'No extrato, sem vínculo', `${diaBR(r.extrato[0].transaction_date)} · ${brl(Number(r.extrato[0].amount))} · ${r.extrato[0].counterpart_name ?? r.extrato[0].description ?? ''}`,
      { tab: 'conciliacao' });
  } else if (!estaPago) {
    add('banco', p?.is_bonus ? 'na' : 'espera', p?.is_bonus ? 'Sem saída' : 'Aguardando pagamento');
  } else if (dinheiro(meio)) {
    add('banco', 'na', 'Pago em dinheiro', 'não passa pelo banco');
  } else if (!temExtrato) {
    add('banco', 'na', 'Sem extrato automático', 'a loja não tem banco integrado');
  } else {
    add('banco', 'pendente', 'Não achado no extrato', 'pago no sistema, mas a saída do banco não foi ligada', { tab: 'conciliacao' });
  }

  for (const j of r.juros) avisos.push(`Juros/multa de ${brl(Number(j.amount))} pagos junto`);

  const situacao: SituacaoCaso = etapas.some((e) => e.estado === 'problema' || e.estado === 'atrasado') || avisos.some((a) => !a.startsWith('Juros'))
    ? 'atencao'
    : etapas.some((e) => e.estado === 'pendente' || e.estado === 'espera') ? 'andamento' : 'ok';

  const titulo = p?.supplier ?? r.contas[0]?.supplier ?? nota?.emitente_nome ?? pedido?.favorecido_nome
    ?? r.contas[0]?.description ?? r.extrato[0]?.counterpart_name ?? r.extrato[0]?.description ?? 'Sem nome';
  const subtitulo = tipo === 'compra' ? (p?.is_bonus ? 'Bonificação' : 'Compra')
    : tipo === 'despesa' ? (r.contas[0]?.description && r.contas[0].description !== titulo ? r.contas[0].description : 'Despesa')
    : tipo === 'nota' ? 'Nota de entrada'
    : tipo === 'pedido' ? (pedido?.descricao ?? 'Pedido de pagamento')
    : (r.extrato[0]?.description ?? 'Pagamento no banco');

  return {
    key: r.key, tipo, titulo, subtitulo, valor: round2(valor), data: dataDo(r), etapas, situacao, avisos,
    compra: p, contas: r.contas, juros: r.juros, notas: r.notas, extrato: r.extrato, pedidos: r.pedidos, caixa: r.caixa,
  };
}

/** Casos cuja data cai no período, mais recentes primeiro. */
export function montarTrilha(dados: TrilhaDados, de: string, ate: string, hoje: string): CasoTrilha[] {
  const temExtrato = dados.extrato.length > 0;
  return agruparCasos(dados)
    .map((r) => montarCaso(r, hoje, temExtrato))
    .filter((c) => c.data >= de && c.data <= ate)
    .sort((a, b) => (a.data < b.data ? 1 : a.data > b.data ? -1 : a.titulo.localeCompare(b.titulo)));
}
