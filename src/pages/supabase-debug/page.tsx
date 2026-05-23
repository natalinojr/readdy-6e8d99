import { useState } from 'react';
import { supabase } from '@/lib/supabase';

interface CheckResult {
  label: string;
  status: 'ok' | 'error' | 'warning' | 'loading';
  detail?: string;
}

const TABLES_TO_CHECK = [
  'order_discounts',
  'refunds',
  'table_session_participants',
  'order_item_assignments',
  'ingredient_batches',
  'combo_ingredients',
  'table_reservations',
  'promotion_rules',
  'vouchers',
  'voucher_transactions',
  'loyalty_transactions',
];

const CRITICAL_COLUMNS: { table: string; column: string }[] = [
  { table: 'customers', column: 'loyalty_points' },
  { table: 'customers', column: 'loyalty_tier' },
  { table: 'payments', column: 'voucher_id' },
  { table: 'orders', column: 'discount_amount' },
];

const SEED_IDS = [
  { entity: 'Cliente Staging', table: 'customers', id: 'c0000000-0000-0000-0000-000000000001' },
  { entity: 'Lote Ingrediente', table: 'ingredient_batches', id: 'e0000000-0000-0000-0000-000000000001' },
  { entity: 'Voucher GC-STAGING-TEST', table: 'vouchers', id: 'f0000000-0000-0000-0000-000000000001' },
  { entity: 'Reserva Mesa 20', table: 'table_reservations', id: 'a2000000-0000-0000-0000-000000000001' },
  { entity: 'Happy Hour Promo', table: 'promotion_rules', id: 'b2000000-0000-0000-0000-000000000001' },
];

