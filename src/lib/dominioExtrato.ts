// Leitor do "Extrato Mensal" da folha gerado pelo Domínio (Thomson Reuters).
// Sem IA: usa o texto e a POSIÇÃO de cada palavra na página (o PDF que o Domínio
// exporta — produtor "Amyuni PDF Converter" — tem camada de texto). PDFs "impressos"
// pelo Microsoft Print to PDF viram desenho e não têm texto: o leitor avisa.
//
// Layout (A4, pontos, y de cima para baixo):
//   cabeçalho  Competência: MM/AAAA · CNPJ
//   por pessoa "Empr.:" (empregado) ou "Contr:" (contribuinte/sócio) + Situação, CPF, Adm,
//              Vínculo, Cargo, Salário; rubricas em duas colunas (proventos à esquerda,
//              descontos à direita), cada uma "código descrição referência valor P|D";
//              linha ND (Proventos, Descontos, Informativa, Líquido) e NF (bases, FGTS).
//   fim        "Total Geral Proventos/Descontos", "Líquido Geral", quadro de Situações.

export interface PdfWord { str: string; x: number; y: number; page: number }

export interface Rubrica { codigo: string; descricao: string; referencia: string | null; valor: number; tipo: 'P' | 'D' }

export interface FuncionarioExtrato {
  codigo: string;
  nome: string;
  tipo: 'empregado' | 'contribuinte';
  situacao: string;           // Trabalhando, Demitido, Férias...
  cpf: string | null;         // só dígitos
  admissao: string | null;    // AAAA-MM-DD
  vinculo: string;            // Celetista, Diretor...
  cargo: string;
  salario: number;
  rubricas: Rubrica[];
  proventos: number;
  descontos: number;
  liquido: number;
  baseInss: number;
  baseFgts: number;
  valorFgts: number;
  baseIrrf: number;
  demissao: { data: string | null; motivo: string } | null;
  avisos: string[];
}

export interface ExtratoDominio {
  empresa: string;
  cnpj: string | null;
  competencia: string;        // AAAA-MM
  funcionarios: FuncionarioExtrato[];
  totais: { proventos: number | null; descontos: number | null; liquido: number | null; fgts: number | null; inss: number | null };
  avisos: string[];
}

const LABEL_RE = /:$/;
const NUM_RE = /^-?\d{1,3}(\.\d{3})*,\d{2}$|^-?\d+,\d{2}$/;
const REF_RE = /^(\d+:\d{2}|-?\d{1,3}(\.\d{3})*,\d{2}|\d+)$/;

