import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase, invokeWithAuth } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';

// ── Notas de entrada (NF-e dos fornecedores contra o CNPJ da loja, via SEFAZ) ──
// Cada nota é conferida aqui e vira uma COMPRA (mercadoria → CMV, com as parcelas
// do boleto em Contas a Pagar) ou uma DESPESA (conta a pagar com categoria DRE),
// ou é ignorada (devolução, bonificação, remessa, nota de outra finalidade).

interface Parcela { numero?: string; vencimento: string; valor: number }
interface Item { codigo?: string; descricao?: string; ncm?: string; cfop?: string; unidade?: string; quantidade?: number; valor_unitario?: number; valor_total?: number; desconto?: number }
interface DocRow {
  id: string; chave: string; numero: number | null; serie: string | null;
  emitente_cnpj: string | null; emitente_nome: string | null; natureza: string | null; cfops: string | null;
  valor_total: number; emitted_at: string | null; sefaz_status: number | null;
  xml_status: 'pending' | 'full' | 'summary' | 'error';
  parcelas: Parcela[]; itens: Item[]; frete: number | null; desconto: number | null; pagamento: Pag[];
  status: 'new' | 'imported' | 'ignored'; import_type: 'purchase' | 'bill' | null; purchase_id: string | null;
  payable_ids: string[]; ignore_reason: string | null; manifest_status: string | null; error_message: string | null;
  imported_at: string | null;
}
const COLS = 'id, chave, numero, serie, emitente_cnpj, emitente_nome, natureza, cfops, valor_total, emitted_at, sefaz_status, xml_status, parcelas, itens, frete, desconto, pagamento, status, import_type, purchase_id, payable_ids, ignore_reason, manifest_status, error_message, imported_at';

const brl = (n: number | null | undefined) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(n ?? 0));
const dataBR = (s: string | null | undefined) => (s ? new Date(s.length === 10 ? `${s}T12:00:00` : s).toLocaleDateString('pt-BR') : '—');
const cnpjFmt = (d: string | null) => {
  const s = (d ?? '').replace(/\D/g, '');
  return s.length === 14 ? `${s.slice(0, 2)}.${s.slice(2, 5)}.${s.slice(5, 8)}/${s.slice(8, 12)}-${s.slice(12)}` : s || '—';
};
const hoje = () => new Date().toISOString().slice(0, 10);

type Filtro = 'new' | 'imported' | 'ignored' | 'all';

// CFOPs de saída que não são venda a pagar: bonificação, amostra, remessa, vasilhame, outras saídas.
const CFOP_NAO_VENDA = /^[56](9(0[1-9]|1[0-9]|2[0-4]|49)|55[0-9])$/;
const TPAG: Record<string, string> = { '01': 'Dinheiro', '02': 'Cheque', '03': 'Cartão de crédito', '04': 'Cartão de débito', '05': 'Crédito loja', '15': 'Boleto', '16': 'Depósito', '17': 'PIX', '18': 'Transferência', '90': 'Sem pagamento', '99': 'Outros' };
const PAGO_NA_HORA = new Set(['01', '03', '04', '17', '16', '18']);
interface Pag { forma: string; valor: number }
function pareceNaoVenda(d: { cfops: string | null; pagamento?: Pag[] }): boolean {
  const cfops = (d.cfops ?? '').split(',').map((c) => c.trim()).filter(Boolean);
  const semPagamento = (d.pagamento ?? []).length > 0 && (d.pagamento ?? []).every((p) => p.forma === '90' || Number(p.valor) === 0);
  return semPagamento || (cfops.length > 0 && cfops.every((c) => CFOP_NAO_VENDA.test(c)));
}
function formaResumo(pag: Pag[] | undefined): string {
  return [...new Set((pag ?? []).map((p) => TPAG[p.forma] ?? 'Outros'))].join(', ');
}

