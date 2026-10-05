// Sem dependências: o balão do assistente importa daqui sem puxar o catálogo de telas.
/**
 * Altura que a barra de baixo da casca nova ocupa no celular (0 sem ela). O balão do assistente usa para
 * não ficar atrás da barra quando a pessoa o arrasta até o rodapé.
 */
export function alturaBarraCasca(): number {
  if (typeof document === 'undefined' || typeof window === 'undefined') return 0;
  return document.documentElement.dataset.cascaBarra && window.innerWidth < 768 ? 66 : 0;
}
