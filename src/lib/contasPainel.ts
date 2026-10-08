// Financeiro › Contas (2026-10-08): as regras da tela, puras e testadas (src/test/lib/contasPainel.test.ts).
// Os fatos vêm de fn_contas_painel (uma chamada só). Aqui decide:
//  · o andamento de cada linha em 3 passos — Nota → Chegou → Pago (Pago só fica verde quando o banco confirma);
//  · a situação/próximo passo (Pagar, Cobrar loja, Explicar, Lançar, "em N dias");
//  · o grupo por tempo (Saiu sem explicação · Notas sem conta · Vencidas · Esta semana · Próxima semana · Depois);
//  · os números do topo, o "saldo depois" de cada conta e o projetado.
// Projetado (regra do dono): saldo depois + vendas previstas dia a dia + repasses de aplicativos já informados.
// Venda prevista de um dia = média, nos últimos N meses, do MESMO dia da semana na MESMA semana do mês
// (ex.: 2ª quinta → média das 2ªs quintas). Dia com o caixa (PDV) registrado usa o total real vendido; dia sem
// esse registro usa o cartão das maquininhas e estima o resto pela proporção do cartão nos dias registrados.

export type Passo = 'ok' | 'esp' | 'no' | 'amb' | 'na' | 'meio' | 'unk';
export type Grupo = 'semexp' | 'sem_conta' | 'venc' | 'sem' | 'prox' | 'dep' | 'pagas';
export type Situacao = 'pode' | 'venc_pagar' | 'venc_cobrar' | 'cobrar' | 'semexp' | 'sem_conta' | 'cartao' | 'pago' | 'pago_sem_banco';

export interface ContaAberta {
  id: string; nome: string; descricao: string | null; valor: number; total: number; vencimento: string; status: string;
  origem: string | null; reference_id: string | null; forma: string | null; tem_boleto: boolean; boleto_origem: string | null;
  ja_paga: boolean; parcela: number | null; parcelas: number | null; fixa: boolean; compra_id: string | null;
  nf: string | null; nf_sefaz: boolean; nf_emitida: string | null; compra_em: string | null; chegou_em: string | null; espera_chegar: boolean;
}
export interface ContaPaga {
  id: string; nome: string; descricao: string | null; valor: number; pago_em: string; forma: string | null; origem: string | null;
  fixa: boolean; nf: string | null; chegou_em: string | null; banco: boolean;
}
export interface NotaSemConta { id: string; doc_id: string; nome: string; numero: string | null; emitida: string; valor: number; vencimento: string; parcela: number; parcelas: number }
export interface LinhaExtrato { id: string; data: string; valor: number; descricao: string | null; source: string | null; tipo: string; bank_account_id?: string | null }
export interface SaldoConta { id: string; nome: string; saldo: number; atualizado_em: string | null; integrado: boolean }
export interface VendaDia { d: string; pdv_total: number | null; pdv_cartao: number | null; adq_cartao: number | null; adq_taxa: number | null }
export interface DadosPainel {
  hoje: string; inicio: string | null; abertas: ContaAberta[]; pagas: ContaPaga[]; notas_sem_conta: NotaSemConta[];
  extrato_pendente: LinhaExtrato[]; saldos: SaldoConta[]; vendas: VendaDia[]; ifood: { data: string; valor: number }[];
}

export interface Linha {
  id: string; tipo: 'conta' | 'saida' | 'nota' | 'paga';
  nome: string; sub: string; valor: number; data: string; dias: number;
  passos: [Passo, Passo, Passo]; situacao: Situacao; grupo: Grupo;
  atrasada: boolean; cartao: boolean;
  conta?: ContaAberta; paga?: ContaPaga; nota?: NotaSemConta; extrato?: LinhaExtrato;
}

/** Dias que a loja tem para confirmar a chegada antes de virar problema (decisão do dono, 2026-10-07). */
export const DIAS_PARA_CHEGAR = 3;

