// Leitura de boleto brasileiro: linha digitável (47/48 dígitos) ou código de barras (44).
//
// Extraído da `inter-bank` em 2026-09-22, sem mudar comportamento, porque passou a ter um
// segundo dono: a caixa de boletos por e-mail. Duplicar isso seria péssimo — é a conferência
// que decide se um número lido de um PDF (ou de uma foto, ou pela IA) pode virar dinheiro.
//
// A regra que vale mais que tudo aqui: **a IA pode LER, mas quem valida é o dígito
// verificador**. Um boleto lido errado que passe pelos DVs é praticamente impossível; um
// número inventado nunca fecha. Por isso `decodeBoleto` lança em vez de devolver "mais ou
// menos certo" — quem chama tem que tratar a falha, não contornar.
//
// Os dois formatos:
//   • bancário (começa ≠ 8): traz VALOR e VENCIMENTO dentro do próprio código;
//   • convênio/arrecadação (começa com 8 — água, luz, tributo): traz valor só quando o
//     indicador diz que o valor é em reais, e nunca traz vencimento.

const onlyDigits = (s: unknown) => String(s ?? '').replace(/\D/g, '');
const round2 = (n: number) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function mod10(num: string): number {
  let sum = 0, w = 2;
  for (let i = num.length - 1; i >= 0; i--) { let p = Number(num[i]) * w; if (p > 9) p = Math.floor(p / 10) + (p % 10); sum += p; w = w === 2 ? 1 : 2; }
  return (10 - (sum % 10)) % 10;
}
export function mod11Banco(num: string): number {
  let sum = 0, w = 2;
  for (let i = num.length - 1; i >= 0; i--) { sum += Number(num[i]) * w; w = w === 9 ? 2 : w + 1; }
  const dv = 11 - (sum % 11);
  return dv === 0 || dv === 10 || dv === 11 ? 1 : dv;
}
export function mod11Conv(num: string): number {
  let sum = 0, w = 2;
  for (let i = num.length - 1; i >= 0; i--) { sum += Number(num[i]) * w; w = w === 9 ? 2 : w + 1; }
  const r = sum % 11;
  return r <= 1 ? 0 : 11 - r;
}

// Fator de vencimento: base 07/10/1997; chegou a 9999 em 21/02/2025 e recomeçou em 1000 no dia 22/02/2025.
export function dueFromFactor(f: number): string | null {
  if (!f) return null;
  const a = addDays('1997-10-07', f);
  if (f < 1000) return a;
  const b = addDays('2025-02-22', f - 1000);
  const now = Date.now();
  return Math.abs(new Date(`${a}T12:00:00Z`).getTime() - now) <= Math.abs(new Date(`${b}T12:00:00Z`).getTime() - now) ? a : b;
}

export type Decoded = {
  kind: 'bancario' | 'convenio';
  barcode: string;
  digitavel: string | null;
  valor: number | null;
  vencimento: string | null;
  banco: string | null;
};

export function decodeBancario(bc: string): Decoded {
  if (mod11Banco(bc.slice(0, 4) + bc.slice(5)) !== Number(bc[4])) throw new Error('Código de barras inválido (o dígito verificador não confere). Confira os números.');
  const valor = Number(bc.slice(9, 19)) / 100;
  return { kind: 'bancario', barcode: bc, digitavel: null, valor: valor > 0 ? round2(valor) : null, vencimento: dueFromFactor(Number(bc.slice(5, 9))), banco: bc.slice(0, 3) };
}

const convDv = (ref: string) => (ref === '6' || ref === '7' ? mod10 : mod11Conv);

export function decodeConvenio(bc: string): Decoded {
  const ref = bc[2];
  if (convDv(ref)(bc.slice(0, 3) + bc.slice(4)) !== Number(bc[3])) throw new Error('Código de barras de convênio inválido (o dígito verificador não confere).');
  const real = ref === '6' || ref === '8';
  const valor = Number(bc.slice(4, 15)) / 100;
  return { kind: 'convenio', barcode: bc, digitavel: null, valor: real && valor > 0 ? round2(valor) : null, vencimento: null, banco: null };
}

