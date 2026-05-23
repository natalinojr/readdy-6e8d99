import { useMemo, useState } from 'react';
import { useEstoque } from '@/contexts/EstoqueContext';
import { useSuppliers } from '@/hooks/useSuppliers';
import { Building2, ChevronDown, ChevronUp, Search } from 'lucide-react';
import type { Insumo } from '@/contexts/EstoqueContext';

const fmt = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

function statusLabel(i: Insumo) {
  if (i.esgotado || i.estoqueAtual <= 0) return { label: 'Esgotado', cls: 'text-red-600 bg-red-50' };
  const ratio = i.estoqueAtual / Math.max(i.estoqueMinimo, 0.001);
  if (ratio <= 0.5) return { label: 'Crítico', cls: 'text-red-600 bg-red-50' };
  if (ratio <= 1) return { label: 'Baixo', cls: 'text-amber-600 bg-amber-50' };
  return { label: 'Ok', cls: 'text-emerald-600 bg-emerald-50' };
}

interface FornecedorGrupo {
  nome: string;
  supplierId: string | null;
  insumos: Insumo[];
  valorEstoque: number;
  insumosBaixo: number;
}

export default function FornecedoresRelatorioTab() {
  const { insumos } = useEstoque();
  const { suppliers } = useSuppliers();
  const [busca, setBusca] = useState('');
  const [filtroFornecedor, setFiltroFornecedor] = useState<string>('todos');
  const [ordenarPor, setOrdenarPor] = useState<'nome' | 'valor' | 'alerta'>('nome');
  const [expandidos, setExpandidos] = useState<Set<string>>(new Set());

  const toggleExpand = (key: string) =>
    setExpandidos((prev) => {
      const s = new Set(prev);
      s.has(key) ? s.delete(key) : s.add(key);
      return s;
    });

  const grupos = useMemo<FornecedorGrupo[]>(() => {
    const map = new Map<string, FornecedorGrupo>();

    for (const ins of insumos) {
      const chave = ins.supplierId ?? ins.fornecedor ?? '__sem_fornecedor__';
      const nomeDisplay = ins.supplierId
        ? (suppliers.find((s) => s.id === ins.supplierId)?.name ?? ins.fornecedor ?? 'Fornecedor desconhecido')
        : (ins.fornecedor || 'Sem fornecedor');

      if (!map.has(chave)) {
        map.set(chave, {
          nome: nomeDisplay,
          supplierId: ins.supplierId ?? null,
          insumos: [],
          valorEstoque: 0,
          insumosBaixo: 0,
        });
      }
      const g = map.get(chave)!;
      g.insumos.push(ins);
      g.valorEstoque += ins.estoqueAtual * ins.precoUnitario;
      const ratio = ins.estoqueMinimo > 0 ? ins.estoqueAtual / ins.estoqueMinimo : 2;
      if (ins.esgotado || ins.estoqueAtual <= 0 || ratio <= 1) g.insumosBaixo++;
    }

    return Array.from(map.values()).sort((a, b) => {
      if (a.nome === 'Sem fornecedor') return 1;
      if (b.nome === 'Sem fornecedor') return -1;
      return a.nome.localeCompare(b.nome, 'pt-BR');
    });
  }, [insumos, suppliers]);

  const gruposFiltrados = useMemo(() => {
    let result = grupos;

    if (filtroFornecedor !== 'todos') {
      result = result.filter((g) => {
        const key = g.supplierId ?? g.nome;
        return key === filtroFornecedor;
      });
    }

    if (busca.trim()) {
      result = result.filter(
        (g) =>
          g.nome.toLowerCase().includes(busca.toLowerCase()) ||
          g.insumos.some((i) => i.nome.toLowerCase().includes(busca.toLowerCase())),
      );
    }

    return [...result].sort((a, b) => {
      if (ordenarPor === 'valor') return b.valorEstoque - a.valorEstoque;
      if (ordenarPor === 'alerta') return b.insumosBaixo - a.insumosBaixo;
      // nome default — sem fornecedor vai pro fim
      if (a.nome === 'Sem fornecedor') return 1;
      if (b.nome === 'Sem fornecedor') return -1;
      return a.nome.localeCompare(b.nome, 'pt-BR');
    });
  }, [grupos, busca, filtroFornecedor, ordenarPor]);

  const totalInsumos = insumos.length;
  const totalValor = insumos.reduce((s, i) => s + i.estoqueAtual * i.precoUnitario, 0);
  const totalAlerta = insumos.filter((i) => {
    const ratio = i.estoqueMinimo > 0 ? i.estoqueAtual / i.estoqueMinimo : 2;
    return i.esgotado || i.estoqueAtual <= 0 || ratio <= 1;
  }).length;

  function exportCSV() {
    const header = ['Fornecedor', 'Insumo', 'Categoria', 'Unidade', 'Estoque Atual', 'Estoque Mín', 'Preço Unit.', 'Valor Estoque', 'Status'];
    const rows: string[][] = [];
    for (const g of grupos) {
      for (const i of g.insumos) {
        const st = statusLabel(i).label;
        rows.push([g.nome, i.nome, i.categoria || '', i.unidade, String(i.estoqueAtual), String(i.estoqueMinimo), i.precoUnitario.toFixed(2), (i.estoqueAtual * i.precoUnitario).toFixed(2), st]);
      }
    }
    const csv = [header, ...rows].map((r) => r.join(';')).join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `insumos_por_fornecedor_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      {/* Cards de resumo */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <div className="bg-white border border-zinc-100 rounded-xl p-4">
          <p className="text-[10px] text-zinc-400 mb-0.5">Fornecedores</p>
          <p className="text-xl font-bold text-zinc-900">{grupos.filter(g => g.nome !== 'Sem fornecedor').length}</p>
          <p className="text-[10px] text-zinc-400 mt-0.5">{grupos.find(g => g.nome === 'Sem fornecedor')?.insumos.length ?? 0} sem vínculo</p>
        </div>
        <div className="bg-white border border-zinc-100 rounded-xl p-4">
          <p className="text-[10px] text-zinc-400 mb-0.5">Total Insumos</p>
          <p className="text-xl font-bold text-zinc-900">{totalInsumos}</p>
          <p className="text-[10px] text-amber-600 mt-0.5">{totalAlerta} em alerta</p>
        </div>
        <div className="bg-white border border-zinc-100 rounded-xl p-4">
          <p className="text-[10px] text-zinc-400 mb-0.5">Valor em Estoque</p>
          <p className="text-lg font-bold text-zinc-900">{fmt(totalValor)}</p>
          <p className="text-[10px] text-zinc-400 mt-0.5">todos os insumos</p>
        </div>
      </div>

      {/* Filtros */}
      <div className="flex flex-col gap-2">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
          <div className="flex items-center gap-2 bg-white border border-zinc-200 rounded-lg px-3 py-2 flex-1">
            <Search size={13} className="text-zinc-400 flex-shrink-0" />
            <input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar fornecedor..."
              className="flex-1 text-xs bg-transparent text-zinc-700 placeholder-zinc-400 focus:outline-none"
            />
          </div>
          <div className="flex items-center gap-2">
            <select
              value={filtroFornecedor}
              onChange={(e) => setFiltroFornecedor(e.target.value)}
              className="flex-1 text-xs border border-zinc-200 rounded-lg px-2.5 py-1.5 text-zinc-700 focus:outline-none focus:border-amber-400 bg-white cursor-pointer"
            >
              <option value="todos">Todos</option>
              {grupos.filter(g => g.nome !== 'Sem fornecedor').map((g) => (
                <option key={g.supplierId ?? g.nome} value={g.supplierId ?? g.nome}>
                  {g.nome}
                </option>
              ))}
              {grupos.some(g => g.nome === 'Sem fornecedor') && (
                <option value="Sem fornecedor">Sem fornecedor</option>
              )}
            </select>
            <button
              onClick={exportCSV}
              className="w-8 h-8 flex items-center justify-center bg-zinc-100 text-zinc-600 rounded-lg hover:bg-zinc-200 transition-colors cursor-pointer flex-shrink-0"
              title="Exportar CSV"
            >
              <i className="ri-download-line text-sm" />
            </button>
          </div>
        </div>
        <div className="flex items-center gap-1 bg-zinc-100 rounded-lg p-1 overflow-x-auto">
          {([['nome', 'Nome A-Z'], ['valor', 'Maior Valor'], ['alerta', 'Mais Alertas']] as const).map(([v, l]) => (
            <button
              key={v}
              onClick={() => setOrdenarPor(v)}
              className={`px-2.5 py-1 text-xs font-medium rounded-md whitespace-nowrap cursor-pointer transition-colors flex-shrink-0 ${
                ordenarPor === v ? 'bg-white text-zinc-900' : 'text-zinc-500 hover:text-zinc-700'
              }`}
            >
              {l}
            </button>
          ))}
        </div>
      </div>

      {/* Comparação de preços quando um fornecedor específico está selecionado */}
      {filtroFornecedor !== 'todos' && gruposFiltrados.length > 0 && (() => {
        const grupo = gruposFiltrados[0];
        const insumosComPreco = grupo.insumos.filter(i => i.precoUnitario > 0);
        if (insumosComPreco.length === 0) return null;
        const avgPreco = insumosComPreco.reduce((s, i) => s + i.precoUnitario, 0) / insumosComPreco.length;
        return (
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-2">
              <Building2 size={14} className="text-amber-600" />
              <span className="text-xs font-bold text-amber-800">{grupo.nome}</span>
            </div>
            <div className="flex items-center gap-4 flex-wrap">
              <div>
                <p className="text-[9px] text-amber-600 uppercase tracking-wide">Insumos</p>
                <p className="text-sm font-bold text-amber-900">{grupo.insumos.length}</p>
              </div>
              <div>
                <p className="text-[9px] text-amber-600 uppercase tracking-wide">Valor total</p>
                <p className="text-sm font-bold text-amber-900">{fmt(grupo.valorEstoque)}</p>
              </div>
              <div>
                <p className="text-[9px] text-amber-600 uppercase tracking-wide">Preço médio/insumo</p>
                <p className="text-sm font-bold text-amber-900">{fmt(avgPreco)}</p>
              </div>
              {grupo.insumosBaixo > 0 && (
                <div className="px-2.5 py-1 bg-orange-100 rounded-lg">
                  <p className="text-xs font-bold text-orange-700">{grupo.insumosBaixo} em alerta</p>
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* Lista de fornecedores */}
      <div className="space-y-3">
        {gruposFiltrados.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 bg-white border border-zinc-100 rounded-xl text-center">
            <Building2 size={32} className="text-zinc-200 mb-3" />
            <p className="text-sm font-semibold text-zinc-500">Nenhum fornecedor encontrado</p>
          </div>
        )}
        {gruposFiltrados.map((grupo) => {
          const key = grupo.supplierId ?? grupo.nome;
          const isOpen = expandidos.has(key);
          const supplier = grupo.supplierId ? suppliers.find((s) => s.id === grupo.supplierId) : null;
          const semFornecedor = grupo.nome === 'Sem fornecedor';

          return (
            <div key={key} className="bg-white border border-zinc-100 rounded-xl overflow-hidden">
              {/* Header do grupo */}
              <button
                onClick={() => toggleExpand(key)}
                className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-zinc-50 transition-colors cursor-pointer text-left"
              >
                <div className={`w-9 h-9 flex items-center justify-center rounded-xl flex-shrink-0 ${semFornecedor ? 'bg-zinc-100' : 'bg-amber-50'}`}>
                  <Building2 size={15} className={semFornecedor ? 'text-zinc-400' : 'text-amber-600'} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-bold text-zinc-800">{grupo.nome}</span>
                    {grupo.supplierId && (
                      <span className="text-[9px] font-bold px-1.5 py-0.5 bg-emerald-100 text-emerald-700 rounded-full">Cadastrado</span>
                    )}
                    {grupo.insumosBaixo > 0 && (
                      <span className="text-[9px] font-bold px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded-full">
                        {grupo.insumosBaixo} em alerta
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                    <span className="text-[10px] text-zinc-400">{grupo.insumos.length} insumo{grupo.insumos.length !== 1 ? 's' : ''}</span>
                    <span className="text-[10px] text-zinc-400">Valor: <strong className="text-zinc-600">{fmt(grupo.valorEstoque)}</strong></span>
                    {supplier?.phone && <span className="text-[10px] text-zinc-400">{supplier.phone}</span>}
                    {supplier?.email && <span className="text-[10px] text-zinc-400">{supplier.email}</span>}
                  </div>
                </div>
                <div className="flex-shrink-0 text-zinc-400">
                  {isOpen ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                </div>
              </button>

              {/* Insumos do grupo */}
              {isOpen && (
                <div className="border-t border-zinc-50">
                  {/* Info fornecedor cadastrado */}
                  {supplier && (supplier.cnpj || supplier.address || supplier.email) && (
                    <div className="px-4 py-3 bg-amber-50/60 border-b border-amber-100 flex flex-wrap gap-4">
                      {supplier.cnpj && (
                        <div>
                          <p className="text-[9px] text-zinc-400 font-medium uppercase tracking-wide">CNPJ</p>
                          <p className="text-xs text-zinc-700 font-semibold">{supplier.cnpj}</p>
                        </div>
                      )}
                      {supplier.phone && (
                        <div>
                          <p className="text-[9px] text-zinc-400 font-medium uppercase tracking-wide">Telefone</p>
                          <p className="text-xs text-zinc-700 font-semibold">{supplier.phone}</p>
                        </div>
                      )}
                      {supplier.address && (
                        <div>
                          <p className="text-[9px] text-zinc-400 font-medium uppercase tracking-wide">Endereço</p>
                          <p className="text-xs text-zinc-700 font-semibold">{supplier.address}</p>
                        </div>
                      )}
                      {supplier.email && (
                        <div>
                          <p className="text-[9px] text-zinc-400 font-medium uppercase tracking-wide">E-mail</p>
                          <p className="text-xs text-zinc-700">{supplier.email}</p>
                        </div>
                      )}
                    </div>
                  )}

                  <div className="overflow-x-auto">
                  <table className="w-full text-xs" style={{ minWidth: '480px' }}>
                    <thead className="bg-zinc-50/80">
                      <tr>
                        <th className="px-4 py-2 text-left font-semibold text-zinc-400">Insumo</th>
                        <th className="px-4 py-2 text-left font-semibold text-zinc-400 hidden sm:table-cell">Categoria</th>
                        <th className="px-4 py-2 text-right font-semibold text-zinc-400">Estoque</th>
                        <th className="px-4 py-2 text-right font-semibold text-zinc-400 hidden sm:table-cell">Preço Unit.</th>
                        <th className="px-4 py-2 text-right font-semibold text-zinc-400">Valor</th>
                        <th className="px-4 py-2 text-center font-semibold text-zinc-400">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-50">
                      {grupo.insumos.map((ins) => {
                        const st = statusLabel(ins);
                        return (
                          <tr key={ins.id} className="hover:bg-zinc-50/50 transition-colors">
                            <td className="px-4 py-2.5 font-medium text-zinc-800">{ins.nome}</td>
                            <td className="px-4 py-2.5 hidden sm:table-cell">
                              {ins.categoria ? (
                                <span className="px-2 py-0.5 bg-zinc-100 text-zinc-500 rounded-full text-[10px]">{ins.categoria}</span>
                              ) : <span className="text-zinc-300">—</span>}
                            </td>
                            <td className="px-4 py-2.5 text-right text-zinc-700">
                              {ins.estoqueAtual} {ins.unidade}
                              {ins.estoqueMinimo > 0 && (
                                <span className="block text-[10px] text-zinc-400">mín: {ins.estoqueMinimo}</span>
                              )}
                            </td>
                            <td className="px-4 py-2.5 text-right font-semibold text-zinc-800 hidden sm:table-cell">{fmt(ins.precoUnitario)}</td>
                            <td className="px-4 py-2.5 text-right font-semibold text-zinc-700">{fmt(ins.estoqueAtual * ins.precoUnitario)}</td>
                            <td className="px-4 py-2.5 text-center">
                              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${st.cls}`}>{st.label}</span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot className="bg-zinc-50 border-t border-zinc-100">
                      <tr>
                        <td colSpan={2} className="px-4 py-2 text-xs font-semibold text-zinc-500 hidden sm:table-cell">
                          Total — {grupo.insumos.length} insumo{grupo.insumos.length !== 1 ? 's' : ''}
                        </td>
                        <td className="px-4 py-2 text-xs font-semibold text-zinc-500 sm:hidden">
                          Total
                        </td>
                        <td className="hidden sm:table-cell" />
                        <td className="px-4 py-2 text-right text-xs font-bold text-zinc-800">{fmt(grupo.valorEstoque)}</td>
                        <td />
                      </tr>
                    </tfoot>
                  </table>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
