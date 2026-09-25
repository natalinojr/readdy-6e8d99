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
export type NativeKind = 'novo' | 'agendar' | 'entrevista' | 'aprovado' | 'descartado';

// ── Agendamento de entrevista pelo assistente (hiring_job_scheduling, por vaga) ──
export interface SchedulingSlot { dow: number; start: string; end: string }
// Entrevistador da vaga (2026-09-16): pelo WhatsApp de alguém OU um usuário do ERPOS com acesso ao
// módulo. Sem `kind` = whatsapp (formato antigo). Usuário é avisado no app e responde pela tela.
export type SchedulingInterviewer =
  | { kind?: 'whatsapp'; name: string; phone: string; jid?: string }
  | { kind: 'usuario'; name: string; user_id: string };
/** Pessoa que pode ser marcada como entrevistadora (RPC fn_hiring_team — ponto único de escopo). */
export interface MembroEquipe { user_id: string; name: string; email: string; has_push: boolean }
export const ehUsuario = (i: SchedulingInterviewer): i is Extract<SchedulingInterviewer, { kind: 'usuario' }> => i.kind === 'usuario';
export const entrevistadorValido = (i: SchedulingInterviewer) => ehUsuario(i)
  ? !!i.user_id
  : !!i.name.trim() && i.phone.replace(/\D/g, '').length >= 10;
// Faixa de horário sem entrevista numa data (o dia inteiro fica em blocked_dates).
export interface BlockedSlot { date: string; start: string; end: string }
export interface JobScheduling {
  job_id: string;
  enabled: boolean;
  slots: SchedulingSlot[];
  blocked_dates: string[];
  blocked_slots: BlockedSlot[];
  duration_min: number;
  gap_min: number;
  per_slot: number;
  min_notice_hours: number;
  horizon_days: number;
  format: string;
  location: string | null;
  interviewers: SchedulingInterviewer[];
  candidate_notes: string | null;
  /** Retorno automático para quem ficou "NA" na entrevista ({nome}, {empresa}, {vaga}). Vazio = não manda. */
  feedback_message?: string | null;
}
export const DIAS_SEMANA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
/** O que falta para o assistente poder convidar candidatos desta vaga (vazio = pronto). */
export function faltasAgendamento(s: Pick<JobScheduling, 'slots' | 'interviewers' | 'format' | 'location'>): string[] {
  const f: string[] = [];
  const slotsOk = s.slots.filter((x) => /^\d{2}:\d{2}$/.test(x.start) && /^\d{2}:\d{2}$/.test(x.end) && x.start < x.end);
  if (slotsOk.length === 0) f.push('pelo menos um dia e horário disponível');
  if (!s.interviewers.some(entrevistadorValido)) f.push('pelo menos um entrevistador (WhatsApp ou usuário do ERPOS)');
  if (s.format === 'presencial' && !(s.location ?? '').trim()) f.push('o local da entrevista');
  return f;
}
export interface Stage { id: string; name: string; color: string; sort_order: number; native_kind: NativeKind | null }
export interface Company {
  id: string; name: string; sort_order: number; is_active: boolean;
  address: string | null; city: string | null; description: string | null; // usados na análise currículo × vaga
  lat: number | null; lng: number | null; // pin da loja (distância até os candidatos)
}

