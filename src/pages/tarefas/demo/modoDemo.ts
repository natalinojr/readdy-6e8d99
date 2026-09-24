/**
 * Modo demonstração do módulo Tarefas — SÓ em desenvolvimento (`npm run dev`),
 * na rota /dev/tarefas. Dados fictícios em memória, sem login e sem banco: serve
 * pra testar layout (principalmente no celular) sem depender de conta real.
 * Em produção `import.meta.env.DEV` é false e nada disto entra no build.
 */
export const MODO_DEMO: boolean =
  import.meta.env.DEV && typeof window !== 'undefined' && window.location.pathname.startsWith('/dev/tarefas');

export const EU_DEMO = { id: 'demo-eu', nome: 'Você (demo)' };

export const USUARIOS_DEMO = [
  { id: 'demo-eu', nome: 'Você (demo)', ativo: true },
  { id: 'demo-ana', nome: 'Ana Souza', ativo: true },
  { id: 'demo-bruno', nome: 'Bruno Lima', ativo: true },
  { id: 'demo-carla', nome: 'Carla Dias', ativo: true },
];
