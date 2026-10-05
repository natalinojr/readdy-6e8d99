import { useEffect, useState, type ReactNode } from 'react';
import ExplicaLucro from './ExplicaLucro';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { dateKeyBrasilia, somarDias, todayBrasilia } from '@/lib/dateUtils';
import { ifoodShipping, ifoodTipoPedido, type IfoodShippingConfig } from '@/lib/ifoodShipping';
import { culpaCancelamento, motivoCurto } from '@/lib/ifoodDashboard';
import { chaveComplementoIfood, chaveItemIfood, rotuloCliente, type PedidoArea } from '@/lib/ifoodArea';
import { brl } from '@/pages/estoque/components/ui/EstoqueUi';
import type { AcessoIfood } from '../lib/tipos';
import type { LojaIfood } from '../lib/useIfoodDados';
import { nomeLoja } from '../lib/tipos';
import { situacaoDaArea } from './LinhaPedido';

// O pedido inteiro numa tela só (protótipo docs/prototipos/ifood-proposta.html, "Um pedido"): passos com o
// tempo de cada fase, itens com a ficha ligada, desconto dividido (loja × iFood), a conta do pedido
// (vendas − comissão e taxas − desconto da loja = chega; − comida = sobra) e as ações que fazem sentido.
// modo 'painel' = ao lado da lista (computador, com o cabeçalho); 'folha' = dentro da Folha (o título fica nela).

const TZ = 'America/Sao_Paulo';
const hhmm = (iso: string | Date | null | undefined): string | null => {
  if (!iso) return null;
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  return Number.isNaN(d.getTime()) ? null : d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: TZ });
};
const fmtMin = (n: number) => {
  if (n < 1) return '<1 min';
  if (n < 60) return `${n} min`;
  if (n >= 1440) return `${Math.floor(n / 1440)} d`;
  const h = Math.floor(n / 60), m = n % 60;
  return m ? `${h} h ${String(m).padStart(2, '0')}` : `${h} h`;
};
const minEntre = (a: string | null, b: string | null) => (a && b ? Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / 60000)) : null);

/** "Hoje 18:40", "Ontem 11:02" ou "03/10 19:10" (Brasília). */
export function dataHoraRotulo(at: Date): string {
  const dia = dateKeyBrasilia(at);
  const hoje = todayBrasilia();
  const d = dia === hoje ? 'Hoje' : dia === somarDias(hoje, -1) ? 'Ontem' : `${dia.slice(8, 10)}/${dia.slice(5, 7)}`;
  return `${d} ${hhmm(at) ?? ''}`.trim();
}

const TOM: Record<string, string> = {
  amber: 'bg-amber-50 text-amber-700', blue: 'bg-blue-50 text-blue-700', green: 'bg-emerald-50 text-emerald-700',
  red: 'bg-red-50 text-red-600', zinc: 'bg-zinc-100 text-zinc-600',
};
const RANK: Record<string, number> = { placed: 0, confirmed: 1, preparing: 2, ready: 3, dispatched: 4, concluded: 5 };

// ── Passos ──────────────────────────────────────────────────────────────────

interface Passo { chave: string; rotulo: string; icone: string; ts: string | null; ok: boolean; atual: boolean }

