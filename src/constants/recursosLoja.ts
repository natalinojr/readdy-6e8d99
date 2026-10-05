/**
 * Recursos novos que cada loja liga ou desliga (regra do dono, 2026-10-05: "nem todas as lojas
 * vão usar"). Fica em system_settings.recursos (jsonb { chave: true }). Desligado é o padrão.
 * `pronto: false` = ainda em construção: aparece em Configurações, mas não dá para ligar.
 */
export type RecursoLoja =
  | 'tv_senhas'
  | 'whatsapp_senha_pronta'
  | 'usuarios_novo'
  | 'caixa_novo'
  | 'cardapio_novo'
  | 'gestor_novo'
  | 'totem_novo'
  | 'tarefas_novo'
  | 'modulos_novo';

export interface RecursoInfo {
  chave: RecursoLoja;
  nome: string;
  descricao: string;
  pronto: boolean;
}

export const RECURSOS_LOJA: RecursoInfo[] = [
  { chave: 'tv_senhas', nome: 'TV de senhas', descricao: 'Tela para uma TV ou tablet no balcão: mostra as senhas prontas e chama em voz alta.', pronto: true },
  { chave: 'whatsapp_senha_pronta', nome: 'Aviso de senha pronta no WhatsApp', descricao: 'No fim do pagamento o totem oferece avisar no WhatsApp quando a senha ficar pronta.', pronto: false },
  { chave: 'usuarios_novo', nome: 'Usuários: tela nova', descricao: 'Quem nunca entrou, quem parou de entrar e nova pessoa em passos.', pronto: true },
  { chave: 'caixa_novo', nome: 'Caixa: tela nova', descricao: '“Precisa de você” sempre à vista e cobrar em menos toques.', pronto: false },
  { chave: 'cardapio_novo', nome: 'Cardápio: tela nova', descricao: 'Margem na lista, “Acabou hoje” em 1 toque e janela do item em abas.', pronto: false },
  { chave: 'gestor_novo', nome: 'Gestor de Pedidos: tela nova', descricao: 'Manchete, “Conferi tudo” e régua única de atraso.', pronto: false },
  { chave: 'totem_novo', nome: 'Totem e pagar: tela nova', descricao: 'Logo e cor da loja no totem e na tela de pagar.', pronto: false },
  { chave: 'tarefas_novo', nome: 'Tarefas: tela nova', descricao: 'Minhas por prazo, Feito e Adiar no próprio item.', pronto: false },
  { chave: 'modulos_novo', nome: 'Módulos: tela nova', descricao: 'O que este aparelho faz, com o estado de cada terminal.', pronto: true },
];

export type RecursosLoja = Partial<Record<RecursoLoja, boolean>>;

const CHAVES = new Set<string>(RECURSOS_LOJA.map((r) => r.chave));

/** Normaliza o jsonb vindo do banco: só chaves conhecidas e só `true`. */
export function normalizarRecursos(v: unknown): RecursosLoja {
  const out: RecursosLoja = {};
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (CHAVES.has(k) && val === true) out[k as RecursoLoja] = true;
    }
  }
  return out;
}
