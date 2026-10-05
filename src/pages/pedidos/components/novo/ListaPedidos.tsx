import { Fragment, useCallback, useEffect, useMemo, useState, type KeyboardEvent, type MouseEvent, type ReactNode, useRef } from 'react';
import type { PedidoRecente } from '@/types/pdv';
import type { FiscalDocumentRow } from '@/lib/fiscal';
import type { useFiscalDocs } from '@/hooks/useFiscalDocs';
import { CartaoAcao, Nota, SecaoTitulo, Vazio, brl, btn } from '@/pages/estoque/components/ui/EstoqueUi';
import {
  ICONE_CANAL, ROTULO_CANAL, canalPedido, entregaDoPedido, canalFiscal, ehAtivo, ehCancelado, ehNaoPago, ehSemNota, notaViva,
  numeroCurto, ondeQuem, situacaoPedido,
  type Canal, type FiltroChip, type Situacao, type StatusNota,
} from '@/lib/pedidosRegras';

// Lista de pedidos do layout novo (protótipo docs/prototipos/pedidos-proposta.html).
// Celular: cartões (em andamento / concluídos). Computador (lg): tabela de 5 colunas que divide
// a largura com o painel do pedido. A linha só mostra selo do que foge do normal. Toda regra
// (situação, não pago, sem nota, canal) vem de src/lib/pedidosRegras.ts.

type Fiscal = ReturnType<typeof useFiscalDocs>;

const LIMITE_INICIAL = 80;