function montarPassos(p: PedidoArea): Passo[] {
  const o = p.order!;
  const tl = o.timeline ?? {};
  const pega = (...ks: string[]) => ks.map((k) => tl[k]).find(Boolean) ?? null;
  const rank = RANK[o.status] ?? -1;
  const comSaiu = o.tipo === 'DELIVERY' || !!pega('DISPATCHED', 'COLLECTED');
  const base: { chave: string; rotulo: string; icone: string; ts: string | null; min: number }[] = [
    { chave: 'chegou', rotulo: 'Chegou', icone: 'ri-file-list-3-line', ts: pega('PLACED') ?? o.at.toISOString(), min: 0 },
    { chave: 'aceito', rotulo: 'Aceito', icone: 'ri-thumb-up-line', ts: pega('CONFIRMED'), min: 1 },
    { chave: 'pronto', rotulo: 'Pronto', icone: 'ri-fire-line', ts: pega('READY_TO_PICKUP', 'SEPARATION_ENDED'), min: 3 },
    ...(comSaiu ? [{ chave: 'saiu', rotulo: 'Saiu', icone: 'ri-e-bike-2-line', ts: pega('DISPATCHED', 'COLLECTED'), min: 4 }] : []),
    { chave: 'entregue', rotulo: 'Entregue', icone: 'ri-hand-heart-line', ts: pega('CONCLUDED', 'DELIVERY_DROP_CODE_VALIDATION_SUCCESS'), min: 5 },
  ];
  let achouAtual = false;
  return base.map((b) => {
    const ok = !!b.ts || rank >= b.min;
    const atual = !ok && !achouAtual;
    if (atual) achouAtual = true;
    return { chave: b.chave, rotulo: b.rotulo, icone: b.icone, ts: b.ts, ok, atual };
  });
}

function Passos({ p }: { p: PedidoArea }) {
  const passos = montarPassos(p);
  const o = p.order!;
  const pilulas = passos.map((s, i) => (i > 0 && s.ts && passos[i - 1].ts ? minEntre(passos[i - 1].ts, s.ts) : null));
  const temPilula = pilulas.some((v) => v != null);
  const inicio = passos[0].ts;
  const fim = passos[passos.length - 1].ts;
  const total = o.status === 'concluded' ? minEntre(inicio, fim) : null;
  const agora = o.status !== 'concluded' && o.status !== 'cancelled' && inicio ? Math.max(0, Math.round((Date.now() - Date.parse(inicio)) / 60000)) : null;
  return (
    <div className="mt-3" aria-label="Passos do pedido">
      <div className={`flex items-start ${temPilula ? 'pt-9' : 'pt-1'}`}>
        {passos.map((s, i) => {
          const bolinha = s.ok ? 'bg-emerald-500 border-emerald-500 text-white' : s.atual ? 'bg-amber-500 border-amber-500 text-white animate-pulse' : 'bg-white border-zinc-200 text-zinc-300';
          return (
            <div key={s.chave} className="relative flex-1 min-w-0 text-center">
              {i > 0 && <span aria-hidden className={`absolute top-[13px] left-[-50%] right-1/2 h-0.5 ${s.ok ? 'bg-emerald-500' : 'bg-zinc-200'}`} />}
              {pilulas[i] != null && (
                <span className="absolute left-0 bottom-full mb-1 -translate-x-1/2 z-20 rounded-xl px-2 py-0.5 text-center leading-tight whitespace-nowrap bg-zinc-100 text-zinc-600">
                  <b className="block text-[10.5px] font-extrabold tabular-nums">{fmtMin(pilulas[i]!)}</b>
                </span>
              )}
              <span className={`relative z-10 mx-auto grid place-items-center w-7 h-7 rounded-full border-2 text-sm ${bolinha}`}>
                <i className={s.ok ? 'ri-check-line' : s.icone} />
              </span>
              <b className={`block text-[11px] font-extrabold mt-1 ${!s.ok && !s.atual ? 'text-zinc-400' : 'text-zinc-800'}`}>{s.rotulo}</b>
              <span className="block text-[10.5px] text-zinc-400 tabular-nums">{hhmm(s.ts) ?? '—'}</span>
            </div>
          );
        })}
      </div>
      {total != null && <p className="text-center text-[11.5px] mt-2 text-zinc-400">Total <b className="text-zinc-900">{fmtMin(total)}</b> até entregar</p>}
      {agora != null && <p className="text-center text-[11.5px] mt-2 text-zinc-400">Chegou há <b className="text-zinc-900">{fmtMin(agora)}</b></p>}
    </div>
  );
}

// ── Peças ───────────────────────────────────────────────────────────────────

