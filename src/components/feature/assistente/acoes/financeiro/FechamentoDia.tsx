// Ação rápida (só leitura): fechamento de um dia da loja — sem IA e sem gravar nada.
// Mesma cara do "Fechamento do turno" que o assistente manda ao fechar a sessão (assistente-cron ›
// sessaoText), só que para o dia inteiro: faturamento × mesmo dia da semana passada, barras por
// pagamento/canal, mais vendidos, caixas do dia e cancelados/descontos.
// Vendas: RPC fn_get_sales_report (mesma do Relatórios › detalhe do dia), sem pedidos de treino.
// 2026-09-23 (dono): saíram os cartões Cartão × Stone e iFood — a conferência fica na Conciliação.
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { Roteiro, useRoteiro, EscolhaData, Fim, OpcaoNeutra, brl, dataBR, hojeISO, somaDias, type AcaoProps } from '../kit';
import { Painel, Kpis, Linhas, Barras, Ranking, Variacao } from '../painel';

interface Relatorio {
  total_revenue?: number; total_orders?: number; avg_ticket?: number;
  by_payment?: { payment_method: string; total: number; count: number }[];
  by_destination?: { destination: string; orders: number; revenue: number }[];
  top_items?: { item_name: string; total_qty: number; total_revenue: number }[];
}
// Mesmos nomes de canal do "Fechamento do turno" (assistente-cron › sessaoText).
const CANAL: Record<string, string> = { delivery: 'Delivery', table: 'Mesa', qr_universal: 'QR Code', cashier: 'Caixa', immediate: 'Balcão', name: 'Senha', password: 'Senha', self_service: 'Autoatendimento', waiter: 'Garçom' };
const TOLERANCIA = 1; // R$: diferença menor que isso é arredondamento/gorjeta miúda