function StatusBadge({ status }: { status: CheckResult['status'] }) {
  const map = {
    ok: 'bg-green-100 text-green-700',
    error: 'bg-red-100 text-red-700',
    warning: 'bg-yellow-100 text-yellow-700',
    loading: 'bg-gray-100 text-gray-500',
  };
  const labels = { ok: 'OK', error: 'ERRO', warning: 'AVISO', loading: '...' };
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-semibold ${map[status]}`}>
      {labels[status]}
    </span>
  );
}

export default function SupabaseDebugPage() {
  const [results, setResults] = useState<CheckResult[]>([]);
  const [running, setRunning] = useState(false);

  async function runChecks() {
    setRunning(true);
    const out: CheckResult[] = [];

    // 1. Verificar tabelas novas
    for (const table of TABLES_TO_CHECK) {
      try {
        const { error } = await supabase.from(table).select('id').limit(1);
        out.push({
          label: `Tabela: ${table}`,
          status: error ? 'error' : 'ok',
          detail: error ? error.message : undefined,
        });
      } catch (e) {
        out.push({ label: `Tabela: ${table}`, status: 'error', detail: String(e) });
      }
    }

    // 2. Verificar colunas críticas (tentando select)
    for (const { table, column } of CRITICAL_COLUMNS) {
      try {
        const { error } = await (supabase.from(table) as ReturnType<typeof supabase.from>)
          .select(column)
          .limit(1);
        out.push({
          label: `Coluna: ${table}.${column}`,
          status: error ? 'error' : 'ok',
          detail: error ? error.message : undefined,
        });
      } catch (e) {
        out.push({ label: `Coluna: ${table}.${column}`, status: 'error', detail: String(e) });
      }
    }

    // 3. Verificar dados do seed
    for (const { entity, table, id } of SEED_IDS) {
      try {
        const { data, error } = await (supabase.from(table) as ReturnType<typeof supabase.from>)
          .select('id')
          .eq('id', id)
          .maybeSingle();
        out.push({
          label: `Seed: ${entity}`,
          status: error ? 'error' : data ? 'ok' : 'warning',
          detail: error ? error.message : !data ? 'Registro não encontrado' : undefined,
        });
      } catch (e) {
        out.push({ label: `Seed: ${entity}`, status: 'error', detail: String(e) });
      }
    }

    // 4. Verificar view table_availability
    try {
      const { error } = await supabase.from('table_availability').select('table_id').limit(1);
      out.push({
        label: 'View: table_availability',
        status: error ? 'error' : 'ok',
        detail: error ? error.message : undefined,
      });
    } catch (e) {
      out.push({ label: 'View: table_availability', status: 'error', detail: String(e) });
    }

    // 5. Verificar função get_user_tenant_id
    try {
      const { error } = await supabase.rpc('get_user_tenant_id');
      out.push({
        label: 'Função: get_user_tenant_id()',
        status: error ? 'warning' : 'ok',
        detail: error ? `${error.message} (normal se não autenticado)` : undefined,
      });
    } catch (e) {
      out.push({ label: 'Função: get_user_tenant_id()', status: 'warning', detail: String(e) });
    }

    setResults(out);
    setRunning(false);
  }

  const okCount = results.filter((r) => r.status === 'ok').length;
  const errCount = results.filter((r) => r.status === 'error').length;
  const warnCount = results.filter((r) => r.status === 'warning').length;

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-3xl mx-auto">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900">Validação de Migrations</h1>
          <p className="text-gray-500 mt-1 text-sm">
            Verifica se todas as tabelas, colunas e dados de seed dos Prompts 10–14 estão corretos.
          </p>
        </div>

        <button
          onClick={runChecks}
          disabled={running}
          className="mb-6 px-5 py-2.5 bg-gray-900 text-white rounded-lg text-sm font-medium
                     hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
        >
          {running ? 'Verificando...' : 'Executar Verificação'}
        </button>

        {results.length > 0 && (
          <>
            <div className="flex gap-4 mb-6">
              <div className="flex-1 bg-green-50 border border-green-200 rounded-lg p-4 text-center">
                <div className="text-2xl font-bold text-green-700">{okCount}</div>
                <div className="text-xs text-green-600 mt-1">Passou</div>
              </div>
              <div className="flex-1 bg-red-50 border border-red-200 rounded-lg p-4 text-center">
                <div className="text-2xl font-bold text-red-700">{errCount}</div>
                <div className="text-xs text-red-600 mt-1">Erros</div>
              </div>
              <div className="flex-1 bg-yellow-50 border border-yellow-200 rounded-lg p-4 text-center">
                <div className="text-2xl font-bold text-yellow-700">{warnCount}</div>
                <div className="text-xs text-yellow-600 mt-1">Avisos</div>
              </div>
            </div>

            <div className="bg-white border border-gray-200 rounded-lg divide-y divide-gray-100">
              {results.map((r, i) => (
                <div key={i} className="flex items-start gap-3 px-4 py-3">
                  <StatusBadge status={r.status} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-gray-800">{r.label}</div>
                    {r.detail && (
                      <div className="text-xs text-gray-500 mt-0.5 truncate">{r.detail}</div>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {errCount === 0 && (
              <div className="mt-4 p-4 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700">
                Todas as verificações passaram! O sistema está pronto para produção.
              </div>
            )}
          </>
        )}

        <div className="mt-8 bg-white border border-gray-200 rounded-lg p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">Script SQL de Validação Manual</h2>
          <pre className="text-xs text-gray-600 bg-gray-50 rounded p-3 overflow-x-auto whitespace-pre-wrap">
{`-- Cole no Supabase SQL Editor para validação completa

-- 1. Tabelas novas
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
    'order_discounts','refunds','table_session_participants',
    'order_item_assignments','ingredient_batches','combo_ingredients',
    'table_reservations','promotion_rules','vouchers',
    'voucher_transactions','loyalty_transactions'
  )
ORDER BY table_name;
-- Esperado: 11 linhas

-- 2. Colunas críticas
SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND (
    (table_name = 'customers' AND column_name = 'loyalty_points') OR
    (table_name = 'customers' AND column_name = 'loyalty_tier') OR
    (table_name = 'payments' AND column_name = 'voucher_id') OR
    (table_name = 'orders' AND column_name = 'discount_amount')
  )
ORDER BY table_name, column_name;
-- Esperado: 4 linhas

-- 3. Tabelas sem RLS (deve retornar 0 linhas)
SELECT tablename FROM pg_tables
WHERE schemaname = 'public' AND rowsecurity = false
ORDER BY tablename;

-- 4. View table_availability
SELECT table_number, upcoming_reservations
FROM table_availability LIMIT 5;

-- 5. Dados do seed
SELECT 'voucher' AS tipo, code AS valor FROM vouchers
  WHERE id = 'f0000000-0000-0000-0000-000000000001'
UNION ALL
SELECT 'reserva', customer_name FROM table_reservations
  WHERE id = 'a2000000-0000-0000-0000-000000000001'
UNION ALL
SELECT 'promo', name FROM promotion_rules
  WHERE id = 'b2000000-0000-0000-0000-000000000001';`}
          </pre>
        </div>
      </div>
    </div>
  );
}