export function brNum(s: string | null | undefined): number {
  if (s == null) return 0;
  const t = String(s).trim().replace(/\./g, '').replace(',', '.');
  const n = Number(t);
  return Number.isFinite(n) ? n : 0;
}
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const dataIso = (s: string | null | undefined) => {
  const m = String(s ?? '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
};
/** "11:29" (horas:minutos) → 11.48 horas. */
export function refHoras(ref: string | null): number {
  const m = String(ref ?? '').match(/^(\d+):(\d{2})$/);
  if (m) return round2(Number(m[1]) + Number(m[2]) / 60);
  return brNum(ref);
}

interface Row { y: number; page: number; words: PdfWord[] }

/** Quebra itens do PDF em palavras (cada item pode ter várias) e agrupa em linhas. */
function toRows(items: PdfWord[]): Row[] {
  const words: PdfWord[] = [];
  for (const it of items) {
    const parts = it.str.split(/\s+/).filter(Boolean);
    // Espaça as palavras de um mesmo item para manter a ordem por x.
    parts.forEach((p, i) => words.push({ str: p, x: it.x + i * 0.01, y: it.y, page: it.page }));
  }
  words.sort((a, b) => a.page - b.page || a.y - b.y || a.x - b.x);
  const rows: Row[] = [];
  for (const w of words) {
    const last = rows[rows.length - 1];
    if (last && last.page === w.page && Math.abs(w.y - last.y) <= 4) last.words.push(w);
    else rows.push({ y: w.y, page: w.page, words: [w] });
  }
  for (const r of rows) r.words.sort((a, b) => a.x - b.x);
  return rows;
}

const text = (ws: PdfWord[]) => ws.map((w) => w.str).join(' ').trim();

/** Palavras depois do rótulo, até o próximo rótulo ("Xxx:"), limitadas a maxX. */
function after(row: Row, label: string, maxX = Infinity): string {
  const i = row.words.findIndex((w) => w.str === label);
  if (i < 0) return '';
  const out: string[] = [];
  for (const w of row.words.slice(i + 1)) {
    if (w.x > maxX) break;
    if (LABEL_RE.test(w.str) && w.str.length > 1) break;
    out.push(w.str);
  }
  return out.join(' ').trim();
}
/** Primeiro número (formato BR) depois do rótulo. */
function numAfter(rows: Row[], label: string): number | null {
  for (const r of rows) {
    const i = r.words.findIndex((w) => w.str === label);
    if (i < 0) continue;
    const n = r.words.slice(i + 1).find((w) => NUM_RE.test(w.str) || /^-?\d+$/.test(w.str));
    if (n) return brNum(n.str);
  }
  return null;
}
/** Rótulo composto ("Total Geral Proventos:") → número depois dele. */
function numAfterPhrase(rows: Row[], phrase: string[]): number | null {
  for (const r of rows) {
    const ws = r.words;
    for (let i = 0; i + phrase.length <= ws.length; i++) {
      if (phrase.every((p, k) => ws[i + k].str === p)) {
        const n = ws.slice(i + phrase.length).find((w) => NUM_RE.test(w.str));
        if (n) return brNum(n.str);
      }
    }
  }
  return null;
}

/** Uma coluna de rubrica: "código descrição [referência] valor P|D". */
function parseRubrica(ws: PdfWord[]): Rubrica | null {
  const t = ws.map((w) => w.str);
  if (t.length < 3) return null;
  const tipo = t[t.length - 1];
  if (tipo !== 'P' && tipo !== 'D') return null;
  const valor = t[t.length - 2];
  if (!NUM_RE.test(valor)) return null;
  if (!/^\d+$/.test(t[0])) return null;
  let fimDesc = t.length - 2;
  let referencia: string | null = null;
  if (fimDesc - 1 >= 1 && REF_RE.test(t[fimDesc - 1])) { referencia = t[fimDesc - 1]; fimDesc--; }
  const descricao = t.slice(1, fimDesc).join(' ').trim();
  if (!descricao) return null;
  return { codigo: t[0], descricao, referencia, valor: brNum(valor), tipo };
}

/** Linha de rubricas: separa a coluna de proventos (esquerda) da de descontos (direita). */
function parseRubricaRow(row: Row): Rubrica[] {
  // O "P"/"D" fecha cada coluna: corta logo depois do primeiro P/D da esquerda.
  const idx = row.words.findIndex((w) => (w.str === 'P' || w.str === 'D') && w.x < 300);
  const cols = idx >= 0 ? [row.words.slice(0, idx + 1), row.words.slice(idx + 1)] : [row.words];
  return cols.map(parseRubrica).filter((r): r is Rubrica => r !== null);
}

export function parseExtratoDominio(items: PdfWord[]): ExtratoDominio {
  const avisos: string[] = [];
  const rows = toRows(items);
  if (rows.length === 0) {
    return { empresa: '', cnpj: null, competencia: '', funcionarios: [], totais: { proventos: null, descontos: null, liquido: null, fgts: null, inss: null },
      avisos: ['O PDF não tem texto. Peça o extrato salvo direto pelo Domínio (não pela impressora "Microsoft Print to PDF").'] };
  }
  const headerRow = rows.find((r) => r.words.some((w) => w.str === 'Competência:'));
  const comp = headerRow ? after(headerRow, 'Competência:') : '';
  const cm = comp.match(/(\d{2})\/(\d{4})/);
  const competencia = cm ? `${cm[2]}-${cm[1]}` : '';
  if (!competencia) avisos.push('Não achei a competência (MM/AAAA) no cabeçalho.');
  const cnpjRow = rows.find((r) => r.words[0]?.str === 'CNPJ:');
  const cnpj = cnpjRow ? (cnpjRow.words.find((w) => /\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/.test(w.str))?.str.replace(/\D/g, '') ?? null) : null;
  const empRow = rows.find((r) => r.page === 1 && r.words.some((w) => w.str === 'LTDA' || w.str === 'ME' || w.str === 'EIRELI' || w.str === 'S/A'));
  const empresa = empRow ? text(empRow.words.filter((w) => w.x < 400)).replace(/^Empresa:\s*/, '').replace(/^\d+\s*-\s*/, '') : '';

  // Blocos por pessoa
  const funcionarios: FuncionarioExtrato[] = [];
  let cur: FuncionarioExtrato | null = null;
  let curRows: Row[] = [];
  const fechar = () => {
    if (!cur) return;
    const f = cur;
    f.proventos = numAfter(curRows, 'Proventos:') ?? 0;
    f.descontos = numAfter(curRows, 'Descontos:') ?? 0;
    f.liquido = numAfter(curRows, 'Líquido:') ?? 0;
    f.baseInss = numAfter(curRows, 'INSS:') ?? 0;
    f.baseIrrf = numAfter(curRows, 'IRRF:') ?? 0;
    // "Base FGTS:" e "Valor FGTS:" — o rótulo "FGTS:" aparece duas vezes na linha NF.
    const nf = curRows.find((r) => r.words[0]?.str === 'NF:');
    if (nf) {
      const fg = nf.words.map((w, i) => ({ w, i })).filter(({ w }) => w.str === 'FGTS:');
      const val = (i: number) => { const n = nf.words.slice(i + 1).find((w) => NUM_RE.test(w.str)); return n ? brNum(n.str) : 0; };
      if (fg[0]) f.baseFgts = val(fg[0].i);
      if (fg[1]) f.valorFgts = val(fg[1].i);
    }
    const somaP = round2(f.rubricas.filter((r) => r.tipo === 'P').reduce((s, r) => s + r.valor, 0));
    const somaD = round2(f.rubricas.filter((r) => r.tipo === 'D').reduce((s, r) => s + r.valor, 0));
    if (Math.abs(somaP - f.proventos) > 0.02) f.avisos.push(`Soma dos proventos lidos (${somaP.toFixed(2)}) difere do total (${f.proventos.toFixed(2)}).`);
    if (Math.abs(somaD - f.descontos) > 0.02) f.avisos.push(`Soma dos descontos lidos (${somaD.toFixed(2)}) difere do total (${f.descontos.toFixed(2)}).`);
    if (Math.abs(round2(f.proventos - f.descontos) - f.liquido) > 0.02) f.avisos.push('Proventos − descontos não bate com o líquido.');
    funcionarios.push(f);
    cur = null; curRows = [];
  };

  let fimDosBlocos = false;
  for (const r of rows) {
    const first = r.words[0]?.str ?? '';
    const linha = text(r.words);
    if (/^Resumo por Rubrica/.test(linha) || /^Total Geral Proventos/.test(linha)) { fechar(); fimDosBlocos = true; }
    if (fimDosBlocos) continue;
    if (first === 'Empr.:' || first === 'Contr:') {
      fechar();
      const nomeFull = after(r, first, 200);
      const nm = nomeFull.match(/^(\d+)\s+(.*)$/);
      cur = {
        codigo: nm ? nm[1] : '', nome: (nm ? nm[2] : nomeFull).trim(),
        tipo: first === 'Contr:' ? 'contribuinte' : 'empregado',
        situacao: after(r, 'Situação:', 340), cpf: (after(r, 'CPF:', 460).replace(/\D/g, '') || null),
        admissao: dataIso(after(r, 'Adm:')), vinculo: '', cargo: '', salario: 0, rubricas: [],
        proventos: 0, descontos: 0, liquido: 0, baseInss: 0, baseFgts: 0, valorFgts: 0, baseIrrf: 0, demissao: null, avisos: [],
      };
      curRows = [r];
      continue;
    }
    if (!cur) continue;
    const f: FuncionarioExtrato = cur;
    curRows.push(r);
    if (first === 'Vínculo:') { f.vinculo = after(r, 'Vínculo:', 220); continue; }
    if (first === 'Cargo:') {
      f.cargo = after(r, 'Cargo:', 210).replace(/^\d+\s+/, '');
      const sal = r.words.find((w, i) => i > 0 && r.words[i - 1].str === 'Salário:');
      f.salario = sal ? brNum(sal.str) : 0;
      continue;
    }
    if (first === 'ND:' || first === 'NF:' || r.words.some((w) => w.str === 'Informativa:' || w.str === 'Dedutora:')) continue;
    if (first === 'DEMITIDO') {
      const d = r.words.find((w) => /^\d{2}\/\d{2}\/\d{4}$/.test(w.str));
      const mi = r.words.findIndex((w) => w.str === 'MOTIVO');
      f.demissao = { data: dataIso(d?.str), motivo: mi >= 0 ? text(r.words.slice(mi + 1)).replace(/^\d+-/, '') : '' };
      continue;
    }
    if (first === 'Filial:') continue;
    f.rubricas.push(...parseRubricaRow(r));
  }
  fechar();

  const totais = {
    proventos: numAfterPhrase(rows, ['Total', 'Geral', 'Proventos:']),
    descontos: numAfterPhrase(rows, ['Total', 'Geral', 'Descontos:']),
    liquido: numAfterPhrase(rows, ['Líquido', 'Geral:']) ?? numAfterPhrase(rows, ['Líquido', 'Filial:']),
    fgts: numAfterPhrase(rows, ['Valor', 'do', 'FGTS:']),
    inss: numAfterPhrase(rows, ['Total', 'INSS:']),
  };
  if (funcionarios.length === 0) avisos.push('Nenhum funcionário encontrado. Confira se é o "Extrato Mensal" da folha do Domínio.');
  if (totais.liquido != null) {
    const soma = round2(funcionarios.reduce((s, f) => s + f.liquido, 0));
    if (Math.abs(soma - totais.liquido) > 0.02) avisos.push(`Soma dos líquidos lidos (${soma.toFixed(2)}) difere do Líquido Geral (${totais.liquido.toFixed(2)}).`);
  }
  return { empresa, cnpj, competencia, funcionarios, totais, avisos };
}

/** Extrai as palavras com posição de um PDF (no navegador ou no Node) usando pdf.js. */
// deno-lint-ignore no-explicit-any
export async function pdfWords(pdfjs: any, data: ArrayBuffer | Uint8Array): Promise<PdfWord[]> {
  // Cópia em Uint8Array puro: o pdf.js recusa Buffer do Node e pode "consumir" o ArrayBuffer original.
  const bytes = new Uint8Array(data instanceof Uint8Array ? data.slice() : new Uint8Array(data).slice());
  const doc = await pdfjs.getDocument({ data: bytes }).promise;
  const out: PdfWord[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const vp = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();
    for (const it of tc.items as { str: string; transform: number[]; height: number }[]) {
      if (!it.str || !it.str.trim()) continue;
      out.push({ str: it.str, x: it.transform[4], y: vp.height - it.transform[5] - (it.height || 0), page: p });
    }
  }
  return out;
}
