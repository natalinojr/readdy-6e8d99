import type { CampoCustom } from '../hooks/useTarefas';

/**
 * Colunas da view Lista — nativas (fixas) + uma por campo personalizado.
 * Qual conjunto fica visível é preferência pessoal (localStorage por lista),
 * não configuração do time — por isso não mexe em `task_custom_fields`.
 */
export type ColunaId =
  | 'responsavel' | 'vencimento' | 'prioridade' | 'etiquetas'
  | 'checklist' | 'subtarefas' | 'comentarios' | 'criada_em' | 'pasta'
  | 'estimado' | 'cronometro'
  | `campo:${string}`;

export interface ColunaDef {
  id: ColunaId;
  label: string;
  larguraPx: number;
  /** Campo personalizado (o menu de colunas mostra esses numa seção própria, primeiro). */
  personalizado?: boolean;
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
  { id: 'pasta', label: 'Pasta', larguraPx: 140 },
  { id: 'estimado', label: 'Tempo estimado', larguraPx: 120 },
  { id: 'cronometro', label: 'Cronômetro', larguraPx: 130 },
];

/** Default = o que já aparecia antes de existir esse menu (não muda a experiência de quem já usa). */
const COLUNAS_PADRAO: ColunaId[] = ['responsavel', 'vencimento', 'prioridade', 'etiquetas'];

/**
 * Numa pasta: os campos dela + os globais. Numa visão que junta várias pastas
 * (Minhas/Compartilhadas/Todas, `listId` null): TODOS os campos — antes só os
 * globais, e um campo criado dentro de uma pasta nunca aparecia ali. Nesse caso
 * o nome da pasta vai junto, pra diferenciar campos de mesmo nome.
 */
export function colunasDisponiveis(
  campos: CampoCustom[],
  listId: string | null,
  nomePasta: (listId: string) => string | null = () => null,
): ColunaDef[] {
  const doCampos: ColunaDef[] = campos
    .filter((c) => listId === null || c.list_id === null || c.list_id === listId)
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((c) => {
      const pasta = listId === null && c.list_id ? nomePasta(c.list_id) : null;
      return {
        id: `campo:${c.id}` as ColunaId,
        label: pasta ? `${c.name} · ${pasta}` : c.name,
        larguraPx: 150,
        personalizado: true,
      };
    });
  return [...COLUNAS_NATIVAS, ...doCampos];
}

function chaveStorage(chave: string): string {
  return `erpos_tarefas_colunas_${chave}`;
}

export function carregarColunasVisiveis(chave: string, padrao: ColunaId[] = COLUNAS_PADRAO): ColunaId[] {
  try {
    const bruto = localStorage.getItem(chaveStorage(chave));
    if (!bruto) return padrao;
    const arr = JSON.parse(bruto);
    return Array.isArray(arr) ? (arr as ColunaId[]) : padrao;
  } catch {
    return padrao;
  }
}

export function salvarColunasVisiveis(chave: string, colunas: ColunaId[]): void {
  try {
    localStorage.setItem(chaveStorage(chave), JSON.stringify(colunas));
  } catch {
    /* localStorage indisponível (modo privado etc.) — segue sem persistir */
  }
}

/** Limites do arrastar da borda da coluna. */
export const LARGURA_MIN_PX = 60;
export const LARGURA_MAX_PX = 600;

/** Larguras que o usuário ajustou arrastando (só as alteradas; o resto usa `larguraPx`). */
export type LargurasColunas = Partial<Record<ColunaId, number>>;

function chaveLarguras(chave: string): string {
  return `erpos_tarefas_larguras_${chave}`;
}

export function carregarLarguras(chave: string): LargurasColunas {
  try {
    const bruto = localStorage.getItem(chaveLarguras(chave));
    if (!bruto) return {};
    const obj = JSON.parse(bruto);
    return obj && typeof obj === 'object' && !Array.isArray(obj) ? (obj as LargurasColunas) : {};
  } catch {
    return {};
  }
}

export function salvarLarguras(chave: string, larguras: LargurasColunas): void {
  try {
    localStorage.setItem(chaveLarguras(chave), JSON.stringify(larguras));
  } catch {
    /* localStorage indisponível — segue sem persistir */
  }
}

// ── Ordem das colunas (arrastando o título) ──
// Guardada à parte da lista de visíveis: antes disso a ordem era sempre a
// canônica, e reaproveitar a ordem em que a pessoa marcou as colunas no menu
// embaralharia a tela de quem já usa.
function chaveOrdem(chave: string): string {
  return `erpos_tarefas_ordem_${chave}`;
}

export function carregarOrdemColunas(chave: string): ColunaId[] {
  try {
    const arr = JSON.parse(localStorage.getItem(chaveOrdem(chave)) ?? '[]');
    return Array.isArray(arr) ? (arr as ColunaId[]) : [];
  } catch {
    return [];
  }
}

export function salvarOrdemColunas(chave: string, ordem: ColunaId[]): void {
  try {
    localStorage.setItem(chaveOrdem(chave), JSON.stringify(ordem));
  } catch {
    /* sem localStorage — vale só nesta sessão */
  }
}

/** Colunas na ordem escolhida; as que nunca foram arrastadas vêm depois, na ordem canônica. */
export function ordenarColunas(colunas: ColunaDef[], ordem: ColunaId[]): ColunaDef[] {
  const pos = (id: ColunaId) => {
    const i = ordem.indexOf(id);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  return colunas
    .map((c, i) => ({ c, i }))
    .sort((a, b) => pos(a.c.id) - pos(b.c.id) || a.i - b.i)
    .map((x) => x.c);
}
