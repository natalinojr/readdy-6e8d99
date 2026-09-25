// Ficha do candidato: cabeçalho fixo, barra de ações e 5 abas (Resumo, Currículo, Entrevistas,
// Conversa, Histórico). O corpo de cada aba mora em ficha/* (T05) e ConversaWhatsApp (T04) —
// este shell só monta a árvore e mantém o estado que é do drawer inteiro (distância, upload).
import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import {
  type Application, type Candidate, type Company, type Interview, type Job, type Stage,
  type Distance, type FichaCfg, type Settings,
  BUCKET, fmtKm, whatsLink, stageOf, decisionOf, withEmpresa, ageOf, companyName,
  avisoIdade,
} from '../shared';
import { melhorAderencia } from '../aderencia';
import { avisar } from '../dialog';
import EditarCandidatoModal from './EditarCandidatoModal';
import FichaResumo from './ficha/FichaResumo';
import FichaCurriculo from './ficha/FichaCurriculo';
import FichaEntrevistas from './ficha/FichaEntrevistas';
import FichaConversa from './ficha/FichaConversa';
import FichaHistorico from './ficha/FichaHistorico';

interface Props {
  c: Candidate;
  companies: Company[];
  stages: Stage[];
  ficha: FichaCfg;
  settings: Settings; // perguntas e critérios da entrevista (para mostrar o registro)
  interviews: Interview[];
  jobs: Job[];
  applications: Application[];
  analyzing: Set<string>;
  onApply: (jobId: string) => void;
  onOpenJob: (jobId: string) => void;
  distances: Distance[];
  onCalcDistances: () => Promise<void>;
  onClose: () => void;
  onUpdate: (patch: Partial<Candidate>) => void;
  onDelete: () => void;
  onOrganizar: () => Promise<void>;
  onAgendar: () => void;
  onOpenInterview: (iv: Interview) => void;
}

type Aba = 'resumo' | 'curriculo' | 'entrevistas' | 'conversa' | 'historico';

