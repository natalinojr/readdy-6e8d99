// Recebimentos e pagamentos (ex-"Receber mercadoria") — tela de celular da loja (2026-09-22).
// Receber: o que chegou? (nota que já está no sistema, compra lançada, cupom, sem nota)
// → conferir item a item → como foi pago (se ainda não está lançado) → confirmar.
// Toda a regra fica na Edge receber-mercadoria, que reaproveita as Edges de compra/nota/estoque.
// Pedir pagamento (2026-09-24): reembolso, freelancer e fornecedor sem nota viram pedido para o dono
// aprovar (Edge pedidos-pagamento); mercadoria paga do bolso vai pelo recebimento ("Paguei do meu bolso").
// Links: ?pedido=reembolso|freelancer|fornecedor, ?aprovar=1, ?meus=1.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { usePermissoes } from '@/hooks/usePermissoes';
import NovoPedido from './pedidos/NovoPedido';
import ListaPedidos from './pedidos/ListaPedidos';
import { chamarPedidos, comprovanteParaEnvio, ROTULO_TIPO, type ContextoPedidos, type TipoPedido } from './pedidos/api';
import Conferir from './components/Conferir';
import Pagamento, { descreverPagamento } from './components/Pagamento';
import SemNota from './components/SemNota';
import ScannerQR from './components/ScannerQR';
import JaChegaram from './components/JaChegaram';
import {
  brl, chamar, dataBR, hojeISO, lerCupom, memorizarCupom, normalizar, qtd, somaDias, un,
  type Aberto, type Insumo, type Pendente, type Resultado, type ScanResult,
} from './api';
import { deAberto, deCupom, novoSemNota, precisaPagamento, type Rascunho } from './rascunho';
import { fotoParaEnvio, isNfcePrQr, lerCodigoDaFoto, type Lido } from './leitura';

type Tela =
  | 'inicio' | 'carregando' | 'conferir' | 'pagamento' | 'resumo' | 'gravando' | 'feito'
  | 'sem_nota_pergunta' | 'sem_nota' | 'aguardando' | 'nao_achou' | 'duplicado' | 'parecidas' | 'busca' | 'digitar'
  | 'reembolso_o_que' | 'pedido' | 'pedido_ok' | 'meus' | 'aprovar';

interface CompraParecida { id: string; supplier: string; total_amount: number; purchase_date: string; delivery_confirmed_at: string | null }

interface Busca { notas: { id: string; numero: string; emitente_nome: string; valor_total: number; emitted_at: string; status: string }[]; compras: { id: string; invoice_number: string; supplier: string; total_amount: number; purchase_date: string; delivery_confirmed_at: string | null }[] }

