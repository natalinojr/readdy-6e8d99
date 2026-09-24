// Ação rápida: vendas de um dia (só leitura).
// Mesma fonte da tela Relatórios (useSalesReport / DiaDetalheModal): RPC fn_get_sales_report
// com o dia em Brasília (-03:00). A RPC já exclui treino, rascunho, pedido cancelado e item
// cancelado (2026-07-09) e escala pagamento em grupo pela parte do pedido (2026-07-17).
// Top itens: junta as unidades "(Un. N)" como a aba Produtos & Ranking (normalizarNomeItem).
// Resposta em PAINEL (2026-09-18, pedido do dono): números em destaque, comparação com o mesmo dia
// da semana passada, barras por pagamento/canal e ranking — em vez de texto corrido.
// Faturado por hora (2026-09-23, pedido do dono): gráfico de linha com a MESMA regra do total da RPC
// (orders pagos, não cancelados, sem treino/rascunho, pela hora de criação em Brasília), somando
// total_amount — a soma das horas bate com o Faturamento. Linha tracejada = mesmo dia da semana passada.
// Por categoria (2026-09-23): mesma conta da Visão Geral (useVisaoGeralExtras) — itens não cancelados
// dos pedidos pagos do dia, preço × quantidade, categoria pelo cardápio. Soma só itens: taxa de
// serviço/entrega e descontos ficam de fora, então não fecha com o Faturamento.
import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { Roteiro, useRoteiro, EscolhaData, Fim, brl, dataBR, somaDias, hojeISO, type AcaoProps } from '../kit';
import { Painel, Kpis, Barras, Ranking, Variacao, GraficoLinha } from '../painel';

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

// Hora (0–23) em Brasília de um timestamp.
const horaBrasilia = (ts: string) => Number(new Date(ts).toLocaleString('en-US', { timeZone: 'America/Sao_Paulo', hour: '2-digit', hourCycle: 'h23' }));

/** Pedidos pagos do dia (mesmos filtros de fn_get_sales_report). null = não deu para ler. */
async function pedidosPagosDoDia(tenantId: string, dia: string): Promise<{ id: string; created_at: string; total_amount: number }[] | null> {
  const todos: { id: string; created_at: string; total_amount: number }[] = [];
  const LOTE = 1000;
  for (let de = 0; ; de += LOTE) {
    const { data, error } = await supabase.from('orders').select('id, created_at, total_amount')
      .eq('tenant_id', tenantId).eq('is_paid', true).neq('status', 'cancelled')
      .eq('is_training', false).eq('is_draft', false)
      .gte('created_at', `${dia}T00:00:00-03:00`).lte('created_at', `${dia}T23:59:59-03:00`)
      .order('created_at').range(de, de + LOTE - 1);
    if (error) return null;
    todos.push(...((data ?? []) as typeof todos));
    if ((data ?? []).length < LOTE) return todos;
  }
}

function porHora(pedidos: { created_at: string; total_amount: number }[] | null): number[] | null {
  if (!pedidos) return null;
  const horas = Array<number>(24).fill(0);
  for (const o of pedidos) horas[horaBrasilia(o.created_at)] += Number(o.total_amount ?? 0);
  return horas;
}

