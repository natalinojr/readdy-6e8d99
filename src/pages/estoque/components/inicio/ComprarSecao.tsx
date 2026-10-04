import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase, invokeWithAuth } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useEstoque } from '@/contexts/EstoqueContext';
import { useToast } from '@/contexts/ToastContext';
import { usePermissoes, RECEBER_MODULO_KEYS } from '@/hooks/usePermissoes';
import { linkWhatsApp } from '@/lib/trilhaAcoes';
import {
  agruparCompras, pedidoDoInsumo, sugestaoCompra, fmtQtd, fmtPrecoUnit, fmtSugestao, dataBrasilia, rotuloUnidade,
  CHAVE_PRODUZIR, CHAVE_SEM_FORNECEDOR,
  type GrupoCompra, type InsumoSituacao, type SituacaoEstoque, type Sugestao,
} from '@/lib/estoqueRegras';
import Folha from './Folha';
import Ajuda from './Ajuda';
import { btn } from '../ui/EstoqueUi';
import { useEstoqueTela } from '../../EstoqueTela';

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const hora = (ts: string) => new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
/** Estoque negativo de insumo que entra na contagem: não dá para saber quanto pedir antes de contar. */
const conteAntes = (i: InsumoSituacao) => i.estoque < 0 && i.contaInventario;

type FolhaAberta = { tipo: 'mandar'; chave: string } | { tipo: 'tudo' } | { tipo: 'item'; id: string } | null;

