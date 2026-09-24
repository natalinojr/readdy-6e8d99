// Ação rápida (só leitura): fechamento de um dia da loja — sem IA e sem gravar nada.
// IGUAL ao "Fechamento do turno" que o assistente manda ao fechar a sessão (assistente-cron ›
// sessaoText), só que para o dia inteiro (todos os turnos): monta os MESMOS dados (DadosPainel) e
// desenha com o MESMO componente do chat (PainelMensagem) — mesmos blocos, mesma ordem; só mudam os
// números (dono, 2026-09-24). Mudou o painel do turno? Mude aqui junto.
// Vendas: RPC fn_get_sales_report (mesma do Relatórios › detalhe do dia). Por hora e por categoria:
// as mesmas contas da ação "Vendas do dia" (pedidosPagosDoDia / porHora / porCategoria).
// Caixas: os que ABRIRAM no dia e já fecharam. Cancelados/descontos: pedidos do dia sem treino.
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { Roteiro, useRoteiro, EscolhaData, Fim, OpcaoNeutra, brl, dataBR, hojeISO, somaDias, type AcaoProps } from '../kit';
import PainelMensagem, { type DadosPainel } from '../../PainelMensagem';
import { pedidosPagosDoDia, porHora, porCategoria } from '../operacao/vendasDoDia';

interface Relatorio {
  total_revenue?: number; total_orders?: number; avg_ticket?: number;
  by_payment?: { payment_method: string; total: number; count: number }[];
  by_destination?: { destination: string; orders: number; revenue: number }[];
  top_items?: { item_name: string; total_qty: number; total_revenue: number }[];
}
// Mesmos nomes de canal do "Fechamento do turno" (assistente-cron › sessaoText).
const CANAL: Record<string, string> = { delivery: 'Delivery', table: 'Mesa', qr_universal: 'QR Code', cashier: 'Caixa', immediate: 'Balcão', name: 'Senha', password: 'Senha', self_service: 'Autoatendimento', waiter: 'Garçom' };
const DIA_SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const diffTexto = (d: number) => (Math.abs(d) < 0.01 ? 'bateu certinho' : d > 0 ? `sobrou ${brl(d)}` : `faltou ${brl(Math.abs(d))}`);

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
    const [rep, anterior, extras, caixas, pedidosDia, pedidosAnterior] = await Promise.all([
      supabase.rpc('fn_get_sales_report', { p_tenant_id: tenantId, p_date_from: from, p_date_to: to, p_session_id: null }),
      supabase.rpc('fn_get_sales_report', { p_tenant_id: tenantId, p_date_from: `${semanaPassada}T00:00:00-03:00`, p_date_to: `${semanaPassada}T23:59:59-03:00`, p_session_id: null }),
      supabase.from('orders').select('status, total_amount, discount_amount')
        .eq('tenant_id', tenantId).gte('created_at', from).lte('created_at', to).eq('is_training', false).eq('is_draft', false),
      supabase.from('cash_registers').select('closing_difference')
        .eq('tenant_id', tenantId).gte('opened_at', from).lte('opened_at', to).not('closed_at', 'is', null),
      pedidosPagosDoDia(tenantId, dia),
      pedidosPagosDoDia(tenantId, semanaPassada),
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
    const lwRev = Number(a?.total_revenue ?? 0);
    const rotuloSemana = `${DIA_SEMANA[new Date(`${semanaPassada}T12:00:00-03:00`).getDay()]} passada`;
    const pagos = [...(r.by_payment ?? [])].sort((x, y) => Number(y.total) - Number(x.total));
    const canais = [...(r.by_destination ?? [])].sort((x, y) => Number(y.revenue) - Number(x.revenue));
    const somaItens = new Map<string, { q: number; v: number }>();
    for (const it of r.top_items ?? []) {
      const nome = String(it.item_name ?? '').replace(/\s*\(Un\.\s*\d+\)\s*$/i, '').trim();
      const acc = somaItens.get(nome) ?? { q: 0, v: 0 };
      acc.q += Number(it.total_qty ?? 0);
      acc.v += Number(it.total_revenue ?? 0);
      somaItens.set(nome, acc);
    }
    const top = [...somaItens.entries()].sort((x, y) => y[1].v - x[1].v).slice(0, 5);
    const categorias = pedidosDia?.length ? await porCategoria(tenantId, pedidosDia.map((o) => o.id)) : null;
    // Eixo das horas: da 1ª à última hora com venda (no dia ou na semana passada), como no turno.
    const horas = porHora(pedidosDia);
    const horasBase = porHora(pedidosAnterior);
    const comVenda = [...Array(24).keys()].filter((h) => (horas?.[h] ?? 0) > 0 || (horasBase?.[h] ?? 0) > 0);
    const grafico = horas && comVenda.length >= 2
      ? Array.from({ length: comVenda[comVenda.length - 1] - comVenda[0] + 1 }, (_, i) => comVenda[0] + i)
        .map((h) => ({ l: `${h}h`, v: horas[h], ...(horasBase ? { b: horasBase[h] } : {}) }))
      : [];
    const difs = (caixas.data ?? []) as Array<{ closing_difference: number | null }>;
    const somaDif = difs.reduce((s, c) => s + Number(c.closing_difference ?? 0), 0);
    const alertas: string[] = [];
    if (cancelados.length) alertas.push(`${cancelados.length} cancelado(s) (${brl(valorCancelado)})`);
    if (descontos > 0) alertas.push(`descontos ${brl(descontos)}`);

    const dados: DadosPainel = {
      t: 'Fechamento do dia', s: user?.loja || 'Loja ativa',
      r: `${dataBR(dia)} · dia inteiro, todos os turnos`,
      kpi: {
        p: { l: 'Faturamento', v: brl(rev), ...(lwRev > 0 ? { var: { a: rev, b: lwRev, r: `vs ${rotuloSemana}` } } : {}) },
        o: [{ l: 'Pedidos', v: String(n) }, { l: 'Ticket médio', v: brl(Number(r.avg_ticket ?? 0)) }],
      },
      ...(grafico.length >= 2 ? { gl: { t: 'Faturado por hora', rb: rotuloSemana, i: grafico } } : {}),
      b: [
        ...(pagos.length ? [{ t: 'Por forma de pagamento', i: pagos.map((p) => ({ l: p.payment_method, v: Number(p.total) })) }] : []),
        ...(canais.length ? [{ t: 'Por canal', c: 'bg-sky-500', i: canais.map((c) => ({ l: CANAL[c.destination] ?? c.destination, v: Number(c.revenue), d: `${Number(c.orders)} pedido${Number(c.orders) === 1 ? '' : 's'}` })) }] : []),
        ...(categorias?.length ? [{ t: 'Por categoria (itens)', c: 'bg-amber-500', i: categorias.map((c) => ({ l: c.nome, v: c.valor, d: `${c.qtd} ${c.qtd === 1 ? 'item' : 'itens'}` })) }] : []),
      ],
      ...(top.length ? { rk: { t: 'Mais vendidos', p: 'v' as const, i: top.map(([nome, it]) => ({ n: nome, q: it.q, v: it.v })) } } : {}),
      ...(difs.length ? { lin: [{ t: 'Caixas', i: [{ l: `${difs.length} caixa${difs.length === 1 ? '' : 's'} do dia`, v: diffTexto(somaDif), st: (Math.abs(somaDif) < 0.01 ? 'ok' : 'perigo') as 'ok' | 'perigo' }] }] } : {}),
      ...(alertas.length ? { al: alertas } : {}),
    };
    painel(<PainelMensagem dados={dados} />);
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
