// Leitura do boleto de benefício — VR, Alelo, Ticket… (2026-09-30, pedido do dono): o boleto vem
// sem o nome dos funcionários e, com mais de um, só no total. Aqui só se LÊ o boleto; a divisão por
// funcionário a pessoa faz na tela.
//
// Ordem (igual à contas-email): texto do PDF primeiro (copia os números exatos: linha digitável e
// Pix copia e cola); a IA lê o resto (nomes, datas, valor) e, em foto, também os números. Linha só
// vale se passar nos dígitos verificadores; Pix só se o CRC fechar — número inventado não passa.
// Modelo: Haiku 4.5 (campos grandes e impressos); sem valor lido, 2ª tentativa com o Sonnet 5.5.
// BENEFICIO_MODEL (secret) troca o 1º sem deploy. Custo em ai_usage_events ('leitura-boleto-beneficio').
// deno-lint-ignore-file no-explicit-any
import Anthropic from 'npm:@anthropic-ai/sdk@0.125.0';
import { registrarUsoIa } from '../_shared/ai-usage.ts';
import { textoDoPdf } from '../_shared/pdf-texto.ts';
import { findBoletos, tryDecodeBoleto } from '../_shared/boleto.ts';
import { acharCopiaECola, copiaValida, lerCopia } from '../_shared/guias.ts';

const MODEL = Deno.env.get('BENEFICIO_MODEL') || 'claude-haiku-4-5';
const MODEL_2 = 'claude-sonnet-5-5';
const IMAGENS = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const MAX_BYTES = 10 * 1024 * 1024;

const txtOuNull = { anyOf: [{ type: 'string' }, { type: 'null' }] };
const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['e_boleto', 'beneficiario', 'beneficiario_cnpj', 'pagador', 'valor', 'vencimento', 'numero_documento', 'produto', 'linha_digitavel', 'pix_copia_e_cola'],
  properties: {
    e_boleto: { type: 'boolean', description: 'true se é boleto, fatura ou cobrança (com linha digitável ou Pix)' },
    beneficiario: { ...txtOuNull, description: 'quem recebe (Beneficiário/Cedente), como impresso' },
    beneficiario_cnpj: { ...txtOuNull, description: 'CNPJ do beneficiário, só números. NUNCA o do pagador' },
    pagador: { ...txtOuNull, description: 'nome do pagador (sacado)' },
    valor: { anyOf: [{ type: 'number' }, { type: 'null' }], description: 'valor do documento em reais' },
    vencimento: { ...txtOuNull, description: 'AAAA-MM-DD' },
    numero_documento: { ...txtOuNull, description: 'Número do Documento / Nosso número' },
    produto: { ...txtOuNull, description: 'o que está sendo pago, curto (ex.: "Multi - Auxílio VR+VA")' },
    linha_digitavel: { ...txtOuNull, description: '47 ou 48 dígitos, só números, copiados exatamente; null se não houver ou não der para ler todos' },
    pix_copia_e_cola: { ...txtOuNull, description: 'o texto do "Pix Copia e Cola" (começa com 000201), exatamente; null se não houver' },
  },
};
const SISTEMA = `Você lê boletos brasileiros de benefício (vale-refeição/alimentação: VR, Alelo, Ticket, Sodexo/Pluxee, Flash, Caju…) e outros boletos.
Devolva só o que está escrito. Valores em reais como número (470,00 → 470). Datas em AAAA-MM-DD.
Números longos (linha digitável, Pix copia e cola) copie exatamente; se não conseguir ler todos os caracteres com certeza, devolva null. Nunca invente.
Se não for boleto/cobrança, e_boleto = false e o resto null.`;

export type BoletoBeneficio = {
  beneficiario: string | null; cnpj: string | null; pagador: string | null;
  valor: number | null; vencimento: string | null; numero_documento: string | null; produto: string | null;
  linha_digitavel: string | null; pix_copia_e_cola: string | null;
  /** O valor que está dentro da linha/Pix bate com o valor lido? null = não deu para conferir. */
  valor_confere: boolean | null;
};

const r2 = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) && n > 0 && n < 1e7 ? Math.round(n * 100) / 100 : null);
const dataOk = (d: unknown) => (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(`${d}T12:00:00Z`)) ? d : null);
const txt = (s: unknown, max = 120) => (typeof s === 'string' && s.trim() ? s.trim().slice(0, max) : null);

