// Ficha do candidato (reorganizada em 2026-09-30): cabeçalho com a decisão, as fases como botões
// (fases livres, clicar muda), o quadro "Próximo passo" com a ação que falta agora e 3 abas —
// Visão geral, Currículo e Linha do tempo (histórico, entrevistas e WhatsApp num lugar só).
// O corpo das abas mora em ficha/*; este shell mantém o estado do drawer inteiro (distância, abas).
import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import {
  type Application, type Candidate, type Company, type Decision, type Interview, type Job, type Stage,
  type Distance, type FichaCfg, type Settings,
  BUCKET, DECISIONS, fmtKm, whatsLink, stageOf, decisionOf, withEmpresa, ageOf, companyName, colorOf,
  avisoIdade,
} from '../shared';
import { melhorAderencia } from '../aderencia';
import { avisar } from '../dialog';
import type { SessaoIA } from '../areas/AreaFila';
import EditarCandidatoModal from './EditarCandidatoModal';
import FichaResumo from './ficha/FichaResumo';
import FichaCurriculo from './ficha/FichaCurriculo';
import FichaEntrevistas from './ficha/FichaEntrevistas';
import FichaConversa from './ficha/FichaConversa';
import FichaHistorico from './ficha/FichaHistorico';
import ProximoPasso from './ficha/ProximoPasso';

interface Props {
  c: Candidate;
  companies: Company[];
  stages: Stage[];
  ficha: FichaCfg;
  settings: Settings; // perguntas e critérios da entrevista (para mostrar o registro)
  interviews: Interview[];
  jobs: Job[];
  applications: Application[];
  /** Sessões do agendamento pela IA deste candidato, mais recente primeiro. */
  sessoes: SessaoIA[];
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
  /** Abre o modo entrevista (registro). */
  onAbrirEntrevista: (iv: Interview) => void;
  /** Abre a janela de data/hora da entrevista (remarcar, cancelar, excluir). */
  onRemarcar: (iv: Interview) => void;
  onSessaoAtualizada: () => void;
  /** Aba ao abrir (ex.: 'linha' quando vem de uma conversa da IA). */
  abaInicial?: Aba;
}

export type Aba = 'visao' | 'curriculo' | 'linha';
type Linha = 'tudo' | 'entrevistas' | 'whatsapp';

