import { useState, useMemo } from 'react';
import { useProducao } from '@/contexts/ProducaoContext';
import { useEstoque } from '@/contexts/EstoqueContext';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { formatCurrencyPreciso } from '@/lib/formatters';
import { convertUnit } from '@/lib/unitConversion';
import { todayBrasilia, somarDias, dateKeyBrasilia, formatOrderTime } from '@/lib/dateUtils';
import { fmtQtd, fmtPrecoUnit, fmtSugestao, sugestaoCompra, ehProduzido, rotuloUnidade, type InsumoSituacao } from '@/lib/estoqueRegras';
import { esperadoDaProducao, rendimentoMedio, receitasParaProduzir, fichaDoInsumo, unidadeBanco } from '@/lib/estoqueProducao';
import { useEstoqueTela } from '../EstoqueTela';
import FichaProducaoModal from './FichaProducaoModal';
import RegistroProducaoModal from './RegistroProducaoModal';
import DetalheBatchModal from './DetalheBatchModal';
import ConfirmModal from '@/components/base/ConfirmModal';
import type { ProductionRecipe, ProductionBatch, UnidadeEstoque } from '@/types/estoque';
import { Segmented } from '../../financeiro/components/dreUi';
import {
  Pagina, Faixa, Chips, SecaoTitulo, CartaoBarra, CartaoAcao, Vazio, Nota, Etiqueta, MenuMais, btn, semAcento, brl,
  type ItemFaixa, type OpcaoChip,
} from './ui/EstoqueUi';

type SubTab = 'fichas' | 'producoes';
type OrdenacaoFichas = 'nome' | 'itens';
type OrdenacaoProducoes = 'data_desc' | 'custo_desc' | 'receita_desc';
type PeriodoId = 'hoje' | '7d' | '30d' | 'mes' | 'tudo' | 'custom';

const OPCOES_PERIODO: OpcaoChip<PeriodoId>[] = [
  { id: 'hoje', rotulo: 'Hoje' },
  { id: '7d', rotulo: '7 dias' },
  { id: '30d', rotulo: '30 dias' },
  { id: 'mes', rotulo: 'Este mês' },
  { id: 'tudo', rotulo: 'Tudo' },
  { id: 'custom', rotulo: 'Período' },
];

