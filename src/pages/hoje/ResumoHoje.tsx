// Resumo do topo da tela Hoje (2026-10-03). Números SEMPRE da mesma conta das outras telas:
//   faturamento de hoje = Dashboard (fn_get_dashboard_metrics + iFood do dia da loja), com o cartão do próprio Dashboard;
//   "no banco" / "vence em 7 dias" = Financeiro › Painel (saldo das contas ativas; contas em aberto
//   pending/overdue/partial, saldo = valor − pago, vencida se antes de hoje em Brasília);
//   loja aberta/fechada = a mesma sessão do topo (SessaoContext).
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useSessao } from '@/contexts/SessaoContext';
import { useDashboardMetrics } from '@/hooks/useDashboardMetrics';
import { useDashboardPainel } from '@/hooks/useDashboardPainel';
import { useIfoodDiaLoja } from '@/hooks/useIfoodDiaLoja';
import { useLojaTemIfood } from '@/hooks/useLojaTemIfood';
import { useIfoodDados } from '@/pages/ifood/lib/useIfoodDados';
import { useBankAccounts } from '@/hooks/useFinanceiro';
import { todayBrasilia, somarDias } from '@/lib/dateUtils';
import FaturamentoHero from '@/pages/dashboard/components/FaturamentoHero';

const brl = (n: number) => Number(n ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** Faturamento de hoje da loja ativa, no cartão do Dashboard (com o círculo claro no canto). */
export function VendasHoje() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { data: m, reload } = useDashboardMetrics();
  const { data: painel, reload: reloadPainel } = useDashboardPainel(null);
  const [k, setK] = useState(0);
  // Dia da loja: as sessões de caixa abertas hoje (a que passa da meia-noite conta no dia em que abriu).
  const { data: ifDia } = useIfoodDiaLoja(user?.tenantId, painel?.dia, painel?.janelas, null, k);
  // Confere de novo a cada 5 min com a tela visível (o Dashboard é que acompanha pedido a pedido).
  // O painel (dia da loja + sessões) vem junto: o dia vira quando a sessão fecha ou a tela volta no dia seguinte.
  useEffect(() => {
    const atualizar = () => { reload(); reloadPainel(true); setK((x) => x + 1); };
    const t = setInterval(() => { if (!document.hidden) atualizar(); }, 5 * 60 * 1000);
    const aoVoltar = () => { if (!document.hidden) atualizar(); };
    document.addEventListener('visibilitychange', aoVoltar);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', aoVoltar); };
  }, [reload, reloadPainel]);
  const valor = (m?.faturamento_hoje ?? 0) + (ifDia?.total ?? 0);
  const diaSemana = painel?.dia_semana ?? new Date().getDay();
  const meta = (painel?.metas ?? []).find((x) => x.dia_semana === diaSemana && (x.faturamento > 0 || x.pedidos > 0 || x.ticket > 0)) ?? null;
  const horaAgora = `${Number(new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', hour12: false }).slice(0, 2))}h`;
  const outroDia = !!painel?.dia && painel.dia !== todayBrasilia();
  const titulo = outroDia ? `Faturamento do dia ${painel!.dia.slice(8, 10)}/${painel!.dia.slice(5, 7)}` : 'Faturamento hoje';
  return (
    <FaturamentoHero
      titulo={`${titulo}${user?.loja ? ` · ${user.loja}` : ''}`}
      ajuda="A mesma conta do Dashboard: a soma das sessões de caixa abertas hoje (a que passa da meia-noite conta no dia em que abriu) + vendas do iFood. Toque em Dashboard para ver por canal e por hora."
      valor={valor}
      rotuloSemana=""
      meta={meta}
      diaSemana={diaSemana}
      ritmoEsperado={(painel?.ritmo_dias ?? 0) < 2 ? null : painel?.ritmo_esperado ?? null}
      horaAgora={horaAgora}
      podeEditarMetas={false}
      onEditarMetas={() => navigate('/dashboard')}
    />
  );
}

