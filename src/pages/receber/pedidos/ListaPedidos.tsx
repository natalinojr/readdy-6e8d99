// "Meus pedidos" (quem pediu acompanha) e "Aprovar pedidos" (dono aprova ou recusa).
// Aprovado vira conta a pagar em aberto; o Pix sai pelo caminho de sempre e a conciliação baixa.
// Compra online (2026-09-28): aprovar só autoriza; o dono abre o link, compra na conta da loja e
// registra em "Já comprei" (nº do pedido + quanto saiu). Sem conta a pagar: o custo vem da nota.
import { useCallback, useEffect, useState } from 'react';
import { brl, dataBR } from '../api';
import { ICONE_TIPO, ROTULO_TIPO, chamarPedidos, situacao, type Categoria, type Pedido } from './api';
import { Categorias, lerValor } from './ui';
import { ConferePix, ResumoLido } from './NovoPedido';
import { lerPixCopia } from './pixCopia';
import JanelaPagamento, { type AvisoPagamento } from './JanelaPagamento';
import { confirmar } from '@/components/base/Dialogos';

interface Props {
  modo: 'meus' | 'aprovar';
  tenantId: string;
  onErro: (msg: string | null) => void;
  onMudou?: () => void;
}

const dataHora = (iso: string) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

export default function ListaPedidos({ modo, tenantId, onErro, onMudou }: Props) {
  const [pedidos, setPedidos] = useState<Pedido[] | null>(null);
  const [decididos, setDecididos] = useState<Pedido[]>([]);
  const [categorias, setCategorias] = useState<Categoria[] | null>(null);
  const [janela, setJanela] = useState<AvisoPagamento | null>(null);

  const carregar = useCallback(async () => {
    if (modo === 'meus') {
      const { data, erro } = await chamarPedidos<{ pedidos: Pedido[] }>('meus', tenantId);
      if (erro) onErro(erro);
      setPedidos(data?.pedidos ?? []);
    } else {
      const { data, erro } = await chamarPedidos<{ pendentes: Pedido[]; decididos: Pedido[] }>('para_aprovar', tenantId);
      if (erro) onErro(erro);
      setPedidos(data?.pendentes ?? []);
      setDecididos(data?.decididos ?? []);
    }
  }, [modo, tenantId, onErro]);

  useEffect(() => { setPedidos(null); carregar(); }, [carregar]);
  // Sempre atualizada (dono, 2026-09-25): aprovou/pagou no computador e o celular, com a tela aberta
  // de antes, ainda mostrava "Esperando aprovação". Recarrega ao voltar para o app e a cada 30 s.
  useEffect(() => {
    const aoVoltar = () => { if (document.visibilityState === 'visible') carregar(); };
    document.addEventListener('visibilitychange', aoVoltar);
    window.addEventListener('focus', aoVoltar);
    const t = window.setInterval(aoVoltar, 30_000);
    return () => { document.removeEventListener('visibilitychange', aoVoltar); window.removeEventListener('focus', aoVoltar); window.clearInterval(t); };
  }, [carregar]);
  useEffect(() => {
    if (modo !== 'aprovar') return;
    chamarPedidos<{ categorias: Categoria[] }>('categorias', tenantId).then(({ data }) => setCategorias(data?.categorias ?? []));
  }, [modo, tenantId]);

  const depois = () => { carregar(); onMudou?.(); };
  // Erro de gravar costuma ser "já foi aprovado/recusado" em outro aparelho: mostra e recarrega.
  const erroERecarrega = useCallback((m: string | null) => { onErro(m); if (m) carregar(); }, [onErro, carregar]);

  if (pedidos === null) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-24">
        <div className="w-9 h-9 border-[3px] border-amber-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-sm text-zinc-500">Carregando…</p>
      </div>
    );
  }

  return (
    <div className="px-4 pt-4 pb-10 space-y-3">
      {modo === 'aprovar' && (
        <p className="text-sm text-zinc-500 px-1">Aprovar já pede o seu PIN e manda o Pix pelo Inter. Se preferir pagar depois, ele fica no 📥 do chat. A conciliação dá baixa pelo extrato.</p>
      )}
      {pedidos.length === 0 && (
        <p className="text-center text-sm text-zinc-400 py-10">{modo === 'meus' ? 'Você não fez pedidos nos últimos 60 dias.' : 'Nenhum pedido esperando aprovação.'}</p>
      )}
      {pedidos.map((p) => modo === 'aprovar'
        ? <CartaoAprovar key={p.id} p={p} tenantId={tenantId} categorias={categorias} onErro={erroERecarrega} onFeito={depois} onJanela={setJanela} />
        : <CartaoMeu key={p.id} p={p} tenantId={tenantId} onErro={erroERecarrega} onFeito={depois} />)}

      {modo === 'aprovar' && decididos.length > 0 && (
        <>
          <p className="text-sm font-bold text-zinc-700 px-1 pt-4">Decididos nos últimos 15 dias</p>
          {decididos.map((p) => <CartaoMeu key={p.id} p={p} tenantId={tenantId} onErro={erroERecarrega} onFeito={depois} onJanela={setJanela} mostrarQuem />)}
        </>
      )}
      {janela && <JanelaPagamento aviso={janela} onFechar={() => { setJanela(null); depois(); }} />}
    </div>
  );
}

