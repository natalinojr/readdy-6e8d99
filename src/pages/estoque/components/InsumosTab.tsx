import { Fragment, useEffect, useMemo, useState } from 'react';
import { useEstoque } from '@/contexts/EstoqueContext';
import { useProducao } from '@/contexts/ProducaoContext';
import { useToast } from '@/contexts/ToastContext';
import { useIngredientCategories } from '@/hooks/useIngredientCategories';
import ImportExportTemplatesModal from '@/components/ImportExportTemplatesModal';
import { useFocoTela } from '@/lib/assistenteFoco';
import { fmtQtd, fmtPrecoUnit } from '@/lib/estoqueRegras';
import { contarPendencias } from '@/lib/estoqueArrumar';
import CategoriasModal from './insumos/CategoriasModal';
import MiniPriceHistory from './insumos/MiniPriceHistory';
import { useAcoesInsumo } from './insumos/AcoesInsumo';
import {
  ROTULO_SITUACAO, FILTROS_SITUACAO, montarLinha, passaFiltroSituacao, contagensPorFiltro,
  valorEmEstoque, diasSemContar, textoDura, ordenarLinhas, exportarInsumosCSV, unidadeDoBanco,
  type LinhaInsumo, type FiltroSituacao, type SituacaoLinha, type SortKey,
} from './insumos/InsumosUtils';
import ItensIndisponiveisPanel from './ItensIndisponiveisPanel';
import { useEstoqueTela } from '../EstoqueTela';
import {
  Pagina, Faixa, CartaoAcao, Chips, Vazio, Etiqueta, MenuMais, btn, semAcento, brl, brlInteiro,
  type ItemFaixa, type OpcaoChip,
} from './ui/EstoqueUi';

// Insumos › Lista (layout novo, 2026-10-04; protótipo aprovado pelo dono). Começa pelo que precisa ser
// feito: faixa com os 4 números, "falta arrumar no cadastro" com botão, e só depois a busca e a lista.
// Situação, filtros e contas moram em insumos/InsumosUtils.ts, pela regra única (src/lib/estoqueRegras.ts).
// Entrada, editar e novo insumo usam as janelas comuns da tela (EstoqueTela); tocar na linha abre a ficha.

const TODAS = '__todas';
const SEM_CATEGORIA = '__sem';

const TOM_ETIQUETA: Record<SituacaoLinha, 'red' | 'amber' | 'green' | 'blue' | 'zinc'> = {
  conferir: 'red', esgotado: 'red', abaixo: 'red', sem_aviso: 'zinc', fora_contagem: 'zinc', ok: 'green',
};

const ROTULO_FILTRO: Record<FiltroSituacao, string> = {
  todos: 'Todos', abaixo: 'Abaixo do mínimo', esgotado: 'Esgotado', conferir: 'Conferir',
  sem_fornecedor: 'Sem fornecedor', fora_contagem: 'Fora da contagem', ok: 'Ok',
};

/** Cabeçalho de coluna clicável — ordena a tabela por essa coluna ao clicar. */
function ThOrdenavel({
  label, sortKey, align = 'left', current, dir, onSort, extra,
}: {
  label: string; sortKey: SortKey; align?: 'left' | 'right';
  current: SortKey | null; dir: 'asc' | 'desc'; onSort: (key: SortKey) => void;
  /** Segunda ordenação no mesmo cabeçalho (Insumo / Categoria) */
  extra?: { label: string; sortKey: SortKey };
}) {
  const botao = (rotulo: string, chave: SortKey) => {
    const ativo = current === chave;
    return (
      <button
        key={chave}
        type="button"
        onClick={() => onSort(chave)}
        className={`inline-flex items-center gap-1 cursor-pointer hover:text-amber-600 uppercase tracking-wide ${ativo ? 'text-amber-600' : ''}`}
      >
        {rotulo}
        <i className={`ri-arrow-${ativo && dir === 'desc' ? 'down' : 'up'}-line text-[10px] ${ativo ? 'opacity-100' : 'opacity-0'}`} />
      </button>
    );
  };
  return (
    <th className={`px-3 py-2.5 text-[11px] font-bold uppercase tracking-wide text-zinc-400 ${align === 'right' ? 'text-right' : 'text-left'}`}>
      <div className={`flex items-center gap-3 ${align === 'right' ? 'justify-end' : 'justify-start'}`}>
        {botao(label, sortKey)}
        {extra && botao(extra.label, extra.sortKey)}
      </div>
    </th>
  );
}

