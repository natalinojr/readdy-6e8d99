// Estoque: UMA regra para cada conceito (2026-10-03). Espelho das funções SQL insumo_abaixo_minimo /
// insumo_esgotado e do cálculo de fn_estoque_situacao (migração 20261003120000_estoque_situacao.sql):
// mudou aqui, muda lá. Quem mostra "estoque baixo" (Início do Estoque, Dashboard, tela Hoje, pendência
// do assistente) usa estas regras — antes eram 6 números diferentes para a mesma pergunta.
//
//   abaixo do mínimo = acompanha E mínimo > 0 E estoque <= mínimo
//   esgotado         = acompanha E (estoque <= 0 OU marcado como esgotado)
//   vai faltar       = acompanha E uso/dia > 0 E NÃO abaixo do mínimo E dias restantes <= dias de previsão
//   conferir         = acompanha E entra na contagem E (estoque negativo OU marcado esgotado com saldo)

export interface InsumoSituacao {
  id: string;
  nome: string;
  /** Unidade do banco: g | kg | ml | L | unit */
  unidade: string;
  categoria: string | null;
  fornecedorId: string | null;
  fornecedor: string | null;
  /** Só dígitos */
  fornecedorFone: string | null;
  /** Saída de uma ficha de produção da loja */
  produzido: boolean;
  estoque: number;
  minimo: number;
  marcadoEsgotado: boolean;
  /** track_stock: false = sem nenhum aviso */
  acompanha: boolean;
  /** count_inventory: false = fora da contagem */
  contaInventario: boolean;
  unidadeContagem: string | null;
  fatorContagem: number | null;
  /** Preço por unidade do estoque */
  preco: number;
  unidadeCompra: string | null;
  fatorCompra: number;
  /** null = loja com menos de 3 dias de histórico de uso */
  consumoDia: number | null;
  diasRestantes: number | null;
  ultimaContagem: string | null;
  abaixoMinimo: boolean;
  esgotado: boolean;
  vaiFaltar: boolean;
}

export type FrequenciaContagem = 'diaria' | 'semanal' | 'mensal';

export interface PlanoContagem {
  id: string;
  nome: string;
  frequencia: FrequenciaContagem;
  /** 0 = domingo (semanal) */
  diaSemana: number | null;
  /** 1..28; 0 = último dia do mês (mensal) */
  diaMes: number | null;
  /** true = todos os insumos que entram na contagem */
  todos: boolean;
  itens: string[];
  criadoEm: string;
}

export interface PedidoMandado {
  id: string;
  fornecedor: string;
  fornecedorNome: string | null;
  itens: Array<{ id: string; nome: string; texto: string }>;
  enviadoEm: string;
  enviadoPorNome: string | null;
}

export interface ConfigEstoque {
  /** Quanto pedir: o uso de N dias (padrão 60 = dois meses) */
  diasCompra: number;
  /** Horizonte do "vai faltar" (padrão 7) */
  diasPrevisao: number;
  podeConfigurar: boolean;
}

export interface SituacaoEstoque {
  hoje: string;
  config: ConfigEstoque;
  janelaDias: number | null;
  insumos: InsumoSituacao[];
  planos: PlanoContagem[];
  pedidos: PedidoMandado[];
  totais: { abaixoMinimo: number; esgotados: number; zeradosAbaixo: number; vaiFaltar: number };
}

export const DIAS_COMPRA_PADRAO = 60;
export const DIAS_PREVISAO_PADRAO = 7;

// ── Regras ────────────────────────────────────────────────────────────────────
type BaseRegra = { acompanha: boolean; minimo: number; estoque: number; marcadoEsgotado?: boolean };

export const abaixoDoMinimo = (i: BaseRegra) => i.acompanha && i.minimo > 0 && i.estoque <= i.minimo;
export const estaEsgotado = (i: BaseRegra) => i.acompanha && (i.estoque <= 0 || !!i.marcadoEsgotado);
export const diasRestantesDe = (i: { estoque: number; consumoDia: number | null }) =>
  i.consumoDia && i.consumoDia > 0 ? Math.max(i.estoque, 0) / i.consumoDia : null;
