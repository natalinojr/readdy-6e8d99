// Contas em aberto da loja (fn_contas_em_aberto) — a MESMA lista para todas as telas que mostram "vencidas",
// "quanto devo" e "dinheiro × o que vence" (2026-10-07). Totais em src/lib/contasAbertas.ts.
// `versao` recarrega (ex.: depois de uma baixa); `ativo=false` não busca (tela sem permissão).
import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { todayBrasilia } from '@/lib/dateUtils';
import type { ContaEmAberto } from '@/lib/contasAbertas';

export function useContasEmAberto(tenantId: string | null | undefined, versao = 0, ativo = true) {
  const [contas, setContas] = useState<ContaEmAberto[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const lojaAnterior = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (!tenantId || !ativo) { setContas(null); return; }
    // trocou de loja: some com os números da anterior enquanto busca (recarga da mesma loja não pisca)
    if (lojaAnterior.current !== tenantId) { setContas(null); lojaAnterior.current = tenantId; }
    let vivo = true;
    setErro(null);
    supabase.rpc('fn_contas_em_aberto', { p_tenants: [tenantId] }).then(({ data, error }) => {
      if (!vivo) return;
      if (error) { setErro(error.message); setContas([]); return; }
      setContas((data ?? []) as ContaEmAberto[]);
    });
    return () => { vivo = false; };
  }, [tenantId, versao, ativo]);
  // "hoje" do servidor (Brasília) quando já veio; senão o de Brasília calculado aqui — nunca o relógio do computador.
  const hoje = contas?.[0]?.hoje ?? todayBrasilia();
  return { contas, erro, hoje, carregando: contas === null && !erro };
}
