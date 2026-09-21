import { Settings, Store, ChefHat, Sliders, Shield, LayoutGrid, Printer, FileText, FileCheck2 } from 'lucide-react';
import FiscalTab from './components/FiscalTab';
import { useSearchParams } from 'react-router-dom';
import LojaTab from './components/LojaTab';
import EstacoesPagamentosTab from './components/EstacoesPagamentosTab';
import OperacaoTab from './components/OperacaoTab';
import PermissoesTab from './components/PermissoesTab';
import MesasConfigTab from './components/MesasConfigTab';
import ImpressorasTab from './components/ImpressorasTab';
import ModelosImpressaoTab from './components/ModelosImpressaoTab';
import { usePermissoes } from '@/hooks/usePermissoes';
import { cfgKeyDaAba } from '@/constants/permissoesAbas';

type Tab = 'loja' | 'fiscal' | 'mesas' | 'estacoes' | 'impressoras' | 'modelos-impressao' | 'operacao' | 'permissoes';

const VALID_TABS: Tab[] = ['loja', 'fiscal', 'mesas', 'estacoes', 'impressoras', 'modelos-impressao', 'operacao', 'permissoes'];

const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'loja', label: 'Dados da Loja', icon: <Store size={14} /> },
  { id: 'fiscal', label: 'Fiscal (NFC-e)', icon: <FileCheck2 size={14} /> },
  { id: 'mesas', label: 'Mesas & QR Codes', icon: <LayoutGrid size={14} /> },
  { id: 'estacoes', label: 'Estações & Pagamentos', icon: <ChefHat size={14} /> },
  { id: 'impressoras', label: 'Impressoras', icon: <Printer size={14} /> },
  { id: 'modelos-impressao', label: 'Modelos de Impressão', icon: <FileText size={14} /> },
  { id: 'operacao', label: 'Operação & Integrações', icon: <Sliders size={14} /> },
  { id: 'permissoes', label: 'Permissões', icon: <Shield size={14} /> },
];

export default function ConfiguracoesPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  // Abas liberadas para o papel (Configurações › Permissões, 2026-09-21).
  // Mesmo padrão do Financeiro e dos Relatórios: a tela continua exigindo
  // `configuracoes_editar`, e aqui filtramos aba a aba.
  const { hasPermissao, loading: carregandoPermissoes } = usePermissoes();
  const podeAba = (t: string) => { const k = cfgKeyDaAba(t); return !!k && hasPermissao(k); };
  const abasLiberadas = tabs.filter((t) => podeAba(t.id));

  const rawTab = searchParams.get('tab') as Tab | null;
  const daUrl = rawTab && VALID_TABS.includes(rawTab) && podeAba(rawTab) ? rawTab : null;
  // Link para uma aba que o papel não tem (ou aba inválida) cai na primeira
  // liberada, em vez de abrir a tela vazia.
  const tab: Tab = daUrl ?? (abasLiberadas[0]?.id ?? 'loja');

  const setTab = (t: Tab) => setSearchParams({ tab: t }, { replace: true });

  // Enquanto as permissões carregam, `hasPermissao` ainda não é confiável —
  // mostrar "sem acesso" aqui faria a tela piscar o aviso a cada entrada.
  if (!carregandoPermissoes && abasLiberadas.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center px-6">
        <div className="w-10 h-10 flex items-center justify-center bg-zinc-100 rounded-xl mb-3">
          <Settings size={18} className="text-zinc-400" />
        </div>
        <h1 className="text-sm font-bold text-zinc-800">Configurações</h1>
        <p className="text-xs text-zinc-400 mt-1 max-w-sm">
          Seu perfil não tem nenhuma aba de Configurações liberada. Peça ao administrador em
          Configurações › Permissões.
        </p>
      </div>
    );
  }

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
          {abasLiberadas.map((t) => (
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
        {tab === 'loja' && podeAba('loja') && <LojaTab />}
        {tab === 'fiscal' && podeAba('fiscal') && <FiscalTab />}
        {tab === 'mesas' && podeAba('mesas') && <MesasConfigTab />}
        {tab === 'estacoes' && podeAba('estacoes') && <EstacoesPagamentosTab />}
        {tab === 'impressoras' && podeAba('impressoras') && <ImpressorasTab />}
        {tab === 'modelos-impressao' && podeAba('modelos-impressao') && <ModelosImpressaoTab />}
        {tab === 'operacao' && podeAba('operacao') && <OperacaoTab />}
        {tab === 'permissoes' && podeAba('permissoes') && <PermissoesTab />}
      </div>
    </div>
  );
}