export default function ComprarSecao({ situacao, extras, onReload, onIrContar, destaque, onTirarDaLista }: {
  situacao: SituacaoEstoque;
  /** Postos na lista à mão (vieram do "Vai faltar") */
  extras: Set<string>;
  onReload: () => void | Promise<void>;
  onIrContar: () => void;
  /** Insumo que acabou de entrar na lista: a linha acende */
  destaque: string | null;
  onTirarDaLista: (i: InsumoSituacao) => void;
}) {
  const { user } = useAuth();
  const toast = useToast();
  const { reloadInsumos } = useEstoque();
  const navigate = useNavigate();
  const { hasPermissao } = usePermissoes();
  const { abrirArrumar, podeConfigurar } = useEstoqueTela();
  const podeReceber = RECEBER_MODULO_KEYS.some((k) => hasPermissao(k));
  const { diasCompra } = situacao.config;
  // "Chegou?" respondido com "Ainda não": some só nesta visita ao Início (não grava nada).
  const [aindaNao, setAindaNao] = useState<Record<string, boolean>>({});
  const [fora, setFora] = useState<Record<string, boolean>>({});
  const [qtd, setQtd] = useState<Record<string, number>>({});
  const [folha, setFolha] = useState<FolhaAberta>(null);
  const [msg, setMsg] = useState('');
  const [copiado, setCopiado] = useState(false);
  const [gravando, setGravando] = useState(false);
  const [novoMinimo, setNovoMinimo] = useState('');
  const caixaTexto = useRef<HTMLTextAreaElement>(null);

  const itens = useMemo(() => situacao.insumos.filter((i) => i.abaixoMinimo || extras.has(i.id)), [situacao.insumos, extras]);
  const grupos = useMemo(() => agruparCompras(itens), [itens]);
  // Pedido mandado vale por insumo: novo no fornecedor (ou que chegou e baixou de novo) volta a pedir.
  const pedidoDe = (i: InsumoSituacao) => pedidoDoInsumo(i, situacao.pedidos);
  const porMandar = (g: GrupoCompra) => g.itens.filter((i) => !pedidoDe(i));
  const ultimoPedido = (g: GrupoCompra) => g.itens.map(pedidoDe).filter(Boolean)
    .sort((a, b) => b!.enviadoEm.localeCompare(a!.enviadoEm))[0] ?? null;

  const sugestaoDe = (i: InsumoSituacao): Sugestao => {
    const s = sugestaoCompra(i, diasCompra);
    const v = qtd[i.id];
    if (v === undefined) return s;
    return s.embalagens != null
      ? { ...s, embalagens: v, qtd: v * i.fatorCompra }
      : { ...s, qtd: v };
  };
  const ativos = (g: GrupoCompra) => porMandar(g).filter((i) => !fora[i.id] && !conteAntes(i) && sugestaoDe(i).qtd > 0);
  const totalDe = (g: GrupoCompra) => ativos(g).reduce((s, i) => s + (i.preco ? sugestaoDe(i).qtd * i.preco : 0), 0);
  // Item sem preço entra no pedido mas não soma no total: o cartão avisa quantos ficaram de fora da conta.
  const semPrecoDe = (g: GrupoCompra) => ativos(g).filter((i) => !i.preco).length;

  const mudarQtd = (i: InsumoSituacao, sinal: 1 | -1) => {
    const s = sugestaoDe(i);
    const passo = s.embalagens != null ? 1 : i.unidade === 'unit' ? 1 : i.unidade === 'g' || i.unidade === 'ml' ? 100 : 0.5;
    const atual = s.embalagens != null ? s.embalagens : s.qtd;
    setQtd((q) => ({ ...q, [i.id]: Math.max(0, Math.round((atual + sinal * passo) * 1000) / 1000) }));
  };

  // Situação do insumo em palavras (celular: linha de etiquetas; computador: coluna "Situação").
  const situacaoTxt = (i: InsumoSituacao): { t: string; c?: string } => {
    if (i.estoque < 0) return { t: `sistema ${fmtQtd(i.estoque, i.unidade)}`, c: 'text-red-600 font-bold' };
    if (i.esgotado) return { t: 'zerado', c: 'text-red-600 font-bold' };
    if (i.diasRestantes != null) return { t: `acaba em ~${Math.max(1, Math.round(i.diasRestantes))} ${Math.round(i.diasRestantes) <= 1 ? 'dia' : 'dias'}`, c: 'text-amber-700 font-bold' };
    return { t: 'abaixo do mínimo', c: 'text-amber-700 font-semibold' };
  };
  const abrirItem = (i: InsumoSituacao) => { setNovoMinimo(String(i.minimo || '')); setFolha({ tipo: 'item', id: i.id }); };
  const marcar = (i: InsumoSituacao) => {
    const off = !!fora[i.id];
    return (
      <button
        onClick={() => setFora((f) => ({ ...f, [i.id]: !f[i.id] }))}
        className={`w-[22px] h-[22px] rounded-md border-2 flex items-center justify-center flex-shrink-0 cursor-pointer ${off ? 'border-zinc-300 bg-white' : 'border-emerald-600 bg-emerald-600 text-white'}`}
        aria-label={off ? 'Incluir no pedido' : 'Tirar do pedido'}
      >
        {!off && <i className="ri-check-line text-sm" />}
      </button>
    );
  };
  const quantidade = (i: InsumoSituacao) => {
    // Pode quebrar em duas linhas no celular, em vez de empurrar a linha para fora da tela.
    if (conteAntes(i)) return <button onClick={onIrContar} title="O sistema mostra estoque negativo, então não dá para saber quanto pedir. Conte primeiro." className="text-[11px] font-bold leading-tight text-center text-red-600 bg-red-50 border border-dashed border-red-300 rounded-lg px-2 py-1.5 flex-shrink-0 max-w-[84px] cursor-pointer">conte antes</button>;
    const s = sugestaoDe(i);
    return (
      <div className={`flex items-center gap-1 flex-shrink-0 ${fora[i.id] ? 'opacity-40' : ''}`}>
        <button onClick={() => mudarQtd(i, -1)} className="w-9 h-9 rounded-lg border border-zinc-200 hover:bg-zinc-50 text-base font-bold text-zinc-600 cursor-pointer" aria-label="Menos">−</button>
        <div className="min-w-[58px] text-center leading-tight">
          {s.embalagens != null ? (
            <>
              <p className="text-[12.5px] font-extrabold text-zinc-800">{s.embalagens} {s.unidadeCompra}</p>
              <p className="text-[10.5px] text-zinc-400">{fmtQtd(s.qtd, i.unidade)}</p>
            </>
          ) : <p className="text-[12.5px] font-extrabold text-zinc-800">{fmtQtd(s.qtd, i.unidade)}</p>}
        </div>
        <button onClick={() => mudarQtd(i, 1)} className="w-9 h-9 rounded-lg border border-zinc-200 hover:bg-zinc-50 text-base font-bold text-zinc-600 cursor-pointer" aria-label="Mais">+</button>
      </div>
    );
  };

  const linhaPedido = (i: InsumoSituacao) => `• ${i.nome} — ${fmtSugestao(sugestaoDe(i), i.unidade)}`;
  const dataHoje = `${situacao.hoje.slice(8, 10)}/${situacao.hoje.slice(5, 7)}`;
  const mensagemDe = (g: GrupoCompra) => {
    const linhas = ativos(g).map(linhaPedido).join('\n');
    if (g.chave === CHAVE_PRODUZIR) return `Cozinha, precisa produzir:\n\n${linhas}\n\n(${user?.loja ?? ''}, ${dataHoje})`;
    return `Olá! Pedido da ${user?.loja ?? 'loja'} (${dataHoje}):\n\n${linhas}\n\nPode confirmar o valor e a entrega? Obrigado!`;
  };
  // "Mandar tudo": só o que tem quantidade para pedir (o − até 0 tira da lista) e o que precisa de contagem antes.
  const linhasTudo = (g: GrupoCompra) => porMandar(g)
    .filter((i) => !fora[i.id] && (conteAntes(i) || sugestaoDe(i).qtd > 0))
    .map((i) => (conteAntes(i) ? `• ${i.nome} — contar antes` : linhaPedido(i)));
  const mensagemTudo = () => `Lista de compras — ${user?.loja ?? ''} (${dataHoje})\n\n` + grupos
    .filter((g) => linhasTudo(g).length > 0)
    .map((g) => `*${g.nome}*\n${linhasTudo(g).join('\n')}`)
    .join('\n\n');

  const abrirMandar = (g: GrupoCompra) => { setMsg(mensagemDe(g)); setCopiado(false); setFolha({ tipo: 'mandar', chave: g.chave }); };
  const abrirTudo = () => { setMsg(mensagemTudo()); setCopiado(false); setFolha({ tipo: 'tudo' }); };

  const registrar = async (lista: GrupoCompra[]) => {
    // Nada com quantidade para pedir (tudo zerado ou "conte antes"): não marca pedido vazio como mandado.
    if (lista.length === 0) {
      setFolha(null);
      toast.info('Nada para marcar como mandado', 'Os itens com quantidade 0 ou “conte antes” ficam de fora.');
      return;
    }
    setGravando(true);
    try {
      for (const g of lista) {
        const { error } = await supabase.rpc('fn_estoque_registrar_pedido', {
          p_tenant_id: user!.tenantId,
          p_fornecedor: g.chave,
          p_fornecedor_nome: g.nome,
          p_itens: ativos(g).map((i) => ({ id: i.id, nome: i.nome, texto: fmtSugestao(sugestaoDe(i), i.unidade) })),
        });
        if (error) throw error;
      }
      setFolha(null);
      toast.success(lista.length > 1 ? 'Lista marcada como mandada' : 'Pedido marcado como mandado', 'Fica marcado para todos até a mercadoria chegar.');
      onReload();
    } catch (e) {
      toast.error('Não marquei o pedido como mandado', e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e));
    } finally {
      setGravando(false);
    }
  };

  // Copiar pode ser bloqueado pelo navegador: aí o texto fica selecionado para copiar à mão, e o
  // "Já mandei" aparece do mesmo jeito (senão não haveria como marcar o pedido).
  const copiar = async () => {
    try { await navigator.clipboard.writeText(msg); toast.success('Copiado', 'É só colar no WhatsApp.'); }
    catch {
      caixaTexto.current?.focus();
      caixaTexto.current?.select();
      toast.info('Texto selecionado', 'O navegador não deixou copiar sozinho: segure no texto e copie.');
    }
    setCopiado(true);
  };

  // window.open / navigator.share precisam acontecer no toque, antes de qualquer await.
  const enviar = (lista: GrupoCompra[], fone: string | null) => {
    const link = fone ? linkWhatsApp(fone, msg) : null;
    if (link) { window.open(link, '_blank'); void registrar(lista); return; }
    // Compartilhar: só marca "mandado" se a pessoa de fato compartilhou (cancelar não conta).
    if (typeof navigator.share === 'function') { navigator.share({ text: msg }).then(() => registrar(lista)).catch(() => undefined); return; }
    void copiar();
  };

  // Mesmas ações do stock-write que a aba Estoque usa (campo ausente = preservado), mas com o erro
  // de volta para a tela (o EstoqueContext só registra no console).
  const gravarInsumo = async (corpo: Record<string, unknown>) => {
    const { error } = await invokeWithAuth('stock-write', { body: { ...corpo, tenant_id: user!.tenantId } });
    if (error) throw error;
    void reloadInsumos();
  };

  const desfazer = async (id: string) => {
    const { error } = await supabase.rpc('fn_estoque_desfazer_pedido', { p_tenant_id: user!.tenantId, p_id: id });
    if (error) toast.error('Não desfiz', error.message); else onReload();
  };

  const nomeTotal = itens.length;
  const pendentesGrupos = grupos.filter((g) => porMandar(g).length > 0);
  // Grupos que de fato vão no "Mandar tudo" (com pelo menos um item de quantidade > 0).
  const gruposTudo = pendentesGrupos.filter((g) => ativos(g).length > 0);
  const grupoAberto = folha?.tipo === 'mandar' ? grupos.find((g) => g.chave === folha.chave) ?? null : null;
  const itemAberto = folha?.tipo === 'item' ? situacao.insumos.find((i) => i.id === folha.id) ?? null : null;

  return (
    <section id="inicio-comprar" className="scroll-mt-4">
      <div className="flex items-baseline gap-2 mb-2 px-0.5">
        <h2 className="text-base lg:text-lg font-extrabold text-zinc-900 flex items-center gap-1.5">Comprar
          <Ajuda titulo="Lista de compras">
            Entra aqui, sozinho, todo insumo acompanhado com estoque <b>igual ou abaixo do mínimo</b>, e também o que você pôs na lista pelo “Vai faltar”. Cada cartão é um fornecedor.
            <br /><br /><b>Quantidade</b>: o uso de {diasCompra} dias, arredondado na embalagem de compra (caixa, pacote); sem uso registrado, o bastante para ficar com 2× o mínimo; produção da cozinha, até 2× o mínimo. Ajuste no − / +.
            <br /><b>✓</b>: desmarque o que não quer pedir agora.
            <br /><b>Mandar</b>: abre o WhatsApp do fornecedor (ou compartilha) com o pedido pronto e marca “pedido mandado” para todos. O insumo sai da lista quando a mercadoria chega.
          </Ajuda>
        </h2>
        <span className={`text-xs font-bold rounded-full px-2 py-0.5 ${nomeTotal ? (pendentesGrupos.length ? 'bg-red-500 text-white' : 'bg-emerald-600 text-white') : 'bg-emerald-600 text-white'}`}>{nomeTotal}</span>
        <span className="text-xs text-zinc-400 flex-1">lista de compras · abaixo do mínimo</span>
        {pendentesGrupos.length > 1 && (
          <button onClick={abrirTudo} className="text-xs font-bold text-amber-700 hover:text-amber-800 cursor-pointer">Mandar tudo</button>
        )}
      </div>

      {grupos.length === 0 && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-4 text-center">
          <i className="ri-checkbox-circle-fill text-2xl text-emerald-600" />
          <p className="text-sm font-bold text-emerald-800 mt-1">Nada abaixo do mínimo</p>
          <p className="text-xs text-emerald-700 mt-0.5">Quando algum insumo chegar no mínimo, ele aparece aqui, no fornecedor dele.</p>
        </div>
      )}

      <div className="space-y-2.5">
        {grupos.map((g) => {
          const abertos = porMandar(g);
          const pedido = abertos.length === 0 ? ultimoPedido(g) : null;
          const jaPedidos = g.itens.filter((i) => pedidoDe(i));
          const temZerado = abertos.some((i) => i.esgotado);
          const total = totalDe(g);
          const semPreco = semPrecoDe(g);
          const produzir = g.chave === CHAVE_PRODUZIR;
          const semForn = g.chave === CHAVE_SEM_FORNECEDOR;
          // Pedido mandado há mais de 1 dia e a mercadoria ainda sem entrada: pergunta "Chegou?" (não vale para a cozinha).
          const horasDoPedido = pedido ? (Date.now() - new Date(pedido.enviadoEm).getTime()) / 3600000 : 0;
          const perguntarChegou = !!pedido && !produzir && podeReceber && horasDoPedido > 24 && !aindaNao[g.chave];
          const barra = pedido ? 'bg-emerald-500' : temZerado ? 'bg-red-500' : 'bg-amber-400';
          return (
            <div key={g.chave} className="relative bg-white border border-zinc-200 rounded-2xl pl-4 pr-3 py-3 lg:pl-5 lg:pr-4 lg:py-3.5 overflow-hidden">
              <span className={`absolute left-0 top-0 bottom-0 w-1 ${barra}`} />
              <div className="flex items-center gap-2 mb-1">
                <p className="text-sm font-extrabold text-zinc-900 truncate flex-1 min-w-0">{g.nome}</p>
                {produzir ? <span className="text-[10px] font-bold uppercase tracking-wide bg-sky-50 text-sky-700 rounded-md px-1.5 py-0.5">cozinha</span>
                  : g.fone ? <span className="text-[10px] font-bold uppercase tracking-wide bg-emerald-50 text-emerald-700 rounded-md px-1.5 py-0.5">WhatsApp</span>
                  : g.chave !== CHAVE_SEM_FORNECEDOR ? <span className="text-[10px] font-bold uppercase tracking-wide bg-zinc-100 text-zinc-500 rounded-md px-1.5 py-0.5">sem telefone</span> : null}
                {!pedido && (total > 0 || semPreco > 0) && (
                  <span className="text-right leading-tight whitespace-nowrap flex-shrink-0">
                    {total > 0 && <span className="block text-sm font-extrabold text-zinc-800 tabular-nums">{brl(total)}</span>}
                    {semPreco > 0 && (
                      <span title="O valor soma só os itens que têm preço cadastrado" className="block text-[10.5px] font-semibold text-amber-700">
                        {total > 0 ? '+ ' : ''}{semPreco} sem preço
                      </span>
                    )}
                  </span>
                )}
                {!pedido && (
                  <button
                    onClick={() => abrirMandar(g)}
                    disabled={ativos(g).length === 0}
                    className={`hidden lg:flex ml-2 h-9 px-3.5 rounded-xl text-[13px] font-bold items-center gap-1.5 cursor-pointer disabled:opacity-40 whitespace-nowrap ${g.fone ? 'bg-[#1FA855] hover:bg-[#1a9049] text-white' : 'bg-amber-500 hover:bg-amber-600 text-zinc-900'}`}
                  >
                    <i className={produzir ? 'ri-restaurant-line' : g.fone ? 'ri-whatsapp-line' : 'ri-share-forward-line'} />
                    {produzir ? 'Avisar a cozinha' : g.fone ? 'Mandar pelo WhatsApp' : 'Compartilhar pedido'}{jaPedidos.length > 0 ? ` (${ativos(g).length})` : ''}
                  </button>
                )}
              </div>

              {pedido ? (
                <div>
                  <p className="text-xs font-bold text-emerald-700 flex items-center gap-1.5 mt-1">
                    <i className="ri-check-double-line" />
                    {produzir ? 'Cozinha avisada' : 'Pedido mandado'} {dataBrasilia(pedido.enviadoEm) === situacao.hoje ? 'hoje' : `em ${dataBrasilia(pedido.enviadoEm).slice(8, 10)}/${dataBrasilia(pedido.enviadoEm).slice(5, 7)}`} às {hora(pedido.enviadoEm)}
                    {pedido.enviadoPorNome ? ` · ${pedido.enviadoPorNome.split(' ')[0]}` : ''}
                  </p>
                  <p className="text-[11px] text-zinc-500 mt-1 leading-snug">
                    {g.itens.map((i) => i.nome).join(', ')}. Sai da lista quando a mercadoria chegar.
                  </p>
                  <div className="flex gap-3 mt-1.5">
                    <button onClick={() => abrirMandar(g)} className="text-[11px] font-bold text-amber-700 cursor-pointer">Mandar de novo</button>
                    <button onClick={() => desfazer(pedido.id)} className="text-[11px] font-semibold text-zinc-400 underline cursor-pointer">desfazer</button>
                  </div>
                  {perguntarChegou && (
                    <div className="mt-2.5 pt-2.5 border-t border-emerald-100">
                      <p className="text-[12.5px] text-zinc-600 leading-snug">
                        <b className="text-zinc-900">Chegou?</b> Faz {Math.floor(horasDoPedido / 24)} {Math.floor(horasDoPedido / 24) === 1 ? 'dia' : 'dias'} que o pedido foi mandado e a mercadoria ainda não deu entrada.
                      </p>
                      <div className="flex gap-2 flex-wrap mt-2">
                        <button onClick={() => navigate('/receber')} className={`${btn('dark', 'sm')} !min-h-[38px]`}>
                          <i className="ri-truck-line" />Receber mercadoria
                        </button>
                        <button onClick={() => setAindaNao((a) => ({ ...a, [g.chave]: true }))} className={`${btn('out', 'sm')} !min-h-[38px]`}>Ainda não</button>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <>
                  {semForn && (
                    <p className="text-[12px] text-zinc-500 leading-snug mb-1">
                      {podeConfigurar
                        ? 'Para pedir direto, diga quem vende. Escolher aqui já vale para os próximos pedidos.'
                        : 'Para pedir direto, falta o fornecedor: o Supervisor escolhe o fornecedor de cada insumo. Enquanto isso, dá para compartilhar o pedido.'}
                    </p>
                  )}
                  {jaPedidos.length > 0 && (
                    <p className="text-[11px] font-semibold text-emerald-700 mt-0.5 mb-1 leading-snug">
                      <i className="ri-check-double-line" /> Já pedido: {jaPedidos.map((i) => i.nome).join(', ')}. Abaixo, o que ainda falta pedir.{' '}
                      <Ajuda titulo="Já pedido">Esses insumos estão num pedido marcado como mandado. Saem da lista quando a mercadoria chegar (entrada no estoque). Se foi engano, use “desfazer”.</Ajuda>
                      {(() => { const p = ultimoPedido(g); return p ? <button onClick={() => desfazer(p.id)} className="ml-1.5 font-semibold text-zinc-400 underline cursor-pointer">desfazer</button> : null; })()}
                    </p>
                  )}
                  {/* Celular: uma linha por insumo */}
                  <div className="divide-y divide-zinc-100 lg:hidden">
                    {abertos.map((i) => {
                      const off = !!fora[i.id];
                      const tags: Array<{ t: string; c?: string }> = [situacaoTxt(i)];
                      if (!(i.estoque < 0) && !i.esgotado && i.diasRestantes == null) tags[0] = { t: `tem ${fmtQtd(i.estoque, i.unidade)}` };
                      if (i.minimo > 0) tags.push({ t: `mín. ${fmtQtd(i.minimo, i.unidade)}` });
                      return (
                        <div key={i.id} data-item={i.id} className={`py-2 transition-colors ${destaque === i.id ? 'bg-amber-100 -mx-2 px-2 rounded-xl' : ''}`}>
                          <div className="flex items-center gap-2.5">
                            {marcar(i)}
                            <button onClick={() => abrirItem(i)} className="flex-1 min-w-0 text-left cursor-pointer">
                              <p className={`text-[13.5px] font-bold truncate ${off ? 'text-zinc-400 line-through' : 'text-zinc-800'}`}>{i.nome}</p>
                              <p className="text-[11.5px] text-zinc-400 leading-snug">
                                {tags.map((t, k) => <span key={k}>{k > 0 && ' · '}<span className={t.c}>{t.t}</span></span>)}
                              </p>
                            </button>
                            {!i.abaixoMinimo && (
                              <button onClick={() => onTirarDaLista(i)} title="Posto na lista por alguém da loja. Toque para tirar." className="text-[10.5px] font-bold text-sky-700 bg-sky-50 rounded-md px-1.5 py-0.5 flex-shrink-0 cursor-pointer">na lista ✕</button>
                            )}
                            {quantidade(i)}
                          </div>
                          {semForn && podeConfigurar && (
                            <div className="pl-8 mt-1.5">
                              <button onClick={() => abrirArrumar({ filtro: 'fornecedor', insumoId: i.id })} className={`${btn('p', 'sm')} !min-h-[36px]`}>
                                <i className="ri-truck-line" />Quem vende?
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  {/* Computador: tabela */}
                  <table className="hidden lg:table table-fixed w-full text-[13px] mt-1">
                    {/* Larguras fixas: as colunas ficam alinhadas de um fornecedor para o outro. */}
                    <colgroup>
                      <col className="w-8" /><col /><col className="w-[140px]" /><col className="w-[95px]" />
                      <col className="w-[80px] hidden xl:table-column" /><col className="w-[80px] hidden xl:table-column" /><col className="w-[165px]" /><col className="w-[90px]" />
                    </colgroup>
                    <thead>
                      <tr className="text-[10.5px] uppercase tracking-wide text-zinc-400 border-b border-zinc-100">
                        <th className="w-8 py-2" />
                        <th className="text-left font-semibold py-2">Insumo</th>
                        <th className="text-left font-semibold py-2"><span className="inline-flex items-center gap-1">Situação<Ajuda titulo="Situação"><b>Zerado</b>: acabou. <b>Sistema −X</b>: o número do sistema está negativo, o que não existe; conte antes de pedir. <b>Acaba em ~N dias</b>: pelo uso dos últimos 14 dias. <b>Abaixo do mínimo</b>: ainda tem, mas já chegou no mínimo.</Ajuda></span></th>
                        <th className="text-right font-semibold py-2"><span className="inline-flex items-center gap-1">No sistema<Ajuda titulo="No sistema">Quanto o sistema calcula que tem agora: o que foi contado por último, mais o que entrou, menos o que saiu (vendas pela ficha técnica, perdas, produção).</Ajuda></span></th>
                        <th className="text-right font-semibold py-2 hidden xl:table-cell"><span className="inline-flex items-center gap-1">Mínimo<Ajuda titulo="Mínimo">Quando o estoque chega nesse número, o insumo entra sozinho na lista de compras. Clique no nome do insumo para mudar.</Ajuda></span></th>
                        <th className="text-right font-semibold py-2 hidden xl:table-cell"><span className="inline-flex items-center gap-1">Uso/dia<Ajuda titulo="Uso por dia">Média de uso por dia nos últimos 14 dias: vendas que baixam pela ficha técnica, perdas e produção. Sem ficha técnica, fica “—”.</Ajuda></span></th>
                        <th className="text-center font-semibold py-2"><span className="inline-flex items-center gap-1">Pedir<Ajuda titulo="Quanto pedir">Sugestão: o uso de {diasCompra} dias, arredondado na embalagem de compra (caixa, pacote). Sem uso registrado: o bastante para ficar com 2× o mínimo. Produção da cozinha: até 2× o mínimo. Ajuste no − / +. “Conte antes”: o número do sistema está errado, conte primeiro.</Ajuda></span></th>
                        <th className="text-right font-semibold py-2"><span className="inline-flex items-center gap-1 justify-end">Valor<Ajuda titulo="Valor">Quantidade sugerida × último preço de compra. É só uma estimativa; o fornecedor confirma o valor.</Ajuda></span></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-50">
                      {abertos.map((i) => {
                        const off = !!fora[i.id];
                        const st = situacaoTxt(i);
                        const valor = !conteAntes(i) && i.preco ? sugestaoDe(i).qtd * i.preco : 0;
                        return (
                          <tr key={i.id} data-item={i.id} className={`transition-colors ${destaque === i.id ? 'bg-amber-100' : 'hover:bg-zinc-50/70'} ${off ? 'opacity-60' : ''}`}>
                            <td className="py-1.5">{marcar(i)}</td>
                            <td className="py-1.5 pr-3">
                              <button onClick={() => abrirItem(i)} title={i.nome} className={`max-w-full truncate align-middle text-left font-bold hover:text-amber-700 cursor-pointer ${off ? 'text-zinc-400 line-through' : 'text-zinc-800'}`}>{i.nome}</button>
                              {!i.abaixoMinimo && (
                                <button onClick={() => onTirarDaLista(i)} title="Posto na lista por alguém da loja (ainda não chegou no mínimo). Clique para tirar." className="ml-1.5 text-[10.5px] font-bold text-sky-700 bg-sky-50 rounded-md px-1.5 py-0.5 cursor-pointer align-middle">na lista ✕</button>
                              )}
                              {semForn && podeConfigurar && (
                                <button onClick={() => abrirArrumar({ filtro: 'fornecedor', insumoId: i.id })} className="ml-1.5 text-[11px] font-bold text-amber-800 bg-amber-100 hover:bg-amber-200 rounded-md px-2 py-0.5 cursor-pointer align-middle whitespace-nowrap">Quem vende?</button>
                              )}
                            </td>
                            <td className={`py-1.5 pr-3 text-[12px] whitespace-nowrap ${st.c ?? 'text-zinc-500'}`}>{st.t}</td>
                            <td className={`py-1.5 pr-3 text-right tabular-nums whitespace-nowrap ${i.estoque < 0 ? 'text-red-600 font-semibold' : 'text-zinc-700'}`}>{fmtQtd(i.estoque, i.unidade)}</td>
                            <td className="py-1.5 pr-3 text-right tabular-nums whitespace-nowrap text-zinc-500 hidden xl:table-cell">{i.minimo > 0 ? fmtQtd(i.minimo, i.unidade) : '—'}</td>
                            <td className="py-1.5 pr-3 text-right tabular-nums whitespace-nowrap text-zinc-500 hidden xl:table-cell">{i.consumoDia ? fmtQtd(i.consumoDia, i.unidade) : '—'}</td>
                            <td className="py-1.5"><div className="flex justify-center">{quantidade(i)}</div></td>
                            <td className="py-1.5 text-right tabular-nums whitespace-nowrap font-semibold text-zinc-700">{valor ? brl(valor) : <span className="text-zinc-300 font-normal">—</span>}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  <button
                    onClick={() => abrirMandar(g)}
                    disabled={ativos(g).length === 0}
                    className={`lg:hidden mt-2 w-full min-h-[44px] rounded-xl text-sm font-bold flex items-center justify-center gap-2 cursor-pointer disabled:opacity-40 ${g.fone ? 'bg-[#1FA855] hover:bg-[#1a9049] text-white' : 'bg-amber-500 hover:bg-amber-600 text-zinc-900'}`}
                  >
                    <i className={produzir ? 'ri-restaurant-line' : g.fone ? 'ri-whatsapp-line' : 'ri-share-forward-line'} />
                    {produzir ? 'Avisar a cozinha' : g.fone ? 'Mandar pelo WhatsApp' : 'Compartilhar pedido'}{jaPedidos.length > 0 ? ` (${ativos(g).length})` : ''}
                  </button>
                  {abertos.some(conteAntes) && (
                    <p className="text-[11px] text-zinc-400 mt-2 leading-snug break-words">“Conte antes”: o sistema mostra um número negativo, então não dá para saber quanto pedir. Fica de fora do pedido até a contagem.</p>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>
      <p className="text-[11px] text-zinc-400 mt-2 px-0.5 leading-snug">
        Quantidade sugerida: o uso de {diasCompra} dias (ou 2× o mínimo, se o uso for pequeno ou desconhecido), arredondado na embalagem de compra. Produção da cozinha: até 2× o mínimo. Ajuste no − / +.
      </p>

      {/* Mandar um pedido / a lista toda */}
      <Folha
        aberta={folha?.tipo === 'mandar' || folha?.tipo === 'tudo'}
        titulo={folha?.tipo === 'tudo' ? 'Mandar a lista toda' : grupoAberto?.chave === CHAVE_PRODUZIR ? 'Avisar a cozinha' : `Pedido para ${grupoAberto?.nome ?? ''}`}
        subtitulo={folha?.tipo === 'tudo' ? 'Para quem faz as compras' : grupoAberto?.fone ? 'Abre a conversa com o fornecedor, com a mensagem pronta' : 'Você escolhe para quem mandar'}
        onFechar={() => setFolha(null)}
        rodape={(
          <>
            <button onClick={copiar} className="flex-1 min-h-[44px] rounded-xl border border-zinc-200 text-sm font-bold text-zinc-700 cursor-pointer">Copiar</button>
            {copiado ? (
              <button
                disabled={gravando}
                onClick={() => registrar(folha?.tipo === 'tudo' ? gruposTudo : grupoAberto ? [grupoAberto] : [])}
                className="flex-1 min-h-[44px] rounded-xl bg-zinc-900 text-white text-sm font-bold cursor-pointer disabled:opacity-50"
              >Já mandei</button>
            ) : (
              <button
                disabled={gravando}
                onClick={() => enviar(folha?.tipo === 'tudo' ? gruposTudo : grupoAberto ? [grupoAberto] : [], folha?.tipo === 'tudo' ? null : grupoAberto?.fone ?? null)}
                className={`flex-1 min-h-[44px] rounded-xl text-sm font-bold cursor-pointer disabled:opacity-50 flex items-center justify-center gap-1.5 ${folha?.tipo !== 'tudo' && grupoAberto?.fone ? 'bg-[#1FA855] text-white' : 'bg-amber-500 text-zinc-900'}`}
              >
                <i className={folha?.tipo !== 'tudo' && grupoAberto?.fone ? 'ri-whatsapp-line' : 'ri-share-forward-line'} />
                {folha?.tipo !== 'tudo' && grupoAberto?.fone ? 'Abrir o WhatsApp' : 'Compartilhar'}
              </button>
            )}
          </>
        )}
      >
        <textarea
          ref={caixaTexto}
          value={msg}
          onChange={(e) => setMsg(e.target.value)}
          className="w-full min-h-[200px] rounded-2xl border border-zinc-200 p-3 text-[13.5px] leading-relaxed text-zinc-800 focus:outline-none focus:border-amber-400"
        />
        {folha?.tipo === 'mandar' && grupoAberto && porMandar(grupoAberto).some(conteAntes) && (
          <p className="text-xs bg-red-50 text-red-800 rounded-xl px-3 py-2 mt-2">Os itens com “conte antes” ficaram de fora. Depois da contagem eles voltam com a quantidade certa.</p>
        )}
        <p className="text-xs bg-zinc-50 text-zinc-600 rounded-xl px-3 py-2 mt-2 mb-1">Depois de mandar, o cartão fica como “pedido mandado” para todo mundo da loja, até a mercadoria chegar.</p>
      </Folha>

      {/* Detalhe de um insumo da lista */}
      <Folha
        aberta={!!itemAberto}
        titulo={itemAberto?.nome ?? ''}
        subtitulo={[itemAberto?.categoria, itemAberto?.fornecedor].filter(Boolean).join(' · ') || undefined}
        onFechar={() => setFolha(null)}
        rodape={itemAberto ? (
          <>
            <button
              disabled={gravando}
              onClick={async () => {
                setGravando(true);
                try {
                  await gravarInsumo({ action: 'set_track_stock', ingredient_id: itemAberto.id, track_stock: false });
                  toast.success(`${itemAberto.nome}: avisos desligados`, 'Sai da lista e de todos os números.'); setFolha(null); onReload();
                }
                catch (e) { toast.error('Não consegui desligar', e instanceof Error ? e.message : String(e)); }
                finally { setGravando(false); }
              }}
              className="flex-1 min-h-[44px] rounded-xl border border-zinc-200 text-sm font-bold text-zinc-700 cursor-pointer disabled:opacity-50"
            >Não uso mais</button>
            <button
              disabled={gravando || !(Number(novoMinimo.replace(',', '.')) >= 0) || novoMinimo.trim() === ''}
              onClick={async () => {
                const v = Number(novoMinimo.replace(',', '.'));
                setGravando(true);
                try {
                  await gravarInsumo({ action: 'upsert_ingredient', id: itemAberto.id, name: itemAberto.nome, min_stock: v });
                  toast.success('Mínimo salvo'); setFolha(null); onReload();
                }
                catch (e) { toast.error('Não salvei o mínimo', e instanceof Error ? e.message : String(e)); }
                finally { setGravando(false); }
              }}
              className="flex-1 min-h-[44px] rounded-xl bg-amber-500 text-zinc-900 text-sm font-bold cursor-pointer disabled:opacity-50"
            >Salvar mínimo</button>
          </>
        ) : undefined}
      >
        {itemAberto && <DetalheInsumo i={itemAberto} novoMinimo={novoMinimo} setNovoMinimo={setNovoMinimo} diasCompra={diasCompra} />}
      </Folha>
    </section>
  );
}

function DetalheInsumo({ i, novoMinimo, setNovoMinimo, diasCompra }: {
  i: InsumoSituacao; novoMinimo: string; setNovoMinimo: (v: string) => void; diasCompra: number;
}) {
  const linhas: Array<[string, string, string?]> = [
    ['No sistema', fmtQtd(i.estoque, i.unidade) + (i.estoque < 0 ? ' · conferir' : ''), i.estoque < 0 ? 'text-red-600' : undefined],
    ['Uso por dia', i.consumoDia ? `~${fmtQtd(i.consumoDia, i.unidade)}` : 'sem uso registrado'],
    ['Acaba em', i.diasRestantes == null ? '—' : i.diasRestantes < 0.5 ? 'já acabou' : `~${Math.round(i.diasRestantes)} dias`],
    ['Preço', fmtPrecoUnit(i.preco, i.unidade)],
    ['Última contagem', i.ultimaContagem ? new Date(i.ultimaContagem).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : 'nunca'],
    ['Fornecedor', i.fornecedor ?? 'não definido', i.fornecedor ? undefined : 'text-red-600'],
    ['Embalagem de compra', i.unidadeCompra && i.fatorCompra !== 1 ? `${i.unidadeCompra} = ${fmtQtd(i.fatorCompra, i.unidade)}` : '—'],
    [`Pedido sugerido (${diasCompra} dias)`, fmtSugestao(sugestaoCompra(i, diasCompra), i.unidade)],
  ];
  return (
    <div>
      {linhas.map(([k, v, c]) => (
        <div key={k} className="flex justify-between gap-3 py-2 border-t border-zinc-100 first:border-t-0 text-[13.5px]">
          <span className="text-zinc-500">{k}</span><b className={`text-right ${c ?? 'text-zinc-800'}`}>{v}</b>
        </div>
      ))}
      <label className="block mt-3 text-xs font-bold text-zinc-600">Estoque mínimo ({rotuloUnidade(i.unidade)})</label>
      <input
        value={novoMinimo}
        onChange={(e) => setNovoMinimo(e.target.value)}
        inputMode="decimal"
        className="mt-1 w-full rounded-xl border border-zinc-200 px-3 py-2.5 text-base font-bold focus:outline-none focus:border-amber-400"
      />
      <p className="text-[11px] text-zinc-400 mt-1 mb-2">Abaixo disso o insumo entra na lista de compras. “Não uso mais” desliga os avisos dele.</p>
    </div>
  );
}