function Cabecalho({ p, mostrarQuem }: { p: Pedido; mostrarQuem?: boolean }) {
  const s = situacao(p);
  return (
    <div className="flex items-start gap-3">
      <div className="w-11 h-11 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center flex-shrink-0">
        <i className={`${ICONE_TIPO[p.tipo]} text-xl`} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p className="text-[15px] font-bold text-zinc-800 truncate">{p.favorecido_nome}</p>
          <p className="text-[15px] font-black text-zinc-900 whitespace-nowrap">{brl(p.valor_pago ?? p.valor)}</p>
        </div>
        <p className="text-sm text-zinc-600">{p.descricao}</p>
        <p className="text-xs text-zinc-400 mt-0.5">
          {ROTULO_TIPO[p.tipo]} · {dataHora(p.created_at)}{mostrarQuem && p.solicitado_por_nome ? ` · por ${p.solicitado_por_nome}` : ''}
        </p>
        <span className={`inline-block mt-1.5 px-2 py-0.5 rounded-lg text-xs font-bold ${s.cor}`}>{s.texto}</span>
      </div>
    </div>
  );
}

function Detalhes({ p }: { p: Pedido }) {
  const linhas: [string, string][] = [];
  // Com valor por dia: uma linha por dia (dono, 2026-09-27); pedido antigo: só as datas
  if (p.dias?.length && p.valores_dia?.length === p.dias.length) p.dias.forEach((d, i) => linhas.push([`Dia ${dataBR(d).slice(0, 5)}`, brl(Number(p.valores_dia![i]))]));
  else if (p.dias?.length) linhas.push(['Dias', p.dias.map((d) => dataBR(d).slice(0, 5)).join(', ')]);
  if (p.freelancer_funcao) linhas.push(['Função', p.freelancer_funcao]);
  if (p.data_gasto) linhas.push(['Pago em', dataBR(p.data_gasto)]);
  if (p.vencimento) linhas.push(['Vence', dataBR(p.vencimento)]);
  if (p.categoria) linhas.push(['Classificação', p.categoria]);
  if (p.favorecido_doc) linhas.push(['CPF/CNPJ', p.favorecido_doc]);
  if (p.tipo === 'compra_online') {
    if (p.quantidade) linhas.push(['Quantidade', String(p.quantidade).replace('.', ',')]);
    if (p.anuncio_id) linhas.push(['Anúncio', p.anuncio_id]);
    if (p.valor_pago != null) linhas.push(['Pedido de', brl(p.valor)]);
    if (p.comprado_em) linhas.push(['Comprado', `${dataHora(p.comprado_em)}${p.comprado_por_nome ? ` · ${p.comprado_por_nome}` : ''}`]);
  }
  if (p.obs) linhas.push(['Obs.', p.obs]);
  if (!linhas.length) return null;
  return (
    <div className="mt-3 pt-3 border-t border-zinc-100 space-y-1">
      {linhas.map(([r, v]) => (
        <p key={r} className="text-sm flex justify-between gap-3"><span className="text-zinc-500">{r}</span><span className="text-zinc-800 text-right">{v}</span></p>
      ))}
    </div>
  );
}

