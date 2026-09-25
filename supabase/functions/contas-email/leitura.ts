// contas-email › leitura e lançamento do boleto que chegou por e-mail (2026-09-25).
//
// Ordem da leitura, do mais barato e mais confiável para o mais caro:
//   1. corpo do e-mail;
//   2. texto do PDF anexo (sem modelo: copia os números exatos);
//   3. só se o PDF é imagem (ou o anexo é foto): a IA lê.
// Em todos os casos a linha digitável só vale se passar nos dígitos verificadores, e o CNPJ só
// vale se passar nos dígitos dele. A IA pode LER, quem aprova é o DV — número inventado não fecha.
//
// Regra de lançamento (dono, 2026-09-22) — caixa de e-mail que vira conta a pagar é o vetor do
// golpe do boleto falso, então:
//   • remetente é fornecedor cadastrado E o CNPJ do beneficiário é o dele → lança direto;
//   • qualquer outra coisa (remetente novo, CNPJ diferente, CNPJ não achado) → pendência no 📥;
//   • nada daqui paga: a conta entra com o boleto guardado e o pagamento segue o caminho de
//     sempre (preparado no dia, aprovado pelo dono).
// deno-lint-ignore-file no-explicit-any

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import Anthropic from 'npm:@anthropic-ai/sdk@0.125.0';
import { findBoletos, tryDecodeBoleto, type Decoded } from '../_shared/boleto.ts';
import { textoDoPdf } from '../_shared/pdf-texto.ts';

type Admin = SupabaseClient;
export interface Anexo { nome: string; tipo: string; base64: string }

