import { useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLojasComparar } from '@/hooks/useLojasComparar';
import { corDaLoja, rotuloComparacao, totalLojas, ROTULO_PERIODO, type LojaComparada, type PeriodoLojas } from '@/lib/lojasComparar';
import { cliqueParaNovaAba } from '@/lib/novaJanela';
import GraficoLojas, { CanaisLojas } from './components/GraficoLojas';
import { AgoraTexto, AoVivo, brl, EscolherLojasModal, EtiquetaDia, MetaBarra, MetaTexto, PontoLoja, Variacao, useAbrirLoja } from './components/ui';

// Comparar lojas (/lojas, 2026-10-04): as lojas em que a pessoa vê o Dashboard, lado a lado e ao vivo.
// Números = a conta do Dashboard de cada loja (PDV pago + iFood), no dia da loja: a soma das sessões de caixa
// abertas no dia (a que passa da meia-noite conta no dia em que abriu). Regras em src/lib/lojasComparar.ts.

type Ordem = 'fat' | 'var' | 'ticket' | 'ped';
const PERIODOS: PeriodoLojas[] = ['hoje', 'ontem', '7d', 'mes'];
const CHAVE_PERIODO = 'lojas.periodo';

function lerPeriodo(): PeriodoLojas {
  try {
    const v = localStorage.getItem(CHAVE_PERIODO);
    if (v && (PERIODOS as string[]).includes(v)) return v as PeriodoLojas;
  } catch { /* sem storage */ }
  return 'hoje';
}

const iFoodPct = (l: LojaComparada) => (l.atual.faturamento > 0 ? (l.atual.ifood / l.atual.faturamento) * 100 : 0);

function Atencao({ lojas, periodo, onAbrir }: { lojas: LojaComparada[]; periodo: PeriodoLojas; onAbrir: (l: LojaComparada) => void }) {
  const itens: Array<{ chave: string; icone: string; cor: string; texto: ReactNode; acao?: string; loja?: LojaComparada }> = [];
  for (const l of lojas) {
    if (l.variacao !== null && l.variacao <= -10) {
      itens.push({
        chave: `abaixo-${l.tenantId}`, icone: 'ri-arrow-down-circle-line', cor: 'text-red-600', acao: 'Abrir', loja: l,
        texto: <><b className="text-zinc-900">{l.nome}</b> está {Math.abs(l.variacao).toFixed(0)}% abaixo ({rotuloComparacao(periodo, l)}).
          {periodo === 'hoje' && l.agora.em_aberto.pedidos > 0 && <> Tem {l.agora.em_aberto.pedidos} em aberto somando {brl(l.agora.em_aberto.valor, false)}.</>}</>,
      });
    }
    if (periodo === 'hoje' && l.agora.atrasados > 0) {
      itens.push({
        chave: `atraso-${l.tenantId}`, icone: 'ri-fire-line', cor: 'text-red-600', acao: 'Abrir', loja: l,
        texto: <><b className="text-zinc-900">{l.nome}</b>: {l.agora.atrasados} {l.agora.atrasados === 1 ? 'pedido' : 'pedidos'} há mais de 20 min na cozinha.</>,
      });
    }
    if (l.meta && l.atual.faturamento >= l.meta) {
      itens.push({
        chave: `meta-${l.tenantId}`, icone: 'ri-trophy-line', cor: 'text-emerald-600',
        texto: <><b className="text-zinc-900">{l.nome}</b> bateu a meta{periodo === 'hoje' ? ' do dia' : ' do período'} ({((l.atual.faturamento / l.meta) * 100).toFixed(0)}%).</>,
      });
    }
    if (periodo === 'hoje' && !l.meta) {
      itens.push({
        chave: `sem-meta-${l.tenantId}`, icone: 'ri-flag-line', cor: 'text-zinc-400', acao: 'Definir', loja: l,
        texto: <><b className="text-zinc-900">{l.nome}</b> não tem meta — sem meta não dá para saber se o dia está bom.</>,
      });
    }
  }
  if (periodo !== 'hoje') {
    const maisIfood = lojas.filter((l) => l.atual.ifood > 0).sort((a, b) => iFoodPct(b) - iFoodPct(a))[0];
    if (maisIfood && lojas.length > 1) {
      itens.push({
        chave: 'ifood', icone: 'ri-e-bike-2-line', cor: 'text-red-500',
        texto: <>O iFood pesa mais na <b className="text-zinc-900">{maisIfood.nome}</b>: {iFoodPct(maisIfood).toFixed(0)}% da venda.</>,
      });
    }
  }
  if (itens.length === 0) return null;
  return (
    <div className="bg-white border border-zinc-200 rounded-2xl px-4 py-1 mb-4">
      {itens.slice(0, 6).map((it) => (
        <div key={it.chave} className="flex items-start gap-3 py-2.5 border-b border-zinc-100 last:border-0 text-[13px] text-zinc-600 leading-snug">
          <i className={`${it.icone} ${it.cor} text-base mt-px`} />
          <div className="flex-1 min-w-0">{it.texto}</div>
          {it.acao && it.loja && (
            <button onClick={() => onAbrir(it.loja!)} className="text-xs font-bold text-amber-700 hover:underline cursor-pointer whitespace-nowrap">{it.acao}</button>
          )}
        </div>
      ))}
    </div>
  );
}

