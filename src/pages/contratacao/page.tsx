// Contratação — banco de currículos. Leitura híbrida: PDF com texto é lido no
// navegador de graça (src/lib/curriculoLocal.ts); foto/PDF escaneado vai direto
// para a IA (Edge hiring-cv-scan); nos demais a IA só roda no botão "Organizar
// com IA". A tela grava em hiring_candidates (+ arquivo no bucket privado "curriculos"). Tabela e bucket têm RLS pelo e-mail do dono; o guard aqui
// é só para a UX.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { readCurriculoPdf } from '@/lib/curriculoLocal';

const OWNER_EMAIL = 'natalinojr.engel@gmail.com';
const BUCKET = 'curriculos';

type Status = 'novo' | 'triagem' | 'entrevista' | 'aprovado' | 'contratado' | 'descartado';
const STATUS: { id: Status; label: string; cls: string }[] = [
  { id: 'novo', label: 'Novo', cls: 'bg-sky-50 text-sky-700 border-sky-200' },
  { id: 'triagem', label: 'Triagem', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  { id: 'entrevista', label: 'Entrevista', cls: 'bg-violet-50 text-violet-700 border-violet-200' },
  { id: 'aprovado', label: 'Aprovado', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  { id: 'contratado', label: 'Contratado', cls: 'bg-green-600 text-white border-green-600' },
  { id: 'descartado', label: 'Descartado', cls: 'bg-zinc-100 text-zinc-500 border-zinc-200' },
];
const statusInfo = (s: string) => STATUS.find((x) => x.id === s) ?? STATUS[0];

interface Experience { empresa: string | null; cargo: string | null; inicio: string | null; fim: string | null; atual: boolean; descricao: string | null }
interface Education { instituicao: string | null; curso: string | null; nivel: string | null; situacao: string | null }

interface Candidate {
  id: string;
  tenant_id: string | null;
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
  food_service_experience: boolean | null;
  total_experience_months: number | null;
  strengths: string[];
  concerns: string[];
  status: Status;
  rating: number | null;
  notes: string | null;
  file_path: string | null;
  file_name: string | null;
  file_type: string | null;
  raw_text: string | null;
  ai_processed: boolean;
  created_at: string;
}

interface QueueItem { key: string; name: string; state: 'lendo' | 'ok' | 'erro'; msg?: string }

// ── Helpers ─────────────────────────────────────────────────────────────────
function loadImage(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Imagem inválida'));
    img.src = url;
  });
}

// Foto do celular chega com 4–12 MB: reduz para ~2000px em JPEG antes de enviar à IA.
async function fileToPayload(file: File): Promise<{ base64: string; mediaType: string }> {
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

const onlyDigits = (s: unknown) => String(s ?? '').replace(/\D/g, '');
const safeName = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(-80);
const norm = (s: unknown) => String(s ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
const isoDate = (v: unknown) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v ?? '')) ? String(v) : null);

function fmtPhone(p: string | null) {
  const d = onlyDigits(p);
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return p ?? '';
}
function whatsLink(p: string | null) {
  const d = onlyDigits(p);
  if (d.length < 10) return null;
  return `https://wa.me/${d.startsWith('55') ? d : `55${d}`}`;
}
function fmtMonths(m: number | null) {
  if (m == null) return null;
  if (m < 12) return `${m} ${m === 1 ? 'mês' : 'meses'}`;
  const y = Math.floor(m / 12);
  const r = m % 12;
  return `${y} ${y === 1 ? 'ano' : 'anos'}${r ? ` e ${r} ${r === 1 ? 'mês' : 'meses'}` : ''}`;
}
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('pt-BR');

async function invokeScan(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke('hiring-cv-scan', { body });
  if (error) {
    let msg = error.message;
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === 'function') {
      try { const b = await ctx.json(); if (b?.error) msg = String(b.error); } catch { /* corpo não-JSON */ }
    }
    throw new Error(msg);
  }
  const resp = data as { success?: boolean; error?: string; data?: Record<string, any> } | null; // eslint-disable-line @typescript-eslint/no-explicit-any
  if (!resp?.success || !resp.data) throw new Error(resp?.error || 'Falha ao ler o currículo');
  return resp.data;
}

