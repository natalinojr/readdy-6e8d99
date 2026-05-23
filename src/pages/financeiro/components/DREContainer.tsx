import { useState } from 'react';
import DRETab from './DRETab';
import DREComparativoTab from './DREComparativoTab';
import CategoriasDRETab from './CategoriasDRETab';

const SUB_TABS = [
  { id: 'dre', label: 'DRE', icon: 'ri-file-chart-line', desc: 'Demonstrativo de Resultado' },
  { id: 'comparativo', label: 'DRE Comparativo', icon: 'ri-scales-3-line', desc: 'Caixa × Competência' },
  { id: 'categorias', label: 'Categorias DRE', icon: 'ri-folder-chart-line', desc: 'Estrutura do DRE' },
];

export default function DREContainer() {
  const [activeSubTab, setActiveSubTab] = useState<'dre' | 'comparativo' | 'categorias'>('dre');

  return (
    <div className="flex flex-col h-full">
      {/* Sub-navigation */}
      <div className="bg-white border-b border-zinc-200 px-6 pt-3 pb-0">
        <div className="flex items-center gap-1">
          {SUB_TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveSubTab(tab.id as typeof activeSubTab)}
              className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold whitespace-nowrap border-b-2 transition-colors cursor-pointer rounded-t-lg ${
                activeSubTab === tab.id
                  ? 'border-amber-500 text-amber-600 bg-amber-50/50'
                  : 'border-transparent text-zinc-500 hover:text-zinc-700 hover:bg-zinc-50'
              }`}
            >
              <i className={`${tab.icon} text-sm`} />
              {tab.label}
              {activeSubTab === tab.id && (
                <span className="text-xs text-amber-400 font-normal hidden sm:inline">
                  — {tab.desc}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {activeSubTab === 'dre' && <DRETab />}
        {activeSubTab === 'comparativo' && <DREComparativoTab />}
        {activeSubTab === 'categorias' && <CategoriasDRETab />}
      </div>
    </div>
  );
}
