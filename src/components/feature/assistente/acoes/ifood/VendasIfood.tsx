// Ação rápida (só leitura): vendas do iFood de um dia — o iFood não passa pelo PDV, então o
// "Vendas do dia" não tem esses pedidos. Fonte: fin_ifood_sales (API Sales do iFood), mesmas contas
// da tela Financeiro › iFood › Pedidos (ver ./comum.ts). Hoje/ontem: busca leve na API antes de
// somar (a diária das 07h20 ainda não tem as vendas da noite). Comparação: mesmo dia da semana passada.
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useAcessoAcoes, rotaLiberada } from '../acesso';
import { Roteiro, useRoteiro, EscolhaData, Fim, brl, dataBR, somaDias, hojeISO, type AcaoProps } from '../kit';
import { Painel, Kpis, Barras, Linhas, Variacao, GraficoLinha } from '../painel';
import { resumoIfood, lojasIfood, atualizarVendasIfood } from './comum';

const DIA_SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

export default function VendasIfood({ onFechar, irPara }: AcaoProps) {
  const { user } = useAuth();
  const tenantId = user?.tenantId ?? '';
  const verTela = rotaLiberada('/financeiro?tab=ifood', useAcessoAcoes());
  const { baloes, bot, eu, painel } = useRoteiro();
  const [passo, setPasso] = useState<'dia' | 'carregando' | 'fim'>('dia');
  const [vazio, setVazio] = useState<string | null>(null);
  const iniciou = useRef(false);

  useEffect(() => {
    if (iniciou.current) return;
    iniciou.current = true;
    bot(tenantId ? `*Loja: ${user?.loja || 'loja ativa'}*\nVendas do iFood de qual dia?` : 'Nenhuma loja ativa.');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const carregar = async (dia: string) => {
    eu(dataBR(dia));
    setVazio(null);
    setPasso('carregando');
    const nomes = await lojasIfood(tenantId);
    if (!Object.keys(nomes).length) {
      bot('Esta loja não tem iFood ligado. A conexão é feita em Financeiro › iFood › Configurar.');
      setPasso('fim');
      return;
    }
    if (dia >= somaDias(hojeISO(), -1)) await atualizarVendasIfood(tenantId);
    const semanaPassada = somaDias(dia, -7);
    const [r, a] = await Promise.all([
      resumoIfood(tenantId, `${dia}T00:00:00-03:00`, `${dia}T23:59:59.999-03:00`, nomes),
      resumoIfood(tenantId, `${semanaPassada}T00:00:00-03:00`, `${semanaPassada}T23:59:59.999-03:00`, nomes),
    ]);
    if (!r) { bot('Não consegui ler as vendas do iFood.'); setPasso('fim'); return; }
    if (!r.pedidos && !r.cancelados) {
      bot(`Nenhuma venda no iFood em ${dataBR(dia)}${dia === hojeISO() ? ' (ainda)' : ''}.`);
      setVazio(somaDias(dia, -1));
      setPasso('fim');
      return;
    }
    const rotulo = `${DIA_SEMANA[new Date(`${semanaPassada}T12:00:00-03:00`).getDay()]} passada`;
    const base = (v: number | undefined) => (a && a.pedidos > 0 ? v ?? 0 : null);
    const ticket = r.pedidos ? r.vendido / r.pedidos : 0;
    const comVenda = [...Array(24).keys()].filter((h) => r.porHora[h] > 0 || (a?.porHora[h] ?? 0) > 0);
    const pontos = comVenda.length >= 2
      ? Array.from({ length: comVenda[comVenda.length - 1] - comVenda[0] + 1 }, (_, i) => comVenda[0] + i)
        .map((h) => ({ rotulo: `${h}h`, valor: r.porHora[h], base: a ? a.porHora[h] : null }))
      : [];
    const pctTaxa = r.vendido > 0 ? Math.round((Math.abs(r.taxas) / r.vendido) * 1000) / 10 : 0;

    painel(
      <Painel titulo={`iFood · ${dataBR(dia)}`} subtitulo={user?.loja || 'Loja ativa'}
        rodape="Vendido = itens + entrega dos pedidos não cancelados. Líquido = o que o iFood repassa (cai no repasse da semana). O iFood não entra no Vendas do dia do PDV.">
        <Kpis
          principal={{ label: 'Vendido no iFood', valor: brl(r.vendido), extra: <Variacao atual={r.vendido} base={base(a?.vendido)} rotulo={`vs ${rotulo}`} /> }}
          outros={[
            { label: 'Pedidos', valor: String(r.pedidos), extra: <Variacao atual={r.pedidos} base={base(a?.pedidos)} rotulo="" /> },
            { label: 'Ticket médio', valor: brl(ticket) },
            { label: 'Líquido', valor: brl(r.liquido) },
          ]}
        />
        <Linhas titulo="Para onde vai o dinheiro" itens={[
          { label: 'Taxas do iFood', valor: brl(r.taxas), detalhe: `${pctTaxa}% do vendido`, status: 'alerta' },
          ...(r.promoLoja ? [{ label: 'Promoções pagas pela loja', valor: brl(r.promoLoja), status: 'alerta' as const }] : []),
          ...(r.promoIfood ? [{ label: 'Promoções pagas pelo iFood', valor: brl(r.promoIfood), status: 'neutro' as const }] : []),
          { label: 'Líquido para a loja', valor: brl(r.liquido), status: 'ok' },
          ...(r.cancelados ? [{ label: `${r.cancelados} cancelado${r.cancelados === 1 ? '' : 's'}`, valor: brl(r.valorCancelado), status: 'perigo' as const }] : []),
        ]} />
        {pontos.length >= 2 && <GraficoLinha titulo="Vendido por hora" pontos={pontos} rotuloBase={rotulo} />}
        {r.porLoja.length > 1 && (
          <Barras titulo="Por loja do iFood" cor="bg-red-500"
            itens={r.porLoja.map((l) => ({ label: l.nome, valor: l.vendido, detalhe: `${l.pedidos} pedido${l.pedidos === 1 ? '' : 's'}` }))} />
        )}
        <Barras titulo="Por forma de pagamento" cor="bg-sky-500"
          itens={r.porPagamento.map((p) => ({ label: p.nome, valor: p.valor, detalhe: `${p.pedidos} pedido${p.pedidos === 1 ? '' : 's'}` }))} />
      </Painel>,
    );
    setPasso('fim');
  };

  return (
    <Roteiro titulo="Vendas do iFood" icone="ri-e-bike-2-line" cor="bg-red-50 text-red-600" baloes={baloes}
      carregando={passo === 'carregando'} textoCarregando="Buscando as vendas no iFood…" onFechar={onFechar}>
      {passo === 'dia' && tenantId && <EscolhaData onEscolher={carregar} />}
      {(passo === 'fim' || !tenantId) && (
        <Fim onFechar={onFechar} acoes={tenantId ? [
          ...(vazio ? [{ label: `Ver ${dataBR(vazio)}`, onClick: () => carregar(vazio) }] : []),
          { label: 'Outro dia', onClick: () => { bot('Qual dia?'); setPasso('dia'); } },
          ...(verTela ? [{ label: 'Abrir iFood no Financeiro', onClick: () => irPara('/financeiro?tab=ifood') }] : []),
        ] : []} />
      )}
    </Roteiro>
  );
}
