// Caixa de pendências dentro do chat do assistente (2026-09-18). Antes morava no sino, e o
// "Resolver" levava para a página de configuração do assistente — não fazia sentido (dono):
// quem resolve é o chat, com botão. Abre pelo botão ao lado das ações rápidas e ocupa o painel
// inteiro, como elas (a faixa fixa no topo tomava espaço da conversa). Aqui aparecem as pendências de TODAS as lojas do dono
// (a RLS de `pendencias` já filtra por user_tenants), com a ação certa em cada uma:
//   pagamento pedido no grupo → Pagar (prepara de novo se venceu e já pede o PIN) ou Ver a mensagem
//                                (quando faltou dado, a conversa do grupo abre na mensagem do pedido)
//   conta sem DRE / itens     → Classificar aqui (um por um, no próprio cartão) ou Abrir na tela
//   tarefas                   → aba própria "Tarefas" (2026-09-18): as MINHAS tarefas vencidas e de hoje,
//                                de qualquer loja — o módulo é por pessoa, não por loja. A pendência
//                                agregada "tarefas vencidas" por loja (cron) sai da lista para não dobrar.
//   o resto                   → Abrir (troca de loja se precisar e vai à tela que resolve)
//   aviso informativo         → OK (estoque crítico: sai da lista; volta se piorar)
//   exige ação                → Não vou fazer (com motivo) — nunca some por tempo.
// Resolver no celular sem abrir tabela grande foi o pedido do dono (2026-09-18); a tela continua
// a um toque para quem está no computador.
import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { kindConfig } from '@/contexts/PendenciasContext';
import ItensClassificarCard from '@/components/feature/assistente/ItensClassificarCard';
import TarefasPendencia, { minhasTarefasPendentes } from '@/components/feature/assistente/TarefasPendencia';

type Call = <T>(action: string, extra?: Record<string, unknown>) => Promise<T>;

export interface PendenciaChat {
  id: string; tenantId: string; loja: string; kind: string; titulo: string; detalhe: string | null;
  rota: string | null; urgencia: 'alta' | 'normal' | 'baixa'; acaoRequerida: boolean; status: string; criadaEm: string;
}

export async function carregarPendenciasChat(): Promise<PendenciaChat[]> {
  const { data, error } = await supabase
    .from('pendencias')
    .select('id, tenant_id, kind, titulo, detalhe, rota, urgencia, acao_requerida, status, criada_em, tenants(name)')
    .in('status', ['aberta', 'vista'])
    // Ordem de chegada (dono, 2026-09-24): a mais antiga não pode cair fora do limite.
    .order('criada_em', { ascending: true })
    .limit(300);
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
    // Tarefas têm aba própria, por pessoa (a linha por loja do cron seria a mesma coisa duas vezes).
    .filter((p) => p.kind !== 'tarefa_vencida');
}

