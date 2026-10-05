// Cartão "Aniversariantes" do Funil: tipos da resposta do crm-funnel (list_aniversariantes),
// o rótulo do dia ("faz aniversário hoje", "sexta, 09/10") e a mensagem de parabéns.
// Lógica pura: testada em src/test/lib/aniversarioMensagem.test.ts.
import { dateKeyBrasilia } from '@/lib/dateUtils';

export interface AnivVoucher {
  code: string;
  claim_token: string | null;
  voucher_type: string;
  discount_type: string | null;
  discount_value: number | null;
  original_amount: number;
  min_order_amount: number | null;
  expires_at: string | null;
}

export interface Aniversariante {
  customer_id: string;
  nome: string;
  phone: string;
  phone_fmt: string;
  opt_out: boolean;
  /** 0 = hoje. */
  dias_ate: number;
  /** 'dd/mm' da data em que comemora. */
  data_aniversario: string;
  /** 'YYYY-MM-DD' da data em que comemora. */
  proximo_aniversario: string;
  voucher: AnivVoucher | null;
}

const DIAS_SEMANA = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

function fmtMoeda(v: number): string {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/** Dia da semana de uma data 'YYYY-MM-DD' (sem passar por fuso). */
export function diaDaSemana(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return '';
  return DIAS_SEMANA[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

/** "faz aniversário hoje" ou "sexta, 09/10". */
export function rotuloDia(a: Pick<Aniversariante, 'dias_ate' | 'data_aniversario' | 'proximo_aniversario'>): string {
  if (a.dias_ate <= 0) return 'faz aniversário hoje';
  return `${diaDaSemana(a.proximo_aniversario)}, ${a.data_aniversario}`;
}

/** O voucher ainda vale? (vencido não se manda: o cliente receberia um código morto). */
export function voucherVale(v: AnivVoucher | null | undefined, agora: number = Date.now()): v is AnivVoucher {
  if (!v) return false;
  if (!v.expires_at) return true;
  return new Date(v.expires_at).getTime() > agora;
}

/** 'dd/mm' em Brasília de um instante (validade do voucher). */
export function ddmmBrasilia(ts: string): string {
  const k = dateKeyBrasilia(ts); // YYYY-MM-DD
  return `${k.slice(8, 10)}/${k.slice(5, 7)}`;
}

/** "15% de desconto", "R$ 10,00 de desconto" ou "um vale-presente de R$ 50,00". */
export function descricaoVoucher(v: AnivVoucher): string {
  if (v.voucher_type === 'gift_card') return `um vale-presente de ${fmtMoeda(Number(v.original_amount))}`;
  const valor = Number(v.discount_value ?? v.original_amount ?? 0);
  return v.discount_type === 'percent' ? `${valor}% de desconto` : `${fmtMoeda(valor)} de desconto`;
}

export function primeiroNome(nome: string): string {
  return nome.trim().split(/\s+/)[0] || 'tudo bem';
}

export interface OpcoesMensagem {
  /** Nome da loja (opcional: sem ele a frase "Aqui é da …" some). */
  loja?: string;
  /** Endereço do sistema (location.origin), para o link do voucher. */
  origin: string;
  agora?: number;
}

/** Mensagem de WhatsApp do cartão Aniversariantes.
 *  Com voucher que vale: parabéns + "use o código *X*" + link de ativação (se houver token) + validade.
 *  Sem voucher (ou vencido): só os parabéns e o convite. */
export function mensagemAniversario(a: Aniversariante, op: OpcoesMensagem): string {
  const nome = primeiroNome(a.nome);
  const felicita = a.dias_ate <= 0 ? 'Feliz aniversário!' : 'Feliz aniversário antecipado!';
  const quem = op.loja ? ` Aqui é da ${op.loja}.` : '';
  const v = a.voucher;
  if (!voucherVale(v, op.agora)) {
    return `Olá, ${nome}! \u{1F382} ${felicita}${quem} Queremos comemorar com você — venha nos visitar! \u{1F973}`;
  }
  const minimo = v.min_order_amount && v.min_order_amount > 0 ? ` (em pedidos acima de ${fmtMoeda(v.min_order_amount)})` : '';
  const validade = v.expires_at ? ` Válido até ${ddmmBrasilia(v.expires_at)}.` : '';
  const link = v.claim_token ? ` Ative aqui: ${op.origin.replace(/\/+$/, '')}/voucher/${v.claim_token}` : '';
  return `Olá, ${nome}! \u{1F382} ${felicita}${quem} Preparamos um presente pra você: use o código *${v.code}* e ganhe ${descricaoVoucher(v)}${minimo}.${validade}${link} Te esperamos! \u{1F973}`;
}
