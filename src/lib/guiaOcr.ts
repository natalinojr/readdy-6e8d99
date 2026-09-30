// Guia (DAS / DARF / FGTS Digital) que chegou como IMAGEM (PDF "Imprimir como PDF", escaneado):
// o texto vem do OCR gratuito no navegador (Tesseract) e o Pix do QR Code (jsQR). OCR erra dígitos,
// então nada daqui é aceito sem conferência:
//   - linha digitável: só blocos que passam no DV (módulo 10/11) e cujo DV geral fecha; "O"/"o" → 0;
//   - valor de DAS/DARF: o que está GRAVADO no código de barras (não o lido no texto);
//   - Pix: o do QR Code, só se o CRC16 bate;
//   - vencimento: "Pagar até: dd/mm/aaaa" do canhoto; sem ele, a maior data da guia.
// A saída é um resumo em texto no formato que o lerGuia do servidor já entende (_shared/guias.ts),
// seguido do texto do OCR. O servidor confere tudo de novo. Sem IA, sem custo. (2026-09-30)

export interface ResumoGuiaOcr {
  tipo: 'DAS' | 'DARF' | 'FGTS' | null;
  linha: string | null;        // 48 dígitos conferidos
  valor: string | null;        // "2.070,49"
  vencimento: string | null;   // "10/07/2026"
  numero: string | null;
  cnpj: string | null;
  competencia: string | null;  // "05/2026"
  pix: string | null;
}

const mod10 = (s: string) => {
  let t = 0, m = 2;
  for (let i = s.length - 1; i >= 0; i--) { const v = Number(s[i]) * m; t += Math.floor(v / 10) + (v % 10); m = m === 2 ? 1 : 2; }
  return (10 - (t % 10)) % 10;
};
const mod11 = (s: string) => {
  let t = 0, m = 2;
  for (let i = s.length - 1; i >= 0; i--) { t += Number(s[i]) * m; m = m === 9 ? 2 : m + 1; }
  const r = t % 11;
  return r === 0 || r === 1 ? 0 : 11 - r;
};

