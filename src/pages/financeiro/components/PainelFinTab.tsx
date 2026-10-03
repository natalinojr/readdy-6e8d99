/**
 * Painel do Financeiro (2026-09-30): as quatro perguntas do dia, cada uma com o caminho para a aba
 * que responde em detalhe. Não tem cálculo próprio — reusa as mesmas fontes das abas:
 *  - Quanto tenho: useBankAccounts (aba Bancos), saldo do banco quando há integração (como a Projeção);
 *  - Quanto devo: useBillsPayable (aba Contas a Pagar), mesma regra de "em aberto" do selo do menu
 *    (pending/overdue/partial, vencida = vencimento antes de hoje), pelo saldo que falta pagar;
 *  - O mês: dreCaixaDoPeriodo (a mesma função da DRE) — recebido e CMV; o resultado fica na DRE;
 *  - O que falta: a caixa de Pendências (usePendencias), só os tipos de dinheiro, cada um com a rota dele.
 * Ao abrir (2026-10-01): busca o saldo do Inter na hora (inter-bank › sync, a mesma busca da Conciliação,
 * pulada se outra busca rodou há menos de 2 min); o botão Atualizar força a busca e recarrega os quatro cartões.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { invokeWithAuth } from '@/lib/supabase';
import { useBankAccounts, useBillsPayable } from '@/hooks/useFinanceiro';
import { usePendencias, kindConfig } from '@/contexts/PendenciasContext';
import { todayBrasilia, somarDias } from '@/lib/dateUtils';
import { dreCaixaDoPeriodo } from './DRETab';
import { mesExtenso } from './dreUi';

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const ddmm = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}`;
// Pendências que não são de dinheiro ficam fora do Painel (continuam na caixa de Pendências).
const FORA_DO_PAINEL = new Set(['tarefa_vencida', 'estoque_critico', 'recebimento_sem_nota', 'recebimento_parado', 'aprovacao', 'vendas_abaixo_ritmo', 'insumo_antes_do_pico']);

function Pergunta({ titulo, icone, acao, onAcao, destaque, children }: {
  titulo: string; icone: string; acao: string; onAcao: () => void; destaque?: 'red'; children: React.ReactNode;
}) {
  return (
    <div className={`bg-white rounded-2xl border flex flex-col ${destaque === 'red' ? 'border-red-200' : 'border-zinc-200'}`}>
      <div className="flex items-center gap-2 px-5 pt-4">
        <span className="w-7 h-7 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center"><i className={`${icone} text-sm`} /></span>
        <h3 className="text-sm font-bold text-zinc-800">{titulo}</h3>
      </div>
      <div className="px-5 py-3 flex-1 flex flex-col gap-2">{children}</div>
      <button onClick={onAcao} className="mx-5 mb-4 self-start text-xs font-semibold text-amber-600 hover:text-amber-700 flex items-center gap-1 cursor-pointer">
        {acao}<i className="ri-arrow-right-line" />
      </button>
    </div>
  );
}
function Linha({ rotulo, valor, cor }: { rotulo: string; valor: string; cor?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-zinc-500">{rotulo}</span>
      <span className={`font-semibold tabular-nums whitespace-nowrap ${cor ?? 'text-zinc-900'}`}>{valor}</span>
    </div>
  );
}
const Carregando = () => <div className="h-16 rounded-lg bg-zinc-100 animate-pulse" />;

export default function PainelFinTab({ onIrAba }: { onIrAba: (aba: string) => void }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { accounts, loading: carregandoContas, refresh: recarregarContas } = useBankAccounts();
  const { bills, loading: carregandoContasPagar, refresh: recarregarContasPagar } = useBillsPayable();
  const { abertas, recarregar: recarregarPendencias } = usePendencias();

  // Saldo real do banco: busca no Inter ao abrir (max_age_min evita repetir ao trocar de aba) e no botão (forçado).
  const [buscandoSaldo, setBuscandoSaldo] = useState(false);
  const [erroSaldo, setErroSaldo] = useState(false);
  const [versao, setVersao] = useState(0);
  const buscarSaldo = useCallback(async (forcar: boolean) => {
    if (!user?.tenantId) return;
    setBuscandoSaldo(true); setErroSaldo(false);
    const r = await invokeWithAuth<{ success?: boolean; error?: string }>('inter-bank', {
      body: { action: 'sync', tenant_id: user.tenantId, ...(forcar ? {} : { max_age_min: 2 }) },
    });
    const err = r.data?.error ?? r.error?.message;
    // Loja sem Inter integrado não é erro: só não há saldo do banco para buscar.
    if (err && !/não configurad|desativad|Configure a conta/i.test(err)) setErroSaldo(true);
    await recarregarContas();
    setBuscandoSaldo(false);
  }, [user?.tenantId, recarregarContas]);
  useEffect(() => { buscarSaldo(false); }, [buscarSaldo]);
  const atualizarTudo = () => {
    buscarSaldo(true);
    recarregarContasPagar();
    recarregarPendencias();
    setVersao((v) => v + 1);
  };

  // --- Quanto tenho
  const contas = accounts.filter((a) => a.is_active !== false);
  const saldoDe = (a: (typeof contas)[number]) => Number(a.synced_balance ?? a.current_balance ?? 0);
  const noBanco = contas.reduce((s, a) => s + saldoDe(a), 0);
  const divergentes = contas.filter((a) => a.synced_balance != null && Math.abs(Number(a.synced_balance) - Number(a.current_balance)) > 1);

  // --- Quanto devo
  const hoje = todayBrasilia();
  const em7 = somarDias(hoje, 7);
  const devo = useMemo(() => {
    const abertasCP = bills.filter((b) => ['pending', 'overdue', 'partial'].includes(b.status));
    const resta = (b: (typeof bills)[number]) => Math.max(0, Number(b.amount) - Number(b.paid_amount ?? 0));
    const soma = (l: typeof abertasCP) => l.reduce((s, b) => s + resta(b), 0);
    const vencidas = abertasCP.filter((b) => b.due_date < hoje);
    const semana = abertasCP.filter((b) => b.due_date >= hoje && b.due_date <= em7);
    const depois = abertasCP.filter((b) => b.due_date > em7);
    const proximas = [...semana, ...depois].sort((a, b) => a.due_date.localeCompare(b.due_date)).slice(0, 5)
      .map((b) => ({ id: b.id, data: b.due_date, nome: b.supplier || b.description, valor: resta(b) }));
    return {
      total: soma(abertasCP), n: abertasCP.length,
      vencidas: { n: vencidas.length, v: soma(vencidas) }, semana: { n: semana.length, v: soma(semana) }, depois: { n: depois.length, v: soma(depois) },
      proximas,
    };
  }, [bills, hoje, em7]);

  // --- O mês (mesma função da DRE, regime de caixa)
  const mes = hoje.slice(0, 7);
  const [dre, setDre] = useState<{ receita: number; cmv: number } | null>(null);
  const [erroDre, setErroDre] = useState(false);
  useEffect(() => {
    if (!user?.tenantId) return;
    let vivo = true;
    setDre(null); setErroDre(false);
    const inicio = `${mes}-01`;
    dreCaixaDoPeriodo(user.tenantId, inicio, hoje, user.tenantKind)
      .then((r) => { if (vivo) setDre({ receita: r.receita, cmv: r.cmv }); })
      .catch(() => { if (vivo) setErroDre(true); });
    return () => { vivo = false; };
  }, [user?.tenantId, user?.tenantKind, mes, hoje, versao]);

  // --- O que falta (caixa de Pendências, agrupada por tipo)
  const grupos = useMemo(() => {
    const m = new Map<string, { kind: string; n: number; rota: string | null; alta: boolean }>();
    for (const p of abertas) {
      if (FORA_DO_PAINEL.has(p.kind)) continue;
      const g = m.get(p.kind) ?? { kind: p.kind, n: 0, rota: p.rota, alta: false };
      g.n += 1; g.alta = g.alta || p.urgencia === 'alta'; g.rota = g.rota ?? p.rota;
      m.set(p.kind, g);
    }
    return [...m.values()].sort((a, b) => Number(b.alta) - Number(a.alta) || b.n - a.n);
  }, [abertas]);
  // A rota vem pronta da pendência (às vezes com ?busca=/&nota=); sem rota, abre a caixa de Pendências.
  const irPara = (rota: string | null) => navigate(rota || '/pendencias');

  return (
    <div className="p-4 md:p-6 flex flex-col gap-4 max-w-[1400px]">
      <div className="flex justify-end -mb-1">
        <button onClick={atualizarTudo} disabled={buscandoSaldo}
          className="text-xs font-semibold text-zinc-600 hover:text-zinc-900 bg-white border border-zinc-200 rounded-lg px-3 py-1.5 flex items-center gap-1.5 cursor-pointer disabled:opacity-60 disabled:cursor-default">
          <i className={`ri-refresh-line ${buscandoSaldo ? 'animate-spin' : ''}`} />
          {buscandoSaldo ? 'Atualizando…' : 'Atualizar'}
        </button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-4 gap-4">
        <Pergunta titulo="Quanto tenho?" icone="ri-bank-line" acao="Abrir Bancos e Contas" onAcao={() => onIrAba('bancos')}>
          {carregandoContas ? <Carregando /> : (<>
            <p className="text-2xl font-bold tabular-nums text-zinc-900">{brl(noBanco)}</p>
            {contas.map((a) => (
              <Linha key={a.id} rotulo={`${a.name}${a.synced_balance != null ? ' (pelo banco)' : ''}`} valor={brl(saldoDe(a))} cor={saldoDe(a) < 0 ? 'text-red-600' : undefined} />
            ))}
            {contas.length === 0 && <p className="text-xs text-zinc-400">Nenhuma conta bancária cadastrada.</p>}
            {(() => {
              const quando = contas.map((a) => a.synced_balance_at ?? '').filter(Boolean).sort().pop();
              if (buscandoSaldo) return <p className="text-[11px] text-zinc-400">Buscando o saldo no banco…</p>;
              if (erroSaldo) return <p className="text-[11px] text-amber-600">Não deu para buscar o saldo no banco agora{quando ? `; mostrando o de ${new Date(quando).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })}` : ''}.</p>;
              return quando ? <p className="text-[11px] text-zinc-400">Saldo do banco às {new Date(quando).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })} de {new Date(quando).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' })}.</p> : null;
            })()}
            {divergentes.map((a) => (
              <div key={a.id} className="rounded-lg bg-red-50 text-red-700 text-[11px] px-2.5 py-1.5 flex gap-1.5">
                <i className="ri-error-warning-line mt-px" />
                No sistema o {a.name} está com {brl(Number(a.current_balance))}: diferença de {brl(Number(a.synced_balance) - Number(a.current_balance))}.
              </div>
            ))}
          </>)}
        </Pergunta>

        <Pergunta titulo="Quanto devo?" icone="ri-bill-line" acao="Abrir Contas a Pagar" onAcao={() => onIrAba('pagar')} destaque={devo.vencidas.n > 0 ? 'red' : undefined}>
          {carregandoContasPagar ? <Carregando /> : (<>
            <p className="text-2xl font-bold tabular-nums text-zinc-900">{brl(devo.total)}</p>
            <Linha rotulo={`Vencidas (${devo.vencidas.n})`} valor={brl(devo.vencidas.v)} cor={devo.vencidas.n ? 'text-red-600' : undefined} />
            <Linha rotulo={`Próximos 7 dias (${devo.semana.n})`} valor={brl(devo.semana.v)} cor={devo.semana.n ? 'text-amber-600' : undefined} />
            <Linha rotulo={`Depois (${devo.depois.n})`} valor={brl(devo.depois.v)} />
            <p className="text-[11px] text-zinc-400">Saldo que falta pagar das {devo.n} contas em aberto.</p>
          </>)}
        </Pergunta>

        <Pergunta titulo={`Como está ${mesExtenso(mes).split(' ')[0].toLowerCase()}?`} icone="ri-pie-chart-2-line" acao="Ver o resultado na DRE" onAcao={() => onIrAba('dre')}>
          {erroDre ? <p className="text-xs text-zinc-400">Não deu para carregar agora.</p> : !dre ? <Carregando /> : (<>
            <p className="text-2xl font-bold tabular-nums text-zinc-900">{brl(dre.receita)}</p>
            <Linha rotulo="Recebido no mês" valor={brl(dre.receita)} />
            <Linha rotulo="Compras de mercadoria (CMV)" valor={brl(dre.cmv)} />
            {dre.receita > 0 && <Linha rotulo="CMV sobre o recebido" valor={`${((dre.cmv / dre.receita) * 100).toFixed(1).replace('.', ',')}%`} />}
            <p className="text-[11px] text-zinc-400">Mesma conta da DRE, pelo caixa, até hoje.</p>
          </>)}
        </Pergunta>

        <Pergunta titulo="O que falta resolver?" icone="ri-list-check-3" acao="Abrir a Trilha" onAcao={() => onIrAba('trilha')}>
          <p className="text-2xl font-bold tabular-nums text-zinc-900">
            {grupos.reduce((s, g) => s + g.n, 0)} <span className="text-sm font-semibold text-zinc-400">pendências</span>
          </p>
          <Linha rotulo="Urgentes" valor={String(grupos.filter((g) => g.alta).reduce((s, g) => s + g.n, 0))} cor="text-red-600" />
          <Linha rotulo="Tipos diferentes" valor={String(grupos.length)} />
          <p className="text-[11px] text-zinc-400">A lista está logo abaixo; o caminho completo de cada despesa fica na Trilha.</p>
        </Pergunta>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_380px] gap-4 items-start">
        <div className="bg-white rounded-2xl border border-zinc-200">
          <div className="px-5 py-3 border-b border-zinc-100">
            <h3 className="text-sm font-bold text-zinc-800">O que falta resolver</h3>
            <p className="text-xs text-zinc-400">Cada linha abre o lugar que resolve</p>
          </div>
          {grupos.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-zinc-400">Nada pendente no financeiro.</p>
          ) : (
            <div className="divide-y divide-zinc-100">
              {grupos.map((g) => {
                const cfg = kindConfig(g.kind);
                return (
                  <button key={g.kind} onClick={() => irPara(g.rota)} className="w-full text-left px-5 py-3 flex items-center gap-3 hover:bg-zinc-50/70 cursor-pointer">
                    <span className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${cfg.corBg} ${cfg.corTexto}`}><i className={cfg.icone} /></span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-semibold text-zinc-800">{cfg.label}</span>
                      <span className="block text-xs text-zinc-400">{g.n} {g.n === 1 ? 'item' : 'itens'}{g.alta ? ' · urgente' : ''}</span>
                    </span>
                    {g.alta && <span className="w-2 h-2 rounded-full bg-red-500" />}
                    <i className="ri-arrow-right-s-line text-zinc-300 text-lg" />
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="bg-white rounded-2xl border border-zinc-200">
          <div className="px-5 py-3 border-b border-zinc-100">
            <h3 className="text-sm font-bold text-zinc-800">Vence nos próximos dias</h3>
          </div>
          {carregandoContasPagar ? <div className="p-5"><Carregando /></div> : devo.proximas.length === 0 ? (
            <p className="px-5 py-6 text-sm text-zinc-400">Nenhuma conta a vencer.</p>
          ) : (
            <div className="divide-y divide-zinc-100">
              {devo.proximas.map((p) => (
                <div key={p.id} className="px-5 py-2.5 flex items-center gap-3 text-sm">
                  <span className="text-xs text-zinc-400 w-10 flex-shrink-0">{ddmm(p.data)}</span>
                  <span className="flex-1 truncate text-zinc-700">{p.nome}</span>
                  <b className="tabular-nums">{brl(p.valor)}</b>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
