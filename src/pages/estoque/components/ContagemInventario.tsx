import { useState, useMemo, useEffect, Fragment } from 'react';
import { useEstoque, type InventarioItemContado, type Insumo } from '../../../contexts/EstoqueContext';
import { useAuth } from '../../../contexts/AuthContext';
import ConfirmarInventarioModal from './ConfirmarInventarioModal';

interface InventarioDraft {
  /** Valores digitados, na unidade de CONTAGEM de cada insumo. */
  contagens: Record<string, string>;
  /** Fator de contagem de cada insumo quando o rascunho foi salvo (ausente = 1, rascunho antigo). */
  fatores?: Record<string, number>;
  savedAt: string;
  operador: string;
}

interface Props {
  operador: string;
  onConcluido: () => void;
  onCancelar: () => void;
  /** Se true, ignora rascunho existente e começa do zero */
  startFresh?: boolean;
}

const SEM_CATEGORIA = 'Sem categoria';
const catDe = (c: string | undefined) => (c && c.trim() ? c.trim() : SEM_CATEGORIA);
// Ordem das categorias: alfabética, "Sem categoria" por último.
const compararCategoria = (a: string, b: string) => {
  if (a === b) return 0;
  if (a === SEM_CATEGORIA) return 1;
  if (b === SEM_CATEGORIA) return -1;
  return a.localeCompare(b, 'pt-BR');
};

// Unidade de contagem: a equipe pode contar em pacote e o estoque ficar em kg.
// O digitado fica na unidade de contagem; tudo que é gravado/comparado volta para a do estoque.
const fatorDe = (i: Insumo) => (i.unidadeContagem && i.fatorContagem && i.fatorContagem > 0 ? i.fatorContagem : 1);
const rotuloDe = (i: Insumo) => (fatorDe(i) !== 1 ? (i.unidadeContagem as string) : i.unidade);
const arred = (n: number, casas: number) => Math.round(n * 10 ** casas) / 10 ** casas;
/** Valor inicial do campo: o teórico convertido para a unidade de contagem. */
const preenchido = (i: Insumo) => String(arred(i.estoqueAtual / fatorDe(i), 3));
const qtdBR = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 3 });

// Busca sem acento e sem diferença de maiúscula ("acucar" acha "Açúcar").
const normalizar = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

const fmt = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

