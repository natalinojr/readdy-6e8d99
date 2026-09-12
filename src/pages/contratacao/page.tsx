// Contratação — banco de currículos por loja, agenda de entrevistas e relatórios.
// Leitura híbrida: PDF com texto é lido no navegador de graça (src/lib/curriculoLocal.ts);
// foto/PDF escaneado vai direto para a IA (Edge hiring-cv-scan); nos demais a IA só
// roda no botão "Organizar com IA". Dados em hiring_candidates / hiring_interviews
// (+ arquivo no bucket privado "curriculos"), tudo com RLS pelo e-mail do dono;
// o guard aqui é só para a UX.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { readCurriculoPdf } from '@/lib/curriculoLocal';
import {
  type Candidate, type Interview, type Loja, type Status, OWNER_EMAIL, BUCKET, STATUS, norm, safeName, scanWithAi, aiFields,
} from './shared';
import CandidatosLista from './components/CandidatosLista';
import CandidatoDrawer from './components/CandidatoDrawer';
import EntrevistaModal from './components/EntrevistaModal';
import AgendaEntrevistas from './components/AgendaEntrevistas';
import RelatoriosContratacao from './components/RelatoriosContratacao';

interface QueueItem { key: string; name: string; state: 'lendo' | 'ok' | 'erro'; msg?: string }
type Aba = 'candidatos' | 'agenda' | 'relatorios';
type ModalState = { interview: Interview | null; candidateId?: string | null; date?: string | null } | null;

const lsGet = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* sem storage */ } };

