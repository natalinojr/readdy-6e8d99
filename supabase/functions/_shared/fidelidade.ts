// deno-lint-ignore-file no-explicit-any
// Programa de fidelidade — formato da configuração, padrões e as contas da
// simulação (quantos clientes caem em cada nível, quanto o programa devolve,
// quanto custa cada giro da roleta).
//
// Arquivo ÚNICO para front e back: a Edge Function `fidelidade` importa daqui e
// o front usa via src/lib/fidelidade.ts (re-export). Sem imports, para rodar
// igual no Deno e no Vite.
//
// Fase 1 (2026-09-27): só configurar e simular. Nada credita ponto nem dá
// desconto ainda — isso é a Fase 2 (acúmulo no pedido pago + resgate no caixa).

export type TipoRecompensa = 'produto' | 'desconto_valor' | 'desconto_percentual' | 'frete_gratis';
export type TipoPremio = 'pontos' | 'recompensa' | 'desconto_percentual' | 'nada';
export type TipoPresente = 'nenhum' | 'pontos' | 'giro' | 'recompensa';

export interface Canais {
  salao: boolean;
  balcao: boolean;
  delivery: boolean;
  totem: boolean;
}

export interface Recompensa {
  id: string;
  nome: string;
  tipo: TipoRecompensa;
  /** R$ (desconto_valor) ou % (desconto_percentual). Produto/frete: 0. */
  valor: number;
  produto_id: string | null;
  custo_pontos: number;
  /** Quanto sai do bolso da loja em R$ (custo do produto, valor do desconto, frete). */
  custo_loja: number;
  /** Só a partir deste nível da trilha (null = qualquer cliente). */
  nivel_minimo: string | null;
  ativo: boolean;
}

export interface Nivel {
  id: string;
  nome: string;
  emoji: string;
  cor: string;
  min_compras: number;
  multiplicador: number;
  beneficios: string;
  presente_tipo: TipoPresente;
  /** pontos ou nº de giros; ignorado para 'recompensa' e 'nenhum'. */
  presente_valor: number;
  presente_recompensa_id: string | null;
}

export interface Premio {
  id: string;
  nome: string;
  tipo: TipoPremio;
  /** pontos ou %; 0 em 'recompensa' e 'nada'. */
  valor: number;
  recompensa_id: string | null;
  /** Peso relativo na roleta (a chance é peso / soma dos pesos). */
  peso: number;
  /** R$ que a loja gasta quando sai este prêmio. */
  custo_loja: number;
  /** No máximo N por dia na loja (0 = sem limite). */
  limite_dia: number;
  cor: string;
}

export interface FidelidadeConfig {
  nome_programa: string;
  pontos: {
    ativo: boolean;
    pontos_por_real: number;
    pedido_minimo: number;
    validade_meses: number;
    bonus_cadastro: number;
    bonus_aniversario: number;
    canais: Canais;
  };
  recompensas: Recompensa[];
  trilha: {
    ativo: boolean;
    /** Conta as compras dos últimos N dias (0 = desde sempre). */
    janela_dias: number;
    niveis: Nivel[];
  };
  roleta: {
    ativo: boolean;
    a_cada_compras: number;
    pedido_acima_de: number;
    ao_subir_nivel: boolean;
    aniversario: boolean;
    giro_validade_dias: number;
    premios: Premio[];
  };
}

