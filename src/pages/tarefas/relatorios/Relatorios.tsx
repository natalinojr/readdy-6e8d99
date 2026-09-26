/**
 * Relatórios compartilháveis (Tarefas) — aba "Relatórios" de uma pasta.
 * Monta o relatório (itens com texto, imagens e campos de resposta), manda o
 * link para quem está fora do sistema e acompanha as respostas, cada uma com
 * nome e horário. O relatório é da pasta aberta e vale para quem divide a pasta;
 * dá para mudar de pasta depois e ligar tarefas a ele.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ArrowLeft, Plus, Link2, Copy, MessageCircle, RefreshCw, Loader2, Trash2, Pencil, ChevronUp, ChevronDown,
  Lock, Unlock, Users, FileText, Check, Folder, ListTodo, X, CheckCircle2, Circle, Search, LayoutTemplate,
  MoreHorizontal, Clock, MessagesSquare, Archive, RotateCcw, Sparkles, CornerDownRight, EyeOff,
} from 'lucide-react';
import { useToast } from '@/contexts/ToastContext';
import ConfirmDialog from '../components/ConfirmDialog';
import type { TaskRow } from '../hooks/useTarefas';
import ItemRelatorio, { FormItem, NovoItem } from './ItemRelatorio';
import LinksRelatorio from './LinksRelatorio';
import { descreverCondicao, itensVisiveis } from './condicaoItem';
import {
  chamarDono, enviarImagemDono, linkPublico,
  podeEditar, podeExcluir,
  type ImagemRel, type ItemRel, type ModeloRel, type RelatorioCompleto, type ResumoRelatorio,
} from './api';
import { useVoltarFecha } from '@/lib/voltarAndroid';

/** Pasta de Tarefas (o suficiente para escolher onde o relatório fica). */
export interface PastaRel { id: string; name: string; color: string; access?: 'owner' | 'edit' | 'view' }

/** Pastas onde posso pôr relatório: as minhas e as compartilhadas comigo com 'pode editar'. */
const pastasPermitidas = (pastas: PastaRel[]) => pastas.filter((p) => (p.access ?? 'owner') !== 'view');

// ─── Peças visuais ────────────────────────────────────────────────────────────

