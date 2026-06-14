const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-internal-token",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function requiredEnv(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`Missing env var: ${name}`);
  return value;
}

function normalizeWhatsAppPhone(rawPhone: unknown): string | null {
  const digits = String(rawPhone ?? "").replace(/\D/g, "");
  if (!digits) return null;

  if (digits.startsWith("55") && digits.length >= 12 && digits.length <= 13) {
    return digits;
  }

  if (digits.length === 10 || digits.length === 11) {
    return `55${digits}`;
  }

  return null;
}

function firstName(name: unknown): string {
  const clean = String(name ?? "cliente").trim();
  return clean.split(/\s+/)[0] || "cliente";
}

function moneyBRL(value: unknown): string {
  const number = Number(value ?? 0);
  return `R$ ${number.toFixed(2).replace(".", ",")}`;
}

async function sendTemplate(params: {
  to: string;
  templateName: string;
  languageCode: string;
  bodyParams?: string[];
}) {
  const accessToken = requiredEnv("META_WHATSAPP_ACCESS_TOKEN");
  const phoneNumberId = requiredEnv("META_WHATSAPP_PHONE_NUMBER_ID");

  const components = params.bodyParams && params.bodyParams.length > 0
    ? [
        {
          type: "body",
          parameters: params.bodyParams.map((text) => ({
            type: "text",
            text,
          })),
        },
      ]
    : undefined;

  const response = await fetch(
    `https://graph.facebook.com/v20.0/${phoneNumberId}/messages`,
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: params.to,
        type: "template",
        template: {
          name: params.templateName,
          language: { code: params.languageCode },
          ...(components ? { components } : {}),
        },
      }),
    },
  );

  const responseBody = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error("[whatsapp-send] Meta error:", response.status, responseBody);
    return {
      ok: false,
      status: response.status,
      error: responseBody,
    };
  }

  return {
    ok: true,
    status: response.status,
    data: responseBody,
  };
}

Deno.serve({ verify_jwt: false }, async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const internalToken = Deno.env.get("WHATSAPP_INTERNAL_TOKEN")?.trim();
    if (internalToken) {
      const providedToken = req.headers.get("x-internal-token")?.trim();
      if (providedToken !== internalToken) return json({ error: "Unauthorized" }, 401);
    }

    const body = await req.json();
    const action = body.action;

    if (action === "delivery_order_created") {
      const to = normalizeWhatsAppPhone(body.customer_phone);
      if (!to) return json({ ok: false, skipped: true, reason: "invalid_phone" }, 200);

      const templateName = Deno.env.get("WHATSAPP_TEMPLATE_ORDER_CREATED")?.trim() || "pedido_recebido_delivery";
      const languageCode = Deno.env.get("WHATSAPP_TEMPLATE_LANGUAGE")?.trim() || "pt_BR";

      const result = await sendTemplate({
        to,
        templateName,
        languageCode,
        bodyParams: [
          firstName(body.customer_name),
          String(body.order_number ?? ""),
          moneyBRL(body.total_amount),
        ],
      });

      return json(result, result.ok ? 200 : 502);
    }

    if (action === "send_template") {
      const to = normalizeWhatsAppPhone(body.to);
      if (!to) return json({ error: "Invalid phone" }, 400);
      if (!body.template_name) return json({ error: "template_name is required" }, 400);

      const result = await sendTemplate({
        to,
        templateName: String(body.template_name),
        languageCode: String(body.language_code || "pt_BR"),
        bodyParams: Array.isArray(body.body_params)
          ? body.body_params.map((p: unknown) => String(p ?? ""))
          : [],
      });

      return json(result, result.ok ? 200 : 502);
    }

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (err) {
    console.error("[whatsapp-send] Error:", err);
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