export function decodeBoleto(raw: string): Decoded {
  const d = onlyDigits(raw);
  if (d.length === 47) {
    if (mod10(d.slice(0, 9)) !== Number(d[9]) || mod10(d.slice(10, 20)) !== Number(d[20]) || mod10(d.slice(21, 31)) !== Number(d[31])) {
      throw new Error('Linha digitável inválida (um dígito verificador não confere). Confira os números.');
    }
    const bc = d.slice(0, 4) + d[32] + d.slice(33, 47) + d.slice(4, 9) + d.slice(10, 20) + d.slice(21, 31);
    return { ...decodeBancario(bc), digitavel: d };
  }
  if (d.length === 48 && d[0] === '8') {
    const blocks = [0, 12, 24, 36].map((i) => d.slice(i, i + 12));
    const dv = convDv(d[2]);
    for (const b of blocks) if (dv(b.slice(0, 11)) !== Number(b[11])) throw new Error('Linha do convênio inválida (o dígito de um bloco não confere).');
    return { ...decodeConvenio(blocks.map((b) => b.slice(0, 11)).join('')), digitavel: d };
  }
  if (d.length === 44) return d[0] === '8' ? decodeConvenio(d) : decodeBancario(d);
  throw new Error(`Esperava a linha digitável (47 ou 48 números) ou o código de barras (44 números). Recebi ${d.length}.`);
}

/** Versão que não lança: devolve null quando os dígitos não fecham. Para quem varre um texto
 *  atrás de candidatos (PDF, corpo de e-mail) e só quer os que passam na conferência. */
export function tryDecodeBoleto(raw: string): Decoded | null {
  try { return decodeBoleto(raw); } catch { return null; }
}

/** Acha boletos dentro de um texto qualquer e devolve só os que passam nos dígitos
 *  verificadores. Ordem: linha digitável (mais comum no PDF) antes do código de barras. */
export function findBoletos(texto: string): Decoded[] {
  const achados: Decoded[] = [];
  const vistos = new Set<string>();
  // Sequências de dígitos, aceitando os separadores típicos da linha digitável impressa
  // (espaço, ponto e hífen) — sem isso a linha "34191.79001 01043..." não é encontrada.
  const candidatos = String(texto ?? '').match(/[\d][\d.\s-]{40,60}[\d]/g) ?? [];
  const add = (dec: Decoded | null) => {
    if (!dec || vistos.has(dec.barcode)) return;
    vistos.add(dec.barcode); achados.push(dec);
  };
  // Linha digitável: pode estar colada em outros números, então varre janelas. Tem 3 DVs de
  // módulo 10 + o geral — janela aleatória quase nunca fecha.
  for (const c of candidatos) {
    const d = onlyDigits(c);
    for (const len of [47, 48]) {
      for (let i = 0; i + len <= d.length; i++) add(tryDecodeBoleto(d.slice(i, i + len)));
    }
  }
  // Código de barras (44) tem UM dígito verificador: numa janela deslizante 1 em cada ~10
  // sequências "fecha" por acaso (2026-09-25: um "boleto de 2019" saiu dos números do PDF).
  // Por isso só a sequência de exatamente 44 dígitos, e só quando não há linha digitável.
  if (!achados.length) {
    for (const c of candidatos) {
      const d = onlyDigits(c);
      if (d.length === 44) add(tryDecodeBoleto(d));
    }
  }
  return achados;
}

// ── Boleto vencido: multa e juros (2026-09-22) ──
// O Inter recusa pagar boleto vencido pelo valor do código ("Campo(s) inválido(s): Valor a pagar"):
// exige o valor atualizado. O 1º caso foi um DLR Alimentos (Itaú, R$ 220,00, 12 dias de atraso),
// recusado duas vezes. O valor atualizado sai das INSTRUÇÕES impressas no boleto ("multa 2% após
// o vencimento", "juros de 1% ao mês"). Sem instrução legível, devolve null: quem chama pede o valor
// ao dono (o app do Inter mostra ao ler o código) — nunca chuta.
//
// Regras do cálculo (as da cobrança bancária):
//   • vencimento em sábado/domingo pode ser pago no dia útil seguinte sem encargo (feriado não entra:
//     no pior caso sai uma cobrança a mais e o Inter recusa, sem mover dinheiro);
//   • multa: uma vez, sobre o valor do documento;
//   • juros simples por dia corrido desde o vencimento; "% ao mês" vira ao dia dividindo por 30.
export type Encargos = { dias: number; multa: number; juros: number; total: number; regra: string };

