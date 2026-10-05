import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { PagamentoPedido, PedidoRecente } from '@/types/pdv';
import type { FiscalDocumentRow } from '@/lib/fiscal';
import type { useFiscalDocs } from '@/hooks/useFiscalDocs';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { somarDias } from '@/lib/dateUtils';
import {
  ROTULO_CANAL, canalPedido, diaBR, ehCancelado, notaViva, numeroCurto, ondeQuem, situacaoPedido, type Situacao,
} from '@/lib/pedidosRegras';
import Folha from '@/pages/estoque/components/inicio/Folha';
import { Etiqueta, brl, btn } from '@/pages/estoque/components/ui/EstoqueUi';
import type { AcoesPedido } from '../../lib/acoesTipos';
import EmitirNfModal from '../EmitirNfModal';

// Detalhe de "pagos juntos" (era o "Card Unificado") e as peças que ele divide com PedidoDetalhe:
// casca folha/painel, blocos, conta, pagamento e nota fiscal. Ficam aqui porque PedidoDetalhe
// importa este arquivo (o contrário seria uma importação circular).

type Fiscal = ReturnType<typeof useFiscalDocs>;
type OnToast = (ok: boolean, titulo: string, msg?: string) => void;

export interface PropsDetalhe {
  pedido: PedidoRecente;
  /** 'folha' = celular/tablet (sobe de baixo); 'painel' = computador (cartão ao lado da lista). */
  modo: 'folha' | 'painel';
  aberto: boolean;
  onFechar: () => void;
  /** Abre outro pedido (ex.: tocar num pedido do grupo). */
  onAbrirPedido: (p: PedidoRecente) => void;
  agoraMs: number;
  /** Dia de hoje em Brasília (AAAA-MM-DD). */
  hoje: string;
  fiscal: Fiscal;
  onToast: OnToast;
  acoes: AcoesPedido;
}

// ── Horas e dias (sempre em Brasília) ─────────────────────────────────────────
const TZ = 'America/Sao_Paulo';

/** "19:11" em Brasília; null se não houver horário válido. */
export function hhmm(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: TZ });
}

/** "Hoje", "Ontem" ou "03/10". */
export function rotuloDia(dia: string, hoje: string): string {
  if (dia === hoje) return 'Hoje';
  if (dia === somarDias(hoje, -1)) return 'Ontem';
  return `${dia.slice(8, 10)}/${dia.slice(5, 7)}`;
}

/** Dia (AAAA-MM-DD, Brasília) em que o pedido foi feito. */
export function diaDoPedido(p: PedidoRecente, hoje: string): string {
  return p._criadoTs ? diaBR(p._criadoTs) : (p.dataPedido ?? hoje);
}

const qtdItens = (p: PedidoRecente) => p.itensDetalhes.filter((i) => !i.cancelado).reduce((a, i) => a + i.quantidade, 0);

