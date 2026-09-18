// Caixa de pendências dentro do chat do assistente (2026-09-18). Antes morava no sino, e o
// "Resolver" levava para a página de configuração do assistente — não fazia sentido (dono):
// quem resolve é o chat, com botão. Abre pelo botão ao lado das ações rápidas e ocupa o painel
// inteiro, como elas (a faixa fixa no topo tomava espaço da conversa). Aqui aparecem as pendências de TODAS as lojas do dono
// (a RLS de `pendencias` já filtra por user_tenants), com a ação certa em cada uma:
//   pagamento pedido no grupo → Pagar (prepara de novo se venceu e já pede o PIN) ou Ver a mensagem
//                                (quando faltou dado, a conversa do grupo abre na mensagem do pedido)
//   conta sem DRE / itens     → Classificar aqui (um por um, no próprio cartão) ou Abrir na tela
//   tarefas vencidas          → Ver tarefas (lista aqui; tocar abre a tarefa no módulo)
//   o resto                   → Abrir (troca de loja se precisar e vai à tela que resolve)
//   aviso informativo         → OK (estoque crítico: sai da lista; volta se piorar)
//   exige ação                → Não vou fazer (com motivo) — nunca some por tempo.
// Resolver no celular sem abrir tabela grande foi o pedido do dono (2026-09-18); a tela continua
// a um toque para quem está no computador.
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { kindConfig } from '@/contexts/PendenciasContext';
import ItensClassificarCard from '@/components/feature/assistente/ItensClassificarCard';

type Call = <T>(action: string, extra?: Record<string, unknown>) => Promise<T>;

export interface PendenciaChat {
  id: string; tenantId: string; loja: string; kind: string; titulo: string; detalhe: string | null;
  rota: string | null; urgencia: 'alta' | 'normal' | 'baixa'; acaoRequerida: boolean; status: string; criadaEm: string;
}

const PESO = { alta: 0, normal: 1, baixa: 2 } as const;

export async function carregarPendenciasChat(): Promise<PendenciaChat[]> {
  const { data, error } = await supabase
    .from('pendencias')
    .select('id, tenant_id, kind, titulo, detalhe, rota, urgencia, acao_requerida, status, criada_em, tenants(name)')
    .in('status', ['aberta', 'vista'])
    .order('criada_em', { ascending: false })
    .limit(100);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => {
    const t = (r as { tenants?: { name?: string } | { name?: string }[] | null }).tenants;
    const loja = (Array.isArray(t) ? t[0]?.name : t?.name) ?? '';
    return {
      id: r.id, tenantId: r.tenant_id, loja, kind: r.kind, titulo: r.titulo, detalhe: r.detalhe,
      rota: r.rota, urgencia: r.urgencia, acaoRequerida: r.acao_requerida, status: r.status, criadaEm: r.criada_em,
    } as PendenciaChat;
  })
    // Aviso (estoque crítico…) com OK dado sai da lista; volta sozinho se piorar (assistente-cron).
    // O que exige ação continua listado mesmo visto: só sai resolvendo ou com "Não vou fazer".
    .filter((p) => p.acaoRequerida || p.status !== 'vista')
    .sort((a, b) => (PESO[a.urgencia] - PESO[b.urgencia]) || (b.criadaEm < a.criadaEm ? -1 : 1));
}

