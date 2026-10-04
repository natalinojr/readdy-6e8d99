import type { Insumo } from '@/contexts/EstoqueContext';
import {
  abaixoDoMinimo, estaEsgotado, precisaConferir, diasRestantesDe, ehProduzido,
  type InsumoSituacao,
} from '@/lib/estoqueRegras';
import { todayBrasilia } from '@/lib/dateUtils';

// Lista de Insumos (layout novo, 2026-10-04): tudo que a lista decide sobre um insumo (situação, filtros,
// pendências de cadastro, valor em estoque, dias sem contar) mora aqui, pela regra única do estoque
// (src/lib/estoqueRegras.ts). A tela só desenha; o que é regra é testado em src/test/lib/insumosLista.test.ts.

/** Insumo do EstoqueContext no formato das regras únicas (src/lib/estoqueRegras.ts). */
export const regraDoInsumo = (i: Insumo) => ({
  acompanha: i.rastrearEstoque !== false, minimo: i.estoqueMinimo, estoque: i.estoqueAtual, marcadoEsgotado: i.esgotado,
  contaInventario: i.contaInventario !== false,
});

/** Unidade do front ('un', 'l') → unidade do banco ('unit', 'L') que fmtQtd/fmtPrecoUnit esperam. */
export const unidadeDoBanco = (u: string | null | undefined): string => {
  if (u === 'un') return 'unit';
  if (u === 'l') return 'L';
  return u || 'unit';
};

// ── Situação de um insumo ─────────────────────────────────────────────────────
export type SituacaoLinha = 'conferir' | 'esgotado' | 'abaixo' | 'sem_aviso' | 'fora_contagem' | 'ok';

export const ROTULO_SITUACAO: Record<SituacaoLinha, string> = {
  conferir: 'Conferir', esgotado: 'Esgotado', abaixo: 'Abaixo do mínimo',
  sem_aviso: 'Sem aviso', fora_contagem: 'Fora da contagem', ok: 'Ok',
};

/** Sem aviso (acompanha = false) vem primeiro: o sistema não avisa nada por causa dele, nem "Esgotado". */
export function situacaoDe(b: { acompanha: boolean; contaInventario: boolean; minimo: number; estoque: number; marcadoEsgotado: boolean }): SituacaoLinha {
  if (!b.acompanha) return 'sem_aviso';
  if (precisaConferir(b)) return 'conferir';
  if (estaEsgotado(b)) return 'esgotado';
  if (abaixoDoMinimo(b)) return 'abaixo';
  if (!b.contaInventario) return 'fora_contagem';
  return 'ok';
}

// Rótulos pela regra única do estoque (src/lib/estoqueRegras.ts, 2026-10-03): estoque negativo (ou marcado
// esgotado com saldo) é "Conferir" — o número está errado; sem a antiga faixa "Crítico ≤ 50%". Insumo sem
// aviso não é "Esgotado" nem "Abaixo do mínimo" (antes ignorava o aviso); "Conferir" só vale para quem
// entra na contagem. Usado também pelo relatório por fornecedor.
export const statusEstoque = (i: Insumo) => {
  switch (situacaoDe(regraDoInsumo(i))) {
    case 'sem_aviso': return { label: 'Sem aviso', cls: 'text-zinc-600 bg-zinc-100' };
    case 'conferir': return { label: 'Conferir', cls: 'text-red-700 bg-red-50' };
    case 'esgotado': return { label: 'Esgotado', cls: 'text-red-600 bg-red-50' };
    case 'abaixo': return { label: 'Abaixo do mínimo', cls: 'text-amber-700 bg-amber-50' };
    default: return { label: 'Ok', cls: 'text-emerald-600 bg-emerald-50' };
  }
};

// ── Uma linha da lista ──────────────────────────────────────────────────────────
export interface LinhaInsumo {
  insumo: Insumo;
  id: string;
  nome: string;
  /** Categoria do insumo ou, se não tiver, a da ficha de produção (mesma usada no filtro) */
  categoria: string | null;
  fornecedor: string | null;
  produzido: boolean;
  /** Unidade do banco (g, kg, ml, L, unit) */
  unidade: string;
  estoque: number;
  minimo: number;
  preco: number;
  acompanha: boolean;
  contaInventario: boolean;
  marcadoEsgotado: boolean;
  /** Uso por dia (fn_estoque_situacao); null = sem histórico */
  consumoDia: number | null;
  /** Dias que o estoque dura no ritmo de uso; null = sem uso medido ou sem estoque */
  dias: number | null;
  situacao: SituacaoLinha;
  /** Estoque × preço; negativo não diminui o total (vale 0) */
  valor: number;
}

