import { useState } from 'react';
import { Package, AlertTriangle } from 'lucide-react';
import InsumosTab from './components/InsumosTab';
import MovimentacoesTab from './components/MovimentacoesTab';
import InventarioTab from './components/InventarioTab';
import CmvTab from './components/CmvTab';
import ProducaoTab from './components/ProducaoTab';
import DivergenciaPanel from './components/DivergenciaPanel';
import FornecedoresRelatorioTab from './components/FornecedoresRelatorioTab';
import ValidadeTab from './components/ValidadeTab';
import ConsumoIngredientesTab from '../relatorios/components/ConsumoIngredientesTab';
import { useEstoque } from '../../contexts/EstoqueContext';
import CardapioExportImportModal from '../../components/feature/CardapioExportImportModal';

type Tab = 'insumos' | 'movimentacoes' | 'inventario' | 'cmv' | 'producao' | 'fornecedores' | 'validade' | 'consumo';

const tabs: { id: Tab; label: string; badge?: string }[] = [
  { id: 'insumos', label: 'Estoque' },
  { id: 'movimentacoes', label: 'Movimentações' },
  { id: 'inventario', label: 'Inventário' },
  { id: 'cmv', label: 'CMV / Fichas' },
  { id: 'producao', label: 'Produção' },
  { id: 'consumo', label: 'Consumo' },
  { id: 'fornecedores', label: 'Por Fornecedor' },
  { id: 'validade', label: 'Validade & Lotes' },
];

export default function EstoquePage() {
  const [tab, setTab] = useState<Tab>('insumos');
  const [showExportImport, setShowExportImport] = useState(false);
  const { insumos, insumosEsgotados, reloadInsumos } = useEstoque();

  const alertas = insumos.filter((i) => i.estoqueAtual <= i.estoqueMinimo).length;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 md:px-6 py-4" style={{ background: '#ffffff', borderBottom: '1px solid #f4f4f5' }}>
        <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 flex items-center justify-center bg-emerald-50 rounded-lg">
              <Package size={16} className="text-emerald-600" />
            </div>
            <div>
              <h1 className="text-base font-bold text-zinc-900">Estoque</h1>
              <p className="text-xs text-zinc-400 hidden sm:block">Insumos, movimentações e inventário</p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {insumosEsgotados.length > 0 && (
              <div className="flex items-center gap-2 px-3 py-2 bg-red-50 border border-red-200 rounded-xl">
                <i className="ri-forbid-2-fill text-red-500 text-sm" />
                <p className="text-xs font-semibold text-red-700">
                  {insumosEsgotados.length} esgotado{insumosEsgotados.length > 1 ? 's' : ''}
                </p>
              </div>
            )}
            {alertas > 0 && (
              <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-xl">
                <div className="w-4 h-4 flex items-center justify-center text-amber-500"><AlertTriangle size={14} /></div>
                <p className="text-xs font-semibold text-amber-700">
                  {alertas} em alerta
                </p>
              </div>
            )}
            <button
              onClick={() => setShowExportImport(true)}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-amber-600 bg-amber-50 border border-amber-200 rounded-xl hover:bg-amber-100 transition-colors cursor-pointer whitespace-nowrap"
            >
              <i className="ri-exchange-line" />
              Exportar / Importar
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 -mb-4 overflow-x-auto" style={{ borderBottom: '1px solid rgba(245,158,11,0.15)' }}>
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 px-3 md:px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors whitespace-nowrap cursor-pointer flex-shrink-0 ${
                tab === t.id
                  ? 'border-amber-500 text-amber-600'
                  : 'border-transparent text-zinc-500 hover:text-zinc-700'
              }`}
            >
              {t.label}
              {t.id === 'validade' && (
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        <div className="max-w-7xl mx-auto space-y-6">
          {/* Painel de divergência — só na aba Inventário */}
          {tab === 'inventario' && <DivergenciaPanel />}

          {tab === 'insumos' && <InsumosTab />}
          {tab === 'movimentacoes' && <MovimentacoesTab />}
          {tab === 'inventario' && <InventarioTab />}
          {tab === 'cmv' && <CmvTab />}
          {tab === 'producao' && <ProducaoTab />}
          {tab === 'consumo' && <ConsumoIngredientesTab periodo="Últimos 30 dias" />}
          {tab === 'fornecedores' && <FornecedoresRelatorioTab />}
          {tab === 'validade' && <ValidadeTab />}
        </div>
      </div>

      {/* Modal Exportar / Importar */}
      <CardapioExportImportModal
        open={showExportImport}
        onClose={() => setShowExportImport(false)}
        onSuccess={() => {
          reloadInsumos();
        }}
      />
    </div>
  );
}
