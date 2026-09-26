// Ação rápida (só leitura): tempos da operação no iFood — aceite, preparo, espera do entregador,
// rota e total, em MEDIANA (um pedido travado não distorce), comparados com os 7 dias anteriores.
// Mesmas contas do dashboard de Relatórios › iFood (montarOperacao/mediana, eventos da API Sales).
// Lista os pedidos mais demorados do período para a loja olhar o que houve.
import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useAcessoAcoes, rotaLiberada } from '../acesso';
import { montarOperacao, mediana, type OperacaoPedido } from '@/lib/ifoodDashboard';
import { Roteiro, useRoteiro, Opcao, Fim, dataBR, horaBR, hojeISO, somaDias, type AcaoProps } from '../kit';
import { Painel, Kpis, Linhas, type Status } from '../painel';
import { atualizarVendasIfood } from './comum';

interface Linha { merchant_id: string; short_id: string | null; sale_created_at: string; current_status: string | null; events: { fullCode?: string; createdAt?: string }[] | null }
const fmt = (m: number | null) => (m == null ? '—' : m < 1 ? '< 1 min' : `${Math.round(m)} min`);

async function lerPeriodo(tenantId: string, de: string, ate: string): Promise<Linha[] | null> {
  const linhas: Linha[] = [];
  for (let i = 0; ; i += 1000) {
    const { data, error } = await supabase.from('fin_ifood_sales')
      .select('merchant_id, short_id, sale_created_at, current_status, events:raw->orderEvents')
      .eq('tenant_id', tenantId).gte('sale_created_at', `${de}T00:00:00-03:00`).lte('sale_created_at', `${ate}T23:59:59.999-03:00`)
      .order('sale_created_at').range(i, i + 999);
    if (error) return null;
    linhas.push(...((data ?? []) as unknown as Linha[]));
    if ((data ?? []).length < 1000) return linhas;
  }
}

