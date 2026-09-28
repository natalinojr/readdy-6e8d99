// Tráfego Pago › Manual do gestor + Pesquisador mensal (2026-09-28).
// Itens do manual com confiança e fonte; propostas do Pesquisador (Edge trafego-pesquisador).
// Fonte oficial da Meta entra sozinha; o resto espera o admin aplicar ou rejeitar.
import { useCallback, useEffect, useState } from 'react';
import { BookOpen, Loader2, Search, Check, X, ChevronDown, ChevronUp, ExternalLink } from 'lucide-react';
import { invokeWithAuth } from '@/lib/supabase';

type Item = { chave: string; tema: string; regra: string; valor: string | null; confianca: string; fonte_url: string | null; verificado_em: string | null; status: string };
type Pesquisa = { id: string; trigger: string; status: string; started_at: string; finished_at: string | null; buscas: number | null; custo_usd: number | null; error: string | null; requested_by: string | null };
type Proposta = { id: string; item_chave: string | null; tipo: string; resumo: string; regra: string | null; valor: string | null; fonte_url: string | null; fonte_oficial: boolean; trecho: string | null; status: string; decided_by: string | null; created_at: string };

const CONF_LABEL: Record<string, { txt: string; cls: string }> = {
  oficial: { txt: 'Oficial Meta', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  oficial_a_confirmar: { txt: 'Oficial (a confirmar)', cls: 'bg-sky-50 text-sky-700 border-sky-200' },
  dado_medido: { txt: 'Dado medido', cls: 'bg-violet-50 text-violet-700 border-violet-200' },
  mercado: { txt: 'Prática de mercado', cls: 'bg-zinc-100 text-zinc-600 border-zinc-200' },
  inferencia: { txt: 'Inferência', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
};
const STATUS_LABEL: Record<string, string> = { aplicada: 'Aplicada', a_testar: 'A testar', pendente: 'Pendente', rejeitada: 'Rejeitada' };
const TIPO_LABEL: Record<string, string> = { confirmar: 'Confirma', alterar: 'Muda', nova: 'Regra nova', alerta: 'Alerta' };
const dataHora = (iso: string | null) => (iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');
const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };

export default function ManualGestor({ tenantId }: { tenantId: string }) {
  const [aberto, setAberto] = useState(false);
  const [dados, setDados] = useState<{ itens: Item[]; pesquisas: Pesquisa[]; propostas: Proposta[]; is_admin: boolean } | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [rodando, setRodando] = useState(false);
  const [decidindo, setDecidindo] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    const { data, error } = await invokeWithAuth<{ success: boolean; itens: Item[]; pesquisas: Pesquisa[]; propostas: Proposta[]; is_admin: boolean; error?: string }>('trafego-pesquisador', { body: { action: 'list', tenant_id: tenantId } });
    if (error || !data?.success) { setErro(error?.message ?? data?.error ?? 'Não carregou o manual.'); return; }
    setErro(null); setDados(data);
  }, [tenantId]);
  useEffect(() => { if (aberto && !dados) void carregar(); }, [aberto, dados, carregar]);

  // Pesquisa em andamento: atualiza a cada 10 s até terminar.
  const emAndamento = dados?.pesquisas.some((p) => p.status === 'running');
  useEffect(() => {
    if (!aberto || !emAndamento) return;
    const t = setInterval(() => void carregar(), 10000);
    return () => clearInterval(t);
  }, [aberto, emAndamento, carregar]);

  const pesquisar = async () => {
    setRodando(true); setErro(null);
    const { data, error } = await invokeWithAuth<{ success: boolean; error?: string }>('trafego-pesquisador', { body: { action: 'run', tenant_id: tenantId } });
    setRodando(false);
    if (error || !data?.success) setErro(error?.message ?? data?.error ?? 'Não iniciou a pesquisa.');
    await carregar();
  };
  const decidir = async (id: string, decisao: 'aplicar' | 'rejeitar') => {
    setDecidindo(id);
    const { data, error } = await invokeWithAuth<{ success: boolean; error?: string }>('trafego-pesquisador', { body: { action: 'decide', tenant_id: tenantId, proposta_id: id, decisao } });
    setDecidindo(null);
    if (error || !data?.success) setErro(error?.message ?? data?.error ?? 'Não salvou.');
    await carregar();
  };

  const abertas = dados?.propostas.filter((p) => p.status === 'pendente' || p.status === 'a_testar') ?? [];
  const recentes = dados?.propostas.filter((p) => p.status === 'aplicada' || p.status === 'rejeitada').slice(0, 10) ?? [];
  const ultima = dados?.pesquisas[0];

  return (
    <div className="bg-white border border-zinc-200 rounded-2xl p-4">
      <button onClick={() => setAberto((v) => !v)} className="w-full flex items-center gap-2 text-left cursor-pointer">
        <BookOpen size={15} className="text-amber-500" />
        <span className="text-sm font-bold text-zinc-800 flex-1">Manual do gestor de tráfego</span>
        <span className="text-[11px] text-zinc-400 hidden sm:inline">regras que o agente segue, conferidas todo mês</span>
        {aberto ? <ChevronUp size={15} className="text-zinc-400" /> : <ChevronDown size={15} className="text-zinc-400" />}
      </button>

      {aberto && (
        <div className="mt-3 space-y-4">
          {erro && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{erro}</p>}
          {!dados ? <div className="flex justify-center py-6"><Loader2 size={20} className="animate-spin text-amber-500" /></div> : (
            <>
              <div className="flex items-center gap-2 flex-wrap text-xs text-zinc-500">
                <span className="flex-1 min-w-[200px]">
                  {ultima ? <>Última pesquisa: {dataHora(ultima.started_at)} · {ultima.status === 'running' ? 'rodando…' : ultima.status === 'error' ? `erro: ${ultima.error ?? ''}` : `${ultima.buscas ?? 0} buscas · US$ ${Number(ultima.custo_usd ?? 0).toFixed(2)}`}</> : 'Nenhuma pesquisa ainda. O Pesquisador roda sozinho todo dia 1º.'}
                </span>
                {dados.is_admin && (
                  <button onClick={pesquisar} disabled={rodando || emAndamento}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg bg-amber-500 text-white hover:bg-amber-600 cursor-pointer disabled:opacity-50">
                    {rodando || emAndamento ? <Loader2 size={12} className="animate-spin" /> : <Search size={12} />} {emAndamento ? 'Pesquisando (1–3 min)…' : 'Pesquisar agora'}
                  </button>
                )}
              </div>

              {abertas.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-bold text-zinc-700">Propostas esperando decisão ({abertas.length})</p>
                  {abertas.map((p) => (
                    <div key={p.id} className="border border-amber-200 bg-amber-50/40 rounded-xl p-3 text-xs">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-zinc-800">{TIPO_LABEL[p.tipo] ?? p.tipo}{p.item_chave ? ` · ${p.item_chave}` : ''}</span>
                        <span className="text-[10px] font-semibold text-zinc-500">{STATUS_LABEL[p.status]}</span>
                      </div>
                      <p className="text-zinc-700 mt-1">{p.resumo}</p>
                      {(p.regra || p.valor) && <p className="text-zinc-600 mt-1"><span className="font-semibold">Proposta:</span> {p.regra ?? ''}{p.valor ? ` = ${p.valor}` : ''}</p>}
                      <div className="flex items-center gap-2 mt-2 flex-wrap">
                        {p.fonte_url ? <a href={p.fonte_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sky-600 hover:underline">{host(p.fonte_url)} <ExternalLink size={10} /></a> : <span className="text-zinc-400">sem fonte</span>}
                        {p.fonte_oficial && <span className="text-[10px] font-bold text-emerald-700">fonte oficial</span>}
                        {dados.is_admin && (
                          <span className="ml-auto flex gap-1.5">
                            <button onClick={() => decidir(p.id, 'rejeitar')} disabled={decidindo === p.id} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-white border border-zinc-200 text-zinc-600 cursor-pointer disabled:opacity-50"><X size={11} /> Rejeitar</button>
                            <button onClick={() => decidir(p.id, 'aplicar')} disabled={decidindo === p.id} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-emerald-500 text-white font-bold cursor-pointer disabled:opacity-50"><Check size={11} /> Aplicar</button>
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div>
                <p className="text-xs font-bold text-zinc-700 mb-2">Regras ({dados.itens.length})</p>
                <div className="divide-y divide-zinc-100 border border-zinc-100 rounded-xl">
                  {dados.itens.map((i) => {
                    const c = CONF_LABEL[i.confianca] ?? CONF_LABEL.mercado;
                    return (
                      <div key={i.chave} className="px-3 py-2 text-xs flex items-start gap-2 flex-wrap">
                        <div className="flex-1 min-w-[220px]">
                          <p className="text-zinc-700"><span className="text-zinc-400">{i.tema} · </span>{i.regra}{i.valor ? <strong className="text-zinc-800"> = {i.valor}</strong> : null}</p>
                          <p className="text-[10px] text-zinc-400 mt-0.5">
                            {i.fonte_url ? <a href={i.fonte_url} target="_blank" rel="noreferrer" className="hover:underline">{host(i.fonte_url)}</a> : 'sem fonte'}
                            {i.verificado_em ? ` · conferido em ${new Date(i.verificado_em + 'T12:00:00').toLocaleDateString('pt-BR')}` : ''}
                            {i.status !== 'vigente' ? ` · ${i.status === 'a_testar' ? 'a testar' : i.status}` : ''}
                          </p>
                        </div>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border whitespace-nowrap ${c.cls}`}>{c.txt}</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {recentes.length > 0 && (
                <div>
                  <p className="text-xs font-bold text-zinc-700 mb-1">Decididas recentemente</p>
                  <ul className="text-[11px] text-zinc-500 space-y-0.5">
                    {recentes.map((p) => <li key={p.id}>{STATUS_LABEL[p.status]} · {TIPO_LABEL[p.tipo]}{p.item_chave ? ` ${p.item_chave}` : ''}: {p.resumo.slice(0, 140)} {p.decided_by ? `(${p.decided_by})` : ''}</li>)}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
