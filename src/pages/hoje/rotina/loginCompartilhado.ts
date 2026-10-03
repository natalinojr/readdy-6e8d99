// Login compartilhado = um login da loja usado por várias pessoas (hoje, o "Caixa" logado no celular da
// loja, o "Cozinha", o "Gerente" genérico — todos @erpos.local). Nele, marcar algo da rotina pergunta
// "quem fez?" (sem PIN; freelancer não tem login, só o nome fica guardado).
// Um lugar só: quando o papel de aparelho do "celular da loja" existir (proposta de outra sessão,
// store_devices), ele entra aqui também.
const DOMINIO_GENERICO = /@([a-z0-9-]+\.)*erpos\.(local|internal)$/i;

export function loginCompartilhado(email: string | null | undefined): boolean {
  // Só no `npm run dev`: simula o login da loja para testar o "quem fez?" com um usuário qa.* (não existe
  // login @erpos.local na loja Testes PDV). localStorage.erpos_dev_compartilhado = '1'.
  if (import.meta.env?.DEV) {
    try { if (localStorage.getItem('erpos_dev_compartilhado') === '1') return true; } catch { /* sem storage */ }
  }
  return !!email && DOMINIO_GENERICO.test(email.trim());
}
