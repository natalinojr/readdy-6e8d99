// Leitura grátis de currículo em PDF (sem IA): pdf.js tira o texto e regras simples
// pegam o que tem formato previsível (e-mail, telefone, nascimento, cidade/UF).
// O resto fica no texto completo, pesquisável. Organizar experiências/resumo é
// papel da IA (Edge hiring-cv-scan), chamada só quando o usuário pedir.
import { pdfWords } from '@/lib/dominioExtrato';

export interface CurriculoLocal {
  full_name: string | null;
  email: string | null;
  phone: string | null;
  birth_date: string | null;
  age: number | null;
  city: string | null;
  neighborhood: string | null;
  desired_role: string | null;
  food_service_experience: boolean | null;
  raw_text: string;
}

// Abaixo disso o PDF é escaneado (imagem) e só a IA consegue ler.
const MIN_TEXT_CHARS = 150;

const UFS = 'AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO';
const FOOD_WORDS = /\b(restaurante|lanchonete|pizzaria|hamburgueria|churrascaria|padaria|confeitaria|cozinh\w*|chapeir\w*|garcom|garconete|bartender|barman|sushiman|pizzaiol\w*|auxiliar de cozinha|atendente de (lanchonete|restaurante)|food ?service|delivery|ifood|mcdonald\w*|burger king|subway|outback|madero|habib\w*|bobs|giraffas|coco bambu)\b/;
const HEADER_WORDS = /\b(curriculo|curriculum|vitae|resumo|dados pessoais|informacoes|objetivo|contato|perfil)\b/;

const strip = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
const titleCase = (s: string) => s.toLowerCase().replace(/(^|\s)(\p{L})/gu, (_m, sp, l) => sp + l.toUpperCase())
  .replace(/\s(Da|De|Do|Das|Dos|E)\s/g, (m) => m.toLowerCase());

/** Linhas de texto do PDF, na ordem de leitura (página, depois altura). */
async function pdfLines(file: File): Promise<string[]> {
  const pdfjs = await import('pdfjs-dist');
  const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const words = await pdfWords(pdfjs, await file.arrayBuffer());
  words.sort((a, b) => a.page - b.page || a.y - b.y || a.x - b.x);
  const lines: { page: number; y: number; parts: { x: number; s: string }[] }[] = [];
  for (const w of words) {
    const last = lines[lines.length - 1];
    if (last && last.page === w.page && Math.abs(last.y - w.y) <= 3) last.parts.push({ x: w.x, s: w.str });
    else lines.push({ page: w.page, y: w.y, parts: [{ x: w.x, s: w.str }] });
  }
  return lines
    .map((l) => l.parts.sort((a, b) => a.x - b.x).map((p) => p.s).join(' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

function findPhone(text: string): string | null {
  const re = /(?:\+?55[\s.-]?)?\(?\b(\d{2})\)?[\s.-]?(9?[\s.]?\d{4})[\s.-]?(\d{4})\b/g;
  for (const m of text.matchAll(re)) {
    const d = `${m[1]}${m[2]}${m[3]}`.replace(/\D/g, '');
    const ddd = Number(d.slice(0, 2));
    if (ddd >= 11 && ddd <= 99 && (d.length === 11 || d.length === 10)) return d;
  }
  return null;
}

function findBirth(text: string): { date: string | null; age: number | null } {
  const m = strip(text).match(/(nascimento|nasc\.?|nascid[oa] em)\D{0,25}(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/);
  if (m) {
    const [d, mo, y] = [Number(m[2]), Number(m[3]), Number(m[4])];
    if (d >= 1 && d <= 31 && mo >= 1 && mo <= 12 && y > 1940) {
      const now = new Date();
      let age = now.getFullYear() - y;
      if (now.getMonth() + 1 < mo || (now.getMonth() + 1 === mo && now.getDate() < d)) age--;
      return { date: `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`, age };
    }
  }
  const a = strip(text).match(/\b(\d{2})\s*anos\b/);
  const age = a && Number(a[1]) >= 14 && Number(a[1]) <= 80 ? Number(a[1]) : null;
  return { date: null, age };
}

function findName(lines: string[]): string | null {
  for (const l of lines.slice(0, 10)) {
    const clean = l.replace(/^(nome( completo)?\s*:\s*)/i, '').trim();
    if (/@|\d/.test(clean)) continue;
    if (HEADER_WORDS.test(strip(clean))) continue;
    const words = clean.split(/\s+/);
    if (words.length < 2 || words.length > 6) continue;
    if (!words.every((w) => /^[\p{L}'.-]+$/u.test(w))) continue;
    return titleCase(clean);
  }
  return null;
}

function afterLabel(lines: string[], label: RegExp, max = 80): string | null {
  for (let i = 0; i < lines.length; i++) {
    const s = strip(lines[i]);
    const m = s.match(label);
    if (!m) continue;
    const rest = lines[i].slice((m.index ?? 0) + m[0].length).replace(/^[\s:–-]+/, '').trim();
    const val = rest || lines[i + 1]?.trim() || '';
    if (val) return val.slice(0, max);
  }
  return null;
}

/** Lê o PDF no navegador. Devolve null quando o PDF não tem texto (escaneado). */
export async function readCurriculoPdf(file: File): Promise<CurriculoLocal | null> {
  const lines = await pdfLines(file);
  const raw_text = lines.join('\n');
  if (raw_text.replace(/\s/g, '').length < MIN_TEXT_CHARS) return null;

  const email = raw_text.match(/[\w.+-]+@[\w-]+(\.[\w-]+)+/)?.[0]?.toLowerCase() ?? null;
  const { date, age } = findBirth(raw_text);

  const cityM = raw_text.match(new RegExp(`([\\p{Lu}][\\p{L}' ]{2,40}?)\\s*[-/–,]\\s*(${UFS})\\b`, 'u'));
  const city = cityM ? titleCase(cityM[1].trim().replace(/^.*\b(cidade|endere[cç]o)\s*:?\s*/i, '')) : null;
  const neighborhood = afterLabel(lines, /\bbairro\b\s*:?/, 50)?.split(/[,-]/)[0].trim() || null;
  const desired_role = afterLabel(lines, /\b(objetivo( profissional)?|cargo pretendido|vaga pretendida|cargo)\b\s*:?/, 80);

  return {
    full_name: findName(lines),
    email,
    phone: findPhone(raw_text),
    birth_date: date,
    age,
    city,
    neighborhood,
    desired_role,
    // Só marca "sim" por palavra-chave; ausência não prova nada (fica null).
    food_service_experience: FOOD_WORDS.test(strip(raw_text)) ? true : null,
    raw_text,
  };
}
