/**
 * Módulos que não dependem de loja (Tarefas, Contratação): o acesso é por USUÁRIO,
 * liberado no Admin Master (tabela user_module_access, RPC fn_my_modules).
 * O dono sempre tem todos; o papel "tarefas" sempre tem Tarefas.
 */
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';

export type ModuloLivre = 'tarefas' | 'contratacao';

let cache: { userId: string; promise: Promise<ModuloLivre[]> } | null = null;

function load(userId: string) {
  if (!cache || cache.userId !== userId) {
    cache = {
      userId,
      promise: Promise.resolve(supabase.rpc('fn_my_modules')).then(({ data, error }) => {
        if (error) { cache = null; return []; }
        return (data ?? []) as ModuloLivre[];
      }),
    };
  }
  return cache.promise;
}

export function invalidateModuleAccess() {
  cache = null;
}

export function useModuleAccess() {
  const { user, hasNoTenants } = useAuth();
  const [modules, setModules] = useState<ModuloLivre[] | null>(null);

  useEffect(() => {
    let alive = true;
    if (user?.id) {
      load(user.id).then((m) => { if (alive) setModules(m); });
    } else if (hasNoTenants) {
      // Sem loja o AuthContext deixa user=null; o id vem da sessão (acesso só a módulo).
      supabase.auth.getSession().then(({ data }) => {
        const id = data.session?.user?.id;
        if (!id) { if (alive) setModules([]); return; }
        load(id).then((m) => { if (alive) setModules(m); });
      });
    } else {
      setModules(null);
    }
    return () => { alive = false; };
  }, [user?.id, hasNoTenants]);

  const list = modules ?? [];
  return {
    modules: list,
    loading: modules === null,
    hasModule: (m: ModuloLivre) => list.includes(m),
  };
}
