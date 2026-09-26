// Ação rápida (só leitura): mais vendidos no iFood. A API Financial não traz os itens dos pedidos;
// a fonte por produto é o relatório "Cardápio" do Portal do Parceiro importado na aba iFood
// (fin_ifood_menu_sales) — mesma leitura e mesma soma por nome da tela (IfoodProdutos).
import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useAcessoAcoes, rotaLiberada } from '../acesso';
import { Roteiro, useRoteiro, Fim, brl, dataBR, type AcaoProps } from '../kit';
import { Painel, Kpis, Ranking, Linhas } from '../painel';

interface Linha { period_start: string; period_end: string; kind: 'item' | 'complemento'; name: string; quantity: number | null; total_value: number | null; visits: number | null; orders: number | null; promo_quantity: number | null }
const n = (v: unknown) => Number(v ?? 0);

export default function ProdutosIfood({ onFechar, irPara }: AcaoProps) {
  const { user } = useAuth();
  const tenantId = user?.tenantId ?? '';
  const verTela = rotaLiberada('/financeiro?tab=ifood', useAcessoAcoes());
  const { baloes, bot, painel } = useRoteiro();
  const [carregando, setCarregando] = useState(true);
  const iniciou = useRef(false);

  useEffect(() => {
    if (iniciou.current) return;
    iniciou.current = true;
    (async () => {
      if (!tenantId) { bot('Nenhuma loja ativa.'); setCarregando(false); return; }
      // Último período importado primeiro; depois lê só as linhas dele.
      const ult = await supabase.from('fin_ifood_menu_sales').select('period_start, period_end')
        .eq('tenant_id', tenantId).order('period_end', { ascending: false }).order('period_start').limit(1);
      const p = (ult.data ?? [])[0] as { period_start: string; period_end: string } | undefined;
      if (ult.error || !p) {
        bot('Nenhum relatório de Cardápio do iFood importado.\nNo Portal do Parceiro: Relatórios › Cardápio › Exportar; depois suba o arquivo em Financeiro › iFood.');
        setCarregando(false);
        return;
      }
      const { data, error } = await supabase.from('fin_ifood_menu_sales')
        .select('period_start, period_end, kind, name, quantity, total_value, visits, orders, promo_quantity')
        .eq('tenant_id', tenantId).eq('period_start', p.period_start).eq('period_end', p.period_end).limit(20000);
      if (error) { bot(`Não consegui ler os produtos: ${error.message}`); setCarregando(false); return; }
      // Soma por nome (com várias lojas do iFood o mesmo produto vem uma vez por loja).
      const agrupa = (kind: Linha['kind']) => {
        const m = new Map<string, { nome: string; qtd: number; valor: number; visitas: number; pedidos: number; promo: number }>();
        for (const l of ((data ?? []) as Linha[]).filter((x) => x.kind === kind)) {
          const k = l.name.toLowerCase();
          const g = m.get(k) ?? { nome: l.name, qtd: 0, valor: 0, visitas: 0, pedidos: 0, promo: 0 };
          g.qtd += n(l.quantity); g.valor += n(l.total_value); g.visitas += n(l.visits); g.pedidos += n(l.orders); g.promo += n(l.promo_quantity);
          m.set(k, g);
        }
        return [...m.values()].sort((a, b) => b.valor - a.valor);
      };
      const itens = agrupa('item');
      const comps = agrupa('complemento');
      const total = itens.reduce((s, i) => s + i.valor, 0);
      // Muita visita e pouco pedido: foto/preço/descrição a rever (conversão = pedidos ÷ visitas).
      const baixaConversao = itens.filter((i) => i.visitas >= 30).map((i) => ({ ...i, conv: i.pedidos / i.visitas }))
        .sort((a, b) => a.conv - b.conv).slice(0, 3);

      painel(
        <Painel titulo="Mais vendidos no iFood" subtitulo={user?.loja || 'Loja ativa'}
          rodape={`Relatório de Cardápio do Portal do Parceiro, ${dataBR(p.period_start)} a ${dataBR(p.period_end)}. Para atualizar, importe um relatório novo em Financeiro › iFood.`}>
          <Kpis principal={{ label: 'Vendido em itens', valor: brl(total) }}
            outros={[{ label: 'Itens vendidos', valor: String(itens.reduce((s, i) => s + i.qtd, 0)) }, { label: 'Produtos', valor: String(itens.length) }]} />
          <Ranking titulo="Mais vendidos (por faturamento)" por="valor" itens={itens.slice(0, 10).map((i) => ({ nome: i.nome, qtd: i.qtd, valor: i.valor }))} />
          {comps.length > 0 && (
            <Ranking titulo="Complementos" por="valor" itens={comps.slice(0, 5).map((i) => ({ nome: i.nome, qtd: i.qtd, valor: i.valor }))} />
          )}
          {baixaConversao.length > 0 && (
            <Linhas titulo="Muita visita, pouco pedido" itens={baixaConversao.map((i) => ({
              label: i.nome, valor: `${Math.round(i.conv * 100)}%`, detalhe: `${i.visitas} visitas · ${i.pedidos} pedidos — rever foto, preço ou descrição`, status: 'alerta' as const,
            }))} />
          )}
        </Painel>,
      );
      setCarregando(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Roteiro titulo="Mais vendidos no iFood" icone="ri-trophy-line" cor="bg-red-50 text-red-600" baloes={baloes}
      carregando={carregando} textoCarregando="Lendo o relatório de cardápio…" onFechar={onFechar}>
      {!carregando && <Fim onFechar={onFechar} acoes={tenantId ? [...(verTela ? [{ label: 'Abrir iFood no Financeiro', onClick: () => irPara('/financeiro?tab=ifood') }] : [])] : []} />}
    </Roteiro>
  );
}