export const CORES = ['#f59e0b', '#ef4444', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6', '#64748b'];

export function novoId(prefixo: string): string {
  return `${prefixo}_${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-3)}`;
}

// Padrão de uma loja que nunca configurou. Pensado para devolver ~5% do gasto
// em valor de venda (e bem menos em custo real) — faixa comum em food service.
export function configPadrao(): FidelidadeConfig {
  return {
    nome_programa: 'Clube de vantagens',
    pontos: {
      ativo: true,
      pontos_por_real: 1,
      pedido_minimo: 0,
      validade_meses: 6,
      bonus_cadastro: 20,
      bonus_aniversario: 50,
      canais: { salao: true, balcao: true, delivery: true, totem: true },
    },
    recompensas: [
      { id: 'rw_refri', nome: 'Refrigerante lata', tipo: 'produto', valor: 0, produto_id: null, custo_pontos: 120, custo_loja: 3, nivel_minimo: null, ativo: true },
      { id: 'rw_10reais', nome: 'R$ 10 de desconto', tipo: 'desconto_valor', valor: 10, produto_id: null, custo_pontos: 200, custo_loja: 10, nivel_minimo: null, ativo: true },
      // "Entrega grátis" (frete_gratis) fica fora do padrão: nenhuma tela aplica esse desconto ainda.
    ],
    trilha: {
      ativo: true,
      janela_dias: 365,
      niveis: [
        { id: 'lv_bronze', nome: 'Bronze', emoji: '🥉', cor: '#b45309', min_compras: 1, multiplicador: 1, beneficios: 'Acumula pontos em toda compra', presente_tipo: 'nenhum', presente_valor: 0, presente_recompensa_id: null },
        { id: 'lv_prata', nome: 'Prata', emoji: '🥈', cor: '#64748b', min_compras: 5, multiplicador: 1.2, beneficios: '+20% de pontos', presente_tipo: 'giro', presente_valor: 1, presente_recompensa_id: null },
        { id: 'lv_ouro', nome: 'Ouro', emoji: '🥇', cor: '#ca8a04', min_compras: 12, multiplicador: 1.5, beneficios: '+50% de pontos e prioridade no atendimento', presente_tipo: 'recompensa', presente_valor: 0, presente_recompensa_id: 'rw_refri' },
        { id: 'lv_diamante', nome: 'Diamante', emoji: '💎', cor: '#7c3aed', min_compras: 24, multiplicador: 2, beneficios: 'Pontos em dobro e prova novidades antes', presente_tipo: 'pontos', presente_valor: 200, presente_recompensa_id: null },
      ],
    },
    roleta: {
      ativo: false,
      a_cada_compras: 5,
      pedido_acima_de: 0,
      ao_subir_nivel: true,
      aniversario: true,
      giro_validade_dias: 30,
      premios: [
        { id: 'pz_nada', nome: 'Não foi dessa vez', tipo: 'nada', valor: 0, recompensa_id: null, peso: 42, custo_loja: 0, limite_dia: 0, cor: '#94a3b8' },
        { id: 'pz_20pts', nome: '+20 pontos', tipo: 'pontos', valor: 20, recompensa_id: null, peso: 30, custo_loja: 0, limite_dia: 0, cor: '#f59e0b' },
        { id: 'pz_refri', nome: 'Refri grátis', tipo: 'recompensa', valor: 0, recompensa_id: 'rw_refri', peso: 18, custo_loja: 3, limite_dia: 0, cor: '#10b981' },
        { id: 'pz_10off', nome: '10% na próxima', tipo: 'desconto_percentual', valor: 10, recompensa_id: null, peso: 10, custo_loja: 5, limite_dia: 0, cor: '#3b82f6' },
      ],
    },
  };
}

const num = (v: unknown, def: number, min = 0, max = 1_000_000): number => {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, n));
};
const txt = (v: unknown, def: string, max = 80): string => {
  const s = typeof v === 'string' ? v.trim() : '';
  return (s || def).slice(0, max);
};
const bool = (v: unknown, def: boolean): boolean => (typeof v === 'boolean' ? v : def);
const um = <T extends string>(v: unknown, opcoes: readonly T[], def: T): T =>
  (opcoes as readonly string[]).includes(String(v)) ? (v as T) : def;
const idOuNull = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 64) : null);

/** Completa o que falta com o padrão e corta valores fora de faixa. Aceita
 *  config vazia/antiga. Não inventa: lista vazia continua vazia. */