// Data e hora de chegada de cada pendência (dono, 2026-09-24): "24/09 · 14:32" + "há 3 h".
const dataHora = (iso: string) => {
  const d = new Date(iso);
  return `${d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} · ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
};
const idadeMin = (iso: string) => Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
const idade = (iso: string) => {
  const m = idadeMin(iso);
  if (m < 1) return 'agora';
  if (m < 60) return `há ${m} min`;
  if (m < 1440) return `há ${Math.floor(m / 60)} h`;
  const d = Math.floor(m / 1440);
  return `há ${d} dia${d > 1 ? 's' : ''}`;
};
// Esperando há mais de 1 dia fica âmbar; mais de 3, vermelho — o que envelhece salta aos olhos.
const corIdade = (iso: string) => {
  const m = idadeMin(iso);
  return m >= 3 * 1440 ? 'bg-red-50 text-red-700 border-red-200' : m >= 1440 ? 'bg-amber-50 text-amber-800 border-amber-200' : 'bg-zinc-50 text-zinc-500 border-zinc-200';
};
const chaveDia = (iso: string) => new Date(iso).toDateString();
const rotuloDia = (iso: string) => {
  const d = new Date(iso);
  if (d.toDateString() === new Date().toDateString()) return 'Hoje';
  if (d.toDateString() === new Date(Date.now() - 86400000).toDateString()) return 'Ontem';
  const s = d.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit' });
  return s.charAt(0).toUpperCase() + s.slice(1);
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
  // Filtro por loja (dono atende mais de uma, 2026-09-18). '' = todas. Lembrado neste aparelho.
  const [loja, setLoja] = useState<string>(() => { try { return localStorage.getItem(FILTRO_KEY) ?? ''; } catch { return ''; } });
  const escolherLoja = (id: string) => { setLoja(id); try { localStorage.setItem(FILTRO_KEY, id); } catch { /* sem storage */ } };
  const [lista, setLista] = useState<PendenciaChat[] | null>(null);
  const [ocupada, setOcupada] = useState<string | null>(null);
  const [erros, setErros] = useState<Record<string, string>>({});
  const [motivoDe, setMotivoDe] = useState<string | null>(null);
  const [motivo, setMotivo] = useState('');
  // Ordem de chegada: mais antiga primeiro (fila) ou mais nova primeiro. Lembrada neste aparelho.
  const [ordem, setOrdem] = useState<'antigas' | 'novas'>(() => { try { return localStorage.getItem(ORDEM_KEY) === 'novas' ? 'novas' : 'antigas'; } catch { return 'antigas'; } });
  const trocarOrdem = () => { const o = ordem === 'antigas' ? 'novas' : 'antigas'; setOrdem(o); try { localStorage.setItem(ORDEM_KEY, o); } catch { /* sem storage */ } };
  const [destaque, setDestaque] = useState<string | null>(null);
  const listaRef = useRef<HTMLDivElement>(null);

  const [nTarefas, setNTarefas] = useState(0);
  // Pendência de pagamento: para quem vai e se a mercadoria já chegou (assistente-app, dono 2026-09-18)
  const [infoPag, setInfoPag] = useState<Record<string, InfoPagamento>>({});
  const recarregar = useCallback(async () => {
    try {
      const l = await carregarPendenciasChat();
      setLista(l);
      const ids = l.filter((p) => p.kind === 'pagamento_grupo' || p.kind === 'pagamento_pendente').map((p) => p.id);
      if (ids.length) call<{ info: Record<string, InfoPagamento> }>('pendencias_pagamento_info', { ids }).then((r) => setInfoPag(r.info ?? {})).catch(() => {});
    } catch { setLista((l) => l ?? []); }
    try { setNTarefas((await minhasTarefasPendentes(meuId)).length); } catch { /* aba some */ }
  }, [meuId, call]);

  useEffect(() => {
    recarregar();
    const t = setInterval(() => { if (!document.hidden) recarregar(); }, 30000);
    return () => clearInterval(t);
  }, [recarregar, versao]);

  const marcar = async (p: PendenciaChat, acao: 'vista' | 'descartada', m?: string) => {
    setOcupada(p.id);
    const { error } = await supabase.rpc('fn_pendencia_marcar', { p_id: p.id, p_acao: acao, p_motivo: m ?? null });
    if (error) setErros((e) => ({ ...e, [p.id]: error.message }));
    else {
      // "Não vou fazer" num pedido de pagamento = não vou pagar: os Pix já preparados também saem
      // (senão os cartões seguiam no rodapé do chat esperando "Pagar" — dono, 2026-09-20).
      if (acao === 'descartada' && ['pagamento_grupo', 'pagamento_pendente'].includes(p.kind)) {
        try {
          const r = await call<{ cancelados: number; erros?: string[] }>('pendencia_recusar', { id: p.id });
          if (r.erros?.length) setErros((e) => ({ ...e, [p.id]: `Pendência fechada, mas não consegui cancelar: ${r.erros?.join(' · ')}` }));
        } catch (e) {
          setErros((x) => ({ ...x, [p.id]: `Pendência fechada, mas o pagamento continua preparado: ${e instanceof Error ? e.message : String(e)}` }));
        }
      }
      setMotivoDe(null); setMotivo(''); await recarregar(); onMudou?.();
    }
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

  const todas = lista ?? [];
  const lojas = [...new Map(todas.map((p) => [p.tenantId, p.loja || 'Loja'])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  // Loja escolhida que sumiu da lista (tudo resolvido lá): volta para Todas em vez de mostrar vazio.
  const verTarefas = loja === ABA_TAREFAS && nTarefas > 0;
  const filtro = lojas.some(([id]) => id === loja) ? loja : '';
  const itens = (verTarefas ? [] : filtro ? todas.filter((p) => p.tenantId === filtro) : todas)
    .slice().sort((a, b) => (ordem === 'antigas' ? a.criadaEm.localeCompare(b.criadaEm) : b.criadaEm.localeCompare(a.criadaEm)));
  const maisAntiga = itens.reduce<PendenciaChat | null>((m, p) => (!m || p.criadaEm < m.criadaEm ? p : m), null);
  // Botão "Mais antiga": rola até ela e pisca o cartão, em qualquer ordem ou filtro.
  const irParaMaisAntiga = () => {
    if (!maisAntiga) return;
    listaRef.current?.querySelector(`[data-pend="${maisAntiga.id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setDestaque(maisAntiga.id);
    setTimeout(() => setDestaque((d) => (d === maisAntiga.id ? null : d)), 2500);
  };
  const urgentes = itens.filter((p) => p.urgencia === 'alta').length;
  const abas: Array<[string, string, number]> = [
    ['', 'Todas', todas.length + nTarefas],
    ...lojas.map(([id, nome]) => [id, nome, todas.filter((p) => p.tenantId === id).length] as [string, string, number]),
    ...(nTarefas > 0 ? [[ABA_TAREFAS, 'Tarefas', nTarefas] as [string, string, number]] : []),
  ];
  const abaAtual = verTarefas ? ABA_TAREFAS : filtro;
  const totalVisivel = itens.length + (filtro ? 0 : nTarefas);

  return (
    <div data-sem-arrasto className="absolute inset-0 z-10 flex flex-col bg-zinc-50">
      <div className="flex items-center gap-2.5 px-4 h-14 border-b border-zinc-100 bg-white flex-shrink-0">
        <div className="w-8 h-8 flex items-center justify-center rounded-xl bg-indigo-50 border border-indigo-200">
          <i className="ri-inbox-archive-line text-indigo-600" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-black text-zinc-900 leading-tight">Pendências</p>
          <p className="text-[11px] text-zinc-400 leading-tight">
            {lista === null ? 'carregando…' : verTarefas
              ? `${nTarefas} ${nTarefas === 1 ? 'tarefa vencida ou para hoje' : 'tarefas vencidas ou para hoje'}`
              : totalVisivel === 1 ? '1 esperando você' : `${totalVisivel} esperando você`}
            {urgentes > 0 ? ` · ${urgentes} urgente${urgentes > 1 ? 's' : ''}` : ''}
          </p>
        </div>
        <button onClick={onFechar} className="w-9 h-9 flex items-center justify-center rounded-xl text-zinc-400 hover:bg-zinc-100 cursor-pointer" aria-label="Fechar pendências">
          <i className="ri-close-line text-xl" />
        </button>
      </div>
      {abas.length > 2 && (
        <div className="flex gap-1.5 px-3 py-2 border-b border-zinc-100 bg-white overflow-x-auto flex-shrink-0">
          {abas.map(([id, nome, n]) => (
            <button key={id || 'todas'} onClick={() => escolherLoja(id)}
              className={`flex-shrink-0 h-8 px-3 rounded-full text-xs font-bold whitespace-nowrap cursor-pointer ${abaAtual === id ? 'bg-violet-600 text-white' : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'}`}>
              {id === ABA_TAREFAS && <i className="ri-task-line mr-1" />}{nome} · {n}
            </button>
          ))}
        </div>
      )}
      {verTarefas ? (
        <div className="flex-1 overflow-y-auto px-3 pb-3">
          <p className="text-[11px] text-zinc-500 pt-3">Suas tarefas (criadas por você ou com você de responsável), de qualquer loja. Toque para mudar status, prazo ou comentar.</p>
          <TarefasPendencia meuId={meuId} onAbrir={onAbrirTarefa} onMudou={() => { recarregar(); onMudou?.(); }} />
        </div>
      ) : lista === null ? (
        <div className="mx-auto my-16 w-6 h-6 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
      ) : !totalVisivel ? (
        <p className="text-sm text-zinc-400 text-center py-16"><i className="ri-check-double-line text-2xl block mb-1 text-emerald-500" />Nada pendente.</p>
      ) : (
        <>
        {itens.length > 1 && (
          <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-100 bg-white flex-shrink-0">
            <button onClick={trocarOrdem} title="Ordem de chegada"
              className="h-8 px-3 flex items-center gap-1.5 rounded-full border border-zinc-200 text-xs font-bold text-zinc-600 hover:bg-zinc-50 cursor-pointer whitespace-nowrap">
              <i className={ordem === 'antigas' ? 'ri-sort-asc' : 'ri-sort-desc'} />
              {ordem === 'antigas' ? 'Mais antigas primeiro' : 'Mais novas primeiro'}
            </button>
            {maisAntiga && (
              <button onClick={irParaMaisAntiga}
                className={`ml-auto h-8 px-3 flex items-center gap-1.5 rounded-full border text-xs font-bold cursor-pointer whitespace-nowrap ${corIdade(maisAntiga.criadaEm)}`}>
                <i className="ri-history-line" /> Mais antiga · {idade(maisAntiga.criadaEm)}
              </button>
            )}
          </div>
        )}
        <div ref={listaRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
          {nTarefas > 0 && !filtro && (
            <button onClick={() => escolherLoja(ABA_TAREFAS)}
              className="w-full flex items-center gap-2.5 rounded-2xl border border-amber-200 bg-white px-3.5 py-3 text-left cursor-pointer hover:bg-amber-50/40">
              <span className="w-8 h-8 flex-shrink-0 flex items-center justify-center rounded-xl bg-amber-100"><i className="ri-task-line text-amber-700" /></span>
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-bold text-zinc-900">{nTarefas} {nTarefas === 1 ? 'tarefa sua vencida ou para hoje' : 'tarefas suas vencidas ou para hoje'}</span>
                <span className="block text-[11px] text-zinc-500">De qualquer loja · toque para ver</span>
              </span>
              <i className="ri-arrow-right-s-line text-zinc-400" />
            </button>
          )}
          {itens.map((p, i) => {
            const cfg = kindConfig(p.kind);
            const ehPagamento = p.kind === 'pagamento_grupo' || p.kind === 'pagamento_pendente';
            const busy = ocupada === p.id;
            // Separador por dia de chegada (Hoje / Ontem / Segunda-feira, 22/09).
            const novoDia = i === 0 || chaveDia(itens[i - 1].criadaEm) !== chaveDia(p.criadaEm);
            return (
              <div key={p.id}>
              {novoDia && (
                <div className={`flex items-center gap-2 pb-1 ${i === 0 ? '' : 'pt-2'}`}>
                  <span className="text-[11px] font-black uppercase tracking-wide text-zinc-400">{rotuloDia(p.criadaEm)}</span>
                  <span className="flex-1 h-px bg-zinc-200" />
                </div>
              )}
              <div data-pend={p.id}
                className={`rounded-2xl border bg-white px-3.5 py-3 text-sm transition-shadow ${p.urgencia === 'alta' ? 'border-red-200 border-l-4 border-l-red-500' : 'border-zinc-200'} ${destaque === p.id ? 'ring-4 ring-violet-300' : ''}`}>
                <div className="flex items-start gap-2.5">
                  <span className={`w-9 h-9 flex-shrink-0 flex items-center justify-center rounded-xl ${cfg.corBg}`}>
                    <i className={`${cfg.icone} ${cfg.corTexto} text-lg`} />
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] leading-tight">
                      <span className={`font-bold ${cfg.corTexto}`}>{cfg.label}</span>
                      {p.loja && <span className="text-zinc-500">· {p.loja}</span>}
                      {p.urgencia === 'alta' && <span className="px-1.5 rounded bg-red-100 text-red-700 font-bold">Urgente</span>}
                      {p.status === 'vista' && <span className="text-zinc-400"><i className="ri-eye-line" /> vista</span>}
                    </p>
                    <p className="font-bold text-zinc-900 leading-snug mt-0.5">{p.titulo}</p>
                  </div>
                  <div className="flex-shrink-0 text-right" title={`Chegou em ${new Date(p.criadaEm).toLocaleString('pt-BR')}`}>
                    <p className="text-[11px] font-bold text-zinc-700 whitespace-nowrap tabular-nums">{dataHora(p.criadaEm)}</p>
                    <span className={`inline-block mt-0.5 px-1.5 rounded-full border text-[10px] font-semibold whitespace-nowrap ${corIdade(p.criadaEm)}`}>{idade(p.criadaEm)}</span>
                  </div>
                </div>
                <div className="pl-[46px]">
                    {ehPagamento && infoPag[p.id] && <LinhaPagamento info={infoPag[p.id]} />}
                    {p.detalhe && <p className="text-xs text-zinc-500 mt-1 line-clamp-3 whitespace-pre-wrap">{p.detalhe}</p>}
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
                        <button onClick={() => pagar(p)} disabled={busy} className={p.kind === 'pagamento_grupo' ? `${PRINCIPAL} col-span-2` : PRINCIPAL}>
                          {busy ? 'Preparando…' : <><i className="ri-check-line" /> Pagar</>}
                        </button>
                        {p.kind === 'pagamento_grupo' && (
                          <button onClick={() => verMensagem(p)} disabled={busy} className={SECUNDARIO}>
                            <i className="ri-chat-quote-line" /> Ver a mensagem
                          </button>
                        )}
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
                {expandida === p.id && p.kind === 'conta_atrasada' && <ContasAtrasadasInline tenantId={p.tenantId} />}
                {expandida === p.id && p.kind === 'tarefa_vencida' && (
                  <TarefasPendencia tenantId={p.tenantId} meuId={meuId} onAbrir={onAbrirTarefa} />
                )}
              </div>
              </div>
            );
          })}
        </div>
        </>
      )}
    </div>
  );
}

