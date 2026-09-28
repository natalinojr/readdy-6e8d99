// Histórico de solicitações de pagamento no Financeiro (dono, 2026-09-27). Na conversa, cada mudança de
// status é uma mensagem solta ("aguardando aprovação no Inter", depois "pago"), e o mesmo Pix aparecia
// duas, três vezes. Aqui é UMA linha por solicitação: quem, quanto, o status atual e, tocando, os
// detalhes (chave, vencimento, loja, quando foi enviado/pago, erro) e a linha do tempo das mudanças.
// Os dados vêm da Edge assistente-app › payments_history (fin_inter_payments + mensagens de status).
import { useCallback, useEffect, useState } from 'react';

type Call = <T>(action: string, extra?: Record<string, unknown>) => Promise<T>;

export interface PagamentoHistorico {
  id: string; kind: 'pix' | 'boleto'; amount: number; beneficiary_name: string | null; pix_key: string | null;
  due_date: string | null; description: string | null; status: string; status_label: string; error: string | null;
  created_at: string; paid_at: string | null; sent_at: string | null; updated_at: string | null;
  face_value?: number | null; recebido?: boolean | null; recebido_em?: string | null;
  loja: string | null; origem: string | null; substituido: boolean; has_bill?: boolean;
  linha_do_tempo: { at: string; texto: string; canal: string }[];
}

const FILTROS = [
  { id: 'todos', label: 'Todos' },
  { id: 'aberto', label: 'Em andamento' },
  { id: 'pagos', label: 'Pagos' },
  { id: 'nao_pagos', label: 'Não pagos' },
] as const;
type Filtro = typeof FILTROS[number]['id'];

const ABERTO = ['draft', 'awaiting_pin', 'sending', 'sent', 'pending_approval', 'approved', 'scheduled'];
const CANAL: Record<string, string> = { telegram: 'Telegram', app: 'ERPOS', whatsapp: 'WhatsApp', cron: 'Automático' };

const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dataHora = (iso: string) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const horaMin = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const rotuloDia = (iso: string) => {
  const d = new Date(iso);
  const meia = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const dias = Math.round((meia(new Date()) - meia(d)) / 86400000);
  if (dias === 0) return 'Hoje';
  if (dias === 1) return 'Ontem';
  return d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' });
};
const maiuscula = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

function visual(p: PagamentoHistorico): { texto: string; icone: string; badge: string } {
  if (p.status === 'paid') return { texto: 'Pago', icone: 'ri-checkbox-circle-fill text-emerald-600', badge: 'bg-emerald-100 text-emerald-800' };
  if (p.status === 'pending_approval') return { texto: 'Falta aprovar no app do Inter', icone: 'ri-time-line text-amber-600', badge: 'bg-amber-100 text-amber-800' };
  if (['draft', 'awaiting_pin'].includes(p.status)) return { texto: 'Esperando você pagar', icone: 'ri-lock-2-line text-violet-600', badge: 'bg-violet-100 text-violet-800' };
  if (ABERTO.includes(p.status)) return { texto: maiuscula(p.status_label), icone: 'ri-loader-4-line text-sky-600', badge: 'bg-sky-100 text-sky-800' };
  if (['failed', 'rejected'].includes(p.status)) return { texto: maiuscula(p.status_label), icone: 'ri-error-warning-fill text-red-500', badge: 'bg-red-100 text-red-700' };
  return { texto: maiuscula(p.status_label), icone: 'ri-close-circle-line text-zinc-400', badge: 'bg-zinc-100 text-zinc-600' };
}

function Linha({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2 text-xs">
      <span className="w-24 flex-shrink-0 text-zinc-400">{rotulo}</span>
      <span className="flex-1 min-w-0 text-zinc-700 break-words">{children}</span>
    </div>
  );
}

