// Ação rápida (só leitura): fechamento de um dia — vendas do ERPOS por forma de pagamento × vendas na
// Stone × vendas do iFood — sem IA e sem gravar nada.
// ERPOS: RPC fn_get_sales_report (mesma do Relatórios › detalhe do dia), sem pedidos de treino.
// Stone: stone-conciliation › get_config / get_history (fin_stone_imports: vendas brutas do arquivo do dia).
// iFood: fetchIfoodVendas (relatório de conciliação importado, por data do pedido — igual Relatórios).
import { useEffect, useState } from 'react';
import { supabase, invokeWithAuth } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { fetchIfoodVendas } from '@/lib/ifoodVendas';
import { Roteiro, useRoteiro, EscolhaData, Fim, OpcaoNeutra, brl, dataBR, hojeISO, type AcaoProps } from '../kit';

interface ByPayment { payment_method: string; payment_type: string; total: number; count: number }
interface StoneDia { reference_date: string; status: string; sales_count?: number | null; sales_gross?: number | null; payments_total?: number | null; error_message?: string | null }
const TOLERANCIA = 1; // R$: diferença menor que isso é arredondamento/gorjeta miúda
const CARTAO = ['credit_card', 'debit_card'];

export default function FechamentoDia({ onFechar, irPara }: AcaoProps) {
  const { user } = useAuth();
  const tenantId = user?.tenantId ?? '';
  const { baloes, bot, eu } = useRoteiro();
  const [passo, setPasso] = useState<'dia' | 'carregando' | 'fim'>('dia');
  useEffect(() => {
    bot(tenantId ? `Loja: *${user?.loja || 'loja ativa'}*\nFechamento de qual dia?` : 'Nenhuma loja ativa.');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dif = (a: number, b: number) => {
    const d = Math.round((a - b) * 100) / 100;
    return Math.abs(d) < TOLERANCIA ? '✅ bate' : `⚠️ diferença ${d > 0 ? '+' : '−'}${brl(Math.abs(d))}`;
  };

  const fechar = async (dia: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dia) || dia > hojeISO()) { bot('Data inválida.'); return; }
    eu(dataBR(dia));
    setPasso('carregando');
    const from = `${dia}T00:00:00-03:00`;
    const to = `${dia}T23:59:59-03:00`;
    const [rep, stoneCfg, stoneHist, ifood] = await Promise.all([
      supabase.rpc('fn_get_sales_report', { p_tenant_id: tenantId, p_date_from: from, p_date_to: to, p_session_id: null }),
      invokeWithAuth<{ config?: { is_active?: boolean } | null; error?: string }>('stone-conciliation', { body: { action: 'get_config', tenant_id: tenantId } }),
      invokeWithAuth<{ history?: StoneDia[]; error?: string }>('stone-conciliation', { body: { action: 'get_history', tenant_id: tenantId } }),
      fetchIfoodVendas(tenantId, from, to),
    ]);

    // ── ERPOS ──
    let cartaoErp = 0;
    let ifoodErp: number | null = null;
    if (rep.error) {
      bot(`Não consegui ler as vendas do ERPOS: ${rep.error.message}`);
    } else {
      const r = (rep.data ?? {}) as { total_revenue?: number; total_orders?: number; by_payment?: ByPayment[] };
      const formas = [...(r.by_payment ?? [])].sort((a, b) => Number(b.total) - Number(a.total));
      const totalPag = formas.reduce((s, p) => s + Number(p.total ?? 0), 0);
      cartaoErp = formas.filter((p) => CARTAO.includes(p.payment_type)).reduce((s, p) => s + Number(p.total ?? 0), 0);
      const ifoodForma = formas.filter((p) => /ifood/i.test(p.payment_method));
      if (ifoodForma.length) ifoodErp = ifoodForma.reduce((s, p) => s + Number(p.total ?? 0), 0);
      bot(formas.length ? [
        `*Vendas no ERPOS · ${dataBR(dia)}*`,
        ...formas.map((p) => `${p.payment_method}: ${brl(Number(p.total))} (${p.count})`),
        `Total recebido: ${brl(totalPag)}`,
        `Pedidos pagos: ${Number(r.total_orders ?? 0)} · faturamento ${brl(Number(r.total_revenue ?? 0))}`,
        Math.abs(totalPag - Number(r.total_revenue ?? 0)) >= TOLERANCIA ? `Pagamentos × faturamento: ${dif(totalPag, Number(r.total_revenue ?? 0))}` : '',
      ].filter(Boolean).join('\n') : `*Vendas no ERPOS · ${dataBR(dia)}*\nNenhum pedido pago nesse dia.`);
    }

    // ── Stone ──
    const cfg = stoneCfg.data?.config ?? null;
    if (stoneCfg.error || stoneCfg.data?.error) {
      bot(`Stone: não consegui consultar (${stoneCfg.error?.message ?? stoneCfg.data?.error}).`);
    } else if (!cfg) {
      bot('Stone: não integrada nesta loja.');
    } else if (dia >= hojeISO()) {
      bot(`*Cartão (ERPOS) × Stone*\nERPOS crédito+débito: ${brl(cartaoErp)}\nO arquivo da Stone de hoje só sai amanhã a partir das 04h.`);
    } else {
      const s = (stoneHist.data?.history ?? []).find((h) => h.reference_date === dia);
      if (!s) {
        bot(`*Cartão (ERPOS) × Stone*\nERPOS crédito+débito: ${brl(cartaoErp)}\nStone: dia ainda não importado. Rode "Atualizar conciliação" e tente de novo.`);
      } else if (s.status !== 'success') {
        bot(`*Cartão (ERPOS) × Stone*\nERPOS crédito+débito: ${brl(cartaoErp)}\nStone: importação do dia falhou${s.error_message ? ` (${s.error_message.slice(0, 160)})` : ''}.`);
      } else {
        const stone = Number(s.sales_gross ?? 0);
        bot([
          '*Cartão (ERPOS) × Stone*',
          `ERPOS crédito+débito: ${brl(cartaoErp)}`,
          `Stone vendas brutas: ${brl(stone)} (${Number(s.sales_count ?? 0)})`,
          `Stone − ERPOS: ${dif(stone, cartaoErp)}`,
          s.payments_total != null ? `Depósitos da Stone no dia: ${brl(Number(s.payments_total))}` : '',
          'Obs.: a Stone pode incluir Pix/voucher passado na maquininha; o ERPOS inclui cartão online.',
        ].filter(Boolean).join('\n'));
      }
    }

    // ── iFood ──
    if (ifood.error) {
      bot(`iFood: não consegui ler (${ifood.error}).`);
    } else if (ifood.pedidos === 0 && Math.abs(ifood.total) < 0.005) {
      bot(`*iFood · ${dataBR(dia)}*\nSem vendas no relatório do iFood para o dia (o relatório pode chegar depois; ou a loja não usa iFood).${ifoodErp != null ? `\nERPOS (forma iFood): ${brl(ifoodErp)}` : ''}`);
    } else {
      bot([
        `*iFood · ${dataBR(dia)}*`,
        `Vendas no iFood: ${brl(ifood.total)} (${ifood.pedidos} pedido(s))`,
        ifoodErp != null ? `ERPOS (forma iFood): ${brl(ifoodErp)} · ${dif(ifood.total, ifoodErp)}` : 'Pedidos do iFood não passam pelo caixa do ERPOS: valor só informativo.',
      ].join('\n'));
    }
    setPasso('fim');
  };

  return (
    <Roteiro titulo="Fechamento do dia" icone="ri-calendar-check-line" cor="bg-emerald-50 text-emerald-600" baloes={baloes}
      carregando={passo === 'carregando'} textoCarregando="Somando vendas, Stone e iFood…" onFechar={onFechar}>
      {passo === 'dia' && tenantId && <EscolhaData onEscolher={fechar} />}
      {passo === 'dia' && !tenantId && <OpcaoNeutra onClick={onFechar}>Fechar</OpcaoNeutra>}
      {passo === 'fim' && (
        <Fim onFechar={onFechar} acoes={[
          { label: 'Outro dia', onClick: () => { bot('Fechamento de qual dia?'); setPasso('dia'); } },
          { label: 'Abrir na conciliação', onClick: () => irPara('/financeiro?tab=conciliacao') },
        ]} />
      )}
    </Roteiro>
  );
}