function Bloco({ titulo, children, direita }: { titulo: string; children: ReactNode; direita?: ReactNode }) {
  return (
    <section className="mt-4">
      <div className="flex items-center gap-2 mb-1.5">
        <h5 className="text-[11px] font-extrabold uppercase tracking-wide text-zinc-400">{titulo}</h5>
        {direita && <div className="ml-auto">{direita}</div>}
      </div>
      {children}
    </section>
  );
}

function Linha({ rotulo, valor, tom = 'neutro', forte = false, pequena = false }: { rotulo: ReactNode; valor: ReactNode; tom?: 'neutro' | 'menos' | 'mais'; forte?: boolean; pequena?: boolean }) {
  const cor = tom === 'menos' ? 'text-red-600' : tom === 'mais' ? 'text-emerald-700' : 'text-zinc-900';
  return (
    <div className={`flex items-baseline justify-between gap-3 ${pequena ? 'pl-4 py-0.5 text-[12px] text-zinc-500' : forte ? 'py-1.5 mt-1 border-t border-zinc-200 text-[14px] font-extrabold' : 'py-1 text-[13px]'}`}>
      <span className={pequena ? '' : forte ? 'text-zinc-900' : 'text-zinc-600'}>{rotulo}</span>
      <b className={`tabular-nums whitespace-nowrap ${pequena ? 'font-semibold text-zinc-600' : cor}`}>{valor}</b>
    </div>
  );
}

const menos = (v: number) => `− ${brl(Math.abs(v))}`;

// ── Estado do pedido para as ações (configuração do módulo, rascunho do ERPOS, negociação) ──

interface Extras {
  modo: IfoodShippingConfig['order_mode'] | null;
  rascunho: boolean;
  cancelando: boolean;
  disputa: Record<string, unknown> | null;
}
const cacheModo = new Map<string, { em: number; modo: IfoodShippingConfig['order_mode'] | null }>();
async function modoDosPedidos(tenantId: string): Promise<IfoodShippingConfig['order_mode'] | null> {
  const c = cacheModo.get(tenantId);
  if (c && Date.now() - c.em < 60_000) return c.modo;
  const r = await ifoodShipping<{ config?: IfoodShippingConfig }>('get_config', tenantId);
  const modo = r.success ? (r.config?.order_mode ?? null) : null;
  cacheModo.set(tenantId, { em: Date.now(), modo });
  return modo;
}

function Botao({ on, busy, children, tom = 'out', off }: { on: () => void; busy?: boolean; children: ReactNode; tom?: 'out' | 'ok' | 'perigo'; off?: boolean }) {
  const cor = tom === 'ok' ? 'bg-emerald-600 hover:bg-emerald-500 text-white' : tom === 'perigo' ? 'bg-white border border-red-200 text-red-600 hover:bg-red-50' : 'bg-white border border-zinc-200 hover:bg-zinc-50 text-zinc-700';
  return (
    <button type="button" disabled={busy || off} onClick={on}
      className={`inline-flex items-center justify-center gap-1.5 min-h-[34px] px-3 rounded-xl text-[12.5px] font-bold cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap ${cor}`}>
      {busy ? '…' : children}
    </button>
  );
}

const ACAO_DISPUTA: Record<string, string> = { CANCELLATION: 'cancelar o pedido', PARTIAL_CANCELLATION: 'cancelar parte do pedido', PROP_REFUND: 'reembolso proporcional' };