const onlyDigits = (s: unknown) => String(s ?? '').replace(/\D/g, '');
const round2 = (n: number) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const brl = (n: number) => Number(n ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const diaBr = (d: string | null) => (d ? d.split('-').reverse().join('/') : '');
const hojeSP = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
function log(level: 'INFO' | 'WARN' | 'ERROR', action: string, msg: string, ctx?: Record<string, unknown>) {
  const e = JSON.stringify({ ts: new Date().toISOString(), fn: 'contas-email', level, action, msg, ...(ctx ?? {}) });
  if (level === 'ERROR') console.error(e); else if (level === 'WARN') console.warn(e); else console.log(e);
}

// ── CNPJ ────────────────────────────────────────────────────────────────────
export function cnpjValido(v: unknown): boolean {
  const d = onlyDigits(v);
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;
  const dv = (base: string) => {
    let soma = 0, peso = base.length - 7;
    for (const ch of base) { soma += Number(ch) * peso--; if (peso < 2) peso = 9; }
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const d1 = dv(d.slice(0, 12));
  return d1 === Number(d[12]) && dv(d.slice(0, 13)) === Number(d[13]);
}
const fmtCnpj = (d: string) => d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
/** Mesma empresa = mesma raiz (8 primeiros dígitos): matriz e filial emitem boleto uma pela outra. */
const mesmaEmpresa = (a: string | null, b: string | null) => !!a && !!b && a.slice(0, 8) === b.slice(0, 8);

/** CNPJ do beneficiário a partir do texto: o válido que não é o da própria loja (o pagador). Com
 *  mais de um candidato, só aceita o que vem logo depois de "Beneficiário"/"Cedente" — sem esse
 *  rótulo não chuta (CNPJ errado aqui liberaria o lançamento direto). */
function cnpjBeneficiarioDoTexto(texto: string, cnpjLoja: string | null): string | null {
  const achados: Array<{ d: string; i: number }> = [];
  for (const m of texto.matchAll(/(?<![\d./-])\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}(?![\d])/g)) {
    const d = onlyDigits(m[0]);
    if (cnpjValido(d) && !mesmaEmpresa(d, cnpjLoja)) achados.push({ d, i: m.index ?? 0 });
  }
  const unicos = [...new Set(achados.map((a) => a.d))];
  if (unicos.length === 1) return unicos[0];
  if (!unicos.length) return null;
  // O primeiro CNPJ depois de cada rótulo, desde que não haja "Pagador/Sacado" no meio (aí o
  // CNPJ seguinte é o do pagador, não o do beneficiário).
  const rotulos = [...texto.matchAll(/benefici[aá]rio|cedente/gi)].map((m) => m.index ?? 0);
  const pagador = [...texto.matchAll(/pagador|sacado/gi)].map((m) => m.index ?? 0);
  const perto = new Set<string>();
  for (const r of rotulos) {
    const prox = achados.filter((a) => a.i > r && a.i - r < 250).sort((x, y) => x.i - y.i)[0];
    if (prox && !pagador.some((p) => p > r && p < prox.i)) perto.add(prox.d);
  }
  return perto.size === 1 ? [...perto][0] : null;
}
/** Nome depois de "Beneficiário"/"Cedente", até o CNPJ ou o fim da linha. */
function beneficiarioDoTexto(texto: string): string | null {
  const m = texto.match(/(?:benefici[aá]rio|cedente)(?:\s*final)?\s*:?[ \t]*([^\n]{3,120})/i);
  if (!m) return null;
  const nome = m[1].split(/\s*(?:CNPJ|CPF|C\.N\.P\.J|\d{2}\.\d{3}\.\d{3})/i)[0].replace(/[\s\-–:]+$/, '').trim();
  return nome.length >= 3 && /[a-z]/i.test(nome) ? nome.slice(0, 80) : null;
}
function vencimentoDoTexto(texto: string): string | null {
  const m = texto.match(/vencimento[^\d]{0,30}(\d{2})\/(\d{2})\/(\d{4})/i);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

// ── IA (só quando o PDF/foto não tem texto) ─────────────────────────────────
const MODELO_LEITURA = 'claude-haiku-4-5';
const MODELO_SEGUNDA = 'claude-sonnet-5';   // 2ª tentativa quando o DV reprova a leitura do Haiku
const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['e_boleto', 'boletos'],
  properties: {
    e_boleto: { type: 'boolean' },
    boletos: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['linha_digitavel', 'beneficiario', 'beneficiario_cnpj', 'valor', 'vencimento'],
        properties: {
          linha_digitavel: { type: 'string' },
          beneficiario: { type: 'string' },
          beneficiario_cnpj: { type: 'string' },
          valor: { type: 'number' },
          vencimento: { type: 'string' },
        },
      },
    },
  },
};
const SISTEMA = `Você lê boletos bancários e guias de arrecadação brasileiros. Devolva, para cada boleto do documento:
- linha_digitavel: os 47 ou 48 dígitos da linha digitável (ou os 44 do código de barras), SÓ os números, copiados exatamente. Se não conseguir ler todos os dígitos com certeza, devolva "".
- beneficiario: nome de quem recebe (Beneficiário/Cedente), como impresso.
- beneficiario_cnpj: CNPJ/CPF do beneficiário, só números; "" se não aparecer. NUNCA devolva o CNPJ do pagador (sacado).
- valor: valor do documento em reais (0 se não aparecer).
- vencimento: AAAA-MM-DD ("" se não aparecer).
e_boleto = false se o documento não for boleto/guia (nota fiscal, contrato, propaganda...). Nunca invente números.`;

async function lerComIa(anexo: Anexo, modelo: string): Promise<any[] | null> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY') ?? '';
  if (!apiKey) return null;
  const client = new Anthropic({ apiKey });
  const pdf = /pdf/i.test(anexo.tipo) || /\.pdf$/i.test(anexo.nome);
  const data = anexo.base64.replace(/^data:[^;]+;base64,/, '').replace(/\s/g, '');
  const bloco = pdf
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } }
    : { type: 'image', source: { type: 'base64', media_type: /png/i.test(anexo.tipo) ? 'image/png' : 'image/jpeg', data } };
  const t0 = Date.now();
  try {
    const r: any = await client.messages.create({
      model: modelo, max_tokens: 1500, system: SISTEMA,
      output_config: { format: { type: 'json_schema', schema: SCHEMA } },
      messages: [{ role: 'user', content: [bloco, { type: 'text', text: 'Leia os boletos deste arquivo.' }] }],
    } as any);
    const txt = (r.content ?? []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
    const out = JSON.parse(txt);
    log('INFO', 'ia', 'leitura', { modelo, ms: Date.now() - t0, in: r.usage?.input_tokens, out: r.usage?.output_tokens, boletos: out?.boletos?.length ?? 0 });
    return out?.e_boleto ? (out.boletos ?? []) : [];
  } catch (e) {
    log('WARN', 'ia', 'leitura falhou', { modelo, error: String((e as Error)?.message ?? e) });
    return null;
  }
}