/**
 * Uma linha discreta: "iFood ontem: 14 pedidos, R$ 820,00 vendidos, sobraram R$ 310,00" (toque leva a /ifood).
 * A sobra só entra com o valor de TODOS os pedidos de ontem conhecido (comida de cada item pela ficha) e para
 * quem vê dinheiro do iFood (fin_ifood ou rel_ifood); senão fica de fora. Só em loja com iFood; quem chama
 * confere o acesso à tela /ifood. Mesmos números da área iFood (useIfoodDados, período "Ontem").
 */
export function IfoodOntem({ verDinheiro }: { verDinheiro: boolean }) {
  const { user } = useAuth();
  const temIfood = useLojaTemIfood(user?.tenantId);
  if (temIfood !== true || !user?.tenantId) return null;
  return <IfoodOntemLinha tenantId={user.tenantId} verDinheiro={verDinheiro} />;
}

function IfoodOntemLinha({ tenantId, verDinheiro }: { tenantId: string; verDinheiro: boolean }) {
  const navigate = useNavigate();
  const { pedidos, carregando, erro } = useIfoodDados(tenantId, 'Ontem');
  if (carregando) return null;
  const validos = pedidos.filter((p) => !p.cancelado && !p.order?.teste);
  // Erro de leitura sem nenhum pedido: melhor sem a linha do que dizer "nenhum pedido" errado
  if (erro && validos.length === 0) return null;
  const vendido = validos.reduce((s, p) => s + p.venda, 0);
  const sobras = validos.map((p) => p.sobra);
  const sobra = verDinheiro && validos.length > 0 && sobras.every((x): x is number => x != null) ? sobras.reduce((s, x) => s + x, 0) : null;
  const texto = validos.length === 0
    ? 'iFood ontem: nenhum pedido'
    : `iFood ontem: ${validos.length} ${validos.length === 1 ? 'pedido' : 'pedidos'}, ${brl(vendido)} vendidos${sobra != null ? `, ${sobra >= 0 ? 'lucro bruto de' : 'prejuízo de'} ${brl(Math.abs(sobra))}` : ''}`;
  return (
    <button onClick={() => navigate('/ifood')} title="Abrir a área do iFood"
      className="w-full flex items-center gap-2.5 rounded-2xl border border-zinc-200 bg-white px-3.5 py-2.5 text-left hover:border-zinc-300 cursor-pointer">
      <i className="ri-store-2-line text-base text-[#EA1D2C] flex-shrink-0" />
      <span className="flex-1 min-w-0 text-[13px] text-zinc-600 leading-snug">{texto}</span>
      <i className="ri-arrow-right-s-line text-zinc-400 flex-shrink-0" />
    </button>
  );
}

