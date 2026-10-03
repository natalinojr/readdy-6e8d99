import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import InicioTab from './components/inicio/InicioTab';
import InsumosTab from './components/InsumosTab';
import MovimentacoesTab from './components/MovimentacoesTab';
import EstoqueTeoricoTab from './components/EstoqueTeoricoTab';
import InventarioTab from './components/InventarioTab';
import CmvTab from './components/CmvTab';
import ProducaoTab from './components/ProducaoTab';
import FornecedoresRelatorioTab from './components/FornecedoresRelatorioTab';
import ValidadeTab from './components/ValidadeTab';
import ConsumoIngredientesTab from '../relatorios/components/ConsumoIngredientesTab';
import { useEstoque } from '../../contexts/EstoqueContext';
import { useEstoqueSituacao } from '../../hooks/useEstoqueSituacao';
import { contagemDeHoje } from '../../lib/estoqueRegras';
import { usePermissoes } from '../../hooks/usePermissoes';
import CardapioExportImportModal from '../../components/feature/CardapioExportImportModal';

type Tab = 'inicio' | 'insumos' | 'movimentacoes' | 'teorico' | 'inventario' | 'cmv' | 'producao' | 'fornecedores' | 'validade' | 'consumo';

const VALID_TABS: Tab[] = ['inicio', 'insumos', 'movimentacoes', 'teorico', 'inventario', 'cmv', 'producao', 'fornecedores', 'validade', 'consumo'];

// Início (2026-10-03) é a primeira aba e a padrão: o que comprar, contar e o que vai faltar.
// Nenhuma aba saiu (regra do dono); a lista de insumos ("Estoque") passou a ser a segunda.
const tabs: { id: Tab; label: string; icon: string }[] = [
  { id: 'inicio', label: 'Início', icon: 'ri-home-5-line' },
  { id: 'insumos', label: 'Estoque', icon: 'ri-archive-line' },
  { id: 'movimentacoes', label: 'Movimentações', icon: 'ri-arrow-left-right-line' },
  { id: 'teorico', label: 'Estoque Teórico', icon: 'ri-calculator-line' },
  { id: 'inventario', label: 'Inventário', icon: 'ri-clipboard-line' },
  { id: 'cmv', label: 'CMV / Fichas', icon: 'ri-percent-line' },
  { id: 'producao', label: 'Produção', icon: 'ri-tools-line' },
  { id: 'consumo', label: 'Consumo', icon: 'ri-line-chart-line' },
  { id: 'fornecedores', label: 'Por Fornecedor', icon: 'ri-truck-line' },
  { id: 'validade', label: 'Validade & Lotes', icon: 'ri-calendar-check-line' },
];

