/**
 * Papéis presos a uma única área do sistema: entram por ela e não saem.
 * A decisão vive aqui, fora do componente, para poder ser testada sem tela.
 */
export const PAPEIS_PRESOS: Record<string, string> = {
  gestor_entregas: '/gestor-entregas',
  tarefas: '/tarefas',
  financeiro: '/financeiro',
  contabilidade: '/financeiro',
};

export function rotaForcada(perfil: string | undefined | null, pathname: string): string | null {
  if (!perfil) return null;
  const destino = PAPEIS_PRESOS[perfil];
  if (!destino) return null;
  return pathname.startsWith(destino) ? null : destino;
}
