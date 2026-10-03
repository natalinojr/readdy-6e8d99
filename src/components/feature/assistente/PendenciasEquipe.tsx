// Caixa de pendências no chat de quem NÃO é o dono (2026-09-28, pedido do dono): o mesmo botão
// que ele tem no assistente, mas cada pessoa vê só o que é dela:
//   • lojas: só as que ela faz parte (a RLS de `pendencias` já filtra por user_tenants);
//   • tipo: pelo papel dela NAQUELA loja (pendenciaVisivelPara) — pedido de cancelamento/desconto
//     só para quem aprova, dinheiro só para o Financeiro, o operacional para todos;
//   • tarefas: as dela (responsável ou quem criou), vencidas e de hoje.
// Não passa pelo assistente-app (que é só do dono): aprovar é a RPC fn_pdv_approval_decide,
// "OK"/"Não vou fazer" é fn_pendencia_marcar, o resto abre a tela que resolve.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { kindConfig, pendenciaVisivelPara } from '@/contexts/PendenciasContext';
import { perguntar } from '@/components/base/Dialogos';
import TarefasPendencia, { minhasTarefasPendentes } from './TarefasPendencia';

interface Item {
  id: string; tenantId: string; loja: string; kind: string; ref: string; titulo: string; detalhe: string | null;
  rota: string | null; urgencia: 'alta' | 'normal' | 'baixa'; acaoRequerida: boolean; status: string; criadaEm: string;
}

const PESO = { alta: 0, normal: 1, baixa: 2 } as const;

