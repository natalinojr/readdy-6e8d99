// Painel rápido (/widget) — o que abre ao clicar na bolinha do app "ERPOS para Windows" (desktop/).
// Mostra só o que pede ação: o "Agora" da tela Hoje, minhas tarefas (atrasadas, hoje, amanhã),
// novidades das tarefas e, para quem vê o Dashboard, vendas de hoje × meta. Dentro do app ela
// também fica carregada escondida: é daqui que saem o número da bolinha e as notificações do Windows.
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { usePermissoes } from '@/hooks/usePermissoes';
import { useModuleAccess } from '@/hooks/useModuleAccess';
import { useDashboardMetrics } from '@/hooks/useDashboardMetrics';
import { useDashboardPainel } from '@/hooks/useDashboardPainel';
import { useIfoodVendas } from '@/hooks/useIfoodVendas';
import { desktop } from '@/lib/desktop';
import { todayBrasilia } from '@/lib/dateUtils';
import type { TaskNotificacao, TaskRow } from '@/pages/tarefas/hooks/useTarefas';
import { textoSobrecarga, textoVencimento } from '@/pages/tarefas/components/NotificacoesInbox';
import { rotuloPrazo } from '@/components/feature/assistente/acoes/tarefas/comum';
import { usePendenciasHoje } from '@/pages/hoje/hojeStore';
import type { ItemHoje } from '@/pages/hoje/organizar';
import { OQueAconteceu } from '@/components/feature/lancar';
import { useWidgetTarefas } from './useWidgetTarefas';

const brl = (n: number) => Number(n ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
const RECARGA_HOJE_MS = 2 * 60 * 1000;
/** Aviso do Windows só para o que acabou de acontecer (reabrir o app não repete o dia inteiro). */
const JANELA_AVISO_MS = 20 * 60 * 1000;

// ── memória do que já foi avisado (por aparelho; sem ela só avisaria de novo) ──
function lerSet(chave: string): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(chave) || '[]') as string[]); } catch { return new Set(); }
}
function gravarSet(chave: string, s: Set<string>) {
  try { localStorage.setItem(chave, JSON.stringify([...s].slice(-400))); } catch { /* sem storage: só não lembra */ }
}
function lerTexto(chave: string): string | null {
  try { return localStorage.getItem(chave); } catch { return null; }
}
function gravarTexto(chave: string, v: string) {
  try { localStorage.setItem(chave, v); } catch { /* idem */ }
}

function tituloNotificacao(n: TaskNotificacao): string {
  if (n.type === 'due') return `⏰ ${textoVencimento(n.payload)}`;
  if (n.type === 'overload') return `🔥 ${textoSobrecarga(n.payload)}`;
  const quem = n.actor_name ?? 'Alguém';
  if (n.type === 'assigned') return `${quem} passou uma tarefa para você`;
  if (n.type === 'mentioned') return `${quem} mencionou você`;
  return `${quem} comentou na sua tarefa`;
}

const recente = (iso: string | null | undefined) => !!iso && Date.now() - new Date(iso).getTime() < JANELA_AVISO_MS;