// Resposta da IA → colunas da tabela. Sem status/nota/anotações: isso é do usuário.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function aiFields(out: Record<string, any>) {
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

async function scanWithAi(file: File) {
  const { base64, mediaType } = await fileToPayload(file);
  const out = await invokeScan({ file_base64: base64, media_type: mediaType });
  if (out.legivel === false) throw new Error(out.avisos?.[0] || 'Não parece um currículo legível.');
  return out;
}

// ── Página ──────────────────────────────────────────────────────────────────
export default function ContratacaoPage() {
  const { user } = useAuth();
  const isOwner = user?.email?.toLowerCase() === OWNER_EMAIL;

  const [items, setItems] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [busca, setBusca] = useState('');
  const [filtro, setFiltro] = useState<Status | 'todos'>('todos');
  const [soArea, setSoArea] = useState(false);
  const [selId, setSelId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const carregar = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.from('hiring_candidates').select('*').order('created_at', { ascending: false }).limit(1000);
    if (error) setLoadError(error.message);
    else { setItems((data ?? []) as Candidate[]); setLoadError(null); }
    setLoading(false);
  }, []);

  useEffect(() => { if (isOwner) carregar(); }, [isOwner, carregar]);

  const processFile = useCallback(async (file: File, key: string) => {
    const upd = (p: Partial<QueueItem>) => setQueue((q) => q.map((x) => (x.key === key ? { ...x, ...p } : x)));
    try {
      const okType = file.type === 'application/pdf' || file.type.startsWith('image/');
      if (!okType) throw new Error('Use PDF ou foto (Word: salve como PDF antes).');
      // 1º: PDF com texto é lido de graça no navegador. Se não tiver texto (escaneado) ou for foto, vai para a IA.
      let fields: Record<string, unknown> | null = null;
      let modo = 'leitura grátis';
      if (file.type === 'application/pdf') {
        try {
          const loc = await readCurriculoPdf(file);
          if (loc) fields = { ...loc, ai_processed: false };
        } catch { /* PDF estranho: tenta a IA */ }
      }
      if (!fields) {
        fields = aiFields(await scanWithAi(file));
        modo = 'IA';
      }

      // Arquivo original guardado no bucket privado (falha no upload não perde a leitura).
      const path = `${crypto.randomUUID()}/${safeName(file.name)}`;
      const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type, upsert: false });

      const row = {
        ...fields,
        tenant_id: user?.tenantId ?? null,
        full_name: (fields.full_name as string | null) || file.name.replace(/\.[^.]+$/, ''),
        file_path: upErr ? null : path,
        file_name: file.name,
        file_type: file.type,
      };
      const { data: ins, error } = await supabase.from('hiring_candidates').insert(row).select('*').single();
      if (error) throw new Error(error.message);
      const cand = ins as Candidate;

      // Aviso de duplicado (mesmo telefone ou e-mail já cadastrado).
      let dup: Candidate | undefined;
      setItems((prev) => {
        dup = prev.find((c) => (cand.phone && c.phone === cand.phone) || (cand.email && c.email === cand.email));
        return [cand, ...prev];
      });
      const avisos: string[] = [modo];
      if (dup) avisos.push(`possível duplicado de ${dup.full_name}`);
      if (upErr) avisos.push('arquivo original não foi salvo');
      upd({ state: 'ok', msg: [cand.full_name, ...avisos].join(' · ') });
    } catch (e) {
      upd({ state: 'erro', msg: (e as Error).message });
    }
  }, [user?.tenantId]);

  const addFiles = useCallback(async (files: FileList | File[]) => {
    const list = Array.from(files);
    if (!list.length) return;
    const entries = list.map((f) => ({ file: f, key: crypto.randomUUID() }));
    setQueue((q) => [...entries.map(({ file, key }) => ({ key, name: file.name, state: 'lendo' as const })), ...q]);
    // 2 por vez: rápido sem estourar o limite da API.
    let i = 0;
    const worker = async () => { while (i < entries.length) { const e = entries[i++]; await processFile(e.file, e.key); } };
    await Promise.all([worker(), worker()]);
  }, [processFile]);

  const updateCandidate = useCallback(async (id: string, patch: Partial<Candidate>) => {
    setItems((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
    const { error } = await supabase.from('hiring_candidates').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) { alert(`Não foi possível salvar: ${error.message}`); carregar(); }
  }, [carregar]);

  // IA sob demanda: baixa o original do bucket e completa a ficha (mantém status/nota/anotações).
  const organizarComIA = useCallback(async (c: Candidate) => {
    if (!c.file_path) throw new Error('O arquivo original não foi salvo; suba o currículo de novo.');
    const { data: blob, error } = await supabase.storage.from(BUCKET).download(c.file_path);
    if (error || !blob) throw new Error('Não foi possível baixar o arquivo original.');
    const file = new File([blob], c.file_name ?? 'curriculo', { type: c.file_type ?? blob.type });
    const patch = aiFields(await scanWithAi(file)) as Partial<Candidate>;
    const { error: upErr } = await supabase.from('hiring_candidates')
      .update({ ...patch, updated_at: new Date().toISOString() }).eq('id', c.id);
    if (upErr) throw new Error(upErr.message);
    setItems((prev) => prev.map((x) => (x.id === c.id ? { ...x, ...patch } : x)));
  }, []);

  const deleteCandidate = useCallback(async (c: Candidate) => {
    if (!confirm(`Excluir o currículo de ${c.full_name}? Não dá para desfazer.`)) return;
    const { error } = await supabase.from('hiring_candidates').delete().eq('id', c.id);
    if (error) { alert(`Não foi possível excluir: ${error.message}`); return; }
    if (c.file_path) await supabase.storage.from(BUCKET).remove([c.file_path]);
    setItems((prev) => prev.filter((x) => x.id !== c.id));
    setSelId(null);
  }, []);

  const counts = useMemo(() => {
    const m: Record<string, number> = { todos: items.length };
    for (const c of items) m[c.status] = (m[c.status] ?? 0) + 1;
    return m;
  }, [items]);

  const filtrados = useMemo(() => {
    const q = norm(busca).trim();
    return items.filter((c) => {
      if (filtro !== 'todos' && c.status !== filtro) return false;
      if (soArea && c.food_service_experience !== true) return false;
      if (!q) return true;
      const hay = norm([c.full_name, c.desired_role, c.city, c.neighborhood, c.phone, c.email, c.skills.join(' '),
        c.experiences.map((e) => `${e.empresa} ${e.cargo}`).join(' '), c.raw_text ?? ''].join(' '));
      return q.split(/\s+/).every((t) => hay.includes(t));
    });
  }, [items, busca, filtro, soArea]);

  const sel = items.find((c) => c.id === selId) ?? null;

  if (user && !isOwner) return <Navigate to="/modulos" replace />;

  const lendo = queue.filter((q) => q.state === 'lendo').length;

  return (
    <div className="max-w-6xl mx-auto">
      {/* Cabeçalho */}
      <div className="flex flex-wrap items-center gap-3 mb-5">
        <div className="w-10 h-10 flex items-center justify-center rounded-xl bg-rose-50 border border-rose-200">
          <i className="ri-user-search-line text-xl text-rose-600" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-black text-zinc-900">Contratação</h1>
          <p className="text-xs text-zinc-400">Currículos lidos por IA e organizados por candidato</p>
        </div>
        <button
          onClick={() => fileRef.current?.click()}
          className="flex items-center gap-2 px-4 h-10 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-sm font-bold cursor-pointer whitespace-nowrap"
        >
          <i className="ri-upload-2-line" /> Adicionar currículos
        </button>
        <input
          ref={fileRef}
          type="file"
          multiple
          accept="application/pdf,image/*"
          className="hidden"
          onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ''; }}
        />
      </div>

      {/* Área de soltar */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files); }}
        onClick={() => fileRef.current?.click()}
        className={`mb-5 rounded-2xl border-2 border-dashed px-4 py-5 text-center cursor-pointer transition-colors ${
          dragOver ? 'border-rose-400 bg-rose-50' : 'border-zinc-200 hover:border-rose-300 bg-zinc-50/60'
        }`}
      >
        <i className="ri-file-user-line text-2xl text-rose-400" />
        <p className="text-sm font-semibold text-zinc-700 mt-1">Arraste PDFs ou fotos de currículos aqui</p>
        <p className="text-xs text-zinc-400">Pode mandar vários de uma vez. No celular, toque para tirar foto.</p>
      </div>

      {/* Fila de leitura */}
      {queue.length > 0 && (
        <div className="mb-5 rounded-2xl border border-zinc-200 bg-white overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2 border-b border-zinc-100">
            <p className="text-xs font-bold text-zinc-600">
              {lendo > 0 ? `Lendo ${lendo} currículo${lendo > 1 ? 's' : ''}…` : 'Leitura concluída'}
            </p>
            {lendo === 0 && (
              <button onClick={() => setQueue([])} className="text-xs text-zinc-400 hover:text-zinc-700 cursor-pointer">Limpar</button>
            )}
          </div>
          <ul className="max-h-48 overflow-y-auto divide-y divide-zinc-50">
            {queue.map((q) => (
              <li key={q.key} className="flex items-center gap-3 px-4 py-2 text-xs">
                {q.state === 'lendo' && <div className="w-3.5 h-3.5 border-2 border-rose-500 border-t-transparent rounded-full animate-spin flex-shrink-0" />}
                {q.state === 'ok' && <i className="ri-checkbox-circle-fill text-emerald-500 text-sm" />}
                {q.state === 'erro' && <i className="ri-error-warning-fill text-red-500 text-sm" />}
                <span className="font-medium text-zinc-700 truncate max-w-[40%]">{q.name}</span>
                {q.msg && <span className={`truncate ${q.state === 'erro' ? 'text-red-600' : 'text-zinc-500'}`}>{q.msg}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="relative flex-1 min-w-[200px]">
          <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 text-sm" />
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por nome, cargo, cidade, empresa, habilidade…"
            className="w-full h-10 pl-9 pr-3 rounded-xl border border-zinc-200 text-sm focus:outline-none focus:border-rose-300"
          />
        </div>
        <label className="flex items-center gap-2 px-3 h-10 rounded-xl border border-zinc-200 text-xs font-semibold text-zinc-600 cursor-pointer select-none">
          <input type="checkbox" checked={soArea} onChange={(e) => setSoArea(e.target.checked)} className="accent-rose-600" />
          Só com experiência em restaurante
        </label>
      </div>
      <div className="flex gap-1.5 mb-4 overflow-x-auto pb-1">
        {[{ id: 'todos' as const, label: 'Todos' }, ...STATUS].map((s) => (
          <button
            key={s.id}
            onClick={() => setFiltro(s.id)}
            className={`px-3 h-8 rounded-full text-xs font-bold whitespace-nowrap border cursor-pointer transition-colors ${
              filtro === s.id ? 'bg-zinc-900 text-white border-zinc-900' : 'bg-white text-zinc-600 border-zinc-200 hover:border-zinc-300'
            }`}
          >
            {s.label} <span className="opacity-60">{counts[s.id] ?? 0}</span>
          </button>
        ))}
      </div>

      {/* Lista */}
      {loading ? (
        <div className="py-16 flex justify-center"><div className="w-7 h-7 border-2 border-rose-500 border-t-transparent rounded-full animate-spin" /></div>
      ) : loadError ? (
        <p className="py-10 text-center text-sm text-red-600">Erro ao carregar: {loadError}</p>
      ) : filtrados.length === 0 ? (
        <div className="py-16 text-center text-zinc-400">
          <i className="ri-inbox-line text-4xl" />
          <p className="text-sm font-semibold mt-2">{items.length ? 'Nenhum candidato com esses filtros' : 'Nenhum currículo ainda'}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {filtrados.map((c) => (
            <CandidateCard key={c.id} c={c} onOpen={() => setSelId(c.id)} />
          ))}
        </div>
      )}

      {sel && (
        <CandidateDrawer
          c={sel}
          onClose={() => setSelId(null)}
          onUpdate={(patch) => updateCandidate(sel.id, patch)}
          onDelete={() => deleteCandidate(sel)}
          onOrganizar={() => organizarComIA(sel)}
        />
      )}
    </div>
  );
}

// ── Card ────────────────────────────────────────────────────────────────────
function CandidateCard({ c, onOpen }: { c: Candidate; onOpen: () => void }) {
  const st = statusInfo(c.status);
  const ultima = c.experiences[0];
  return (
    <button onClick={onOpen} className="text-left p-4 rounded-2xl border border-zinc-200 bg-white hover:border-rose-300 hover:shadow-sm transition-all cursor-pointer">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-full bg-rose-100 text-rose-700 font-black flex items-center justify-center flex-shrink-0">
          {(c.full_name || '?').charAt(0).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="font-bold text-zinc-900 truncate">{c.full_name}</p>
            {c.rating ? <span className="text-amber-500 text-xs whitespace-nowrap">{'★'.repeat(c.rating)}</span> : null}
          </div>
          <p className="text-xs text-zinc-500 truncate">
            {[c.desired_role, c.age ? `${c.age} anos` : null, [c.neighborhood, c.city].filter(Boolean).join(', ') || null].filter(Boolean).join(' · ') || '—'}
          </p>
          {ultima && (
            <p className="text-xs text-zinc-400 truncate mt-0.5">
              <i className="ri-briefcase-line" /> {[ultima.cargo, ultima.empresa].filter(Boolean).join(' em ')}
            </p>
          )}
        </div>
        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border whitespace-nowrap ${st.cls}`}>{st.label}</span>
      </div>
      <div className="flex flex-wrap gap-1.5 mt-3">
        {c.food_service_experience === true && <Chip cls="bg-emerald-50 text-emerald-700 border-emerald-200">Exp. em restaurante</Chip>}
        {c.food_service_experience === false && <Chip cls="bg-zinc-50 text-zinc-500 border-zinc-200">Sem exp. na área</Chip>}
        {c.total_experience_months != null && <Chip cls="bg-zinc-50 text-zinc-600 border-zinc-200">{fmtMonths(c.total_experience_months)} de experiência</Chip>}
        {c.concerns.length > 0 && <Chip cls="bg-orange-50 text-orange-700 border-orange-200">{c.concerns.length} ponto{c.concerns.length > 1 ? 's' : ''} de atenção</Chip>}
        {!c.ai_processed && <Chip cls="bg-sky-50 text-sky-700 border-sky-200">Leitura simples</Chip>}
        <span className="ml-auto text-[10px] text-zinc-400 self-center">{fmtDate(c.created_at)}</span>
      </div>
    </button>
  );
}

function Chip({ children, cls }: { children: React.ReactNode; cls: string }) {
  return <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${cls}`}>{children}</span>;
}

// ── Detalhe ─────────────────────────────────────────────────────────────────
function CandidateDrawer({ c, onClose, onUpdate, onDelete, onOrganizar }: {
  c: Candidate;
  onClose: () => void;
  onUpdate: (patch: Partial<Candidate>) => void;
  onDelete: () => void;
  onOrganizar: () => Promise<void>;
}) {
  const [notes, setNotes] = useState(c.notes ?? '');
  const [iaBusy, setIaBusy] = useState(false);
  const [iaErro, setIaErro] = useState<string | null>(null);
  const [verTexto, setVerTexto] = useState(false);
  useEffect(() => { setIaErro(null); setVerTexto(false); }, [c.id]);
  const organizar = async () => {
    setIaBusy(true); setIaErro(null);
    try { await onOrganizar(); } catch (e) { setIaErro((e as Error).message); } finally { setIaBusy(false); }
  };
  useEffect(() => { setNotes(c.notes ?? ''); }, [c.id, c.notes]);
  const wa = whatsLink(c.phone);

  const abrirArquivo = async () => {
    if (!c.file_path) return;
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(c.file_path, 300);
    if (error || !data?.signedUrl) { alert('Não foi possível abrir o arquivo.'); return; }
    window.open(data.signedUrl, '_blank', 'noopener');
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />
      <aside className="fixed inset-y-0 right-0 z-50 w-full max-w-xl bg-white shadow-2xl flex flex-col">
        <div className="flex items-start gap-3 px-5 py-4 border-b border-zinc-100">
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-black text-zinc-900">{c.full_name}</h2>
            <p className="text-xs text-zinc-500">{[c.desired_role, c.age ? `${c.age} anos` : null].filter(Boolean).join(' · ')}</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-zinc-100 text-zinc-500 cursor-pointer">
            <i className="ri-close-line text-lg" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {/* Status + nota */}
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={c.status}
              onChange={(e) => onUpdate({ status: e.target.value as Status })}
              className="h-9 px-3 rounded-lg border border-zinc-200 text-sm font-semibold cursor-pointer"
            >
              {STATUS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
            <div className="flex items-center">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  onClick={() => onUpdate({ rating: c.rating === n ? null : n })}
                  className={`text-xl px-0.5 cursor-pointer ${c.rating && n <= c.rating ? 'text-amber-500' : 'text-zinc-300 hover:text-amber-300'}`}
                  title={`${n} estrela${n > 1 ? 's' : ''}`}
                >★</button>
              ))}
            </div>
          </div>

          {!c.ai_processed && (
            <div className="rounded-xl border border-sky-200 bg-sky-50 p-3">
              <p className="text-xs text-sky-900">
                <b>Leitura simples (grátis):</b> só contato, cidade e o texto completo, com os campos adivinhados por regra.
                Para ver experiências, resumo e pontos fortes e de atenção, organize com IA (alguns centavos).
              </p>
              <button
                onClick={organizar}
                disabled={iaBusy}
                className="mt-2 flex items-center gap-1.5 px-3 h-8 rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-60 text-white text-xs font-bold cursor-pointer"
              >
                {iaBusy ? <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <i className="ri-sparkling-line" />}
                {iaBusy ? 'Organizando…' : 'Organizar com IA'}
              </button>
              {iaErro && <p className="text-xs text-red-600 mt-1.5">{iaErro}</p>}
            </div>
          )}

          {/* Contato */}
          <Section title="Contato">
            <div className="space-y-1.5 text-sm">
              {c.phone && (
                <p className="flex items-center gap-2">
                  <i className="ri-phone-line text-zinc-400" /> {fmtPhone(c.phone)}
                  {wa && <a href={wa} target="_blank" rel="noopener noreferrer" className="text-emerald-600 font-semibold text-xs ml-1"><i className="ri-whatsapp-line" /> WhatsApp</a>}
                </p>
              )}
              {c.email && <p className="flex items-center gap-2"><i className="ri-mail-line text-zinc-400" /> <a href={`mailto:${c.email}`} className="text-sky-700">{c.email}</a></p>}
              {(c.city || c.neighborhood) && <p className="flex items-center gap-2"><i className="ri-map-pin-line text-zinc-400" /> {[c.neighborhood, c.city].filter(Boolean).join(', ')}</p>}
              {c.birth_date && <p className="flex items-center gap-2"><i className="ri-cake-2-line text-zinc-400" /> {c.birth_date.split('-').reverse().join('/')}</p>}
              {!c.phone && !c.email && !c.city && <p className="text-zinc-400 text-xs">Sem dados de contato no currículo.</p>}
            </div>
          </Section>

          {c.summary && <Section title="Resumo"><p className="text-sm text-zinc-700 leading-relaxed">{c.summary}</p></Section>}

          {(c.strengths.length > 0 || c.concerns.length > 0) && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {c.strengths.length > 0 && (
                <div className="rounded-xl bg-emerald-50 border border-emerald-100 p-3">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-700 mb-1.5">Pontos fortes</p>
                  <ul className="space-y-1 text-xs text-emerald-900">{c.strengths.map((s, i) => <li key={i}>• {s}</li>)}</ul>
                </div>
              )}
              {c.concerns.length > 0 && (
                <div className="rounded-xl bg-orange-50 border border-orange-100 p-3">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-orange-700 mb-1.5">Pontos de atenção</p>
                  <ul className="space-y-1 text-xs text-orange-900">{c.concerns.map((s, i) => <li key={i}>• {s}</li>)}</ul>
                </div>
              )}
            </div>
          )}

          {c.raw_text && (
            <Section title="Texto do currículo">
              <button onClick={() => setVerTexto((v) => !v)} className="text-xs font-semibold text-sky-700 cursor-pointer">
                {verTexto ? 'Esconder texto' : 'Mostrar texto completo'}
              </button>
              {verTexto && (
                <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap rounded-xl bg-zinc-50 border border-zinc-100 p-3 text-xs text-zinc-700 font-sans">{c.raw_text}</pre>
              )}
            </Section>
          )}

          {c.ai_processed && <Section title={`Experiência${c.total_experience_months != null ? ` · ${fmtMonths(c.total_experience_months)}` : ''}`}>
            {c.experiences.length === 0 ? <p className="text-xs text-zinc-400">Nenhuma experiência informada.</p> : (
              <ol className="space-y-3 border-l-2 border-zinc-100 pl-4">
                {c.experiences.map((e, i) => (
                  <li key={i} className="relative">
                    <span className="absolute -left-[21px] top-1.5 w-2.5 h-2.5 rounded-full bg-rose-400" />
                    <p className="text-sm font-bold text-zinc-800">{e.cargo || 'Cargo não informado'}</p>
                    <p className="text-xs text-zinc-500">
                      {[e.empresa, [e.inicio, e.atual ? 'atual' : e.fim].filter(Boolean).join(' – ')].filter(Boolean).join(' · ')}
                    </p>
                    {e.descricao && <p className="text-xs text-zinc-600 mt-1 leading-relaxed">{e.descricao}</p>}
                  </li>
                ))}
              </ol>
            )}
          </Section>}

          {c.education.length > 0 && (
            <Section title="Formação">
              <ul className="space-y-1.5 text-sm">
                {c.education.map((e, i) => (
                  <li key={i}>
                    <span className="font-semibold text-zinc-800">{[e.nivel, e.curso].filter(Boolean).join(' — ') || 'Formação'}</span>
                    <span className="text-xs text-zinc-500"> {[e.instituicao, e.situacao].filter(Boolean).join(' · ')}</span>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {(c.skills.length > 0 || c.courses.length > 0 || c.languages.length > 0) && (
            <Section title="Habilidades e cursos">
              <div className="flex flex-wrap gap-1.5">
                {[...c.skills, ...c.courses, ...c.languages].map((s, i) => (
                  <span key={i} className="text-xs px-2 py-0.5 rounded-full bg-zinc-100 text-zinc-700">{s}</span>
                ))}
              </div>
            </Section>
          )}

          {(c.availability || c.salary_expectation || c.driver_license) && (
            <Section title="Outras informações">
              <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-sm">
                {c.availability && <><dt className="text-zinc-400">Disponibilidade</dt><dd>{c.availability}</dd></>}
                {c.salary_expectation && <><dt className="text-zinc-400">Pretensão</dt><dd>{c.salary_expectation}</dd></>}
                {c.driver_license && <><dt className="text-zinc-400">CNH</dt><dd>{c.driver_license}</dd></>}
              </dl>
            </Section>
          )}

          <Section title="Minhas anotações">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              onBlur={() => { if (notes !== (c.notes ?? '')) onUpdate({ notes: notes || null }); }}
              rows={4}
              placeholder="Impressões da entrevista, referências, próximo passo…"
              className="w-full rounded-xl border border-zinc-200 p-3 text-sm focus:outline-none focus:border-rose-300"
            />
          </Section>
        </div>

        <div className="flex items-center gap-2 px-5 py-3 border-t border-zinc-100">
          {c.file_path && (
            <button onClick={abrirArquivo} className="flex items-center gap-1.5 px-3 h-9 rounded-lg border border-zinc-200 hover:bg-zinc-50 text-sm font-semibold text-zinc-700 cursor-pointer">
              <i className="ri-file-text-line" /> Ver currículo original
            </button>
          )}
          <button onClick={onDelete} className="ml-auto flex items-center gap-1.5 px-3 h-9 rounded-lg text-sm font-semibold text-red-600 hover:bg-red-50 cursor-pointer">
            <i className="ri-delete-bin-line" /> Excluir
          </button>
        </div>
      </aside>
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-400 mb-2">{title}</p>
      {children}
    </section>
  );
}