export default function ContagemInventario({ operador, onConcluido, onCancelar, startFresh }: Props) {
  const { insumos: todosInsumos } = useEstoque();
  // Insumo marcado como "fora do inventário" existe para lançamentos, mas não é contado.
  const insumos = useMemo(() => todosInsumos.filter((i) => i.contaInventario), [todosInsumos]);
  const { confirmarInventario } = useEstoque();
  const { user } = useAuth();
  const tenantId = user?.tenantId ?? '';

  const getDraftKey = () => `erpos_inventario_draft_${tenantId}`;

  // Tenta carregar rascunho do localStorage (a menos que startFresh)
  const carregarRascunho = (): Record<string, string> | null => {
    if (!tenantId) return null;
    try {
      const raw = localStorage.getItem(getDraftKey());
      if (!raw) return null;
      const draft: InventarioDraft = JSON.parse(raw);
      if (!draft.contagens || Object.keys(draft.contagens).length === 0) return null;
      // Se a unidade de contagem mudou desde que o rascunho foi salvo, reconverte o número
      // (ex.: salvo em kg, agora conta em pacote) para não gravar pacote como se fosse kg.
      const convertido: Record<string, string> = {};
      for (const [id, valor] of Object.entries(draft.contagens)) {
        const ins = insumos.find((i) => i.id === id);
        const fatorAntes = draft.fatores?.[id] ?? 1;
        const n = parseFloat(valor);
        if (!ins || valor === '' || isNaN(n) || fatorAntes === fatorDe(ins)) { convertido[id] = valor; continue; }
        convertido[id] = String(arred((n * fatorAntes) / fatorDe(ins), 3));
      }
      return convertido;
    } catch {
      return null;
    }
  };

  const salvarRascunho = () => {
    if (!tenantId) return;
    try {
      const draft: InventarioDraft = {
        contagens,
        fatores: Object.fromEntries(insumos.map((i) => [i.id, fatorDe(i)])),
        savedAt: new Date().toISOString(),
        operador,
      };
      localStorage.setItem(getDraftKey(), JSON.stringify(draft));
      setRascunhoSalvo(true);
    } catch {
      // localStorage cheio ou indisponível
    }
  };

  const limparRascunho = () => {
    if (!tenantId) return;
    try { localStorage.removeItem(getDraftKey()); } catch { /* ignore */ }
  };

  // Mapa: insumoId → quantidade digitada (string para permitir vazio/decimal)
  const [contagens, setContagens] = useState<Record<string, string>>(() => {
    if (startFresh) {
      if (tenantId) { try { localStorage.removeItem(getDraftKey()); } catch { /* ignore */ } }
      const init: Record<string, string> = {};
      insumos.forEach((i) => { init[i.id] = preenchido(i); });
      return init;
    }
    const draft = carregarRascunho();
    if (draft) {
      // Garante que novos insumos (não presentes no rascunho) tenham valor padrão
      const merged: Record<string, string> = {};
      insumos.forEach((i) => {
        merged[i.id] = draft[i.id] ?? preenchido(i);
      });
      return merged;
    }
    const init: Record<string, string> = {};
    insumos.forEach((i) => { init[i.id] = preenchido(i); });
    return init;
  });

  /** Contado convertido para a unidade do ESTOQUE (NaN = vazio/inválido). Campo intocado = teórico exato. */
  const contadoEstoque = (i: Insumo): number => {
    const raw = contagens[i.id] ?? '';
    if (raw === '') return NaN;
    if (raw === preenchido(i)) return i.estoqueAtual;
    const n = parseFloat(raw);
    return isNaN(n) ? NaN : arred(n * fatorDe(i), 4);
  };
  const temDiferenca = (i: Insumo) => {
    const c = contadoEstoque(i);
    return !isNaN(c) && Math.abs(c - i.estoqueAtual) > 0.00005;
  };

  const [categoriaFiltro, setCategoriaFiltro] = useState('Todas');
  const [busca, setBusca] = useState('');
  const [apenasComDiff, setApenasComDiff] = useState(false);
  const [showConfirmar, setShowConfirmar] = useState(false);
  const [confirmado, setConfirmado] = useState(false);
  const [rascunhoSalvo, setRascunhoSalvo] = useState(false);
  const [showCancelarModal, setShowCancelarModal] = useState(false);

  // Limpa flag de "salvo" após 2 segundos
  useEffect(() => {
    if (rascunhoSalvo) {
      const t = setTimeout(() => setRascunhoSalvo(false), 2000);
      return () => clearTimeout(t);
    }
  }, [rascunhoSalvo]);

  // Verifica se tem rascunho carregado (para mostrar badge)
  const temRascunhoCarregado = useMemo(() => {
    const draft = carregarRascunho();
    return draft !== null && Object.keys(draft).length > 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contagens]);

  const handleChange = (id: string, value: string) => {
    setContagens((prev) => ({ ...prev, [id]: value }));
  };

  const insumosFiltrados = useMemo(() => {
    return insumos
      .filter((i) => categoriaFiltro === 'Todas' || catDe(i.categoria) === categoriaFiltro)
      .filter((i) => {
        const q = normalizar(busca);
        return !q || normalizar(i.nome).includes(q);
      })
      .filter((i) => !apenasComDiff || temDiferenca(i));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [insumos, categoriaFiltro, busca, apenasComDiff, contagens]);

  // Contagem em sequência: insumos da mesma categoria sempre juntos (categoria em ordem
  // alfabética, "Sem categoria" por último; nome em ordem alfabética dentro dela).
  const grupos = useMemo(() => {
    const porCategoria = new Map<string, typeof insumosFiltrados>();
    for (const i of insumosFiltrados) {
      const c = catDe(i.categoria);
      const arr = porCategoria.get(c) ?? [];
      arr.push(i);
      porCategoria.set(c, arr);
    }
    return Array.from(porCategoria.entries())
      .sort(([a], [b]) => compararCategoria(a, b))
      .map(([categoria, itens]) => ({
        categoria,
        itens: [...itens].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')),
      }));
  }, [insumosFiltrados]);

  const categoriasDisponiveis = useMemo(
    () => Array.from(new Set(insumos.map((i) => catDe(i.categoria)))).sort(compararCategoria),
    [insumos],
  );

  // Calcula os itens com diferença para o resumo inferior
  const itensComDiferenca = useMemo(() => {
    return insumos.filter(temDiferenca);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [insumos, contagens]);

  const valorImpacto = useMemo(() => {
    return itensComDiferenca.reduce((s, i) => s + (contadoEstoque(i) - i.estoqueAtual) * i.precoUnitario, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itensComDiferenca, contagens]);

  // Monta a lista final de itens para confirmar
  const itensParaConfirmar: InventarioItemContado[] = useMemo(() => {
    return insumos.map((i) => {
      const contado = contadoEstoque(i);
      const qtdContada = isNaN(contado) ? i.estoqueAtual : contado;
      return {
        insumoId: i.id,
        insumoNome: i.nome,
        unidade: i.unidade,
        qtdTeorica: i.estoqueAtual,
        qtdContada,
        diferenca: parseFloat((qtdContada - i.estoqueAtual).toFixed(4)),
        precoUnitario: i.precoUnitario,
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [insumos, contagens]);

  const handleConfirmar = () => {
    confirmarInventario(itensParaConfirmar, operador);
    limparRascunho();
    setShowConfirmar(false);
    setConfirmado(true);
    setTimeout(() => onConcluido(), 2000);
  };

  const handleCancelarContagem = () => {
    // Se não tem nada alterado, cancela direto
    const temAlteracao = itensComDiferenca.length > 0 || temRascunhoCarregado;
    if (!temAlteracao) {
      limparRascunho();
      onCancelar();
      return;
    }
    setShowCancelarModal(true);
  };

  const handleDescartarESair = () => {
    limparRascunho();
    setShowCancelarModal(false);
    onCancelar();
  };

  const handleSalvarRascunhoESair = () => {
    salvarRascunho();
    setShowCancelarModal(false);
    onCancelar();
  };

  if (confirmado) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <div className="w-16 h-16 flex items-center justify-center bg-emerald-50 rounded-full mb-4">
          <i className="ri-check-double-line text-3xl text-emerald-500" />
        </div>
        <h3 className="text-base font-bold text-zinc-800 mb-1">Inventário Confirmado!</h3>
        <p className="text-sm text-zinc-500">Estoque atualizado · {itensComDiferenca.length} ajuste{itensComDiferenca.length !== 1 ? 's' : ''} registrado{itensComDiferenca.length !== 1 ? 's' : ''}</p>
        <div className="flex items-center gap-2 mt-4 text-zinc-400 text-xs">
          <i className="ri-loader-4-line animate-spin" />
          Voltando ao histórico...
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header da contagem */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <p className="text-sm font-bold text-zinc-800">Nova Contagem de Inventário</p>
            {temRascunhoCarregado && (
              <span className="text-[10px] font-bold bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">
                Rascunho carregado
              </span>
            )}
          </div>
          <p className="text-xs text-zinc-500">Operador: <span className="font-semibold">{operador}</span> · {insumos.length} insumos a contar</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={salvarRascunho}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold border border-amber-300 text-amber-700 bg-amber-50 hover:bg-amber-100 rounded-lg cursor-pointer transition-colors whitespace-nowrap"
          >
            <i className={`text-sm ${rascunhoSalvo ? 'ri-check-line text-emerald-500' : 'ri-save-line'}`} />
            {rascunhoSalvo ? 'Salvo!' : 'Salvar Rascunho'}
          </button>
          <button
            onClick={handleCancelarContagem}
            className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-red-500 cursor-pointer transition-colors whitespace-nowrap"
          >
            <i className="ri-close-line text-sm" />
            Cancelar contagem
          </button>
        </div>
      </div>

      {/* Busca: filtra pelo nome enquanto digita */}
      <div className="relative">
        <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 text-sm pointer-events-none" />
        <input
          type="search"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar insumo..."
          className="w-full h-10 md:h-9 pl-9 pr-9 text-base md:text-sm border border-zinc-200 rounded-lg bg-white text-zinc-800 focus:outline-none focus:border-amber-400"
        />
        {busca && (
          <button
            type="button"
            onClick={() => setBusca('')}
            title="Limpar busca"
            className="absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 flex items-center justify-center rounded-md text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100 cursor-pointer"
          >
            <i className="ri-close-line text-sm" />
          </button>
        )}
      </div>

      {/* Filtros */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1 bg-zinc-100 rounded-lg p-1 overflow-x-auto">
          {['Todas', ...categoriasDisponiveis].map((c) => (
            <button
              key={c}
              onClick={() => setCategoriaFiltro(c)}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${categoriaFiltro === c ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500 hover:text-zinc-700'}`}
            >
              {c}
            </button>
          ))}
        </div>
        <button
          onClick={() => setApenasComDiff(!apenasComDiff)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border cursor-pointer transition-all whitespace-nowrap ${
            apenasComDiff
              ? 'bg-amber-500 border-amber-500 text-white'
              : 'border-zinc-200 text-zinc-600 hover:border-zinc-300'
          }`}
        >
          <i className={`ri-filter-line text-xs`} />
          Só com diferença ({itensComDiferenca.length})
        </button>
      </div>

      {/* Tabela de contagem */}
      {/* Celular: cartão por insumo, com input grande para digitar andando pelo estoque */}
      <ul className="md:hidden space-y-2">
        {grupos.map(({ categoria, itens }) => (
          <Fragment key={categoria}>
            <li className="pt-2 first:pt-0 flex items-center gap-2">
              <span className="text-[11px] font-bold uppercase tracking-wide text-zinc-500">{categoria}</span>
              <span className="text-[10px] text-zinc-400">({itens.length})</span>
              <span className="flex-1 h-px bg-zinc-200" />
            </li>
        {itens.map((insumo) => {
          const rawVal = contagens[insumo.id] ?? '';
          const contado = contadoEstoque(insumo);
          const diff = isNaN(contado) ? 0 : parseFloat((contado - insumo.estoqueAtual).toFixed(4));
          const temDiff = temDiferenca(insumo);
          const impacto = temDiff ? diff * insumo.precoUnitario : 0;
          const emOutraUnidade = fatorDe(insumo) !== 1;

          return (
            <li key={insumo.id}>
              <div className={`rounded-xl border bg-white px-3 py-3 ${temDiff ? 'border-amber-300 bg-amber-50/30' : 'border-zinc-200'}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-zinc-800 break-words line-clamp-2">{insumo.nome}</p>
                    <p className="text-xs text-zinc-400">{insumo.fornecedor}</p>
                  </div>
                  <span className="px-2 py-0.5 bg-zinc-100 text-zinc-600 rounded-full text-[10px] font-medium whitespace-nowrap flex-shrink-0">
                    {insumo.categoria}
                  </span>
                </div>
                <p className="text-xs text-zinc-500 mt-1.5">
                  Sistema (teórico): <span className="font-semibold text-zinc-600">
                    {emOutraUnidade
                      ? `${qtdBR(insumo.estoqueAtual / fatorDe(insumo))} ${rotuloDe(insumo)} (${qtdBR(insumo.estoqueAtual)} ${insumo.unidade})`
                      : `${insumo.estoqueAtual} ${insumo.unidade}`}
                  </span>
                </p>
                <div className="mt-2">
                  <label className="block text-[11px] font-semibold text-zinc-500 mb-1">
                    Contagem real{emOutraUnidade && <> — em <span className="text-amber-700">{rotuloDe(insumo)}</span> (1 = {qtdBR(fatorDe(insumo))} {insumo.unidade})</>}
                  </label>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="0.001"
                      value={rawVal}
                      onChange={(e) => handleChange(insumo.id, e.target.value)}
                      className={`h-11 text-base w-full text-right border rounded-lg px-3 focus:outline-none transition-colors ${
                        temDiff
                          ? 'border-amber-400 bg-amber-50 text-zinc-800 focus:border-amber-500'
                          : 'border-zinc-200 bg-white text-zinc-700 focus:border-amber-400'
                      }`}
                    />
                    <span className={`text-xs flex-shrink-0 ${emOutraUnidade ? 'text-amber-700 font-semibold' : 'text-zinc-400'}`}>{rotuloDe(insumo)}</span>
                  </div>
                  {emOutraUnidade && !isNaN(contado) && (
                    <p className="text-[11px] text-zinc-500 mt-1 text-right">= {qtdBR(contado)} {insumo.unidade}</p>
                  )}
                </div>
                {temDiff && (
                  <div className="flex items-center gap-1.5 flex-wrap mt-2">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold ${diff > 0 ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-500'}`}>
                      {diff > 0 ? '+' : ''}{diff} {insumo.unidade}
                    </span>
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ${impacto > 0 ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-500'}`}>
                      {impacto >= 0 ? '+' : ''}{fmt(impacto)}
                    </span>
                  </div>
                )}
              </div>
            </li>
          );
        })}
          </Fragment>
        ))}
        {insumosFiltrados.length === 0 && (
          <div className="text-center py-8">
            <i className="ri-search-line text-2xl text-zinc-300 block mb-1" />
            <p className="text-xs text-zinc-400">Nenhum insumo neste filtro</p>
          </div>
        )}
      </ul>

      <div className="hidden md:block bg-white border border-zinc-100 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-zinc-50 border-b border-zinc-100">
              <tr>
                <th className="px-4 py-3 text-left font-semibold text-zinc-500">Insumo</th>
                <th className="px-4 py-3 text-center font-semibold text-zinc-500">Categoria</th>
                <th className="px-4 py-3 text-right font-semibold text-zinc-500">Sistema (teórico)</th>
                <th className="px-4 py-3 text-center font-semibold text-zinc-500 w-40">Contagem real</th>
                <th className="px-4 py-3 text-right font-semibold text-zinc-500">Diferença</th>
                <th className="px-4 py-3 text-right font-semibold text-zinc-500">Impacto (R$)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-50">
              {grupos.map(({ categoria, itens }) => (
                <Fragment key={categoria}>
                  <tr className="bg-zinc-50/80">
                    <td colSpan={6} className="px-4 py-2">
                      <span className="text-[11px] font-bold uppercase tracking-wide text-zinc-500">{categoria}</span>
                      <span className="ml-1.5 text-[10px] text-zinc-400">({itens.length})</span>
                    </td>
                  </tr>
              {itens.map((insumo) => {
                const rawVal = contagens[insumo.id] ?? '';
                const contado = contadoEstoque(insumo);
                const diff = isNaN(contado) ? 0 : parseFloat((contado - insumo.estoqueAtual).toFixed(4));
                const temDiff = temDiferenca(insumo);
                const impacto = temDiff ? diff * insumo.precoUnitario : 0;
                const emOutraUnidade = fatorDe(insumo) !== 1;

                return (
                  <tr
                    key={insumo.id}
                    className={`transition-colors ${temDiff ? 'bg-amber-50/30' : 'hover:bg-zinc-50'}`}
                  >
                    <td className="px-4 py-3">
                      <p className="font-medium text-zinc-800">{insumo.nome}</p>
                      <p className="text-[10px] text-zinc-400">{insumo.fornecedor}</p>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className="px-2 py-0.5 bg-zinc-100 text-zinc-600 rounded-full text-[10px] font-medium whitespace-nowrap">
                        {insumo.categoria}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-zinc-600">
                      {emOutraUnidade ? (
                        <>
                          {qtdBR(insumo.estoqueAtual / fatorDe(insumo))} {rotuloDe(insumo)}
                          <p className="text-[10px] font-normal text-zinc-400">{qtdBR(insumo.estoqueAtual)} {insumo.unidade}</p>
                        </>
                      ) : (
                        <>{insumo.estoqueAtual} {insumo.unidade}</>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          min="0"
                          step="0.001"
                          value={rawVal}
                          onChange={(e) => handleChange(insumo.id, e.target.value)}
                          className={`w-full text-sm text-right border rounded-lg px-2 py-1.5 focus:outline-none transition-colors ${
                            temDiff
                              ? 'border-amber-400 bg-amber-50 text-zinc-800 focus:border-amber-500'
                              : 'border-zinc-200 bg-white text-zinc-700 focus:border-amber-400'
                          }`}
                        />
                        <span className={`text-[10px] flex-shrink-0 ${emOutraUnidade ? 'text-amber-700 font-semibold' : 'text-zinc-400'}`}>{rotuloDe(insumo)}</span>
                      </div>
                      {emOutraUnidade && (
                        <p className="text-[10px] text-zinc-400 mt-0.5 text-right">
                          {isNaN(contado) ? `1 ${rotuloDe(insumo)} = ${qtdBR(fatorDe(insumo))} ${insumo.unidade}` : `= ${qtdBR(contado)} ${insumo.unidade}`}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {temDiff ? (
                        <span className={`font-bold ${diff > 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                          {diff > 0 ? '+' : ''}{diff} {insumo.unidade}
                        </span>
                      ) : (
                        <span className="text-zinc-300">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {temDiff ? (
                        <span className={`font-semibold text-xs ${impacto > 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                          {impacto >= 0 ? '+' : ''}{fmt(impacto)}
                        </span>
                      ) : (
                        <span className="text-zinc-300">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
                </Fragment>
              ))}
            </tbody>
          </table>
          {insumosFiltrados.length === 0 && (
            <div className="text-center py-8">
              <i className="ri-search-line text-2xl text-zinc-300 block mb-1" />
              <p className="text-xs text-zinc-400">Nenhum insumo neste filtro</p>
            </div>
          )}
        </div>
      </div>

      {/* Barra inferior de resumo + confirmar */}
      <div className="sticky bottom-0 bg-white border border-zinc-200 rounded-xl px-5 py-4 flex items-center gap-6 flex-wrap">
        <div className="flex items-center gap-6 flex-1 flex-wrap">
          <div>
            <p className="text-[10px] text-zinc-400">Itens contados</p>
            <p className="text-sm font-bold text-zinc-800">{insumos.length}</p>
          </div>
          <div>
            <p className="text-[10px] text-zinc-400">Com diferença</p>
            <p className={`text-sm font-bold ${itensComDiferenca.length > 0 ? 'text-amber-600' : 'text-zinc-400'}`}>
              {itensComDiferenca.length}
            </p>
          </div>
          <div>
            <p className="text-[10px] text-zinc-400">Impacto financeiro</p>
            <p className={`text-sm font-bold ${valorImpacto < 0 ? 'text-red-500' : valorImpacto > 0 ? 'text-emerald-600' : 'text-zinc-400'}`}>
              {valorImpacto >= 0 ? '+' : ''}{fmt(valorImpacto)}
            </p>
          </div>
        </div>
        <button
          onClick={() => setShowConfirmar(true)}
          className="px-6 py-2.5 bg-amber-500 hover:bg-amber-600 text-white text-sm font-bold rounded-xl cursor-pointer whitespace-nowrap transition-colors flex items-center gap-2"
        >
          <i className="ri-check-double-line" />
          Confirmar Contagem
        </button>
      </div>

      {/* Modal de confirmação */}
      {showConfirmar && (
        <ConfirmarInventarioModal
          itens={itensParaConfirmar}
          operador={operador}
          onConfirmar={handleConfirmar}
          onCancelar={() => setShowConfirmar(false)}
        />
      )}

      {/* Modal de cancelamento — salvar rascunho ou descartar */}
      {showCancelarModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-white rounded-2xl w-full max-w-md mx-4 overflow-hidden">
            <div className="flex items-start gap-4 px-6 py-5 bg-amber-50 border-b border-amber-200">
              <div className="w-10 h-10 flex items-center justify-center bg-amber-100 rounded-xl flex-shrink-0 mt-0.5">
                <i className="ri-error-warning-line text-amber-600 text-xl" />
              </div>
              <div>
                <h2 className="text-sm font-bold text-zinc-900 mb-1">Cancelar contagem?</h2>
                <p className="text-xs text-zinc-600 leading-relaxed">
                  Você tem {itensComDiferenca.length} iten{itensComDiferenca.length !== 1 ? 's' : ''} com diferença na contagem atual. Deseja salvar o progresso como rascunho para terminar depois ou descartar tudo?
                </p>
              </div>
            </div>
            <div className="px-6 py-4 bg-zinc-50 border-t border-zinc-100 flex flex-col gap-3">
              <button
                onClick={handleSalvarRascunhoESair}
                className="w-full py-3 bg-amber-500 hover:bg-amber-600 text-white text-sm font-bold rounded-xl cursor-pointer whitespace-nowrap transition-colors flex items-center justify-center gap-2"
              >
                <i className="ri-save-line" />
                Salvar Rascunho e Sair
              </button>
              <button
                onClick={handleDescartarESair}
                className="w-full py-3 border border-red-200 bg-red-50 hover:bg-red-100 text-red-600 text-sm font-semibold rounded-xl cursor-pointer whitespace-nowrap transition-colors flex items-center justify-center gap-2"
              >
                <i className="ri-delete-bin-line" />
                Descartar e Sair
              </button>
              <button
                onClick={() => setShowCancelarModal(false)}
                className="w-full py-2 text-zinc-500 hover:text-zinc-700 text-xs font-medium cursor-pointer transition-colors"
              >
                Continuar contando
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}