export const vaiFaltarEm = (i: BaseRegra & { consumoDia: number | null }, diasPrevisao: number) => {
  const d = diasRestantesDe(i);
  return i.acompanha && d !== null && !abaixoDoMinimo(i) && d <= diasPrevisao;
};
/** Número impossível (negativo) ou conflito: precisa contar para saber a verdade. */
export const precisaConferir = (i: InsumoSituacao) =>
  i.acompanha && i.contaInventario && (i.estoque < 0 || (i.marcadoEsgotado && i.estoque > 0));

/** Feito na cozinha: saída de ficha de produção ou cadastrado com fornecedor "Produção interna". */
export const ehProduzido = (i: Pick<InsumoSituacao, 'produzido' | 'fornecedor'>) =>
  i.produzido || /produ[cç][aã]o\s*interna/i.test(i.fornecedor ?? '');

// ── Quanto pedir ──────────────────────────────────────────────────────────────
export interface Sugestao {
  /** Na unidade do estoque */
  qtd: number;
  /** Embalagens de compra (null = pede na unidade do estoque) */
  embalagens: number | null;
  unidadeCompra: string | null;
}

/** Pede o uso de `diasCompra` dias; se o uso for pequeno ou desconhecido, o bastante para ficar com 2× o mínimo.
 *  Produzido na cozinha não é pedido (guacamole de 2 meses estraga): produz até 2× o mínimo. */
export function sugestaoCompra(i: InsumoSituacao, diasCompra: number): Sugestao {
  const saldo = Math.max(i.estoque, 0);
  const porUso = !ehProduzido(i) && i.consumoDia && i.consumoDia > 0 ? i.consumoDia * diasCompra : 0;
  let q = Math.max(porUso, 2 * i.minimo - saldo);
  if (q <= 0) q = i.minimo;
  return arredondarCompra(i, q);
}

/** Arredonda para cima na embalagem de compra (CX de 15 kg, pacote de 183 g) ou num passo amigável. */
export function arredondarCompra(i: Pick<InsumoSituacao, 'unidade' | 'unidadeCompra' | 'fatorCompra'>, q: number): Sugestao {
  if (i.unidadeCompra && i.fatorCompra > 0 && i.fatorCompra !== 1) {
    const emb = Math.max(1, Math.ceil(q / i.fatorCompra - 1e-9));
    return { qtd: arred(emb * i.fatorCompra), embalagens: emb, unidadeCompra: i.unidadeCompra };
  }
  const passo = i.unidade === 'unit' ? 1 : i.unidade === 'g' || i.unidade === 'ml' ? 10 : 0.1;
  return { qtd: arred(Math.max(passo, Math.ceil(q / passo - 1e-9) * passo)), embalagens: null, unidadeCompra: null };
}

// ── Lista de compras por fornecedor ───────────────────────────────────────────
export const CHAVE_PRODUZIR = '__fab';
export const CHAVE_SEM_FORNECEDOR = '__sem';

export function chaveFornecedor(i: InsumoSituacao): string {
  if (ehProduzido(i)) return CHAVE_PRODUZIR;
  if (i.fornecedorId) return i.fornecedorId;
  if (i.fornecedor) return 'nome:' + i.fornecedor.trim().toLowerCase();
  return CHAVE_SEM_FORNECEDOR;
}

export interface GrupoCompra {
  chave: string;
  nome: string;
  fone: string | null;
  itens: InsumoSituacao[];
}

const urgencia = (i: InsumoSituacao) => (i.esgotado ? -1 : i.diasRestantes ?? 1e9);

export function agruparCompras(itens: InsumoSituacao[]): GrupoCompra[] {
  const mapa = new Map<string, GrupoCompra>();
  for (const i of itens) {
    const chave = chaveFornecedor(i);
    let g = mapa.get(chave);
    if (!g) {
      g = {
        chave,
        nome: chave === CHAVE_PRODUZIR ? 'Produzir na cozinha' : chave === CHAVE_SEM_FORNECEDOR ? 'Sem fornecedor' : (i.fornecedor ?? 'Fornecedor'),
        fone: chave === CHAVE_PRODUZIR || chave === CHAVE_SEM_FORNECEDOR ? null : i.fornecedorFone,
        itens: [],
      };
      mapa.set(chave, g);
    }
    if (!g.fone && i.fornecedorFone && chave !== CHAVE_PRODUZIR && chave !== CHAVE_SEM_FORNECEDOR) g.fone = i.fornecedorFone;
    g.itens.push(i);
  }
  const ordem = (g: GrupoCompra) => (g.chave === CHAVE_SEM_FORNECEDOR ? 2 : g.chave === CHAVE_PRODUZIR ? 1 : 0);
  return [...mapa.values()]
    .map((g) => ({ ...g, itens: [...g.itens].sort((a, b) => urgencia(a) - urgencia(b) || a.nome.localeCompare(b.nome, 'pt-BR')) }))
    .sort((a, b) => ordem(a) - ordem(b)
      || b.itens.filter((i) => i.esgotado).length - a.itens.filter((i) => i.esgotado).length
      || a.nome.localeCompare(b.nome, 'pt-BR'));
}

