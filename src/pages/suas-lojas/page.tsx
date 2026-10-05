// "Suas lojas" (2026-10-05, pedido do dono): o que abre ao tocar em "Loja" no seletor Loja · Tarefas · Contratação ·
// Notas da casca nova, para quem tem 2+ lojas. Só mostra, não escolhe loja (trocar de loja = o nome da loja no topo):
// o total de hoje das lojas juntas, um cartão por loja (faturamento, variação, pedidos, tíquete, iFood, meta, caixa,
// o que está em aberto, o que precisa de você), o gráfico ao longo do dia e de onde vem a venda.
// Números = os do Comparar lojas (useLojasComparar / fn_lojas_comparar, no dia da loja). Quem tem 1 loja vai ao começo.
import { useMemo } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useLojasComparar } from '@/hooks/useLojasComparar';
import { usePendenciasHoje } from '@/pages/hoje/hojeStore';
import { corDaLoja, ordenarPorFaturamento, rotuloComparacao, totalLojas, type LojaComparada } from '@/lib/lojasComparar';
import { btn } from '@/components/kit';
import GraficoLojas, { CanaisLojas } from '@/pages/lojas/components/GraficoLojas';
import { AgoraTexto, AoVivo, brl, EtiquetaDia, MetaBarra, MetaTexto, PontoLoja, Variacao } from '@/pages/lojas/components/ui';

function Numero({ rotulo, valor, dica }: { rotulo: string; valor: string; dica?: string }) {
  return (
    <div className="bg-[#FAF7F2] rounded-xl px-2.5 py-2 min-w-0" title={dica}>
      <div className="text-[10.5px] font-bold uppercase tracking-[.06em] text-[#9A9086]">{rotulo}</div>
      <div className="text-[14px] font-extrabold text-[#1F1A14] tabular-nums truncate">{valor}</div>
    </div>
  );
}

function NumeroEscuro({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="bg-white/[.07] rounded-xl px-3 py-2 min-w-0">
      <div className="text-[10.5px] font-bold uppercase tracking-[.06em] text-white/50">{rotulo}</div>
      <div className="text-[15px] font-extrabold tabular-nums truncate">{valor}</div>
    </div>
  );
}

function CartaoLoja({ l, cor, precisam }: { l: LojaComparada; cor: string; precisam: number }) {
  const ifoodPct = l.atual.faturamento > 0 ? (l.atual.ifood / l.atual.faturamento) * 100 : 0;
  const faltam = l.meta ? l.meta - l.atual.faturamento : 0;
  return (
    <div className="bg-white border border-[#EEE6DA] rounded-[18px] p-4 min-w-0">
      <div className="flex items-center gap-x-2 gap-y-1 flex-wrap min-w-0">
        <PontoLoja cor={cor} />
        <b className="text-[15px] font-extrabold text-[#1F1A14] leading-tight">{l.nome}</b>
        <EtiquetaDia loja={l} />
        {precisam > 0 && (
          <span className="ml-auto text-[11px] font-bold rounded-full px-2 py-0.5 bg-red-50 text-red-600 whitespace-nowrap">
            {precisam} {precisam === 1 ? 'precisa' : 'precisam'} de você
          </span>
        )}
      </div>
      <div className="text-[11.5px] text-[#5B5248] mt-1 leading-snug"><AgoraTexto loja={l} /></div>

      <div className="flex items-end gap-2 flex-wrap mt-3">
        <span className="text-[26px] leading-none font-black tracking-tight tabular-nums text-[#1F1A14]">{brl(l.atual.faturamento)}</span>
        <Variacao pct={l.variacao} />
        {l.ifoodCarregando && <span className="text-[10.5px] text-[#9A9086]">iFood chegando…</span>}
      </div>
      <div className="text-[11px] text-[#9A9086] mt-1">{rotuloComparacao('hoje', l)}: {brl(l.anterior.faturamento, false)}</div>

      <div className="grid grid-cols-3 gap-2 mt-3">
        <Numero rotulo="Pedidos" valor={String(l.atual.pedidos)} />
        <Numero rotulo="Tíquete" valor={l.atual.pedidos > 0 ? brl(l.atual.ticket, false) : '—'} />
        <Numero rotulo="iFood" valor={l.temIfood ? `${ifoodPct.toFixed(0)}%` : '—'}
          dica={l.temIfood ? `${l.atual.ifoodPedidos} pedidos · ${brl(l.atual.ifood, false)}` : 'sem iFood'} />
      </div>

      <MetaBarra loja={l} cor={cor} />
      <div className="flex items-center justify-between gap-2 text-[11px] text-[#5B5248] mt-1">
        <MetaTexto loja={l} />
        {l.meta && faltam > 0 && <span className="tabular-nums">faltam {brl(faltam, false)} de {brl(l.meta, false)}</span>}
      </div>
    </div>
  );
}