export default function FechamentoDia({ onFechar, irPara }: AcaoProps) {
  const { user } = useAuth();
  const tenantId = user?.tenantId ?? '';
  const { baloes, bot, eu, painel } = useRoteiro();
  const [passo, setPasso] = useState<'dia' | 'carregando' | 'fim'>('dia');
  useEffect(() => {
    bot(tenantId ? `Loja: *${user?.loja || 'loja ativa'}*\nFechamento de qual dia?` : 'Nenhuma loja ativa.');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fechar = async (dia: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dia) || dia > hojeISO()) { bot('Data inválida.'); return; }
    eu(dataBR(dia));
    setPasso('carregando');
    const from = `${dia}T00:00:00-03:00`;
    const to = `${dia}T23:59:59-03:00`;
    const semanaPassada = somaDias(dia, -7);
    const [rep, anterior, extras, caixas] = await Promise.all([
      supabase.rpc('fn_get_sales_report', { p_tenant_id: tenantId, p_date_from: from, p_date_to: to, p_session_id: null }),
      supabase.rpc('fn_get_sales_report', { p_tenant_id: tenantId, p_date_from: `${semanaPassada}T00:00:00-03:00`, p_date_to: `${semanaPassada}T23:59:59-03:00`, p_session_id: null }),
      supabase.from('orders').select('status, total_amount, discount_amount')
        .eq('tenant_id', tenantId).gte('created_at', from).lte('created_at', to).eq('is_training', false).eq('is_draft', false),
      supabase.from('cash_registers').select('closing_difference')
        .eq('tenant_id', tenantId).gte('opened_at', from).lte('opened_at', to).not('closed_at', 'is', null),
    ]);

    if (rep.error) {
      bot(`Não consegui ler as vendas: ${rep.error.message}`);
      setPasso('fim');
      return;
    }
    const r = (rep.data ?? {}) as Relatorio;
    const a = (anterior.error ? null : anterior.data) as Relatorio | null;
    const pedidos = (extras.data ?? []) as Array<{ status: string; total_amount: number | null; discount_amount: number | null }>;
    const cancelados = pedidos.filter((o) => o.status === 'cancelled');
    const valorCancelado = cancelados.reduce((s, o) => s + Number(o.total_amount ?? 0), 0);
    const descontos = pedidos.filter((o) => o.status !== 'cancelled').reduce((s, o) => s + Number(o.discount_amount ?? 0), 0);
    const n = Number(r.total_orders ?? 0);
    if (!n && !cancelados.length) {
      bot(`*Fechamento do dia · ${dataBR(dia)}*\nNenhum pedido pago nesse dia.`);
      setPasso('fim');
      return;
    }

    const rev = Number(r.total_revenue ?? 0);
    const base = a && Number(a.total_orders) > 0 ? Number(a.total_revenue ?? 0) : null;
    const diaSemana = new Date(`${semanaPassada}T12:00:00-03:00`).toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '');
    const formas = [...(r.by_payment ?? [])].sort((x, y) => Number(y.total) - Number(x.total));
    const totalPag = formas.reduce((s, p) => s + Number(p.total ?? 0), 0);
    const canais = [...(r.by_destination ?? [])].sort((x, y) => Number(y.revenue) - Number(x.revenue));
    const somaItens = new Map<string, { qtd: number; valor: number }>();
    for (const it of r.top_items ?? []) {
      const nome = String(it.item_name ?? '').replace(/\s*\(Un\.\s*\d+\)\s*$/i, '').trim();
      const prev = somaItens.get(nome) ?? { qtd: 0, valor: 0 };
      prev.qtd += Number(it.total_qty ?? 0);
      prev.valor += Number(it.total_revenue ?? 0);
      somaItens.set(nome, prev);
    }
    const top = [...somaItens.entries()].sort((x, y) => y[1].qtd - x[1].qtd).slice(0, 5).map(([nome, v]) => ({ nome, ...v }));
    const difs = (caixas.data ?? []) as Array<{ closing_difference: number | null }>;
    const somaDif = difs.reduce((s, c) => s + Number(c.closing_difference ?? 0), 0);
    const difPagFat = Math.round((totalPag - rev) * 100) / 100;
    const alertas: string[] = [];
    if (cancelados.length) alertas.push(`${cancelados.length} cancelado(s) (${brl(valorCancelado)})`);
    if (descontos > 0) alertas.push(`descontos ${brl(descontos)}`);
    if (formas.length && Math.abs(difPagFat) >= TOLERANCIA) alertas.push(`pagamentos × faturamento: diferença ${difPagFat > 0 ? '+' : '−'}${brl(Math.abs(difPagFat))}`);

    painel(
      <Painel titulo="Fechamento do dia" subtitulo={user?.loja || 'Loja ativa'} rodape={`${dataBR(dia)} · dia inteiro, todos os turnos`}>
        <Kpis
          principal={{ label: 'Faturamento', valor: brl(rev), extra: <Variacao atual={rev} base={base} rotulo={`vs ${diaSemana} passada`} /> }}
          outros={[{ label: 'Pedidos', valor: String(n) }, { label: 'Ticket médio', valor: brl(Number(r.avg_ticket ?? 0)) }]}
        />
        {formas.length > 0 && <Barras titulo="Por forma de pagamento" itens={formas.map((p) => ({ label: p.payment_method, valor: Number(p.total) }))} />}
        {canais.length > 0 && (
          <Barras titulo="Por canal" cor="bg-sky-500"
            itens={canais.map((c) => ({ label: CANAL[c.destination] ?? c.destination, valor: Number(c.revenue), detalhe: `${c.orders} pedido${Number(c.orders) === 1 ? '' : 's'}` }))} />
        )}
        {top.length > 0 && <Ranking titulo="Mais vendidos" itens={top} />}
        {difs.length > 0 && (
          <Linhas titulo="Caixas" itens={[{
            label: `${difs.length} caixa${difs.length === 1 ? '' : 's'} do dia`,
            valor: Math.abs(somaDif) < 0.01 ? 'bateu certinho' : somaDif > 0 ? `sobrou ${brl(somaDif)}` : `faltou ${brl(Math.abs(somaDif))}`,
            status: Math.abs(somaDif) < 0.01 ? 'ok' : 'perigo',
          }]} />
        )}
        {alertas.map((al) => (
          <p key={al} className="text-xs font-semibold text-amber-700 bg-amber-50 rounded-xl px-3 py-2">⚠️ {al}</p>
        ))}
      </Painel>,
    );
    setPasso('fim');
  };

  return (
    <Roteiro titulo="Fechamento do dia" icone="ri-calendar-check-line" cor="bg-emerald-50 text-emerald-600" baloes={baloes}
      carregando={passo === 'carregando'} textoCarregando="Somando as vendas do dia…" onFechar={onFechar}>
      {passo === 'dia' && tenantId && <EscolhaData onEscolher={fechar} />}
      {passo === 'dia' && !tenantId && <OpcaoNeutra onClick={onFechar}>Fechar</OpcaoNeutra>}
      {passo === 'fim' && (
        <Fim onFechar={onFechar} acoes={[
          { label: 'Outro dia', onClick: () => { bot('Fechamento de qual dia?'); setPasso('dia'); } },
          { label: 'Abrir Relatórios', onClick: () => irPara('/relatorios') },
        ]} />
      )}
    </Roteiro>
  );
}
