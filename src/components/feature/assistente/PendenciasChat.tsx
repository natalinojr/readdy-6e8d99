// Caixa de pendências dentro do chat do assistente (2026-09-18). Antes morava no sino, e o
// "Resolver" levava para a página de configuração do assistente — não fazia sentido (dono):
// quem resolve é o chat, com botão. Aqui aparecem as pendências de TODAS as lojas do dono
// (a RLS de `pendencias` já filtra por user_tenants), com a ação certa em cada uma:
//   pagamento pedido no grupo → Pagar (prepara de novo se venceu e já pede o PIN)
//   o resto                   → Abrir (troca de loja se precisar e vai à tela que resolve)
//   aviso informativo         → Ciente (check permanente)
//   exige ação                → Não vou fazer (com motivo) — nunca some por tempo.
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { kindConfig } from '@/contexts/PendenciasContext';

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
  }).sort((a, b) => (PESO[a.urgencia] - PESO[b.urgencia]) || (b.criadaEm < a.criadaEm ? -1 : 1));
}

const quando = (iso: string) => {
  const d = new Date(iso);
  const hoje = new Date().toDateString() === d.toDateString();
  return d.toLocaleString('pt-BR', hoje ? { hour: '2-digit', minute: '2-digit' } : { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
};

interface Props {
  aberta: boolean;
  onAlternar: () => void;
  /** Muda quando algo lá fora pode ter fechado uma pendência (pagamento feito, cancelado). */
  versao: number;
  onContagem?: (n: number) => void;
  onPagar: (p: PendenciaChat) => Promise<void>;
  onAbrir: (p: PendenciaChat) => void;
  onPedir: (texto: string) => void;
}

export default function PendenciasChat({ aberta, onAlternar, versao, onContagem, onPagar, onAbrir, onPedir }: Props) {
  const [lista, setLista] = useState<PendenciaChat[]>([]);
  const [ocupada, setOcupada] = useState<string | null>(null);
  const [erros, setErros] = useState<Record<string, string>>({});
  const [motivoDe, setMotivoDe] = useState<string | null>(null);
  const [motivo, setMotivo] = useState('');

  const recarregar = useCallback(async () => {
    try { setLista(await carregarPendenciasChat()); } catch { /* a caixa é extra: o chat segue */ }
  }, []);

  useEffect(() => {
    recarregar();
    const t = setInterval(() => { if (!document.hidden) recarregar(); }, 30000);
    return () => clearInterval(t);
  }, [recarregar, versao]);

  const novas = lista.filter((p) => p.status === 'aberta').length;
  useEffect(() => { onContagem?.(novas); }, [novas, onContagem]);

  if (!lista.length) return null;

  const marcar = async (p: PendenciaChat, acao: 'vista' | 'descartada', m?: string) => {
    setOcupada(p.id);
    const { error } = await supabase.rpc('fn_pendencia_marcar', { p_id: p.id, p_acao: acao, p_motivo: m ?? null });
    if (error) setErros((e) => ({ ...e, [p.id]: error.message }));
    else { setMotivoDe(null); setMotivo(''); await recarregar(); }
    setOcupada(null);
  };

  const pagar = async (p: PendenciaChat) => {
    setOcupada(p.id);
    setErros((e) => { const n = { ...e }; delete n[p.id]; return n; });
    try { await onPagar(p); await recarregar(); }
    catch (e) { setErros((x) => ({ ...x, [p.id]: e instanceof Error ? e.message : String(e) })); }
    finally { setOcupada(null); }
  };

  const urgentes = lista.filter((p) => p.urgencia === 'alta').length;

  return (
    <div className={`border-b border-zinc-100 bg-indigo-50/60 flex-shrink-0 flex flex-col ${aberta ? 'max-h-[55%]' : ''}`} data-sem-arrasto>
      <button onClick={onAlternar} className="flex items-center gap-2 px-4 py-2 text-left cursor-pointer flex-shrink-0" aria-expanded={aberta}>
        <i className="ri-inbox-archive-line text-indigo-600" />
        <span className="flex-1 text-xs font-bold text-indigo-800">
          {lista.length === 1 ? '1 pendência' : `${lista.length} pendências`}
          {urgentes > 0 && <span className="ml-1.5 px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 text-[10px]">{urgentes} urgente{urgentes > 1 ? 's' : ''}</span>}
        </span>
        <i className={`ri-arrow-${aberta ? 'up' : 'down'}-s-line text-indigo-500`} />
      </button>
      {aberta && (
        <div className="overflow-y-auto px-3 pb-3 space-y-2">
          {lista.map((p) => {
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
                  <div className="flex flex-wrap gap-2 mt-2.5">
                    {ehPagamento ? (
                      <button onClick={() => pagar(p)} disabled={busy} className="flex-1 h-9 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-sm font-bold disabled:opacity-50 cursor-pointer">
                        {busy ? 'Preparando…' : <><i className="ri-check-line" /> Pagar</>}
                      </button>
                    ) : p.rota && (
                      <button onClick={() => onAbrir(p)} className="flex-1 h-9 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-sm font-bold cursor-pointer">
                        <i className="ri-arrow-right-up-line" /> Abrir
                      </button>
                    )}
                    {!p.acaoRequerida ? (
                      <button onClick={() => marcar(p, 'vista')} disabled={busy} className="px-3 h-9 rounded-xl border border-zinc-200 text-zinc-600 text-sm font-bold hover:bg-zinc-50 disabled:opacity-50 cursor-pointer">
                        Ciente
                      </button>
                    ) : (
                      <button onClick={() => { setMotivoDe(p.id); setMotivo(''); }} disabled={busy} className="px-3 h-9 rounded-xl border border-zinc-200 text-zinc-500 text-sm font-bold hover:bg-zinc-50 disabled:opacity-50 cursor-pointer">
                        Não vou fazer
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
