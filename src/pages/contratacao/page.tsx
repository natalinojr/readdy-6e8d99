// Contratação — banco de currículos por empresa, kanban de fases, agenda de entrevistas,
// relatórios e configurações. Independente das lojas do ERPOS (empresas próprias em
// hiring_companies; fases em hiring_stages; configurações em hiring_settings).
// Leitura híbrida: PDF com texto é lido no navegador de graça (src/lib/curriculoLocal.ts);
// foto/PDF escaneado vai direto para a IA (Edge hiring-cv-scan); nos demais a IA só
// roda no botão "Organizar com IA". Tudo com RLS pelo e-mail do dono; o guard aqui é só UX.
import { type Dispatch, type SetStateAction, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js';
import { useAuth } from '@/contexts/AuthContext';
import { useModuleAccess } from '@/hooks/useModuleAccess';
import { supabase } from '@/lib/supabase';
import { readCurriculoPdf } from '@/lib/curriculoLocal';
import {
  type Application, type Candidate, type Company, type Interview, type Job, type Settings, type Stage, matchWithAi,
  type Distance, calcDistancesAi, distancesForCompany,
  BUCKET, norm, safeName, scanWithAi, aiFields, mergeSettings, stageOf, stageByKind, faltasFicha,
} from './shared';
import type { CandidatePatch } from './components/EntrevistaModal';
import { type Aderencia, melhorAderencia } from './aderencia';
import { DialogHost, confirmar, avisar } from './dialog';
import Vagas, { appKey } from './components/Vagas';
import VagaModal, { type JobDraft } from './components/VagaModal';
import AdicionarCandidatosModal from './components/AdicionarCandidatosModal';
import { candidatosTravadosNoLote } from './components/AcoesEmLote';
import UploadCurriculosModal from './components/UploadCurriculosModal';
import BarraInferior from './components/BarraInferior';
import CandidatoDrawer from './components/CandidatoDrawer';
import EntrevistaModal from './components/EntrevistaModal';
import RelatoriosContratacao from './components/RelatoriosContratacao';
import AreaHoje from './areas/AreaHoje';
import AreaConfiguracoes from './areas/AreaConfiguracoes';
import AreaEntrevistas from './areas/AreaEntrevistas';
import AreaCandidatos from './areas/AreaCandidatos';
import { type Area, type Destino, type SubAbaEntrevistas, type ModoCandidatos, type SecaoConfig, AREAS, AREA_CONFIG, destinoDeAbaAntiga } from './navegacao';

export interface QueueItem { key: string; name: string; state: 'lendo' | 'ok' | 'erro'; msg?: string }
type ModalState = { interview: Interview | null; candidateId?: string | null; date?: string | null } | null;

const lsGet = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* sem storage */ } };

function estadoInicialDeNavegacao(): { area: Area; view: ModoCandidatos } {
  const dest = destinoDeAbaAntiga(lsGet('contratacao_aba'));
  return {
    area: dest.area, // 'hoje' já existe (T14) — é o default real a partir daqui (RF-01)
    view: dest.modoCandidatos ?? (lsGet('contratacao_view') === 'tabela' ? 'tabela' : lsGet('contratacao_view') === 'kanban' ? 'kanban' : 'cards'),
  };
}