// ── Planos de contagem ────────────────────────────────────────────────────────
// Datas sempre 'YYYY-MM-DD' no calendário de Brasília (o "hoje" vem do banco).
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const comoData = (s: string) => new Date(s.slice(0, 10) + 'T12:00:00Z');
const somar = (s: string, n: number) => { const d = comoData(s); d.setUTCDate(d.getUTCDate() + n); return ymd(d); };
const ultimoDiaDoMes = (ano: number, mes0: number) => new Date(Date.UTC(ano, mes0 + 1, 0)).getUTCDate();
const diaDoMesEm = (ano: number, mes0: number, diaMes: number) =>
  ymd(new Date(Date.UTC(ano, mes0, diaMes === 0 ? ultimoDiaDoMes(ano, mes0) : Math.min(diaMes, ultimoDiaDoMes(ano, mes0)), 12)));

/** Data agendada mais recente (<= hoje) do plano, sem considerar quando ele foi criado. */
function agendadaAte(p: PlanoContagem, hoje: string): string {
  if (p.frequencia === 'diaria') return hoje;
  if (p.frequencia === 'semanal') {
    const dow = comoData(hoje).getUTCDay();
    return somar(hoje, -(((dow - (p.diaSemana ?? 1)) + 7) % 7));
  }
  const d = comoData(hoje);
  const ano = d.getUTCFullYear(), mes = d.getUTCMonth();
  const desteMes = diaDoMesEm(ano, mes, p.diaMes ?? 1);
  if (desteMes <= hoje) return desteMes;
  return mes === 0 ? diaDoMesEm(ano - 1, 11, p.diaMes ?? 1) : diaDoMesEm(ano, mes - 1, p.diaMes ?? 1);
}

/** Próxima data agendada depois de `depoisDe`. */
export function proximaOcorrencia(p: PlanoContagem, depoisDe: string): string {
  if (p.frequencia === 'diaria') return somar(depoisDe, 1);
  if (p.frequencia === 'semanal') return somar(agendadaAte(p, depoisDe), 7);
  const d = comoData(depoisDe);
  const ano = d.getUTCFullYear(), mes = d.getUTCMonth();
  const desteMes = diaDoMesEm(ano, mes, p.diaMes ?? 1);
  if (desteMes > depoisDe) return desteMes;
  return mes === 11 ? diaDoMesEm(ano + 1, 0, p.diaMes ?? 1) : diaDoMesEm(ano, mes + 1, p.diaMes ?? 1);
}

/** Ocorrência que vale agora: a agendada mais recente, desde que depois da criação do plano. */
export function ocorrenciaAtual(p: PlanoContagem, hoje: string): string | null {
  const ag = agendadaAte(p, hoje);
  const criado = p.criadoEm ? dataBrasilia(p.criadoEm) : '0000-00-00';
  return ag >= criado ? ag : null;
}

export function itensDoPlano(p: PlanoContagem, insumos: InsumoSituacao[]): InsumoSituacao[] {
  if (p.todos) return insumos.filter((i) => i.contaInventario);
  const ids = new Set(p.itens);
  return insumos.filter((i) => ids.has(i.id));
}

export interface SituacaoPlano {
  plano: PlanoContagem;
  /** null = ainda não chegou o primeiro dia */
  ocorrencia: string | null;
  /** Dias de atraso (0 = é hoje) */
  atraso: number;
  pendentes: InsumoSituacao[];
  contados: InsumoSituacao[];
  proxima: string;
}