export default function ListaPedidos({
  itens, chip, carregando, selecionadoId, onAbrir, agoraMs, hoje, fiscal, onToast,
  busca, onBusca, mostrarProcurar30, onProcurar30, fiscalAtivo: fiscalAtivoProp, itensDoPeriodo,
}: {
  /** Já agrupados (pagos juntos) e filtrados. */
  itens: PedidoRecente[];
  chip: FiltroChip;
  carregando: boolean;
  selecionadoId: string | null;
  onAbrir: (p: PedidoRecente) => void;
  agoraMs: number;
  hoje: string;
  fiscal: Fiscal;
  onToast: (ok: boolean, titulo: string, msg?: string) => void;
  busca: string;
  onBusca: (v: string) => void;
  mostrarProcurar30: boolean;
  onProcurar30: () => void;
  /** A loja emite NFC-e? Sem isto vale `fiscal.enabled === true` (e sempre true dentro do filtro "Sem nota"). */
  fiscalAtivo?: boolean;
  /**
   * Todos os pedidos do período, sem o filtro do chip (já agrupados). Só serve ao bloco "Itens
   * cancelados em pedidos que seguiram", no filtro Cancelados: com o filtro aplicado `itens` só
   * tem pedidos cancelados. Sem isto o bloco usa `itens`.
   */
  itensDoPeriodo?: PedidoRecente[];
}) {
  // Sem as notas carregadas (ou com erro de leitura) nada é "sem nota": o lote emitiria em dobro.
  const notasProntas = fiscal.carregado && !fiscal.erroLeitura;
  const fiscalAtivo = (fiscalAtivoProp ?? fiscal.enabled === true) && notasProntas;
  const notaDoc = useCallback((id: string) => fiscal.byOrder.get(id), [fiscal.byOrder]);
  const canaisFiscais = fiscal.canais;
  const ctx = useMemo<Ctx>(
    () => ({
      agoraMs, hoje, fiscalAtivo, chip, notaDoc, statusNota: (id) => notaDoc(id)?.status,
      emiteNota: canaisFiscais ? (p: PedidoRecente) => canaisFiscais[canalFiscal(p)] : undefined,
    }),
    [agoraMs, hoje, fiscalAtivo, chip, notaDoc, canaisFiscais],
  );

  // ── Linhas: uma por pedido ou por grupo pago junto ──
  const linhas = useMemo(() => itens.map((p) => montarLinha(p, ctx)), [itens, ctx]);
  // Em andamento primeiro, concluídos depois (a ordem de dentro de cada parte é a que veio).
  const ordenadas = useMemo(() => [...linhas.filter((l) => l.ativo), ...linhas.filter((l) => !l.ativo)], [linhas]);
  const nAndando = useMemo(() => linhas.filter((l) => l.ativo).length, [linhas]);

  // ── Ver mais ──
  const [limiteBase, setLimiteBase] = useState(LIMITE_INICIAL);
  useEffect(() => { setLimiteBase(LIMITE_INICIAL); }, [chip, busca]);
  const emLote = chip === 'semnota';
  // No filtro "Sem nota" tudo aparece: "N selecionados" tem que ser o que se vê.
  const limite = emLote ? Number.POSITIVE_INFINITY : limiteBase;
  const visiveis = ordenadas.slice(0, limite);
  const resto = ordenadas.length - visiveis.length;

  // ── Pagos juntos abertos ──
  const [abertos, setAbertos] = useState<Set<string>>(new Set());
  const alternarGrupo = (id: string) => setAbertos((prev) => {
    const n = new Set(prev);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  // ── Emitir notas em lote (filtro "Sem nota") ──
  // Guarda o que a pessoa DESmarcou: o que entra na lista já vem marcado.
  const [desmarcados, setDesmarcados] = useState<Set<string>>(new Set());
  const [lote, setLote] = useState<{ total: number; feito: number; ok: number } | null>(null);
  const elegiveis = useMemo(() => (emLote ? linhas.filter((l) => l.semNota) : []), [emLote, linhas]);
  // Ao entrar no "Sem nota": já vêm marcados só os pedidos das últimas 24 h sem nota cancelada. Os mais
  // antigos (a nota sairia com a data de hoje) e os de nota cancelada de propósito ficam para marcar à mão.
  const elegiveisRef = useRef(elegiveis);
  elegiveisRef.current = elegiveis;
  useEffect(() => {
    if (!emLote) { setDesmarcados(new Set()); return; }
    const limite = Date.now() - 24 * 3_600_000;
    const foraDoPadrao = elegiveisRef.current.filter((l) => {
      const criado = l.p._criadoTs ? new Date(l.p._criadoTs).getTime() : 0;
      const notaCancelada = idsDe(l.p).some((id) => fiscal.byOrder.get(id)?.status === 'cancelled');
      return criado < limite || notaCancelada;
    });
    setDesmarcados(new Set(foraDoPadrao.map((l) => l.p.id)));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emLote]);
  const marcados = elegiveis.filter((l) => !desmarcados.has(l.p.id));
  const valorMarcado = marcados.reduce((a, l) => a + l.p.total, 0);
  const todosMarcados = elegiveis.length > 0 && marcados.length === elegiveis.length;
  const alternarMarca = (id: string) => setDesmarcados((prev) => {
    const n = new Set(prev);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });
  const alternarTodos = () => setDesmarcados(todosMarcados ? new Set(elegiveis.map((l) => l.p.id)) : new Set());

  const emitirLote = async () => {
    const alvo = marcados.map((l) => l.p);
    if (alvo.length === 0 || lote) return;
    const ok0 = window.confirm(
      `Emitir ${alvo.length} ${alvo.length === 1 ? 'NFC-e' : 'NFC-e'} (${brl(valorMarcado)})?\n\n`
      + 'Uma nota por pedido (pagos juntos: uma para o grupo). A nota sai com a data de hoje.',
    );
    if (!ok0) return;
    setLote({ total: alvo.length, feito: 0, ok: 0 });
    let ok = 0;
    const falhas: string[] = [];
    try {
      for (let i = 0; i < alvo.length; i++) {
        let emitiu = false;
        let falhou: string | null = null;
        // Sequencial: não sobrecarrega a SEFAZ/provedor. Um pedido = uma NFC-e.
        for (const id of idsDe(alvo[i])) {
          if (notaViva(fiscal.byOrder.get(id)?.status)) continue;
          const r = await fiscal.emitir(id);
          if (r.success) emitiu = true; else falhou = r.message ?? r.status;
          // Pedidos pagos juntos: a fiscal-write emite UMA nota do grupo, que já cobre os demais.
          if (r.source_type === 'payment_group') break;
        }
        if (falhou) falhas.push(falhou); else if (emitiu) ok++;
        setLote({ total: alvo.length, feito: i + 1, ok });
      }
    } finally {
      setLote(null);
    }
    if (falhas.length > 0) {
      onToast(false, ok > 0 ? `${ok} autorizada${ok === 1 ? '' : 's'}, ${falhas.length} com problema` : 'Nota não autorizada', falhas[0]);
    } else if (ok > 0) {
      onToast(true, ok === 1 ? 'NFC-e autorizada' : `${ok} NFC-e autorizadas`);
    }
    await fiscal.recarregar();
  };

  // ── Cancelados: itens cancelados em pedidos que seguiram ──
  const itensCancelados = useMemo(() => {
    if (chip !== 'cancelados') return [];
    const base = itensDoPeriodo ?? itens;
    return base
      .flatMap((it) => (it.pedidosOriginais?.length ? it.pedidosOriginais : [it]))
      .filter((p) => !ehCancelado(p))
      .flatMap((p) => p.itensDetalhes.filter((i) => i.cancelado).map((i) => ({ ped: p, item: i })));
  }, [chip, itens, itensDoPeriodo]);

  const termo = busca.trim();

  return (
    <div>
      {/* Celular: a busca fica aqui (no computador ela está no topo da tela) */}
      <label className="lg:hidden flex items-center gap-2 h-11 px-3 mb-3 rounded-2xl border border-zinc-200 bg-white focus-within:border-amber-400">
        <i className="ri-search-line text-zinc-400 text-lg" />
        <input
          value={busca}
          onChange={(e) => onBusca(e.target.value)}
          placeholder="Nº, mesa, cliente, item ou valor…"
          aria-label="Buscar pedido"
          inputMode="search"
          enterKeyHint="search"
          className="flex-1 min-w-0 bg-transparent outline-none text-[16px] text-zinc-800 placeholder:text-zinc-400"
        />
        {busca && (
          <button type="button" onClick={() => onBusca('')} aria-label="Limpar a busca" className="text-zinc-300 hover:text-zinc-500 cursor-pointer flex-shrink-0">
            <i className="ri-close-circle-fill text-lg" />
          </button>
        )}
      </label>

      {emLote && elegiveis.length > 0 && (
        <div className="flex items-start gap-3 mb-3">
          <Nota className="flex-1">Marque e emita de uma vez. Quem pediu CPF na nota: abra o pedido e emita por lá.</Nota>
          <button type="button" onClick={alternarTodos} className={`${btn('ghost', 'sm')} flex-shrink-0`}>
            {todosMarcados ? 'Desmarcar todos' : 'Marcar todos'}
          </button>
        </div>
      )}

      {linhas.length === 0 ? (
        carregando
          ? <Vazio icone="ri-loader-4-line animate-spin" titulo="Carregando pedidos…" />
          : <Vazio icone="ri-file-list-3-line" titulo={termo ? `Nada com “${termo}” neste período` : 'Nenhum pedido neste período'} />
      ) : (
        <>
          {/* ── Celular ── */}
          <div className="lg:hidden">
            <ListaCelular
              visiveis={visiveis} nAndando={nAndando} total={ordenadas.length} chip={chip} ctx={ctx}
              abertos={abertos} onAlternarGrupo={alternarGrupo} onAbrir={onAbrir}
              emLote={emLote} desmarcados={desmarcados} onMarcar={alternarMarca}
            />
          </div>

          {/* ── Computador ── */}
          <div className="hidden lg:block">
            <TabelaComputador
              visiveis={visiveis} ctx={ctx} selecionadoId={selecionadoId}
              abertos={abertos} onAlternarGrupo={alternarGrupo} onAbrir={onAbrir}
              emLote={emLote} desmarcados={desmarcados} onMarcar={alternarMarca}
              todosMarcados={todosMarcados} onAlternarTodos={alternarTodos} temElegivel={elegiveis.length > 0}
            />
          </div>

          {resto > 0 && (
            <button type="button" onClick={() => setLimiteBase((l) => l + LIMITE_INICIAL)}
              className="block w-full text-center text-[13px] font-extrabold text-amber-700 hover:text-amber-800 py-3 cursor-pointer">
              Ver mais {Math.min(resto, LIMITE_INICIAL)} {Math.min(resto, LIMITE_INICIAL) === 1 ? 'pedido' : 'pedidos'}
            </button>
          )}
        </>
      )}

      {/* ── Cancelados: itens que saíram de pedidos que seguiram ── */}
      {chip === 'cancelados' && itensCancelados.length > 0 && (
        <div className="mt-5">
          <SecaoTitulo titulo="Itens cancelados em pedidos que seguiram" n={itensCancelados.length} tomN="zinc" />
          <div className="bg-white border border-zinc-200 rounded-2xl px-3.5 divide-y divide-zinc-100">
            {itensCancelados.map(({ ped, item }) => (
              <button key={`${ped.id}-${item.id}`} type="button" onClick={() => onAbrir(ped)}
                className="w-full flex items-center gap-2.5 py-2.5 text-left cursor-pointer">
                <span className="w-8 h-8 rounded-[10px] bg-red-50 text-red-600 flex items-center justify-center flex-shrink-0"><i className="ri-subtract-line text-base" /></span>
                <span className="flex-1 min-w-0">
                  <b className="block text-[13.5px] font-bold text-zinc-800 truncate" title={`${item.quantidade}× ${item.nome} · #${numeroCurto(ped)}`}>{item.quantidade}× {item.nome} · #{numeroCurto(ped)}</b>
                  <span className="block text-[11.5px] text-zinc-400 truncate" title={`${ondeQuem(ped)} · ${ped.criadoEm}`}>{ondeQuem(ped)} · {ped.criadoEm}</span>
                </span>
                <b className="text-[14px] font-extrabold tabular-nums whitespace-nowrap text-zinc-700">{brl(item.preco * item.quantidade)}</b>
              </button>
            ))}
          </div>
          <Nota className="mt-2">O sistema ainda não guarda quem cancelou o item nem o motivo.</Nota>
        </div>
      )}

      {/* ── Busca sem resultado no período ── */}
      {termo && mostrarProcurar30 && (
        <CartaoAcao
          className="mt-4" tom="prop" icone="ri-history-line" titulo="Não é nenhum desses?"
          acoes={<button type="button" className={btn('p', 'sm')} onClick={onProcurar30}>Procurar nos últimos 30 dias</button>}
        >
          Procuro “{termo}” nos <b className="text-zinc-900">últimos 30 dias</b>: número, valor, cliente, telefone e item.
        </CartaoAcao>
      )}

      {/* ── Barra do lote (grudada embaixo) ── */}
      {emLote && (marcados.length > 0 || lote) && (
        <div className="sticky bottom-3 z-20 mt-3">
          <div className="flex items-center gap-3 bg-zinc-900 text-white rounded-2xl pl-3.5 pr-2.5 py-2.5 shadow-xl">
            <i className="ri-file-shield-2-line text-xl text-amber-400 flex-shrink-0" />
            {lote ? (
              <>
                <div className="flex-1 min-w-0">
                  <p className="text-[13.5px] font-extrabold">Emitindo {lote.feito}/{lote.total}…</p>
                  <div className="h-1.5 bg-white/20 rounded-full overflow-hidden mt-1">
                    <div className="h-full bg-amber-400 transition-all" style={{ width: `${Math.round((lote.feito / lote.total) * 100)}%` }} />
                  </div>
                </div>
                <span className="text-[11px] text-zinc-300 flex-shrink-0">{lote.ok} {lote.ok === 1 ? 'autorizada' : 'autorizadas'}</span>
              </>
            ) : (
              <>
                <p className="flex-1 min-w-0 text-[13.5px] font-extrabold leading-tight">
                  {marcados.length} {marcados.length === 1 ? 'selecionado' : 'selecionados'}
                  <span className="block text-[11px] font-medium text-zinc-300 truncate">{brl(valorMarcado)} · uma NFC-e por pedido</span>
                </p>
                <button type="button" className={btn('p', 'sm')} onClick={emitirLote}>
                  Emitir {marcados.length} {marcados.length === 1 ? 'nota' : 'notas'}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// Dados de cada linha
// ═════════════════════════════════════════════════════════════════════════════

interface Ctx {
  agoraMs: number;
  hoje: string;
  fiscalAtivo: boolean;
  chip: FiltroChip;
  notaDoc: (orderId: string) => FiscalDocumentRow | undefined;
  statusNota: (orderId: string) => StatusNota | undefined;
  emiteNota?: (p: PedidoRecente) => boolean;
}

interface Linha {
  p: PedidoRecente;
  grupo: boolean;
  /** Pedidos de dentro do grupo, do mais antigo ao mais novo (vazio se não é grupo). */
  subs: PedidoRecente[];
  /** Pedido que dá nome à linha: o próprio, ou o primeiro do grupo. */
  base: PedidoRecente;
  canal: Canal;
  num: string;
  onde: string;
  ativo: boolean;
  cancelado: boolean;
  /** Pago, com valor e sem nota viva (só loja com NFC-e). */
  semNota: boolean;
  sit: Situacao;
}

const idsDe = (p: PedidoRecente): string[] => (p.pedidoIds?.length ? p.pedidoIds : [p.id]);
const tsDe = (p: PedidoRecente) => (p._criadoTs ? new Date(p._criadoTs).getTime() : 0);

function montarLinha(p: PedidoRecente, ctx: Ctx): Linha {
  const grupo = (p.pedidosOriginais?.length ?? 0) > 1;
  const subs = grupo ? [...(p.pedidosOriginais ?? [])].sort((a, b) => tsDe(a) - tsDe(b)) : [];
  const base = grupo ? subs[0] : p;
  const sit = situacaoPedido(base, ctx.agoraMs, ctx.hoje);
  return {
    p, grupo, subs, base,
    canal: canalPedido(base),
    num: numeroCurto(base),
    onde: ondeQuem(base),
    // Esquecido (parado há 12 h+) não sobe como "em andamento": fica no lugar pela hora
    ativo: (grupo ? subs.some(ehAtivo) : ehAtivo(p)) && sit.tipo !== 'parado',
    cancelado: ehCancelado(p),
    semNota: ehSemNota(p, ctx.fiscalAtivo, ctx.statusNota, ctx.emiteNota),
    sit,
  };
}

/** "19:25" hoje; "03/10 19:25" em outro dia (no período de vários dias o número se repete a cada dia). */
const quando = (p: PedidoRecente, hoje: string) =>
  p.dataPedido && p.dataPedido !== hoje ? `${p.dataPedido.slice(8, 10)}/${p.dataPedido.slice(5, 7)} ${p.criadoEm}` : p.criadoEm;

const horaBR = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }) : '';

/** "3× Taco · 2× Coca" (item cancelado fica de fora). */
const textoItens = (p: PedidoRecente) =>
  p.itensDetalhes.filter((i) => !i.cancelado).map((i) => `${i.quantidade}× ${i.nome}`).join(' · ');
const qtdItens = (p: PedidoRecente) =>
  p.itensDetalhes.filter((i) => !i.cancelado).reduce((a, i) => a + i.quantidade, 0);

const motivoCancelamento = (p: PedidoRecente) => p.cancelReason?.trim() || 'Sem motivo informado';
function quemCancelou(p: PedidoRecente): string {
  const hora = horaBR(p.canceladoEm);
  if (p.canceladoPor) return `cancelado por ${p.canceladoPor}${hora ? ` às ${hora}` : ''}`;
  return hora ? `cancelado às ${hora}` : 'quem cancelou não foi registrado';
}
/** O pedido cancelado já tinha começado na cozinha? */
const foiParaCozinha = (p: PedidoRecente) =>
  !!p._iniciouPreparoTs || p.itensDetalhes.some((i) => (i.unidades ?? []).some((u) => !!u._iniciadoPreparoTs));

/** Linha 2 do cartão do celular. */
function linha2(l: Linha, chip: FiltroChip): string {
  const { p } = l;
  if (l.grupo) {
    const nomes = l.subs.map((s) => `#${numeroCurto(s)}`).join(' · ');
    const quem = p.garcomNome ? (l.canal === 'garcom' ? `Garçom ${p.garcomNome}` : p.garcomNome) : '';
    return quem ? `${nomes} · ${quem}` : nomes;
  }
  if (l.cancelado && chip !== 'cancelados') {
    return [motivoCancelamento(p), p.canceladoPor].filter(Boolean).join(' · ');
  }
  const itens = textoItens(p);
  if (l.canal !== 'delivery') return itens;
  const ent = entregaDoPedido(p);
  const onde = ent.retirada ? 'Retirada' : ent.endereco;
  return onde ? `${onde} · ${itens}` : itens;
}

/** Horário do 1º ao último pedido do grupo. */
function faixaHora(l: Linha): string {
  const a = l.subs[0]?.criadoEm ?? '';
  const b = l.subs[l.subs.length - 1]?.criadoEm ?? '';
  return a && b && a !== b ? `${a} → ${b}` : a;
}

// ═════════════════════════════════════════════════════════════════════════════
// Peças pequenas
// ═════════════════════════════════════════════════════════════════════════════

type TomSelo = 'ambar' | 'vermelho' | 'verde' | 'azul' | 'laranja' | 'neutro' | 'solido' | 'tracejado' | 'contorno';
const CLASSE_SELO: Record<TomSelo, string> = {
  ambar: 'bg-amber-50 text-amber-700',
  vermelho: 'bg-red-50 text-red-600',
  verde: 'bg-emerald-50 text-emerald-700',
  azul: 'bg-blue-50 text-blue-600',
  laranja: 'bg-orange-100 text-orange-700',
  neutro: 'bg-zinc-100 text-zinc-600',
  solido: 'bg-red-600 text-white',
  tracejado: 'bg-white border border-dashed border-zinc-300 text-zinc-400',
  contorno: 'bg-white border border-emerald-200 text-emerald-700',
};

function Selo({ tom = 'neutro', icone, pulso, title, children }: {
  tom?: TomSelo; icone?: string; pulso?: boolean; title?: string; children: ReactNode;
}) {
  return (
    <span title={title} className={`inline-flex items-center gap-1 max-w-full rounded-[7px] px-[7px] py-[3px] text-[11px] font-extrabold leading-tight ${CLASSE_SELO[tom]}`}>
      {pulso && <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse flex-none" />}
      {icone && <i className={`${icone} text-xs flex-none`} />}
      <span className="truncate min-w-0">{children}</span>
    </span>
  );
}

const COR_CANAL: Record<Canal, string> = {
  tablet: 'bg-blue-50 text-blue-600',
  caixa: 'bg-amber-50 text-amber-700',
  delivery: 'bg-orange-50 text-orange-700',
  qr: 'bg-violet-50 text-violet-600',
  garcom: 'bg-emerald-50 text-emerald-700',
  totem: 'bg-zinc-100 text-zinc-600',
};

function IconeCanal({ canal, pequeno, contagem }: { canal: Canal; pequeno?: boolean; contagem?: number }) {
  return (
    <span className={`relative flex-shrink-0 flex items-center justify-center ${pequeno ? 'w-7 h-7 rounded-[9px] text-sm' : 'w-[38px] h-[38px] rounded-xl text-lg'} ${COR_CANAL[canal]}`}
      title={ROTULO_CANAL[canal]}>
      <i className={ICONE_CANAL[canal]} />
      {contagem != null && (
        <span className="absolute -right-1.5 -top-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-zinc-900 text-white text-[10px] font-extrabold flex items-center justify-center border-2 border-white">
          {contagem}
        </span>
      )}
    </span>
  );
}

/** Selo da situação de um pedido andando (cozinha, pronto, saiu, parado). Entregue/cancelado não entram aqui. */
function seloAndando(sit: Situacao, chave: string): ReactNode {
  const dica = sit.atrasado ? 'Passou da meta de 15 min' : undefined;
  switch (sit.tipo) {
    case 'cozinha': return <Selo key={chave} tom={sit.atrasado ? 'vermelho' : 'ambar'} pulso title={dica}>{sit.rotulo}</Selo>;
    case 'pronto': return <Selo key={chave} tom={sit.atrasado ? 'vermelho' : 'verde'} icone="ri-checkbox-circle-line" title={dica}>{sit.rotulo}</Selo>;
    case 'saiu': return <Selo key={chave} tom={sit.atrasado ? 'vermelho' : 'azul'} icone="ri-e-bike-2-line" title={dica}>{sit.rotulo}</Selo>;
    case 'parado': return <Selo key={chave} tom="solido" icone="ri-alarm-warning-line" title="Andando há mais de 12 horas: ficou sem baixa">{sit.rotulo}</Selo>;
    default: return null;
  }
}

/** Selos de um pedido: só o que foge do normal. No computador o entregue ganha um selo neutro com o tempo. */
function selosPedido(l: Linha, ctx: Ctx, computador: boolean): ReactNode[] {
  const { p, sit } = l;
  const s: ReactNode[] = [];
  if (sit.tipo === 'cancelado') {
    s.push(<Selo key="cn" tom="vermelho" icone="ri-close-circle-line">Cancelado</Selo>);
    return s;
  }
  if (sit.tipo === 'entregue') {
    if (computador) {
      s.push(<Selo key="ent">{sit.minutos != null ? `Entregue · ${sit.minutos} min` : 'Entregue'}</Selo>);
      if (sit.atrasado) s.push(<Selo key="atr" tom="vermelho" title="Passou da meta de 15 min">atrasou</Selo>);
    }
  } else {
    s.push(seloAndando(sit, 'sit'));
  }
  if (ehNaoPago(p)) s.push(<Selo key="np" tom="laranja" icone="ri-error-warning-line">Não pago</Selo>);
  if (l.semNota) {
    const st = ctx.statusNota(p.id);
    const recusada = st === 'rejected' || st === 'error';
    s.push(<Selo key="nf" tom={recusada ? 'vermelho' : 'tracejado'} title={recusada ? 'A nota foi recusada: abra o pedido para emitir de novo' : undefined}>{recusada ? 'nota recusada' : 'sem nota'}</Selo>);
  }
  return s;
}

/** Selos de um grupo pago junto. */
function selosGrupo(l: Linha, ctx: Ctx): ReactNode[] {
  const s: ReactNode[] = [<Selo key="pj" tom="verde" icone="ri-links-line">Pagos juntos</Selo>];
  const andando = l.subs.find(ehAtivo);
  if (andando) s.push(seloAndando(situacaoPedido(andando, ctx.agoraMs, ctx.hoje), 'sit'));
  if (ctx.fiscalAtivo) {
    if (l.semNota) {
      s.push(<Selo key="nf" tom="tracejado">sem nota</Selo>);
    } else {
      const notas = new Set<string>();
      for (const id of idsDe(l.p)) {
        const d = ctx.notaDoc(id);
        if (d && d.status === 'authorized') notas.add(d.id);
      }
      if (notas.size > 0) s.push(<Selo key="nf" tom="contorno" icone="ri-check-line">{notas.size === 1 ? '1 nota' : `${notas.size} notas`}</Selo>);
    }
  }
  return s;
}

/** Selos do filtro Cancelados: motivo, quem/quando e se já tinha ido para a cozinha. */
function selosCancelado(p: PedidoRecente): ReactNode[] {
  const cozinha = foiParaCozinha(p);
  return [
    <Selo key="mot" tom="vermelho" icone="ri-close-circle-line">{motivoCancelamento(p)}</Selo>,
    <Selo key="quem">{quemCancelou(p)}</Selo>,
    cozinha
      ? <Selo key="coz" tom="ambar" icone="ri-fire-line">já tinha ido para a cozinha</Selo>
      : <Selo key="coz">não tinha ido para a cozinha</Selo>,
  ];
}

// Só quando a tecla é da própria linha: Enter/Espaço num botão ou caixinha de dentro continua valendo para ele.
const aoTeclar = (acao: () => void) => (e: KeyboardEvent) => {
  if (e.target !== e.currentTarget) return;
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); acao(); }
};
const parar = (e: MouseEvent) => e.stopPropagation();

function BotaoVerOs({ n, aberto, onClick }: { n: number; aberto: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={(e) => { e.stopPropagation(); onClick(); }} aria-expanded={aberto}
      className="inline-flex items-center text-[11.5px] font-extrabold text-amber-700 hover:text-amber-800 py-0.5 cursor-pointer whitespace-nowrap">
      ver os {n}<i className={`ri-arrow-down-s-line text-sm transition-transform ${aberto ? 'rotate-180' : ''}`} />
    </button>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// Celular
// ═════════════════════════════════════════════════════════════════════════════

interface PropsLista {
  ctx: Ctx;
  abertos: Set<string>;
  onAlternarGrupo: (id: string) => void;
  onAbrir: (p: PedidoRecente) => void;
  emLote: boolean;
  desmarcados: Set<string>;
  onMarcar: (id: string) => void;
}

function ListaCelular({ visiveis, nAndando, total, chip, ...resto }: PropsLista & {
  visiveis: Linha[]; nAndando: number; total: number; chip: FiltroChip;
}) {
  const andando = visiveis.filter((l) => l.ativo);
  const concluidos = visiveis.filter((l) => !l.ativo);
  const comTitulos = chip === 'todos' || (nAndando > 0 && nAndando < total);

  const bloco = (titulo: string, n: number, ls: Linha[]) => ls.length === 0 ? null : (
    <div>
      {comTitulos && (
        <p className="flex items-center justify-between text-[11.5px] font-extrabold uppercase tracking-wider text-zinc-400 mt-4 mb-1.5 px-1">
          {titulo}<span className="normal-case tracking-normal font-bold">{n}</span>
        </p>
      )}
      <div className="bg-white border border-zinc-200 rounded-2xl px-3.5 divide-y divide-zinc-100">
        {ls.map((l) => <CartaoCelular key={l.p.id} l={l} chip={chip} {...resto} />)}
      </div>
    </div>
  );

  return (
    <>
      {bloco('Em andamento', nAndando, andando)}
      {bloco('Concluídos', total - nAndando, concluidos)}
    </>
  );
}

function CartaoCelular({ l, chip, ctx, abertos, onAlternarGrupo, onAbrir, emLote, desmarcados, onMarcar }: PropsLista & {
  l: Linha; chip: FiltroChip;
}) {
  const { p, grupo, sit } = l;
  const aberto = grupo && abertos.has(p.id);
  const cancelado = l.cancelado;
  const naTelaCancelados = chip === 'cancelados' && cancelado;

  const selos = grupo
    ? selosGrupo(l, ctx)
    : naTelaCancelados ? selosCancelado(p) : selosPedido(l, ctx, false);

  // À direita: horário (e o tempo, quando entregue).
  let direita: ReactNode;
  if (grupo) direita = faixaHora(l);
  else if (sit.tipo === 'entregue' && sit.minutos != null) {
    direita = <span className={sit.atrasado ? 'text-red-600 font-extrabold' : undefined}>{quando(p, ctx.hoje)} · {sit.minutos} min</span>;
  } else direita = quando(p, ctx.hoje);

  const marcavel = emLote && l.semNota;

  return (
    <div role="button" tabIndex={0} onClick={() => onAbrir(p)} onKeyDown={aoTeclar(() => onAbrir(p))}
      className={`flex gap-2.5 items-start py-3 cursor-pointer ${cancelado ? 'opacity-60' : ''}`}>
      {marcavel && (
        <div className="flex-shrink-0 self-center -ml-1.5 w-9 h-10 flex items-center justify-center" onClick={parar}>
          <input type="checkbox" checked={!desmarcados.has(p.id)} onChange={() => onMarcar(p.id)}
            aria-label={`Incluir o pedido ${l.num} no lote`}
            className="w-5 h-5 accent-amber-500 cursor-pointer" />
        </div>
      )}
      <IconeCanal canal={l.canal} contagem={grupo ? l.subs.length : undefined} />
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-1.5 min-w-0">
          {grupo ? (
            <>
              <b className="text-[15px] font-extrabold tracking-tight text-zinc-900 truncate min-w-0" title={l.onde}>{l.onde}</b>
              <span className="text-[13.5px] font-bold text-zinc-500 flex-none">· {l.subs.length} pedidos</span>
            </>
          ) : (
            <>
              <b className="text-[15px] font-extrabold tracking-tight text-zinc-900 flex-none">#{l.num}</b>
              <span className="text-[13.5px] font-bold text-zinc-800 truncate min-w-0" title={l.onde}>{l.onde}</span>
            </>
          )}
        </div>
        <p className="text-[12px] text-zinc-400 mt-0.5 truncate" title={linha2(l, chip)}>{linha2(l, chip)}</p>
        {(selos.length > 0 || grupo) && (
          <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
            {selos}
            {grupo && <BotaoVerOs n={l.subs.length} aberto={aberto} onClick={() => onAlternarGrupo(p.id)} />}
          </div>
        )}
        {aberto && (
          <div className="mt-2 border-l-2 border-zinc-200 pl-2.5" onClick={parar}>
            {l.subs.map((s) => (
              <button key={s.id} type="button" onClick={(e) => { e.stopPropagation(); onAbrir(s); }}
                className={`w-full flex items-baseline gap-2 py-1.5 text-left text-[12px] border-t border-dashed border-zinc-200 first:border-t-0 cursor-pointer ${ehCancelado(s) ? 'opacity-60' : ''}`}>
                <b className="flex-none font-extrabold text-zinc-800">#{numeroCurto(s)}</b>
                <span className="flex-1 min-w-0 truncate text-zinc-400" title={`${s.criadoEm} · ${textoItens(s)}`}>{s.criadoEm} · {textoItens(s)}</span>
                <em className={`flex-none not-italic font-extrabold text-zinc-700 ${ehCancelado(s) ? 'line-through' : ''}`}>{brl(s.total)}</em>
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="text-right flex-none">
        <p className={`text-[14.5px] font-extrabold tabular-nums whitespace-nowrap ${cancelado ? 'line-through text-zinc-400' : 'text-zinc-900'}`}>{brl(p.total)}</p>
        <p className="text-[11px] text-zinc-400 mt-0.5 whitespace-nowrap">{direita}</p>
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// Computador
// ═════════════════════════════════════════════════════════════════════════════

const TH = 'px-3 py-2.5 text-left text-[10.5px] uppercase tracking-wide font-extrabold text-zinc-400 bg-zinc-50 border-b border-zinc-200';

function TabelaComputador({ visiveis, selecionadoId, todosMarcados, onAlternarTodos, temElegivel, ...resto }: PropsLista & {
  visiveis: Linha[]; selecionadoId: string | null; todosMarcados: boolean; onAlternarTodos: () => void; temElegivel: boolean;
}) {
  const { emLote } = resto;
  // Colunas de largura fixa; "Itens" fica com o que sobra. O painel do pedido (380 px) divide a tela
  // com a tabela: o Total tem largura própria e a tabela rola de lado em vez de cortar.
  // Com o painel do pedido aberto a coluna "Itens" sai (os itens vão para baixo do onde/quem):
  // senão ela ficava com ~30 px e o Total cortava.
  const compacta = selecionadoId != null;
  const minLargura = (compacta ? 420 : 580) + (emLote ? 40 : 0);
  return (
    <div className="bg-white border border-zinc-200 rounded-2xl overflow-x-auto">
      <table className="w-full table-fixed text-[13px]" style={{ minWidth: minLargura }}>
        <colgroup>
          {emLote && <col style={{ width: 40 }} />}
          <col style={{ width: 84 }} />
          {compacta ? <col /> : <col style={{ width: 210 }} />}
          {!compacta && <col />}
          <col style={{ width: compacta ? 168 : 200 }} />
          <col style={{ width: 100 }} />
        </colgroup>
        <thead>
          <tr>
            {emLote && (
              <th className={`${TH} !px-0 text-center`}>
                <input type="checkbox" checked={todosMarcados} disabled={!temElegivel} onChange={onAlternarTodos}
                  aria-label="Marcar ou desmarcar todos" className="w-4 h-4 accent-amber-500 cursor-pointer disabled:cursor-not-allowed" />
              </th>
            )}
            <th className={TH}>Nº</th>
            <th className={TH}>Onde / quem</th>
            {!compacta && <th className={TH}>Itens</th>}
            <th className={TH}>Situação</th>
            <th className={`${TH} text-right`}>Total</th>
          </tr>
        </thead>
        <tbody>
          {visiveis.map((l) => (
            <LinhasTabela key={l.p.id} l={l} selecionadoId={selecionadoId} compacta={compacta} {...resto} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LinhasTabela({ l, ctx, selecionadoId, compacta, abertos, onAlternarGrupo, onAbrir, emLote, desmarcados, onMarcar }: PropsLista & {
  l: Linha; selecionadoId: string | null; compacta: boolean;
}) {
  const { p, grupo, base } = l;
  const aberto = grupo && abertos.has(p.id);
  const cancelado = l.cancelado;
  const selecionado = selecionadoId != null && (selecionadoId === p.id || (!aberto && l.subs.some((s) => s.id === selecionadoId)));
  const naTelaCancelados = ctx.chip === 'cancelados' && cancelado;
  const marcavel = emLote && l.semNota;

  const selos = grupo
    ? selosGrupo(l, ctx)
    : selosPedido(l, ctx, true);
  const subOnde = l.canal === 'delivery'
    ? (() => { const ent = entregaDoPedido(base); return ent.retirada ? 'Delivery · Retirada' : ent.endereco ? `Delivery · ${ent.endereco}` : 'Delivery'; })()
    : [ROTULO_CANAL[l.canal], base.garcomNome].filter(Boolean).join(' · ');

  // Célula "Itens"
  let itens: ReactNode;
  if (grupo) {
    itens = (
      <>
        <span className="block truncate text-zinc-600" title={`${l.subs.map((s) => `#${numeroCurto(s)}`).join(' · ')} — ${qtdItens(p)} itens`}>
          {l.subs.map((s) => `#${numeroCurto(s)}`).join(' · ')} — {qtdItens(p)} itens
        </span>
        <BotaoVerOs n={l.subs.length} aberto={aberto} onClick={() => onAlternarGrupo(p.id)} />
      </>
    );
  } else if (cancelado) {
    itens = naTelaCancelados ? (
      <>
        <span className="block truncate font-semibold text-red-600" title={motivoCancelamento(p)}>{motivoCancelamento(p)}</span>
        <span className="block truncate text-[11px] text-zinc-400" title={quemCancelou(p)}>{quemCancelou(p)}</span>
      </>
    ) : (
      <span className="block truncate text-zinc-500" title={[motivoCancelamento(p), p.canceladoPor].filter(Boolean).join(' · ')}>{[motivoCancelamento(p), p.canceladoPor].filter(Boolean).join(' · ')}</span>
    );
  } else {
    const t = textoItens(p);
    itens = <span className="block truncate text-zinc-600" title={t}>{t}</span>;
  }

  return (
    <Fragment>
      <tr tabIndex={0} onClick={() => onAbrir(p)} onKeyDown={aoTeclar(() => onAbrir(p))}
        className={`cursor-pointer border-b border-zinc-100 ${selecionado ? 'bg-amber-50' : 'hover:bg-amber-50/40'} ${cancelado ? 'opacity-60' : ''}`}>
        {emLote && (
          <td className="px-0 py-2.5 text-center" onClick={parar}>
            {marcavel && (
              <input type="checkbox" checked={!desmarcados.has(p.id)} onChange={() => onMarcar(p.id)}
                aria-label={`Incluir o pedido ${l.num} no lote`} className="w-4 h-4 accent-amber-500 cursor-pointer" />
            )}
          </td>
        )}
        <td className="px-3 py-2.5 align-middle">
          <b className="text-sm font-extrabold text-zinc-900 whitespace-nowrap">
            #{l.num}{grupo && <span className="ml-1 font-bold text-zinc-400">+{l.subs.length - 1}</span>}
          </b>
          <span className="block text-[11px] text-zinc-400 mt-0.5 whitespace-nowrap">{quando(base, ctx.hoje)}</span>
        </td>
        <td className="px-3 py-2.5 align-middle overflow-hidden">
          <div className="flex items-center gap-2 min-w-0">
            <IconeCanal canal={l.canal} pequeno />
            <div className="min-w-0">
              <p className="font-bold text-zinc-800 truncate" title={grupo ? `${l.onde} · ${l.subs.length} pedidos` : l.onde}>{grupo ? `${l.onde} · ${l.subs.length} pedidos` : l.onde}</p>
              <div className="text-[11px] text-zinc-400 truncate" title={compacta ? (grupo ? `${l.subs.map((s) => `#${numeroCurto(s)}`).join(' · ')} — ${qtdItens(p)} itens` : textoItens(p)) : subOnde}>{compacta ? itens : subOnde}</div>
            </div>
          </div>
        </td>
        {!compacta && <td className="px-3 py-2.5 align-middle overflow-hidden">{itens}</td>}
        <td className="px-3 py-2.5 align-middle overflow-hidden">
          <div className="flex flex-wrap gap-1">
            {naTelaCancelados
              ? <><Selo tom="vermelho" icone="ri-close-circle-line">Cancelado</Selo>{foiParaCozinha(p)
                ? <Selo tom="ambar" icone="ri-fire-line" title="O pedido já tinha ido para a cozinha">já foi p/ cozinha</Selo>
                : <Selo title="O pedido não tinha ido para a cozinha">não foi p/ cozinha</Selo>}</>
              : selos}
          </div>
        </td>
        <td className="px-3 py-2.5 align-middle text-right">
          <b className={`font-extrabold tabular-nums whitespace-nowrap ${cancelado ? 'line-through text-zinc-400' : 'text-zinc-900'}`}>{brl(p.total)}</b>
        </td>
      </tr>

      {aberto && l.subs.map((s) => {
        const sub = montarSub(s, ctx);
        return (
          <tr key={s.id} tabIndex={0} onClick={() => onAbrir(s)} onKeyDown={aoTeclar(() => onAbrir(s))}
            className={`cursor-pointer border-b border-zinc-100 bg-zinc-50/70 ${selecionadoId === s.id ? '!bg-amber-50' : 'hover:bg-amber-50/40'} ${ehCancelado(s) ? 'opacity-60' : ''}`}>
            {emLote && <td />}
            <td className="pl-5 pr-3 py-2 align-middle whitespace-nowrap">
              <span className="text-zinc-400">↳</span> <b className="font-extrabold text-zinc-800">#{sub.num}</b>
            </td>
            <td className="px-3 py-2 align-middle text-[11px] text-zinc-400">{s.criadoEm}</td>
            {!compacta && <td className="px-3 py-2 align-middle overflow-hidden"><span className="block truncate text-zinc-500" title={textoItens(s)}>{textoItens(s)}</span></td>}
            <td className="px-3 py-2 align-middle overflow-hidden"><div className="flex flex-wrap gap-1">{selosPedido(sub, ctx, true)}</div></td>
            <td className="px-3 py-2 align-middle text-right">
              <span className={`tabular-nums whitespace-nowrap text-zinc-600 ${ehCancelado(s) ? 'line-through text-zinc-400' : ''}`}>{brl(s.total)}</span>
            </td>
          </tr>
        );
      })}
    </Fragment>
  );
}

/** Linha de um pedido de dentro do grupo (a nota é do grupo, por isso não marca "sem nota"). */
function montarSub(s: PedidoRecente, ctx: Ctx): Linha {
  return { ...montarLinha(s, { ...ctx, fiscalAtivo: false }), semNota: false };
}
