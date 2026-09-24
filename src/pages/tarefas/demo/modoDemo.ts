/**
 * Modo demonstração do módulo Tarefas — SÓ em desenvolvimento (`npm run dev`),
 * na rota /dev/tarefas. Dados fictícios em memória, sem login e sem banco: serve
 * pra testar layout (principalmente no celular) sem depender de conta real.
 * Em produção `import.meta.env.DEV` é false e nada disto entra no build.
 */
// Função, e não constante de módulo: a constante era calculada uma vez só, quando o
// módulo carregava. Se isso acontecesse em outra rota (ex.: /tarefas antes de ir por
// navegação interna para /dev/tarefas), o demo ficava desligado a sessão toda e a
// página caía em /modulos → /login. Lida na hora, a URL já é a da rota atual.
export function modoDemo(): boolean {
  return import.meta.env.DEV && typeof window !== 'undefined' && window.location.pathname.startsWith('/dev/tarefas');
}

export const EU_DEMO = { id: 'demo-eu', nome: 'Você (demo)' };

export const USUARIOS_DEMO = [
  { id: 'demo-eu', nome: 'Você (demo)', ativo: true },
  { id: 'demo-ana', nome: 'Ana Souza', ativo: true },
  { id: 'demo-bruno', nome: 'Bruno Lima', ativo: true },
  { id: 'demo-carla', nome: 'Carla Dias', ativo: true },
];