export function normalizarConfig(bruto: unknown): FidelidadeConfig {
  const p = configPadrao();
  const c = (bruto && typeof bruto === 'object' ? bruto : {}) as Record<string, any>;
  const pt = c.pontos ?? {};
  const tr = c.trilha ?? {};
  const ro = c.roleta ?? {};

  const recompensas: Recompensa[] = (Array.isArray(c.recompensas) ? c.recompensas : p.recompensas).slice(0, 50).map((r: any) => ({
    id: idOuNull(r?.id) ?? novoId('rw'),
    nome: txt(r?.nome, 'Recompensa'),
    tipo: um(r?.tipo, ['produto', 'desconto_valor', 'desconto_percentual', 'frete_gratis'] as const, 'produto'),
    valor: num(r?.valor, 0, 0, 100_000),
    produto_id: idOuNull(r?.produto_id),
    custo_pontos: Math.round(num(r?.custo_pontos, 100, 1, 1_000_000)),
    custo_loja: num(r?.custo_loja, 0, 0, 100_000),
    nivel_minimo: idOuNull(r?.nivel_minimo),
    ativo: bool(r?.ativo, true),
  }));

  const niveis: Nivel[] = (Array.isArray(tr.niveis) ? tr.niveis : p.trilha.niveis).slice(0, 10).map((n: any) => ({
    id: idOuNull(n?.id) ?? novoId('lv'),
    nome: txt(n?.nome, 'Nível', 40),
    emoji: txt(n?.emoji, '⭐', 8),
    cor: /^#[0-9a-f]{6}$/i.test(String(n?.cor)) ? String(n.cor) : '#64748b',
    min_compras: Math.round(num(n?.min_compras, 1, 0, 10_000)),
    multiplicador: num(n?.multiplicador, 1, 1, 10),
    beneficios: txt(n?.beneficios, '', 200),
    presente_tipo: um(n?.presente_tipo, ['nenhum', 'pontos', 'giro', 'recompensa'] as const, 'nenhum'),
    presente_valor: Math.round(num(n?.presente_valor, 0, 0, 100_000)),
    presente_recompensa_id: idOuNull(n?.presente_recompensa_id),
  }));
  niveis.sort((a, b) => a.min_compras - b.min_compras);

  const premios: Premio[] = (Array.isArray(ro.premios) ? ro.premios : p.roleta.premios).slice(0, 12).map((z: any, i: number) => ({
    id: idOuNull(z?.id) ?? novoId('pz'),
    nome: txt(z?.nome, 'Prêmio', 40),
    tipo: um(z?.tipo, ['pontos', 'recompensa', 'desconto_percentual', 'nada'] as const, 'nada'),
    valor: num(z?.valor, 0, 0, 100_000),
    recompensa_id: idOuNull(z?.recompensa_id),
    peso: num(z?.peso, 1, 0, 1_000),
    custo_loja: num(z?.custo_loja, 0, 0, 100_000),
    limite_dia: Math.round(num(z?.limite_dia, 0, 0, 10_000)),
    cor: /^#[0-9a-f]{6}$/i.test(String(z?.cor)) ? String(z.cor) : CORES[i % CORES.length],
  }));

  return {
    nome_programa: txt(c.nome_programa, p.nome_programa, 60),
    pontos: {
      ativo: bool(pt.ativo, p.pontos.ativo),
      pontos_por_real: num(pt.pontos_por_real, p.pontos.pontos_por_real, 0, 100),
      pedido_minimo: num(pt.pedido_minimo, p.pontos.pedido_minimo, 0, 10_000),
      validade_meses: Math.round(num(pt.validade_meses, p.pontos.validade_meses, 0, 60)),
      bonus_cadastro: Math.round(num(pt.bonus_cadastro, p.pontos.bonus_cadastro, 0, 100_000)),
      bonus_aniversario: Math.round(num(pt.bonus_aniversario, p.pontos.bonus_aniversario, 0, 100_000)),
      canais: {
        salao: bool(pt.canais?.salao, true),
        balcao: bool(pt.canais?.balcao, true),
        delivery: bool(pt.canais?.delivery, true),
        totem: bool(pt.canais?.totem, true),
      },
    },
    recompensas,
    trilha: {
      ativo: bool(tr.ativo, p.trilha.ativo),
      janela_dias: Math.round(num(tr.janela_dias, p.trilha.janela_dias, 0, 3650)),
      niveis,
    },
    roleta: {
      ativo: bool(ro.ativo, p.roleta.ativo),
      a_cada_compras: Math.round(num(ro.a_cada_compras, p.roleta.a_cada_compras, 0, 1000)),
      pedido_acima_de: num(ro.pedido_acima_de, p.roleta.pedido_acima_de, 0, 100_000),
      ao_subir_nivel: bool(ro.ao_subir_nivel, p.roleta.ao_subir_nivel),
      aniversario: bool(ro.aniversario, p.roleta.aniversario),
      giro_validade_dias: Math.round(num(ro.giro_validade_dias, p.roleta.giro_validade_dias, 1, 365)),
      premios,
    },
  };
}

