import { useState, useCallback, useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { getPeriodDates, todayBrasilia } from '@/lib/dateUtils';
import {
  linhasDoRelatorio, pontoMensal, mesesDosUltimos12, limitesDoMes,
  type LinhaCmv, type PontoMensal,
} from '@/lib/cmvRegras';

// CMV do Estoque (aba CMV e fichas) lê a RPC fn_get_cmv_report: custo gravado na venda (order_items.unit_cost),
// combos e adicionais já tratados no banco, sem o corte de 1.000 linhas do cálculo no navegador.
// A conta em cima do resultado (cobertura, CMV dos pratos com ficha, CSV...) está em src/lib/cmvRegras.ts.

export type { LinhaCmv, PontoMensal };

export interface CmvReportData {
  /** período escolhido ('30d', 'Hoje', 'custom:AAAA-MM-DD:AAAA-MM-DD'...) */
  periodo: string;
  periodo_de: string;
  periodo_ate: string;
  linhas: LinhaCmv[];
}

async function lerRelatorio(tenantId: string, from: string, to: string): Promise<LinhaCmv[]> {
  const { data, error } = await supabase.rpc('fn_get_cmv_report', {
    p_tenant_id: tenantId,
    p_date_from: from,
    p_date_to: to,
  });
  if (error) throw error;
  return linhasDoRelatorio(data);
}

const MSG_ERRO = 'Não consegui ler as vendas deste período. Confira a internet e tente de novo.';

export function useCmvReport() {
  const { user } = useAuth();
  const tenantId = user?.tenantId;
  const [data, setData] = useState<CmvReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Só a última leitura vale (período trocado depressa ou outra loja)
  const leitura = useRef(0);

  const load = useCallback(async (periodo: string) => {
    const minha = ++leitura.current;
    if (!tenantId) { setData(null); setError(null); setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      const { from, to } = getPeriodDates(periodo);
      const linhas = await lerRelatorio(tenantId, from, to);
      if (minha !== leitura.current) return;
      setData({ periodo, periodo_de: from.slice(0, 10), periodo_ate: to.slice(0, 10), linhas });
    } catch (e) {
      if (minha !== leitura.current) return;
      console.error('[useCmvReport]', e);
      setData(null);
      setError(MSG_ERRO);
    } finally {
      if (minha === leitura.current) setLoading(false);
    }
  }, [tenantId]);

  // Trocou de loja: nada da loja anterior fica na tela
  useEffect(() => { setData(null); setError(null); }, [tenantId]);

  return { data, loading, error, load };
}

// ── CMV mês a mês (gráfico dos últimos 12 meses) ──────────────────────────────────────
// Um relatório por mês (a mesma RPC), 4 de cada vez. Mês que falha aparece como falha (nunca "sem dados").
const CACHE_MS = 5 * 60 * 1000;
const cacheMes = new Map<string, { em: number; ponto: PontoMensal }>();
/** "Atualizar" e "Aplicar fichas" esquecem o que foi guardado (o gráfico pode ser remontado com a versão nova
 *  e aí não perceberia que precisa ler de novo). */
export function esquecerCmvMensal() { cacheMes.clear(); }

export function useCmvMensal(versao = 0) {
  const { user } = useAuth();
  const tenantId = user?.tenantId;
  const [dados, setDados] = useState<PontoMensal[]>([]);
  const [falhas, setFalhas] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const rodada = useRef(0);

  const carregar = useCallback(async (forcar: boolean) => {
    const minha = ++rodada.current;
    if (!tenantId) { setDados([]); setFalhas([]); setLoading(false); return; }
    setLoading(true);
    const meses = mesesDosUltimos12(todayBrasilia());
    const pontos = new Map<string, PontoMensal>();
    const erros: string[] = [];
    const pendentes: string[] = [];
    for (const mes of meses) {
      const guardado = cacheMes.get(`${tenantId}|${mes}`);
      if (!forcar && guardado && Date.now() - guardado.em < CACHE_MS) pontos.set(mes, guardado.ponto);
      else pendentes.push(mes);
    }
    let proximo = 0;
    const trabalhador = async () => {
      while (proximo < pendentes.length) {
        const mes = pendentes[proximo++];
        try {
          const { from, to } = limitesDoMes(mes);
          const ponto = pontoMensal(mes, await lerRelatorio(tenantId, from, to));
          pontos.set(mes, ponto);
          cacheMes.set(`${tenantId}|${mes}`, { em: Date.now(), ponto });
        } catch (e) {
          console.error('[useCmvMensal]', mes, e);
          erros.push(mes);
        }
        if (minha !== rodada.current) return;
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, pendentes.length) }, trabalhador));
    if (minha !== rodada.current) return;
    setDados(meses.filter((m) => pontos.has(m)).map((m) => pontos.get(m) as PontoMensal));
    setFalhas(erros.sort());
    setLoading(false);
  }, [tenantId]);

  // `versao` sobe quando a pessoa pede para atualizar (ou aplica fichas nas vendas): lê tudo de novo
  const ultimaVersao = useRef(versao);
  useEffect(() => {
    const forcar = versao !== ultimaVersao.current;
    ultimaVersao.current = versao;
    carregar(forcar);
  }, [carregar, versao]);

  // Trocou de loja: zera (as leituras da outra loja já estão em chaves próprias do cache)
  useEffect(() => { setDados([]); setFalhas([]); }, [tenantId]);

  return { dados, falhas, loading, recarregar: () => carregar(true) };
}
