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
import { pedidosPagosDoDia, porHora, porCategoria } from './vendasDoDia';
import { useAuth } from '@/contexts/AuthContext';
import { Roteiro, useRoteiro, EscolhaData, Fim, brl, dataBR, somaDias, hojeISO, type AcaoProps } from '../kit';
import { Painel, Kpis, Barras, Ranking, Variacao, GraficoLinha, Linhas } from '../painel';
import { resumoIfood, lojasIfood, atualizarVendasIfood } from '../ifood/comum';
import { useAcessoAcoes, rotaLiberada } from '../acesso';

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
  const [temIfood, setTemIfood] = useState(false);
  const acesso = useAcessoAcoes();

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
    // iFood (2026-09-25): fora do PDV, entra num bloco à parte + "Total c/ iFood". Hoje/ontem: busca leve antes.
    // Semana passada também (2026-09-26): o número em destaque é o total ERPOS + iFood, e a variação
    // compara total com total.
    const ifoodDosDias = async () => {
      const nomes = await lojasIfood(tenantId);
      if (!Object.keys(nomes).length) return [null, null] as const;
      if (iso >= somaDias(hojeISO(), -1)) await atualizarVendasIfood(tenantId);
      const dia = (d: string) => resumoIfood(tenantId, `${d}T00:00:00-03:00`, `${d}T23:59:59.999-03:00`, nomes);
      return Promise.all([dia(iso), dia(semanaPassada).catch(() => null)]);
    };
    const [{ data, error }, anterior, pedidosDia, pedidosAnterior, [ifoodBruto, ifoodAnterior]] = await Promise.all([
      relatorio(iso), relatorio(semanaPassada), pedidosPagosDoDia(tenantId, iso), pedidosPagosDoDia(tenantId, semanaPassada),
      ifoodDosDias().catch(() => [null, null] as const),
    ]);
    const ifood = ifoodBruto && (ifoodBruto.pedidos || ifoodBruto.cancelados) ? ifoodBruto : null;
    setTemIfood(!!ifoodBruto);
    if (error) { bot(`Não consegui ler as vendas: ${error.message}`); setPasso('fim'); return; }
    const r = (data ?? {}) as Relatorio;
    const a = (anterior.error ? null : anterior.data) as Relatorio | null;
    const pedidos = Number(r.total_orders ?? 0);
    if (!pedidos && !ifood) {
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
    // Com iFood ligado (2026-09-26) o gráfico soma ERPOS + iFood por hora, nos dois dias, para bater
    // com o total em destaque; a linha tracejada é sempre o mesmo dia da semana passada.
    const somaIfood = (h: number[] | null, f: { porHora: number[] } | null) => (h && f ? h.map((v, i) => v + (f.porHora[i] ?? 0)) : h);
    const horas = somaIfood(porHora(pedidosDia), ifood);
    const horasAnterior = somaIfood(porHora(pedidosAnterior), ifood ? ifoodAnterior : null);
    const comVenda = [...Array(24).keys()].filter((h) => (horas?.[h] ?? 0) > 0 || (horasAnterior?.[h] ?? 0) > 0);
    const pontosHora = horas && comVenda.length
      ? Array.from({ length: comVenda[comVenda.length - 1] - comVenda[0] + 1 }, (_, i) => comVenda[0] + i)
        .map((h) => ({ rotulo: `${h}h`, valor: horas[h], base: horasAnterior ? horasAnterior[h] : null }))
      : [];
    const categorias = pedidosDia?.length ? await porCategoria(tenantId, pedidosDia.map((o) => o.id)) : null;
    // Destaque (2026-09-26, pedido do dono): com iFood ligado, o número grande é o total (ERPOS + iFood)
    // e embaixo, em menor, quanto veio de cada um. Base da semana passada = PDV + iFood daquele dia.
    const erpos = Number(r.total_revenue ?? 0);
    const total = erpos + (ifood?.vendido ?? 0);
    const temAnterior = (a && Number(a.total_orders) > 0) || (ifoodAnterior?.pedidos ?? 0) > 0;
    const baseTotal = ifood
      ? (temAnterior ? Number(a?.total_revenue ?? 0) + (ifoodAnterior?.vendido ?? 0) : null)
      : base(a?.total_revenue);

    painel(
      <Painel titulo={`Vendas de ${dataBR(iso)}`} subtitulo={user?.loja || 'Loja ativa'} rodape={`${ifood ? 'Total = ERPOS + iFood (vendido = itens + entrega). O gráfico por hora soma os dois; pedidos, ticket e as barras são só do ERPOS (o iFood está no bloco próprio).' : 'iFood fora do PDV não entra aqui.'} Por categoria soma só os itens (sem taxa de serviço/entrega e descontos).`}>
        <Kpis
          principal={{ label: ifood ? 'Faturamento total' : 'Faturamento', valor: brl(total), extra: (
            <>
              <Variacao atual={total} base={baseTotal} rotulo={`vs ${diaSemana} passada`} />
              {ifood && (
                <p className="text-xs font-semibold text-zinc-600 mt-1 tabular-nums">
                  ERPOS {brl(erpos)} · iFood {brl(ifood.vendido)}
                </p>
              )}
            </>
          ) }}
          outros={[
            { label: ifood ? 'Pedidos ERPOS' : 'Pedidos', valor: String(pedidos), extra: <Variacao atual={pedidos} base={base(a?.total_orders)} rotulo={`vs ${diaSemana} passada`} /> },
            { label: ifood ? 'Ticket médio ERPOS' : 'Ticket médio', valor: brl(r.avg_ticket), extra: <Variacao atual={Number(r.avg_ticket)} base={base(a?.avg_ticket)} rotulo={`vs ${diaSemana} passada`} /> },
          ]}
        />
        {ifood && (
          <Linhas titulo="iFood (fora do PDV)" itens={[
            { label: 'Vendido no iFood', valor: brl(ifood.vendido), detalhe: `${ifood.pedidos} pedido${ifood.pedidos === 1 ? '' : 's'} · itens + entrega` },
            { label: 'Taxas do iFood', valor: brl(ifood.taxas), status: 'alerta' },
            { label: 'Líquido para a loja', valor: brl(ifood.liquido), status: 'ok' },
            ...(ifood.cancelados ? [{ label: `${ifood.cancelados} cancelado${ifood.cancelados === 1 ? '' : 's'} no iFood`, valor: brl(ifood.valorCancelado), status: 'perigo' as const }] : []),
          ]} />
        )}
        {pontosHora.length >= 2 && (
          <GraficoLinha titulo={ifood ? 'Faturado por hora (ERPOS + iFood)' : 'Faturado por hora'} pontos={pontosHora} rotuloBase={`${diaSemana} passada`} />
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
          ...(temIfood && rotaLiberada('/financeiro?tab=ifood', acesso) ? [{ label: 'Abrir iFood no Financeiro', onClick: () => irPara('/financeiro?tab=ifood') }] : []),
        ]} />
      )}
    </Roteiro>
  );
}