function BotaoComprovante({ p, tenantId, onErro }: { p: Pedido; tenantId: string; onErro: (m: string | null) => void }) {
  const [abrindo, setAbrindo] = useState(false);
  const [ver, setVer] = useState<{ url: string; pdf: boolean } | null>(null);
  if (!p.tem_comprovante) return null;
  // Mostra dentro do app: abrir em aba nova tirava do app instalado e a foto vinha no tamanho original (com zoom)
  const abrir = async () => {
    setAbrindo(true);
    const { data, erro } = await chamarPedidos<{ url: string; pdf?: boolean }>('comprovante', tenantId, { id: p.id });
    setAbrindo(false);
    if (erro || !data?.url) { onErro(erro ?? 'Não consegui abrir o comprovante'); return; }
    setVer({ url: data.url, pdf: !!data.pdf });
  };
  return (
    <>
      <button type="button" onClick={abrir} className="flex-1 py-3 rounded-2xl border-2 border-zinc-200 text-zinc-700 text-sm font-bold flex items-center justify-center gap-1.5 cursor-pointer">
        <i className="ri-image-line" /> {abrindo ? 'Abrindo…' : p.tipo === 'compra_online' ? 'Ver print' : 'Comprovante'}
      </button>
      {ver && <VerComprovante url={ver.url} pdf={ver.pdf} titulo={`${p.favorecido_nome} · ${brl(p.valor)}`} onFechar={() => setVer(null)} />}
    </>
  );
}

function VerComprovante({ url, pdf, titulo, onFechar }: { url: string; pdf: boolean; titulo: string; onFechar: () => void }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onFechar(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onFechar]);
  return (
    <div className="fixed inset-0 z-[100] bg-black/90 flex flex-col" role="dialog" aria-modal="true" onClick={onFechar}>
      <div className="flex items-center gap-2 px-3 text-white flex-shrink-0" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 8px)', paddingBottom: 8 }}>
        <p className="flex-1 min-w-0 text-sm font-semibold truncate">{titulo}</p>
        <button type="button" onClick={onFechar} className="w-11 h-11 flex items-center justify-center rounded-full active:bg-white/20 cursor-pointer" aria-label="Fechar">
          <i className="ri-close-line text-2xl" />
        </button>
      </div>
      <div className="flex-1 min-h-0 flex items-center justify-center p-3" onClick={(e) => e.stopPropagation()}>
        {pdf ? (
          <div className="text-center text-white space-y-4">
            <i className="ri-file-pdf-2-line text-6xl text-red-400" />
            <p className="text-sm">O comprovante é um PDF.</p>
            <a href={url} target="_blank" rel="noreferrer" className="inline-block px-5 py-3 rounded-2xl bg-white text-zinc-800 font-bold">Abrir o PDF</a>
          </div>
        ) : (
          <img src={url} alt="Comprovante" className="max-w-full max-h-full object-contain rounded-lg" />
        )}
      </div>
    </div>
  );
}

interface ResultadoPagamento { preparado: boolean; motivo?: string; aviso?: string; pendencia_id?: string | null }

/** Depois de aprovar: Pix preparado → janela que já pede o PIN e paga ali (2026-09-25; antes era um
 *  alert mandando ao 📥). Sem preparo, avisa por quê — o texto vem do servidor (2026-09-24):
 *  "já em andamento"/"já pago" NÃO são para pagar pelo banco. */