const quando = (iso: string) => {
  const d = new Date(iso);
  const hoje = new Date().toDateString() === d.toDateString();
  return d.toLocaleString('pt-BR', hoje ? { hour: '2-digit', minute: '2-digit' } : { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
};

interface Props {
  call: Call;
  /** Usuário logado: "minhas" tarefas vencidas (criei ou sou o responsável), como no cron. */
  meuId: string | null;
  onFechar: () => void;
  /** Muda quando algo lá fora pode ter fechado uma pendência (pagamento feito, cancelado). */
  versao: number;
  /** Algo mudou aqui (ciente, descarte, pagamento): o botão do chat reconta. */
  onMudou?: () => void;
  onPagar: (p: PendenciaChat) => Promise<void>;
  onAbrir: (p: PendenciaChat) => void;
  onPedir: (texto: string) => void;
  onVerMensagem: (p: PendenciaChat) => Promise<void>;
  onAbrirTarefa: (tenantId: string, taskId: string) => void;
}

export default function PendenciasChat({ call, meuId, onFechar, versao, onMudou, onPagar, onAbrir, onPedir, onVerMensagem, onAbrirTarefa }: Props) {
  // Cartão aberto para resolver ali mesmo (classificar, ver tarefas). Um por vez.
  const [expandida, setExpandida] = useState<string | null>(null);
  const [lista, setLista] = useState<PendenciaChat[] | null>(null);
  const [ocupada, setOcupada] = useState<string | null>(null);
  const [erros, setErros] = useState<Record<string, string>>({});
  const [motivoDe, setMotivoDe] = useState<string | null>(null);
  const [motivo, setMotivo] = useState('');

  const recarregar = useCallback(async () => {
    try { setLista(await carregarPendenciasChat()); } catch { setLista((l) => l ?? []); }
  }, []);

  useEffect(() => {
    recarregar();
    const t = setInterval(() => { if (!document.hidden) recarregar(); }, 30000);
    return () => clearInterval(t);
  }, [recarregar, versao]);

  const marcar = async (p: PendenciaChat, acao: 'vista' | 'descartada', m?: string) => {
    setOcupada(p.id);
    const { error } = await supabase.rpc('fn_pendencia_marcar', { p_id: p.id, p_acao: acao, p_motivo: m ?? null });
    if (error) setErros((e) => ({ ...e, [p.id]: error.message }));
    else { setMotivoDe(null); setMotivo(''); await recarregar(); onMudou?.(); }
    setOcupada(null);
  };

  const pagar = async (p: PendenciaChat) => {
    setOcupada(p.id);
    setErros((e) => { const n = { ...e }; delete n[p.id]; return n; });
    try { await onPagar(p); await recarregar(); onMudou?.(); }
    catch (e) { setErros((x) => ({ ...x, [p.id]: e instanceof Error ? e.message : String(e) })); }
    finally { setOcupada(null); }
  };

  const verMensagem = async (p: PendenciaChat) => {
    setOcupada(p.id);
    try { await onVerMensagem(p); }
    catch (e) { setErros((x) => ({ ...x, [p.id]: e instanceof Error ? e.message : String(e) })); }
    finally { setOcupada(null); }
  };

  const itens = lista ?? [];
  const urgentes = itens.filter((p) => p.urgencia === 'alta').length;

  return (
    <div data-sem-arrasto className="absolute inset-0 z-10 flex flex-col bg-zinc-50">
      <div className="flex items-center gap-2.5 px-4 h-14 border-b border-zinc-100 bg-white flex-shrink-0">
        <div className="w-8 h-8 flex items-center justify-center rounded-xl bg-indigo-50 border border-indigo-200">
          <i className="ri-inbox-archive-line text-indigo-600" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-black text-zinc-900 leading-tight">Pendências</p>
          <p className="text-[11px] text-zinc-400 leading-tight">
            {lista === null ? 'carregando…' : itens.length === 1 ? '1 esperando você' : `${itens.length} esperando você`}
            {urgentes > 0 ? ` · ${urgentes} urgente${urgentes > 1 ? 's' : ''}` : ''}
          </p>
        </div>
        <button onClick={onFechar} className="w-9 h-9 flex items-center justify-center rounded-xl text-zinc-400 hover:bg-zinc-100 cursor-pointer" aria-label="Fechar pendências">
          <i className="ri-close-line text-xl" />
        </button>
      </div>
      {lista === null ? (
        <div className="mx-auto my-16 w-6 h-6 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
      ) : !itens.length ? (
        <p className="text-sm text-zinc-400 text-center py-16"><i className="ri-check-double-line text-2xl block mb-1 text-emerald-500" />Nada pendente.</p>
      ) : (
        <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
          {itens.map((p) => {
            const cfg = kindConfig(p.kind);
            const ehPagamento = p.kind === 'pagamento_grupo';
            const busy = ocupada === p.id;
            return (
              <div key={p.id} className={`rounded-2xl border bg-white px-3.5 py-3 text-sm ${p.urgencia === 'alta' ? 'border-red-200' : 'border-indigo-100'}`}>
                <div className="flex items-start gap-2.5">
                  <span className={`w-8 h-8 flex-shrink-0 flex items-center justify-center rounded-xl ${cfg.corBg}`}>
                    <i className={`${cfg.icone} ${cfg.corTexto}`} />
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-zinc-900 leading-snug">{p.titulo}</p>
                    <p className="text-[11px] text-zinc-500 mt-0.5">
                      {p.loja && <span className="font-semibold text-zinc-600">{p.loja}</span>}
                      {p.loja ? ' · ' : ''}{cfg.label} · {quando(p.criadaEm)}
                      {p.status === 'vista' ? ' · vista' : ''}
                    </p>
                    {p.detalhe && <p className="text-xs text-zinc-500 mt-1 line-clamp-3 whitespace-pre-wrap">{p.detalhe}</p>}
                  </div>
                </div>

                {erros[p.id] && (
                  <div className="mt-2 rounded-xl bg-red-50 border border-red-100 px-2.5 py-2">
                    <p className="text-xs text-red-700">{erros[p.id]}</p>
                    {ehPagamento && (
                      <button onClick={() => onPedir(`Sobre a pendência "${p.titulo}"${p.loja ? ` (${p.loja})` : ''}: `)} className="mt-1 text-xs font-bold text-violet-700 cursor-pointer">
                        <i className="ri-chat-3-line" /> Pedir ao assistente
                      </button>
                    )}
                  </div>
                )}

                {motivoDe === p.id ? (
                  <form className="flex gap-1.5 mt-2.5" onSubmit={(e) => { e.preventDefault(); if (motivo.trim()) marcar(p, 'descartada', motivo.trim()); }}>
                    <input autoFocus value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Por que não vai fazer?"
                      className="flex-1 min-w-0 h-9 px-3 rounded-xl border border-zinc-200 text-sm focus:outline-none focus:border-violet-400" />
                    <button type="submit" disabled={busy || !motivo.trim()} className="px-3 h-9 rounded-xl bg-zinc-800 text-white text-xs font-bold disabled:opacity-40 cursor-pointer">OK</button>
                    <button type="button" onClick={() => { setMotivoDe(null); setMotivo(''); }} className="px-2 h-9 rounded-xl text-zinc-400 cursor-pointer" aria-label="Cancelar"><i className="ri-close-line" /></button>
                  </form>
                ) : (
                  // Três botões não cabem numa linha do celular (o texto quebrava e vazava, 2026-09-18):
                  // com três, a ação principal ocupa a linha de cima e as outras duas dividem a de baixo.
                  <div className="grid grid-cols-2 gap-2 mt-2.5">
                    {ehPagamento && (
                      <>
                        <button onClick={() => pagar(p)} disabled={busy} className={`${PRINCIPAL} col-span-2`}>
                          {busy ? 'Preparando…' : <><i className="ri-check-line" /> Pagar</>}
                        </button>
                        <button onClick={() => verMensagem(p)} disabled={busy} className={SECUNDARIO}>
                          <i className="ri-chat-quote-line" /> Ver a mensagem
                        </button>
                      </>
                    )}
                    {RESOLVE_AQUI[p.kind] && (
                      <button onClick={() => setExpandida((x) => (x === p.id ? null : p.id))}
                        className={expandida === p.id ? `${SECUNDARIO} col-span-2 bg-violet-100` : `${PRINCIPAL} col-span-2`}>
                        <i className={RESOLVE_AQUI[p.kind].icone} /> {expandida === p.id ? 'Fechar' : RESOLVE_AQUI[p.kind].label}
                      </button>
                    )}
                    {!ehPagamento && p.rota && (
                      <button onClick={() => onAbrir(p)} className={RESOLVE_AQUI[p.kind] ? SECUNDARIO : PRINCIPAL}>
                        <i className="ri-arrow-right-up-line" /> {RESOLVE_AQUI[p.kind] ? 'Abrir na tela' : 'Abrir'}
                      </button>
                    )}
                    {!p.acaoRequerida ? (
                      <button onClick={() => marcar(p, 'vista')} disabled={busy} className={NEUTRO}><i className="ri-check-line" /> OK</button>
                    ) : (
                      <button onClick={() => { setMotivoDe(p.id); setMotivo(''); }} disabled={busy} className={NEUTRO}>Não vou fazer</button>
                    )}
                  </div>
                )}

                {expandida === p.id && p.kind === 'conta_sem_dre' && (
                  <ContasDreInline call={call} tenantId={p.tenantId} onFeito={() => onMudou?.()} onTudo={() => { setExpandida(null); recarregar(); onMudou?.(); }} />
                )}
                {expandida === p.id && p.kind === 'item_sem_classe' && (
                  <ItensClassificarCard call={call} tenantId={p.tenantId} abertoInicial onFeito={() => onMudou?.()} onTudo={() => { setExpandida(null); recarregar(); onMudou?.(); }} />
                )}
                {expandida === p.id && p.kind === 'tarefa_vencida' && (
                  <TarefasInline tenantId={p.tenantId} meuId={meuId} onAbrir={(id) => onAbrirTarefa(p.tenantId, id)} />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

const BOTAO = 'h-10 px-2 flex items-center justify-center gap-1.5 rounded-xl text-sm font-bold whitespace-nowrap disabled:opacity-50 cursor-pointer';
const PRINCIPAL = `${BOTAO} bg-violet-600 hover:bg-violet-500 text-white`;
const SECUNDARIO = `${BOTAO} border border-violet-200 text-violet-700 hover:bg-violet-50`;
const NEUTRO = `${BOTAO} border border-zinc-200 text-zinc-500 hover:bg-zinc-50`;

// Tipos que dá para resolver no próprio cartão.
const RESOLVE_AQUI: Record<string, { label: string; icone: string }> = {
  conta_sem_dre: { label: 'Classificar aqui', icone: 'ri-pie-chart-line' },
  item_sem_classe: { label: 'Classificar aqui', icone: 'ri-price-tag-3-line' },
  tarefa_vencida: { label: 'Ver tarefas', icone: 'ri-task-line' },
};

const brl = (n: number) => Number(n ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const data = (d: string | null) => (d ? d.slice(0, 10).split('-').reverse().join('/') : '');

interface ContaSemDre { id: string; description: string; amount: number; due_date: string | null; supplier: string | null; category: string | null }
interface CategoriaDre { id: string; name: string; group_type: string }

// Contas sem categoria na DRE: escolhe a categoria e grava, uma por uma (assistente-app › conta_dre,
// mesma regra da enquete: só grava se a conta ainda estiver sem categoria).
function ContasDreInline({ call, tenantId, onFeito, onTudo }: { call: Call; tenantId: string; onFeito: () => void; onTudo: () => void }) {
  const [contas, setContas] = useState<ContaSemDre[] | null>(null);
  const [cats, setCats] = useState<CategoriaDre[]>([]);
  const [escolha, setEscolha] = useState<Record<string, string>>({});
  const [gravando, setGravando] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    call<{ contas: ContaSemDre[]; categorias: CategoriaDre[] }>('contas_sem_dre', { tenant_id: tenantId })
      .then((r) => { setContas(r.contas); setCats(r.categorias); })
      .catch((e) => { setErro(e instanceof Error ? e.message : String(e)); setContas([]); });
  }, [call, tenantId]);

  const gravar = async (c: ContaSemDre) => {
    const cat = escolha[c.id];
    if (!cat) return;
    setGravando(c.id); setErro(null);
    try {
      await call('conta_dre', { tenant_id: tenantId, bill_id: c.id, dre_category_id: cat });
      const resto = (contas ?? []).filter((x) => x.id !== c.id);
      setContas(resto);
      onFeito();
      if (!resto.length) onTudo();
    } catch (e) { setErro(e instanceof Error ? e.message : String(e)); }
    finally { setGravando(null); }
  };

  if (contas === null) return <p className="mt-2.5 text-xs text-zinc-500">Carregando contas…</p>;
  const grupos = [...new Set(cats.map((c) => c.group_type))];
  return (
    <div className="mt-2.5 space-y-2">
      {erro && <p className="text-xs text-red-600">{erro}</p>}
      {!contas.length && !erro && <p className="text-xs font-semibold text-emerald-700"><i className="ri-check-line" /> Nenhuma conta sem categoria.</p>}
      {contas.map((c) => (
        <div key={c.id} className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2.5">
          <p className="text-sm font-semibold text-zinc-800 leading-snug">{c.description}</p>
          <p className="text-[11px] text-zinc-500">
            {brl(c.amount)}{c.due_date ? ` · vence ${data(c.due_date)}` : ''}{c.supplier ? ` · ${c.supplier}` : ''}
          </p>
          <div className="flex gap-1.5 mt-2">
            <select value={escolha[c.id] ?? ''} onChange={(e) => setEscolha((x) => ({ ...x, [c.id]: e.target.value }))}
              className="flex-1 min-w-0 h-9 px-2 rounded-lg border border-zinc-200 bg-white text-sm focus:outline-none focus:border-violet-400">
              <option value="">Categoria da DRE…</option>
              {grupos.map((g) => (
                <optgroup key={g} label={GRUPO_DRE[g] ?? g}>
                  {cats.filter((x) => x.group_type === g).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                </optgroup>
              ))}
            </select>
            <button onClick={() => gravar(c)} disabled={!escolha[c.id] || gravando === c.id}
              className="px-3 h-9 rounded-lg bg-violet-600 text-white text-sm font-bold disabled:opacity-40 cursor-pointer">
              {gravando === c.id ? '…' : 'OK'}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
const GRUPO_DRE: Record<string, string> = { cost: 'Custos', expense: 'Despesas' };

interface TarefaVencida { id: string; title: string; due_date: string | null; assignee_name: string | null; list_name: string | null; completed_at: string | null; assignee_id: string | null; created_by: string | null }

// Tarefas vencidas da loja (as minhas: criei ou sou o responsável — a mesma conta do cron). Tocar
// abre a PRÓPRIA tarefa no módulo (/tarefas?task=), com ler, editar, comentar e mudar status.
function TarefasInline({ tenantId, meuId, onAbrir }: { tenantId: string; meuId: string | null; onAbrir: (id: string) => void }) {
  const [tarefas, setTarefas] = useState<TarefaVencida[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    supabase.rpc('fn_get_tasks', { p_tenant_id: tenantId }).then(({ data, error }) => {
      if (error) { setErro(error.message); setTarefas([]); return; }
      const agora = Date.now();
      const vencidas = ((data ?? []) as TarefaVencida[])
        .filter((t) => !t.completed_at && t.due_date && new Date(t.due_date).getTime() < agora)
        .filter((t) => !meuId || t.assignee_id === meuId || t.created_by === meuId)
        .sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)));
      setTarefas(vencidas);
    });
  }, [tenantId, meuId]);

  if (tarefas === null) return <p className="mt-2.5 text-xs text-zinc-500">Carregando tarefas…</p>;
  return (
    <div className="mt-2.5 space-y-1.5">
      {erro && <p className="text-xs text-red-600">{erro}</p>}
      {!tarefas.length && !erro && <p className="text-xs font-semibold text-emerald-700"><i className="ri-check-line" /> Nenhuma tarefa vencida.</p>}
      {tarefas.map((t) => (
        <button key={t.id} onClick={() => onAbrir(t.id)}
          className="w-full flex items-center gap-2.5 rounded-xl border border-zinc-200 bg-zinc-50 hover:bg-white px-3 py-2.5 text-left cursor-pointer">
          <i className="ri-checkbox-blank-circle-line text-amber-500" />
          <span className="flex-1 min-w-0">
            <span className="block text-sm font-semibold text-zinc-800 truncate">{t.title}</span>
            <span className="block text-[11px] text-red-600">
              venceu {data(t.due_date)}{t.assignee_name ? ` · ${t.assignee_name}` : ''}{t.list_name ? ` · ${t.list_name}` : ''}
            </span>
          </span>
          <i className="ri-arrow-right-s-line text-zinc-400" />
        </button>
      ))}
    </div>
  );
}