// ── Contas da simulação ─────────────────────────────────────────────────────

/** Nível de quem tem `compras` compras na janela (null = ainda não entrou na trilha). */
export function nivelPorCompras(compras: number, niveis: Nivel[]): Nivel | null {
  let atual: Nivel | null = null;
  for (const n of [...niveis].sort((a, b) => a.min_compras - b.min_compras)) {
    if (compras >= n.min_compras) atual = n;
  }
  return atual;
}

export interface FaixaHistograma { compras: number; clientes: number; gasto: number }

/** Quantos clientes (e quanto gasto) caem em cada nível, com os pedidos de hoje. */
export function distribuirNiveis(hist: FaixaHistograma[], niveis: Nivel[]) {
  const porNivel = new Map<string, { clientes: number; gasto: number }>();
  let fora = 0;
  for (const n of niveis) porNivel.set(n.id, { clientes: 0, gasto: 0 });
  for (const f of hist) {
    const n = nivelPorCompras(f.compras, niveis);
    if (!n) { fora += f.clientes; continue; }
    const a = porNivel.get(n.id)!;
    a.clientes += f.clientes;
    a.gasto += f.gasto;
  }
  return { porNivel, fora };
}

/** Quanto a loja gasta, em R$, para devolver 1 ponto — pior caso: a recompensa
 *  ativa que mais custa por ponto (é para ela que o cliente esperto corre).
 *  Sem recompensa ativa: 0. */
export function custoPorPonto(recompensas: Recompensa[]): number {
  const ativas = recompensas.filter((r) => r.ativo && r.custo_pontos > 0);
  if (ativas.length === 0) return 0;
  return Math.max(...ativas.map((r) => r.custo_loja / r.custo_pontos));
}

/** % do faturamento que volta ao cliente em custo real, se todo ponto for
 *  resgatado na recompensa mais generosa (pior caso para a loja). */
export function retornoPercentual(cfg: FidelidadeConfig, multiplicadorMedio = 1): number {
  if (!cfg.pontos.ativo) return 0;
  return cfg.pontos.pontos_por_real * multiplicadorMedio * custoPorPonto(cfg.recompensas) * 100;
}

/** Chance de cada prêmio (0–1) e custo esperado de UM giro em R$. */
export function chancesRoleta(premios: { id: string; peso: number; custo_loja?: number }[]) {
  const soma = premios.reduce((s, p) => s + Math.max(0, p.peso), 0);
  const chances = premios.map((p) => ({ id: p.id, chance: soma > 0 ? Math.max(0, p.peso) / soma : 0 }));
  const custoGiro = premios.reduce((s, p, i) => s + chances[i].chance * (p.custo_loja ?? 0), 0);
  return { chances, custoGiro, soma };
}

/** Parte da tela (aba Fidelidade) a que o aviso se refere. */
export type SecaoAviso = 'recompensas' | 'trilha' | 'roleta';
export interface AvisoConfig { secao: SecaoAviso; texto: string }

/** Avisos de configuração que não impedem salvar (rascunho), mas quase sempre são
 *  engano — e por isso impedem LIGAR o programa. Cada um diz a que seção pertence. */
