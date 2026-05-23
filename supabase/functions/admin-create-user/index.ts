import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const ADMIN_EMAIL = 'natalinojr.engel@gmail.com';

    const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Verifica se quem está chamando é o admin master
    const authHeader = req.headers.get('Authorization') ?? '';
    const token = authHeader.replace('Bearer ', '');
    const { data: { user: caller }, error: callerErr } = await adminClient.auth.getUser(token);
    if (callerErr || !caller) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (caller.email !== ADMIN_EMAIL) {
      return new Response(JSON.stringify({ error: 'Forbidden — apenas admin master pode criar usuários' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json() as {
      nome: string;
      email: string;
      senha: string;
      nickname?: string;
      invite_code?: string;
    };

    const { nome, email, senha, nickname, invite_code } = body;

    if (!nome || !email || !senha) {
      return new Response(JSON.stringify({ error: 'nome, email e senha são obrigatórios' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 1. Verifica se e-mail já existe
    const { data: existing } = await adminClient.auth.admin.listUsers({ perPage: 1000 });
    const alreadyExists = existing?.users?.some(u => u.email?.toLowerCase() === email.toLowerCase().trim());
    if (alreadyExists) {
      return new Response(JSON.stringify({ error: 'Já existe uma conta com esse e-mail.' }), {
        status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 2. Cria o usuário no Auth
    const { data: newUser, error: createErr } = await adminClient.auth.admin.createUser({
      email: email.toLowerCase().trim(),
      password: senha,
      email_confirm: true,
      user_metadata: { nome, name: nome.trim() },
    });

    if (createErr || !newUser?.user) {
      return new Response(JSON.stringify({ error: createErr?.message ?? 'Erro ao criar usuário' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const userId = newUser.user.id;

    // 3. Aguarda o trigger processar e atualiza name + nickname
    await new Promise(resolve => setTimeout(resolve, 200));

    const updatePayload: Record<string, unknown> = { name: nome.trim() };
    if (nickname && nickname.trim()) updatePayload.nickname = nickname.trim();

    await adminClient
      .from('users')
      .update(updatePayload)
      .eq('id', userId);

    // 4. Se tiver invite_code, anota reserva no convite
    if (invite_code) {
      const { data: invite } = await adminClient
        .from('store_invites')
        .select('id, used_at')
        .eq('invite_code', invite_code)
        .maybeSingle();

      if (invite && !invite.used_at) {
        await adminClient
          .from('store_invites')
          .update({
            notes: `Reservado para: ${email.toLowerCase().trim()} (usuário criado pelo admin, aguardando onboarding)`,
          })
          .eq('id', invite.id);
      }
    }

    return new Response(JSON.stringify({
      success: true,
      user_id: userId,
      email: email.toLowerCase().trim(),
      nome: nome.trim(),
      nickname: nickname?.trim() ?? null,
    }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