function ItemPagamento({ p, onAcao, onStatus }: {
  p: PagamentoHistorico;
  onAcao: (p: PagamentoHistorico, op: 'ok' | 'no') => void | Promise<void>;
  onStatus: (p: PagamentoHistorico) => Promise<void>;
}) {
  const [aberto, setAberto] = useState(false);
  const [conferindo, setConferindo] = useState(false);
  const v = visual(p);
  const emAberto = ABERTO.includes(p.status);
  const podePagar = ['draft', 'awaiting_pin'].includes(p.status);
  const comEncargos = p.kind === 'boleto' && p.face_value != null && p.amount - p.face_value > 0.005;
  const verStatus = async () => {
    if (conferindo) return;
    setConferindo(true);
    try { await onStatus(p); } finally { setConferindo(false); }
  };
  return (
    <div className={`rounded-2xl border bg-white ${p.status === 'pending_approval' ? 'border-amber-200' : 'border-zinc-100'}`}>
      <button onClick={() => setAberto((x) => !x)} aria-expanded={aberto} className="w-full flex items-start gap-2.5 px-3 py-2.5 text-left cursor-pointer">
        <i className={`${v.icone} text-xl leading-none mt-0.5`} />
        <span className="flex-1 min-w-0">
          <span className="flex items-baseline gap-2">
            <span className="flex-1 min-w-0 text-sm font-black text-zinc-900 truncate">
              {p.kind === 'pix' ? 'Pix' : 'Boleto'} {brl(p.amount)}
            </span>
            <span className="text-[11px] text-zinc-400 flex-shrink-0">{horaMin(p.created_at)}</span>
          </span>
          {p.beneficiary_name && <span className="block text-xs text-zinc-700 truncate">para <b className="font-bold">{p.beneficiary_name}</b></span>}
          <span className="flex items-center gap-1.5 mt-1 flex-wrap">
            <span className={`text-[11px] font-bold rounded-full px-2 py-0.5 ${v.badge}`}>{v.texto}</span>
            {p.substituido && <span className="text-[11px] font-semibold rounded-full px-2 py-0.5 bg-zinc-100 text-zinc-500">refeito</span>}
            {p.loja && <span className="text-[11px] text-zinc-400 truncate">{p.loja}</span>}
          </span>
        </span>
        <i className={`ri-arrow-${aberto ? 'up' : 'down'}-s-line text-zinc-400 mt-0.5`} />
      </button>
      {aberto && (
        <div className="px-3 pb-3 pt-0.5 space-y-1 border-t border-zinc-50">
          <div className="pt-2 space-y-1">
            {p.pix_key && <Linha rotulo="Chave">{p.pix_key}</Linha>}
            {p.due_date && <Linha rotulo="Vencimento">{p.due_date.slice(0, 10).split('-').reverse().join('/')}</Linha>}
            {comEncargos && <Linha rotulo="Valor do boleto">{brl(p.face_value!)} (com juros/multa: {brl(p.amount)})</Linha>}
            {p.description && <Linha rotulo="Descrição">{p.description}</Linha>}
            {p.recebido != null && (
              <Linha rotulo="Mercadoria">{p.recebido ? `recebida${p.recebido_em ? ` em ${new Date(p.recebido_em).toLocaleDateString('pt-BR')}` : ''}` : 'ainda NÃO recebida'}</Linha>
            )}
            {p.has_bill && <Linha rotulo="Conta a pagar">ligada ao Financeiro</Linha>}
            <Linha rotulo="Pedido em">{dataHora(p.created_at)}{p.origem ? ` · pelo ${CANAL[p.origem] ?? p.origem}` : ''}</Linha>
            {p.sent_at && <Linha rotulo="Enviado ao Inter">{dataHora(p.sent_at)}</Linha>}
            {p.paid_at && <Linha rotulo="Pago em">{dataHora(p.paid_at)}</Linha>}
            {!p.paid_at && !emAberto && p.updated_at && <Linha rotulo="Encerrado em">{dataHora(p.updated_at)}</Linha>}
            {p.error && <Linha rotulo="Motivo"><span className="text-red-600">{p.error}</span></Linha>}
            {p.substituido && <Linha rotulo="Observação">Foi preparado de novo — o pedido novo aparece à parte.</Linha>}
          </div>
          {p.linha_do_tempo.length > 0 && (
            <div className="pt-2">
              <p className="text-[11px] font-bold uppercase tracking-wide text-zinc-400 pb-1">Linha do tempo</p>
              <ol className="relative border-l border-zinc-200 ml-1.5 space-y-1.5">
                {p.linha_do_tempo.map((t, i) => (
                  <li key={i} className="pl-3 relative">
                    <span className={`absolute -left-[5px] top-1.5 w-2 h-2 rounded-full ${i === p.linha_do_tempo.length - 1 ? 'bg-violet-500' : 'bg-zinc-300'}`} />
                    <p className="text-xs text-zinc-700">{maiuscula(t.texto)}</p>
                    <p className="text-[10px] text-zinc-400">{dataHora(t.at)}{t.canal && t.canal !== 'app' ? ` · ${CANAL[t.canal] ?? t.canal}` : ''}</p>
                  </li>
                ))}
              </ol>
            </div>
          )}
          {emAberto && (
            <div className="flex gap-2 pt-2">
              {podePagar ? (
                <button onClick={() => onAcao(p, 'ok')} className="flex-1 h-9 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-sm font-bold cursor-pointer">
                  <i className="ri-check-line" /> Pagar
                </button>
              ) : (
                <button onClick={verStatus} disabled={conferindo} className="flex-1 h-9 rounded-xl border border-zinc-200 text-zinc-700 text-sm font-bold hover:bg-zinc-50 cursor-pointer disabled:opacity-60">
                  <i className={`ri-refresh-line ${conferindo ? 'inline-block animate-spin' : ''}`} /> {conferindo ? 'Conferindo…' : 'Ver status no Inter'}
                </button>
              )}
              <button onClick={() => onAcao(p, 'no')} className="px-3 h-9 rounded-xl border border-zinc-200 text-zinc-500 text-sm font-bold hover:bg-zinc-50 cursor-pointer">Cancelar</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function HistoricoPagamentos({ call, onFechar, onAcao, versao = 0 }: {
  call: Call;
  onFechar: () => void;
  /** Pagar (PIN/digital) e Cancelar passam pelo chat, que já cuida do PIN e da faixa de pagamentos. */
  onAcao: (p: PagamentoHistorico, op: 'ok' | 'no') => void | Promise<void>;
  /** Muda quando um pagamento mudou fora daqui (pagou, cancelou): recarrega a lista. */
  versao?: number;
}) {
  const [filtro, setFiltro] = useState<Filtro>('todos');
  const [lista, setLista] = useState<PagamentoHistorico[] | null>(null);
  const [temMais, setTemMais] = useState(false);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async (antes?: string) => {
    setCarregando(true); setErro(null);
    try {
      const r = await call<{ payments: PagamentoHistorico[]; has_more: boolean }>('payments_history', { filtro, ...(antes ? { before: antes } : {}) });
      setLista((prev) => (antes && prev ? [...prev, ...r.payments.filter((x) => !prev.some((y) => y.id === x.id))] : r.payments));
      setTemMais(r.has_more);
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
      if (!antes) setLista((prev) => prev ?? []);
    } finally { setCarregando(false); }
  }, [call, filtro]);

  useEffect(() => { setLista(null); carregar(); }, [carregar, versao]);

  const conferirStatus = async (p: PagamentoHistorico) => {
    try {
      const out = await call<{ payment: PagamentoHistorico }>('pay', { id: p.id, op: 'st' });
      // A resposta do 'pay' não traz a linha do tempo: mantém a que já temos e só troca o status.
      setLista((prev) => prev?.map((x) => (x.id === p.id ? { ...x, ...out.payment, linha_do_tempo: x.linha_do_tempo, loja: x.loja, origem: x.origem } : x)) ?? prev);
    } catch (e) { setErro(e instanceof Error ? e.message : String(e)); }
  };

  const itens = lista ?? [];
  return (
    <div data-sem-arrasto className="absolute inset-0 z-10 flex flex-col bg-zinc-50">
      <div className="flex items-center gap-2.5 px-4 h-14 border-b border-zinc-100 bg-white flex-shrink-0">
        <button onClick={onFechar} className="w-8 h-8 flex items-center justify-center rounded-xl text-zinc-500 hover:bg-zinc-100 cursor-pointer" aria-label="Voltar para a conversa">
          <i className="ri-arrow-left-line text-xl" />
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-black text-zinc-900 leading-tight">Histórico de pagamentos</p>
          <p className="text-[11px] text-zinc-400 leading-tight">Uma linha por solicitação, com o status atual</p>
        </div>
        <button onClick={() => carregar()} disabled={carregando} className="w-9 h-9 flex items-center justify-center rounded-xl text-zinc-400 hover:bg-zinc-100 cursor-pointer disabled:opacity-50" aria-label="Atualizar">
          <i className={`ri-refresh-line text-lg ${carregando ? 'inline-block animate-spin' : ''}`} />
        </button>
      </div>
      <div className="flex gap-1.5 px-3 py-2 overflow-x-auto flex-shrink-0 bg-white border-b border-zinc-100" role="group" aria-label="Filtrar pagamentos">
        {FILTROS.map((f) => (
          <button key={f.id} onClick={() => setFiltro(f.id)} aria-pressed={filtro === f.id}
            className={`h-8 px-3 flex-shrink-0 rounded-full text-xs font-bold cursor-pointer ${filtro === f.id ? 'bg-violet-600 text-white' : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'}`}>
            {f.label}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
        {erro && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2">{erro}</p>}
        {lista === null && <div className="mx-auto my-16 w-6 h-6 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />}
        {lista !== null && !itens.length && !erro && <p className="text-sm text-zinc-400 text-center py-10">Nenhuma solicitação de pagamento{filtro !== 'todos' ? ' neste filtro' : ''}.</p>}
        {itens.map((p, i) => {
          const novoDia = i === 0 || new Date(itens[i - 1].created_at).toDateString() !== new Date(p.created_at).toDateString();
          return (
            <div key={p.id}>
              {novoDia && <p className="px-1 pt-1 pb-1.5 text-[11px] font-bold uppercase tracking-wide text-zinc-400">{rotuloDia(p.created_at)}</p>}
              <ItemPagamento p={p} onAcao={onAcao} onStatus={conferirStatus} />
            </div>
          );
        })}
        {temMais && (
          <button onClick={() => carregar(itens[itens.length - 1]?.created_at)} disabled={carregando} className="block mx-auto text-xs text-violet-600 font-semibold py-2 cursor-pointer disabled:opacity-50">
            {carregando ? 'Carregando…' : 'Carregar mais antigos'}
          </button>
        )}
      </div>
    </div>
  );
}