/**
 * Junta o insumo do EstoqueContext (sempre fresco) com a leitura da regra única (uso por dia, produzido,
 * fornecedor). A situação sai das regras em cima do estoque que a tela mostra, para o rótulo e o número baterem.
 */
export function montarLinha(
  insumo: Insumo,
  sit: InsumoSituacao | null,
  extra: { categoria: string | null; ehFicha: boolean },
): LinhaInsumo {
  const base = regraDoInsumo(insumo);
  const consumoDia = sit?.consumoDia ?? null;
  // Mesmo preço da regra única (fn_estoque_situacao: preço ou, sem ele, a última compra), como o resto da tela.
  const preco = insumo.precoUnitario || sit?.preco || 0;
  const estoque = insumo.estoqueAtual;
  return {
    insumo,
    id: insumo.id,
    nome: insumo.nome,
    categoria: extra.categoria,
    fornecedor: (sit?.fornecedor ?? insumo.fornecedor ?? '').trim() || null,
    produzido: !!sit?.produzido || extra.ehFicha,
    unidade: unidadeDoBanco(insumo.unidade),
    estoque,
    minimo: base.minimo,
    preco,
    acompanha: base.acompanha,
    contaInventario: base.contaInventario,
    marcadoEsgotado: base.marcadoEsgotado,
    consumoDia,
    dias: estoque > 0 ? diasRestantesDe({ estoque, consumoDia }) : null,
    situacao: situacaoDe(base),
    valor: Math.max(estoque, 0) * preco,
  };
}

/** "dura 21 dias" sem o "dura": null quando não há uso medido ou o estoque acabou. */
export function textoDura(dias: number | null): string | null {
  if (dias === null) return null;
  if (dias < 1) return 'menos de 1 dia';
  const n = Math.round(dias);
  if (n > 365) return 'mais de 1 ano';
  return n === 1 ? '1 dia' : `${n} dias`;
}

// ── Filtros de situação (chips) ─────────────────────────────────────────────────
export type FiltroSituacao = 'todos' | 'abaixo' | 'esgotado' | 'conferir' | 'sem_fornecedor' | 'fora_contagem' | 'ok';

type LinhaRegra = Pick<LinhaInsumo, 'acompanha' | 'contaInventario' | 'minimo' | 'estoque' | 'marcadoEsgotado' | 'produzido' | 'fornecedor' | 'preco'>;

/** Pede-se fornecedor de quem se compra e acompanha: o produzido na cozinha não tem. */
export const semFornecedor = (l: Pick<LinhaRegra, 'acompanha' | 'produzido' | 'fornecedor'>) =>
  l.acompanha && !ehProduzido({ produzido: l.produzido, fornecedor: l.fornecedor }) && !l.fornecedor;

/** O filtro e o número do chip saem desta mesma conta. "Ok" = só o que a etiqueta da linha mostra como Ok. */
export function passaFiltroSituacao(l: LinhaRegra, f: FiltroSituacao): boolean {
  switch (f) {
    case 'todos': return true;
    case 'abaixo': return abaixoDoMinimo(l);
    case 'esgotado': return estaEsgotado(l);
    case 'conferir': return precisaConferir(l);
    case 'sem_fornecedor': return semFornecedor(l);
    case 'fora_contagem': return !l.contaInventario;
    case 'ok': return situacaoDe(l) === 'ok';
  }
}

export const FILTROS_SITUACAO: FiltroSituacao[] = ['todos', 'abaixo', 'esgotado', 'conferir', 'sem_fornecedor', 'fora_contagem', 'ok'];

export function contagensPorFiltro(linhas: LinhaRegra[]): Record<FiltroSituacao, number> {
  const r = { todos: 0, abaixo: 0, esgotado: 0, conferir: 0, sem_fornecedor: 0, fora_contagem: 0, ok: 0 } as Record<FiltroSituacao, number>;
  for (const l of linhas) for (const f of FILTROS_SITUACAO) if (passaFiltroSituacao(l, f)) r[f]++;
  return r;
}

// ── "Falta arrumar no cadastro" ───────────────────────────────────────────────
export interface PendenciasCadastro {
  semFornecedor: number;
  semMinimo: number;
  semPreco: number;
  negativos: number;
  total: number;
}

