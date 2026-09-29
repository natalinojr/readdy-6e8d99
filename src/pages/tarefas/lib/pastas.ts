import type { TaskList } from '../hooks/useTarefas';

export interface NoPasta extends TaskList {
  filhas: NoPasta[];
  /** Quantos níveis abaixo da raiz — usado só para indentação. */
  profundidade: number;
}

/** Monta a árvore de pastas a partir da lista plana vinda do backend. Suporta
 * profundidade ilimitada; pai órfão (arquivado/removido) vira raiz. */
export function montarArvorePastas(lists: TaskList[]): NoPasta[] {
  const porId = new Map<string, NoPasta>();
  lists.forEach((l) => porId.set(l.id, { ...l, filhas: [], profundidade: 0 }));

  const raizes: NoPasta[] = [];
  lists.forEach((l) => {
    const no = porId.get(l.id)!;
    const pai = l.parent_list_id ? porId.get(l.parent_list_id) : null;
    if (pai) pai.filhas.push(no);
    else raizes.push(no);
  });

  // Ordem do usuário (arrastar na barra lateral). sort é estável: empate mantém a
  // ordem que o servidor mandou (sort_order, created_at).
  const marcarProfundidade = (nos: NoPasta[], nivel: number) => {
    nos.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
    nos.forEach((n) => {
      n.profundidade = nivel;
      marcarProfundidade(n.filhas, nivel + 1);
    });
  };
  marcarProfundidade(raizes, 0);

  return raizes;
}

/** Achata a árvore de volta (pré-ordem) — útil pra renderizar uma lista indentada. */
export function achatarArvore(nos: NoPasta[]): NoPasta[] {
  const resultado: NoPasta[] = [];
  const visitar = (lista: NoPasta[]) => {
    for (const n of lista) {
      resultado.push(n);
      visitar(n.filhas);
    }
  };
  visitar(nos);
  return resultado;
}

/** Nova ordem das irmãs ao soltar `arrastadaId` antes/depois de `alvoId`. */
export function reordenarIrmas(idsIrmas: string[], arrastadaId: string, alvoId: string, posicao: 'antes' | 'depois'): string[] {
  if (arrastadaId === alvoId || !idsIrmas.includes(arrastadaId) || !idsIrmas.includes(alvoId)) return idsIrmas;
  const sem = idsIrmas.filter((id) => id !== arrastadaId);
  const i = sem.indexOf(alvoId) + (posicao === 'depois' ? 1 : 0);
  return [...sem.slice(0, i), arrastadaId, ...sem.slice(i)];
}

/** A pasta e todas as subpastas dela (não dá pra mover uma pasta para dentro dela mesma). */
export function idsSubarvore(no: NoPasta): Set<string> {
  const ids = new Set<string>();
  const visitar = (n: NoPasta) => { ids.add(n.id); n.filhas.forEach(visitar); };
  visitar(no);
  return ids;
}