const corEstoque = (s: SituacaoLinha) => (s === 'conferir' || s === 'esgotado' || s === 'abaixo' ? 'text-red-600' : 'text-zinc-900');

export default function InsumosTab() {
  const { insumos, loading, reloadInsumos, inventarioSessions } = useEstoque();
  const { recipes, batches, reload: reloadProducao } = useProducao();
  const { categories, names: categoriasDB, loading: loadingCategorias, addCategory, removeCategory, renameCategory } = useIngredientCategories();
  const { situacao, irPara, abrirFicha, abrirEntrada, abrirNovoInsumo, abrirArrumar, podeConfigurar, podeContar } = useEstoqueTela();
  const { itensMenu, modais } = useAcoesInsumo();
  const toast = useToast();

  const [busca, setBusca] = useState('');
  const [categoriaSel, setCategoriaSel] = useState(TODAS);
  const [filtro, setFiltro] = useState<FiltroSituacao>('todos');
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [categoriasModal, setCategoriasModal] = useState(false);
  const [showTemplatesModal, setShowTemplatesModal] = useState(false);
  const [expandedPriceId, setExpandedPriceId] = useState<string | null>(null);

  // Set de nomes de fichas para identificar produtos produzidos
  const recipeNames = useMemo(() => new Set(recipes.map((r) => r.name).filter(Boolean) as string[]), [recipes]);

  // Última produção de cada produto (indexado pelo nome)
  const ultimaProducaoPorProduto = useMemo(() => {
    const map = new Map<string, { data: string; qty: number; unit: string }>();
    for (const recipe of recipes) {
      const batchesRecipe = batches
        .filter((b) => b.recipeId === recipe.id)
        .sort((a, b) => new Date(b.producedAt).getTime() - new Date(a.producedAt).getTime());
      if (batchesRecipe.length > 0) {
        const last = batchesRecipe[0];
        map.set(recipe.name, {
          data: new Date(last.producedAt).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', timeZone: 'America/Sao_Paulo' }),
          qty: last.producedQuantity,
          unit: last.unit,
        });
      }
    }
    return map;
  }, [recipes, batches]);

  // Mapa: nome do produto acabado → categoria da ficha de produção
  const categoriaProducaoPorNome = useMemo(() => {
    const map = new Map<string, string>();
    for (const recipe of recipes) {
      if (recipe.name && recipe.category) map.set(recipe.name, recipe.category);
    }
    return map;
  }, [recipes]);

  // Incluir categorias das fichas de produção na lista de categorias
  const todasCategorias = useMemo(() => {
    const set = new Set<string>(categoriasDB);
    insumos.forEach((i) => { if (i.categoria && i.categoria !== 'Sem categoria') set.add(i.categoria); });
    recipes.forEach((r) => { if (r.category) set.add(r.category); });
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [categoriasDB, insumos, recipes]);

  // Uma linha por insumo: dados do EstoqueContext + uso por dia/fornecedor da regra única
  const linhas = useMemo<LinhaInsumo[]>(() => {
    const sitPorId = new Map((situacao?.insumos ?? []).map((s) => [s.id, s] as const));
    return insumos.map((i) => {
      // A mesma categoria que a linha mostra é a que o filtro usa (antes o filtro olhava só i.categoria)
      const categoria = i.categoria && i.categoria !== 'Sem categoria' ? i.categoria : categoriaProducaoPorNome.get(i.nome) ?? null;
      return montarLinha(i, sitPorId.get(i.id) ?? null, { categoria, ehFicha: recipeNames.has(i.nome) });
    });
  }, [insumos, situacao, categoriaProducaoPorNome, recipeNames]);

  // Categoria apagada ou renomeada enquanto estava escolhida: volta para Todas
  useEffect(() => {
    if (categoriaSel !== TODAS && categoriaSel !== SEM_CATEGORIA && !todasCategorias.includes(categoriaSel)) setCategoriaSel(TODAS);
  }, [categoriaSel, todasCategorias]);

  const porCategoria = useMemo(() => {
    const m = new Map<string, number>();
    let sem = 0;
    for (const l of linhas) {
      if (l.categoria) m.set(l.categoria, (m.get(l.categoria) ?? 0) + 1);
      else sem++;
    }
    return { m, sem };
  }, [linhas]);

  // Busca (sem acento) e categoria valem para a lista E para os números dos chips: clicar no chip dá o número que ele mostra
  const aposBusca = useMemo(() => {
    const t = semAcento(busca);
    return linhas.filter((l) => {
      if (t && !semAcento(l.nome).includes(t)) return false;
      if (categoriaSel === TODAS) return true;
      return categoriaSel === SEM_CATEGORIA ? !l.categoria : l.categoria === categoriaSel;
    });
  }, [linhas, busca, categoriaSel]);

  const contagens = useMemo(() => contagensPorFiltro(aposBusca), [aposBusca]);
  const globais = useMemo(() => contagensPorFiltro(linhas), [linhas]);

  const visiveis = useMemo(
    () => ordenarLinhas(aposBusca.filter((l) => passaFiltroSituacao(l, filtro)), sortKey, sortDir),
    [aposBusca, filtro, sortKey, sortDir],
  );

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('asc'); }
  };

  const limparFiltros = () => { setBusca(''); setCategoriaSel(TODAS); setFiltro('todos'); };

  // ── Números da faixa ──
  // Mesma regra da fila do Arrumar (src/lib/estoqueArrumar.ts): o número do cartão bate com o passo a passo.
  const pend = useMemo(() => {
    if (!situacao) return { semFornecedor: 0, semMinimo: 0, semPreco: 0, negativos: 0, total: 0 };
    const c = contarPendencias(situacao, podeContar);
    return { semFornecedor: c.fornecedor, semMinimo: c.minimo, semPreco: c.preco, negativos: c.negativo, total: c.fornecedor + c.minimo + c.preco + c.negativo };
  }, [situacao, podeContar]);
  const valorTotal = useMemo(() => valorEmEstoque(linhas), [linhas]);
  // Abaixo do mínimo: o número da regra única (o mesmo do Início); enquanto ela carrega, a mesma conta aqui
  const abaixoMinimo = situacao?.totais.abaixoMinimo ?? globais.abaixo;
  const dias = useMemo(() => diasSemContar(inventarioSessions), [inventarioSessions]);
  // O contexto traz as 50 últimas contagens
  const nContagens = inventarioSessions.length >= 50 ? '50+' : String(inventarioSessions.length);
  const rotuloContagens = `${nContagens} ${inventarioSessions.length === 1 ? 'contagem' : 'contagens'}`;

  const itensFaixa: ItemFaixa[] = [
    { valor: insumos.length.toLocaleString('pt-BR'), rotulo: insumos.length === 1 ? 'insumo' : 'insumos' },
    {
      valor: abaixoMinimo.toLocaleString('pt-BR'), rotulo: 'abaixo do mínimo', tom: abaixoMinimo > 0 ? 'red' : 'neutro',
      onClick: () => { limparFiltros(); setFiltro('abaixo'); },
    },
    {
      valor: brlInteiro(valorTotal), rotulo: 'em estoque',
      ajuda: <>Soma de estoque × preço de cada insumo. Estoque negativo vale zero (não diminui o total) e insumo sem preço não entra na conta.</>,
    },
    {
      valor: dias === null ? '—' : dias === 0 ? 'Hoje' : dias === 1 ? '1 dia' : `${dias} dias`,
      rotulo: dias === null ? 'nenhuma contagem' : dias === 0 ? `última contagem (${rotuloContagens})` : `sem contar (${rotuloContagens})`,
      tom: dias === null || dias > 7 ? 'amber' : 'neutro',
      onClick: () => irPara('inventario'),
    },
  ];

  const opcoesChips: OpcaoChip<FiltroSituacao>[] = FILTROS_SITUACAO.map((f) => ({
    id: f,
    rotulo: ROTULO_FILTRO[f],
    n: contagens[f],
    tom: f === 'abaixo' && contagens.abaixo > 0 ? 'red' : f === 'conferir' && contagens.conferir > 0 ? 'amber' : undefined,
  }));

  const alternarPreco = (id: string) => setExpandedPriceId((atual) => (atual === id ? null : id));

  // O assistente sabe o que a tela mostra (2026-09-16): filtros, alertas e os insumos visíveis.
  // Assim "esse aqui tá caro?" e "o que falta comprar?" têm a que se referir.
  useFocoTela(() => ({
    tipo: 'tela_insumos',
    titulo: 'Estoque › Insumos',
    dados: {
      filtros: { busca: busca || null, categoria: categoriaSel === TODAS ? 'Todas' : categoriaSel === SEM_CATEGORIA ? 'Sem categoria' : categoriaSel, situacao: ROTULO_FILTRO[filtro] },
      total_cadastrados: insumos.length,
      apos_filtros: visiveis.length,
      abaixo_do_minimo: abaixoMinimo, esgotados: globais.esgotado,
      valor_total_estoque: valorTotal,
      visiveis: visiveis.slice(0, 20).map((l) => ({ id: l.id, nome: l.nome, estoque: l.estoque, unidade: l.insumo.unidade, minimo: l.minimo, preco: l.preco })),
    },
  }), [busca, categoriaSel, filtro, insumos.length, visiveis, abaixoMinimo, globais.esgotado, valorTotal]);

  const exportarCSV = () => {
    if (!visiveis.length) { toast.info('Nada para exportar', 'Nenhum insumo na lista com esses filtros.'); return; }
    exportarInsumosCSV(visiveis.map((l) => l.insumo));
  };

  /** "categoria · fornecedor"; o que falta aparece em âmbar (produzido na cozinha não tem fornecedor) */
  const subtitulo = (l: LinhaInsumo) => (
    <>
      {l.categoria ?? <span className="text-zinc-300">sem categoria</span>}
      {' · '}
      {l.fornecedor ?? (l.produzido ? 'produzido na cozinha' : <span className="font-semibold text-amber-700">sem fornecedor</span>)}
    </>
  );

  /** Fora da contagem, mas a etiqueta principal é outra (Esgotado, Sem aviso...): vira uma segunda etiqueta */
  const foraDaContagemExtra = (l: LinhaInsumo) => !l.contaInventario && l.situacao !== 'fora_contagem';

  return (
    <Pagina>
      {/* Itens do cardápio indisponíveis por falta de insumo (só aparece quando há) */}
      <ItensIndisponiveisPanel onEntradaRapida={(insumoId) => abrirEntrada(insumoId)} />

      {insumos.length > 0 && (
        <>
          <Faixa itens={itensFaixa} />

          {podeConfigurar && pend.total > 0 && (
            <CartaoAcao
              tom="prop"
              icone="ri-magic-line"
              titulo={`Falta arrumar ${pend.total} ${pend.total === 1 ? 'coisa' : 'coisas'} no cadastro`}
              direita={<button type="button" onClick={() => abrirArrumar()} className={btn('p', 'sm')}><i className="ri-play-line" />Arrumar</button>}
            >
              <div className="flex gap-1.5 flex-wrap mt-1">
                {pend.semFornecedor > 0 && <ChipPendencia n={pend.semFornecedor} texto="sem fornecedor" onClick={() => abrirArrumar({ filtro: 'fornecedor' })} />}
                {pend.semMinimo > 0 && <ChipPendencia n={pend.semMinimo} texto="sem mínimo" onClick={() => abrirArrumar({ filtro: 'minimo' })} />}
                {pend.semPreco > 0 && <ChipPendencia n={pend.semPreco} texto="sem preço" onClick={() => abrirArrumar({ filtro: 'preco' })} />}
                {pend.negativos > 0 && <ChipPendencia n={pend.negativos} texto={pend.negativos === 1 ? 'negativo' : 'negativos'} vermelho onClick={() => abrirArrumar({ filtro: 'negativo' })} />}
              </div>
            </CartaoAcao>
          )}
        </>
      )}

      {/* Barra: busca, categoria, ⋯ e novo insumo */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative basis-full sm:basis-auto sm:flex-1 sm:max-w-md">
          <i className="ri-search-line absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400 text-base pointer-events-none" />
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Procurar insumo"
            aria-label="Procurar insumo"
            className="w-full h-10 rounded-xl border border-zinc-200 pl-10 pr-9 text-[13.5px] bg-white text-zinc-800 placeholder-zinc-400 focus:outline-none focus:border-amber-400"
          />
          {busca && (
            <button type="button" onClick={() => setBusca('')} aria-label="Limpar busca"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 w-7 h-7 flex items-center justify-center rounded-lg text-zinc-400 hover:text-zinc-700 cursor-pointer">
              <i className="ri-close-line text-base" />
            </button>
          )}
        </div>

        <div className="relative flex-1 sm:flex-none sm:w-56 min-w-0">
          <select
            value={categoriaSel}
            onChange={(e) => setCategoriaSel(e.target.value)}
            aria-label="Categoria"
            className={`w-full h-10 appearance-none rounded-xl border pl-3 pr-8 text-[13px] font-semibold focus:outline-none focus:border-amber-400 cursor-pointer ${categoriaSel === TODAS ? 'border-zinc-200 bg-white text-zinc-700' : 'border-amber-300 bg-amber-50 text-amber-800'}`}
          >
            <option value={TODAS}>Todas as categorias</option>
            {todasCategorias.map((c) => <option key={c} value={c}>{c} ({porCategoria.m.get(c) ?? 0})</option>)}
            {porCategoria.sem > 0 && <option value={SEM_CATEGORIA}>Sem categoria ({porCategoria.sem})</option>}
          </select>
          <i className="ri-arrow-down-s-line absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 text-base pointer-events-none" />
        </div>

        <MenuMais grande rotulo="Mais: exportar, modelos, categorias" itens={[
          { rotulo: 'Exportar CSV', icone: 'ri-download-line', onClick: exportarCSV },
          { rotulo: 'Importar / exportar modelos', icone: 'ri-file-transfer-line', onClick: () => setShowTemplatesModal(true) },
          { rotulo: 'Categorias', icone: 'ri-price-tag-3-line', onClick: () => setCategoriasModal(true) },
        ]} />

        <button type="button" onClick={abrirNovoInsumo} className={`${btn('p')} h-10 !min-h-0`}>
          <i className="ri-add-line text-base" />Novo insumo
        </button>
      </div>

      {insumos.length > 0 && (
        <Chips<FiltroSituacao> opcoes={opcoesChips} valor={filtro} onChange={setFiltro} />
      )}

      {/* Lista */}
      {loading && insumos.length === 0 ? (
        <div className="space-y-2 animate-pulse">
          {[0, 1, 2, 3].map((k) => <div key={k} className="h-16 bg-zinc-100 rounded-2xl" />)}
        </div>
      ) : insumos.length === 0 ? (
        <Vazio icone="ri-flask-line" titulo="Nenhum insumo cadastrado"
          acao={<button type="button" onClick={abrirNovoInsumo} className={btn('p')}><i className="ri-add-line" />Novo insumo</button>}>
          Cadastre o primeiro insumo, ou importe uma planilha pelo menu ⋯.
        </Vazio>
      ) : visiveis.length === 0 ? (
        <Vazio icone="ri-search-line" titulo="Nenhum insumo com esses filtros"
          acao={<button type="button" onClick={limparFiltros} className={btn('out')}>Limpar filtros</button>}>
          Troque a busca, a categoria ou a situação.
        </Vazio>
      ) : (
        <>
          {/* Celular e tablet: cartões-linha. Tocar abre a ficha; o + é a entrada rápida */}
          <div className="lg:hidden bg-white border border-zinc-200 rounded-2xl px-3.5 divide-y divide-zinc-100">
            {visiveis.map((l) => {
              const dura = textoDura(l.dias);
              const ultimaProd = l.produzido ? ultimaProducaoPorProduto.get(l.nome) : null;
              return (
                <div key={l.id} role="button" tabIndex={0}
                  onClick={() => abrirFicha(l.id)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && e.target === e.currentTarget) abrirFicha(l.id); }}
                  className="flex items-center gap-2.5 py-3 cursor-pointer">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <p className="text-[13.5px] font-bold text-zinc-900 truncate">{l.nome}</p>
                      {l.produzido && <span className="flex-shrink-0"><Etiqueta tom="amber">Produzido</Etiqueta></span>}
                    </div>
                    <p className="text-[11.5px] text-zinc-400 mt-0.5 truncate">{subtitulo(l)}</p>
                    {(l.minimo > 0 || l.acompanha || dura || foraDaContagemExtra(l)) && (
                      <p className="text-[11.5px] text-zinc-400 mt-0.5 leading-snug">
                        {[
                          l.minimo > 0 ? `mín ${fmtQtd(l.minimo, l.unidade)}` : l.acompanha ? 'sem mínimo' : null,
                          dura ? `dura ${dura}` : null,
                          foraDaContagemExtra(l) ? 'fora da contagem' : null,
                        ].filter(Boolean).join(' · ')}
                      </p>
                    )}
                    {ultimaProd && (
                      <p className="text-[11px] text-amber-600 mt-0.5">Última produção: {ultimaProd.data} · {fmtQtd(ultimaProd.qty, unidadeDoBanco(ultimaProd.unit))}</p>
                    )}
                  </div>
                  <div className="text-right flex-shrink-0 max-w-[112px]">
                    <p className={`text-sm font-extrabold tabular-nums ${corEstoque(l.situacao)}`}>{fmtQtd(l.estoque, l.unidade)}</p>
                    <div className="mt-0.5"><Etiqueta tom={TOM_ETIQUETA[l.situacao]}>{ROTULO_SITUACAO[l.situacao]}</Etiqueta></div>
                  </div>
                  <button type="button" aria-label={`Entrada de ${l.nome}`} title="Entrada"
                    onClick={(e) => { e.stopPropagation(); abrirEntrada(l.id); }}
                    className="w-[34px] h-[34px] flex-shrink-0 inline-flex items-center justify-center rounded-xl bg-amber-100 hover:bg-amber-200 text-amber-700 cursor-pointer">
                    <i className="ri-add-line text-lg" />
                  </button>
                </div>
              );
            })}
          </div>

          {/* Computador: tabela. Clicar na linha abre a ficha; "+ Entrada" e o ⋯ têm todas as ações */}
          <div className="hidden lg:block bg-white rounded-2xl border border-zinc-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead className="border-b border-zinc-200 bg-zinc-50/60">
                  <tr>
                    <ThOrdenavel label="Insumo" sortKey="nome" extra={{ label: 'Categoria', sortKey: 'categoria' }} current={sortKey} dir={sortDir} onSort={toggleSort} />
                    <ThOrdenavel label="Estoque" sortKey="estoque" align="right" current={sortKey} dir={sortDir} onSort={toggleSort} />
                    <ThOrdenavel label="Mínimo" sortKey="minimo" align="right" current={sortKey} dir={sortDir} onSort={toggleSort} />
                    <ThOrdenavel label="Dura" sortKey="dura" current={sortKey} dir={sortDir} onSort={toggleSort} />
                    <ThOrdenavel label="Preço" sortKey="preco" align="right" current={sortKey} dir={sortDir} onSort={toggleSort} />
                    <ThOrdenavel label="Valor" sortKey="valor" align="right" current={sortKey} dir={sortDir} onSort={toggleSort} />
                    <ThOrdenavel label="Situação" sortKey="status" current={sortKey} dir={sortDir} onSort={toggleSort} />
                    <th className="px-3 py-2.5" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100/80">
                  {visiveis.map((l) => {
                    const dura = textoDura(l.dias);
                    const ultimaProd = l.produzido ? ultimaProducaoPorProduto.get(l.nome) : null;
                    const aberto = expandedPriceId === l.id;
                    const pct = l.minimo > 0 ? Math.min(Math.max(l.estoque, 0) / (l.minimo * 2), 1) * 100 : 0;
                    const problema = l.situacao === 'conferir' || l.situacao === 'esgotado' || l.situacao === 'abaixo';
                    return (
                      <Fragment key={l.id}>
                        <tr onClick={() => abrirFicha(l.id)}
                          title={l.insumo.ultimaEntrada && l.insumo.ultimaEntrada !== '—' ? `Atualizado em ${l.insumo.ultimaEntrada}` : undefined}
                          className={`cursor-pointer transition-colors ${aberto ? 'bg-amber-50/30' : 'hover:bg-amber-50/30'}`}>
                          <td className="px-3 py-2.5 max-w-[320px]">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <p className="font-bold text-zinc-900 truncate">{l.nome}</p>
                              {l.produzido && <span className="flex-shrink-0"><Etiqueta tom="amber">Produzido</Etiqueta></span>}
                            </div>
                            <p className="text-[11.5px] text-zinc-400 mt-0.5 truncate">{subtitulo(l)}</p>
                            {ultimaProd && (
                              <p className="text-[11px] text-amber-600 mt-0.5">Última produção: {ultimaProd.data} · {fmtQtd(ultimaProd.qty, unidadeDoBanco(ultimaProd.unit))}</p>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-right whitespace-nowrap tabular-nums">
                            <p className={`font-extrabold ${corEstoque(l.situacao)}`}>{fmtQtd(l.estoque, l.unidade)}</p>
                            {l.minimo > 0 && (
                              <div className="w-20 h-1.5 bg-zinc-100 rounded-full overflow-hidden ml-auto mt-1">
                                <div className={`h-full rounded-full ${problema ? 'bg-red-500' : 'bg-emerald-500'}`} style={{ width: `${pct}%` }} />
                              </div>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-right whitespace-nowrap tabular-nums">
                            {l.minimo > 0
                              ? <span className="text-zinc-700">{fmtQtd(l.minimo, l.unidade)}</span>
                              : l.acompanha ? <span className="text-amber-700 font-semibold">sem mínimo</span> : <span className="text-zinc-300">—</span>}
                          </td>
                          <td className="px-3 py-2.5 whitespace-nowrap text-zinc-600">{dura ?? <span className="text-zinc-300">—</span>}</td>
                          <td className="px-3 py-2.5 text-right whitespace-nowrap tabular-nums">
                            {/* Clicar no preço abre o histórico de preço do insumo */}
                            <button type="button" onClick={(e) => { e.stopPropagation(); alternarPreco(l.id); }}
                              title="Ver histórico de preço" className="inline-flex flex-col items-end cursor-pointer group">
                              <span className={`font-semibold inline-flex items-center gap-0.5 group-hover:text-amber-600 ${l.preco > 0 ? 'text-zinc-800' : 'text-amber-700'}`}>
                                {fmtPrecoUnit(l.preco, l.unidade)}
                                <i className={`text-xs text-zinc-300 group-hover:text-amber-400 ${aberto ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'}`} />
                              </span>
                              {l.insumo.priceSource === 'average' && (
                                <span className="text-[10px] text-sky-600 font-medium flex items-center gap-0.5"><i className="ri-bar-chart-line" /> Média 3 meses</span>
                              )}
                              {l.insumo.priceSource === 'purchase' && (
                                <span className="text-[10px] text-emerald-600 font-medium flex items-center gap-0.5"><i className="ri-shopping-cart-line" /> Última compra</span>
                              )}
                              {l.insumo.priceSource === 'manual' && (
                                <span className="text-[10px] text-zinc-400 flex items-center gap-0.5"><i className="ri-edit-line" /> Manual</span>
                              )}
                            </button>
                          </td>
                          <td className="px-3 py-2.5 text-right whitespace-nowrap tabular-nums text-zinc-800">
                            {l.valor > 0 ? brl(l.valor) : <span className="text-zinc-300">—</span>}
                          </td>
                          <td className="px-3 py-2.5">
                            <div className="flex flex-col items-start gap-1">
                              <Etiqueta tom={TOM_ETIQUETA[l.situacao]}>{ROTULO_SITUACAO[l.situacao]}</Etiqueta>
                              {foraDaContagemExtra(l) && <Etiqueta tom="zinc">Fora da contagem</Etiqueta>}
                            </div>
                          </td>
                          <td className="px-3 py-2.5">
                            <div className="flex items-center justify-end gap-1.5">
                              <button type="button" onClick={(e) => { e.stopPropagation(); abrirEntrada(l.id); }} className={btn('out', 'sm')}>
                                <i className="ri-add-line text-sm" />Entrada
                              </button>
                              <MenuMais itens={itensMenu(l.insumo, [
                                { rotulo: aberto ? 'Esconder histórico de preço' : 'Ver histórico de preço', icone: 'ri-line-chart-line', onClick: () => alternarPreco(l.id) },
                              ])} />
                            </div>
                          </td>
                        </tr>
                        {aberto && <MiniPriceHistory insumo={l.insumo} colSpan={8} />}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* Confirmações e histórico de compras */}
      {modais}

      {categoriasModal && (
        <CategoriasModal
          categories={categories}
          loading={loadingCategorias}
          onClose={() => setCategoriasModal(false)}
          onAdd={addCategory}
          onRemove={removeCategory}
          onRename={async (id, nome) => {
            // O banco leva o nome novo aos insumos e às fichas de produção; recarrega os dois
            // para a lista e o seletor de categoria não mostrarem mais o nome antigo.
            const r = await renameCategory(id, nome);
            if (!r.error) await Promise.all([reloadInsumos(), reloadProducao()]);
            return r;
          }}
        />
      )}

      {showTemplatesModal && (
        <ImportExportTemplatesModal
          open={showTemplatesModal}
          defaultTab="insumos"
          insumosData={visiveis.map((l) => ({
            nome: l.insumo.nome,
            unidade: l.insumo.unidade,
            categoria: l.insumo.categoria,
            estoqueMinimo: l.insumo.estoqueMinimo,
            fornecedor: l.insumo.fornecedor,
            purchaseUnit: l.insumo.purchaseUnit,
            purchaseFactor: l.insumo.purchaseFactor,
          }))}
          onClose={() => setShowTemplatesModal(false)}
          onSuccess={() => reloadInsumos()}
        />
      )}
    </Pagina>
  );
}

/** Uma pendência do cadastro: o número e o que falta; toque leva ao "Arrumar" só dessa. */
function ChipPendencia({ n, texto, onClick, vermelho = false }: { n: number; texto: string; onClick: () => void; vermelho?: boolean }) {
  return (
    <button type="button" onClick={onClick}
      className={`inline-flex items-center gap-1 h-8 px-3 rounded-full border text-[12.5px] font-semibold cursor-pointer whitespace-nowrap ${
        vermelho ? 'bg-red-50 border-red-200 text-red-700 hover:bg-red-100' : 'bg-white border-zinc-200 text-zinc-700 hover:border-amber-300'}`}>
      <b className="font-extrabold">{n.toLocaleString('pt-BR')}</b> {texto}
    </button>
  );
}
