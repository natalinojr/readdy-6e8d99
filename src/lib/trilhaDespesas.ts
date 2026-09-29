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
  id: string; bank_account_id?: string | null; transaction_date: string; amount: number; description: string | null;
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
 *  prazo = conta a pagar em aberto e ainda dentro do vencimento (não é tarefa) ·
 *  espera = etapa ainda não chegou (depende da anterior) · na = não se aplica a este caso */
export type EstadoEtapa = 'ok' | 'pendente' | 'prazo' | 'atrasado' | 'problema' | 'espera' | 'na';
/** extrato: abre a linha do extrato na própria Trilha (mesma janela da Conciliação), em vez de ir para a aba. */
export interface Atalho { tab: string; param?: string; valor?: string | null; extrato?: TrExtrato }
export interface EtapaTrilha {
  id: EtapaId; nome: string; estado: EstadoEtapa; resumo: string; detalhe?: string;
  /** a ação concreta que falta, em linguagem simples ("→ Falta: …") — só em pendente/atrasado/problema */
  falta?: string;
  atalho?: Atalho;
}
export type TipoCaso = 'compra' | 'despesa' | 'nota' | 'pedido' | 'pagamento';
export type SituacaoCaso = 'ok' | 'andamento' | 'atencao';
export type GrupoTarefa = 'saida_banco' | 'vencidas' | 'sem_conta' | 'estoque' | 'notas' | 'pedidos' | 'classificar' | 'extrato';
export interface TarefaTrilha { key: string; grupo: GrupoTarefa; etapas: EtapaId[]; urgente: boolean; porque: string }
export interface CasoTrilha {
  key: string; tipo: TipoCaso; titulo: string; subtitulo: string; valor: number; data: string;
  etapas: EtapaTrilha[]; situacao: SituacaoCaso; avisos: string[]; tarefas: TarefaTrilha[];
  // peças, para o detalhe
  compra: TrCompra | null; contas: TrConta[]; juros: TrConta[]; notas: TrNota[];
  extrato: TrExtrato[]; pedidos: TrPedido[]; caixa: TrCaixa[];
}

export const NOMES_ETAPA: Record<EtapaId, string> = {
  documento: 'Nota fiscal', lancamento: 'Compra ou despesa', estoque: 'Estoque',
  conta: 'Conta a pagar', pagamento: 'Pagamento', banco: 'Extrato do banco',
};

/** Precisa de alguém fazer algo (tarefa). */
export const ruim = (e: EstadoEtapa) => e === 'problema' || e === 'atrasado' || e === 'pendente';
/** Precisa de atenção (vermelho). */
export const grave = (e: EstadoEtapa) => e === 'problema' || e === 'atrasado';

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

const diasEntre = (de: string, ate: string) => {
  if (!de || !ate) return 0;
  const t = (x: string) => Date.UTC(Number(x.slice(0, 4)), Number(x.slice(5, 7)) - 1, Number(x.slice(8, 10)));
  return Math.max(0, Math.round((t(ate) - t(de)) / 86400000));
};
const plural = (n: number, um: string, varios: string) => (n === 1 ? um : varios);

