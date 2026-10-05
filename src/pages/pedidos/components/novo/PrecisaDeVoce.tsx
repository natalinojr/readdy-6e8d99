import { useState, type ReactNode } from 'react';
import type { PedidoRecente } from '@/types/pdv';
import {
  CartaoAcao, CartaoBarra, SecaoTitulo, brl, btn, type CorBarra,
} from '@/pages/estoque/components/ui/EstoqueUi';
import {
  META_PEDIDO_MIN, diaBR, ehEntregue, numeroCurto, ondeQuem, situacaoPedido,
  type FiltroChip, type PendenciasPedidos, type ResumoPedidos,
} from '@/lib/pedidosRegras';
import type { AcoesPedido } from '@/pages/pedidos/lib/acoesTipos';

// "Precisa de você": só o que tem problema, cada cartão com o botão que resolve
// (protótipo docs/prototipos/pedidos-proposta.html, tela "Hoje"). As listas vêm de
// pendenciasPedidos() em src/lib/pedidosRegras.ts; aqui só se desenha e se chama as ações.

export interface EsquecidosPedidos {
  ids: string[];
  /** Número de um dos pedidos esquecidos, para a pessoa reconhecer. */
  exemplo?: string;
}

/** Ids dos pedidos esquecidos andando: os parados da lista carregada + os de outros dias, sem repetir. */
export function idsEsquecidos(pend: PendenciasPedidos, esquecidos: EsquecidosPedidos): string[] {
  return [...new Set([...pend.parados.map((p) => p.id), ...esquecidos.ids])];
}

/** Quantos cartões "Precisa de você" aparecem. A página usa o mesmo número na frase de cima. */
export function contarPendencias(pend: PendenciasPedidos, esquecidos: EsquecidosPedidos, fiscalAtivo: boolean): number {
  return (pend.naoPagos.length > 0 ? 1 : 0)
    + (fiscalAtivo && pend.semNota.length > 0 ? 1 : 0)
    + (pend.atrasados.length > 0 ? 1 : 0)
    + (idsEsquecidos(pend, esquecidos).length > 0 ? 1 : 0);
}

const juntar = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} e ${xs[xs.length - 1]}`);
/** "#038, #041 e #047" (passando de `max`, "#038, #041, #047, #050, #051 e mais 3"). */
function listaNumeros(ps: PedidoRecente[], max = 5): string {
  const nums = ps.map((p) => `#${numeroCurto(p)}`);
  return nums.length <= max ? juntar(nums) : `${nums.slice(0, max).join(', ')} e mais ${nums.length - max}`;
}
const somar = (ps: PedidoRecente[]) => ps.reduce((a, p) => a + p.total, 0);

/** Itens (sem os cancelados) e quantos já estão prontos. Item sem cozinha esperando já conta como pronto. */
function contarItens(p: PedidoRecente): { total: number; prontos: number } {
  let total = 0;
  let prontos = 0;
  for (const i of p.itensDetalhes) {
    if (i.cancelado) continue;
    total += i.quantidade;
    for (const u of i.unidades ?? []) {
      if (u.status === 'pronto' || u.status === 'entregue' || (u.semCozinha && u.status === 'aguardando')) prontos++;
    }
  }
  return { total, prontos };
}

