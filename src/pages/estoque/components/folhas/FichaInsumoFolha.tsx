import { useEffect, useRef, useState, type ReactNode } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useEstoque } from '@/contexts/EstoqueContext';
import { useToast } from '@/contexts/ToastContext';
import { useIngredientPriceHistory } from '@/hooks/useIngredientPriceHistory';
import { ehProduzido, fmtPrecoUnit, fmtQtd, precisaConferir, type InsumoSituacao } from '@/lib/estoqueRegras';
import { descreverMov, diaMes, qtdComSinal, quandoCurto, type MovFicha, type TomMov } from '@/lib/estoqueFicha';
import Folha from '../inicio/Folha';
import HistoricoComprasModal from '../HistoricoComprasModal';
import { useAcoesInsumo } from '../insumos/AcoesInsumo';
import { useEstoqueTela } from '../../EstoqueTela';
import { MenuMais, Etiqueta, btn, brl } from '../ui/EstoqueUi';
import EscolherFornecedor, { type FornecedorEscolhido } from './EscolherFornecedor';

// Ficha do insumo (layout novo, protótipo S.ficha): tudo de um insumo num lugar só — números, quem vende,
// preço, pratos, última contagem e as últimas movimentações — com os botões do dia a dia embaixo.
// Os números vêm da regra única (situacao); a ficha só acrescenta pratos e movimentações (fn_estoque_ficha_insumo).

interface DadosFicha { pratos: Array<{ id: string; nome: string }>; movimentos: MovFicha[] }

const esperar = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const numOuNull = (v: unknown) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

const tomMov: Record<TomMov, string> = {
  blue: 'bg-blue-50 text-blue-600', green: 'bg-emerald-50 text-emerald-700', red: 'bg-red-50 text-red-600',
  amber: 'bg-amber-50 text-amber-700', zinc: 'bg-zinc-100 text-zinc-600',
};

function Numero({ valor, rotulo, tom = 'neutro', extra }: { valor: string; rotulo: string; tom?: 'neutro' | 'red'; extra?: string | null }) {
  return (
    <div className="bg-zinc-50 rounded-2xl px-3 py-2 min-w-0">
      <p className={`text-base font-extrabold tabular-nums leading-tight truncate ${tom === 'red' ? 'text-red-600' : 'text-zinc-900'}`}>{valor}</p>
      <p className="text-[10.5px] font-semibold text-zinc-400 mt-0.5">{rotulo}</p>
      {extra && <p className="text-[10.5px] font-semibold text-zinc-500 mt-0.5 leading-tight">{extra}</p>}
    </div>
  );
}

function Linha({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5 border-t border-zinc-100 first:border-t-0 text-[13.5px]">
      <span className="text-zinc-400 flex-shrink-0">{rotulo}</span>
      <div className="text-right min-w-0 font-bold text-zinc-800">{children}</div>
    </div>
  );
}

/** A ficha recomeça do zero a cada insumo (key): nada do insumo anterior, nem o histórico de preço, fica na tela. */
export default function FichaInsumoFolha({ insumoId, onFechar }: { insumoId: string | null; onFechar: () => void }) {
  return <FichaInterna key={insumoId ?? 'fechada'} insumoId={insumoId} onFechar={onFechar} />;
}

