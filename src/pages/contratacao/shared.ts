// Tipos, constantes e helpers do módulo Contratação.
// O módulo é independente das lojas do ERPOS: tem empresas próprias (hiring_companies),
// fases do kanban editáveis (hiring_stages, 4 nativas) e configurações (hiring_settings).
import { supabase } from '@/lib/supabase';

export const OWNER_EMAIL = 'natalinojr.engel@gmail.com';
export const BUCKET = 'curriculos';

// ── Cores das fases (classes literais para o Tailwind) ──────────────────────
export const COLORS: Record<string, { label: string; cls: string; bar: string; dot: string }> = {
  sky: { label: 'Azul', cls: 'bg-sky-50 text-sky-700 border-sky-200', bar: 'bg-sky-400', dot: 'bg-sky-500' },
  indigo: { label: 'Índigo', cls: 'bg-indigo-50 text-indigo-700 border-indigo-200', bar: 'bg-indigo-400', dot: 'bg-indigo-500' },
  violet: { label: 'Roxo', cls: 'bg-violet-50 text-violet-700 border-violet-200', bar: 'bg-violet-400', dot: 'bg-violet-500' },
  rose: { label: 'Rosa', cls: 'bg-rose-50 text-rose-700 border-rose-200', bar: 'bg-rose-400', dot: 'bg-rose-500' },
  orange: { label: 'Laranja', cls: 'bg-orange-50 text-orange-700 border-orange-200', bar: 'bg-orange-400', dot: 'bg-orange-500' },
  amber: { label: 'Amarelo', cls: 'bg-amber-50 text-amber-700 border-amber-200', bar: 'bg-amber-400', dot: 'bg-amber-500' },
  teal: { label: 'Verde-água', cls: 'bg-teal-50 text-teal-700 border-teal-200', bar: 'bg-teal-400', dot: 'bg-teal-500' },
  emerald: { label: 'Verde', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', bar: 'bg-emerald-400', dot: 'bg-emerald-500' },
  green: { label: 'Verde forte', cls: 'bg-green-600 text-white border-green-600', bar: 'bg-green-600', dot: 'bg-green-600' },
  zinc: { label: 'Cinza', cls: 'bg-zinc-100 text-zinc-600 border-zinc-200', bar: 'bg-zinc-300', dot: 'bg-zinc-400' },
};
export const colorOf = (c: string | null | undefined) => COLORS[c ?? ''] ?? COLORS.zinc;

// ── Fases e empresas ────────────────────────────────────────────────────────
export type NativeKind = 'novo' | 'entrevista' | 'aprovado' | 'descartado';
export interface Stage { id: string; name: string; color: string; sort_order: number; native_kind: NativeKind | null }
export interface Company { id: string; name: string; sort_order: number; is_active: boolean }

export const NATIVE_LABEL: Record<NativeKind, string> = {
  novo: 'onde entram os currículos novos',
  entrevista: 'para onde o candidato vai ao agendar entrevista',
  aprovado: 'aprovados',
  descartado: 'fora do processo (sai do ranking)',
};

export const stageOf = (stages: Stage[], id: string | null) =>
  stages.find((s) => s.id === id) ?? stages.find((s) => s.native_kind === 'novo') ?? null;
export const stageByKind = (stages: Stage[], k: NativeKind) => stages.find((s) => s.native_kind === k) ?? null;
export const companyName = (companies: Company[], id: string | null) => (id ? companies.find((c) => c.id === id)?.name ?? 'Empresa removida' : 'Sem empresa');

// ── Candidato ───────────────────────────────────────────────────────────────
export interface Experience { empresa: string | null; cargo: string | null; inicio: string | null; fim: string | null; atual: boolean; descricao: string | null }
export interface Education { instituicao: string | null; curso: string | null; nivel: string | null; situacao: string | null }

export interface Candidate {
  id: string;
  company_id: string | null;
  stage_id: string | null;
  full_name: string;
  email: string | null;
  phone: string | null;
  city: string | null;
  neighborhood: string | null;
  birth_date: string | null;
  age: number | null;
  desired_role: string | null;
  summary: string | null;
  experiences: Experience[];
  education: Education[];
  skills: string[];
  languages: string[];
  courses: string[];
  availability: string | null;
  salary_expectation: string | null;
  driver_license: string | null;
  total_experience_months: number | null;
  strengths: string[];
  concerns: string[];
  rating: number | null;
  notes: string | null;
  file_path: string | null;
  file_name: string | null;
  file_type: string | null;
  raw_text: string | null;
  ai_processed: boolean;
  created_at: string;
}

// ── Entrevistas ─────────────────────────────────────────────────────────────
export type InterviewStatus = 'agendada' | 'realizada' | 'faltou' | 'cancelada';
export type InterviewFormat = 'presencial' | 'telefone' | 'video';
export type Recommendation = 'seguir' | 'talvez' | 'nao_seguir';

export interface Interview {
  id: string;
  candidate_id: string;
  company_id: string | null;
  scheduled_at: string;
  duration_min: number;
  format: InterviewFormat;
  location: string | null;
  interviewer: string | null;
  status: InterviewStatus;
  scores: Record<string, number>;
  recommendation: Recommendation | null;
  notes: string | null;
  created_at: string;
}

export const INTERVIEW_STATUS: { id: InterviewStatus; label: string; cls: string }[] = [
  { id: 'agendada', label: 'Agendada', cls: 'bg-violet-100 text-violet-800 border-violet-200' },
  { id: 'realizada', label: 'Realizada', cls: 'bg-emerald-100 text-emerald-800 border-emerald-200' },
  { id: 'faltou', label: 'Faltou', cls: 'bg-red-100 text-red-700 border-red-200' },
  { id: 'cancelada', label: 'Cancelada', cls: 'bg-zinc-100 text-zinc-500 border-zinc-200' },
];
export const interviewStatusInfo = (s: string) => INTERVIEW_STATUS.find((x) => x.id === s) ?? INTERVIEW_STATUS[0];

export const FORMATS: { id: InterviewFormat; label: string; icon: string; texto: string }[] = [
  { id: 'presencial', label: 'Presencial', icon: 'ri-store-2-line', texto: 'presencial' },
  { id: 'telefone', label: 'Telefone', icon: 'ri-phone-line', texto: 'por telefone' },
  { id: 'video', label: 'Vídeo', icon: 'ri-vidicon-line', texto: 'por vídeo' },
];

export const RECOMMENDATIONS: { id: Recommendation; label: string; cls: string }[] = [
  { id: 'seguir', label: 'Seguir no processo', cls: 'bg-emerald-600 text-white border-emerald-600' },
  { id: 'talvez', label: 'Talvez', cls: 'bg-amber-500 text-white border-amber-500' },
  { id: 'nao_seguir', label: 'Não seguir', cls: 'bg-red-600 text-white border-red-600' },
];

export function avgScore(scores: Record<string, number> | null | undefined): number | null {
  const vals = Object.values(scores ?? {}).filter((v) => typeof v === 'number' && v > 0);
  return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
}

// ── Configurações (hiring_settings.data) ────────────────────────────────────
export interface Criterion { id: string; label: string }
export interface Settings {
  criteria: Criterion[];
  invite_template: string;
  default_duration: number;
  default_location: string;
  default_interviewer: string;
}
export const DEFAULT_SETTINGS: Settings = {
  criteria: [
    { id: 'pontualidade', label: 'Pontualidade' },
    { id: 'comunicacao', label: 'Comunicação' },
    { id: 'experiencia', label: 'Experiência na função' },
    { id: 'disponibilidade', label: 'Disponibilidade de horário' },
    { id: 'atitude', label: 'Postura e atitude' },
  ],
  invite_template: 'Olá, {nome}! Recebemos seu currículo para a {empresa} e gostaríamos de conversar com você. '
    + 'Entrevista {formato} no dia {data} às {hora}{local}. Pode confirmar?',
  default_duration: 30,
  default_location: '',
  default_interviewer: '',
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mergeSettings(data: Record<string, any> | null | undefined): Settings {
  const d = data ?? {};
  return {
    criteria: Array.isArray(d.criteria) && d.criteria.length ? d.criteria : DEFAULT_SETTINGS.criteria,
    invite_template: typeof d.invite_template === 'string' && d.invite_template.trim() ? d.invite_template : DEFAULT_SETTINGS.invite_template,
    default_duration: Number(d.default_duration) > 0 ? Number(d.default_duration) : DEFAULT_SETTINGS.default_duration,
    default_location: typeof d.default_location === 'string' ? d.default_location : '',
    default_interviewer: typeof d.default_interviewer === 'string' ? d.default_interviewer : '',
  };
}
export function inviteText(template: string, v: { nome: string; empresa: string; formato: string; data: string; hora: string; local: string }) {
  return template
    .replace(/\{nome\}/g, v.nome)
    .replace(/\{empresa\}/g, v.empresa || 'nossa empresa')
    .replace(/\{formato\}/g, v.formato)
    .replace(/\{data\}/g, v.data)
    .replace(/\{hora\}/g, v.hora)
    .replace(/\{local\}/g, v.local ? `, ${v.local}` : '');
}

// ── Helpers ─────────────────────────────────────────────────────────────────
export const onlyDigits = (s: unknown) => String(s ?? '').replace(/\D/g, '');
export const safeName = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(-80);
export const norm = (s: unknown) => String(s ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
export const isoDate = (v: unknown) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v ?? '')) ? String(v) : null);
export const firstName = (s: string) => s.trim().split(/\s+/)[0] ?? s;
export const slug = (s: string) => norm(s).replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || `c_${Date.now()}`;