export default function EstoquePage() {
  // Aba guardada na URL (?tab=producao) — nao em useState puro. Sem isso, sair
  // da pagina (outro modulo) e voltar remonta o componente e reseta pra
  // "insumos" sempre, mesmo se o usuario estava em Producao. Mesmo padrao ja
  // usado em ConfiguracoesPage.
  const [searchParams, setSearchParams] = useSearchParams();
  const rawTab = searchParams.get('tab') as Tab | null;
  const tab: Tab = rawTab && VALID_TABS.includes(rawTab) ? rawTab : 'inicio';
  const setTab = (t: Tab) => setSearchParams({ tab: t }, { replace: true });

  const [showExportImport, setShowExportImport] = useState(false);
  const { reloadInsumos } = useEstoque();

  // Números do topo pela regra única (a mesma do Início, do Dashboard e do assistente).
  const situacao = useEstoqueSituacao();
  const nComprar = situacao.data?.totais.abaixoMinimo ?? 0;
  const { hasPermissao } = usePermissoes();
  const podeContar = hasPermissao('estoque_inventario');
  const nContar = useMemo(() => (situacao.data && podeContar ? contagemDeHoje(situacao.data).itens.length : 0), [situacao.data, podeContar]);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 md:px-6 pt-4 md:pt-5 pb-0" style={{ background: '#ffffff', borderBottom: '1px solid #f4f4f5' }}>
        <div className="flex items-center justify-between gap-3 mb-3 md:mb-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 md:w-9 md:h-9 flex items-center justify-center rounded-xl flex-shrink-0" style={{ background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)' }}>
              <i className="ri-archive-line text-white text-base md:text-lg" />
            </div>
            <div className="min-w-0">
              <h1 className="text-base md:text-lg font-bold text-zinc-800">Estoque</h1>
              <p className="text-xs text-zinc-400 hidden sm:block">Comprar, contar e o que vai faltar</p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {tab !== 'inicio' && nComprar > 0 && (
              <button onClick={() => setTab('inicio')} className="flex items-center gap-1.5 px-3 py-2 bg-red-50 border border-red-200 rounded-xl text-xs font-semibold text-red-700 cursor-pointer">
                <i className="ri-shopping-cart-2-line text-sm" />
                {nComprar} abaixo do mínimo
              </button>
            )}
            {tab !== 'inicio' && nContar > 0 && (
              <button onClick={() => setTab('inicio')} className="flex items-center gap-1.5 px-3 py-2 bg-zinc-50 border border-zinc-200 rounded-xl text-xs font-semibold text-zinc-700 cursor-pointer">
                <i className="ri-scales-3-line text-sm" />
                {nContar} para contar
              </button>
            )}
            <button
              onClick={() => setShowExportImport(true)}
              className={`${tab === 'inicio' ? 'hidden md:flex' : 'flex'} items-center gap-1.5 px-3 py-2 border border-zinc-200 bg-white hover:bg-zinc-50 rounded-xl text-xs font-semibold text-zinc-600 cursor-pointer transition-colors whitespace-nowrap shadow-sm`}
            >
              <i className="ri-exchange-line" />
              Exportar / Importar
            </button>
          </div>
        </div>

        {/* Tabs — scroll horizontal no mobile; a partir de md quebram em linhas */}
        <div className="flex md:flex-wrap gap-0.5 overflow-x-auto md:overflow-visible scrollbar-hide -mx-4 md:mx-0 px-4 md:px-0" style={{ borderBottom: '1px solid rgba(245,158,11,0.15)' }}>
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-1 md:gap-1.5 px-2.5 md:px-3 py-2.5 text-xs font-semibold whitespace-nowrap border-b-2 transition-colors cursor-pointer flex-shrink-0 ${
                tab === t.id
                  ? 'border-amber-500 text-amber-600'
                  : 'border-transparent text-zinc-400 hover:text-zinc-700'
              }`}
            >
              <i className={t.icon} />
              {t.label}
              {t.id === 'validade' && (
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Content — cada aba cuida do próprio container (p-4 md:p-6 max-w-[1400px]) */}
      <div className="flex-1 overflow-y-auto">
        {tab === 'inicio' && <InicioTab situacao={situacao.data} carregando={situacao.loading} erro={situacao.error} onReload={situacao.reload} />}
        {tab === 'insumos' && <InsumosTab />}
        {tab === 'movimentacoes' && <MovimentacoesTab />}
        {tab === 'teorico' && <EstoqueTeoricoTab />}
        {tab === 'inventario' && <InventarioTab />}
        {tab === 'cmv' && <CmvTab />}
        {tab === 'producao' && <ProducaoTab />}
        {tab === 'consumo' && (
          <div className="p-4 md:p-6 max-w-[1400px] mx-auto">
            <ConsumoIngredientesTab periodo="Últimos 30 dias" />
          </div>
        )}
        {tab === 'fornecedores' && <FornecedoresRelatorioTab />}
        {tab === 'validade' && <ValidadeTab />}
      </div>

      {/* Modal Exportar / Importar */}
      <CardapioExportImportModal
        open={showExportImport}
        onClose={() => setShowExportImport(false)}
        onSuccess={() => {
          reloadInsumos();
          situacao.reload();
        }}
      />
    </div>
  );
}