export default function ReceberPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const tenantId = user?.tenantId ?? '';
  const { hasPermissao } = usePermissoes();
  const podeReceber = hasPermissao('estoque_receber') || hasPermissao('estoque_movimentar');
  const [params, setParams] = useSearchParams();
  const [ctxPed, setCtxPed] = useState<ContextoPedidos | null>(null);
  const [tipoPedido, setTipoPedido] = useState<TipoPedido>('reembolso');
  /** Mercadoria paga do bolso: o recebimento já abre com "Paguei do meu bolso" marcado. */
  const modoReembolso = useRef(false);
  const fotoCupom = useRef<File | null>(null);
  const [scanner, setScanner] = useState(false);

  const [tela, setTela] = useState<Tela>('inicio');
  const [msgCarregando, setMsgCarregando] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [pendentes, setPendentes] = useState<Pendente[] | null>(null);
  const [filtro, setFiltro] = useState('');
  const [aba, setAba] = useState<'esperando' | 'chegaram'>('esperando');
  const [r, setR] = useState<Rascunho | null>(null);
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [dup, setDup] = useState<{ id: string; purchase_date: string; delivery_confirmed_at?: string | null } | null>(null);
  const [busca, setBusca] = useState<Busca | null>(null);
  const [chaveNaoAchada, setChaveNaoAchada] = useState('');
  const [fornecedores, setFornecedores] = useState<{ id: string; nome: string }[]>([]);
  const [aguardando, setAguardando] = useState({ fornecedor: '', descricao: '', obs: '', ref: '' });
  const [parecidas, setParecidas] = useState<CompraParecida[]>([]);
  const [digitado, setDigitado] = useState('');
  const inputCodigo = useRef<HTMLInputElement>(null);
  const inputCupom = useRef<HTMLInputElement>(null);

  const carregarPendentes = useCallback(async () => {
    if (!tenantId || !podeReceber) return;
    const { data, erro: e } = await chamar<{ itens: Pendente[] }>('pendentes', tenantId);
    if (e) { setErro(e); setPendentes([]); return; }
    setPendentes(data?.itens ?? []);
  }, [tenantId, podeReceber]);

  const lojaAtual = useRef(tenantId);
  lojaAtual.current = tenantId;
  const carregarCtxPed = useCallback(async () => {
    if (!tenantId) return;
    const { data } = await chamarPedidos<ContextoPedidos>('contexto', tenantId);
    if (lojaAtual.current === tenantId) setCtxPed(data); // resposta atrasada de outra loja: descarta
  }, [tenantId]);

  // Troca de loja: nada do rascunho de uma loja pode ser lançado na outra
  useEffect(() => {
    setR(null); setResultado(null); setErro(null); setTela('inicio'); setPendentes(null); setCtxPed(null);
    modoReembolso.current = false;
    carregarCtxPed();
  }, [tenantId, carregarCtxPed]);
  useEffect(() => { carregarPendentes(); }, [carregarPendentes]);
  // Voltou ao início por qualquer caminho (erro de leitura inclusive): próximo recebimento é normal
  useEffect(() => { if (tela === 'inicio') modoReembolso.current = false; }, [tela]);

  // Atalhos por link (ação rápida, pendência do 📥): abre direto no pedido/lista e limpa o link
  useEffect(() => {
    const pedido = params.get('pedido');
    const alvo: Tela | null = pedido === 'reembolso' ? 'reembolso_o_que'
      : pedido === 'freelancer' || pedido === 'fornecedor' ? 'pedido'
      : params.get('aprovar') ? 'aprovar' : params.get('meus') ? 'meus' : null;
    if (!alvo) return;
    if (pedido === 'freelancer' || pedido === 'fornecedor') setTipoPedido(pedido);
    setErro(null); setR(null); setTela(alvo);
    setParams({}, { replace: true });
  }, [params, setParams]);

  const comReembolso = (x: Rascunho): Rascunho => (modoReembolso.current ? {
    ...x, pagamento: 'reembolso',
    reembolso: { nome: ctxPed?.ultimo_reembolso?.nome ?? ctxPed?.nome ?? '', pix: ctxPed?.ultimo_reembolso?.pix_chave ?? '', foto: x.origem === 'cupom' ? fotoCupom.current : null },
  } : x);

  const novoAguardando = (obs = '') => ({ fornecedor: '', descricao: '', obs, ref: crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 12)}` });

  const carregando = (msg: string) => { setErro(null); setMsgCarregando(msg); setTela('carregando'); };
  const voltarInicio = () => { setErro(null); setR(null); setTela('inicio'); modoReembolso.current = false; };
  const abrirPedido = (t: TipoPedido) => { setErro(null); setTipoPedido(t); setTela('pedido'); };
  const mudar = (patch: Partial<Rascunho>) => setR((x) => (x ? { ...x, ...patch } : x));

  // ── Abrir uma nota/compra da lista ──────────────────────────────────────────
  const abrir = async (tipo: 'nota' | 'compra', id: string) => {
    carregando('Abrindo…');
    const { data, erro: e } = await chamar<Aberto>('abrir', tenantId, { tipo, id });
    if (e || !data) { setErro(e ?? 'Não consegui abrir'); setTela('inicio'); return; }
    const novo = deAberto(data);
    if (novo.origem === 'nota' && !novo.pagInfo?.ja_definido) {
      // Só o boleto vem marcado: "dinheiro" na nota às vezes é genérico, e marcar sozinho
      // criaria sangria prevista de uma retirada que não aconteceu
      novo.pagamento = (novo.pagInfo?.parcelas ?? []).length ? 'nota' : null;
      const f = (novo.pagInfo?.formas ?? []).map((x) => x.forma).find((x) => /PIX|Cart/i.test(x));
      if (f) novo.forma = /PIX/i.test(f) ? 'PIX' : 'Cartão Débito';
    }
    setR(novo);
    setTela('conferir');
  };

  // ── Código de barras da DANFE / QR do cupom ────────────────────────────────
  const buscarCodigo = async (codigo: string) => {
    carregando('Procurando a nota…');
    const { data, erro: e } = await chamar<{ tipo: string; id?: string; chave?: string; notas?: Busca['notas']; compras?: Busca['compras'] }>('buscar', tenantId, { codigo });
    if (e || !data) { setErro(e ?? 'Não consegui procurar'); setTela('inicio'); return; }
    if (data.tipo === 'nota' && data.id) return abrir('nota', data.id);
    if (data.tipo === 'nfce') { setErro('Isso é um cupom (NFC-e). Toque em "Cupom / notinha" e tire foto do QR Code.'); setTela('inicio'); return; }
    if (data.tipo === 'nao_achou') { setChaveNaoAchada(data.chave ?? codigo); setTela('nao_achou'); return; }
    setBusca({ notas: data.notas ?? [], compras: data.compras ?? [] });
    setTela('busca');
  };

  const lerCupomQr = async (url: string) => {
    carregando('Lendo o cupom na SEFAZ…');
    try { await abrirCupom(await lerCupom(tenantId, { action: 'qrcode', url })); } catch (e) {
      // A consulta da SEFAZ-PR às vezes sai do ar (ex.: 24/09 respondia "mal formatado" até para QR válido):
      // a foto da notinha é lida por IA e não depende dela
      const msg = (e as Error).message;
      setErro(/SEFAZ/i.test(msg) ? `${msg} — a consulta da SEFAZ está com problema. Toque em "Cupom / notinha" › "Tirar foto da notinha" para lançar pela foto.` : msg);
      setTela('inicio');
    }
  };

  const onFotoCodigo = async (file: File | undefined) => {
    if (!file) return;
    carregando('Lendo o código…');
    const lido = await lerCodigoDaFoto(file).catch(() => ({ tipo: 'nada' as const }));
    if (lido.tipo === 'chave') return buscarCodigo(lido.chave);
    if (lido.tipo === 'qr' && isNfcePrQr(lido.url)) return lerCupomQr(lido.url);
    setErro('Não consegui ler o código. Tire a foto mais perto, reta e com luz — ou digite o número da nota.');
    setTela('inicio');
  };

  // Leitor ao vivo (cupom): QR da SEFAZ ou, por engano, o código da DANFE
  const onLidoAoVivo = (l: Lido) => {
    setScanner(false);
    if (l.tipo === 'qr' && isNfcePrQr(l.url)) { fotoCupom.current = null; return lerCupomQr(l.url); }
    if (l.tipo === 'chave') {
      if (!podeReceber) { setErro('Isso é uma nota fiscal (DANFE), não cupom de mercado. Peça a quem recebe mercadoria para dar entrada.'); return; }
      return buscarCodigo(l.chave);
    }
    if (l.tipo === 'qr' && /fazenda\.pr\.gov\.br/i.test(l.url)) {
      setErro('Esse link é da página da nota, não do QR. No leitor do celular, copie o link ANTES de abrir (ele tem "nfce/qrcode?p=").');
      return;
    }
    setErro('Esse QR Code não é de cupom fiscal do Paraná. Use "Tirar foto da notinha".');
  };
  const abrirLeitorCupom = () => { setErro(null); setScanner(true); };

  const onFotoCupom = async (file: File | undefined) => {
    if (!file) return;
    fotoCupom.current = file;
    carregando('Procurando o QR Code…');
    const lido = await lerCodigoDaFoto(file).catch(() => ({ tipo: 'nada' as const }));
    if (lido.tipo === 'qr' && isNfcePrQr(lido.url)) return lerCupomQr(lido.url);
    if (lido.tipo === 'chave') {
      if (!podeReceber) { setErro('Isso é uma nota fiscal (DANFE), não cupom de mercado. Peça a quem recebe mercadoria para dar entrada.'); setTela('inicio'); return; }
      return buscarCodigo(lido.chave);
    }
    carregando('Lendo a notinha (leva uns segundos)…');
    try {
      const { base64, mediaType } = await fotoParaEnvio(file);
      await abrirCupom(await lerCupom(tenantId, { action: 'scan', file_base64: base64, media_type: mediaType }));
    } catch (e) { setErro((e as Error).message); setTela('inicio'); }
  };

  const abrirCupom = async (s: ScanResult) => {
    if (!s.readable || !s.items.length) {
      setErro(s.warnings?.[0] || 'Não encontrei itens nessa foto. Tente uma foto mais nítida, reta e com boa luz.');
      setTela('inicio');
      return;
    }
    if (s.duplicate) { setDup(s.duplicate); setTela('duplicado'); return; }
    const { data, erro: e } = await chamar<{ insumos: Insumo[] }>('insumos', tenantId);
    if (e) { setErro(e); setTela('inicio'); return; }
    setR(comReembolso(deCupom(s, data?.insumos ?? [])));
    setTela('conferir');
  };

  // ── Sem nota ────────────────────────────────────────────────────────────────
  const abrirSemNota = async () => {
    carregando('Carregando insumos…');
    const [ins, forn] = await Promise.all([
      chamar<{ insumos: Insumo[] }>('insumos', tenantId),
      chamar<{ fornecedores: { id: string; nome: string }[] }>('fornecedores', tenantId),
    ]);
    if (ins.erro) { setErro(ins.erro); setTela('inicio'); return; }
    setFornecedores(forn.data?.fornecedores ?? []);
    setR(comReembolso(novoSemNota(ins.data?.insumos ?? [])));
    setTela('sem_nota');
  };

  const enviarAguardando = async () => {
    carregando('Avisando o financeiro…');
    const { erro: e } = await chamar('aguardando_nota', tenantId, aguardando);
    if (e) { setErro(e); setTela('aguardando'); return; }
    setResultado(null);
    setTela('feito');
  };

  // ── Confirmar ──────────────────────────────────────────────────────────────
  const gravar = async (forcar = false) => {
    if (!r) return;
    setErro(null);
    setTela('gravando');
    let res: Awaited<ReturnType<typeof chamar<Resultado>>>;
    if (r.origem === 'nota' || r.origem === 'compra') {
      res = await chamar<Resultado>('confirmar', tenantId, {
        tipo: r.origem, id: r.id, pagamento: r.pagamento ?? 'nota', forma: r.forma,
        recebido_em: r.recebidoEm, obs: r.obs,
        itens: r.itens.map((i) => ({ key: i.key, recebido: i.recebido, ingredient_id: i.ingredient_id, units_per_package: i.units_per_package })),
      });
    } else {
      // Paguei do meu bolso: dados do reembolso (o pedido nasce ligado à compra)
      let reembolso: Record<string, unknown> | undefined;
      if (r.pagamento === 'reembolso' && r.reembolso) {
        let comprovante: { base64: string; media_type: string } | null = null;
        try {
          if (r.reembolso.foto) comprovante = await comprovanteParaEnvio(r.reembolso.foto);
        } catch (e) { setErro((e as Error).message || 'Não consegui ler o comprovante. Escolha outro.'); setTela('pagamento'); return; }
        reembolso = { nome: r.reembolso.nome, pix_chave: r.reembolso.pix, comprovante };
      }
      res = await chamar<Resultado>('lancar', tenantId, {
        reembolso,
        origem: r.origem, fornecedor: r.fornecedor, numero: r.numero, data_compra: r.data, chave: r.chave,
        pagamento: r.pagamento, forma: r.forma, vencimento: r.vencimento, recebido_em: r.recebidoEm, obs: r.obs,
        ref: r.ref, forcar,
        itens: r.itens.map((i) => {
          // Conversão: fator escolhido na tela > embalagem lida do cupom > o purchase-write resolve
          // (kg↔g, L↔ml, fator do insumo). "Sem nota" já vem na unidade do insumo (fator 1).
          const pack = !i.fatorManual && i.scan?.pack_count && i.scan?.pack_size ? { pack_count: i.scan.pack_count, pack_size: i.scan.pack_size } : null;
          const conv = r.origem === 'sem_nota' || i.fatorManual ? { units_per_package: i.units_per_package } : pack ?? {};
          return {
            descricao: i.descricao, ingredient_id: i.ingredient_id, quantidade: i.quantidade, unidade: i.unidade,
            valor_total: i.valor_total, ...conv,
            merchandise_category_id: i.scan?.merchandise_category_id ?? null, dre_category_id: i.scan?.dre_category_id ?? null,
          };
        }),
      });
      if (!res.erro && r.origem === 'cupom' && r.supplierKey) {
        memorizarCupom(tenantId, r.supplierKey, r.itens.filter((i) => i.scan).map((i) => {
          const s = i.scan!;
          const packIgual = s.pack_count && s.pack_size && s.pack_count * s.pack_size === i.units_per_package;
          return {
            raw_description: s.raw_description, ingredient_id: i.ingredient_id, catalog_id: i.ingredient_id === s.ingredient_id ? s.catalog_id : null,
            merchandise_category_id: s.merchandise_category_id, dre_category_id: s.dre_category_id, unit_label: s.unit_label,
            pack_count: packIgual ? s.pack_count : null, pack_size: packIgual ? s.pack_size : null,
          };
        }));
      }
    }
    if (res.erro) {
      const d = res.extra?.duplicada as typeof dup;
      if (d) { setDup(d); setTela('duplicado'); return; }
      const pp = res.extra?.parecidas as CompraParecida[] | undefined;
      if (pp?.length) { setParecidas(pp); setTela('parecidas'); return; }
      setErro(res.erro);
      setTela(res.extra?.purchase_id ? 'inicio' : 'resumo');
      if (res.extra?.purchase_id) carregarPendentes();
      return;
    }
    setResultado(res.data);
    setTela('feito');
    carregarPendentes();
    if (r.pagamento === 'reembolso') carregarCtxPed();
  };

  // ── Navegação ─────────────────────────────────────────────────────────────
  const voltar = () => {
    if (tela === 'pagamento') return setTela(r?.origem === 'sem_nota' ? 'sem_nota' : 'conferir');
    if (tela === 'resumo') return setTela(r && precisaPagamento(r) ? 'pagamento' : 'conferir');
    if (tela === 'aguardando') return setTela('sem_nota_pergunta');
    if (tela === 'pedido' && tipoPedido === 'reembolso') return setTela('reembolso_o_que');
    if (tela === 'inicio') return navigate('/modulos');
    if (tela === 'gravando' || tela === 'carregando') return;
    voltarInicio();
  };
  const depoisDeConferir = () => setTela(r && precisaPagamento(r) ? 'pagamento' : 'resumo');

  const titulo: Record<Tela, string> = {
    inicio: 'Recebimentos e pagamentos', carregando: 'Recebimentos e pagamentos', conferir: 'Conferir o que chegou', pagamento: 'Pagamento',
    resumo: 'Confirmar recebimento', gravando: 'Confirmando…', feito: 'Pronto', sem_nota_pergunta: 'Chegou sem nota',
    sem_nota: 'Chegou sem nota', aguardando: 'Nota vem depois', nao_achou: 'Nota não encontrada', duplicado: 'Já lançado',
    busca: 'Resultado da busca', digitar: 'Digitar a nota', parecidas: 'Já lançado?',
    reembolso_o_que: 'Pedir reembolso', pedido: `Pedir pagamento · ${ROTULO_TIPO[tipoPedido]}`, pedido_ok: 'Pedido enviado',
    meus: 'Meus pedidos', aprovar: 'Aprovar pedidos',
  };
  const perms = ctxPed?.perms;
  const podePedir = !!perms && (perms.pag_reembolso || perms.pag_freelancer || perms.pag_fornecedor);

  const lista = useMemo(() => {
    const q = normalizar(filtro);
    const base = pendentes ?? [];
    return q ? base.filter((p) => normalizar(`${p.fornecedor} ${p.numero ?? ''}`).includes(q)) : base;
  }, [pendentes, filtro]);

  return (
    <div className="h-full flex flex-col bg-zinc-50">
      {/* Topo */}
      <div className="bg-gradient-to-br from-amber-500 to-orange-500 text-white flex-shrink-0" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
        <div className="flex items-center gap-2 px-2 h-14">
          <button onClick={voltar} className="w-11 h-11 flex items-center justify-center rounded-full active:bg-white/20 cursor-pointer" aria-label="Voltar">
            <i className="ri-arrow-left-line text-2xl" />
          </button>
          <div className="min-w-0 flex-1">
            <p className="text-base font-bold leading-tight truncate">{titulo[tela]}</p>
            <p className="text-xs text-white/80 truncate">{user?.loja}</p>
          </div>
          {tela === 'inicio' && (
            <button onClick={() => { setPendentes(null); carregarPendentes(); carregarCtxPed(); }} className="w-11 h-11 flex items-center justify-center rounded-full active:bg-white/20 cursor-pointer" aria-label="Atualizar">
              <i className="ri-refresh-line text-xl" />
            </button>
          )}
        </div>
      </div>

      <input ref={inputCodigo} type="file" accept="image/*" capture="environment" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; onFotoCodigo(f); }} />
      <input ref={inputCupom} type="file" accept="image/*,application/pdf" capture="environment" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; onFotoCupom(f); }} />

      {scanner && <ScannerQR onLido={onLidoAoVivo} onLink={(url) => onLidoAoVivo({ tipo: 'qr', url })} onFoto={() => { setScanner(false); inputCupom.current?.click(); }} onFechar={() => setScanner(false)} />}

      <div className="flex-1 overflow-y-auto">
        {erro && (
          <div className="mx-4 mt-4 bg-red-50 border border-red-200 text-red-700 rounded-2xl p-3.5 text-sm flex gap-2">
            <i className="ri-error-warning-line text-lg flex-shrink-0" />
            <p className="flex-1">{erro}</p>
            <button onClick={() => setErro(null)} className="cursor-pointer" aria-label="Fechar"><i className="ri-close-line" /></button>
          </div>
        )}

        {tela === 'inicio' && (
          <div className="px-4 pt-4 pb-10">
            {perms?.pag_aprovar && (ctxPed?.para_aprovar ?? 0) > 0 && (
              <button onClick={() => setTela('aprovar')} className="w-full mb-4 flex items-center gap-3 bg-emerald-500 text-white rounded-3xl p-4 text-left shadow-lg shadow-emerald-500/25 cursor-pointer active:scale-[0.99]">
                <i className="ri-checkbox-multiple-line text-3xl" />
                <div className="flex-1">
                  <p className="text-[15px] font-bold">{ctxPed!.para_aprovar} pedido{ctxPed!.para_aprovar > 1 ? 's' : ''} de pagamento para aprovar</p>
                  <p className="text-xs text-white/85">Reembolso, freelancer ou fornecedor sem nota</p>
                </div>
                <i className="ri-arrow-right-s-line text-2xl" />
              </button>
            )}

            {podePedir && (
              <div className="mb-6">
                <p className="text-sm font-bold text-zinc-700 px-1 mb-2">Pedir pagamento</p>
                <div className="grid grid-cols-3 gap-2.5">
                  {perms!.pag_reembolso && <BotaoPedido icone="ri-refund-2-line" titulo="Reembolso" onClick={() => { setErro(null); setTela('reembolso_o_que'); }} />}
                  {perms!.pag_freelancer && <BotaoPedido icone="ri-user-star-line" titulo="Freelancer" onClick={() => abrirPedido('freelancer')} />}
                  {perms!.pag_fornecedor && <BotaoPedido icone="ri-store-2-line" titulo="Fornecedor sem nota" onClick={() => abrirPedido('fornecedor')} />}
                </div>
                <div className="mt-2.5 flex gap-2">
                  <button onClick={() => setTela('meus')} className="flex-1 py-3 rounded-2xl bg-white border border-zinc-100 text-sm font-semibold text-zinc-700 cursor-pointer">
                    <i className="ri-list-check-2 mr-1" /> Meus pedidos
                  </button>
                  {perms!.pag_aprovar && (
                    <button onClick={() => setTela('aprovar')} className="flex-1 py-3 rounded-2xl bg-white border border-zinc-100 text-sm font-semibold text-zinc-700 cursor-pointer">
                      <i className="ri-checkbox-multiple-line mr-1" /> Aprovar
                    </button>
                  )}
                </div>
              </div>
            )}

            {!podeReceber && ctxPed && !podePedir && (
              <p className="text-center text-sm text-zinc-500 py-10">Seu perfil ainda não tem nada liberado aqui. Peça ao administrador em Configurações › Permissões.</p>
            )}

            {podeReceber && <>
            {podePedir && <p className="text-sm font-bold text-zinc-700 px-1 mb-2">Chegou mercadoria</p>}
            <div className="grid grid-cols-2 gap-3">
              <BotaoGrande cor="bg-amber-500 text-white" icone="ri-barcode-line" titulo="Ler código da nota" sub="Foto do código de barras da DANFE" onClick={() => inputCodigo.current?.click()} destaque />
              <BotaoGrande cor="bg-white text-zinc-800" icone="ri-receipt-line" titulo="Cupom / notinha" sub="Lê o QR Code do cupom de mercado" onClick={abrirLeitorCupom} />
              <BotaoGrande cor="bg-white text-zinc-800" icone="ri-inbox-unarchive-line" titulo="Chegou sem nota" sub="Lançar ou avisar o financeiro" onClick={() => setTela('sem_nota_pergunta')} />
              <BotaoGrande cor="bg-white text-zinc-800" icone="ri-keyboard-line" titulo="Digitar nº da nota" sub="Se o código não ler" onClick={() => { setDigitado(''); setTela('digitar'); }} />
            </div>

            <div className="mt-6 grid grid-cols-2 gap-1 bg-zinc-100 rounded-2xl p-1">
              {([['esperando', `Esperando chegar${pendentes ? ` (${pendentes.length})` : ''}`], ['chegaram', 'Já chegaram']] as const).map(([v, l]) => (
                <button key={v} onClick={() => setAba(v)} className={`py-2.5 rounded-xl text-sm font-semibold cursor-pointer ${aba === v ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500'}`}>{l}</button>
              ))}
            </div>
            <div className="mt-3 flex items-center gap-2 bg-white border border-zinc-100 rounded-2xl px-4">
              <i className="ri-search-line text-zinc-400" />
              <input value={filtro} onChange={(e) => setFiltro(e.target.value)} placeholder="Fornecedor ou número" className="flex-1 bg-transparent py-3 text-base outline-none" />
            </div>
            {aba === 'chegaram' ? <JaChegaram tenantId={tenantId} filtro={filtro} onErro={setErro} /> : (
            <div className="mt-3 space-y-2.5">
              {pendentes === null && <Spinner texto="Carregando…" />}
              {pendentes && lista.length === 0 && (
                <p className="text-center text-sm text-zinc-400 py-8">{filtro ? 'Nada com esse nome.' : 'Nenhuma nota ou compra esperando chegar.'}</p>
              )}
              {lista.map((p) => (
                <button key={`${p.tipo}-${p.id}`} onClick={() => abrir(p.tipo, p.id)} className="w-full text-left bg-white rounded-3xl border border-zinc-100 p-4 active:bg-zinc-50 cursor-pointer">
                  <div className="flex items-start gap-3">
                    <div className={`w-11 h-11 rounded-2xl flex items-center justify-center flex-shrink-0 ${p.tipo === 'nota' ? 'bg-sky-50 text-sky-600' : 'bg-violet-50 text-violet-600'}`}>
                      <i className={`${p.tipo === 'nota' ? 'ri-file-list-3-line' : 'ri-shopping-basket-2-line'} text-xl`} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[15px] font-bold text-zinc-800 truncate">{p.fornecedor}</p>
                      <p className="text-sm text-zinc-500">
                        {p.numero ? `NF ${p.numero} · ` : ''}{dataBR(p.data)} · {p.itens_qtd} {p.itens_qtd === 1 ? 'item' : 'itens'}
                      </p>
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        <span className={`text-[11px] font-semibold rounded-full px-2 py-0.5 ${p.tipo === 'nota' && !p.lancada ? 'bg-sky-50 text-sky-700' : 'bg-violet-50 text-violet-700'}`}>
                          {p.tipo === 'nota' ? (p.lancada ? 'Nota fiscal · lançada' : 'Nota fiscal') : 'Compra lançada'}
                        </span>
                        {p.pagamento && <span className="text-[11px] font-semibold rounded-full px-2 py-0.5 bg-zinc-100 text-zinc-600">{p.pagamento}</span>}
                      </div>
                    </div>
                    <p className="text-[15px] font-bold text-zinc-800 whitespace-nowrap">{brl(p.valor)}</p>
                  </div>
                </button>
              ))}
            </div>
            )}
            </>}
          </div>
        )}

        {tela === 'reembolso_o_que' && (
          <div className="px-4 pt-6 space-y-3">
            <p className="text-xl font-bold text-zinc-900 px-1">O que você comprou?</p>
            <p className="text-sm text-zinc-500 px-1 mb-2">Mercadoria entra no estoque e no custo (CMV); o resto vira despesa.</p>
            <BotaoGrande cor="bg-white text-zinc-800" icone="ri-receipt-line" titulo="Mercadoria com cupom" sub="Insumo, bebida, embalagem — foto do cupom do mercado"
              onClick={() => { modoReembolso.current = true; abrirLeitorCupom(); }} largo />
            <BotaoGrande cor="bg-white text-zinc-800" icone="ri-inbox-unarchive-line" titulo="Mercadoria sem cupom" sub="Digito o que comprei e anexo a foto do recibo"
              onClick={() => { modoReembolso.current = true; abrirSemNota(); }} largo />
            <BotaoGrande cor="bg-white text-zinc-800" icone="ri-tools-line" titulo="Outra coisa" sub="Limpeza, manutenção, material, transporte…" onClick={() => abrirPedido('reembolso')} largo />
          </div>
        )}

        {tela === 'pedido' && (ctxPed
          ? <NovoPedido key={tipoPedido} tipo={tipoPedido} tenantId={tenantId} contexto={ctxPed} onErro={setErro} onEnviado={() => { setTela('pedido_ok'); carregarCtxPed(); }} />
          : <Spinner texto="Carregando…" grande />)}

        {tela === 'pedido_ok' && (
          <div className="px-4 pt-10 pb-10 text-center">
            <div className="w-20 h-20 mx-auto rounded-full bg-emerald-100 flex items-center justify-center">
              <i className="ri-send-plane-line text-4xl text-emerald-600" />
            </div>
            <p className="text-2xl font-black text-zinc-900 mt-5">Pedido enviado</p>
            <p className="text-sm text-zinc-500 mt-2">O financeiro vai aprovar. Acompanhe em "Meus pedidos".</p>
            <div className="mt-8 space-y-3">
              <button onClick={() => setTela('meus')} className="w-full py-4 rounded-2xl bg-amber-500 text-white font-bold cursor-pointer">Ver meus pedidos</button>
              <button onClick={voltarInicio} className="w-full py-4 rounded-2xl border-2 border-zinc-200 text-zinc-700 font-bold cursor-pointer">Voltar</button>
            </div>
          </div>
        )}

        {(tela === 'meus' || tela === 'aprovar') && (
          <ListaPedidos key={tela} modo={tela} tenantId={tenantId} onErro={setErro} onMudou={carregarCtxPed} />
        )}

        {(tela === 'carregando' || tela === 'gravando') && <Spinner texto={tela === 'gravando' ? 'Confirmando o recebimento…' : msgCarregando} grande />}

        {tela === 'digitar' && (
          <div className="px-4 pt-6 space-y-4">
            <p className="text-sm text-zinc-600 px-1">Digite o <b>número da nota</b> (está no alto da DANFE, "Nº") ou a <b>chave de acesso</b> inteira (44 números).</p>
            <input
              autoFocus inputMode="numeric" value={digitado} onChange={(e) => setDigitado(e.target.value.replace(/[^0-9 ]/g, ''))}
              placeholder="Ex.: 3902" className="w-full bg-white border-2 border-zinc-100 focus:border-amber-400 rounded-2xl px-4 py-4 text-xl font-semibold tracking-wide outline-none"
            />
            <BotaoPrincipal onClick={() => buscarCodigo(digitado)} disabled={!digitado.replace(/\D/g, '')}>Procurar</BotaoPrincipal>
          </div>
        )}

        {tela === 'busca' && busca && (
          <div className="px-4 pt-4 space-y-2.5">
            {busca.notas.length + busca.compras.length === 0 && (
              <div className="text-center py-10">
                <p className="text-zinc-600 font-semibold">Nenhuma nota com esse número.</p>
                <p className="text-sm text-zinc-400 mt-1">Ela pode ainda não ter chegado da SEFAZ.</p>
                <button onClick={() => { setAguardando(novoAguardando()); setTela('aguardando'); }} className="mt-5 px-5 py-3 rounded-2xl bg-amber-500 text-white font-bold cursor-pointer">
                  Avisar o financeiro
                </button>
              </div>
            )}
            {busca.notas.map((n) => (
              <ItemBusca key={n.id} titulo={n.emitente_nome} sub={`NF ${n.numero} · ${dataBR(n.emitted_at)} · ${brl(n.valor_total)}`}
                aviso={n.status === 'imported' ? 'Já lançada' : null} onClick={() => abrir('nota', n.id)} />
            ))}
            {busca.compras.map((c) => (
              <ItemBusca key={c.id} titulo={c.supplier} sub={`NF ${c.invoice_number} · ${dataBR(c.purchase_date)} · ${brl(c.total_amount)}`}
                aviso={c.delivery_confirmed_at ? `Já recebida em ${dataBR(c.delivery_confirmed_at)}` : null}
                onClick={c.delivery_confirmed_at ? undefined : () => abrir('compra', c.id)} />
            ))}
          </div>
        )}

        {tela === 'nao_achou' && (
          <div className="px-4 pt-8 text-center">
            <div className="w-16 h-16 mx-auto rounded-full bg-amber-100 flex items-center justify-center"><i className="ri-file-search-line text-3xl text-amber-600" /></div>
            <p className="text-lg font-bold text-zinc-800 mt-4">Essa nota ainda não está no sistema</p>
            <p className="text-sm text-zinc-500 mt-2">Às vezes a SEFAZ demora para mandar. Também pode ser nota emitida para outro CNPJ.</p>
            <p className="text-xs text-zinc-400 mt-3 break-all">Chave {chaveNaoAchada}</p>
            <div className="mt-6 space-y-3">
              <BotaoPrincipal onClick={() => buscarCodigo(chaveNaoAchada)}>Procurar de novo</BotaoPrincipal>
              <button
                onClick={() => { setAguardando(novoAguardando(`Chave ${chaveNaoAchada}`)); setTela('aguardando'); }}
                className="w-full py-4 rounded-2xl border-2 border-zinc-200 text-zinc-700 font-bold cursor-pointer"
              >
                Avisar o financeiro e receber depois
              </button>
            </div>
          </div>
        )}

        {tela === 'duplicado' && dup && (
          <div className="px-4 pt-8 text-center">
            <div className="w-16 h-16 mx-auto rounded-full bg-violet-100 flex items-center justify-center"><i className="ri-file-copy-2-line text-3xl text-violet-600" /></div>
            <p className="text-lg font-bold text-zinc-800 mt-4">Isso já foi lançado</p>
            <p className="text-sm text-zinc-500 mt-2">Lançado em {dataBR(dup.purchase_date)} (pode ter vindo pelo grupo do WhatsApp).</p>
            <div className="mt-6 space-y-3">
              {pendentes?.some((p) => p.tipo === 'compra' && p.id === dup.id) || dup.delivery_confirmed_at === null ? (
                <BotaoPrincipal onClick={() => abrir('compra', dup.id)}>Confirmar o recebimento dela</BotaoPrincipal>
              ) : (
                <p className="text-sm text-emerald-700 font-semibold">Se o recebimento já foi confirmado, não precisa fazer nada.</p>
              )}
              <button onClick={voltarInicio} className="w-full py-4 rounded-2xl border-2 border-zinc-200 text-zinc-700 font-bold cursor-pointer">Voltar</button>
            </div>
          </div>
        )}

        {tela === 'sem_nota_pergunta' && (
          <div className="px-4 pt-6 space-y-3">
            <p className="text-xl font-bold text-zinc-900 px-1">Vai vir nota fiscal depois?</p>
            <p className="text-sm text-zinc-500 px-1 mb-2">Se o fornecedor vai emitir a nota, não lance agora — senão entra duas vezes.</p>
            <BotaoGrande cor="bg-white text-zinc-800" icone="ri-time-line" titulo="Sim, a nota vem depois" sub="Só aviso o financeiro. Recebo quando a nota aparecer aqui." onClick={() => { setAguardando(novoAguardando()); setTela('aguardando'); }} largo />
            <BotaoGrande cor="bg-white text-zinc-800" icone="ri-edit-box-line" titulo="Não, não vai ter nota" sub="Lanço agora o que chegou e quanto custou." onClick={abrirSemNota} largo />
          </div>
        )}

        {tela === 'aguardando' && (
          <div className="px-4 pt-4 space-y-4 pb-10">
            <Campo label="Fornecedor" valor={aguardando.fornecedor} onValor={(v) => setAguardando((a) => ({ ...a, fornecedor: v }))} placeholder="Quem entregou?" />
            <Campo label="O que chegou" valor={aguardando.descricao} onValor={(v) => setAguardando((a) => ({ ...a, descricao: v }))} placeholder="Ex.: 3 cx de mussarela, 2 fardos de refri" multilinha />
            <Campo label="Observação (opcional)" valor={aguardando.obs} onValor={(v) => setAguardando((a) => ({ ...a, obs: v }))} placeholder="Ex.: entregador disse que a nota vai por e-mail" multilinha />
            <p className="text-xs text-zinc-500 px-1">O estoque só entra quando a nota aparecer em "Esperando chegar" e você confirmar.</p>
            <BotaoPrincipal onClick={enviarAguardando} disabled={!aguardando.fornecedor.trim() || !aguardando.descricao.trim()}>Avisar o financeiro</BotaoPrincipal>
          </div>
        )}

        {tela === 'sem_nota' && r && <SemNota r={r} fornecedores={fornecedores} onMudar={mudar} onContinuar={() => setTela('pagamento')} />}
        {tela === 'conferir' && r && <Conferir r={r} onItens={(itens) => mudar({ itens })} onContinuar={depoisDeConferir} />}
        {tela === 'pagamento' && r && (
          <Pagamento r={r} onMudar={mudar} onContinuar={() => setTela('resumo')} soReembolso={!podeReceber}
            reembolso={perms?.pag_reembolso ? { nome: ctxPed?.ultimo_reembolso?.nome ?? ctxPed?.nome ?? '', pix: ctxPed?.ultimo_reembolso?.pix_chave ?? '' } : null} />
        )}

        {tela === 'resumo' && r && <Resumo r={r} onMudar={mudar} onConfirmar={() => gravar()} />}

        {tela === 'parecidas' && (
          <div className="px-4 pt-6 space-y-3">
            <p className="text-xl font-bold text-zinc-900 px-1">Isso já não foi lançado?</p>
            <p className="text-sm text-zinc-500 px-1">Achei compra com o mesmo valor nesses dias (pode ter vindo pelo grupo do WhatsApp).</p>
            {parecidas.map((c) => (
              <ItemBusca key={c.id} titulo={c.supplier} sub={`${dataBR(c.purchase_date)} · ${brl(c.total_amount)}`}
                aviso={c.delivery_confirmed_at ? `Já recebida em ${dataBR(c.delivery_confirmed_at)} — se for a mesma, não precisa fazer nada.` : 'Se for a mesma, toque aqui para só confirmar o recebimento dela'}
                onClick={c.delivery_confirmed_at ? undefined : () => abrir('compra', c.id)} />
            ))}
            <button onClick={() => gravar(true)} className="w-full py-4 rounded-2xl border-2 border-zinc-200 text-zinc-700 font-bold cursor-pointer">
              Não, é outra compra — lançar
            </button>
            <button onClick={voltarInicio} className="w-full py-3 text-sm text-zinc-500 cursor-pointer">Cancelar</button>
          </div>
        )}

        {tela === 'feito' && (
          <Feito resultado={resultado} r={r} onOutra={() => { setResultado(null); voltarInicio(); }} onSair={() => navigate('/modulos')} />
        )}
      </div>
    </div>
  );
}

