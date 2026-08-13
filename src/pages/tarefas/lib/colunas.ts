import type { CampoCustom } from '../hooks/useTarefas';

/**
 * Colunas da view Lista — nativas (fixas) + uma por campo personalizado.
 * Qual conjunto fica visível é preferência pessoal (localStorage por lista),
 * não configuração do time — por isso não mexe em `task_custom_fields`.
 */
export type ColunaId =
  | 'responsavel' | 'vencimento' | 'prioridade' | 'etiquetas'
  | 'checklist' | 'subtarefas' | 'comentarios' | 'criada_em'
  | `campo:${string}`;

export interface ColunaDef {
  id: ColunaId;
  label: string;
  larguraPx: number;
}

export const COLUNAS_NATIVAS: ColunaDef[] = [
  { id: 'responsavel', label: 'Responsável', larguraPx: 140 },
  { id: 'vencimento', label: 'Vencimento', larguraPx: 110 },
  { id: 'prioridade', label: 'Prioridade', larguraPx: 120 },
  { id: 'etiquetas', label: 'Etiquetas', larguraPx: 170 },
  { id: 'checklist', label: 'Checklist', larguraPx: 90 },
  { id: 'subtarefas', label: 'Subtarefas', larguraPx: 90 },
  { id: 'comentarios', label: 'Comentários', larguraPx: 100 },
  { id: 'criada_em', label: 'Criada em', larguraPx: 100 },
];

/** Default = o que já aparecia antes de existir esse menu (não muda a experiência de quem já usa). */
const COLUNAS_PADRAO: ColunaId[] = ['responsavel', 'vencimento', 'prioridade', 'etiquetas'];

export function colunasDisponiveis(campos: CampoCustom[], listId: string | null): ColunaDef[] {
  const doCampos: ColunaDef[] = campos
    .filter((c) => c.list_id === null || c.list_id === listId)
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((c) => ({ id: `campo:${c.id}` as ColunaId, label: c.name, larguraPx: 150 }));
  return [...COLUNAS_NATIVAS, ...doCampos];
}

function chaveStorage(listId: string): string {
  return `erpos_tarefas_colunas_${listId}`;
}

export function carregarColunasVisiveis(listId: string): ColunaId[] {
  try {
    const bruto = localStorage.getItem(chaveStorage(listId));
    if (!bruto) return COLUNAS_PADRAO;
    const arr = JSON.parse(bruto);
    return Array.isArray(arr) ? (arr as ColunaId[]) : COLUNAS_PADRAO;
  } catch {
    return COLUNAS_PADRAO;
  }
}

export function salvarColunasVisiveis(listId: string, colunas: ColunaId[]): void {
  try {
    localStorage.setItem(chaveStorage(listId), JSON.stringify(colunas));
  } catch {
    /* localStorage indisponível (modo privado etc.) — segue sem persistir */
  }
}
