// Ação rápida (só leitura): um pedido do iFood pelo número curto (o "#1234" do Portal/tablet) —
// quanto o cliente pagou, promoções por quem pagou, cada taxa, o líquido e a linha do tempo.
// Fonte: fin_ifood_sales (API Sales). Número curto se repete: busca nos últimos 30 dias e, se vier
// mais de um, a pessoa escolhe. Antes de buscar, busca leve das vendas de hoje/ontem na API.
import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useAcessoAcoes, rotaLiberada } from '../acesso';
import { Roteiro, useRoteiro, Campo, Opcao, Fim, brl, dataBR, horaBR, hojeISO, somaDias, type AcaoProps } from '../kit';
import { Painel, Kpis, Linhas, Chip } from '../painel';
import { atualizarVendasIfood, canceladoIfood, codigoCancelamento, lojasIfood, MOTIVO_CANCELAMENTO, nm, taxasDoPedido } from './comum';

interface Pedido {
  sale_id: string; merchant_id: string; short_id: string | null; sale_created_at: string; current_status: string | null;
  gross_bag: number | null; delivery_fee: number | null; service_fee: number | null; sale_balance: number | null;
  payment_methods: Array<{ method?: string; value?: number; liability?: string; wallet?: { name?: string }; card?: { brand?: string } }> | null;
  billing_entries: Array<{ name?: string; value?: number }> | null;
  benefits: { benefits?: Array<{ target?: string; value?: number; sponsorships?: Array<{ name?: string; value?: number }> }> } | null;
  eventos: Array<{ fullCode?: string; createdAt?: string; metadata?: { cancelCode?: number } | null }> | null;
  logistica: string | null;
}
const n = (v: unknown) => Number(v ?? 0);
const QUEM: Record<string, string> = { IFOOD: 'iFood', MERCHANT: 'loja', CHAIN: 'loja (rede)', EXTERNAL: 'indústria' };
// Marcos da linha do tempo (códigos do orderEvents da API).
const MARCOS: Array<[string, string]> = [
  ['PLACED', 'Pedido feito'], ['RECEIVED', 'Chegou na loja'], ['CONFIRMED', 'Loja aceitou'], ['READY_TO_DELIVER', 'Pronto'],
  ['DELIVERY_ARRIVED_AT_ORIGIN', 'Entregador chegou'], ['DELIVERY_COLLECTED', 'Saiu para entrega'],
  ['DELIVERY_DROP_CODE_VALIDATION_SUCCESS', 'Entregue'], ['CONCLUDED', 'Concluído'], ['CANCELLED', 'Cancelado'],
];

