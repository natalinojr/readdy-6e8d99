import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { formatCurrency } from '@/lib/formatters';

// Produtos vendidos no iFood — relatório "Cardápio" do Portal do Parceiro importado na aba iFood
// (fin_ifood_menu_sales). A API Financial não traz os itens dos pedidos; este relatório é a fonte
// por produto (e a base do CMV do iFood quando as fichas técnicas estiverem atualizadas).

interface Linha {
  id: string; merchant_short: string | null; store_name: string | null; period_start: string; period_end: string;
  kind: 'item' | 'complemento'; group_name: string | null; name: string; visits: number | null; orders: number | null;
  conversion: number | null; quantity: number | null; promo_quantity: number | null; total_value: number | null;
}

interface Props { tenantId: string; lojaShort: string | null; onImportar: () => void }

const dBR = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
const n = (v: unknown) => Number(v ?? 0);

export default function IfoodProdutos({ tenantId, lojaShort, onImportar }: Props) {
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [periodo, setPeriodo] = useState('');
  const [busca, setBusca] = useState('');

  useEffect(() => {
    let vivo = true;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase.from('fin_ifood_menu_sales').select('*').eq('tenant_id', tenantId)
        .order('period_end', { ascending: false }).limit(20000);
      if (!vivo) return;
      if (error) setErro(error.message);
      const rows = (data ?? []) as Linha[];
      setLinhas(rows);
      setPeriodo((p) => p || (rows[0] ? `${rows[0].period_start}|${rows[0].period_end}` : ''));
      setLoading(false);
    })();
    return () => { vivo = false; };
  }, [tenantId]);

  const periodos = useMemo(() => [...new Set(linhas.map((l) => `${l.period_start}|${l.period_end}`))], [linhas]);
  const doPeriodo = useMemo(() => linhas.filter((l) => `${l.period_start}|${l.period_end}` === periodo && (!lojaShort || l.merchant_short === lojaShort)), [linhas, periodo, lojaShort]);

  // Soma por nome (com "todas as lojas", o mesmo produto aparece uma vez por loja).
  const agrupa = (kind: Linha['kind']) => {
    const mapa = new Map<string, { name: string; group: string | null; qtd: number; pedidos: number; valor: number; promo: number; visitas: number }>();
    for (const l of doPeriodo.filter((x) => x.kind === kind)) {
      const k = l.name.toLowerCase();
      const g = mapa.get(k) ?? { name: l.name, group: l.group_name, qtd: 0, pedidos: 0, valor: 0, promo: 0, visitas: 0 };
      g.qtd += n(l.quantity); g.pedidos += n(l.orders); g.valor += n(l.total_value); g.promo += n(l.promo_quantity); g.visitas += n(l.visits);
      mapa.set(k, g);
    }
    const q = busca.trim().toLowerCase();
    return [...mapa.values()].filter((g) => !q || g.name.toLowerCase().includes(q)).sort((a, b) => b.valor - a.valor);
  };
  const itens = agrupa('item');
  const comps = agrupa('complemento');
  const totItens = itens.reduce((s, i) => s + i.valor, 0);
  const qtdItens = itens.reduce((s, i) => s + i.qtd, 0);

  if (loading) return <div className="flex items-center justify-center py-12"><div className="w-6 h-6 border-2 border-red-500 border-t-transparent rounded-full animate-spin" /></div>;
  if (erro) return <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">Falha ao carregar: {erro}</div>;

  if (linhas.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-zinc-100 p-8 text-center space-y-2">
        <i className="ri-shopping-basket-2-line text-3xl text-zinc-300" />
        <p className="text-sm font-semibold text-zinc-700">Nenhum relatório de Cardápio importado</p>
        <p className="text-xs text-zinc-500 max-w-md mx-auto">
          No Portal do Parceiro: <strong>Relatórios › Cardápio</strong>, escolha o período e clique em <strong>Exportar relatório</strong>;
          depois <strong>Exportações › Baixar</strong> (página cinza → Ctrl+S). Suba o arquivo aqui — o mesmo botão do relatório de conciliação.
        </p>
        <button onClick={onImportar} className="mt-2 px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-semibold hover:bg-red-700 cursor-pointer">
          <i className="ri-upload-2-line" /> Importar relatório de Cardápio
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-zinc-500">Período:</span>
        <select value={periodo} onChange={(e) => setPeriodo(e.target.value)} className="border border-zinc-200 rounded-lg px-3 py-2 text-sm bg-white">
          {periodos.map((p) => { const [a, b] = p.split('|'); return <option key={p} value={p}>{dBR(a)} a {dBR(b)}</option>; })}
        </select>
        <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar produto..."
          className="border border-zinc-200 rounded-lg px-3 py-2 text-sm bg-white min-w-[200px]" />
        <div className="flex-1" />
        <button onClick={onImportar} className="px-3 py-2 border border-zinc-200 rounded-lg text-sm font-semibold text-zinc-700 hover:bg-zinc-50 cursor-pointer">
          <i className="ri-upload-2-line" /> Importar outro período
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <div className="bg-white rounded-2xl border border-zinc-100 p-4"><p className="text-xs text-zinc-500">Itens vendidos</p><p className="text-xl font-bold text-zinc-900 mt-1">{qtdItens.toLocaleString('pt-BR')}</p><p className="text-[11px] text-zinc-400">{itens.length} produto(s) diferente(s)</p></div>
        <div className="bg-white rounded-2xl border border-zinc-100 p-4"><p className="text-xs text-zinc-500">Valor dos itens</p><p className="text-xl font-bold text-zinc-900 mt-1">{formatCurrency(totItens)}</p><p className="text-[11px] text-zinc-400">preço médio {formatCurrency(qtdItens ? totItens / qtdItens : 0)}</p></div>
        <div className="bg-white rounded-2xl border border-zinc-100 p-4"><p className="text-xs text-zinc-500">Complementos</p><p className="text-xl font-bold text-zinc-900 mt-1">{comps.reduce((s, c) => s + c.qtd, 0).toLocaleString('pt-BR')}</p><p className="text-[11px] text-zinc-400">{formatCurrency(comps.reduce((s, c) => s + c.valor, 0))} cobrados à parte</p></div>
      </div>

      <div className="bg-white rounded-2xl border border-zinc-100 overflow-hidden">
        <div className="px-4 py-3 border-b border-zinc-100">
          <p className="text-sm font-semibold text-zinc-800">Produtos</p>
          <p className="text-xs text-zinc-500">Quantidade e valor vendidos no iFood no período (valor com as promoções aplicadas, como o iFood informa).</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]">
            <thead className="text-[11px] uppercase tracking-wide text-zinc-400 border-b border-zinc-100">
              <tr><th className="text-left px-3 py-2">Produto</th><th className="text-right px-3 py-2">Qtd.</th><th className="text-right px-3 py-2">Pedidos</th><th className="text-right px-3 py-2">Valor</th><th className="text-right px-3 py-2">Preço médio</th><th className="text-right px-3 py-2">% do valor</th><th className="text-right px-3 py-2">Com promoção</th><th className="text-right px-3 py-2">Visitas</th></tr>
            </thead>
            <tbody>
              {itens.map((i) => (
                <tr key={i.name} className="border-t border-zinc-100">
                  <td className="px-3 py-2">{i.name}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{i.qtd.toLocaleString('pt-BR')}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-zinc-500">{i.pedidos.toLocaleString('pt-BR')}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(i.valor)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-zinc-500">{formatCurrency(i.qtd ? i.valor / i.qtd : 0)}</td>
                  <td className="px-3 py-2 text-right text-xs text-zinc-500">{totItens ? ((i.valor / totItens) * 100).toFixed(1) : '0.0'}%</td>
                  <td className="px-3 py-2 text-right text-xs text-amber-700">{i.promo ? i.promo.toLocaleString('pt-BR') : '—'}</td>
                  <td className="px-3 py-2 text-right text-xs text-zinc-400">{i.visitas ? i.visitas.toLocaleString('pt-BR') : '—'}</td>
                </tr>
              ))}
              {itens.length === 0 && <tr><td colSpan={8} className="px-3 py-4 text-center text-xs text-zinc-400">Nenhum produto {busca ? 'com esse nome ' : ''}neste período.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-zinc-100 overflow-hidden">
        <div className="px-4 py-3 border-b border-zinc-100">
          <p className="text-sm font-semibold text-zinc-800">Complementos</p>
          <p className="text-xs text-zinc-500">Escolhas dentro dos produtos (sabor do burrito no combo, bebida, adicionais). Valor R$ 0,00 = já incluso no preço do produto.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[560px]">
            <thead className="text-[11px] uppercase tracking-wide text-zinc-400 border-b border-zinc-100">
              <tr><th className="text-left px-3 py-2">Complemento</th><th className="text-left px-3 py-2">Tipo</th><th className="text-right px-3 py-2">Qtd.</th><th className="text-right px-3 py-2">Pedidos</th><th className="text-right px-3 py-2">Valor</th></tr>
            </thead>
            <tbody>
              {comps.map((c) => (
                <tr key={c.name} className="border-t border-zinc-100">
                  <td className="px-3 py-2">{c.name}</td>
                  <td className="px-3 py-2 text-xs text-zinc-500">{c.group ?? '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{c.qtd.toLocaleString('pt-BR')}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-zinc-500">{c.pedidos.toLocaleString('pt-BR')}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{c.valor ? formatCurrency(c.valor) : <span className="text-zinc-400">incluso</span>}</td>
                </tr>
              ))}
              {comps.length === 0 && <tr><td colSpan={5} className="px-3 py-4 text-center text-xs text-zinc-400">Nenhum complemento neste período.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
