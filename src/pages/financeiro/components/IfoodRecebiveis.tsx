import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { formatCurrency } from '@/lib/formatters';
import { todayBrasilia } from '@/lib/dateUtils';

// Repasses do iFood ainda não pagos (relatório de conciliação importado — aba iFood).
// Só leitura: NÃO viram fin_receivable_installments, porque dar baixa numa parcela
// lança auto_sale no caixa e a venda do iFood já entra pelo razão (ifood_sale) na
// data do repasse — seria receita em dobro.

interface Row { data_repasse: string; esperado: number; depositos: number }

export default function IfoodRecebiveis() {
  const { user } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);

  useEffect(() => {
    if (!user?.tenantId) return;
    const hoje = todayBrasilia();
    const ate = new Date(Date.now() + 120 * 86400_000).toISOString().slice(0, 10);
    supabase.rpc('fin_ifood_repasses', { p_tenant: user.tenantId, p_from: hoje, p_to: ate }).then(({ data }) => {
      setRows(((data ?? []) as Row[]).map((r) => ({ ...r, esperado: Number(r.esperado) })));
    });
  }, [user?.tenantId]);

  if (rows.length === 0) return null;
  const total = rows.reduce((s, r) => s + r.esperado, 0);

  return (
    <div className="bg-white rounded-xl border border-red-100 p-4">
      <div className="flex items-center gap-3 mb-3">
        <div className="w-10 h-10 flex items-center justify-center rounded-lg bg-red-50">
          <i className="ri-restaurant-2-line text-red-600 text-lg" />
        </div>
        <div className="flex-1">
          <p className="text-xs text-zinc-500">Repasses iFood a receber</p>
          <p className="text-base font-bold text-red-600">{formatCurrency(total)}</p>
        </div>
        <p className="text-[11px] text-zinc-400 max-w-xs text-right">Pelo relatório do iFood importado. Entram sozinhos em Receitas e no caixa na data de cada repasse.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {rows.map((r) => (
          <span key={r.data_repasse} className="text-xs bg-red-50 text-red-800 px-2.5 py-1 rounded-full">
            {r.data_repasse.slice(8, 10)}/{r.data_repasse.slice(5, 7)} — <strong>{formatCurrency(r.esperado)}</strong>
          </span>
        ))}
      </div>
    </div>
  );
}