const TZ = 'America/Sao_Paulo';
const pct = (v: number) => `${v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
/** "sáb 27/09" (dia de Brasília) */
const diaCurto = (iso: string) => {
  const d = new Date(iso);
  const semana = d.toLocaleDateString('pt-BR', { weekday: 'short', timeZone: TZ }).replace('.', '');
  return `${semana} ${d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: TZ })}`;
};
const qtdProducao = (b: Pick<ProductionBatch, 'producedQuantity' | 'unit'>) => fmtQtd(b.producedQuantity, unidadeBanco(b.unit));

/** "esperado 1,25 kg (96%)" e, se houve, "perda R$ 2,00" — o que o sistema já guardava e não mostrava. */
function EsperadoReal({ b }: { b: ProductionBatch }) {
  const e = esperadoDaProducao(b);
  const perda = b.lossValue && b.lossValue > 0 ? b.lossValue : 0;
  if (!e && !perda) return null;
  const tom = e && e.pct < 80 ? 'text-red-600 font-semibold' : e && e.pct < 95 ? 'text-amber-700 font-semibold' : 'text-zinc-500';
  return (
    <span className={tom}>
      {e
        ? `esperado ${fmtQtd(e.esperadoQtd, unidadeBanco(b.unit))} (${Math.round(e.pct)}%${perda ? `, perda ${brl(perda)}` : ''})`
        : `perda ${brl(perda)}`}
    </span>
  );
}

// ── Produzir hoje ────────────────────────────────────────────────────────────
function textoSituacao(i: InsumoSituacao) {
  if (i.estoque < 0) return <><em className="not-italic font-bold text-red-600">{fmtQtd(i.estoque, i.unidade)}</em> · o número não vale: conte antes de produzir</>;
  const dias = i.diasRestantes;
  return (
    <>
      {i.estoque <= 0 || i.esgotado
        ? <em className="not-italic font-bold text-red-600">zerado</em>
        : <em className="not-italic font-bold text-amber-700">{fmtQtd(i.estoque, i.unidade)}</em>}
      {i.minimo > 0 && <> · mín. {fmtQtd(i.minimo, i.unidade)}</>}
      {i.consumoDia != null && i.consumoDia > 0 && <> · usa {fmtQtd(i.consumoDia, i.unidade)}/dia</>}
      {dias != null && i.estoque > 0 && <> · acaba em ~{Math.max(1, Math.round(dias))} {Math.round(dias) <= 1 ? 'dia' : 'dias'}</>}
    </>
  );
}

function ProduzirHoje({ onProduzir, onCriarFicha }: {
  onProduzir: (recipeId: string, receitas?: number) => void;
  onCriarFicha: (i: InsumoSituacao) => void;
}) {
  const { recipes, batches } = useProducao();
  const tela = useEstoqueTela();
  const situacao = tela.situacao;

  // Mesma regra do Início: o que a cozinha faz e está abaixo do mínimo. Quem tem número negativo vai por último
  // (primeiro precisa contar).
  const lista = useMemo(() => (situacao?.insumos ?? [])
    .filter((i) => ehProduzido(i) && i.abaixoMinimo)
    .sort((a, b) => (a.estoque < 0 ? 1 : 0) - (b.estoque < 0 ? 1 : 0)
      || (a.esgotado ? -1 : a.diasRestantes ?? 1e9) - (b.esgotado ? -1 : b.diasRestantes ?? 1e9)
      || a.nome.localeCompare(b.nome, 'pt-BR')), [situacao]);

  // Receitas a fazer = quanto falta ÷ o que a ficha rendeu da última vez (a ficha não declara rendimento).
  const abrir = (i: InsumoSituacao, receitaId: string, qtd: number) => {
    const ultima = [...batches].filter((b) => b.recipeId === receitaId)
      .sort((a, b) => b.producedAt.localeCompare(a.producedAt))[0];
    onProduzir(receitaId, receitasParaProduzir(qtd, i.unidade, ultima));
  };

  return (
    <section>
      <SecaoTitulo titulo="Produzir hoje" n={lista.length} tomN={lista.length ? 'amber' : 'zinc'}
        ajuda="O que a cozinha faz (guacamole, cheddar, pastas…) e está abaixo do mínimo. A quantidade é a que leva o estoque a 2× o mínimo." />
      {!situacao ? (
        <p className="text-xs text-zinc-400 px-1">Calculando o que produzir…</p>
      ) : lista.length === 0 ? (
        <CartaoAcao tom="ok" icone="ri-check-line" titulo="Nada para produzir hoje">
          Tudo o que a cozinha faz está acima do mínimo.
        </CartaoAcao>
      ) : (
        <CartaoBarra cor="amber">
          <div className="divide-y divide-zinc-100">
            {lista.map((i) => {
              const ficha = fichaDoInsumo(recipes, i);
              const sug = sugestaoCompra(i, situacao.config.diasCompra);
              return (
                <div key={i.id} className="flex items-center gap-2.5 py-2.5 first:pt-0 last:pb-0">
                  <div className="flex-1 min-w-0">
                    <button type="button" onClick={() => tela.abrirFicha(i.id)}
                      className="block max-w-full text-left text-[13.5px] font-bold text-zinc-900 truncate hover:text-amber-700 cursor-pointer">
                      {i.nome}
                    </button>
                    <p className="text-[11.5px] text-zinc-500 leading-snug">{textoSituacao(i)}</p>
                  </div>
                  {i.estoque < 0 ? (
                    <button type="button" className={btn('out', 'sm')} onClick={() => tela.contar([i], `Contar ${i.nome} antes de produzir`)}>
                      <i className="ri-scales-3-line" />Contar
                    </button>
                  ) : ficha ? (
                    <button type="button" className={btn('dark', 'sm')} onClick={() => abrir(i, ficha.id, sug.qtd)}>
                      Produzir {fmtSugestao(sug, i.unidade)}
                    </button>
                  ) : (
                    <button type="button" className={btn('out', 'sm')} onClick={() => onCriarFicha(i)} title="Este item ainda não tem ficha de produção">
                      <i className="ri-add-line" />Criar ficha
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </CartaoBarra>
      )}
    </section>
  );
}

// ── Fichas ───────────────────────────────────────────────────────────────────
function ListaFichas({ recipes, onEdit, onNovaProducao, onNovaFicha }: {
  recipes: ProductionRecipe[];
  onEdit: (r: ProductionRecipe) => void;
  onNovaProducao: (recipeId: string) => void;
  onNovaFicha: () => void;
}) {
  const { batches, deleteRecipe } = useProducao();
  const { insumos } = useEstoque();
  const toast = useToast();
  const [busca, setBusca] = useState('');
  const [ordenacao, setOrdenacao] = useState<OrdenacaoFichas>('nome');
  const [confirmRecipeId, setConfirmRecipeId] = useState<string | null>(null);
  const [confirmRecipeName, setConfirmRecipeName] = useState('');

  const fichasFiltradas = useMemo(() => {
    const q = semAcento(busca);
    const base = q ? recipes.filter((r) => semAcento(r.name).includes(q)) : recipes;
    return [...base].sort((a, b) => {
      if (ordenacao === 'itens') return b.items.length - a.items.length || a.name.localeCompare(b.name, 'pt-BR');
      return a.name.localeCompare(b.name, 'pt-BR');
    });
  }, [recipes, busca, ordenacao]);

  // Última produção de cada ficha: de lá vêm "rende ~X" e "R$/kg" (a ficha não declara rendimento, ele se pesa).
  const ultimaPorFicha = useMemo(() => {
    const map = new Map<string, ProductionBatch>();
    const novasPrimeiro = [...batches].sort((a, b) => b.producedAt.localeCompare(a.producedAt));
    for (const b of novasPrimeiro) if (!map.has(b.recipeId)) map.set(b.recipeId, b);
    return map;
  }, [batches]);

  const batchCountForRecipe = (recipeId: string) => batches.filter((b) => b.recipeId === recipeId).length;

  // Custo estimado de UMA RECEITA (os insumos da ficha), usando os preços ATUAIS do estoque.
  // NÃO é custo por unidade de saída: o custo por unidade real só existe DEPOIS de uma produção
  // pesada (RegistroProducaoModal.unitCost), e é esse que aparece em "R$/kg" quando há produção.
  const custoEstimadoPorReceita = useMemo(() => {
    const map = new Map<string, number>();
    for (const recipe of recipes) {
      let total = 0;
      for (const it of recipe.items) {
        const insumo = insumos.find((i) => i.id === it.ingredientId);
        if (insumo && insumo.precoUnitario > 0) {
          // Converte a quantidade da ficha pra unidade do insumo no estoque
          const convertedQty = convertUnit(it.quantity, it.unit, insumo.unidade);
          const qty = convertedQty !== null ? convertedQty : it.quantity;
          total += qty * insumo.precoUnitario;
        }
      }
      map.set(recipe.id, total);
    }
    return map;
  }, [recipes, insumos]);

  return (
    <div className="space-y-3">
      <ConfirmModal
        isOpen={!!confirmRecipeId}
        title="Excluir ficha de produção?"
        message={`A ficha "${confirmRecipeName}" será excluída permanentemente. Esta ação não pode ser desfeita.`}
        icon="ri-delete-bin-6-line"
        confirmLabel="Excluir"
        danger
        onConfirm={async () => {
          const id = confirmRecipeId;
          const nome = confirmRecipeName;
          if (!id) return;
          // Espera o servidor: só diz "excluída" se foi mesmo (antes fechava a janela sem esperar nem avisar erro).
          try {
            await deleteRecipe(id);
            toast.success('Ficha excluída', `“${nome}” saiu da lista de fichas.`);
          } catch (e) {
            toast.error('Não foi possível excluir a ficha', e instanceof Error ? e.message : String(e));
          } finally {
            setConfirmRecipeId(null);
            setConfirmRecipeName('');
          }
        }}
        onCancel={() => {
          setConfirmRecipeId(null);
          setConfirmRecipeName('');
        }}
      />

      {/* Busca + ordenação */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <i className="ri-search-line absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400 text-base pointer-events-none" />
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar ficha de produção…"
            className="w-full h-[42px] rounded-xl border border-zinc-200 pl-10 pr-3 text-[13.5px] bg-white text-zinc-700 placeholder-zinc-400 focus:outline-none focus:border-amber-400"
          />
        </div>
        <div className="overflow-x-auto max-w-full">
          <Segmented<OrdenacaoFichas>
            value={ordenacao}
            onChange={setOrdenacao}
            options={[
              { id: 'nome', label: 'Nome', icon: 'ri-sort-alphabet-asc' },
              { id: 'itens', label: 'Mais insumos', icon: 'ri-stack-line' },
            ]}
          />
        </div>
      </div>

      {fichasFiltradas.length === 0 ? (
        <Vazio icone="ri-file-list-3-line" titulo={busca ? 'Nenhuma ficha encontrada' : 'Ainda não há ficha de produção'}
          acao={!busca ? <button type="button" className={btn('p', 'sm')} onClick={onNovaFicha}><i className="ri-add-line" />Criar a primeira ficha</button> : undefined}>
          {busca ? 'Tente outro nome.' : 'A ficha diz quais insumos viram o produto pronto (guacamole, cheddar…). Com ela, a produção desconta os insumos e soma o produto no estoque.'}
        </Vazio>
      ) : (
        <div className="bg-white border border-zinc-200 rounded-2xl divide-y divide-zinc-100">
          {fichasFiltradas.map((recipe) => {
            const custoReceita = custoEstimadoPorReceita.get(recipe.id) ?? 0;
            const batchCount = batchCountForRecipe(recipe.id);
            const ultima = ultimaPorFicha.get(recipe.id);
            const unidadeFicha = unidadeBanco(ultima?.unit ?? recipe.unit);
            const previa = recipe.items.slice(0, 3).map((it) => `${it.ingredientName} ${fmtQtd(it.quantity, unidadeBanco(it.unit))}`).join(' · ');
            return (
              <div key={recipe.id} className="flex items-start gap-2.5 px-3.5 py-3">
                <span className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 bg-amber-50 text-amber-700"><i className="ri-knife-line text-base" /></span>
                <div className="flex-1 min-w-0">
                  <p className="text-[13.5px] font-bold text-zinc-900 flex items-center gap-1.5 min-w-0">
                    <span className="truncate">{recipe.name}</span>
                    {!recipe.isActive && <Etiqueta>inativa</Etiqueta>}
                  </p>
                  <p className="text-[11.5px] text-zinc-500 leading-snug">
                    {ultima
                      ? <>rende ~{fmtQtd(ultima.producedQuantity, unidadeFicha)} · {fmtPrecoUnit(ultima.unitCost, unidadeFicha)} · </>
                      : <>ainda sem produção · </>}
                    {recipe.items.length} {recipe.items.length === 1 ? 'insumo' : 'insumos'}
                  </p>
                  {previa && (
                    <p className="text-[11px] text-zinc-400 leading-snug truncate">
                      {previa}{recipe.items.length > 3 ? ` · +${recipe.items.length - 3}` : ''}
                    </p>
                  )}
                  <p className="text-[11px] text-zinc-400">
                    Custo estimado (1 receita): <span className="font-semibold text-zinc-600">{brl(custoReceita)}</span>
                    {batchCount > 0 && <> · {batchCount} {batchCount === 1 ? 'produção' : 'produções'}</>}
                  </p>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <button type="button" className={btn('out', 'sm')} onClick={() => onNovaProducao(recipe.id)}>Produzir</button>
                  <MenuMais rotulo="Mais ações da ficha" itens={[
                    { rotulo: 'Editar ficha', icone: 'ri-edit-line', onClick: () => onEdit(recipe) },
                    { rotulo: 'Excluir ficha', icone: 'ri-delete-bin-line', perigo: true, onClick: () => { setConfirmRecipeId(recipe.id); setConfirmRecipeName(recipe.name); } },
                  ]} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Últimas produções (resumo na aba Fichas) ──────────────────────────────────
function UltimasProducoes({ batches, onVerDetalhe, onVerTodas }: {
  batches: ProductionBatch[];
  onVerDetalhe: (b: ProductionBatch) => void;
  onVerTodas: () => void;
}) {
  const ultimas = useMemo(() => [...batches].sort((a, b) => b.producedAt.localeCompare(a.producedAt)).slice(0, 5), [batches]);
  return (
    <div className="space-y-2">
      <SecaoTitulo titulo="Últimas produções"
        direita={batches.length > 5 ? <button type="button" onClick={onVerTodas} className="text-xs font-bold text-amber-700 hover:underline cursor-pointer">Ver todas</button> : undefined} />
      {ultimas.length === 0 ? (
        <Vazio icone="ri-archive-drawer-line" titulo="Nenhuma produção registrada">
          Toque em “Produzir” numa ficha para registrar a primeira.
        </Vazio>
      ) : (
        <div className="bg-white border border-zinc-200 rounded-2xl divide-y divide-zinc-100">
          {ultimas.map((b) => (
            <button key={b.id} type="button" onClick={() => onVerDetalhe(b)}
              className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-left cursor-pointer hover:bg-zinc-50">
              <div className="flex-1 min-w-0">
                <p className="text-[13.5px] font-bold text-zinc-900 truncate">{b.recipeName} · {qtdProducao(b)}</p>
                <p className="text-[11.5px] text-zinc-400 leading-snug">
                  {diaCurto(b.producedAt)} · {b.producedBy || '—'}
                  {(esperadoDaProducao(b) || (b.lossValue ?? 0) > 0) && <> · <EsperadoReal b={b} /></>}
                </p>
              </div>
              <p className="text-sm font-extrabold text-zinc-900 tabular-nums flex-shrink-0">{brl(b.totalCost)}</p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Registros de produção ───────────────────────────────────────────────────
function ListaProducoes({ batches, onVerDetalhe, temPeriodo }: {
  /** Já filtradas pelo período escolhido no topo da aba */
  batches: ProductionBatch[];
  onVerDetalhe: (batch: ProductionBatch) => void;
  temPeriodo: boolean;
}) {
  const { deleteBatch } = useProducao();
  const toast = useToast();
  const [busca, setBusca] = useState('');
  const [ordenacao, setOrdenacao] = useState<OrdenacaoProducoes>('data_desc');
  const [confirmBatchId, setConfirmBatchId] = useState<string | null>(null);
  const [confirmBatchName, setConfirmBatchName] = useState('');

  const producoesFiltradas = useMemo(() => {
    const q = semAcento(busca);
    const base = q ? batches.filter((b) => semAcento(b.recipeName).includes(q)) : batches;
    return [...base].sort((a, b) => {
      if (ordenacao === 'data_desc')
        return new Date(b.producedAt).getTime() - new Date(a.producedAt).getTime();
      if (ordenacao === 'custo_desc') return b.totalCost - a.totalCost;
      return b.producedQuantity - a.producedQuantity;
    });
  }, [batches, busca, ordenacao]);

  const rendClasse = (y: number) => (y >= 70 ? 'text-emerald-700 bg-emerald-50' : y >= 40 ? 'text-amber-700 bg-amber-50' : 'text-red-700 bg-red-50');

  return (
    <div className="space-y-3">
      <ConfirmModal
        isOpen={!!confirmBatchId}
        title="Excluir registro de produção?"
        message={`O registro "${confirmBatchName}" será excluído e o estoque volta ao que era antes dele: os insumos usados voltam e o que foi produzido sai. Insumo contado depois desta produção fica como está.`}
        icon="ri-delete-bin-6-line"
        confirmLabel="Excluir"
        danger
        onConfirm={async () => {
          const id = confirmBatchId;
          setConfirmBatchId(null);
          setConfirmBatchName('');
          if (!id) return;
          // Antes não esperava nem mostrava erro (e o estoque não voltava).
          try {
            const r = await deleteBatch(id);
            toast.success('Produção excluída', r.estornados === 0 && !r.pulados.length
              ? 'Não havia movimento de estoque para desfazer.'
              : r.pulados.length
                ? `Estoque devolvido. Ficaram como estão (contados depois): ${r.pulados.join(', ')}.`
                : 'Estoque devolvido ao que era antes dela.');
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            if (msg.includes('já foi excluída')) toast.info('Produção já excluída', 'Nada mudou no estoque.');
            else toast.error('Não foi possível excluir a produção', msg);
          }
        }}
        onCancel={() => {
          setConfirmBatchId(null);
          setConfirmBatchName('');
        }}
      />

      {/* Busca + ordenação */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <i className="ri-search-line absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400 text-base pointer-events-none" />
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar registro de produção…"
            className="w-full h-[42px] rounded-xl border border-zinc-200 pl-10 pr-3 text-[13.5px] bg-white text-zinc-700 placeholder-zinc-400 focus:outline-none focus:border-amber-400"
          />
        </div>
        <div className="overflow-x-auto max-w-full">
          <Segmented<OrdenacaoProducoes>
            value={ordenacao}
            onChange={setOrdenacao}
            options={[
              { id: 'data_desc', label: 'Mais recente', icon: 'ri-time-line' },
              { id: 'custo_desc', label: 'Maior custo', icon: 'ri-money-dollar-circle-line' },
              { id: 'receita_desc', label: 'Maior produção', icon: 'ri-sort-desc' },
            ]}
          />
        </div>
        {(temPeriodo || busca) && (
          <span className="text-xs font-semibold text-amber-600 whitespace-nowrap">
            {producoesFiltradas.length} resultado{producoesFiltradas.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {producoesFiltradas.length === 0 ? (
        <Vazio icone="ri-archive-drawer-line" titulo="Nenhum registro de produção">
          {temPeriodo || busca ? 'Tente outro período ou outra busca.' : 'Registre produções a partir das fichas de produção.'}
        </Vazio>
      ) : (
        <div className="bg-white rounded-2xl border border-zinc-200 overflow-hidden">
          {/* Computador */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="bg-zinc-50/70 border-b border-zinc-200">
                  {[['Produto', 'text-left'], ['Data', 'text-center'], ['Produzido', 'text-right'], ['Rendimento', 'text-center'], ['Perda', 'text-right'], ['Custo total', 'text-right'], ['Custo/un', 'text-right'], ['Operador', 'text-center'], ['', 'text-right']].map(([t, c], k) => (
                    <th key={k} className={`px-4 py-2.5 ${c} text-[10.5px] font-extrabold uppercase tracking-wide text-zinc-400 whitespace-nowrap`}>{t}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {producoesFiltradas.map((batch) => {
                  const e = esperadoDaProducao(batch);
                  return (
                    <tr key={batch.id} className="hover:bg-zinc-50 transition-colors">
                      <td className="px-4 py-3">
                        <p className="font-bold text-zinc-900 truncate max-w-[240px]" title={batch.recipeName}>{batch.recipeName}</p>
                        {batch.notes && <p className="text-[11px] text-zinc-400 truncate max-w-[200px]">{batch.notes}</p>}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <p className="font-medium text-zinc-700">{diaCurto(batch.producedAt)}</p>
                        <p className="text-[11px] text-zinc-400">{formatOrderTime(batch.producedAt)}</p>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums whitespace-nowrap font-bold text-zinc-900">{qtdProducao(batch)}</td>
                      <td className="px-4 py-3 text-center">
                        <div className="flex flex-col items-center">
                          {batch.yieldPercentActual !== null ? (
                            <span className={`inline-block px-2 py-0.5 rounded-md text-[11px] font-semibold ${rendClasse(batch.yieldPercentActual)}`}>
                              {pct(batch.yieldPercentActual)}
                            </span>
                          ) : <span className="text-[11px] text-zinc-400">—</span>}
                          {e && batch.yieldPercentExpected !== null && (
                            <span className="text-[10px] text-zinc-400 mt-0.5" title="Média das produções anteriores desta ficha">
                              esperado {fmtQtd(e.esperadoQtd, unidadeBanco(batch.unit))} ({Math.round(e.pct)}%)
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right">
                        {batch.lossQuantityKg && batch.lossQuantityKg > 0 ? (
                          <div>
                            <p className="text-[11px] font-semibold text-red-600">{fmtQtd(batch.lossQuantityKg, 'kg')}</p>
                            {batch.lossValue ? <p className="text-[11px] text-red-400">{brl(batch.lossValue)}</p> : null}
                          </div>
                        ) : <span className="text-zinc-300">—</span>}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums whitespace-nowrap font-semibold text-zinc-800">{brl(batch.totalCost)}</td>
                      <td className="px-4 py-3 text-right tabular-nums whitespace-nowrap text-zinc-600">
                        {formatCurrencyPreciso(batch.unitCost)}/{rotuloUnidade(unidadeBanco(batch.unit))}
                      </td>
                      <td className="px-4 py-3 text-center text-zinc-600">{batch.producedBy}</td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button type="button" onClick={() => onVerDetalhe(batch)} title="Ver detalhes"
                            className="w-8 h-8 flex items-center justify-center text-zinc-400 hover:text-amber-500 cursor-pointer transition-colors">
                            <i className="ri-eye-line text-base" />
                          </button>
                          <button type="button" title="Excluir"
                            onClick={() => { setConfirmBatchId(batch.id); setConfirmBatchName(batch.recipeName); }}
                            className="w-8 h-8 flex items-center justify-center text-zinc-400 hover:text-red-500 cursor-pointer transition-colors">
                            <i className="ri-delete-bin-line text-base" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Celular */}
          <div className="md:hidden divide-y divide-zinc-100">
            {producoesFiltradas.map((batch) => (
              <div key={batch.id} className="p-3.5">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-[13.5px] font-bold text-zinc-900">{batch.recipeName} · {qtdProducao(batch)}</p>
                    <p className="text-[11.5px] text-zinc-400 leading-snug">
                      {diaCurto(batch.producedAt)} · {formatOrderTime(batch.producedAt)} · {batch.producedBy || '—'}
                    </p>
                    {(esperadoDaProducao(batch) || (batch.lossValue ?? 0) > 0) && (
                      <p className="text-[11.5px] leading-snug"><EsperadoReal b={batch} /></p>
                    )}
                  </div>
                  {batch.yieldPercentActual !== null ? (
                    <span className={`flex-shrink-0 px-2 py-0.5 rounded-md text-[11px] font-semibold ${rendClasse(batch.yieldPercentActual)}`}>
                      {pct(batch.yieldPercentActual)}
                    </span>
                  ) : <span className="text-[11px] text-zinc-400">—</span>}
                </div>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs text-zinc-500">
                    Custo total <b className="text-zinc-900">{brl(batch.totalCost)}</b> · {formatCurrencyPreciso(batch.unitCost)}/{rotuloUnidade(unidadeBanco(batch.unit))}
                  </p>
                  <div className="flex items-center gap-1.5">
                    <button type="button" className={btn('out', 'sm')} onClick={() => onVerDetalhe(batch)}>
                      <i className="ri-eye-line" />Detalhes
                    </button>
                    <button type="button" aria-label="Excluir registro"
                      onClick={() => { setConfirmBatchId(batch.id); setConfirmBatchName(batch.recipeName); }}
                      className="w-[34px] h-[34px] flex items-center justify-center rounded-xl border border-zinc-200 text-zinc-400 hover:text-red-500 cursor-pointer transition-colors">
                      <i className="ri-delete-bin-line text-base" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Aba principal ──────────────────────────────────────────────────────────────
export default function ProducaoTab() {
  const { recipes, batches, loading, error } = useProducao();
  const { user } = useAuth();
  const [subTab, setSubTab] = useState<SubTab>('fichas');
  const [showFichaModal, setShowFichaModal] = useState(false);
  const [showProducaoModal, setShowProducaoModal] = useState(false);
  const [showDetalheModal, setShowDetalheModal] = useState(false);
  const [editingRecipe, setEditingRecipe] = useState<ProductionRecipe | null>(null);
  /** "Criar ficha" a partir do Produzir hoje: já vem com o nome e a unidade do insumo */
  const [fichaNova, setFichaNova] = useState<{ nome: string; unidade?: UnidadeEstoque } | null>(null);
  const [producaoRecipeId, setProducaoRecipeId] = useState<string>('');
  const [producaoReceitas, setProducaoReceitas] = useState<number | undefined>(undefined);
  const [detalheBatch, setDetalheBatch] = useState<ProductionBatch | null>(null);

  // Período (dias de Brasília) dos números e dos registros. Padrão: 30 dias, como no layout aprovado.
  const hoje = todayBrasilia();
  const [periodo, setPeriodo] = useState<PeriodoId>('30d');
  const [customDe, setCustomDe] = useState(() => somarDias(todayBrasilia(), -29));
  const [customAte, setCustomAte] = useState(() => todayBrasilia());
  const { de, ate } = useMemo<{ de: string | null; ate: string | null }>(() => {
    switch (periodo) {
      case 'hoje': return { de: hoje, ate: hoje };
      case '7d': return { de: somarDias(hoje, -6), ate: hoje };
      case '30d': return { de: somarDias(hoje, -29), ate: hoje };
      case 'mes': return { de: hoje.slice(0, 8) + '01', ate: hoje };
      case 'tudo': return { de: null, ate: null };
      default: return { de: customDe || null, ate: customAte || null };
    }
  }, [periodo, hoje, customDe, customAte]);
  const rotuloPeriodo = periodo === 'hoje' ? 'hoje' : periodo === '7d' ? 'em 7 dias' : periodo === '30d' ? 'em 30 dias'
    : periodo === 'mes' ? 'neste mês' : periodo === 'tudo' ? 'no histórico' : 'no período';

  // Registros do período — usados nos números E na lista
  const batchesFiltrados = useMemo(() => {
    if (!de && !ate) return batches;
    return batches.filter((b) => {
      const k = dateKeyBrasilia(b.producedAt);
      return (!de || k >= de) && (!ate || k <= ate);
    });
  }, [batches, de, ate]);

  const rendimento = rendimentoMedio(batchesFiltrados);
  const custoTotal = batchesFiltrados.reduce((s, b) => s + b.totalCost, 0);
  const fichasAtivas = recipes.filter((r) => r.isActive).length;

  const itensFaixa: ItemFaixa[] = [
    { valor: String(fichasAtivas), rotulo: 'fichas de produção' },
    { valor: String(batchesFiltrados.length), rotulo: `produções ${rotuloPeriodo}`, onClick: () => setSubTab('producoes') },
    { valor: rendimento === null ? '—' : pct(rendimento), rotulo: 'rendimento médio', tom: 'amber',
      ajuda: 'Quanto do que entra de insumo vira produto pronto, na média das produções do período.' },
    { valor: brl(custoTotal), rotulo: `custo ${rotuloPeriodo}` },
  ];

  const abrirNovaFicha = (pre?: { nome: string; unidade?: UnidadeEstoque }) => {
    setEditingRecipe(null);
    setFichaNova(pre ?? null);
    setShowFichaModal(true);
  };

  const handleEdit = (recipe: ProductionRecipe) => {
    setEditingRecipe(recipe);
    setFichaNova(null);
    setShowFichaModal(true);
  };

  const handleNovaProducao = (recipeId: string, receitas?: number) => {
    setProducaoRecipeId(recipeId);
    setProducaoReceitas(receitas);
    setShowProducaoModal(true);
  };

  const handleVerDetalhe = (batch: ProductionBatch) => {
    setDetalheBatch(batch);
    setShowDetalheModal(true);
  };

  // Insumo (unidade do banco) → unidade da ficha
  const unidadeFicha = (u: string): UnidadeEstoque | undefined =>
    u === 'unit' ? 'un' : u === 'L' ? 'l' : (['kg', 'g', 'ml'] as const).find((x) => x === u);

  return (
    <Pagina>
      {/* Começa pelo que precisa ser feito */}
      <ProduzirHoje
        onProduzir={handleNovaProducao}
        onCriarFicha={(i) => abrirNovaFicha({ nome: i.nome, unidade: unidadeFicha(i.unidade) })}
      />

      {error && (
        <Nota>Não consegui atualizar as fichas e as produções agora; estou mostrando o que ficou salvo neste aparelho. {error}</Nota>
      )}

      {/* Período + números */}
      <div className="space-y-2">
        <Chips opcoes={OPCOES_PERIODO} valor={periodo} onChange={(p) => setPeriodo(p)} />
        {periodo === 'custom' && (
          <div className="flex items-center gap-3 flex-wrap">
            <label className="flex items-center gap-1.5 text-xs text-zinc-500 font-semibold">
              De
              <input type="date" value={customDe} max={hoje}
                onChange={(e) => { setCustomDe(e.target.value); if (e.target.value > customAte) setCustomAte(e.target.value); }}
                className="h-9 text-xs border border-zinc-200 rounded-xl px-3 text-zinc-700 bg-white focus:outline-none focus:border-amber-400 cursor-pointer" />
            </label>
            <label className="flex items-center gap-1.5 text-xs text-zinc-500 font-semibold">
              Até
              <input type="date" value={customAte} max={hoje}
                onChange={(e) => { setCustomAte(e.target.value); if (e.target.value < customDe) setCustomDe(e.target.value); }}
                className="h-9 text-xs border border-zinc-200 rounded-xl px-3 text-zinc-700 bg-white focus:outline-none focus:border-amber-400 cursor-pointer" />
            </label>
          </div>
        )}
      </div>
      <Faixa itens={itensFaixa} />

      {/* Fichas / Registros + nova ficha */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="overflow-x-auto max-w-full">
          <Segmented<SubTab>
            value={subTab}
            onChange={setSubTab}
            options={[
              { id: 'fichas', label: `Fichas de produção (${recipes.length})`, icon: 'ri-file-list-3-line' },
              { id: 'producoes', label: `Registros de produção (${batches.length})`, icon: 'ri-archive-drawer-line' },
            ]}
          />
        </div>
        {subTab === 'fichas' && (
          <button type="button" className={`${btn('p', 'sm')} ml-auto`} onClick={() => abrirNovaFicha()}>
            <i className="ri-add-line" />Nova ficha
          </button>
        )}
      </div>

      {/* Carregando */}
      {loading && (
        <div className="py-14 text-center">
          <i className="ri-loader-4-line animate-spin text-4xl text-zinc-200 block mb-2" />
          <span className="text-zinc-400 text-sm">Carregando…</span>
        </div>
      )}

      {/* Conteúdo */}
      {!loading && subTab === 'fichas' && (
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-4 items-start">
          <ListaFichas
            recipes={recipes}
            onEdit={handleEdit}
            onNovaProducao={(id) => handleNovaProducao(id)}
            onNovaFicha={() => abrirNovaFicha()}
          />
          <UltimasProducoes batches={batches} onVerDetalhe={handleVerDetalhe} onVerTodas={() => setSubTab('producoes')} />
        </div>
      )}
      {!loading && subTab === 'producoes' && (
        <ListaProducoes batches={batchesFiltrados} onVerDetalhe={handleVerDetalhe} temPeriodo={periodo !== 'tudo'} />
      )}

      {/* Modais */}
      {showFichaModal && (
        <FichaProducaoModal
          recipe={editingRecipe}
          nomeInicial={fichaNova?.nome}
          unidadeInicial={fichaNova?.unidade}
          onClose={() => {
            setShowFichaModal(false);
            setEditingRecipe(null);
            setFichaNova(null);
          }}
        />
      )}
      {showProducaoModal && (
        <RegistroProducaoModal
          recipeId={producaoRecipeId}
          receitasIniciais={producaoReceitas}
          onClose={() => setShowProducaoModal(false)}
          operador={user?.nome ?? 'Operador'}
        />
      )}
      {showDetalheModal && detalheBatch && (
        <DetalheBatchModal
          batch={detalheBatch}
          onClose={() => {
            setShowDetalheModal(false);
            setDetalheBatch(null);
          }}
        />
      )}
    </Pagina>
  );
}