/** Mesmas quatro contas do "Arrumar a lista": com aviso e sem mínimo; preço zero; negativos = Conferir. */
export function pendenciasCadastro(linhas: LinhaRegra[]): PendenciasCadastro {
  let sf = 0, sm = 0, sp = 0, ng = 0;
  for (const l of linhas) {
    if (semFornecedor(l)) sf++;
    if (l.acompanha && l.minimo <= 0) sm++;
    if (!(l.preco > 0)) sp++;
    if (precisaConferir(l)) ng++;
  }
  return { semFornecedor: sf, semMinimo: sm, semPreco: sp, negativos: ng, total: sf + sm + sp + ng };
}

/** Estoque × preço de todos os insumos; estoque negativo não diminui o total. */
export const valorEmEstoque = (linhas: Array<Pick<LinhaInsumo, 'estoque' | 'preco'>>) =>
  linhas.reduce((s, l) => s + Math.max(l.estoque, 0) * (l.preco || 0), 0);

// ── Dias sem contar ───────────────────────────────────────────────────────────
/** 'dd/mm/aaaa' (como o EstoqueContext guarda a data da contagem) → 'aaaa-mm-dd'; null se não for data. */
function ymdDeContagem(data: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(data.trim());
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

const diasEntre = (depois: string, antes: string) =>
  Math.round((Date.parse(`${depois}T12:00:00Z`) - Date.parse(`${antes}T12:00:00Z`)) / 86_400_000);

/** Dias desde a contagem confirmada mais recente (hoje em Brasília); null se nunca houve contagem. */
export function diasSemContar(sessoes: Array<{ data: string }>, hoje: string = todayBrasilia()): number | null {
  let ultima: string | null = null;
  for (const s of sessoes) {
    const ymd = ymdDeContagem(s.data);
    if (ymd && (!ultima || ymd > ultima)) ultima = ymd;
  }
  return ultima ? Math.max(0, diasEntre(hoje, ultima)) : null;
}

// ── Ordenação (clique no cabeçalho) ───────────────────────────────────────────
export type SortKey = 'nome' | 'categoria' | 'estoque' | 'minimo' | 'dura' | 'preco' | 'valor' | 'status';

const RANK_SITUACAO: Record<SituacaoLinha, number> = { conferir: 0, esgotado: 1, abaixo: 2, sem_aviso: 3, fora_contagem: 4, ok: 5 };

/** Sem uso medido (dura) vai sempre para o fim, qualquer que seja o sentido. */
export function ordenarLinhas<T extends LinhaInsumo>(linhas: T[], chave: SortKey | null, sentido: 'asc' | 'desc'): T[] {
  if (!chave) return linhas;
  const dir = sentido === 'asc' ? 1 : -1;
  const arr = [...linhas];
  arr.sort((a, b) => {
    switch (chave) {
      case 'nome': return dir * a.nome.localeCompare(b.nome, 'pt-BR');
      case 'categoria': return dir * (a.categoria ?? '').localeCompare(b.categoria ?? '', 'pt-BR') || a.nome.localeCompare(b.nome, 'pt-BR');
      case 'estoque': return dir * (a.estoque - b.estoque);
      case 'minimo': return dir * (a.minimo - b.minimo);
      case 'preco': return dir * (a.preco - b.preco);
      case 'valor': return dir * (a.valor - b.valor);
      case 'status': return dir * (RANK_SITUACAO[a.situacao] - RANK_SITUACAO[b.situacao]) || a.nome.localeCompare(b.nome, 'pt-BR');
      case 'dura': {
        if (a.dias === null && b.dias === null) return 0;
        if (a.dias === null) return 1;
        if (b.dias === null) return -1;
        return dir * (a.dias - b.dias);
      }
    }
  });
  return arr;
}

// ── Exportar ──────────────────────────────────────────────────────────────────
export const exportarInsumosCSV = (insumos: Insumo[]) => {
  const headers = ['Nome', 'Categoria', 'Fornecedor', 'Unidade', 'Preço Unit. (R$)', 'Estoque Atual', 'Estoque Mínimo', 'Status', 'Última Atualização'];
  const rows = insumos.map((i) => {
    const status = statusEstoque(i).label;
    return [
      i.nome,
      i.categoria || 'Sem categoria',
      i.fornecedor || '',
      i.unidade,
      i.precoUnitario.toFixed(2).replace('.', ','),
      String(i.estoqueAtual),
      String(i.estoqueMinimo),
      status,
      i.ultimaEntrada,
    ];
  });
  const csv = [headers, ...rows].map((r) => r.join(';')).join('\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  // Data de Brasília: depois das 21h o UTC já é o dia seguinte
  a.download = `insumos_${todayBrasilia()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
};
