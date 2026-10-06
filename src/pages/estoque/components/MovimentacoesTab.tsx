import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import type { Movimentacao } from '@/types/estoque';
import { useEstoque } from '../../../contexts/EstoqueContext';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { todayBrasilia, somarDias, dateKeyBrasilia, formatOrderTime } from '@/lib/dateUtils';
import { fmtQtd } from '@/lib/estoqueRegras';
import {
  TIPOS_DB, ehEstorno, passaNoTipo, sinalDaQuantidade, getMotivoDisplay, diasEntre, tituloDoDia, type TipoLista,
} from '@/lib/estoqueMovimentos';
import { unidadeBanco } from '@/lib/estoqueProducao';
import { useEstoqueTela } from '../EstoqueTela';
import {
  Pagina, Faixa, Chips, CartaoAcao, Vazio, Nota, Etiqueta, btn, semAcento, brl, brlInteiro,
  type ItemFaixa, type OpcaoChip,
} from './ui/EstoqueUi';

// ── Tipos da tela ─────────────────────────────────────────────────────────────
type PeriodoId = 'hoje' | '7d' | '30d' | 'mes' | 'custom';

/** Resumo do período inteiro (fn_estoque_mov_resumo) — não depende das linhas carregadas. */
interface ResumoMov {
  entradas: number;
  entradas_custo: number;
  vendas: number;
  vendas_custo: number;
  saidas: number;
  perdas: number;
  perdas_custo: number;
  producoes: number;
  ajustes_contagem: number;
  vendas_por_dia: Array<{ dia: string; linhas: number; pedidos: number; custo: number }>;
}

const LIMITE_LINHAS = 500; // o mesmo limite do contexto (fn_get_stock_movements)

const OPCOES_PERIODO: OpcaoChip<PeriodoId>[] = [
  { id: 'hoje', rotulo: 'Hoje' },
  { id: '7d', rotulo: '7 dias' },
  { id: '30d', rotulo: '30 dias' },
  { id: 'mes', rotulo: 'Este mês' },
  { id: 'custom', rotulo: 'Período' },
];

const OPCOES_TIPO: OpcaoChip<TipoLista>[] = [
  { id: 'menos_vendas', rotulo: 'Tudo menos vendas' },
  { id: 'entradas', rotulo: 'Entradas' },
  { id: 'perdas', rotulo: 'Perdas' },
  { id: 'saidas', rotulo: 'Saídas' },
  { id: 'producao', rotulo: 'Produção' },
  { id: 'contagem', rotulo: 'Contagem' },
  { id: 'vendas', rotulo: 'Vendas' },
  { id: 'emprestimos', rotulo: 'Empréstimos' },
];

interface Visual { etiqueta: string; tom: 'red' | 'amber' | 'green' | 'blue' | 'zinc'; icone: string; fundo: string }
function visualDe(m: Movimentacao): Visual {
  if (m.tipo === 'saida_venda') return { etiqueta: 'Venda', tom: 'blue', icone: 'ri-restaurant-line', fundo: 'bg-blue-50 text-blue-600' };
  if (ehEstorno(m)) return { etiqueta: 'Estorno', tom: 'zinc', icone: 'ri-arrow-go-back-line', fundo: 'bg-zinc-100 text-zinc-600' };
  switch (m.tipo) {
    case 'entrada': return { etiqueta: 'Entrada', tom: 'green', icone: 'ri-arrow-down-line', fundo: 'bg-emerald-50 text-emerald-700' };
    case 'saida_manual': return { etiqueta: 'Saída', tom: 'zinc', icone: 'ri-arrow-up-line', fundo: 'bg-zinc-100 text-zinc-600' };
    case 'perda':
      return m.sinal === 0
        ? { etiqueta: 'Perda (produção)', tom: 'amber', icone: 'ri-knife-line', fundo: 'bg-amber-50 text-amber-700' }
        : { etiqueta: 'Perda', tom: 'red', icone: 'ri-delete-bin-6-line', fundo: 'bg-red-50 text-red-600' };
    case 'entrada_producao':
    case 'saida_producao': return { etiqueta: 'Produção', tom: 'amber', icone: 'ri-knife-line', fundo: 'bg-amber-50 text-amber-700' };
    case 'ajuste_inventario': return { etiqueta: 'Contagem', tom: 'zinc', icone: 'ri-scales-3-line', fundo: 'bg-zinc-100 text-zinc-600' };
    case 'emprestimo_saida': return { etiqueta: 'Empréstimo · saiu', tom: 'zinc', icone: 'ri-arrow-right-up-line', fundo: 'bg-fuchsia-50 text-fuchsia-700' };
    case 'emprestimo_entrada': return { etiqueta: 'Empréstimo · chegou', tom: 'green', icone: 'ri-arrow-left-down-line', fundo: 'bg-teal-50 text-teal-700' };
    default: return { etiqueta: 'Saída', tom: 'zinc', icone: 'ri-arrow-up-line', fundo: 'bg-zinc-100 text-zinc-600' };
  }
}