export default function NotasEntradaTab() {
  const { user } = useAuth();
  const { success: toastOk, error: toastErr } = useToast();
  const tenantId = user?.tenantId;
  const podeLancar = user?.perfil === 'admin' || user?.perfil === 'gerente';

  const [docs, setDocs] = useState<DocRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filtro, setFiltro] = useState<Filtro>('new');
  const [busca, setBusca] = useState('');
  const [sincronizando, setSincronizando] = useState(false);
  const [ultimaSync, setUltimaSync] = useState<{ at: string | null; erro: string | null; temToken: boolean }>({ at: null, erro: null, temToken: false });
  const [aberto, setAberto] = useState<DocRow | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const call = useCallback(async <T,>(body: Record<string, unknown>) => {
    const { data, error } = await invokeWithAuth<T & { success?: boolean; error?: string }>('fiscal-inbound', { body: { tenant_id: tenantId, ...body } });
    if (error) return { success: false, error: error.message } as unknown as T & { success?: boolean; error?: string };
    return (data ?? { success: false, error: 'Sem resposta' }) as T & { success?: boolean; error?: string };
  }, [tenantId]);

  const carregar = useCallback(async () => {
    if (!tenantId) return;
    const [{ data }, { data: fs }] = await Promise.all([
      supabase.from('fiscal_inbound_documents').select(COLS).eq('tenant_id', tenantId).order('emitted_at', { ascending: false }).limit(1000),
      supabase.from('fiscal_settings').select('inbound_last_sync_at, inbound_last_error, enabled').eq('tenant_id', tenantId).maybeSingle(),
    ]);
    setDocs((data ?? []) as unknown as DocRow[]);
    setUltimaSync({ at: (fs?.inbound_last_sync_at as string) ?? null, erro: (fs?.inbound_last_error as string) ?? null, temToken: Boolean(fs) });
    setLoading(false);
  }, [tenantId]);

  useEffect(() => { carregar(); }, [carregar]);

  const sincronizar = async () => {
    setSincronizando(true);
    const r = await call<{ encontradas?: number; novas?: number; xml?: { full: number; summary: number; error: number }; skipped?: string }>({ action: 'sync', days: 90 });
    setSincronizando(false);
    if (!r.success) { toastErr('Não foi possível buscar as notas', r.error || r.skipped || ''); await carregar(); return; }
    toastOk(`${r.encontradas ?? 0} nota(s) na SEFAZ`, `${r.novas ?? 0} nova(s)${r.xml?.summary ? ` · ${r.xml.summary} aguardando ciência` : ''}`);
    await carregar();
  };

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return docs.filter((d) => {
      if (filtro !== 'all' && d.status !== filtro) return false;
      if (!q) return true;
      return (d.emitente_nome ?? '').toLowerCase().includes(q) || (d.emitente_cnpj ?? '').includes(q.replace(/\D/g, '') || '§') || String(d.numero ?? '').includes(q);
    });
  }, [docs, filtro, busca]);

  const resumo = useMemo(() => {
    const novas = docs.filter((d) => d.status === 'new' && d.sefaz_status !== 2);
    return {
      novas: novas.length,
      valorNovas: novas.reduce((s, d) => s + Number(d.valor_total ?? 0), 0),
      semXml: novas.filter((d) => d.xml_status !== 'full').length,
      canceladas: docs.filter((d) => d.sefaz_status === 2 && d.status !== 'ignored').length,
    };
  }, [docs]);

  const acao = async (d: DocRow, body: Record<string, unknown>, okMsg: string) => {
    setBusy(d.id);
    const r = await call<{ success?: boolean; error?: string; motivo?: string }>({ document_id: d.id, ...body });
    setBusy(null);
    if (r.success) toastOk(okMsg); else toastErr('Não foi possível', r.error || r.motivo || '');
    await carregar();
  };

  const abrirDanfe = async (d: DocRow) => {
    setBusy(d.id);
    const r = await call<{ pdf_base64?: string; content_type?: string }>({ action: 'get_pdf', document_id: d.id });
    setBusy(null);
    if (!r.success || !r.pdf_base64) { toastErr('DANFE indisponível', r.error ?? ''); return; }
    const bin = atob(r.pdf_base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const url = URL.createObjectURL(new Blob([bytes], { type: r.content_type === 'text/html' ? 'text/html;charset=utf-8' : 'application/pdf' }));
    window.open(url, '_blank', 'noopener');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  return (
    <div className="p-4 md:p-6 space-y-4">
      {/* Cabeçalho */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold text-zinc-800">Notas de entrada (SEFAZ)</h2>
          <p className="text-xs text-zinc-500 mt-0.5 max-w-2xl">
            NF-e emitidas pelos fornecedores contra o CNPJ da loja. Confira e lance como compra (as parcelas do boleto vão para Contas a Pagar) ou ignore.
          </p>
          <p className="text-[11px] text-zinc-400 mt-1">
            {ultimaSync.at ? `Última busca: ${new Date(ultimaSync.at).toLocaleString('pt-BR')}` : 'Ainda não buscamos notas nesta loja.'}
            {ultimaSync.erro ? <span className="text-red-500"> · Erro: {ultimaSync.erro}</span> : null}
          </p>
        </div>
        <button onClick={sincronizar} disabled={sincronizando}
          className="inline-flex items-center gap-2 text-xs font-semibold px-3 py-2 rounded-lg bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50 cursor-pointer whitespace-nowrap">
          <i className={sincronizando ? 'ri-loader-4-line animate-spin' : 'ri-download-cloud-2-line'} />
          {sincronizando ? 'Buscando na SEFAZ…' : 'Buscar notas agora'}
        </button>
      </div>

      {/* Resumo */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-white rounded-xl border border-zinc-100 p-4">
          <p className="text-[11px] font-semibold text-zinc-400 uppercase">A conferir</p>
          <p className="text-xl font-bold text-amber-600 mt-1">{resumo.novas}</p>
          <p className="text-xs text-zinc-500">{brl(resumo.valorNovas)}</p>
        </div>
        <div className="bg-white rounded-xl border border-zinc-100 p-4">
          <p className="text-[11px] font-semibold text-zinc-400 uppercase">Sem XML completo</p>
          <p className={`text-xl font-bold mt-1 ${resumo.semXml ? 'text-sky-600' : 'text-zinc-700'}`}>{resumo.semXml}</p>
          <p className="text-xs text-zinc-500">faltam itens e parcelas</p>
        </div>
        <div className="bg-white rounded-xl border border-zinc-100 p-4">
          <p className="text-[11px] font-semibold text-zinc-400 uppercase">Canceladas pelo fornecedor</p>
          <p className={`text-xl font-bold mt-1 ${resumo.canceladas ? 'text-red-600' : 'text-zinc-700'}`}>{resumo.canceladas}</p>
          <p className="text-xs text-zinc-500">não devem ser pagas</p>
        </div>
        <div className="bg-white rounded-xl border border-zinc-100 p-4">
          <p className="text-[11px] font-semibold text-zinc-400 uppercase">Total na lista</p>
          <p className="text-xl font-bold text-zinc-700 mt-1">{docs.length}</p>
          <p className="text-xs text-zinc-500">últimos 90 dias da SEFAZ</p>
        </div>
      </div>

      {/* Filtros */}
      <div className="bg-white rounded-xl border border-zinc-100 p-3 flex flex-wrap items-center gap-2">
        {([['new', 'A conferir'], ['imported', 'Lançadas'], ['ignored', 'Ignoradas'], ['all', 'Todas']] as const).map(([id, label]) => (
          <button key={id} onClick={() => setFiltro(id)}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg cursor-pointer ${filtro === id ? 'bg-zinc-900 text-white' : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'}`}>
            {label}
          </button>
        ))}
        <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Fornecedor, CNPJ ou nº da nota"
          className="flex-1 min-w-[180px] text-sm border border-zinc-200 rounded-lg px-3 py-1.5 focus:outline-none focus:border-amber-400" />
      </div>

      {/* Lista */}
      <div className="bg-white rounded-xl border border-zinc-100 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-sm text-zinc-400">Carregando…</div>
        ) : filtrados.length === 0 ? (
          <div className="p-10 text-center">
            <i className="ri-inbox-2-line text-3xl text-zinc-300" />
            <p className="text-sm text-zinc-500 mt-2">{docs.length === 0 ? 'Nenhuma nota de entrada ainda.' : 'Nada neste filtro.'}</p>
            {docs.length === 0 && <p className="text-xs text-zinc-400 mt-1">Clique em "Buscar notas agora". A SEFAZ guarda as notas dos últimos 90 dias.</p>}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] uppercase text-zinc-400 border-b border-zinc-100">
                  <th className="text-left px-4 py-2.5 font-semibold">Emissão</th>
                  <th className="text-left px-4 py-2.5 font-semibold">Fornecedor</th>
                  <th className="text-left px-4 py-2.5 font-semibold">Nota</th>
                  <th className="text-right px-4 py-2.5 font-semibold">Valor</th>
                  <th className="text-left px-4 py-2.5 font-semibold">Vencimentos</th>
                  <th className="text-left px-4 py-2.5 font-semibold">Situação</th>
                  <th className="text-right px-4 py-2.5 font-semibold">Ações</th>
                </tr>
              </thead>
              <tbody>
                {filtrados.map((d) => {
                  const cancelada = d.sefaz_status === 2;
                  const proxima = (d.parcelas ?? []).find((p) => p.vencimento >= hoje()) ?? (d.parcelas ?? [])[0];
                  const isBusy = busy === d.id;
                  return (
                    <tr key={d.id} className={`border-b border-zinc-50 hover:bg-zinc-50/60 ${cancelada ? 'bg-red-50/40' : ''}`}>
                      <td className="px-4 py-2.5 text-zinc-600 whitespace-nowrap">{dataBR(d.emitted_at)}</td>
                      <td className="px-4 py-2.5 min-w-[200px]">
                        <p className="font-medium text-zinc-800 truncate max-w-[260px]" title={d.emitente_nome ?? ''}>{d.emitente_nome ?? '—'}</p>
                        <p className="text-[10px] text-zinc-400 font-mono">{cnpjFmt(d.emitente_cnpj)}</p>
                      </td>
                      <td className="px-4 py-2.5 text-zinc-600 whitespace-nowrap">
                        {d.numero ?? '—'}{d.serie ? `/${d.serie}` : ''}
                        {d.natureza && <p className="text-[10px] text-zinc-400 truncate max-w-[160px]" title={d.natureza}>{d.natureza}</p>}
                      </td>
                      <td className="px-4 py-2.5 text-right font-semibold text-zinc-800 whitespace-nowrap">{brl(d.valor_total)}</td>
                      <td className="px-4 py-2.5 text-zinc-600 whitespace-nowrap">
                        {d.xml_status !== 'full' ? <span className="text-[11px] text-sky-600">aguardando XML</span>
                          : pareceNaoVenda(d) ? <span className="text-[11px] font-semibold text-violet-600" title="CFOP de remessa/bonificação ou nota sem pagamento — normalmente se ignora">remessa/bonificação?</span>
                          : (d.parcelas ?? []).length === 0 ? <span className="text-[11px] text-zinc-500">sem boleto · {formaResumo(d.pagamento) || 'pago na hora?'}</span>
                          : <>
                              <span className="text-xs">{(d.parcelas ?? []).length}× · próx. {dataBR(proxima?.vencimento)}</span>
                            </>}
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        {cancelada ? <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-700">Cancelada na SEFAZ</span>
                          : d.status === 'imported' ? <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700">{d.import_type === 'purchase' ? 'Lançada como compra' : 'Lançada como despesa'}</span>
                          : d.status === 'ignored' ? <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-zinc-100 text-zinc-500" title={d.ignore_reason ?? ''}>Ignorada</span>
                          : <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700">A conferir</span>}
                        {d.error_message && d.status === 'new' && <p className="text-[10px] text-red-500 truncate max-w-[200px]" title={d.error_message}>{d.error_message}</p>}
                      </td>
                      <td className="px-4 py-2.5 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1">
                          {d.xml_status === 'summary' && podeLancar && d.status === 'new' && (
                            <button onClick={() => acao(d, { action: 'manifest', tipo: 2 }, 'Ciência registrada. O XML completo chega em alguns minutos.')} disabled={isBusy}
                              title="Registra a ciência da operação na SEFAZ para liberar o XML com itens e boletos"
                              className="text-[11px] font-semibold px-2 py-1 rounded-lg border border-sky-200 text-sky-700 bg-sky-50 hover:bg-sky-100 disabled:opacity-40 cursor-pointer">
                              Pedir XML
                            </button>
                          )}
                          {(d.xml_status === 'error' || d.xml_status === 'pending') && (
                            <button onClick={() => acao(d, { action: 'refetch_xml' }, 'XML atualizado')} disabled={isBusy} title="Tentar baixar o XML de novo"
                              className="w-7 h-7 flex items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100 disabled:opacity-40 cursor-pointer"><i className="ri-refresh-line" /></button>
                          )}
                          <button onClick={() => abrirDanfe(d)} disabled={isBusy} title="Ver DANFE"
                            className="w-7 h-7 flex items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100 disabled:opacity-40 cursor-pointer"><i className="ri-file-text-line" /></button>
                          {d.status === 'new' && !cancelada && (
                            <button onClick={() => setAberto(d)} disabled={isBusy}
                              className="text-[11px] font-bold px-2.5 py-1 rounded-lg bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-40 cursor-pointer">
                              Conferir
                            </button>
                          )}
                          {d.status === 'new' && (
                            <button onClick={() => acao(d, { action: 'ignore', reason: cancelada ? 'Cancelada pelo fornecedor' : 'Ignorada na conferência' }, 'Nota ignorada')} disabled={isBusy} title="Ignorar (devolução, bonificação, remessa...)"
                              className="w-7 h-7 flex items-center justify-center rounded-lg text-zinc-400 hover:bg-zinc-100 disabled:opacity-40 cursor-pointer"><i className="ri-eye-off-line" /></button>
                          )}
                          {d.status === 'ignored' && (
                            <button onClick={() => acao(d, { action: 'unignore' }, 'Nota voltou para conferência')} disabled={isBusy}
                              className="text-[11px] font-semibold px-2 py-1 rounded-lg text-zinc-600 hover:bg-zinc-100 cursor-pointer">Desfazer</button>
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

      {aberto && (
        <ConferirModal
          doc={aberto}
          podeLancar={podeLancar}
          tenantId={tenantId ?? ''}
          onClose={() => setAberto(null)}
          onLancado={async (msg) => { setAberto(null); toastOk(msg); await carregar(); }}
          call={call}
          onErro={(t, m) => toastErr(t, m)}
        />
      )}
    </div>
  );
}

// ── Conferência e lançamento ─────────────────────────────────────────────────
function ConferirModal({ doc, podeLancar, tenantId, onClose, onLancado, call, onErro }: {
  doc: DocRow; podeLancar: boolean; tenantId: string;
  onClose: () => void; onLancado: (msg: string) => void; onErro: (t: string, m?: string) => void;
  call: <T>(body: Record<string, unknown>) => Promise<T & { success?: boolean; error?: string }>;
}) {
  const parcelasIniciais: Parcela[] = (doc.parcelas ?? []).length > 0
    ? doc.parcelas.map((p) => ({ ...p }))
    : [{ numero: '1', vencimento: (doc.emitted_at ?? new Date().toISOString()).slice(0, 10), valor: Number(doc.valor_total ?? 0) }];
  const [parcelas, setParcelas] = useState<Parcela[]>(parcelasIniciais);
  const [tipo, setTipo] = useState<'purchase' | 'bill'>('purchase');
  const semBoleto = (doc.parcelas ?? []).length === 0;
  const pagoNaHora = semBoleto && (doc.pagamento ?? []).some((p) => PAGO_NA_HORA.has(p.forma));
  const [pago, setPago] = useState<boolean>(pagoNaHora);
  const formaPrincipal = (doc.pagamento ?? []).slice().sort((a, b) => Number(b.valor) - Number(a.valor))[0]?.forma;
  const naoVenda = pareceNaoVenda(doc);
  const [centros, setCentros] = useState<{ id: string; name: string }[]>([]);
  const [dres, setDres] = useState<{ id: string; name: string; group_type: string }[]>([]);
  const [centro, setCentro] = useState('');
  const [dre, setDre] = useState('');
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    if (!tenantId) return;
    supabase.from('fin_cost_centers').select('id, name').eq('tenant_id', tenantId).is('deleted_at', null).eq('is_active', true).order('sort_order')
      .then(({ data }) => setCentros((data ?? []) as { id: string; name: string }[]));
    supabase.from('fin_dre_categories').select('id, name, group_type').eq('tenant_id', tenantId).is('deleted_at', null).order('sort_order')
      .then(({ data }) => setDres((data ?? []) as { id: string; name: string; group_type: string }[]));
  }, [tenantId]);

  const soma = Math.round(parcelas.reduce((s, p) => s + (Number(p.valor) || 0), 0) * 100) / 100;
  const diff = Math.round((soma - Number(doc.valor_total ?? 0)) * 100) / 100;
  const itens = doc.itens ?? [];

  const setParc = (i: number, k: keyof Parcela, v: string) => setParcelas((ps) => ps.map((p, j) => (j === i ? { ...p, [k]: k === 'valor' ? Number(v.replace(',', '.')) || 0 : v } : p)));

  const lancar = async () => {
    setEnviando(true);
    const r = await call<{ parcelas?: number; supplier?: string }>({
      action: tipo === 'purchase' ? 'import_purchase' : 'import_bill',
      document_id: doc.id,
      parcelas,
      pago: tipo === 'purchase' && pago,
      payment_method: formaPrincipal ? (TPAG[formaPrincipal] ?? 'Outros') : undefined,
      cost_center_id: centro || null,
      dre_category_id: tipo === 'bill' ? (dre || null) : null,
      category: tipo === 'bill' ? (dres.find((d) => d.id === dre)?.name ?? 'Outros') : undefined,
    });
    setEnviando(false);
    if (!r.success) { onErro('Não foi possível lançar', r.error); return; }
    onLancado(tipo === 'purchase' && pago
      ? 'Compra lançada como paga · saída registrada no Fluxo de Caixa'
      : `${tipo === 'purchase' ? 'Compra lançada' : 'Despesa lançada'} · ${r.parcelas ?? parcelas.length} parcela(s) em Contas a Pagar`);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-3xl max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 p-5 border-b border-zinc-100">
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-zinc-900 truncate">{doc.emitente_nome}</h3>
            <p className="text-xs text-zinc-500">
              NF-e {doc.numero}{doc.serie ? `/${doc.serie}` : ''} · {cnpjFmt(doc.emitente_cnpj)} · emitida em {dataBR(doc.emitted_at)} · <strong>{brl(doc.valor_total)}</strong>
            </p>
            {doc.natureza && <p className="text-[11px] text-zinc-400 mt-0.5">Natureza: {doc.natureza}{doc.cfops ? ` · CFOP ${doc.cfops}` : ''}</p>}
          </div>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-zinc-100 cursor-pointer text-zinc-500"><i className="ri-close-line" /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {doc.xml_status !== 'full' && (
            <div className="flex items-start gap-2 bg-sky-50 border border-sky-100 rounded-lg p-3">
              <i className="ri-information-line text-sky-500" />
              <p className="text-xs text-sky-800">Ainda não temos o XML completo desta nota, então itens e boletos não aparecem. Dá para lançar pelo valor total, ou usar "Pedir XML" na lista e voltar em alguns minutos.</p>
            </div>
          )}

          {/* Itens */}
          {itens.length > 0 && (
            <div>
              <p className="text-xs font-bold text-zinc-700 mb-2">Itens da nota ({itens.length})</p>
              <div className="border border-zinc-100 rounded-lg overflow-hidden max-h-56 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="bg-zinc-50 text-zinc-400 uppercase text-[10px] sticky top-0">
                    <tr><th className="text-left px-3 py-1.5">Produto</th><th className="text-right px-3 py-1.5">Qtd</th><th className="text-right px-3 py-1.5">Unit.</th><th className="text-right px-3 py-1.5">Total</th></tr>
                  </thead>
                  <tbody>
                    {itens.map((it, i) => (
                      <tr key={i} className="border-t border-zinc-50">
                        <td className="px-3 py-1.5 text-zinc-700">{it.descricao}<span className="text-zinc-400"> {it.ncm ? `· NCM ${it.ncm}` : ''}</span></td>
                        <td className="px-3 py-1.5 text-right text-zinc-600 whitespace-nowrap">{Number(it.quantidade ?? 0).toLocaleString('pt-BR')} {it.unidade}</td>
                        <td className="px-3 py-1.5 text-right text-zinc-600 whitespace-nowrap">{brl(it.valor_unitario)}</td>
                        <td className="px-3 py-1.5 text-right font-medium text-zinc-800 whitespace-nowrap">{brl(it.valor_total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-[10px] text-zinc-400 mt-1">Os itens entram na compra como descrição. O estoque só é movimentado quando o item estiver vinculado a um insumo (edite a compra depois, se quiser).</p>
            </div>
          )}

          {naoVenda && (
            <div className="flex items-start gap-2 bg-violet-50 border border-violet-100 rounded-lg p-3">
              <i className="ri-error-warning-line text-violet-500" />
              <p className="text-xs text-violet-800">Esta nota parece <strong>remessa, bonificação ou outra saída</strong> (CFOP {doc.cfops}). Normalmente não se lança: feche e use o botão de ignorar na lista.</p>
            </div>
          )}

          {tipo === 'purchase' && (
            <div>
              <p className="text-xs font-bold text-zinc-700 mb-2">Pagamento</p>
              <div className="grid grid-cols-2 gap-2">
                <button onClick={() => setPago(false)} className={`text-left p-2.5 rounded-lg border text-xs cursor-pointer ${!pago ? 'border-amber-400 bg-amber-50' : 'border-zinc-200 hover:border-zinc-300'}`}>
                  <strong className="text-zinc-800">A pagar</strong>
                  <span className="block text-zinc-500">{semBoleto ? 'Cria conta a pagar no vencimento abaixo' : `Boleto: ${parcelas.length} parcela(s) em Contas a Pagar`}</span>
                </button>
                <button onClick={() => setPago(true)} className={`text-left p-2.5 rounded-lg border text-xs cursor-pointer ${pago ? 'border-amber-400 bg-amber-50' : 'border-zinc-200 hover:border-zinc-300'}`}>
                  <strong className="text-zinc-800">Já paga</strong>
                  <span className="block text-zinc-500">{formaResumo(doc.pagamento) ? `Na nota: ${formaResumo(doc.pagamento)}` : 'Pago na entrega'}</span>
                </button>
              </div>
              {pago && (
                <p className="text-[11px] text-amber-700 mt-1.5">A compra entra como paga e a saída é registrada no Fluxo de Caixa na data da nota. Se essa saída já foi lançada em outro lugar (sangria, despesa manual), escolha "A pagar" e dê baixa por lá para não duplicar.</p>
              )}
            </div>
          )}

          {/* Parcelas */}
          {!(tipo === 'purchase' && pago) && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-bold text-zinc-700">
                {(doc.parcelas ?? []).length > 0 ? `Boletos da nota (${parcelas.length})` : 'Vencimento (a nota não traz boleto)'}
              </p>
              <button onClick={() => setParcelas((ps) => [...ps, { numero: String(ps.length + 1), vencimento: ps[ps.length - 1]?.vencimento ?? hoje(), valor: 0 }])}
                className="text-[11px] font-semibold text-amber-600 hover:text-amber-700 cursor-pointer">+ parcela</button>
            </div>
            <div className="space-y-1.5">
              {parcelas.map((p, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="w-8 text-[11px] text-zinc-400 text-right">{i + 1}ª</span>
                  <input type="date" value={p.vencimento} onChange={(e) => setParc(i, 'vencimento', e.target.value)}
                    className="text-sm border border-zinc-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-amber-400" />
                  <input type="number" step="0.01" value={p.valor} onChange={(e) => setParc(i, 'valor', e.target.value)}
                    className="w-32 text-sm border border-zinc-200 rounded-lg px-2 py-1.5 text-right focus:outline-none focus:border-amber-400" />
                  {parcelas.length > 1 && (
                    <button onClick={() => setParcelas((ps) => ps.filter((_, j) => j !== i))} className="w-7 h-7 flex items-center justify-center rounded-lg text-zinc-400 hover:bg-zinc-100 cursor-pointer"><i className="ri-delete-bin-line" /></button>
                  )}
                </div>
              ))}
            </div>
            <p className={`text-[11px] mt-2 ${Math.abs(diff) >= 0.01 ? 'text-amber-700' : 'text-zinc-400'}`}>
              Soma das parcelas: {brl(soma)}{Math.abs(diff) >= 0.01 ? ` · diferença de ${brl(diff)} para o total da nota (frete/desconto fora do boleto?)` : ' · confere com o total da nota'}
            </p>
          </div>

          )}

          {/* Tipo de lançamento */}
          <div>
            <p className="text-xs font-bold text-zinc-700 mb-2">Como lançar</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <button onClick={() => setTipo('purchase')}
                className={`text-left p-3 rounded-xl border cursor-pointer ${tipo === 'purchase' ? 'border-amber-400 bg-amber-50' : 'border-zinc-200 hover:border-zinc-300'}`}>
                <p className="text-sm font-bold text-zinc-800"><i className="ri-shopping-cart-2-line mr-1" />Compra de mercadoria</p>
                <p className="text-[11px] text-zinc-500 mt-0.5">Insumos, bebidas, embalagens de revenda. Entra em Compras e no CMV da DRE.</p>
              </button>
              <button onClick={() => setTipo('bill')}
                className={`text-left p-3 rounded-xl border cursor-pointer ${tipo === 'bill' ? 'border-amber-400 bg-amber-50' : 'border-zinc-200 hover:border-zinc-300'}`}>
                <p className="text-sm font-bold text-zinc-800"><i className="ri-bill-line mr-1" />Despesa</p>
                <p className="text-[11px] text-zinc-500 mt-0.5">Equipamento, material de limpeza, uso e consumo. Entra na DRE pela categoria.</p>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-semibold text-zinc-600 mb-1">Centro de custo <span className="font-normal text-zinc-400">(opcional)</span></label>
              <select value={centro} onChange={(e) => setCentro(e.target.value)} className="w-full text-sm border border-zinc-200 rounded-lg px-3 py-2 focus:outline-none focus:border-amber-400 cursor-pointer">
                <option value="">Sem centro de custo</option>
                {centros.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            {tipo === 'bill' && (
              <div>
                <label className="block text-[11px] font-semibold text-zinc-600 mb-1">Categoria da DRE</label>
                <select value={dre} onChange={(e) => setDre(e.target.value)} className="w-full text-sm border border-zinc-200 rounded-lg px-3 py-2 focus:outline-none focus:border-amber-400 cursor-pointer">
                  <option value="">Escolha…</option>
                  {dres.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
            )}
          </div>
        </div>

        <div className="p-4 border-t border-zinc-100 flex items-center justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm font-semibold text-zinc-600 bg-zinc-100 rounded-lg hover:bg-zinc-200 cursor-pointer">Cancelar</button>
          <button onClick={lancar} disabled={!podeLancar || enviando || (!(tipo === 'purchase' && pago) && (parcelas.length === 0 || soma <= 0)) || (tipo === 'bill' && !dre)}
            title={!podeLancar ? 'Apenas administradores e gerentes' : undefined}
            className="px-4 py-2 text-sm font-semibold text-white bg-amber-500 rounded-lg hover:bg-amber-600 disabled:opacity-40 cursor-pointer">
            {enviando ? 'Lançando…' : tipo === 'purchase' ? (pago ? 'Lançar compra paga' : `Lançar compra · ${parcelas.length} parcela(s)`) : `Lançar despesa · ${parcelas.length} parcela(s)`}
          </button>
        </div>
      </div>
    </div>
  );
}