// ── Cartão com a faixa colorida à esquerda (como no protótipo) ────────────────
function Cartao({ cor, icone, titulo, direita, children, acoes }: {
  cor: Extract<CorBarra, 'red' | 'amber'>;
  icone: string;
  titulo: ReactNode;
  direita?: ReactNode;
  children: ReactNode;
  acoes: ReactNode;
}) {
  const corIcone = cor === 'red' ? 'bg-red-100 text-red-600' : 'bg-amber-100 text-amber-700';
  return (
    <CartaoBarra cor={cor} className="flex flex-col">
      <div className="flex items-start gap-2.5">
        <span className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 ${corIcone}`}><i className={`${icone} text-base`} /></span>
        <p className="flex-1 min-w-0 pt-1 text-[14.5px] font-extrabold text-zinc-900 leading-snug">{titulo}</p>
        {direita != null && <span className="flex-shrink-0 pt-1 text-[13.5px] font-extrabold text-zinc-900 whitespace-nowrap tabular-nums">{direita}</span>}
      </div>
      <div className="text-[12.5px] text-zinc-600 leading-relaxed mt-1">{children}</div>
      <div className="flex gap-2 flex-wrap items-center mt-auto pt-2.5">{acoes}</div>
    </CartaoBarra>
  );
}

// ── Não pagos ─────────────────────────────────────────────────────────────────
function CartaoNaoPagos({ lista, acoes, onAbrir, onChip, hoje }: {
  lista: PedidoRecente[]; acoes: AcoesPedido; onAbrir: (p: PedidoRecente) => void; onChip: (c: FiltroChip) => void; hoje: string;
}) {
  if (lista.length === 1) {
    const p = lista[0];
    const dia = p._criadoTs ? diaBR(p._criadoTs) : (p.dataPedido ?? hoje);
    const quando = dia !== hoje ? `${dia.slice(8, 10)}/${dia.slice(5, 7)} ${p.criadoEm}` : p.criadoEm;
    const quem = [ondeQuem(p), quando, p.garcomNome ? `lançado por ${p.garcomNome}` : null].filter(Boolean).join(' · ');
    return (
      <Cartao
        cor="red" icone="ri-money-dollar-circle-line"
        titulo={`#${numeroCurto(p)} não foi pago`}
        direita={brl(p.total)}
        acoes={(
          <>
            {acoes.podeCobrar
              ? <button type="button" className={btn('p', 'sm')} onClick={() => acoes.cobrar(p)}>Cobrar</button>
              : <span className="text-[12.5px] font-semibold text-zinc-500">Avise o caixa</span>}
            <button type="button" className={btn('out', 'sm')} onClick={() => onAbrir(p)}>Ver pedido</button>
          </>
        )}
      >
        {quem}. {ehEntregue(p) ? 'Já saiu da cozinha.' : 'Ainda aparece como andando.'}
      </Cartao>
    );
  }
  return (
    <Cartao
      cor="red" icone="ri-money-dollar-circle-line"
      titulo={`${lista.length} pedidos não pagos`}
      direita={brl(somar(lista))}
      acoes={<button type="button" className={btn('p', 'sm')} onClick={() => onChip('naopago')}>Ver quais</button>}
    >
      {listaNumeros(lista)}. Ninguém registrou o pagamento.
    </Cartao>
  );
}

// ── Sem nota ──────────────────────────────────────────────────────────────────
function CartaoSemNota({ lista, onChip }: { lista: PedidoRecente[]; onChip: (c: FiltroChip) => void }) {
  const n = lista.length;
  return (
    <Cartao
      cor="amber" icone="ri-file-shield-2-line"
      titulo={n === 1 ? '1 pago sem nota fiscal' : `${n} pagos sem nota fiscal`}
      direita={brl(somar(lista))}
      acoes={(
        <>
          {/* A emissão em lote fica na lista, no filtro "Sem nota" (já com tudo marcado). */}
          <button type="button" className={btn('p', 'sm')} onClick={() => onChip('semnota')}>{n === 1 ? 'Emitir a nota' : `Emitir as ${n}`}</button>
          <button type="button" className={btn('out', 'sm')} onClick={() => onChip('semnota')}>{n === 1 ? 'Ver qual' : 'Ver quais'}</button>
        </>
      )}
    >
      {listaNumeros(lista)}. A loja emite NFC-e e {n === 1 ? 'ele ficou' : 'eles ficaram'} sem.
    </Cartao>
  );
}