/** Faturamento por categoria do cardápio (itens não cancelados), maior primeiro. null = não deu para ler. */
async function porCategoria(tenantId: string, ids: string[]): Promise<{ nome: string; valor: number; qtd: number }[] | null> {
  const mapa = new Map<string, { valor: number; qtd: number }>();
  // Em pedaços: muitos ids num .in() estouram o tamanho da URL.
  for (let i = 0; i < ids.length; i += 150) {
    const { data, error } = await supabase.from('order_items')
      .select('item_price, quantity, menu_items!order_items_item_id_fkey(menu_categories(name))')
      .in('order_id', ids.slice(i, i + 150)).eq('tenant_id', tenantId).neq('status', 'cancelled');
    if (error) return null;
    // O tipo gerado do join vem como array; na prática o PostgREST devolve objeto (FK para um).
    for (const oi of (data ?? []) as unknown as Array<{ item_price: number | null; quantity: number | null; menu_items: { menu_categories: { name: string } | null } | null }>) {
      const nome = oi.menu_items?.menu_categories?.name ?? 'Sem categoria';
      const c = mapa.get(nome) ?? { valor: 0, qtd: 0 };
      c.valor += Number(oi.item_price ?? 0) * (oi.quantity ?? 1);
      c.qtd += oi.quantity ?? 1;
      mapa.set(nome, c);
    }
  }
  return [...mapa.entries()].map(([nome, v]) => ({ nome, ...v })).sort((a, b) => b.valor - a.valor);
}

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
    const [{ data, error }, anterior, pedidosDia, pedidosAnterior] = await Promise.all([
      relatorio(iso), relatorio(semanaPassada), pedidosPagosDoDia(tenantId, iso), pedidosPagosDoDia(tenantId, semanaPassada),
    ]);
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
    const top = [...mapa.entries()].sort((x, y) => y[1].valor - x[1].valor).slice(0, 5).map(([nome, v]) => ({ nome, ...v }));
    const diaSemana = new Date(`${semanaPassada}T12:00:00-03:00`).toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '');
    const base = (n: number | undefined) => (a && Number(a.total_orders) > 0 ? Number(n ?? 0) : null);
    // Eixo das horas: da primeira à última hora com venda (em qualquer dos dois dias).
    const horas = porHora(pedidosDia);
    const horasAnterior = porHora(pedidosAnterior);
    const comVenda = [...Array(24).keys()].filter((h) => (horas?.[h] ?? 0) > 0 || (horasAnterior?.[h] ?? 0) > 0);
    const pontosHora = horas && comVenda.length
      ? Array.from({ length: comVenda[comVenda.length - 1] - comVenda[0] + 1 }, (_, i) => comVenda[0] + i)
        .map((h) => ({ rotulo: `${h}h`, valor: horas[h], base: horasAnterior ? horasAnterior[h] : null }))
      : [];
    const categorias = pedidosDia?.length ? await porCategoria(tenantId, pedidosDia.map((o) => o.id)) : null;

    painel(
      <Painel titulo={`Vendas de ${dataBR(iso)}`} subtitulo={user?.loja || 'Loja ativa'} rodape="iFood fora do PDV não entra aqui. Por categoria soma só os itens (sem taxa de serviço/entrega e descontos).">
        <Kpis
          principal={{ label: 'Faturamento', valor: brl(r.total_revenue), extra: <Variacao atual={Number(r.total_revenue)} base={base(a?.total_revenue)} rotulo={`vs ${diaSemana} passada`} /> }}
          outros={[
            { label: 'Pedidos', valor: String(pedidos), extra: <Variacao atual={pedidos} base={base(a?.total_orders)} rotulo="" /> },
            { label: 'Ticket médio', valor: brl(r.avg_ticket), extra: <Variacao atual={Number(r.avg_ticket)} base={base(a?.avg_ticket)} rotulo="" /> },
          ]}
        />
        {pontosHora.length >= 2 && (
          <GraficoLinha titulo="Faturado por hora" pontos={pontosHora} rotuloBase={`${diaSemana} passada`} />
        )}
        {categorias && categorias.length > 0 && (
          <Barras titulo="Por categoria (itens)" cor="bg-amber-500"
            itens={categorias.map((c) => ({ label: c.nome, valor: c.valor, detalhe: `${c.qtd} ${c.qtd === 1 ? 'item' : 'itens'}` }))} />
        )}
        <Barras titulo="Por forma de pagamento"
          itens={[...(r.by_payment ?? [])].sort((x, y) => Number(y.total) - Number(x.total)).map((p) => ({ label: p.payment_method, valor: Number(p.total) }))} />
        <Barras titulo="Por canal" cor="bg-sky-500"
          itens={[...(r.by_destination ?? [])].sort((x, y) => Number(y.revenue) - Number(x.revenue))
            .map((c) => ({ label: CANAL[c.destination] ?? c.destination, valor: Number(c.revenue), detalhe: `${c.orders} pedido${Number(c.orders) === 1 ? '' : 's'}` }))} />
        <Ranking titulo="Mais vendidos" itens={top} por="valor" />
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