function quando(iso: string): string {
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  if (min < 1440) return `há ${Math.floor(min / 60)} h`;
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

/** Pendências + tarefas da pessoa. Usado pela caixa e pelo número no botão do chat. */
export function usePendenciasEquipe() {
  const { user, availableTenants } = useAuth();
  const meuId = user?.id ?? null;
  const [itens, setItens] = useState<Item[] | null>(null);
  const [tarefas, setTarefas] = useState(0);
  const [erro, setErro] = useState<string | null>(null);

  // Papel da pessoa em cada loja (o mesmo usuário pode ser caixa numa e gerente noutra).
  const papelPorLoja = useMemo(() => {
    const m = new Map<string, string>();
    (availableTenants ?? []).forEach((t) => m.set(t.tenantId, t.role));
    if (user?.tenantId && user.perfil) m.set(user.tenantId, user.perfil);
    return m;
  }, [availableTenants, user?.tenantId, user?.perfil]);

  const carregar = useCallback(async () => {
    if (!meuId) return;
    const [{ data, error }, minhas] = await Promise.all([
      supabase.from('pendencias')
        .select('id, tenant_id, kind, ref, titulo, detalhe, rota, urgencia, acao_requerida, status, criada_em, tenants(name)')
        .in('status', ['aberta', 'vista'])
        .order('criada_em', { ascending: true })
        .limit(300),
      minhasTarefasPendentes(meuId).catch(() => []),
    ]);
    if (error) { setErro(error.message); return; }
    setErro(null);
    setTarefas(minhas.length);
    setItens((data ?? []).map((r) => {
      const t = (r as { tenants?: { name?: string } | { name?: string }[] | null }).tenants;
      return {
        id: r.id, tenantId: r.tenant_id, loja: (Array.isArray(t) ? t[0]?.name : t?.name) ?? '',
        kind: r.kind, ref: r.ref, titulo: r.titulo, detalhe: r.detalhe, rota: r.rota, urgencia: r.urgencia,
        acaoRequerida: r.acao_requerida, status: r.status, criadaEm: r.criada_em,
      } as Item;
    })
      .filter((p) => pendenciaVisivelPara(p.kind, papelPorLoja.get(p.tenantId)))
      // Aviso com OK dado sai; o que exige ação fica até resolver. Tarefas têm aba própria, por pessoa.
      .filter((p) => (p.acaoRequerida || p.status !== 'vista') && p.kind !== 'tarefa_vencida')
      .sort((a, b) => (PESO[a.urgencia] - PESO[b.urgencia]) || a.criadaEm.localeCompare(b.criadaEm)));
  }, [meuId, papelPorLoja]);

  // Sem assinatura em tempo real de propósito: este botão existe em todo aparelho (PDV, KDS…) e
  // postgres_changes custa RLS por linha × aparelho. Conta de 45 em 45 s (como no chat do dono) e
  // recarrega ao abrir a caixa; o pedido de cancelamento já chega na hora pelo bipe + aviso.
  useEffect(() => {
    carregar();
    const t = setInterval(() => { if (!document.hidden) carregar(); }, 45000);
    return () => clearInterval(t);
  }, [carregar]);

  const novas = (itens ?? []).filter((p) => p.status === 'aberta').length + tarefas;
  return { itens, erro, novas, recarregar: carregar };
}

// Cabeçalho (dono, 2026-09-29, caso Thatiele): o balão abre direto aqui quando há pendência nova, e
// só com um X ninguém sabia que atrás estavam as Conversas. Agora: seta de voltar + botão "Conversas"
// (com as não lidas); o X fecha o chat inteiro.
export default function PendenciasEquipe({ dados, onFechar, onAbrirRota, naoLidasConversas = 0, onFecharTudo }: {
  dados: ReturnType<typeof usePendenciasEquipe>;
  /** Volta para a lista de conversas. */
  onFechar: () => void;
  onAbrirRota: (tenantId: string, rota: string) => void;
  naoLidasConversas?: number;
  /** Fecha o balão inteiro (só no flutuante). */
  onFecharTudo?: () => void;
}) {
  const { user } = useAuth();
  const { itens, erro, recarregar } = dados;
  const [aba, setAba] = useState<'pendencias' | 'tarefas'>('pendencias');
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [falha, setFalha] = useState<string | null>(null);
  useEffect(() => { recarregar(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const varias = new Set((itens ?? []).map((p) => p.tenantId)).size > 1;

  const rodar = async (id: string, fn: () => Promise<{ error: { message: string } | null }>) => {
    setOcupado(id); setFalha(null);
    try {
      const { error } = await fn();
      if (error) setFalha(error.message);
    } finally {
      setOcupado(null);
      recarregar();
    }
  };

  const decidir = (p: Item, aprovar: boolean) => rodar(p.id, async () =>
    supabase.rpc('fn_pdv_approval_decide', { p_id: p.ref, p_aprovar: aprovar, p_nome: user?.nome ?? 'Supervisor' }));
  const marcar = (p: Item, acao: 'vista' | 'descartada', motivo?: string) => rodar(p.id, async () =>
    supabase.rpc('fn_pendencia_marcar', { p_id: p.id, p_acao: acao, p_motivo: motivo ?? null }));
  const naoVouFazer = async (p: Item) => {
    const motivo = await perguntar({ titulo: 'Por que não vai fazer?', mensagem: p.titulo, opcional: true });
    if (motivo === null) return;
    marcar(p, 'descartada', motivo.trim() || undefined);
  };

  const BTN = 'text-xs font-bold px-3 py-1.5 rounded-lg cursor-pointer whitespace-nowrap disabled:opacity-40';
  return (
    <div className="absolute inset-0 z-20 flex flex-col bg-zinc-50">
      <div className="flex items-center gap-2 px-3 h-14 border-b border-zinc-100 bg-white flex-shrink-0">
        <button onClick={onFechar} className="w-9 h-9 flex-shrink-0 flex items-center justify-center rounded-xl text-zinc-500 hover:bg-zinc-100 cursor-pointer" aria-label="Voltar para as conversas">
          <i className="ri-arrow-left-line text-xl" />
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-black text-zinc-900 leading-tight">Pendências</p>
          <p className="text-[11px] text-zinc-400 leading-tight truncate">Só o que é seu, nas lojas em que você está</p>
        </div>
        <button onClick={recarregar} className="w-9 h-9 flex items-center justify-center rounded-xl text-zinc-400 hover:bg-zinc-100 cursor-pointer" aria-label="Atualizar pendências">
          <i className="ri-refresh-line text-lg" />
        </button>
        <button onClick={onFechar}
          className="relative h-9 px-2.5 flex-shrink-0 flex items-center gap-1.5 rounded-xl bg-violet-50 text-violet-700 text-xs font-bold hover:bg-violet-100 cursor-pointer"
          aria-label={naoLidasConversas ? `Conversas: ${naoLidasConversas} não lida${naoLidasConversas > 1 ? 's' : ''}` : 'Conversas'}>
          <i className="ri-chat-3-line text-base" /> Conversas
          {naoLidasConversas > 0 && (
            <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 flex items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-black border-2 border-white">
              {naoLidasConversas > 9 ? '9+' : naoLidasConversas}
            </span>
          )}
        </button>
        {onFecharTudo && (
          <button onClick={onFecharTudo} className="w-9 h-9 flex-shrink-0 flex items-center justify-center rounded-xl text-zinc-400 hover:bg-zinc-100 cursor-pointer" aria-label="Fechar o chat">
            <i className="ri-close-line text-xl" />
          </button>
        )}
      </div>
      <div className="flex gap-1 px-3 py-2 border-b border-zinc-100 bg-white flex-shrink-0" role="tablist">
        {([['pendencias', 'Pendências'], ['tarefas', 'Minhas tarefas']] as const).map(([id, rotulo]) => (
          <button key={id} role="tab" aria-selected={aba === id} onClick={() => setAba(id)}
            className={`flex-1 h-9 rounded-xl text-sm font-semibold cursor-pointer ${aba === id ? 'bg-indigo-100 text-indigo-700' : 'text-zinc-500 hover:bg-zinc-100'}`}>
            {rotulo}{id === 'pendencias' && itens?.length ? ` (${itens.length})` : ''}
          </button>
        ))}
      </div>

      {aba === 'tarefas' ? (
        <div className="flex-1 overflow-y-auto px-3 py-3">
          <TarefasPendencia meuId={user?.id ?? null} onAbrir={(tid, id) => onAbrirRota(tid, `/tarefas?task=${encodeURIComponent(id)}`)} onMudou={recarregar} />
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
          {(erro || falha) && (
            <p className="px-3 py-2 rounded-xl bg-red-50 border border-red-200 text-xs font-semibold text-red-700">{falha ?? erro}</p>
          )}
          {itens === null ? (
            <div className="py-10 flex justify-center"><span className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" /></div>
          ) : itens.length === 0 ? (
            <div className="py-14 text-center">
              <i className="ri-inbox-line text-3xl text-zinc-300" />
              <p className="mt-2 text-sm font-semibold text-zinc-400">Nada pendente para você</p>
            </div>
          ) : itens.map((p) => {
            const cfg = kindConfig(p.kind);
            const aprovacao = p.kind === 'aprovacao';
            const busy = ocupado === p.id;
            return (
              <div key={p.id} className={`bg-white border rounded-2xl px-3.5 py-3 ${p.urgencia === 'alta' ? 'border-red-200' : 'border-zinc-200'}`}>
                <div className="flex items-start gap-3">
                  <div className={`w-9 h-9 flex-shrink-0 flex items-center justify-center rounded-xl ${cfg.corBg}`}>
                    <i className={`${cfg.icone} text-base ${cfg.corTexto}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-[10px] font-bold uppercase tracking-wider ${cfg.corTexto}`}>{cfg.label}</span>
                      {p.urgencia === 'alta' && <span className="text-[9px] font-black uppercase px-1.5 py-0.5 rounded-full bg-red-100 text-red-700">urgente</span>}
                      <span className="text-[10px] text-zinc-400">{quando(p.criadaEm)}{varias && p.loja ? ` · ${p.loja}` : ''}</span>
                    </div>
                    <p className="text-sm font-bold text-zinc-900 mt-1 leading-snug">{p.titulo}</p>
                    {p.detalhe && <p className="text-xs text-zinc-500 mt-1 whitespace-pre-line break-words">{p.detalhe}</p>}
                    <div className="flex items-center gap-1.5 mt-2.5 flex-wrap">
                      {aprovacao ? (
                        <>
                          <button onClick={() => decidir(p, true)} disabled={busy} className={`${BTN} bg-green-500 hover:bg-green-600 text-white`}>
                            <i className="ri-check-line mr-1" />Aprovar
                          </button>
                          <button onClick={() => decidir(p, false)} disabled={busy} className={`${BTN} bg-red-100 hover:bg-red-200 text-red-600`}>
                            <i className="ri-close-line mr-1" />Recusar
                          </button>
                        </>
                      ) : (
                        <>
                          {p.rota && (
                            <button onClick={() => onAbrirRota(p.tenantId, p.rota!)} disabled={busy} className={`${BTN} bg-indigo-500 hover:bg-indigo-600 text-white`}>
                              Abrir e resolver
                            </button>
                          )}
                          {!p.acaoRequerida && (
                            <button onClick={() => marcar(p, 'vista')} disabled={busy} className={`${BTN} bg-zinc-100 hover:bg-zinc-200 text-zinc-600`}>OK</button>
                          )}
                          {p.acaoRequerida && (
                            <button onClick={() => naoVouFazer(p)} disabled={busy} className={`${BTN} text-zinc-400 hover:text-red-600 hover:bg-red-50`}>Não vou fazer</button>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