const ymd = (s: string | null | undefined) => (s ? String(s).slice(0, 10) : '');
export const somarDias = (d: string, n: number) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
export const diasEntre = (de: string, ate: string) => Math.round((Date.parse(`${ate}T12:00:00Z`) - Date.parse(`${de}T12:00:00Z`)) / 86400000);
/** 1 = segunda … 7 = domingo */
export const diaSemana = (d: string) => { const w = new Date(`${d}T12:00:00Z`).getUTCDay(); return w === 0 ? 7 : w; };
/** Domingo da semana de `d` (semana de segunda a domingo). */
export const fimDaSemana = (d: string) => somarDias(d, 7 - diaSemana(d));
const ehCartao = (forma: string | null | undefined) => !!forma && /cart[aã]o|credit|cr[eé]dito/i.test(forma) && !/d[eé]bito autom/i.test(forma);
const r2 = (v: number) => Math.round(v * 100) / 100;

function grupoPorData(data: string, hoje: string): Grupo {
  if (data < hoje) return 'venc';
  const dom = fimDaSemana(hoje);
  if (data <= dom) return 'sem';
  if (data <= somarDias(dom, 7)) return 'prox';
  return 'dep';
}

export function linhaConta(c: ContaAberta, hoje: string): Linha {
  const venc = ymd(c.vencimento);
  const vencida = venc < hoje;
  const nota: Passo = c.nf ? 'ok' : (c.fixa && c.tem_boleto ? 'ok' : 'na');
  let chegou: Passo = 'na';
  if (c.compra_id) {
    if (c.chegou_em) chegou = 'ok';
    else if (c.espera_chegar) {
      const base = ymd(c.nf_emitida) || ymd(c.compra_em) || venc;
      chegou = diasEntre(base, hoje) > DIAS_PARA_CHEGAR ? 'no' : 'esp';
    }
  }
  const pago: Passo = vencida ? 'no' : 'esp';
  const cartao = ehCartao(c.forma);
  let situacao: Situacao;
  if (vencida) situacao = chegou === 'esp' || chegou === 'no' ? 'venc_cobrar' : 'venc_pagar';
  else if (chegou === 'no') situacao = 'cobrar';
  else if (cartao) situacao = 'cartao';
  else situacao = 'pode';
  const partes = [c.nf ? `NF ${c.nf}` : (c.fixa ? 'conta fixa' : (c.descricao && c.descricao !== c.nome ? c.descricao : ''))];
  if (c.parcelas && c.parcelas > 1) partes.push(`${c.parcela ?? 1}/${c.parcelas}`);
  if (cartao) partes.push('cartão');
  else if (c.fixa && c.tem_boleto) partes.push(c.boleto_origem === 'email' ? 'boleto por e-mail' : 'boleto');
  return {
    id: c.id, tipo: 'conta', nome: c.nome, sub: partes.filter(Boolean).join(' · '), valor: Number(c.valor), data: venc,
    dias: diasEntre(hoje, venc), passos: [nota, chegou, pago], situacao, grupo: grupoPorData(venc, hoje),
    atrasada: vencida, cartao, conta: c,
  };
}

export function linhaSaida(e: LinhaExtrato, hoje: string): Linha {
  return {
    id: e.id, tipo: 'saida', nome: e.descricao || 'Saída do banco', sub: 'saiu do banco · ninguém disse o que foi', valor: Math.abs(Number(e.valor)),
    data: ymd(e.data), dias: diasEntre(hoje, ymd(e.data)), passos: ['amb', 'na', 'ok'], situacao: 'semexp', grupo: 'semexp',
    atrasada: false, cartao: false, extrato: e,
  };
}

export function linhaNota(n: NotaSemConta, hoje: string): Linha {
  const venc = ymd(n.vencimento);
  return {
    id: n.id, tipo: 'nota', nome: n.nome, sub: `NF ${n.numero ?? ''}${n.parcelas > 1 ? ` · ${n.parcela}/${n.parcelas}` : ''} · ainda não virou conta`.trim(),
    valor: Number(n.valor), data: venc, dias: diasEntre(hoje, venc), passos: ['ok', 'unk', venc < hoje ? 'no' : 'esp'],
    situacao: 'sem_conta', grupo: 'sem_conta', atrasada: venc < hoje, cartao: false, nota: n,
  };
}

