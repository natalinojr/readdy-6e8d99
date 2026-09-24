// Contas do dia usadas pelas ações "Vendas do dia" e "Fechamento do dia" (mesmos filtros de
// fn_get_sales_report). Arquivo à parte para os dois painéis não divergirem.
import { supabase } from '@/lib/supabase';

// Hora (0–23) em Brasília de um timestamp.
const horaBrasilia = (ts: string) => Number(new Date(ts).toLocaleString('en-US', { timeZone: 'America/Sao_Paulo', hour: '2-digit', hourCycle: 'h23' }));

/** Pedidos pagos do dia (mesmos filtros de fn_get_sales_report). null = não deu para ler. */
export async function pedidosPagosDoDia(tenantId: string, dia: string): Promise<{ id: string; created_at: string; total_amount: number }[] | null> {
  const todos: { id: string; created_at: string; total_amount: number }[] = [];
  const LOTE = 1000;
  for (let de = 0; ; de += LOTE) {
    const { data, error } = await supabase.from('orders').select('id, created_at, total_amount')
      .eq('tenant_id', tenantId).eq('is_paid', true).neq('status', 'cancelled')
      .eq('is_training', false).eq('is_draft', false)
      .gte('created_at', `${dia}T00:00:00-03:00`).lte('created_at', `${dia}T23:59:59-03:00`)
      .order('created_at').range(de, de + LOTE - 1);
    if (error) return null;
    todos.push(...((data ?? []) as typeof todos));
    if ((data ?? []).length < LOTE) return todos;
  }
}

export function porHora(pedidos: { created_at: string; total_amount: number }[] | null): number[] | null {
  if (!pedidos) return null;
  const horas = Array<number>(24).fill(0);
  for (const o of pedidos) horas[horaBrasilia(o.created_at)] += Number(o.total_amount ?? 0);
  return horas;
}

/** Faturamento por categoria do cardápio (itens não cancelados), maior primeiro. null = não deu para ler. */
export async function porCategoria(tenantId: string, ids: string[]): Promise<{ nome: string; valor: number; qtd: number }[] | null> {
  const mapa = new Map<string, { valor: number; qtd: number }>();
  // Em pedaços: muitos ids num .in() estouram o tamanho da URL.
  for (let i = 0; i < ids.length; i += 150) {
    const { data, error } = await supabase.from('order_items')
      .select('item_price, quantity, menu_items!order_items_item_id_fkey(menu_categories(name))')
      .in('order_id', ids.slice(i, i + 150)).eq('tenant_id', tenantId).neq('status', 'cancelled');
    if (error) return null;
    // O tipo gerado do join vem como array; na prática o PostgREST devolve objeto (FK para um).
    for (const oi of (data ?? []) as unknown as Array<{ item_price: number | null; quantity: number | null; menu_items: { menu_categories: { name: string } | null } | null }>) {
      const nome = oi.menu_items?.menu_categories?.name ?? 'Sem categoria';
      const c = mapa.get(nome) ?? { valor: 0, qtd: 0 };
      c.valor += Number(oi.item_price ?? 0) * (oi.quantity ?? 1);
      c.qtd += oi.quantity ?? 1;
      mapa.set(nome, c);
    }
  }
  return [...mapa.entries()].map(([nome, v]) => ({ nome, ...v })).sort((a, b) => b.valor - a.valor);
}