/** Quantidade legível ("2,05 kg") com o sinal de verdade. */
function quantidadeTexto(m: Movimentacao): { texto: string; cor: string } {
  const sinal = sinalDaQuantidade(m);
  const cor = sinal === '+' ? 'text-emerald-700' : m.tipo === 'perda' && m.sinal !== 0 ? 'text-red-600' : 'text-zinc-900';
  return { texto: `${sinal}${fmtQtd(m.quantidade, unidadeBanco(m.unidade))}`, cor };
}

// ── Datas (sempre Brasília) ───────────────────────────────────────────────────
/** Início do dia de Brasília (UTC-3 fixo, sem horário de verão desde 2019). */
const inicioDoDia = (ymd: string) => new Date(`${ymd}T00:00:00-03:00`);
const fimDoDia = (ymd: string) => new Date(`${ymd}T23:59:59.999-03:00`);

type LinhaDia = { tipo: 'mov'; mv: Movimentacao } | { tipo: 'vendas'; dia: string; linhas: number; pedidos: number; custo: number };
interface GrupoDia { dia: string; linhas: LinhaDia[] }

export default function MovimentacoesTab() {
  const { movimentacoes, reloadMovimentacoes } = useEstoque();
  const { user } = useAuth();
  const tela = useEstoqueTela();
  const tenantId = user?.tenantId;

  const hoje = todayBrasilia();
  const [periodo, setPeriodo] = useState<PeriodoId>('30d');
  const [customDe, setCustomDe] = useState(() => somarDias(todayBrasilia(), -29));
  const [customAte, setCustomAte] = useState(() => todayBrasilia());
  const [tipo, setTipo] = useState<TipoLista>('menos_vendas');
  /** Dia tocado em "N baixas por venda": a lista de Vendas mostra só esse dia (os números seguem o período). */
  const [diaFoco, setDiaFoco] = useState<string | null>(null);
  const [busca, setBusca] = useState('');

  // Período em datas de Brasília
  const { de, ate } = useMemo(() => {
    switch (periodo) {
      case 'hoje': return { de: hoje, ate: hoje };
      case '7d': return { de: somarDias(hoje, -6), ate: hoje };
      case '30d': return { de: somarDias(hoje, -29), ate: hoje };
      case 'mes': return { de: hoje.slice(0, 8) + '01', ate: hoje };
      default: return { de: customDe, ate: customAte };
    }
  }, [periodo, hoje, customDe, customAte]);
  const diasDoPeriodo = de && ate ? Math.max(1, diasEntre(de, ate)) : 1;

  // ── Resumo do período inteiro ──
  const [resumo, setResumo] = useState<ResumoMov | null>(null);
  const [resumoErro, setResumoErro] = useState(false);
  const seqResumo = useRef(0);
  const carregarResumo = useCallback(async () => {
    if (!tenantId || !de || !ate || de > ate) return;
    const seq = ++seqResumo.current;
    const { data, error } = await supabase.rpc('fn_estoque_mov_resumo', {
      p_tenant_id: tenantId,
      p_de: inicioDoDia(de).toISOString(),
      // período que termina hoje fica sem limite final (relógio do aparelho atrasado não esconde o recente)
      p_ate: ate === hoje ? null : fimDoDia(ate).toISOString(),
    });
    if (seq !== seqResumo.current) return; // chegou uma resposta mais nova
    if (error || !data) {
      console.error('[Movimentacoes] fn_estoque_mov_resumo:', error?.message);
      setResumo(null);
      setResumoErro(true);
      return;
    }
    const r = data as Partial<ResumoMov>;
    setResumo({
      entradas: Number(r.entradas ?? 0),
      entradas_custo: Number(r.entradas_custo ?? 0),
      vendas: Number(r.vendas ?? 0),
      vendas_custo: Number(r.vendas_custo ?? 0),
      saidas: Number(r.saidas ?? 0),
      perdas: Number(r.perdas ?? 0),
      perdas_custo: Number(r.perdas_custo ?? 0),
      producoes: Number(r.producoes ?? 0),
      ajustes_contagem: Number(r.ajustes_contagem ?? 0),
      vendas_por_dia: Array.isArray(r.vendas_por_dia) ? r.vendas_por_dia.map((d) => ({
        dia: String(d.dia), linhas: Number(d.linhas ?? 0), pedidos: Number(d.pedidos ?? 0), custo: Number(d.custo ?? 0),
      })) : [],
    });
    setResumoErro(false);
  }, [tenantId, de, ate, hoje]);

  // Troca de período: zera o resumo antigo (não mostra número de outro período) e busca o novo.
  const ultimoResumo = useRef(0);
  const carregarResumoRef = useRef(carregarResumo);
  carregarResumoRef.current = carregarResumo;
  useEffect(() => { setResumo(null); setResumoErro(false); ultimoResumo.current = Date.now(); void carregarResumo(); }, [carregarResumo]);
  // Chegou movimento novo (venda, lançamento): atualiza os números sem piscar, no máximo a cada 30 s — o resumo
  // varre o período inteiro e não pode rodar a cada venda (o banco já travou por carga). Sempre com o período atual.
  const movMaisNovo = movimentacoes[0]?.id;
  useEffect(() => {
    if (!movMaisNovo) return;
    const espera = Math.max(1500, 30000 - (Date.now() - ultimoResumo.current));
    const t = setTimeout(() => { ultimoResumo.current = Date.now(); void carregarResumoRef.current(); }, espera);
    return () => clearTimeout(t);
  }, [movMaisNovo]);

  // ── Lista: vai ao banco com período + tipo + busca (a lista padrão só traz as 500 mais recentes) ──
  const buscaServidor = busca.trim().length >= 3 ? busca.trim() : '';
  const [buscaAplicada, setBuscaAplicada] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setBuscaAplicada(buscaServidor), 400);
    return () => clearTimeout(t);
  }, [buscaServidor]);

  const [carregando, setCarregando] = useState(true);
  const seqLista = useRef(0);
  const reloadRef = useRef(reloadMovimentacoes);
  reloadRef.current = reloadMovimentacoes;
  const deLista = diaFoco ?? de;
  const ateLista = diaFoco ?? ate;
  useEffect(() => {
    if (!deLista || !ateLista || deLista > ateLista) return;
    const seq = ++seqLista.current;
    setCarregando(true);
    void reloadRef.current(
      inicioDoDia(deLista),
      ateLista === hoje ? undefined : fimDoDia(ateLista),
      undefined,
      buscaAplicada || undefined,
      TIPOS_DB[tipo],
    ).finally(() => { if (seq === seqLista.current) setCarregando(false); });
  }, [deLista, ateLista, hoje, buscaAplicada, tipo]);

  // ── Linhas na tela: filtro fino por cima do que o banco devolveu ──
  const movs = useMemo(() => {
    const q = semAcento(busca);
    return movimentacoes.filter((m) => {
      if (!passaNoTipo(m, tipo)) return false;
      // guarda contra lista antiga enquanto a nova carrega
      if (m.criadoEm) {
        const k = dateKeyBrasilia(m.criadoEm);
        if (k < deLista || (ateLista !== hoje && k > ateLista)) return false;
      }
      if (q) {
        const alvo = semAcento(`${m.insumoNome ?? ''} ${m.motivo ?? ''} ${m.operador ?? ''} ${m.itemVendidoNome ?? ''}`);
        if (!alvo.includes(q)) return false;
      }
      return true;
    });
  }, [movimentacoes, tipo, deLista, ateLista, hoje, busca]);

  const batePeloLimite = movimentacoes.length >= LIMITE_LINHAS;
  /** Dia mais antigo carregado: abaixo dele a lista foi cortada pelo limite e não dá para afirmar nada. */
  const diaMaisAntigo = useMemo(() => {
    if (!batePeloLimite) return null;
    let min: string | null = null;
    for (const m of movimentacoes) {
      if (!m.criadoEm) continue;
      const k = dateKeyBrasilia(m.criadoEm);
      if (min === null || k < min) min = k;
    }
    return min;
  }, [movimentacoes, batePeloLimite]);

  // Em "Tudo menos vendas" cada dia ganha UMA linha com as baixas de venda (vem do resumo do período inteiro).
  const mostrarLinhaVendas = tipo === 'menos_vendas' && !busca.trim() && !diaFoco;
  const grupos = useMemo<GrupoDia[]>(() => {
    const porDia = new Map<string, LinhaDia[]>();
    for (const mv of movs) {
      const k = mv.criadoEm ? dateKeyBrasilia(mv.criadoEm) : hoje;
      if (!porDia.has(k)) porDia.set(k, []);
      porDia.get(k)!.push({ tipo: 'mov', mv });
    }
    if (mostrarLinhaVendas && resumo) {
      for (const d of resumo.vendas_por_dia) {
        if (d.dia < de || d.dia > ate) continue;
        if (diaMaisAntigo && d.dia < diaMaisAntigo) continue;
        if (!porDia.has(d.dia)) porDia.set(d.dia, []);
        porDia.get(d.dia)!.push({ tipo: 'vendas', dia: d.dia, linhas: d.linhas, pedidos: d.pedidos, custo: d.custo });
      }
    }
    return [...porDia.entries()]
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .map(([dia, linhas]) => ({
        dia,
        // a linha de vendas fecha o dia (fica depois do que a equipe lançou)
        linhas: [...linhas.filter((l) => l.tipo === 'mov'), ...linhas.filter((l) => l.tipo === 'vendas')],
      }));
  }, [movs, resumo, mostrarLinhaVendas, de, ate, hoje, diaMaisAntigo]);

  const abrirVendasDoDia = (dia: string) => { setTipo('vendas'); setDiaFoco(dia); };
  const trocarTipo = (t: TipoLista) => { setDiaFoco(null); setTipo(t); };
  const trocarPeriodo = (p: PeriodoId) => { setDiaFoco(null); setPeriodo(p); };

  // ── Faixa do período ──
  const traco = '—';
  const itensFaixa: ItemFaixa[] = [
    {
      valor: resumo ? resumo.entradas.toLocaleString('pt-BR') : traco,
      rotulo: resumo ? `entradas · ${brlInteiro(resumo.entradas_custo)}` : 'entradas',
      tom: 'green',
      onClick: () => trocarTipo('entradas'),
    },
    {
      valor: resumo ? resumo.vendas.toLocaleString('pt-BR') : traco,
      rotulo: 'baixas por venda',
      onClick: () => trocarTipo('vendas'),
    },
    {
      valor: resumo ? resumo.saidas.toLocaleString('pt-BR') : traco,
      rotulo: 'saídas',
      onClick: () => trocarTipo('saidas'),
    },
    {
      valor: resumo ? resumo.perdas.toLocaleString('pt-BR') : traco,
      rotulo: resumo && resumo.perdas > 0 ? `perdas · ${brlInteiro(resumo.perdas_custo)}` : 'perdas',
      tom: resumo && resumo.perdas > 0 ? 'red' : 'neutro',
      onClick: () => trocarTipo('perdas'),
    },
  ];

  const semPerdaNoPeriodo = !!resumo && resumo.perdas === 0 && resumo.entradas + resumo.vendas > 0 && diasDoPeriodo >= 7;

  const tituloDia = (d: string) => tituloDoDia(d, hoje);
  const periodoInvalido = periodo === 'custom' && (!customDe || !customAte || customDe > customAte);

  return (
    <Pagina>
      {/* Período */}
      <div className="space-y-2">
        <Chips opcoes={OPCOES_PERIODO} valor={periodo} onChange={trocarPeriodo} />
        {periodo === 'custom' && (
          <div className="flex items-center gap-3 flex-wrap">
            <label className="flex items-center gap-1.5 text-xs text-zinc-500 font-semibold">
              De
              <input type="date" value={customDe} max={hoje}
                onChange={(e) => { setDiaFoco(null); setCustomDe(e.target.value); if (e.target.value > customAte) setCustomAte(e.target.value); }}
                className="h-9 text-xs border border-zinc-200 rounded-xl px-3 text-zinc-700 bg-white focus:outline-none focus:border-amber-400 cursor-pointer" />
            </label>
            <label className="flex items-center gap-1.5 text-xs text-zinc-500 font-semibold">
              Até
              <input type="date" value={customAte} max={hoje}
                onChange={(e) => { setDiaFoco(null); setCustomAte(e.target.value); if (e.target.value < customDe) setCustomDe(e.target.value); }}
                className="h-9 text-xs border border-zinc-200 rounded-xl px-3 text-zinc-700 bg-white focus:outline-none focus:border-amber-400 cursor-pointer" />
            </label>
            {periodoInvalido && <span className="text-xs text-red-600 font-semibold">Escolha as duas datas.</span>}
          </div>
        )}
      </div>

      {/* Números do período inteiro */}
      <Faixa itens={itensFaixa} />
      {resumoErro && (
        <Nota>Não consegui calcular os totais deste período agora. A lista abaixo continua valendo; tente de novo em instantes.</Nota>
      )}

      {/* Propositivo: ninguém anota perda */}
      {semPerdaNoPeriodo && (
        <CartaoAcao
          tom="prop"
          icone="ri-delete-bin-6-line"
          titulo={`Nenhuma perda anotada em ${diasDoPeriodo} dias`}
          acoes={<button type="button" className={btn('p', 'sm')} onClick={() => tela.abrirPerda()}>Registrar perda</button>}
        >
          Toda cozinha perde alguma coisa. O que estraga e não é anotado aparece só na contagem, como “diferença”, sem saber por quê.
        </CartaoAcao>
      )}

      {/* Atalhos de registro (chamam as mesmas janelas do + Registrar) */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs font-semibold text-zinc-400 mr-0.5">Registrar:</span>
        <button type="button" className={btn('out', 'sm')} onClick={() => tela.abrirPerda()}><i className="ri-delete-bin-6-line" />Perda</button>
        <button type="button" className={btn('out', 'sm')} onClick={() => tela.abrirSaida()}><i className="ri-arrow-up-circle-line" />Saída</button>
        <button type="button" className={btn('out', 'sm')} onClick={() => tela.abrirTransferir()}><i className="ri-arrow-left-right-line" />Emprestar a outra loja</button>
        <button type="button" className={btn('out', 'sm')} onClick={() => tela.abrirCompra()}><i className="ri-shopping-cart-2-line" />Compra</button>
      </div>

      {/* Busca + tipo */}
      <div className="space-y-2.5">
        <div className="relative">
          <i className="ri-search-line absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400 text-base pointer-events-none" />
          <input
            type="text"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Insumo, fornecedor, nº da nota…"
            className="w-full h-[42px] rounded-xl border border-zinc-200 pl-10 pr-10 text-[13.5px] bg-white text-zinc-700 placeholder-zinc-400 focus:outline-none focus:border-amber-400"
          />
          {busca && (
            <button type="button" onClick={() => setBusca('')} aria-label="Limpar busca"
              className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 cursor-pointer">
              <i className="ri-close-line text-base" />
            </button>
          )}
        </div>
        <Chips opcoes={OPCOES_TIPO} valor={tipo} onChange={trocarTipo} />
        {diaFoco && (
          <div className="flex items-center gap-2 text-xs text-zinc-500">
            <span>Só as vendas de <b className="text-zinc-800">{tituloDia(diaFoco)}</b>.</span>
            <button type="button" className="font-bold text-amber-700 hover:underline cursor-pointer"
              onClick={() => { setDiaFoco(null); setTipo('menos_vendas'); }}>Ver o período todo</button>
          </div>
        )}
      </div>

      {/* Lista */}
      {grupos.length === 0 ? (
        carregando || (tipo === 'menos_vendas' && !busca.trim() && !resumo && !resumoErro) ? (
          <div className="py-14 text-center text-zinc-400 text-sm">
            <i className="ri-loader-4-line animate-spin text-3xl block text-zinc-300 mb-2" />Carregando…
          </div>
        ) : (
          <Vazio icone="ri-arrow-left-right-line" titulo="Nenhuma movimentação encontrada"
            acao={tipo === 'menos_vendas' && busca.trim()
              ? <button type="button" className={btn('out', 'sm')} onClick={() => trocarTipo('vendas')}>Procurar também nas vendas</button>
              : undefined}>
            {busca.trim() ? 'Tente outra palavra ou outro período.' : 'Neste período não houve nada deste tipo. Tente outro período.'}
          </Vazio>
        )
      ) : (
        <>
          {/* Celular: cartões por dia */}
          <div className="md:hidden space-y-1">
            {grupos.map((g) => (
              <section key={g.dia}>
                <h3 className="text-[11.5px] font-extrabold uppercase tracking-wide text-zinc-400 mt-3 mb-1.5 px-1">{tituloDia(g.dia)}</h3>
                <div className="bg-white border border-zinc-200 rounded-2xl divide-y divide-zinc-100">
                  {g.linhas.map((l) => l.tipo === 'vendas' ? (
                    <button key={`v-${l.dia}`} type="button" onClick={() => abrirVendasDoDia(l.dia)}
                      className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-left cursor-pointer hover:bg-zinc-50">
                      <span className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 bg-blue-50 text-blue-600"><i className="ri-restaurant-line text-base" /></span>
                      <div className="flex-1 min-w-0">
                        <p className="text-[13.5px] font-bold text-zinc-900">{l.linhas.toLocaleString('pt-BR')} baixas por venda</p>
                        <p className="text-[11.5px] text-zinc-400">{l.pedidos.toLocaleString('pt-BR')} {l.pedidos === 1 ? 'pedido' : 'pedidos'} · toque para ver</p>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="text-sm font-extrabold text-zinc-900">{brl(l.custo)}</p>
                        <p className="text-[11px] text-zinc-400">custo</p>
                      </div>
                    </button>
                  ) : (
                    <LinhaCartao key={l.mv.id} mv={l.mv} onFicha={tela.abrirFicha} />
                  ))}
                </div>
              </section>
            ))}
          </div>

          {/* Computador: tabela */}
          <div className="hidden md:block bg-white rounded-2xl border border-zinc-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]" style={{ minWidth: '760px' }}>
                <thead>
                  <tr className="bg-zinc-50/70 border-b border-zinc-200">
                    <Th>Quando</Th><Th>O quê</Th><Th>Insumo</Th><Th direita>Quantidade</Th><Th>Motivo / origem</Th><Th>Quem</Th><Th direita>Custo</Th>
                  </tr>
                </thead>
                <tbody>
                  {grupos.map((g) => (
                    <GrupoTabela key={g.dia} grupo={g} titulo={tituloDia(g.dia)} onFicha={tela.abrirFicha} onVendas={abrirVendasDoDia} />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {batePeloLimite && (
        <Nota>Mostrando as {LIMITE_LINHAS} mais recentes. Para ver mais antigas, escolha um período menor ou um tipo só.</Nota>
      )}
    </Pagina>
  );
}

// ── Peças ─────────────────────────────────────────────────────────────────────
function Th({ children, direita }: { children: React.ReactNode; direita?: boolean }) {
  return <th className={`px-4 py-2.5 text-[10.5px] font-extrabold uppercase tracking-wide text-zinc-400 whitespace-nowrap ${direita ? 'text-right' : 'text-left'}`}>{children}</th>;
}

const horaDe = (mv: Movimentacao) => (mv.criadoEm ? formatOrderTime(mv.criadoEm) : mv.hora);

function LinhaCartao({ mv, onFicha }: { mv: Movimentacao; onFicha: (id: string) => void }) {
  const v = visualDe(mv);
  const d = getMotivoDisplay(mv);
  const q = quantidadeTexto(mv);
  const origem = [d.label !== '—' ? d.label : null, d.sub, mv.pedidoNumero ? `pedido ${mv.pedidoNumero}` : null].filter(Boolean).join(' · ');
  return (
    <div className="flex items-center gap-2.5 px-3.5 py-2.5">
      <span className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 ${v.fundo}`}><i className={`${v.icone} text-base`} /></span>
      <div className="flex-1 min-w-0">
        <button type="button" onClick={() => onFicha(mv.insumoId)}
          className="block max-w-full text-left text-[13.5px] font-bold text-zinc-900 truncate hover:text-amber-700 cursor-pointer">
          {mv.insumoNome}
        </button>
        <p className="text-[11.5px] text-zinc-400 leading-snug line-clamp-2">
          {v.etiqueta}{origem ? ` · ${origem}` : ''} · {mv.operador} · {horaDe(mv)}
        </p>
      </div>
      <div className="text-right flex-shrink-0">
        <p className={`text-sm font-extrabold tabular-nums ${q.cor}`}>{q.texto}</p>
        <p className="text-[11px] text-zinc-400 tabular-nums">{mv.custo ? brl(mv.custo) : '—'}</p>
      </div>
    </div>
  );
}

function GrupoTabela({ grupo, titulo, onFicha, onVendas }: {
  grupo: GrupoDia; titulo: string; onFicha: (id: string) => void; onVendas: (dia: string) => void;
}) {
  return (
    <>
      <tr className="bg-zinc-50/40">
        <td colSpan={7} className="px-4 pt-3.5 pb-1.5 text-[11.5px] font-extrabold uppercase tracking-wide text-zinc-400">{titulo}</td>
      </tr>
      {grupo.linhas.map((l) => {
        if (l.tipo === 'vendas') {
          return (
            <tr key={`v-${l.dia}`} onClick={() => onVendas(l.dia)} className="border-t border-zinc-100 cursor-pointer hover:bg-amber-50/40">
              <td className="px-4 py-2.5 text-zinc-400">dia todo</td>
              <td className="px-4 py-2.5"><Etiqueta tom="blue">Vendas</Etiqueta></td>
              <td className="px-4 py-2.5 font-bold text-zinc-900">{l.linhas.toLocaleString('pt-BR')} baixas</td>
              <td className="px-4 py-2.5 text-right text-zinc-300">—</td>
              <td className="px-4 py-2.5 text-zinc-500">{l.pedidos.toLocaleString('pt-BR')} {l.pedidos === 1 ? 'pedido' : 'pedidos'} · clique para abrir uma por uma</td>
              <td className="px-4 py-2.5 text-zinc-300">—</td>
              <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-zinc-800">{brl(l.custo)}</td>
            </tr>
          );
        }
        const mv = l.mv;
        const v = visualDe(mv);
        const d = getMotivoDisplay(mv);
        const q = quantidadeTexto(mv);
        return (
          <tr key={mv.id} className="border-t border-zinc-100 hover:bg-zinc-50">
            <td className="px-4 py-2.5 text-zinc-500 tabular-nums whitespace-nowrap">{horaDe(mv)}</td>
            <td className="px-4 py-2.5"><Etiqueta tom={v.tom}>{v.etiqueta}</Etiqueta></td>
            <td className="px-4 py-2.5 max-w-[220px]">
              <button type="button" onClick={() => onFicha(mv.insumoId)}
                className="block max-w-full text-left font-bold text-zinc-900 truncate hover:text-amber-700 cursor-pointer" title="Abrir a ficha do insumo">
                {mv.insumoNome}
              </button>
            </td>
            <td className={`px-4 py-2.5 text-right tabular-nums whitespace-nowrap font-bold ${q.cor}`}>{q.texto}</td>
            <td className="px-4 py-2.5 max-w-[260px]">
              <p className={`truncate ${d.cls}`}>{d.label}</p>
              {(d.sub || mv.pedidoNumero) && (
                <p className="text-[11px] text-zinc-400 truncate">{[d.sub, mv.pedidoNumero ? `pedido ${mv.pedidoNumero}` : null].filter(Boolean).join(' · ')}</p>
              )}
            </td>
            <td className="px-4 py-2.5 text-zinc-600 whitespace-nowrap">{mv.operador}</td>
            <td className="px-4 py-2.5 text-right tabular-nums whitespace-nowrap text-zinc-700">{mv.custo ? brl(mv.custo) : <span className="text-zinc-300">—</span>}</td>
          </tr>
        );
      })}
    </>
  );
}
