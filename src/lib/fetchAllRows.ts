/**
 * fetchAllRows.ts
 *
 * O PostgREST (Supabase) devolve no máximo ~1000 linhas por request. Sem
 * paginação, uma query grande é TRUNCADA em silêncio — sem erro, sem aviso —
 * e os totais somados no cliente passam a subnotificar sozinhos conforme o
 * histórico cresce. O projeto já foi mordido por isso em `useOrdersHistory`.
 *
 * Este helper repete a query em lotes até acabar, com teto de segurança.
 *
 * Uso:
 *   const { rows, truncated } = await fetchAllRows((from, to) =>
 *     supabase.from('fin_cash_flow').select('...').eq('tenant_id', t).range(from, to)
 *   );
 */

export interface FetchAllResult<T> {
  rows: T[];
  /** true = o teto de segurança foi atingido e existem mais linhas no banco */
  truncated: boolean;
  error: { message: string } | null;
}

export async function fetchAllRows<T>(
  runPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  opts: { pageSize?: number; maxRows?: number } = {},
): Promise<FetchAllResult<T>> {
  const pageSize = opts.pageSize ?? 1000;
  const maxRows = opts.maxRows ?? 20000;

  const rows: T[] = [];
  let truncated = false;

  for (let page = 0; page * pageSize < maxRows; page++) {
    const from = page * pageSize;
    const { data, error } = await runPage(from, from + pageSize - 1);
    if (error) return { rows, truncated, error };

    const batch = data ?? [];
    rows.push(...batch);

    // Lote incompleto = acabou
    if (batch.length < pageSize) return { rows, truncated: false, error: null };

    if (rows.length >= maxRows) {
      truncated = true;
      break;
    }
  }

  return { rows, truncated, error: null };
}