// ── Casca: folha (celular) ou painel (computador) ────────────────────────────
export function Casca({ modo, aberto, onFechar, titulo, subtitulo, rodape, chave, escAtivo = true, children }: {
  modo: 'folha' | 'painel';
  aberto: boolean;
  onFechar: () => void;
  titulo: string;
  subtitulo?: string;
  rodape?: ReactNode;
  /** Muda quando outro pedido é aberto: o corpo volta ao topo. */
  chave: string;
  /** false enquanto uma janela por cima (ex.: CPF da nota) tem o Esc dela. */
  escAtivo?: boolean;
  children: ReactNode;
}) {
  const topo = useRef<HTMLDivElement>(null);
  const chaveAnterior = useRef(chave);
  useEffect(() => {
    if (chaveAnterior.current === chave) return;
    chaveAnterior.current = chave;
    topo.current?.scrollIntoView({ block: 'nearest' });
  }, [chave]);

  useEffect(() => {
    if (!aberto || !escAtivo) return;
    // Com outra janela por cima (cobrar, cancelar, período…), o Esc é dela
    const fechar = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const sobrepostas = document.querySelectorAll('.fixed.inset-0').length;
      if (sobrepostas > (modo === 'folha' ? 1 : 0)) return;
      onFechar();
    };
    window.addEventListener('keydown', fechar);
    return () => window.removeEventListener('keydown', fechar);
  }, [aberto, escAtivo, onFechar]);

  const corpo = <><div ref={topo} aria-hidden /><div className="pb-2">{children}</div></>;

  if (modo === 'folha') {
    return <Folha aberta={aberto} titulo={titulo} subtitulo={subtitulo} onFechar={onFechar} rodape={rodape}>{corpo}</Folha>;
  }
  if (!aberto) return null;
  return (
    <aside aria-label="Detalhe do pedido" className="bg-white border border-zinc-200 rounded-2xl lg:sticky lg:top-4 flex flex-col max-h-[calc(100dvh-2rem)]">
      <div className="px-4 pt-3.5 pb-2 relative flex-shrink-0">
        <h3 className="text-[17px] font-extrabold text-zinc-900 pr-10 leading-snug">{titulo}</h3>
        {subtitulo && <p className="text-xs text-zinc-500 mt-0.5">{subtitulo}</p>}
        <button type="button" onClick={onFechar} aria-label="Fechar"
          className="absolute right-3 top-3 w-9 h-9 rounded-full bg-zinc-100 hover:bg-zinc-200 flex items-center justify-center cursor-pointer">
          <i className="ri-close-line text-lg text-zinc-600" />
        </button>
      </div>
      <div className="px-4 py-1 overflow-y-auto flex-1 min-h-0">{corpo}</div>
      {rodape && <div className="px-4 pt-3 pb-4 border-t border-zinc-100 flex gap-2 flex-shrink-0">{rodape}</div>}
    </aside>
  );
}

// ── Blocos e linhas ──────────────────────────────────────────────────────────
export function Bloco({ titulo, direita, children, className = '' }: {
  titulo: string; direita?: ReactNode; children: ReactNode; className?: string;
}) {
  return (
    <section className={`bg-zinc-50 border border-zinc-100 rounded-2xl px-3.5 py-3 mt-2.5 ${className}`}>
      <div className="flex items-center justify-between gap-2 mb-1.5 min-h-[20px]">
        <h4 className="text-[11px] font-extrabold tracking-wider uppercase text-zinc-400">{titulo}</h4>
        {direita}
      </div>
      {children}
    </section>
  );
}

const COR_LINHA = { neutro: 'text-zinc-900', red: 'text-red-600', verde: 'text-emerald-700', laranja: 'text-orange-700' } as const;

export function Linha({ rotulo, valor, tom = 'neutro', forte = false, riscado = false }: {
  rotulo: ReactNode; valor: ReactNode; tom?: keyof typeof COR_LINHA; forte?: boolean; riscado?: boolean;
}) {
  return (
    <div className={`flex items-baseline justify-between gap-3 ${forte ? 'border-t border-zinc-200 mt-1 pt-2.5 text-[15px]' : 'py-1 text-[13px]'}`}>
      <span className={forte ? 'font-extrabold text-zinc-900' : 'text-zinc-500'}>{rotulo}</span>
      <b className={`text-right tabular-nums ${forte ? 'font-extrabold' : 'font-bold'} ${riscado ? 'line-through text-zinc-400' : COR_LINHA[tom]}`}>{valor}</b>
    </div>
  );
}

// ── Selo da situação (um só por pedido) ──────────────────────────────────────
export function tomDaSituacao(sit: Situacao): 'red' | 'amber' | 'green' | 'blue' | 'zinc' {
  switch (sit.tipo) {
    case 'cozinha': return sit.atrasado ? 'red' : 'amber';
    case 'pronto': return 'green';
    case 'saiu': return 'blue';
    case 'cancelado':
    case 'parado': return 'red';
    default: return 'zinc';
  }
}

export function SeloSituacao({ sit }: { sit: Situacao }) {
  return (
    <Etiqueta tom={tomDaSituacao(sit)}>
      {sit.tipo === 'cozinha' && <span className="inline-block w-1.5 h-1.5 rounded-full bg-current animate-pulse mr-1 align-middle" />}
      {sit.rotulo}
    </Etiqueta>
  );
}