// ── Peças ─────────────────────────────────────────────────────────────────────
function BotaoPedido({ icone, titulo, onClick }: { icone: string; titulo: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="bg-white border border-zinc-100 rounded-3xl p-3 min-h-[92px] flex flex-col items-start justify-between text-left active:scale-[0.98] transition-transform cursor-pointer">
      <i className={`${icone} text-2xl text-emerald-600`} />
      <p className="text-[13px] font-bold text-zinc-800 leading-tight">{titulo}</p>
    </button>
  );
}

function BotaoGrande({ cor, icone, titulo, sub, onClick, destaque, largo }: { cor: string; icone: string; titulo: string; sub: string; onClick: () => void; destaque?: boolean; largo?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={`${cor} ${largo ? 'w-full flex items-center gap-4 text-left' : 'flex flex-col items-start text-left'} rounded-3xl p-4 border ${destaque ? 'border-transparent shadow-lg shadow-amber-500/30' : 'border-zinc-100'} active:scale-[0.98] transition-transform cursor-pointer min-h-[120px]`}
    >
      <i className={`${icone} text-3xl ${destaque ? '' : 'text-amber-500'}`} />
      <div className={largo ? '' : 'mt-auto pt-3'}>
        <p className="text-[15px] font-bold leading-tight">{titulo}</p>
        <p className={`text-xs mt-1 leading-snug ${destaque ? 'text-white/85' : 'text-zinc-500'}`}>{sub}</p>
      </div>
    </button>
  );
}

