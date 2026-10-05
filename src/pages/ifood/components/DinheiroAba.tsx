import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase, invokeWithAuth } from '@/lib/supabase';
import { fetchAllRows } from '@/lib/fetchAllRows';
import { getPeriodDates, somarDias, todayBrasilia } from '@/lib/dateUtils';
import { culpaCancelamento, motivoCurto, resumir } from '@/lib/ifoodDashboard';
import { btn, brl, CartaoAcao, CartaoBarra, Etiqueta, Nota, SecaoTitulo, Vazio } from '@/components/kit';
import IfoodConfigModal from '@/pages/financeiro/components/conciliacao/IfoodConfigModal';
import IfoodTab from '@/pages/financeiro/components/IfoodTab';
import type { AbaProps } from '../lib/tipos';
import {
  dividirDescontos, dividirPor100, fraseRepasses, resumoRepasses, situacaoRepasse,
  type RepasseRow, type SituacaoRepasse,
} from '../lib/dinheiro';
import { rotuloPeriodo } from './PeriodoFolha';

// Aba Dinheiro da área iFood (protótipo docs/prototipos/ifood-proposta.html › Dinheiro).
// Os números e regras vêm da tela antiga (Financeiro › iFood): repasses só os de REPASSE, conferência com o
// Inter pela RPC fin_ifood_repasses, "Lançar no financeiro" pela edge ifood-financial (set_options).
// A tela antiga inteira continua em "Ver tudo", então nada some.

const SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

