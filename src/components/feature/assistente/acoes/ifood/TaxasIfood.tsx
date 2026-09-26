// Ação rápida (só leitura): quanto o iFood custa no mês — taxas por tipo (comissão, transação,
// entrega…) e promoções pagas pela loja, em R$ e em % do vendido. Fonte: fin_ifood_sales, mesmas
// contas de ./comum.ts (tela Financeiro › iFood › Pedidos); os nomes dos lançamentos vêm do mesmo
// tradutor da tela (nm). Mês corrente sai com a busca leve das vendas de hoje antes.
import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { Roteiro, useRoteiro, Opcao, Fim, brl, hojeISO, type AcaoProps } from '../kit';
import { Painel, Kpis, Barras, Linhas, Variacao } from '../painel';
import { resumoIfood, lojasIfood, atualizarVendasIfood, canceladoIfood, nm } from './comum';

const n = (v: unknown) => Number(v ?? 0);
const mesAnterior = (m: string) => { const [y, mm] = m.split('-').map(Number); return mm === 1 ? `${y - 1}-12` : `${y}-${String(mm - 1).padStart(2, '0')}`; };
const fimDoMes = (m: string) => { const [y, mm] = m.split('-').map(Number); return `${m}-${String(new Date(Date.UTC(y, mm, 0)).getUTCDate()).padStart(2, '0')}`; };
// As vendas da API só são buscadas ~30 dias para trás: o 1º mês da tabela vem pela metade. Primeira venda
// guardada a partir de 60 dias antes do mês (ignora sobra antiga de loja de teste).
async function primeiraVenda(tenantId: string, mes: string): Promise<string | null> {
  const [y, m] = mes.split('-').map(Number);
  const desde = new Date(Date.UTC(y, m - 3, 1)).toISOString().slice(0, 10);
  const { data } = await supabase.from('fin_ifood_sales').select('sale_created_at').eq('tenant_id', tenantId)
    .gte('sale_created_at', `${desde}T00:00:00-03:00`).order('sale_created_at').limit(1);
  const ts = (data?.[0] as { sale_created_at?: string } | undefined)?.sale_created_at;
  return ts ? new Date(new Date(ts).getTime() - 3 * 3600_000).toISOString().slice(0, 10) : null;
}
const nomeMes = (m: string) => new Date(`${m}-15T12:00:00Z`).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });

