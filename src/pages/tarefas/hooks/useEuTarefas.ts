import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { EU_DEMO, MODO_DEMO } from '../demo/modoDemo';
import { useAuth } from '@/contexts/AuthContext';

/**
 * Quem está usando Tarefas. Tarefas é por pessoa: quem tem o módulo liberado
 * no Admin Master usa mesmo sem loja (2026-09-23). Sem loja o AuthContext deixa
 * `user` nulo, então o id e o nome vêm da sessão e `tenantId` fica nulo — o
 * banco e o task-write aceitam tenant nulo para quem tem o módulo.
 */
export interface EuTarefas {
  id: string | null;
  nome: string;
  tenantId: string | null;
  /** Já sabemos quem é (com ou sem loja) — pode carregar e gravar. */
  pronto: boolean;
  semLoja: boolean;
}

export function useEuTarefas(): EuTarefas {
  const { user, hasNoTenants } = useAuth();
  // Modo demonstração (só dev): usuário fictício, sem sessão.
  const demo = MODO_DEMO ? { id: EU_DEMO.id, nome: EU_DEMO.nome, tenantId: 'demo', pronto: true, semLoja: false } : null;
  const [sessao, setSessao] = useState<{ id: string; nome: string } | null>(null);

  useEffect(() => {
    if (user || !hasNoTenants) { setSessao(null); return; }
    let vivo = true;
    supabase.auth.getSession().then(({ data }) => {
      const u = data.session?.user;
      if (!vivo || !u) return;
      const meta = u.user_metadata ?? {};
      setSessao({ id: u.id, nome: String(meta.name ?? meta.nome ?? u.email ?? 'Eu') });
    }).catch(() => { /* sem sessão: continua não pronto */ });
    return () => { vivo = false; };
  }, [user, hasNoTenants]);

  if (demo) return demo;
  if (user) return { id: user.id, nome: user.nome, tenantId: user.tenantId, pronto: true, semLoja: false };
  if (hasNoTenants && sessao) return { id: sessao.id, nome: sessao.nome, tenantId: null, pronto: true, semLoja: true };
  return { id: null, nome: '', tenantId: null, pronto: false, semLoja: hasNoTenants };
}
