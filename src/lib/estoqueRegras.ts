// Estoque: UMA regra para cada conceito (2026-10-03). Espelho das funções SQL insumo_abaixo_minimo /
// insumo_esgotado e do cálculo de fn_estoque_situacao (migração 20261003120000_estoque_situacao.sql):
// mudou aqui, muda lá. Quem mostra "estoque baixo" (Início do Estoque, Dashboard, tela Hoje, pendência
// do assistente) usa estas regras — antes eram 6 números diferentes para a mesma pergunta.
//
//   abaixo do mínimo = acompanha E mínimo > 0 E estoque <= mínimo
//   esgotado         = acompanha E (estoque <= 0 OU marcado como esgotado)
//   vai faltar       = acompanha E uso/dia > 0 E NÃO abaixo do mínimo E dias restantes <= dias de previsão
//   conferir         = acompanha E entra na contagem E (estoque negativo OU marcado esgotado com saldo)

// Planos de contagem: a lógica mora em supabase/functions/_shared/estoque-planos.ts (o assistente-cron
// usa a mesma para o aviso no dia da contagem).
export * from '../../supabase/functions/_shared/estoque-planos';
import { situacaoPlano, type PlanoContagem, type SituacaoPlano, type FrequenciaContagem } from '../../supabase/functions/_shared/estoque-planos';

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
  /** Última entrada de mercadoria (30 dias) — pedido mandado antes dela já chegou */
  ultimaEntrada: string | null;
  abaixoMinimo: boolean;
  esgotado: boolean;
  vaiFaltar: boolean;
  /** Posto na lista de compras à mão (Vai faltar › Pôr na lista); sai sozinho quando a mercadoria chega */
  naLista: boolean;
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
  totais: { abaixoMinimo: number; esgotados: number; zeradosAbaixo: number; vaiFaltar: number; naLista: number };
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
export const precisaConferir = (i: Pick<InsumoSituacao, 'acompanha' | 'contaInventario' | 'estoque' | 'marcadoEsgotado'>) =>
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

/** Pedido mandado (últimos 7 dias) que ainda vale para o insumo: o insumo estava no pedido e não teve
 *  entrada de mercadoria depois do envio. Insumo novo no fornecedor, ou que chegou e baixou de novo, volta a pedir. */
export function pedidoDoInsumo(i: InsumoSituacao, pedidos: PedidoMandado[]): PedidoMandado | null {
  const chave = chaveFornecedor(i);
  for (const p of pedidos) {
    if (p.fornecedor !== chave) continue;
    if (!p.itens.some((x) => x.id === i.id)) continue;
    if (i.ultimaEntrada && i.ultimaEntrada > p.enviadoEm) continue;
    return p;
  }
  return null;
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

export interface ContagemDeHoje {
  planos: SituacaoPlano<InsumoSituacao>[];
  /** Planos com itens por contar na ocorrência atual (hoje ou atrasados) */
  devidos: SituacaoPlano<InsumoSituacao>[];
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
      ultimaEntrada: r.ultima_entrada ? new Date(String(r.ultima_entrada)).toISOString() : null,
      abaixoMinimo: !!r.abaixo_minimo,
      esgotado: !!r.esgotado,
      vaiFaltar: !!r.vai_faltar,
      naLista: !!r.na_lista,
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
      enviadoEm: e.enviado_em ? new Date(String(e.enviado_em)).toISOString() : '',
      enviadoPorNome: e.enviado_por_nome ? String(e.enviado_por_nome) : null,
    })),
    totais: {
      abaixoMinimo: Number(t.abaixo_minimo ?? 0),
      esgotados: Number(t.esgotados ?? 0),
      zeradosAbaixo: Number(t.zerados_abaixo ?? 0),
      vaiFaltar: Number(t.vai_faltar ?? 0),
      naLista: Number(t.na_lista ?? 0),
    },
  };
}