export default function LojasPage() {
  const navigate = useNavigate();
  const [periodo, setPeriodoState] = useState<PeriodoLojas>(lerPeriodo);
  const [ordem, setOrdem] = useState<Ordem>('fat');
  const [escolher, setEscolher] = useState(false);
  const [verParadas, setVerParadas] = useState(false);
  const { lojas, carregando, erro, atualizadoEm, recarregar, setOculta } = useLojasComparar(periodo);
  const abrirLoja = useAbrirLoja();

  const setPeriodo = (p: PeriodoLojas) => {
    setPeriodoState(p);
    try { localStorage.setItem(CHAVE_PERIODO, p); } catch { /* sem storage */ }
  };

  // Cor fixa por loja (ordem do nome), nunca pelo ranking
  const cores = useMemo(() => Object.fromEntries(lojas.map((l, i) => [l.tenantId, corDaLoja(i)])), [lojas]);
  const chaveOrdem: Record<Ordem, (l: LojaComparada) => number> = {
    fat: (l) => l.atual.faturamento, var: (l) => l.variacao ?? -1e9, ticket: (l) => l.atual.ticket, ped: (l) => l.atual.pedidos,
  };
  const mostradas = lojas.filter((l) => !l.oculta && !l.parada).sort((a, b) => chaveOrdem[ordem](b) - chaveOrdem[ordem](a));
  const paradas = lojas.filter((l) => !l.oculta && l.parada);
  const ocultas = lojas.filter((l) => l.oculta);
  const total = totalLojas(mostradas);
  const maxFat = Math.max(1, ...mostradas.map((l) => l.atual.faturamento));
  const rotulo = mostradas[0] ? rotuloComparacao(periodo, mostradas[0]) : '';
  const ifoodChegando = mostradas.some((l) => l.ifoodCarregando);
  const abrir = (l: LojaComparada) => { abrirLoja(l.tenantId); };

  return (
    <div className="min-h-screen" style={{ background: 'radial-gradient(ellipse at 20% 0%, #fff8ed 0%, #fafaf9 40%, #f5f5f4 100%)' }}>
      {/* Topo */}
      <div className="sticky top-0 z-20 backdrop-blur-md bg-[#fafaf9]/85 border-b border-zinc-200/60">
        <div className="max-w-6xl mx-auto px-4 md:px-8 py-3 flex items-center gap-3">
          <a href="/modulos" onClick={(e) => { if (cliqueParaNovaAba(e)) return; e.preventDefault(); navigate('/modulos'); }}
            className="w-10 h-10 flex items-center justify-center rounded-xl border border-zinc-200 bg-white hover:bg-zinc-50 text-zinc-600 flex-shrink-0" aria-label="Voltar para Módulos">
            <i className="ri-arrow-left-line text-lg" />
          </a>
          <div className="min-w-0 flex-1">
            <h1 className="text-lg md:text-xl font-black text-zinc-900 leading-tight">Comparar lojas</h1>
            <p className="text-[11.5px] text-zinc-400 font-semibold flex items-center gap-2">
              <AoVivo />
              {atualizadoEm && <span>atualizado {atualizadoEm.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>}
              {ifoodChegando && <span className="text-zinc-400">· buscando o iFood…</span>}
            </p>
          </div>
          <button onClick={() => setEscolher(true)} title="Escolher lojas"
            className="h-10 px-3 flex items-center gap-1.5 rounded-xl border border-zinc-200 bg-white hover:bg-zinc-50 text-xs font-bold text-zinc-600 cursor-pointer">
            <i className="ri-equalizer-line text-base" /><span className="hidden sm:inline">Escolher lojas</span>
          </button>
          <button onClick={() => recarregar()} title="Atualizar"
            className="w-10 h-10 hidden sm:flex items-center justify-center rounded-xl border border-zinc-200 bg-white hover:bg-zinc-50 text-zinc-600 cursor-pointer">
            <i className="ri-refresh-line text-base" />
          </button>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 md:px-8 pt-3 pb-16">
        {/* Período + ordem */}
        <div className="flex items-center gap-2 overflow-x-auto pb-3 -mx-1 px-1">
          {PERIODOS.map((p) => (
            <button key={p} onClick={() => setPeriodo(p)}
              className={`flex-shrink-0 px-3.5 py-2 rounded-full text-[12.5px] font-bold border cursor-pointer transition-colors ${periodo === p ? 'bg-zinc-900 border-zinc-900 text-white' : 'bg-white border-zinc-200 text-zinc-600 hover:border-zinc-300'}`}>
              {ROTULO_PERIODO[p]}
            </button>
          ))}
          <span className="flex-1" />
          <label className="hidden md:flex items-center gap-2 text-xs font-bold text-zinc-500 flex-shrink-0">
            Ordenar
            <select value={ordem} onChange={(e) => setOrdem(e.target.value as Ordem)}
              className="text-xs font-bold border border-zinc-200 rounded-lg px-2 py-1.5 bg-white text-zinc-800 cursor-pointer">
              <option value="fat">Faturamento</option>
              <option value="var">Variação</option>
              <option value="ticket">Tíquete</option>
              <option value="ped">Pedidos</option>
            </select>
          </label>
        </div>

        {erro && (
          <div className="mb-4 flex items-center gap-2 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700">
            <i className="ri-error-warning-line text-sm" /> Não deu para carregar as lojas: {erro}
            <button onClick={() => recarregar()} className="ml-auto font-bold underline cursor-pointer">Tentar de novo</button>
          </div>
        )}

        {carregando ? (
          <div className="space-y-3">
            <div className="h-28 rounded-2xl bg-white/70 border border-zinc-200 animate-pulse" />
            <div className="h-48 rounded-2xl bg-white/70 border border-zinc-200 animate-pulse" />
          </div>
        ) : lojas.length === 0 ? (
          <div className="text-center py-20 text-zinc-400">
            <i className="ri-store-2-line text-4xl" />
            <p className="text-sm font-semibold mt-2">Você não vê o Dashboard de nenhuma loja.</p>
          </div>
        ) : (
          <>
            {/* Números do grupo */}
            <div className="grid grid-cols-3 md:grid-cols-[1.5fr_1fr_1fr_1fr] gap-2.5 mb-4">
              <div className="col-span-3 md:col-span-1 rounded-2xl bg-zinc-900 text-white p-4">
                <p className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">Faturamento · {mostradas.length} {mostradas.length === 1 ? 'loja' : 'lojas'}</p>
                <p className="text-[30px] font-black tracking-tight tabular-nums mt-1 leading-tight">{brl(total.faturamento)}</p>
                <p className="text-[11.5px] text-zinc-300 mt-1 flex items-center gap-2 flex-wrap">
                  <Variacao pct={total.variacao} escuro titulo={total.variacao === null ? 'Uma das lojas não tem base de comparação' : undefined} /> {rotulo}
                </p>
              </div>
              <div className="rounded-2xl bg-white border border-zinc-200 p-3 md:p-4">
                <p className="text-[10.5px] font-bold uppercase tracking-wider text-zinc-400">Pedidos</p>
                <p className="text-lg md:text-xl font-black text-zinc-900 tabular-nums mt-1">{total.pedidos}</p>
                <p className="text-[11px] text-zinc-500">PDV + iFood</p>
              </div>
              <div className="rounded-2xl bg-white border border-zinc-200 p-3 md:p-4">
                <p className="text-[10.5px] font-bold uppercase tracking-wider text-zinc-400">Tíquete</p>
                <p className="text-lg md:text-xl font-black text-zinc-900 tabular-nums mt-1">{brl(total.ticket)}</p>
                <p className="text-[11px] text-zinc-500">médio</p>
              </div>
              <div className="rounded-2xl bg-white border border-zinc-200 p-3 md:p-4">
                <p className="text-[10.5px] font-bold uppercase tracking-wider text-zinc-400">Abertas</p>
                <p className="text-lg md:text-xl font-black text-zinc-900 tabular-nums mt-1">{total.abertas} de {mostradas.length}</p>
                <p className="text-[11px] text-zinc-500">caixa aberto agora</p>
              </div>
            </div>

            <Atencao lojas={mostradas} periodo={periodo} onAbrir={abrir} />

            {/* Ranking — celular: cartões */}
            <div className="md:hidden space-y-2.5 mb-4">
              {mostradas.map((l, i) => (
                <div key={l.tenantId} className="relative bg-white border border-zinc-200 rounded-2xl p-3.5">
                  <button onClick={() => setOculta(l.tenantId, true)} title="Esconder esta loja (só para você)"
                    className="absolute top-2.5 right-2.5 w-8 h-8 flex items-center justify-center rounded-lg text-zinc-300 hover:text-zinc-600 hover:bg-zinc-50 cursor-pointer">
                    <i className="ri-eye-off-line" />
                  </button>
                  <button onClick={() => abrir(l)} className="w-full text-left cursor-pointer">
                    <span className="flex items-center gap-2 pr-8 min-w-0">
                      <span className="text-[11px] font-bold text-zinc-400 w-5">{i + 1}º</span>
                      <PontoLoja cor={cores[l.tenantId]} />
                      <span className="text-[13.5px] font-black text-zinc-800 truncate">{l.nome}</span>
                      <EtiquetaDia loja={l} />
                    </span>
                    <span className="flex items-center gap-2 mt-1.5 ml-7 flex-wrap">
                      <span className="text-[19px] font-black text-zinc-900 tabular-nums">{brl(l.atual.faturamento)}</span>
                      <Variacao pct={l.variacao} titulo={rotuloComparacao(periodo, l)} />
                    </span>
                    <span className="block h-1.5 bg-zinc-100 rounded-full overflow-hidden mt-2 ml-7">
                      <span className="block h-full rounded-full" style={{ width: `${(l.atual.faturamento / maxFat) * 100}%`, background: cores[l.tenantId] }} />
                    </span>
                    <span className="grid grid-cols-3 gap-2 mt-2.5 ml-7 text-[11px] text-zinc-400 font-semibold">
                      <span>Pedidos<b className="block text-[13px] text-zinc-800 tabular-nums">{l.atual.pedidos}</b></span>
                      <span>Tíquete<b className="block text-[13px] text-zinc-800 tabular-nums">{brl(l.atual.ticket)}</b></span>
                      <span>iFood<b className="block text-[13px] text-zinc-800 tabular-nums">{iFoodPct(l).toFixed(0)}%</b></span>
                    </span>
                    <span className="block mt-2 ml-7 text-[11.5px] text-zinc-500 leading-relaxed">
                      <MetaTexto loja={l} />{periodo === 'hoje' && <> · <AgoraTexto loja={l} /></>}
                    </span>
                    <span className="block ml-7"><MetaBarra loja={l} cor={cores[l.tenantId]} /></span>
                  </button>
                </div>
              ))}
            </div>

            {/* Ranking — computador: tabela */}
            <div className="hidden md:block bg-white border border-zinc-200 rounded-2xl px-2 py-2 mb-4 overflow-x-auto">
              <table className="w-full text-[12.5px]">
                <thead>
                  <tr className="text-[10.5px] font-bold uppercase tracking-wider text-zinc-400">
                    <th className="text-left px-3 py-2">Loja</th>
                    <th className="text-right px-3 py-2">Faturamento</th>
                    <th className="text-right px-3 py-2" title={rotulo}>Variação</th>
                    <th className="text-right px-3 py-2">Pedidos</th>
                    <th className="text-right px-3 py-2">Tíquete</th>
                    <th className="text-right px-3 py-2">iFood</th>
                    <th className="text-right px-3 py-2">Meta</th>
                    {periodo === 'hoje' && <th className="text-left px-3 py-2">Agora</th>}
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody>
                  {mostradas.map((l, i) => (
                    <tr key={l.tenantId} onClick={() => abrir(l)} className="group border-t border-zinc-100 hover:bg-amber-50/30 cursor-pointer">
                      <td className="px-3 py-3">
                        <span className="flex items-center gap-2 font-black text-[13px] text-zinc-800 min-w-0">
                          <span className="text-[11px] text-zinc-400 font-bold w-5">{i + 1}º</span>
                          <PontoLoja cor={cores[l.tenantId]} />
                          <span className="truncate max-w-[220px]">{l.nome}</span>
                          <EtiquetaDia loja={l} />
                        </span>
                      </td>
                      <td className="px-3 py-3 text-right">
                        <span className="flex items-center justify-end gap-2">
                          <b className="tabular-nums text-zinc-900">{brl(l.atual.faturamento)}</b>
                          <span className="w-20 h-1.5 bg-zinc-100 rounded-full overflow-hidden">
                            <span className="block h-full rounded-full" style={{ width: `${(l.atual.faturamento / maxFat) * 100}%`, background: cores[l.tenantId] }} />
                          </span>
                        </span>
                      </td>
                      <td className="px-3 py-3 text-right"><Variacao pct={l.variacao} titulo={rotuloComparacao(periodo, l)} /></td>
                      <td className="px-3 py-3 text-right tabular-nums">{l.atual.pedidos}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{brl(l.atual.ticket)}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{iFoodPct(l).toFixed(0)}%</td>
                      <td className="px-3 py-3 text-right whitespace-nowrap"><MetaTexto loja={l} /></td>
                      {periodo === 'hoje' && <td className="px-3 py-3 text-[11.5px] text-zinc-600 min-w-[180px]"><AgoraTexto loja={l} /></td>}
                      <td className="px-1 py-3">
                        <button onClick={(e) => { e.stopPropagation(); setOculta(l.tenantId, true); }} title="Esconder esta loja (só para você)"
                          className="w-7 h-7 flex items-center justify-center rounded-md text-zinc-300 opacity-0 group-hover:opacity-100 hover:text-zinc-600 hover:bg-zinc-100 cursor-pointer">
                          <i className="ri-eye-off-line" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {mostradas.length > 0 && (
              <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-3 mb-4">
                <GraficoLojas lojas={mostradas} cores={cores} periodo={periodo} />
                <CanaisLojas lojas={mostradas} cores={cores} />
              </div>
            )}

            <div className="text-[11.5px] text-zinc-400 leading-relaxed space-y-1 px-1">
              <p>
                Faturamento = pedidos pagos do sistema (sem cancelado, treino ou rascunho) + iFood — o mesmo número do Dashboard de cada loja.
                O dia é a soma das sessões de caixa abertas nele: a que passa da meia-noite conta no dia em que abriu. É venda, não dinheiro na conta.
              </p>
              {ocultas.length > 0 && (
                <p>
                  Escondidas por você:{' '}
                  {ocultas.map((l, i) => (
                    <span key={l.tenantId}>{i > 0 && ', '}<button onClick={() => setOculta(l.tenantId, false)} className="font-bold text-amber-700 hover:underline cursor-pointer">{l.nome} (mostrar)</button></span>
                  ))}
                </p>
              )}
              {paradas.length > 0 && (
                <p>
                  <button onClick={() => setVerParadas((v) => !v)} className="font-bold text-amber-700 hover:underline cursor-pointer">
                    {verParadas ? 'Esconder' : `+ ${paradas.length} ${paradas.length === 1 ? 'loja' : 'lojas'} sem vendas em 30 dias`}
                  </button>
                  {verParadas && <> — {paradas.map((l) => l.nome).join(' · ')} (fora da comparação)</>}
                </p>
              )}
            </div>
          </>
        )}
      </div>

      {escolher && <EscolherLojasModal lojas={lojas} cores={cores} onOcultar={setOculta} onFechar={() => setEscolher(false)} />}
    </div>
  );
}