function BotaoPrincipal({ children, onClick, disabled }: { children: ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled} className="w-full py-4 rounded-2xl bg-amber-500 active:bg-amber-600 disabled:bg-zinc-200 disabled:text-zinc-400 text-white text-base font-bold cursor-pointer">
      {children}
    </button>
  );
}

function Spinner({ texto, grande }: { texto: string; grande?: boolean }) {
  return (
    <div className={`flex flex-col items-center justify-center gap-3 ${grande ? 'py-32' : 'py-10'}`}>
      <div className="w-9 h-9 border-[3px] border-amber-500 border-t-transparent rounded-full animate-spin" />
      <p className="text-sm text-zinc-500">{texto}</p>
    </div>
  );
}

function ItemBusca({ titulo, sub, aviso, onClick }: { titulo: string; sub: string; aviso: string | null; onClick?: () => void }) {
  return (
    <button onClick={onClick} disabled={!onClick} className="w-full text-left bg-white rounded-3xl border border-zinc-100 p-4 disabled:opacity-60 cursor-pointer">
      <p className="text-[15px] font-bold text-zinc-800">{titulo}</p>
      <p className="text-sm text-zinc-500">{sub}</p>
      {aviso && <p className="text-xs font-semibold text-violet-700 mt-1">{aviso}</p>}
    </button>
  );
}