/** Quem do plano ainda não foi contado desde a ocorrência atual. */
export function situacaoPlano(p: PlanoContagem, insumos: InsumoSituacao[], hoje: string): SituacaoPlano {
  const itens = itensDoPlano(p, insumos);
  const oc = ocorrenciaAtual(p, hoje);
  const contadoDesde = (i: InsumoSituacao) => !!oc && !!i.ultimaContagem && dataBrasilia(i.ultimaContagem) >= oc;
  const pendentes = oc ? itens.filter((i) => !contadoDesde(i)) : [];
  const contados = oc ? itens.filter(contadoDesde) : [];
  const atraso = oc ? Math.round((comoData(hoje).getTime() - comoData(oc).getTime()) / 86400000) : 0;
  return { plano: p, ocorrencia: oc, atraso, pendentes, contados, proxima: proximaOcorrencia(p, oc && pendentes.length ? oc : hoje) };
}

export interface ContagemDeHoje {
  planos: SituacaoPlano[];
  /** Planos com itens por contar na ocorrência atual (hoje ou atrasados) */
  devidos: SituacaoPlano[];
  /** Número impossível: conta fora da rotina */
  conferir: InsumoSituacao[];
  /** Tudo o que precisa contar agora, sem repetir */
  itens: InsumoSituacao[];
}

export function contagemDeHoje(s: SituacaoEstoque): ContagemDeHoje {
  const planos = s.planos.map((p) => situacaoPlano(p, s.insumos, s.hoje));
  const devidos = planos.filter((p) => p.pendentes.length > 0);
  const conferir = s.insumos.filter(precisaConferir);
  const vistos = new Set<string>();
  const itens: InsumoSituacao[] = [];
  for (const i of [...conferir, ...devidos.flatMap((p) => p.pendentes)]) {
    if (!vistos.has(i.id)) { vistos.add(i.id); itens.push(i); }
  }
  return { planos, devidos, conferir, itens };
}

const DIAS_SEMANA = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
export const nomeDiaSemana = (d: number) => DIAS_SEMANA[d] ?? '';

export function descreverFrequencia(p: Pick<PlanoContagem, 'frequencia' | 'diaSemana' | 'diaMes'>): string {
  if (p.frequencia === 'diaria') return 'Todo dia';
  if (p.frequencia === 'semanal') return `Toda ${nomeDiaSemana(p.diaSemana ?? 1)}`.replace('Toda sábado', 'Todo sábado').replace('Toda domingo', 'Todo domingo');
  return p.diaMes === 0 ? 'Último dia do mês' : `Todo dia ${p.diaMes} do mês`;
}

/** "hoje", "amanhã", "segunda, 06/10" */
export function quandoFica(data: string, hoje: string): string {
  if (data === hoje) return 'hoje';
  if (data === somar(hoje, 1)) return 'amanhã';
  if (data === somar(hoje, -1)) return 'ontem';
  const d = comoData(data);
  return `${nomeDiaSemana(d.getUTCDay())}, ${data.slice(8, 10)}/${data.slice(5, 7)}`;
}

export const dataBrasilia = (ts: string) => new Date(ts).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });

// ── Formatação ────────────────────────────────────────────────────────────────
const arred = (n: number) => Math.round(n * 10000) / 10000;
export const rotuloUnidade = (u: string | null | undefined) => (!u || u === 'unit' ? 'un' : u);

/** 2046 g → "2,05 kg"; 1500 ml → "1,5 L"; 3 unit → "3 un". */
export function fmtQtd(q: number, unidade: string): string {
  const nf = (n: number, d: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: d });
  if (unidade === 'g' && Math.abs(q) >= 1000) return `${nf(q / 1000, 2)} kg`;
  if (unidade === 'ml' && Math.abs(q) >= 1000) return `${nf(q / 1000, 2)} L`;
  if (unidade === 'unit') return `${nf(q, 1)} un`;
  return `${nf(q, unidade === 'kg' || unidade === 'L' ? 2 : 0)} ${unidade}`;
}

/** Preço por unidade do estoque legível: insumo em grama sai por kg (R$ 0,0044/g → R$ 4,40/kg). */
export function fmtPrecoUnit(preco: number, unidade: string): string {
  if (!preco) return 'sem preço';
  const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  if (unidade === 'g') return `${brl(preco * 1000)}/kg`;
  if (unidade === 'ml') return `${brl(preco * 1000)}/L`;
  return `${brl(preco)}/${rotuloUnidade(unidade)}`;
}

