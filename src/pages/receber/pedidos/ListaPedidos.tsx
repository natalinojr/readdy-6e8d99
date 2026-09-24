// "Meus pedidos" (quem pediu acompanha) e "Aprovar pedidos" (dono aprova ou recusa).
// Aprovado vira conta a pagar em aberto; o Pix sai pelo caminho de sempre e a conciliação baixa.
import { useCallback, useEffect, useState } from 'react';
import { brl, dataBR } from '../api';
import { ICONE_TIPO, ROTULO_TIPO, chamarPedidos, situacao, type Categoria, type Pedido } from './api';
import { Categorias } from './ui';

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
  useEffect(() => {
    if (modo !== 'aprovar') return;
    chamarPedidos<{ categorias: Categoria[] }>('categorias', tenantId).then(({ data }) => setCategorias(data?.categorias ?? []));
  }, [modo, tenantId]);

  const depois = () => { carregar(); onMudou?.(); };

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
        <p className="text-sm text-zinc-500 px-1">Aprovado vira conta a pagar em aberto. Faça o Pix como sempre — a conciliação dá baixa pelo extrato.</p>
      )}
      {pedidos.length === 0 && (
        <p className="text-center text-sm text-zinc-400 py-10">{modo === 'meus' ? 'Você não fez pedidos nos últimos 60 dias.' : 'Nenhum pedido esperando aprovação.'}</p>
      )}
      {pedidos.map((p) => modo === 'aprovar'
        ? <CartaoAprovar key={p.id} p={p} tenantId={tenantId} categorias={categorias} onErro={onErro} onFeito={depois} />
        : <CartaoMeu key={p.id} p={p} tenantId={tenantId} onErro={onErro} onFeito={depois} />)}

      {modo === 'aprovar' && decididos.length > 0 && (
        <>
          <p className="text-sm font-bold text-zinc-700 px-1 pt-4">Decididos nos últimos 15 dias</p>
          {decididos.map((p) => <CartaoMeu key={p.id} p={p} tenantId={tenantId} onErro={onErro} onFeito={depois} mostrarQuem />)}
        </>
      )}
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
          <p className="text-[15px] font-black text-zinc-900 whitespace-nowrap">{brl(p.valor)}</p>
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
  if (p.dias?.length) linhas.push(['Dias', p.dias.map((d) => dataBR(d).slice(0, 5)).join(', ')]);
  if (p.freelancer_funcao) linhas.push(['Função', p.freelancer_funcao]);
  if (p.data_gasto) linhas.push(['Pago em', dataBR(p.data_gasto)]);
  if (p.vencimento) linhas.push(['Vence', dataBR(p.vencimento)]);
  if (p.categoria) linhas.push(['Classificação', p.categoria]);
  if (p.favorecido_doc) linhas.push(['CPF/CNPJ', p.favorecido_doc]);
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
  if (!p.tem_comprovante) return null;
  const abrir = async () => {
    // Abre a aba antes do await: navegador de celular bloqueia pop-up aberto depois de uma espera
    const janela = window.open('', '_blank');
    setAbrindo(true);
    const { data, erro } = await chamarPedidos<{ url: string }>('comprovante', tenantId, { id: p.id });
    setAbrindo(false);
    if (erro || !data?.url) { janela?.close(); onErro(erro ?? 'Não consegui abrir o comprovante'); return; }
    if (janela) janela.location.href = data.url; else window.location.href = data.url;
  };
  return (
    <button type="button" onClick={abrir} className="flex-1 py-3 rounded-2xl border-2 border-zinc-200 text-zinc-700 text-sm font-bold flex items-center justify-center gap-1.5 cursor-pointer">
      <i className="ri-image-line" /> {abrindo ? 'Abrindo…' : 'Comprovante'}
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

function CartaoMeu({ p, tenantId, onErro, onFeito, mostrarQuem }: { p: Pedido; tenantId: string; onErro: (m: string | null) => void; onFeito: () => void; mostrarQuem?: boolean }) {
  const [cancelando, setCancelando] = useState(false);
  const cancelar = async () => {
    if (!window.confirm('Cancelar este pedido?')) return;
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
      {!mostrarQuem && p.status === 'pendente' && !p.purchase_id && (
        <button type="button" onClick={cancelar} disabled={cancelando} className="mt-3 w-full py-3 rounded-2xl border-2 border-zinc-200 text-zinc-600 text-sm font-bold cursor-pointer">
          {cancelando ? 'Cancelando…' : 'Cancelar pedido'}
        </button>
      )}
    </div>
  );
}

function CartaoAprovar({ p, tenantId, categorias, onErro, onFeito }: { p: Pedido; tenantId: string; categorias: Categoria[] | null; onErro: (m: string | null) => void; onFeito: () => void }) {
  const [dre, setDre] = useState<string | null>(p.dre_category_id);
  const [recusando, setRecusando] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [gravando, setGravando] = useState(false);
  const precisaDre = p.tipo !== 'freelancer' && !p.purchase_id;

  const aprovar = async () => {
    if (precisaDre && !dre) { onErro('Escolha a classificação antes de aprovar'); return; }
    setGravando(true);
    onErro(null);
    const { erro } = await chamarPedidos('aprovar', tenantId, { id: p.id, dre_category_id: precisaDre ? dre : null });
    setGravando(false);
    if (erro) { onErro(erro); return; }
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
      <Pix chave={p.pix_chave} />
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
            {gravando ? 'Gravando…' : 'Aprovar'}
          </button>
        </div>
      )}
    </div>
  );
}