function avisarPagamento(r: ResultadoPagamento | undefined, p: Pedido, onErro: (m: string | null) => void, onJanela: (a: AvisoPagamento) => void) {
  if (!r) return;
  if (r.preparado) onJanela({ nome: p.favorecido_nome, valor: p.valor, pendenciaId: r.pendencia_id ?? null, texto: r.aviso ?? 'O Pix está pronto no 📥 do chat do assistente: toque em Pagar e confirme com o PIN.' });
  else onErro(r.aviso ?? `O Pix não foi preparado (${r.motivo ?? 'motivo desconhecido'}). Pague pelo app do banco — a conciliação dá baixa. Ficou um aviso no 📥 do chat.`);
}

function PagarDeNovo({ p, tenantId, onErro, onJanela }: { p: Pedido; tenantId: string; onErro: (m: string | null) => void; onJanela: (a: AvisoPagamento) => void }) {
  const [indo, setIndo] = useState(false);
  const mandar = async () => {
    setIndo(true);
    onErro(null);
    const { data, erro } = await chamarPedidos<{ pagamento: ResultadoPagamento }>('preparar_pagamento', tenantId, { id: p.id });
    setIndo(false);
    if (erro) { onErro(erro); return; }
    avisarPagamento(data?.pagamento, p, onErro, onJanela);
  };
  return (
    <button type="button" onClick={mandar} disabled={indo} className="mt-3 w-full py-3 rounded-2xl bg-violet-600 active:bg-violet-700 disabled:bg-zinc-200 text-white text-sm font-bold flex items-center justify-center gap-1.5 cursor-pointer">
      <i className="ri-lock-2-line" /> {indo ? 'Preparando…' : 'Pagar agora'}
    </button>
  );
}

function Pix({ chave }: { chave: string | null }) {
  const [copiou, setCopiou] = useState(false);
  if (!chave) return null;
  return (
    <div className="mt-3 flex items-center gap-2 bg-zinc-50 rounded-2xl px-3 py-2.5">
      <i className="ri-qr-code-line text-zinc-400" />
      <p className="flex-1 min-w-0 text-sm text-zinc-700 truncate">Pix: <b>{chave}</b></p>
      <button type="button" onClick={() => { navigator.clipboard?.writeText(chave).then(() => { setCopiou(true); setTimeout(() => setCopiou(false), 1500); }).catch(() => {}); }}
        className="text-sm font-semibold text-amber-600 cursor-pointer">{copiou ? 'Copiado' : 'Copiar'}</button>
    </div>
  );
}

function AbrirLink({ p }: { p: Pedido }) {
  if (!p.link_url) return null;
  return (
    <a href={p.link_url} target="_blank" rel="noreferrer" className="mt-3 flex items-center gap-2 bg-zinc-50 rounded-2xl px-3 py-2.5 active:bg-zinc-100">
      <i className="ri-external-link-line text-zinc-400" />
      <span className="flex-1 min-w-0 text-sm text-zinc-700 truncate">Ver no <b>{p.favorecido_nome}</b></span>
      <i className="ri-arrow-right-s-line text-zinc-400" />
    </a>
  );
}