export function linhaPaga(p: ContaPaga, hoje: string): Linha {
  const pago = ymd(p.pago_em);
  return {
    id: p.id, tipo: 'paga', nome: p.nome, sub: [p.nf ? `NF ${p.nf}` : (p.fixa ? 'conta fixa' : ''), p.forma ?? ''].filter(Boolean).join(' · '),
    valor: Number(p.valor), data: pago, dias: diasEntre(hoje, pago),
    passos: [p.nf ? 'ok' : 'na', p.chegou_em ? 'ok' : 'na', p.banco ? 'ok' : 'meio'],
    situacao: p.banco ? 'pago' : 'pago_sem_banco', grupo: 'pagas', atrasada: false, cartao: ehCartao(p.forma), paga: p,
  };
}

/** Todas as linhas em aberto (contas a pagar de verdade + notas com boleto sem conta + saídas sem explicação). */
export function linhasAbertas(d: DadosPainel): Linha[] {
  const contas = d.abertas.filter((c) => !c.ja_paga && Number(c.valor) > 0.005).map((c) => linhaConta(c, d.hoje));
  const notas = d.notas_sem_conta.map((n) => linhaNota(n, d.hoje));
  const saidas = d.extrato_pendente.filter((e) => e.tipo === 'debit').map((e) => linhaSaida(e, d.hoje));
  return [...saidas, ...notas, ...contas];
}

export const ORDEM_GRUPOS: Grupo[] = ['semexp', 'sem_conta', 'venc', 'sem', 'prox', 'dep'];

export interface Numeros {
  aPagar: { v: number; n: number }; vencidas: { v: number; n: number }; semana: { v: number; n: number };
  saldo: { v: number; atualizado_em: string | null }; saidas: { v: number; n: number }; entradasPendentes: { v: number; n: number };
}
export function numeros(d: DadosPainel, linhas: Linha[]): Numeros {
  const soma = (l: Linha[]) => ({ v: r2(l.reduce((s, x) => s + x.valor, 0)), n: l.length });
  const dividas = linhas.filter((l) => l.tipo !== 'saida');
  const integradas = d.saldos.filter((s) => s.atualizado_em).map((s) => s.atualizado_em as string).sort();
  const ent = d.extrato_pendente.filter((e) => e.tipo === 'credit');
  return {
    aPagar: soma(dividas),
    vencidas: soma(dividas.filter((l) => l.atrasada)),
    semana: soma(dividas.filter((l) => l.grupo === 'sem')),
    saldo: { v: r2(d.saldos.reduce((s, x) => s + Number(x.saldo || 0), 0)), atualizado_em: integradas.length ? integradas[0] : null },
    saidas: soma(linhas.filter((l) => l.tipo === 'saida')),
    entradasPendentes: { v: r2(ent.reduce((s, e) => s + Number(e.valor), 0)), n: ent.length },
  };
}

// ───────────────────────── Projeção ─────────────────────────

export type Janela = 1 | 2 | 3 | 6;
export interface Exemplo { d: string; vendas: number; cartao: number; estimado: boolean }
export interface PrevisaoDia { d: string; nome: string; exemplos: Exemplo[]; trocouSemana: boolean; vendas: number; entra: number; estimado: boolean }