const diaSemana = (iso: string) => new Date(`${iso}T00:00:00Z`).getUTCDay();
const diasEntre = (de: string, ate: string) => Math.round((Date.parse(`${ate}T00:00:00Z`) - Date.parse(`${de}T00:00:00Z`)) / 86_400_000);

/** Vencido para efeito de pagamento? (sábado/domingo passam para a segunda-feira). */
export function boletoVencido(vencimento: string | null | undefined, hoje: string): boolean {
  if (!vencimento || !/^\d{4}-\d{2}-\d{2}$/.test(vencimento)) return false;
  let limite = vencimento;
  while (diaSemana(limite) === 0 || diaSemana(limite) === 6) limite = addDays(limite, 1);
  return hoje > limite;
}

const numBR = (s: string) => {
  const t = s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
};

/**
 * Valor atualizado de um boleto vencido, pelas instruções do próprio boleto.
 * null = vencido mas não deu para ler a regra (ou o resultado não é plausível).
 * Não vencido → encargos zero (total = valor).
 */
export function encargosAtraso(valor: number, vencimento: string | null | undefined, hoje: string, instrucoes: string | null | undefined): Encargos | null {
  if (!boletoVencido(vencimento, hoje)) return { dias: 0, multa: 0, juros: 0, total: round2(valor), regra: 'no prazo' };
  const t = String(instrucoes ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/\s+/g, ' ');
  if (!t.trim()) return null;
  const R = String.raw;
  const N = R`(\d{1,4}(?:[.,]\d{1,4})?)`;
  const m = (src: string) => t.match(new RegExp(src));
  const dias = diasEntre(vencimento!, hoje);

  let multa = 0; let regraMulta = '';
  const mPct = m(R`multa[^%\d]{0,30}${N}\s*%`) ?? m(R`${N}\s*%\s*(?:de\s+)?multa`);
  const mRs = m(R`multa[^%\d]{0,30}r\$\s*${N}`);
  if (mRs) { multa = numBR(mRs[1]); regraMulta = `multa R$ ${mRs[1]}`; }
  else if (mPct) { multa = valor * numBR(mPct[1]) / 100; regraMulta = `multa ${mPct[1]}%`; }
  else if (/multa/.test(t)) return null;

  let juros = 0; let regraJuros = '';
  const MES = R`(?:ao\s+mes|a\.?\s?m\.?(?![a-z])|mensa)`;
  const DIA = R`(?:ao\s+dia|por\s+dia|a\.?\s?d\.?(?![a-z])|diari)`;
  const JM = '(?:juros|mora)';
  const jRsDia = m(R`${JM}[^%\d]{0,40}r\$\s*${N}\s*(?:de\s+\w+\s+)?${DIA}`) ?? m(R`${JM}\s+${DIA}\w*[^%\d]{0,20}r\$\s*${N}`);
  const jPctMes = m(R`${JM}[^%\d]{0,40}${N}\s*%\s*(?:de\s+\w+\s+)?${MES}`) ?? m(R`${N}\s*%\s*${MES}[^.]{0,20}${JM}`);
  const jPctDia = m(R`${JM}[^%\d]{0,40}${N}\s*%\s*(?:de\s+\w+\s+)?${DIA}`) ?? m(R`${N}\s*%\s*${DIA}[^.]{0,20}${JM}`);
  if (jRsDia) { juros = numBR(jRsDia[1]) * dias; regraJuros = `juros R$ ${jRsDia[1]} ao dia`; }
  else if (jPctDia) { juros = valor * numBR(jPctDia[1]) / 100 * dias; regraJuros = `juros ${jPctDia[1]}% ao dia`; }
  else if (jPctMes) { juros = valor * numBR(jPctMes[1]) / 100 / 30 * dias; regraJuros = `juros ${jPctMes[1]}% ao mês`; }
  else if (/juros|mora/.test(t)) return null;

  if (!Number.isFinite(multa) || !Number.isFinite(juros) || multa < 0 || juros < 0) return null;
  multa = round2(multa); juros = round2(juros);
  const total = round2(valor + multa + juros);
  // Trava de plausibilidade: encargo acima de 30% do documento é leitura errada, não boleto.
  if (total > valor * 1.3) return null;
  const regra = [regraMulta, regraJuros].filter(Boolean).join(' + ') || 'sem multa/juros nas instruções';
  return { dias, multa, juros, total, regra };
}