interface InfoPagamento {
  para: string | null; valor: number | null; tipo: string | null;
  compra_lancada: boolean; recebido: boolean | null; recebido_em: string | null;
  guia?: string | null; // DAS/DARF/FGTS: "Guia de imposto — não é compra · vence dd/mm"
}

// Para quem vai (em destaque) e se a mercadoria já chegou — o que se confere antes de pagar.
function LinhaPagamento({ info }: { info: InfoPagamento }) {
  return (
    <div className="mt-2 rounded-xl bg-violet-50 border border-violet-100 px-3 py-2">
      <p className="text-sm text-zinc-800 break-words">
        {info.tipo === 'boleto' ? 'Boleto' : info.tipo === 'pix' ? 'Pix' : 'Pagar'}
        {info.valor ? <> de <b>{brl(info.valor)}</b></> : null} para{' '}
        <b className="font-black text-violet-800">{info.para || 'destinatário não identificado'}</b>
      </p>
      {info.guia ? (
        <p className="text-xs font-semibold mt-0.5 text-zinc-600">
          <i className="ri-government-line" /> {info.guia}
        </p>
      ) : (
      <p className={`text-xs font-semibold mt-0.5 ${info.recebido ? 'text-emerald-700' : info.recebido === false ? 'text-amber-700' : 'text-zinc-500'}`}>
        <i className={info.recebido ? 'ri-checkbox-circle-line' : info.recebido === false ? 'ri-truck-line' : 'ri-question-line'} />{' '}
        {info.recebido
          ? `Mercadoria recebida${info.recebido_em ? ` em ${new Date(info.recebido_em).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}` : ''}`
          : info.recebido === false ? 'Mercadoria ainda NÃO recebida' : 'Compra não lançada no ERPOS (recebimento não confirmado)'}
      </p>
      )}
    </div>
  );
}

