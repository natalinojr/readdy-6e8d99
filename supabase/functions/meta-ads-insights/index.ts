const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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

const GRAPH_VERSION = "v20.0";

// Date presets aceitos pela Meta (evita injeção de valor inválido na URL)
const ALLOWED_DATE_PRESETS = new Set([
  "today",
  "yesterday",
  "last_3d",
  "last_7d",
  "last_14d",
  "last_30d",
  "this_week_mon_today",
  "last_week_mon_sun",
  "this_month",
  "last_month",
  "maximum",
]);

type MetaAction = { action_type?: string; value?: string };

// Extrai os "resultados" (conversões) do array de actions da Meta para uma forma simples
function simplifyActions(actions: unknown): Array<{ type: string; value: number }> {
  if (!Array.isArray(actions)) return [];
  return (actions as MetaAction[])
    .map((a) => ({
      type: String(a.action_type ?? ""),
      value: Number(a.value ?? 0),
    }))
    .filter((a) => a.type && a.value > 0);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const accessToken = requiredEnv("META_ACCESS_TOKEN");
    const adAccountId = requiredEnv("META_AD_ACCOUNT_ID"); // formato: act_123456789

    const body = await req.json().catch(() => ({}));

    // Diagnóstico: lista as permissões que o token realmente carrega
    if (body.debug === "permissions") {
      const permUrl =
        `https://graph.facebook.com/${GRAPH_VERSION}/me/permissions` +
        `?access_token=${encodeURIComponent(accessToken)}`;
      const permResp = await fetch(permUrl);
      const permBody = await permResp.json().catch(() => ({}));
      return json({ debug: "permissions", status: permResp.status, data: permBody });
    }

    const requested = String(body.date_preset ?? "last_7d");
    const datePreset = ALLOWED_DATE_PRESETS.has(requested) ? requested : "last_7d";

    const fields = [
      "campaign_name",
      "spend",
      "impressions",
      "reach",
      "clicks",
      "cpc",
      "ctr",
      "actions",
    ].join(",");

    const url =
      `https://graph.facebook.com/${GRAPH_VERSION}/${adAccountId}/insights` +
      `?level=campaign&fields=${fields}&date_preset=${datePreset}` +
      `&access_token=${encodeURIComponent(accessToken)}`;

    const response = await fetch(url);
    const responseBody = await response.json().catch(() => ({}));

    if (!response.ok) {
      console.error("[meta-ads-insights] Meta error:", response.status, responseBody);
      return json(
        {
          ok: false,
          status: response.status,
          error: responseBody?.error ?? responseBody,
        },
        502,
      );
    }

    const rows = Array.isArray(responseBody.data) ? responseBody.data : [];

    const campaigns = rows.map((row: Record<string, unknown>) => ({
      campaign: String(row.campaign_name ?? "(sem nome)"),
      spend: Number(row.spend ?? 0),
      impressions: Number(row.impressions ?? 0),
      reach: Number(row.reach ?? 0),
      clicks: Number(row.clicks ?? 0),
      cpc: Number(row.cpc ?? 0),
      ctr: Number(row.ctr ?? 0),
      results: simplifyActions(row.actions),
    }));

    return json({
      ok: true,
      date_preset: datePreset,
      count: campaigns.length,
      campaigns,
    });
  } catch (err) {
    console.error("[meta-ads-insights] Error:", err);
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