function Campo({ label, valor, onValor, placeholder, multilinha }: { label: string; valor: string; onValor: (v: string) => void; placeholder?: string; multilinha?: boolean }) {
  const cls = 'mt-1.5 w-full bg-white border-2 border-zinc-100 focus:border-amber-400 rounded-2xl px-4 py-3.5 text-base outline-none';
  return (
    <div>
      <label className="text-sm font-semibold text-zinc-700 px-1">{label}</label>
      {multilinha
        ? <textarea rows={3} value={valor} onChange={(e) => onValor(e.target.value)} placeholder={placeholder} className={cls} />
        : <input value={valor} onChange={(e) => onValor(e.target.value)} placeholder={placeholder} className={cls} />}
    </div>
  );
}

function Resumo({ r, onMudar, onConfirmar }: { r: Rascunho; onMudar: (p: Partial<Rascunho>) => void; onConfirmar: () => void }) {
  const hoje = hojeISO();
  const entram = r.itens.filter((i) => i.ingredient_id && i.recebido > 0);
  const faltas = r.itens.filter((i) => Math.abs(i.recebido - i.quantidade) > 1e-9);
  const total = r.origem === 'sem_nota' ? r.itens.reduce((t, i) => t + i.valor_total, 0) : r.valor;
  const nomeIns = (id: string | null) => r.insumos.find((i) => i.id === id);
  return (
    <div className="pb-28 px-4 pt-4 space-y-3">
      <div className="bg-white rounded-3xl border border-zinc-100 p-4 space-y-3">
        <Linha rotulo="Fornecedor" valor={r.fornecedor} />
        <Linha rotulo={r.origem === 'cupom' ? 'Cupom' : r.origem === 'sem_nota' ? 'Documento' : 'Nota'} valor={r.origem === 'sem_nota' ? 'Sem nota' : r.numero ? `Nº ${r.numero}` : '—'} />
        <Linha rotulo="Valor" valor={brl(total)} />
        <Linha rotulo="Pagamento" valor={descreverPagamento(r)} />
      </div>

      <div className="bg-white rounded-3xl border border-zinc-100 p-4">
        <p className="text-sm font-bold text-zinc-700">Entra no estoque ({entram.length} de {r.itens.length})</p>
        <div className="mt-2 space-y-1.5">
          {entram.map((i) => {
            const ins = nomeIns(i.ingredient_id);
            return <p key={i.key} className="text-sm text-zinc-600 flex justify-between gap-3"><span className="truncate">{ins?.nome}</span><span className="font-semibold text-emerald-700 whitespace-nowrap">+{qtd(i.recebido * i.units_per_package)} {un(ins?.unidade)}</span></p>;
          })}
          {entram.length === 0 && <p className="text-sm text-zinc-400">Nenhum item ligado a insumo — o estoque não muda.</p>}
        </div>
        {faltas.length > 0 && (
          <div className="mt-3 pt-3 border-t border-zinc-100">
            <p className="text-sm font-bold text-orange-700">Chegou diferente</p>
            {faltas.map((i) => <p key={i.key} className="text-sm text-orange-700">{i.descricao}: {qtd(i.recebido)} de {qtd(i.quantidade)} {i.unidade}</p>)}
            <p className="text-xs text-zinc-500 mt-1">O financeiro vai ver a diferença na compra.</p>
          </div>
        )}
      </div>

      <div className="bg-white rounded-3xl border border-zinc-100 p-4">
        <p className="text-sm font-bold text-zinc-700 mb-2">Chegou quando?</p>
        <div className="flex gap-2">
          {[{ v: hoje, l: 'Hoje' }, { v: somaDias(hoje, -1), l: 'Ontem' }].map((o) => (
            <button key={o.v} onClick={() => onMudar({ recebidoEm: o.v })} className={`px-4 py-2.5 rounded-xl text-sm font-semibold cursor-pointer ${r.recebidoEm === o.v ? 'bg-amber-500 text-white' : 'bg-zinc-100 text-zinc-600'}`}>{o.l}</button>
          ))}
          <input type="date" max={hoje} value={r.recebidoEm} onChange={(e) => e.target.value && onMudar({ recebidoEm: e.target.value })} className="flex-1 min-w-0 border border-zinc-200 rounded-xl px-3 text-sm" />
        </div>
        <p className="text-sm font-bold text-zinc-700 mt-4 mb-2">Observação (opcional)</p>
        <textarea rows={2} value={r.obs} onChange={(e) => onMudar({ obs: e.target.value })} placeholder="Ex.: caixa amassada, entregador atrasou" className="w-full border-2 border-zinc-100 focus:border-amber-400 rounded-2xl px-3 py-2.5 text-base outline-none" />
      </div>

      <div className="fixed bottom-0 inset-x-0 bg-white/95 backdrop-blur border-t border-zinc-100 px-4 pt-3" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 12px)' }}>
        <button onClick={onConfirmar} className="w-full py-4 rounded-2xl bg-emerald-500 active:bg-emerald-600 text-white text-base font-bold flex items-center justify-center gap-2 cursor-pointer">
          <i className="ri-check-double-line text-xl" /> Confirmar recebimento
        </button>
      </div>
    </div>
  );
}

