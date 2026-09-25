// Guias de imposto e encargo que chegam todo mês (dono, 2026-09-18): DAS (Simples Nacional),
// DARF previdenciário (INSS descontado da folha) e GFD (FGTS Digital). Leitura EXATA, sem modelo:
// - a linha digitável só vale se os dígitos verificadores conferem (a leitura por IA do DAS de
//   08/2026 perdeu um "9" e a do DARF perdeu o último dígito — 47 em vez de 48);
// - DAS e DARF trazem o número do documento dentro do código de barras: com ele dá para consertar
//   um dígito perdido/trocado e ter certeza de que o conserto é o certo (candidato único);
// - o FGTS Digital não tem código de barras, só Pix copia e cola (QR dinâmico da Caixa): o CRC do
//   BR Code confere se o texto está inteiro.
// Funções puras: o texto vem da camada de texto do PDF (pdf-texto.ts) ou da transcrição da foto.

export const soDigitos = (s: unknown) => String(s ?? '').replace(/\D/g, '');

function mod10(num: string): number {
  let sum = 0, w = 2;
  for (let i = num.length - 1; i >= 0; i--) { let p = Number(num[i]) * w; if (p > 9) p = Math.floor(p / 10) + (p % 10); sum += p; w = w === 2 ? 1 : 2; }
  return (10 - (sum % 10)) % 10;
}
function mod11Conv(num: string): number {
  let sum = 0, w = 2;
  for (let i = num.length - 1; i >= 0; i--) { sum += Number(num[i]) * w; w = w === 9 ? 2 : w + 1; }
  const r = sum % 11;
  return r <= 1 ? 0 : 11 - r;
}
function mod11Banco(num: string): number {
  let sum = 0, w = 2;
  for (let i = num.length - 1; i >= 0; i--) { sum += Number(num[i]) * w; w = w === 9 ? 2 : w + 1; }
  const dv = 11 - (sum % 11);
  return dv === 0 || dv === 10 || dv === 11 ? 1 : dv;
}

// Linha de arrecadação (convênio/tributo): 48 dígitos, 4 blocos de 11 + DV. 3º dígito 6/7 = módulo 10.
export function arrecadacaoValida(d: string): boolean {
  if (d.length !== 48 || d[0] !== '8') return false;
  const dv = d[2] === '6' || d[2] === '7' ? mod10 : mod11Conv;
  for (let i = 0; i < 48; i += 12) if (dv(d.slice(i, i + 11)) !== Number(d[i + 11])) return false;
  const bc = barrasDaArrecadacao(d);
  return dv(bc.slice(0, 3) + bc.slice(4)) === Number(bc[3]);
}
export const barrasDaArrecadacao = (d: string) => [0, 12, 24, 36].map((i) => d.slice(i, i + 11)).join('');
// Valor no código de arrecadação (só quando o 3º dígito é 6 ou 8 = valor real).
export function valorDaArrecadacao(d: string): number | null {
  const bc = barrasDaArrecadacao(d);
  if (!(bc[2] === '6' || bc[2] === '8')) return null;
  const v = Number(bc.slice(4, 15)) / 100;
  return v > 0 ? Math.round(v * 100) / 100 : null;
}
// Boleto bancário: 47 dígitos, 3 campos com DV módulo 10 + DV geral módulo 11 do código de barras.
export function bancariaValida(d: string): boolean {
  if (d.length !== 47 || d[0] === '8') return false;
  if (mod10(d.slice(0, 9)) !== Number(d[9]) || mod10(d.slice(10, 20)) !== Number(d[20]) || mod10(d.slice(21, 31)) !== Number(d[31])) return false;
  const bc = d.slice(0, 4) + d[32] + d.slice(33, 47) + d.slice(4, 9) + d.slice(10, 20) + d.slice(21, 31);
  return mod11Banco(bc.slice(0, 4) + bc.slice(5)) === Number(bc[4]);
}
export const linhaValida = (raw: unknown) => { const d = soDigitos(raw); return arrecadacaoValida(d) || bancariaValida(d); };