// ── Leitura ─────────────────────────────────────────────────────────────────
export interface BoletoLido {
  digitavel: string;
  barcode: string;
  valor: number | null;
  vencimento: string | null;
  beneficiario: string | null;
  cnpj: string | null;           // beneficiário, 14 dígitos, DV conferido
  origem: 'corpo' | 'pdf_texto' | 'ia';
  anexo: string | null;
}

const PARECE_BOLETO = /boleto|fatura|cobran[cç]a|vencimento|linha digit[aá]vel|segunda via|2[ªa] via|guia|condom[ií]nio|mensalidade/i;
const ehPdf = (a: Anexo) => /pdf/i.test(a.tipo) || /\.pdf$/i.test(a.nome);
const ehImagem = (a: Anexo) => /^image\/(png|jpe?g)/i.test(a.tipo) || /\.(png|jpe?g)$/i.test(a.nome);

function deDecoded(d: Decoded, extra: Partial<BoletoLido> & Pick<BoletoLido, 'origem'>): BoletoLido {
  return {
    digitavel: d.digitavel ?? d.barcode, barcode: d.barcode,
    valor: d.valor, vencimento: d.vencimento,
    beneficiario: null, cnpj: null, anexo: null, ...extra,
  };
}

/** Lê os boletos de um e-mail. `textos` volta junto para quem quiser guardar/mostrar. */
export async function lerBoletos(email: { subject: string; texto: string; anexos: Anexo[] }, cnpjLoja: string | null) {
  const vistos = new Map<string, BoletoLido>();
  const pdfsSemTexto: Anexo[] = [];
  const avisos: string[] = [];
  const corpo = `${email.subject}\n${email.texto}`;

  for (const d of findBoletos(corpo)) {
    const b = deDecoded(d, { origem: 'corpo' });
    b.cnpj = cnpjBeneficiarioDoTexto(corpo, cnpjLoja);
    b.beneficiario = beneficiarioDoTexto(corpo);
    b.vencimento ??= vencimentoDoTexto(corpo);
    vistos.set(b.barcode, b);
  }

  for (const a of email.anexos) {
    if (!ehPdf(a)) continue;
    const txt = await textoDoPdf(a.base64);
    const achou = txt.trim() ? findBoletos(txt) : [];
    if (!achou.length) { pdfsSemTexto.push(a); continue; }
    for (const d of achou) {
      if (vistos.has(d.barcode)) continue;
      const b = deDecoded(d, { origem: 'pdf_texto', anexo: a.nome });
      b.cnpj = cnpjBeneficiarioDoTexto(txt, cnpjLoja);
      b.beneficiario = beneficiarioDoTexto(txt);
      b.vencimento ??= vencimentoDoTexto(txt);
      vistos.set(b.barcode, b);
    }
  }

  // IA: PDF sem texto (escaneado/imagem) e, se ainda não achou nada num e-mail com cara de
  // boleto, fotos anexadas (imagem pequena é quase sempre logo de assinatura: fica de fora).
  const paraIa = [...pdfsSemTexto];
  if (!vistos.size && PARECE_BOLETO.test(`${corpo} ${email.anexos.map((a) => a.nome).join(' ')}`)) {
    paraIa.push(...email.anexos.filter((a) => ehImagem(a) && a.base64.length * 0.75 > 40_000));
  }
  for (const a of paraIa.slice(0, 4)) {
    let lidos = await lerComIa(a, MODELO_LEITURA);
    let ok = (lidos ?? []).map((l) => ({ l, d: tryDecodeBoleto(onlyDigits(l.linha_digitavel)) }));
    // Leu "boleto" mas nenhum número fechou no DV: uma segunda leitura com o modelo maior.
    if (lidos?.length && !ok.some((x) => x.d)) {
      lidos = await lerComIa(a, MODELO_SEGUNDA);
      ok = (lidos ?? []).map((l) => ({ l, d: tryDecodeBoleto(onlyDigits(l.linha_digitavel)) }));
    }
    if (lidos === null) avisos.push(`Não consegui ler o anexo ${a.nome} (falha na leitura).`);
    else if (lidos.length && !ok.some((x) => x.d)) avisos.push(`O anexo ${a.nome} parece boleto, mas a linha digitável lida não confere nos dígitos verificadores.`);
    for (const { l, d } of ok) {
      if (!d || vistos.has(d.barcode)) continue;
      const cnpj = onlyDigits(l.beneficiario_cnpj);
      vistos.set(d.barcode, deDecoded(d, {
        origem: 'ia', anexo: a.nome,
        // Valor e vencimento do código mandam; o que a IA leu só completa o convênio (que não traz vencimento).
        valor: d.valor ?? (Number(l.valor) > 0 ? round2(Number(l.valor)) : null),
        vencimento: d.vencimento ?? (/^\d{4}-\d{2}-\d{2}$/.test(String(l.vencimento)) ? l.vencimento : null),
        beneficiario: String(l.beneficiario ?? '').trim() || null,
        cnpj: cnpjValido(cnpj) && !mesmaEmpresa(cnpj, cnpjLoja) ? cnpj : null,
      }));
    }
  }
  return { boletos: [...vistos.values()].slice(0, 5), avisos, pareceBoleto: PARECE_BOLETO.test(corpo) || email.anexos.some(ehPdf) };
}

