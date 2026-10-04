// "Arrumar a lista" do Estoque (2026-10-04): que perguntas cada insumo ainda tem e que sugestão dar.
// Lógica pura (sem tela) para a ArrumarFolha e para os testes.
import { ehProduzido, precisaConferir, type InsumoSituacao, type SituacaoEstoque } from './estoqueRegras';

/** O que falta no cadastro. Também é o "filtro" do Arrumar a lista (uma pergunta só). */
export type Pergunta = 'fornecedor' | 'minimo' | 'preco' | 'negativo';
export interface ItemFila { ins: InsumoSituacao; perguntas: Pergunta[] }
export interface Forn { id: string; nome: string; n: number }
export interface SugestoesFornecedor { geral: Forn[]; porCategoria: Map<string, Forn[]> }

/** Texto digitado → número (aceita vírgula). vazio = não preencheu; valor null = digitou algo que não é número. */
export function lerNumero(t: string): { vazio: boolean; valor: number | null } {
  let s = t.trim();
  if (s === '') return { vazio: true, valor: null };
  // "1.500,5" e "1.500" (milhar) também valem, como se escreve no Brasil
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  const n = Number(s);
  return { vazio: false, valor: Number.isFinite(n) ? n : null };
}

/** Uma semana de uso, arredondada num passo amigável (un 1, g/ml 100, kg/L 0,5). null = sem histórico de uso. */
export function umaSemanaDeUso(i: Pick<InsumoSituacao, 'unidade' | 'consumoDia'>): number | null {
  if (!i.consumoDia || i.consumoDia <= 0) return null;
  const passo = i.unidade === 'unit' ? 1 : i.unidade === 'g' || i.unidade === 'ml' ? 100 : 0.5;
  return Math.max(passo, Math.round((i.consumoDia * 7) / passo) * passo);
}

/** O preço é pedido por kg/L quando o estoque é em g/ml; senão por unidade. `divisor` leva para a unidade do estoque. */
export function unidadeDoPreco(unidade: string): { rotulo: 'kg' | 'L' | 'un'; divisor: number } {
  if (unidade === 'g' || unidade === 'kg') return { rotulo: 'kg', divisor: unidade === 'g' ? 1000 : 1 };
  if (unidade === 'ml' || unidade === 'L') return { rotulo: 'L', divisor: unidade === 'ml' ? 1000 : 1 };
  return { rotulo: 'un', divisor: 1 };
}

/** R$ por kg/L digitado → preço na unidade do estoque (R$ 42,14/kg num insumo em g → 0,04214 por g). */
export function precoNaUnidadeDoEstoque(valorDigitado: number, unidade: string): number {
  return Math.round((valorDigitado / unidadeDoPreco(unidade).divisor) * 1e8) / 1e8;
}

/** Fornecedores (com id) dos insumos, do mais usado para o menos usado. Produzido na cozinha não conta. */
export function contarFornecedores(itens: InsumoSituacao[]): Forn[] {
  const mapa = new Map<string, Forn>();
  for (const i of itens) {
    if (!i.fornecedorId || !i.fornecedor || ehProduzido(i)) continue;
    const f = mapa.get(i.fornecedorId);
    if (f) f.n += 1; else mapa.set(i.fornecedorId, { id: i.fornecedorId, nome: i.fornecedor, n: 1 });
  }
  return [...mapa.values()].sort((a, b) => b.n - a.n || a.nome.localeCompare(b.nome, 'pt-BR'));
}

/** Insumos com cadastro faltando (só os que têm aviso ligado), com as perguntas de cada um.
 *  `filtro` deixa uma pergunta só; `insumoId` deixa um insumo só. A pergunta "negativo" (contar) só vale para quem pode contar. */
/** O que falta no cadastro deste insumo. Insumo "sem aviso" (acompanha = false) fica de fora de propósito.
 *  É a mesma conta do cartão "Arrumar a lista" (Lista e Início) e da fila: o número bate com o passo a passo. */
export function perguntasDoInsumo(i: InsumoSituacao, podeContar: boolean): Pergunta[] {
  if (!i.acompanha) return [];
  const perguntas: Pergunta[] = [];
  if (!i.fornecedorId && !i.fornecedor && !ehProduzido(i)) perguntas.push('fornecedor');
  if (!(i.minimo > 0)) perguntas.push('minimo');
  if (!(i.preco > 0)) perguntas.push('preco');
  if (podeContar && precisaConferir(i)) perguntas.push('negativo');
  return perguntas;
}

/** Quantos insumos têm cada pendência (cartão "Arrumar a lista"); `insumos` = quantos aparecem no passo a passo. */
export function contarPendencias(s: SituacaoEstoque, podeContar: boolean): Record<Pergunta, number> & { insumos: number } {
  const r = { fornecedor: 0, minimo: 0, preco: 0, negativo: 0, insumos: 0 };
  for (const i of s.insumos) {
    const p = perguntasDoInsumo(i, podeContar);
    if (p.length) r.insumos++;
    for (const x of p) r[x]++;
  }
  return r;
}

export function montarFila(
  s: SituacaoEstoque,
  filtro: Pergunta | undefined,
  insumoId: string | undefined,
  podeContar: boolean,
): { fila: ItemFila[]; sug: SugestoesFornecedor } {
  const fila: ItemFila[] = [];
  for (const i of s.insumos) {
    if (insumoId && i.id !== insumoId) continue;
    const perguntas = perguntasDoInsumo(i, podeContar);
    const doFiltro = filtro ? perguntas.filter((p) => p === filtro) : perguntas;
    if (doFiltro.length) fila.push({ ins: i, perguntas: doFiltro });
  }
  // Primeiro o que está errado de verdade (número impossível), depois o que já está baixo, depois o resto.
  const peso = (x: ItemFila) => (precisaConferir(x.ins) ? 0 : x.ins.esgotado || x.ins.abaixoMinimo ? 1 : 2);
  fila.sort((a, b) => peso(a) - peso(b) || a.ins.nome.localeCompare(b.ins.nome, 'pt-BR'));

  const porCategoria = new Map<string, Forn[]>();
  const categorias = new Set(s.insumos.map((i) => i.categoria).filter((c): c is string => !!c));
  for (const c of categorias) porCategoria.set(c, contarFornecedores(s.insumos.filter((i) => i.categoria === c)));
  return { fila, sug: { geral: contarFornecedores(s.insumos), porCategoria } };
}

/** Fornecedores sugeridos para um insumo: o mais comum da categoria dele + os mais usados da loja (até 3 no total). */
export function fornecedoresSugeridos(ins: Pick<InsumoSituacao, 'categoria'>, sug: SugestoesFornecedor): { sugerido: Forn | null; chips: Forn[] } {
  const daCategoria = ins.categoria ? sug.porCategoria.get(ins.categoria) ?? [] : [];
  const sugerido = daCategoria[0] ?? null;
  const resto = sug.geral.filter((f) => f.id !== sugerido?.id).slice(0, sugerido ? 2 : 3);
  return { sugerido, chips: sugerido ? [sugerido, ...resto] : resto };
}