// ── Conta (subtotal, desconto, serviço, gorjeta, entrega, total) ─────────────
export interface Conta {
  /** Itens, ANTES do desconto. */
  subtotal: number;
  desconto: number;
  servico: number;
  gorjeta: number;
  entrega: number;
  total: number;
}

const numero = (v: unknown, fallback: number): number => {
  if (v == null) return fallback; // 0 é valor real: só null/undefined cai no plano B
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

function contaDoPedido(p: PedidoRecente): Conta {
  return {
    subtotal: p.subtotal ?? p.total,
    desconto: p.desconto ?? 0,
    servico: p.serviceFee ?? 0,
    gorjeta: p.tipAmount ?? 0,
    entrega: p.deliveryFee ?? 0,
    total: p.total,
  };
}

interface LinhaContaDB {
  id: string;
  subtotal: number | string | null;
  discount_amount: number | string | null;
  service_fee_amount: number | string | null;
  tip_amount: number | string | null;
  total_amount: number | string | null;
  delivery_fee: number | string | null;
}

/**
 * Conta somada dos pedidos, lida do banco (a lista não traz todos os campos). Enquanto não chega,
 * ou se falhar, usa o que o pedido já trouxe. Só devolve números do mesmo conjunto de pedidos.
 */
export function useContas(pedidos: PedidoRecente[]): Conta {
  const { user } = useAuth();
  const tenantId = user?.tenantId;
  const chave = `${tenantId ?? ''}:${pedidos.map((p) => p.id).join(',')}`;
  const [dados, setDados] = useState<{ chave: string; linhas: Record<string, LinhaContaDB> } | null>(null);

  useEffect(() => {
    if (!tenantId || pedidos.length === 0) return;
    let cancelado = false;
    supabase
      .from('orders')
      .select('id, subtotal, discount_amount, service_fee_amount, tip_amount, total_amount, delivery_fee')
      .eq('tenant_id', tenantId)
      .in('id', pedidos.map((p) => p.id))
      .then(({ data }) => {
        if (cancelado || !data) return;
        const linhas: Record<string, LinhaContaDB> = {};
        for (const r of data as LinhaContaDB[]) linhas[r.id] = r;
        setDados({ chave, linhas });
      });
    return () => { cancelado = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave]);

  const linhas = dados && dados.chave === chave ? dados.linhas : null;
  return pedidos.reduce<Conta>((soma, p) => {
    const fb = contaDoPedido(p);
    const r = linhas?.[p.id];
    const c: Conta = r
      ? {
          subtotal: numero(r.subtotal, fb.subtotal),
          desconto: numero(r.discount_amount, fb.desconto),
          servico: numero(r.service_fee_amount, fb.servico),
          gorjeta: numero(r.tip_amount, fb.gorjeta),
          entrega: numero(r.delivery_fee, fb.entrega),
          total: numero(r.total_amount, fb.total),
        }
      : fb;
    return {
      subtotal: soma.subtotal + c.subtotal, desconto: soma.desconto + c.desconto, servico: soma.servico + c.servico,
      gorjeta: soma.gorjeta + c.gorjeta, entrega: soma.entrega + c.entrega, total: soma.total + c.total,
    };
  }, { subtotal: 0, desconto: 0, servico: 0, gorjeta: 0, entrega: 0, total: 0 });
}

export function ContaBloco({ conta, riscado = false }: { conta: Conta; riscado?: boolean }) {
  return (
    <Bloco titulo="Conta">
      <Linha rotulo="Itens" valor={brl(conta.subtotal)} />
      {conta.desconto > 0.005 && <Linha rotulo="Desconto" valor={`− ${brl(conta.desconto)}`} tom="red" />}
      {conta.servico > 0.005 && <Linha rotulo="Serviço" valor={`+ ${brl(conta.servico)}`} />}
      {conta.gorjeta > 0.005 && <Linha rotulo="Gorjeta" valor={`+ ${brl(conta.gorjeta)}`} />}
      {conta.entrega > 0.005 && <Linha rotulo="Entrega" valor={`+ ${brl(conta.entrega)}`} />}
      <Linha rotulo="Total" valor={brl(conta.total)} forte riscado={riscado} />
    </Bloco>
  );
}

// ── Pagamento ────────────────────────────────────────────────────────────────
function paymentIcon(name: string | null, type?: string | null, change?: number | null): string {
  if (change != null && change > 0) return 'ri-money-dollar-circle-line';
  const t = (type ?? '').toLowerCase();
  if (t === 'dinheiro') return 'ri-money-dollar-circle-line';
  if (t === 'credito' || t === 'crédito') return 'ri-bank-card-line';
  if (t === 'debito' || t === 'débito') return 'ri-bank-card-2-line';
  if (t === 'pix') return 'ri-qr-code-line';
  if (t === 'vale') return 'ri-coupon-line';
  if (!name) return 'ri-wallet-3-line';
  const n = name.toLowerCase();
  if (n.includes('pix')) return 'ri-qr-code-line';
  if (n.includes('dinheiro') || n.includes('espécie') || n.includes('especie') || n.includes('cash')) return 'ri-money-dollar-circle-line';
  if (n.includes('crédito') || n.includes('credito')) return 'ri-bank-card-line';
  if (n.includes('débito') || n.includes('debito')) return 'ri-bank-card-2-line';
  if (n.includes('vale') || n.includes('vr') || n.includes('va')) return 'ri-coupon-line';
  return 'ri-wallet-3-line';
}

function ehDinheiro(name: string | null, type?: string | null, change?: number | null): boolean {
  if (change != null && change > 0) return true;
  if ((type ?? '').toLowerCase() === 'dinheiro') return true;
  if (!name) return false;
  const n = name.toLowerCase();
  return n.includes('dinheiro') || n.includes('espécie') || n.includes('especie') || n.includes('cash');
}

/** Nome da forma de pagamento: o que o caixa deu, ou o tipo em português. */
export function formaPagamentoNome(pg: Pick<PagamentoPedido, 'payment_method_name' | 'payment_method_type' | 'change_amount'>): string {
  if (pg.payment_method_name) return pg.payment_method_name;
  const t = (pg.payment_method_type ?? '').toLowerCase();
  if (t === 'dinheiro' || (pg.change_amount != null && pg.change_amount > 0)) return 'Dinheiro';
  if (t === 'credito' || t === 'crédito') return 'Cartão de crédito';
  if (t === 'debito' || t === 'débito') return 'Cartão de débito';
  if (t === 'pix') return 'Pix';
  if (t === 'vale') return 'Vale/Refeição';
  return 'Forma não identificada';
}

/**
 * Pagamento do pedido. Em pagamento em conjunto (payment_group) o pedido principal grava o valor do
 * GRUPO inteiro; aqui mostra só a parte deste pedido e avisa que foi pago junto com outros.
 * `consolidado` = pagamentos já somados por forma (ver consolidatePayments): o valor já é o cobrado.
 */
export function PagamentoBloco({ pagamentos, total, pago, cancelado, consolidado = false }: {
  pagamentos: PagamentoPedido[]; total: number; pago: boolean; cancelado: boolean; consolidado?: boolean;
}) {
  if (pagamentos.length === 0) {
    if (cancelado) return null;
    return (
      <Bloco titulo="Pagamento">
        {total <= 0.005
          ? <Linha rotulo="Sem valor a receber" valor={brl(0)} />
          : pago
            ? <Linha rotulo="Pago" valor="forma não registrada" tom="verde" />
            : <Linha rotulo="Nenhum pagamento registrado" valor={`falta ${brl(total)}`} tom="laranja" />}
      </Bloco>
    );
  }

  const emConjunto = (pg: PagamentoPedido) => !consolidado && !!pg.payment_group_id && pg.amount > total + 0.01;
  const cobrado = (pg: PagamentoPedido) => (emConjunto(pg) ? total : pg.amount);
  const totalPago = pagamentos.reduce((a, pg) => a + cobrado(pg), 0);

  return (
    <Bloco titulo="Pagamento" direita={pago ? <Etiqueta tom="green">Pago</Etiqueta> : undefined}>
      {pagamentos.map((pg) => {
        const din = ehDinheiro(pg.payment_method_name, pg.payment_method_type, pg.change_amount);
        const troco = pg.change_amount != null && pg.change_amount > 0 ? pg.change_amount : 0;
        const valor = cobrado(pg);
        return (
          <div key={pg.id} className="py-2 border-t border-zinc-200/70 first:border-t-0">
            <div className="flex items-center gap-2.5">
              <span className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 ${din ? 'bg-emerald-100 text-emerald-700' : 'bg-white border border-zinc-200 text-zinc-500'}`}>
                <i className={`${paymentIcon(pg.payment_method_name, pg.payment_method_type, pg.change_amount)} text-base`} />
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-[13.5px] font-bold text-zinc-800 leading-tight flex items-center gap-1.5 flex-wrap">
                  {formaPagamentoNome(pg)}
                  {pg.is_refunded && <Etiqueta tom="red">estornado</Etiqueta>}
                </p>
                {din && troco > 0 && (
                  <p className="text-[11.5px] text-zinc-500 mt-0.5">Entregue {brl(valor + troco)} · troco {brl(troco)}</p>
                )}
                {pg.operator_name && (
                  <p className="text-[11.5px] text-zinc-500 mt-0.5">Recebido por <b className="text-zinc-700">{pg.operator_name}</b></p>
                )}
              </div>
              <b className="text-[14px] font-extrabold tabular-nums text-zinc-900 flex-shrink-0">{brl(valor)}</b>
            </div>
            {emConjunto(pg) && (
              <p className="mt-1.5 ml-[42px] text-[11.5px] text-zinc-500 leading-snug">
                <i className="ri-links-line text-amber-500 mr-1" />
                Pago junto com outros pedidos, total {brl(pg.amount)}. O valor acima é a parte deste pedido.
              </p>
            )}
          </div>
        );
      })}
      {pagamentos.length > 1 && <Linha rotulo="Total pago" valor={brl(totalPago)} forte />}
    </Bloco>
  );
}

/**
 * Soma os pagamentos por forma (Pix + Pix = um Pix). Em pagamento em conjunto o principal grava o
 * valor do grupo inteiro e os outros o deles: a soma passa do total, então o cobrado é limitado ao
 * total dos pedidos (a venda real). O troco não escala: é o troco real, dado uma vez.
 */
export function consolidatePayments(pedidos: PedidoRecente[]): { pagamentos: PagamentoPedido[]; total: number } {
  const todos = pedidos.flatMap((p) => p.pagamentos ?? []);
  const total = pedidos.reduce((acc, p) => acc + p.total, 0);

  const agrupado = new Map<string, PagamentoPedido>();
  for (const pg of todos) {
    const chave = `${pg.payment_method_name || ''}::${pg.payment_method_type || ''}`;
    const atual = agrupado.get(chave);
    if (atual) {
      atual.amount += pg.amount;
      atual.change_amount += pg.change_amount ?? 0;
    } else {
      agrupado.set(chave, { ...pg, change_amount: pg.change_amount ?? 0 });
    }
  }
  const lista = Array.from(agrupado.values());
  const somaPagamentos = lista.reduce((a, g) => a + g.amount, 0);
  if (somaPagamentos > total && somaPagamentos > 0) {
    const fator = total / somaPagamentos;
    lista.forEach((g) => { g.amount *= fator; });
  }
  return { pagamentos: lista, total };
}

// ── Nota fiscal ──────────────────────────────────────────────────────────────
/** Emite (ou reemite) as notas dos pedidos `ids`, pulando as que já estão vivas, e avisa o resultado. */
export async function emitirNotas(
  fiscal: Fiscal, ids: string[], consumer: { cpf?: string; name?: string } | null, onToast: OnToast,
): Promise<void> {
  let ok = 0;
  let falha: string | null = null;
  for (const id of ids) {
    const d = fiscal.byOrder.get(id);
    if (d && (d.status === 'authorized' || d.status === 'processing')) continue;
    const r = await fiscal.emitir(id, consumer);
    if (r.success) ok++; else falha = r.message ?? r.status;
    // Pedidos pagos juntos: a fiscal-write emite UMA nota do grupo, que já cobre os demais.
    if (r.source_type === 'payment_group') break;
  }
  if (falha) onToast(false, ok > 0 ? `${ok} nota(s) autorizada(s), 1 falhou` : 'Nota não autorizada', falha);
  else if (ok > 0) onToast(true, ok === 1 ? 'NFC-e autorizada' : `${ok} NFC-e autorizadas`);
}

/** Linha da nota fiscal de um pedido (ou do grupo): número, situação e os botões Ver / Imprimir cupom. */
export function NotaDoc({ doc, fiscal, onToast, extra }: {
  doc: FiscalDocumentRow; fiscal: Fiscal; onToast: OnToast; extra?: string;
}) {
  const ocupado = fiscal.busy.has(doc.source_id);
  const numeroNota = doc.numero != null ? doc.numero.toLocaleString('pt-BR') : '';
  const hora = hhmm(doc.emitted_at);
  const homolog = doc.environment === 2 ? <Etiqueta tom="amber">homologação</Etiqueta> : null;

  if (doc.status === 'processing' || doc.status === 'pending') {
    return (
      <p className="flex items-center gap-1.5 text-[13px] font-semibold text-sky-600 py-1">
        <i className="ri-loader-4-line animate-spin" />Emitindo a nota…
      </p>
    );
  }
  if (doc.status === 'cancelled') {
    return (
      <div className="flex items-start justify-between gap-3 text-[13px] py-1">
        <span className="text-zinc-400 line-through font-semibold">NFC-e nº {numeroNota}</span>
        <b className="text-zinc-500">cancelada</b>
      </div>
    );
  }
  if (doc.status !== 'authorized') {
    return (
      <div className="text-[13px] py-1">
        <b className="text-red-600">Nota não autorizada</b>
        <p className="text-[12px] text-red-600/90 break-words mt-0.5">{doc.sefaz_message || doc.error_message || 'A SEFAZ não aceitou a nota.'}</p>
      </div>
    );
  }

  const ver = async () => {
    const err = await fiscal.abrirDanfe(doc);
    if (err) onToast(false, 'DANFE indisponível', err);
  };
  const imprimir = async () => {
    const err = await fiscal.imprimir(doc);
    onToast(!err, err ? 'Não foi possível imprimir' : 'Cupom enviado para a impressora', err ?? undefined);
  };
  return (
    <div className="py-1">
      <div className="flex items-start justify-between gap-3 text-[13px]">
        <span className="text-zinc-700 font-semibold flex items-center gap-1.5 flex-wrap">
          NFC-e{numeroNota ? ` nº ${numeroNota}` : ''}{homolog}
        </span>
        <b className="text-emerald-700 text-right whitespace-nowrap">autorizada{hora ? ` ${hora}` : ''}</b>
      </div>
      {extra && <p className="text-[11.5px] text-zinc-400 mt-0.5">{extra}</p>}
      <div className="flex gap-2 mt-2 flex-wrap">
        <button type="button" onClick={ver} disabled={ocupado} className={btn('out', 'sm')}>
          <i className="ri-file-text-line" />Ver
        </button>
        <button type="button" onClick={imprimir} disabled={ocupado} className={btn('out', 'sm')}>
          <i className="ri-printer-line" />Imprimir cupom
        </button>
      </div>
    </div>
  );
}

// ── Pagos juntos ─────────────────────────────────────────────────────────────
function Numero({ valor, rotulo }: { valor: ReactNode; rotulo: string }) {
  return (
    <div className="bg-zinc-50 border border-zinc-100 rounded-2xl px-2.5 py-2 min-w-0">
      <p className="text-[15px] sm:text-[17px] font-extrabold text-zinc-900 tabular-nums leading-tight truncate" title={typeof valor === 'string' || typeof valor === 'number' ? String(valor) : undefined}>{valor}</p>
      <p className="text-[10.5px] font-semibold text-zinc-400 mt-0.5 truncate" title={rotulo}>{rotulo}</p>
    </div>
  );
}

export default function PagosJuntos(props: PropsDetalhe) {
  const { pedido, modo, aberto, onFechar, onAbrirPedido, agoraMs, hoje, fiscal, onToast, acoes } = props;

  // Do mais antigo para o mais novo (o grupo vem do mais novo para o mais antigo).
  const subs = useMemo(
    () => [...(pedido.pedidosOriginais ?? [])].sort((a, b) => (Date.parse(a._criadoTs ?? '') || 0) - (Date.parse(b._criadoTs ?? '') || 0)),
    [pedido.pedidosOriginais],
  );
  const conta = useContas(subs);
  const consolidado = useMemo(() => consolidatePayments(subs), [subs]);
  const [modalNf, setModalNf] = useState(false);
  const [imprimindo, setImprimindo] = useState(false);

  const primeiro = subs[0] ?? pedido;
  const ultimo = subs[subs.length - 1] ?? pedido;
  const canal = canalPedido(primeiro);
  const dia = diaDoPedido(primeiro, hoje);
  const diaFim = diaDoPedido(ultimo, hoje);
  const h1 = hhmm(primeiro._criadoTs) ?? primeiro.criadoEm;
  const h2 = hhmm(ultimo._criadoTs) ?? ultimo.criadoEm;
  const quem = primeiro.garcomNome
    ? (canal === 'garcom' ? `Garçom ${primeiro.garcomNome}` : `${ROTULO_CANAL[canal]} · ${primeiro.garcomNome}`)
    : null;
  const periodo = subs.length > 1 && (h2 !== h1 || diaFim !== dia)
    ? `${rotuloDia(dia, hoje)} ${h1} → ${diaFim !== dia ? `${rotuloDia(diaFim, hoje)} ` : ''}${h2}`
    : `${rotuloDia(dia, hoje)} ${h1}`;
  const titulo = `${ondeQuem(primeiro)} · ${subs.length} pedidos pagos juntos`;
  const subtitulo = [periodo, quem].filter(Boolean).join(' · ');

  // Notas fiscais do grupo (uma nota do grupo cobre todos; senão, uma por pedido).
  const fiscalAtivo = fiscal.enabled === true && fiscal.carregado && !fiscal.erroLeitura;
  const unicos = Array.from(
    new Map(
      subs
        .map((s) => fiscal.byOrder.get(s.id))
        .filter((d): d is FiscalDocumentRow => d != null)
        .map((d) => [d.id, d] as const),
    ).values(),
  );
  const autorizadas = unicos.filter((d) => d.status === 'authorized');
  const emitindo = unicos.some((d) => d.status === 'processing' || d.status === 'pending');
  const recusada = unicos.find((d) => d.status === 'rejected' || d.status === 'error');
  const semNota = subs.filter((s) => s.pago && s.total > 0.005 && !ehCancelado(s) && !notaViva(fiscal.byOrder.get(s.id)?.status));
  const emitirOcupado = subs.some((s) => fiscal.busy.has(s.id));
  const mostrarNota = fiscalAtivo && (autorizadas.length > 0 || emitindo || semNota.length > 0);

  const imprimirResumo = async () => {
    setImprimindo(true);
    try { await acoes.imprimir(pedido, 'resumo'); }
    catch { onToast(false, 'Não foi possível imprimir'); }
    finally { setImprimindo(false); }
  };

  const rodape = (
    <button type="button" onClick={imprimirResumo} disabled={imprimindo} className={`${btn('out')} flex-1`}>
      <i className={imprimindo ? 'ri-loader-4-line animate-spin' : 'ri-printer-line'} />Imprimir resumo
    </button>
  );

  return (
    <>
      <Casca modo={modo} aberto={aberto} onFechar={onFechar} titulo={titulo} subtitulo={subtitulo} rodape={rodape}
        chave={pedido.id} escAtivo={!modalNf}>
        <div className="grid grid-cols-3 gap-2 mt-1">
          <Numero valor={subs.length} rotulo="pedidos" />
          <Numero valor={brl(conta.total)} rotulo="total" />
          {fiscalAtivo
            ? <Numero valor={autorizadas.length} rotulo={autorizadas.length === 1 ? 'nota autorizada' : 'notas autorizadas'} />
            : <Numero valor={subs.reduce((a, s) => a + qtdItens(s), 0)} rotulo="itens" />}
        </div>

        <Bloco titulo="Pedidos">
          {subs.map((s) => {
            const sit = situacaoPedido(s, agoraMs, hoje);
            const cancelado = ehCancelado(s);
            return (
              <button key={s.id} type="button" onClick={() => onAbrirPedido(s)}
                className="w-full flex items-center gap-2 py-2.5 text-left border-t border-zinc-200/70 first:border-t-0 cursor-pointer hover:bg-zinc-100/60 rounded-lg">
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] text-zinc-500 truncate" title={`#${numeroCurto(s)} · ${hhmm(s._criadoTs) ?? s.criadoEm} · ${qtdItens(s)} ${qtdItens(s) === 1 ? 'item' : 'itens'}`}>
                    <b className="text-zinc-900 font-extrabold">#{numeroCurto(s)}</b> · {hhmm(s._criadoTs) ?? s.criadoEm} · {qtdItens(s)} {qtdItens(s) === 1 ? 'item' : 'itens'}
                  </p>
                  <div className="mt-1"><SeloSituacao sit={sit} /></div>
                </div>
                <b className={`text-[13.5px] font-extrabold tabular-nums flex-shrink-0 ${cancelado ? 'line-through text-zinc-400' : 'text-zinc-900'}`}>{brl(s.total)}</b>
                <i className="ri-arrow-right-s-line text-zinc-400 text-lg flex-shrink-0" />
              </button>
            );
          })}
        </Bloco>

        <ContaBloco conta={conta} />

        <PagamentoBloco pagamentos={consolidado.pagamentos} total={consolidado.total} pago={subs.every((s) => !!s.pago)}
          cancelado={subs.every(ehCancelado)} consolidado />

        {mostrarNota && (
          <Bloco titulo={autorizadas.length > 1 ? 'Notas fiscais' : 'Nota fiscal'}>
            {autorizadas.map((d) => {
              const doPedido = subs.find((s) => s.id === d.source_id);
              const extra = d.source_type === 'payment_group'
                ? `Uma nota só para os ${subs.length} pedidos`
                : doPedido ? `Pedido #${numeroCurto(doPedido)}` : undefined;
              return <NotaDoc key={d.id} doc={d} fiscal={fiscal} onToast={onToast} extra={extra} />;
            })}
            {emitindo && (
              <p className="flex items-center gap-1.5 text-[13px] font-semibold text-sky-600 py-1">
                <i className="ri-loader-4-line animate-spin" />Emitindo a nota…
              </p>
            )}
            {semNota.length > 0 && (
              <div className="flex items-start gap-2 py-1">
                <div className="flex-1 min-w-0 text-[13px]">
                  <b className={recusada ? 'text-red-600' : 'text-zinc-800'}>
                    {recusada ? 'Nota não autorizada' : semNota.length === subs.length ? 'Sem nota fiscal' : `${semNota.length} de ${subs.length} pedidos sem nota`}
                  </b>
                  {recusada && (
                    <p className="text-[12px] text-red-600/90 break-words mt-0.5">{recusada.sefaz_message || recusada.error_message || 'A SEFAZ não aceitou a nota.'}</p>
                  )}
                </div>
                <button type="button" onClick={() => setModalNf(true)} disabled={emitirOcupado} className={`${btn('p', 'sm')} flex-shrink-0`}>
                  {emitirOcupado ? 'Emitindo…' : recusada ? 'Tentar de novo' : 'Emitir'}
                </button>
              </div>
            )}
          </Bloco>
        )}
      </Casca>

      {modalNf && (
        <EmitirNfModal
          titulo={`Emitir NFC-e de ${semNota.length} ${semNota.length === 1 ? 'pedido' : 'pedidos'} pagos juntos`}
          valor={brl(conta.total)}
          onConfirm={async (consumer) => { setModalNf(false); await emitirNotas(fiscal, semNota.map((s) => s.id), consumer, onToast); }}
          onClose={() => setModalNf(false)}
        />
      )}
    </>
  );
}