export function fmtPhone(p: string | null) {
  const d = onlyDigits(p);
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return p ?? '';
}
export function whatsLink(p: string | null, text?: string) {
  const d = onlyDigits(p);
  if (d.length < 10) return null;
  const base = `https://wa.me/${d.startsWith('55') ? d : `55${d}`}`;
  return text ? `${base}?text=${encodeURIComponent(text)}` : base;
}
export function fmtMonths(m: number | null) {
  if (m == null) return null;
  if (m < 12) return `${m} ${m === 1 ? 'mês' : 'meses'}`;
  const y = Math.floor(m / 12);
  const r = m % 12;
  return `${y} ${y === 1 ? 'ano' : 'anos'}${r ? ` e ${r} ${r === 1 ? 'mês' : 'meses'}` : ''}`;
}
export const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('pt-BR');
export const fmtDateTime = (iso: string) => new Date(iso).toLocaleString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
export const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
export const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function loadImage(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Imagem inválida'));
    img.src = url;
  });
}

// Foto do celular chega com 4–12 MB: reduz para ~2000px em JPEG antes de enviar à IA.
export async function fileToPayload(file: File): Promise<{ base64: string; mediaType: string }> {
  const readB64 = (blob: Blob) => new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
  if (file.type === 'application/pdf') return { base64: await readB64(file), mediaType: 'application/pdf' };
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const scale = Math.min(1, 2000 / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Falha ao processar a imagem'))), 'image/jpeg', 0.85));
    return { base64: await readB64(blob), mediaType: 'image/jpeg' };
  } finally {
    URL.revokeObjectURL(url);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AiOut = Record<string, any>;

async function invokeScan(body: Record<string, unknown>): Promise<AiOut> {
  const { data, error } = await supabase.functions.invoke('hiring-cv-scan', { body });
  if (error) {
    let msg = error.message;
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === 'function') {
      try { const b = await ctx.json(); if (b?.error) msg = String(b.error); } catch { /* corpo não-JSON */ }
    }
    throw new Error(msg);
  }
  const resp = data as { success?: boolean; error?: string; data?: AiOut } | null;
  if (!resp?.success || !resp.data) throw new Error(resp?.error || 'Falha ao ler o currículo');
  return resp.data;
}

export async function scanWithAi(file: File): Promise<AiOut> {
  const { base64, mediaType } = await fileToPayload(file);
  const out = await invokeScan({ file_base64: base64, media_type: mediaType });
  if (out.legivel === false) throw new Error(out.avisos?.[0] || 'Não parece um currículo legível.');
  return out;
}

// Resposta da IA → colunas da tabela. Sem fase/nota/anotações/empresa: isso é do usuário.
export function aiFields(out: AiOut) {
  return {
    ...(out.nome ? { full_name: String(out.nome) } : {}),
    email: out.email ? String(out.email).toLowerCase() : null,
    phone: onlyDigits(out.telefone) || null,
    city: out.cidade ?? null,
    neighborhood: out.bairro ?? null,
    birth_date: isoDate(out.data_nascimento),
    age: Number.isInteger(out.idade) ? out.idade : null,
    desired_role: out.cargo_pretendido ?? null,
    summary: out.resumo ?? null,
    experiences: Array.isArray(out.experiencias) ? out.experiencias : [],
    education: Array.isArray(out.formacao) ? out.formacao : [],
    skills: out.habilidades ?? [],
    languages: out.idiomas ?? [],
    courses: out.cursos ?? [],
    availability: out.disponibilidade ?? null,
    salary_expectation: out.pretensao_salarial ?? null,
    driver_license: out.cnh ?? null,
    food_service_experience: typeof out.experiencia_food_service === 'boolean' ? out.experiencia_food_service : null,
    total_experience_months: Number.isInteger(out.tempo_experiencia_meses) ? out.tempo_experiencia_meses : null,
    strengths: out.pontos_fortes ?? [],
    concerns: out.pontos_atencao ?? [],
    ai_processed: true,
    extraction: out,
  };
}