/** Depois de comprar na conta da loja: nº do pedido no site e quanto saiu (com frete). */
function JaComprei({ p, tenantId, onErro, onFeito }: { p: Pedido; tenantId: string; onErro: (m: string | null) => void; onFeito: () => void }) {
  const [aberto, setAberto] = useState(false);
  const [numero, setNumero] = useState('');
  const [valor, setValor] = useState(p.valor.toFixed(2).replace('.', ','));
  const [gravando, setGravando] = useState(false);
  const v = lerValor(valor);
  const gravar = async () => {
    setGravando(true);
    onErro(null);
    const { erro } = await chamarPedidos('comprado', tenantId, { id: p.id, pedido_externo: numero, valor_pago: v });
    setGravando(false);
    if (erro) { onErro(erro); return; }
    onFeito();
  };
  if (!aberto) {
    return (
      <button type="button" onClick={() => setAberto(true)} className="mt-3 w-full py-3 rounded-2xl bg-emerald-500 active:bg-emerald-600 text-white text-sm font-bold flex items-center justify-center gap-1.5 cursor-pointer">
        <i className="ri-shopping-bag-3-line" /> Já comprei
      </button>
    );
  }
  const campo = 'w-full border-2 border-zinc-100 focus:border-emerald-300 rounded-2xl px-3 py-2.5 text-base outline-none';
  return (
    <div className="mt-3 space-y-2 bg-emerald-50/60 rounded-2xl p-3">
      <label className="block text-xs font-semibold text-zinc-600">Nº do pedido no site (opcional)
        <input value={numero} onChange={(e) => setNumero(e.target.value)} placeholder="Ex.: 2000009876543210" className={`${campo} mt-1`} />
      </label>
      <label className="block text-xs font-semibold text-zinc-600">Quanto saiu (com frete)
        <input value={valor} inputMode="decimal" onChange={(e) => setValor(e.target.value.replace(/[^\d.,]/g, ''))} className={`${campo} mt-1 font-bold`} />
      </label>
      <div className="flex gap-2">
        <button type="button" onClick={() => setAberto(false)} className="flex-1 py-3 rounded-2xl border-2 border-zinc-200 text-zinc-600 text-sm font-bold cursor-pointer">Voltar</button>
        <button type="button" onClick={gravar} disabled={gravando || !(v > 0)} className="flex-[1.4] py-3 rounded-2xl bg-emerald-500 disabled:bg-zinc-200 text-white text-sm font-bold cursor-pointer">
          {gravando ? 'Gravando…' : 'Registrar compra'}
        </button>
      </div>
    </div>
  );
}

function CartaoMeu({ p, tenantId, onErro, onFeito, onJanela, mostrarQuem }: { p: Pedido; tenantId: string; onErro: (m: string | null) => void; onFeito: () => void; onJanela?: (a: AvisoPagamento) => void; mostrarQuem?: boolean }) {
  const [cancelando, setCancelando] = useState(false);
  const cancelar = async () => {
    if (!(await confirmar({ titulo: 'Cancelar este pedido?', confirmarLabel: 'Cancelar pedido', perigo: true }))) return;
    setCancelando(true);
    const { erro } = await chamarPedidos('cancelar', tenantId, { id: p.id });
    setCancelando(false);
    if (erro) { onErro(erro); return; }
    onFeito();
  };
  return (
    <div className="bg-white rounded-3xl border border-zinc-100 p-4">
      <Cabecalho p={p} mostrarQuem={mostrarQuem} />
      {p.status === 'recusada' && p.motivo_recusa && <p className="mt-2 text-sm text-red-700 bg-red-50 rounded-xl px-3 py-2">Motivo: {p.motivo_recusa}</p>}
      {p.status === 'aprovada' && p.decidido_por_nome && <p className="mt-2 text-xs text-zinc-500">Aprovado por {p.decidido_por_nome}{p.pago_em ? ` · pago em ${dataBR(p.pago_em)}` : ''}</p>}
      {p.tipo === 'compra_online' && p.status !== 'comprada' && p.status !== 'cancelada' && p.status !== 'recusada' && <AbrirLink p={p} />}
      {p.tipo === 'compra_online' && p.compra_detalhe && mostrarQuem && <div className="mt-3"><ResumoLido l={p.compra_detalhe} /></div>}
      {p.tipo === 'compra_online' && (p.status === 'comprada' || mostrarQuem) && <Detalhes p={p} />}
      {p.tipo === 'compra_online' && mostrarQuem && p.tem_comprovante && <div className="mt-3 flex"><BotaoComprovante p={p} tenantId={tenantId} onErro={onErro} /></div>}
      {mostrarQuem && onJanela && p.tipo === 'compra_online' && !p.pix_copia_e_cola && p.status === 'aprovada' && <JaComprei p={p} tenantId={tenantId} onErro={onErro} onFeito={onFeito} />}
      {mostrarQuem && onJanela && (p.tipo !== 'compra_online' || !!p.pix_copia_e_cola) && p.status === 'aprovada' && !p.pago && (!p.pix_inter || p.pix_inter === 'recusado') && <PagarDeNovo p={p} tenantId={tenantId} onErro={onErro} onJanela={onJanela} />}
      {!mostrarQuem && p.status === 'pendente' && !p.purchase_id && (
        <button type="button" onClick={cancelar} disabled={cancelando} className="mt-3 w-full py-3 rounded-2xl border-2 border-zinc-200 text-zinc-600 text-sm font-bold cursor-pointer">
          {cancelando ? 'Cancelando…' : 'Cancelar pedido'}
        </button>
      )}
    </div>
  );
}