// ── Decisão e lançamento ───────────────────────────────────────────────────
export interface Fornecedor { id: string; name: string; cnpj: string | null; email: string | null }

/** Por que NÃO lança direto (null = pode lançar). */
export function motivoPendencia(b: BoletoLido, remetente: Fornecedor | null, doCnpj: Fornecedor | null): { motivo: string; alerta: boolean } | null {
  const cnpjForn = onlyDigits(remetente?.cnpj);
  if (!remetente) {
    return doCnpj
      ? { motivo: `Remetente não está cadastrado, mas o CNPJ do boleto é de ${doCnpj.name}. Confira se o e-mail é mesmo dele.`, alerta: false }
      : { motivo: 'Remetente não é fornecedor cadastrado.', alerta: false };
  }
  if (!b.cnpj) return { motivo: `Não achei o CNPJ do beneficiário no boleto para conferir com ${remetente.name}.`, alerta: false };
  if (cnpjForn.length !== 14) return { motivo: `${remetente.name} está cadastrado sem CNPJ: não dá para conferir o beneficiário.`, alerta: false };
  if (!mesmaEmpresa(b.cnpj, cnpjForn)) {
    return { motivo: `ATENÇÃO: o e-mail veio de ${remetente.name} (CNPJ ${fmtCnpj(cnpjForn)}), mas o boleto paga ${b.beneficiario ?? 'outra empresa'} (CNPJ ${fmtCnpj(b.cnpj)}). Pode ser golpe do boleto falso — confira com o fornecedor por telefone antes de lançar.`, alerta: true };
  }
  return null;
}

type Conta = { id: string; description: string; supplier: string | null; due_date: string };
export type ResultadoLancar =
  | { ok: true; conta_id: string; acao: string }
  | { ok: false; ambiguo: Conta[] };

/** Guarda o boleto na conta a pagar: mesmo desenho do guardar_boleto do assistente (boleto pelo
 *  WhatsApp) — acha a conta em aberto do mesmo valor e fornecedor e grava o boleto nela; se não
 *  existe, cria. Mais de uma candidata → não chuta. */