export default function ContratacaoPage() {
  const { user } = useAuth();
  // Dono ou usuário liberado no Admin Master (mesmo critério do is_hiring_admin() da RLS).
  const { hasModule, loading: acessoLoading } = useModuleAccess();
  const isOwner = hasModule('contratacao');

  const [items, setItems] = useState<Candidate[]>([]);
  const [interviews, setInterviews] = useState<Interview[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [stages, setStages] = useState<Stage[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [applications, setApplications] = useState<Application[]>([]);
  interface AgendamentoIASessao {
    id: string; candidate_id: string; job_id: string; status: string; updated_at: string;
    error: string | null; confirmed_at: string | null; confirm_requested_at: string | null; interview_id: string | null;
    pending_request: { kind?: string; starts_at?: string | null; texto?: string } | null;
  }
  const [schedSessions, setSchedSessions] = useState<AgendamentoIASessao[]>([]);
  const [distances, setDistances] = useState<Distance[]>([]);
  const [analyzing, setAnalyzing] = useState<Set<string>>(new Set());
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [jobModal, setJobModal] = useState<{ job: Job | null } | null>(null);
  const [addToJob, setAddToJob] = useState<Job | null>(null);
  const [vagaUpload, setVagaUpload] = useState<string>('');
  const [settings, setSettings] = useState<Settings>(mergeSettings(null));
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [area, setArea] = useState<Area>(() => estadoInicialDeNavegacao().area);
  const [view, setView] = useState<ModoCandidatos>(() => estadoInicialDeNavegacao().view);
  const [focoSubabaEntrevistas, setFocoSubabaEntrevistas] = useState<SubAbaEntrevistas | null>(null);
  const [focoSecaoConfig, setFocoSecaoConfig] = useState<SecaoConfig | null>(null);
  const [busca, setBusca] = useState('');
  const [faseFiltro, setFaseFiltro] = useState<string>('todas');
  const [decisaoFiltro, setDecisaoFiltro] = useState<string>('todas');
  const [empresaFiltro, setEmpresaFiltro] = useState<string>(() => lsGet('contratacao_empresa') ?? 'todas');
  const [empresaUpload, setEmpresaUpload] = useState<string>('');
  const [selId, setSelId] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalState>(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Link que abre um lugar certo (2026-09-16): botão "Abrir entrevista de Fulana" do chat do assistente
  // e toque na notificação. ?aba=<aba>, ?entrevista=<id> (abre o registro dela na aba Entrevistas),
  // ?candidato=<id> (abre a ficha). O parâmetro é consumido: recarregar não reabre o mesmo lugar.
  const [searchParams, setSearchParams] = useSearchParams();
  const [focoEntrevista, setFocoEntrevista] = useState<string | null>(null);
  useEffect(() => {
    const a = searchParams.get('aba');
    const ent = searchParams.get('entrevista');
    const cand = searchParams.get('candidato');
    if (!a && !ent && !cand) return;
    const dest: Destino | null = a ? destinoDeAbaAntiga(a) : null;
    if (dest) {
      setArea(dest.area); // 'hoje' já existe (T14) — RF-01
      if (dest.subabaEntrevistas) setFocoSubabaEntrevistas(dest.subabaEntrevistas);
      if (dest.modoCandidatos) setView(dest.modoCandidatos);
      if (dest.secaoConfig) setFocoSecaoConfig(dest.secaoConfig);
    }
    if (ent) {
      setFocoEntrevista(ent);
      // Com filtro de outra empresa a entrevista não apareceria na lista.
      setEmpresaFiltro('todas');
    }
    // Em Conversas da IA (sub-aba de Entrevistas, antes aba própria "agendamentos") o
    // candidato só dá contexto; abrir a ficha por cima esconderia o pedido.
    if (cand && dest?.subabaEntrevistas !== 'conversas') setSelId(cand);
    setSearchParams({}, { replace: true });
  }, [searchParams, setSearchParams]);

  useEffect(() => { lsSet('contratacao_view', view); }, [view]);
  useEffect(() => { lsSet('contratacao_aba', area); }, [area]);
  useEffect(() => { lsSet('contratacao_empresa', empresaFiltro); }, [empresaFiltro]);

  const ativas = useMemo(() => companies.filter((c) => c.is_active), [companies]);
  // Envio: empresa do filtro quando há uma escolhida; senão, a primeira ativa.
  useEffect(() => {
    if (empresaFiltro !== 'todas' && empresaFiltro !== 'sem' && ativas.some((c) => c.id === empresaFiltro)) setEmpresaUpload(empresaFiltro);
    else if (!ativas.some((c) => c.id === empresaUpload)) setEmpresaUpload(ativas[0]?.id ?? '');
  }, [empresaFiltro, ativas, empresaUpload]);

  const carregarConfig = useCallback(async () => {
    const [comp, stg, set] = await Promise.all([
      supabase.from('hiring_companies').select('*').order('sort_order').order('name'),
      supabase.from('hiring_stages').select('*').order('sort_order'),
      supabase.from('hiring_settings').select('data').eq('id', 1).maybeSingle(),
    ]);
    if (!comp.error) setCompanies((comp.data ?? []) as Company[]);
    if (!stg.error) setStages((stg.data ?? []) as Stage[]);
    if (!set.error) setSettings(mergeSettings(set.data?.data));
    return comp.error ?? stg.error ?? set.error ?? null;
  }, []);

  // silencioso = atualização automática (sem spinner; erro não troca a tela).
  const carregar = useCallback(async (silencioso = false) => {
    if (!silencioso) setLoading(true);
    const [cand, ivs, jb, ap, dst, sess, cfgErr] = await Promise.all([
      supabase.from('hiring_candidates').select('*').order('created_at', { ascending: false }).limit(2000),
      supabase.from('hiring_interviews').select('*').order('scheduled_at', { ascending: true }).limit(2000),
      supabase.from('hiring_jobs').select('*').order('created_at', { ascending: false }).limit(500),
      supabase.from('hiring_applications').select('*').limit(5000),
      supabase.from('hiring_distances').select('*').limit(20000),
      supabase.from('hiring_scheduling_sessions')
        .select('id, candidate_id, job_id, status, updated_at, error, confirmed_at, confirm_requested_at, interview_id, pending_request')
        .order('updated_at', { ascending: false }).limit(500),
      carregarConfig(),
    ]);
    const err = cand.error ?? ivs.error ?? jb.error ?? ap.error ?? dst.error ?? sess.error ?? cfgErr;
    if (err) { if (!silencioso) setLoadError(err.message); }
    else {
      setItems((cand.data ?? []) as Candidate[]);
      setInterviews((ivs.data ?? []) as Interview[]);
      setJobs((jb.data ?? []) as Job[]);
      setApplications((ap.data ?? []) as Application[]);
      setDistances((dst.data ?? []) as Distance[]);
      setSchedSessions((sess.data ?? []) as AgendamentoIASessao[]);
      setLoadError(null);
    }
    setLoading(false);
  }, [carregarConfig]);

  useEffect(() => { if (isOwner) carregar(); }, [isOwner, carregar]);

  // O assistente (WhatsApp/Telegram) cria candidatos, marca entrevistas e muda fases por fora da tela:
  // atualiza sozinho a cada minuto e ao voltar para a aba.
  useEffect(() => {
    if (!isOwner) return;
    const tick = () => { if (document.visibilityState === 'visible') carregar(true); };
    const t = setInterval(tick, 60_000);
    document.addEventListener('visibilitychange', tick);
    window.addEventListener('focus', tick);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', tick); window.removeEventListener('focus', tick); };
  }, [isOwner, carregar]);

  const carregarRef = useRef(carregar);
  useEffect(() => { carregarRef.current = carregar; }, [carregar]);
  // Tempo real (supabase_realtime, migração 20260915160000): etapa, nota e entrevista que o robô/IA ou
  // outra pessoa mudam entram na hora, pela própria linha do evento. O polling acima fica de reserva.
  useEffect(() => {
    if (!isOwner) return;
    const aplica = <T extends { id: string }>(set: Dispatch<SetStateAction<T[]>>, ordena?: (a: T, b: T) => number) =>
      (p: RealtimePostgresChangesPayload<Record<string, unknown>>) => {
        if (p.eventType === 'DELETE') {
          const id = (p.old as { id?: string }).id;
          if (id) set((prev) => prev.filter((x) => x.id !== id));
          return;
        }
        const row = p.new as unknown as T;
        // O Realtime às vezes manda a linha vazia/incompleta (ex.: checagem de RLS). Entrava na lista uma
        // "entrevista" sem id nem scheduled_at e o sort do salvar quebrava a tela ("reading 'localeCompare'",
        // 2026-09-16). Sem id → recarrega em silêncio; linha nova só entra se vier completa.
        if (!row || !(row as { id?: string }).id) { carregarRef.current?.(true); return; }
        set((prev) => {
          const existe = prev.some((x) => x.id === row.id);
          if (!existe && Object.keys(row as object).length < 5) { carregarRef.current?.(true); return prev; }
          const next = existe ? prev.map((x) => (x.id === row.id ? { ...x, ...row } : x)) : [row, ...prev];
          return ordena ? [...next].sort(ordena) : next;
        });
      };
    const ch = supabase.channel('contratacao-tempo-real')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'hiring_candidates' }, aplica(setItems))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'hiring_applications' }, aplica(setApplications))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'hiring_interviews' },
        aplica(setInterviews, (a, b) => String(a.scheduled_at).localeCompare(String(b.scheduled_at))))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [isOwner]);

  const novoStageId = stageByKind(stages, 'novo')?.id ?? null;

  // Distância do candidato até as lojas com pin (Edge + OpenRouteService; grátis).
  const calcDistances = useCallback(async (candidateId: string) => {
    const rows = await calcDistancesAi(candidateId);
    setDistances((prev) => [...prev.filter((d) => !(d.candidate_id === candidateId && rows.some((r) => r.company_id === d.company_id))), ...rows]);
    // O geocode grava lat/lng/precisão no candidato: traz de volta para a ficha.
    const { data } = await supabase.from('hiring_candidates').select('lat, lng, geo_label, geo_precision').eq('id', candidateId).maybeSingle();
    if (data) setItems((prev) => prev.map((c) => (c.id === candidateId ? { ...c, ...data } : c)));
  }, []);

  // Análise currículo × vaga × loja (IA). Uma candidatura por vez por chave; a tela mostra o "analisando".
  const analyze = useCallback(async (jobId: string, candidateId: string) => {
    const k = appKey(jobId, candidateId);
    setAnalyzing((s) => new Set(s).add(k));
    try {
      const app = await matchWithAi(candidateId, jobId);
      setApplications((prev) => [...prev.filter((a) => !(a.job_id === jobId && a.candidate_id === candidateId)), app]);
    } catch (e) {
      setApplications((prev) => prev.map((a) => (a.job_id === jobId && a.candidate_id === candidateId ? { ...a, error: (e as Error).message } : a)));
    } finally {
      setAnalyzing((s) => { const n = new Set(s); n.delete(k); return n; });
    }
  }, []);

  // Inscreve candidatos do banco numa vaga e analisa (2 por vez).
  const applyToJob = useCallback(async (jobId: string, candidateIds: string[]) => {
    if (!candidateIds.length) return;
    const { data, error } = await supabase.from('hiring_applications')
      .upsert(candidateIds.map((cid) => ({ job_id: jobId, candidate_id: cid })), { onConflict: 'job_id,candidate_id', ignoreDuplicates: true })
      .select('*');
    if (error) { avisar(`Não foi possível inscrever na vaga: ${error.message}`); return; }
    const novos = (data ?? []) as Application[];
    setApplications((prev) => [...prev.filter((a) => !novos.some((n) => n.id === a.id)), ...novos]);
    const fila = novos.map((n) => n.candidate_id);
    let i = 0;
    const worker = async () => { while (i < fila.length) { const cid = fila[i++]; await analyze(jobId, cid); } };
    await Promise.all([worker(), worker()]);
  }, [analyze]);

  const processFile = useCallback(async (file: File, key: string, companyId: string | null, jobId: string | null) => {
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
        company_id: companyId,
        stage_id: novoStageId,
        full_name: (fields.full_name as string | null) || file.name.replace(/\.[^.]+$/, ''),
        file_path: upErr ? null : path,
        file_name: file.name,
        file_type: file.type,
      };
      const { data: ins, error } = await supabase.from('hiring_candidates').insert(row).select('*').single();
      // Índice único no banco (telefone/e-mail): currículo repetido não entra (regra do dono, 2026-09-14)
      if (error) throw new Error(error.code === '23505' ? 'Currículo repetido: já existe um candidato com esse telefone ou e-mail. Não foi salvo de novo.' : error.message);
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
      if (jobId) avisos.push('inscrito na vaga, analisando');
      upd({ state: 'ok', msg: [cand.full_name, ...avisos].join(' · ') });
      // Distância antes da análise da vaga (a análise usa os km reais).
      // Sem loja escolhida não há distância a calcular.
      (companyId ? calcDistances(cand.id).catch(() => {}) : Promise.resolve()).finally(() => { if (jobId) applyToJob(jobId, [cand.id]); });
    } catch (e) {
      upd({ state: 'erro', msg: (e as Error).message });
    }
  }, [novoStageId, applyToJob, calcDistances]);

  // jobIdArg: vaga escolhida na tela da vaga; sem ela, vale o seletor "Vaga" da área de envio.
  const addFiles = useCallback(async (files: FileList | File[], jobIdArg?: string | null) => {
    const list = Array.from(files);
    if (!list.length) return;
    const jobId = jobIdArg !== undefined && jobIdArg !== null ? jobIdArg : (vagaUpload || null);
    const job = jobId ? jobs.find((j) => j.id === jobId) ?? null : null;
    const companyId = job ? job.company_id : (empresaUpload || null);
    const entries = list.map((f) => ({ file: f, key: crypto.randomUUID() }));
    setQueue((q) => [...entries.map(({ file, key }) => ({ key, name: file.name, state: 'lendo' as const })), ...q]);
    // 2 por vez: rápido sem estourar o limite da API.
    let i = 0;
    const worker = async () => { while (i < entries.length) { const e = entries[i++]; await processFile(e.file, e.key, companyId, jobId); } };
    await Promise.all([worker(), worker()]);
  }, [processFile, empresaUpload, vagaUpload, jobs]);

  const updateCandidate = useCallback(async (id: string, patch: Partial<Candidate>) => {
    // Ficha incompleta não sai de "Novo" (exceto para "Descartado"). O banco também trava.
    if (patch.stage_id) {
      const atual = items.find((x) => x.id === id);
      const de = atual ? stageOf(stages, atual.stage_id) : null;
      const para = stages.find((s) => s.id === patch.stage_id);
      if (atual && de?.native_kind === 'novo' && para && para.native_kind !== 'novo' && para.native_kind !== 'descartado') {
        const faltam = faltasFicha({ ...atual, ...patch }, settings);
        if (faltam.length) {
          const ok = await confirmar({
            titulo: 'Ficha incompleta',
            mensagem: `Faltam: ${faltam.map((f) => f.label.toLowerCase()).join(', ')}. O ideal é completar na ficha antes de tirar ${atual.full_name.split(' ')[0]} de "${de.name}". Quer mover mesmo assim?`,
            confirmarLabel: 'Mover mesmo assim',
          });
          if (!ok) return;
          patch = { ...patch, required_waived_at: new Date().toISOString() };
        }
      }
    }
    setItems((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
    const { error } = await supabase.from('hiring_candidates').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) { avisar(`Não foi possível salvar: ${error.message}`); carregar(); return; }
    // Empresa trocada: as entrevistas acompanham o candidato.
    if ('company_id' in patch) {
      await supabase.from('hiring_interviews').update({ company_id: patch.company_id ?? null }).eq('candidate_id', id);
      setInterviews((prev) => prev.map((iv) => (iv.candidate_id === id ? { ...iv, company_id: patch.company_id ?? null } : iv)));
      // Trocou a loja: a distância antiga some e, com loja nova, recalcula (a Edge apaga as outras).
      setDistances((prev) => prev.filter((d) => d.candidate_id !== id));
      if (patch.company_id) calcDistances(id).catch(() => {});
      else await supabase.from('hiring_distances').delete().eq('candidate_id', id);
    }
  }, [carregar, calcDistances, items, stages, settings]);

  // IA sob demanda: baixa o original do bucket e completa a ficha (mantém fase/nota/anotações/empresa).
  const organizarComIA = useCallback(async (c: Candidate) => {
    if (!c.file_path) throw new Error('O arquivo original não foi salvo; suba o currículo de novo.');
    const { data: blob, error } = await supabase.storage.from(BUCKET).download(c.file_path);
    if (error || !blob) throw new Error('Não foi possível baixar o arquivo original.');
    const file = new File([blob], c.file_name ?? 'curriculo', { type: c.file_type ?? blob.type });
    // Endereço pode mudar com a leitura da IA: zera a localização para o geocode refazer.
    const patch = { ...aiFields(await scanWithAi(file)), lat: null, lng: null, geo_label: null, geo_precision: null } as Partial<Candidate>;
    const { error: upErr } = await supabase.from('hiring_candidates')
      .update({ ...patch, updated_at: new Date().toISOString() }).eq('id', c.id);
    if (upErr) throw new Error(upErr.message);
    setItems((prev) => prev.map((x) => (x.id === c.id ? { ...x, ...patch } : x)));
    await supabase.from('hiring_distances').delete().eq('candidate_id', c.id);
    setDistances((prev) => prev.filter((d) => d.candidate_id !== c.id));
    calcDistances(c.id).catch(() => {});
  }, [calcDistances]);

  const deleteCandidate = useCallback(async (c: Candidate) => {
    const ok = await confirmar({
      titulo: 'Excluir currículo?',
      mensagem: <>O currículo de <b className="text-zinc-900">{c.full_name}</b> e as entrevistas dele serão apagados. Não dá para desfazer.</>,
      confirmarLabel: 'Excluir',
      perigo: true,
    });
    if (!ok) return;
    const { error } = await supabase.from('hiring_candidates').delete().eq('id', c.id);
    if (error) { avisar(`Não foi possível excluir: ${error.message}`); return; }
    if (c.file_path) await supabase.storage.from(BUCKET).remove([c.file_path]);
    setItems((prev) => prev.filter((x) => x.id !== c.id));
    setInterviews((prev) => prev.filter((x) => x.candidate_id !== c.id));
    setSelId(null);
  }, []);

  // Loja ganhou/mudou o pin: calcula a distância de todos os candidatos até ela, em lotes
  // (a Edge respeita o limite do ORS). Depois recarrega as distâncias da loja.
  const recalcCompany = useCallback(async (companyId: string) => {
    for (let i = 0; i < 60; i++) {
      let r: { done: number; processed: number; remaining: number };
      try { r = await distancesForCompany(companyId); } catch { break; }
      if (!r.remaining || !r.processed) break;
    }
    const { data } = await supabase.from('hiring_distances').select('*').eq('company_id', companyId);
    setDistances((prev) => [...prev.filter((d) => d.company_id !== companyId), ...((data ?? []) as Distance[])]);
  }, []);

  // ── Vagas ──
  const saveJob = useCallback(async (d: JobDraft): Promise<boolean> => {
    const { id, ...rest } = d;
    const antes = id ? jobs.find((j) => j.id === id) : null;
    const hoje = new Date().toISOString().slice(0, 10);
    const row = {
      ...rest,
      closed_at: rest.status === 'fechada' ? (antes?.closed_at ?? hoje) : null,
      updated_at: new Date().toISOString(),
    };
    const { data, error } = id
      ? await supabase.from('hiring_jobs').update(row).eq('id', id).select('*').single()
      : await supabase.from('hiring_jobs').insert(row).select('*').single();
    if (error || !data) { avisar(`Não foi possível salvar a vaga: ${error?.message ?? 'erro'}`); return false; }
    const job = data as Job;
    setJobs((prev) => (id ? prev.map((j) => (j.id === id ? job : j)) : [job, ...prev]));
    if (!id) setSelectedJobId(job.id);
    return true;
  }, [jobs]);

  // Candidato pode ter chegado por uma conversa do WhatsApp (bot_conversations) antes do realtime
  // trazê-lo para `items` — busca uma vez antes de abrir a ficha. Recriado aqui porque o branch
  // aba === 'links' que tinha essa lógica foi removido em T09 (Fase 3); agora dois lugares
  // precisam dela: VagaDivulgacao (T11) e ConfigWhatsApp (T12).
  const abrirCandidatoDoBot = useCallback(async (id: string) => {
    if (!items.some((c) => c.id === id)) {
      const { data } = await supabase.from('hiring_candidates').select('*').eq('id', id).maybeSingle();
      if (data) setItems((prev) => [data as Candidate, ...prev]);
    }
    setSelId(id);
  }, [items]);

  const deleteJob = useCallback(async (job: Job) => {
    const n = applications.filter((a) => a.job_id === job.id).length;
    const ok = await confirmar({
      titulo: `Excluir a vaga ${job.title}?`,
      mensagem: n
        ? `As ${n} inscrições e análises desta vaga serão apagadas. O agendamento pela IA desta vaga também será apagado e os links de WhatsApp criados para ela deixam de estar ligados a uma vaga (continuam existindo, sem vaga). Os currículos continuam no banco.`
        : 'A vaga será apagada. O agendamento pela IA desta vaga também será apagado e os links de WhatsApp criados para ela deixam de estar ligados a uma vaga (continuam existindo, sem vaga).',
      confirmarLabel: 'Excluir', perigo: true,
    });
    if (!ok) return;
    const { error } = await supabase.from('hiring_jobs').delete().eq('id', job.id);
    if (error) { avisar(`Não foi possível excluir: ${error.message}`); return; }
    setJobs((prev) => prev.filter((j) => j.id !== job.id));
    setApplications((prev) => prev.filter((a) => a.job_id !== job.id));
    setSelectedJobId(null);
  }, [applications]);

  const removeApplication = useCallback(async (app: Application) => {
    const nome = items.find((c) => c.id === app.candidate_id)?.full_name ?? 'o candidato';
    const ok = await confirmar({ titulo: 'Tirar da vaga?', mensagem: `${nome} sai desta vaga; o currículo continua no banco.`, confirmarLabel: 'Tirar' });
    if (!ok) return;
    const { error } = await supabase.from('hiring_applications').delete().eq('id', app.id);
    if (error) { avisar(`Não foi possível: ${error.message}`); return; }
    setApplications((prev) => prev.filter((a) => a.id !== app.id));
  }, [items]);

  // ── Filtros ──
  const daEmpresa = useMemo(() => items.filter((c) =>
    empresaFiltro === 'todas' || (empresaFiltro === 'sem' ? !c.company_id : c.company_id === empresaFiltro)), [items, empresaFiltro]);

  const buscados = useMemo(() => {
    const q = norm(busca).trim();
    const base = decisaoFiltro === 'todas' ? daEmpresa
      : daEmpresa.filter((c) => (decisaoFiltro === 'sem' ? !c.decision : c.decision === decisaoFiltro));
    if (!q) return base;
    return base.filter((c) => {
      const hay = norm([c.full_name, c.desired_role, c.city, c.neighborhood, c.phone, c.email, c.skills.join(' '),
        c.experiences.map((e) => `${e.empresa} ${e.cargo}`).join(' '), c.raw_text ?? ''].join(' '));
      return q.split(/\s+/).every((t) => hay.includes(t));
    });
  }, [daEmpresa, busca, decisaoFiltro]);

  const counts = useMemo(() => {
    const m: Record<string, number> = { todas: buscados.length };
    for (const c of buscados) { const s = stageOf(stages, c.stage_id)?.id ?? ''; m[s] = (m[s] ?? 0) + 1; }
    return m;
  }, [buscados, stages]);

  const filtrados = useMemo(() =>
    faseFiltro === 'todas' ? buscados : buscados.filter((c) => stageOf(stages, c.stage_id)?.id === faseFiltro), [buscados, faseFiltro, stages]);

  const jobsDaEmpresa = useMemo(() => jobs.filter((j) =>
    empresaFiltro === 'todas' || (empresaFiltro === 'sem' ? !j.company_id : j.company_id === empresaFiltro)), [jobs, empresaFiltro]);
  const vagasUpload = useMemo(() => jobs.filter((j) => j.status !== 'fechada' && (!empresaUpload || j.company_id === empresaUpload)), [jobs, empresaUpload]);

  const ivsDaEmpresa = useMemo(() => {
    const ids = new Set(daEmpresa.map((c) => c.id));
    return interviews.filter((iv) => ids.has(iv.candidate_id));
  }, [interviews, daEmpresa]);

  const { proximaEntrevista, ultimaAvaliacao } = useMemo(() => {
    const now = new Date().toISOString();
    const prox = new Map<string, Interview>();
    const ult = new Map<string, Interview>();
    for (const iv of interviews) {
      if (iv.status === 'agendada' && iv.scheduled_at >= now) {
        const cur = prox.get(iv.candidate_id);
        if (!cur || iv.scheduled_at < cur.scheduled_at) prox.set(iv.candidate_id, iv);
      }
      if (iv.status === 'realizada') {
        const cur = ult.get(iv.candidate_id);
        if (!cur || iv.scheduled_at > cur.scheduled_at) ult.set(iv.candidate_id, iv);
      }
    }
    return { proximaEntrevista: prox, ultimaAvaliacao: ult };
  }, [interviews]);

  const distMap = useMemo(() => new Map(distances.map((d) => [`${d.company_id}:${d.candidate_id}`, d])), [distances]);
  const distancia = useCallback((candidateId: string, companyId: string | null) =>
    (companyId ? distMap.get(`${companyId}:${candidateId}`) ?? null : null), [distMap]);
  // Distância só existe até a loja escolhida na ficha do candidato.
  const distanciaLista = useCallback((c: Candidate) => distancia(c.id, c.company_id), [distancia]);
  // Vagas de cada candidato (coluna Vaga da tabela).
  const vagasPorCandidato = useMemo(() => {
    const titulo = new Map(jobs.map((j) => [j.id, j.title]));
    const m = new Map<string, string[]>();
    for (const a of applications) {
      const t = titulo.get(a.job_id);
      if (t) m.set(a.candidate_id, [...(m.get(a.candidate_id) ?? []), t]);
    }
    return m;
  }, [applications, jobs]);
  const vagasDe = useCallback((c: Candidate) => vagasPorCandidato.get(c.id) ?? [], [vagasPorCandidato]);
  const applicationsPorCandidato = useMemo(() => {
    const m = new Map<string, Application[]>();
    for (const a of applications) m.set(a.candidate_id, [...(m.get(a.candidate_id) ?? []), a]);
    return m;
  }, [applications]);
  // job_id de cada candidato (Fase 6, correção de revisão): filtro de vaga compara por id, não por
  // título — duas vagas de empresas diferentes com o mesmo título não podem virar uma etiqueta só.
  const vagaIdsDe = useCallback((c: Candidate) => applicationsPorCandidato.get(c.id)?.map((a) => a.job_id) ?? [], [applicationsPorCandidato]);
  const aderenciaPorCandidato = useMemo(() => {
    const m = new Map<string, Aderencia | null>();
    for (const c of items) m.set(c.id, melhorAderencia(applicationsPorCandidato.get(c.id) ?? [], jobs));
    return m;
  }, [items, applicationsPorCandidato, jobs]);
  const aderenciaDe = useCallback((c: Candidate) => aderenciaPorCandidato.get(c.id) ?? null, [aderenciaPorCandidato]);
  const faltasPorCandidato = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of items) m.set(c.id, faltasFicha(c, settings).length);
    return m;
  }, [items, settings]);
  const faltasDe = useCallback((c: Candidate) => faltasPorCandidato.get(c.id) ?? 0, [faltasPorCandidato]);

  // Ação em lote (T17): mesma trava de dados mínimos de updateCandidate, mas com UMA pergunta só
  // para o lote inteiro, em vez de N janelas em sequência. updateCandidate (caminho de 1
  // candidato — drag do Kanban, ficha) não é tocado por esta função.
  const moveLote = useCallback(async (ids: string[], stageId: string) => {
    const alvo = items.filter((c) => ids.includes(c.id) && c.stage_id !== stageId);
    if (!alvo.length) return;
    const travados = candidatosTravadosNoLote(alvo, stageId, stages, faltasDe);
    let waiveIds = new Set<string>();
    if (travados.length) {
      const ok = await confirmar({
        titulo: 'Ficha incompleta',
        mensagem: `${travados.length} de ${alvo.length} candidato${alvo.length > 1 ? 's têm' : ' tem'} ficha incompleta: `
          + `${travados.map((c) => c.full_name.split(' ')[0]).join(', ')}. Quer mover mesmo assim?`,
        confirmarLabel: 'Mover mesmo assim',
      });
      if (!ok) return; // Decisão 2: um "não" cancela o lote inteiro, nada é gravado.
      waiveIds = new Set(travados.map((c) => c.id));
    }
    const agora = new Date().toISOString();
    setItems((prev) => prev.map((c) => {
      if (!alvo.some((a) => a.id === c.id)) return c;
      return waiveIds.has(c.id) ? { ...c, stage_id: stageId, required_waived_at: agora } : { ...c, stage_id: stageId };
    }));
    const semTrava = alvo.filter((c) => !waiveIds.has(c.id)).map((c) => c.id);
    const comTrava = alvo.filter((c) => waiveIds.has(c.id)).map((c) => c.id);
    const erros: string[] = [];
    if (semTrava.length) {
      const { error } = await supabase.from('hiring_candidates').update({ stage_id: stageId, updated_at: agora }).in('id', semTrava);
      if (error) erros.push(error.message);
    }
    if (comTrava.length) {
      const { error } = await supabase.from('hiring_candidates')
        .update({ stage_id: stageId, updated_at: agora, required_waived_at: agora }).in('id', comTrava);
      if (error) erros.push(error.message);
    }
    if (erros.length) {
      avisar(`Não foi possível mover ${erros.length === 1 ? '1 grupo' : `${erros.length} grupos`}: ${erros.join('; ')}`);
      carregar();
    }
  }, [items, stages, faltasDe, carregar]);
  const agendamentoIAPorCandidato = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of schedSessions) if (!m.has(s.candidate_id)) m.set(s.candidate_id, s.status);
    return m;
  }, [schedSessions]);
  const agendamentoIADe = useCallback((c: Candidate) => agendamentoIAPorCandidato.get(c.id) ?? null, [agendamentoIAPorCandidato]);

  const sel = items.find((c) => c.id === selId) ?? null;
  const mostrarEmpresa = empresaFiltro === 'todas' && companies.length > 1;

  const onInterviewSaved = (iv: Interview, candidatePatch?: CandidatePatch) => {
    if (!iv?.id) { carregar(true); return; }
    setInterviews((prev) => [...prev.filter((x) => x.id && x.id !== iv.id), iv]
      .sort((a, b) => String(a.scheduled_at ?? '').localeCompare(String(b.scheduled_at ?? ''))));
    if (candidatePatch) {
      const { id, ...rest } = candidatePatch;
      setItems((prev) => prev.map((c) => (c.id === id ? { ...c, ...rest } : c)));
    }
    setModal(null);
  };

  if (user && !acessoLoading && !isOwner) return <Navigate to="/modulos" replace />;

  const lendo = queue.filter((q) => q.state === 'lendo').length;
  const semEmpresas = !loading && companies.length === 0;

  return (
    <div className="max-w-6xl mx-auto pb-20 sm:pb-0">
      {/* Cabeçalho */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="w-10 h-10 flex items-center justify-center rounded-xl bg-rose-50 border border-rose-200">
          <i className="ri-user-search-line text-xl text-rose-600" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-black text-zinc-900">Contratação</h1>
          <p className="text-xs text-zinc-400">Currículos, kanban, entrevistas e relatórios por empresa</p>
        </div>
        {area !== 'config' && companies.length > 1 && (
          <select value={empresaFiltro} onChange={(e) => setEmpresaFiltro(e.target.value)}
            className="w-full sm:w-auto h-10 px-3 rounded-xl border border-zinc-200 text-sm font-semibold text-zinc-700 cursor-pointer">
            <option value="todas">Todas as empresas</option>
            {companies.map((c) => <option key={c.id} value={c.id}>{c.name}{c.is_active ? '' : ' (inativa)'}</option>)}
            <option value="sem">Sem empresa</option>
          </select>
        )}
        {(area === 'candidatos' || (area === 'vagas' && jobs.some((j) => j.id === selectedJobId))) && (
          <button onClick={() => {
            const job = area === 'vagas' ? jobs.find((j) => j.id === selectedJobId) : null;
            setEmpresaUpload(job ? (job.company_id ?? '') : '');
            setVagaUpload(job ? job.id : '');
            setUploadOpen(true);
          }}
            className="flex flex-1 sm:flex-none items-center justify-center gap-2 px-4 h-10 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-sm font-bold cursor-pointer whitespace-nowrap">
            <i className="ri-upload-2-line" /> Adicionar currículos
          </button>
        )}
        <input ref={fileRef} type="file" multiple accept="application/pdf,image/*" className="hidden"
          onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ''; }} />
      </div>

      {/* Áreas */}
      <div className="flex gap-1 mb-4 border-b border-zinc-200 overflow-x-auto">
        {AREAS.map((t) => (
          <button key={t.id} onClick={() => setArea(t.id)}
            className={`flex items-center gap-1.5 px-3 sm:px-4 h-10 text-[13px] sm:text-sm font-bold border-b-2 -mb-px cursor-pointer whitespace-nowrap flex-shrink-0 ${
              area === t.id ? 'border-rose-600 text-rose-700' : 'border-transparent text-zinc-500 hover:text-zinc-800'}`}>
            <i className={t.icon} /> {t.label}
          </button>
        ))}
        <button onClick={() => setArea('config')} title={AREA_CONFIG.label}
          className={`flex items-center justify-center w-10 h-10 -mb-px border-b-2 cursor-pointer ml-auto flex-shrink-0 ${
            area === 'config' ? 'border-rose-600 text-rose-700' : 'border-transparent text-zinc-500 hover:text-zinc-800'}`}>
          <i className={AREA_CONFIG.icon} />
        </button>
      </div>

      {semEmpresas && area !== 'config' && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 flex items-center gap-3">
          <i className="ri-building-line text-lg" />
          <span className="flex-1">Cadastre as empresas ou lojas para separar os currículos.</span>
          <button onClick={() => setArea('config')} className="px-3 h-8 rounded-lg bg-amber-500 text-white text-xs font-bold cursor-pointer">Ir para Configurações</button>
        </div>
      )}

      {loading ? (
        <div className="py-16 flex justify-center"><div className="w-7 h-7 border-2 border-rose-500 border-t-transparent rounded-full animate-spin" /></div>
      ) : loadError ? (
        <p className="py-10 text-center text-sm text-red-600">Erro ao carregar: {loadError}</p>
      ) : area === 'hoje' ? (
        <AreaHoje interviews={ivsDaEmpresa} candidates={items} jobs={jobsDaEmpresa} applications={applications} companies={companies}
          mostrarEmpresa={mostrarEmpresa} schedSessions={schedSessions} tenantId={user?.tenantId}
          onOpenCandidate={setSelId} onAbrirConversas={() => { setArea('entrevistas'); setFocoSubabaEntrevistas('conversas'); }}
          onAbrirVaga={(jobId) => { setArea('vagas'); setSelectedJobId(jobId); }}
          onNewInterview={(date) => setModal({ interview: null, date })}
          onSessaoAtualizada={() => carregar(true)} />
      ) : area === 'config' ? (
        <AreaConfiguracoes companies={companies} stages={stages} settings={settings} candidates={items}
          onReload={async () => { await carregarConfig(); const { data } = await supabase.from('hiring_candidates').select('*').order('created_at', { ascending: false }).limit(2000); if (data) setItems(data as Candidate[]); }}
          onSettingsSaved={setSettings} onRecalcCompany={recalcCompany}
          jobs={jobs} onOpenCandidate={abrirCandidatoDoBot}
          secaoInicial={focoSecaoConfig} onSecaoInicialUsada={() => setFocoSecaoConfig(null)} />
      ) : area === 'vagas' ? (
        <Vagas
          jobs={jobsDaEmpresa} companies={companies} candidates={items} applications={applications} stages={stages}
          mostrarEmpresa={mostrarEmpresa} analyzing={analyzing} distancia={distancia}
          selectedJobId={selectedJobId} onSelectJob={setSelectedJobId}
          onNewJob={() => setJobModal({ job: null })}
          onDeleteJob={deleteJob}
          onAddFromBank={setAddToJob}
          onUploadToJob={(job) => { setEmpresaUpload(job.company_id ?? ''); setVagaUpload(job.id); setUploadOpen(true); }}
          onReanalyze={(a) => analyze(a.job_id, a.candidate_id)}
          onRemoveApplication={removeApplication}
          onOpenCandidate={abrirCandidatoDoBot}
          onSaveJob={saveJob}
        />
      ) : area === 'entrevistas' ? (
        <AreaEntrevistas interviews={ivsDaEmpresa} candidates={items} companies={companies} stages={stages} settings={settings}
          applications={applications} jobs={jobs} mostrarEmpresa={mostrarEmpresa}
          onSaved={onInterviewSaved} onOpenCandidate={setSelId}
          onOpenInterview={(iv) => setModal({ interview: iv })}
          onNewInterview={(date) => setModal({ interview: null, date })}
          focoId={focoEntrevista} onFocoUsado={() => setFocoEntrevista(null)}
          subabaInicial={focoSubabaEntrevistas} onSubabaInicialUsada={() => setFocoSubabaEntrevistas(null)} />
      ) : area === 'relatorios' ? (
        <RelatoriosContratacao candidates={daEmpresa} interviews={interviews} companies={companies} stages={stages} settings={settings}
          mostrarEmpresa={mostrarEmpresa} onOpen={setSelId} />
      ) : (
        <AreaCandidatos
          busca={busca} onBuscaChange={setBusca}
          decisaoFiltro={decisaoFiltro} onDecisaoFiltroChange={setDecisaoFiltro}
          view={view} onViewChange={setView}
          items={items} buscados={buscados} filtrados={filtrados} daEmpresa={daEmpresa}
          stages={stages} companies={companies} mostrarEmpresa={mostrarEmpresa}
          faseFiltro={faseFiltro} onFaseFiltroChange={setFaseFiltro} counts={counts}
          proximaEntrevista={proximaEntrevista} ultimaAvaliacao={ultimaAvaliacao}
          distanciaLista={distanciaLista} vagasDe={vagasDe} vagaIdsDe={vagaIdsDe} jobs={jobs}
          aderenciaDe={aderenciaDe} faltasDe={faltasDe} agendamentoIADe={agendamentoIADe}
          onOpen={setSelId}
          onMove={(id, stageId) => { const c = items.find((x) => x.id === id); if (c && c.stage_id !== stageId) updateCandidate(id, { stage_id: stageId }); }}
          onMoverLote={moveLote}
        />
      )}

      {sel && (
        <CandidatoDrawer
          c={sel}
          companies={companies}
          stages={stages}
          ficha={settings}
          settings={settings}
          interviews={interviews.filter((iv) => iv.candidate_id === sel.id)}
          jobs={jobs}
          applications={applications.filter((a) => a.candidate_id === sel.id)}
          analyzing={analyzing}
          onApply={(jobId) => applyToJob(jobId, [sel.id])}
          onOpenJob={(jobId) => { setSelId(null); setSelectedJobId(jobId); setArea('vagas'); }}
          distances={distances.filter((d) => d.candidate_id === sel.id)}
          onCalcDistances={() => calcDistances(sel.id)}
          onClose={() => setSelId(null)}
          onUpdate={(patch) => updateCandidate(sel.id, patch)}
          onDelete={() => deleteCandidate(sel)}
          onOrganizar={() => organizarComIA(sel)}
          onAgendar={() => setModal({ interview: null, candidateId: sel.id })}
          onOpenInterview={(iv) => setModal({ interview: iv })}
        />
      )}

      {modal && (
        <EntrevistaModal
          interview={modal.interview}
          candidates={items}
          companies={companies}
          stages={stages}
          settings={settings}
          presetCandidateId={modal.candidateId}
          presetDate={modal.date}
          onClose={() => setModal(null)}
          onSaved={onInterviewSaved}
          onDeleted={(id) => { setInterviews((prev) => prev.filter((x) => x.id !== id)); setModal(null); }}
        />
      )}

      {jobModal && (
        <VagaModal job={jobModal.job} companies={companies}
          presetCompanyId={empresaFiltro !== 'todas' && empresaFiltro !== 'sem' ? empresaFiltro : null}
          onClose={() => setJobModal(null)} onSave={saveJob} />
      )}

      {addToJob && (
        <AdicionarCandidatosModal job={addToJob} candidates={items} companies={companies} stages={stages}
          jaInscritos={new Set(applications.filter((a) => a.job_id === addToJob.id).map((a) => a.candidate_id))}
          onClose={() => setAddToJob(null)}
          onAdd={(ids) => applyToJob(addToJob.id, ids)} />
      )}

      <UploadCurriculosModal
        open={uploadOpen} onClose={() => setUploadOpen(false)}
        empresas={ativas} empresaId={empresaUpload} onEmpresaChange={(id) => { setEmpresaUpload(id); setVagaUpload(''); }}
        vagas={vagasUpload} vagaId={vagaUpload} onVagaChange={setVagaUpload}
        dragOver={dragOver} onDragOver={setDragOver}
        onPickFiles={() => fileRef.current?.click()} onDropFiles={(files) => addFiles(files)}
        queue={queue} onClearQueue={() => setQueue([])} lendo={lendo}
      />

      <BarraInferior area={area} onArea={setArea} />
      <DialogHost />
    </div>
  );
}