// ── Distância loja × candidato (hiring_distances, calculada pela Edge com o ORS) ──
export type GeoPrecision = 'endereco' | 'rua' | 'bairro' | 'cidade';
export interface Distance {
  company_id: string;
  candidate_id: string;
  km: number;
  minutes: number | null;
  method: 'rota' | 'estimativa';
  precision: GeoPrecision | null;
  computed_at: string;
}
export const PRECISION_LABEL: Record<GeoPrecision, string> = {
  endereco: 'endereço exato',
  rua: 'pela rua',
  bairro: 'aproximado pelo bairro',
  cidade: 'só pela cidade (impreciso)',
};
export const fmtKm = (km: number) => (km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1).replace('.', ',')} km`);
/** Cor do chip pela distância: perto, médio, longe. */
export const distCls = (km: number) => (km <= 5 ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
  : km <= 12 ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-red-50 text-red-700 border-red-200');

// ── Vagas e candidaturas ────────────────────────────────────────────────────
export type JobStatus = 'aberta' | 'pausada' | 'fechada';
export interface Job {
  id: string;
  company_id: string | null;
  title: string;
  description: string | null;
  requirements: string | null;
  desirable: string | null;
  schedule: string | null;
  salary: string | null;
  benefits: string | null;
  contract_type: string | null;
  openings: number;
  status: JobStatus;
  notes: string | null;
  opened_at: string;
  closed_at: string | null;
  created_at: string;
}
export const JOB_STATUS: { id: JobStatus; label: string; cls: string }[] = [
  { id: 'aberta', label: 'Aberta', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  { id: 'pausada', label: 'Pausada', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  { id: 'fechada', label: 'Fechada', cls: 'bg-zinc-100 text-zinc-500 border-zinc-200' },
];
export const jobStatusInfo = (s: string) => JOB_STATUS.find((x) => x.id === s) ?? JOB_STATUS[0];
export const CONTRACT_TYPES = ['CLT', 'Temporário', 'Freelancer / diária', 'Jovem aprendiz', 'Estágio', 'PJ'];

export interface MatchAnalysis {
  resumo: string;
  pontos_fortes: string[];
  lacunas: string[];
  deslocamento: string;
  perguntas_entrevista: string[];
  alertas: string[];
}
export type Fit = 'alta' | 'media' | 'baixa';
export interface Application {
  id: string;
  job_id: string;
  candidate_id: string;
  score: number | null;
  fit: Fit | null;
  analysis: MatchAnalysis | null;
  analyzed_at: string | null;
  error: string | null;
  created_at: string;
}
export const FIT: Record<Fit, { label: string; cls: string; bar: string }> = {
  alta: { label: 'Alta aderência', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', bar: 'bg-emerald-500' },
  media: { label: 'Média aderência', cls: 'bg-amber-50 text-amber-700 border-amber-200', bar: 'bg-amber-400' },
  baixa: { label: 'Baixa aderência', cls: 'bg-zinc-100 text-zinc-600 border-zinc-200', bar: 'bg-zinc-400' },
};
export const fitOf = (score: number | null): Fit | null => (score == null ? null : score >= 75 ? 'alta' : score >= 50 ? 'media' : 'baixa');

export const NATIVE_LABEL: Record<NativeKind, string> = {
  novo: 'onde entram os currículos novos',
  agendar: 'o assistente chama o candidato no WhatsApp para marcar a entrevista',
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
  address: string | null;
  marital_status: string | null;
  decision: Decision | null;
  lat: number | null;
  lng: number | null;
  geo_label: string | null;
  geo_precision: string | null; // endereco | rua | bairro | cidade | nao_encontrado
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
  source?: string | null; // 'whatsapp_link' quando veio pelo link público
  whatsapp?: string | null; // número de quem mandou o currículo pelo link (pode ser ≠ do telefone do currículo)
  extra_fields?: Record<string, string> | null; // respostas dos dados mínimos criados pelo dono
  required_waived_at?: string | null;          // "mover mesmo assim" com ficha incompleta
  created_at: string;
}

// ── Histórico do candidato (hiring_candidate_events, gravado por gatilhos no banco) ──
export interface CandidateEvent {
  id: number;
  candidate_id: string;
  at: string;
  kind: string; // criado | fase | decisao | loja | avaliacao | ficha | ia | vaga | entrevista | registro | anotacao | anexo (meta.path no bucket)
  title: string;
  detail: string | null;
  actor: string | null; // e-mail de quem fez, 'assistente' (WhatsApp/IA) ou 'sistema'
  meta: Record<string, unknown>;
}

// ── Entrevistas ─────────────────────────────────────────────────────────────
export type InterviewStatus = 'agendada' | 'realizada' | 'faltou' | 'cancelada';
export type InterviewFormat = 'presencial' | 'telefone' | 'video';
// Tomada de decisão ao fim da entrevista (gravada na entrevista e no candidato).
export type Decision = 'gpc' | 'pc' | 'r' | 'na';

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
  answers: Record<string, string>;
  recommendation: Decision | null; // coluna guarda a tomada de decisão (gpc/pc/r/na)
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

export const DECISIONS: { id: Decision; sigla: string; label: string; cls: string; bar: string }[] = [
  { id: 'gpc', sigla: 'GPC', label: 'Grande potencial de contratação', cls: 'bg-emerald-600 text-white border-emerald-600', bar: 'bg-emerald-500' },
  { id: 'pc', sigla: 'PC', label: 'Potencial de contratação', cls: 'bg-sky-600 text-white border-sky-600', bar: 'bg-sky-500' },
  { id: 'r', sigla: 'R', label: 'Quadro de reserva', cls: 'bg-amber-500 text-white border-amber-500', bar: 'bg-amber-400' },
  { id: 'na', sigla: 'NA', label: 'Não adequado à {empresa}', cls: 'bg-zinc-500 text-white border-zinc-500', bar: 'bg-zinc-400' },
];
/** Menor de idade: aviso na ficha e na lista (a decisão é do dono). Menos de 16 = abaixo da idade mínima (CLT), salvo aprendiz. */
export function avisoIdade(idade: number | null | undefined): { texto: string; cls: string; dica: string } | null {
  if (idade == null || idade >= 18) return null;
  return idade < 16
    ? { texto: 'Menor de 16', cls: 'bg-red-100 text-red-700 border-red-200', dica: 'Abaixo da idade mínima para trabalhar (16 anos; aprendiz a partir de 14).' }
    : { texto: 'Menor de idade', cls: 'bg-amber-100 text-amber-800 border-amber-200', dica: 'Menor de 18 anos: confira as regras de jornada (sem trabalho noturno, após 22h).' };
}
export const decisionOf = (d: string | null | undefined) => DECISIONS.find((x) => x.id === d) ?? null;
export const withEmpresa = (text: string, empresa: string | null | undefined) => text.replace(/\{empresa\}/g, empresa || 'empresa');

/** Idade pela data de nascimento (sempre atual); sem data, a idade escrita no currículo. */
export function ageOf(c: { birth_date: string | null; age: number | null }): number | null {
  const m = c.birth_date?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return c.age;
  const now = new Date();
  let a = now.getFullYear() - Number(m[1]);
  if (now.getMonth() + 1 < Number(m[2]) || (now.getMonth() + 1 === Number(m[2]) && now.getDate() < Number(m[3]))) a--;
  return a >= 0 && a < 120 ? a : c.age;
}

export function avgScore(scores: Record<string, number> | null | undefined): number | null {
  const vals = Object.values(scores ?? {}).filter((v) => typeof v === 'number' && v > 0);
  return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
}

// ── Dados mínimos da ficha ──────────────────────────────────────────────────
// Mesma regra da função do banco hiring_missing_fields (que trava a saída de "Novo") e do
// atendente do WhatsApp (canal-publico), que pergunta ao candidato o que faltar.
export type BuiltinField = 'full_name' | 'phone' | 'email' | 'birth_date' | 'address' | 'neighborhood' | 'city' | 'marital_status'
  | 'education' | 'experiences' | 'availability' | 'desired_role' | 'salary_expectation' | 'driver_license';
/** Campo nativo ou criado pelo dono (id "x_…", valor em hiring_candidates.extra_fields). */
export type RequiredField = string;
export interface CustomField { id: string; label: string; ask?: string }
export type FichaCfg = Pick<Settings, 'required_fields' | 'custom_fields'>;
export const REQUIRED_FIELDS: { id: BuiltinField; label: string; sensivel?: boolean }[] = [
  { id: 'full_name', label: 'Nome completo' },
  { id: 'phone', label: 'Telefone' },
  { id: 'email', label: 'E-mail' },
  { id: 'birth_date', label: 'Data de nascimento' },
  { id: 'address', label: 'Endereço (rua e número)' },
  { id: 'neighborhood', label: 'Bairro' },
  { id: 'city', label: 'Cidade' },
  { id: 'marital_status', label: 'Estado civil', sensivel: true },
  { id: 'education', label: 'Escolaridade' },
  { id: 'experiences', label: 'Experiências anteriores' },
  { id: 'availability', label: 'Disponibilidade de horário' },
  { id: 'desired_role', label: 'Cargo pretendido' },
  { id: 'salary_expectation', label: 'Pretensão salarial' },
  { id: 'driver_license', label: 'CNH' },
];
export const DEFAULT_REQUIRED: RequiredField[] = ['full_name', 'phone', 'birth_date', 'address', 'city', 'education', 'experiences'];
const vazio = (v: unknown) => !String(v ?? '').trim();
/** Todos os campos possíveis: nativos + criados pelo dono. */
export const fieldsOf = (s: FichaCfg): { id: string; label: string; custom?: boolean; sensivel?: boolean }[] =>
  [...REQUIRED_FIELDS, ...(s.custom_fields ?? []).map((f) => ({ id: f.id, label: f.label, custom: true }))];
/** Dados mínimos que faltam na ficha (vazio = completa). */
export function faltasFicha(c: Candidate, s: FichaCfg): { id: string; label: string; custom?: boolean }[] {
  const falta = (f: { id: string; custom?: boolean }) => {
    if (f.custom) return vazio(c.extra_fields?.[f.id]);
    switch (f.id) {
      case 'phone': return onlyDigits(c.phone).length < 10;
      case 'email': return !String(c.email ?? '').includes('@');
      case 'education': return !(c.education?.length);
      case 'experiences': return !(c.experiences?.length);
      default: return vazio(c[f.id as BuiltinField]);
    }
  };
  return fieldsOf(s).filter((f) => s.required_fields.includes(f.id) && falta(f));
}

// ── Configurações (hiring_settings.data) ────────────────────────────────────
export interface Criterion { id: string; label: string }
export interface Settings {
  required_fields: RequiredField[]; // dados mínimos para sair da fase "Novo"
  custom_fields: CustomField[];     // dados criados pelo dono (entram na lista acima quando marcados)
  questions: Criterion[]; // perguntas do questionário da entrevista ({empresa} vira o nome da empresa)
  criteria: Criterion[];
  invite_template: string;
  default_duration: number;
  default_location: string;
  default_interviewer: string;
}
export const DEFAULT_SETTINGS: Settings = {
  required_fields: DEFAULT_REQUIRED,
  custom_fields: [],
  questions: [
    { id: 'filhos', label: 'Filhos' },
    { id: 'contribuicao', label: 'Como sua formação e experiência anterior poderá contribuir com a {empresa}?' },
    { id: 'moradia', label: 'Onde mora e como virá ao trabalho (distância e deslocamento)?' },
    { id: 'salario', label: 'Salário pretendido?' },
    { id: 'horario', label: 'Horário de trabalho?' },
    { id: 'motivo', label: 'Por que precisa do trabalho?' },
    { id: 'inicio', label: 'Quando pode começar a trabalhar?' },
    { id: 'porque_contratar', label: 'Por que a empresa deveria contratá-la?' },
  ],
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
  const custom_fields: CustomField[] = Array.isArray(d.custom_fields)
    ? d.custom_fields.filter((f: CustomField) => f && typeof f.id === 'string' && typeof f.label === 'string') : [];
  const conhecido = (f: string) => REQUIRED_FIELDS.some((x) => x.id === f) || custom_fields.some((x) => x.id === f);
  return {
    ...d, // preserva chaves que esta tela não conhece
    custom_fields,
    // Lista salva (mesmo vazia) vale; sem nada salvo, usa o padrão.
    required_fields: Array.isArray(d.required_fields) ? d.required_fields.filter(conhecido) : DEFAULT_REQUIRED,
    questions: Array.isArray(d.questions) ? d.questions : DEFAULT_SETTINGS.questions,
    criteria: Array.isArray(d.criteria) ? d.criteria : DEFAULT_SETTINGS.criteria,
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

/** Distância do candidato até todas as lojas com pin (grava em hiring_distances). */
export async function calcDistancesAi(candidateId: string): Promise<Distance[]> {
  return await invokeScan({ action: 'distance', candidate_id: candidateId }) as unknown as Distance[];
}
/** Um lote de candidatos até uma loja (chamar de novo enquanto remaining > 0). */
export async function distancesForCompany(companyId: string): Promise<{ done: number; processed: number; remaining: number }> {
  return await invokeScan({ action: 'distance_company', company_id: companyId }) as unknown as { done: number; processed: number; remaining: number };
}
/** Endereço → coordenada (ORS), com foco opcional na região. */
export async function geocodeText(text: string, focus?: { lat: number; lng: number } | null) {
  return await invokeScan({ action: 'geocode', text, focus: focus ?? null }) as unknown as { lat: number; lng: number; label: string; precision: GeoPrecision };
}

/** Compara currículo × vaga × loja (IA) e grava a candidatura. */
export async function matchWithAi(candidateId: string, jobId: string): Promise<Application> {
  return await invokeScan({ action: 'match', candidate_id: candidateId, job_id: jobId }) as unknown as Application;
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
    address: out.endereco ?? null,
    marital_status: out.estado_civil ?? null,
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
