// Estoque › Insumos › Compras por insumo: contas puras (leitura da RPC fn_estoque_compras_periodo, ordem, busca, CSV).
import { montarCsv } from './consumoInsumos';

export interface CompraLinha { dia: string; fornecedor: string; nota: string | null; qtd: number; total: number }
export interface InsumoComprado {
  id: string;
  nome: string;
  /** Unidade do banco: g | kg | ml | L | unit */
  unidade: string;
  categoria: string | null;
  qtd: number;
  gasto: number;
  nCompras: number;
  ultima: string;
  compras: CompraLinha[];
  /** Gasto ÷ quantidade, na unidade do estoque */
  precoMedio: number;
  /** Fornecedores distintos, do que mais gastou para o que menos */
  fornecedores: string[];
}
export interface ComprasPeriodo {
  insumos: InsumoComprado[];
  semInsumo: { itens: number; valor: number };
}

const n = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };

/** Resposta da RPC → telas. Formato fora do esperado é erro (nunca "nada comprado"). */
export function lerCompras(raw: unknown): ComprasPeriodo {
  const o = raw as { insumos?: unknown; sem_insumo?: { itens?: unknown; valor?: unknown } } | null;
  if (!o || !Array.isArray(o.insumos)) throw new Error('Resposta inesperada das compras por insumo');
  const insumos = (o.insumos as Array<Record<string, unknown>>).map((r) => {
    const compras = (Array.isArray(r.compras) ? (r.compras as Array<Record<string, unknown>>) : []).map((c) => ({
      dia: String(c.dia ?? ''), fornecedor: String(c.fornecedor ?? ''), nota: c.nota ? String(c.nota) : null,
      qtd: n(c.qtd), total: n(c.total),
    }));
    const porForn = new Map<string, number>();
    for (const c of compras) if (c.fornecedor) porForn.set(c.fornecedor, (porForn.get(c.fornecedor) ?? 0) + c.total);
    const qtd = n(r.qtd);
    const gasto = n(r.gasto);
    return {
      id: String(r.id), nome: String(r.nome ?? ''), unidade: String(r.unidade ?? 'unit'),
      categoria: r.categoria ? String(r.categoria) : null,
      qtd, gasto, nCompras: n(r.n_compras), ultima: String(r.ultima ?? ''), compras,
      precoMedio: qtd > 0 ? gasto / qtd : 0,
      fornecedores: [...porForn.entries()].sort((a, b) => b[1] - a[1]).map(([nome]) => nome),
    } satisfies InsumoComprado;
  });
  return { insumos, semInsumo: { itens: n(o.sem_insumo?.itens), valor: n(o.sem_insumo?.valor) } };
}

export type OrdemCompras = 'gasto' | 'nome' | 'qtd' | 'recente';

export function ordenarCompras(lista: InsumoComprado[], ordem: OrdemCompras): InsumoComprado[] {
  const porNome = (a: InsumoComprado, b: InsumoComprado) => a.nome.localeCompare(b.nome, 'pt-BR');
  const c = [...lista];
  if (ordem === 'nome') return c.sort(porNome);
  if (ordem === 'qtd') return c.sort((a, b) => b.qtd - a.qtd || porNome(a, b));
  if (ordem === 'recente') return c.sort((a, b) => b.ultima.localeCompare(a.ultima) || porNome(a, b));
  return c.sort((a, b) => b.gasto - a.gasto || porNome(a, b));
}

export function totaisCompras(lista: InsumoComprado[]): { insumos: number; gasto: number; compras: number } {
  // "compras" = linhas de nota (um insumo pode estar na mesma nota de outro; conta por insumo e nota)
  return { insumos: lista.length, gasto: lista.reduce((s, i) => s + i.gasto, 0), compras: lista.reduce((s, i) => s + i.nCompras, 0) };
}

const dataBR = (ymd: string) => (/^\d{4}-\d{2}-\d{2}$/.test(ymd) ? `${ymd.slice(8)}/${ymd.slice(5, 7)}/${ymd.slice(0, 4)}` : ymd);
export { dataBR };

/** Uma linha por compra (o detalhe), no formato do Excel brasileiro. */
export function csvCompras(lista: InsumoComprado[]): string {
  const rot = (u: string) => (u === 'unit' ? 'un' : u);
  const linhas = lista.flatMap((i) => i.compras.map((c) => [
    i.nome, i.categoria ?? '', dataBR(c.dia), c.fornecedor, c.nota ?? '', c.qtd, rot(i.unidade),
    c.qtd > 0 ? Math.round((c.total / c.qtd) * 1e6) / 1e6 : 0, Math.round(c.total * 100) / 100,
  ]));
  return montarCsv(['Insumo', 'Categoria', 'Data', 'Fornecedor', 'Nota', 'Quantidade', 'Unidade', 'Preço unitário', 'Total'], linhas);
}
