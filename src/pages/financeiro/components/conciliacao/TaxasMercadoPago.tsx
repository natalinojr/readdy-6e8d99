import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { formatCurrency } from '@/lib/formatters';
import { todayBrasilia } from '@/lib/dateUtils';
import { PRODUTOS_CARTAO } from './TaxasContratadas';

// Taxa efetiva do Mercado Pago por tipo de cartão e bandeira (fin_mp_taxas).
// Bruto e taxa são os REAIS de cada venda (o MP devolve por pagamento); o período é pela data da venda.

interface Linha { produto: string; bandeira: string; vendas: number; bruto: number; taxa: number }

const PRODUTOS: Record<string, string> = {
  ...PRODUTOS_CARTAO,
  pre_pago: 'Pré-pago',
  pix: 'Pix',
  outro: 'Outros',
};
const ORDEM = ['debito', 'credito_vista', 'credito_2_6', 'credito_7_12', 'pre_pago', 'pix', 'outro'];

function addDaysISO(iso: string, days: number) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d + days);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}
const pct = (taxa: number, bruto: number) => (bruto > 0 ? `${((taxa / bruto) * 100).toFixed(2).replace('.', ',')}%` : '—');
const nomeBandeira = (b: string) => (b ? b.charAt(0).toUpperCase() + b.slice(1) : '—');

export default function TaxasMercadoPago() {
  const { user } = useAuth();
  const hoje = todayBrasilia();
  const [from, setFrom] = useState(addDaysISO(hoje, -29));
  const [to, setTo] = useState(hoje);
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!user?.tenantId || !from || !to) return;
    let vivo = true;
    setLoading(true);
    setErro(null);
    supabase.rpc('fin_mp_taxas', { p_tenant: user.tenantId, p_from: from, p_to: to }).then(({ data, error }) => {
      if (!vivo) return;
      if (error) setErro(error.message);
      setLinhas(((data ?? []) as Array<Record<string, unknown>>).map((x) => ({
        produto: String(x.produto), bandeira: String(x.bandeira ?? ''),
        vendas: Number(x.vendas), bruto: Number(x.bruto), taxa: Number(x.taxa),
      })));
      setLoading(false);
    });
    return () => { vivo = false; };
  }, [user?.tenantId, from, to]);

  const grupos = useMemo(() => {
    const m = new Map<string, Linha[]>();
    for (const l of linhas) m.set(l.produto, [...(m.get(l.produto) ?? []), l]);
    return [...m.entries()]
      .sort((a, b) => ORDEM.indexOf(a[0]) - ORDEM.indexOf(b[0]))
      .map(([produto, ls]) => ({
        produto, linhas: ls,
        vendas: ls.reduce((s, l) => s + l.vendas, 0),
        bruto: ls.reduce((s, l) => s + l.bruto, 0),
        taxa: ls.reduce((s, l) => s + l.taxa, 0),
      }));
  }, [linhas]);

  const total = grupos.reduce((s, g) => ({ vendas: s.vendas + g.vendas, bruto: s.bruto + g.bruto, taxa: s.taxa + g.taxa }), { vendas: 0, bruto: 0, taxa: 0 });

  return (
    <div className="space-y-3">
      <div className="flex items-end gap-2 flex-wrap">
        <div>
          <label className="block text-[11px] text-zinc-500 mb-0.5">Vendas de</label>
          <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)}
            className="border border-zinc-200 rounded-lg px-2 py-1.5 text-xs bg-white" />
        </div>
        <div>
          <label className="block text-[11px] text-zinc-500 mb-0.5">Até</label>
          <input type="date" value={to} min={from} max={hoje} onChange={(e) => setTo(e.target.value)}
            className="border border-zinc-200 rounded-lg px-2 py-1.5 text-xs bg-white" />
        </div>
        {!loading && total.bruto > 0 && (
          <p className="ml-auto text-xs text-zinc-500">
            Taxa média do período: <strong className="text-zinc-800">{pct(total.taxa, total.bruto)}</strong>
            <span className="text-zinc-400"> · {formatCurrency(total.taxa)} de {formatCurrency(total.bruto)}</span>
          </p>
        )}
      </div>

      {erro && <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{erro}</p>}

      {loading ? (
        <div className="flex justify-center py-8"><div className="w-5 h-5 border-2 border-sky-500 border-t-transparent rounded-full animate-spin" /></div>
      ) : grupos.length === 0 ? (
        <p className="text-sm text-zinc-500 text-center py-8">Nenhuma venda do Mercado Pago no período. Busque as vendas na aba "Vendas por dia".</p>
      ) : (
        <div className="border border-zinc-200 rounded-xl overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-zinc-50">
              <tr>
                <th className="text-left px-4 py-2 text-zinc-500 font-semibold">Tipo</th>
                <th className="text-right px-4 py-2 text-zinc-500 font-semibold">Vendas</th>
                <th className="text-right px-4 py-2 text-zinc-500 font-semibold">Bruto</th>
                <th className="text-right px-4 py-2 text-zinc-500 font-semibold">Taxa</th>
                <th className="text-right px-4 py-2 text-zinc-500 font-semibold">Taxa efetiva</th>
              </tr>
            </thead>
            <tbody>
              {grupos.map((g) => (
                <GrupoLinhas key={g.produto} g={g} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-[11px] text-zinc-400 flex items-start gap-1">
        <i className="ri-information-line mt-px" />
        Taxa efetiva = taxa cobrada ÷ valor bruto, calculada venda a venda com o que o Mercado Pago informou. Vendas estornadas e do Mercado Livre ficam de fora.
      </p>
    </div>
  );
}

function GrupoLinhas({ g }: { g: { produto: string; linhas: Linha[]; vendas: number; bruto: number; taxa: number } }) {
  const detalhar = g.linhas.length > 1 || (g.linhas[0]?.bandeira ?? '') !== '';
  return (
    <>
      <tr className="border-t border-zinc-100 bg-white">
        <td className="px-4 py-2.5 font-semibold text-zinc-800">{PRODUTOS[g.produto] ?? g.produto}</td>
        <td className="px-4 py-2.5 text-right text-zinc-700">{g.vendas}</td>
        <td className="px-4 py-2.5 text-right text-zinc-800 font-semibold">{formatCurrency(g.bruto)}</td>
        <td className="px-4 py-2.5 text-right text-red-600 font-semibold">{formatCurrency(g.taxa)}</td>
        <td className="px-4 py-2.5 text-right text-zinc-900 font-bold">{pct(g.taxa, g.bruto)}</td>
      </tr>
      {detalhar && g.linhas.map((l) => (
        <tr key={l.bandeira} className="text-zinc-500">
          <td className="pl-8 pr-4 py-1.5">{nomeBandeira(l.bandeira)}</td>
          <td className="px-4 py-1.5 text-right">{l.vendas}</td>
          <td className="px-4 py-1.5 text-right">{formatCurrency(l.bruto)}</td>
          <td className="px-4 py-1.5 text-right">{formatCurrency(l.taxa)}</td>
          <td className="px-4 py-1.5 text-right font-semibold text-zinc-700">{pct(l.taxa, l.bruto)}</td>
        </tr>
      ))}
    </>
  );
}
