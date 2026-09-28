// Leitura do print de uma compra online (2026-09-28, pedido do dono): quem pede tira print do
// checkout/carrinho (Mercado Livre, Shopee, Amazon…) e a IA devolve itens, desconto, frete e total.
// O link sozinho não dá valor nem quantidade (a API do ML recusa ler anúncio — 403).
// Modelo: Sonnet 5. Medido 2026-09-28 no print real do ML (R$ 158,26): o Haiku 4.5 errou os centavos
// sobrescritos do total em 3 de 3 (158,00 / 158,80; US$ 0,003); o Sonnet 5 acertou 3 de 3 (US$ 0,007).
// PRINT_COMPRA_MODEL (secret) troca sem deploy. Custo em ai_usage_events.
// deno-lint-ignore-file no-explicit-any
import Anthropic from 'npm:@anthropic-ai/sdk@0.125.0';
import { registrarUsoIa } from '../_shared/ai-usage.ts';

const MODEL = Deno.env.get('PRINT_COMPRA_MODEL') || 'claude-sonnet-5-5'; // 5.5 desde 2026-09-28
const TIPOS = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const MAX_BYTES = 8 * 1024 * 1024;

const numOuNull = { anyOf: [{ type: 'number' }, { type: 'null' }] };
const txtOuNull = { anyOf: [{ type: 'string' }, { type: 'null' }] };
const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['e_compra', 'site', 'itens', 'subtotal', 'desconto', 'frete', 'total', 'entrega', 'numero_pedido'],
  properties: {
    e_compra: { type: 'boolean', description: 'true se a imagem é carrinho, checkout, resumo ou confirmação de compra online' },
    site: txtOuNull,
    itens: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['descricao', 'quantidade', 'valor'],
        properties: {
          descricao: { type: 'string' },
          quantidade: { type: 'number' },
          valor: { ...numOuNull, description: 'valor da linha (já multiplicado pela quantidade), sem o desconto do resumo' },
        },
      },
    },
    subtotal: numOuNull,
    desconto: { ...numOuNull, description: 'desconto total, número positivo' },
    frete: { ...numOuNull, description: 'valor cobrado de frete (0 se grátis)' },
    total: { ...numOuNull, description: 'valor final a pagar' },
    entrega: { ...txtOuNull, description: 'endereço e/ou prazo de entrega, curto' },
    numero_pedido: { ...txtOuNull, description: 'nº do pedido, se já aparece' },
  },
};

const SISTEMA = `Você lê prints (capturas de tela) de compras em lojas online brasileiras — Mercado Livre, Shopee, Amazon, Magalu etc.
Devolva só o que está escrito na imagem. Valores em reais como número (R$ 158,25 → 158.25; centavos pequenos sobrescritos fazem parte do valor: "R$ 179⁸⁰" = 179.80).
Quando houver preço riscado e preço atual, use o atual. "Frete Grátis" = frete 0. O total é o valor final que será pago.
Nome do produto sem textos de propaganda ("OFERTA IMPERDÍVEL", "Mais vendido"). Inclua variação (cor, tamanho) se aparecer.
Se não for uma compra online, e_compra = false e o resto vazio/null.`;

export type PrintLido = {
  e_compra: boolean; site: string | null;
  itens: { descricao: string; quantidade: number; valor: number | null }[];
  subtotal: number | null; desconto: number | null; frete: number | null; total: number | null;
  entrega: string | null; numero_pedido: string | null;
};

export async function lerPrintCompra(admin: any, tenantId: string, userId: string, img: { base64?: string; media_type?: string }): Promise<{ lido?: PrintLido; erro?: string; status?: number }> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY') ?? '';
  if (!apiKey) return { erro: 'Leitura por IA não configurada no servidor.', status: 503 };
  const tipo = String(img?.media_type ?? 'image/jpeg').toLowerCase();
  const data = String(img?.base64 ?? '').replace(/^data:[^;]+;base64,/, '').replace(/\s/g, '');
  if (!data) return { erro: 'Envie o print da compra.' };
  if (!TIPOS.includes(tipo)) return { erro: 'O print precisa ser imagem (JPG/PNG).' };
  if (Math.floor(data.length * 3 / 4) > MAX_BYTES) return { erro: 'Imagem grande demais (máx. 8 MB).' };

  const client = new Anthropic({ apiKey });
  let res: any;
  try {
    res = await client.messages.create({
      model: MODEL,
      max_tokens: 2000,
      system: SISTEMA,
      output_config: { format: { type: 'json_schema', schema: SCHEMA } },
      messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: tipo as 'image/jpeg', data } },
        { type: 'text', text: 'Leia o print desta compra online.' },
      ] }],
    } as any);
    await registrarUsoIa(admin, { feature: 'leitura-print-compra', model: res.model, usage: res.usage, tenantId, userId });
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) return { erro: 'Muitas leituras ao mesmo tempo. Tente de novo em alguns segundos.', status: 429 };
    if (e instanceof Anthropic.BadRequestError && /credit balance|billing/i.test(String(e.message))) return { erro: 'Sem créditos na IA. Preencha à mão.', status: 402 };
    console.error('[pedidos-pagamento] ler_print', String((e as Error)?.message ?? e).slice(0, 400));
    return { erro: 'Não consegui ler o print agora. Tente de novo ou preencha à mão.', status: 502 };
  }
  if (res.stop_reason === 'refusal') return { erro: 'A leitura foi recusada para esta imagem.', status: 422 };
  const texto = (res.content ?? []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
  let lido: PrintLido;
  try { lido = JSON.parse(texto); } catch { return { erro: 'Não entendi o print. Preencha à mão.', status: 502 }; }
  if (!lido.e_compra) return { erro: 'Isso não parece o print de uma compra online. Tire o print da tela de finalizar a compra (com o total).' };
  const r2 = (n: any) => (typeof n === 'number' && Number.isFinite(n) ? Math.round(n * 100) / 100 : null);
  lido.itens = (lido.itens ?? []).filter((i) => i?.descricao).slice(0, 30)
    .map((i) => ({ descricao: String(i.descricao).trim().slice(0, 200), quantidade: i.quantidade > 0 ? i.quantidade : 1, valor: r2(i.valor) }));
  for (const k of ['subtotal', 'desconto', 'frete', 'total'] as const) lido[k] = r2(lido[k]);
  if (lido.desconto != null) lido.desconto = Math.abs(lido.desconto);
  // O total é o que vale (é o que sai da conta). O desconto em centavos sobrescritos é o que a IA mais
  // erra: com subtotal e total lidos, ele sai da conta (subtotal + frete − total).
  if (lido.subtotal != null && lido.total != null) {
    const calc = Math.round((lido.subtotal + (lido.frete ?? 0) - lido.total) * 100) / 100;
    if (calc >= 0 && (lido.desconto == null ? calc > 0 : Math.abs(calc - lido.desconto) > 0.009)) lido.desconto = calc > 0 ? calc : null;
  }
  return { lido };
}
