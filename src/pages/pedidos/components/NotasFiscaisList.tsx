import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase, invokeWithAuth } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { STATUS_LABEL, STATUS_CLASS, formatChave, formatCpfCnpj, formatBRL, type FiscalDocumentRow, type FiscalDocStatus } from '@/lib/fiscal';
import { buildZip, downloadBlob } from '@/lib/zipStore';

const LIST_COLS = 'id, tenant_id, model, status, source_type, source_id, order_ids, order_number, environment, total_amount, customer_cpf, customer_name, serie, numero, chave, protocolo, sefaz_status_code, sefaz_message, qr_code, url_chave, error_message, attempts, emitted_at, cancelled_at, cancel_reason, printed_at, created_at, updated_at';

function monthRange(ym: string): { start: string; end: string } {
  const [y, m] = ym.split('-').map(Number);
  const start = new Date(y, m - 1, 1);
  const end = new Date(y, m, 1);
  return { start: start.toISOString(), end: end.toISOString() };
}
const thisMonth = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
const fmtDateTime = (iso: string | null) => iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';

export default function NotasFiscaisList() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { success: toastSuccess, error: toastError } = useToast();
  const [docs, setDocs] = useState<FiscalDocumentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [mes, setMes] = useState(thisMonth());
  const [statusFiltro, setStatusFiltro] = useState<'all' | FiscalDocStatus>('all');
  const [busca, setBusca] = useState('');
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState<string | null>(null); // id ou ação em andamento
  const [cancelDoc, setCancelDoc] = useState<FiscalDocumentRow | null>(null);
  const [justificativa, setJustificativa] = useState('');
  const [detail, setDetail] = useState<FiscalDocumentRow | null>(null);
  const [emitirPedido, setEmitirPedido] = useState('');
  const podeCancelar = user?.perfil === 'admin' || user?.perfil === 'gerente';

  const carregar = useCallback(async () => {
    if (!user?.tenantId) return;
    setLoading(true);
    const { start, end } = monthRange(mes);
    const [{ data }, { data: fs }] = await Promise.all([
      supabase.from('fiscal_documents').select(LIST_COLS).eq('tenant_id', user.tenantId).gte('created_at', start).lt('created_at', end).order('created_at', { ascending: false }).limit(2000),
      supabase.from('fiscal_settings').select('enabled').eq('tenant_id', user.tenantId).maybeSingle(),
    ]);
    setDocs((data ?? []) as unknown as FiscalDocumentRow[]);
    setEnabled(fs ? Boolean(fs.enabled) : null);
    setLoading(false);
  }, [user?.tenantId, mes]);

  useEffect(() => { carregar(); }, [carregar]);

  // Atualiza em tempo real quando uma nota muda de status (emissão é assíncrona)
  useEffect(() => {
    if (!user?.tenantId) return;
    const ch = supabase.channel(`fiscal-docs-${user.tenantId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'fiscal_documents', filter: `tenant_id=eq.${user.tenantId}` }, () => carregar())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user?.tenantId, carregar]);

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase().replace(/\s/g, '');
    return docs.filter(d => {
      if (statusFiltro !== 'all' && d.status !== statusFiltro) return false;
      if (!q) return true;
      return (d.order_number ?? '').toLowerCase().replace(/\s/g, '').includes(q)
        || (d.chave ?? '').includes(q)
        || String(d.numero ?? '').includes(q)
        || (d.customer_cpf ?? '').includes(q);
    });
  }, [docs, statusFiltro, busca]);

  const resumo = useMemo(() => {
    const aut = docs.filter(d => d.status === 'authorized');
    return {
      autorizadas: aut.length,
      valor: aut.reduce((s, d) => s + Number(d.total_amount ?? 0), 0),
      problemas: docs.filter(d => d.status === 'rejected' || d.status === 'error').length,
      pendentes: docs.filter(d => d.status === 'pending' || d.status === 'processing').length,
      canceladas: docs.filter(d => d.status === 'cancelled').length,
    };
  }, [docs]);

  const call = async <T,>(body: Record<string, unknown>): Promise<T | null> => {
    const { data, error } = await invokeWithAuth<T & { success?: boolean; error?: string; message?: string }>('fiscal-write', { body: { tenant_id: user?.tenantId, ...body } });
    if (error) { toastError('Erro', error.message); return null; }
    return data as T;
  };

  const reemitir = async (d: FiscalDocumentRow) => {
    setBusy(d.id);
    const r = await call<{ success: boolean; status: string; message?: string }>({ action: 'retry', document_id: d.id });
    setBusy(null);
    if (r?.success) toastSuccess('Nota autorizada'); else if (r) toastError('Não autorizada', r.message ?? r.status);
    carregar();
  };

  const reprocessar = async () => {
    setBusy('pending');
    const r = await call<{ success: boolean; processed: number; results: { success: boolean }[] }>({ action: 'run_pending' });
    setBusy(null);
    if (r) toastSuccess(`${r.results.filter(x => x.success).length} de ${r.processed} autorizadas`);
    carregar();
  };

  const abrirPdf = async (d: FiscalDocumentRow) => {
    setBusy(d.id);
    const r = await call<{ success: boolean; pdf_base64?: string; error?: string }>({ action: 'get_pdf', document_id: d.id });
    setBusy(null);
    if (!r?.success || !r.pdf_base64) { toastError('PDF indisponível', r?.error ?? ''); return; }
    const bin = atob(r.pdf_base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
    window.open(url, '_blank', 'noopener');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  const baixarXml = async (d: FiscalDocumentRow) => {
    const r = await call<{ success: boolean; xml?: string | null }>({ action: 'get_xml', document_id: d.id });
    if (!r?.xml) { toastError('XML indisponível'); return; }
    downloadBlob(new Blob([r.xml], { type: 'application/xml' }), `NFCe-${d.chave ?? d.id}.xml`);
  };

  const baixarXmlsMes = async () => {
    if (!user?.tenantId) return;
    setBusy('zip');
    const { start, end } = monthRange(mes);
    const { data } = await supabase.from('fiscal_documents').select('chave, xml, status, numero')
      .eq('tenant_id', user.tenantId).in('status', ['authorized', 'cancelled']).not('xml', 'is', null)
      .gte('created_at', start).lt('created_at', end).limit(5000);
    setBusy(null);
    const rows = (data ?? []) as { chave: string | null; xml: string | null; status: string; numero: number | null }[];
    if (rows.length === 0) { toastError('Nenhum XML autorizado neste mês'); return; }
    const zip = buildZip(rows.map(r => ({ name: `${r.status === 'cancelled' ? 'CANCELADA-' : ''}NFCe-${r.chave ?? r.numero}.xml`, content: r.xml ?? '' })));
    downloadBlob(zip, `NFCe-${mes}.zip`);
    toastSuccess(`${rows.length} XML(s) no arquivo`);
  };

  const imprimir = async (d: FiscalDocumentRow) => {
    setBusy(d.id);
    const r = await call<{ success: boolean; error?: string }>({ action: 'print_danfe', document_id: d.id });
    setBusy(null);
    if (r?.success) toastSuccess('Cupom enviado para a impressora'); else toastError('Não foi possível imprimir', r?.error ?? '');
  };

  const confirmarCancelamento = async () => {
    if (!cancelDoc) return;
    setBusy(cancelDoc.id);
    const r = await call<{ success: boolean; error?: string }>({ action: 'cancel', document_id: cancelDoc.id, justificativa });
    setBusy(null);
    if (r?.success) { toastSuccess('Nota cancelada na SEFAZ'); setCancelDoc(null); setJustificativa(''); carregar(); }
    else toastError('Cancelamento recusado', r?.error ?? '');
  };

  const emitirManual = async () => {
    const num = emitirPedido.trim();
    if (!num || !user?.tenantId) return;
    setBusy('manual');
    const { data: o } = await supabase.from('orders').select('id, table_session_id').eq('tenant_id', user.tenantId).eq('number', num).order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (!o) { setBusy(null); toastError('Pedido não encontrado', `Número ${num}`); return; }
    const body = o.table_session_id
      ? { action: 'emit', source_type: 'table_session', source_id: o.table_session_id, force: true }
      : { action: 'emit', source_type: 'order', source_id: o.id, force: true };
    const r = await call<{ success: boolean; status: string; message?: string }>(body);
    setBusy(null);
    if (r?.success) { toastSuccess('Nota autorizada'); setEmitirPedido(''); }
    else if (r) toastError(r.status === 'skipped' ? 'Nota não emitida' : 'Não autorizada', r.message ?? r.status);
    carregar();
  };

  const inputCls = 'text-sm border border-zinc-200 rounded-lg px-3 py-2 text-zinc-800 focus:outline-none focus:border-amber-400';

  return (
    <div className="p-4 md:p-6 space-y-4">
      {enabled === false && (
        <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl p-4">
          <i className="ri-error-warning-line text-amber-500 text-lg" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-amber-800">Emissão automática desligada</p>
            <p className="text-xs text-amber-700 mt-0.5">As vendas não estão gerando NFC-e. Configure o provedor e ligue a emissão em Configurações › Fiscal.</p>
          </div>
          <button onClick={() => navigate('/configuracoes?tab=fiscal')} className="text-xs font-semibold text-amber-700 border border-amber-300 rounded-lg px-3 py-1.5 hover:bg-amber-100 cursor-pointer whitespace-nowrap">Abrir configuração</button>
        </div>
      )}
      {enabled === null && !loading && (
        <div className="flex items-start gap-3 bg-zinc-50 border border-zinc-200 rounded-xl p-4">
          <i className="ri-information-line text-zinc-400 text-lg" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-zinc-700">Módulo fiscal ainda não configurado</p>
            <p className="text-xs text-zinc-500 mt-0.5">Cadastre o token do Brasil NFe e a tributação padrão para começar a emitir NFC-e.</p>
          </div>
          <button onClick={() => navigate('/configuracoes?tab=fiscal')} className="text-xs font-semibold text-zinc-700 border border-zinc-300 rounded-lg px-3 py-1.5 hover:bg-zinc-100 cursor-pointer whitespace-nowrap">Configurar</button>
        </div>
      )}

      {/* Resumo */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-white rounded-xl border border-zinc-100 p-4">
          <p className="text-[11px] font-semibold text-zinc-400 uppercase">Autorizadas no mês</p>
          <p className="text-xl font-bold text-emerald-600 mt-1">{resumo.autorizadas}</p>
          <p className="text-xs text-zinc-500">{formatBRL(resumo.valor)}</p>
        </div>
        <div className="bg-white rounded-xl border border-zinc-100 p-4">
          <p className="text-[11px] font-semibold text-zinc-400 uppercase">Com problema</p>
          <p className={`text-xl font-bold mt-1 ${resumo.problemas > 0 ? 'text-red-600' : 'text-zinc-700'}`}>{resumo.problemas}</p>
          <p className="text-xs text-zinc-500">rejeitadas ou com erro</p>
        </div>
        <div className="bg-white rounded-xl border border-zinc-100 p-4">
          <p className="text-[11px] font-semibold text-zinc-400 uppercase">Pendentes</p>
          <p className="text-xl font-bold text-zinc-700 mt-1">{resumo.pendentes}</p>
          <p className="text-xs text-zinc-500">aguardando emissão</p>
        </div>
        <div className="bg-white rounded-xl border border-zinc-100 p-4">
          <p className="text-[11px] font-semibold text-zinc-400 uppercase">Canceladas</p>
          <p className="text-xl font-bold text-zinc-700 mt-1">{resumo.canceladas}</p>
          <p className="text-xs text-zinc-500">no mês</p>
        </div>
      </div>

      {/* Filtros e ações */}
      <div className="bg-white rounded-xl border border-zinc-100 p-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-[11px] font-semibold text-zinc-500 mb-1">Mês</label>
          <input type="month" className={inputCls} value={mes} onChange={e => setMes(e.target.value)} />
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-zinc-500 mb-1">Status</label>
          <select className={`${inputCls} cursor-pointer`} value={statusFiltro} onChange={e => setStatusFiltro(e.target.value as 'all' | FiscalDocStatus)}>
            <option value="all">Todos</option>
            {(Object.keys(STATUS_LABEL) as FiscalDocStatus[]).map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
        </div>
        <div className="flex-1 min-w-[160px]">
          <label className="block text-[11px] font-semibold text-zinc-500 mb-1">Buscar</label>
          <input className={`${inputCls} w-full`} placeholder="Pedido, número, chave, CPF" value={busca} onChange={e => setBusca(e.target.value)} />
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={reprocessar} disabled={busy !== null || resumo.pendentes + resumo.problemas === 0}
            className="text-xs font-semibold px-3 py-2 rounded-lg border border-zinc-200 text-zinc-700 hover:bg-zinc-50 disabled:opacity-40 cursor-pointer whitespace-nowrap">
            <i className="ri-refresh-line mr-1" />{busy === 'pending' ? 'Reprocessando…' : 'Reprocessar pendentes'}
          </button>
          <button onClick={baixarXmlsMes} disabled={busy !== null}
            className="text-xs font-semibold px-3 py-2 rounded-lg border border-zinc-200 text-zinc-700 hover:bg-zinc-50 disabled:opacity-40 cursor-pointer whitespace-nowrap">
            <i className="ri-download-2-line mr-1" />XMLs do mês (contador)
          </button>
        </div>
      </div>

      {/* Emissão manual */}
      <div className="bg-white rounded-xl border border-zinc-100 p-4 flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[200px]">
          <p className="text-xs font-semibold text-zinc-700">Emitir nota de um pedido</p>
          <p className="text-[11px] text-zinc-400">Para vendas feitas com a emissão desligada ou que ficaram sem nota. Pedido de mesa emite a sessão inteira.</p>
        </div>
        <input className={`${inputCls} w-40`} placeholder="Nº do pedido" value={emitirPedido} onChange={e => setEmitirPedido(e.target.value)} onKeyDown={e => e.key === 'Enter' && emitirManual()} />
        <button onClick={emitirManual} disabled={busy !== null || !emitirPedido.trim()}
          className="text-xs font-semibold px-3 py-2 rounded-lg bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-40 cursor-pointer whitespace-nowrap">
          {busy === 'manual' ? 'Emitindo…' : 'Emitir NFC-e'}
        </button>
      </div>

      {/* Lista */}
      <div className="bg-white rounded-xl border border-zinc-100 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-sm text-zinc-400">Carregando…</div>
        ) : filtrados.length === 0 ? (
          <div className="p-8 text-center text-sm text-zinc-400">Nenhuma nota neste período.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] uppercase text-zinc-400 border-b border-zinc-100">
                  <th className="text-left px-4 py-2.5 font-semibold">Data</th>
                  <th className="text-left px-4 py-2.5 font-semibold">Venda</th>
                  <th className="text-left px-4 py-2.5 font-semibold">NFC-e</th>
                  <th className="text-right px-4 py-2.5 font-semibold">Valor</th>
                  <th className="text-left px-4 py-2.5 font-semibold">CPF</th>
                  <th className="text-left px-4 py-2.5 font-semibold">Status</th>
                  <th className="text-right px-4 py-2.5 font-semibold">Ações</th>
                </tr>
              </thead>
              <tbody>
                {filtrados.map(d => {
                  const isBusy = busy === d.id;
                  const canRetry = d.status === 'rejected' || d.status === 'error' || d.status === 'pending';
                  return (
                    <tr key={d.id} className="border-b border-zinc-50 hover:bg-zinc-50/60">
                      <td className="px-4 py-2.5 text-zinc-600 whitespace-nowrap">{fmtDateTime(d.emitted_at ?? d.created_at)}</td>
                      <td className="px-4 py-2.5 text-zinc-800 whitespace-nowrap">
                        <span className="font-medium">{d.order_number ?? '—'}</span>
                        <span className="block text-[10px] text-zinc-400">{d.source_type === 'table_session' ? 'mesa' : 'pedido'}{d.environment === 2 ? ' · homologação' : ''}</span>
                      </td>
                      <td className="px-4 py-2.5 text-zinc-700 whitespace-nowrap">
                        {d.numero ? <span className="font-mono">{d.numero}{d.serie ? `/${d.serie}` : ''}</span> : <span className="text-zinc-300">—</span>}
                        {d.chave && <span className="block text-[10px] text-zinc-400 font-mono" title={d.chave}>…{d.chave.slice(-8)}</span>}
                      </td>
                      <td className="px-4 py-2.5 text-right text-zinc-800 font-medium whitespace-nowrap">{formatBRL(d.total_amount)}</td>
                      <td className="px-4 py-2.5 text-zinc-600 whitespace-nowrap">{d.customer_cpf ? formatCpfCnpj(d.customer_cpf) : <span className="text-zinc-300">—</span>}</td>
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        <button onClick={() => setDetail(d)} className={`text-[11px] font-semibold px-2 py-1 rounded-full cursor-pointer ${STATUS_CLASS[d.status]}`} title={d.error_message ?? d.sefaz_message ?? ''}>
                          {STATUS_LABEL[d.status]}
                        </button>
                        {(d.status === 'rejected' || d.status === 'error') && d.error_message && (
                          <span className="block text-[10px] text-red-500 max-w-[220px] truncate" title={d.error_message}>{d.error_message}</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1">
                          {d.status === 'authorized' && (
                            <>
                              <button onClick={() => abrirPdf(d)} disabled={isBusy} title="Ver DANFE (PDF)" className="w-7 h-7 flex items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100 disabled:opacity-40 cursor-pointer"><i className="ri-file-pdf-2-line" /></button>
                              <button onClick={() => imprimir(d)} disabled={isBusy} title="Reimprimir cupom" className="w-7 h-7 flex items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100 disabled:opacity-40 cursor-pointer"><i className="ri-printer-line" /></button>
                              {podeCancelar && (
                                <button onClick={() => { setCancelDoc(d); setJustificativa(''); }} disabled={isBusy} title="Cancelar nota" className="w-7 h-7 flex items-center justify-center rounded-lg text-red-500 hover:bg-red-50 disabled:opacity-40 cursor-pointer"><i className="ri-close-circle-line" /></button>
                              )}
                            </>
                          )}
                          {(d.status === 'authorized' || d.status === 'cancelled') && (
                            <button onClick={() => baixarXml(d)} disabled={isBusy} title="Baixar XML" className="w-7 h-7 flex items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100 disabled:opacity-40 cursor-pointer"><i className="ri-file-code-line" /></button>
                          )}
                          {canRetry && (
                            <button onClick={() => reemitir(d)} disabled={isBusy} title="Tentar emitir de novo" className="text-[11px] font-semibold px-2 py-1 rounded-lg bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-40 cursor-pointer whitespace-nowrap">
                              {isBusy ? '…' : 'Reemitir'}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal detalhe */}
      {detail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setDetail(null)}>
          <div className="bg-white rounded-2xl p-6 w-full max-w-lg" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-zinc-900">NFC-e {detail.numero ? `nº ${detail.numero}` : ''} · {detail.order_number}</h3>
              <button onClick={() => setDetail(null)} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-zinc-100 cursor-pointer text-zinc-500"><i className="ri-close-line" /></button>
            </div>
            <dl className="text-xs space-y-2">
              <div className="flex gap-2"><dt className="w-28 text-zinc-400">Status</dt><dd><span className={`px-2 py-0.5 rounded-full font-semibold ${STATUS_CLASS[detail.status]}`}>{STATUS_LABEL[detail.status]}</span></dd></div>
              <div className="flex gap-2"><dt className="w-28 text-zinc-400">Valor</dt><dd className="text-zinc-800 font-medium">{formatBRL(detail.total_amount)}</dd></div>
              {detail.chave && <div className="flex gap-2"><dt className="w-28 text-zinc-400">Chave</dt><dd className="font-mono text-zinc-700 break-all">{formatChave(detail.chave)}</dd></div>}
              {detail.protocolo && <div className="flex gap-2"><dt className="w-28 text-zinc-400">Protocolo</dt><dd className="font-mono text-zinc-700">{detail.protocolo}</dd></div>}
              {detail.emitted_at && <div className="flex gap-2"><dt className="w-28 text-zinc-400">Autorizada em</dt><dd className="text-zinc-700">{new Date(detail.emitted_at).toLocaleString('pt-BR')}</dd></div>}
              {detail.sefaz_message && <div className="flex gap-2"><dt className="w-28 text-zinc-400">SEFAZ</dt><dd className="text-zinc-700">{detail.sefaz_status_code} - {detail.sefaz_message}</dd></div>}
              {detail.error_message && <div className="flex gap-2"><dt className="w-28 text-zinc-400">Erro</dt><dd className="text-red-600 break-words">{detail.error_message}</dd></div>}
              {detail.cancel_reason && <div className="flex gap-2"><dt className="w-28 text-zinc-400">Cancelamento</dt><dd className="text-zinc-700">{detail.cancel_reason}</dd></div>}
              {detail.url_chave && <div className="flex gap-2"><dt className="w-28 text-zinc-400">Consulta</dt><dd><a className="text-amber-600 underline" href={detail.url_chave} target="_blank" rel="noreferrer">{detail.url_chave}</a></dd></div>}
              <div className="flex gap-2"><dt className="w-28 text-zinc-400">Tentativas</dt><dd className="text-zinc-700">{detail.attempts}</dd></div>
            </dl>
          </div>
        </div>
      )}

      {/* Modal cancelamento */}
      {cancelDoc && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md">
            <h3 className="text-sm font-bold text-zinc-900 mb-1">Cancelar NFC-e nº {cancelDoc.numero}</h3>
            <p className="text-xs text-zinc-500 mb-4">A SEFAZ só aceita cancelamento em até 30 minutos após a autorização (prazo pode variar por estado). A venda no ERPOS não é alterada.</p>
            <label className="block text-xs font-semibold text-zinc-600 mb-1.5">Justificativa (mínimo 15 caracteres)</label>
            <textarea className="w-full text-sm border border-zinc-200 rounded-lg px-3 py-2 focus:outline-none focus:border-amber-400" rows={3} value={justificativa} onChange={e => setJustificativa(e.target.value)} placeholder="Ex: Erro de digitação no valor da venda" />
            <div className="flex gap-2 mt-4">
              <button onClick={() => setCancelDoc(null)} className="flex-1 py-2 text-sm font-semibold text-zinc-600 bg-zinc-100 rounded-lg hover:bg-zinc-200 cursor-pointer">Voltar</button>
              <button onClick={confirmarCancelamento} disabled={justificativa.trim().length < 15 || busy === cancelDoc.id}
                className="flex-1 py-2 text-sm font-semibold text-white bg-red-500 rounded-lg hover:bg-red-600 disabled:opacity-40 cursor-pointer">
                {busy === cancelDoc.id ? 'Cancelando…' : 'Cancelar na SEFAZ'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