function Linha({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-sm text-zinc-500">{rotulo}</span>
      <span className="text-sm font-semibold text-zinc-800 text-right">{valor}</span>
    </div>
  );
}

function Feito({ resultado, r, onOutra, onSair }: { resultado: Resultado | null; r: Rascunho | null; onOutra: () => void; onSair: () => void }) {
  const sg = resultado?.sangria;
  return (
    <div className="px-4 pt-10 pb-10 text-center">
      <div className="w-20 h-20 mx-auto rounded-full bg-emerald-100 flex items-center justify-center">
        <i className="ri-check-line text-5xl text-emerald-600" />
      </div>
      {resultado ? (
        <>
          <p className="text-2xl font-black text-zinc-900 mt-5">Recebido!</p>
          <p className="text-sm text-zinc-500 mt-1">{r?.fornecedor}{resultado.lancada_agora ? ' · compra lançada' : ''} · estoque atualizado</p>
          <div className="mt-6 space-y-3 text-left">
            {sg && sg.ok && sg.acao === 'prevista_criada' && (
              <Aviso cor="amber" icone="ri-safe-2-line">Avise quem está no caixa: tem uma <b>sangria prevista de {brl(r?.valor)}</b> para confirmar no PDV. O caixa não fecha sem ela.</Aviso>
            )}
            {sg && sg.ok && sg.acao === 'ligada_a_sangria' && (
              <Aviso cor="emerald" icone="ri-links-line">Ligado à sangria de fornecedor que já foi feita no caixa.</Aviso>
            )}
            {sg && !sg.ok && <Aviso cor="red" icone="ri-error-warning-line">A sangria não foi prevista: {sg.motivo}. Avise o financeiro.</Aviso>}
            {resultado.faltas.length > 0 && <Aviso cor="orange" icone="ri-scales-line">Chegou diferente em {resultado.faltas.length} item(ns). Ficou anotado na compra para o financeiro.</Aviso>}
            {resultado.sem_estoque > 0 && <Aviso cor="zinc" icone="ri-link-unlink">{resultado.sem_estoque} item(ns) sem insumo ligado não entraram no estoque.</Aviso>}
            {resultado.aviso && <Aviso cor="red" icone="ri-error-warning-line">{resultado.aviso}</Aviso>}
            {r?.pagamento === 'reembolso' && resultado.reembolso?.ok && <Aviso cor="emerald" icone="ri-refund-2-line">Pedido de reembolso para <b>{r.reembolso?.nome}</b> enviado ao financeiro. Acompanhe em "Meus pedidos".</Aviso>}
            {r?.pagamento === 'reembolso' && !resultado.reembolso?.ok && <Aviso cor="red" icone="ri-error-warning-line">{resultado.reembolso?.erro ?? 'O pedido de reembolso não foi criado. Avise o financeiro.'}</Aviso>}
          </div>
        </>
      ) : (
        <>
          <p className="text-2xl font-black text-zinc-900 mt-5">Financeiro avisado</p>
          <p className="text-sm text-zinc-500 mt-2">Quando a nota aparecer em "Esperando chegar", confirme o recebimento por aqui.</p>
        </>
      )}
      <div className="mt-8 space-y-3">
        <button onClick={onOutra} className="w-full py-4 rounded-2xl bg-amber-500 text-white font-bold cursor-pointer">Receber outra</button>
        <button onClick={onSair} className="w-full py-4 rounded-2xl border-2 border-zinc-200 text-zinc-700 font-bold cursor-pointer">Sair</button>
      </div>
    </div>
  );
}

function Aviso({ cor, icone, children }: { cor: 'amber' | 'emerald' | 'red' | 'orange' | 'zinc'; icone: string; children: ReactNode }) {
  const c = {
    amber: 'bg-amber-50 border-amber-200 text-amber-800', emerald: 'bg-emerald-50 border-emerald-200 text-emerald-800',
    red: 'bg-red-50 border-red-200 text-red-700', orange: 'bg-orange-50 border-orange-200 text-orange-800', zinc: 'bg-zinc-100 border-zinc-200 text-zinc-700',
  }[cor];
  return (
    <div className={`border rounded-2xl p-3.5 text-sm flex gap-2.5 ${c}`}>
      <i className={`${icone} text-lg flex-shrink-0`} />
      <p>{children}</p>
    </div>
  );
}