// Linhas válidas escritas no texto (com espaço, ponto ou hífen entre os blocos). Janela deslizante
// porque o PDF às vezes cola a linha em outro número (ex.: o CNPJ ao lado, no canhoto).
export function acharLinhas(texto: string): string[] {
  const out: string[] = [];
  for (const m of String(texto ?? '').matchAll(/\d[\d \t.\-]{44,120}\d/g)) {
    const d = soDigitos(m[0]);
    for (let i = 0; i + 47 <= d.length; i++) {
      const a = d.slice(i, i + 48);
      if (a.length === 48 && arrecadacaoValida(a)) out.push(a);
      const b = d.slice(i, i + 47);
      if (bancariaValida(b)) out.push(b);
    }
  }
  return [...new Set(out)];
}

// Conserta UM dígito perdido, sobrando ou trocado numa linha de arrecadação — só quando o número do
// documento (impresso em destaque, lido à parte) está dentro do código e sobra UM candidato só.
export function repararArrecadacao(lida: unknown, numeroDocumento: unknown, valor?: number | null): string | null {
  const d = soDigitos(lida);
  const exigir = soDigitos(numeroDocumento);
  if (arrecadacaoValida(d)) return d;
  if (exigir.length < 12 || d[0] !== '8' || d.length < 47 || d.length > 49) return null;
  const cands = new Set<string>();
  const testa = (c: string) => {
    if (!arrecadacaoValida(c) || !barrasDaArrecadacao(c).includes(exigir)) return;
    const v = valorDaArrecadacao(c);
    if (valor != null && v != null && Math.abs(v - valor) > 0.005) return;
    cands.add(c);
  };
  if (d.length === 47) for (let i = 0; i <= 47; i++) for (let k = 0; k <= 9; k++) testa(d.slice(0, i) + k + d.slice(i));
  if (d.length === 49) for (let i = 0; i < 49; i++) testa(d.slice(0, i) + d.slice(i + 1));
  if (d.length === 48) for (let i = 0; i < 48; i++) for (let k = 0; k <= 9; k++) if (String(k) !== d[i]) testa(d.slice(0, i) + k + d.slice(i + 1));
  return cands.size === 1 ? [...cands][0] : null;
}