async function lerComIa(model: string, bloco: any, admin: any, tenantId: string, userId: string): Promise<any | { erro: string; status: number }> {
  const client = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') ?? '' });
  try {
    const res: any = await client.messages.create({
      model, max_tokens: 1500, system: SISTEMA,
      output_config: { format: { type: 'json_schema', schema: SCHEMA } },
      messages: [{ role: 'user', content: [bloco, { type: 'text', text: 'Leia este boleto.' }] }],
    } as any);
    await registrarUsoIa(admin, { feature: 'leitura-boleto-beneficio', model: res.model, usage: res.usage, tenantId, userId });
    if (res.stop_reason === 'refusal') return { erro: 'A leitura foi recusada para este arquivo.', status: 422 };
    return JSON.parse((res.content ?? []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join(''));
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) return { erro: 'Muitas leituras ao mesmo tempo. Tente de novo em alguns segundos.', status: 429 };
    if (e instanceof Anthropic.BadRequestError && /credit balance|billing/i.test(String(e.message))) return { erro: 'Sem créditos na IA. Preencha à mão.', status: 402 };
    console.error('[pedidos-pagamento] ler_boleto', String((e as Error)?.message ?? e).slice(0, 400));
    return { erro: 'Não consegui ler o boleto agora. Tente de novo ou preencha à mão.', status: 502 };
  }
}

export async function lerBoletoBeneficio(admin: any, tenantId: string, userId: string, arq: { base64?: string; media_type?: string }): Promise<{ lido?: BoletoBeneficio; erro?: string; status?: number }> {
  if (!Deno.env.get('ANTHROPIC_API_KEY')) return { erro: 'Leitura por IA não configurada no servidor.', status: 503 };
  const tipo = String(arq?.media_type ?? '').toLowerCase();
  const data = String(arq?.base64 ?? '').replace(/^data:[^;]+;base64,/, '').replace(/\s/g, '');
  if (!data) return { erro: 'Envie o boleto (PDF ou foto).' };
  const pdf = tipo === 'application/pdf';
  if (!pdf && !IMAGENS.includes(tipo)) return { erro: 'O boleto precisa ser PDF ou foto (JPG/PNG).' };
  if (Math.floor(data.length * 3 / 4) > MAX_BYTES) return { erro: 'Arquivo grande demais (máx. 10 MB).' };

  // 1. Texto do PDF: números exatos, sem modelo
  const texto = pdf ? await textoDoPdf(data) : '';
  const linhaTxt = texto ? findBoletos(texto)[0] ?? null : null;
  const pixTxt = texto ? acharCopiaECola(texto) : null;

  // 2. IA para o resto (e para os números, quando é foto ou PDF escaneado)
  const bloco = pdf
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } }
    : { type: 'image', source: { type: 'base64', media_type: tipo, data } };
  let ia = await lerComIa(MODEL, bloco, admin, tenantId, userId);
  if (ia?.erro) return ia;
  if (!ia?.e_boleto) return { erro: 'Isso não parece um boleto. Mande o PDF do boleto ou uma foto dele inteiro.' };
  if (r2(ia.valor) == null) {
    const ia2 = await lerComIa(MODEL_2, bloco, admin, tenantId, userId);
    if (!ia2?.erro && ia2?.e_boleto) ia = ia2;
  }

  const linha = linhaTxt ?? tryDecodeBoleto(String(ia.linha_digitavel ?? '').replace(/\D/g, ''));
  // Só quebras de linha: o nome de quem recebe tem espaço ("VR BENEFICIOS") e entra no CRC
  const pixIa = String(ia.pix_copia_e_cola ?? '').replace(/\r?\n/g, '').trim();
  const pix = pixTxt ?? (copiaValida(pixIa) ? pixIa : null);
  const valorPix = pix ? lerCopia(pix).valor : null;
  const valorCodigo = linha?.valor ?? (valorPix && valorPix > 0 ? valorPix : null);
  const valorLido = r2(ia.valor);
  const cnpj = String(ia.beneficiario_cnpj ?? '').replace(/\D/g, '');
  return {
    lido: {
      beneficiario: txt(ia.beneficiario) ?? (pix ? txt(lerCopia(pix).nome) : null),
      cnpj: cnpj.length === 14 ? cnpj : null,
      pagador: txt(ia.pagador),
      // O valor de dentro do código manda (a IA erra centavo; o código tem DV/CRC)
      valor: valorCodigo ?? valorLido,
      vencimento: linha?.vencimento ?? dataOk(ia.vencimento),
      numero_documento: txt(ia.numero_documento, 60),
      produto: txt(ia.produto, 120),
      linha_digitavel: linha ? (linha.digitavel ?? linha.barcode) : null,
      pix_copia_e_cola: pix,
      valor_confere: valorCodigo != null && valorLido != null ? Math.abs(valorCodigo - valorLido) < 0.01 : null,
    },
  };
}