// ── Atrasados ─────────────────────────────────────────────────────────────────
function CartaoAtrasados({ lista, acoes, onAbrir, onChip, agoraMs, hoje }: {
  lista: PedidoRecente[]; acoes: AcoesPedido; onAbrir: (p: PedidoRecente) => void; onChip: (c: FiltroChip) => void; agoraMs: number; hoje: string;
}) {
  if (lista.length === 1) {
    const p = lista[0];
    const sit = situacaoPedido(p, agoraMs, hoje);
    const num = numeroCurto(p);
    const titulo = sit.tipo === 'pronto'
      ? (sit.minutos != null ? `#${num} pronto, esperando há ${sit.minutos} min` : `#${num} pronto e ainda não entregue`)
      : `#${num} na cozinha há ${sit.minutos ?? 0} min`;
    const { total, prontos } = contarItens(p);
    const doItem = prontos === 0 ? 'nenhum pronto' : prontos === 1 ? '1 pronto' : `${prontos} prontos`;
    return (
      <Cartao
        cor="amber" icone="ri-fire-line"
        titulo={titulo}
        direita={`meta ${META_PEDIDO_MIN}`}
        acoes={(
          <>
            <button type="button" className={btn('out', 'sm')} onClick={() => onAbrir(p)}>Ver pedido</button>
            <button type="button" className={btn('out', 'sm')} onClick={() => acoes.abrirNoGestor(p)}>
              <i className="ri-layout-column-line" />Abrir no Gestor
            </button>
          </>
        )}
      >
        {ondeQuem(p)} · {total} {total === 1 ? 'item' : 'itens'}, <b className="text-zinc-900">{doItem}</b>.
      </Cartao>
    );
  }
  return (
    <Cartao
      cor="amber" icone="ri-fire-line"
      titulo={`${lista.length} pedidos passaram da meta`}
      direita={`meta ${META_PEDIDO_MIN}`}
      acoes={<button type="button" className={btn('out', 'sm')} onClick={() => onChip('cozinha')}>Ver</button>}
    >
      {listaNumeros(lista)} ainda não foram entregues e já passaram do tempo.
    </Cartao>
  );
}

// ── Esquecidos (andando de outros dias) ───────────────────────────────────────
// Desligado na revisão de 2026-10-05: entregar pedido de outro dia dá baixa de estoque com a data de hoje,
// por cima de contagens feitas depois. Falta o dono decidir: fechar sem mexer no estoque ou baixar hoje.
const MARCAR_ESQUECIDOS = false;

function CartaoEsquecidos({ ids, exemplo, acoes, onChip, onVer }: {
  ids: string[]; exemplo?: string; acoes: AcoesPedido; onChip: (c: FiltroChip) => void; onVer?: () => void;
}) {
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const n = ids.length;

  const marcar = async () => {
    if (ocupado) return;
    const ok = window.confirm(
      `Marcar ${n} ${n === 1 ? 'pedido de outro dia como entregue' : 'pedidos de outros dias como entregues'}?\n\n`
      + `${n === 1 ? 'Ele sai' : 'Eles saem'} da lista de andando e o tempo ${n === 1 ? 'dele' : 'deles'} para de correr.\n\n`
      + 'Os itens que ainda não tinham saído da cozinha dão baixa no estoque com a data de hoje (igual a entregar pelo Gestor).',
    );
    if (!ok) return;
    setOcupado(true);
    setAviso(null);
    try {
      const feitos = await acoes.marcarEntregues(ids);
      if (feitos < n) {
        setAviso(feitos === 0
          ? 'Não foi possível marcar. Tente de novo ou use o Gestor de pedidos.'
          : `Só ${feitos} de ${n} foram marcados. Tente de novo para os outros.`);
      }
    } catch {
      setAviso('Não foi possível marcar. Tente de novo ou use o Gestor de pedidos.');
    } finally {
      setOcupado(false);
    }
  };

  return (
    <Cartao
      cor="red" icone="ri-alarm-warning-line"
      titulo={n === 1 ? '1 pedido de outro dia ainda andando' : `${n} pedidos de outros dias ainda andando`}
      acoes={(
        <>
          {MARCAR_ESQUECIDOS && acoes.podeEntregar && (
            <button type="button" className={btn('p', 'sm')} disabled={ocupado} onClick={marcar}>
              {ocupado
                ? <><i className="ri-loader-4-line animate-spin" />Marcando…</>
                : n === 1 ? 'Marcar como entregue' : 'Marcar como entregues'}
            </button>
          )}
          <button type="button" className={btn('out', 'sm')} onClick={() => (onVer ? onVer() : onChip('cozinha'))}>Ver</button>
        </>
      )}
    >
      {n === 1
        ? 'Nunca foi marcado como entregue: deixa a cozinha cheia e o tempo dele fica correndo.'
        : 'Nunca foram marcados como entregues: deixam a cozinha cheia e o tempo deles fica correndo.'}
      {exemplo ? <span className="text-zinc-400"> Ex.: {exemplo}.</span> : null}
      {aviso && <span className="block mt-1 font-semibold text-red-600">{aviso}</span>}
    </Cartao>
  );
}