const dm = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}`;
const diaSemana = (ymd: string) => {
  const [y, m, d] = ymd.split('-').map(Number);
  return SEMANA[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
};
const pct = (v: number, casas = 0) => `${v.toFixed(casas).replace('.', ',')}%`;
const brl0 = (v: number) => brl(v, 0);

/** "Este mês" / "Últimos 30 dias" / "Setembro" para abrir a frase. */
function inicioDaFrase(periodo: string): string {
  if (periodo === '30 dias' || periodo === '30d') return 'Nos últimos 30 dias';
  if (periodo === '7 dias' || periodo === '7d') return 'Nos últimos 7 dias';
  const t = rotuloPeriodo(periodo);
  return t.startsWith('custom') ? 'No período' : t;
}

const ROTULO_SITUACAO: Record<SituacaoRepasse, { tom: 'green' | 'red' | 'amber' | 'zinc'; texto: (diff: number) => string }> = {
  bateu: { tom: 'green', texto: () => 'bateu' },
  faltou: { tom: 'red', texto: (d) => `faltou ${brl(Math.abs(d))}` },
  sobrou: { tom: 'amber', texto: (d) => `sobrou ${brl(Math.abs(d))}` },
  nao_achou: { tom: 'red', texto: () => 'não achei no banco' },
  previsto: { tom: 'zinc', texto: () => 'previsto' },
  sem_conta: { tom: 'zinc', texto: () => 'sem extrato do banco' },
};

export default function DinheiroAba({ tenantId, loja, periodo, acesso, dados, abrirPedido }: AbaProps) {
  const [params] = useSearchParams();
  const verCancelados = params.get('ver') === 'cancelados';
  const hoje = todayBrasilia();
  const { diaIni, diaFim } = useMemo(() => {
    const d = getPeriodDates(periodo);
    return { diaIni: d.from.slice(0, 10), diaFim: d.to.slice(0, 10) };
  }, [periodo]);

  const fin = useMemo(() => dados.fin.filter((p) => !loja || p.loja === loja), [dados.fin, loja]);
  const r = useMemo(() => resumir(fin), [fin]);
  const por100 = useMemo(() => dividirPor100(r), [r]);
  const descontos = useMemo(() => dividirDescontos(r), [r]);
  const numeroDoPedido = useMemo(() => new Map(dados.orders.map((o) => [o.id, o.numero])), [dados.orders]);

  // ── Repasses × banco ──
  const [repasses, setRepasses] = useState<RepasseRow[]>([]);
  const [erroRepasses, setErroRepasses] = useState<string | null>(null);
  const [aberto, setAberto] = useState<string | null>(null);
  const [todos, setTodos] = useState(false);
  const carregarRepasses = useCallback(async () => {
    if (!tenantId) return;
    // Mais 7 dias à frente: o repasse seguinte (previsto) cai na próxima quarta.
    const ate = somarDias(diaFim < hoje ? hoje : diaFim, 7);
    // Começo do mês tem 1 repasse só: mostra pelo menos as últimas 4 semanas.
    const de = diaIni < somarDias(hoje, -28) ? diaIni : somarDias(hoje, -28);
    const { data, error } = await supabase.rpc('fin_ifood_repasses', { p_tenant: tenantId, p_from: de, p_to: ate });
    if (error) { setErroRepasses(error.message); setRepasses([]); return; }
    setErroRepasses(null);
    setRepasses(((data ?? []) as RepasseRow[]).map((x) => ({ ...x, esperado: Number(x.esperado), recebido_inter: Number(x.recebido_inter) })));
  }, [tenantId, diaIni, diaFim, hoje]);
  useEffect(() => { carregarRepasses(); }, [carregarRepasses]);

  const repassesOrd = useMemo(() => [...repasses].sort((a, b) => a.data_repasse.localeCompare(b.data_repasse)), [repasses]);
  const resumoRep = useMemo(() => resumoRepasses(repasses, hoje), [repasses, hoje]);
  const fraseRep = fraseRepasses(resumoRep);
  const passados = useMemo(
    () => repassesOrd.filter((x) => situacaoRepasse(x, hoje).situacao !== 'previsto').reverse(),
    [repassesOrd, hoje],
  );

  // ── Cancelamentos e ressarcimentos ──
  const [verLista, setVerLista] = useState(false);
  const cancel = useMemo(() => {
    const cs = fin.filter((p) => p.cancelado).sort((a, b) => b.at.getTime() - a.at.getTime());
    const devolvidos = fin.filter((p) => p.ajustes > 0.005);
    const semRessarcimento = cs.filter((p) => p.ajustes <= 0.005 && !!p.motivo && culpaCancelamento(p.motivo) !== 'loja');
    return {
      lista: cs,
      n: cs.length,
      perdido: cs.reduce((s, p) => s + p.bruto, 0),
      nDevolvidos: devolvidos.length,
      devolvido: devolvidos.reduce((s, p) => s + p.ajustes, 0),
      semRessarcimento,
      valorSemRessarcimento: semRessarcimento.reduce((s, p) => s + p.bruto, 0),
    };
  }, [fin]);
  useEffect(() => {
    if (!verCancelados || dados.carregando) return;
    setVerLista(true);
    const t = setTimeout(() => document.getElementById('cancelados')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
    return () => clearTimeout(t);
  }, [verCancelados, dados.carregando]);

  // ── Lançando no financeiro ──
  const [lancando, setLancando] = useState<boolean | null>(null);
  const [modoTeste, setModoTeste] = useState(false);
  const [temImportacao, setTemImportacao] = useState(false);
  const [salvandoLanc, setSalvandoLanc] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const carregarConfig = useCallback(() => {
    if (!tenantId) return;
    invokeWithAuth<{ config?: { post_to_ledger?: boolean; homologation_mode?: boolean } | null }>('ifood-financial', { body: { action: 'get_config', tenant_id: tenantId } })
      .then((c) => {
        const cfg = c.data?.config;
        if (!cfg) return;
        setLancando(cfg.post_to_ledger === true);
        setModoTeste(cfg.homologation_mode === true);
      });
    supabase.from('fin_ifood_imports').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId)
      .then(({ count }) => setTemImportacao((count ?? 0) > 0));
  }, [tenantId]);
  useEffect(() => { carregarConfig(); }, [carregarConfig]);

  const alternarLancamento = async () => {
    if (lancando == null) return;
    setSalvandoLanc(true);
    setErro(null);
    const res = await invokeWithAuth<{ success?: boolean; error?: string }>('ifood-financial', { body: { action: 'set_options', tenant_id: tenantId, post_to_ledger: !lancando } });
    setSalvandoLanc(false);
    if (res.data?.error || res.error) { setErro(res.data?.error ?? res.error?.message ?? 'Não consegui salvar.'); return; }
    setLancando(!lancando);
  };

  // ── Ações do fim ──
  const [verTudo, setVerTudo] = useState(false);
  const [importar, setImportar] = useState(false);
  const [baixando, setBaixando] = useState(false);
  const competencia = diaFim.slice(0, 7);
  const nomeMes = MESES[Number(competencia.slice(5, 7)) - 1] ?? competencia;

  // Planilha do mês: as colunas originais do relatório do iFood (mesmo caminho da tela antiga).
  const baixarPlanilha = async () => {
    setBaixando(true);
    setErro(null);
    const { rows, error } = await fetchAllRows<{ raw: Record<string, unknown> | null }>((from, ate) => {
      let q = supabase.from('fin_ifood_entries').select('raw').eq('tenant_id', tenantId).eq('competence', competencia);
      if (loja) q = q.eq('merchant_id', loja);
      return q.order('id', { ascending: true }).range(from, ate);
    }, { maxRows: 50000 });
    setBaixando(false);
    if (error) { setErro(error.message); return; }
    const raws = rows.map((x) => x.raw ?? {});
    if (raws.length === 0) { setErro(`Não tenho o relatório de ${nomeMes} para baixar. Importe o relatório do Portal.`); return; }
    const cols = Object.keys(raws[0]);
    const cel = (v: unknown) => { const s = v === null || v === undefined ? '' : String(v); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const csv = '﻿' + [cols.join(';'), ...raws.map((x) => cols.map((c) => cel(x[c])).join(';'))].join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url; a.download = `conciliacao-ifood-${competencia}${loja ? '-' + loja.slice(0, 8) : ''}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const depoisDeImportar = () => { dados.recarregar(); carregarRepasses(); carregarConfig(); };

  if (!acesso.financeiro) return null;

  const incluiHoje = diaFim >= somarDias(hoje, -1);
  const lanc = lancando;

  return (
    <div className="space-y-4">
      {dados.carregando ? (
        <div className="flex items-center justify-center py-16">
          <div className="w-6 h-6 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (dados.semDinheiro || fin.length === 0) ? (
        <Vazio icone="ri-money-dollar-circle-line" titulo={dados.semDinheiro ? 'Não consegui abrir o dinheiro do iFood' : 'Sem dinheiro do iFood neste período'}
          acao={<>
            <button type="button" onClick={() => setImportar(true)} className={btn('p', 'sm')}><i className="ri-upload-2-line" /> Importar relatório do Portal</button>
            <button type="button" onClick={() => setVerTudo(true)} className={btn('out', 'sm')}>Ver tudo</button>
          </>}>
          {dados.semDinheiro
            ? 'Tente de novo em alguns minutos. Se continuar, importe o relatório do Portal do Parceiro.'
            : 'O dinheiro chega com o relatório do iFood. Se a conexão não está ligada, importe o relatório do Portal do Parceiro.'}
        </Vazio>
      ) : (
        <>
          {/* Frase */}
          <div>
            <h2 className="text-[22px] md:text-2xl font-extrabold tracking-tight text-zinc-900 leading-tight">
              {inicioDaFrase(periodo)}: vendeu {brl0(r.vendas)}, chegaram {brl0(r.liquido)}
            </h2>
            <p className="text-sm text-zinc-500 mt-1">
              O iFood ficou com <b className="text-zinc-800">{pct(r.custoPct)}</b>.
              {fraseRep && <> <span className={resumoRep.problemas > 0 ? 'text-red-600 font-bold' : ''}>{fraseRep}</span></>}
            </p>
          </div>

          {incluiHoje && (
            <Nota>Os pedidos de hoje e de ontem ainda são estimados: o iFood fecha as taxas no dia seguinte, então o que chega pode mudar um pouco.</Nota>
          )}

          <div className="grid lg:grid-cols-2 gap-4 items-start">
            <div className="space-y-4">
              {/* De cada R$ 100 */}
              {por100 && (
                <div className="bg-white border border-zinc-200 rounded-2xl px-4 py-3.5">
                  <p className="text-[15px] font-extrabold text-zinc-900">De cada R$ 100 vendidos</p>
                  <div className="flex h-8 rounded-xl overflow-hidden bg-zinc-100 mt-2.5 text-[11.5px] font-extrabold text-white">
                    <div className="flex items-center px-2 whitespace-nowrap overflow-hidden" style={{ width: `${por100.chegaBarra}%`, background: '#16A34A' }}
                      title={`Chega na loja: ${brl(por100.chega100)}`}>
                      {por100.chegaBarra >= 22 ? `R$ ${por100.chega100.toFixed(0)} chegam` : ''}
                    </div>
                    {por100.partes.map((p) => (
                      <div key={p.id} className="flex items-center justify-center overflow-hidden" style={{ width: `${p.barra}%`, background: p.cor }} title={`${p.nome}: ${brl(p.v100)}`}>
                        {p.barra >= 7 ? p.v100.toFixed(0) : ''}
                      </div>
                    ))}
                  </div>
                  <dl className="mt-3 space-y-1.5 text-[13px]">
                    {por100.partes.map((p) => (
                      <div key={p.id} className="flex items-center gap-2">
                        <i className="w-2.5 h-2.5 rounded-full flex-none" style={{ background: p.cor }} />
                        <dt className="flex-1 min-w-0 text-zinc-600">{p.nome}</dt>
                        <dd className="font-extrabold tabular-nums text-zinc-900">{brl(p.v100)}</dd>
                      </div>
                    ))}
                    {por100.devolveu100 > 0.005 && (
                      <div className="flex items-center gap-2">
                        <i className="w-2.5 h-2.5 rounded-full flex-none bg-white border-2 border-emerald-500" />
                        <dt className="flex-1 min-w-0 text-zinc-600">O iFood devolveu (ressarcimentos e ajustes)</dt>
                        <dd className="font-extrabold tabular-nums text-emerald-700">+ {brl(por100.devolveu100)}</dd>
                      </div>
                    )}
                    <div className="flex items-center gap-2 border-t border-zinc-100 pt-1.5">
                      <i className="w-2.5 h-2.5 rounded-full flex-none" style={{ background: '#16A34A' }} />
                      <dt className="flex-1 min-w-0 font-extrabold text-zinc-900">Chega na loja</dt>
                      <dd className="font-extrabold tabular-nums text-emerald-700">{brl(por100.chega100)}</dd>
                    </div>
                  </dl>
                  {por100.promoIfood > 0.005 && (
                    <p className="text-[12px] text-zinc-500 mt-2.5">Promoções pagas pelo iFood (não saem do seu bolso): <b className="text-zinc-800">{brl(por100.promoIfood)}</b></p>
                  )}
                  {por100.devolveu100 > 0.005 && (
                    <p className="text-[11px] text-zinc-400 mt-1">A barra já desconta o que o iFood devolveu, para fechar em 100.</p>
                  )}
                </div>
              )}

              {/* Descontos */}
              <div>
                <SecaoTitulo titulo="Descontos" sub="dados aos clientes" />
                {descontos.total < 0.005 ? (
                  <Nota>Nenhum desconto para clientes neste período.</Nota>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    <CartaoBarra cor="amber">
                      <p className="text-[11px] font-bold text-zinc-400">Pago pela loja</p>
                      <p className="text-lg font-extrabold tabular-nums text-zinc-900">{brl(descontos.loja)}</p>
                      <p className="text-[11.5px] text-zinc-500">{pct(descontos.pctLoja, 1)} das vendas · sai do que chega</p>
                    </CartaoBarra>
                    <CartaoBarra cor="green">
                      <p className="text-[11px] font-bold text-zinc-400">Pago pelo iFood</p>
                      <p className="text-lg font-extrabold tabular-nums text-zinc-900">{brl(descontos.ifood)}</p>
                      <p className="text-[11.5px] text-zinc-500">{pct(descontos.pctIfood, 1)} das vendas · não sai do seu bolso</p>
                    </CartaoBarra>
                  </div>
                )}
              </div>
            </div>

            {/* Repasses */}
            <div>
              <SecaoTitulo titulo="Repasses" sub="o que o iFood paga × o que caiu no banco" />
              {erroRepasses && <p className="text-xs text-red-600 mb-2">Não consegui conferir com o banco: {erroRepasses}</p>}
              {repassesOrd.length === 0 && !erroRepasses ? (
                <Nota>Sem repasses neste período.</Nota>
              ) : (
                <>
                  <div className="flex gap-2 overflow-x-auto scrollbar-hide -mx-4 px-4 md:mx-0 md:px-0 pb-1">
                    {repassesOrd.slice(-8).map((x) => {
                      const s = situacaoRepasse(x, hoje);
                      const ok = s.situacao === 'bateu';
                      const ruim = s.situacao === 'faltou' || s.situacao === 'sobrou' || s.situacao === 'nao_achou';
                      const previsto = s.situacao === 'previsto';
                      return (
                        <div key={x.data_repasse}
                          className={`flex-none min-w-[88px] rounded-xl px-2.5 py-2 border ${ok ? 'bg-emerald-50 border-emerald-200' : ruim ? 'bg-red-50 border-red-200' : 'bg-white border-dashed border-zinc-300'}`}>
                          <small className="block text-[10.5px] font-bold text-zinc-500 whitespace-nowrap">{diaSemana(x.data_repasse)} {dm(x.data_repasse)}</small>
                          <b className="block text-[15px] font-extrabold tabular-nums text-zinc-900">{brl0(x.esperado)}{ok && <span className="text-emerald-600"> ✓</span>}</b>
                          {previsto && <small className="block text-[10px] font-bold text-zinc-400">previsto</small>}
                        </div>
                      );
                    })}
                  </div>
                  <p className="text-[12px] text-zinc-500 mt-1.5">
                    {resumoRep.bateram > 0 && <span className="text-emerald-700 font-extrabold">✓ caiu no banco</span>}
                    {resumoRep.proximo && <>{resumoRep.bateram > 0 ? ' · ' : ''}o de {dm(resumoRep.proximo.data_repasse)} é previsão.</>}
                  </p>

                  {passados.length > 0 && (
                    <div className="bg-white border border-zinc-200 rounded-2xl mt-2.5 divide-y divide-zinc-100">
                      {(todos ? passados : passados.slice(0, 5)).map((x) => {
                        const s = situacaoRepasse(x, hoje);
                        const rot = ROTULO_SITUACAO[s.situacao];
                        const abre = aberto === x.data_repasse;
                        const dep = x.detalhe?.ifood ?? [];
                        const cre = x.detalhe?.inter ?? [];
                        return (
                          <div key={x.data_repasse}>
                            <button type="button" onClick={() => setAberto(abre ? null : x.data_repasse)} className="w-full text-left flex items-center gap-3 px-3 py-2.5 cursor-pointer">
                              <span className={`w-8 h-8 rounded-xl flex items-center justify-center flex-none ${s.situacao === 'bateu' ? 'bg-emerald-100 text-emerald-700' : s.situacao === 'sem_conta' ? 'bg-zinc-100 text-zinc-500' : 'bg-red-100 text-red-600'}`}><i className="ri-bank-line" /></span>
                              <span className="flex-1 min-w-0">
                                <b className="block text-[13.5px] font-extrabold text-zinc-900">{diaSemana(x.data_repasse)} {dm(x.data_repasse)} · {brl(x.esperado)}</b>
                                <span className="block text-[11.5px] text-zinc-400">
                                  {s.situacao === 'sem_conta' ? 'Esta conta do iFood não tem extrato do banco para conferir' : `Caiu no banco: ${x.linhas_inter === 0 ? '—' : brl(x.recebido_inter)}`}
                                </span>
                              </span>
                              <Etiqueta tom={rot.tom}>{rot.texto(s.diff)}</Etiqueta>
                            </button>
                            {abre && (
                              <div className="px-3 pb-3 grid sm:grid-cols-2 gap-3 text-xs">
                                <div>
                                  <p className="font-bold text-zinc-700 mb-1">O iFood informou</p>
                                  {dep.length === 0 && <p className="text-zinc-400">Sem detalhe.</p>}
                                  {dep.map((d, i) => (
                                    <div key={i} className="flex justify-between border-t border-zinc-100 py-0.5"><span>{d.metodo || '—'}</span><span className="tabular-nums">{brl(Number(d.valor))}</span></div>
                                  ))}
                                  {Number(x.detalhe?.antecipacao ?? 0) > 0 && (
                                    <>
                                      <div className="flex justify-between border-t border-zinc-200 py-0.5 mt-1"><span>Antes da antecipação</span><span className="tabular-nums">{brl(Number(x.detalhe?.bruto ?? 0))}</span></div>
                                      <div className="flex justify-between border-t border-zinc-100 py-0.5 text-red-600"><span>Taxa de antecipação</span><span className="tabular-nums">− {brl(Number(x.detalhe?.antecipacao))}</span></div>
                                    </>
                                  )}
                                </div>
                                <div>
                                  <p className="font-bold text-zinc-700 mb-1">Caiu no banco</p>
                                  {cre.length === 0 && <p className="text-zinc-400">Nada ainda.</p>}
                                  {cre.map((d, i) => (
                                    <div key={i} className="flex justify-between gap-2 border-t border-zinc-100 py-0.5"><span className="break-words">{dm(d.data)} · {d.descricao}</span><span className="tabular-nums whitespace-nowrap">{brl(Number(d.valor))}</span></div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                      {passados.length > 5 && (
                        <button type="button" onClick={() => setTodos(!todos)} className="w-full text-center text-[12.5px] font-bold text-amber-700 py-2 cursor-pointer">
                          {todos ? 'Ver menos' : `Ver os ${passados.length}`}
                        </button>
                      )}
                    </div>
                  )}
                  <p className="text-[11px] text-zinc-400 mt-2">
                    O banco recebe todas as lojas iFood na mesma conta, por isso o repasse é conferido pelo total do dia (ele não muda com a loja escolhida no topo).
                  </p>
                </>
              )}
            </div>
          </div>

          {/* Cancelamentos e ressarcimentos */}
          <div>
            <SecaoTitulo id="cancelados" titulo="Cancelamentos e ressarcimentos" />
            {cancel.n === 0 && cancel.nDevolvidos === 0 ? (
              <Nota>Nenhum pedido cancelado neste período.</Nota>
            ) : (
              <CartaoAcao tom={cancel.semRessarcimento.length > 0 ? 'prop' : 'neutro'} icone="ri-arrow-go-back-line"
                titulo={<>{cancel.n} cancelado{cancel.n === 1 ? '' : 's'} ({brl0(cancel.perdido)}){cancel.nDevolvidos > 0 ? <> · iFood devolveu {brl0(cancel.devolvido)} em {cancel.nDevolvidos}</> : null}</>}
                acoes={cancel.n > 0 ? <button type="button" onClick={() => setVerLista(!verLista)} className={btn('out', 'sm')}>{verLista ? 'Esconder a lista' : `Ver os ${cancel.n}`}</button> : undefined}>
                {cancel.semRessarcimento.length > 0 ? (
                  <>
                    {cancel.semRessarcimento.length === 1 ? '1 cancelamento' : `${cancel.semRessarcimento.length} cancelamentos`} que não foi culpa da loja ainda sem ressarcimento ({brl(cancel.valorSemRessarcimento)}).
                    {' '}<b>Dá para pedir o ressarcimento no Portal do Parceiro.</b>
                  </>
                ) : cancel.n > 0 ? 'Nenhum cancelamento sem ressarcimento que dê para pedir.' : 'Só ajustes a favor da loja.'}
              </CartaoAcao>
            )}
            {verLista && cancel.n > 0 && (
              <div className="bg-white border border-zinc-200 rounded-2xl mt-2 divide-y divide-zinc-100">
                {cancel.lista.map((p) => {
                  const num = numeroDoPedido.get(p.id);
                  const culpa = p.motivo ? culpaCancelamento(p.motivo) : null;
                  const pedir = p.ajustes <= 0.005 && !!p.motivo && culpa !== 'loja';
                  return (
                    <button type="button" key={p.id} onClick={() => abrirPedido(p.id)} className="w-full text-left flex items-center gap-3 px-3 py-2.5 cursor-pointer">
                      <span className="flex-1 min-w-0">
                        <b className="block text-[13.5px] font-extrabold text-zinc-900">{num ? `#${num}` : `iFood ${p.id.slice(0, 4)}`} · {dm(p.dia)} · {brl(p.bruto)}</b>
                        <span className="block text-[11.5px] text-zinc-400 truncate">{p.motivo ? motivoCurto(p.motivo) : 'Sem motivo informado'}{culpa === 'loja' ? ' · falha da loja' : ''}</span>
                      </span>
                      {p.ajustes > 0.005 ? <Etiqueta tom="green">devolveu {brl(p.ajustes)}</Etiqueta>
                        : pedir ? <Etiqueta tom="amber">pedir ressarcimento</Etiqueta>
                        : <Etiqueta>sem ressarcimento</Etiqueta>}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}

      {/* Financeiro: no modo de teste do iFood nada é lançado */}
      {modoTeste ? (
        <CartaoAcao tom="info" icone="ri-flask-line" titulo="Modo de teste do iFood">
          Estes dados são da loja de teste do iFood. Eles aparecem aqui para conferência e não entram em Receitas, DRE nem Fluxo de Caixa.
        </CartaoAcao>
      ) : lanc != null && (
        <CartaoAcao tom={lanc ? 'ok' : 'prop'} icone={lanc ? 'ri-book-2-line' : 'ri-information-line'} titulo={lanc ? 'Lançando no financeiro' : 'Fora do financeiro'}
          acoes={acesso.configurar ? (
            <button type="button" onClick={alternarLancamento} disabled={salvandoLanc || !temImportacao} className={btn(lanc ? 'out' : 'p', 'sm')}>
              {salvandoLanc ? 'Salvando...' : lanc ? 'Parar de lançar' : 'Lançar no financeiro'}
            </button>
          ) : undefined}>
          {lanc
            ? 'Venda e taxas entram em Receitas, DRE e Fluxo de Caixa; o repasse entra no caixa na data em que caiu.'
            : 'Estes números ainda não entram em Receitas nem na DRE.'}
        </CartaoAcao>
      )}
      {erro && <p className="text-xs text-red-600">{erro}</p>}

      {/* Ações */}
      <div className="bg-white border border-zinc-200 rounded-2xl divide-y divide-zinc-100">
        <LinhaAcao icone="ri-file-excel-2-line" titulo={`Baixar planilha de ${nomeMes}`} sub="um pedido por linha, com cada taxa" carregando={baixando} onClick={baixarPlanilha} />
        <LinhaAcao icone="ri-upload-2-line" titulo="Importar relatório do Portal" sub="para mês antigo ou loja sem conexão" onClick={() => setImportar(true)} />
        <LinhaAcao icone="ri-layout-grid-line" titulo="Ver tudo (tela completa antiga)" sub="Resumo, Produtos, CMV, Pedidos, Repasses e Eventos"
          direita={<i className={`ri-arrow-${verTudo ? 'up' : 'down'}-s-line text-zinc-400 text-lg`} />} onClick={() => setVerTudo(!verTudo)} />
      </div>

      {verTudo && (
        <div className="border border-zinc-200 rounded-2xl bg-zinc-50/50 -mx-2 md:mx-0">
          <IfoodTab />
        </div>
      )}

      {importar && <IfoodConfigModal onClose={() => setImportar(false)} onImported={depoisDeImportar} />}
    </div>
  );
}

function LinhaAcao({ icone, titulo, sub, onClick, carregando, direita }: {
  icone: string; titulo: string; sub: string; onClick: () => void; carregando?: boolean; direita?: React.ReactNode;
}) {
  return (
    <button type="button" onClick={onClick} disabled={carregando} className="w-full text-left flex items-center gap-3 px-3 py-3 cursor-pointer hover:bg-zinc-50 disabled:opacity-60">
      <span className="w-9 h-9 rounded-xl bg-zinc-100 text-zinc-600 flex items-center justify-center flex-none">
        <i className={`${carregando ? 'ri-loader-4-line animate-spin' : icone} text-lg`} />
      </span>
      <span className="flex-1 min-w-0">
        <b className="block text-[14px] font-extrabold text-zinc-900">{titulo}</b>
        <span className="block text-[12px] text-zinc-400">{sub}</span>
      </span>
      {direita}
    </button>
  );
}
