// "Fazer rápido" no balão (2026-10-03): as ações que a pessoa mais usa NESTE aparelho, para não ter de
// procurar entre ~57 roteiros toda vez. Conveniência local (localStorage): sem storage, vale a lista
// padrão do perfil. As outras continuam em "Todas as ações".
const CHAVE = 'erpos.acoes.uso';

type Uso = Record<string, { n: number; em: number }>;

function ler(): Uso {
  try {
    const v = JSON.parse(localStorage.getItem(CHAVE) ?? '{}') as Uso;
    return v && typeof v === 'object' ? v : {};
  } catch { return {}; }
}

export function registrarUsoAcao(id: string): void {
  try {
    const u = ler();
    u[id] = { n: (u[id]?.n ?? 0) + 1, em: Date.now() };
    localStorage.setItem(CHAVE, JSON.stringify(u));
  } catch { /* sem storage: só não lembra */ }
}

/** Padrão antes de a pessoa usar qualquer coisa (o que cada um mais faz no dia a dia). */
export const PADRAO_DONO = ['vendas-dia', 'contas-vencendo', 'saldo-extrato', 'lancar', 'receber-mercadoria', 'nova-tarefa'];
export const PADRAO_EQUIPE = ['receber-mercadoria', 'lancar', 'registrar-perda', 'contagem-rapida', 'caixa-aberto', 'nova-tarefa', 'tarefas-hoje', 'vendas-dia', 'pedidos-atrasados', 'pedir-reembolso'];

/**
 * As `n` primeiras para o "Fazer rápido": primeiro as mais usadas aqui (mais vezes, depois a mais
 * recente), completando com o padrão e, se faltar, na ordem do menu. Só entre as liberadas.
 */
export function maisUsadas<T extends { id: string }>(liberadas: T[], padrao: string[], n = 6): T[] {
  const uso = ler();
  const porId = new Map(liberadas.map((a) => [a.id, a]));
  const usadas = Object.entries(uso)
    .filter(([id]) => porId.has(id))
    .sort((a, b) => b[1].n - a[1].n || b[1].em - a[1].em)
    .map(([id]) => id);
  const ordem = [...usadas, ...padrao, ...liberadas.map((a) => a.id)];
  const out: T[] = [];
  for (const id of ordem) {
    const a = porId.get(id);
    if (a && !out.includes(a)) out.push(a);
    if (out.length >= n) break;
  }
  return out;
}
