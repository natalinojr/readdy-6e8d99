import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // Verify caller is admin master
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const token = authHeader.replace('Bearer ', '');
    const { data: { user: callerUser }, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !callerUser) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const ADMIN_MASTER_EMAIL = 'natalinojr.engel@gmail.com';
    if (callerUser.email !== ADMIN_MASTER_EMAIL) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const body = await req.json();
    const { action, user_id, email, senha, nome, nickname, is_active } = body;

    if (!action || !user_id) {
      return new Response(JSON.stringify({ error: 'action e user_id são obrigatórios' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ── UPDATE (email / senha / nome / nickname) ─────────────────────────────
    if (action === 'update') {
      const authUpdates: Record<string, string> = {};
      if (email) authUpdates.email = email.trim().toLowerCase();
      if (senha) authUpdates.password = senha;

      if (Object.keys(authUpdates).length > 0) {
        const { error: authUpdateError } = await supabaseAdmin.auth.admin.updateUserById(user_id, authUpdates);
        if (authUpdateError) throw new Error(`Erro ao atualizar auth: ${authUpdateError.message}`);
      }

      const publicUpdates: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (email) publicUpdates.email = email.trim().toLowerCase();
      if (nome) publicUpdates.name = nome.trim();
      // nickname pode ser string vazia para limpar o apelido
      if (nickname !== undefined) publicUpdates.nickname = nickname?.trim() || null;

      const { error: publicError } = await supabaseAdmin
        .from('users')
        .update(publicUpdates)
        .eq('id', user_id);
      if (publicError) throw new Error(`Erro ao atualizar usuário: ${publicError.message}`);

      return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ── TOGGLE ACTIVE (pausar / reativar) ────────────────────────────────────
    if (action === 'toggle_active') {
      // 1. Atualiza is_active na tabela pública
      const { error: toggleError } = await supabaseAdmin
        .from('users')
        .update({ is_active, updated_at: new Date().toISOString() })
        .eq('id', user_id);
      if (toggleError) throw new Error(`Erro ao alterar status: ${toggleError.message}`);

      // 2. Bane ou desbane no Supabase Auth (bloqueia novos logins)
      const { error: banError } = await supabaseAdmin.auth.admin.updateUserById(user_id, {
        ban_duration: is_active ? 'none' : '876000h', // 100 anos = pausa permanente
      });
      if (banError) throw new Error(`Erro ao alterar auth ban: ${banError.message}`);

      // 3. Se estiver PAUSANDO (is_active = false): invalida TODAS as sessões ativas imediatamente
      if (!is_active) {
        const { error: signOutError } = await supabaseAdmin.auth.admin.signOut(user_id, 'global');
        if (signOutError) {
          console.error(`[admin-manage-user] signOut global falhou: ${signOutError.message}`);
        }
      }

      return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ── DELETE ───────────────────────────────────────────────────────────────
    if (action === 'delete') {
      // 1. Invalida sessões ativas antes de deletar
      try {
        await supabaseAdmin.auth.admin.signOut(user_id, 'global');
      } catch {
        // Silencioso — pode não ter sessão ativa
      }

      // 2. Soft delete na tabela pública
      const { error: softDeleteError } = await supabaseAdmin
        .from('users')
        .update({ deleted_at: new Date().toISOString(), is_active: false, updated_at: new Date().toISOString() })
        .eq('id', user_id);
      if (softDeleteError) throw new Error(`Erro no soft delete: ${softDeleteError.message}`);

      // 3. Hard delete do Auth
      const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(user_id);
      if (deleteError) throw new Error(`Erro ao deletar auth user: ${deleteError.message}`);

      return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify({ error: 'Ação inválida' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