export default function WidgetPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { hasPermissao } = usePermissoes();
  const modulos = useModuleAccess();
  const app = desktop();
  // Só o painel da bolinha conta e avisa; a janela principal aberta em /widget só mostra.
  const avisos = app?.isPanel ? app : null;
  const comTarefas = modulos.hasModule('tarefas');
  const tf = useWidgetTarefas(comTarefas);
  const { itens, recarregar: recarregarHoje } = usePendenciasHoje();
  const agora = (itens ?? []).filter((i) => i.bloco === 'agora');
  const verVendas = !!user && (user.perfil === 'admin' || hasPermissao('gestao_dashboard'));

  // Lançar acontece dentro do painel; o resto abre na janela principal.
  const [tela, setTela] = useState<'painel' | 'lancar'>('painel');
  useEffect(() => { app?.fixar?.(tela === 'lancar'); }, [app, tela]);
  // Hora da última leitura: a das tarefas, ou a das pendências para quem não tem Tarefas.
  const [hojeLidoEm, setHojeLidoEm] = useState<Date | null>(null);
  useEffect(() => { if (itens !== null) setHojeLidoEm(new Date()); }, [itens]);
  const atualizadoEm = comTarefas ? tf.atualizadoEm : hojeLidoEm;

  const abrir = (caminho: string) => {
    if (app) app.openInMain(caminho); else navigate(caminho);
  };

  // A tela Hoje só confere com a janela visível; o painel fica escondido a maior parte do tempo.
  useEffect(() => {
    const t = setInterval(() => recarregarHoje(), RECARGA_HOJE_MS);
    return () => clearInterval(t);
  }, [recarregarHoje]);

  // Abriu o painel: dados frescos.
  useEffect(() => app?.onPanelShown(() => { tf.recarregar(); recarregarHoje(); }), [app, tf.recarregar, recarregarHoje]);

  // ── número da bolinha ──
  const nTarefas = tf.grupos.atrasadas.length + tf.grupos.hoje.length;
  const badge = nTarefas + agora.length;
  // Só depois de ler (senão a bolinha pisca 0 a cada recarga do painel).
  const leu = (!comTarefas || tf.tarefas !== null) && (!user || itens !== null);
  useEffect(() => { if (leu) avisos?.setBadge(badge); }, [avisos, badge, leu]);

  // ── avisos do Windows ──
  // Tarefas: as notificações que o servidor já cria (lembrete de vencimento nas horas que a pessoa
  // escolheu, atribuição, menção, comentário) — a mesma regra do push do celular.
  useEffect(() => {
    if (!avisos) return;
    const vistos = lerSet('erpos_widget_notif_vistas');
    let mudou = false;
    for (const n of tf.notificacoes) {
      if (vistos.has(n.id)) continue;
      vistos.add(n.id); mudou = true;
      if (n.is_read || !recente(n.created_at)) continue;
      avisos.notify({ title: tituloNotificacao(n), body: n.task_title ?? 'Tarefa', path: `/tarefas?task=${encodeURIComponent(n.task_id)}` });
    }
    if (mudou) gravarSet('erpos_widget_notif_vistas', vistos);
  }, [avisos, tf.notificacoes]);

  // Resumo do dia: uma vez por dia, a partir das 7h, se houver tarefa para hoje ou atrasada.
  useEffect(() => {
    if (!avisos || tf.tarefas === null) return;
    const dia = todayBrasilia();
    const hora = Number(new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', hour12: false }).slice(0, 2));
    if (hora < 7 || lerTexto('erpos_widget_resumo') === dia) return;
    gravarTexto('erpos_widget_resumo', dia);
    const { atrasadas, hoje } = tf.grupos;
    if (!atrasadas.length && !hoje.length) return;
    const partes = [hoje.length ? `${hoje.length} para hoje` : null, atrasadas.length ? `${atrasadas.length} atrasada${atrasadas.length > 1 ? 's' : ''}` : null].filter(Boolean);
    avisos.notify({ title: 'Suas tarefas de hoje', body: partes.join(' · ') });
  }, [avisos, tf.tarefas, tf.grupos]);

  // "Agora" da tela Hoje: cartão novo que pede ação.
  const agoraChaves = agora.map((i) => i.chave).join('|');
  useEffect(() => {
    if (!avisos || itens === null) return;
    const vistos = lerSet('erpos_widget_agora_vistos');
    let mudou = false;
    for (const i of agora) {
      if (vistos.has(i.chave)) continue;
      vistos.add(i.chave); mudou = true;
      if (!recente(i.criadaEm)) continue;
      avisos.notify({ title: 'Precisa de você', body: `${i.titulo}${i.loja ? ` · ${i.loja}` : ''}`, path: '/hoje' });
    }
    if (mudou) gravarSet('erpos_widget_agora_vistos', vistos);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [avisos, agoraChaves, itens === null]);

  const naoLidas = tf.notificacoes.filter((n) => !n.is_read);

  if (tela === 'lancar') {
    return (
      <div className="h-screen overflow-hidden bg-white">
        <OQueAconteceu
          telaCheia
          onFechar={() => undefined}
          onNavegar={(rota) => { setTela('painel'); abrir(rota); }}
          onSair={() => setTela('painel')}
        />
      </div>
    );
  }
  const nada = !agora.length && !nTarefas && !tf.grupos.amanha.length && !naoLidas.length;

  return (
    <div className="flex h-screen flex-col bg-zinc-50 font-sans text-zinc-800">
      <header className="flex items-center gap-2 border-b border-zinc-200 bg-white px-4 py-3">
        <img src="/icon-192.png" alt="" className="h-7 w-7 rounded-lg" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold leading-tight">{tf.eu.nome ? `Olá, ${tf.eu.nome.split(' ')[0]}` : 'ERPOS'}</p>
          {user?.loja && <LojaSeletor />}
        </div>
        {atualizadoEm && (
          <span className="text-[11px] tabular-nums text-zinc-400" title="Última atualização">
            {atualizadoEm.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
          </span>
        )}
        <button onClick={() => { tf.recarregar(); recarregarHoje(); }} title="Atualizar" className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100">
          <i className={`ri-refresh-line ${tf.atualizando ? 'animate-spin' : ''}`} />
        </button>
        <button onClick={() => abrir('/hoje')} title="Abrir o ERPOS" className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100">
          <i className="ri-external-link-line" />
        </button>
        {app && (
          <button onClick={() => app.closePanel()} title="Fechar" className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100">
            <i className="ri-close-line" />
          </button>
        )}
      </header>

      <main className="flex-1 space-y-3 overflow-y-auto p-3">
        {verVendas && <VendasLinha onAbrir={() => abrir('/dashboard')} />}

        {agora.length > 0 && (
          <Secao titulo="Precisa de você agora" n={agora.length} cor="text-red-600">
            {agora.slice(0, 4).map((i) => <LinhaAgora key={i.chave} i={i} onAbrir={() => abrir('/hoje')} />)}
            {agora.length > 4 && <Mais texto={`Ver as outras ${agora.length - 4} na tela Hoje`} onClick={() => abrir('/hoje')} />}
          </Secao>
        )}

        {comTarefas && (
          <>
            {tf.erro && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{tf.erro}</p>}
            {tf.carregando && <p className="px-1 text-xs text-zinc-400">Carregando tarefas…</p>}
            {tf.grupos.atrasadas.length > 0 && (
              <Secao titulo="Tarefas atrasadas" n={tf.grupos.atrasadas.length} cor="text-red-600">
                {tf.grupos.atrasadas.map((t) => <LinhaTarefa key={t.id} t={t} onAbrir={abrir} onConcluir={tf.concluir} onAdiar={tf.adiarParaAmanha} />)}
              </Secao>
            )}
            {tf.grupos.hoje.length > 0 && (
              <Secao titulo="Tarefas de hoje" n={tf.grupos.hoje.length} cor="text-amber-600">
                {tf.grupos.hoje.map((t) => <LinhaTarefa key={t.id} t={t} onAbrir={abrir} onConcluir={tf.concluir} onAdiar={tf.adiarParaAmanha} />)}
              </Secao>
            )}
            {tf.grupos.amanha.length > 0 && (
              <Secao titulo="Amanhã" n={tf.grupos.amanha.length} cor="text-zinc-500">
                {tf.grupos.amanha.slice(0, 5).map((t) => <LinhaTarefa key={t.id} t={t} onAbrir={abrir} onConcluir={tf.concluir} />)}
                {tf.grupos.amanha.length > 5 && <Mais texto={`Ver as outras ${tf.grupos.amanha.length - 5}`} onClick={() => abrir('/tarefas')} />}
              </Secao>
            )}
            {naoLidas.length > 0 && (
              <Secao titulo="Novidades nas tarefas" n={naoLidas.length} cor="text-indigo-600">
                {naoLidas.slice(0, 4).map((n) => (
                  <button key={n.id} onClick={() => { tf.marcarLida(n); abrir(`/tarefas?task=${encodeURIComponent(n.task_id)}`); }}
                    className="block w-full cursor-pointer px-3 py-2 text-left hover:bg-zinc-50">
                    <p className="truncate text-xs font-semibold text-zinc-700">{tituloNotificacao(n)}</p>
                    <p className="truncate text-xs text-zinc-500">{n.task_title ?? 'Tarefa'}</p>
                  </button>
                ))}
                {naoLidas.length > 4 && <Mais texto={`Ver as outras ${naoLidas.length - 4}`} onClick={() => abrir('/tarefas')} />}
              </Secao>
            )}
          </>
        )}

        {nada && !tf.carregando && itens !== null && (
          <div className="py-10 text-center">
            <p className="text-2xl">👌</p>
            <p className="mt-1 text-sm font-semibold text-zinc-600">Nada pedindo você agora</p>
            <p className="text-xs text-zinc-400">Sem tarefa atrasada ou para hoje.</p>
          </div>
        )}
      </main>

      <footer className="grid grid-cols-3 gap-2 border-t border-zinc-200 bg-white p-3">
        {user && <Atalho icone="ri-flashlight-line" texto="Lançar" onClick={() => setTela('lancar')} />}
        {comTarefas && <Atalho icone="ri-task-line" texto="Tarefas" onClick={() => abrir('/tarefas')} />}
        {user && <Atalho icone="ri-sun-line" texto="Hoje" onClick={() => abrir('/hoje')} />}
      </footer>
    </div>
  );
}

function Secao({ titulo, n, cor, children }: { titulo: string; n: number; cor: string; children: React.ReactNode }) {
  return (
    <section className="overflow-hidden rounded-xl border border-zinc-200 bg-white">
      <h2 className={`flex items-center justify-between px-3 pb-1 pt-2.5 text-[11px] font-bold uppercase tracking-wide ${cor}`}>
        {titulo}<span className="rounded-full bg-zinc-100 px-1.5 text-[11px] text-zinc-600">{n}</span>
      </h2>
      <div className="divide-y divide-zinc-100">{children}</div>
    </section>
  );
}

function Mais({ texto, onClick }: { texto: string; onClick: () => void }) {
  return <button onClick={onClick} className="w-full cursor-pointer px-3 py-2 text-left text-xs font-bold text-amber-600 hover:bg-zinc-50">{texto}</button>;
}

function Atalho({ icone, texto, onClick }: { icone: string; texto: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex cursor-pointer flex-col items-center gap-0.5 rounded-lg py-1.5 text-zinc-600 hover:bg-amber-50 hover:text-amber-700">
      <i className={`${icone} text-lg`} /><span className="text-[11px] font-semibold">{texto}</span>
    </button>
  );
}

function LinhaAgora({ i, onAbrir }: { i: ItemHoje; onAbrir: () => void }) {
  return (
    <button onClick={onAbrir} className="flex w-full cursor-pointer items-start gap-2 px-3 py-2 text-left hover:bg-zinc-50">
      <i className={`mt-0.5 ${i.urgente ? 'ri-error-warning-fill text-red-500' : 'ri-arrow-right-circle-line text-amber-500'}`} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-semibold">{i.titulo}</p>
        <p className="truncate text-[11px] text-zinc-500">{[i.loja, i.detalhe, i.valor ? brl(i.valor) : null].filter(Boolean).join(' · ')}</p>
      </div>
    </button>
  );
}

function LinhaTarefa({ t, onAbrir, onConcluir, onAdiar }: {
  t: TaskRow; onAbrir: (caminho: string) => void; onConcluir: (t: TaskRow) => void; onAdiar?: (t: TaskRow) => void;
}) {
  const [indo, setIndo] = useState(false);
  return (
    <div className="group flex items-start gap-2 px-3 py-2 hover:bg-zinc-50">
      <button onClick={() => { setIndo(true); onConcluir(t); }} disabled={indo} title="Concluir"
        className="mt-0.5 cursor-pointer text-zinc-400 hover:text-emerald-600 disabled:opacity-40">
        <i className={indo ? 'ri-checkbox-circle-fill text-emerald-600' : 'ri-checkbox-blank-circle-line'} />
      </button>
      <button onClick={() => onAbrir(`/tarefas?task=${encodeURIComponent(t.id)}`)} className="min-w-0 flex-1 cursor-pointer text-left">
        <p className="truncate text-[13px] font-semibold">{t.title}</p>
        <p className="truncate text-[11px] text-zinc-500">{[rotuloPrazo(t), t.list_name].filter(Boolean).join(' · ')}</p>
      </button>
      {onAdiar && (
        <button onClick={() => { setIndo(true); onAdiar(t); }} disabled={indo} title="Adiar para amanhã"
          className="mt-0.5 hidden cursor-pointer text-xs text-zinc-400 hover:text-amber-600 group-hover:block">
          <i className="ri-skip-forward-line" />
        </button>
      )}
    </div>
  );
}

/** Vendas de hoje × meta: a mesma conta do Dashboard (pedidos pagos + iFood) e da tela Hoje. */
function VendasLinha({ onAbrir }: { onAbrir: () => void }) {
  const { data: m, reload } = useDashboardMetrics();
  const { data: painel } = useDashboardPainel(null);
  const [k, setK] = useState(0);
  const { data: ifDia } = useIfoodVendas('Hoje', null, k);
  const recarregar = useRef(reload);
  recarregar.current = reload;
  useEffect(() => {
    const t = setInterval(() => { recarregar.current(); setK((x) => x + 1); }, 5 * 60 * 1000);
    return () => clearInterval(t);
  }, []);
  const valor = (m?.faturamento_hoje ?? 0) + (ifDia?.total ?? 0);
  const diaSemana = painel?.dia_semana ?? new Date().getDay();
  const meta = (painel?.metas ?? []).find((x) => x.dia_semana === diaSemana && x.faturamento > 0) ?? null;
  const pct = meta ? valor / meta.faturamento : null;
  const esperado = (painel?.ritmo_dias ?? 0) < 2 ? null : painel?.ritmo_esperado ?? null;
  const atras = pct !== null && esperado !== null && pct < 1 && pct + 0.03 < esperado;
  return (
    <button onClick={onAbrir} className="block w-full cursor-pointer rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-left hover:border-amber-300">
      <div className="flex items-baseline justify-between">
        <span className="text-[11px] font-bold uppercase tracking-wide text-zinc-500">Vendas hoje</span>
        <span className="text-base font-bold tabular-nums">{brl(valor)}</span>
      </div>
      {pct !== null && (
        <>
          <div className="relative mt-1.5 h-1.5 rounded-full bg-zinc-100">
            <div className={`h-1.5 rounded-full ${pct >= 1 ? 'bg-emerald-500' : atras ? 'bg-red-400' : 'bg-amber-400'}`} style={{ width: `${Math.min(pct * 100, 100)}%` }} />
            {esperado !== null && <div className="absolute -top-0.5 h-2.5 w-0.5 bg-zinc-700" style={{ left: `${Math.min(esperado * 100, 100)}%` }} />}
          </div>
          <p className="mt-1 text-[11px] text-zinc-500">
            {(pct * 100).toFixed(0)}% da meta de {brl(meta!.faturamento)}
            {esperado !== null && pct < 1 && ` · esperado agora ${(esperado * 100).toFixed(0)}%`}
          </p>
        </>
      )}
    </button>
  );
}

/** Nome da loja no topo; quem tem mais de uma troca por aqui (só neste painel — a janela principal fica na dela). */
function LojaSeletor() {
  const { user, canSwitchTenant, selectTenant } = useAuth();
  const [lojas, setLojas] = useState<{ id: string; nome: string }[] | null>(null);
  const [trocando, setTrocando] = useState(false);
  useEffect(() => {
    if (!canSwitchTenant || !user?.id) return;
    let vivo = true;
    supabase.rpc('get_user_tenants', { p_user_id: user.id }).then(({ data }) => {
      if (!vivo) return;
      const l = ((data as { tenant_id: string; tenant_name: string }[]) ?? []).map((t) => ({ id: t.tenant_id, nome: t.tenant_name }));
      setLojas(l.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')));
    });
    return () => { vivo = false; };
  }, [canSwitchTenant, user?.id]);
  const [aberto, setAberto] = useState(false);
  const caixa = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => { if (!caixa.current?.contains(e.target as Node)) setAberto(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setAberto(false); };
    document.addEventListener('mousedown', fora);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', fora); document.removeEventListener('keydown', esc); };
  }, [aberto]);
  if (!user) return null;
  if (!canSwitchTenant || !lojas || lojas.length < 2) return <p className="truncate text-[11px] text-zinc-500">{user.loja}</p>;
  const trocar = async (id: string) => {
    setAberto(false);
    if (id === user.tenantId) return;
    setTrocando(true);
    try { await selectTenant(id); } finally { setTrocando(false); }
  };
  return (
    <div ref={caixa} className="relative">
      <button type="button" onClick={() => setAberto((a) => !a)} disabled={trocando} aria-haspopup="listbox" aria-expanded={aberto}
        className="flex max-w-full cursor-pointer items-center gap-0.5 text-[11px] font-semibold text-amber-700 hover:text-amber-800">
        <span className="truncate">{trocando ? 'Trocando…' : user.loja}</span>
        <i className={`ri-arrow-down-s-line flex-shrink-0 transition-transform ${aberto ? 'rotate-180' : ''}`} />
      </button>
      {aberto && (
        <div role="listbox" className="absolute left-0 top-full z-30 mt-1.5 max-h-80 w-64 overflow-y-auto rounded-xl border border-zinc-200 bg-white p-1 shadow-xl">
          <p className="px-2.5 pb-1 pt-1.5 text-[10px] font-bold uppercase tracking-wide text-zinc-400">Trocar de loja</p>
          {lojas.map((l) => {
            const atual = l.id === user.tenantId;
            return (
              <button key={l.id} type="button" role="option" aria-selected={atual} onClick={() => trocar(l.id)}
                className={`flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] ${atual ? 'bg-amber-50 font-semibold text-amber-800' : 'text-zinc-700 hover:bg-zinc-50'}`}>
                <span className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg ${atual ? 'bg-amber-100 text-amber-600' : 'bg-zinc-100 text-zinc-500'}`}>
                  <i className="ri-store-2-line text-sm" />
                </span>
                <span className="min-w-0 flex-1 truncate">{l.nome}</span>
                {atual && <i className="ri-check-line text-amber-600" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