const FILTRO_KEY = 'erpos.pendencias.loja';
const ORDEM_KEY = 'erpos.pendencias.ordem';
const ABA_TAREFAS = '__tarefas';
const BOTAO = 'h-10 px-2 flex items-center justify-center gap-1.5 rounded-xl text-sm font-bold whitespace-nowrap disabled:opacity-50 cursor-pointer';
const PRINCIPAL = `${BOTAO} bg-violet-600 hover:bg-violet-500 text-white`;
const SECUNDARIO = `${BOTAO} border border-violet-200 text-violet-700 hover:bg-violet-50`;
const NEUTRO = `${BOTAO} border border-zinc-200 text-zinc-500 hover:bg-zinc-50`;

// Tipos que dá para resolver no próprio cartão.
const RESOLVE_AQUI: Record<string, { label: string; icone: string }> = {
  conta_sem_dre: { label: 'Classificar aqui', icone: 'ri-pie-chart-line' },
  item_sem_classe: { label: 'Classificar aqui', icone: 'ri-price-tag-3-line' },
  tarefa_vencida: { label: 'Ver tarefas', icone: 'ri-task-line' },
  conta_atrasada: { label: 'Ver contas', icone: 'ri-file-list-3-line' },
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

interface ContaAtrasada { id: string; description: string; supplier: string | null; amount: number; paid_amount: number | null; due_date: string }

// Contas atrasadas da loja, mais antiga primeiro, com quantos dias de atraso. Leitura direta: a RLS
// de fin_accounts_payable libera SELECT a membro da loja (20260912070000_fin_select_membership).
function ContasAtrasadasInline({ tenantId }: { tenantId: string }) {
  const [contas, setContas] = useState<ContaAtrasada[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  useEffect(() => {
    const hoje = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
    supabase.from('fin_accounts_payable').select('id, description, supplier, amount, paid_amount, due_date')
      .eq('tenant_id', tenantId).not('status', 'in', '(paid,cancelled)').lt('due_date', hoje)
      .order('due_date', { ascending: true }).limit(100)
      .then(({ data: d, error }) => { if (error) setErro(error.message); setContas((d as ContaAtrasada[]) ?? []); });
  }, [tenantId]);
  if (contas === null) return <p className="mt-2.5 text-xs text-zinc-500">Carregando contas…</p>;
  const agora = Date.now();
  return (
    <div className="mt-2.5 space-y-1.5">
      {erro && <p className="text-xs text-red-600">{erro}</p>}
      {!contas.length && !erro && <p className="text-xs font-semibold text-emerald-700"><i className="ri-check-line" /> Nenhuma conta atrasada.</p>}
      {contas.map((c) => {
        const dias = Math.max(1, Math.floor((agora - new Date(`${c.due_date}T12:00:00-03:00`).getTime()) / 86400000));
        return (
          <div key={c.id} className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2.5">
            <p className="text-sm font-semibold text-zinc-800 break-words">{c.supplier || c.description}</p>
            {c.supplier && c.description && c.description !== c.supplier && <p className="text-xs text-zinc-500 break-words">{c.description}</p>}
            <p className="text-[11px] mt-0.5">
              <span className="font-bold text-zinc-800">{brl(Number(c.amount) - Number(c.paid_amount ?? 0))}</span>
              <span className="text-red-600"> · venceu {data(c.due_date)} · {dias} dia{dias > 1 ? 's' : ''}</span>
            </p>
          </div>
        );
      })}
    </div>
  );
}
