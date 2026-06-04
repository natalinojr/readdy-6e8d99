import { useState } from 'react';
import { useCardapio } from '../../contexts/CardapioContext';
import CategoriasTab from './components/CategoriasTab';
import ItensTab from './components/ItensTab';
import CombosTab from './components/CombosTab';
import ObservacoesGlobaisTab from './components/ObservacoesGlobaisTab';
import CardapioExportImportModal from '../../components/feature/CardapioExportImportModal';

import { notifyReload } from '@/lib/reloadSignal';

type Tab = 'categorias' | 'itens' | 'combos' | 'obsGlobais';

export default function CardapioPage() {
  const { itens, categorias, combos, obsGlobais, loading, recarregar } = useCardapio();
  const [activeTab, setActiveTab] = useState<Tab>('itens');
  const [showExportImport, setShowExportImport] = useState(false);

  const tabs: { id: Tab; label: string; shortLabel: string; icon: string; count: number }[] = [
    { id: 'itens', label: 'Itens', shortLabel: 'Itens', icon: 'ri-file-list-3-line', count: itens.length },
    { id: 'categorias', label: 'Categorias', shortLabel: 'Categ.', icon: 'ri-layout-grid-line', count: categorias.length },
    { id: 'combos', label: 'Combos', shortLabel: 'Combos', icon: 'ri-gift-2-line', count: combos.length },
    { id: 'obsGlobais', label: 'Obs. Globais', shortLabel: 'Obs.', icon: 'ri-chat-3-line', count: obsGlobais.filter(o => o.ativo).length },
  ];

  const ativosCount = itens.filter(i => i.status === 'ativo').length;
  const inativos = itens.filter(i => i.status === 'inativo').length;
  const promoCount = itens.filter(i => i.promocoes.some(p => p.ativo)).length;

  return (
    <div className="min-h-screen bg-gray-50/50">
      {/* Header */}
      <div className="px-4 md:px-6 py-4 md:py-5" style={{ background: '#ffffff', borderBottom: '1px solid #f4f4f5' }}>
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div>
            <h1 className="text-lg font-bold text-gray-900">Cardápio</h1>
            <p className="text-xs text-gray-500 mt-0.5">Gerencie categorias, itens e combos do seu restaurante</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1.5 bg-green-50 text-green-700 text-xs font-medium px-2.5 py-1.5 rounded-full">
              <i className="ri-checkbox-circle-line" />
              {ativosCount} ativos
            </div>
            {inativos > 0 && (
              <div className="flex items-center gap-1.5 bg-gray-100 text-gray-600 text-xs font-medium px-2.5 py-1.5 rounded-full">
                <i className="ri-pause-circle-line" />
                {inativos} inativos
              </div>
            )}
            {promoCount > 0 && (
              <div className="flex items-center gap-1.5 bg-red-50 text-red-600 text-xs font-medium px-2.5 py-1.5 rounded-full">
                <i className="ri-price-tag-3-line" />
                {promoCount} promo
              </div>
            )}
            <button
              onClick={() => setShowExportImport(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-amber-600 bg-amber-50 border border-amber-200 rounded-full hover:bg-amber-100 transition-colors cursor-pointer whitespace-nowrap"
            >
              <i className="ri-exchange-line" />
              Exportar / Importar
            </button>
          </div>
        </div>

        {/* Tabs — scrollable on mobile */}
        <div className="flex items-center gap-0 mt-4 border-b border-gray-100 -mb-4 pb-0 overflow-x-auto scrollbar-none">
          {tabs.map(t => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={`flex items-center gap-1.5 px-3 md:px-4 py-3 text-sm font-medium border-b-2 transition-colors cursor-pointer whitespace-nowrap -mb-px flex-shrink-0 ${
                activeTab === t.id
                  ? 'border-orange-500 text-orange-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              <i className={`${t.icon} text-base`} />
              <span className="hidden sm:inline">{t.label}</span>
              <span className="sm:hidden">{t.shortLabel}</span>
              <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${
                activeTab === t.id ? 'bg-orange-100 text-orange-600' : 'bg-gray-100 text-gray-500'
              }`}>
                {t.count}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="p-4 md:p-6">
        {loading && (
          <div className="flex items-center justify-center py-20">
            <div className="w-6 h-6 border-2 border-orange-400 border-t-transparent rounded-full animate-spin" />
          </div>
        )}
        {!loading && activeTab === 'itens' && <ItensTab />}
        {!loading && activeTab === 'categorias' && <CategoriasTab />}
        {!loading && activeTab === 'combos' && <CombosTab />}
        {!loading && activeTab === 'obsGlobais' && <ObservacoesGlobaisTab />}
      </div>

      {/* Modal Exportar / Importar */}
      <CardapioExportImportModal
        open={showExportImport}
        onClose={() => setShowExportImport(false)}
        onSuccess={() => {
          recarregar();
          notifyReload('menu');
        }}
      />
    </div>
  );
}