/** "há 5 min", "há 3 h", "ontem", "12/09". */
function tempoRelativo(iso: string): string {
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `há ${h} h`;
  if (h < 48) return 'ontem';
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

/** Barra de progresso em três partes: resolvido, respondido, aguardando. */
function BarraProgresso({ resolvidos, respondidos, total, alta = false }: { resolvidos: number; respondidos: number; total: number; alta?: boolean }) {
  const pct = (n: number) => (total ? (n / total) * 100 : 0);
  return (
    <div className={`w-full ${alta ? 'h-2' : 'h-1.5'} rounded-full bg-amber-100 overflow-hidden flex`} title={`${resolvidos} resolvidos · ${respondidos} respondidos · ${total - resolvidos - respondidos} aguardando`}>
      <div className="h-full bg-emerald-500 transition-all" style={{ width: `${pct(resolvidos)}%` }} />
      <div className="h-full bg-sky-400 transition-all" style={{ width: `${pct(respondidos)}%` }} />
    </div>
  );
}

function Legenda({ cor, n, rotulo }: { cor: string; n: number; rotulo: string }) {
  return (
    <span className="flex items-center gap-1.5 text-xs text-slate-500">
      <span className={`w-2 h-2 rounded-full ${cor}`} />
      <strong className="font-semibold text-slate-700">{n}</strong> {rotulo}
    </span>
  );
}

/** Cartão da coluna lateral do relatório. */
function Painel({ icone, titulo, acao, children }: { icone: ReactNode; titulo: string; acao?: ReactNode; children: ReactNode }) {
  return (
    <section className="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-4">
      <div className="flex items-center gap-2 mb-2.5">
        <span className="w-7 h-7 rounded-lg bg-slate-100 text-slate-500 flex items-center justify-center shrink-0">{icone}</span>
        <h2 className="text-sm font-semibold text-slate-700 flex-1 min-w-0 truncate">{titulo}</h2>
        {acao}
      </div>
      {children}
    </section>
  );
}

/** Menu "⋯" com as ações menos usadas. Fecha ao clicar fora. */
function MenuAcoes({ itens }: { itens: Array<{ icone: ReactNode; rotulo: string; onClick: () => void; perigo?: boolean } | null> }) {
  const [aberto, setAberto] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setAberto(false); };
    document.addEventListener('mousedown', fora);
    return () => document.removeEventListener('mousedown', fora);
  }, [aberto]);
  const visiveis = itens.filter((i): i is NonNullable<typeof i> => !!i);
  if (!visiveis.length) return null;
  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setAberto((v) => !v)}
        className="w-9 h-9 rounded-xl border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 flex items-center justify-center"
        title="Mais ações"
      >
        <MoreHorizontal size={18} />
      </button>
      {aberto && (
        <div className="absolute left-0 sm:left-auto sm:right-0 top-11 z-30 w-56 rounded-xl border border-slate-200 bg-white shadow-lg py-1.5">
          {visiveis.map((i) => (
            <button
              key={i.rotulo}
              onClick={() => { setAberto(false); i.onClick(); }}
              className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left hover:bg-slate-50 ${i.perigo ? 'text-red-600' : 'text-slate-700'}`}
            >
              <span className={i.perigo ? 'text-red-500' : 'text-slate-400'}>{i.icone}</span>
              {i.rotulo}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Lista de relatórios da pasta ─────────────────────────────────────────────

interface Props {
  /** Pasta aberta em Tarefas: a lista mostra os relatórios dela e o novo nasce nela. */
  pasta: PastaRel;
  /** Abre direto num relatório (ex.: clique no push → /tarefas?relatorio=<id>). */
  abrirId?: string | null;
  /** Pastas que eu vejo (para mudar o relatório de pasta). */
  pastas: PastaRel[];
  meuId: string | null;
  /** Tarefas que eu vejo — para ligar ao relatório. */
  tarefas: TaskRow[];
  onOpenTask: (taskId: string) => void;
}

/** Topo do item condicional na tela da equipe: de qual item ele depende e se está aparecendo para quem responde. */
function FaixaItemCondicional({ item, itens, visiveis }: { item: ItemRel; itens: ItemRel[]; visiveis: Set<string> }) {
  const c = descreverCondicao(item, itens);
  if (!c) return null;
  const aparece = visiveis.has(item.id);
  return (
    <div className="px-4 py-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs bg-indigo-50 text-slate-600 border-b border-indigo-100">
      <CornerDownRight size={13} className="text-indigo-500 shrink-0" />
      <span>Aparece só se no item</span>
      <strong className="font-medium text-indigo-800">{c.numero} · {c.titulo}</strong>
      <span>a pergunta</span>
      <strong className="font-medium text-indigo-800">{c.pergunta}</strong>
      <span>for</span>
      <strong className="font-medium text-indigo-800">{c.respostas}</strong>
      {!aparece && (
        <span className="ml-auto flex items-center gap-1 text-slate-400" title="Com as respostas de agora, quem abre o link não vê este item">
          <EyeOff size={12} /> escondido agora
        </span>
      )}
    </div>
  );
}

export default function Relatorios({ pasta, abrirId, pastas, meuId, tarefas, onOpenTask }: Props) {
  const toast = useToast();
  const [lista, setLista] = useState<ResumoRelatorio[] | null>(null);
  const [selecionado, setSelecionado] = useState<string | null>(abrirId ?? null);
  const [criando, setCriando] = useState(false);
  const [novoTitulo, setNovoTitulo] = useState('');
  const [modelos, setModelos] = useState<ModeloRel[] | null>(null);
  const [modeloId, setModeloId] = useState('');
  const [gerenciandoModelos, setGerenciandoModelos] = useState(false);
  const [excluindoModelo, setExcluindoModelo] = useState<ModeloRel | null>(null);
  const podeCriar = (pasta.access ?? 'owner') !== 'view';

  const carregarLista = useCallback(async () => {
    const r = await chamarDono<{ reports: ResumoRelatorio[] }>('list');
    if (!r.ok) { toast.error('Erro ao carregar relatórios', r.error); setLista([]); return; }
    setLista(r.data.reports);
  }, [toast]);

  useEffect(() => { carregarLista(); }, [carregarLista]);

  const carregarModelos = useCallback(async () => {
    const r = await chamarDono<{ templates: ModeloRel[] }>('list_templates');
    setModelos(r.ok ? r.data.templates : []);
  }, []);
  useEffect(() => { if (criando || gerenciandoModelos) carregarModelos(); }, [criando, gerenciandoModelos, carregarModelos]);
  useEffect(() => { setSelecionado(abrirId ?? null); }, [abrirId, pasta.id]);

  const daPasta = useMemo(() => (lista ?? []).filter((r) => r.list_id === pasta.id), [lista, pasta.id]);

  const criar = async () => {
    if (!novoTitulo.trim()) return;
    const r = await chamarDono<{ id: string }>('create', { title: novoTitulo.trim(), list_id: pasta.id, template_id: modeloId || null });
    if (!r.ok) { toast.error('Erro ao criar relatório', r.error); return; }
    setNovoTitulo('');
    setModeloId('');
    setCriando(false);
    setSelecionado(r.data.id);
    carregarLista();
  };

  const voltar = useCallback(() => { setSelecionado(null); carregarLista(); }, [carregarLista]);
  // Relatório aberto é uma camada: o voltar volta para a lista de relatórios.
  useVoltarFecha(!!selecionado, voltar, 'relatorio-aberto');

  if (selecionado) {
    return (
      <DetalheRelatorio
        id={selecionado}
        pastas={pastas}
        meuId={meuId}
        tarefas={tarefas}
        onOpenTask={onOpenTask}
        onVoltar={voltar}
      />
    );
  }

  return (
    <div className="max-w-5xl">
      {/* Cabeçalho */}
      <div className="flex flex-wrap items-end gap-3 mb-5">
        <div className="flex-1 min-w-[220px]">
          <h2 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
            Relatórios
            {daPasta.length > 0 && <span className="text-xs font-medium text-slate-500 bg-slate-200/70 rounded-full px-2 py-0.5">{daPasta.length}</span>}
          </h2>
          <p className="text-sm text-slate-500 mt-0.5">Pontos para quem está fora do sistema responder pelo link — cada resposta fica com nome e horário.</p>
        </div>
        {podeCriar && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => setGerenciandoModelos((v) => !v)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm border transition ${gerenciandoModelos ? 'bg-indigo-50 border-indigo-200 text-indigo-700' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}`}
            >
              <LayoutTemplate size={15} /> Modelos
            </button>
            <button
              onClick={() => setCriando(true)}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-sm font-medium bg-indigo-600 text-white shadow-sm shadow-indigo-200 hover:bg-indigo-700"
            >
              <Plus size={16} /> Novo relatório
            </button>
          </div>
        )}
      </div>

      {/* Novo relatório */}
      {criando && (
        <div className="bg-white rounded-2xl border border-indigo-200 shadow-sm p-4 mb-4">
          <p className="text-sm font-semibold text-slate-700 mb-2.5 flex items-center gap-2"><Sparkles size={15} className="text-indigo-500" /> Novo relatório em {pasta.name}</p>
          <div className="flex flex-wrap gap-2">
            <input
              value={novoTitulo}
              onChange={(e) => setNovoTitulo(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') criar(); if (e.key === 'Escape') setCriando(false); }}
              autoFocus
              maxLength={200}
              placeholder="Ex.: Vistoria da obra — pendências do empreiteiro"
              className="flex-1 min-w-[220px] rounded-xl border border-slate-200 px-3 py-2.5 text-base md:text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200"
            />
            <select
              value={modeloId}
              onChange={(e) => {
                setModeloId(e.target.value);
                const m = modelos?.find((x) => x.id === e.target.value);
                if (m && !novoTitulo.trim()) setNovoTitulo(m.name);
              }}
              className="rounded-xl border border-slate-200 px-3 py-2.5 text-base md:text-sm bg-white"
              title="Começar com os itens, campos e links de um modelo"
            >
              <option value="">Em branco</option>
              {(modelos ?? []).map((m) => <option key={m.id} value={m.id}>Modelo: {m.name}</option>)}
            </select>
          </div>
          <div className="flex justify-end gap-2 mt-3">
            <button onClick={() => setCriando(false)} className="px-3 py-2 rounded-xl text-sm text-slate-500 hover:bg-slate-100">Cancelar</button>
            <button onClick={criar} disabled={!novoTitulo.trim()} className="px-4 py-2 rounded-xl text-sm font-medium bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50">Criar relatório</button>
          </div>
        </div>
      )}

      {/* Modelos */}
      {gerenciandoModelos && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 mb-4">
          <p className="text-sm font-semibold text-slate-700">Meus modelos</p>
          <p className="text-xs text-slate-400 mb-2">Para criar um modelo, abra um relatório e use "Salvar como modelo". São só seus e valem para qualquer pasta.</p>
          {modelos === null && <Loader2 size={15} className="animate-spin text-slate-300" />}
          {modelos?.length === 0 && <p className="text-sm text-slate-400 py-2">Nenhum modelo ainda.</p>}
          <div className="grid sm:grid-cols-2 gap-2">
            {(modelos ?? []).map((m) => (
              <div key={m.id} className="flex items-center gap-2.5 rounded-xl border border-slate-200 px-3 py-2">
                <span className="w-8 h-8 rounded-lg bg-violet-50 text-violet-500 flex items-center justify-center shrink-0"><LayoutTemplate size={15} /></span>
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-medium text-slate-700 truncate">{m.name}</span>
                  <span className="block text-xs text-slate-400">{m.items_total} {m.items_total === 1 ? 'item' : 'itens'}{m.links_total ? ` · ${m.links_total} link${m.links_total > 1 ? 's' : ''}` : ''}</span>
                </span>
                <button onClick={() => setExcluindoModelo(m)} className="p-1.5 rounded-lg text-slate-300 hover:text-red-500 hover:bg-red-50" title="Excluir modelo"><Trash2 size={14} /></button>
              </div>
            ))}
          </div>
        </div>
      )}
      {excluindoModelo && (
        <ConfirmDialog
          titulo="Excluir modelo?"
          descricao={`"${excluindoModelo.name}" sai da lista. Os relatórios criados com ele continuam iguais.`}
          textoConfirmar="Excluir"
          perigo
          onCancelar={() => setExcluindoModelo(null)}
          onConfirmar={async () => {
            const m = excluindoModelo;
            setExcluindoModelo(null);
            const r = await chamarDono('delete_template', { template_id: m.id });
            if (!r.ok) { toast.error('Não foi possível excluir', r.error); return; }
            carregarModelos();
          }}
        />
      )}

      {/* Lista */}
      {lista === null && (
        <div className="grid md:grid-cols-2 gap-3">
          {[0, 1].map((i) => <div key={i} className="h-36 rounded-2xl bg-white border border-slate-200 animate-pulse" />)}
        </div>
      )}
      {lista !== null && daPasta.length === 0 && !criando && (
        <div className="bg-white rounded-2xl border border-dashed border-slate-300 py-12 px-6 text-center">
          <span className="mx-auto w-14 h-14 rounded-2xl bg-indigo-50 text-indigo-500 flex items-center justify-center"><FileText size={26} /></span>
          <p className="mt-3 font-medium text-slate-700">Nenhum relatório em {pasta.name}</p>
          <p className="text-sm text-slate-500 mt-1 max-w-md mx-auto">Liste os pontos (com fotos e perguntas), mande o link e acompanhe as respostas de quem está fora — fornecedor, empreiteiro, cliente.</p>
          {podeCriar && (
            <button onClick={() => setCriando(true)} className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium bg-indigo-600 text-white hover:bg-indigo-700">
              <Plus size={16} /> Criar o primeiro
            </button>
          )}
        </div>
      )}
      <div className="grid md:grid-cols-2 gap-3">
        {daPasta.map((r) => {
          const respondidos = Math.max(0, r.items_total - r.items_open - r.items_resolved);
          return (
            <button
              key={r.id}
              onClick={() => setSelecionado(r.id)}
              className="group text-left bg-white rounded-2xl border border-slate-200/80 shadow-sm p-4 hover:border-indigo-300 hover:shadow-md transition flex flex-col"
            >
              <div className="flex items-start gap-3">
                <span className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${r.status === 'closed' ? 'bg-slate-100 text-slate-400' : 'bg-indigo-50 text-indigo-500'}`}>
                  <FileText size={19} />
                </span>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-slate-800 leading-snug line-clamp-2 group-hover:text-indigo-700">{r.title}</p>
                  <p className="text-xs text-slate-400 mt-0.5 flex items-center gap-1.5 flex-wrap">
                    {r.access !== 'creator' && <span>de {r.owner_name ?? 'outra pessoa'}{r.access === 'view' ? ' · só ver e responder' : ''}</span>}
                    {r.status === 'closed' && <span className="px-1.5 py-px rounded-full bg-slate-100 text-slate-500">encerrado</span>}
                    {r.status === 'open' && !r.link_enabled && <span className="px-1.5 py-px rounded-full bg-slate-100 text-slate-500">link desligado</span>}
                  </p>
                </div>
                {r.unseen > 0 && (
                  <span className="shrink-0 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-indigo-600 text-white">
                    {r.unseen} nova{r.unseen === 1 ? '' : 's'}
                  </span>
                )}
              </div>
              <div className="mt-4">
                <div className="flex items-baseline justify-between mb-1.5">
                  <span className="text-xs text-slate-500">
                    {r.items_total === 0 ? 'Sem itens ainda' : <><strong className="font-semibold text-slate-700">{r.items_resolved}</strong> de {r.items_total} resolvido{r.items_total === 1 ? '' : 's'}</>}
                  </span>
                  {r.items_open > 0 && <span className="text-[11px] text-amber-700">{r.items_open} aguardando</span>}
                </div>
                <BarraProgresso resolvidos={r.items_resolved} respondidos={respondidos} total={r.items_total} />
              </div>
              <div className="mt-3 pt-3 border-t border-slate-100 flex items-center gap-4 text-xs text-slate-400">
                <span className="flex items-center gap-1"><MessagesSquare size={13} /> {r.guest_responses} resposta{r.guest_responses === 1 ? '' : 's'} de fora</span>
                <span className="flex items-center gap-1 ml-auto"><Clock size={13} /> {tempoRelativo(r.updated_at)}</span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Um relatório ─────────────────────────────────────────────────────────────

function DetalheRelatorio({ id, onVoltar, pastas, meuId, tarefas, onOpenTask }: {
  id: string;
  onVoltar: () => void;
  pastas: PastaRel[];
  meuId: string | null;
  tarefas: TaskRow[];
  onOpenTask: (taskId: string) => void;
}) {
  const toast = useToast();
  const [dados, setDados] = useState<RelatorioCompleto | null>(null);
  const [editandoCabecalho, setEditandoCabecalho] = useState(false);
  const [titulo, setTitulo] = useState('');
  const [descricao, setDescricao] = useState('');
  const [editandoItem, setEditandoItem] = useState<string | null>(null);
  const [excluindoItem, setExcluindoItem] = useState<ItemRel | null>(null);
  const [excluindoRelatorio, setExcluindoRelatorio] = useState(false);
  const [trocandoLink, setTrocandoLink] = useState(false);
  const [copiado, setCopiado] = useState(false);
  const [nomeModelo, setNomeModelo] = useState<string | null>(null);

  const carregar = useCallback(async (marcarVisto = false) => {
    const r = await chamarDono<RelatorioCompleto>('get', { report_id: id, mark_seen: marcarVisto });
    if (!r.ok) { toast.error('Erro ao abrir relatório', r.error); onVoltar(); return; }
    setDados(r.data);
  }, [id, toast, onVoltar]);

  useEffect(() => { carregar(true); }, [carregar]);
  useEffect(() => {
    const f = () => { if (document.visibilityState === 'visible') carregar(true); };
    document.addEventListener('visibilitychange', f);
    return () => document.removeEventListener('visibilitychange', f);
  }, [carregar]);

  const acao = async (action: string, payload: Record<string, unknown> = {}, ok?: string) => {
    const r = await chamarDono(action, { report_id: id, ...payload });
    if (!r.ok) { toast.error('Não foi possível salvar', r.error); return false; }
    if (ok) toast.success(ok);
    await carregar();
    return true;
  };

  const enviarImagem = async (f: File): Promise<ImagemRel | null> => {
    const r = await enviarImagemDono(id, f);
    if (!r.ok) { toast.error('Erro ao enviar imagem', r.error); return null; }
    return r.data;
  };

  if (!dados) {
    return (
      <div className="max-w-6xl space-y-3">
        <div className="h-40 rounded-2xl bg-white border border-slate-200 animate-pulse" />
        <div className="h-64 rounded-2xl bg-white border border-slate-200 animate-pulse" />
      </div>
    );
  }

  const { report, items, guests } = dados;
  const visiveis = itensVisiveis(items);
  const link = report.share_token ? linkPublico(report.share_token, report.title) : '';
  const aberto = report.status === 'open';
  // O que dá pra mexer depende do acesso: quem só vê a pasta lê e responde.
  const edita = podeEditar(report.access);
  const exclui = podeExcluir(report.access);
  const criador = report.access === 'creator';
  const pastaAtual = pastas.find((p) => p.id === report.list_id);
  const opcoesPasta = pastasPermitidas(pastas);
  if (report.list_id && !opcoesPasta.some((p) => p.id === report.list_id)) {
    opcoesPasta.push({ id: report.list_id, name: pastaAtual?.name ?? 'Pasta atual', color: '' });
  }
  const resolvidos = items.filter((i) => i.status === 'resolved').length;
  const respondidos = items.filter((i) => i.status === 'answered').length;
  const aguardando = items.length - resolvidos - respondidos;

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopiado(true);
      window.setTimeout(() => setCopiado(false), 2000);
    } catch {
      toast.error('Não consegui copiar', link);
    }
  };
  const whatsapp = () => {
    const txt = `${report.title}\nPor favor, responda os itens por este link:\n${link}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(txt)}`, '_blank', 'noopener');
  };

  const mover = (i: number, dir: -1 | 1) => {
    const alvo = items[i + dir];
    if (!alvo) return;
    // Troca de posição com o vizinho; o depois do vizinho fica no meio para não empatar.
    const vizinho2 = items[i + dir * 2];
    const nova = vizinho2 ? (alvo.position + vizinho2.position) / 2 : alvo.position + dir;
    acao('update_item', { item_id: items[i].id, position: nova });
  };

  return (
    <div className="max-w-6xl">
      <button onClick={onVoltar} className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-indigo-600 mb-3">
        <ArrowLeft size={15} /> Relatórios{pastaAtual ? ` de ${pastaAtual.name}` : ''}
      </button>

      {/* ── Cabeçalho ── */}
      <section className="relative bg-white rounded-2xl border border-slate-200/80 shadow-sm">
        <div className={`h-1.5 rounded-t-2xl ${aberto ? 'bg-gradient-to-r from-indigo-500 via-violet-500 to-sky-400' : 'bg-slate-300'}`} />
        <div className="p-5">
          {editandoCabecalho ? (
            <div className="space-y-2">
              <input
                value={titulo}
                onChange={(e) => setTitulo(e.target.value)}
                maxLength={200}
                autoFocus
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-lg font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-200"
              />
              <textarea
                value={descricao}
                onChange={(e) => setDescricao(e.target.value)}
                rows={3}
                maxLength={5000}
                placeholder="Explicação para quem vai responder (opcional)"
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-base md:text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200"
              />
              <div className="flex justify-end gap-2">
                <button onClick={() => setEditandoCabecalho(false)} className="px-3 py-1.5 rounded-xl text-sm text-slate-500 hover:bg-slate-100">Cancelar</button>
                <button
                  disabled={!titulo.trim()}
                  onClick={async () => { if (await acao('update', { title: titulo, description: descricao })) setEditandoCabecalho(false); }}
                  className="px-4 py-1.5 rounded-xl text-sm font-medium bg-indigo-600 text-white disabled:opacity-50"
                >
                  Salvar
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-start gap-3">
              <div className="flex-1 min-w-[240px]">
                <div className="flex flex-wrap items-center gap-2 mb-1.5">
                  <span className={`text-[11px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full ${aberto ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                    {aberto ? 'Recebendo respostas' : 'Encerrado'}
                  </span>
                  {!report.link_enabled && <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-amber-50 text-amber-700">link desligado</span>}
                  {!criador && (
                    <span className="text-xs text-slate-400">
                      criado por {report.owner_name ?? 'outra pessoa'}{report.access === 'view' ? ' · você pode ver e responder' : ''}
                    </span>
                  )}
                </div>
                <h1 className="text-xl md:text-2xl font-semibold text-slate-800 break-words leading-tight">{report.title}</h1>
                {report.description
                  ? <p className="text-sm text-slate-600 whitespace-pre-wrap mt-1.5 break-words">{report.description}</p>
                  : edita && <p className="text-sm text-slate-400 mt-1.5">Sem explicação para quem vai responder.</p>}
              </div>
              <div className="flex items-center gap-2">
                {report.link_enabled && (
                  <>
                    <button
                      onClick={whatsapp}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm shadow-emerald-100"
                    >
                      <MessageCircle size={16} /> <span className="hidden sm:inline">WhatsApp</span>
                    </button>
                    <button
                      onClick={copiar}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                    >
                      {copiado ? <Check size={16} className="text-emerald-600" /> : <Copy size={16} />} <span className="hidden sm:inline">{copiado ? 'Copiado' : 'Copiar link'}</span>
                    </button>
                  </>
                )}
                <MenuAcoes itens={[
                  edita ? { icone: <Pencil size={15} />, rotulo: 'Editar título e explicação', onClick: () => { setTitulo(report.title); setDescricao(report.description ?? ''); setEditandoCabecalho(true); } } : null,
                  { icone: <LayoutTemplate size={15} />, rotulo: 'Salvar como modelo', onClick: () => setNomeModelo(report.title) },
                  edita && aberto ? { icone: <Archive size={15} />, rotulo: 'Encerrar relatório', onClick: () => acao('update', { status: 'closed' }, 'Relatório encerrado') } : null,
                  edita && !aberto ? { icone: <RotateCcw size={15} />, rotulo: 'Reabrir relatório', onClick: () => acao('update', { status: 'open' }, 'Relatório reaberto') } : null,
                  exclui ? { icone: <Trash2 size={15} />, rotulo: 'Excluir relatório', onClick: () => setExcluindoRelatorio(true), perigo: true } : null,
                ]} />
              </div>
            </div>
          )}

          {nomeModelo !== null && (
            <div className="mt-4 flex flex-wrap items-center gap-2 rounded-xl bg-violet-50/70 border border-violet-100 p-3">
              <LayoutTemplate size={16} className="text-violet-500" />
              <input
                value={nomeModelo}
                onChange={(e) => setNomeModelo(e.target.value)}
                autoFocus
                maxLength={200}
                placeholder="Nome do modelo"
                className="flex-1 min-w-[200px] rounded-lg border border-violet-200 bg-white px-3 py-1.5 text-base md:text-sm"
              />
              <button onClick={() => setNomeModelo(null)} className="px-3 py-1.5 rounded-lg text-sm text-slate-500 hover:bg-white">Cancelar</button>
              <button
                disabled={!nomeModelo.trim()}
                onClick={async () => {
                  const r = await chamarDono('save_template', { report_id: id, name: nomeModelo.trim() });
                  if (!r.ok) { toast.error('Não foi possível salvar o modelo', r.error); return; }
                  toast.success('Modelo salvo', 'Use em "Novo relatório" de qualquer pasta.');
                  setNomeModelo(null);
                }}
                className="px-4 py-1.5 rounded-lg text-sm font-medium bg-violet-600 text-white disabled:opacity-50"
              >
                Salvar modelo
              </button>
            </div>
          )}

          {/* Progresso */}
          {items.length > 0 && (
            <div className="mt-5">
              <BarraProgresso resolvidos={resolvidos} respondidos={respondidos} total={items.length} alta />
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                <Legenda cor="bg-emerald-500" n={resolvidos} rotulo={resolvidos === 1 ? 'resolvido' : 'resolvidos'} />
                <Legenda cor="bg-sky-400" n={respondidos} rotulo={respondidos === 1 ? 'respondido' : 'respondidos'} />
                <Legenda cor="bg-amber-300" n={aguardando} rotulo="aguardando" />
              </div>
            </div>
          )}
        </div>
      </section>

      {/* ── Itens + coluna lateral ── */}
      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px] items-start">
        <div className="space-y-3 min-w-0">
          <div className="flex items-center gap-2 px-1">
            <h2 className="text-sm font-semibold text-slate-700">Itens</h2>
            <span className="text-xs text-slate-400">{items.length}</span>
          </div>
          {items.length === 0 && !edita && (
            <p className="text-sm text-slate-400 bg-white rounded-2xl border border-dashed border-slate-300 py-8 text-center">Nenhum item ainda.</p>
          )}
          {items.map((item, i) => editandoItem === item.id ? (
            <FormItem
              key={item.id}
              inicial={item}
              comCampos
              itens={items}
              rotuloSalvar="Salvar"
              onEnviarImagem={enviarImagem}
              onCancelar={() => setEditandoItem(null)}
              aviso={item.responses.length > 0 ? (
                <p className="text-xs text-amber-700">Este item já tem respostas: a edição fica registrada no histórico dele, com o texto anterior.</p>
              ) : undefined}
              onSalvar={async (title, body, images, fields, links, show_if) => {
                const ok = await acao('update_item', { item_id: item.id, title, body, images, fields, links, show_if });
                if (ok) setEditandoItem(null);
                return ok;
              }}
            />
          ) : (
            <ItemRelatorio
              key={item.id}
              item={item}
              numero={i + 1}
              podeResponder
              meuUserId={meuId}
              onEnviarImagem={enviarImagem}
              podeAlterarCampos={criador}
              faixa={<FaixaItemCondicional item={item} itens={items} visiveis={visiveis} />}
              onResponder={(body, images, st, answers, links, parent_id) => acao('reply', { item_id: item.id, body, images, new_status: st, answers, links, parent_id })}
              acoes={edita && (
                <div className="shrink-0 flex items-center opacity-60 hover:opacity-100 transition">
                  <button disabled={i === 0} onClick={() => mover(i, -1)} className="p-1 rounded-lg text-slate-400 hover:bg-slate-100 disabled:opacity-30" title="Subir"><ChevronUp size={16} /></button>
                  <button disabled={i === items.length - 1} onClick={() => mover(i, 1)} className="p-1 rounded-lg text-slate-400 hover:bg-slate-100 disabled:opacity-30" title="Descer"><ChevronDown size={16} /></button>
                  <button onClick={() => setEditandoItem(item.id)} className="p-1 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-indigo-600" title="Editar item"><Pencil size={15} /></button>
                  <button onClick={() => setExcluindoItem(item)} className="p-1 rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-500" title="Excluir item"><Trash2 size={15} /></button>
                </div>
              )}
            />
          ))}
          {edita && (
            <NovoItem
              comCampos
              itens={items}
              onEnviarImagem={enviarImagem}
              onCriar={(title, body, images, fields, links, show_if) => acao('add_item', { title, body, images, fields, links, show_if })}
            />
          )}
        </div>

        <aside className="space-y-3 xl:sticky xl:top-20">
          {/* Compartilhar */}
          <Painel icone={<Link2 size={15} />} titulo="Link para responder">
            {report.link_enabled ? (
              <>
                <div className="flex items-center gap-1.5 rounded-xl bg-slate-50 border border-slate-200 pl-3 pr-1 py-1">
                  <input readOnly value={link} onFocus={(e) => e.target.select()} className="flex-1 min-w-0 bg-transparent text-xs text-slate-600 outline-none" />
                  <button onClick={copiar} className="shrink-0 p-1.5 rounded-lg text-slate-500 hover:bg-white" title="Copiar">
                    {copiado ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} />}
                  </button>
                </div>
                {edita && (
                  <div className="mt-2 flex gap-3 text-xs">
                    <button onClick={() => setTrocandoLink(true)} className="flex items-center gap-1 text-slate-500 hover:text-indigo-600"><RefreshCw size={12} /> Trocar link</button>
                    <button onClick={() => acao('update', { link_enabled: false }, 'Link desligado')} className="flex items-center gap-1 text-slate-500 hover:text-indigo-600"><Lock size={12} /> Desligar</button>
                  </div>
                )}
              </>
            ) : (
              <div className="flex items-center gap-2">
                <p className="text-xs text-slate-500 flex-1">Desligado — quem tiver o endereço não consegue abrir.</p>
                {edita && (
                  <button onClick={() => acao('update', { link_enabled: true }, 'Link ligado')} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs border border-slate-200 hover:bg-slate-50">
                    <Unlock size={12} /> Ligar
                  </button>
                )}
              </div>
            )}
            <label className={`mt-3 flex items-start gap-2 text-xs text-slate-600 ${edita ? 'cursor-pointer' : 'opacity-60'}`}>
              <input
                type="checkbox"
                checked={report.guests_can_add_items}
                disabled={!edita}
                onChange={(e) => acao('update', { guests_can_add_items: e.target.checked })}
                className="w-4 h-4 mt-px"
              />
              Quem recebe o link também pode incluir itens
            </label>
            <div className="mt-3 pt-3 border-t border-slate-100 flex items-center gap-2 text-xs text-slate-500">
              <Folder size={13} className="shrink-0" style={{ color: pastaAtual?.color || undefined }} />
              {criador ? (
                <select
                  value={report.list_id ?? ''}
                  onChange={async (e) => {
                    const destino = pastas.find((p) => p.id === e.target.value)?.name ?? 'outra pasta';
                    await acao('update', { list_id: e.target.value }, `Relatório movido para ${destino}`);
                  }}
                  className="flex-1 min-w-0 rounded-lg border border-slate-200 px-2 py-1 text-base md:text-xs bg-white"
                  title="Quem divide a pasta também vê o relatório"
                >
                  {opcoesPasta.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              ) : (
                <span className="truncate">Pasta {pastaAtual?.name ?? '—'}</span>
              )}
            </div>
          </Painel>

          <LinksRelatorio
            links={report.links ?? []}
            podeEditar={edita}
            onSalvar={(links) => acao('update', { links })}
            className="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-4"
          />

          <TarefasLigadas
            ids={report.linked_task_ids ?? []}
            tarefas={tarefas}
            podeMexer={edita}
            pastaId={report.list_id ?? null}
            onOpenTask={onOpenTask}
            onLigar={(taskId) => acao('link_task', { task_id: taskId }, 'Tarefa ligada ao relatório')}
            onDesligar={(taskId) => acao('unlink_task', { task_id: taskId })}
          />

          <Painel icone={<Users size={15} />} titulo={`Quem entrou pelo link · ${guests.length}`}>
            {guests.length === 0 ? (
              <p className="text-xs text-slate-400">Ninguém ainda. Cada pessoa informa o nome ao abrir.</p>
            ) : (
              <ul className="space-y-2">
                {guests.map((g) => (
                  <li key={g.id} className="flex items-center gap-2.5">
                    <span className="w-7 h-7 rounded-full bg-amber-100 text-amber-800 text-xs font-semibold flex items-center justify-center shrink-0">
                      {g.name.trim().charAt(0).toUpperCase()}
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-medium text-slate-700 truncate">{g.name}</span>
                      <span className="block text-[11px] text-slate-400 truncate">
                        {g.contact ? `${g.contact} · ` : ''}visto {g.last_seen_at ? tempoRelativo(g.last_seen_at) : '—'}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Painel>
        </aside>
      </div>

      {excluindoItem && (
        <ConfirmDialog
          titulo="Excluir item?"
          descricao={`"${excluindoItem.title}" e as ${excluindoItem.responses.length} resposta(s) dele somem do relatório.`}
          textoConfirmar="Excluir"
          perigo
          onCancelar={() => setExcluindoItem(null)}
          onConfirmar={async () => { const it = excluindoItem; setExcluindoItem(null); await acao('delete_item', { item_id: it.id }, 'Item excluído'); }}
        />
      )}
      {excluindoRelatorio && (
        <ConfirmDialog
          titulo="Excluir relatório?"
          descricao="O link para de funcionar e o relatório sai da pasta."
          textoConfirmar="Excluir"
          perigo
          onCancelar={() => setExcluindoRelatorio(false)}
          onConfirmar={async () => {
            setExcluindoRelatorio(false);
            const r = await chamarDono('archive', { report_id: id });
            if (!r.ok) { toast.error('Não foi possível excluir', r.error); return; }
            toast.success('Relatório excluído');
            onVoltar();
          }}
        />
      )}
      {trocandoLink && (
        <ConfirmDialog
          titulo="Trocar o link?"
          descricao="O link antigo para de funcionar. Quem já respondeu continua no histórico, mas vai precisar do link novo (e se identificar de novo) para continuar."
          textoConfirmar="Trocar link"
          onCancelar={() => setTrocandoLink(false)}
          onConfirmar={async () => { setTrocandoLink(false); await acao('regenerate_link', {}, 'Link trocado'); }}
        />
      )}
    </div>
  );
}

/** Tarefas ligadas ao relatório; clicar abre a tarefa. Tarefa que eu não vejo entra só na contagem. */
function TarefasLigadas({ ids, tarefas, podeMexer, pastaId, onOpenTask, onLigar, onDesligar }: {
  ids: string[];
  tarefas: TaskRow[];
  podeMexer: boolean;
  pastaId: string | null;
  onOpenTask: (id: string) => void;
  onLigar: (id: string) => Promise<boolean>;
  onDesligar: (id: string) => Promise<boolean>;
}) {
  const [buscando, setBuscando] = useState(false);
  const [busca, setBusca] = useState('');
  const porId = new Map(tarefas.map((t) => [t.id, t]));
  const ligadas = ids.map((id) => porId.get(id)).filter((t): t is TaskRow => !!t);
  const ocultas = ids.length - ligadas.length;
  const candidatas = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return tarefas
      .filter((t) => !ids.includes(t.id) && (!termo || t.title.toLowerCase().includes(termo)))
      // As da própria pasta primeiro, depois as abertas.
      .sort((a, b) => Number(b.list_id === pastaId) - Number(a.list_id === pastaId)
        || Number(a.status_category === 'done') - Number(b.status_category === 'done'))
      .slice(0, 8);
  }, [tarefas, ids, busca, pastaId]);

  return (
    <Painel
      icone={<ListTodo size={15} />}
      titulo={`Tarefas ligadas · ${ids.length}`}
      acao={podeMexer && !buscando ? (
        <button onClick={() => setBuscando(true)} className="p-1 rounded-lg text-indigo-600 hover:bg-indigo-50" title="Ligar tarefa"><Plus size={16} /></button>
      ) : undefined}
    >
      {ids.length === 0 && !buscando && <p className="text-xs text-slate-400">Nenhuma tarefa ligada.</p>}
      {ligadas.length > 0 && (
        <ul className="space-y-1">
          {ligadas.map((t) => (
            <li key={t.id} className="group flex items-center gap-2 rounded-lg px-2 py-1.5 -mx-2 hover:bg-slate-50">
              {t.status_category === 'done' ? <CheckCircle2 size={15} className="text-emerald-500 shrink-0" /> : <Circle size={15} className="text-slate-300 shrink-0" />}
              <button onClick={() => onOpenTask(t.id)} className={`flex-1 min-w-0 text-left text-sm truncate hover:text-indigo-600 ${t.status_category === 'done' ? 'text-slate-400 line-through' : 'text-slate-700'}`}>
                {t.title}
              </button>
              {t.assignee_name && <span className="text-[11px] text-slate-400 shrink-0 max-w-[80px] truncate">{t.assignee_name}</span>}
              {podeMexer && (
                <button onClick={() => onDesligar(t.id)} className="p-0.5 text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100" title="Desligar do relatório"><X size={14} /></button>
              )}
            </li>
          ))}
        </ul>
      )}
      {ocultas > 0 && <p className="text-[11px] text-slate-400 mt-1">+ {ocultas} tarefa{ocultas > 1 ? 's' : ''} que você não vê</p>}
      {buscando && (
        <div className="mt-2 rounded-xl border border-slate-200 overflow-hidden">
          <div className="flex items-center gap-2 px-2.5 border-b border-slate-100 bg-slate-50/60">
            <Search size={14} className="text-slate-400" />
            <input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              autoFocus
              placeholder="Buscar tarefa…"
              className="flex-1 py-2 bg-transparent text-base md:text-sm outline-none"
            />
            <button onClick={() => { setBuscando(false); setBusca(''); }} className="p-1 text-slate-400"><X size={14} /></button>
          </div>
          <ul className="max-h-64 overflow-y-auto">
            {candidatas.map((t) => (
              <li key={t.id}>
                <button
                  onClick={async () => { if (await onLigar(t.id)) { setBuscando(false); setBusca(''); } }}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-indigo-50/60 flex items-center gap-2"
                >
                  <span className="flex-1 min-w-0 truncate">{t.title}</span>
                  {t.list_name && t.list_id !== pastaId && <span className="text-[11px] text-slate-400 shrink-0">{t.list_name}</span>}
                </button>
              </li>
            ))}
            {candidatas.length === 0 && <li className="px-3 py-2 text-sm text-slate-400">Nenhuma tarefa encontrada.</li>}
          </ul>
        </div>
      )}
    </Painel>
  );
}
