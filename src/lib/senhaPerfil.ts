// Regras da tela Perfil › Alterar senha.

/** Mesmo mínimo do cadastro de usuário (Usuários › senha) e do Supabase Auth. */
export const SENHA_MINIMA = 6;

/**
 * Quem entra por matrícula + PIN usa e-mail "de mentira" (user_0007_ab12cd34@erpos.local,
 * tablet@totem.erpos.local, kiosk-…@kiosk.erpos.internal). Não existe senha de e-mail para
 * essa pessoa trocar: o acesso é pelo PIN, que o administrador define em Usuários.
 */
export function entraSoPorPin(email: string | null | undefined): boolean {
  const e = (email ?? '').trim().toLowerCase();
  return /@([a-z0-9-]+\.)*erpos\.(local|internal)$/.test(e);
}

/** Devolve a mensagem de erro (em português) ou '' se está tudo certo. */
export function validarTrocaDeSenha(atual: string, nova: string, confirmar: string): string {
  if (!atual) return 'Digite a senha atual.';
  if (!nova) return 'Digite a nova senha.';
  if (nova.length < SENHA_MINIMA) return `A nova senha precisa ter pelo menos ${SENHA_MINIMA} caracteres.`;
  if (nova !== confirmar) return 'As duas senhas novas não são iguais.';
  if (nova === atual) return 'A nova senha precisa ser diferente da atual.';
  return '';
}
