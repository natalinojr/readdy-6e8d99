import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { usePaymentMethods } from '@/hooks/usePaymentMethods';
import { formatCurrency } from '@/lib/formatters';

// Vendas por forma de pagamento (Financeiro › Receitas).
// Mesma fonte do Relatórios › Visão Geral: fn_get_sales_report.by_payment (pagamentos
// de pedidos pagos, não cancelados, sem treino, pela data do pagamento). A taxa e o
// prazo vêm do cadastro da forma (Configurações › Formas de pagamento) — a taxa aqui é
// ESTIMADA; a real do cartão está no DRE (livro-razão) e na Conciliação.

interface ByPayment { payment_method: string; payment_type: string; total: number; count: number }

const TIPO_LABEL: Record<string, string> = {
  credit_card: 'Crédito',
  debit_card: 'Débito',
  meal_voucher: 'Voucher',
  pix: 'Pix',
  cash: 'Dinheiro',
  other: 'Outros',
};
const TIPO_ORDEM = ['credit_card', 'debit_card', 'meal_voucher', 'pix', 'cash', 'other'];
const TIPO_COR: Record<string, string> = {
  credit_card: '#f59e0b',
  debit_card: '#f97316',
  meal_voucher: '#8b5cf6',
  pix: '#06b6d4',
  cash: '#10b981',
  other: '#94a3b8',
};
const TIPO_ICONE: Record<string, string> = {
  credit_card: 'ri-bank-card-line',
  debit_card: 'ri-bank-card-2-line',
  meal_voucher: 'ri-coupon-line',
  pix: 'ri-qr-code-line',
  cash: 'ri-money-dollar-circle-line',
  other: 'ri-wallet-line',
};
// tipo do cadastro (usePaymentMethods, em pt) → tipo do banco
const TIPO_PT_DB: Record<string, string> = { credito: 'credit_card', debito: 'debit_card', pix: 'pix', dinheiro: 'cash', vale: 'meal_voucher' };

const tipoDe = (t: string) => (TIPO_LABEL[t] ? t : 'other');
const norm = (s: string) => s.trim().toLowerCase();
const prazoLabel = (d: number | null) => (d == null ? '—' : d === 0 ? 'na hora' : `D+${d}`);

interface Linha {
  nome: string; tipo: string; total: number; count: number;
  taxaPct: number | null; taxaValor: number; prazo: number | null;
}