function CartaoAprovar({ p, tenantId, categorias, onErro, onFeito, onJanela }: { p: Pedido; tenantId: string; categorias: Categoria[] | null; onErro: (m: string | null) => void; onFeito: () => void; onJanela: (a: AvisoPagamento) => void }) {
  const [dre, setDre] = useState<string | null>(p.dre_category_id);
  const [recusando, setRecusando] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [gravando, setGravando] = useState(false);
  const compra = p.tipo === 'compra_online';
  // Compra online com Pix (2026-09-28): o dono classifica — Despesa (categoria do DRE) ou CMV (categoria de mercadoria)
  const comPix = compra && !!p.pix_copia_e_cola;
  const [classe, setClasse] = useState<'despesa' | 'cmv' | null>(null);
  const [catMerc, setCatMerc] = useState<Categoria[] | null>(null);
  const [catId, setCatId] = useState<string | null>(null);
  useEffect(() => {
    if (classe !== 'cmv' || catMerc) return;
    chamarPedidos<{ categorias: Categoria[] }>('categorias_mercadoria', tenantId).then(({ data, erro }) => { if (erro) onErro(erro); setCatMerc(data?.categorias ?? []); });
  }, [classe, catMerc, tenantId, onErro]);
  const pixDoPedido = comPix ? lerPixCopia(p.pix_copia_e_cola!) : null;
  const precisaDre = !compra && p.tipo !== 'freelancer' && !p.purchase_id;

  const aprovar = async () => {
    if (precisaDre && !dre) { onErro('Escolha a classificação antes de aprovar'); return; }
    if (comPix && (!classe || !catId)) { onErro(classe ? 'Escolha a categoria' : 'Escolha se é Despesa ou CMV'); return; }
    setGravando(true);
    onErro(null);
    const { data, erro } = await chamarPedidos<{ pagamento?: ResultadoPagamento }>('aprovar', tenantId, {
      id: p.id, dre_category_id: precisaDre ? dre : null, ...(comPix ? { classe, categoria_id: catId } : {}),
    });
    setGravando(false);
    if (erro) { onErro(erro); return; }
    // Compra online sem Pix (pedido antigo): o cartão vai para "Decididos" com "Já comprei"
    if (!compra || comPix) avisarPagamento(data?.pagamento, p, onErro, onJanela);
    onFeito();
  };
  const recusar = async () => {
    setGravando(true);
    onErro(null);
    const { erro } = await chamarPedidos('recusar', tenantId, { id: p.id, motivo });
    setGravando(false);
    if (erro) { onErro(erro); return; }
    onFeito();
  };

  return (
    <div className="bg-white rounded-3xl border-2 border-amber-200 p-4">
      <Cabecalho p={p} mostrarQuem />
      <Detalhes p={p} />
      {!compra && <Pix chave={p.pix_chave} />}
      {compra && p.compra_detalhe && <div className="mt-3"><ResumoLido l={p.compra_detalhe} /></div>}
      {pixDoPedido && <ConferePix pix={pixDoPedido} total={p.compra_detalhe?.total ?? null} />}
      {comPix && p.pix_liberado === false && (
        <p className="mt-2 text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">A chave <b>{p.pix_chave}</b> ainda não está nos Pix permitidos: o Inter vai recusar. Cadastre uma vez em Assistente › Configurações › Pix permitidos (com o seu PIN) e aprove.</p>
      )}
      {compra && <AbrirLink p={p} />}
      {compra && !comPix && <p className="mt-3 text-xs text-sky-800 bg-sky-50 rounded-xl px-3 py-2">Autorizar não cria conta a pagar. Compre na conta da loja (CNPJ) e toque em "Já comprei"; a nota do vendedor entra sozinha e vira a compra.</p>}
      {comPix && (
        <div className="mt-3 space-y-2">
          <p className="text-sm font-semibold text-zinc-700 px-1">Classificação</p>
          <div className="grid grid-cols-2 gap-2">
            {([['despesa', 'Despesa', 'Utensílio, manutenção, limpeza…'], ['cmv', 'CMV', 'Mercadoria, insumo, embalagem']] as const).map(([v, t, d]) => (
              <button key={v} type="button" onClick={() => { setClasse(v); setCatId(null); }}
                className={`text-left rounded-2xl border-2 px-3 py-2.5 cursor-pointer ${classe === v ? 'border-amber-400 bg-amber-50' : 'border-zinc-100 bg-white'}`}>
                <p className="text-sm font-bold text-zinc-800">{t}</p>
                <p className="text-[11px] text-zinc-500 leading-tight">{d}</p>
              </button>
            ))}
          </div>
          {classe === 'despesa' && <Categorias categorias={categorias} valor={catId} onValor={setCatId} titulo="Categoria da despesa" />}
          {classe === 'cmv' && <Categorias categorias={catMerc} valor={catId} onValor={setCatId} titulo="Categoria da mercadoria" />}
          <p className="text-xs text-zinc-500 px-1">Aprovar lança a compra (aparece em "Esperando chegar") e prepara o Pix pelo Inter com o seu PIN. A nota do vendedor, se chegar, é ignorada.</p>
        </div>
      )}
      {p.purchase_id && <p className="mt-3 text-xs text-violet-700 bg-violet-50 rounded-xl px-3 py-2">Mercadoria: a compra já foi lançada e entrou no estoque, sem conta a pagar. Aprovar cria a conta do reembolso; recusar deixa a compra sem conta (ajuste em Financeiro › Compras se precisar).</p>}
      {precisaDre && (
        <div className="mt-3">
          <Categorias categorias={categorias} valor={dre} onValor={setDre} />
        </div>
      )}
      {recusando ? (
        <div className="mt-3 space-y-2">
          <textarea rows={2} autoFocus value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Motivo (a pessoa vai ver)" className="w-full border-2 border-zinc-100 focus:border-red-300 rounded-2xl px-3 py-2.5 text-base outline-none" />
          <div className="flex gap-2">
            <button type="button" onClick={() => setRecusando(false)} className="flex-1 py-3 rounded-2xl border-2 border-zinc-200 text-zinc-600 text-sm font-bold cursor-pointer">Voltar</button>
            <button type="button" onClick={recusar} disabled={gravando || motivo.trim().length < 3} className="flex-1 py-3 rounded-2xl bg-red-500 disabled:bg-zinc-200 text-white text-sm font-bold cursor-pointer">Recusar</button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex gap-2">
          <BotaoComprovante p={p} tenantId={tenantId} onErro={onErro} />
          <button type="button" onClick={() => setRecusando(true)} disabled={gravando} className="flex-1 py-3 rounded-2xl border-2 border-red-200 text-red-600 text-sm font-bold cursor-pointer">Recusar</button>
          <button type="button" onClick={aprovar} disabled={gravando} className="flex-[1.4] py-3 rounded-2xl bg-emerald-500 active:bg-emerald-600 disabled:bg-zinc-200 text-white text-sm font-bold cursor-pointer">
            {gravando ? 'Aprovando…' : compra && !comPix ? 'Autorizar compra' : 'Aprovar e pagar'}
          </button>
        </div>
      )}
    </div>
  );
}
