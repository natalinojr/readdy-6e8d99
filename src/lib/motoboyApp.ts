// App "ERPOS Entregas": o motoboy guarda no aparelho o perfil (nome + celular) e as lojas ligadas por código.
// Entrar numa loja = gravar a sessão de sempre (MOTOBOY_SESSION_KEY) e abrir /entregas/<slug>.
import type { MotoboySession } from '@/pages/motoboy/page';

// Mesma chave de src/pages/motoboy/page.tsx (repetida aqui para não puxar a página inteira para este módulo)
const MOTOBOY_SESSION_KEY = 'erpos_motoboy_session';

export const PERFIL_KEY = 'erpos_motoboy_perfil';
export const LOJAS_KEY = 'erpos_motoboy_lojas';

export interface PerfilMotoboy { nome: string; celular: string }
export interface LojaMotoboy { tenant_id: string; driver_id: string; name: string; store_name: string; store_slug: string }

function ler<T>(key: string, padrao: T): T {
  try { const raw = localStorage.getItem(key); return raw ? (JSON.parse(raw) as T) : padrao; } catch { return padrao; }
}
function gravar(key: string, v: unknown) { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* sem storage */ } }

export const lerPerfil = () => ler<PerfilMotoboy | null>(PERFIL_KEY, null);
export const salvarPerfil = (p: PerfilMotoboy) => gravar(PERFIL_KEY, p);
export const lerLojas = () => ler<LojaMotoboy[]>(LOJAS_KEY, []).filter((l) => l && l.tenant_id && l.store_slug);

/** Adiciona (ou atualiza, se já tinha) a loja na lista do aparelho. */
export function guardarLoja(l: LojaMotoboy): LojaMotoboy[] {
  const lista = [l, ...lerLojas().filter((x) => x.tenant_id !== l.tenant_id)];
  gravar(LOJAS_KEY, lista);
  return lista;
}

export function removerLoja(tenantId: string): LojaMotoboy[] {
  const lista = lerLojas().filter((x) => x.tenant_id !== tenantId);
  gravar(LOJAS_KEY, lista);
  return lista;
}

/** Sessão da loja em que o motoboy está logado agora (a do portal /entregas/<slug>). */
export const lerSessaoLoja = () => ler<MotoboySession | null>(MOTOBOY_SESSION_KEY, null);

/** Grava a sessão da loja escolhida (a mesma que o portal /entregas/<slug> já usa). */
export function entrarNaLoja(l: LojaMotoboy) {
  const sess: MotoboySession = { tenant_id: l.tenant_id, driver_id: l.driver_id, name: l.name, store_slug: l.store_slug, store_name: l.store_name };
  gravar(MOTOBOY_SESSION_KEY, sess);
}

/** Aparelho com o app de entregas (ou quem já ligou loja por código): mostra "Minhas lojas" no portal. */
export const usaAppEntregas = () => lerLojas().length > 0;