/** "2 CX (30 kg)" ou "400 ml" */
export function fmtSugestao(s: Sugestao, unidade: string): string {
  if (s.embalagens != null) return `${s.embalagens} ${s.unidadeCompra} (${fmtQtd(s.qtd, unidade)})`;
  return fmtQtd(s.qtd, unidade);
}

// ── Leitura do banco (fn_estoque_situacao) ────────────────────────────────────
const num = (v: unknown) => (v == null || v === '' ? null : Number(v));

export function mapearSituacao(raw: Record<string, any>): SituacaoEstoque {
  const cfg = raw?.config ?? {};
  const t = raw?.totais ?? {};
  return {
    hoje: String(raw?.hoje ?? new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })),
    config: {
      diasCompra: Number(cfg.dias_compra ?? DIAS_COMPRA_PADRAO),
      diasPrevisao: Number(cfg.dias_previsao ?? DIAS_PREVISAO_PADRAO),
      podeConfigurar: !!cfg.pode_configurar,
    },
    janelaDias: num(raw?.janela_dias),
    insumos: ((raw?.insumos ?? []) as Array<Record<string, any>>).map((r) => ({
      id: String(r.id),
      nome: String(r.nome ?? ''),
      unidade: String(r.unidade ?? 'unit'),
      categoria: r.categoria ? String(r.categoria) : null,
      fornecedorId: r.fornecedor_id ? String(r.fornecedor_id) : null,
      fornecedor: r.fornecedor ? String(r.fornecedor) : null,
      fornecedorFone: r.fornecedor_fone ? String(r.fornecedor_fone) : null,
      produzido: !!r.produzido,
      estoque: Number(r.estoque ?? 0),
      minimo: Number(r.minimo ?? 0),
      marcadoEsgotado: !!r.marcado_esgotado,
      acompanha: r.acompanha !== false,
      contaInventario: r.conta_inventario !== false,
      unidadeContagem: r.unidade_contagem ? String(r.unidade_contagem) : null,
      fatorContagem: num(r.fator_contagem) && Number(r.fator_contagem) > 0 ? Number(r.fator_contagem) : null,
      preco: Number(r.preco ?? 0),
      unidadeCompra: r.unidade_compra ? String(r.unidade_compra) : null,
      fatorCompra: Number(r.fator_compra ?? 1) || 1,
      consumoDia: num(r.consumo_dia),
      diasRestantes: num(r.dias_restantes),
      ultimaContagem: r.ultima_contagem ? String(r.ultima_contagem) : null,
      abaixoMinimo: !!r.abaixo_minimo,
      esgotado: !!r.esgotado,
      vaiFaltar: !!r.vai_faltar,
    })),
    planos: ((raw?.planos ?? []) as Array<Record<string, any>>).map((p) => ({
      id: String(p.id),
      nome: String(p.nome ?? ''),
      frequencia: (p.frequencia ?? 'mensal') as FrequenciaContagem,
      diaSemana: num(p.dia_semana),
      diaMes: num(p.dia_mes),
      todos: !!p.todos,
      itens: Array.isArray(p.itens) ? p.itens.map(String) : [],
      criadoEm: String(p.created_at ?? ''),
    })),
    pedidos: ((raw?.pedidos ?? []) as Array<Record<string, any>>).map((e) => ({
      id: String(e.id),
      fornecedor: String(e.fornecedor ?? ''),
      fornecedorNome: e.fornecedor_nome ? String(e.fornecedor_nome) : null,
      itens: Array.isArray(e.itens) ? e.itens : [],
      enviadoEm: String(e.enviado_em ?? ''),
      enviadoPorNome: e.enviado_por_nome ? String(e.enviado_por_nome) : null,
    })),
    totais: {
      abaixoMinimo: Number(t.abaixo_minimo ?? 0),
      esgotados: Number(t.esgotados ?? 0),
      zeradosAbaixo: Number(t.zerados_abaixo ?? 0),
      vaiFaltar: Number(t.vai_faltar ?? 0),
    },
  };
}
