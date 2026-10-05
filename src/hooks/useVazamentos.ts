import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { lerLoja, META_CMV, type VazLojaDados } from '@/lib/vazamentos';

// Vazamentos do mês: lê fn_vazamentos_lojas (as lojas em que a pessoa é do Financeiro) e fn_vazamentos_mes (uma loja
// por chamada, mesma janela para todas). A resposta de cada loja fica guardada 2 min; "Atualizar" (muda a versao) lê de novo.
// A RPC confere de novo no banco se a pessoa é do Financeiro da loja: o front só pede o que a lista devolveu.

export interface LojaVaz { tenantId: string; nome: string; oculta: boolean }

const TTL_MS = 2 * 60 * 1000;
const guarda = new Map<string, { ts: number; versao: number; dados: VazLojaDados }>();

export function useVazamentosLojas() {
  const { user } = useAuth();
  const [lojas, setLojas] = useState<LojaVaz[] | null>(null);
  const [erro, setErro] = useState(false);
  useEffect(() => {
    if (!user?.tenantId) return;
    let vivo = true;
    setLojas(null); setErro(false);
    supabase.rpc('fn_vazamentos_lojas').then(({ data, error }) => {
      if (!vivo) return;
      if (error) { console.error('[vazamentos] lojas', error); setErro(true); return; }
      setLojas(((data ?? []) as Array<{ tenant_id: string; nome: string; oculta: boolean }>)
        .map((r) => ({ tenantId: r.tenant_id, nome: r.nome, oculta: !!r.oculta })));
    });
    return () => { vivo = false; };
  }, [user?.tenantId]);
  return { lojas, erro };
}

export function useVazamentos(tenantIds: string[], de: string, ate: string, versao: number) {
  const [dados, setDados] = useState<VazLojaDados[]>([]);
  // Chave do que já chegou: "carregando" = o que foi pedido ainda não é o que está na tela (sem piscar "sem dado").
  const [carregada, setCarregada] = useState('');
  const [falhas, setFalhas] = useState<string[]>([]);
  const req = useRef(0);
  const chaveIds = tenantIds.join(',');
  const chave = `${chaveIds}|${de}|${ate}|${versao}`;

  const carregar = useCallback(async () => {
    const ids = chaveIds ? chaveIds.split(',') : [];
    const minha = ++req.current;
    if (ids.length === 0) { setDados([]); setFalhas([]); setCarregada(chave); return; }
    const resultados = await Promise.all(ids.map(async (id) => {
      const k = `${id}|${de}|${ate}`;
      const g = guarda.get(k);
      if (g && g.versao === versao && Date.now() - g.ts < TTL_MS) return { id, dados: g.dados };
      const { data, error } = await supabase.rpc('fn_vazamentos_mes', { p_tenant: id, p_de: de, p_ate: ate, p_meta_cmv: META_CMV });
      if (error) { console.error('[vazamentos]', error); return { id, erro: true as const }; }
      try {
        const d = lerLoja(data);
        guarda.set(k, { ts: Date.now(), versao, dados: d });
        return { id, dados: d };
      } catch (e) { console.error('[vazamentos] formato', e); return { id, erro: true as const }; }
    }));
    if (minha !== req.current) return;
    setDados(resultados.flatMap((r) => ('dados' in r && r.dados ? [r.dados] : [])));
    setFalhas(resultados.filter((r) => 'erro' in r).map((r) => r.id));
    setCarregada(chave);
  }, [chaveIds, de, ate, versao, chave]);

  useEffect(() => { carregar(); }, [carregar]);
  return { dados, carregando: carregada !== chave, falhas };
}