// ── Pix copia e cola (BR Code / EMV) ──
export function crc16(s: string): string {
  let crc = 0xffff;
  for (const b of new TextEncoder().encode(s)) {
    crc ^= b << 8;
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}
export function copiaValida(p: unknown): boolean {
  const s = String(p ?? '');
  if (!s.startsWith('000201') || s.length < 30) return false;
  const i = s.length - 8;
  return s.slice(i, i + 4) === '6304' && crc16(s.slice(0, i + 4)) === s.slice(i + 4).toUpperCase();
}
export function acharCopiaECola(texto: string): string | null {
  const t = String(texto ?? '').replace(/\r?\n/g, '');
  for (let ini = t.indexOf('000201'); ini >= 0; ini = t.indexOf('000201', ini + 1)) {
    for (let fim = t.indexOf('6304', ini); fim >= 0; fim = t.indexOf('6304', fim + 1)) {
      const c = t.slice(ini, fim + 8);
      if (copiaValida(c)) return c;
    }
  }
  return null;
}
// Campos de primeiro nível do BR Code (+ o subcampo 25 = location do QR dinâmico).
export function lerCopia(p: string): { nome: string | null; cidade: string | null; valor: number | null; location: string | null; chave: string | null } {
  const tlv = (s: string) => {
    const m = new Map<string, string>();
    for (let i = 0; i + 4 <= s.length;) {
      const id = s.slice(i, i + 2), n = Number(s.slice(i + 2, i + 4));
      if (!Number.isFinite(n)) break;
      m.set(id, s.slice(i + 4, i + 4 + n)); i += 4 + n;
    }
    return m;
  };
  const top = tlv(p);
  const conta = tlv(top.get('26') ?? '');
  const v = top.get('54');
  return { nome: top.get('59') ?? null, cidade: top.get('60') ?? null, valor: v ? Number(v) : null, location: conta.get('25') ?? null, chave: conta.get('01') ?? null };
}

// ── Guias ──
export type Guia = {
  tipo: 'DAS' | 'DARF' | 'FGTS';
  titulo: string;           // "DAS Simples Nacional", "DARF INSS (previdência)", "FGTS Digital (GFD)"
  fornecedor: string;       // quem recebe
  encargo_folha: boolean;   // INSS descontado / FGTS: o custo já entra na DRE pela folha
  competencia: string | null; // AAAA-MM
  vencimento: string | null;  // AAAA-MM-DD
  valor: number | null;
  cnpj: string | null;      // 14 dígitos, ou a raiz de 8 (a GFD só traz a raiz)
  numero: string | null;
  linha: string | null;     // 48 dígitos validados
  copia_e_cola: string | null; // BR Code validado (CRC)
  composicao: string | null;
  linha_reparada: boolean;
  completa: boolean;
};

const MESES = ['janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const semAcento = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '');
const num = (s: string | undefined) => (s ? Number(s.replace(/\./g, '').replace(',', '.')) : NaN);
const dataIso = (dd: string, mm: string, aaaa: string) => `${aaaa}-${mm}-${dd}`;

export function lerGuia(textoBruto: string, linhaLida?: string | null): Guia | null {
  const texto = String(textoBruto ?? '');
  const t = semAcento(texto);
  let tipo: Guia['tipo'] | null = null;
  if (/Guia do FGTS Digital|\bGFD\b/i.test(t)) tipo = 'FGTS';
  else if (/Arrecadacao do Simples Nacional|\bDAS\b.{0,40}Simples Nacional/i.test(t)) tipo = 'DAS';
  else if (/Arrecadacao de Receitas Federais|\bDARF\b/i.test(t)) tipo = 'DARF';
  if (!tipo) return null;
  const previdencia = tipo === 'DARF' && /\b(1082|1099|1138|1141|1170|1176|1191|1196|1200|1646)\b|CONTR(IB)?\.? PREV|CP SEGURADOS|PREVIDENCI/i.test(t);
  // IRRF descontado do salário (código 0561, 2026-09-25): o imposto já está no bruto da folha, que a DRE
  // conta — lançado como "Impostos" contava duas vezes. Vira encargo da folha, igual ao INSS descontado.
  const irrfFolha = tipo === 'DARF' && /\b0561\b|TRABALHO ASSALARIADO/i.test(t);

  // Competência: "agosto/2026" (Receita) · "PA:08/2026" · "08/2026" solto (GFD), nunca o fim de uma data.
  let competencia: string | null = null;
  const mesNome = t.match(/\b(janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\s*\/\s*(20\d{2})/i);
  if (mesNome) competencia = `${mesNome[2]}-${String(MESES.indexOf(mesNome[1].toLowerCase()) + 1).padStart(2, '0')}`;
  const pa = competencia ? null : t.match(/PA:\s*(0[1-9]|1[0-2])\/(20\d{2})/i) ?? t.match(/(?<!\/)(0[1-9]|1[0-2])\/(20\d{2})(?!\/)/);
  if (pa) competencia = `${pa[2]}-${pa[1]}`;

  const venc = t.match(/Pagar (?:este documento )?ate:?\s*(\d{2})\/(\d{2})\/(\d{4})/i)
    ?? t.match(/Data de Vencimento[\s\S]{0,120}?(\d{2})\/(\d{2})\/(\d{4})/i);
  const vencimento = venc ? dataIso(venc[1], venc[2], venc[3]) : null;

  const vTxt = t.match(/Valor Total do Documento\s*:?\s*(?:R\$\s*)?([\d.]+,\d{2})/i)?.[1]
    ?? t.match(/Total da Guia\s*:?\s*(?:R\$\s*)?([\d.]+,\d{2})/i)?.[1]
    ?? t.match(/Valor a recolher\s*:?\s*(?:R\$\s*)?([\d.]+,\d{2})/i)?.[1]
    ?? t.match(/\bValor\s*:\s*(?:R\$\s*)?([\d.]+,\d{2})/i)?.[1];
  const valor = Number.isFinite(num(vTxt)) && num(vTxt) > 0 ? Math.round(num(vTxt) * 100) / 100 : null;

  const cnpj14 = t.match(/(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})/)?.[1];
  const raiz = t.match(/CPF\/CNPJ do Empregador\s*:?\s*(\d{2}\.\d{3}\.\d{3})/i)?.[1];
  const cnpj = cnpj14 ? soDigitos(cnpj14) : raiz ? soDigitos(raiz) : null;

  const numero = t.match(/N(?:u|ú)mero(?: do Documento)?\s*:?\s*(\d{2}\.\d{2}\.\d{5}\.\d{7}-\d)/i)?.[1]
    ?? t.match(/(\d{2}\.\d{2}\.\d{5}\.\d{7}-\d)/)?.[1]
    ?? t.match(/Identificador\s*:?\s*([\d]{10,20}-\d)/i)?.[1] ?? null;

  // Linha: a que está escrita e confere; senão a lida (conserto só com o número do documento).
  let linha: string | null = null;
  let reparada = false;
  if (tipo !== 'FGTS') {
    const achadas = acharLinhas(texto).filter((l) => l.length === 48);
    linha = achadas.find((l) => !numero || barrasDaArrecadacao(l).includes(soDigitos(numero))) ?? achadas[0] ?? null;
    if (!linha && linhaLida) {
      const r = repararArrecadacao(linhaLida, numero, valor);
      if (r) { linha = r; reparada = !arrecadacaoValida(soDigitos(linhaLida)); }
    }
    if (!linha) {
      // A transcrição às vezes traz a linha com um dígito a menos, em blocos: tenta consertar cada candidata.
      for (const m of texto.matchAll(/8\d{10}[ \t.\-]?\d[\d \t.\-]{30,60}\d/g)) {
        const r = repararArrecadacao(m[0], numero, valor);
        if (r) { linha = r; reparada = true; break; }
      }
    }
  }
  const copia = acharCopiaECola(texto);

  // Composição (vai nas observações da conta): "1082 CONTR PREV ... 171,72".
  const itens: string[] = [];
  for (const m of texto.matchAll(/^\s*(\d{4})\s+(.{3,70}?)\s+(?:[\d.]+,\d{2}\s+)*?([\d.]+,\d{2})\s*$/gm)) itens.push(`${m[1]} ${m[2].replace(/(\s+(?:[\d.]+,\d{2}|-|Principal|Total))+\s*$/i, '').trim()}: ${m[3]}`);
  if (tipo === 'FGTS') {
    const f = t.match(/Total FGTS\s*:?\s*([\d.]+,\d{2})/i)?.[1];
    const c = t.match(/Total Consignado\s*:?\s*([\d.]+,\d{2})/i)?.[1];
    if (f) itens.push(`FGTS: ${f}`);
    if (c && num(c) > 0) itens.push(`Consignado (desconto de empréstimo em folha): ${c}`);
  }

  const titulo = tipo === 'DAS' ? 'DAS Simples Nacional' : tipo === 'FGTS' ? 'FGTS Digital (GFD)' : previdencia ? 'DARF INSS (previdência)' : irrfFolha ? 'DARF IRRF (folha)' : 'DARF';
  const fornecedor = tipo === 'FGTS' ? 'Caixa Econômica Federal (FGTS Digital)' : 'Receita Federal';
  const pagavel = tipo === 'FGTS' ? !!copia : !!linha;
  return {
    tipo, titulo, fornecedor, encargo_folha: tipo === 'FGTS' || previdencia || irrfFolha,
    competencia, vencimento, valor, cnpj, numero, linha, copia_e_cola: copia,
    composicao: itens.length ? itens.join('; ').slice(0, 600) : null,
    linha_reparada: reparada,
    completa: !!(vencimento && valor && cnpj && pagavel),
  };
}
