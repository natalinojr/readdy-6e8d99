// Ação rápida (só leitura): cancelamentos do iFood num período — quantos, quanto se perdeu, de quem foi
// a culpa e por quê. Fonte: fin_ifood_sales (API Sales, com a venda do dia); motivo pelo código do
// evento REFUND (./comum MOTIVO_CANCELAMENTO) e culpa pela regra do dashboard de Relatórios › iFood
// (culpaCancelamento). "Perdido" = itens + entrega do pedido cancelado.
import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useAcessoAcoes, rotaLiberada } from '../acesso';
import { culpaCancelamento } from '@/lib/ifoodDashboard';
import { Roteiro, useRoteiro, Opcao, Fim, brl, dataBR, horaBR, hojeISO, somaDias, type AcaoProps } from '../kit';
import { Painel, Kpis, Barras, Linhas } from '../painel';
import { atualizarVendasIfood, canceladoIfood, codigoCancelamento, lojasIfood, MOTIVO_CANCELAMENTO } from './comum';

interface Linha {
  merchant_id: string; short_id: string | null; sale_created_at: string; current_status: string | null;
  gross_bag: number | null; delivery_fee: number | null; eventos: Array<{ metadata?: { cancelCode?: number } | null }> | null;
}
const CULPA: Record<string, string> = { loja: 'Loja', cliente: 'Cliente', ifood: 'iFood / entregador' };
const n = (v: unknown) => Number(v ?? 0);