export default function TemposIfood({ onFechar, irPara }: AcaoProps) {
  const { user } = useAuth();
  const tenantId = user?.tenantId ?? '';
  const verTela = rotaLiberada('/relatorios', useAcessoAcoes());
  const { baloes, bot, eu, painel } = useRoteiro();
  const [passo, setPasso] = useState<'periodo' | 'carregando' | 'fim'>('periodo');
  const iniciou = useRef(false);

  useEffect(() => {
    if (iniciou.current) return;
    iniciou.current = true;
    bot(tenantId ? `*Loja: ${user?.loja || 'loja ativa'}*\nTempos do iFood de qual período?` : 'Nenhuma loja ativa.');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const carregar = async (rotulo: string, de: string, ate: string) => {
    eu(rotulo);
    setPasso('carregando');
    if (ate >= somaDias(hojeISO(), -1)) await atualizarVendasIfood(tenantId);
    const dias = Math.round((Date.parse(`${ate}T12:00:00Z`) - Date.parse(`${de}T12:00:00Z`)) / 86400000) + 1;
    const [linhas, base] = await Promise.all([
      lerPeriodo(tenantId, de, ate),
      lerPeriodo(tenantId, somaDias(de, -Math.max(7, dias)), somaDias(de, -1)),
    ]);
    if (!linhas) { bot('Não consegui ler os pedidos do iFood.'); setPasso('fim'); return; }
    const op = montarOperacao(linhas);
    const ok = op.map((o, i) => ({ o, l: linhas[i] })).filter((x) => !x.o.cancelado);
    const periodo = de === ate ? dataBR(de) : `${dataBR(de).slice(0, 5)} a ${dataBR(ate)}`;
    if (!ok.length) { bot(`Nenhum pedido concluído no iFood em ${periodo}.`); setPasso('fim'); return; }
    const opBase = base ? montarOperacao(base).filter((o) => !o.cancelado) : [];
    const med = (lista: OperacaoPedido[], k: keyof OperacaoPedido) => mediana(lista.map((o) => o[k] as number | null));
    const atual = ok.map((x) => x.o);
    // Status: pior que a base em 20% (e 2+ min) = alerta.
    const st = (k: keyof OperacaoPedido): Status => {
      const a = med(atual, k), b = med(opBase, k);
      if (a == null || b == null) return 'neutro';
      return a > b * 1.2 && a - b >= 2 ? 'alerta' : a < b * 0.9 ? 'ok' : 'neutro';
    };
    const comBase = (k: keyof OperacaoPedido) => { const b = med(opBase, k); return b == null ? undefined : `antes: ${fmt(b)}`; };
    const esperando = atual.filter((o) => (o.esperaEntregadorMin ?? 0) > 10).length;
    const lentos = [...ok].filter((x) => x.o.totalMin != null).sort((a, b) => (b.o.totalMin ?? 0) - (a.o.totalMin ?? 0)).slice(0, 5);
    painel(
      <Painel titulo={`Tempos do iFood · ${periodo}`} subtitulo={user?.loja || 'Loja ativa'}
        rodape={`Medianas dos ${ok.length} pedidos concluídos (pedido travado não distorce). "Antes" = ${Math.max(7, dias)} dias anteriores. Pelos eventos da API do iFood — mesma conta de Relatórios › iFood.`}>
        <Kpis
          principal={{ label: 'Do pedido à entrega', valor: fmt(med(atual, 'totalMin')), extra: comBase('totalMin') ? <span className="text-xs text-zinc-600">{comBase('totalMin')}</span> : undefined }}
          outros={[{ label: 'Preparo', valor: fmt(med(atual, 'preparoMin')) }, { label: 'Aceite', valor: fmt(med(atual, 'aceiteMin')) }]}
        />
        <Linhas titulo="Cada etapa (mediana)" itens={[
          { label: 'Aceite (chegou → loja aceitou)', valor: fmt(med(atual, 'aceiteMin')), detalhe: comBase('aceiteMin'), status: st('aceiteMin') },
          { label: 'Preparo (aceitou → pronto)', valor: fmt(med(atual, 'preparoMin')), detalhe: comBase('preparoMin'), status: st('preparoMin') },
          { label: 'Pedido pronto esperando o entregador', valor: fmt(med(atual, 'esperaEntregadorMin')), detalhe: comBase('esperaEntregadorMin'), status: st('esperaEntregadorMin') },
          { label: 'Entregador esperando o pedido', valor: fmt(med(atual, 'entregadorEsperouMin')), detalhe: comBase('entregadorEsperouMin'), status: st('entregadorEsperouMin') },
          { label: 'Rota (coletou → cliente)', valor: fmt(med(atual, 'rotaMin')), detalhe: comBase('rotaMin'), status: st('rotaMin') },
        ]} />
        {esperando > 0 && (
          <p className="text-xs font-semibold text-amber-700 bg-amber-50 rounded-xl px-3 py-2">⚠️ {esperando} pedido{esperando === 1 ? '' : 's'} pronto{esperando === 1 ? '' : 's'} esperou mais de 10 min pelo entregador.</p>
        )}
        <Linhas titulo="Mais demorados" itens={lentos.map(({ o, l }) => ({
          label: `#${l.short_id ?? '—'} · ${dataBR(l.sale_created_at.slice(0, 10)).slice(0, 5)} ${horaBR(l.sale_created_at)}`,
          valor: fmt(o.totalMin), detalhe: `preparo ${fmt(o.preparoMin)} · esperou entregador ${fmt(o.esperaEntregadorMin)} · rota ${fmt(o.rotaMin)}`,
          status: 'alerta' as const,
        }))} />
      </Painel>,
    );
    setPasso('fim');
  };

  const hoje = hojeISO();
  return (
    <Roteiro titulo="Tempos do iFood" icone="ri-timer-line" cor="bg-red-50 text-red-600" baloes={baloes}
      carregando={passo === 'carregando'} textoCarregando="Medindo os tempos…" onFechar={onFechar}>
      {passo === 'periodo' && tenantId && (
        <>
          <Opcao onClick={() => carregar('Hoje', hoje, hoje)}>Hoje</Opcao>
          <Opcao onClick={() => carregar('Ontem', somaDias(hoje, -1), somaDias(hoje, -1))}>Ontem</Opcao>
          <Opcao onClick={() => carregar('Últimos 7 dias', somaDias(hoje, -6), hoje)}>Últimos 7 dias</Opcao>
        </>
      )}
      {(passo === 'fim' || !tenantId) && (
        <Fim onFechar={onFechar} acoes={tenantId ? [
          { label: 'Outro período', onClick: () => { bot('Qual período?'); setPasso('periodo'); } },
          ...(verTela ? [{ label: 'Abrir Relatórios', onClick: () => irPara('/relatorios') }] : []),
        ] : []} />
      )}
    </Roteiro>
  );
}