function Negociacao({ d, pode, busy, onResponder }: { d: Record<string, unknown>; pode: boolean; busy: string; onResponder: (op: string, motivo?: string) => void }) {
  const [recusa, setRecusa] = useState<string | null>(null);
  const acaoTxt = ACAO_DISPUTA[String(d.action ?? '')] ?? String(d.action ?? 'negociação');
  const expira = typeof d.expiresAt === 'string' ? hhmm(d.expiresAt) : '';
  const fechada = Boolean(d.settled || d.answered);
  if (d.settled && !d.answered && !d.message) return null;
  return (
    <div className="rounded-xl border border-red-200 bg-red-50 p-3 space-y-2 mt-3">
      <p className="text-[12.5px] text-red-700 font-bold">
        O cliente pediu: {acaoTxt}{d.message ? ` — “${String(d.message)}”` : ''}{expira && !fechada ? ` · responder até ${expira}` : ''}
      </p>
      {d.settled ? <p className="text-[12px] text-zinc-600">O iFood já encerrou esse pedido do cliente.</p>
        : d.answered ? <p className="text-[12px] text-zinc-600">Respondido: {d.answered === 'accept' ? 'aceito' : 'recusado'}. Esperando o iFood.</p>
        : !pode ? <p className="text-[12px] text-zinc-600">Responda no Gestor de Pedidos do iFood.</p>
        : recusa === null ? (
          <div className="flex gap-2">
            <Botao on={() => onResponder('dispute_accept')} busy={busy === 'dispute_accept'} tom="ok">Aceitar</Botao>
            <Botao on={() => setRecusa('')} tom="perigo">Recusar</Botao>
          </div>
        ) : (
          <div className="flex gap-2">
            <input value={recusa} onChange={(e) => setRecusa(e.target.value)} maxLength={250} placeholder="Motivo da recusa"
              className="flex-1 min-w-0 px-3 py-1.5 rounded-xl border border-zinc-200 text-[12.5px] bg-white" />
            <Botao on={() => onResponder('dispute_reject', recusa.trim())} busy={busy === 'dispute_reject'} tom="perigo" off={!recusa.trim()}>Enviar</Botao>
          </div>
        )}
    </div>
  );
}

// ── Componente ──────────────────────────────────────────────────────────────

/** " (17,7%)" — quanto o valor é das vendas do pedido. */
const pctVenda = (v: number, venda: number) => (venda > 0.005 ? ` (${((v / venda) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%)` : '');

