import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function extractErrorMessage(err: unknown): string {
  if (!err) return 'Erro desconhecido';
  if (typeof err === 'string') return err;
  if (typeof err === 'object') {
    const e = err as Record<string, unknown>;
    return String(e.message ?? e.msg ?? e.error ?? JSON.stringify(e));
  }
  return String(err);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });

    const { data: { user } } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''));
    if (!user) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });

    const body = await req.json();
    const { action, tenant_id, payload } = body;

    if (!tenant_id) return new Response(JSON.stringify({ error: 'tenant_id required' }), { status: 400, headers: corsHeaders });

    // Validate tenant membership
    const { data: tenantCheck } = await supabase
      .from('user_tenants')
      .select('tenant_id')
      .eq('user_id', user.id)
      .eq('tenant_id', tenant_id)
      .maybeSingle();
    if (!tenantCheck) return new Response(JSON.stringify({ error: 'User does not belong to the requested tenant' }), { status: 403, headers: corsHeaders });

    let result: { data?: unknown; error?: unknown } | null = null;

    switch (action) {
      // ── Cost Centers ──────────────────────────────────────────────────────
      case 'list_cost_centers': {
        const { data, error } = await supabase
          .from('fin_cost_centers')
          .select('*')
          .eq('tenant_id', tenant_id)
          .eq('is_active', true)
          .is('deleted_at', null)
          .order('sort_order');
        if (error) {
          console.error('[list_cost_centers] error:', error.message);
          return new Response(JSON.stringify({ error: extractErrorMessage(error) }), { status: 500, headers: corsHeaders });
        }
        return new Response(JSON.stringify({ data: data ?? [] }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      case 'upsert_cost_center': {
        const { id, ...data } = payload;
        if (id) {
          result = await supabase.from('fin_cost_centers').update({ ...data, tenant_id }).eq('id', id).eq('tenant_id', tenant_id).select().single();
        } else {
          result = await supabase.from('fin_cost_centers').insert({ ...data, tenant_id }).select().single();
        }
        if (result?.error) {
          const errMsg = extractErrorMessage(result.error);
          if (errMsg.includes('uq_cost_center_name_tenant') || errMsg.includes('unique constraint')) {
            return new Response(
              JSON.stringify({ error: 'Já existe um centro de custo com este nome para este estabelecimento.' }),
              { status: 409, headers: corsHeaders },
            );
          }
        }
        break;
      }
      case 'delete_cost_center': {
        result = await supabase.from('fin_cost_centers').update({ is_active: false }).eq('id', payload.id).eq('tenant_id', tenant_id);
        break;
      }

      // ── Bank Accounts ───────────────────────────────────────────────────
      case 'list_bank_accounts': {
        const { data, error } = await supabase
          .from('fin_bank_accounts')
          .select('*')
          .eq('tenant_id', tenant_id)
          .eq('is_active', true)
          .order('is_default', { ascending: false })
          .order('name');
        if (error) {
          console.error('[list_bank_accounts] error:', error.message);
          return new Response(JSON.stringify({ error: extractErrorMessage(error) }), { status: 500, headers: corsHeaders });
        }
        return new Response(JSON.stringify({ data: data ?? [] }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      case 'upsert_bank_account': {
        const { id, ...data } = payload;
        if (id) {
          result = await supabase.from('fin_bank_accounts').update({ ...data, tenant_id }).eq('id', id).eq('tenant_id', tenant_id).select().single();
        } else {
          result = await supabase.from('fin_bank_accounts').insert({ ...data, tenant_id }).select().single();
        }
        break;
      }

      case 'set_default_bank_account': {
        await supabase.from('fin_bank_accounts').update({ is_default: false }).eq('tenant_id', tenant_id);
        result = await supabase.from('fin_bank_accounts').update({ is_default: true }).eq('id', payload.id).eq('tenant_id', tenant_id);
        break;
      }

      case 'delete_bank_account': {
        result = await supabase.from('fin_bank_accounts').update({ is_active: false }).eq('id', payload.id).eq('tenant_id', tenant_id);
        break;
      }

      // ── Income Routing ──────────────────────────────────────────────────
      case 'list_income_routing': {
        const { data, error } = await supabase
          .from('fin_income_routing')
          .select('*, bank_account:fin_bank_accounts(id,name,color,icon)')
          .eq('tenant_id', tenant_id)
          .order('source_type');
        if (error) {
          console.error('[list_income_routing] error:', error.message);
          return new Response(JSON.stringify({ error: extractErrorMessage(error) }), { status: 500, headers: corsHeaders });
        }
        return new Response(JSON.stringify({ data: data ?? [] }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      case 'upsert_income_routing': {
        const { id, ...data } = payload;
        if (id) {
          result = await supabase.from('fin_income_routing').update({ ...data, tenant_id }).eq('id', id).eq('tenant_id', tenant_id).select().single();
        } else {
          const { source_type, source_id } = data as Record<string, unknown>;
          const { data: existing } = await supabase
            .from('fin_income_routing')
            .select('id')
            .eq('tenant_id', tenant_id)
            .eq('source_type', source_type ?? '')
            .eq('source_id', source_id ?? '')
            .maybeSingle();
          if (existing) {
            result = await supabase.from('fin_income_routing').update({ ...data, tenant_id }).eq('id', (existing as { id: string }).id).select().single();
          } else {
            result = await supabase.from('fin_income_routing').insert({ ...data, tenant_id }).select().single();
          }
        }
        break;
      }

      case 'delete_income_routing': {
        result = await supabase.from('fin_income_routing').delete().eq('id', payload.id).eq('tenant_id', tenant_id);
        break;
      }

      // ── Bank Transactions ───────────────────────────────────────────────
      case 'list_bank_transactions': {
        let query = supabase
          .from('fin_bank_transactions')
          .select('*')
          .eq('tenant_id', tenant_id)
          .eq('bank_account_id', payload.bank_account_id)
          .order('transaction_date', { ascending: false })
          .order('created_at', { ascending: false });
        if (payload?.start_date) query = query.gte('transaction_date', payload.start_date);
        if (payload?.end_date) query = query.lte('transaction_date', payload.end_date);
        const limit = payload?.limit ? Number(payload.limit) : 200;
        query = query.limit(limit);
        const { data, error } = await query;
        if (error) {
          console.error('[list_bank_transactions] error:', error.message);
          return new Response(JSON.stringify({ error: extractErrorMessage(error) }), { status: 500, headers: corsHeaders });
        }
        return new Response(JSON.stringify({ data: data ?? [] }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      // ── Cash Flow ─────────────────────────────────────────────────────────
      case 'list_cash_flow': {
        let query = supabase
          .from('fin_cash_flow')
          .select('*, cost_center:fin_cost_centers(id,name,color,icon)')
          .eq('tenant_id', tenant_id)
          .order('date', { ascending: false })
          .order('created_at', { ascending: false });
        if (payload?.startDate) query = query.gte('date', payload.startDate);
        if (payload?.endDate) query = query.lte('date', payload.endDate);
        const { data, error } = await query;
        if (error) {
          console.error('[list_cash_flow] error:', error.message);
          return new Response(JSON.stringify({ error: extractErrorMessage(error) }), { status: 500, headers: corsHeaders });
        }
        return new Response(JSON.stringify({ data: data ?? [] }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      case 'insert_cash_flow': {
        const normalizedPayload: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
          normalizedPayload[key] = value === '' ? null : value;
        }
        if (!normalizedPayload.description || normalizedPayload.description === null) {
          normalizedPayload.description = normalizedPayload.category || 'Movimentação';
        }
        result = await supabase.from('fin_cash_flow').insert({ ...normalizedPayload, tenant_id }).select().single();
        break;
      }
      case 'delete_cash_flow': {
        result = await supabase.from('fin_cash_flow').delete().eq('id', payload.id).eq('tenant_id', tenant_id);
        break;
      }

      // ── Bills Payable ─────────────────────────────────────────────────────
      case 'list_bills_payable': {
        // Marcar contas vencidas no banco antes de retornar os dados
        await supabase.rpc('fn_mark_overdue_bills');
        const { data, error } = await supabase
          .from('fin_accounts_payable')
          .select('*, cost_center:fin_cost_centers(id,name,color,icon)')
          .eq('tenant_id', tenant_id)
          .order('due_date');
        if (error) {
          console.error('[list_bills_payable] error:', error.message);
          return new Response(JSON.stringify({ error: extractErrorMessage(error) }), { status: 500, headers: corsHeaders });
        }
        return new Response(JSON.stringify({ data: data ?? [] }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      case 'upsert_bill': {
        const { id, ...data } = payload;
        const { recurrence_type, ...cleanData } = data as Record<string, unknown>;
        void recurrence_type;
        if (id) {
          result = await supabase.from('fin_accounts_payable').update({ ...cleanData, tenant_id }).eq('id', id).eq('tenant_id', tenant_id).select().single();
        } else {
          result = await supabase.from('fin_accounts_payable').insert({ ...cleanData, tenant_id }).select().single();
        }
        if (result?.error) {
          console.error('[upsert_bill] Supabase error:', JSON.stringify(result.error));
          return new Response(JSON.stringify({ error: extractErrorMessage(result.error) }), { status: 500, headers: corsHeaders });
        }
        break;
      }

      case 'bulk_update_bill_dre_category': {
        // Vínculo em LOTE de categoria DRE. Antes o front fazia N updates
        // diretos na tabela (um por conta) e contava todos como salvos sem
        // olhar o erro — e, para usuário multi-loja, a RLS `*_auth_uid`
        // (LIMIT 1 sobre user_tenants, sem ORDER BY) podia afetar zero linhas
        // silenciosamente na loja "errada".
        const assignments = payload?.assignments as Array<{ bill_id: string; dre_category_id: string | null }> | undefined;
        if (!Array.isArray(assignments) || assignments.length === 0) {
          return new Response(JSON.stringify({ error: 'Nenhum vínculo informado' }), { status: 400, headers: corsHeaders });
        }

        let updated = 0;
        const failures: string[] = [];
        for (const a of assignments) {
          if (!a?.bill_id) continue;
          const { error: updErr, count } = await supabase
            .from('fin_accounts_payable')
            .update({ dre_category_id: a.dre_category_id || null }, { count: 'exact' })
            .eq('id', a.bill_id)
            .eq('tenant_id', tenant_id);
          if (updErr) failures.push(extractErrorMessage(updErr));
          else updated += count ?? 0;
        }

        if (failures.length > 0) {
          return new Response(JSON.stringify({
            error: `${failures.length} vínculo(s) falharam: ${failures[0]}`,
          }), { status: 500, headers: corsHeaders });
        }
        return new Response(JSON.stringify({ data: { updated } }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      case 'pay_bill': {
        const { id, paid_date, paid_amount, payment_method, bank_account_id } = payload;

        const { data: bill, error: fetchError } = await supabase
          .from('fin_accounts_payable')
          .select('*')
          .eq('id', id)
          .eq('tenant_id', tenant_id)
          .single();

        if (fetchError || !bill) {
          return new Response(JSON.stringify({ error: 'Bill not found' }), { status: 404, headers: corsHeaders });
        }

        // PAGAMENTO PARCIAL: antes o status ia para 'paid' incondicionalmente, então
        // uma conta paga a menor era quitada e o saldo devedor sumia. Agora paid_amount
        // ACUMULA os pagamentos e a conta só fecha quando cobre o valor total.
        const billRec = bill as Record<string, unknown>;
        const billAmount = Number(billRec.amount ?? 0);
        const alreadyPaid = Number(billRec.paid_amount ?? 0);
        const paymentAmount = Math.round(Number(paid_amount ?? 0) * 100) / 100;

        if (billRec.status === 'paid') {
          return new Response(JSON.stringify({ error: 'Conta já está quitada' }), { status: 409, headers: corsHeaders });
        }
        if (!(paymentAmount > 0)) {
          return new Response(JSON.stringify({ error: 'Valor do pagamento deve ser maior que zero' }), { status: 400, headers: corsHeaders });
        }
        // Trava o pagamento no saldo devedor: sem isso, pagar em lote uma conta
        // parcial lançava a diferença de novo no caixa e no banco (dinheiro que
        // saiu do relatório sem ter saído da conta).
        const remainingBefore = Math.round((billAmount - alreadyPaid) * 100) / 100;
        if (paymentAmount > remainingBefore + 0.005) {
          return new Response(JSON.stringify({
            error: `Valor acima do saldo devedor (${remainingBefore.toFixed(2)}). Já foram pagos ${alreadyPaid.toFixed(2)} de ${billAmount.toFixed(2)}.`,
          }), { status: 400, headers: corsHeaders });
        }

        const newPaidTotal = Math.round((alreadyPaid + paymentAmount) * 100) / 100;
        // Tolerância de meio centavo evita que arredondamento deixe a conta eternamente 'partial'
        const isSettled = newPaidTotal >= billAmount - 0.005;

        result = await supabase
          .from('fin_accounts_payable')
          .update({
            status: isSettled ? 'paid' : 'partial',
            paid_date,
            paid_amount: newPaidTotal,
            payment_method,
          })
          .eq('id', id)
          .eq('tenant_id', tenant_id)
          .select()
          .single();

        if (result?.error) {
          console.error('[pay_bill] Supabase error:', JSON.stringify(result.error));
          return new Response(JSON.stringify({ error: extractErrorMessage(result.error) }), { status: 500, headers: corsHeaders });
        }

        // P3: origin='auto_bill_payment' (não 'manual'). Com 'manual', a conta paga era
        // contada 2x em Despesas (fin_accounts_payable pago + fin_cash_flow manual).
        // A lista de exclusão em useFinanceiro/useDespesas já espera 'auto_bill_payment'.
        await supabase.from('fin_cash_flow').insert({
          tenant_id,
          type: 'expense',
          amount: paymentAmount,
          description: (bill as Record<string, unknown>).description,
          category: (bill as Record<string, unknown>).category || 'Conta a Pagar',
          cost_center_id: (bill as Record<string, unknown>).cost_center_id,
          origin: 'auto_bill_payment',
          reference_id: id,
          date: paid_date,
        });

        const targetBankAccountId = bank_account_id || (bill as Record<string, unknown>).bank_account_id;
        if (targetBankAccountId) {
          await supabase.rpc('fn_bank_debit', {
            p_bank_account_id: targetBankAccountId,
            p_amount: paymentAmount,
            p_description: `Pagamento: ${(bill as Record<string, unknown>).description}`,
            p_reference_type: 'bill_payment',
            p_reference_id: id,
            p_transaction_date: paid_date,
          });
        }

        if ((bill as Record<string, unknown>).reference_type === 'purchase' && (bill as Record<string, unknown>).reference_id) {
          const { data: sibling_bills } = await supabase
            .from('fin_accounts_payable')
            .select('id, status, reference_id')
            .eq('tenant_id', tenant_id)
            .eq('reference_id', (bill as Record<string, unknown>).reference_id as string)
            .eq('reference_type', 'purchase');

          const allBills = sibling_bills ?? [];
          // A própria conta conta como quitada só se o pagamento cobriu o total
          const allPaid = (allBills as Array<{ id: string; status: string }>).every((b) => b.id === id ? isSettled : b.status === 'paid');
          const anyPaid = (allBills as Array<{ id: string; status: string }>).some((b) => b.id === id ? true : b.status === 'paid');
          const newPurchaseStatus = allPaid ? 'paid' : anyPaid ? 'partial' : 'pending';

          await supabase
            .from('fin_purchases')
            .update({ payment_status: newPurchaseStatus })
            .eq('id', (bill as Record<string, unknown>).reference_id as string)
            .eq('tenant_id', tenant_id);
        }

        // Só gera a próxima ocorrência quando a atual foi de fato quitada;
        // um pagamento parcial não deve adiantar o mês seguinte.
        if ((bill as Record<string, unknown>).is_recurring && isSettled) {
          const currentDue = new Date((bill as Record<string, unknown>).due_date as string);
          const nextDue = new Date(currentDue.getFullYear(), currentDue.getMonth() + 1, currentDue.getDate());
          const nextDueStr = nextDue.toISOString().split('T')[0];

          const { data: existing } = await supabase
            .from('fin_accounts_payable')
            .select('id')
            .eq('tenant_id', tenant_id)
            .eq('description', (bill as Record<string, unknown>).description as string)
            .eq('due_date', nextDueStr)
            .maybeSingle();

          if (!existing) {
            await supabase.from('fin_accounts_payable').insert({
              tenant_id,
              supplier: (bill as Record<string, unknown>).supplier,
              description: (bill as Record<string, unknown>).description,
              category: (bill as Record<string, unknown>).category,
              cost_center_id: (bill as Record<string, unknown>).cost_center_id,
              bank_account_id: (bill as Record<string, unknown>).bank_account_id,
              amount: (bill as Record<string, unknown>).amount,
              due_date: nextDueStr,
              status: 'pending',
              is_recurring: true,
              notes: (bill as Record<string, unknown>).notes,
            });
          }
        }
        break;
      }

      case 'delete_bill': {
        result = await supabase.from('fin_accounts_payable').delete().eq('id', payload.id).eq('tenant_id', tenant_id);
        break;
      }

      // ── Suppliers ─────────────────────────────────────────────────────────
      case 'list_suppliers': {
        const { data, error } = await supabase
          .from('fin_suppliers')
          .select('*')
          .eq('tenant_id', tenant_id)
          .eq('is_active', true)
          .order('name');
        if (error) {
          console.error('[list_suppliers] error:', error.message);
          return new Response(JSON.stringify({ error: extractErrorMessage(error) }), { status: 500, headers: corsHeaders });
        }
        return new Response(JSON.stringify({ data: data ?? [] }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      case 'upsert_supplier': {
        const { id, ...data } = payload;
        if (id) {
          result = await supabase.from('fin_suppliers').update({ ...data, tenant_id }).eq('id', id).eq('tenant_id', tenant_id).select().single();
        } else {
          result = await supabase.from('fin_suppliers').insert({ ...data, tenant_id }).select().single();
        }
        break;
      }

      // ── Merchandise categories ────────────────────────────────────────────
      // Categorias de MERCADORIA (Bebidas, Hortifruti, Proteínas...) — lista
      // gerenciável pelo usuário. Não confundir com fin_dre_categories, que é
      // plano de contas (inclui Aluguel, Salário etc.).
      case 'list_merchandise_categories': {
        const { data, error } = await supabase
          .from('fin_merchandise_categories')
          .select('*')
          .eq('tenant_id', tenant_id)
          .eq('is_active', true)
          .order('sort_order')
          .order('name');
        if (error) {
          console.error('[list_merchandise_categories] error:', error.message);
          return new Response(JSON.stringify({ error: extractErrorMessage(error) }), { status: 500, headers: corsHeaders });
        }
        return new Response(JSON.stringify({ data: data ?? [] }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      case 'upsert_merchandise_category': {
        const { id, name, sort_order } = payload;
        const cleanName = String(name ?? '').trim();
        if (!cleanName) {
          return new Response(JSON.stringify({ error: 'Nome da categoria é obrigatório' }), { status: 400, headers: corsHeaders });
        }
        const data: Record<string, unknown> = { name: cleanName, updated_at: new Date().toISOString() };
        if (sort_order !== undefined) data.sort_order = Number(sort_order) || 0;

        if (id) {
          result = await supabase.from('fin_merchandise_categories').update(data).eq('id', id).eq('tenant_id', tenant_id).select().single();
        } else {
          result = await supabase.from('fin_merchandise_categories').insert({ ...data, tenant_id }).select().single();
        }
        if (result?.error) {
          // índice único (tenant_id, lower(name))
          const msg = String(result.error.code) === '23505'
            ? `Já existe uma categoria chamada "${cleanName}"`
            : extractErrorMessage(result.error);
          return new Response(JSON.stringify({ error: msg }), { status: 400, headers: corsHeaders });
        }
        break;
      }

      case 'merge_merchandise_category': {
        // Move tudo de `from_id` para `to_id` e desativa a origem.
        // É como o usuário colapsa duplicatas ("Mercearia" → "Secos").
        const { from_id, to_id } = payload;
        if (!from_id || !to_id || from_id === to_id) {
          return new Response(JSON.stringify({ error: 'Selecione duas categorias diferentes' }), { status: 400, headers: corsHeaders });
        }

        // Garante que AMBAS pertencem a este tenant antes de mover qualquer coisa
        const { data: both, error: bothErr } = await supabase
          .from('fin_merchandise_categories')
          .select('id')
          .eq('tenant_id', tenant_id)
          .in('id', [from_id, to_id]);
        if (bothErr || (both ?? []).length !== 2) {
          return new Response(JSON.stringify({ error: 'Categoria não encontrada nesta loja' }), { status: 404, headers: corsHeaders });
        }

        const { count: movedIngredients } = await supabase
          .from('ingredients')
          .update({ merchandise_category_id: to_id }, { count: 'exact' })
          .eq('tenant_id', tenant_id)
          .eq('merchandise_category_id', from_id);

        const { count: movedItems } = await supabase
          .from('fin_purchase_items')
          .update({ merchandise_category_id: to_id }, { count: 'exact' })
          .eq('tenant_id', tenant_id)
          .eq('merchandise_category_id', from_id);

        result = await supabase
          .from('fin_merchandise_categories')
          .update({ is_active: false, updated_at: new Date().toISOString() })
          .eq('id', from_id)
          .eq('tenant_id', tenant_id)
          .select()
          .single();

        if (result?.error) {
          return new Response(JSON.stringify({ error: extractErrorMessage(result.error) }), { status: 500, headers: corsHeaders });
        }
        return new Response(
          JSON.stringify({ data: { moved_ingredients: movedIngredients ?? 0, moved_purchase_items: movedItems ?? 0 } }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }

      case 'delete_merchandise_category': {
        // Soft delete: itens de compra já lançados continuam apontando para a categoria.
        result = await supabase
          .from('fin_merchandise_categories')
          .update({ is_active: false, updated_at: new Date().toISOString() })
          .eq('id', payload.id)
          .eq('tenant_id', tenant_id)
          .select()
          .single();
        break;
      }

      // ── Anticipations ─────────────────────────────────────────────────────
      case 'list_anticipations': {
        const { data, error } = await supabase
          .from('fin_anticipations')
          .select('*')
          .eq('tenant_id', tenant_id)
          .order('created_at', { ascending: false });
        if (error) {
          console.error('[list_anticipations] error:', error.message);
          return new Response(JSON.stringify({ error: extractErrorMessage(error) }), { status: 500, headers: corsHeaders });
        }
        return new Response(JSON.stringify({ data: data ?? [] }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      case 'insert_anticipation': {
        const { gross_amount, fee_percent, net_amount, notes, installment_ids = [] } = payload;
        const fee_amount = Number(gross_amount) - Number(net_amount);
        const today = new Date().toISOString().split('T')[0];
        const nowIso = new Date().toISOString();

        const { data: anticipation, error: antErr } = await supabase
          .from('fin_anticipations')
          .insert({
            tenant_id,
            gross_amount: Number(gross_amount),
            fee_percent: Number(fee_percent),
            net_amount: Number(net_amount),
            notes: notes || null,
            installment_ids: installment_ids.length > 0 ? installment_ids : null,
            status: 'active',
            created_by: user.id,
          })
          .select()
          .single();

        if (antErr || !anticipation) {
          console.error('[insert_anticipation] Erro ao criar antecipação:', antErr?.message);
          return new Response(JSON.stringify({ error: extractErrorMessage(antErr) }), { status: 500, headers: corsHeaders });
        }

        if (installment_ids.length > 0) {
          const { error: markErr } = await supabase
            .from('fin_receivable_installments')
            .update({ is_anticipated: true, anticipation_id: anticipation.id, anticipated_at: nowIso })
            .in('id', installment_ids)
            .eq('tenant_id', tenant_id);
          if (markErr) console.error('[insert_anticipation] Erro ao marcar recebíveis:', markErr.message);
        }

        await supabase.from('fin_cash_flow').insert({
          tenant_id, type: 'income', amount: Number(net_amount),
          description: notes || `Antecipação de recebíveis (taxa ${fee_percent}%)`,
          category: 'Antecipação', origin: 'auto_anticipation', reference_id: anticipation.id, date: today,
        });

        if (fee_amount > 0) {
          await supabase.from('fin_cash_flow').insert({
            tenant_id, type: 'expense', amount: fee_amount,
            description: `Taxa de antecipação (${fee_percent}%)`,
            category: 'Taxas Bancárias', origin: 'auto_anticipation', reference_id: anticipation.id, date: today,
          });
        }

        result = { data: anticipation };
        break;
      }

      // ── Receivable installments ───────────────────────────────────────────
      case 'list_receivable_installments': {
        const { data, error } = await supabase
          .from('fin_receivable_installments')
          .select('*, orders!left ( number, payments!left ( amount, payment_methods!left ( name ) ) )')
          .eq('tenant_id', tenant_id)
          .order('due_date');
        if (error) {
          console.error('[list_receivable_installments] error:', error.message);
          return new Response(JSON.stringify({ error: extractErrorMessage(error) }), { status: 500, headers: corsHeaders });
        }
        const enriched = (data ?? []).map((inst: Record<string, unknown>) => {
          const orderNum = inst.order_number ?? (inst.orders as Record<string, unknown>)?.number ?? null;
          const pmName = inst.payment_method_name ?? ((inst.orders as Record<string, unknown>)?.payments as Array<Record<string, unknown>>)?.[0]?.payment_methods?.name ?? null;
          return { ...inst, order_number: orderNum, payment_method_name: pmName };
        });
        return new Response(JSON.stringify({ data: enriched }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      case 'receive_installment': {
        const { id } = payload;
        const now = new Date().toISOString();
        const today = now.split('T')[0];

        const { data: installment, error: fetchErr } = await supabase
          .from('fin_receivable_installments')
          .select('*')
          .eq('id', id)
          .maybeSingle();

        if (fetchErr) {
          console.error('[receive_installment] Erro ao buscar parcela:', fetchErr.message);
          return new Response(JSON.stringify({ error: `Erro ao buscar parcela: ${fetchErr.message}` }), { status: 500, headers: corsHeaders });
        }
        if (!installment) {
          return new Response(JSON.stringify({ error: 'Parcela não encontrada' }), { status: 404, headers: corsHeaders });
        }
        if ((installment as Record<string, unknown>).tenant_id !== tenant_id) {
          return new Response(JSON.stringify({ error: 'Acesso negado: parcela não pertence a este tenant' }), { status: 403, headers: corsHeaders });
        }
        if ((installment as Record<string, unknown>).status === 'received') {
          return new Response(JSON.stringify({ data: { id, status: 'received', message: 'Parcela já estava marcada como recebida.' } }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }

        if ((installment as Record<string, unknown>).is_anticipated) {
          const { error: updateErr } = await supabase.from('fin_receivable_installments').update({ status: 'received', received_at: now }).eq('id', id);
          if (updateErr) return new Response(JSON.stringify({ error: extractErrorMessage(updateErr) }), { status: 500, headers: corsHeaders });
          result = { data: { message: 'Recebível já antecipado — marcado como recebido sem duplicar fluxo de caixa.' } };
          break;
        }

        const { error: updateErr } = await supabase.from('fin_receivable_installments').update({ status: 'received', received_at: now }).eq('id', id);
        if (updateErr) return new Response(JSON.stringify({ error: extractErrorMessage(updateErr) }), { status: 500, headers: corsHeaders });

        result = { data: { id, status: 'received' } };

        const { data: existingFlow } = await supabase.from('fin_cash_flow').select('id').eq('tenant_id', tenant_id).eq('reference_id', id).eq('origin', 'auto_sale').maybeSingle();
        if (!existingFlow) {
          let orderDesc = `Parcela ${(installment as Record<string, unknown>).installment_number}/${(installment as Record<string, unknown>).total_installments}`;
          if ((installment as Record<string, unknown>).order_id) {
            const { data: orderData } = await supabase.from('orders').select('number').eq('id', (installment as Record<string, unknown>).order_id as string).maybeSingle();
            if ((orderData as Record<string, unknown>)?.number) orderDesc = `Recebimento Pedido #${(orderData as Record<string, unknown>).number} (${(installment as Record<string, unknown>).installment_number}/${(installment as Record<string, unknown>).total_installments})`;
          }
          await supabase.from('fin_cash_flow').insert({ tenant_id, type: 'income', amount: (installment as Record<string, unknown>).amount, description: orderDesc, category: 'Vendas', origin: 'auto_sale', reference_id: id, date: today });

          // BUG-43: Lançar taxa de maquininha tambem para recebiveis a prazo
          const instOrderId = (installment as Record<string, unknown>).order_id as string | undefined;
          const instAmount = Number((installment as Record<string, unknown>).amount ?? 0);
          if (instOrderId && instAmount > 0) {
            const { data: relatedPayment } = await supabase
              .from('payments')
              .select('payment_method_id')
              .eq('order_id', instOrderId)
              .eq('amount', instAmount)
              .eq('is_refunded', false)
              .maybeSingle();
            if (relatedPayment?.payment_method_id) {
              const { data: pmData } = await supabase
                .from('payment_methods')
                .select('fee_percentage, name')
                .eq('id', relatedPayment.payment_method_id)
                .maybeSingle();
              const feePercent = Number((pmData as Record<string, unknown>)?.fee_percentage ?? 0);
              if (feePercent > 0) {
                const feeAmount = Math.round((instAmount * feePercent / 100) * 100) / 100;
                if (feeAmount > 0) {
                  const { data: existingFee } = await supabase.from('fin_cash_flow')
                    .select('id')
                    .eq('tenant_id', tenant_id)
                    .eq('reference_id', id)
                    .eq('origin', 'auto_card_fee')
                    .maybeSingle();
                  if (!existingFee) {
                    const pmName = (pmData as Record<string, unknown>)?.name ?? 'Cartao';
                    await supabase.from('fin_cash_flow').insert({
                      tenant_id,
                      type: 'expense',
                      amount: feeAmount,
                      description: `Taxa maquininha — ${pmName} (${feePercent}%) — ${orderDesc}`,
                      category: 'Taxas de Cartao',
                      origin: 'auto_card_fee',
                      reference_id: id,
                      date: today,
                    });
                  }
                }
              }
            }
          }
        }
        break;
      }

      // ── DRE Categories ────────────────────────────────────────────────────
      case 'upsert_dre_category': {
        const { id, ...data } = payload;
        if (id) {
          result = await supabase.from('fin_dre_categories').update({ ...data, tenant_id }).eq('id', id).eq('tenant_id', tenant_id).select().single();
        } else {
          result = await supabase.from('fin_dre_categories').insert({ ...data, tenant_id }).select().single();
        }
        break;
      }
      case 'delete_dre_category': {
        result = await supabase.from('fin_dre_categories').delete().eq('id', payload.id).eq('tenant_id', tenant_id);
        break;
      }

      // ── Convert Budget to Purchase ────────────────────────────────────────
      // ── Budgets (orçamentos) ──────────────────────────────────────────────
      // Escrita centralizada aqui em vez de direto do front: `fin_budget_items`
      // NÃO tem coluna tenant_id, então o insert direto ficava à mercê da RLS
      // `fin_budgets_*`, que resolve o tenant com LIMIT 1 sobre user_tenants —
      // para admin multi-loja isso podia gravar zero linhas em silêncio.
      case 'upsert_budget': {
        const { id, items, ...data } = payload as Record<string, unknown> & {
          id?: string;
          items?: Array<Record<string, unknown>>;
        };

        let budgetId = id;
        if (id) {
          const upd = await supabase.from('fin_budgets')
            .update({ ...data }).eq('id', id).eq('tenant_id', tenant_id).select().maybeSingle();
          if (upd.error) {
            return new Response(JSON.stringify({ error: extractErrorMessage(upd.error) }), { status: 500, headers: corsHeaders });
          }
          if (!upd.data) {
            return new Response(JSON.stringify({ error: 'Orçamento não encontrado nesta loja' }), { status: 404, headers: corsHeaders });
          }
        } else {
          const ins = await supabase.from('fin_budgets')
            .insert({ ...data, tenant_id, created_by: user.id }).select().maybeSingle();
          if (ins.error || !ins.data) {
            return new Response(JSON.stringify({ error: extractErrorMessage(ins.error ?? 'Falha ao criar orçamento') }), { status: 500, headers: corsHeaders });
          }
          budgetId = (ins.data as Record<string, unknown>).id as string;
        }

        // Itens: substituição completa. Sem eles o orçamento fica com valor
        // cheio e zero itens — e convertido em compra nasce vazio, sem entrada
        // de estoque. Por isso a falha aqui é ERRO, não aviso.
        if (Array.isArray(items)) {
          const del = await supabase.from('fin_budget_items').delete().eq('budget_id', budgetId);
          if (del.error) {
            return new Response(JSON.stringify({ error: extractErrorMessage(del.error) }), { status: 500, headers: corsHeaders });
          }
          const rows = items
            .filter((i) => String(i.descricao ?? '').trim())
            .map((i) => ({
              budget_id: budgetId,
              descricao: i.descricao,
              quantidade: Number(i.quantidade ?? 0),
              unidade: i.unidade ?? null,
              valor_unitario: Number(i.valor_unitario ?? 0),
              valor_total: Number(i.quantidade ?? 0) * Number(i.valor_unitario ?? 0),
            }));
          if (rows.length > 0) {
            const insItems = await supabase.from('fin_budget_items').insert(rows);
            if (insItems.error) {
              return new Response(JSON.stringify({ error: `Itens não gravados: ${extractErrorMessage(insItems.error)}` }), { status: 500, headers: corsHeaders });
            }
          }
        }

        return new Response(JSON.stringify({ data: { id: budgetId } }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      case 'update_budget_status': {
        const { id, status } = payload as { id?: string; status?: string };
        if (!id || !status) {
          return new Response(JSON.stringify({ error: 'id e status são obrigatórios' }), { status: 400, headers: corsHeaders });
        }
        const patch: Record<string, unknown> = { status };
        // aprovado_por/aprovado_em só fazem sentido na APROVAÇÃO
        if (status === 'aprovado') {
          patch.aprovado_por = user.id;
          patch.aprovado_em = new Date().toISOString();
        }
        const upd = await supabase.from('fin_budgets')
          .update(patch).eq('id', id).eq('tenant_id', tenant_id).select().maybeSingle();
        if (upd.error) {
          return new Response(JSON.stringify({ error: extractErrorMessage(upd.error) }), { status: 500, headers: corsHeaders });
        }
        if (!upd.data) {
          return new Response(JSON.stringify({ error: 'Orçamento não encontrado nesta loja' }), { status: 404, headers: corsHeaders });
        }
        return new Response(JSON.stringify({ data: upd.data }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      case 'delete_budget': {
        const { id } = payload as { id?: string };
        if (!id) return new Response(JSON.stringify({ error: 'id required' }), { status: 400, headers: corsHeaders });
        // Confere a posse antes de apagar (fin_budget_items não tem tenant_id)
        const { data: owned } = await supabase.from('fin_budgets')
          .select('id').eq('id', id).eq('tenant_id', tenant_id).maybeSingle();
        if (!owned) {
          return new Response(JSON.stringify({ error: 'Orçamento não encontrado nesta loja' }), { status: 404, headers: corsHeaders });
        }
        await supabase.from('fin_budget_items').delete().eq('budget_id', id);
        result = await supabase.from('fin_budgets').delete().eq('id', id).eq('tenant_id', tenant_id);
        break;
      }

      case 'convert_budget_to_purchase': {
        const { budget_id, payment_method, payment_status, due_date, bank_account_id, cost_center_id } = payload;

        const { data: budget, error: budgetErr } = await supabase.from('fin_budgets').select('*, items:fin_budget_items(*)').eq('id', budget_id).eq('tenant_id', tenant_id).maybeSingle();
        if (budgetErr || !budget) return new Response(JSON.stringify({ error: 'Orçamento não encontrado' }), { status: 404, headers: corsHeaders });
        if ((budget as Record<string, unknown>).status === 'convertido') return new Response(JSON.stringify({ error: 'Este orçamento já foi convertido em compra.' }), { status: 400, headers: corsHeaders });

        const today = new Date().toISOString().split('T')[0];
        const finalDueDate = due_date || (() => { const d = new Date(); d.setDate(d.getDate() + 30); return d.toISOString().split('T')[0]; })();

        const { data: purchase, error: purchaseErr } = await supabase.from('fin_purchases').insert({
          tenant_id,
          supplier: (budget as Record<string, unknown>).fornecedor || 'Fornecedor não informado',
          total_amount: Number((budget as Record<string, unknown>).valor_total),
          payment_method: payment_method || 'outros',
          payment_status: payment_status || 'pending',
          purchase_date: today,
          due_date: finalDueDate,
          bank_account_id: bank_account_id || null,
          cost_center_id: cost_center_id || null,
          notes: `Convertido do orçamento: ${(budget as Record<string, unknown>).titulo}${(budget as Record<string, unknown>).observacoes ? '\n' + (budget as Record<string, unknown>).observacoes : ''}`,
          created_by: user.id,
        }).select().single();

        if (purchaseErr || !purchase) return new Response(JSON.stringify({ error: extractErrorMessage(purchaseErr) }), { status: 500, headers: corsHeaders });

        const budgetItems = ((budget as Record<string, unknown>).items ?? []) as Array<{ descricao: string; quantidade: number; unidade: string; valor_unitario: number; valor_total?: number }>;
        if (budgetItems.length > 0) {
          const purchaseItems = budgetItems.map(item => ({
            tenant_id,
            purchase_id: (purchase as Record<string, unknown>).id,
            name: item.descricao,
            quantity: Number(item.quantidade),
            unit: item.unidade || 'un',
            unit_price: Number(item.valor_unitario),
            total_price: Number(item.valor_total ?? item.quantidade * item.valor_unitario),
          }));
          await supabase.from('fin_purchase_items').insert(purchaseItems);
        }

        await supabase.from('fin_budgets').update({
          status: 'convertido',
          converted_to_purchase_id: (purchase as Record<string, unknown>).id,
          converted_at: new Date().toISOString(),
          converted_by: user.id,
        }).eq('id', budget_id).eq('tenant_id', tenant_id);

        if ((payment_status || 'pending') !== 'paid') {
          await supabase.from('fin_accounts_payable').insert({
            tenant_id,
            supplier: (budget as Record<string, unknown>).fornecedor || 'Fornecedor não informado',
            description: `Compra - ${(budget as Record<string, unknown>).fornecedor || (budget as Record<string, unknown>).titulo} (via Orçamento)`,
            amount: Number((budget as Record<string, unknown>).valor_total),
            due_date: finalDueDate,
            status: 'pending',
            category: 'Compras',
            bank_account_id: bank_account_id || null,
            cost_center_id: cost_center_id || null,
            reference_id: (purchase as Record<string, unknown>).id,
            reference_type: 'purchase',
            notes: `Gerado automaticamente a partir do orçamento: ${(budget as Record<string, unknown>).titulo}`,
          });
        } else {
          await supabase.from('fin_cash_flow').insert({
            tenant_id, type: 'expense',
            amount: Number((budget as Record<string, unknown>).valor_total),
            description: `Compra - ${(budget as Record<string, unknown>).fornecedor || (budget as Record<string, unknown>).titulo}`,
            category: 'Compras', origin: 'auto_purchase',
            reference_id: (purchase as Record<string, unknown>).id, date: today,
          });
          if (bank_account_id) {
            await supabase.rpc('fn_bank_debit', {
              p_bank_account_id: bank_account_id,
              p_amount: Number((budget as Record<string, unknown>).valor_total),
              p_description: `Compra - ${(budget as Record<string, unknown>).fornecedor || (budget as Record<string, unknown>).titulo}`,
              p_reference_type: 'purchase',
              p_reference_id: (purchase as Record<string, unknown>).id,
              p_transaction_date: today,
            });
          }
        }

        result = { data: { purchase_id: (purchase as Record<string, unknown>).id, purchase } };
        break;
      }

      // ── Bank Account manual transaction ───────────────────────────────────
      case 'bank_manual_transaction': {
        const { bank_account_id, type, amount, description, transaction_date } = payload;
        if (type === 'debit') {
          await supabase.rpc('fn_bank_debit', {
            p_bank_account_id: bank_account_id,
            p_amount: amount,
            p_description: description,
            p_reference_type: 'manual',
            p_reference_id: null,
            p_transaction_date: transaction_date || new Date().toISOString().split('T')[0],
          });
        } else {
          await supabase.rpc('fn_bank_credit', {
            p_bank_account_id: bank_account_id,
            p_amount: amount,
            p_description: description,
            p_reference_type: 'manual',
            p_reference_id: null,
            p_transaction_date: transaction_date || new Date().toISOString().split('T')[0],
          });
        }
        result = { data: { ok: true } };
        break;
      }

      // ── Reconciliation Rules ──────────────────────────────────────────────
      case 'list_reconciliation_rules': {
        const { data: rulesData, error: rulesErr } = await supabase
          .from('fin_reconciliation_rules')
          .select('*')
          .eq('tenant_id', tenant_id)
          .eq('is_active', true)
          .order('match_count', { ascending: false });
        if (rulesErr) {
          console.error('[list_reconciliation_rules] error:', rulesErr.message);
          return new Response(JSON.stringify({ error: extractErrorMessage(rulesErr) }), { status: 500, headers: corsHeaders });
        }
        return new Response(JSON.stringify({ data: rulesData ?? [] }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      case 'upsert_reconciliation_rule': {
        const { id, ...data } = payload;
        if (id) {
          result = await supabase
            .from('fin_reconciliation_rules')
            .update({ ...data, tenant_id })
            .eq('id', id)
            .eq('tenant_id', tenant_id)
            .select()
            .single();
        } else {
          result = await supabase
            .from('fin_reconciliation_rules')
            .insert({ ...data, tenant_id, match_count: 0 })
            .select()
            .single();
        }
        break;
      }

      case 'delete_reconciliation_rule': {
        result = await supabase
          .from('fin_reconciliation_rules')
          .delete()
          .eq('id', payload.id)
          .eq('tenant_id', tenant_id);
        break;
      }

      case 'increment_reconciliation_rule_count': {
        const { rule_id } = payload;
        const { data: currentRule } = await supabase
          .from('fin_reconciliation_rules')
          .select('match_count')
          .eq('id', rule_id)
          .eq('tenant_id', tenant_id)
          .maybeSingle();
        if (currentRule) {
          await supabase
            .from('fin_reconciliation_rules')
            .update({ match_count: ((currentRule as Record<string, unknown>).match_count as number ?? 0) + 1 })
            .eq('id', rule_id)
            .eq('tenant_id', tenant_id);
        }
        result = { data: { ok: true } };
        break;
      }

      // ── Statement Imports (Conciliation) ──────────────────────────────────
      case 'list_statement_imports': {
        const { bank_account_id, date_from, date_to, status: filterStatus } = payload ?? {};
        let query = supabase
          .from('fin_bank_statement_imports')
          .select('*')
          .eq('tenant_id', tenant_id)
          .order('transaction_date', { ascending: false })
          .order('created_at', { ascending: false })
          .limit(500);
        if (bank_account_id) query = query.eq('bank_account_id', bank_account_id);
        if (date_from) query = query.gte('transaction_date', date_from);
        if (date_to) query = query.lte('transaction_date', date_to);
        if (filterStatus && filterStatus !== 'ignored') query = query.neq('status', 'ignored');
        const { data, error } = await query;
        if (error) {
          console.error('[list_statement_imports] error:', error.message);
          return new Response(JSON.stringify({ error: extractErrorMessage(error) }), { status: 500, headers: corsHeaders });
        }
        return new Response(JSON.stringify({ data: data ?? [] }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      case 'list_statement_imports_external_ids': {
        const { bank_account_id } = payload ?? {};
        const { data, error } = await supabase
          .from('fin_bank_statement_imports')
          .select('external_id')
          .eq('tenant_id', tenant_id)
          .eq('bank_account_id', bank_account_id);
        if (error) {
          console.error('[list_statement_imports_external_ids] error:', error.message);
          return new Response(JSON.stringify({ error: extractErrorMessage(error) }), { status: 500, headers: corsHeaders });
        }
        return new Response(JSON.stringify({ data: data ?? [] }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      case 'update_statement_import': {
        const { id, ...updates } = payload;
        result = await supabase
          .from('fin_bank_statement_imports')
          .update({ ...updates })
          .eq('id', id)
          .eq('tenant_id', tenant_id)
          .select()
          .single();
        break;
      }

      case 'upsert_statement_import': {
        const { id, ...data } = payload;
        if (id) {
          result = await supabase
            .from('fin_bank_statement_imports')
            .update({ ...data, tenant_id })
            .eq('id', id)
            .eq('tenant_id', tenant_id)
            .select()
            .single();
        } else {
          result = await supabase
            .from('fin_bank_statement_imports')
            .insert({ ...data, tenant_id })
            .select()
            .single();
        }
        break;
      }

      case 'bulk_insert_statement_imports': {
        const { items } = payload as { items: Record<string, unknown>[] };
        if (!items || items.length === 0) {
          result = { data: [] };
          break;
        }
        const withTenant = items.map(item => ({ ...item, tenant_id }));
        result = await supabase
          .from('fin_bank_statement_imports')
          .upsert(withTenant, { onConflict: 'tenant_id,bank_account_id,external_id', ignoreDuplicates: true })
          .select();
        break;
      }

      case 'delete_statement_import': {
        result = await supabase
          .from('fin_bank_statement_imports')
          .delete()
          .eq('id', payload.id)
          .eq('tenant_id', tenant_id);
        break;
      }

      case 'clear_statement_imports': {
        const { bank_account_id } = payload;
        result = await supabase
          .from('fin_bank_statement_imports')
          .delete()
          .eq('tenant_id', tenant_id)
          .eq('bank_account_id', bank_account_id);
        break;
      }

      // ── Purchase Catalog ──────────────────────────────────────────────────
      case 'list_purchase_catalog': {
        const { data, error } = await supabase
          .from('fin_purchase_catalog')
          .select('*')
          .eq('tenant_id', tenant_id)
          .eq('is_active', true)
          .order('name');
        if (error) {
          console.error('[list_purchase_catalog] error:', error.message);
          return new Response(JSON.stringify({ error: extractErrorMessage(error) }), { status: 500, headers: corsHeaders });
        }
        return new Response(JSON.stringify({ data: data ?? [] }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      case 'upsert_purchase_catalog': {
        const { id, ...data } = payload;
        if (id) {
          result = await supabase.from('fin_purchase_catalog').update({ ...data, tenant_id }).eq('id', id).eq('tenant_id', tenant_id).select().single();
        } else {
          result = await supabase.from('fin_purchase_catalog').insert({ ...data, tenant_id }).select().single();
        }
        break;
      }

      case 'delete_purchase_catalog': {
        result = await supabase.from('fin_purchase_catalog').update({ is_active: false }).eq('id', payload.id).eq('tenant_id', tenant_id);
        break;
      }

      // ── Bulk Templates (Import/Export cross-tenant) ───────────────────────
      case 'bulk_insert_ingredients': {
        const { items } = payload as { items: Array<Record<string, unknown>> };
        if (!items || items.length === 0) {
          result = { data: [] };
          break;
        }
        const insertData = items.map((item) => ({
          tenant_id,
          name: item.nome ?? item.name ?? 'Sem nome',
          unit: (item.unidade ?? 'un') as string,
          category: (item.categoria ?? '') as string,
          min_stock: Number(item.estoque_minimo ?? item.min_stock ?? 0),
          supplier: (item.fornecedor ?? item.supplier ?? '') as string,
          purchase_unit: (item.purchase_unit ?? null) as string | null,
          purchase_factor: Number(item.purchase_factor ?? 1),
          unit_price: 0,
          current_stock: 0,
          is_depleted: false,
        }));
        const { data: inserted, error: insertErr } = await supabase
          .from('ingredients')
          .insert(insertData)
          .select();
        if (insertErr) {
          console.error('[bulk_insert_ingredients] error:', insertErr.message);
          return new Response(JSON.stringify({ error: extractErrorMessage(insertErr) }), { status: 500, headers: corsHeaders });
        }
        result = { data: inserted ?? [] };
        break;
      }

      case 'bulk_insert_dre_categories': {
        const { items } = payload as { items: Array<Record<string, unknown>> };
        if (!items || items.length === 0) {
          result = { data: [] };
          break;
        }
        const idMap: Record<string, string> = {};
        const insertData = items.map((item, idx) => ({
          tenant_id,
          name: (item.name ?? 'Sem nome') as string,
          group_type: (item.group_type ?? 'expense') as string,
          sort_order: Number(item.sort_order ?? idx),
          parent_id: null as string | null,
          is_active: true,
        }));
        const { data: inserted, error: insertErr } = await supabase
          .from('fin_dre_categories')
          .insert(insertData)
          .select();
        if (insertErr) {
          console.error('[bulk_insert_dre_categories] error:', insertErr.message);
          return new Response(JSON.stringify({ error: extractErrorMessage(insertErr) }), { status: 500, headers: corsHeaders });
        }
        for (let i = 0; i < items.length; i++) {
          const originalId = items[i].id as string | undefined;
          if (originalId && inserted && inserted[i]) {
            idMap[originalId] = (inserted[i] as Record<string, unknown>).id as string;
          }
        }
        if (inserted && inserted.length > 0) {
          for (let i = 0; i < items.length; i++) {
            const originalParentId = items[i].parent_id as string | null | undefined;
            if (originalParentId && idMap[originalParentId]) {
              await supabase
                .from('fin_dre_categories')
                .update({ parent_id: idMap[originalParentId] })
                .eq('id', (inserted[i] as Record<string, unknown>).id as string)
                .eq('tenant_id', tenant_id);
            }
          }
        }
        result = { data: inserted ?? [] };
        break;
      }

      case 'bulk_insert_purchase_catalog': {
        const { items } = payload as { items: Array<Record<string, unknown>> };
        if (!items || items.length === 0) {
          result = { data: [] };
          break;
        }
        const insertData = items.map((item) => ({
          tenant_id,
          name: (item.name ?? 'Sem nome') as string,
          description: (item.description ?? null) as string | null,
          default_unit: (item.default_unit ?? 'un') as string,
          dre_category_id: (item.dre_category_id ?? null) as string | null,
          default_supplier: (item.default_supplier ?? null) as string | null,
          supplier_id: (item.supplier_id ?? null) as string | null,
          notes: (item.notes ?? null) as string | null,
          is_active: true,
          sort_order: 0,
        }));
        const { data: inserted, error: insertErr } = await supabase
          .from('fin_purchase_catalog')
          .insert(insertData)
          .select();
        if (insertErr) {
          console.error('[bulk_insert_purchase_catalog] error:', insertErr.message);
          return new Response(JSON.stringify({ error: extractErrorMessage(insertErr) }), { status: 500, headers: corsHeaders });
        }
        result = { data: inserted ?? [] };
        break;
      }

      // ── Payroll ───────────────────────────────────────────────────────────
      // ── RH: campos customizados da folha ──────────────────────────────────
      // Migrado do front. O update/delete direto filtrava SÓ por id (sem
      // tenant_id), dependendo inteiramente da RLS — que neste projeto resolve
      // o tenant com LIMIT 1 sobre user_tenants e é frágil para multi-loja.
      case 'upsert_payroll_custom_field': {
        const { id, ...data } = payload as Record<string, unknown> & { id?: string };
        const record = { ...data, tenant_id, updated_at: new Date().toISOString() };
        if (id) {
          result = await supabase.from('hr_payroll_custom_fields')
            .update(record).eq('id', id).eq('tenant_id', tenant_id).select().maybeSingle();
        } else {
          result = await supabase.from('hr_payroll_custom_fields')
            .insert(record).select().maybeSingle();
        }
        if (result?.error) {
          return new Response(JSON.stringify({ error: extractErrorMessage(result.error) }), { status: 500, headers: corsHeaders });
        }
        break;
      }

      case 'delete_payroll_custom_field': {
        const { id } = payload as { id?: string };
        if (!id) return new Response(JSON.stringify({ error: 'id required' }), { status: 400, headers: corsHeaders });
        // Soft delete, escopado por tenant
        result = await supabase.from('hr_payroll_custom_fields')
          .update({ is_active: false, updated_at: new Date().toISOString() })
          .eq('id', id).eq('tenant_id', tenant_id);
        if (result?.error) {
          return new Response(JSON.stringify({ error: extractErrorMessage(result.error) }), { status: 500, headers: corsHeaders });
        }
        break;
      }

      // ── RH: Funcionários (hr_employees) ──────────────────────────────────
      // Escritas migradas do client: a RLS *_auth_uid resolve o tenant com
      // LIMIT 1 sobre user_tenants (sem ORDER BY) e falha silenciosamente
      // para admin multi-loja. Aqui tudo é escopado explicitamente por tenant.
      case 'upsert_employee': {
        const { id, tenant_id: _t, created_at: _c, updated_at: _u, ...data } =
          (payload ?? {}) as Record<string, unknown> & { id?: string };
        const record = { ...data, tenant_id, updated_at: new Date().toISOString() };
        if (id) {
          result = await supabase.from('hr_employees')
            .update(record).eq('id', id).eq('tenant_id', tenant_id).select().maybeSingle();
          if (!result?.error && !result?.data) {
            return new Response(JSON.stringify({ error: 'Funcionário não encontrado neste estabelecimento' }), { status: 404, headers: corsHeaders });
          }
        } else {
          result = await supabase.from('hr_employees')
            .insert(record).select().maybeSingle();
        }
        if (result?.error) {
          console.error('[upsert_employee] error:', extractErrorMessage(result.error));
          return new Response(JSON.stringify({ error: extractErrorMessage(result.error) }), { status: 500, headers: corsHeaders });
        }
        break;
      }

      case 'delete_employee': {
        const { id } = (payload ?? {}) as { id?: string };
        if (!id) return new Response(JSON.stringify({ error: 'id required' }), { status: 400, headers: corsHeaders });
        // Soft delete: mantém histórico, apenas inativa
        result = await supabase.from('hr_employees')
          .update({ status: 'inactive', updated_at: new Date().toISOString() })
          .eq('id', id).eq('tenant_id', tenant_id);
        if (result?.error) {
          console.error('[delete_employee] error:', extractErrorMessage(result.error));
          return new Response(JSON.stringify({ error: extractErrorMessage(result.error) }), { status: 500, headers: corsHeaders });
        }
        break;
      }

      case 'update_employee_vacation':
      case 'update_employee_thirteenth': {
        const { id, ...rest } = (payload ?? {}) as Record<string, unknown> & { id?: string };
        if (!id) return new Response(JSON.stringify({ error: 'id required' }), { status: 400, headers: corsHeaders });
        const allowed = action === 'update_employee_vacation'
          ? ['vacation_start_date', 'vacation_end_date', 'next_vacation_date', 'vacation_days_taken', 'vacation_days_per_year', 'status']
          : ['thirteenth_status', 'thirteenth_first_paid_date', 'thirteenth_second_paid_date'];
        const data: Record<string, unknown> = {};
        for (const key of allowed) {
          if (key in rest) data[key] = rest[key];
        }
        if (Object.keys(data).length === 0) {
          return new Response(JSON.stringify({ error: 'Nenhum campo válido informado' }), { status: 400, headers: corsHeaders });
        }
        result = await supabase.from('hr_employees')
          .update({ ...data, updated_at: new Date().toISOString() })
          .eq('id', id).eq('tenant_id', tenant_id);
        if (result?.error) {
          console.error(`[${action}] error:`, extractErrorMessage(result.error));
          return new Response(JSON.stringify({ error: extractErrorMessage(result.error) }), { status: 500, headers: corsHeaders });
        }
        break;
      }

      // ── RH: Folha (hr_payroll) ───────────────────────────────────────────
      case 'upsert_payroll': {
        const { id, tenant_id: _t, created_at: _c, updated_at: _u, ...data } =
          (payload ?? {}) as Record<string, unknown> & { id?: string };
        // Remove chaves indefinidas/nulas-de-transporte (o JSON já dropa undefined)
        const clean = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined));
        const record = { ...clean, tenant_id, updated_at: new Date().toISOString() };
        if (id) {
          result = await supabase.from('hr_payroll')
            .update(record).eq('id', id).eq('tenant_id', tenant_id).select().maybeSingle();
          if (!result?.error && !result?.data) {
            return new Response(JSON.stringify({ error: 'Lançamento de folha não encontrado neste estabelecimento' }), { status: 404, headers: corsHeaders });
          }
        } else {
          result = await supabase.from('hr_payroll')
            .insert(record).select().maybeSingle();
        }
        if (result?.error) {
          console.error('[upsert_payroll] error:', extractErrorMessage(result.error));
          return new Response(JSON.stringify({ error: extractErrorMessage(result.error) }), { status: 500, headers: corsHeaders });
        }
        break;
      }

      case 'delete_payroll': {
        const { id } = (payload ?? {}) as { id?: string };
        if (!id) return new Response(JSON.stringify({ error: 'id required' }), { status: 400, headers: corsHeaders });
        result = await supabase.from('hr_payroll')
          .delete().eq('id', id).eq('tenant_id', tenant_id);
        if (result?.error) {
          console.error('[delete_payroll] error:', extractErrorMessage(result.error));
          return new Response(JSON.stringify({ error: extractErrorMessage(result.error) }), { status: 500, headers: corsHeaders });
        }
        break;
      }

      case 'bulk_insert_payroll': {
        const { records } = (payload ?? {}) as { records?: Record<string, unknown>[] };
        if (!Array.isArray(records) || records.length === 0) {
          return new Response(JSON.stringify({ error: 'Nenhum registro informado' }), { status: 400, headers: corsHeaders });
        }
        const now = new Date().toISOString();
        const rows = records.map((r) => {
          const { id: _i, tenant_id: _t, created_at: _c, updated_at: _u, ...data } =
            r as Record<string, unknown> & { id?: string };
          const clean = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined));
          return { ...clean, tenant_id, updated_at: now };
        });
        result = await supabase.from('hr_payroll').insert(rows).select('id');
        if (result?.error) {
          console.error('[bulk_insert_payroll] error:', extractErrorMessage(result.error));
          return new Response(JSON.stringify({ error: extractErrorMessage(result.error) }), { status: 500, headers: corsHeaders });
        }
        result = { data: { inserted: (result?.data as unknown[] | null)?.length ?? 0 } };
        break;
      }

      case 'pay_payroll': {
        const { id, paid_date, payment_method } = payload;
        const { data: entry, error: fetchErr } = await supabase
          .from('hr_payroll')
          .select('id, employee_name, net_salary, entry_type, reference_month')
          .eq('id', id)
          .eq('tenant_id', tenant_id)
          .maybeSingle();
        if (fetchErr || !entry) {
          return new Response(JSON.stringify({ error: 'Lançamento não encontrado' }), { status: 404, headers: corsHeaders });
        }
        const { error: updateErr } = await supabase
          .from('hr_payroll')
          .update({ status: 'paid', paid_date, payment_method, updated_at: new Date().toISOString() })
          .eq('id', id)
          .eq('tenant_id', tenant_id);
        if (updateErr) {
          console.error('[pay_payroll] Erro ao atualizar:', updateErr.message);
          return new Response(JSON.stringify({ error: extractErrorMessage(updateErr) }), { status: 500, headers: corsHeaders });
        }
        const typeLabel: Record<string, string> = {
          regular: 'Folha de Pagamento',
          thirteenth_first: '13º Salário (1ª Parcela)',
          thirteenth_second: '13º Salário (2ª Parcela)',
          vacation_pay: 'Férias',
        };
        const entryTypeKey = (entry as Record<string, unknown>).entry_type as string ?? 'regular';
        const category = typeLabel[entryTypeKey] ?? 'Folha de Pagamento';
        const employeeName = (entry as Record<string, unknown>).employee_name as string ?? '';
        const netSalary = Number((entry as Record<string, unknown>).net_salary ?? 0);
        const refMonth = (entry as Record<string, unknown>).reference_month as string ?? '';
        await supabase.from('fin_cash_flow').insert({
          tenant_id,
          type: 'expense',
          amount: netSalary,
          description: `${category} — ${employeeName} (${refMonth})`,
          category: 'Folha de Pagamento',
          origin: 'auto_payroll',
          reference_id: id,
          date: paid_date,
        });
        result = { data: { id, status: 'paid' } };
        break;
      }

      case 'pay_all_payroll': {
        const { ids, paid_date, payment_method } = payload;
        if (!ids || ids.length === 0) {
          return new Response(JSON.stringify({ error: 'Nenhum ID informado' }), { status: 400, headers: corsHeaders });
        }
        const { data: entries, error: fetchErr } = await supabase
          .from('hr_payroll')
          .select('id, employee_name, net_salary, entry_type, reference_month')
          .in('id', ids)
          .eq('tenant_id', tenant_id);
        if (fetchErr || !entries || entries.length === 0) {
          return new Response(JSON.stringify({ error: 'Lançamentos não encontrados' }), { status: 404, headers: corsHeaders });
        }
        const { error: updateErr } = await supabase
          .from('hr_payroll')
          .update({ status: 'paid', paid_date, payment_method, updated_at: new Date().toISOString() })
          .in('id', ids)
          .eq('tenant_id', tenant_id);
        if (updateErr) {
          console.error('[pay_all_payroll] Erro ao atualizar:', updateErr.message);
          return new Response(JSON.stringify({ error: extractErrorMessage(updateErr) }), { status: 500, headers: corsHeaders });
        }
        const totalNet = (entries as Array<{ net_salary: number }>).reduce((s, e) => s + Number(e.net_salary), 0);
        const month = (entries[0] as Record<string, unknown>).reference_month as string ?? '';
        await supabase.from('fin_cash_flow').insert({
          tenant_id,
          type: 'expense',
          amount: totalNet,
          description: `Folha de Pagamento — ${(entries as Array<{ employee_name: string }>).length} funcionário(s) (${month})`,
          category: 'Folha de Pagamento',
          origin: 'auto_payroll',
          reference_id: (entries[0] as Record<string, unknown>).id as string,
          date: paid_date,
        });
        result = { data: { updated: ids.length, total: totalNet } };
        break;
      }

      default:
        return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), { status: 400, headers: corsHeaders });
    }

    if (result?.error) {
      console.error(`[financial-write] ${action} error:`, JSON.stringify(result.error));
      return new Response(JSON.stringify({ error: extractErrorMessage(result.error) }), { status: 500, headers: corsHeaders });
    }

    return new Response(JSON.stringify({ data: result?.data ?? null }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (err) {
    console.error('[financial-write] Unexpected error:', err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: corsHeaders });
  }
});