export default function PedidoIfood({ onFechar, irPara }: AcaoProps) {
  const { user } = useAuth();
  const tenantId = user?.tenantId ?? '';
  const verTela = rotaLiberada('/financeiro?tab=ifood', useAcessoAcoes());
  const { baloes, bot, eu, painel } = useRoteiro();
  const [passo, setPasso] = useState<'numero' | 'carregando' | 'escolher' | 'fim'>('numero');
  const [opcoes, setOpcoes] = useState<Pedido[]>([]);
  const nomes = useRef<Record<string, string>>({});
  const iniciou = useRef(false);

  useEffect(() => {
    if (iniciou.current) return;
    iniciou.current = true;
    bot(tenantId ? `*Loja: ${user?.loja || 'loja ativa'}*\nQual o número do pedido do iFood? (o número curto, ex.: 3433)` : 'Nenhuma loja ativa.');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const mostrar = (p: Pedido) => {
    const cancelado = canceladoIfood(p);
    const pago = (p.payment_methods ?? []).reduce((a, m) => a + n(m.value), 0);
    const promos: Array<{ label: string; valor: string; status: 'ok' | 'alerta' }> = [];
    for (const b of p.benefits?.benefits ?? []) {
      for (const sp of b.sponsorships ?? []) {
        if (!n(sp.value)) continue;
        const quem = QUEM[String(sp.name).toUpperCase()] ?? String(sp.name);
        promos.push({ label: `Promoção ${b.target === 'DELIVERY_FEE' ? 'na entrega' : b.target === 'CART' ? 'no pedido' : 'no item'} · paga pela ${quem}`, valor: brl(n(sp.value)), status: quem.startsWith('loja') ? 'alerta' : 'ok' });
      }
    }
    const taxas = (p.billing_entries ?? []).filter((b) => n(b.value) < 0 && !/SUBSIDY/i.test(String(b.name)))
      .map((b) => ({ label: nm(b.name), valor: brl(n(b.value)), status: 'alerta' as const }));
    const primeiro = new Map<string, string>();
    for (const e of p.eventos ?? []) if (e.fullCode && e.createdAt && !primeiro.has(e.fullCode)) primeiro.set(e.fullCode, e.createdAt);
    const inicio = primeiro.get('PLACED') ?? primeiro.get('RECEIVED') ?? p.sale_created_at;
    const min = (iso: string) => Math.round((Date.parse(iso) - Date.parse(inicio)) / 60000);
    const tempo = MARCOS.filter(([c]) => primeiro.has(c)).map(([c, rotulo]) => ({
      label: rotulo, valor: horaBR(primeiro.get(c)), detalhe: c === 'PLACED' ? undefined : `+${min(primeiro.get(c)!)} min`,
      status: (c === 'CANCELLED' ? 'perigo' : c === 'CONCLUDED' || c === 'DELIVERY_DROP_CODE_VALIDATION_SUCCESS' ? 'ok' : 'neutro') as 'perigo' | 'ok' | 'neutro',
    }));
    const codigo = codigoCancelamento(p.eventos);
    painel(
      <Painel titulo={`Pedido #${p.short_id ?? '—'}`} subtitulo={`${nomes.current[p.merchant_id] ?? 'iFood'} · ${dataBR(p.sale_created_at.slice(0, 10))} ${horaBR(p.sale_created_at)}`}
        rodape="Da API de vendas do iFood. Líquido = o que o iFood repassa por este pedido.">
        <Kpis
          principal={{ label: 'Líquido para a loja', valor: brl(n(p.sale_balance)), extra: cancelado ? <Chip texto={`Cancelado${codigo ? ` · ${MOTIVO_CANCELAMENTO[codigo] ?? `código ${codigo}`}` : ''}`} status="perigo" /> : <Chip texto={p.logistica === 'IFOOD_LOGISTICS' ? 'Entrega do iFood' : 'Entrega própria'} status="neutro" /> }}
          outros={[
            { label: 'Itens + entrega', valor: brl(n(p.gross_bag) + n(p.delivery_fee)) },
            { label: 'Cliente pagou', valor: brl(pago) },
          ]}
        />
        <Linhas titulo="Conta do pedido" itens={[
          { label: 'Itens', valor: brl(n(p.gross_bag)) },
          ...(n(p.delivery_fee) ? [{ label: 'Entrega', valor: brl(n(p.delivery_fee)) }] : []),
          ...promos,
          ...taxas,
          { label: 'Total de taxas', valor: brl(taxasDoPedido(p)), status: 'alerta' },
          { label: 'Líquido para a loja', valor: brl(n(p.sale_balance)), status: 'ok' },
        ]} />
        <Linhas titulo="Pagamento" itens={(p.payment_methods ?? []).map((m) => ({
          label: m.wallet?.name ? nm(m.wallet.name) : `${nm(m.method)}${m.card?.brand ? ` ${nm(m.card.brand)}` : ''}`,
          valor: brl(n(m.value)), detalhe: m.liability === 'IFOOD' ? 'pago no app (iFood recebe)' : m.liability === 'MERCHANT' ? 'pago na entrega (loja recebe)' : undefined,
        }))} vazio="Sem forma de pagamento na API." />
        <Linhas titulo="Linha do tempo" itens={tempo} vazio="Sem eventos na API." />
      </Painel>,
    );
    setPasso('fim');
  };

  const buscar = async (texto: string) => {
    const numero = texto.replace(/\D/g, '');
    eu(texto);
    if (!numero) { bot('Digite só o número do pedido.'); return; }
    setPasso('carregando');
    if (!Object.keys(nomes.current).length) nomes.current = await lojasIfood(tenantId);
    await atualizarVendasIfood(tenantId);
    const { data, error } = await supabase.from('fin_ifood_sales')
      .select('sale_id, merchant_id, short_id, sale_created_at, current_status, gross_bag, delivery_fee, service_fee, sale_balance, payment_methods, billing_entries, benefits:raw->benefits, eventos:raw->orderEvents, logistica:raw->delivery->deliveryParameters->>logisticProvider')
      .eq('tenant_id', tenantId).eq('short_id', numero)
      .gte('sale_created_at', `${somaDias(hojeISO(), -30)}T00:00:00-03:00`).order('sale_created_at', { ascending: false }).limit(10);
    if (error) { bot(`Não consegui buscar: ${error.message}`); setPasso('numero'); return; }
    const achados = (data ?? []) as unknown as Pedido[];
    if (!achados.length) { bot(`Não achei o pedido #${numero} nos últimos 30 dias. Confira o número e digite de novo.`); setPasso('numero'); return; }
    if (achados.length === 1) { mostrar(achados[0]); return; }
    setOpcoes(achados);
    bot(`Achei ${achados.length} pedidos #${numero}. Qual deles?`);
    setPasso('escolher');
  };

  return (
    <Roteiro titulo="Pedido do iFood" icone="ri-file-list-3-line" cor="bg-red-50 text-red-600" baloes={baloes}
      carregando={passo === 'carregando'} textoCarregando="Buscando o pedido no iFood…" onFechar={onFechar}>
      {passo === 'numero' && tenantId && <Campo placeholder="Número do pedido" modo="numeric" onEnviar={buscar} />}
      {passo === 'escolher' && opcoes.map((p) => (
        <Opcao key={p.sale_id} onClick={() => { eu(`${dataBR(p.sale_created_at.slice(0, 10))} ${horaBR(p.sale_created_at)}`); mostrar(p); }}
          detalhe={`· ${brl(n(p.gross_bag) + n(p.delivery_fee))}${nomes.current[p.merchant_id] ? ` · ${nomes.current[p.merchant_id]}` : ''}`}>
          {dataBR(p.sale_created_at.slice(0, 10))} {horaBR(p.sale_created_at)}
        </Opcao>
      ))}
      {(passo === 'fim' || !tenantId) && (
        <Fim onFechar={onFechar} acoes={tenantId ? [
          { label: 'Outro pedido', onClick: () => { bot('Qual o número?'); setPasso('numero'); } },
          ...(verTela ? [{ label: 'Abrir iFood no Financeiro', onClick: () => irPara('/financeiro?tab=ifood') }] : []),
        ] : []} />
      )}
    </Roteiro>
  );
}