// ── Seção ─────────────────────────────────────────────────────────────────────
export default function PrecisaDeVoce({ pend, esquecidos, resumo, acoes, onAbrir, onChip, onVerEsquecidos, agoraMs, hoje, fiscalAtivo, carregando = false }: {
  pend: PendenciasPedidos;
  /** Pedidos andando de outros dias (lista carregada + hook usePedidosEsquecidos). */
  esquecidos: EsquecidosPedidos;
  resumo: ResumoPedidos;
  acoes: AcoesPedido;
  onAbrir: (p: PedidoRecente) => void;
  onChip: (c: FiltroChip) => void;
  /** "Ver" dos esquecidos: eles são de outros dias, então a página troca o período antes do filtro. */
  onVerEsquecidos?: () => void;
  agoraMs: number;
  hoje: string;
  fiscalAtivo: boolean;
  /** Pedidos do filtro novo ainda chegando: não diz "Tudo certo" com a lista do filtro anterior. */
  carregando?: boolean;
}) {
  const idsEsq = idsEsquecidos(pend, esquecidos);
  const mostrarSemNota = fiscalAtivo && pend.semNota.length > 0;
  const n = contarPendencias(pend, esquecidos, fiscalAtivo);

  if (n === 0) {
    if (carregando) return null;
    return (
      <CartaoAcao tom="ok" icone="ri-checkbox-circle-line" titulo="Tudo certo com os pedidos">
        {resumo.pedidos === 0 ? 'Nenhum pedido neste período.' : (
          <>
            {fiscalAtivo ? 'Todos pagos, com nota e entregues.' : 'Todos pagos e entregues.'}
            {resumo.tempoMedio != null && <> Tempo médio <b className="text-zinc-900">{resumo.tempoMedio} min</b> (meta {META_PEDIDO_MIN}).</>}
          </>
        )}
      </CartaoAcao>
    );
  }

  return (
    <section>
      <SecaoTitulo titulo="Precisa de você" n={n} />
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        {pend.naoPagos.length > 0 && (
          <CartaoNaoPagos lista={pend.naoPagos} acoes={acoes} onAbrir={onAbrir} onChip={onChip} hoje={hoje} />
        )}
        {mostrarSemNota && <CartaoSemNota lista={pend.semNota} onChip={onChip} />}
        {pend.atrasados.length > 0 && (
          <CartaoAtrasados lista={pend.atrasados} acoes={acoes} onAbrir={onAbrir} onChip={onChip} agoraMs={agoraMs} hoje={hoje} />
        )}
        {idsEsq.length > 0 && (
          <CartaoEsquecidos ids={idsEsq} exemplo={esquecidos.exemplo} acoes={acoes} onChip={onChip} onVer={onVerEsquecidos} />
        )}
      </div>
    </section>
  );
}