export default function ContratacaoPage() {
  const { user, availableTenants } = useAuth();
  const isOwner = user?.email?.toLowerCase() === OWNER_EMAIL;

  const lojas: Loja[] = useMemo(() => {
    const list = availableTenants.map((t) => ({ id: t.tenantId, nome: t.tenantName }));
    if (user?.tenantId && !list.some((l) => l.id === user.tenantId)) list.unshift({ id: user.tenantId, nome: user.loja ?? 'Loja atual' });
    return list;
  }, [availableTenants, user?.tenantId, user?.loja]);

  const [items, setItems] = useState<Candidate[]>([]);
  const [interviews, setInterviews] = useState<Interview[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [aba, setAba] = useState<Aba>('candidatos');
  const [view, setView] = useState<'cards' | 'tabela'>(() => (lsGet('contratacao_view') === 'tabela' ? 'tabela' : 'cards'));
  const [busca, setBusca] = useState('');
  const [filtro, setFiltro] = useState<Status | 'todos'>('todos');
  const [soArea, setSoArea] = useState(false);
  const [lojaFiltro, setLojaFiltro] = useState<string>(() => lsGet('contratacao_loja') ?? 'todas');
  const [lojaUpload, setLojaUpload] = useState<string>(user?.tenantId ?? '');
  const [selId, setSelId] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalState>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { lsSet('contratacao_view', view); }, [view]);
  useEffect(() => { lsSet('contratacao_loja', lojaFiltro); }, [lojaFiltro]);
  // Filtro numa loja específica: novos currículos vão para ela.
  useEffect(() => { if (lojaFiltro !== 'todas') setLojaUpload(lojaFiltro === 'sem' ? '' : lojaFiltro); }, [lojaFiltro]);

  const carregar = useCallback(async () => {
    setLoading(true);
    const [cand, ivs] = await Promise.all([
      supabase.from('hiring_candidates').select('*').order('created_at', { ascending: false }).limit(2000),
      supabase.from('hiring_interviews').select('*').order('scheduled_at', { ascending: true }).limit(2000),
    ]);
    if (cand.error || ivs.error) setLoadError((cand.error ?? ivs.error)!.message);
    else {
      setItems((cand.data ?? []) as Candidate[]);
      setInterviews((ivs.data ?? []) as Interview[]);
      setLoadError(null);
    }
    setLoading(false);
  }, []);

  useEffect(() => { if (isOwner) carregar(); }, [isOwner, carregar]);

  const processFile = useCallback(async (file: File, key: string, tenantId: string | null) => {
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
        tenant_id: tenantId,
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
  }, []);

  const addFiles = useCallback(async (files: FileList | File[]) => {
    const list = Array.from(files);
    if (!list.length) return;
    const tenantId = lojaUpload || null;
    const entries = list.map((f) => ({ file: f, key: crypto.randomUUID() }));
    setQueue((q) => [...entries.map(({ file, key }) => ({ key, name: file.name, state: 'lendo' as const })), ...q]);
    // 2 por vez: rápido sem estourar o limite da API.
    let i = 0;
    const worker = async () => { while (i < entries.length) { const e = entries[i++]; await processFile(e.file, e.key, tenantId); } };
    await Promise.all([worker(), worker()]);
  }, [processFile, lojaUpload]);

  const updateCandidate = useCallback(async (id: string, patch: Partial<Candidate>) => {
    setItems((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
    const { error } = await supabase.from('hiring_candidates').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) { alert(`Não foi possível salvar: ${error.message}`); carregar(); return; }
    // Loja trocada: as entrevistas acompanham o candidato.
    if ('tenant_id' in patch) {
      await supabase.from('hiring_interviews').update({ tenant_id: patch.tenant_id ?? null }).eq('candidate_id', id);
      setInterviews((prev) => prev.map((iv) => (iv.candidate_id === id ? { ...iv, tenant_id: patch.tenant_id ?? null } : iv)));
    }
  }, [carregar]);

  // IA sob demanda: baixa o original do bucket e completa a ficha (mantém status/nota/anotações/loja).
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
    if (!confirm(`Excluir o currículo de ${c.full_name}? As entrevistas dele também são apagadas. Não dá para desfazer.`)) return;
    const { error } = await supabase.from('hiring_candidates').delete().eq('id', c.id);
    if (error) { alert(`Não foi possível excluir: ${error.message}`); return; }
    if (c.file_path) await supabase.storage.from(BUCKET).remove([c.file_path]);
    setItems((prev) => prev.filter((x) => x.id !== c.id));
    setInterviews((prev) => prev.filter((x) => x.candidate_id !== c.id));
    setSelId(null);
  }, []);

  // ── Filtros ──
  const doLoja = useCallback((tid: string | null) =>
    lojaFiltro === 'todas' || (lojaFiltro === 'sem' ? !tid : tid === lojaFiltro), [lojaFiltro]);

  const daLoja = useMemo(() => items.filter((c) => doLoja(c.tenant_id)), [items, doLoja]);

  const counts = useMemo(() => {
    const m: Record<string, number> = { todos: daLoja.length };
    for (const c of daLoja) m[c.status] = (m[c.status] ?? 0) + 1;
    return m;
  }, [daLoja]);

  const filtrados = useMemo(() => {
    const q = norm(busca).trim();
    return daLoja.filter((c) => {
      if (filtro !== 'todos' && c.status !== filtro) return false;
      if (soArea && c.food_service_experience !== true) return false;
      if (!q) return true;
      const hay = norm([c.full_name, c.desired_role, c.city, c.neighborhood, c.phone, c.email, c.skills.join(' '),
        c.experiences.map((e) => `${e.empresa} ${e.cargo}`).join(' '), c.raw_text ?? ''].join(' '));
      return q.split(/\s+/).every((t) => hay.includes(t));
    });
  }, [daLoja, busca, filtro, soArea]);

  const ivsDaLoja = useMemo(() => {
    const ids = new Set(daLoja.map((c) => c.id));
    return interviews.filter((iv) => ids.has(iv.candidate_id));
  }, [interviews, daLoja]);

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

  const sel = items.find((c) => c.id === selId) ?? null;
  const mostrarLoja = lojaFiltro === 'todas' && lojas.length > 1;

  const onInterviewSaved = (iv: Interview, candidatePatch?: { id: string; status: Status }) => {
    setInterviews((prev) => [...prev.filter((x) => x.id !== iv.id), iv].sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at)));
    if (candidatePatch) setItems((prev) => prev.map((c) => (c.id === candidatePatch.id ? { ...c, status: candidatePatch.status } : c)));
    setModal(null);
  };

  if (user && !isOwner) return <Navigate to="/modulos" replace />;

  const lendo = queue.filter((q) => q.state === 'lendo').length;

  return (
    <div className="max-w-6xl mx-auto">
      {/* Cabeçalho */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="w-10 h-10 flex items-center justify-center rounded-xl bg-rose-50 border border-rose-200">
          <i className="ri-user-search-line text-xl text-rose-600" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-black text-zinc-900">Contratação</h1>
          <p className="text-xs text-zinc-400">Currículos, entrevistas e relatórios por loja</p>
        </div>
        {lojas.length > 1 && (
          <select value={lojaFiltro} onChange={(e) => setLojaFiltro(e.target.value)}
            className="h-10 px-3 rounded-xl border border-zinc-200 text-sm font-semibold text-zinc-700 cursor-pointer">
            <option value="todas">Todas as lojas</option>
            {lojas.map((l) => <option key={l.id} value={l.id}>{l.nome}</option>)}
            <option value="sem">Sem loja</option>
          </select>
        )}
        <button onClick={() => fileRef.current?.click()}
          className="flex items-center gap-2 px-4 h-10 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-sm font-bold cursor-pointer whitespace-nowrap">
          <i className="ri-upload-2-line" /> Adicionar currículos
        </button>
        <input ref={fileRef} type="file" multiple accept="application/pdf,image/*" className="hidden"
          onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ''; }} />
      </div>

      {/* Abas */}
      <div className="flex gap-1 mb-4 border-b border-zinc-200">
        {([
          { id: 'candidatos', label: 'Candidatos', icon: 'ri-group-line' },
          { id: 'agenda', label: 'Agenda de entrevistas', icon: 'ri-calendar-2-line' },
          { id: 'relatorios', label: 'Relatórios', icon: 'ri-bar-chart-2-line' },
        ] as const).map((t) => (
          <button key={t.id} onClick={() => setAba(t.id)}
            className={`flex items-center gap-1.5 px-4 h-10 text-sm font-bold border-b-2 -mb-px cursor-pointer whitespace-nowrap ${
              aba === t.id ? 'border-rose-600 text-rose-700' : 'border-transparent text-zinc-500 hover:text-zinc-800'}`}>
            <i className={t.icon} /> {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="py-16 flex justify-center"><div className="w-7 h-7 border-2 border-rose-500 border-t-transparent rounded-full animate-spin" /></div>
      ) : loadError ? (
        <p className="py-10 text-center text-sm text-red-600">Erro ao carregar: {loadError}</p>
      ) : aba === 'agenda' ? (
        <AgendaEntrevistas interviews={ivsDaLoja} candidates={items} lojas={lojas} mostrarLoja={mostrarLoja}
          onOpenInterview={(iv) => setModal({ interview: iv })} onNew={(date) => setModal({ interview: null, date })} />
      ) : aba === 'relatorios' ? (
        <RelatoriosContratacao candidates={daLoja} interviews={interviews} lojas={lojas} mostrarLoja={mostrarLoja} onOpen={setSelId} />
      ) : (
        <>
          {/* Área de soltar */}
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files); }}
            className={`mb-4 rounded-2xl border-2 border-dashed px-4 py-4 flex flex-wrap items-center justify-center gap-3 transition-colors ${
              dragOver ? 'border-rose-400 bg-rose-50' : 'border-zinc-200 bg-zinc-50/60'}`}
          >
            <button onClick={() => fileRef.current?.click()} className="flex items-center gap-2 text-left cursor-pointer">
              <i className="ri-file-user-line text-2xl text-rose-400" />
              <span>
                <span className="block text-sm font-semibold text-zinc-700">Arraste PDFs ou fotos de currículos aqui</span>
                <span className="block text-xs text-zinc-400">Vários de uma vez. PDF com texto é lido de graça; foto vai para a IA.</span>
              </span>
            </button>
            {lojas.length > 0 && (
              <label className="flex items-center gap-2 text-xs font-semibold text-zinc-600">
                Salvar na loja
                <select value={lojaUpload} onChange={(e) => setLojaUpload(e.target.value)}
                  className="h-8 px-2 rounded-lg border border-zinc-200 text-xs bg-white cursor-pointer">
                  {lojas.map((l) => <option key={l.id} value={l.id}>{l.nome}</option>)}
                  <option value="">Sem loja</option>
                </select>
              </label>
            )}
          </div>

          {/* Fila de leitura */}
          {queue.length > 0 && (
            <div className="mb-4 rounded-2xl border border-zinc-200 bg-white overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2 border-b border-zinc-100">
                <p className="text-xs font-bold text-zinc-600">{lendo > 0 ? `Lendo ${lendo} currículo${lendo > 1 ? 's' : ''}…` : 'Leitura concluída'}</p>
                {lendo === 0 && <button onClick={() => setQueue([])} className="text-xs text-zinc-400 hover:text-zinc-700 cursor-pointer">Limpar</button>}
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
              <input value={busca} onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar por nome, cargo, cidade, empresa, palavra do currículo…"
                className="w-full h-10 pl-9 pr-3 rounded-xl border border-zinc-200 text-sm focus:outline-none focus:border-rose-300" />
            </div>
            <label className="flex items-center gap-2 px-3 h-10 rounded-xl border border-zinc-200 text-xs font-semibold text-zinc-600 cursor-pointer select-none">
              <input type="checkbox" checked={soArea} onChange={(e) => setSoArea(e.target.checked)} className="accent-rose-600" />
              Só com experiência em restaurante
            </label>
            <div className="flex rounded-xl border border-zinc-200 overflow-hidden">
              {([['cards', 'ri-layout-grid-line', 'Cards'], ['tabela', 'ri-table-line', 'Tabela']] as const).map(([v, icon, label]) => (
                <button key={v} onClick={() => setView(v)} title={label}
                  className={`px-3 h-10 text-sm cursor-pointer ${view === v ? 'bg-zinc-900 text-white' : 'bg-white text-zinc-500 hover:text-zinc-800'}`}>
                  <i className={icon} />
                </button>
              ))}
            </div>
          </div>
          <div className="flex gap-1.5 mb-4 overflow-x-auto pb-1">
            {[{ id: 'todos' as const, label: 'Todos' }, ...STATUS].map((s) => (
              <button key={s.id} onClick={() => setFiltro(s.id)}
                className={`px-3 h-8 rounded-full text-xs font-bold whitespace-nowrap border cursor-pointer transition-colors ${
                  filtro === s.id ? 'bg-zinc-900 text-white border-zinc-900' : 'bg-white text-zinc-600 border-zinc-200 hover:border-zinc-300'}`}>
                {s.label} <span className="opacity-60">{counts[s.id] ?? 0}</span>
              </button>
            ))}
          </div>

          {filtrados.length === 0 ? (
            <div className="py-16 text-center text-zinc-400">
              <i className="ri-inbox-line text-4xl" />
              <p className="text-sm font-semibold mt-2">{daLoja.length ? 'Nenhum candidato com esses filtros' : 'Nenhum currículo ainda'}</p>
            </div>
          ) : (
            <CandidatosLista view={view} items={filtrados} lojas={lojas} mostrarLoja={mostrarLoja}
              proximaEntrevista={proximaEntrevista} ultimaAvaliacao={ultimaAvaliacao} onOpen={setSelId} />
          )}
        </>
      )}

      {sel && (
        <CandidatoDrawer
          c={sel}
          lojas={lojas}
          interviews={interviews.filter((iv) => iv.candidate_id === sel.id)}
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
          lojas={lojas}
          presetCandidateId={modal.candidateId}
          presetDate={modal.date}
          onClose={() => setModal(null)}
          onSaved={onInterviewSaved}
          onDeleted={(id) => { setInterviews((prev) => prev.filter((x) => x.id !== id)); setModal(null); }}
        />
      )}
    </div>
  );
}