export function avisosConfigPorSecao(cfg: FidelidadeConfig): AvisoConfig[] {
  const av: AvisoConfig[] = [];
  const add = (secao: SecaoAviso, texto: string) => { av.push({ secao, texto }); };
  const ids = new Set(cfg.recompensas.map((r) => r.id));
  const niveisIds = new Set(cfg.trilha.niveis.map((n) => n.id));
  if (cfg.pontos.ativo && !cfg.recompensas.some((r) => r.ativo)) add('recompensas', 'Pontos ligados sem nenhuma recompensa ativa: o cliente acumula e não tem no que trocar.');
  for (const r of cfg.recompensas) {
    if (r.nivel_minimo && !niveisIds.has(r.nivel_minimo)) add('recompensas', `"${r.nome}" pede um nível que não existe mais.`);
    if (r.tipo === 'produto' && !r.produto_id) add('recompensas', `"${r.nome}" é produto mas não está ligada a um item do cardápio.`);
    if (r.tipo === 'frete_gratis') add('recompensas', `A recompensa "${r.nome}" é do tipo Entrega grátis, que o delivery ainda não aplica — troque o tipo ou exclua.`);
    if (r.tipo === 'desconto_percentual' && r.valor > 100) add('recompensas', `"${r.nome}" dá mais de 100% de desconto.`);
  }
  const mins = cfg.trilha.niveis.map((n) => n.min_compras);
  if (new Set(mins).size !== mins.length) add('trilha', 'Dois níveis da trilha pedem o mesmo número de compras.');
  for (const n of cfg.trilha.niveis) {
    if (n.presente_tipo === 'recompensa' && (!n.presente_recompensa_id || !ids.has(n.presente_recompensa_id))) add('trilha', `O presente do nível ${n.nome} aponta para uma recompensa que não existe.`);
  }
  if (cfg.roleta.ativo) {
    if (cfg.roleta.premios.length < 2) add('roleta', 'A roleta precisa de pelo menos 2 prêmios.');
    if (cfg.roleta.premios.length > 0 && chancesRoleta(cfg.roleta.premios).soma <= 0) add('roleta', 'Roleta ligada com todos os pesos zero: nenhum prêmio pode sair.');
    if (!cfg.roleta.a_cada_compras && !cfg.roleta.pedido_acima_de && !cfg.roleta.ao_subir_nivel && !cfg.roleta.aniversario) add('roleta', 'Roleta ligada, mas nenhuma regra dá giro ao cliente.');
    if (!cfg.roleta.premios.some((p) => p.tipo === 'nada')) add('roleta', 'Sem "Não foi dessa vez", todo giro custa alguma coisa — confira o custo por giro.');
    for (const p of cfg.roleta.premios) {
      if (p.tipo === 'recompensa' && (!p.recompensa_id || !ids.has(p.recompensa_id))) add('roleta', `Prêmio "${p.nome}" aponta para uma recompensa que não existe.`);
      if (p.tipo === 'desconto_percentual' && p.valor > 100) add('roleta', `Prêmio "${p.nome}" dá mais de 100% de desconto.`);
    }
  }
  return av;
}

/** Só os textos dos avisos (ver avisosConfigPorSecao). */
export function avisosConfig(cfg: FidelidadeConfig): string[] {
  return avisosConfigPorSecao(cfg).map((a) => a.texto);
}

/** Onde a recompensa `id` está em uso (presente de nível ou prêmio da roleta), ex.:
 *  ["Nível Ouro", "Roleta (Refri grátis)"]. Vazio = pode excluir sem deixar ponta solta. */
export function usosDaRecompensa(cfg: FidelidadeConfig, id: string): string[] {
  const usos: string[] = [];
  for (const n of cfg.trilha.niveis) {
    if (n.presente_tipo === 'recompensa' && n.presente_recompensa_id === id) usos.push(`Nível ${n.nome}`);
  }
  const premios = cfg.roleta.premios.filter((p) => p.tipo === 'recompensa' && p.recompensa_id === id);
  if (premios.length > 0) usos.push(`Roleta (${premios.map((p) => p.nome).join(', ')})`);
  return usos;
}