function FichaInterna({ insumoId, onFechar }: { insumoId: string | null; onFechar: () => void }) {
  const { user } = useAuth();
  const toast = useToast();
  const tenantId = user?.tenantId;
  const { insumos, setRastrearEstoque, setContaInventario, marcarInsumoEsgotado, reloadInsumos } = useEstoque();
  const acoes = useAcoesInsumo();
  const {
    situacao, recarregarSituacao, irPara, contar, abrirEntrada, abrirSaida, abrirPerda, abrirCompra, editarInsumo,
    podeConfigurar, podeContar,
  } = useEstoqueTela();
  const { stats: precos } = useIngredientPriceHistory(insumoId);

  const sit: InsumoSituacao | null = insumoId ? situacao?.insumos.find((i) => i.id === insumoId) ?? null : null;
  const ins = insumoId ? insumos.find((i) => i.id === insumoId) ?? null : null;
  // Insumo excluído (pelo ⋯ desta ficha) ou que sumiu da lista: a ficha fecha sozinha.
  useEffect(() => {
    if (insumoId && insumos.length > 0 && !ins) onFechar();
  }, [insumoId, insumos.length, ins, onFechar]);

  const [dados, setDados] = useState<DadosFicha | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [recarga, setRecarga] = useState(0);
  const [verPratos, setVerPratos] = useState(false);

  const [escolhendo, setEscolhendo] = useState(false);
  const [salvandoForn, setSalvandoForn] = useState(false);
  const [fornLocal, setFornLocal] = useState<string | null>(null);
  const [historico, setHistorico] = useState(false);
  const [confirmaEsgotado, setConfirmaEsgotado] = useState(false);
  const [ocupado, setOcupado] = useState(false);

  // A situação mais nova fica numa ref para conferir, depois de gravar, o que o banco realmente guardou.
  const situacaoRef = useRef(situacao);
  situacaoRef.current = situacao;

  // Pratos e últimas movimentações
  useEffect(() => {
    setDados(null);
    setErro(null);
    if (!insumoId || !tenantId) return;
    let vivo = true;
    setCarregando(true);
    (async () => {
      try {
        const { data, error } = await supabase.rpc('fn_estoque_ficha_insumo', { p_tenant_id: tenantId, p_ingredient_id: insumoId });
        if (!vivo) return;
        if (error) throw error;
        const d = (data ?? {}) as { pratos?: Array<{ id: string; nome: string }>; movimentos?: Array<Record<string, unknown>> };
        setDados({
          pratos: Array.isArray(d.pratos) ? d.pratos.map((p) => ({ id: String(p.id), nome: String(p.nome ?? '') })) : [],
          movimentos: Array.isArray(d.movimentos) ? d.movimentos.map((m) => ({
            id: String(m.id),
            tipo: String(m.tipo ?? ''),
            quantidade: Number(m.quantidade ?? 0),
            sinal: numOuNull(m.sinal),
            motivo: m.motivo ? String(m.motivo) : null,
            created_at: String(m.created_at ?? ''),
            operador: m.operador ? String(m.operador) : null,
            pedido: m.pedido != null ? String(m.pedido) : null,
            prato: m.prato ? String(m.prato) : null,
          })) : [],
        });
      } catch (e) {
        if (vivo) setErro((e as { message?: string })?.message ?? 'Erro desconhecido.');
      } finally {
        if (vivo) setCarregando(false);
      }
    })();
    return () => { vivo = false; };
  }, [insumoId, tenantId, recarga]);

  /** Roda a mudança e só diz que deu certo se a situação recarregada do banco mostra o novo estado.
   *  (As funções do contexto engolem o erro; por isso a conferência.) */
  const mudar = async (acao: () => Promise<void>, confere: (i: InsumoSituacao) => boolean): Promise<boolean> => {
    await acao();
    await recarregarSituacao();
    for (let k = 0; k < 12; k++) {
      const atual = situacaoRef.current?.insumos.find((x) => x.id === insumoId);
      if (atual && confere(atual)) return true;
      await esperar(150);
    }
    return false;
  };

  const alternar = async (qual: 'avisos' | 'contagem') => {
    if (!sit || ocupado) return;
    setOcupado(true);
    const quer = qual === 'avisos' ? !sit.acompanha : !sit.contaInventario;
    try {
      const ok = await mudar(
        () => (qual === 'avisos' ? setRastrearEstoque(sit.id, quer) : setContaInventario(sit.id, quer)),
        (i) => (qual === 'avisos' ? i.acompanha : i.contaInventario) === quer,
      );
      if (ok) {
        toast.success(
          qual === 'avisos' ? (quer ? 'Avisos ligados' : 'Avisos desligados') : (quer ? 'Entra na contagem' : 'Fora da contagem'),
          sit.nome,
        );
      } else {
        toast.error('Não consegui mudar', 'O servidor não confirmou a mudança. Confira a conexão e tente de novo.');
      }
    } catch (e) {
      toast.error('Não consegui mudar', (e as { message?: string })?.message ?? 'Tente de novo.');
    } finally {
      setOcupado(false);
    }
  };

  const marcarEsgotado = async () => {
    if (!sit || ocupado) return;
    setOcupado(true);
    try {
      const ok = await mudar(() => marcarInsumoEsgotado(sit.id, user?.nome ?? 'Estoque'), (i) => i.marcadoEsgotado);
      if (ok) { toast.success('Marcado como esgotado', sit.nome); setConfirmaEsgotado(false); }
      else toast.error('Não marquei como esgotado', 'O servidor não confirmou. Tente de novo.');
    } catch (e) {
      toast.error('Não marquei como esgotado', (e as { message?: string })?.message ?? 'Tente de novo.');
    } finally {
      setOcupado(false);
    }
  };

  const escolherFornecedor = async (f: FornecedorEscolhido) => {
    if (!sit || !tenantId) return;
    setSalvandoForn(true);
    try {
      const { data, error } = await supabase.rpc('fn_estoque_arrumar_insumo', {
        p_tenant_id: tenantId, p_ingredient_id: sit.id, p_supplier_id: f.id,
      });
      if (error || (data as { ok?: boolean } | null)?.ok !== true) {
        toast.error('Não gravei o fornecedor', error?.message ?? 'O servidor não confirmou. Tente de novo.');
        return;
      }
      setFornLocal(f.nome);
      toast.success('Fornecedor escolhido', `${sit.nome} agora é de ${f.nome}. Vale para os próximos pedidos.`);
      await recarregarSituacao();
      void reloadInsumos();
    } catch (e) {
      toast.error('Não gravei o fornecedor', (e as { message?: string })?.message ?? 'Tente de novo.');
    } finally {
      setSalvandoForn(false);
    }
  };

  // Abrir outra janela fecha a ficha antes (uma coisa de cada vez na tela)
  const depoisDeFechar = (fn: () => void) => () => { onFechar(); fn(); };

  // ── Corpo ──
  let corpo: ReactNode;
  if (!sit) {
    corpo = !situacao ? (
      <p className="text-sm text-zinc-500 py-6 text-center">Carregando o estoque…</p>
    ) : (
      <div className="py-6 text-center">
        <p className="text-sm font-bold text-zinc-800">Não achei este insumo na lista</p>
        <p className="text-xs text-zinc-500 mt-1 leading-relaxed">Pode ter sido apagado ou ser novo demais. Atualize para conferir.</p>
        <button type="button" onClick={() => { void recarregarSituacao(); }} className={`${btn('out')} mt-3`}>Atualizar</button>
      </div>
    );
  } else {
    const conferir = precisaConferir(sit);
    const produzido = ehProduzido(sit);
    const nomeForn = produzido ? null : (sit.fornecedor ?? fornLocal);
    const dias = sit.diasRestantes;
    const dura = sit.consumoDia && sit.consumoDia > 0 && sit.estoque > 0 && dias != null
      ? (dias < 1 ? 'dura menos de 1 dia' : dias > 365 ? 'dura mais de 1 ano' : `dura ${Math.round(dias)} ${Math.round(dias) === 1 ? 'dia' : 'dias'}`)
      : null;
    const pontos = precos?.points.slice(-6) ?? [];
    const ultimaCompra = diaMes(precos?.points.length ? precos.points[precos.points.length - 1].date : ins?.lastPurchaseDate);
    const maxP = Math.max(...pontos.map((p) => p.price), 0);
    const minP = Math.min(...pontos.map((p) => p.price), maxP);
    const altura = (p: number) => (maxP > minP ? 28 + (72 * (p - minP)) / (maxP - minP) : 60);
    const pratos = dados?.pratos ?? [];
    const contagemEm = diaMes(sit.ultimaContagem);

    corpo = (
      <div className="pb-3">
        <div className="grid grid-cols-3 gap-2">
          <Numero valor={fmtQtd(sit.estoque, sit.unidade)} rotulo="no sistema" tom={sit.estoque < 0 ? 'red' : 'neutro'} />
          <Numero valor={sit.minimo > 0 ? fmtQtd(sit.minimo, sit.unidade) : '—'} rotulo="mínimo" />
          <Numero valor={sit.consumoDia != null ? fmtQtd(sit.consumoDia, sit.unidade) : '—'} rotulo="usa por dia" extra={dura} />
        </div>

        {(sit.esgotado || sit.abaixoMinimo || sit.vaiFaltar || sit.naLista) && (
          <div className="flex gap-1.5 flex-wrap mt-2">
            {sit.esgotado ? <Etiqueta tom="red">Esgotado</Etiqueta> : sit.abaixoMinimo ? <Etiqueta tom="red">Abaixo do mínimo</Etiqueta> : null}
            {sit.vaiFaltar && <Etiqueta tom="amber">Vai faltar em breve</Etiqueta>}
            {sit.naLista && <Etiqueta tom="blue">Na lista de compras</Etiqueta>}
          </div>
        )}

        {conferir && (
          <div className="mt-3 rounded-2xl bg-red-50 border border-red-100 px-3.5 py-3 text-[12.5px] text-red-800 leading-snug">
            {sit.estoque < 0
              ? <><b>Número impossível:</b> não dá para ter menos que zero. Conte agora e ele volta a valer.</>
              : <><b>Conferir:</b> está marcado como esgotado, mas o sistema tem {fmtQtd(sit.estoque, sit.unidade)}. Conte agora para acertar.</>}
            {podeContar ? (
              <button type="button" onClick={depoisDeFechar(() => contar([sit], `Conferir ${sit.nome}`))} className={`${btn('dark')} w-full mt-2`}>
                <i className="ri-scales-3-line" />Contar agora
              </button>
            ) : (
              <p className="text-[11.5px] text-red-700/70 mt-1.5">Contar é com quem tem a permissão de inventário.</p>
            )}
          </div>
        )}

        <div className="mt-2">
          <Linha rotulo="Quem vende">
            {produzido ? 'Produção da cozinha'
              : nomeForn ? nomeForn
              : podeConfigurar ? (
                <button type="button" disabled={salvandoForn} onClick={() => setEscolhendo(true)} className={btn('p', 'sm')}>
                  {salvandoForn ? 'Gravando…' : 'Escolher fornecedor'}
                </button>
              ) : <span className="text-zinc-400 font-semibold">Sem fornecedor</span>}
          </Linha>
          <Linha rotulo="Preço">
            {sit.preco > 0 ? fmtPrecoUnit(sit.preco, sit.unidade) : <span className="text-zinc-400 font-semibold">sem preço</span>}
            {ultimaCompra && <span className="font-semibold text-zinc-400 text-xs"> · última compra {ultimaCompra}</span>}
          </Linha>
          {pontos.length >= 2 && (
            <Linha rotulo={`Preço nas últimas ${pontos.length} compras`}>
              <div className="flex items-end justify-end gap-[3px] h-8" aria-hidden>
                {pontos.map((p, k) => (
                  <span key={`${p.date}-${k}`} title={`${diaMes(p.date) ?? ''} · ${fmtPrecoUnit(p.price, sit.unidade)}`}
                    className={`w-2.5 rounded-t-[3px] ${k === pontos.length - 1 ? 'bg-amber-500' : 'bg-amber-200'}`}
                    style={{ height: `${altura(p.price)}%` }} />
                ))}
              </div>
            </Linha>
          )}
          <Linha rotulo="Valor em estoque">
            {sit.estoque > 0 && sit.preco > 0 ? brl(sit.estoque * sit.preco) : <span className="text-zinc-400 font-semibold">—</span>}
          </Linha>
          <Linha rotulo="Aparece em">
            {!dados ? <span className="text-zinc-400 font-semibold">{erro ? '—' : '…'}</span>
              : pratos.length === 0 ? <span className="text-zinc-400 font-semibold">nenhum prato</span>
              : (
                <button type="button" onClick={() => setVerPratos((v) => !v)} aria-expanded={verPratos}
                  className="text-right cursor-pointer font-bold text-zinc-800">
                  {pratos.length} {pratos.length === 1 ? 'prato' : 'pratos'}
                  <i className={`ml-1 text-zinc-400 ${verPratos ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'}`} />
                  {!verPratos && (
                    <span className="block text-xs font-semibold text-zinc-400 truncate">
                      {pratos.slice(0, 3).map((p) => p.nome).join(', ')}{pratos.length > 3 ? ' · ver todos' : ''}
                    </span>
                  )}
                </button>
              )}
          </Linha>
          {verPratos && pratos.length > 0 && (
            <ul className="mb-2 rounded-xl bg-zinc-50 px-3 py-1.5 text-[13px] text-zinc-700">
              {[...pratos].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')).map((p) => (
                <li key={p.id} className="py-1 border-t border-zinc-100 first:border-t-0">{p.nome}</li>
              ))}
            </ul>
          )}
          <Linha rotulo="Última contagem">
            {contagemEm ?? <span className="text-zinc-400 font-semibold">ainda não contado</span>}
          </Linha>
          <Linha rotulo="Avisos">
            {sit.acompanha ? 'Ligados' : <span className="text-zinc-400 font-semibold">Desligados</span>}
          </Linha>
          <Linha rotulo="Contagem">
            {sit.contaInventario ? 'Entra no inventário' : <span className="text-zinc-400 font-semibold">Fora da contagem</span>}
          </Linha>
        </div>

        <p className="text-[11px] font-extrabold uppercase tracking-widest text-zinc-400 mt-5 mb-1">Últimas movimentações</p>
        {carregando && !dados ? (
          <p className="text-sm text-zinc-500 py-3">Carregando as movimentações…</p>
        ) : erro ? (
          <div className="py-3">
            <p className="text-sm font-bold text-red-600">Não consegui carregar as movimentações</p>
            <p className="text-xs text-zinc-500 mt-0.5">{erro}</p>
            <button type="button" onClick={() => setRecarga((r) => r + 1)} className={`${btn('out', 'sm')} mt-2`}>Tentar de novo</button>
          </div>
        ) : dados && dados.movimentos.length === 0 ? (
          <p className="text-sm text-zinc-500 py-3">Nenhuma movimentação ainda.</p>
        ) : (
          dados?.movimentos.map((m) => {
            const d = descreverMov(m);
            const q = qtdComSinal(m, sit.unidade);
            return (
              <div key={m.id} className="flex items-center gap-2.5 py-2 border-t border-zinc-100 first:border-t-0">
                <span className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 ${tomMov[d.tom]}`}><i className={`${d.icone} text-base`} /></span>
                <div className="flex-1 min-w-0">
                  <p className="text-[13.5px] font-bold text-zinc-800 truncate">{d.texto}</p>
                  <p className="text-[11.5px] text-zinc-400 truncate">{quandoCurto(m.created_at)}{m.pedido ? ` · pedido ${m.pedido}` : ''}</p>
                </div>
                <b className={`text-sm tabular-nums whitespace-nowrap ${q.positivo ? 'text-emerald-600' : 'text-zinc-800'}`}>{q.texto}</b>
              </div>
            );
          })
        )}
        <div className="flex gap-2 mt-3 flex-wrap">
          <button type="button" onClick={depoisDeFechar(() => irPara('movimentacoes'))} className={btn('out', 'sm')}>Ver tudo</button>
          {ins && <button type="button" onClick={() => setHistorico(true)} className={btn('out', 'sm')}>Histórico de compras</button>}
        </div>
      </div>
    );
  }

  // ── Rodapé ──
  let rodape: ReactNode;
  if (sit && confirmaEsgotado) {
    rodape = (
      <div className="w-full">
        <p className="text-[12.5px] text-zinc-600 leading-snug mb-2">
          Marcar <b>{sit.nome}</b> como esgotado? O estoque será zerado e o garçom e o caixa recebem aviso.
        </p>
        <div className="flex gap-2">
          <button type="button" disabled={ocupado} onClick={() => setConfirmaEsgotado(false)} className={`${btn('out')} flex-1`}>Cancelar</button>
          <button type="button" disabled={ocupado} onClick={marcarEsgotado}
            className="inline-flex items-center justify-center flex-1 min-h-[42px] rounded-xl bg-red-600 hover:bg-red-500 text-white text-[13.5px] font-bold cursor-pointer disabled:opacity-50">
            {ocupado ? 'Marcando…' : 'Marcar esgotado'}
          </button>
        </div>
      </div>
    );
  } else if (sit) {
    rodape = (
      <>
        <button type="button" onClick={depoisDeFechar(() => abrirEntrada(sit.id))} className={`${btn('p')} flex-1 !px-2`}>+ Entrada</button>
        <button type="button" onClick={depoisDeFechar(() => abrirSaida(sit.id))} className={`${btn('out')} flex-1 !px-2`}>Saída</button>
        <button type="button" onClick={depoisDeFechar(() => abrirPerda(sit.id))} className={`${btn('out')} flex-1 !px-2`}>Perda</button>
        <button type="button" onClick={depoisDeFechar(() => editarInsumo(sit.id))} className={`${btn('out')} flex-1 !px-2`}>Editar</button>
        <MenuMais grande rotulo="Mais ações do insumo" itens={[
          { rotulo: sit.acompanha ? 'Desligar os avisos' : 'Ligar os avisos', icone: sit.acompanha ? 'ri-notification-off-line' : 'ri-notification-3-line', onClick: () => { void alternar('avisos'); } },
          { rotulo: sit.contaInventario ? 'Tirar da contagem' : 'Pôr na contagem', icone: 'ri-scales-3-line', onClick: () => { void alternar('contagem'); } },
          { rotulo: 'Marcar como esgotado', icone: 'ri-forbid-2-line', perigo: true, oculto: sit.marcadoEsgotado, onClick: () => setConfirmaEsgotado(true) },
          { rotulo: 'Comprar', icone: 'ri-shopping-cart-2-line', onClick: depoisDeFechar(() => abrirCompra(sit.id)) },
          // No celular a linha da lista não tem ⋯: o que só existia lá (assistente, excluir) vem para cá.
          ...(ins ? acoes.itensMenu(ins).filter((x) => x.rotulo === 'Perguntar ao assistente' || x.rotulo === 'Excluir insumo') : []),
        ]} />
      </>
    );
  }

  const subtitulo = sit
    ? [sit.categoria || 'Sem categoria', sit.contaInventario ? 'conta no inventário' : 'fora da contagem', sit.acompanha ? 'com aviso' : 'sem aviso'].join(' · ')
    : undefined;

  return (
    <>
      <Folha aberta={!!insumoId} titulo={sit?.nome ?? 'Insumo'} subtitulo={subtitulo} onFechar={onFechar} rodape={rodape}>
        {corpo}
      </Folha>
      <EscolherFornecedor
        aberta={!!insumoId && escolhendo}
        titulo="Quem vende?"
        subtitulo={sit?.nome}
        onEscolher={(f) => { void escolherFornecedor(f); }}
        onFechar={() => setEscolhendo(false)}
      />
      {insumoId && historico && ins && <HistoricoComprasModal insumo={ins} onClose={() => setHistorico(false)} />}
      {acoes.modais}
    </>
  );
}