export default function FormasPagamentoPanel({ startDate, endDate }: { startDate: string; endDate: string }) {
  const { user } = useAuth();
  const tenantId = user?.tenantId;
  const { formas } = usePaymentMethods();
  const [rows, setRows] = useState<ByPayment[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [aberto, setAberto] = useState<string | null>(null);

  useEffect(() => {
    if (!tenantId || !startDate || !endDate) return;
    let vivo = true;
    setLoading(true);
    setError('');
    supabase.rpc('fn_get_sales_report', {
      p_tenant_id: tenantId,
      p_date_from: `${startDate}T00:00:00-03:00`,
      p_date_to: `${endDate}T23:59:59.999-03:00`,
      p_session_id: null,
    }).then(({ data, error: err }) => {
      if (!vivo) return;
      if (err) { setError(err.message); setRows([]); }
      else setRows(((data ?? {}) as { by_payment?: ByPayment[] }).by_payment ?? []);
      setLoading(false);
    });
    return () => { vivo = false; };
  }, [tenantId, startDate, endDate]);

  const linhas: Linha[] = useMemo(() => rows.map((r) => {
    const tipo = tipoDe(r.payment_type);
    const cad = formas.find((f) => norm(f.nome) === norm(r.payment_method) && (TIPO_PT_DB[f.tipo] ?? 'other') === tipo)
      ?? formas.find((f) => norm(f.nome) === norm(r.payment_method));
    const total = Number(r.total ?? 0);
    const taxaPct = cad ? cad.taxa : null;
    return {
      nome: r.payment_method, tipo, total, count: Number(r.count ?? 0),
      taxaPct, taxaValor: taxaPct ? Math.round(total * taxaPct) / 100 : 0,
      prazo: cad ? cad.prazoRecebimento : null,
    };
  }), [rows, formas]);

  const grupos = useMemo(() => {
    const m = new Map<string, { tipo: string; total: number; count: number; taxa: number; linhas: Linha[] }>();
    for (const l of linhas) {
      const g = m.get(l.tipo) ?? { tipo: l.tipo, total: 0, count: 0, taxa: 0, linhas: [] };
      g.total += l.total; g.count += l.count; g.taxa += l.taxaValor; g.linhas.push(l);
      m.set(l.tipo, g);
    }
    return [...m.values()]
      .map((g) => ({ ...g, linhas: g.linhas.sort((a, b) => b.total - a.total) }))
      .sort((a, b) => TIPO_ORDEM.indexOf(a.tipo) - TIPO_ORDEM.indexOf(b.tipo));
  }, [linhas]);

  const total = grupos.reduce((s, g) => s + g.total, 0);
  const totalTaxa = grupos.reduce((s, g) => s + g.taxa, 0);

  return (
    <div className="bg-white rounded-xl border border-zinc-200 p-4 md:p-5">
      <div className="flex items-start justify-between gap-3 mb-4 flex-wrap">
        <div>
          <h3 className="text-sm font-semibold text-zinc-800">Vendas por forma de pagamento</h3>
          <p className="text-xs text-zinc-400 mt-0.5">Pedidos pagos no período, pela data do pagamento. Taxa estimada pelo cadastro de cada forma.</p>
        </div>
        {total > 0 && (
          <div className="text-right">
            <p className="text-sm font-bold text-zinc-900">{formatCurrency(total)}</p>
            <p className="text-[11px] text-zinc-400">taxas ≈ {formatCurrency(totalTaxa)} · líquido ≈ {formatCurrency(total - totalTaxa)}</p>
          </div>
        )}
      </div>

      {error ? (
        <div className="flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
          <i className="ri-error-warning-line mt-0.5" />
          <span>Não foi possível carregar as formas de pagamento (os valores não estão zerados por falta de vendas). Detalhe: {error}</span>
        </div>
      ) : loading && rows.length === 0 ? (
        <div className="flex justify-center py-8">
          <div className="w-5 h-5 border-2 border-zinc-300 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : grupos.length === 0 ? (
        <p className="text-xs text-zinc-400 py-6 text-center">Nenhum pagamento de pedido no período.</p>
      ) : (
        <div className="space-y-1">
          {grupos.map((g) => {
            const pct = total > 0 ? (g.total / total) * 100 : 0;
            const expandivel = g.linhas.length > 1;
            const prazos = [...new Set(g.linhas.map((l) => l.prazo))];
            const taxas = [...new Set(g.linhas.map((l) => l.taxaPct))];
            return (
              <div key={g.tipo} className="rounded-lg">
                <button
                  type="button"
                  onClick={() => expandivel && setAberto(aberto === g.tipo ? null : g.tipo)}
                  className={`w-full text-left px-2 py-2 rounded-lg ${expandivel ? 'hover:bg-zinc-50 cursor-pointer' : 'cursor-default'}`}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 flex-shrink-0 flex items-center justify-center rounded-lg" style={{ backgroundColor: `${TIPO_COR[g.tipo]}1a`, color: TIPO_COR[g.tipo] }}>
                      <i className={TIPO_ICONE[g.tipo]} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold text-zinc-800 flex items-center gap-1">
                          {TIPO_LABEL[g.tipo]}
                          {expandivel && <i className={`ri-arrow-${aberto === g.tipo ? 'up' : 'down'}-s-line text-zinc-400`} />}
                        </span>
                        <span className="text-sm font-bold text-zinc-900">{formatCurrency(g.total)}</span>
                      </div>
                      <div className="w-full bg-zinc-100 rounded-full h-1.5 my-1">
                        <div className="h-1.5 rounded-full" style={{ width: `${pct}%`, backgroundColor: TIPO_COR[g.tipo] }} />
                      </div>
                      <div className="flex items-center justify-between gap-2 text-[11px] text-zinc-500 flex-wrap">
                        <span>{pct.toFixed(1)}% · {g.count} pagamento(s)</span>
                        <span>
                          taxa {taxas.length === 1 ? (taxas[0] == null ? '—' : `${taxas[0]}%`) : 'várias'}
                          {g.taxa > 0 && <> ≈ {formatCurrency(g.taxa)}</>}
                          {' · '}cai {prazos.length === 1 ? prazoLabel(prazos[0]) : 'em prazos diferentes'}
                        </span>
                      </div>
                    </div>
                  </div>
                </button>
                {expandivel && aberto === g.tipo && (
                  <div className="ml-11 mr-2 mb-2 border-l border-zinc-100 pl-3 space-y-1.5">
                    {g.linhas.map((l) => (
                      <div key={l.nome} className="flex items-center justify-between gap-2 text-xs">
                        <span className="text-zinc-700 truncate">{l.nome} <span className="text-zinc-400">· {l.count}</span></span>
                        <span className="text-zinc-500 whitespace-nowrap">
                          {l.taxaPct == null ? 'sem cadastro' : `${l.taxaPct}%`} · {prazoLabel(l.prazo)} · <strong className="text-zinc-800">{formatCurrency(l.total)}</strong>
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          <p className="text-[11px] text-zinc-400 pt-2">
            iFood pago no app não entra aqui (vem pelos repasses, em Financeiro › iFood). A taxa real do cartão, que vai para o DRE, vem da maquininha/Conciliação.
          </p>
        </div>
      )}
    </div>
  );
}