/** Monta as etapas, a situação e as tarefas de um caso. `temExtrato` = a loja tem extrato automático. */
export function montarCaso(r: Rascunho, hoje: string, temExtrato: boolean): CasoTrilha {
  const tipo = tipoDo(r);
  const p = r.compra;
  const nota = r.notas[0] ?? null;
  const pedido = r.pedidos[0] ?? null;
  const avisos: string[] = [];
  const etapas: EtapaTrilha[] = [];
  const tarefas: TarefaTrilha[] = [];
  const add = (id: EtapaId, estado: EstadoEtapa, resumo: string, extra: { detalhe?: string; falta?: string; atalho?: Atalho } = {}) =>
    etapas.push({ id, nome: NOMES_ETAPA[id], estado, resumo, ...extra });
  const tarefa = (grupo: GrupoTarefa, ids: EtapaId[], urgente: boolean, porque: string) =>
    tarefas.push({ key: `${grupo}:${r.key}`, grupo, etapas: ids, urgente, porque });

  const totalContas = round2(r.contas.reduce((s, c) => s + Number(c.amount || 0), 0));
  const valor = p ? Number(p.total_amount || 0)
    : r.contas.length ? totalContas
    : nota ? Number(nota.valor_total || 0)
    : pedido ? Number(pedido.valor || 0)
    : Number(r.extrato[0]?.amount || 0);
  // Caso "só a saída do banco": saiu dinheiro e ninguém disse o que foi
  const soSaida = !p && !r.contas.length && !nota && !pedido && r.extrato.length > 0;

  // ── 1. Nota fiscal ───────────────────────────────────────────────────────────
  if (nota) {
    const servico = Number(nota.modelo) === 10 || nota.import_type === 'bill';
    add('documento', 'ok', `${servico ? 'Nota de serviço' : 'Nota'} nº ${nota.numero ?? '?'} recebida`, {
      detalhe: `${nota.emitente_nome ?? ''} · emitida ${diaBR(nota.emitted_at)} · ${brl(Number(nota.valor_total))}${nota.auto_imported ? ' · lançada pela conciliação' : ''}`,
      atalho: { tab: 'notas-entrada', param: 'busca', valor: String(nota.numero ?? nota.emitente_nome ?? '') },
    });
    if (p && !p.is_bonus && Math.abs(Number(nota.valor_total) - Number(p.total_amount)) > 1)
      avisos.push(`Valor da nota (${brl(Number(nota.valor_total))}) diferente da compra (${brl(Number(p.total_amount))})`);
  } else if (pedido) {
    add('documento', 'ok', `Pedido de pagamento: ${TIPO_PEDIDO[pedido.tipo] ?? pedido.tipo}`, {
      detalhe: `${pedido.solicitado_por_nome ? 'por ' + pedido.solicitado_por_nome + ' · ' : ''}${pedido.status}`,
      atalho: { tab: 'pagar' },
    });
  } else if (p?.invoice_number) {
    add('documento', 'ok', `Nota nº ${p.invoice_number} (número digitado, sem o arquivo)`);
  } else {
    add('documento', 'na', 'Sem nota fiscal', { detalhe: soSaida ? 'só o pagamento no banco' : undefined });
  }

  // ── 2. Compra ou despesa ─────────────────────────────────────────────────────
  // "Sem categoria" = mesma regra do ContasPagarDREModal / pay_bill: só conta que não é de compra
  // nem da folha, e sem dre_category_id (o texto `category` não conta).
  const semClassif = r.contas.filter((c) => c.reference_type !== 'purchase' && c.reference_type !== 'hr_payroll' && !c.dre_category_id);
  const atalhoConta = r.contas[0] ? { tab: 'pagar', param: 'busca', valor: r.contas[0].description } : undefined;
  if (p) {
    add('lancamento', 'ok', p.is_bonus ? 'Bonificação lançada em Compras' : 'Lançada em Compras', {
      detalhe: `${diaBR(p.purchase_date)} · ${brl(Number(p.total_amount))}${p.payment_method ? ' · ' + p.payment_method : ''}`,
      atalho: { tab: 'compras', param: 'foco', valor: p.id },
    });
  } else if (r.contas.length) {
    const cat = r.contas.find((c) => c.category)?.category;
    if (semClassif.length) {
      add('lancamento', 'pendente', 'Lançada em Despesas, mas sem categoria do DRE', { falta: 'escolher a categoria do DRE', atalho: atalhoConta });
      tarefa('classificar', ['lancamento'], false,
        `${plural(semClassif.length, 'A conta a pagar desta despesa', `${semClassif.length} contas a pagar desta despesa`)} ${plural(semClassif.length, 'foi lançada', 'foram lançadas')}, mas sem categoria do DRE.`);
    } else {
      add('lancamento', 'ok', cat ? `Lançada em Despesas — categoria ${cat}` : 'Lançada em Despesas', { atalho: atalhoConta });
    }
  } else if (nota && nota.status === 'new') {
    add('lancamento', 'pendente', 'A nota chegou, mas ainda não virou compra nem despesa', {
      falta: 'lançar como compra ou despesa', atalho: { tab: 'notas-entrada', param: 'busca', valor: String(nota.numero ?? '') },
    });
    tarefa('notas', ['lancamento'], false, `A nota nº ${nota.numero ?? '?'}, emitida em ${diaBR(nota.emitted_at)}, ainda não virou compra nem despesa.`);
  } else if (pedido) {
    const pend = pedido.status === 'pendente';
    add('lancamento', 'pendente', pend ? 'Pedido de pagamento esperando aprovação' : 'Pedido aprovado, mas ainda não lançado', {
      falta: pend ? 'aprovar ou recusar o pedido' : 'lançar o pedido', atalho: { tab: 'pagar' },
    });
    tarefa('pedidos', ['lancamento'], false,
      `O pedido de ${(TIPO_PEDIDO[pedido.tipo] ?? pedido.tipo).toLowerCase()} de ${brl(Number(pedido.valor))} ${pend ? 'está esperando aprovação' : 'foi aprovado, mas ainda não foi lançado'}.`);
  } else {
    const e0 = r.extrato[0];
    add('lancamento', 'problema', 'Saiu do banco, mas ninguém disse se foi compra, despesa ou outra coisa', {
      falta: 'dizer o que foi esse pagamento', atalho: { tab: 'conciliacao', extrato: e0 },
    });
    tarefa('saida_banco', ['lancamento', 'banco'], true,
      `Saíram ${brl(Math.abs(Number(e0?.amount || 0)))} do banco em ${diaBR(e0?.transaction_date)}${e0?.counterpart_name ? ' (' + e0.counterpart_name + ')' : ''}, e ninguém disse se foi compra, despesa ou outra coisa.`);
  }

  // ── 3. Estoque (só compra) ───────────────────────────────────────────────────
  const aindaNaoLancou = !p && !r.contas.length && (!!nota || !!pedido);
  const atalhoCompra = p ? { tab: 'compras', param: 'foco', valor: p.id } : undefined;
  if (!p) {
    if (aindaNaoLancou) add('estoque', 'espera', 'Espera virar compra ou despesa');
    else if (r.contas.length) add('estoque', 'na', 'Não precisa: despesa não vai ao estoque');
    else add('estoque', 'na', 'Não precisa');
  } else if (Number(p.itens_estoque) === 0) {
    add('estoque', 'na', 'Não precisa: nenhum item ligado a insumo', {
      detalhe: Number(p.itens) > 0 ? `${p.itens} ite${Number(p.itens) === 1 ? 'm' : 'ns'} sem insumo — não mexe no estoque` : undefined, atalho: atalhoCompra,
    });
  } else if (p.stock_applied_at) {
    const n = Number(p.itens_estoque), m = Number(p.itens);
    const resumo = n < m ? `${n} de ${m} itens entraram no estoque (os outros sem insumo)`
      : n === 1 ? 'O item entrou no estoque' : `Os ${n} itens entraram no estoque`;
    add('estoque', 'ok', resumo, { detalhe: `em ${diaBR(p.delivery_confirmed_at ?? p.stock_applied_at)}`, atalho: atalhoCompra });
  } else if (p.delivery_confirmed_at) {
    add('estoque', 'problema', `Chegou em ${diaBR(p.delivery_confirmed_at)}, mas o estoque não entrou`, { falta: 'ligar os itens aos insumos', atalho: atalhoCompra });
    tarefa('estoque', ['estoque'], true, `A mercadoria chegou em ${diaBR(p.delivery_confirmed_at)}, mas os itens ligados a insumos não entraram no estoque.`);
  } else {
    add('estoque', 'pendente', 'Ninguém confirmou que a mercadoria chegou', { falta: 'confirmar a entrega para os itens entrarem no estoque', atalho: atalhoCompra });
    tarefa('estoque', ['estoque'], false, `A compra foi lançada em ${diaBR(p.purchase_date)}, mas ninguém confirmou que a mercadoria chegou.`);
  }

  // ── 4. Conta a pagar ─────────────────────────────────────────────────────────
  const aVista = !!p && (r.caixa.length > 0 || (r.contas.length === 0 && p.payment_status === 'paid'));
  if (r.contas.length) {
    const n = r.contas.length;
    add('conta', 'ok', n > 1 ? `${n} parcelas criadas em Contas a pagar` : 'Conta a pagar criada', {
      detalhe: n === 1 ? `vence ${diaBR(r.contas[0].due_date)}` : brl(totalContas), atalho: atalhoConta,
    });
    if (p && !p.is_bonus && Math.abs(totalContas - Number(p.total_amount)) > 0.05)
      avisos.push(`Contas somam ${brl(totalContas)}, a compra é ${brl(Number(p.total_amount))}`);
  } else if (p?.is_bonus) {
    add('conta', 'na', 'Não precisa: bonificação');
  } else if (aVista) {
    add('conta', 'na', 'Não precisa: foi paga na hora');
  } else if (p) {
    add('conta', 'problema', 'Não foi paga na hora, mas ninguém criou a conta a pagar', {
      falta: 'criar a conta a pagar — senão ela nunca aparece para pagar', atalho: atalhoCompra,
    });
    tarefa('sem_conta', ['conta'], true, `A compra foi lançada em ${diaBR(p.purchase_date)} e não foi paga na hora, mas ninguém criou a conta a pagar dela.`);
  } else if (soSaida) {
    add('conta', 'na', 'Não precisa: já foi pago');
  } else {
    add('conta', 'espera', 'Espera virar compra ou despesa');
  }

  // ── 5. Pagamento ─────────────────────────────────────────────────────────────
  let estaPago = false;
  if (r.contas.length) {
    const abertas = r.contas.filter((c) => !pago(c));
    if (!abertas.length) {
      estaPago = true;
      const ult = r.contas.map((c) => d10(c.paid_date)).filter(Boolean).sort().pop();
      add('pagamento', 'ok', r.contas.length > 1 ? 'Todas as parcelas pagas' : 'Pago', { detalhe: ult ? 'em ' + diaBR(ult) : undefined, atalho: atalhoConta });
    } else {
      const vencidas = abertas.filter((c) => c.status === 'overdue' || (d10(c.due_date) && d10(c.due_date) < hoje));
      const prox = abertas.map((c) => d10(c.due_date)).filter(Boolean).sort()[0];
      const pagas = r.contas.length - abertas.length;
      const falta = round2(abertas.reduce((s, c) => s + Number(c.amount || 0) - Number(c.paid_amount || 0), 0));
      if (vencidas.length) {
        const maisAntiga = vencidas.map((c) => d10(c.due_date)).filter(Boolean).sort()[0] ?? '';
        const dias = diasEntre(maisAntiga, hoje);
        const diasTxt = `${dias} ${plural(dias, 'dia', 'dias')}`;
        add('pagamento', 'atrasado',
          vencidas.length > 1 ? `${vencidas.length} parcelas vencidas desde ${diaBR(maisAntiga)}` : `Venceu em ${diaBR(maisAntiga)} e não foi paga`, {
            detalhe: `falta ${brl(falta)}`, falta: `pagar — ${diasTxt} de atraso`,
            atalho: { tab: 'pagar', param: 'busca', valor: vencidas[0].description },
          });
        tarefa('vencidas', ['pagamento', 'banco'], true, vencidas.length > 1
          ? `${vencidas.length} parcelas venceram; a mais antiga há ${diasTxt}.` : `Venceu há ${diasTxt}.`);
      } else {
        add('pagamento', 'prazo',
          r.contas.length > 1
            ? (pagas ? `${pagas} de ${r.contas.length} parcelas pagas — a próxima vence em ${diaBR(prox)}` : `${r.contas.length} parcelas — a próxima vence em ${diaBR(prox)}`)
            : `Vence em ${diaBR(prox)}`,
          { detalhe: `falta ${brl(falta)}`, atalho: { tab: 'pagar', param: 'busca', valor: abertas[0].description } });
      }
    }
  } else if (p?.is_bonus) {
    add('pagamento', 'na', 'Não precisa: bonificação');
  } else if (aVista) {
    estaPago = true;
    const meio = p?.payment_method;
    add('pagamento', 'ok', meio ? `Pago na hora (${meio})` : 'Pago na hora', { detalhe: `em ${diaBR(r.caixa[0]?.date ?? p?.purchase_date)}` });
  } else if (soSaida) {
    estaPago = true;
    add('pagamento', 'ok', 'Pago — saiu do banco', { detalhe: `em ${diaBR(r.extrato[0].transaction_date)}` });
  } else {
    add('pagamento', 'espera', 'Espera a conta a pagar');
  }

  // ── 6. Extrato do banco ──────────────────────────────────────────────────────
  const meioPag = p?.payment_method ?? r.contas.find((c) => c.payment_method)?.payment_method ?? null;
  const conciliado = r.extrato.filter((e) => e.status === 'matched' || e.reconciled);
  if (conciliado.length) {
    const soma = round2(conciliado.reduce((s, e) => s + Number(e.amount || 0), 0));
    add('banco', 'ok', conciliado.length > 1 ? `${conciliado.length} saídas encontradas e ligadas no extrato` : 'Saída encontrada e ligada no extrato', {
      detalhe: `${diaBR(conciliado[0].transaction_date)} · ${brl(soma)}${conciliado[0].counterpart_name ? ' · ' + conciliado[0].counterpart_name : ''}`,
      atalho: { tab: 'conciliacao', extrato: conciliado[0] },
    });
    if (r.contas.length && !estaPago) avisos.push('Saiu do banco, mas a conta ainda está em aberto');
  } else if (r.extrato.length) {
    const e0 = r.extrato[0];
    const det = `${diaBR(e0.transaction_date)} · ${brl(Number(e0.amount))} · ${e0.counterpart_name ?? e0.description ?? ''}`;
    if (soSaida) {
      add('banco', 'espera', 'Está no extrato — liga sozinho quando você disser o que foi o pagamento', { detalhe: det, atalho: { tab: 'conciliacao', extrato: e0 } });
    } else {
      add('banco', 'problema', 'Está no extrato, mas não está ligado a nenhuma compra ou despesa', {
        detalhe: det, falta: 'ligar a saída a esta despesa', atalho: { tab: 'conciliacao', extrato: e0 },
      });
      tarefa('extrato', ['banco'], false, `A saída de ${brl(Math.abs(Number(e0.amount)))} em ${diaBR(e0.transaction_date)} está no extrato, mas não está ligada a nenhuma compra ou despesa.`);
    }
  } else if (!estaPago) {
    add('banco', p?.is_bonus ? 'na' : 'espera', p?.is_bonus ? 'Não precisa: bonificação' : 'Espera o pagamento');
  } else if (dinheiro(meioPag)) {
    add('banco', 'na', 'Não precisa: dinheiro não passa pelo banco');
  } else if (!temExtrato) {
    add('banco', 'na', 'Não precisa: a loja não tem extrato automático');
  } else {
    const dtPago = r.contas.map((c) => d10(c.paid_date)).filter(Boolean).sort().pop() ?? d10(p?.purchase_date);
    add('banco', 'pendente', 'Marcado como pago, mas a saída não foi achada no extrato', { falta: 'ligar a saída do extrato', atalho: { tab: 'conciliacao' } });
    tarefa('extrato', ['banco'], false, `Foi marcado como pago${dtPago ? ' em ' + diaBR(dtPago) : ''}, mas a saída não foi achada no extrato.`);
  }

  for (const j of r.juros) avisos.push(`Juros/multa de ${brl(Number(j.amount))} pagos junto`);

  const situacao: SituacaoCaso = etapas.some((e) => grave(e.estado)) || avisos.some((a) => !a.startsWith('Juros'))
    ? 'atencao'
    : etapas.some((e) => e.estado === 'pendente' || e.estado === 'espera' || e.estado === 'prazo') ? 'andamento' : 'ok';

  const titulo = p?.supplier ?? r.contas[0]?.supplier ?? nota?.emitente_nome ?? pedido?.favorecido_nome
    ?? r.contas[0]?.description ?? r.extrato[0]?.counterpart_name ?? r.extrato[0]?.description ?? 'Sem nome';
  const subtitulo = tipo === 'compra' ? (p?.is_bonus ? 'Bonificação' : 'Compra')
    : tipo === 'despesa' ? (r.contas[0]?.description && r.contas[0].description !== titulo ? r.contas[0].description : 'Despesa')
    : tipo === 'nota' ? 'Nota de entrada'
    : tipo === 'pedido' ? (pedido?.descricao ?? 'Pedido de pagamento')
    : (r.extrato[0]?.description ?? 'Pagamento no banco');

  return {
    key: r.key, tipo, titulo, subtitulo, valor: round2(valor), data: dataDo(r), etapas, situacao, avisos, tarefas,
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
