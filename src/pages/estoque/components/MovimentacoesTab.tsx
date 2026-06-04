import { useState, useMemo, useEffect } from 'react';
import { Plus, ArrowUpCircle, ArrowDownCircle, AlertTriangle, X, ChevronDown, ShoppingCart, Calendar } from 'lucide-react';
import type { Movimentacao } from '@/types/estoque';
import { useEstoque } from '../../../contexts/EstoqueContext';
import RegistrarPerdaModal from '../../kds/components/RegistrarPerdaModal';
import TransferirEstoqueModal from './TransferirEstoqueModal';
import NovaCompraModal from '../../financeiro/components/NovaCompraModal';

const fmt = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

const tipoConfig: Record<Movimentacao['tipo'], { label: string; cls: string; icon: React.ReactNode }> = {
  entrada: { label: 'Entrada', cls: 'text-emerald-600 bg-emerald-50', icon: <ArrowUpCircle size={13} /> },
  saida_venda: { label: 'Saída (venda)', cls: 'text-sky-600 bg-sky-50', icon: <ArrowDownCircle size={13} /> },
  saida_manual: { label: 'Saída manual', cls: 'text-orange-500 bg-orange-50', icon: <ArrowDownCircle size={13} /> },
  perda: { label: 'Perda', cls: 'text-red-600 bg-red-50', icon: <AlertTriangle size={13} /> },
  entrada_producao: { label: 'Entrada (produção)', cls: 'text-amber-600 bg-amber-50', icon: <ArrowUpCircle size={13} /> },
  saida_producao: { label: 'Saída (produção)', cls: 'text-amber-700 bg-amber-100', icon: <ArrowDownCircle size={13} /> },
  ajuste_inventario: { label: 'Ajuste Inventário', cls: 'text-violet-600 bg-violet-50', icon: <i className="ri-equalizer-line text-[13px]" /> },
};

function getMotivoDisplay(mv: Movimentacao) {
  const motivo = mv.motivo ?? '';
  if (mv.tipo === 'saida_venda' && mv.itemVendidoNome) {
    return { label: mv.itemVendidoNome, sub: 'Baixa por venda', cls: 'text-sky-700 font-semibold' };
  }
  if (motivo.startsWith('Producao:') || motivo.startsWith('Produção:')) {
    const label = motivo.replace('Producao:', '').replace('Produção:', '').trim();
    if (mv.tipo === 'saida_producao') {
      return { label, sub: 'Saída (produção)', cls: 'text-amber-700 font-semibold' };
    }
    if (mv.tipo === 'entrada_producao') {
      return { label, sub: 'Entrada (produção)', cls: 'text-amber-600 font-semibold' };
    }
    return { label, sub: 'Baixa por produção', cls: 'text-amber-700 font-semibold' };
  }
  if (motivo.startsWith('Perda em produção:')) {
    return { label: motivo.replace('Perda em produção:', '').trim(), sub: 'Perda em produção', cls: 'text-red-600 font-semibold' };
  }
  return { label: motivo || (mv.tipo === 'saida_venda' ? 'Baixa automática por venda' : '—'), sub: null, cls: 'text-zinc-500' };
}

type MovTipoModal = Movimentacao['tipo'] | 'compra_fornecedor';

interface NovaMovimentacaoModalProps {
  onClose: () => void;
  onOpenCompra: (insumoId?: string) => void;
}