export default function CandidatoDrawer({
  c, companies, stages, ficha, settings, interviews, jobs, applications, sessoes, analyzing, onApply, onOpenJob, distances, onCalcDistances,
  onClose, onUpdate, onDelete, onOrganizar, onAgendar, onAbrirEntrevista, onRemarcar, onSessaoAtualizada, abaInicial,
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
  const [decisaoAberta, setDecisaoAberta] = useState(false);
  const [aba, setAba] = useState<Aba>(abaInicial ?? 'visao');
  const [linha, setLinha] = useState<Linha>(abaInicial === 'linha' ? 'whatsapp' : 'tudo');
  useEffect(() => {
    setEditarDados(false); setDecisaoAberta(false);
    setAba(abaInicial ?? 'visao'); setLinha(abaInicial === 'linha' ? 'whatsapp' : 'tudo');
  }, [c.id, abaInicial]);

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
  const faseAtual = stageOf(stages, c.stage_id);
  const aviso = avisoIdade(idade);

  const ABAS: { id: Aba; label: string; icon: string }[] = [
    { id: 'visao', label: 'Visão geral', icon: 'ri-file-user-line' },
    { id: 'curriculo', label: 'Currículo', icon: 'ri-file-text-line' },
    { id: 'linha', label: 'Linha do tempo', icon: 'ri-history-line' },
  ];

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-[56]" onClick={onClose} />
      <aside className="fixed inset-y-0 right-0 z-[57] w-full max-w-xl bg-white shadow-2xl flex flex-col">
        {/* Cabeçalho: nome, dados rápidos, decisão (clicável), WhatsApp */}
        <div className="flex items-start gap-3 px-5 pt-4 pb-3">
          <div className="w-11 h-11 rounded-full bg-rose-100 text-rose-700 font-black flex items-center justify-center flex-shrink-0">
            {(c.full_name || '?').charAt(0).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-black text-zinc-900 leading-tight">{c.full_name}</h2>
            <p className="text-xs text-zinc-500">
              {[
                c.desired_role,
                idade != null ? `${idade} anos` : null,
                c.neighborhood,
                dist ? fmtKm(dist.km) : null,
                aderencia ? `aderência ${aderencia.score}/100 · ${aderencia.jobTitle}` : null,
              ].filter(Boolean).join(' · ')}
            </p>
            {aviso && <span title={aviso.dica} className={`inline-block mt-1 text-[10px] font-bold px-2 py-0.5 rounded border ${aviso.cls}`}>{aviso.texto}</span>}
          </div>
          <div className="relative">
            <button onClick={() => setDecisaoAberta((v) => !v)} title={dec ? withEmpresa(dec.label, empresa) : 'Tomada de decisão'}
              className={`h-9 px-2.5 rounded-lg border text-xs font-black cursor-pointer ${dec ? dec.cls : 'border-dashed border-zinc-300 text-zinc-400 hover:text-zinc-700'}`}>
              {dec ? dec.sigla : 'Decisão'}
            </button>
            {decisaoAberta && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setDecisaoAberta(false)} />
                <div className="absolute right-0 mt-1 z-20 w-64 rounded-xl border border-zinc-200 bg-white shadow-2xl p-1.5">
                  {DECISIONS.map((d) => (
                    <button key={d.id} onClick={() => { onUpdate({ decision: c.decision === d.id ? null : (d.id as Decision) }); setDecisaoAberta(false); }}
                      className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left text-xs hover:bg-zinc-50 cursor-pointer ${c.decision === d.id ? 'bg-zinc-100' : ''}`}>
                      <span className={`font-black px-1.5 py-0.5 rounded border ${d.cls}`}>{d.sigla}</span>
                      <span className="text-zinc-700">{withEmpresa(d.label, empresa)}</span>
                    </button>
                  ))}
                  {c.decision && (
                    <button onClick={() => { onUpdate({ decision: null }); setDecisaoAberta(false); }} className="w-full px-2 py-1.5 text-left text-xs text-zinc-500 hover:bg-zinc-50 rounded-lg cursor-pointer">
                      Tirar a decisão
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
          {wa && (
            <a href={wa} target="_blank" rel="noopener noreferrer" title="WhatsApp"
              className="w-9 h-9 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 flex items-center justify-center">
              <i className="ri-whatsapp-line" />
            </a>
          )}
          <button onClick={onClose} className="w-9 h-9 flex items-center justify-center rounded-lg hover:bg-zinc-100 text-zinc-500 cursor-pointer">
            <i className="ri-close-line text-lg" />
          </button>
        </div>

        {/* Fases (livres): clicar move a pessoa */}
        <div className="px-5 pb-3">
          <div className="flex gap-1 overflow-x-auto pb-1">
            {stages.map((s) => {
              const on = faseAtual?.id === s.id;
              return (
                <button key={s.id} onClick={() => { if (!on) onUpdate({ stage_id: s.id }); }} title={on ? 'Fase atual' : `Mover para ${s.name}`}
                  className={`flex-shrink-0 px-2.5 h-7 rounded-full border text-[11px] font-bold whitespace-nowrap cursor-pointer ${
                    on ? `${colorOf(s.color).cls} ring-2 ring-offset-1 ring-zinc-300` : 'bg-white text-zinc-400 border-zinc-200 hover:text-zinc-700 hover:border-zinc-300'}`}>
                  {s.name}
                </button>
              );
            })}
          </div>
        </div>

        <div className="px-5 pb-3">
          <ProximoPasso c={c} stages={stages} interviews={interviews} sessoes={sessoes} empresa={empresa}
            onUpdate={onUpdate} onAbrirEntrevista={onAbrirEntrevista} onRemarcar={onRemarcar} onAgendar={onAgendar} onSessaoAtualizada={onSessaoAtualizada} />
        </div>

        {/* Abas */}
        <div className="flex gap-1 px-5 border-b border-zinc-200 overflow-x-auto">
          {ABAS.map((t) => (
            <button key={t.id} onClick={() => setAba(t.id)}
              className={`flex items-center gap-1.5 px-3 h-10 text-[13px] sm:text-sm font-bold border-b-2 -mb-px cursor-pointer whitespace-nowrap flex-shrink-0 ${
                aba === t.id ? 'border-rose-600 text-rose-700' : 'border-transparent text-zinc-500 hover:text-zinc-800'}`}>
              <i className={t.icon} /> {t.label}
            </button>
          ))}
        </div>

        <div className={aba === 'visao' ? 'flex-1 overflow-y-auto px-5 py-4 space-y-5' : 'hidden'}>
          <FichaResumo c={c} companies={companies} stages={stages} ficha={ficha} jobs={jobs} applications={applications}
            analyzing={analyzing} onApply={onApply} onOpenJob={onOpenJob} onUpdate={onUpdate} onOrganizar={onOrganizar} />
        </div>
        <div className={aba === 'curriculo' ? 'flex-1 overflow-y-auto px-5 py-4 space-y-5' : 'hidden'}>
          <div className="flex flex-wrap gap-2">
            {c.file_path && (
              <button onClick={abrirArquivo} className="flex items-center gap-1 px-3 h-8 rounded-lg border border-zinc-200 hover:bg-zinc-50 text-xs font-bold text-zinc-700 cursor-pointer">
                <i className="ri-file-text-line" /> Arquivo original
              </button>
            )}
            <button onClick={() => setEditarDados(true)} className="flex items-center gap-1 px-3 h-8 rounded-lg border border-zinc-200 hover:bg-zinc-50 text-xs font-bold text-zinc-700 cursor-pointer">
              <i className="ri-pencil-line" /> Editar dados
            </button>
          </div>
          <FichaCurriculo c={c} ficha={ficha} idade={idade} wa={wa} loja={loja} lojaTemPin={!!lojaTemPin} temEndereco={temEndereco}
            dist={dist} distBusy={distBusy} distErro={distErro} onCalcular={calcular} />
        </div>
        <div className={aba === 'linha' ? 'flex-1 overflow-y-auto px-5 py-4 space-y-4' : 'hidden'}>
          <div className="flex gap-1.5">
            {([['tudo', 'Tudo'], ['entrevistas', `Entrevistas${interviews.length ? ` (${interviews.length})` : ''}`], ['whatsapp', 'WhatsApp']] as const).map(([id, label]) => (
              <button key={id} onClick={() => setLinha(id)}
                className={`px-3 h-8 rounded-full border text-xs font-bold cursor-pointer ${linha === id ? 'bg-zinc-900 text-white border-zinc-900' : 'bg-white text-zinc-600 border-zinc-200 hover:border-zinc-300'}`}>
                {label}
              </button>
            ))}
          </div>
          <div className={linha === 'tudo' ? '' : 'hidden'}><FichaHistorico c={c} applications={applications} interviews={interviews} /></div>
          <div className={linha === 'entrevistas' ? '' : 'hidden'}>
            <FichaEntrevistas interviews={interviews} settings={settings} empresa={empresa}
              onAbrirEntrevista={onAbrirEntrevista} onRemarcar={onRemarcar} onAgendar={onAgendar} />
          </div>
          <div className={linha === 'whatsapp' ? '' : 'hidden'}><FichaConversa c={c} ativa={aba === 'linha' && linha === 'whatsapp'} /></div>
        </div>

        <div className="px-5 py-2 border-t border-zinc-100 flex items-center gap-3">
          <span className="text-[11px] text-zinc-400 truncate">{empresa || 'Sem empresa'}</span>
          <button onClick={onDelete} className="ml-auto flex items-center gap-1 text-xs font-semibold text-red-600 hover:bg-red-50 px-2 h-8 rounded-lg cursor-pointer">
            <i className="ri-delete-bin-line" /> Excluir
          </button>
        </div>
      </aside>
      {editarDados && <EditarCandidatoModal c={c} onClose={() => setEditarDados(false)} onSave={(patch) => onUpdate(patch)} />}
    </>
  );
}
