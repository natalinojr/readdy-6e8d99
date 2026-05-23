import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

serve(async (req) => {
  const origin = req.headers.get("origin") || "";

  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      },
    });
  }

  let body = {};
  try {
    body = await req.json();
  } catch (_e) {
    body = {};
  }

  const ip = body.ip;
  const port = Number(body.port) || 9100;

  if (!ip || typeof ip !== "string") {
    return new Response(
      JSON.stringify({ error: "IP é obrigatório" }),
      {
        status: 400,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": origin,
        },
      },
    );
  }

  const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
  if (!ipv4Regex.test(ip)) {
    return new Response(
      JSON.stringify({ error: "Formato de IP inválido" }),
      {
        status: 400,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": origin,
        },
      },
    );
  }

  const start = performance.now();
  let online = false;
  let responseTimeMs = 0;
  let error = null;

  try {
    const conn = await Deno.connect({ hostname: ip, port, transport: "tcp" });
    conn.close();
    online = true;
    responseTimeMs = Math.round(performance.now() - start);
  } catch (e) {
    error = e.message;
    responseTimeMs = Math.round(performance.now() - start);
    if (error && error.includes("Connection refused")) {
      online = true;
    }
  }

  return new Response(
    JSON.stringify({ ip, port, online, responseTimeMs, error }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": origin,
      },
    },
  );
});