function SuasLojas() {
  const navigate = useNavigate();
  const { lojas, carregando } = useLojasComparar('hoje', true, 2);
  const { itens } = usePendenciasHoje();

  const cores = useMemo(() => Object.fromEntries(lojas.map((l, i) => [l.tenantId, corDaLoja(i)])), [lojas]);
  // As mesmas do "Suas lojas agora": sem as escondidas no Comparar e as sem venda há 30 dias.
  const mostradas = ordenarPorFaturamento(lojas.filter((l) => !l.oculta && !l.parada));
  const foraDaConta = lojas.length - mostradas.length;
  const total = totalLojas(mostradas);
  const precisam = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of itens ?? []) if (i.bloco === 'agora') m.set(i.tenantId, (m.get(i.tenantId) ?? 0) + 1);
    return m;
  }, [itens]);
  const metaTotal = mostradas.reduce((s, l) => s + (l.meta ?? 0), 0);
  const fatComMeta = mostradas.reduce((s, l) => s + (l.meta ? l.atual.faturamento : 0), 0);
  const ifoodTotal = mostradas.reduce((s, l) => s + l.atual.ifood, 0);
  const emAberto = mostradas.reduce((s, l) => s + l.agora.em_aberto.pedidos, 0);

  if (carregando) {
    return <div className="flex justify-center py-20"><div className="w-7 h-7 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" /></div>;
  }
  // Vê o Dashboard em menos de 2 lojas: não há o que somar.
  if (lojas.length < 2) return <Navigate to="/" replace />;

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center gap-2">
        <h1 className="text-[22px] md:text-[26px] font-black leading-tight text-[#1F1A14]">Suas lojas</h1>
        <AoVivo />
      </div>
      <p className="text-[13px] text-[#5B5248] mt-1 mb-4">Hoje, no dia de cada loja. Para trabalhar em outra loja, toque no nome da loja lá em cima.</p>

      {/* Total das lojas juntas */}
      <div className="rounded-[20px] bg-[#1F1A14] text-white p-4 md:p-5 mb-4">
        <div className="text-[11px] font-extrabold uppercase tracking-[.1em] text-white/60">
          {mostradas.length === 1 ? 'Sua loja hoje' : `Suas ${mostradas.length} lojas juntas hoje`}
        </div>
        <div className="flex items-end gap-2 flex-wrap mt-1.5">
          <span className="text-[32px] md:text-[38px] leading-none font-black tracking-tight tabular-nums">{brl(total.faturamento)}</span>
          <Variacao pct={total.variacao} escuro titulo={total.variacao === null ? 'Uma das lojas não tem base de comparação' : undefined} />
        </div>
        {mostradas[0] && <div className="text-[11.5px] text-white/50 mt-1">{rotuloComparacao('hoje', mostradas[0])}</div>}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-4">
          <NumeroEscuro rotulo="Pedidos" valor={String(total.pedidos)} />
          <NumeroEscuro rotulo="Tíquete médio" valor={total.pedidos > 0 ? brl(total.ticket, false) : '—'} />
          <NumeroEscuro rotulo="iFood" valor={total.faturamento > 0 ? `${((ifoodTotal / total.faturamento) * 100).toFixed(0)}%` : '—'} />
          <NumeroEscuro rotulo="Em aberto agora" valor={`${emAberto} ${emAberto === 1 ? 'pedido' : 'pedidos'}`} />
        </div>
        {metaTotal > 0 && (
          <div className="mt-4">
            <div className="h-2 bg-white/10 rounded-full overflow-hidden">
              <div className="h-full rounded-full bg-amber-400" style={{ width: `${Math.min(100, (fatComMeta / metaTotal) * 100)}%` }} />
            </div>
            <div className="text-[11.5px] text-white/60 mt-1 tabular-nums">
              {((fatComMeta / metaTotal) * 100).toFixed(0)}% da meta do dia (lojas com meta: {brl(fatComMeta, false)} de {brl(metaTotal, false)})
            </div>
          </div>
        )}
      </div>

      {/* Uma por loja */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
        {mostradas.map((l) => <CartaoLoja key={l.tenantId} l={l} cor={cores[l.tenantId]} precisam={precisam.get(l.tenantId) ?? 0} />)}
      </div>
      {foraDaConta > 0 && (
        <p className="text-[11.5px] text-[#9A9086] -mt-2 mb-4">
          {foraDaConta} {foraDaConta === 1 ? 'loja fica' : 'lojas ficam'} de fora (escondidas no Comparar lojas ou sem venda há 30 dias).
        </p>
      )}

      {mostradas.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-[3fr_2fr] gap-3 mb-4">
          <GraficoLojas lojas={mostradas} cores={cores} periodo="hoje" />
          <CanaisLojas lojas={mostradas} cores={cores} />
        </div>
      )}

      <button type="button" onClick={() => navigate('/lojas')} className={`${btn('out')} w-full`}>
        <i className="ri-bar-chart-grouped-line" />Comparar as lojas (ontem, 7 dias, mês)
      </button>
    </div>
  );
}

export default function SuasLojasPage() {
  const { canSwitchTenant } = useAuth();
  if (!canSwitchTenant) return <Navigate to="/" replace />;
  return <SuasLojas />;
}
