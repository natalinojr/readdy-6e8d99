import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { FatosPorQue } from '@/lib/porQueMudou';

// "Por que mudou?": lê os fatos que o front não tem (canal do PDV, abertura do caixa, itens pausados) de
// fn_por_que_mudou, só quando a folha está aberta. Dia da loja: as datas são as do período da tela (d1..d2 e c1..c2),
// nunca o calendário. Falha = fatos null (a folha avisa o que não conseguiu ler; não conclui nada sem dado).

export interface PeriodoPorQue { d1: string; d2: string; c1: string; c2: string; corte: string | null }

const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const canais = (o: unknown): Record<string, { valor: number; pedidos: number }> => {
  const out: Record<string, { valor: number; pedidos: number }> = {};
  for (const [k, v] of Object.entries((o ?? {}) as Record<string, { valor?: unknown; pedidos?: unknown }>)) out[k] = { valor: num(v?.valor), pedidos: num(v?.pedidos) };
  return out;
};

export function lerFatos(raw: unknown): FatosPorQue {
  const o = raw as Record<string, unknown> | null;
  const c = o?.canais as Record<string, unknown> | undefined;
  const a = o?.aberturas as Record<string, unknown> | undefined;
  if (!o || !c || !a || !Array.isArray(o.pausas) || !Array.isArray(a.atual) || !Array.isArray(a.anterior)) throw new Error('Resposta inesperada de fn_por_que_mudou');
  return {
    canais: { atual: canais(c.atual), anterior: canais(c.anterior) },
    aberturas: { atual: a.atual as FatosPorQue['aberturas']['atual'], anterior: a.anterior as FatosPorQue['aberturas']['anterior'] },
    pausas: (o.pausas as FatosPorQue['pausas']).map((p) => ({ ...p, minutos: num(p.minutos), vendeu_no_comparado: num(p.vendeu_no_comparado) })),
  };
}

export function usePorQueMudou(ativo: boolean, tenantId: string | undefined, p: PeriodoPorQue | null) {
  const [fatos, setFatos] = useState<FatosPorQue | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [falhou, setFalhou] = useState(false);
  const chave = p ? `${tenantId}|${p.d1}|${p.d2}|${p.c1}|${p.c2}|${p.corte ?? ''}` : '';

  useEffect(() => {
    if (!ativo || !tenantId || !p) return;
    let vivo = true;
    setCarregando(true); setFalhou(false); setFatos(null);
    supabase.rpc('fn_por_que_mudou', { p_tenant: tenantId, p_d1: p.d1, p_d2: p.d2, p_c1: p.c1, p_c2: p.c2, p_corte: p.corte })
      .then(({ data, error }) => {
        if (!vivo) return;
        setCarregando(false);
        if (error) { console.error('[porQueMudou]', error); setFalhou(true); return; }
        try { setFatos(lerFatos(data)); } catch (e) { console.error('[porQueMudou] formato', e); setFalhou(true); }
      });
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ativo, chave]);

  return { fatos, carregando, falhou };
}
