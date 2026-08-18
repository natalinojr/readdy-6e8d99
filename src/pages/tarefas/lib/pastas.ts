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

  const marcarProfundidade = (nos: NoPasta[], nivel: number) => {
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
