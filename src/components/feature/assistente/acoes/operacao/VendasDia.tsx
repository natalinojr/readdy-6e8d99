// Ação rápida: vendas de um dia (só leitura).
// Mesma fonte da tela Relatórios (useSalesReport / DiaDetalheModal): RPC fn_get_sales_report
// com o dia em Brasília (-03:00). A RPC já exclui treino, rascunho, pedido cancelado e item
// cancelado (2026-07-09) e escala pagamento em grupo pela parte do pedido (2026-07-17).
// Top itens: junta as unidades "(Un. N)" como a aba Produtos & Ranking (normalizarNomeItem).
// Resposta em PAINEL (2026-09-18, pedido do dono): números em destaque, comparação com o mesmo dia
// da semana passada, barras por pagamento/canal e ranking — em vez de texto corrido.
import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { Roteiro, useRoteiro, EscolhaData, Fim, brl, dataBR, somaDias, hojeISO, type AcaoProps } from '../kit';
import { Painel, Kpis, Barras, Ranking, Variacao } from '../painel';

interface Relatorio {
  total_revenue: number;
  total_orders: number;
  avg_ticket: number;
  top_items?: { item_name: string; total_qty: number; total_revenue: number }[];
  by_destination?: { destination: string; orders: number; revenue: number }[];
  by_payment?: { payment_method: string; total: number; count: number }[];
}

// Rótulos iguais aos de useOrigemReport (Relatórios › Origem dos Pedidos)
const CANAL: Record<string, string> = {
  cashier: 'Caixa', waiter: 'Garçom', table: 'Mesa (QR)', qr_universal: 'QR CODE',
  self_service: 'Autoatendimento', delivery: 'Delivery',
};

// Mesma regra de ProdutosTab.normalizarNomeItem (unidades do KDS gravadas como " (Un. N)")
const normalizarNome = (nome: string) => nome.replace(/\s*\(Un\.\s*\d+\)\s*$/i, '').trim();

export default function VendasDia({ onFechar, irPara }: AcaoProps) {
  const { user } = useAuth();
  const { baloes, bot, eu, painel } = useRoteiro();
  const [passo, setPasso] = useState<'dia' | 'carregando' | 'fim'>('dia');
  const iniciou = useRef(false);
  // Dia sem venda (ex.: "hoje" logo depois da meia-noite, com o turno de ontem recém-fechado):
  // oferece o dia anterior num toque.
  const [vazio, setVazio] = useState<string | null>(null);

  useEffect(() => {
    if (iniciou.current) return;
    iniciou.current = true;
    bot(`*Loja: ${user?.loja || 'loja ativa'}*\nVendas de qual dia?`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const carregar = async (iso: string) => {
    if (!user?.tenantId) { bot('Nenhuma loja ativa.'); setPasso('fim'); return; }
    const tenantId = user.tenantId;
    eu(dataBR(iso));
    setVazio(null);
    setPasso('carregando');
    const relatorio = (dia: string) => supabase.rpc('fn_get_sales_report', {
      p_tenant_id: tenantId,
      p_date_from: `${dia}T00:00:00-03:00`,
      p_date_to: `${dia}T23:59:59-03:00`,
      p_session_id: null,
    });
    // Mesmo dia da semana passada: a comparação que faz sentido num restaurante (sexta com sexta).
    const semanaPassada = somaDias(iso, -7);
    const [{ data, error }, anterior] = await Promise.all([relatorio(iso), relatorio(semanaPassada)]);
    if (error) { bot(`Não consegui ler as vendas: ${error.message}`); setPasso('fim'); return; }
    const r = (data ?? {}) as Relatorio;
    const a = (anterior.error ? null : anterior.data) as Relatorio | null;
    const pedidos = Number(r.total_orders ?? 0);
    if (!pedidos) {
      bot(`Nenhuma venda paga em ${dataBR(iso)}${iso === hojeISO() ? ' (ainda)' : ''}.`);
      setVazio(somaDias(iso, -1));
      setPasso('fim');
      return;
    }

    const mapa = new Map<string, { qtd: number; valor: number }>();
    for (const it of r.top_items ?? []) {
      const nome = normalizarNome(it.item_name);
      const prev = mapa.get(nome) ?? { qtd: 0, valor: 0 };
      prev.qtd += Number(it.total_qty ?? 0);
      prev.valor += Number(it.total_revenue ?? 0);
      mapa.set(nome, prev);
    }
    const top = [...mapa.entries()].sort((x, y) => y[1].qtd - x[1].qtd).slice(0, 5).map(([nome, v]) => ({ nome, ...v }));
    const diaSemana = new Date(`${semanaPassada}T12:00:00-03:00`).toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '');
    const base = (n: number | undefined) => (a && Number(a.total_orders) > 0 ? Number(n ?? 0) : null);

    painel(
      <Painel titulo={`Vendas de ${dataBR(iso)}`} subtitulo={user?.loja || 'Loja ativa'} rodape="iFood fora do PDV não entra aqui.">
        <Kpis
          principal={{ label: 'Faturamento', valor: brl(r.total_revenue), extra: <Variacao atual={Number(r.total_revenue)} base={base(a?.total_revenue)} rotulo={`vs ${diaSemana} passada`} /> }}
          outros={[
            { label: 'Pedidos', valor: String(pedidos), extra: <Variacao atual={pedidos} base={base(a?.total_orders)} rotulo="" /> },
            { label: 'Ticket médio', valor: brl(r.avg_ticket), extra: <Variacao atual={Number(r.avg_ticket)} base={base(a?.avg_ticket)} rotulo="" /> },
          ]}
        />
        <Barras titulo="Por forma de pagamento"
          itens={[...(r.by_payment ?? [])].sort((x, y) => Number(y.total) - Number(x.total)).map((p) => ({ label: p.payment_method, valor: Number(p.total) }))} />
        <Barras titulo="Por canal" cor="bg-sky-500"
          itens={[...(r.by_destination ?? [])].sort((x, y) => Number(y.revenue) - Number(x.revenue))
            .map((c) => ({ label: CANAL[c.destination] ?? c.destination, valor: Number(c.revenue), detalhe: `${c.orders} pedido${Number(c.orders) === 1 ? '' : 's'}` }))} />
        <Ranking titulo="Mais vendidos" itens={top} />
      </Painel>,
    );
    setPasso('fim');
  };

  return (
    <Roteiro titulo="Vendas do dia" icone="ri-line-chart-line" cor="bg-emerald-50 text-emerald-600" baloes={baloes}
      carregando={passo === 'carregando'} textoCarregando="Somando as vendas…" onFechar={onFechar}>
      {passo === 'dia' && <EscolhaData onEscolher={carregar} />}
      {passo === 'fim' && (
        <Fim onFechar={onFechar} acoes={[
          ...(vazio ? [{ label: `Ver ${dataBR(vazio)}`, onClick: () => carregar(vazio) }] : []),
          { label: 'Outro dia', onClick: () => { bot('Qual dia?'); setPasso('dia'); } },
          { label: 'Abrir Relatórios', onClick: () => irPara('/relatorios') },
        ]} />
      )}
    </Roteiro>
  );
}