export default function CandidatoDrawer({
  c, companies, stages, ficha, settings, interviews, jobs, applications, analyzing, onApply, onOpenJob, distances, onCalcDistances,
  onClose, onUpdate, onDelete, onOrganizar, onAgendar, onOpenInterview,
}: Props) {
  // Distância só até a loja escolhida na ficha (regra do dono). Calcula sozinha ao abrir quando a
  // loja tem pin, o candidato tem endereço e ainda não há distância (uma tentativa por abertura/loja).
  const [distBusy, setDistBusy] = useState(false);
  const [distErro, setDistErro] = useState<string | null>(null);
  const tentouDist = useRef<string | null>(null);
  const loja = companies.find((x) => x.id === c.company_id) ?? null;
  const lojaTemPin = loja?.lat != null && loja?.lng != null;
  const dist = distances.find((d) => d.company_id === c.company_id) ?? null;
  const temEndereco = !!(c.address || c.neighborhood || c.city || c.lat != null);
  const calcular = async () => {
    setDistBusy(true); setDistErro(null);
    try { await onCalcDistances(); } catch (e) { setDistErro((e as Error).message); } finally { setDistBusy(false); }
  };
  useEffect(() => {
    const chave = `${c.id}:${c.company_id ?? ''}`;
    if (tentouDist.current === chave) return;
    tentouDist.current = chave;
    if (!lojaTemPin || !temEndereco || dist || c.geo_precision === 'nao_encontrado') return;
    calcular();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c.id, c.company_id]);

  // WhatsApp de quem mandou pelo link primeiro (o telefone do currículo pode ser outro número).
  const wa = whatsLink(c.whatsapp || c.phone);
  const [editarDados, setEditarDados] = useState(false);
  useEffect(() => { setEditarDados(false); }, [c.id]);
  const [menuAberto, setMenuAberto] = useState(false);
  useEffect(() => { setMenuAberto(false); }, [c.id]);

  const [aba, setAba] = useState<Aba>('resumo');
  useEffect(() => setAba('resumo'), [c.id]);

  const abrirArquivo = async () => {
    if (!c.file_path) return;
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(c.file_path, 300);
    if (error || !data?.signedUrl) { avisar('Não foi possível abrir o arquivo do currículo.'); return; }
    window.open(data.signedUrl, '_blank', 'noopener');
  };

  const empresa = c.company_id ? companyName(companies, c.company_id) : '';
  const idade = ageOf(c);
  const dec = decisionOf(c.decision);
  const aderencia = melhorAderencia(applications, jobs);

  const ABAS: { id: Aba; label: string; icon: string }[] = [
    { id: 'resumo', label: 'Resumo', icon: 'ri-file-user-line' },
    { id: 'curriculo', label: 'Currículo', icon: 'ri-file-text-line' },
    { id: 'entrevistas', label: 'Entrevistas', icon: 'ri-calendar-event-line' },
    { id: 'conversa', label: 'Conversa', icon: 'ri-whatsapp-line' },
    { id: 'historico', label: 'Histórico', icon: 'ri-history-line' },
  ];

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />
      <aside className="fixed inset-y-0 right-0 z-50 w-full max-w-xl bg-white shadow-2xl flex flex-col">
        {/* Cabeçalho fixo: nome, idade, bairro, distância, melhor nota/vaga, decisão */}
        <div className="flex items-start gap-3 px-5 py-4 border-b border-zinc-100">
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-black text-zinc-900">{c.full_name}</h2>
            <p className="text-xs text-zinc-500">
              {[
                c.desired_role,
                idade != null ? `${idade} anos` : null,
                c.marital_status,
                c.neighborhood,
                dist ? fmtKm(dist.km) : null,
                aderencia ? `Aderência ${aderencia.score.toFixed(1).replace('.', ',')} · ${aderencia.jobTitle}` : null,
              ].filter(Boolean).join(' · ')}
            </p>
          </div>
          {(() => { const a = avisoIdade(idade); return a ? <span title={a.dica} className={`text-xs font-bold px-2 py-1 rounded-lg border ${a.cls}`}>{a.texto}</span> : null; })()}
          {dec && <span className={`text-xs font-black px-2.5 py-1 rounded-lg border ${dec.cls}`} title={withEmpresa(dec.label, empresa)}>{dec.sigla}</span>}
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-zinc-100 text-zinc-500 cursor-pointer">
            <i className="ri-close-line text-lg" />
          </button>
        </div>

        {/* Barra de ações: fase, WhatsApp, agendar pela IA, currículo original, editar dados, ⋯ */}
        <div className="flex flex-wrap items-center gap-2 px-5 py-2.5 border-b border-zinc-100">
          <select value={stageOf(stages, c.stage_id)?.id ?? ''} onChange={(e) => onUpdate({ stage_id: e.target.value })}
            className="h-9 px-3 rounded-lg border border-zinc-200 text-sm font-semibold cursor-pointer">
            {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>

          {wa && (
            <a href={wa} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-1 px-2.5 h-8 rounded-lg border border-zinc-200 hover:bg-zinc-50 text-xs font-bold text-zinc-700 cursor-pointer">
              <i className="ri-whatsapp-line" /> <span className="hidden sm:inline">WhatsApp</span>
            </a>
          )}

          <button onClick={() => setAba('resumo')}
            className="flex items-center gap-1 px-2.5 h-8 rounded-lg border border-zinc-200 hover:bg-zinc-50 text-xs font-bold text-zinc-700 cursor-pointer">
            <i className="ri-robot-2-line" /> <span className="hidden sm:inline">Agendamento pela IA</span>
          </button>

          {c.file_path && (
            <button onClick={abrirArquivo}
              className="flex items-center gap-1 px-2.5 h-8 rounded-lg border border-zinc-200 hover:bg-zinc-50 text-xs font-bold text-zinc-700 cursor-pointer">
              <i className="ri-file-text-line" /> <span className="hidden sm:inline">Ver currículo original</span>
            </button>
          )}

          <button onClick={() => setEditarDados(true)} title="Editar dados do candidato"
            className="flex items-center gap-1 px-2.5 h-8 rounded-lg border border-zinc-200 hover:bg-zinc-50 text-xs font-bold text-zinc-700 cursor-pointer">
            <i className="ri-pencil-line" /> <span className="hidden sm:inline">Editar dados</span>
          </button>

          <div className="relative">
            <button onClick={() => setMenuAberto((v) => !v)} title="Mais ações"
              className="w-8 h-8 flex items-center justify-center rounded-lg border border-zinc-200 hover:bg-zinc-50 text-zinc-600 cursor-pointer">
              <i className="ri-more-2-fill" />
            </button>
            {menuAberto && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setMenuAberto(false)} />
                <div className="absolute right-0 mt-1 z-20 rounded-lg border border-zinc-200 bg-white shadow-2xl overflow-hidden">
                  <button onClick={() => { setMenuAberto(false); onDelete(); }}
                    className="flex items-center gap-1.5 px-3 h-9 w-full text-left text-sm font-semibold text-red-600 hover:bg-red-50 cursor-pointer whitespace-nowrap">
                    <i className="ri-delete-bin-line" /> Excluir
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Abas */}
        <div className="flex gap-1 px-5 border-b border-zinc-200 overflow-x-auto">
          {ABAS.map((t) => (
            <button key={t.id} onClick={() => setAba(t.id)}
              className={`flex items-center gap-1.5 px-3 sm:px-4 h-10 text-[13px] sm:text-sm font-bold border-b-2 -mb-px cursor-pointer whitespace-nowrap flex-shrink-0 ${
                aba === t.id ? 'border-rose-600 text-rose-700' : 'border-transparent text-zinc-500 hover:text-zinc-800'}`}>
              <i className={t.icon} /> {t.label}
            </button>
          ))}
        </div>

        <div className={aba === 'resumo' ? 'flex-1 overflow-y-auto px-5 py-4 space-y-5' : 'hidden'}>
          <FichaResumo c={c} companies={companies} stages={stages} ficha={ficha} jobs={jobs} applications={applications}
            analyzing={analyzing} empresa={empresa} onApply={onApply} onOpenJob={onOpenJob} onUpdate={onUpdate} onOrganizar={onOrganizar} />
        </div>
        <div className={aba === 'curriculo' ? 'flex-1 overflow-y-auto px-5 py-4 space-y-5' : 'hidden'}>
          <FichaCurriculo c={c} ficha={ficha} idade={idade} wa={wa} loja={loja} lojaTemPin={!!lojaTemPin} temEndereco={temEndereco}
            dist={dist} distBusy={distBusy} distErro={distErro} onCalcular={calcular} />
        </div>
        <div className={aba === 'entrevistas' ? 'flex-1 overflow-y-auto px-5 py-4 space-y-5' : 'hidden'}>
          <FichaEntrevistas interviews={interviews} settings={settings} empresa={empresa} onOpenInterview={onOpenInterview} onAgendar={onAgendar} />
        </div>
        <div className={aba === 'conversa' ? 'flex-1 overflow-y-auto px-5 py-4 space-y-5' : 'hidden'}>
          <FichaConversa c={c} ativa={aba === 'conversa'} />
        </div>
        <div className={aba === 'historico' ? 'flex-1 overflow-y-auto px-5 py-4 space-y-5' : 'hidden'}>
          <FichaHistorico c={c} applications={applications} interviews={interviews} />
        </div>
      </aside>
      {editarDados && <EditarCandidatoModal c={c} onClose={() => setEditarDados(false)} onSave={(patch) => onUpdate(patch)} />}
    </>
  );
}
