import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase, invokeWithAuth } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { formatChave, formatCpfCnpj, cancelMinutesLeft, CANCEL_WINDOW_MIN, type FiscalDocumentRow, type FiscalDocStatus } from '@/lib/fiscal';
import { buildZip, downloadBlob } from '@/lib/zipStore';
import { MonthNav } from '@/pages/financeiro/components/dreUi';
import {
  CartaoAcao, Chips, Faixa, MenuMais, SecaoTitulo, Vazio, Nota, brl, btn, semAcento,
  type ItemFaixa, type ItemMenu, type OpcaoChip,
} from '@/pages/estoque/components/ui/EstoqueUi';
import Folha from '@/pages/estoque/components/inicio/Folha';

// Notas fiscais (NFC-e) — layout novo (2026-10-05), mesmo desenho da aba Pedidos: frase do mês,
// "Precisa de você" com o botão que resolve (recusadas → tentar de novo; paradas → reprocessar),
// faixa de números, filtros com contagem, lista enxuta e a nota abrindo numa folha com as ações.
// Nada da tela antiga sumiu: emitir nota de um pedido, XMLs do mês e reprocessar ficam no ⋯.

const LIST_COLS = 'id, tenant_id, model, status, source_type, source_id, order_ids, order_number, environment, total_amount, customer_cpf, customer_name, serie, numero, chave, protocolo, sefaz_status_code, sefaz_message, qr_code, url_chave, error_message, attempts, emitted_at, cancelled_at, cancel_reason, printed_at, created_at, updated_at';
const TZ = 'America/Sao_Paulo';
const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

/** Mês em Brasília (antes usava o fuso do aparelho). */
function intervaloMes(ym: string): { start: string; end: string } {
  const [y, m] = ym.split('-').map(Number);
  const prox = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
  return { start: new Date(`${ym}-01T00:00:00-03:00`).toISOString(), end: new Date(`${prox}-01T00:00:00-03:00`).toISOString() };
}
const mesAtual = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ }).slice(0, 7);
const rotuloMes = (ym: string) => `${MESES[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
const quando = (iso: string | null) => (iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: TZ }) : '—');
const quandoCompleto = (iso: string | null) => (iso ? new Date(iso).toLocaleString('pt-BR', { timeZone: TZ }) : '—');
/** "P0410260048" → "#048" (sequência do dia), como na aba Pedidos. */
const pedidoCurto = (cod: string | null) => {
  const m = (cod ?? '').match(/^[A-Za-z]{0,2}\d{6}(\d+)$/);
  return m ? `#${String(Number(m[1])).padStart(3, '0')}` : (cod ?? '—');
};

type Grupo = 'todas' | 'autorizadas' | 'problema' | 'emissao' | 'canceladas';
const GRUPO_DE: Record<FiscalDocStatus, Grupo> = {
  authorized: 'autorizadas', rejected: 'problema', error: 'problema', pending: 'emissao', processing: 'emissao',
  cancelled: 'canceladas', skipped: 'canceladas',
};
const SELO: Record<FiscalDocStatus, { texto: string; cor: string }> = {
  authorized: { texto: 'Autorizada', cor: 'bg-emerald-50 text-emerald-700' },
  processing: { texto: 'Emitindo', cor: 'bg-blue-50 text-blue-600' },
  pending: { texto: 'Na fila', cor: 'bg-amber-50 text-amber-700' },
  rejected: { texto: 'Recusada', cor: 'bg-red-50 text-red-600' },
  error: { texto: 'Erro', cor: 'bg-red-50 text-red-600' },
  cancelled: { texto: 'Cancelada', cor: 'bg-zinc-100 text-zinc-500' },
  skipped: { texto: 'Não emitida', cor: 'bg-zinc-100 text-zinc-500' },
};
/** Parada em emissão: na fila/emitindo há mais de 2 min (o provedor costuma responder em segundos). */
const parada = (d: FiscalDocumentRow, agora: number) =>
  (d.status === 'pending' || d.status === 'processing') && agora - new Date(d.updated_at ?? d.created_at).getTime() > 2 * 60_000;
const motivo = (d: FiscalDocumentRow) => d.error_message || (d.sefaz_message ? `${d.sefaz_status_code ?? ''} ${d.sefaz_message}`.trim() : '');

function Selo({ d }: { d: FiscalDocumentRow }) {
  const s = SELO[d.status];
  return <span className={`inline-flex items-center text-[11px] font-bold rounded-md px-1.5 py-0.5 whitespace-nowrap ${s.cor}`}>{s.texto}</span>;
}