export default function CancelamentosIfood({ onFechar, irPara }: AcaoProps) {
  const { user } = useAuth();
  const tenantId = user?.tenantId ?? '';
  const verTela = rotaLiberada('/relatorios', useAcessoAcoes());
  const { baloes, bot, eu, painel } = useRoteiro();
  const [passo, setPasso] = useState<'periodo' | 'carregando' | 'fim'>('periodo');
  const iniciou = useRef(false);

  useEffect(() => {
    if (iniciou.current) return;
    iniciou.current = true;
    bot(tenantId ? `*Loja: ${user?.loja || 'loja ativa'}*\nCancelamentos do iFood de qual período?` : 'Nenhuma loja ativa.');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const carregar = async (rotulo: string, de: string, ate: string) => {
    eu(rotulo);
    setPasso('carregando');
    const nomes = await lojasIfood(tenantId);
    if (ate >= somaDias(hojeISO(), -1)) await atualizarVendasIfood(tenantId);
    const linhas: Linha[] = [];
    for (let i = 0; ; i += 1000) {
      const { data, error } = await supabase.from('fin_ifood_sales')
        .select('merchant_id, short_id, sale_created_at, current_status, gross_bag, delivery_fee, eventos:raw->orderEvents')
        .eq('tenant_id', tenantId).gte('sale_created_at', `${de}T00:00:00-03:00`).lte('sale_created_at', `${ate}T23:59:59.999-03:00`)
        .order('sale_created_at', { ascending: false }).range(i, i + 999);
      if (error) { bot(`Não consegui ler: ${error.message}`); setPasso('fim'); return; }
      linhas.push(...((data ?? []) as unknown as Linha[]));
      if ((data ?? []).length < 1000) break;
    }
    const cancel = linhas.filter(canceladoIfood);
    const periodo = de === ate ? dataBR(de) : `${dataBR(de).slice(0, 5)} a ${dataBR(ate)}`;
    if (!cancel.length) {
      bot(`Nenhum pedido cancelado no iFood em ${periodo}${linhas.length ? ` (${linhas.length} pedidos no período)` : ''}. 👏`);
      setPasso('fim');
      return;
    }
    const perdido = (s: Linha) => n(s.gross_bag) + n(s.delivery_fee);
    const culpas = new Map<string, { qtd: number; valor: number }>();
    const motivos = new Map<string, { qtd: number; valor: number; culpa: string }>();
    for (const s of cancel) {
      const cod = codigoCancelamento(s.eventos);
      const culpa = cod ? culpaCancelamento(String(cod)) : 'ifood';
      const c = culpas.get(culpa) ?? { qtd: 0, valor: 0 };
      c.qtd += 1; c.valor += perdido(s); culpas.set(culpa, c);
      const motivo = cod ? (MOTIVO_CANCELAMENTO[cod] ?? `Código ${cod}`) : 'Sem motivo na API';
      const m = motivos.get(motivo) ?? { qtd: 0, valor: 0, culpa };
      m.qtd += 1; m.valor += perdido(s); motivos.set(motivo, m);
    }
    const taxa = linhas.length ? Math.round((cancel.length / linhas.length) * 1000) / 10 : 0;
    const daLoja = culpas.get('loja');
    painel(
      <Painel titulo={`Cancelamentos do iFood · ${periodo}`} subtitulo={user?.loja || 'Loja ativa'}
        rodape="Da API de vendas do iFood. Motivo pelo código que o iFood manda no cancelamento; culpa: 5xx e 902 = loja, 6xx = cliente, o resto = iFood/entregador (mesma regra de Relatórios › iFood).">
        <Kpis
          principal={{ label: 'Perdido em cancelamentos', valor: brl(cancel.reduce((a, s) => a + perdido(s), 0)), extra: <span className="text-xs font-semibold text-zinc-600">{taxa.toLocaleString('pt-BR')}% dos pedidos do período</span> }}
          outros={[{ label: 'Cancelados', valor: String(cancel.length) }, { label: 'Culpa da loja', valor: String(daLoja?.qtd ?? 0) }]}
        />
        <Barras titulo="De quem foi" cor="bg-red-500"
          itens={[...culpas.entries()].sort((x, y) => y[1].valor - x[1].valor).map(([k, v]) => ({ label: CULPA[k] ?? k, valor: v.valor, detalhe: `${v.qtd} pedido${v.qtd === 1 ? '' : 's'}` }))} />
        <Linhas titulo="Motivos" itens={[...motivos.entries()].sort((x, y) => y[1].qtd - x[1].qtd).map(([label, v]) => ({
          label, valor: `${v.qtd}×`, detalhe: brl(v.valor),
          status: v.culpa === 'loja' ? 'perigo' as const : 'neutro' as const,
        }))} />
        <Linhas titulo="Pedidos" itens={cancel.slice(0, 10).map((s) => {
          const cod = codigoCancelamento(s.eventos);
          return {
            label: `#${s.short_id ?? '—'} · ${dataBR(s.sale_created_at.slice(0, 10)).slice(0, 5)} ${horaBR(s.sale_created_at)}${Object.keys(nomes).length > 1 ? ` · ${nomes[s.merchant_id] ?? ''}` : ''}`,
            valor: brl(perdido(s)), detalhe: cod ? MOTIVO_CANCELAMENTO[cod] ?? `código ${cod}` : 'sem motivo na API',
            status: cod && culpaCancelamento(String(cod)) === 'loja' ? 'perigo' as const : 'neutro' as const,
          };
        })} />
      </Painel>,
    );
    setPasso('fim');
  };

  const hoje = hojeISO();
  return (
    <Roteiro titulo="Cancelamentos do iFood" icone="ri-close-circle-line" cor="bg-red-50 text-red-600" baloes={baloes}
      carregando={passo === 'carregando'} textoCarregando="Lendo os cancelamentos…" onFechar={onFechar}>
      {passo === 'periodo' && tenantId && (
        <>
          <Opcao onClick={() => carregar('Hoje', hoje, hoje)}>Hoje</Opcao>
          <Opcao onClick={() => carregar('Últimos 7 dias', somaDias(hoje, -6), hoje)}>Últimos 7 dias</Opcao>
          <Opcao onClick={() => carregar('Últimos 30 dias', somaDias(hoje, -29), hoje)}>Últimos 30 dias</Opcao>
        </>
      )}
      {(passo === 'fim' || !tenantId) && (
        <Fim onFechar={onFechar} acoes={tenantId ? [
          { label: 'Outro período', onClick: () => { bot('Qual período?'); setPasso('periodo'); } },
          ...(verTela ? [{ label: 'Abrir Relatórios', onClick: () => irPara('/relatorios') }] : []),
        ] : []} />
      )}
    </Roteiro>
  );
}