export default function DetalhePedidoIfood({ p, lojas, acesso, tenantId, modo, onFechar, onMudou }: {
  p: PedidoArea;
  lojas: LojaIfood[];
  acesso: AcessoIfood;
  tenantId: string;
  modo: 'painel' | 'folha';
  onFechar?: () => void;
  onMudou?: () => void;
}) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const o = p.order;
  const sit = situacaoDaArea(p);
  const cliente = rotuloCliente(p.pedidosAntes);
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const [busy, setBusy] = useState('');
  const [extras, setExtras] = useState<Extras>({ modo: null, rascunho: false, cancelando: false, disputa: null });
  const [motivos, setMotivos] = useState<{ code: string; description: string }[] | null>(null);
  const [motivo, setMotivo] = useState('');

  const rowId = o?.rowId;
  const pedidoErpos = o?.pedidoErpos ?? null;
  const encerrado = o ? (o.status === 'concluded' || o.status === 'cancelled') : true;

  // Carrega o que as ações precisam (só do pedido aberto): negociação aberta, rascunho no ERPOS e modo dos pedidos.
  useEffect(() => {
    setMsg(null); setMotivos(null); setMotivo('');
    if (!rowId || !tenantId) { setExtras({ modo: null, rascunho: false, cancelando: false, disputa: null }); return; }
    let vivo = true;
    (async () => {
      const [ped, erp] = await Promise.all([
        supabase.from('ifood_orders').select('dispute, cancel_requested').eq('id', rowId).eq('tenant_id', tenantId).maybeSingle(),
        pedidoErpos ? supabase.from('orders').select('is_draft').eq('id', pedidoErpos).eq('tenant_id', tenantId).maybeSingle() : Promise.resolve({ data: null }),
      ]);
      const disputa = ((ped.data as { dispute?: Record<string, unknown> | null } | null)?.dispute ?? null);
      const precisaModo = !encerrado || (disputa && !disputa.settled && !disputa.answered);
      const m = precisaModo ? await modoDosPedidos(tenantId).catch(() => null) : null;
      if (!vivo) return;
      setExtras({
        modo: m,
        rascunho: !!(erp.data as { is_draft?: boolean } | null)?.is_draft,
        cancelando: !!(ped.data as { cancel_requested?: boolean } | null)?.cancel_requested,
        disputa,
      });
    })().catch(() => null);
    return () => { vivo = false; };
  }, [rowId, pedidoErpos, tenantId, encerrado]);

  const semAcesso = user?.perfil === 'contabilidade';
  const funil = extras.modo === 'funnel';
  const opera = extras.modo === 'operate';

  const acao = async (op: string, extra: Record<string, unknown> = {}) => {
    if (!rowId) return;
    setBusy(op); setMsg(null);
    const r = await ifoodShipping<{ message?: string }>('order_action', tenantId, { order_row_id: rowId, op, ...extra });
    setBusy('');
    setMsg({ ok: r.success, t: r.success ? (r.message ?? 'Enviado ao iFood.') : (r.error ?? 'Não deu certo.') });
    if (r.success) { setMotivos(null); setTimeout(() => onMudou?.(), 3000); }
  };
  const abrirMotivos = async () => {
    if (!rowId) return;
    setBusy('reasons'); setMsg(null);
    const r = await ifoodShipping<{ reasons: { code: string; description: string }[] }>('order_cancel_reasons', tenantId, { order_row_id: rowId });
    setBusy('');
    if (!r.success) { setMsg({ ok: false, t: r.error ?? 'Não deu certo.' }); return; }
    if (!r.reasons.length) { setMsg({ ok: false, t: 'O iFood não deixa mais cancelar este pedido.' }); return; }
    setMotivos(r.reasons); setMotivo('');
  };
  const reler = async () => {
    if (!rowId) return;
    setBusy('refresh'); setMsg(null);
    const r = await ifoodShipping('order_refresh', tenantId, { order_row_id: rowId });
    setBusy('');
    if (!r.success) setMsg({ ok: false, t: r.error ?? 'Não deu certo.' }); else { setMsg({ ok: true, t: 'Pedido lido de novo do iFood.' }); onMudou?.(); }
  };

  const irLigar = (chave: string) => navigate(`/ifood?${new URLSearchParams({ aba: 'itens', ligar: '1', item: chave }).toString()}`);

  const temDesconto = p.promoLoja > 0.005 || p.promoIfood > 0.005;
  const totalDesc = p.promoLoja + p.promoIfood;
  const entregaGratis = Math.min(p.promoLojaEntrega ?? 0, p.promoLoja);
  const descItens = Math.max(0, p.promoLoja - entregaGratis);
  const f = p.fin;
  const tipo = o ? ifoodTipoPedido({ order_type: o.tipo, order_timing: null, delivered_by: o.entregaPor, sales_channel: null, schedule: null }) : 'Pedido de antes de ligar os pedidos no ERPOS';
  const online = o?.pagamento ? !/na entrega/i.test(o.pagamento) : false;

  // Cancelado: motivo (código do iFood na conciliação ou texto do pedido) e de quem foi a culpa.
  const motivoTxt = p.cancelado ? (f?.motivo ?? o?.motivoCancelamento ?? null) : null;
  const culpa = f?.motivo ? culpaCancelamento(f.motivo) : null;

  const pctSobra = p.sobra != null && p.venda > 0.005 ? Math.round((p.sobra / p.venda) * 100) : null;

  return (
    <div className="text-zinc-900">
      {modo === 'painel' && (
        <div className="flex items-start gap-2">
          <div className="flex-1 min-w-0">
            <h3 className="text-[17px] font-extrabold leading-snug">{p.numero ? `#${p.numero}` : 'Pedido do iFood'}{p.cliente ? ` · ${p.cliente}` : ''}</h3>
            <p className="text-xs text-zinc-500 mt-0.5">{dataHoraRotulo(p.at)} · {tipo} · {nomeLoja(lojas, p.loja)}</p>
          </div>
          {onFechar && <button type="button" onClick={onFechar} aria-label="Fechar" className="w-8 h-8 rounded-full bg-zinc-100 hover:bg-zinc-200 flex items-center justify-center cursor-pointer flex-none"><i className="ri-close-line text-zinc-600" /></button>}
        </div>
      )}

      <div className={`flex gap-1.5 flex-wrap ${modo === 'painel' ? 'mt-3' : ''}`}>
        <span className={`text-[11px] font-extrabold rounded-md px-1.5 py-0.5 ${TOM[sit.tom]}`}>{sit.rotulo}</span>
        {cliente && <span className={`text-[11px] font-extrabold rounded-md px-1.5 py-0.5 ${p.pedidosAntes === 0 ? 'bg-sky-50 text-sky-700' : 'bg-zinc-100 text-zinc-600'}`}>{cliente}</span>}
        {o?.pagamento && <span className={`text-[11px] font-extrabold rounded-md px-1.5 py-0.5 ${online ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>{online ? 'pago no app' : o.pagamento}</span>}
        {o?.teste && <span className="text-[11px] font-extrabold rounded-md px-1.5 py-0.5 bg-zinc-100 text-zinc-500">teste</span>}
      </div>

      {o && !p.cancelado && <Passos p={p} />}

      {p.cancelado && (
        <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5">
          <p className="text-[13px] font-extrabold text-red-700">Pedido cancelado</p>
          {motivoTxt && <p className="text-[12.5px] text-red-700 mt-0.5">{motivoCurto(motivoTxt)}</p>}
          {culpa && <p className="text-[12px] text-zinc-600 mt-0.5">Responsável: {culpa === 'loja' ? 'a loja' : culpa === 'cliente' ? 'o cliente' : 'o iFood'}</p>}
        </div>
      )}

      <Bloco titulo="Itens">
        {!o ? (
          <p className="text-[12.5px] text-zinc-500">Itens não disponíveis (pedido de antes de ligar os pedidos no ERPOS).</p>
        ) : o.itens.length === 0 ? (
          <p className="text-[12.5px] text-zinc-500">Os itens ainda estão chegando do iFood. Use “Reler do iFood”.</p>
        ) : (
          <div className="divide-y divide-zinc-100">
            {o.itens.map((it, idx) => {
              const l = p.linhas[idx];
              const faltaItem = l?.semFicha.includes(it.nome);
              const chaveLigar = faltaItem || !l?.semFicha.length ? chaveItemIfood(it.nome)
                : (() => { const c = it.complementos.find((x) => x.nome === l.semFicha[0]); return c ? chaveComplementoIfood(c.nome, c.grupo) : chaveItemIfood(it.nome); })();
              return (
                <div key={idx} className="flex gap-2.5 py-2 first:pt-0">
                  <div className="w-6 h-6 rounded-lg bg-zinc-100 text-zinc-600 text-[12px] font-extrabold flex items-center justify-center flex-none">{it.qtd}</div>
                  <div className="flex-1 min-w-0">
                    <b className="block text-[13.5px] font-bold leading-snug">{it.nome}</b>
                    {it.complementos.map((c, k) => (
                      <span key={k} className="block text-[12px] text-zinc-500">+ {c.qtd > 1 ? `${c.qtd}× ` : ''}{c.nome}{c.preco > 0.005 ? ` (${brl(c.preco)})` : ''}</span>
                    ))}
                    {it.obs && <span className="block text-[12px] text-amber-700 font-semibold">Obs.: {it.obs}</span>}
                    {acesso.dinheiro && l && !p.cancelado && (
                      l.comida != null ? (
                        <span className="block text-[11.5px] text-zinc-400 mt-0.5">ficha: {l.alvo ?? 'ligada'} · comida {brl(l.comida)}</span>
                      ) : (
                        <span className="block text-[11.5px] text-orange-600 font-semibold mt-0.5">
                          sem ficha{l.semFicha.length && !faltaItem ? `: ${l.semFicha.join(', ')}` : ''}
                          {acesso.itens && <> · <button type="button" onClick={() => irLigar(chaveLigar)} className="underline font-extrabold cursor-pointer">Ligar</button></>}
                        </span>
                      )
                    )}
                  </div>
                  <div className="text-[13px] font-bold tabular-nums whitespace-nowrap">{brl(it.total)}</div>
                </div>
              );
            })}
          </div>
        )}
      </Bloco>

      {temDesconto && (
        <Bloco titulo="Desconto">
          <Linha rotulo="Desconto dado ao cliente" valor={brl(totalDesc)} />
          {descItens > 0.005 && <Linha rotulo={<>Desconto nos itens pago pela loja <span className="text-zinc-400 text-[11.5px]">· sai do que chega para você</span></>} valor={brl(descItens)} tom="menos" />}
          {entregaGratis > 0.005 && (
            <>
              <Linha rotulo="Entrega grátis paga pela loja" valor={brl(entregaGratis)} tom="menos" />
              <p className="text-[11.5px] text-zinc-400 pb-1">Com entregador do iFood isso é cobrado no repasse; não é desconto da comida.</p>
            </>
          )}
          <Linha rotulo={<>Pago pelo iFood <span className="text-zinc-400 text-[11.5px]">· não sai do seu bolso</span></>} valor={brl(p.promoIfood)} />
        </Bloco>
      )}

      {acesso.dinheiro && !p.cancelado && (
        <Bloco titulo="A conta do pedido" direita={p.estimado ? <span className="text-[10.5px] font-extrabold rounded-md px-1.5 py-0.5 bg-amber-50 text-amber-700">estimado · o iFood fecha amanhã</span> : undefined}>
          <Linha rotulo="Vendas no iFood" valor={brl(p.venda)} />
          {p.comissaoETaxas == null ? (
            <Linha rotulo="Comissão e taxas do iFood" valor="fecha amanhã" tom="menos" />
          ) : (
            <>
              <Linha rotulo={`Comissão e taxas do iFood${pctVenda(p.comissaoETaxas, p.venda)}${p.estimado ? ' · média da loja' : ''}`} valor={menos(p.comissaoETaxas)} tom="menos" />
              {f && (
                <>
                  {f.comissao > 0.005 && <Linha pequena rotulo={`Comissão${pctVenda(f.comissao, p.venda)}`} valor={brl(f.comissao)} />}
                  {f.transacao > 0.005 && <Linha pequena rotulo={`Taxa de pagamento${pctVenda(f.transacao, p.venda)}`} valor={brl(f.transacao)} />}
                  {f.entregaSobDemanda > 0.005 && <Linha pequena rotulo="Entrega do iFood" valor={brl(f.entregaSobDemanda)} />}
                  {f.outrosServicos > 0.005 && <Linha pequena rotulo="Outros serviços" valor={brl(f.outrosServicos)} />}
                  {Math.abs(f.ajustes) > 0.005 && <Linha pequena rotulo={f.ajustes > 0 ? 'Ressarcimento / ajuste (a favor)' : 'Ajuste'} valor={`${f.ajustes > 0 ? '+ ' : '− '}${brl(Math.abs(f.ajustes))}`} />}
                </>
              )}
            </>
          )}
          {p.promoLoja > 0.005 && <Linha rotulo="Desconto pago pela loja" valor={menos(p.promoLoja)} tom="menos" />}
          <Linha forte rotulo="Chega na loja" valor={p.chega == null ? '—' : brl(p.chega)} />
          {o && (p.comida != null
            ? <Linha rotulo="Comida (fichas)" valor={menos(p.comida)} tom="menos" />
            : <Linha rotulo="Comida (fichas)" valor={<span className="text-orange-600">item sem ficha</span>} />)}
        </Bloco>
      )}

      {acesso.dinheiro && !p.cancelado && o && (
        p.sobra != null ? (
          <div className={`mt-3 rounded-2xl border px-4 py-3 flex items-center gap-3 ${p.sobra < -0.005 ? 'bg-red-50 border-red-200' : 'bg-emerald-50 border-emerald-200'}`}>
            <div className={`text-xl font-extrabold tabular-nums ${p.sobra < -0.005 ? 'text-red-600' : 'text-emerald-700'}`}>{p.sobra < 0 ? '−' : ''}{brl(Math.abs(p.sobra))}</div>
            <div className="text-[12.5px] leading-snug">
              <b className={p.sobra < -0.005 ? 'text-red-700' : 'text-emerald-800'}>{p.sobra < -0.005 ? 'de prejuízo' : 'de lucro bruto'}{pctSobra != null ? ` (${pctSobra}%)` : ''}{p.estimado ? ' · estimado' : ''}</b> <ExplicaLucro />
              {p.sobraBalcao != null && <span className="block text-zinc-600">No balcão os mesmos itens dão {brl(p.sobraBalcao)} de lucro bruto.</span>}
            </div>
          </div>
        ) : (
          <div className="mt-3 rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-[12.5px] text-zinc-600">
            <b className="text-zinc-800">Lucro bruto em aberto.</b>{' '}
            {p.semFicha.length ? `Falta ficha em: ${p.semFicha.join(', ')}.` : p.chega == null ? 'O iFood ainda não fechou as taxas deste pedido.' : 'Sem os itens não dá para somar a comida.'}
          </div>
        )
      )}

      {o && (
        <Bloco titulo="Cliente pagou">
          <Linha rotulo="Total do pedido" valor={brl(o.clientePagou)} />
          {o.pagamento && <Linha pequena rotulo="Forma de pagamento" valor={o.pagamento} />}
          <Linha pequena rotulo="Entrega paga pelo cliente" valor={o.entregaCliente > 0.005 ? brl(o.entregaCliente) : 'grátis'} />
          {o.taxaServico > 0.005 && <Linha pequena rotulo="Taxa de serviço" valor={brl(o.taxaServico)} />}
        </Bloco>
      )}

      {msg && <p className={`mt-3 text-[12.5px] rounded-xl p-2.5 border ${msg.ok ? 'text-emerald-700 bg-emerald-50 border-emerald-100' : 'text-red-600 bg-red-50 border-red-100'}`}>{msg.t}</p>}

      {extras.disputa && !semAcesso && <Negociacao d={extras.disputa} pode={funil || opera} busy={busy} onResponder={(op, m) => acao(op, { reason: m })} />}

      {o && (
        <div className="mt-4 pt-3 border-t border-zinc-100 flex flex-wrap gap-2">
          <Botao on={reler} busy={busy === 'refresh'}><i className="ri-refresh-line" /> Reler do iFood</Botao>
          {o.pedidoErpos && <Botao on={() => navigate('/pedidos')}><i className="ri-external-link-line" /> Abrir em Pedidos</Botao>}
          {!semAcesso && !encerrado && funil && extras.rascunho && <Botao tom="ok" on={() => acao('accept')} busy={busy === 'accept'}>Aceitar (vai para a cozinha)</Botao>}
          {!semAcesso && !encerrado && (funil || opera) && !extras.cancelando && !motivos && (
            <Botao tom="perigo" on={abrirMotivos} busy={busy === 'reasons'}>{extras.rascunho ? 'Recusar' : 'Cancelar pedido'}</Botao>
          )}
        </div>
      )}
      {motivos && (
        <div className="mt-2 space-y-2">
          <p className="text-[12px] text-zinc-500">Cancelar no iFood pode ter multa e pesa na nota da loja. Escolha o motivo:</p>
          <div className="flex gap-2">
            <select value={motivo} onChange={(e) => setMotivo(e.target.value)} className="flex-1 min-w-0 px-3 py-1.5 rounded-xl border border-zinc-200 text-[12.5px] bg-white">
              <option value="">Motivo do cancelamento…</option>
              {motivos.map((m) => <option key={m.code} value={m.code}>{m.description}</option>)}
            </select>
            <Botao tom="perigo" off={!motivo} busy={busy === 'cancel'} on={() => acao('cancel', { code: motivo, reason: motivos.find((x) => x.code === motivo)?.description ?? '' })}>Enviar</Botao>
            <Botao on={() => setMotivos(null)}>Voltar</Botao>
          </div>
        </div>
      )}
    </div>
  );
}
