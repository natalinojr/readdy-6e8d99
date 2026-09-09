import type { PedidoRecente } from '@/types/pdv';
import type { FiscalDocumentRow } from '@/lib/fiscal';
import { STATUS_LABEL, cancelMinutesLeft } from '@/lib/fiscal';
import { useEffect, useState } from 'react';
import EmitirNfModal from './EmitirNfModal';
import { clienteNome } from './utils';
import { formatOrderNumber } from '@/lib/statusMappers';
import type { useFiscalDocs } from '@/hooks/useFiscalDocs';

type Fiscal = ReturnType<typeof useFiscalDocs>;

interface Props {
  pedido: PedidoRecente;
  fiscal: Fiscal;
  onToast: (ok: boolean, title: string, msg?: string) => void;
  compact?: boolean;
}

const fmtHora = (iso: string | null) => iso ? new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '';

/**
 * Coluna "Nota Fiscal" da lista de pedidos. Um pedido = uma NFC-e. Em pedidos
 * unificados (pagamento em grupo) mostra o agregado e emite o que faltar.
 */
export default function NotaFiscalCell(props: Props) {
  return <NotaFiscalCellInner {...props} />;
}

function NotaFiscalCellInner({ pedido, fiscal, onToast, compact }: Props) {
  const ids = pedido.pedidoIds && pedido.pedidoIds.length > 0 ? pedido.pedidoIds : [pedido.id];
  const docs = ids.map(id => fiscal.byOrder.get(id) ?? null);
  const cancelado = pedido.status === 'cancelado' || pedido.status === 'cancelled';
  const isBusy = ids.some(id => fiscal.busy.has(id));
  const stop = (e: React.MouseEvent) => { e.stopPropagation(); e.preventDefault(); };
  // Relógio do prazo de cancelamento (30 min): re-renderiza a cada 30s.
  const [agora, setAgora] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setAgora(Date.now()), 30_000); return () => clearInterval(t); }, []);

  // Emissão manual pergunta antes se o cliente quer CPF/CNPJ na nota.
  const [modal, setModal] = useState(false);
  const emitirTodos = (e: React.MouseEvent) => { stop(e); setModal(true); };
  const executarEmissao = async (consumer: { cpf?: string; name?: string } | null) => {
    setModal(false);
    let ok = 0; let falha: string | null = null;
    for (let i = 0; i < ids.length; i++) {
      const d = docs[i];
      if (d && (d.status === 'authorized' || d.status === 'processing')) continue;
      const r = await fiscal.emitir(ids[i], consumer);
      if (r.success) ok++; else falha = r.message ?? r.status;
      // Pedidos pagos juntos: a fiscal-write emite UMA nota do grupo, que já cobre os demais.
      if (r.source_type === 'payment_group') break;
    }
    if (falha) onToast(false, ok > 0 ? `${ok} nota(s) autorizada(s), 1 falhou` : 'Nota não autorizada', falha);
    else onToast(true, ok === 1 ? 'NFC-e autorizada' : `${ok} NFC-e autorizadas`);
  };

  const titulo = ids.length > 1
    ? `Emitir NFC-e de ${ids.length} pedidos pagos juntos`
    : `Emitir NFC-e do pedido ${formatOrderNumber(pedido.numeroStr ?? pedido.numeroCodigo, pedido.numero)}`;
  const modalEl = modal ? (
    <EmitirNfModal
      titulo={titulo}
      valor={`R$ ${pedido.total.toFixed(2).replace('.', ',')}`}
      nomeInicial={clienteNome(pedido) || undefined}
      onConfirm={executarEmissao}
      onClose={() => setModal(false)}
    />
  ) : null;

  const abrir = async (e: React.MouseEvent, d: FiscalDocumentRow) => {
    stop(e);
    const err = await fiscal.abrirDanfe(d);
    if (err) onToast(false, 'DANFE indisponível', err);
  };
  const imprimir = async (e: React.MouseEvent, d: FiscalDocumentRow) => {
    stop(e);
    const err = await fiscal.imprimir(d);
    onToast(!err, err ? 'Não foi possível imprimir' : 'Cupom enviado para a impressora', err ?? undefined);
  };

  // ── Pedido único, ou grupo pago junto que já tem UMA nota cobrindo todos ──
  const unicaDoGrupo = ids.length > 1 && docs[0]?.source_type === 'payment_group' && docs.every(d => d && d.id === docs[0]!.id) ? docs[0] : null;
  if (ids.length === 1 || unicaDoGrupo) {
    const d = unicaDoGrupo ?? docs[0];
    if (cancelado && !d) return <span className="text-[10px] text-zinc-300">—</span>;

    if (!d) {
      if (!pedido.pago) return <span className="text-[10px] text-zinc-400 whitespace-nowrap" title="A nota sai quando o pedido for pago">Aguarda pgto.</span>;
      return (<>
        <button onClick={emitirTodos} disabled={isBusy}
          className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-md bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50 cursor-pointer whitespace-nowrap"
          title={fiscal.enabled ? 'Sem nota: emitir agora' : 'Emissão automática desligada: emitir manualmente'}>
          <i className={`${isBusy ? 'ri-loader-4-line animate-spin' : 'ri-file-add-line'} text-[11px]`} />{isBusy ? 'Emitindo' : 'Emitir NF'}
        </button>
        {modalEl}
      </>);
    }

    if (d.status === 'authorized' || d.status === 'cancelled') {
      const cancel = d.status === 'cancelled';
      return (
        <div className="min-w-0" onClick={stop}>
          <div className="flex items-center gap-1">
            <span className={`inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full border whitespace-nowrap ${cancel ? 'bg-zinc-100 text-zinc-500 border-zinc-200 line-through' : 'bg-emerald-50 text-emerald-700 border-emerald-200'}`}
              title={`${cancel ? 'Cancelada' : 'Autorizada'} ${d.emitted_at ? new Date(d.emitted_at).toLocaleString('pt-BR') : ''}${d.environment === 2 ? ' · homologação' : ''}\nChave ${d.chave ?? ''}`}>
              <i className={`${cancel ? 'ri-close-circle-line' : 'ri-checkbox-circle-line'} text-[10px]`} />
              NFC-e {d.numero ?? ''}
            </span>
            {d.environment === 2 && <span className="text-[9px] font-bold text-amber-600" title="Ambiente de homologação, sem valor fiscal">H</span>}
          </div>
          {!compact && (
            <div className="flex items-center gap-1 mt-0.5">
              <span className="text-[10px] text-zinc-400">{fmtHora(d.emitted_at)}{d.customer_cpf ? ' · CPF' : ''}</span>
              {!cancel && (() => { const m = cancelMinutesLeft(d.emitted_at, agora); return m !== null && m > 0
                ? <span className={`text-[9px] font-semibold px-1 rounded ${m <= 5 ? 'text-red-600 bg-red-50' : 'text-amber-700 bg-amber-50'}`} title="Prazo para cancelar na SEFAZ (Pedidos › Notas Fiscais)">cancela {m}min</span>
                : null; })()}
              <button onClick={e => abrir(e, d)} disabled={isBusy} title="Ver DANFE" className="w-5 h-5 flex items-center justify-center rounded text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 cursor-pointer disabled:opacity-40"><i className="ri-file-text-line text-[12px]" /></button>
              {!cancel && <button onClick={e => imprimir(e, d)} disabled={isBusy} title="Reimprimir cupom" className="w-5 h-5 flex items-center justify-center rounded text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 cursor-pointer disabled:opacity-40"><i className="ri-printer-line text-[12px]" /></button>}
            </div>
          )}
        </div>
      );
    }

    if (d.status === 'processing' || d.status === 'pending') {
      return <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-sky-600 whitespace-nowrap"><i className="ri-loader-4-line animate-spin" />Emitindo…</span>;
    }

    // rejected / error / skipped
    return (
      <div className="min-w-0" onClick={stop}>
        <button onClick={emitirTodos} disabled={isBusy}
          className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-md border cursor-pointer whitespace-nowrap disabled:opacity-50 ${d.status === 'skipped' ? 'bg-white text-zinc-600 border-zinc-200 hover:bg-zinc-50' : 'bg-red-50 text-red-700 border-red-200 hover:bg-red-100'}`}
          title={d.error_message ?? STATUS_LABEL[d.status]}>
          <i className={`${isBusy ? 'ri-loader-4-line animate-spin' : d.status === 'skipped' ? 'ri-file-add-line' : 'ri-error-warning-line'} text-[11px]`} />
          {isBusy ? 'Emitindo' : d.status === 'skipped' ? 'Emitir NF' : 'Reemitir'}
        </button>
        {!compact && d.error_message && (
          <p className="text-[10px] text-red-500 truncate max-w-[160px] mt-0.5" title={d.error_message}>{d.error_message}</p>
        )}
        {modalEl}
      </div>
    );
  }

  // ── Grupo (pagamento unificado): agrega ──
  const autorizadas = docs.filter(d => d && d.status === 'authorized').length;
  const emitindo = docs.some(d => d && (d.status === 'processing' || d.status === 'pending'));
  const problemas = docs.filter(d => d && (d.status === 'rejected' || d.status === 'error')).length;
  const faltam = ids.length - autorizadas;
  if (autorizadas === ids.length) {
    return (
      <span className="inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 whitespace-nowrap" title={docs.map(d => d ? `NFC-e ${d.numero ?? ''}` : '').filter(Boolean).join(', ')} onClick={stop}>
        <i className="ri-checkbox-circle-line text-[10px]" />{autorizadas} notas
      </span>
    );
  }
  if (emitindo) return <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-sky-600 whitespace-nowrap"><i className="ri-loader-4-line animate-spin" />Emitindo…</span>;
  if (!pedido.pago && autorizadas === 0) return <span className="text-[10px] text-zinc-400 whitespace-nowrap">Aguarda pgto.</span>;
  return (
    <div className="min-w-0" onClick={stop}>
      <button onClick={emitirTodos} disabled={isBusy}
        className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-md cursor-pointer whitespace-nowrap disabled:opacity-50 ${problemas > 0 ? 'bg-red-50 text-red-700 border border-red-200 hover:bg-red-100' : 'bg-amber-500 text-white hover:bg-amber-600'}`}
        title={`${autorizadas} de ${ids.length} com nota`}>
        <i className={`${isBusy ? 'ri-loader-4-line animate-spin' : 'ri-file-add-line'} text-[11px]`} />
        {isBusy ? 'Emitindo' : `Emitir ${faltam} NF`}
      </button>
      {!compact && autorizadas > 0 && <p className="text-[10px] text-zinc-400 mt-0.5">{autorizadas}/{ids.length} emitidas</p>}
      {modalEl}
    </div>
  );
}