const ORD = ['', '1ª', '2ª', '3ª', '4ª', '5ª'];
const NOMES = ['', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado', 'domingo'];
export const nomeDoDia = (d: string, nth = Math.ceil(Number(d.slice(8, 10)) / 7)) => {
  const w = diaSemana(d);
  return `${ORD[nth].replace('ª', w >= 6 ? 'º' : 'ª')} ${NOMES[w]}`;
};

/** A data com o mesmo dia da semana e a mesma ordem (1ª…5ª) num mês (AAAA-MM), ou null se o mês não tem. */
export function mesmoDiaNoMes(mes: string, dow: number, nth: number): string | null {
  const primeiro = `${mes}-01`;
  const off = (dow - diaSemana(primeiro) + 7) % 7;
  const d = somarDias(primeiro, off + (nth - 1) * 7);
  return d.slice(0, 7) === mes ? d : null;
}
const mesMenos = (mes: string, k: number) => { const [a, m] = mes.split('-').map(Number); const t = a * 12 + (m - 1) - k; return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`; };

export interface BaseProjecao { porDia: Map<string, VendaDia>; desde: string; parteCartao: number; taxaCartao: number }
export function baseProjecao(vendas: VendaDia[], hoje: string): BaseProjecao {
  const porDia = new Map(vendas.map((v) => [ymd(v.d), v]));
  const desde = vendas.length ? vendas.map((v) => ymd(v.d)).sort()[0] : hoje;
  const ini = somarDias(hoje, -90);
  let pdvT = 0, pdvC = 0, adqC = 0, adqT = 0;
  for (const v of vendas) {
    if (ymd(v.d) < ini) continue;
    if (v.pdv_total != null) { pdvT += Number(v.pdv_total); pdvC += Number(v.pdv_cartao || 0); }
    if (v.adq_cartao != null) { adqC += Number(v.adq_cartao); adqT += Number(v.adq_taxa || 0); }
  }
  return { porDia, desde, parteCartao: pdvT > 0 && pdvC > 0 ? pdvC / pdvT : 1, taxaCartao: adqC > 0 ? adqT / adqC : 0 };
}

function exemploDe(d: string, b: BaseProjecao): Exemplo | null {
  if (d < b.desde) return null;                       // antes de existir registro: não conta como zero
  const v = b.porDia.get(d);
  if (v && v.pdv_total != null) return { d, vendas: Number(v.pdv_total), cartao: Number(v.pdv_cartao || 0), estimado: false };
  if (v && v.adq_cartao != null) return { d, vendas: Number(v.adq_cartao) / b.parteCartao, cartao: Number(v.adq_cartao), estimado: b.parteCartao < 1 };
  return { d, vendas: 0, cartao: 0, estimado: false };
}

export function preverDia(d: string, hoje: string, janela: Janela, b: BaseProjecao): PrevisaoDia {
  const dow = diaSemana(d), nth = Math.ceil(Number(d.slice(8, 10)) / 7);
  const mesAtual = hoje.slice(0, 7);
  const meses = Array.from({ length: janela }, (_, i) => mesMenos(mesAtual, i + 1));
  const coleta = (n: number) => meses.map((m) => mesmoDiaNoMes(m, dow, n)).filter((x): x is string => !!x).map((x) => exemploDe(x, b)).filter((x): x is Exemplo => !!x);
  let exemplos = coleta(nth), trocou = false;
  if (!exemplos.length && nth === 5) { exemplos = coleta(4); trocou = true; }
  const n = exemplos.length || 1;
  const vendas = exemplos.reduce((s, e) => s + e.vendas, 0) / n;
  const cartao = exemplos.reduce((s, e) => s + e.cartao, 0) / n;
  return { d, nome: nomeDoDia(d, trocou ? 4 : nth), exemplos, trocouSemana: trocou, vendas: r2(vendas), entra: r2(vendas - cartao * b.taxaCartao), estimado: exemplos.some((e) => e.estimado) };
}

export interface SaldoLinha { real: number; proj: number; vendas: number; apps: number; ate: string; dias: PrevisaoDia[] }
/** Saldo depois de cada conta (ordem de vencimento; vencida = paga hoje) e o projetado até a data dela. */
export function saldosPorLinha(linhas: Linha[], saldo: number, d: DadosPainel, janela: Janela, pagosAgora: Set<string> = new Set()): Map<string, SaldoLinha> {
  const out = new Map<string, SaldoLinha>();
  const b = baseProjecao(d.vendas, d.hoje);
  const apps = new Map<string, number>(); d.ifood.forEach((x) => apps.set(ymd(x.data), (apps.get(ymd(x.data)) ?? 0) + Number(x.valor)));
  const ordem = linhas.filter((l) => l.tipo !== 'saida' && !pagosAgora.has(l.id)).sort((a, b2) => a.data.localeCompare(b2.data) || a.id.localeCompare(b2.id));
  let real = saldo, vendas = 0, ifd = 0, ultimo = d.hoje; const dias: PrevisaoDia[] = [];
  for (const l of ordem) {
    const ate = l.data < d.hoje ? d.hoje : l.data;
    while (ultimo < ate) { ultimo = somarDias(ultimo, 1); const p = preverDia(ultimo, d.hoje, janela, b); dias.push(p); vendas += p.entra; ifd += apps.get(ultimo) ?? 0; }
    real -= l.valor;
    out.set(l.id, { real: r2(real), proj: r2(real + vendas + ifd), vendas: r2(vendas), apps: r2(ifd), ate, dias: dias.slice() });
  }
  return out;
}