export default function TaxasIfood({ onFechar, irPara }: AcaoProps) {
  const { user } = useAuth();
  const tenantId = user?.tenantId ?? '';
  const { baloes, bot, eu, painel } = useRoteiro();
  const [passo, setPasso] = useState<'mes' | 'carregando' | 'fim'>('mes');
  const iniciou = useRef(false);
  const atual = hojeISO().slice(0, 7);

  useEffect(() => {
    if (iniciou.current) return;
    iniciou.current = true;
    bot(tenantId ? `*Loja: ${user?.loja || 'loja ativa'}*\nCusto do iFood de qual mês?` : 'Nenhuma loja ativa.');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const carregar = async (mes: string) => {
    eu(nomeMes(mes));
    setPasso('carregando');
    const nomes = await lojasIfood(tenantId);
    if (!Object.keys(nomes).length) { bot('Esta loja não tem iFood ligado.'); setPasso('fim'); return; }
    if (mes === atual) await atualizarVendasIfood(tenantId);
    const ant = mesAnterior(mes);
    const [r, aBruto, inicio] = await Promise.all([
      resumoIfood(tenantId, `${mes}-01T00:00:00-03:00`, `${fimDoMes(mes)}T23:59:59.999-03:00`, nomes),
      resumoIfood(tenantId, `${ant}-01T00:00:00-03:00`, `${fimDoMes(ant)}T23:59:59.999-03:00`, nomes),
      primeiraVenda(tenantId, mes),
    ]);
    // Mês anterior só compara se estiver inteiro no banco; o mês escolhido avisa se começou no meio.
    const a = inicio && inicio <= `${ant}-01` ? aBruto : null;
    const parcial = inicio && inicio > `${mes}-01` ? inicio : null;
    if (!r) { bot('Não consegui ler as vendas do iFood.'); setPasso('fim'); return; }
    if (!r.pedidos) { bot(`Nenhuma venda do iFood em ${nomeMes(mes)}.`); setPasso('fim'); return; }

    // Taxas por tipo de lançamento (negativos que não são promoção), igual à coluna Taxas da tela.
    const porTipo = new Map<string, number>();
    for (const s of r.vendas) {
      for (const b of Array.isArray(s.billing_entries) ? s.billing_entries : []) {
        if (n(b.value) >= 0 || /SUBSIDY/i.test(String(b.name))) continue;
        const k = nm(b.name) || 'Outros';
        porTipo.set(k, (porTipo.get(k) ?? 0) + Math.abs(n(b.value)));
      }
    }
    const custo = Math.abs(r.taxas) + r.promoLoja;
    const pct = (v: number) => (r.vendido > 0 ? `${(Math.round((v / r.vendido) * 1000) / 10).toLocaleString('pt-BR')}%` : '—');
    const custoAnt = a && a.pedidos ? Math.abs(a.taxas) + a.promoLoja : null;
    const pctAnt = custoAnt != null && a && a.vendido > 0 ? custoAnt / a.vendido : null;
    const cancelados = r.vendas.filter(canceladoIfood).length;

    painel(
      <Painel titulo={`Custo do iFood · ${nomeMes(mes)}`} subtitulo={user?.loja || 'Loja ativa'}
        rodape={`Custo = taxas do iFood + promoções pagas pela loja. Base: ${r.pedidos} pedidos, vendido ${brl(r.vendido)} (itens + entrega).${mes === atual ? ' Mês em andamento.' : ''}${parcial ? ` Só há vendas guardadas a partir de ${parcial.split('-').reverse().join('/')} (a busca da API do iFood começou nessa data).` : ''}`}>
        <Kpis
          principal={{ label: 'O iFood ficou com', valor: brl(custo), extra: <span className="text-xs font-semibold text-zinc-600">{pct(custo)} do vendido{pctAnt != null ? ` · mês anterior ${(Math.round(pctAnt * 1000) / 10).toLocaleString('pt-BR')}%` : ''}</span> }}
          outros={[
            { label: 'Vendido', valor: brl(r.vendido), extra: <Variacao atual={r.vendido} base={a && a.pedidos ? a.vendido : null} rotulo="" /> },
            { label: 'Líquido', valor: brl(r.liquido) },
            { label: 'Pedidos', valor: String(r.pedidos) },
          ]}
        />
        <Barras titulo="Taxas por tipo" cor="bg-red-500"
          itens={[...porTipo.entries()].sort((x, y) => y[1] - x[1]).map(([label, valor]) => ({ label, valor, detalhe: `${pct(valor)} do vendido` }))} />
        <Linhas titulo="Promoções" itens={[
          { label: 'Pagas pela loja', valor: brl(r.promoLoja), detalhe: `${pct(r.promoLoja)} do vendido · entra no custo`, status: 'alerta' },
          { label: 'Pagas pelo iFood', valor: brl(r.promoIfood), detalhe: 'não sai do bolso da loja', status: 'ok' },
          ...(cancelados ? [{ label: `${cancelados} pedido${cancelados === 1 ? '' : 's'} cancelado${cancelados === 1 ? '' : 's'}`, valor: brl(r.valorCancelado), status: 'perigo' as const }] : []),
        ]} />
      </Painel>,
    );
    setPasso('fim');
  };

  return (
    <Roteiro titulo="Custo do iFood" icone="ri-percent-line" cor="bg-red-50 text-red-600" baloes={baloes}
      carregando={passo === 'carregando'} textoCarregando="Somando as taxas…" onFechar={onFechar}>
      {passo === 'mes' && tenantId && (
        <>
          <Opcao onClick={() => carregar(atual)} detalhe="(até hoje)">Este mês</Opcao>
          <Opcao onClick={() => carregar(mesAnterior(atual))}>Mês passado</Opcao>
        </>
      )}
      {(passo === 'fim' || !tenantId) && (
        <Fim onFechar={onFechar} acoes={tenantId ? [
          { label: 'Outro mês', onClick: () => { bot('Qual mês?'); setPasso('mes'); } },
          { label: 'Abrir iFood no Financeiro', onClick: () => irPara('/financeiro?tab=ifood') },
        ] : []} />
      )}
    </Roteiro>
  );
}
