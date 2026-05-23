import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ALERT_EMAIL = Deno.env.get('DIVERGENCE_ALERT_EMAIL') ?? '';
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? '';

interface DivergenciaRow {
  order_number: string;
  origin: string;
  order_status: string;
  subtotal_declarado: number;
  subtotal_real: number;
  divergencia_abs: number;
  qtd_itens: number;
  criado_em: string;
  tenant_id: string;
}

const ORIGEM_LABELS: Record<string, string> = {
  self_service: 'Autoatendimento',
  waiter: 'Garçom',
  cashier: 'Caixa',
  table: 'Mesa',
  delivery: 'Delivery',
};

function fmt(v: number): string {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

function buildEmailHtml(rows: DivergenciaRow[], totalDivergencia: number, semItens: number): string {
  const tableRows = rows.map((r) => `
    <tr style="border-bottom:1px solid #f0f0f0;">
      <td style="padding:8px 12px;font-weight:700;color:#111;">${r.order_number}</td>
      <td style="padding:8px 12px;color:#555;">${ORIGEM_LABELS[r.origin] ?? r.origin}</td>
      <td style="padding:8px 12px;color:#555;">${r.order_status}</td>
      <td style="padding:8px 12px;text-align:right;color:#111;">${fmt(r.subtotal_declarado)}</td>
      <td style="padding:8px 12px;text-align:right;color:#111;">${fmt(r.subtotal_real)}</td>
      <td style="padding:8px 12px;text-align:right;font-weight:700;color:${Number(r.divergencia_abs) > 50 ? '#dc2626' : '#d97706'};">${fmt(r.divergencia_abs)}</td>
      <td style="padding:8px 12px;text-align:center;color:#555;">${r.qtd_itens}</td>
      <td style="padding:8px 12px;color:#888;white-space:nowrap;">${fmtDate(r.criado_em)}</td>
    </tr>
  `).join('');

  return `
<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"><title>Alerta de Divergência de Pedidos</title></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f9f9f9;margin:0;padding:24px;">
  <div style="max-width:900px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e5e5e5;">
    
    <!-- Header -->
    <div style="background:#18181b;padding:24px 32px;display:flex;align-items:center;gap:12px;">
      <div style="width:36px;height:36px;background:#f59e0b;border-radius:8px;display:flex;align-items:center;justify-content:center;">
        <span style="color:#18181b;font-size:18px;">⚠</span>
      </div>
      <div>
        <h1 style="color:#fff;margin:0;font-size:18px;font-weight:800;">Alerta Semanal — Divergência de Pedidos</h1>
        <p style="color:#a1a1aa;margin:2px 0 0;font-size:13px;">ERPOS V2 · Verificação automática dos últimos 7 dias</p>
      </div>
    </div>

    <!-- Summary -->
    <div style="padding:24px 32px;border-bottom:1px solid #f0f0f0;">
      <div style="display:flex;gap:16px;flex-wrap:wrap;">
        <div style="flex:1;min-width:160px;background:#fef2f2;border:1px solid #fecaca;border-radius:10px;padding:16px;">
          <p style="margin:0;font-size:11px;color:#ef4444;font-weight:700;text-transform:uppercase;letter-spacing:.05em;">Pedidos com divergência</p>
          <p style="margin:4px 0 0;font-size:28px;font-weight:900;color:#dc2626;">${rows.length}</p>
        </div>
        <div style="flex:1;min-width:160px;background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:16px;">
          <p style="margin:0;font-size:11px;color:#d97706;font-weight:700;text-transform:uppercase;letter-spacing:.05em;">Divergência total</p>
          <p style="margin:4px 0 0;font-size:28px;font-weight:900;color:#b45309;">${fmt(totalDivergencia)}</p>
        </div>
        <div style="flex:1;min-width:160px;background:#fef2f2;border:1px solid #fecaca;border-radius:10px;padding:16px;">
          <p style="margin:0;font-size:11px;color:#ef4444;font-weight:700;text-transform:uppercase;letter-spacing:.05em;">Sem nenhum item</p>
          <p style="margin:4px 0 0;font-size:28px;font-weight:900;color:#dc2626;">${semItens}</p>
        </div>
      </div>
    </div>

    <!-- Table -->
    <div style="padding:24px 32px;">
      <h2 style="font-size:14px;font-weight:700;color:#111;margin:0 0 12px;">Detalhamento dos pedidos</h2>
      <div style="overflow-x:auto;">
        <table style="width:100%;border-collapse:collapse;font-size:13px;">
          <thead>
            <tr style="background:#f9f9f9;border-bottom:2px solid #e5e5e5;">
              <th style="padding:8px 12px;text-align:left;font-size:11px;color:#888;text-transform:uppercase;letter-spacing:.05em;">Pedido</th>
              <th style="padding:8px 12px;text-align:left;font-size:11px;color:#888;text-transform:uppercase;letter-spacing:.05em;">Origem</th>
              <th style="padding:8px 12px;text-align:left;font-size:11px;color:#888;text-transform:uppercase;letter-spacing:.05em;">Status</th>
              <th style="padding:8px 12px;text-align:right;font-size:11px;color:#888;text-transform:uppercase;letter-spacing:.05em;">Declarado</th>
              <th style="padding:8px 12px;text-align:right;font-size:11px;color:#888;text-transform:uppercase;letter-spacing:.05em;">Real</th>
              <th style="padding:8px 12px;text-align:right;font-size:11px;color:#ef4444;text-transform:uppercase;letter-spacing:.05em;">Divergência</th>
              <th style="padding:8px 12px;text-align:center;font-size:11px;color:#888;text-transform:uppercase;letter-spacing:.05em;">Itens</th>
              <th style="padding:8px 12px;text-align:left;font-size:11px;color:#888;text-transform:uppercase;letter-spacing:.05em;">Data</th>
            </tr>
          </thead>
          <tbody>${tableRows}</tbody>
        </table>
      </div>
    </div>

    <!-- SQL hint -->
    <div style="padding:0 32px 24px;">
      <div style="background:#f4f4f5;border-radius:8px;padding:14px 16px;">
        <p style="margin:0 0 6px;font-size:11px;font-weight:700;color:#71717a;text-transform:uppercase;letter-spacing:.05em;">Query de referência (Supabase SQL Editor)</p>
        <code style="font-size:12px;color:#3f3f46;line-height:1.6;">
          SELECT * FROM v_divergencia_totais<br>
          WHERE criado_em &gt;= NOW() - INTERVAL '7 days'<br>
          ORDER BY divergencia_abs DESC;
        </code>
      </div>
    </div>

    <!-- Footer -->
    <div style="background:#f9f9f9;border-top:1px solid #e5e5e5;padding:16px 32px;text-align:center;">
      <p style="margin:0;font-size:12px;color:#a1a1aa;">
        Este email foi gerado automaticamente pelo ERPOS V2 · Verificação semanal de integridade de pedidos
      </p>
    </div>
  </div>
</body>
</html>`;
}

Deno.serve(async (req: Request) => {
  // Aceita GET (cron) ou POST (manual trigger)
  if (req.method !== 'GET' && req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Consultar divergências dos últimos 7 dias
    const since = new Date();
    since.setDate(since.getDate() - 7);

    const { data, error } = await supabase
      .from('v_divergencia_totais')
      .select('*')
      .gte('criado_em', since.toISOString())
      .gt('divergencia_abs', 0)
      .order('divergencia_abs', { ascending: false });

    if (error) {
      console.error('Erro ao consultar v_divergencia_totais:', error);
      return new Response(JSON.stringify({ ok: false, error: error.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const rows = (data ?? []) as DivergenciaRow[];

    // Se não há divergências, retorna OK sem enviar email
    if (rows.length === 0) {
      console.log('Nenhuma divergência nos últimos 7 dias — sistema saudável.');
      return new Response(JSON.stringify({ ok: true, divergencias: 0, email_enviado: false }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const totalDivergencia = rows.reduce((s, r) => s + Number(r.divergencia_abs), 0);
    const semItens = rows.filter((r) => r.qtd_itens === 0).length;

    console.log(`Divergências encontradas: ${rows.length} pedidos, total ${totalDivergencia}`);

    // Enviar email via Resend (se configurado)
    let emailEnviado = false;
    let emailError: string | null = null;

    if (RESEND_API_KEY && ALERT_EMAIL) {
      const html = buildEmailHtml(rows, totalDivergencia, semItens);

      const resendRes = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: 'ERPOS V2 <alertas@erpos.app>',
          to: [ALERT_EMAIL],
          subject: `⚠ ERPOS — ${rows.length} pedido${rows.length !== 1 ? 's' : ''} com divergência nos últimos 7 dias`,
          html,
        }),
      });

      if (resendRes.ok) {
        emailEnviado = true;
        console.log('Email de alerta enviado com sucesso para', ALERT_EMAIL);
      } else {
        const resendBody = await resendRes.text();
        emailError = resendBody;
        console.error('Erro ao enviar email via Resend:', resendBody);
      }
    } else {
      console.warn('RESEND_API_KEY ou DIVERGENCE_ALERT_EMAIL não configurados — email não enviado.');
      emailError = 'Variáveis RESEND_API_KEY e DIVERGENCE_ALERT_EMAIL não configuradas nos secrets da edge function.';
    }

    return new Response(
      JSON.stringify({
        ok: true,
        divergencias: rows.length,
        total_divergencia: totalDivergencia,
        sem_itens: semItens,
        email_enviado: emailEnviado,
        email_error: emailError,
        pedidos: rows.map((r) => ({
          numero: r.order_number,
          origem: r.origin,
          divergencia: r.divergencia_abs,
          qtd_itens: r.qtd_itens,
        })),
      }),
      { headers: { 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    console.error('Erro inesperado:', err);
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
