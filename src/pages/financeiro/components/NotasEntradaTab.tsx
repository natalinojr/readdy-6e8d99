import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase, invokeWithAuth } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { confirmar } from '@/components/base/Dialogos';
import { PrePagoConferir, PrePagoModal, listarPrePagos } from './notas/PrePago';

// ── Notas de entrada (NF-e dos fornecedores contra o CNPJ da loja, via SEFAZ) ──
// Cada nota é conferida aqui e vira uma COMPRA (mercadoria → CMV, com as parcelas
// do boleto em Contas a Pagar) ou uma DESPESA (conta a pagar com categoria DRE),
// ou é ignorada (devolução, bonificação, remessa, nota de outra finalidade).

interface Parcela { numero?: string; vencimento: string; valor: number }
interface Item { codigo?: string; descricao?: string; ncm?: string; cfop?: string; unidade?: string; quantidade?: number; valor_unitario?: number; valor_total?: number; desconto?: number; competencia?: string | null; v_iss?: number; iss_retido?: boolean; v_retencoes?: number; v_liquido?: number }
interface DocRow {
  id: string; chave: string; modelo: number; numero: number | null; serie: string | null;
  emitente_cnpj: string | null; emitente_nome: string | null; natureza: string | null; cfops: string | null;
  valor_total: number; emitted_at: string | null; sefaz_status: number | null;
  xml_status: 'pending' | 'full' | 'summary' | 'error';
  parcelas: Parcela[]; itens: Item[]; frete: number | null; desconto: number | null; pagamento: Pag[];
  status: 'new' | 'imported' | 'ignored'; import_type: 'purchase' | 'bill' | 'bonus' | null; purchase_id: string | null;
  payable_ids: string[]; ignore_reason: string | null; manifest_status: string | null; error_message: string | null;
  imported_at: string | null;
  /** Lançamento automático desfeito: não entra mais sozinha */
  auto_launch_blocked?: boolean;
  /** Lançada sozinha: pela conciliação (auto_import_ref = linha do extrato) ou, sem ref,
   *  logo após a busca na SEFAZ porque o fornecedor já tinha nota lançada antes */
  auto_imported?: boolean;
  auto_import_ref?: string | null;
  /** 'monthly' = nota do mês, quitada por vários pagamentos do extrato;
   *  'prepaid' = fornecedor pré-pago, paga com o crédito das recargas (2026-09-26) */
  settlement?: 'monthly' | 'prepaid' | null;
  settlement_statement_ids?: string[] | null;
}
const COLS = 'id, chave, modelo, numero, serie, emitente_cnpj, emitente_nome, natureza, cfops, valor_total, emitted_at, sefaz_status, xml_status, parcelas, itens, frete, desconto, pagamento, status, import_type, purchase_id, payable_ids, ignore_reason, manifest_status, error_message, imported_at, auto_imported, auto_import_ref, auto_launch_blocked, settlement, settlement_statement_ids';
interface PagtoExtrato { id: string; data: string; valor: number; nome: string; tipo: string }

// Nota do mês (1 nota ↔ vários pagamentos): edge conciliacao-pagamentos
async function callConc<T>(tenantId: string | undefined, body: Record<string, unknown>) {
  const { data, error } = await invokeWithAuth<T & { success?: boolean; error?: string; message?: string }>('conciliacao-pagamentos', { body: { tenant_id: tenantId, ...body } });
  if (error) return { success: false, error: error.message } as unknown as T & { success?: boolean; error?: string; message?: string };
  return (data ?? { success: false, error: 'Sem resposta' }) as T & { success?: boolean; error?: string; message?: string };
}

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
interface Insumo { id: string; name: string; unit: string | null; purchase_unit: string | null; purchase_factor: number | null }
interface Vinculo { ingredient_id: string; units_per_package: number }
function pareceNaoVenda(d: { cfops: string | null; pagamento?: Pag[] }): boolean {
  const cfops = (d.cfops ?? '').split(',').map((c) => c.trim()).filter(Boolean);
  const semPagamento = (d.pagamento ?? []).length > 0 && (d.pagamento ?? []).every((p) => p.forma === '90' || Number(p.valor) === 0);
  return semPagamento || (cfops.length > 0 && cfops.every((c) => CFOP_NAO_VENDA.test(c)));
}
// Bonificação/brinde (CFOP x910): sem custo, mas a mercadoria entra no estoque.
const CFOP_BONIFICACAO = /^[56]910$/;
function isBonificacao(d: { cfops: string | null }): boolean {
  const cfops = (d.cfops ?? '').split(',').map((c) => c.trim()).filter(Boolean);
  return cfops.length > 0 && cfops.every((c) => CFOP_BONIFICACAO.test(c));
}
// Plataformas cuja NFS-e é a comissão/taxa já descontada do repasse — lançar de novo duplica.
const DESCONTA_NO_REPASSE = /IFOOD|RAPPI|99\s?FOOD|AIQFOME|UBER\s?EATS|KEETA/i;
const isServico = (d: { modelo: number }) => Number(d.modelo) === 10;
function formaResumo(pag: Pag[] | undefined): string {
  return [...new Set((pag ?? []).map((p) => TPAG[p.forma] ?? 'Outros'))].join(', ');
}