export default function NotasFiscaisList() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { success: toastOk, error: toastErro } = useToast();
  const [docs, setDocs] = useState<FiscalDocumentRow[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [mes, setMes] = useState(mesAtual());
  const [grupo, setGrupo] = useState<Grupo>('todas');
  const [busca, setBusca] = useState('');
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState<string | null>(null); // id ou ação em andamento
  const [aberta, setAberta] = useState<FiscalDocumentRow | null>(null);
  const [cancelando, setCancelando] = useState<FiscalDocumentRow | null>(null);
  const [justificativa, setJustificativa] = useState('');
  const [emitirAberto, setEmitirAberto] = useState(false);
  const [emitirPedido, setEmitirPedido] = useState('');
  const podeCancelar = user?.perfil === 'admin' || user?.perfil === 'gerente';
  // Relógio do prazo de cancelamento (30 min da SEFAZ) e das notas paradas
  const [agora, setAgora] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setAgora(Date.now()), 30_000); return () => clearInterval(t); }, []);

  const carregar = useCallback(async () => {
    if (!user?.tenantId) return;
    const { start, end } = intervaloMes(mes);
    const [{ data, error }, { data: fs }] = await Promise.all([
      supabase.from('fiscal_documents').select(LIST_COLS).eq('tenant_id', user.tenantId).gte('created_at', start).lt('created_at', end).order('created_at', { ascending: false }).limit(2000),
      supabase.from('fiscal_settings').select('enabled').eq('tenant_id', user.tenantId).maybeSingle(),
    ]);
    if (error) toastErro('Não consegui carregar as notas', error.message);
    else setDocs((data ?? []) as unknown as FiscalDocumentRow[]);
    setEnabled(fs ? Boolean(fs.enabled) : null);
    setCarregando(false);
  }, [user?.tenantId, mes, toastErro]);

  useEffect(() => { setCarregando(true); carregar(); }, [carregar]);

  // Tempo real: a emissão é assíncrona (a nota muda de "emitindo" para "autorizada" sozinha)
  useEffect(() => {
    if (!user?.tenantId) return;
    const ch = supabase.channel(`fiscal-docs-${user.tenantId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'fiscal_documents', filter: `tenant_id=eq.${user.tenantId}` }, () => carregar())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user?.tenantId, carregar]);

  // A folha aberta acompanha a nota atualizada
  useEffect(() => { if (aberta) setAberta(docs.find((d) => d.id === aberta.id) ?? null); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [docs]);

  const resumo = useMemo(() => {
    const aut = docs.filter((d) => d.status === 'authorized');
    return {
      autorizadas: aut.length,
      valor: aut.reduce((s, d) => s + Number(d.total_amount ?? 0), 0),
      problema: docs.filter((d) => GRUPO_DE[d.status] === 'problema'),
      emissao: docs.filter((d) => GRUPO_DE[d.status] === 'emissao'),
      paradas: docs.filter((d) => parada(d, agora)),
      canceladas: docs.filter((d) => GRUPO_DE[d.status] === 'canceladas').length,
      homologacao: docs.some((d) => d.environment === 2),
    };
  }, [docs, agora]);

  const contagem = useMemo(() => {
    const n: Record<Grupo, number> = { todas: docs.length, autorizadas: 0, problema: 0, emissao: 0, canceladas: 0 };
    docs.forEach((d) => { n[GRUPO_DE[d.status]] += 1; });
    return n;
  }, [docs]);

  const lista = useMemo(() => {
    const q = semAcento(busca).replace(/\s/g, '').replace(/^#/, '');
    return docs.filter((d) => {
      if (grupo !== 'todas' && GRUPO_DE[d.status] !== grupo) return false;
      if (!q) return true;
      return semAcento(d.order_number ?? '').includes(q)
        || pedidoCurto(d.order_number).replace('#', '').replace(/^0+/, '') === q.replace(/^0+/, '')
        || (d.chave ?? '').includes(q)
        || String(d.numero ?? '') === q
        || (d.customer_cpf ?? '').includes(q.replace(/\D/g, '') || '§')
        || semAcento(d.customer_name ?? '').includes(q);
    });
  }, [docs, grupo, busca]);

  // ── chamadas ao fiscal-write ──
  const call = async <T,>(body: Record<string, unknown>): Promise<T | null> => {
    const { data, error } = await invokeWithAuth<T & { success?: boolean; error?: string; message?: string }>('fiscal-write', { body: { tenant_id: user?.tenantId, ...body } });
    if (error) { toastErro('Erro', error.message); return null; }
    return data as T;
  };

  const tentarDeNovo = async (lista: FiscalDocumentRow[]) => {
    if (lista.length === 0) return;
    setBusy(lista.length === 1 ? lista[0].id : 'retry');
    let ok = 0; let primeiraFalha: string | null = null;
    for (const d of lista) {
      const r = await call<{ success: boolean; status: string; message?: string }>({ action: 'retry', document_id: d.id });
      if (r?.success) ok++; else if (r) primeiraFalha ??= r.message ?? r.status;
    }
    setBusy(null);
    if (!primeiraFalha) toastOk(ok === 1 ? 'Nota autorizada' : `${ok} notas autorizadas`);
    else toastErro(ok > 0 ? `${ok} autorizada(s), outras recusadas` : 'Não autorizada', primeiraFalha);
    carregar();
  };

  const reprocessar = async () => {
    setBusy('pending');
    const r = await call<{ success: boolean; processed: number; results: { success: boolean }[] }>({ action: 'run_pending' });
    setBusy(null);
    if (r) toastOk(r.processed === 0 ? 'Nada parado para reprocessar' : `${r.results.filter((x) => x.success).length} de ${r.processed} autorizadas`);
    carregar();
  };

  const verDanfe = async (d: FiscalDocumentRow) => {
    setBusy(d.id);
    const r = await call<{ success: boolean; pdf_base64?: string; content_type?: string; error?: string }>({ action: 'get_pdf', document_id: d.id });
    setBusy(null);
    if (!r?.success || !r.pdf_base64) { toastErro('DANFE indisponível', r?.error ?? ''); return; }
    const bin = atob(r.pdf_base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    // NFC-e: o provedor devolve o DANFE em HTML; NF-e vem em PDF.
    const type = r.content_type === 'text/html' ? 'text/html;charset=utf-8' : 'application/pdf';
    const url = URL.createObjectURL(new Blob([bytes], { type }));
    window.open(url, '_blank', 'noopener');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  const baixarXml = async (d: FiscalDocumentRow) => {
    setBusy(d.id);
    const r = await call<{ success: boolean; xml?: string | null }>({ action: 'get_xml', document_id: d.id });
    setBusy(null);
    if (!r?.xml) { toastErro('XML indisponível'); return; }
    downloadBlob(new Blob([r.xml], { type: 'application/xml' }), `NFCe-${d.chave ?? d.id}.xml`);
  };

  const baixarXmlsMes = async () => {
    if (!user?.tenantId) return;
    setBusy('zip');
    const { start, end } = intervaloMes(mes);
    const { data, error } = await supabase.from('fiscal_documents').select('chave, xml, status, numero')
      .eq('tenant_id', user.tenantId).in('status', ['authorized', 'cancelled']).not('xml', 'is', null)
      .gte('created_at', start).lt('created_at', end).limit(5000);
    setBusy(null);
    if (error) { toastErro('Não consegui juntar os XMLs', error.message); return; }
    const rows = (data ?? []) as { chave: string | null; xml: string | null; status: string; numero: number | null }[];
    if (rows.length === 0) { toastErro('Nenhum XML autorizado neste mês'); return; }
    const zip = buildZip(rows.map((r) => ({ name: `${r.status === 'cancelled' ? 'CANCELADA-' : ''}NFCe-${r.chave ?? r.numero}.xml`, content: r.xml ?? '' })));
    downloadBlob(zip, `NFCe-${mes}.zip`);
    toastOk(`${rows.length} XML(s) no arquivo`);
  };

  const imprimir = async (d: FiscalDocumentRow) => {
    setBusy(d.id);
    const r = await call<{ success: boolean; error?: string }>({ action: 'print_danfe', document_id: d.id });
    setBusy(null);
    if (r?.success) toastOk('Cupom enviado para a impressora'); else toastErro('Não foi possível imprimir', r?.error ?? '');
  };

  const confirmarCancelamento = async () => {
    if (!cancelando) return;
    setBusy(cancelando.id);
    const r = await call<{ success: boolean; error?: string }>({ action: 'cancel', document_id: cancelando.id, justificativa });
    setBusy(null);
    if (r?.success) { toastOk('Nota cancelada na SEFAZ'); setCancelando(null); setJustificativa(''); carregar(); }
    else toastErro('Cancelamento recusado', r?.error ?? '');
  };

  /** Aceita o número completo (P0410260048) ou só o final de um pedido de hoje (48). */
  const emitirManual = async () => {
    const num = emitirPedido.trim().replace(/^#/, '');
    if (!num || !user?.tenantId) return;
    setBusy('manual');
    let pedido: { id: string } | null = null;
    if (/^\d{1,4}$/.test(num)) {
      const hoje = new Date().toLocaleDateString('en-CA', { timeZone: TZ });
      const { data } = await supabase.from('orders').select('id, number').eq('tenant_id', user.tenantId)
        .gte('created_at', `${hoje}T00:00:00-03:00`).ilike('number', `%${num.padStart(3, '0')}`).order('created_at', { ascending: false }).limit(5);
      const exatos = (data ?? []).filter((o: { number: string | null }) => (o.number ?? '').match(/^[A-Za-z]{0,2}\d{6}(\d+)$/)?.[1] && Number((o.number ?? '').match(/^[A-Za-z]{0,2}\d{6}(\d+)$/)![1]) === Number(num));
      if (exatos.length === 1) pedido = exatos[0];
      else if (exatos.length > 1) { setBusy(null); toastErro('Mais de um pedido com esse número hoje', 'Digite o número completo (ex.: P0410260048).'); return; }
    } else {
      const { data } = await supabase.from('orders').select('id').eq('tenant_id', user.tenantId).eq('number', num.toUpperCase()).order('created_at', { ascending: false }).limit(1).maybeSingle();
      pedido = data;
    }
    if (!pedido) { setBusy(null); toastErro('Pedido não encontrado', /^\d{1,4}$/.test(num) ? `Nenhum pedido #${num.padStart(3, '0')} hoje. Para outro dia, digite o número completo.` : `Número ${num}`); return; }
    const r = await call<{ success: boolean; status: string; message?: string }>({ action: 'emit', source_type: 'order', source_id: pedido.id, force: true });
    setBusy(null);
    if (r?.success) { toastOk('Nota autorizada'); setEmitirPedido(''); setEmitirAberto(false); }
    else if (r) toastErro(r.status === 'skipped' ? 'Nota não emitida' : 'Não autorizada', r.message ?? r.status);
    carregar();
  };

  // ── tela ──
  const menu: ItemMenu[] = [
    { rotulo: 'Emitir nota de um pedido', icone: 'ri-file-add-line', onClick: () => setEmitirAberto(true) },
    { rotulo: 'XMLs do mês (contabilidade)', icone: 'ri-download-2-line', onClick: baixarXmlsMes },
    { rotulo: 'Reprocessar notas paradas', icone: 'ri-refresh-line', onClick: reprocessar, oculto: resumo.emissao.length === 0 },
    { rotulo: 'Configuração fiscal', icone: 'ri-settings-3-line', onClick: () => navigate('/configuracoes?tab=fiscal') },
  ];
  const ehMesAtual = mes === mesAtual();
  const nPend = (resumo.problema.length > 0 ? 1 : 0) + (resumo.paradas.length > 0 ? 1 : 0);
  const manchete = carregando
    ? `${rotuloMes(mes)}: carregando…`
    : resumo.autorizadas === 0
      ? `${rotuloMes(mes)}: nenhuma nota autorizada`
      : `${rotuloMes(mes)}: ${resumo.autorizadas} ${resumo.autorizadas === 1 ? 'nota' : 'notas'}, ${brl(resumo.valor)}`;

  const faixa: ItemFaixa[] = [
    { valor: resumo.autorizadas, rotulo: 'Autorizadas', tom: 'green', onClick: () => setGrupo('autorizadas') },
    { valor: brl(resumo.valor), rotulo: 'Valor autorizado' },
    { valor: resumo.problema.length, rotulo: 'Recusadas / erro', tom: resumo.problema.length > 0 ? 'red' : 'neutro', onClick: () => setGrupo('problema') },
    { valor: resumo.emissao.length, rotulo: 'Em emissão', tom: resumo.emissao.length > 0 ? 'amber' : 'neutro', onClick: () => setGrupo('emissao') },
    { valor: resumo.canceladas, rotulo: 'Canceladas', onClick: () => setGrupo('canceladas') },
  ];
  const chips: OpcaoChip<Grupo>[] = ([
    { id: 'todas', rotulo: 'Todas', n: contagem.todas },
    { id: 'autorizadas', rotulo: 'Autorizadas', n: contagem.autorizadas },
    { id: 'problema', rotulo: 'Recusadas', n: contagem.problema, tom: 'red' as const },
    { id: 'emissao', rotulo: 'Em emissão', n: contagem.emissao, tom: 'amber' as const },
    { id: 'canceladas', rotulo: 'Canceladas', n: contagem.canceladas },
  ] as OpcaoChip<Grupo>[]).filter((c) => c.id === 'todas' || c.id === grupo || (c.n ?? 0) > 0);

  const prazoCancelar = (d: FiscalDocumentRow) => {
    if (d.status !== 'authorized') return null;
    return cancelMinutesLeft(d.emitted_at, agora);
  };

  return (
    <div className="p-4 md:p-6 max-w-[1400px] mx-auto pb-16 space-y-4">
      {enabled === false && (
        <CartaoAcao tom="alerta" icone="ri-error-warning-line" titulo="Emissão automática desligada"
          acoes={<button className={btn('out', 'sm')} onClick={() => navigate('/configuracoes?tab=fiscal')}>Abrir configuração</button>}>
          As vendas não estão gerando NFC-e. Ligue a emissão em Configurações › Fiscal.
        </CartaoAcao>
      )}
      {enabled === null && !carregando && (
        <CartaoAcao tom="neutro" icone="ri-information-line" titulo="Módulo fiscal ainda não configurado"
          acoes={<button className={btn('out', 'sm')} onClick={() => navigate('/configuracoes?tab=fiscal')}>Configurar</button>}>
          Cadastre o token do Brasil NFe e a tributação padrão para começar a emitir NFC-e.
        </CartaoAcao>
      )}

      {/* Frase do mês + mês e ⋯ */}
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex-1 min-w-[220px]">
          <h2 className="text-[23px] lg:text-[28px] font-extrabold tracking-tight text-zinc-900 leading-tight">{manchete}</h2>
          <p className="text-[12.5px] text-zinc-500 mt-1">
            {carregando ? 'Buscando as notas do mês.'
              : nPend > 0 ? `${nPend} ${nPend === 1 ? 'coisa precisa' : 'coisas precisam'} de você. O resto está certo.`
              : docs.length > 0 ? 'Nada para resolver agora.' : 'Nenhuma nota neste mês.'}
            {resumo.homologacao && <span className="ml-1 text-amber-700 font-semibold">· há notas de homologação (teste)</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <MonthNav mes={mes} onChange={setMes} canGoNext={!ehMesAtual} />
          {!ehMesAtual && <button className={btn('ghost', 'sm')} onClick={() => setMes(mesAtual())}>Mês atual</button>}
          <MenuMais itens={menu} grande rotulo="Mais ações das notas" />
        </div>
      </div>

      {/* Precisa de você */}
      {!carregando && nPend > 0 && (
        <div>
          <SecaoTitulo titulo="Precisa de você" n={nPend} />
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {resumo.problema.length > 0 && (
              <CartaoAcao tom="alerta" icone="ri-close-circle-line"
                titulo={resumo.problema.length === 1 ? `Nota do pedido ${pedidoCurto(resumo.problema[0].order_number)} recusada` : `${resumo.problema.length} notas recusadas`}
                direita={<b className="text-[13.5px] font-extrabold whitespace-nowrap">{brl(resumo.problema.reduce((s, d) => s + Number(d.total_amount ?? 0), 0))}</b>}
                acoes={<>
                  <button className={btn('p', 'sm')} disabled={busy !== null} onClick={() => tentarDeNovo(resumo.problema)}>
                    {busy === 'retry' || (resumo.problema.length === 1 && busy === resumo.problema[0].id) ? <><i className="ri-loader-4-line animate-spin" />Tentando…</> : resumo.problema.length === 1 ? 'Tentar de novo' : `Tentar de novo as ${resumo.problema.length}`}
                  </button>
                  <button className={btn('out', 'sm')} onClick={() => (resumo.problema.length === 1 ? setAberta(resumo.problema[0]) : setGrupo('problema'))}>Ver</button>
                </>}>
                <span className="block truncate" title={motivo(resumo.problema[0])}>Motivo: {motivo(resumo.problema[0]) || 'sem mensagem do provedor'}</span>
              </CartaoAcao>
            )}
            {resumo.paradas.length > 0 && (
              <CartaoAcao tom="prop" icone="ri-time-line"
                titulo={resumo.paradas.length === 1 ? 'Uma nota parada na emissão' : `${resumo.paradas.length} notas paradas na emissão`}
                acoes={<>
                  <button className={btn('p', 'sm')} disabled={busy !== null} onClick={reprocessar}>
                    {busy === 'pending' ? <><i className="ri-loader-4-line animate-spin" />Reprocessando…</> : 'Reprocessar'}
                  </button>
                  <button className={btn('out', 'sm')} onClick={() => setGrupo('emissao')}>Ver</button>
                </>}>
                Faz mais de 2 minutos que {resumo.paradas.length === 1 ? 'ela está' : 'elas estão'} na fila do provedor.
              </CartaoAcao>
            )}
          </div>
        </div>
      )}

      <Faixa itens={faixa} className={carregando ? 'opacity-40' : ''} />

      {/* Lista */}
      <div className="pt-2 space-y-3">
        <SecaoTitulo titulo="Notas" sub={rotuloMes(mes)} />
        <div className="flex flex-col md:flex-row md:items-center gap-2">
          <Chips<Grupo> opcoes={chips} valor={grupo} onChange={setGrupo} className="flex-1" />
          <label className="flex items-center gap-2 bg-white border border-zinc-200 rounded-xl h-9 px-3 md:w-72">
            <i className="ri-search-line text-zinc-400" />
            <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Pedido, nº da nota, chave ou CPF"
              className="flex-1 min-w-0 bg-transparent outline-none text-[13px] text-zinc-800 placeholder:text-zinc-400" />
            {busca && <button onClick={() => setBusca('')} aria-label="Limpar busca" className="text-zinc-400 hover:text-zinc-600 cursor-pointer"><i className="ri-close-line" /></button>}
          </label>
        </div>

        {carregando && docs.length === 0 ? (
          <Vazio icone="ri-loader-4-line animate-spin" titulo="Carregando notas…" />
        ) : lista.length === 0 ? (
          <Vazio icone="ri-file-shield-2-line" titulo={busca ? `Nada com “${busca}” neste mês` : 'Nenhuma nota aqui'}>
            {busca ? 'Confira o número ou troque o mês.' : grupo === 'todas' ? 'As notas aparecem aqui assim que as vendas são pagas.' : 'Escolha "Todas" para ver as outras notas do mês.'}
          </Vazio>
        ) : (
          <div className="bg-white border border-zinc-200 rounded-2xl overflow-hidden">
            {/* Celular */}
            <ul className="md:hidden divide-y divide-zinc-100">
              {lista.map((d) => {
                const prazo = prazoCancelar(d);
                return (
                  <li key={d.id}>
                    <button className="w-full text-left px-4 py-3 flex gap-3 hover:bg-amber-50/40 cursor-pointer" onClick={() => setAberta(d)}>
                      <div className="flex-1 min-w-0">
                        <p className="flex items-baseline gap-1.5 min-w-0">
                          <b className="text-[15px] font-extrabold text-zinc-900">{d.numero ? `Nota ${d.numero}` : 'Sem número'}</b>
                          <span className="text-[13px] font-bold text-zinc-500 truncate" title={d.order_number ?? ''}>· {d.source_type === 'table_session' ? 'mesa' : 'pedido'} {pedidoCurto(d.order_number)}</span>
                        </p>
                        <p className="text-[12px] text-zinc-400 mt-0.5 truncate" title={motivo(d) || undefined}>
                          {quando(d.emitted_at ?? d.created_at)}{d.customer_cpf ? ` · CPF ${formatCpfCnpj(d.customer_cpf)}` : ''}
                          {GRUPO_DE[d.status] === 'problema' && motivo(d) ? ` · ${motivo(d)}` : ''}
                        </p>
                        <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                          <Selo d={d} />
                          {prazo != null && prazo > 0 && podeCancelar && <span className="text-[10.5px] font-bold text-zinc-400">cancelável {prazo} min</span>}
                          {d.environment === 2 && <span className="text-[10.5px] font-bold text-amber-700">homologação</span>}
                        </div>
                      </div>
                      <b className={`text-[14.5px] font-extrabold tabular-nums whitespace-nowrap ${d.status === 'cancelled' ? 'line-through text-zinc-400' : 'text-zinc-900'}`}>{brl(Number(d.total_amount ?? 0))}</b>
                    </button>
                  </li>
                );
              })}
            </ul>

            {/* Computador */}
            <table className="hidden md:table w-full text-[13px] table-fixed">
              <colgroup><col style={{ width: 130 }} /><col style={{ width: 170 }} /><col /><col style={{ width: 190 }} /><col style={{ width: 110 }} /></colgroup>
              <thead>
                <tr className="text-left text-[10.5px] uppercase tracking-wide font-extrabold text-zinc-400 bg-zinc-50 border-b border-zinc-200">
                  <th className="px-4 py-2.5">Nota</th><th className="px-3 py-2.5">Venda</th><th className="px-3 py-2.5">Cliente / motivo</th>
                  <th className="px-3 py-2.5">Situação</th><th className="px-4 py-2.5 text-right">Valor</th>
                </tr>
              </thead>
              <tbody>
                {lista.map((d) => {
                  const prazo = prazoCancelar(d);
                  const problema = GRUPO_DE[d.status] === 'problema';
                  return (
                    <tr key={d.id} onClick={() => setAberta(d)} className={`cursor-pointer border-b border-zinc-100 last:border-0 ${aberta?.id === d.id ? 'bg-amber-50' : 'hover:bg-amber-50/40'}`}>
                      <td className="px-4 py-2.5 align-middle">
                        <b className="font-extrabold text-zinc-900 tabular-nums">{d.numero ? `${d.numero}${d.serie ? `/${d.serie}` : ''}` : '—'}</b>
                        <span className="block text-[11px] text-zinc-400 whitespace-nowrap">{quando(d.emitted_at ?? d.created_at)}</span>
                      </td>
                      <td className="px-3 py-2.5 align-middle overflow-hidden">
                        <span className="block font-bold text-zinc-800 truncate" title={d.order_number ?? ''}>{d.source_type === 'table_session' ? 'Mesa' : 'Pedido'} {pedidoCurto(d.order_number)}</span>
                        <span className="block text-[11px] text-zinc-400 truncate" title={d.order_number ?? ''}>{d.order_number ?? ''}</span>
                      </td>
                      <td className="px-3 py-2.5 align-middle overflow-hidden">
                        {problema && motivo(d)
                          ? <span className="block truncate text-red-600" title={motivo(d)}>{motivo(d)}</span>
                          : <span className="block truncate text-zinc-600" title={d.customer_cpf ? formatCpfCnpj(d.customer_cpf) : ''}>{d.customer_cpf ? `CPF ${formatCpfCnpj(d.customer_cpf)}` : <span className="text-zinc-300">sem CPF</span>}</span>}
                      </td>
                      <td className="px-3 py-2.5 align-middle">
                        <div className="flex flex-wrap items-center gap-1">
                          <Selo d={d} />
                          {prazo != null && prazo > 0 && podeCancelar && <span className={`text-[10.5px] font-bold ${prazo <= 5 ? 'text-red-600' : 'text-zinc-400'}`}>cancelável {prazo} min</span>}
                          {d.environment === 2 && <span className="text-[10.5px] font-bold text-amber-700">homologação</span>}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 align-middle text-right">
                        <b className={`font-extrabold tabular-nums whitespace-nowrap ${d.status === 'cancelled' ? 'line-through text-zinc-400' : 'text-zinc-900'}`}>{brl(Number(d.total_amount ?? 0))}</b>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Nota aberta */}
      <Folha
        aberta={!!aberta}
        onFechar={() => setAberta(null)}
        titulo={aberta ? `${aberta.numero ? `NFC-e nº ${aberta.numero}` : 'NFC-e sem número'} · ${aberta.source_type === 'table_session' ? 'mesa' : 'pedido'} ${pedidoCurto(aberta.order_number)}` : ''}
        subtitulo={aberta ? `${quandoCompleto(aberta.emitted_at ?? aberta.created_at)} · ${brl(Number(aberta.total_amount ?? 0))}` : undefined}
        rodape={aberta && (() => {
          const d = aberta;
          const ocupada = busy === d.id;
          const prazo = prazoCancelar(d);
          if (GRUPO_DE[d.status] === 'problema' || d.status === 'pending') {
            return <button className={`${btn('p')} flex-1`} disabled={ocupada} onClick={() => tentarDeNovo([d])}>{ocupada ? 'Tentando…' : 'Tentar emitir de novo'}</button>;
          }
          return (
            <div className="flex flex-wrap gap-2 w-full">
              {d.status === 'authorized' && <button className={`${btn('out')} flex-1`} disabled={ocupada} onClick={() => verDanfe(d)}><i className="ri-file-text-line" />Ver DANFE</button>}
              {d.status === 'authorized' && <button className={`${btn('out')} flex-1`} disabled={ocupada} onClick={() => imprimir(d)}><i className="ri-printer-line" />Imprimir</button>}
              {(d.status === 'authorized' || d.status === 'cancelled') && <button className={`${btn('out')} flex-1`} disabled={ocupada} onClick={() => baixarXml(d)}><i className="ri-file-code-line" />XML</button>}
              {d.status === 'authorized' && podeCancelar && prazo !== 0 && (
                <button className={`${btn('perigo')} w-full`} disabled={ocupada} onClick={() => { setCancelando(d); setJustificativa(''); }}>
                  <i className="ri-close-circle-line" />Cancelar na SEFAZ{prazo != null ? ` · ${prazo} min` : ''}
                </button>
              )}
            </div>
          );
        })()}
      >
        {aberta && (
          <div className="space-y-3 pb-2">
            <div className="flex flex-wrap items-center gap-1.5"><Selo d={aberta} />{aberta.environment === 2 && <span className="text-[11px] font-bold text-amber-700">homologação (teste)</span>}</div>
            {GRUPO_DE[aberta.status] === 'problema' && (
              <div className="rounded-xl bg-red-50 px-3 py-2.5 text-[12.5px] text-red-700 leading-snug break-words">
                <b className="block">Por que foi recusada</b>{motivo(aberta) || 'O provedor não mandou mensagem.'}
              </div>
            )}
            <dl className="text-[13px] divide-y divide-zinc-100">
              {[
                ['Venda', `${aberta.source_type === 'table_session' ? 'Mesa' : 'Pedido'} ${aberta.order_number ?? '—'}`],
                ['Valor', brl(Number(aberta.total_amount ?? 0))],
                ['Cliente', aberta.customer_cpf ? `${aberta.customer_name ? `${aberta.customer_name} · ` : ''}CPF ${formatCpfCnpj(aberta.customer_cpf)}` : 'sem CPF na nota'],
                ['Autorizada em', aberta.emitted_at ? quandoCompleto(aberta.emitted_at) : null],
                ['Protocolo', aberta.protocolo],
                ['SEFAZ', aberta.sefaz_message ? `${aberta.sefaz_status_code ?? ''} ${aberta.sefaz_message}`.trim() : null],
                ['Cancelamento', aberta.cancel_reason ? `${aberta.cancel_reason}${aberta.cancelled_at ? ` · ${quandoCompleto(aberta.cancelled_at)}` : ''}` : null],
                ['Tentativas', String(aberta.attempts ?? 0)],
              ].filter(([, v]) => v).map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3 py-2"><dt className="text-zinc-500 flex-shrink-0">{k}</dt><dd className="text-right text-zinc-900 font-semibold break-words min-w-0">{v}</dd></div>
              ))}
              {aberta.chave && (
                <div className="py-2">
                  <dt className="text-zinc-500 flex items-center justify-between">Chave de acesso
                    <button className="text-[12px] font-extrabold text-amber-700 cursor-pointer" onClick={() => { navigator.clipboard?.writeText(aberta.chave ?? ''); toastOk('Chave copiada'); }}>copiar</button>
                  </dt>
                  <dd className="font-mono text-[12px] text-zinc-700 break-all mt-1">{formatChave(aberta.chave)}</dd>
                </div>
              )}
            </dl>
            {aberta.url_chave && <a className="text-[12.5px] font-extrabold text-amber-700 hover:underline" href={aberta.url_chave} target="_blank" rel="noreferrer"><i className="ri-external-link-line" /> Consultar na SEFAZ</a>}
            {aberta.status === 'authorized' && podeCancelar && prazoCancelar(aberta) === 0 && (
              <Nota>O prazo de cancelamento ({CANCEL_WINDOW_MIN} min após a autorização) já passou.</Nota>
            )}
          </div>
        )}
      </Folha>

      {/* Cancelar na SEFAZ */}
      <Folha aberta={!!cancelando} onFechar={() => setCancelando(null)} titulo={cancelando ? `Cancelar NFC-e nº ${cancelando.numero ?? ''}` : ''}
        subtitulo={cancelando ? (() => { const m = cancelMinutesLeft(cancelando.emitted_at, agora); return m === null ? undefined : m > 0 ? `Restam ${m} min do prazo de ${CANCEL_WINDOW_MIN} min` : 'O prazo já passou: a SEFAZ vai recusar'; })() : undefined}
        fecharNoFundo={false}
        rodape={<>
          <button className={`${btn('out')} flex-1`} onClick={() => setCancelando(null)}>Voltar</button>
          <button className={`${btn('perigo')} flex-1`} disabled={justificativa.trim().length < 15 || (cancelando ? busy === cancelando.id : false)} onClick={confirmarCancelamento}>
            {cancelando && busy === cancelando.id ? 'Cancelando…' : 'Cancelar na SEFAZ'}
          </button>
        </>}>
        <div className="space-y-2 pb-2">
          <p className="text-[12.5px] text-zinc-600 leading-snug">A venda no ERPOS não muda. Se a venda foi desfeita, faça o estorno no PDV também.</p>
          <label className="block text-[12.5px] font-bold text-zinc-700">Por que cancelar? <span className="font-normal text-zinc-400">(mínimo 15 letras)</span></label>
          <textarea className="w-full text-sm border border-zinc-200 rounded-xl px-3 py-2 focus:outline-none focus:border-amber-400" rows={3}
            value={justificativa} onChange={(e) => setJustificativa(e.target.value)} placeholder="Ex.: erro de digitação no valor da venda" />
          <p className={`text-[11px] ${justificativa.trim().length >= 15 ? 'text-emerald-600' : 'text-zinc-400'}`}>{justificativa.trim().length}/15</p>
        </div>
      </Folha>

      {/* Emitir nota de um pedido */}
      <Folha aberta={emitirAberto} onFechar={() => setEmitirAberto(false)} titulo="Emitir nota de um pedido"
        subtitulo="Para vendas que ficaram sem nota. A nota é sempre por pedido."
        rodape={<button className={`${btn('p')} flex-1`} disabled={busy !== null || !emitirPedido.trim()} onClick={emitirManual}>{busy === 'manual' ? 'Emitindo…' : 'Emitir NFC-e'}</button>}>
        <div className="space-y-2 pb-2">
          <label className="block text-[12.5px] font-bold text-zinc-700">Número do pedido</label>
          <input autoFocus className="w-full h-11 text-base border border-zinc-200 rounded-xl px-3 focus:outline-none focus:border-amber-400"
            placeholder="48 (de hoje) ou P0410260048" value={emitirPedido} onChange={(e) => setEmitirPedido(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && emitirManual()} />
          <Nota>Pedido de hoje: basta o final (48). De outro dia: o número completo. Para emitir vários de uma vez, use o filtro "Sem nota" na aba Pedidos.</Nota>
        </div>
      </Folha>
    </div>
  );
}