export function crc16Pix(s: string): string {
  let crc = 0xffff;
  for (const ch of new TextEncoder().encode(s)) {
    crc ^= ch << 8;
    for (let i = 0; i < 8; i++) crc = (crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

/** Pix copia e cola válido (CRC confere) ou null. */
export function pixValido(p: string | null | undefined): string | null {
  const s = String(p ?? '').trim();
  if (!/^000201/.test(s) || !/6304[0-9A-F]{4}$/i.test(s)) return null;
  return crc16Pix(s.slice(0, -4)) === s.slice(-4).toUpperCase() ? s : null;
}

// OCR troca O/o/D por 0 e I/l por 1 dentro de números
const digitosOcr = (s: string) => s.replace(/[Oo]/g, '0').replace(/[Il|]/g, '1');

/** Linha digitável de arrecadação (48 dígitos) conferida pelos DVs, ou null. */
export function linhaDaGuiaOcr(texto: string): string | null {
  // cada bloco: 11 dígitos + espaço/hífen + 1 dígito (aceitando O/I que o OCR confunde)
  // o separador do DV é opcional: o OCR às vezes cola ("910720261915")
  const re = /(?<![\dA-Za-z])([\dOoIl|]{11})\s*-?\s*([\dOoIl|])(?![\dA-Za-z])/g;
  const blocos: string[] = [];
  for (const m of texto.matchAll(re)) {
    const corpo = digitosOcr(m[1]);
    const dv = digitosOcr(m[2]);
    if (!/^\d{11}$/.test(corpo) || !/^\d$/.test(dv)) continue;
    const b = corpo + dv;
    const f = corpo[2] === '6' || corpo[2] === '7' ? mod10 : mod11;
    // o DV de cada bloco usa o módulo do 3º dígito do 1º bloco; testa os dois e decide no DV geral
    if (mod10(corpo) === Number(dv) || f(corpo) === Number(dv) || mod11(corpo) === Number(dv)) blocos.push(b);
  }
  for (let i = 0; i + 3 < blocos.length; i++) {
    if (!blocos[i].startsWith('8')) continue;
    const seq = blocos.slice(i, i + 4);
    const cod = seq.map((b) => b.slice(0, 11)).join('');
    const geral = cod[2] === '6' || cod[2] === '7' ? mod10 : mod11;
    const blocoOk = (b: string) => (cod[2] === '6' || cod[2] === '7' ? mod10 : mod11)(b.slice(0, 11)) === Number(b[11]);
    if (seq.every(blocoOk) && geral(cod.slice(0, 3) + cod.slice(4)) === Number(cod[3])) return seq.join('');
  }
  return null;
}

/** Linha como o OCR leu (4 blocos seguidos começando por 8), SEM conferir: o servidor conserta um
 *  dígito com o número do documento e o valor (repararArrecadacao) ou recusa. */
export function linhaBrutaOcr(texto: string): string | null {
  const m = texto.match(/(?<![\dA-Za-z])(8[\dOoIl|]{10}\s*-?\s*[\dOoIl|](?:\s+[\dOoIl|]{11}\s*-?\s*[\dOoIl|]){3})(?![\dA-Za-z])/);
  return m ? digitosOcr(m[1]).replace(/\s+/g, ' ').trim() : null;
}

const brl =(centavos: number) => (centavos / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const semAcento = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '');
const paraData = (d: string) => { const [dd, mm, aa] = d.split('/').map(Number); return aa * 10000 + mm * 100 + dd; };

export function resumirGuiaOcr(textoOcr: string, qr: string | null): ResumoGuiaOcr {
  const t = semAcento(String(textoOcr ?? ''));
  const pix = pixValido(qr);
  const tipo: ResumoGuiaOcr['tipo'] = /FGTS/i.test(t) || /caixa\.gov\.br/i.test(pix ?? '') ? 'FGTS'
    : /Simples\s+Nacional/i.test(t) ? 'DAS'
    : /Receitas\s+Federais|\bDARF\b/i.test(t) ? 'DARF' : null;
  const linha = tipo === 'FGTS' ? null : linhaDaGuiaOcr(t);
  // valor: DAS/DARF = gravado no código de barras (posições 5-15 do código de 44)
  let valor: string | null = null;
  if (linha) {
    const cod = [0, 12, 24, 36].map((i) => linha.slice(i, i + 11)).join('');
    valor = brl(Number(cod.slice(4, 15)));
  } else if (tipo === 'FGTS') {
    valor = t.match(/Total da Guia\s*:?\s*([\d.]+,\d{2})/i)?.[1] ?? t.match(/Valor a recolher\s*:?\s*([\d.]+,\d{2})/i)?.[1] ?? null;
  } else {
    // linha não conferiu: valor do texto (o servidor só aceita a linha consertada se bater com ele)
    valor = t.match(/Valor Total do Documento\s*:?\s*([\d.]+,\d{2})/i)?.[1] ?? null;
  }
  const datas = [...t.matchAll(/\b(\d{2}\/\d{2}\/20\d{2})\b/g)].map((m) => m[1]);
  const canhoto = t.match(/Pagar\s+at[e]?\s*:\s*(\d{2}\/\d{2}\/20\d{2})/i)?.[1] ?? null;
  const vencimento = canhoto ?? (datas.length ? datas.reduce((a, b) => (paraData(b) > paraData(a) ? b : a)) : null);
  const numero = t.match(/\b(\d{2}\.\d{2}\.\d{5}\.\d{7}-\d)\b/)?.[1] ?? t.match(/\b(\d{16}-\d)\b/)?.[1] ?? null;
  // FGTS Digital traz só a raiz (8 dígitos) do empregador
  const cnpj = t.match(/\b(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})\b/)?.[1]
    ?? (tipo === 'FGTS' ? t.match(/(?<![\d.])(\d{2}\.\d{3}\.\d{3})(?![\d/.])/)?.[1] ?? null : null);
  const MES = ['janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  const mesNome = t.match(/\b(janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\s*\/\s*(20\d{2})/i);
  const competencia = mesNome ? `${String(MES.indexOf(mesNome[1].toLowerCase()) + 1).padStart(2, '0')}/${mesNome[2]}`
    : t.match(/\bPA:?\s*(\d{2}\/20\d{2})\b/i)?.[1] ?? t.match(/(?<![\d/])(\d{2}\/20\d{2})(?![\d/])/)?.[1] ?? null;
  return { tipo, linha, valor, vencimento, numero, cnpj, competencia, pix };
}

/** Texto para o servidor: resumo conferido no formato do lerGuia + o texto do OCR. */
export function textoGuiaOcr(textoOcr: string, qr: string | null): { texto: string; resumo: ResumoGuiaOcr } {
  const r = resumirGuiaOcr(textoOcr, qr);
  const titulo = r.tipo === 'DAS' ? 'Documento de Arrecadação do Simples Nacional'
    : r.tipo === 'DARF' ? 'Documento de Arrecadação de Receitas Federais'
    : r.tipo === 'FGTS' ? 'GFD - Guia do FGTS Digital' : '';
  const linhas = [
    titulo,
    r.cnpj ? (r.tipo === 'FGTS' ? `CPF/CNPJ do Empregador: ${r.cnpj}` : `CNPJ: ${r.cnpj}`) : '',
    r.competencia ? (r.tipo === 'DARF' ? `PA: ${r.competencia}` : `Competência ${r.competencia}`) : '',
    r.numero ? (r.tipo === 'FGTS' ? `Identificador: ${r.numero}` : `Número do Documento: ${r.numero}`) : '',
    r.vencimento ? `Pagar este documento até: ${r.vencimento}` : '',
    r.valor ? (r.tipo === 'FGTS' ? `Valor a recolher: ${r.valor}` : `Valor Total do Documento: ${r.valor}`) : '',
    r.linha ? `Linha digitável: ${[0, 12, 24, 36].map((i) => `${r.linha!.slice(i, i + 11)} ${r.linha![i + 11]}`).join(' ')}`
      : r.tipo && r.tipo !== 'FGTS' ? (() => { const b = linhaBrutaOcr(semAcento(textoOcr)); return b ? `Linha digitável: ${b}` : ''; })() : '',
    r.pix ? `PIX Copia e Cola: ${r.pix}` : '',
  ].filter(Boolean);
  return { texto: `${linhas.join('\n')}\n\n${textoOcr}`, resumo: r };
}
