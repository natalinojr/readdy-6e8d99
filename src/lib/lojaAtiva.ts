/**
 * Loja ativa POR ABA (2026-09-26).
 *
 * Antes a loja escolhida ficava só no localStorage, que é o mesmo para todas as abas:
 * trocar de loja numa aba fazia a outra (ainda mostrando a loja antiga) passar a
 * consultar e gravar com o `x-tenant-id` da loja nova. Agora cada aba guarda a sua no
 * sessionStorage; o localStorage fica só como "última loja usada", que é o padrão de
 * uma aba nova aberta digitando o endereço. Aba aberta pela rodinha do mouse /
 * "nova janela" já nasce com uma cópia do sessionStorage de quem a abriu.
 */
const CHAVE = 'erpos_selected_tenant_id';

export function getLojaAtiva(): string | null {
  try {
    return sessionStorage.getItem(CHAVE) ?? localStorage.getItem(CHAVE);
  } catch {
    try { return localStorage.getItem(CHAVE); } catch { return null; }
  }
}

export function setLojaAtiva(tenantId: string): void {
  try { sessionStorage.setItem(CHAVE, tenantId); } catch { /* sem storage */ }
  try { localStorage.setItem(CHAVE, tenantId); } catch { /* sem storage */ }
}

/** Aba que abriu na loja padrão passa a ter a sua: a troca de loja em outra aba não a arrasta mais. */
export function fixarLojaNestaAba(tenantId: string): void {
  try { sessionStorage.setItem(CHAVE, tenantId); } catch { /* sem storage */ }
}

/** Esquece a loja desta aba e o padrão das abas novas (as outras abas abertas mantêm a delas). */
export function limparLojaAtiva(): void {
  try { sessionStorage.removeItem(CHAVE); } catch { /* sem storage */ }
  try { localStorage.removeItem(CHAVE); } catch { /* sem storage */ }
}