// ── Clube no tablet ─────────────────────────────────────────────────────────

/** Só dígitos. */
export function soDigitos(v: unknown): string {
  return String(v ?? '').replace(/\D/g, '');
}

/** CPF válido (dígitos verificadores; rejeita 000.000.000-00 e afins). */
export function cpfValido(v: unknown): boolean {
  const d = soDigitos(v);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const dv = (base: string, peso: number) => {
    let s = 0;
    for (let i = 0; i < base.length; i++) s += Number(base[i]) * (peso - i);
    const r = (s * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(d.slice(0, 9), 10) === Number(d[9]) && dv(d.slice(0, 10), 11) === Number(d[10]);
}

export function formatarCpf(v: unknown): string {
  const d = soDigitos(v).slice(0, 11);
  return d.replace(/^(\d{3})(\d)/, '$1.$2').replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3').replace(/\.(\d{3})(\d)/, '.$1-$2');
}

export interface ClubeNivel { id: string; nome: string; emoji: string; cor: string; min_compras: number; multiplicador: number; beneficios: string }
export interface ClubeRecompensa { id: string; nome: string; tipo: TipoRecompensa; valor: number; produto_id: string | null; custo_pontos: number; nivel_ok: boolean; nivel_minimo: string | null; falta: number }
export interface ClubeBeneficio { id: string; origem: string; reward: { tipo: TipoRecompensa; nome: string; valor: number; produto_id?: string | null; motivo?: string }; expires_at: string | null }

/** O que o tablet recebe ao identificar o cliente (fn_fidelidade_resumo). */
export interface ClubeResumo {
  customer_id: string;
  primeiro_nome: string;
  membro: boolean;
  programa: string;
  ativo: boolean;
  saldo: number;
  vence_30d: number;
  pontos_por_real: number;
  compras_janela: number;
  nivel: ClubeNivel | null;
  proximo: ClubeNivel | null;
  faltam_compras: number | null;
  recompensas: ClubeRecompensa[];
  beneficios: ClubeBeneficio[];
  giros: number;
  /** Sem celular não dá para confirmar resgate no tablet (fica com o caixa). */
  tem_celular: boolean;
}

/** Um resgate reservado para o pedido atual. */
export interface ClubeReserva {
  hold_id: string;
  fonte: 'pontos' | 'beneficio';
  reward: { tipo: TipoRecompensa; nome: string; valor: number; produto_id?: string | null; custo_pontos?: number };
}

/** Quanto cada reserva desconta do pedido, dado o carrinho. Produto grátis só
 *  vale se o produto estiver no carrinho (desconta 1 unidade). Nunca passa do subtotal. */
export function descontoDasReservas(
  reservas: ClubeReserva[],
  itens: { id: string; preco: number; qtd: number }[],
  subtotal: number,
): { porReserva: Record<string, number>; total: number } {
  const porReserva: Record<string, number> = {};
  let total = 0;
  const usados = new Map<string, number>();
  for (const r of reservas) {
    let v = 0;
    const w = r.reward;
    if (w.tipo === 'produto' && w.produto_id) {
      const it = itens.find((i) => i.id === w.produto_id);
      const ja = usados.get(w.produto_id) ?? 0;
      if (it && it.qtd > ja) { v = it.preco; usados.set(w.produto_id, ja + 1); }
    } else if (w.tipo === 'desconto_valor') {
      v = Number(w.valor) || 0;
    } else if (w.tipo === 'desconto_percentual') {
      v = subtotal * (Number(w.valor) || 0) / 100;
    }
    v = Math.max(0, Math.min(v, subtotal - total));
    v = Math.round(v * 100) / 100;
    porReserva[r.hold_id] = v;
    total += v;
  }
  return { porReserva, total: Math.round(total * 100) / 100 };
}
