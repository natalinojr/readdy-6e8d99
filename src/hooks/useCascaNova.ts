/**
 * Chave da casca nova (menu em 6 grupos, topo novo, barra de baixo no celular), por pessoa — 2026-10-05.
 * Preferência 'casca_nova' em user_preferences ('1' ligada, '0' desligada). Sem preferência gravada:
 * ligada só para o dono (ADMIN_MASTER_EMAIL), desligada para os demais.
 * A tabela é por (pessoa, loja): ao trocar, gravamos em todas as lojas da pessoa, para valer em qualquer
 * loja. O último valor fica também no aparelho (localStorage) para a casca não piscar ao abrir.
 */
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { ADMIN_MASTER_EMAIL } from '@/constants/telas';

export const PREF_CASCA_NOVA = 'casca_nova';
const CHAVE_LOCAL = 'erpos.casca_nova';

function lerLocal(userId: string | undefined): boolean | null {
  if (!userId) return null;
  try {
    const v = localStorage.getItem(`${CHAVE_LOCAL}:${userId}`);
    return v === '1' ? true : v === '0' ? false : null;
  } catch {
    return null;
  }
}

function gravarLocal(userId: string, v: boolean) {
  try { localStorage.setItem(`${CHAVE_LOCAL}:${userId}`, v ? '1' : '0'); } catch { /* sem storage */ }
}

export function useCascaNova(): { ligada: boolean; podeLigar: boolean; setLigada: (v: boolean) => Promise<void> } {
  const { user, availableTenants } = useAuth();
  const padrao = (user?.email ?? '').toLowerCase() === ADMIN_MASTER_EMAIL;
  const [valor, setValor] = useState<boolean | null>(() => lerLocal(user?.id));

  // Troca de pessoa no mesmo aparelho: começa pelo que está guardado para ela.
  useEffect(() => { setValor(lerLocal(user?.id)); }, [user?.id]);

  useEffect(() => {
    if (!user?.id || !user?.tenantId) return;
    let vivo = true;
    supabase
      .from('user_preferences')
      .select('preference_value')
      .eq('user_id', user.id)
      .eq('tenant_id', user.tenantId)
      .eq('preference_key', PREF_CASCA_NOVA)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!vivo || error) return;
        const v = data?.preference_value;
        const lido = v === '1' ? true : v === '0' ? false : null;
        setValor(lido);
        if (lido === null) {
          try { localStorage.removeItem(`${CHAVE_LOCAL}:${user.id}`); } catch { /* sem storage */ }
        } else {
          gravarLocal(user.id, lido);
        }
      });
    return () => { vivo = false; };
  }, [user?.id, user?.tenantId]);

  const setLigada = useCallback(async (v: boolean) => {
    if (!user?.id) return;
    setValor(v);
    gravarLocal(user.id, v);
    const lojas = new Set<string>([user.tenantId, ...availableTenants.map((t) => t.tenantId)].filter(Boolean));
    const agora = new Date().toISOString();
    const linha = (tenantId: string) => ({
      user_id: user.id, tenant_id: tenantId, preference_key: PREF_CASCA_NOVA, preference_value: v ? '1' : '0', updated_at: agora,
    });
    const opcoes = { onConflict: 'user_id,tenant_id,preference_key' };
    const { error } = await supabase.from('user_preferences').upsert([...lojas].map(linha), opcoes);
    if (error) {
      // Alguma loja recusou (RLS): grava ao menos na loja aberta.
      console.error('[useCascaNova] gravar em todas as lojas', error);
      if (user.tenantId) {
        const r = await supabase.from('user_preferences').upsert(linha(user.tenantId), opcoes);
        if (r.error) console.error('[useCascaNova] gravar', r.error);
      }
    }
  }, [user?.id, user?.tenantId, availableTenants]);

  // Volta pelo menu antigo: quem já desligou a casca (valor '0') ou o dono, para ninguém ficar preso no antigo.
  return { ligada: valor ?? padrao, podeLigar: valor === false || padrao, setLigada };
}
