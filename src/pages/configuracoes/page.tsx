import { Settings, Store, ChefHat, Sliders, Shield, LayoutGrid, Printer, FileText } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import LojaTab from './components/LojaTab';
import EstacoesPagamentosTab from './components/EstacoesPagamentosTab';
import OperacaoTab from './components/OperacaoTab';
import PermissoesTab from './components/PermissoesTab';
import MesasConfigTab from './components/MesasConfigTab';
import ImpressorasTab from './components/ImpressorasTab';
import ModelosImpressaoTab from './components/ModelosImpressaoTab';

type Tab = 'loja' | 'mesas' | 'estacoes' | 'impressoras' | 'modelos-impressao' | 'operacao' | 'permissoes';

const VALID_TABS: Tab[] = ['loja', 'mesas', 'estacoes', 'impressoras', 'modelos-impressao', 'operacao', 'permissoes'];

const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'loja', label: 'Dados da Loja', icon: <Store size={14} /> },
  { id: 'mesas', label: 'Mesas & QR Codes', icon: <LayoutGrid size={14} /> },
  { id: 'estacoes', label: 'Estações & Pagamentos', icon: <ChefHat size={14} /> },
  { id: 'impressoras', label: 'Impressoras', icon: <Printer size={14} /> },
  { id: 'modelos-impressao', label: 'Modelos de Impressão', icon: <FileText size={14} /> },
  { id: 'operacao', label: 'Operação & Integrações', icon: <Sliders size={14} /> },
  { id: 'permissoes', label: 'Permissões', icon: <Shield size={14} /> },
];

export default function ConfiguracoesPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const rawTab = searchParams.get('tab') as Tab | null;
  const tab: Tab = rawTab && VALID_TABS.includes(rawTab) ? rawTab : 'loja';

  const setTab = (t: Tab) => setSearchParams({ tab: t }, { replace: true });

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-4" style={{ background: '#ffffff', borderBottom: '1px solid #f4f4f5' }}>
        <div className="flex items-center gap-3 mb-4">
          <div className="w-8 h-8 flex items-center justify-center bg-zinc-100 rounded-lg">
            <Settings size={16} className="text-zinc-600" />
          </div>
          <div>
            <h1 className="text-base font-bold text-zinc-900">Configurações</h1>
            <p className="text-xs text-zinc-400">Loja, mesas, estações, impressoras, modelos de ticket, operação e permissões</p>
          </div>
        </div>
        <div className="flex items-center gap-1 -mb-4 overflow-x-auto" style={{ borderBottom: '1px solid rgba(245,158,11,0.15)' }}>
          {tabs.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors whitespace-nowrap cursor-pointer flex-shrink-0 ${
                tab === t.id ? 'border-amber-500 text-amber-600' : 'border-transparent text-zinc-500 hover:text-zinc-700'
              }`}>
              <div className="w-4 h-4 flex items-center justify-center">{t.icon}</div>
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-6">
        {tab === 'loja' && <LojaTab />}
        {tab === 'mesas' && <MesasConfigTab />}
        {tab === 'estacoes' && <EstacoesPagamentosTab />}
        {tab === 'impressoras' && <ImpressorasTab />}
        {tab === 'modelos-impressao' && <ModelosImpressaoTab />}
        {tab === 'operacao' && <OperacaoTab />}
        {tab === 'permissoes' && <PermissoesTab />}
      </div>
    </div>
  );
}
