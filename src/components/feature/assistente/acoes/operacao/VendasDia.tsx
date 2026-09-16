// Ação rápida: vendas de um dia (só leitura).
// Mesma fonte da tela Relatórios (useSalesReport / DiaDetalheModal): RPC fn_get_sales_report
// com o dia em Brasília (-03:00). A RPC já exclui treino, rascunho, pedido cancelado e item
// cancelado (2026-07-09) e escala pagamento em grupo pela parte do pedido (2026-07-17).
// Top itens: junta as unidades "(Un. N)" como a aba Produtos & Ranking (normalizarNomeItem).
import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { Roteiro, useRoteiro, EscolhaData, Fim, brl, dataBR, type AcaoProps } from '../kit';

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
  const { baloes, bot, eu } = useRoteiro();
  const [passo, setPasso] = useState<'dia' | 'carregando' | 'fim'>('dia');
  const iniciou = useRef(false);

  useEffect(() => {
    if (iniciou.current) return;
    iniciou.current = true;
    bot(`Loja: *${user?.loja || 'loja ativa'}*\nVendas de qual dia?`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const carregar = async (iso: string) => {
    if (!user?.tenantId) { bot('Nenhuma loja ativa.'); setPasso('fim'); return; }
    eu(dataBR(iso));
    setPasso('carregando');
    const { data, error } = await supabase.rpc('fn_get_sales_report', {
      p_tenant_id: user.tenantId,
      p_date_from: `${iso}T00:00:00-03:00`,
      p_date_to: `${iso}T23:59:59-03:00`,
      p_session_id: null,
    });
    if (error) { bot(`Não consegui ler as vendas: ${error.message}`); setPasso('fim'); return; }
    const r = (data ?? {}) as Relatorio;
    const pedidos = Number(r.total_orders ?? 0);
    if (!pedidos) { bot(`Nenhuma venda paga em ${dataBR(iso)}.`); setPasso('fim'); return; }

    const linhas: string[] = [
      `*Vendas de ${dataBR(iso)}*`,
      `Faturamento: ${brl(r.total_revenue)}`,
      `Pedidos: ${pedidos}`,
      `Ticket médio: ${brl(r.avg_ticket)}`,
    ];

    const pags = [...(r.by_payment ?? [])].sort((a, b) => Number(b.total) - Number(a.total));
    if (pags.length) {
      linhas.push('', '*Por forma de pagamento*');
      pags.forEach((p) => linhas.push(`${p.payment_method}: ${brl(Number(p.total))}`));
    }

    const canais = [...(r.by_destination ?? [])].sort((a, b) => Number(b.revenue) - Number(a.revenue));
    if (canais.length) {
      linhas.push('', '*Por canal*');
      canais.forEach((c) => linhas.push(`${CANAL[c.destination] ?? c.destination}: ${brl(Number(c.revenue))} · ${c.orders} ped.`));
    }

    const mapa = new Map<string, { qtd: number; valor: number }>();
    for (const it of r.top_items ?? []) {
      const nome = normalizarNome(it.item_name);
      const prev = mapa.get(nome) ?? { qtd: 0, valor: 0 };
      prev.qtd += Number(it.total_qty ?? 0);
      prev.valor += Number(it.total_revenue ?? 0);
      mapa.set(nome, prev);
    }
    const top = [...mapa.entries()].sort((a, b) => b[1].qtd - a[1].qtd).slice(0, 5);
    if (top.length) {
      linhas.push('', '*Top 5 itens*');
      top.forEach(([nome, v], i) => linhas.push(`${i + 1}. ${nome} · ${v.qtd} un · ${brl(v.valor)}`));
    }

    linhas.push('', 'iFood fora do PDV não entra aqui.');
    bot(linhas.join('\n'));
    setPasso('fim');
  };

  return (
    <Roteiro titulo="Vendas do dia" icone="ri-line-chart-line" cor="bg-emerald-50 text-emerald-600" baloes={baloes}
      carregando={passo === 'carregando'} textoCarregando="Somando as vendas…" onFechar={onFechar}>
      {passo === 'dia' && <EscolhaData onEscolher={carregar} />}
      {passo === 'fim' && (
        <Fim onFechar={onFechar} acoes={[
          { label: 'Outro dia', onClick: () => { bot('Qual dia?'); setPasso('dia'); } },
          { label: 'Abrir Relatórios', onClick: () => irPara('/relatorios') },
        ]} />
      )}
    </Roteiro>
  );
}