/** Quanto tem no banco × quanto vence até a próxima semana (loja ativa). Só quem vê o financeiro. */
export function DinheiroHoje() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { accounts, loading, error: erroBanco } = useBankAccounts();
  const [devo, setDevo] = useState<{ vencidas: number; semana: number } | null>(null);
  const [erroDevo, setErroDevo] = useState(false);
  useEffect(() => {
    if (!user?.tenantId) return;
    setDevo(null); setErroDevo(false);
    const hoje = todayBrasilia();
    const em7 = somarDias(hoje, 7);
    supabase.from('fin_accounts_payable').select('amount, paid_amount, due_date, status')
      .eq('tenant_id', user.tenantId).in('status', ['pending', 'overdue', 'partial']).lte('due_date', em7).limit(1000)
      .then(({ data, error }) => {
        if (error) { setErroDevo(true); return; }
        const resta = (b: { amount: number; paid_amount: number | null }) => Math.max(0, Number(b.amount) - Number(b.paid_amount ?? 0));
        const linhas = (data ?? []) as Array<{ amount: number; paid_amount: number | null; due_date: string }>;
        setDevo({
          vencidas: linhas.filter((b) => b.due_date < hoje).reduce((s, b) => s + resta(b), 0),
          semana: linhas.filter((b) => b.due_date >= hoje).reduce((s, b) => s + resta(b), 0),
        });
      });
  }, [user?.tenantId]);
  const contas = accounts.filter((a) => a.is_active !== false);
  const noBanco = contas.reduce((s, a) => s + Number(a.synced_balance ?? a.current_balance ?? 0), 0);
  const precisa = devo ? devo.vencidas + devo.semana : 0;
  const daPara = devo != null && !loading && !erroBanco && noBanco >= precisa;
  return (
    <button onClick={() => navigate('/financeiro')}
      className="w-full text-left rounded-2xl border border-zinc-200 bg-white p-4 grid grid-cols-2 gap-3 hover:border-zinc-300 cursor-pointer">
      <div>
        <p className="text-xs font-semibold text-zinc-500">No banco{user?.loja ? ` · ${user.loja}` : ''}</p>
        <p className="text-lg font-bold text-zinc-900 tabular-nums mt-0.5">{loading ? '…' : erroBanco ? '—' : brl(noBanco)}</p>
        <p className="text-[11px] text-zinc-400">{erroBanco ? 'não consegui ler o saldo' : contas.length === 1 ? contas[0].name : `${contas.length} contas`}</p>
      </div>
      <div>
        <p className="text-xs font-semibold text-zinc-500">Vencidas + próximos 7 dias</p>
        <p className="text-lg font-bold text-zinc-900 tabular-nums mt-0.5">{erroDevo ? '—' : devo ? brl(precisa) : '…'}</p>
        {devo && devo.vencidas > 0 && <p className="text-[11px] text-red-600 font-semibold">{brl(devo.vencidas)} já venceram</p>}
        {daPara && precisa > 0 && <span className="inline-flex items-center gap-1 mt-1 px-1.5 py-0.5 rounded-md bg-emerald-50 text-emerald-700 text-[11px] font-semibold"><i className="ri-check-line" />dá para pagar</span>}
      </div>
    </button>
  );
}

/** Loja aberta/fechada (sessão do dia da loja ativa), com o botão que leva ao caixa. */
export function LojaHoje({ comBotao }: { comBotao: boolean }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { estado, sessao, caixa, loadingSession } = useSessao();
  if (loadingSession) return null;
  const aberta = estado !== 'sem_sessao';
  return (
    <div className="relative overflow-hidden rounded-2xl border border-zinc-200 bg-white p-4">
      <div className={`absolute -right-10 -top-10 w-40 h-40 rounded-full pointer-events-none ${aberta ? 'bg-emerald-50' : 'bg-zinc-50'}`} />
      <div className="relative flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-zinc-500 truncate">{user?.loja ?? 'Loja'}</p>
          <p className={`text-xl font-bold mt-0.5 ${aberta ? 'text-emerald-700' : 'text-zinc-800'}`}>{aberta ? 'Loja aberta' : 'Loja fechada'}</p>
          <p className="text-xs text-zinc-500 mt-0.5">
            {aberta
              ? `desde ${sessao?.iniciadaEm ?? '—'}${caixa ? ` · caixa com ${caixa.operadorNome}` : ' · caixa ainda não aberto'}`
              : 'O dia começa abrindo a loja no caixa.'}
          </p>
        </div>
        {comBotao && (
          <button onClick={() => navigate('/pdv/caixa')}
            className={`flex-shrink-0 h-11 px-4 rounded-xl text-sm font-bold cursor-pointer ${aberta ? 'border border-zinc-200 text-zinc-700 hover:bg-zinc-50' : 'bg-amber-500 hover:bg-amber-400 text-zinc-900'}`}>
            {aberta ? 'Ir para o caixa' : 'Abrir a loja'}
          </button>
        )}
      </div>
    </div>
  );
}
