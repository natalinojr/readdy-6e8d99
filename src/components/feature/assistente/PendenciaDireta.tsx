// Ação direta no cartão da pendência (dono, 2026-09-24): o que precisa ser conferido aparece no
// próprio cartão e resolve ali, sem abrir outra tela. Os dados vêm do assistente-app
// (pendencia_detalhe / pendencia_acao) — o dono atende várias lojas e a leitura direta das
// tabelas esbarra no auth_tenant_id().
import { useEffect, useState } from 'react';

type Call = <T>(action: string, extra?: Record<string, unknown>) => Promise<T>;

export interface CompraDetalhe {
  id: string; supplier: string | null; total_amount: number; payment_status: string | null; payment_method: string | null;
  purchase_date: string | null; due_date: string | null; invoice_number: string | null; lancada_por: string | null;
  itens: Array<{ description: string; quantity: number; unit_label: string | null; total_price: number }>;
  contas: Array<{ id: string; amount: number; due_date: string; status: string }>;
}

const brl = (n: number) => Number(n ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dia = (d: string | null) => (d ? new Date(`${d.slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) : '');
const erroTxt = (e: unknown) => (e instanceof Error ? e.message : String(e));

function Carregando() {
  return <div className="flex items-center gap-2 py-2 text-[11px] text-zinc-400"><span className="w-3.5 h-3.5 border-2 border-violet-400 border-t-transparent rounded-full animate-spin" /> carregando…</div>;
}

/** Resumo da compra: fornecedor, valor, como foi paga, quem lançou e os itens (abre ao tocar). */
export function ResumoCompra({ call, pendId, onCompra }: { call: Call; pendId: string; onCompra?: (c: CompraDetalhe | null) => void }) {
  const [c, setC] = useState<CompraDetalhe | null | undefined>(undefined);
  const [erro, setErro] = useState<string | null>(null);
  const [itens, setItens] = useState(false);
  useEffect(() => {
    let vivo = true;
    call<{ compra: CompraDetalhe | null }>('pendencia_detalhe', { id: pendId })
      .then((r) => { if (vivo) { setC(r.compra); onCompra?.(r.compra); } })
      .catch((e) => { if (vivo) { setErro(erroTxt(e)); setC(null); } });
    return () => { vivo = false; };
  }, [pendId]); // eslint-disable-line react-hooks/exhaustive-deps
  if (c === undefined) return <Carregando />;
  if (!c) return <p className="mt-1.5 text-[11px] text-zinc-400">{erro ?? 'A compra não existe mais.'}</p>;
  const paga = c.payment_status === 'paid';
  const conta = c.contas.find((x) => x.status !== 'paid');
  return (
    <div className="mt-1.5 rounded-lg bg-zinc-50 border border-zinc-100 px-2.5 py-1.5 text-xs text-zinc-700">
      <p className="break-words"><b className="font-semibold text-zinc-900">{c.supplier ?? 'Fornecedor'}</b> · <b className="font-semibold text-zinc-900">{brl(c.total_amount)}</b>{c.purchase_date ? ` · ${dia(c.purchase_date)}` : ''}</p>
      <p className="text-[11px] text-zinc-500 mt-0.5">
        {paga ? `Paga${c.payment_method ? ` (${c.payment_method})` : ''}` : conta ? `A pagar · vence ${dia(conta.due_date)}` : 'Não paga'}
        {c.invoice_number ? ` · NF ${c.invoice_number}` : ''}
        {c.lancada_por ? ` · lançada por ${c.lancada_por}` : ''}
      </p>
      {c.itens.length > 0 && (
        <>
          <button onClick={() => setItens((v) => !v)} className="mt-0.5 text-[11px] font-semibold text-violet-700 cursor-pointer">
            {itens ? 'Esconder itens' : `Ver ${c.itens.length} ${c.itens.length === 1 ? 'item' : 'itens'}`}
          </button>
          {itens && (
            <ul className="mt-1 space-y-0.5">
              {c.itens.map((it, i) => (
                <li key={i} className="flex gap-2 text-[11px]">
                  <span className="flex-1 min-w-0 truncate">{Number(it.quantity).toLocaleString('pt-BR')} {it.unit_label ?? ''} {it.description}</span>
                  <span className="tabular-nums text-zinc-500">{brl(it.total_price)}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

/** Sangria sem cupom: escolher a compra (paga em dinheiro) a que ela corresponde. */
export function LigarSangria({ call, pendId, onFeito }: { call: Call; pendId: string; onFeito: (msg: string | null) => void }) {
  const [dados, setDados] = useState<{ sangria: { amount: number }; compras: Array<{ id: string; supplier: string | null; total_amount: number; purchase_date: string }> } | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ligando, setLigando] = useState<string | null>(null);
  useEffect(() => {
    call<NonNullable<typeof dados>>('pendencia_detalhe', { id: pendId }).then(setDados).catch((e) => setErro(erroTxt(e)));
  }, [pendId]); // eslint-disable-line react-hooks/exhaustive-deps
  const ligar = async (id: string) => {
    setLigando(id); setErro(null);
    try {
      const r = await call<{ diferenca: number }>('pendencia_acao', { id: pendId, acao: 'ligar', purchase_id: id });
      onFeito(r.diferenca ? `Ligada. Diferença de ${brl(Math.abs(r.diferenca))} entre a sangria e a compra.` : null);
    } catch (e) { setErro(erroTxt(e)); } finally { setLigando(null); }
  };
  if (!dados && !erro) return <Carregando />;
  return (
    <div className="mt-2 rounded-lg border border-zinc-200 bg-white">
      <p className="px-2.5 pt-2 pb-1 text-[11px] text-zinc-500">Compras pagas em dinheiro, sem sangria ligada (a de valor mais perto primeiro):</p>
      {erro && <p className="px-2.5 pb-2 text-[11px] text-red-600">{erro}</p>}
      {dados && !dados.compras.length && <p className="px-2.5 pb-2 text-[11px] text-zinc-400">Nenhuma compra em dinheiro nesses dias. Mande a foto do cupom para lançar.</p>}
      {dados?.compras.map((c) => {
        const igual = Math.abs(Number(c.total_amount) - Number(dados.sangria.amount)) < 0.01;
        return (
          <div key={c.id} className="flex items-center gap-2 px-2.5 py-1.5 border-t border-zinc-100 text-xs">
            <span className="flex-1 min-w-0">
              <span className="block truncate font-semibold text-zinc-800">{c.supplier ?? 'Fornecedor'}</span>
              <span className="text-[11px] text-zinc-500">{dia(c.purchase_date)} · {brl(c.total_amount)}{igual ? ' · mesmo valor' : ''}</span>
            </span>
            <button onClick={() => ligar(c.id)} disabled={!!ligando}
              className={`h-7 px-2.5 rounded-lg text-[11px] font-semibold cursor-pointer disabled:opacity-50 ${igual ? 'bg-violet-600 text-white' : 'border border-violet-200 text-violet-700'}`}>
              {ligando === c.id ? 'Ligando…' : 'Ligar'}
            </button>
          </div>
        );
      })}
    </div>
  );
}

/** Mercadoria que chegou sem nota: as notas de entrada novas do período, a do fornecedor primeiro. */
export function ProcurarNota({ call, pendId, onAchou }: { call: Call; pendId: string; onAchou: (documentId: string) => void }) {
  const [notas, setNotas] = useState<Array<{ id: string; emitente_nome: string | null; valor_total: number; emitted_at: string; numero: number | null; parecida: boolean }> | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [abrindo, setAbrindo] = useState<string | null>(null);
  useEffect(() => {
    call<{ notas: NonNullable<typeof notas> }>('pendencia_detalhe', { id: pendId }).then((r) => setNotas(r.notas)).catch((e) => setErro(erroTxt(e)));
  }, [pendId]); // eslint-disable-line react-hooks/exhaustive-deps
  const escolher = async (id: string) => {
    setAbrindo(id); setErro(null);
    try { await call('pendencia_acao', { id: pendId, acao: 'nota', document_id: id }); onAchou(id); }
    catch (e) { setErro(erroTxt(e)); setAbrindo(null); }
  };
  if (!notas && !erro) return <Carregando />;
  return (
    <div className="mt-2 rounded-lg border border-zinc-200 bg-white">
      <p className="px-2.5 pt-2 pb-1 text-[11px] text-zinc-500">Notas de entrada ainda não lançadas (últimos 15 dias):</p>
      {erro && <p className="px-2.5 pb-2 text-[11px] text-red-600">{erro}</p>}
      {notas && !notas.length && <p className="px-2.5 pb-2 text-[11px] text-zinc-400">Nenhuma nota nova. Ela pode demorar alguns dias para aparecer na SEFAZ.</p>}
      {notas?.map((n) => (
        <div key={n.id} className="flex items-center gap-2 px-2.5 py-1.5 border-t border-zinc-100 text-xs">
          <span className="flex-1 min-w-0">
            <span className="block truncate font-semibold text-zinc-800">{n.emitente_nome ?? 'Emitente'}</span>
            <span className="text-[11px] text-zinc-500">{n.numero ? `NF ${n.numero} · ` : ''}{dia(n.emitted_at)} · {brl(n.valor_total)}{n.parecida ? ' · mesmo fornecedor' : ''}</span>
          </span>
          <button onClick={() => escolher(n.id)} disabled={!!abrindo}
            className={`h-7 px-2.5 rounded-lg text-[11px] font-semibold cursor-pointer disabled:opacity-50 ${n.parecida ? 'bg-violet-600 text-white' : 'border border-violet-200 text-violet-700'}`}>
            {abrindo === n.id ? 'Abrindo…' : 'É esta'}
          </button>
        </div>
      ))}
    </div>
  );
}