function NovaMovimentacaoModal({ onClose, onOpenCompra }: NovaMovimentacaoModalProps) {
  const { insumos, addMovimentacao } = useEstoque();
  const [tipo, setTipo] = useState<MovTipoModal>('entrada');
  const [insumoId, setInsumoId] = useState('');
  const [quantidade, setQuantidade] = useState('');
  const [motivo, setMotivo] = useState('');

  const handleRegistrar = async () => {
    if (tipo === 'compra_fornecedor') {
      onClose();
      onOpenCompra(insumoId || undefined);
      return;
    }
    if (!insumoId || !quantidade) return;
    const insumoSel = insumos.find((i) => i.id === insumoId);
    if (!insumoSel) return;
    await addMovimentacao({
      insumoId,
      tipo: tipo as Movimentacao['tipo'],
      quantidade: parseFloat(quantidade),
      unidade: insumoSel.unidade,
      motivo: motivo || undefined,
    });
    onClose();
  };

  const tipoOpcoes: { key: MovTipoModal; label: string; icon: string }[] = [
    { key: 'entrada', label: 'Entrada manual', icon: 'ri-arrow-up-circle-line' },
    { key: 'saida_manual', label: 'Saída manual', icon: 'ri-arrow-down-circle-line' },
    { key: 'compra_fornecedor', label: 'Compra de fornecedor', icon: 'ri-shopping-cart-2-line' },
  ];

  const isCompra = tipo === 'compra_fornecedor';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl p-6 w-full max-w-md mx-4">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-sm font-bold text-zinc-900">Registrar Movimentação</h2>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-zinc-100 cursor-pointer text-zinc-500">
            <X size={16} />
          </button>
        </div>
        <div className="space-y-3">
          {/* Tipo selector */}
          <div>
            <label className="block text-xs font-medium text-zinc-600 mb-2">Tipo de Movimentação</label>
            <div className="space-y-1.5">
              {tipoOpcoes.map(({ key, label, icon }) => (
                <button
                  key={key}
                  onClick={() => setTipo(key)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border-2 text-left transition-all cursor-pointer ${
                    tipo === key ? 'border-amber-400 bg-amber-50' : 'border-zinc-100 bg-zinc-50 hover:border-zinc-300'
                  }`}
                >
                  <div className={`w-8 h-8 flex items-center justify-center rounded-lg ${
                    tipo === key ? 'bg-amber-500 text-white' : 'bg-white text-zinc-400'
                  }`}>
                    <i className={`${icon} text-sm`} />
                  </div>
                  <span className={`text-xs font-semibold ${tipo === key ? 'text-amber-700' : 'text-zinc-600'}`}>{label}</span>
                  {key === 'compra_fornecedor' && (
                    <span className="ml-auto text-xs text-zinc-400 bg-zinc-100 px-2 py-0.5 rounded-full whitespace-nowrap">
                      Abre módulo financeiro
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>

          {isCompra ? (
            /* Quando for compra — só precisa do insumo (opcional) */
            <div>
              <label className="block text-xs font-medium text-zinc-600 mb-1">Insumo (opcional)</label>
              <div className="relative">
                <select value={insumoId} onChange={(e) => setInsumoId(e.target.value)}
                  className="w-full text-sm border border-zinc-200 rounded-lg px-3 py-2 text-zinc-800 focus:outline-none focus:border-amber-400 appearance-none cursor-pointer">
                  <option value="">Pré-selecionar insumo...</option>
                  {insumos.map((i) => <option key={i.id} value={i.id}>{i.nome}</option>)}
                </select>
                <div className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none w-4 h-4 flex items-center justify-center text-zinc-400">
                  <ChevronDown size={12} />
                </div>
              </div>
              <p className="text-xs text-zinc-400 mt-1.5 flex items-start gap-1">
                <i className="ri-information-line text-amber-500 mt-px flex-shrink-0" />
                O formulário completo de compra será aberto no próximo passo. Selecionar o insumo acima apenas o pré-preenche.
              </p>
            </div>
          ) : (
            /* Entrada / Saída manual */
            <>
              <div>
                <label className="block text-xs font-medium text-zinc-600 mb-1">Insumo</label>
                <div className="relative">
                  <select value={insumoId} onChange={(e) => setInsumoId(e.target.value)}
                    className="w-full text-sm border border-zinc-200 rounded-lg px-3 py-2 text-zinc-800 focus:outline-none focus:border-amber-400 appearance-none cursor-pointer">
                    <option value="">Selecionar insumo...</option>
                    {insumos.map((i) => <option key={i.id} value={i.id}>{i.nome}</option>)}
                  </select>
                  <div className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none w-4 h-4 flex items-center justify-center text-zinc-400">
                    <ChevronDown size={12} />
                  </div>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-600 mb-1">Quantidade</label>
                <input type="number" step="0.01" value={quantidade}
                  onChange={(e) => setQuantidade(e.target.value)}
                  className="w-full text-sm border border-zinc-200 rounded-lg px-3 py-2 text-zinc-800 focus:outline-none focus:border-amber-400"
                  placeholder="0" />
              </div>
              {tipo === 'saida_manual' && (
                <div>
                  <label className="block text-xs font-medium text-zinc-600 mb-1">Motivo <span className="text-red-400">*</span></label>
                  <textarea rows={2} value={motivo} onChange={(e) => setMotivo(e.target.value)}
                    className="w-full text-sm border border-zinc-200 rounded-lg px-3 py-2 text-zinc-800 focus:outline-none focus:border-amber-400 resize-none"
                    placeholder="Descreva o motivo..." maxLength={200} />
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex gap-2 mt-5">
          <button onClick={onClose}
            className="flex-1 py-2 text-sm font-semibold text-zinc-600 bg-zinc-100 rounded-lg hover:bg-zinc-200 transition-colors cursor-pointer whitespace-nowrap">
            Cancelar
          </button>
          <button
            onClick={handleRegistrar}
            disabled={!isCompra && (!insumoId || !quantidade)}
            className={`flex-1 py-2 text-sm font-semibold text-white rounded-lg disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer whitespace-nowrap flex items-center justify-center gap-2 ${
              isCompra ? 'bg-emerald-500 hover:bg-emerald-600' : 'bg-amber-500 hover:bg-amber-600'
            }`}
          >
            {isCompra && <div className="w-4 h-4 flex items-center justify-center"><ShoppingCart size={13} /></div>}
            {isCompra ? 'Ir para Nova Compra' : 'Registrar'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function MovimentacoesTab() {
  const { movimentacoes, reloadMovimentacoes } = useEstoque();
  const [filtroTipo, setFiltroTipo] = useState<'Todos' | Movimentacao['tipo']>('Todos');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [showPerdaModal, setShowPerdaModal] = useState(false);
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [showCompraModal, setShowCompraModal] = useState(false);
  const [compraInsumoPreSelecionado, setCompraInsumoPreSelecionado] = useState<{ id: string; nome: string; unidade: string } | null>(null);

  const { insumos } = useEstoque();
  const [buscaInsumo, setBuscaInsumo] = useState('');

  // Recarrega movimentacoes do servidor quando o filtro de periodo mudar
  useEffect(() => {
    if (!dateFrom && !dateTo) return;
    const from = dateFrom ? new Date(dateFrom + 'T00:00:00') : undefined;
    const to = dateTo ? new Date(dateTo + 'T23:59:59') : undefined;
    reloadMovimentacoes(from, to);
  }, [dateFrom, dateTo, reloadMovimentacoes]);

  const handleOpenCompra = (insumoId?: string) => {
    if (insumoId) {
      const ins = insumos.find((i) => i.id === insumoId);
      setCompraInsumoPreSelecionado(ins ? { id: ins.id, nome: ins.nome, unidade: ins.unidade } : null);
    } else {
      setCompraInsumoPreSelecionado(null);
    }
    setShowModal(false);
    setShowCompraModal(true);
  };

  // Parse "DD/MM/YYYY" to Date for comparison
  const parseDataBR = (s: string): Date | null => {
    const [d, m, y] = s.split('/');
    if (!d || !m || !y) return null;
    return new Date(Number(y), Number(m) - 1, Number(d));
  };

  const movs = useMemo(() => {
    return movimentacoes.filter((m) => {
      if (filtroTipo !== 'Todos' && m.tipo !== filtroTipo) return false;
      if (buscaInsumo.trim()) {
        const q = buscaInsumo.toLowerCase();
        if (!m.insumoNome?.toLowerCase().includes(q)) return false;
      }
      if (dateFrom || dateTo) {
        const movDate = parseDataBR(m.data);
        if (!movDate) return true;
        if (dateFrom) {
          const from = new Date(dateFrom + 'T00:00:00');
          if (movDate < from) return false;
        }
        if (dateTo) {
          const to = new Date(dateTo + 'T23:59:59');
          if (movDate > to) return false;
        }
      }
      return true;
    });
  }, [movimentacoes, filtroTipo, buscaInsumo, dateFrom, dateTo]);

  const totalEntradas = movimentacoes.filter((m) => m.tipo === 'entrada').reduce((s, m) => s + (m.custo ?? 0), 0);
  const totalPerdas = movimentacoes.filter((m) => m.tipo === 'perda').length;
  const totalSaidasVenda = movimentacoes.filter((m) => m.tipo === 'saida_venda').length;

  const hasDateFilter = dateFrom || dateTo;
  const clearDates = () => { setDateFrom(''); setDateTo(''); };

  return (
    <div className="space-y-4">
      {/* Resumo */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white border border-zinc-100 rounded-xl p-4">
          <p className="text-lg font-bold text-emerald-600">{fmt(totalEntradas)}</p>
          <p className="text-xs text-zinc-500">Custo em entradas (hoje)</p>
        </div>
        <div className="bg-white border border-zinc-100 rounded-xl p-4">
          <p className="text-lg font-bold text-sky-600">{totalSaidasVenda}</p>
          <p className="text-xs text-zinc-500">Saídas por vendas</p>
        </div>
        <div className="bg-white border border-zinc-100 rounded-xl p-4">
          <p className="text-lg font-bold text-red-500">{totalPerdas}</p>
          <p className="text-xs text-zinc-500">Registros de perda</p>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-1 bg-zinc-100 rounded-lg p-1 overflow-x-auto">
          {(['Todos', 'entrada', 'saida_venda', 'saida_manual', 'perda', 'entrada_producao', 'saida_producao', 'ajuste_inventario'] as const).map((t) => (
            <button key={t} onClick={() => setFiltroTipo(t)}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer flex-shrink-0 ${filtroTipo === t ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500 hover:text-zinc-700'}`}>
              {t === 'Todos' ? 'Todos' : tipoConfig[t].label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <button onClick={() => setShowTransferModal(true)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 bg-sky-50 text-sky-600 border border-sky-200 text-xs font-semibold rounded-lg hover:bg-sky-100 transition-colors whitespace-nowrap cursor-pointer">
            <i className="ri-truck-line text-sm" />
            <span className="hidden sm:inline">Transferir</span>
          </button>
          <button onClick={() => setShowPerdaModal(true)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 bg-red-50 text-red-600 border border-red-200 text-xs font-semibold rounded-lg hover:bg-red-100 transition-colors whitespace-nowrap cursor-pointer">
            <i className="ri-alert-line text-sm" />
            <span className="hidden sm:inline">Registrar Perda</span>
            <span className="sm:hidden">Perda</span>
          </button>
          <button onClick={() => handleOpenCompra()}
            className="flex items-center gap-1.5 px-2.5 py-1.5 bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-semibold rounded-lg hover:bg-emerald-100 transition-colors whitespace-nowrap cursor-pointer">
            <div className="w-4 h-4 flex items-center justify-center"><ShoppingCart size={13} /></div>
            <span className="hidden sm:inline">Compra de Fornecedor</span>
            <span className="sm:hidden">Compra</span>
          </button>
          <button onClick={() => setShowModal(true)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 bg-amber-500 text-white text-xs font-semibold rounded-lg hover:bg-amber-600 transition-colors whitespace-nowrap cursor-pointer ml-auto">
            <div className="w-4 h-4 flex items-center justify-center"><Plus size={13} /></div>
            <span className="hidden sm:inline">Registrar Movimentação</span>
            <span className="sm:hidden">Registrar</span>
          </button>
        </div>
      </div>

      {/* Busca por insumo */}
      <div className="flex items-center gap-2 bg-white border border-zinc-100 rounded-xl px-4 py-3">
        <i className="ri-search-line text-zinc-400 text-sm flex-shrink-0" />
        <input
          type="text"
          value={buscaInsumo}
          onChange={(e) => setBuscaInsumo(e.target.value)}
          placeholder="Filtrar por nome do insumo..."
          className="flex-1 text-xs bg-transparent text-zinc-700 placeholder-zinc-400 focus:outline-none"
        />
        {buscaInsumo && (
          <button onClick={() => setBuscaInsumo('')} className="text-zinc-400 hover:text-zinc-600 cursor-pointer">
            <i className="ri-close-line text-sm" />
          </button>
        )}
      </div>

      {/* Filtro de período */}
      <div className="flex items-center gap-3 flex-wrap bg-white border border-zinc-100 rounded-xl px-4 py-3">
        <div className="w-4 h-4 flex items-center justify-center text-zinc-400 flex-shrink-0">
          <Calendar size={14} />
        </div>
        <span className="text-xs font-semibold text-zinc-500 whitespace-nowrap">Período:</span>
        <div className="flex items-center gap-2 flex-wrap flex-1">
          <div className="flex items-center gap-1.5">
            <label className="text-xs text-zinc-400 whitespace-nowrap">De</label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="text-xs border border-zinc-200 rounded-lg px-2.5 py-1.5 text-zinc-700 focus:outline-none focus:border-amber-400 cursor-pointer"
            />
          </div>
          <div className="flex items-center gap-1.5">
            <label className="text-xs text-zinc-400 whitespace-nowrap">Até</label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="text-xs border border-zinc-200 rounded-lg px-2.5 py-1.5 text-zinc-700 focus:outline-none focus:border-amber-400 cursor-pointer"
            />
          </div>
          {/* Atalhos rápidos */}
          <div className="flex items-center gap-1">
            {[
              { label: 'Hoje', days: 0 },
              { label: '7d', days: 7 },
              { label: '30d', days: 30 },
              { label: 'Mês', days: -1 },
            ].map(({ label, days }) => (
              <button
                key={label}
                onClick={() => {
                  const today = new Date();
                  const todayStr = today.toISOString().split('T')[0];
                  if (days === 0) {
                    setDateFrom(todayStr); setDateTo(todayStr);
                  } else if (days === -1) {
                    const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
                    setDateFrom(firstDay.toISOString().split('T')[0]);
                    setDateTo(todayStr);
                  } else {
                    const from = new Date(today);
                    from.setDate(from.getDate() - days);
                    setDateFrom(from.toISOString().split('T')[0]);
                    setDateTo(todayStr);
                  }
                }}
                className="px-2 py-1 text-xs font-medium rounded-md bg-zinc-100 text-zinc-500 hover:bg-amber-100 hover:text-amber-700 transition-colors cursor-pointer whitespace-nowrap"
              >
                {label}
              </button>
            ))}
          </div>
          {hasDateFilter && (
            <button
              onClick={clearDates}
              className="flex items-center gap-1 px-2 py-1 text-xs font-semibold text-zinc-500 hover:text-red-500 bg-zinc-100 hover:bg-red-50 rounded-lg transition-colors cursor-pointer whitespace-nowrap"
            >
              <X size={11} /> Limpar
            </button>
          )}
        </div>
        {hasDateFilter && (
          <span className="text-xs font-semibold text-amber-600 whitespace-nowrap">
            {movs.length} resultado{movs.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* Lista */}
      {/* Desktop table */}
      <div className="hidden md:block bg-white border border-zinc-100 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs" style={{ minWidth: '700px' }}>
            <thead className="bg-zinc-50 border-b border-zinc-100">
              <tr>
                <th className="px-4 py-3 text-left font-semibold text-zinc-500 whitespace-nowrap">Tipo</th>
                <th className="px-4 py-3 text-left font-semibold text-zinc-500 whitespace-nowrap">Insumo</th>
                <th className="px-4 py-3 text-center font-semibold text-zinc-500 whitespace-nowrap">Quantidade</th>
                <th className="px-4 py-3 text-left font-semibold text-zinc-500 whitespace-nowrap">Lanche / Motivo</th>
                <th className="px-4 py-3 text-left font-semibold text-zinc-500 whitespace-nowrap">Pedido</th>
                <th className="px-4 py-3 text-left font-semibold text-zinc-500 whitespace-nowrap">Operador</th>
                <th className="px-4 py-3 text-right font-semibold text-zinc-500 whitespace-nowrap">Data / Hora</th>
                <th className="px-4 py-3 text-right font-semibold text-zinc-500 whitespace-nowrap">Custo</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-50">
              {movs.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-zinc-400">
                    <i className="ri-calendar-line text-2xl block mb-2 text-zinc-300" />
                    <p className="text-xs font-medium">Nenhuma movimentação encontrada</p>
                    {hasDateFilter && <p className="text-xs mt-1">Tente outro período ou limpe o filtro</p>}
                  </td>
                </tr>
              ) : movs.map((mv) => {
                const cfg = tipoConfig[mv.tipo];
                return (
                  <tr key={mv.id} className="hover:bg-zinc-50 transition-colors">
                    <td className="px-4 py-3">
                      <span className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full font-semibold w-fit ${cfg.cls}`}>
                        <div className="w-3 h-3 flex items-center justify-center">{cfg.icon}</div>
                        {cfg.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-medium text-zinc-800 max-w-[180px]">
                      <p className="truncate">{mv.insumoNome}</p>
                    </td>
                    <td className="px-4 py-3 text-center font-semibold text-zinc-800">
                      {['entrada', 'entrada_producao'].includes(mv.tipo) ? '+' : '-'}{mv.quantidade} {mv.unidade}
                    </td>
                    <td className="px-4 py-3 text-zinc-500 max-w-[180px]">
                      {(() => {
                        const d = getMotivoDisplay(mv);
                        return (
                          <div>
                            <p className={`truncate text-xs ${d.cls}`}>{d.label}</p>
                            {d.sub && <p className="text-[10px] text-zinc-400">{d.sub}</p>}
                          </div>
                        );
                      })()}
                    </td>
                    <td className="px-4 py-3">
                      {mv.pedidoNumero ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200 whitespace-nowrap">
                          <i className="ri-receipt-line text-[10px]" />
                          {mv.pedidoNumero}
                        </span>
                      ) : (
                        <span className="text-zinc-300 text-xs">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-zinc-600">{mv.operador}</td>
                    <td className="px-4 py-3 text-right text-zinc-500 whitespace-nowrap">{mv.data} {mv.hora}</td>
                    <td className="px-4 py-3 text-right font-semibold">
                      {mv.custo ? <span className="text-emerald-600">{fmt(mv.custo)}</span> : <span className="text-zinc-300">—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Mobile cards */}
      <div className="md:hidden space-y-2">
        {movs.length === 0 ? (
          <div className="bg-white border border-zinc-100 rounded-xl py-10 text-center">
            <i className="ri-calendar-line text-2xl block mb-2 text-zinc-300" />
            <p className="text-xs font-medium text-zinc-400">Nenhuma movimentação encontrada</p>
            {hasDateFilter && <p className="text-xs mt-1 text-zinc-400">Tente outro período ou limpe o filtro</p>}
          </div>
        ) : movs.map((mv) => {
          const cfg = tipoConfig[mv.tipo];
          return (
            <div key={mv.id} className="bg-white border border-zinc-100 rounded-xl p-3">
              <div className="flex items-start justify-between gap-2 mb-2">
                <span className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold w-fit ${cfg.cls}`}>
                  <div className="w-3 h-3 flex items-center justify-center">{cfg.icon}</div>
                  {cfg.label}
                </span>
                <span className="text-[10px] text-zinc-400 whitespace-nowrap">{mv.data} {mv.hora}</span>
              </div>
              <p className="text-sm font-bold text-zinc-800 mb-1 truncate">{mv.insumoNome}</p>
              <div className="flex items-center justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-zinc-700">
                    {['entrada', 'entrada_producao'].includes(mv.tipo) ? '+' : '-'}{mv.quantidade} {mv.unidade}
                  </p>
                  {mv.tipo === 'saida_venda' && mv.itemVendidoNome ? (
                    <p className="text-[10px] font-semibold text-sky-700 truncate">{mv.itemVendidoNome}</p>
                  ) : mv.motivo ? (
                    <p className="text-[10px] text-zinc-400 truncate max-w-[180px]">{mv.motivo}</p>
                  ) : mv.tipo === 'saida_venda' ? (
                    <p className="text-[10px] text-zinc-400">Baixa automática por venda</p>
                  ) : null}
                  {mv.pedidoNumero && (
                    <span className="inline-flex items-center gap-0.5 mt-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
                      <i className="ri-receipt-line text-[9px]" />{mv.pedidoNumero}
                    </span>
                  )}
                </div>
                <div className="text-right flex-shrink-0">
                  {mv.custo ? (
                    <span className="text-sm font-bold text-emerald-600">{fmt(mv.custo)}</span>
                  ) : (
                    <span className="text-xs text-zinc-300">—</span>
                  )}
                  <p className="text-[10px] text-zinc-400">{mv.operador}</p>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {showModal && (
        <NovaMovimentacaoModal
          onClose={() => setShowModal(false)}
          onOpenCompra={handleOpenCompra}
        />
      )}
      {showPerdaModal && (
        <RegistrarPerdaModal
          operador="Operador Estoque"
          onClose={() => setShowPerdaModal(false)}
        />
      )}
      {showTransferModal && <TransferirEstoqueModal onClose={() => setShowTransferModal(false)} />}
      {showCompraModal && (
        <NovaCompraModal
          insumoPreSelecionado={compraInsumoPreSelecionado}
          onClose={() => { setShowCompraModal(false); setCompraInsumoPreSelecionado(null); }}
          onSaved={() => { setShowCompraModal(false); setCompraInsumoPreSelecionado(null); }}
        />
      )}
    </div>
  );
}