export async function lancarBoleto(admin: Admin, tenantId: string, b: BoletoLido, info: {
  fornecedor: string | null; remetente: string; assunto: string; contaId?: string | null;
}): Promise<ResultadoLancar> {
  const valor = Number(b.valor ?? 0);
  if (!(valor > 0)) throw new Error('O boleto não traz valor.');
  const hoje = hojeSP();
  const campos = { boleto_digitavel: b.digitavel, boleto_barcode: b.barcode, boleto_recebido_em: new Date().toISOString(), boleto_origem: 'email' };

  const { data: ja } = await admin.from('fin_accounts_payable').select('id')
    .eq('tenant_id', tenantId).eq('boleto_digitavel', b.digitavel).neq('status', 'cancelled').limit(1);
  if (ja?.length) return { ok: true, conta_id: ja[0].id, acao: 'já estava guardado' };

  if (info.contaId) {
    const { data: esc, error } = await admin.from('fin_accounts_payable').update(campos)
      .eq('id', info.contaId).eq('tenant_id', tenantId).not('status', 'in', '(paid,cancelled)').is('boleto_digitavel', null)
      .select('id').maybeSingle();
    if (error) throw new Error(error.message);
    if (!esc) throw new Error('Essa conta não está mais em aberto ou já tem boleto.');
    return { ok: true, conta_id: esc.id, acao: 'guardado na conta escolhida' };
  }

  const quem = info.fornecedor ?? b.beneficiario;
  const { data: cands } = await admin.from('fin_accounts_payable').select('id, description, supplier, due_date')
    .eq('tenant_id', tenantId).not('status', 'in', '(paid,cancelled)').is('boleto_digitavel', null)
    .gte('amount', valor - 0.01).lte('amount', valor + 0.01).order('due_date').limit(10);
  const palavras = (x: unknown) => new Set(String(x ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
    .split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !['ltda', 'eireli', 'comercio', 'distribuidora', 'alimentos', 'industria', 'servicos'].includes(w)));
  const pq = palavras(quem);
  const compat = (c: Conta) => {
    if (!pq.size) return true;
    const pc = palavras(`${c.supplier ?? ''} ${c.description ?? ''}`);
    return !pc.size || [...pq].some((w) => pc.has(w));
  };
  const lista = ((cands ?? []) as Conta[]).filter(compat);
  const mesmoDia = b.vencimento ? lista.filter((c) => c.due_date === b.vencimento) : [];
  const alvo = lista.length === 1 ? lista[0] : mesmoDia.length === 1 ? mesmoDia[0] : null;
  if (!alvo && lista.length > 1) return { ok: false, ambiguo: lista };
  if (alvo) {
    const { error } = await admin.from('fin_accounts_payable').update(campos).eq('id', alvo.id).eq('tenant_id', tenantId).is('boleto_digitavel', null);
    if (error) throw new Error(error.message);
    return { ok: true, conta_id: alvo.id, acao: 'guardado na conta que já existia' };
  }
  const dia = b.vencimento ?? hoje;
  const { data: nova, error } = await admin.from('fin_accounts_payable').insert({
    tenant_id: tenantId,
    description: `Boleto ${quem ?? ''}`.trim() + (info.assunto ? ` — ${info.assunto.slice(0, 80)}` : ''),
    supplier: quem, amount: valor, due_date: dia, status: dia < hoje ? 'overdue' : 'pending',
    notes: [`Veio por e-mail de ${info.remetente}`, b.cnpj ? `CNPJ do beneficiário: ${fmtCnpj(b.cnpj)}` : null].filter(Boolean).join(' · '),
    ...campos,
  }).select('id').single();
  if (error) throw new Error(error.message);
  return { ok: true, conta_id: nova.id, acao: 'conta a pagar criada (sem categoria DRE: aparece nas pendências para classificar)' };
}

export const resumoBoleto = (b: BoletoLido) =>
  `${b.beneficiario ?? 'Boleto'} · ${b.valor ? brl(b.valor) : 'sem valor'}${b.vencimento ? ` · vence ${diaBr(b.vencimento)}` : ''}`;
export { fmtCnpj, onlyDigits, brl, diaBr };