// Boleto da nota parada: nota sem lançamento não tem conta a pagar, então o vencimento
// só aparece aqui. Primeiro vencimento da nota e quantos dias faltam (negativo = vencido).
const diasAte = (iso: string) => Math.round((new Date(`${iso}T12:00:00`).getTime() - new Date(`${hoje()}T12:00:00`).getTime()) / 86_400_000);
function urgencia(d: DocRow): { venc: string; dias: number } | null {
  if (d.status !== 'new' || d.sefaz_status === 2) return null;
  const venc = (d.parcelas ?? []).map((p) => p.vencimento).filter(Boolean).sort()[0];
  return venc ? { venc, dias: diasAte(venc) } : null;
}
function UrgenciaTag({ d }: { d: DocRow }) {
  const u = urgencia(d);
  if (!u || u.dias > 3) return null;
  const txt = u.dias < 0 ? `vencida há ${-u.dias} dia${u.dias === -1 ? '' : 's'}` : u.dias === 0 ? 'vence hoje' : `vence em ${u.dias} dia${u.dias === 1 ? '' : 's'}`;
  return <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${u.dias < 0 ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-800'}`} title={`1º vencimento: ${dataBR(u.venc)}`}>{txt}</span>;
}

// Por que a nota não entrou sozinha: as mesmas regras do lançamento automático
// (fiscal-inbound › autoLaunchTenant), para o usuário não ter de adivinhar.
interface Historico { ultima: DocRow; teto: number }
function motivoParada(d: DocRow, h: Historico | undefined, prePago = false): { txt: string; dica: string } | null {
  if (d.status !== 'new' || d.sefaz_status === 2) return null;
  const servico = isServico(d);
  if (prePago) return { txt: 'Fornecedor pré-pago', dica: 'Esta nota é o consumo do crédito: abra em Conferir e use "Lançar do crédito".' };
  if (d.xml_status !== 'full') return { txt: 'Aguardando XML completo', dica: 'Sem o XML não dá para ver itens e boletos. Use "Pedir XML" ou espere a próxima busca.' };
  if (d.auto_launch_blocked) return { txt: 'Lançamento automático desfeito', dica: 'Alguém desfez o lançamento automático desta nota: ela só entra conferindo à mão.' };
  if (!servico && isBonificacao(d)) return { txt: 'Bonificação', dica: 'Bonificação entra sozinha na próxima busca (06h e 12h). Se continuar aqui, confira o erro.' };
  if (!h) return { txt: 'Fornecedor novo nesta loja', dica: 'Primeira nota deste CNPJ nesta loja (lançamentos de outra loja não contam). Depois que você lançar uma, as próximas entram sozinhas do mesmo jeito.' };
  if (h.ultima.settlement === 'monthly') return { txt: 'Nota do mês', dica: 'A última nota deste fornecedor foi quitada pelos pagamentos do extrato. Esta também precisa ser vinculada aos pagamentos em Conferir.' };
  if (servico && DESCONTA_NO_REPASSE.test(d.emitente_nome ?? '')) return { txt: 'Taxa já descontada no repasse', dica: 'Nota da comissão da plataforma: lançar pode duplicar a despesa.' };
  if (!servico && pareceNaoVenda(d)) return { txt: 'Parece remessa/devolução', dica: `CFOP ${d.cfops ?? '—'} ou nota sem pagamento: normalmente se ignora.` };
  if (!servico && h.ultima.import_type !== 'purchase') return { txt: 'Última foi lançada como despesa', dica: 'NF-e só entra sozinha como compra. Confira como lançar esta.' };
  if (h.teto > 0 && Number(d.valor_total ?? 0) > h.teto * 3) return { txt: 'Valor fora do normal', dica: `Mais de 3× a maior nota já lançada deste fornecedor (${brl(h.teto)}).` };
  return { txt: 'Entra sozinha na próxima busca', dica: 'Fornecedor conhecido: o lançamento automático pega esta nota na próxima busca (06h, 12h ou "Buscar notas agora").' };
}

export default function NotasEntradaTab() {
  const { user } = useAuth();
  const { success: toastOk, error: toastErr } = useToast();
  const tenantId = user?.tenantId;
  const podeLancar = user?.perfil === 'admin' || user?.perfil === 'gerente';

  const [docs, setDocs] = useState<DocRow[]>([]);
  const [docsDe, setDocsDe] = useState<string | null>(null); // de qual loja é a lista carregada
  const [loading, setLoading] = useState(true);
  // ?busca= vem do clique num alerta da Conciliação (2026-09-20): mostra todas, não só as novas
  const daUrl = new URLSearchParams(window.location.search).get('busca') ?? '';
  const [filtro, setFiltro] = useState<Filtro>(daUrl ? 'all' : 'new');
  const [busca, setBusca] = useState(daUrl);
  const [tipoDoc, setTipoDoc] = useState<'all' | 'nfe' | 'nfse'>('all');
  const [sincronizando, setSincronizando] = useState(false);
  const [ultimaSync, setUltimaSync] = useState<{ at: string | null; erro: string | null; temToken: boolean }>({ at: null, erro: null, temToken: false });
  const [aberto, setAberto] = useState<DocRow | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [ordem, setOrdem] = useState<'emissao' | 'vencimento'>('emissao');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [ignorandoLote, setIgnorandoLote] = useState(false);
  // Fornecedores pré-pagos (raiz do CNPJ) e a janela do crédito
  const [prePagos, setPrePagos] = useState<Set<string>>(new Set());
  const [verCredito, setVerCredito] = useState(false);
  const carregarPrePagos = useCallback(async () => {
    if (!tenantId) return;
    const r = await listarPrePagos(tenantId);
    setPrePagos(new Set(r.success ? (r.suppliers ?? []).filter((s) => s.is_active).map((s) => s.cnpj.slice(0, 8)) : []));
  }, [tenantId]);
  useEffect(() => { carregarPrePagos(); }, [carregarPrePagos]);
  const ehPrePago = (d: DocRow) => prePagos.has((d.emitente_cnpj ?? '').replace(/\D/g, '').slice(0, 8));
  useEffect(() => { setSel(new Set()); }, [filtro, tipoDoc, busca]);

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
    setDocsDe(tenantId);
    setUltimaSync({ at: (fs?.inbound_last_sync_at as string) ?? null, erro: (fs?.inbound_last_error as string) ?? null, temToken: Boolean(fs) });
    setLoading(false);
  }, [tenantId]);

  useEffect(() => { carregar(); }, [carregar]);

  // ?nota=<id> vem da caixa de pendências ("Conferir e lançar a nota", 2026-09-24): abre a
  // PRÓPRIA nota na conferência, em vez de deixar a pessoa procurar na lista.
  const [params, setParams] = useSearchParams();
  const notaDaUrl = params.get('nota');
  useEffect(() => {
    // Espera a lista da loja atual (a pendência pode ter trocado de loja antes de navegar)
    if (!notaDaUrl || loading || docsDe !== tenantId) return;
    const d = docs.find((x) => x.id === notaDaUrl);
    const limpa = new URLSearchParams(params); limpa.delete('nota'); setParams(limpa, { replace: true });
    if (!d) { toastErr('Nota não encontrada', 'Ela pode ser de outra loja — troque a loja e tente de novo.'); return; }
    if (d.status === 'new') setAberto(d);
    else { setFiltro('all'); setBusca(d.numero != null ? String(d.numero) : ''); toastOk(d.status === 'imported' ? 'Essa nota já foi lançada' : 'Essa nota está ignorada'); }
  }, [notaDaUrl, loading, docsDe, tenantId, docs, params, setParams, toastErr, toastOk]);

  const sincronizar = async () => {
    setSincronizando(true);
    type XmlStats = { full: number; summary: number; error: number };
    const r = await call<{ encontradas?: number; novas?: number; xml?: XmlStats; pendentes?: number; skipped?: string }>({ action: 'sync', days: 90 });
    if (!r.success) { setSincronizando(false); toastErr('Não foi possível buscar as notas', r.error || r.skipped || ''); await carregar(); return; }
    // Muitas notas novas (ex.: 1ª carga da loja): o servidor baixa parte dos XMLs por vez; segue pedindo até zerar.
    let pendentes = r.pendentes ?? 0;
    let aguardandoCiencia = r.xml?.summary ?? 0;
    if (pendentes > 0) await carregar();
    for (let rodada = 0; pendentes > 0 && rodada < 15; rodada++) {
      const x = await call<{ xml?: XmlStats; pendentes?: number }>({ action: 'fetch_xml' });
      if (!x.success) break;
      aguardandoCiencia += x.xml?.summary ?? 0;
      const progresso = (x.xml?.full ?? 0) + (x.xml?.summary ?? 0);
      const antes = pendentes;
      pendentes = x.pendentes ?? 0;
      await carregar();
      if (progresso === 0 && pendentes >= antes) break; // provedor não entrega agora; o cron tenta de novo
    }
    setSincronizando(false);
    toastOk(`${r.encontradas ?? 0} nota(s) na SEFAZ`,
      `${r.novas ?? 0} nova(s)${aguardandoCiencia ? ` · ${aguardandoCiencia} aguardando ciência` : ''}${pendentes ? ` · ${pendentes} XML(s) ainda a baixar (clique em Buscar de novo)` : ''}`);
    await carregar();
  };

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    const lista = docs.filter((d) => {
      if (filtro !== 'all' && d.status !== filtro) return false;
      if (tipoDoc === 'nfe' && isServico(d)) return false;
      if (tipoDoc === 'nfse' && !isServico(d)) return false;
      if (!q) return true;
      return (d.emitente_nome ?? '').toLowerCase().includes(q) || (d.emitente_cnpj ?? '').includes(q.replace(/\D/g, '') || '§') || String(d.numero ?? '').includes(q);
    });
    if (ordem === 'vencimento') {
      // Parada com boleto primeiro (mais vencida no topo); o resto mantém a ordem de emissão
      const venc = (d: DocRow) => urgencia(d)?.venc ?? '9999-12-31';
      lista.sort((a, b) => venc(a).localeCompare(venc(b)));
    }
    return lista;
  }, [docs, filtro, busca, tipoDoc, ordem]);

  // Última nota lançada e maior valor por fornecedor NESTA loja (base do "por que parou")
  const historico = useMemo(() => {
    const m = new Map<string, Historico>();
    const lancadas = docs.filter((d) => d.status === 'imported' && d.emitente_cnpj)
      .sort((a, b) => (b.imported_at ?? '').localeCompare(a.imported_at ?? ''));
    for (const d of lancadas) {
      const k = d.emitente_cnpj as string;
      const h = m.get(k);
      if (!h) m.set(k, { ultima: d, teto: Number(d.valor_total ?? 0) });
      else h.teto = Math.max(h.teto, Number(d.valor_total ?? 0));
    }
    return m;
  }, [docs]);

  const selecionaveis = filtrados.filter((d) => d.status === 'new');
  const todasSel = selecionaveis.length > 0 && selecionaveis.every((d) => sel.has(d.id));
  const toggleSel = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleTodas = () => setSel(todasSel ? new Set() : new Set(selecionaveis.map((d) => d.id)));

  const ignorarSelecionadas = async () => {
    const alvo = docs.filter((d) => sel.has(d.id) && d.status === 'new');
    if (alvo.length === 0) return;
    if (!(await confirmar({
      titulo: `Ignorar ${alvo.length} nota(s)?`,
      mensagem: 'Elas saem de "A conferir" e não viram compra nem despesa. Dá para desfazer depois no filtro "Ignoradas".',
      confirmarLabel: 'Ignorar',
      perigo: true,
    }))) return;
    setIgnorandoLote(true);
    let ok = 0;
    const falhas: string[] = [];
    for (const d of alvo) {
      const r = await call<{ motivo?: string }>({ document_id: d.id, action: 'ignore', reason: d.sefaz_status === 2 ? 'Cancelada pelo fornecedor' : 'Ignorada na conferência (em lote)' });
      if (r.success) ok++; else falhas.push(`${d.numero ?? '—'}: ${r.error || r.motivo || 'erro'}`);
    }
    setIgnorandoLote(false);
    setSel(new Set());
    if (falhas.length) toastErr(`${ok} ignorada(s), ${falhas.length} com erro`, falhas.slice(0, 3).join(' · '));
    else toastOk(`${ok} nota(s) ignorada(s)`);
    await carregar();
  };

  const resumo = useMemo(() => {
    const novas = docs.filter((d) => d.status === 'new' && d.sefaz_status !== 2);
    const vencidas = novas.filter((d) => (urgencia(d)?.dias ?? 0) < 0);
    return {
      novas: novas.length,
      vencidas: vencidas.length,
      valorVencidas: vencidas.reduce((s, d) => s + Number(d.valor_total ?? 0), 0),
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

  // Situação e ações da nota ficam em função própria: a tabela (computador) e os cartões
  // (celular) mostram exatamente as mesmas opções, sem duplicar o JSX.
  const situacaoDaNota = (d: DocRow, cancelada: boolean) => (
    <>
      {cancelada ? <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-700">Cancelada na SEFAZ</span>
                  : d.status === 'imported' ? <><span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700">{d.import_type === 'purchase' ? 'Lançada como compra' : d.import_type === 'bonus' ? 'Lançada como bonificação' : 'Lançada como despesa'}</span>{d.auto_imported && <span className="ml-1 text-[11px] font-bold px-2 py-0.5 rounded-full bg-blue-50 text-blue-700" title={d.auto_import_ref
                    ? 'Importada automaticamente pela conciliação bancária ao confirmar o pagamento.'
                    : 'Lançada automaticamente: este fornecedor já tinha nota lançada antes, e esta entrou do mesmo jeito. Se estiver errada, use "Desfazer".'}>automática</span>}{d.settlement === 'monthly' && <span className="ml-1 text-[11px] font-bold px-2 py-0.5 rounded-full bg-violet-50 text-violet-700" title="Nota do mês: quitada pelos pagamentos do extrato">paga no mês · {(d.settlement_statement_ids ?? []).length} pagto(s)</span>}{d.settlement === 'prepaid' && <span className="ml-1 text-[11px] font-bold px-2 py-0.5 rounded-full bg-violet-50 text-violet-700" title="Fornecedor pré-pago: despesa do mês do consumo, paga com o crédito das recargas">paga com crédito</span>}</>
                  : d.status === 'ignored' ? <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-zinc-100 text-zinc-500" title={d.ignore_reason ?? ''}>Ignorada</span>
                  : <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700">A conferir</span>}
      {(() => {
        const m = motivoParada(d, d.emitente_cnpj ? historico.get(d.emitente_cnpj) : undefined, ehPrePago(d));
        return m && <span className="block w-full mt-0.5 text-[10px] text-zinc-500 cursor-help" title={m.dica}><i className="ri-question-line mr-0.5" />{m.txt}</span>;
      })()}
    </>
  );

  const acoesDaNota = (d: DocRow, isBusy: boolean, cancelada: boolean) => (
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
                  {d.status === 'imported' && d.settlement === 'monthly' && podeLancar && (
                    <button
                      onClick={async () => {
                        if (!(await confirmar({
                          titulo: 'Desfazer o vínculo com os pagamentos do mês?',
                          mensagem: 'As baixas são estornadas, a compra (ou despesa) desta nota é excluída, os pagamentos voltam a pendentes na Conciliação e a nota volta para "A conferir".',
                          confirmarLabel: 'Desfazer',
                          perigo: true,
                        }))) return;
                        setBusy(d.id);
                        const r = await callConc(tenantId, { action: 'unlink_monthly', document_id: d.id });
                        setBusy(null);
                        if (r.success) toastOk(r.message ?? 'Vínculo desfeito'); else toastErr('Não foi possível desfazer', r.error ?? '');
                        await carregar();
                      }}
                      disabled={isBusy}
                      title="Desfazer o vínculo com os pagamentos do mês"
                      className="text-[11px] font-semibold px-2 py-1 rounded-lg text-zinc-600 hover:bg-zinc-100 disabled:opacity-40 cursor-pointer">Desfazer</button>
                  )}
                  {d.status === 'imported' && d.settlement === 'prepaid' && podeLancar && (
                    <button
                      onClick={async () => {
                        if (!(await confirmar({
                          titulo: 'Desfazer o lançamento do crédito?',
                          mensagem: 'A despesa desta nota é excluída, o valor volta para o crédito do fornecedor e a nota volta para "A conferir".',
                          confirmarLabel: 'Desfazer',
                          perigo: true,
                        }))) return;
                        setBusy(d.id);
                        const r = await callConc(tenantId, { action: 'prepaid_unconsume', document_id: d.id });
                        setBusy(null);
                        if (r.success) toastOk(r.message ?? 'Desfeito'); else toastErr('Não foi possível desfazer', r.error ?? '');
                        await carregar();
                      }}
                      disabled={isBusy}
                      title="Desfazer o lançamento do crédito"
                      className="text-[11px] font-semibold px-2 py-1 rounded-lg text-zinc-600 hover:bg-zinc-100 disabled:opacity-40 cursor-pointer">Desfazer</button>
                  )}
                  {d.status === 'imported' && d.auto_imported && !d.auto_import_ref && !d.settlement && podeLancar && (
                    <button
                      onClick={async () => {
                        if (await confirmar({
                          titulo: 'Desfazer o lançamento automático?',
                          mensagem: 'A compra (ou a conta a pagar) desta nota é excluída e a nota volta para "A conferir". Ela não será relançada sozinha.',
                          confirmarLabel: 'Desfazer',
                          perigo: true,
                        })) {
                          acao(d, { action: 'undo_auto_import' }, 'Lançamento desfeito: a nota voltou para conferência');
                        }
                      }}
                      disabled={isBusy}
                      title="Desfazer o lançamento automático"
                      className="text-[11px] font-semibold px-2 py-1 rounded-lg text-zinc-600 hover:bg-zinc-100 disabled:opacity-40 cursor-pointer">Desfazer</button>
                  )}
                </div>
  );

  return (
    <div className="p-4 md:p-6 space-y-4">
      {/* Cabeçalho */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold text-zinc-800">Notas de entrada (SEFAZ)</h2>
          <p className="text-xs text-zinc-500 mt-0.5 max-w-2xl">
            NF-e emitidas pelos fornecedores contra o CNPJ da loja. Nota de fornecedor que já teve nota lançada nesta loja entra sozinha, do mesmo jeito da última vez (selo "automática"); aqui ficam só as que precisam de você: fornecedor novo, remessa/bonificação, taxa de plataforma e valor fora do normal.
          </p>
          <p className="text-[11px] text-zinc-400 mt-1">
            {ultimaSync.at ? `Última busca: ${new Date(ultimaSync.at).toLocaleString('pt-BR')}` : 'Ainda não buscamos notas nesta loja.'}
            {ultimaSync.erro ? <span className="text-red-500"> · Erro: {ultimaSync.erro}</span> : null}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {prePagos.size > 0 && (
            <button onClick={() => setVerCredito(true)} title="Fornecedores pré-pagos: saldo de crédito, recargas e consumos"
              className="inline-flex items-center gap-2 text-xs font-semibold px-3 py-2 rounded-lg border border-violet-200 text-violet-700 bg-violet-50 hover:bg-violet-100 cursor-pointer whitespace-nowrap">
              <i className="ri-wallet-3-line" />Crédito pré-pago
            </button>
          )}
          <button onClick={sincronizar} disabled={sincronizando}
            className="inline-flex items-center gap-2 text-xs font-semibold px-3 py-2 rounded-lg bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50 cursor-pointer whitespace-nowrap">
            <i className={sincronizando ? 'ri-loader-4-line animate-spin' : 'ri-download-cloud-2-line'} />
            {sincronizando ? 'Buscando na SEFAZ…' : 'Buscar notas agora'}
          </button>
        </div>
      </div>

      {/* Resumo */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-white rounded-xl border border-zinc-100 p-4">
          <p className="text-[11px] font-semibold text-zinc-400 uppercase">A conferir</p>
          <p className="text-xl font-bold text-amber-600 mt-1">{resumo.novas}</p>
          <p className="text-xs text-zinc-500">{brl(resumo.valorNovas)}</p>
          {resumo.vencidas > 0 && (
            <button onClick={() => { setFiltro('new'); setOrdem('vencimento'); }} title="Nota parada não vira conta a pagar: o boleto dela não aparece em Contas a Pagar"
              className="mt-1 text-[11px] font-semibold text-red-600 hover:underline cursor-pointer text-left">
              {resumo.vencidas} com boleto vencido · {brl(resumo.valorVencidas)}
            </button>
          )}
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
        <span className="w-px h-5 bg-zinc-200 mx-1" />
        {([['all', 'Todos os tipos'], ['nfe', 'Mercadorias (NF-e)'], ['nfse', 'Serviços (NFS-e)']] as const).map(([id, label]) => (
          <button key={id} onClick={() => setTipoDoc(id)}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg cursor-pointer ${tipoDoc === id ? 'bg-amber-500 text-white' : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'}`}>
            {label} <span className="opacity-70">{docs.filter((d) => (id === 'all' ? true : id === 'nfse' ? isServico(d) : !isServico(d))).length}</span>
          </button>
        ))}
        <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Fornecedor, CNPJ ou nº da nota"
          className="flex-1 min-w-[180px] text-sm border border-zinc-200 rounded-lg px-3 py-1.5 focus:outline-none focus:border-amber-400" />
        <select value={ordem} onChange={(e) => setOrdem(e.target.value as 'emissao' | 'vencimento')}
          className="text-xs border border-zinc-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-amber-400 cursor-pointer">
          <option value="emissao">Mais recentes</option>
          <option value="vencimento">Boleto mais urgente</option>
        </select>
      </div>

      {sel.size > 0 && (
        <div className="bg-zinc-900 text-white rounded-xl px-4 py-2.5 flex flex-wrap items-center gap-3 text-xs">
          <span className="font-semibold">{sel.size} selecionada(s)</span>
          <button onClick={ignorarSelecionadas} disabled={ignorandoLote}
            className="inline-flex items-center gap-1 font-semibold px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 disabled:opacity-50 cursor-pointer">
            <i className={ignorandoLote ? 'ri-loader-4-line animate-spin' : 'ri-eye-off-line'} />{ignorandoLote ? 'Ignorando…' : 'Ignorar selecionadas'}
          </button>
          <button onClick={() => setSel(new Set())} className="ml-auto text-zinc-300 hover:text-white cursor-pointer">Limpar seleção</button>
        </div>
      )}

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
          <>
          {/* Celular: cartão por nota (a tabela de 7 colunas não cabe em 375px) */}
          <ul className="md:hidden p-2 space-y-2 bg-zinc-50/60">
            {filtrados.map((d) => {
              const cancelada = d.sefaz_status === 2;
              const proxima = (d.parcelas ?? []).find((p) => p.vencimento >= hoje()) ?? (d.parcelas ?? [])[0];
              const isBusy = busy === d.id;
              return (
                <li key={d.id} className={`rounded-xl border bg-white px-3 py-3 ${cancelada ? 'border-red-200 bg-red-50/40' : d.status === 'new' ? 'border-amber-200' : 'border-zinc-200'}`}>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[11px] text-zinc-400 whitespace-nowrap inline-flex items-center gap-2">
                      {d.status === 'new' && (
                        <input type="checkbox" checked={sel.has(d.id)} onChange={() => toggleSel(d.id)} aria-label="Selecionar nota" className="w-4 h-4 cursor-pointer" />
                      )}
                      {dataBR(d.emitted_at)}
                    </span>
                    <span className="text-base font-bold text-zinc-900 whitespace-nowrap">{brl(d.valor_total)}</span>
                  </div>
                  <p className="text-sm font-medium text-zinc-800 break-words line-clamp-2">{d.emitente_nome ?? '—'}</p>
                  <p className="text-[11px] text-zinc-500">
                    <span className={`inline-block text-[9px] font-bold px-1.5 py-0.5 rounded mr-1 align-middle ${isServico(d) ? 'bg-sky-50 text-sky-700' : 'bg-zinc-100 text-zinc-600'}`}>{isServico(d) ? 'NFS-e' : 'NF-e'}</span>
                    {d.numero ?? '—'}{d.serie ? `/${d.serie}` : ''} · {cnpjFmt(d.emitente_cnpj)}
                  </p>
                  {(d.parcelas ?? []).length > 0 && (
                    <p className="text-[11px] text-zinc-500 mt-0.5">{(d.parcelas ?? []).length}× · próx. {dataBR(proxima?.vencimento)} <UrgenciaTag d={d} /></p>
                  )}
                  {d.error_message && d.status === 'new' && <p className="text-[11px] text-red-500 break-words line-clamp-2 mt-0.5">{d.error_message}</p>}
                  <div className="flex items-center gap-1.5 flex-wrap mt-2">
                    {situacaoDaNota(d, cancelada)}
                  </div>
                  <div className="mt-2 flex items-center gap-1 flex-wrap [&_button]:h-9 [&_button]:min-w-9 [&_button]:justify-center">
                    {acoesDaNota(d, isBusy, cancelada)}
                  </div>
                </li>
              );
            })}
          </ul>

          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] uppercase text-zinc-400 border-b border-zinc-100">
                  <th className="pl-4 py-2.5 w-6">
                    {selecionaveis.length > 0 && (
                      <input type="checkbox" checked={todasSel} onChange={toggleTodas} title="Selecionar todas as notas a conferir da lista" className="cursor-pointer" />
                    )}
                  </th>
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
                    <tr key={d.id} className={`border-b border-zinc-50 hover:bg-zinc-50/60 ${cancelada ? 'bg-red-50/40' : sel.has(d.id) ? 'bg-amber-50/50' : ''}`}>
                      <td className="pl-4 py-2.5 w-6">
                        {d.status === 'new' && <input type="checkbox" checked={sel.has(d.id)} onChange={() => toggleSel(d.id)} aria-label="Selecionar nota" className="cursor-pointer" />}
                      </td>
                      <td className="px-4 py-2.5 text-zinc-600 whitespace-nowrap">{dataBR(d.emitted_at)}</td>
                      <td className="px-4 py-2.5 min-w-[200px]">
                        <p className="font-medium text-zinc-800 truncate max-w-[260px]" title={d.emitente_nome ?? ''}>{d.emitente_nome ?? '—'}</p>
                        <p className="text-[10px] text-zinc-400 font-mono">{cnpjFmt(d.emitente_cnpj)}</p>
                      </td>
                      <td className="px-4 py-2.5 text-zinc-600 whitespace-nowrap">
                        <span className={`inline-block text-[9px] font-bold px-1.5 py-0.5 rounded mr-1.5 align-middle ${isServico(d) ? 'bg-sky-50 text-sky-700' : 'bg-zinc-100 text-zinc-600'}`}>{isServico(d) ? 'NFS-e' : 'NF-e'}</span>
                        {d.numero ?? '—'}{d.serie ? `/${d.serie}` : ''}
                        {d.natureza && <p className="text-[10px] text-zinc-400 truncate max-w-[160px]" title={d.natureza}>{d.natureza}</p>}
                      </td>
                      <td className="px-4 py-2.5 text-right font-semibold text-zinc-800 whitespace-nowrap">{brl(d.valor_total)}</td>
                      <td className="px-4 py-2.5 text-zinc-600 whitespace-nowrap">
                        {isServico(d) && d.xml_status === 'full' ? (
                          DESCONTA_NO_REPASSE.test(d.emitente_nome ?? '')
                            ? <span className="text-[11px] font-semibold text-violet-600" title="Taxa/comissão já descontada do repasse da plataforma — lançar de novo pode duplicar">descontado no repasse?</span>
                            : <span className="text-[11px] text-zinc-500">serviço · comp. {dataBR((d.itens ?? [])[0]?.competencia ?? null)}</span>
                        ) : d.xml_status !== 'full' ? <span className="text-[11px] text-sky-600">aguardando XML</span>
                          : isBonificacao(d) ? <span className="text-[11px] font-semibold text-emerald-700" title="Bonificação: sem custo, mas a mercadoria entra no estoque no recebimento">bonificação</span>
                          : pareceNaoVenda(d) ? <span className="text-[11px] font-semibold text-violet-600" title="CFOP de remessa/devolução/outras saídas ou nota sem pagamento — normalmente se ignora">remessa/devolução?</span>
                          : (d.parcelas ?? []).length === 0 ? <span className="text-[11px] text-zinc-500">sem boleto · {formaResumo(d.pagamento) || 'pago na hora?'}</span>
                          : <>
                              <span className="text-xs">{(d.parcelas ?? []).length}× · próx. {dataBR(proxima?.vencimento)}</span>
                              <span className="block mt-0.5"><UrgenciaTag d={d} /></span>
                            </>}
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        {situacaoDaNota(d, cancelada)}
                        {d.error_message && d.status === 'new' && <p className="text-[10px] text-red-500 truncate max-w-[200px]" title={d.error_message}>{d.error_message}</p>}
                      </td>
                      <td className="px-4 py-2.5 text-right whitespace-nowrap">
                        {acoesDaNota(d, isBusy, cancelada)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          </>
        )}
      </div>

      {aberto && (
        <ConferirModal
          doc={aberto}
          podeLancar={podeLancar}
          tenantId={tenantId ?? ''}
          onClose={() => setAberto(null)}
          onLancado={async (msg) => { setAberto(null); toastOk(msg); await Promise.all([carregar(), carregarPrePagos()]); }}
          call={call}
          onErro={(t, m) => toastErr(t, m)}
        />
      )}
      {verCredito && (
        <PrePagoModal
          tenantId={tenantId ?? ''}
          podeLancar={podeLancar}
          onClose={() => setVerCredito(false)}
          onConferir={(id) => { const d = docs.find((x) => x.id === id); setVerCredito(false); if (d) setAberto(d); }}
          onErro={(t, m) => toastErr(t, m)}
          onOk={(m) => toastOk(m)}
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
  const servico = isServico(doc);
  const bonificacao = !servico && isBonificacao(doc);
  // 'bonus' = bonificação: compra com itens a R$ 0, só para dar entrada no estoque
  const [tipo, setTipo] = useState<'purchase' | 'bill' | 'bonus'>(servico ? 'bill' : bonificacao ? 'bonus' : 'purchase');
  const comEstoque = tipo === 'purchase' || tipo === 'bonus';
  // NFS-e de fornecedor de PRODUTO (2026-09-18): se o serviço está como CMV na Classificação de
  // itens, a nota já abre como compra. O usuário pode trocar; a escolha dele prevalece.
  useEffect(() => {
    if (!servico) return;
    supabase.rpc('fn_item_doc_classe', { p_doc: doc.id }).then(({ data }) => { if (data === 'cmv') setTipo('purchase'); });
  }, [servico, doc.id]);
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
  // Fornecedor pré-pago: a nota sai do crédito; o lançamento normal some da tela
  const [prePago, setPrePago] = useState(false);
  // Vínculo item → insumo (dá entrada no estoque); vem memorizado por fornecedor+código
  const [insumos, setInsumos] = useState<Insumo[]>([]);
  const [vinculos, setVinculos] = useState<Vinculo[]>(() => (doc.itens ?? []).map(() => ({ ingredient_id: '', units_per_package: 1 })));
  const [vinculosCarregados, setVinculosCarregados] = useState(false);

  useEffect(() => {
    if (servico || (doc.itens ?? []).length === 0) return;
    call<{ links?: Array<{ index: number; ingredient_id: string; units_per_package: number } | null>; ingredients?: Insumo[] }>({ action: 'item_links', document_id: doc.id })
      .then((r) => {
        if (!r.success) return;
        setInsumos(r.ingredients ?? []);
        setVinculos((vs) => vs.map((v, i) => {
          const l = r.links?.[i];
          return l ? { ingredient_id: l.ingredient_id, units_per_package: Number(l.units_per_package) || 1 } : v;
        }));
        setVinculosCarregados(true);
      });
  }, [call, doc.id, doc.itens, servico]);

  // Nota do mês: pagamentos do extrato a este fornecedor perto da emissão
  const [pagtos, setPagtos] = useState<PagtoExtrato[]>([]);
  const [selPagtos, setSelPagtos] = useState<Set<string>>(new Set());
  const [mensal, setMensal] = useState(false);
  useEffect(() => {
    if (bonificacao) return;
    callConc<{ candidates?: PagtoExtrato[]; suggestion?: string[] }>(tenantId, { action: 'monthly_candidates', document_id: doc.id })
      .then((r) => {
        if (!r.success) return;
        const cands = r.candidates ?? [];
        setPagtos(cands);
        const sug = new Set(r.suggestion ?? []);
        setSelPagtos(sug);
        const somaSug = cands.filter((c) => sug.has(c.id)).reduce((s, c) => s + c.valor, 0);
        // Liga sozinho quando 2+ pagamentos somam exatamente o valor da nota
        if (sug.size >= 2 && Math.abs(somaSug - Number(doc.valor_total ?? 0)) <= 0.02) setMensal(true);
      });
  }, [tenantId, doc.id, doc.valor_total, bonificacao]);
  const somaSel = Math.round(pagtos.filter((p) => selPagtos.has(p.id)).reduce((s, p) => s + p.valor, 0) * 100) / 100;
  const saldoMensal = Math.round((Number(doc.valor_total ?? 0) - somaSel) * 100) / 100;
  const usarMensal = mensal && tipo !== 'bonus';

  const setVinculo = (i: number, patch: Partial<Vinculo>) => setVinculos((vs) => vs.map((v, j) => {
    if (j !== i) return v;
    const nv = { ...v, ...patch };
    // Ao trocar de insumo, sugere o fator de embalagem que ele já tem memorizado
    if (patch.ingredient_id !== undefined && patch.units_per_package === undefined) {
      const ing = insumos.find((g) => g.id === patch.ingredient_id);
      nv.units_per_package = Number(ing?.purchase_factor) > 0 ? Number(ing?.purchase_factor) : 1;
    }
    return nv;
  }));

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
    if (usarMensal) {
      const rm = await callConc(tenantId, {
        action: 'link_monthly', document_id: doc.id, ids: [...selPagtos],
        cost_center_id: centro || null,
        tipo, // usarMensal já exclui bonificação
        dre_category_id: tipo === 'bill' ? (dre || null) : null,
        category: tipo === 'bill' ? (dres.find((d) => d.id === dre)?.name ?? 'Outros') : undefined,
        links: comEstoque && vinculosCarregados
          ? vinculos.map((v, i) => ({ index: i, ingredient_id: v.ingredient_id || null, units_per_package: v.units_per_package > 0 ? v.units_per_package : 1 }))
          : undefined,
      });
      setEnviando(false);
      if (!rm.success) { onErro('Não foi possível vincular', rm.error); return; }
      onLancado(rm.message ?? 'Nota do mês lançada');
      return;
    }
    const r = await call<{ parcelas?: number; supplier?: string }>({
      action: tipo === 'bill' ? 'import_bill' : 'import_purchase',
      document_id: doc.id,
      tipo_escolhido: true,
      parcelas,
      bonus: tipo === 'bonus',
      pago: tipo === 'purchase' && pago,
      payment_method: formaPrincipal ? (TPAG[formaPrincipal] ?? 'Outros') : undefined,
      cost_center_id: centro || null,
      dre_category_id: tipo === 'bill' ? (dre || null) : null,
      category: tipo === 'bill' ? (dres.find((d) => d.id === dre)?.name ?? 'Outros') : undefined,
      // Só manda se os vínculos carregaram — senão um erro de rede apagaria os memorizados
      links: comEstoque && vinculosCarregados
        ? vinculos.map((v, i) => ({ index: i, ingredient_id: v.ingredient_id || null, units_per_package: v.units_per_package > 0 ? v.units_per_package : 1 }))
        : undefined,
    });
    setEnviando(false);
    if (!r.success) { onErro('Não foi possível lançar', r.error); return; }
    onLancado(tipo === 'bonus'
      ? 'Bonificação lançada · entra no estoque ao confirmar o recebimento, sem custo'
      : tipo === 'purchase' && pago
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

          {/* Serviço (NFS-e) */}
          {servico && itens[0] && (() => {
            const sv = itens[0];
            return (
              <div className="border border-sky-100 bg-sky-50/40 rounded-xl p-3 space-y-2">
                <p className="text-xs font-bold text-zinc-700">Serviço prestado</p>
                <p className="text-sm text-zinc-800">{sv.descricao}</p>
                {doc.natureza && doc.natureza !== sv.descricao && <p className="text-[11px] text-zinc-500">{doc.natureza}</p>}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
                  <div><p className="text-[10px] uppercase text-zinc-400">Competência</p><p className="text-xs font-semibold text-zinc-700">{dataBR(sv.competencia ?? null)}</p></div>
                  <div><p className="text-[10px] uppercase text-zinc-400">Valor do serviço</p><p className="text-xs font-semibold text-zinc-700">{brl(sv.valor_total)}</p></div>
                  <div><p className="text-[10px] uppercase text-zinc-400">ISS {sv.iss_retido ? '(retido por você)' : ''}</p><p className="text-xs font-semibold text-zinc-700">{brl(sv.v_iss)}</p></div>
                  <div><p className="text-[10px] uppercase text-zinc-400">Líquido a pagar</p><p className="text-xs font-bold text-zinc-900">{brl(sv.v_liquido ?? doc.valor_total)}</p></div>
                </div>
                {(Number(sv.v_retencoes ?? 0) > 0 || sv.iss_retido) && (
                  <p className="text-[11px] text-amber-700">Há imposto retido na fonte ({brl(Number(sv.v_retencoes ?? 0) || sv.v_iss)}): quem recolhe é a loja. Confira com a contadora.</p>
                )}
              </div>
            );
          })()}
          {servico && DESCONTA_NO_REPASSE.test(doc.emitente_nome ?? '') && (
            <div className="flex items-start gap-2 bg-violet-50 border border-violet-100 rounded-lg p-3">
              <i className="ri-error-warning-line text-violet-500" />
              <p className="text-xs text-violet-800">Esta é a nota da <strong>taxa/comissão da plataforma</strong>, que já vem descontada do repasse. Se o repasse já entra líquido no financeiro, lançar aqui duplica a despesa: normalmente se ignora.</p>
            </div>
          )}

          {/* Itens */}
          {!servico && itens.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-bold text-zinc-700">Itens da nota ({itens.length})</p>
                {comEstoque && vinculosCarregados && (
                  <p className="text-[11px] text-zinc-500">{vinculos.filter((v) => v.ingredient_id).length} de {itens.length} vinculado(s) ao estoque</p>
                )}
              </div>
              <div className="border border-zinc-100 rounded-lg overflow-auto max-h-72">
                <table className="w-full text-xs">
                  <thead className="bg-zinc-50 text-zinc-400 uppercase text-[10px] sticky top-0 z-10">
                    <tr>
                      <th className="text-left px-3 py-1.5">Produto</th><th className="text-right px-3 py-1.5">Qtd</th><th className="text-right px-3 py-1.5">Total</th>
                      {comEstoque && <th className="text-left px-3 py-1.5 min-w-[260px]">Insumo do estoque</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {itens.map((it, i) => {
                      const v = vinculos[i];
                      const ing = insumos.find((g) => g.id === v?.ingredient_id);
                      const entra = Number(it.quantidade ?? 0) * (Number(v?.units_per_package) || 1);
                      return (
                        <tr key={i} className="border-t border-zinc-50 align-top">
                          <td className="px-3 py-1.5 text-zinc-700">{it.descricao}<span className="text-zinc-400"> {it.codigo ? `· cód. ${it.codigo}` : ''}</span></td>
                          <td className="px-3 py-1.5 text-right text-zinc-600 whitespace-nowrap">{Number(it.quantidade ?? 0).toLocaleString('pt-BR')} {it.unidade}<p className="text-[10px] text-zinc-400">{brl(it.valor_unitario)}</p></td>
                          <td className="px-3 py-1.5 text-right font-medium text-zinc-800 whitespace-nowrap">{brl(it.valor_total)}</td>
                          {comEstoque && (
                            <td className="px-3 py-1.5">
                              <select value={v?.ingredient_id ?? ''} onChange={(e) => setVinculo(i, { ingredient_id: e.target.value })} disabled={!vinculosCarregados}
                                className={`w-full text-xs border rounded-lg px-2 py-1 focus:outline-none focus:border-amber-400 cursor-pointer ${v?.ingredient_id ? 'border-emerald-300 bg-emerald-50/50' : 'border-zinc-200'}`}>
                                <option value="">{vinculosCarregados ? 'Não entra no estoque' : 'Carregando…'}</option>
                                {insumos.map((g) => <option key={g.id} value={g.id}>{g.name}{g.unit ? ` (${g.unit})` : ''}</option>)}
                              </select>
                              {ing && (
                                <div className="flex items-center gap-1 mt-1 text-[11px] text-zinc-500">
                                  <span>1 {it.unidade || 'un'} =</span>
                                  <input type="number" min="0" step="any" value={v.units_per_package}
                                    onChange={(e) => setVinculo(i, { units_per_package: Number(e.target.value.replace(',', '.')) || 0 })}
                                    className="w-16 border border-zinc-200 rounded px-1.5 py-0.5 text-right focus:outline-none focus:border-amber-400" />
                                  <span>{ing.unit ?? 'un'}</span>
                                  <span className="text-emerald-700 font-semibold ml-auto whitespace-nowrap">+{entra.toLocaleString('pt-BR', { maximumFractionDigits: 3 })} {ing.unit ?? 'un'}</span>
                                </div>
                              )}
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="text-[10px] text-zinc-400 mt-1">
                {comEstoque
                  ? 'Itens vinculados a um insumo entram no estoque quando você confirmar o recebimento da compra (Compras › detalhe › Confirmar recebimento). O vínculo fica memorizado: nas próximas notas deste fornecedor o item já vem vinculado. Confira o fator quando a nota vier em caixa/fardo (ex.: 1 CX = 12 un).'
                  : 'Despesa não movimenta o estoque.'}
              </p>
            </div>
          )}

          {bonificacao ? (
            <div className="flex items-start gap-2 bg-emerald-50 border border-emerald-100 rounded-lg p-3">
              <i className="ri-gift-line text-emerald-600" />
              <p className="text-xs text-emerald-800">Esta nota é <strong>bonificação</strong> (CFOP {doc.cfops}): não tem custo, mas a mercadoria entra no estoque. Lance como <strong>Bonificação</strong> e vincule os itens aos insumos; eles entram no recebimento, sem conta a pagar e sem mexer no custo médio.</p>
            </div>
          ) : naoVenda && (
            <div className="flex items-start gap-2 bg-violet-50 border border-violet-100 rounded-lg p-3">
              <i className="ri-error-warning-line text-violet-500" />
              <p className="text-xs text-violet-800">Esta nota parece <strong>remessa, devolução ou outra saída</strong> (CFOP {doc.cfops}). Normalmente não se lança: feche e use o botão de ignorar na lista.</p>
            </div>
          )}

          <PrePagoConferir doc={doc} tenantId={tenantId} podeLancar={podeLancar} onAtivo={setPrePago} onLancado={onLancado} onErro={onErro} />

          {!prePago && <>
          {/* Nota do mês: vários pagamentos já feitos */}
          {tipo !== 'bonus' && pagtos.length > 0 && (
            <div className={`border rounded-xl p-3 ${usarMensal ? 'border-violet-200 bg-violet-50/40' : 'border-zinc-100'}`}>
              <label className="flex items-start gap-2 cursor-pointer">
                <input type="checkbox" checked={mensal} onChange={(e) => setMensal(e.target.checked)} className="mt-0.5 cursor-pointer" />
                <span>
                  <span className="text-xs font-bold text-zinc-800">Esta nota cobre pagamentos já feitos (nota do mês)</span>
                  <span className="block text-[11px] text-zinc-500">
                    {pagtos.length} pagamento(s) a este fornecedor no extrato perto da emissão. A {tipo === 'bill' ? 'despesa' : 'compra'} entra na data da nota ({dataBR(doc.emitted_at)}) e cada pagamento dá baixa numa parcela, na data e na conta do extrato.
                  </span>
                </span>
              </label>
              {usarMensal && (
                <>
                  <div className="mt-2 border border-zinc-100 bg-white rounded-lg overflow-auto max-h-56">
                    <table className="w-full text-xs">
                      <tbody>
                        {pagtos.map((p) => (
                          <tr key={p.id} className="border-t border-zinc-50 first:border-t-0">
                            <td className="px-2 py-1.5 w-6">
                              <input type="checkbox" checked={selPagtos.has(p.id)} className="cursor-pointer"
                                onChange={(e) => setSelPagtos((s) => { const n = new Set(s); if (e.target.checked) n.add(p.id); else n.delete(p.id); return n; })} />
                            </td>
                            <td className="px-2 py-1.5 text-zinc-600 whitespace-nowrap">{dataBR(p.data)}</td>
                            <td className="px-2 py-1.5 text-zinc-500">{p.tipo}</td>
                            <td className="px-2 py-1.5 text-zinc-500 truncate max-w-[220px]" title={p.nome}>{p.nome}</td>
                            <td className="px-2 py-1.5 text-right font-medium text-zinc-800 whitespace-nowrap">{brl(p.valor)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className={`text-[11px] mt-1.5 ${saldoMensal < -0.01 ? 'text-red-600 font-semibold' : Math.abs(saldoMensal) <= 0.01 ? 'text-emerald-700' : 'text-amber-700'}`}>
                    {selPagtos.size} selecionado(s): {brl(somaSel)} de {brl(doc.valor_total)}
                    {saldoMensal < -0.01 ? ' · passa do valor da nota: desmarque algum'
                      : Math.abs(saldoMensal) <= 0.01 ? ' · confere com a nota'
                      : ` · saldo de ${brl(saldoMensal)} fica em Contas a Pagar (vence hoje)`}
                  </p>
                </>
              )}
            </div>
          )}

          {tipo === 'purchase' && !usarMensal && (
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
          {tipo !== 'bonus' && !usarMensal && !(tipo === 'purchase' && pago) && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-bold text-zinc-700">
                {servico ? 'Vencimento do pagamento ao prestador' : (doc.parcelas ?? []).length > 0 ? `Boletos da nota (${parcelas.length})` : 'Vencimento (a nota não traz boleto)'}
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

          {/* Tipo de lançamento (NFS-e também: fornecedor de produto que emite nota de serviço) */}
          {(
          <div>
            <p className="text-xs font-bold text-zinc-700 mb-2">Como lançar</p>
            <div className={`grid grid-cols-1 gap-2 ${bonificacao ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>
              {bonificacao && (
                <button onClick={() => setTipo('bonus')}
                  className={`text-left p-3 rounded-xl border cursor-pointer ${tipo === 'bonus' ? 'border-amber-400 bg-amber-50' : 'border-zinc-200 hover:border-zinc-300'}`}>
                  <p className="text-sm font-bold text-zinc-800"><i className="ri-gift-line mr-1" />Bonificação</p>
                  <p className="text-[11px] text-zinc-500 mt-0.5">Sem custo: entra no estoque no recebimento. Não gera conta a pagar nem CMV.</p>
                </button>
              )}
              <button onClick={() => setTipo('purchase')}
                className={`text-left p-3 rounded-xl border cursor-pointer ${tipo === 'purchase' ? 'border-amber-400 bg-amber-50' : 'border-zinc-200 hover:border-zinc-300'}`}>
                <p className="text-sm font-bold text-zinc-800"><i className="ri-shopping-cart-2-line mr-1" />Compra de mercadoria</p>
                <p className="text-[11px] text-zinc-500 mt-0.5">{servico
                  ? 'Fornecedor que entrega produto mas emite nota de serviço. Entra em Compras e no CMV da DRE.'
                  : 'Insumos, bebidas, embalagens de revenda. Entra em Compras e no CMV da DRE.'}</p>
              </button>
              <button onClick={() => setTipo('bill')}
                className={`text-left p-3 rounded-xl border cursor-pointer ${tipo === 'bill' ? 'border-amber-400 bg-amber-50' : 'border-zinc-200 hover:border-zinc-300'}`}>
                <p className="text-sm font-bold text-zinc-800"><i className="ri-bill-line mr-1" />Despesa</p>
                <p className="text-[11px] text-zinc-500 mt-0.5">{servico
                  ? 'Serviço de verdade: sistema, contador, marketing, locação. Entra na DRE pela categoria.'
                  : 'Equipamento, material de limpeza, uso e consumo. Entra na DRE pela categoria.'}</p>
              </button>
            </div>
          </div>
          )}

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
          </>}
        </div>

        <div className="p-4 border-t border-zinc-100 flex items-center justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm font-semibold text-zinc-600 bg-zinc-100 rounded-lg hover:bg-zinc-200 cursor-pointer">Cancelar</button>
          {!prePago && <button onClick={lancar}
            disabled={!podeLancar || enviando || (tipo === 'bill' && !dre) || (usarMensal
              ? selPagtos.size === 0 || saldoMensal < -0.01
              : (!(tipo === 'purchase' && pago) && (parcelas.length === 0 || soma <= 0)))}
            title={!podeLancar ? 'Apenas administradores e gerentes' : undefined}
            className="px-4 py-2 text-sm font-semibold text-white bg-amber-500 rounded-lg hover:bg-amber-600 disabled:opacity-40 cursor-pointer">
            {enviando ? 'Lançando…' : usarMensal ? `Lançar e vincular ${selPagtos.size} pagamento(s)` : tipo === 'purchase' ? (pago ? 'Lançar compra paga' : `Lançar compra · ${parcelas.length} parcela(s)`) : `Lançar despesa · ${parcelas.length} parcela(s)`}
          </button>}
        </div>
      </div>
    </div>
  );
}
