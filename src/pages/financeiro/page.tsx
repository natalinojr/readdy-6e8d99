import { useEffect, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { usePermissoes } from '@/hooks/usePermissoes';
import { finKeyDaAba } from '@/constants/permissoesAbas';
import { useFinanceiroAlertas } from '@/hooks/useFinanceiroAlertas';
import VisaoGeralFinTab from './components/VisaoGeralFinTab';
import FluxoCaixaTab from './components/FluxoCaixaTab';
import ContasPagarTab from './components/ContasPagarTab';
import ContasReceberTab from './components/ContasReceberTab';
import ComprasTab from './components/ComprasTab';
import CentroCustosTab from './components/CentroCustosTab';
import DREContainer from './components/DREContainer';
import ImplantacaoTab from './components/ImplantacaoTab';
import OrcamentosTab from './components/OrcamentosTab';
import ConciliacaoTab from './components/ConciliacaoTab';
import BancosContasTab from './components/BancosContasTab';
import RHTab, { type RHView } from './components/RHTab';
import ContasVencidasPanel from './components/ContasVencidasPanel';
import DespesasTab from './components/DespesasTab';
import ReceitasTab from './components/ReceitasTab';
import NotasEntradaTab from './components/NotasEntradaTab';
import ItensClassificacaoTab from './components/ItensClassificacaoTab';
import IfoodTab from './components/IfoodTab';
import FreelancersTab from './components/FreelancersTab';
import EntregadoresTab from './components/EntregadoresTab';
import GuiasTab from './components/GuiasTab';
import TrilhaTab from './components/TrilhaTab';
import PagamentosTab from './components/pagamentos/PagamentosTab';
import PainelFinTab from './components/PainelFinTab';
import LancarFinanceiroModal from './components/LancarFinanceiroModal';
import { OQueAconteceu } from '@/components/feature/lancar';
import BuscaFinanceiro from './components/BuscaFinanceiro';

const TABS = [
  { id: 'painel', label: 'Painel', icon: 'ri-dashboard-3-line' },
  { id: 'visao', label: 'Visão Geral', icon: 'ri-dashboard-line' },
  { id: 'trilha', label: 'Trilha', icon: 'ri-route-line' },
  { id: 'pagamentos', label: 'Pagamentos', icon: 'ri-wallet-3-line' },
  { id: 'receitas', label: 'Receitas', icon: 'ri-arrow-down-circle-line' },
  { id: 'ifood', label: 'iFood', icon: 'ri-restaurant-2-line' },
  { id: 'despesas', label: 'Despesas', icon: 'ri-pie-chart-2-line' },
  { id: 'fluxo', label: 'Fluxo de Caixa', icon: 'ri-exchange-dollar-line' },
  { id: 'pagar', label: 'Contas a Pagar', icon: 'ri-bill-line' },
  { id: 'receber', label: 'Contas a Receber', icon: 'ri-hand-coin-line' },
  { id: 'orcamentos', label: 'Orçamentos', icon: 'ri-file-list-3-line' },
  { id: 'compras', label: 'Compras', icon: 'ri-shopping-cart-2-line' },
  { id: 'notas-entrada', label: 'Notas de Entrada', icon: 'ri-inbox-archive-line' },
  { id: 'itens', label: 'Classificação de Itens', icon: 'ri-price-tag-3-line' },
  { id: 'rh', label: 'RH / Folha', icon: 'ri-team-line' },
  { id: 'guias', label: 'Guias e impostos', icon: 'ri-file-upload-line' },
  { id: 'entregadores', label: 'Entregadores', icon: 'ri-e-bike-2-line' },
  { id: 'centros', label: 'Centro de Custos', icon: 'ri-pie-chart-line' },
  { id: 'dre', label: 'DRE', icon: 'ri-file-chart-line' },
  { id: 'contas-vencidas', label: 'Contas Vencidas', icon: 'ri-alarm-warning-line' },
  { id: 'bancos', label: 'Bancos e Contas', icon: 'ri-bank-card-line' },
  { id: 'conciliacao', label: 'Conciliação', icon: 'ri-bank-line' },
  { id: 'implantacao', label: 'Implantação', icon: 'ri-building-line' },
];

// As 21 abas em 6 grupos (2026-09-30): em cima o grupo, embaixo as abas dele em pílula.
// Nenhuma aba sai; ids e links (?tab=) continuam os mesmos.
const GRUPOS = [
  { id: 'inicio', label: 'Início', icon: 'ri-home-5-line', abas: ['painel', 'visao', 'trilha'] },
  { id: 'pagar', label: 'Pagar', icon: 'ri-bill-line', abas: ['pagamentos', 'pagar', 'contas-vencidas', 'guias', 'rh', 'entregadores'] },
  { id: 'receber', label: 'Receber', icon: 'ri-arrow-down-circle-line', abas: ['receitas', 'receber', 'ifood'] },
  { id: 'bancos', label: 'Bancos', icon: 'ri-bank-line', abas: ['bancos', 'conciliacao', 'fluxo'] },
  { id: 'compras', label: 'Compras', icon: 'ri-shopping-cart-2-line', abas: ['compras', 'notas-entrada', 'itens', 'orcamentos'] },
  { id: 'resultado', label: 'Resultado', icon: 'ri-file-chart-line', abas: ['dre', 'despesas', 'centros', 'implantacao'] },
];
// Ids antigos que ainda chegam por link e abrem dentro de outra aba.
const ABA_CANONICA: Record<string, string> = { previsao: 'fluxo', 'rh-relatorio': 'rh', freelancers: 'rh' };
// ?tab=rh&sub=prestadores abre o RH já na subaba (usado pelo "O que aconteceu?").
const SUBABAS_RH: RHView[] = ['folha', 'funcionarios', 'beneficios', 'freelancers', 'prestadores', 'relatorio'];

export default function FinanceiroPage() {
  const { user } = useAuth();
  const location = useLocation();
  // Abas liberadas para o papel (Configurações › Permissões; admin vê todas).
  const { hasPermissao } = usePermissoes();
  // O Painel só junta números de outras abas: vê quem vê a Visão Geral.
  const podeAba = (t: string) => { const k = finKeyDaAba(t === 'painel' ? 'visao' : t); return !!k && hasPermissao(k); };
  // Freelancers virou subaba de RH / Folha (2026-09-28): quem só tem a permissão de Freelancers
  // continua vendo a aba RH, mas só com os freelancers (sem folha nem salários).
  const podeRH = podeAba('rh');
  const podeAbaOuFreela = (t: string) => podeAba(t) || (t === 'rh' && podeAba('freelancers'));
  const abas = TABS.filter((t) => podeAbaOuFreela(t.id));
  // Mesmo número do menu lateral (contas vencidas + vencendo em 7 dias + folha pendente),
  // quebrado nas abas onde cada parte se resolve — antes só o menu mostrava o total.
  const { contasVencidas, contasVencendo, folhaPendente } = useFinanceiroAlertas();
  const avisoDaAba: Record<string, { n: number; cor: string; dica: string }> = {
    pagar: { n: contasVencidas + contasVencendo, cor: contasVencidas > 0 ? 'bg-red-500' : 'bg-amber-500', dica: `${contasVencidas} vencida(s) e ${contasVencendo} vencendo em 7 dias` },
    'contas-vencidas': { n: contasVencidas, cor: 'bg-red-500', dica: `${contasVencidas} conta(s) vencida(s)` },
    rh: { n: folhaPendente, cor: 'bg-amber-500', dica: `${folhaPendente} pagamento(s) da folha do mês pendente(s)` },
  };
  // Aba na URL (?tab=dre), como no Estoque e nas Configurações. Antes era só useState com
  // location.state: quem chegava por link — inclusive o botão "Abrir DRE" do assistente
  // (2026-09-16) — caía sempre na Visão Geral, e navegar já estando em /financeiro não fazia nada.
  const [searchParams, setSearchParams] = useSearchParams();
  const daUrl = searchParams.get('tab');
  const doState = (location.state as { activeTab?: string } | null)?.activeTab;
  const valida = (t: string | null | undefined) => (t && (TABS.some((x) => x.id === t) || t === 'previsao' || t === 'rh-relatorio' || t === 'freelancers') && podeAbaOuFreela(t) ? t : null);
  const activeTab = valida(daUrl) ?? valida(doState) ?? abas[0]?.id ?? 'visao';
  const setActiveTab = (t: string) => setSearchParams({ tab: t }, { replace: true });
  // Abre a aba já pedindo a janela de lançamento (?abrir=), usado pelo botão Lançar.
  const abrirAba = (t: string, abrir?: string) => setSearchParams(abrir ? { tab: t, abrir } : { tab: t }, { replace: true });
  // Lançar (2026-10-03): abre o "O que aconteceu?"; a lista antiga com os 13 caminhos continua como
  // "lista completa" dentro dele.
  const [lancarAberto, setLancarAberto] = useState(false);
  const [listaLancarAberta, setListaLancarAberta] = useState(false);
  const navigate = useNavigate();
  const [buscaAberta, setBuscaAberta] = useState(false);
  // Resultado da busca: vai para a aba com o item (?busca=/?foco=/?nota=). A chave recria a aba,
  // porque algumas só leem esses parâmetros ao abrir (ex.: a busca do Contas a Pagar).
  const [chaveConteudo, setChaveConteudo] = useState(0);
  const irParaResultado = (params: Record<string, string>) => { setSearchParams(params, { replace: true }); setChaveConteudo((k) => k + 1); };
  // Destino do "O que aconteceu?": aba do Financeiro troca aqui mesmo (recriando a aba, que lê ?abrir= ao montar);
  // o resto (Recebimentos, PDV) navega.
  const navegarLancar = (rota: string) => {
    if (rota.startsWith('/financeiro?')) irParaResultado(Object.fromEntries(new URLSearchParams(rota.split('?')[1])));
    else navigate(rota);
  };
  const subRH = SUBABAS_RH.find((s) => s === searchParams.get('sub'));
  // ?foco=<id da compra> abre a aba Compras já piscando naquela linha — usado pelo Rastreamento
  // da Conciliação (2026-09-20), para o botão cair na compra certa e não só na lista.
  const [highlightPurchaseId, setHighlightPurchaseId] = useState<string | undefined>(
    () => searchParams.get('foco') ?? undefined,
  );

  // Chegou por location.state (telas antigas que navegam assim): passa para a URL uma vez, senão
  // trocar de aba depois voltaria para a do state.
  useEffect(() => {
    if (!daUrl && valida(doState)) setSearchParams({ tab: String(doState) }, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Link externo (?tab=compras&foco=...) chegando com a tela já montada
  useEffect(() => {
    const foco = searchParams.get('foco');
    if (foco) setHighlightPurchaseId(foco);
  }, [searchParams]);

  // Grupos com as abas liberadas para o papel; grupo sem nenhuma aba liberada não aparece.
  const abaCanonica = ABA_CANONICA[activeTab] ?? activeTab;
  const grupos = GRUPOS
    // Na ordem do grupo (a principal primeiro), não na ordem da lista TABS.
    .map((g) => ({ ...g, abas: g.abas.map((id) => abas.find((t) => t.id === id)).filter((t): t is (typeof abas)[number] => !!t) }))
    .filter((g) => g.abas.length > 0);
  const grupoAtivo = grupos.find((g) => g.abas.some((t) => t.id === abaCanonica)) ?? grupos[0];
  // Voltar a um grupo reabre a última aba usada nele (e não sempre a primeira).
  const [ultimaDoGrupo, setUltimaDoGrupo] = useState<Record<string, string>>({});
  const grupoAtivoId = grupoAtivo?.id;
  useEffect(() => {
    if (!grupoAtivoId) return;
    setUltimaDoGrupo((u) => (u[grupoAtivoId] === abaCanonica ? u : { ...u, [grupoAtivoId]: abaCanonica }));
  }, [grupoAtivoId, abaCanonica]);
  // No celular as fileiras rolam de lado: traz o grupo e a aba ativos para a vista.
  useEffect(() => {
    document.querySelectorAll('[data-fin-ativo]').forEach((el) => el.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
  }, [abaCanonica]);
  const abrirGrupo = (g: (typeof grupos)[number]) => {
    const ultima = ultimaDoGrupo[g.id];
    setActiveTab(ultima && g.abas.some((t) => t.id === ultima) ? ultima : g.abas[0].id);
  };
  // Selo do grupo: o maior aviso entre as abas dele (sem somar, para não contar a mesma conta
  // duas vezes — Contas a Pagar já inclui as vencidas).
  const avisoDoGrupo = (g: (typeof grupos)[number]) => {
    const avisos = g.abas.map((t) => avisoDaAba[t.id]).filter((a): a is (typeof avisoDaAba)[string] => !!a && a.n > 0);
    if (avisos.length === 0) return null;
    const maior = avisos.reduce((a, b) => (b.n > a.n ? b : a));
    return { n: maior.n, cor: avisos.some((a) => a.cor === 'bg-red-500') ? 'bg-red-500' : maior.cor, dica: avisos.map((a) => a.dica).join(' · ') };
  };

  const handleNavigateToCompras = (purchaseId?: string) => {
    setHighlightPurchaseId(purchaseId);
    setActiveTab('compras');
  };

  const handleClearHighlight = () => {
    setHighlightPurchaseId(undefined);
  };

  if (!user || !['admin', 'gerente', 'financeiro', 'contabilidade'].includes(user.perfil)) {
    return (
      <div className="flex-1 flex items-center justify-center bg-zinc-50">
        <div className="text-center">
          <div className="w-16 h-16 flex items-center justify-center bg-red-100 rounded-full mx-auto mb-4">
            <i className="ri-lock-line text-red-500 text-2xl" />
          </div>
          <h2 className="text-lg font-semibold text-zinc-800">Acesso Restrito</h2>
          <p className="text-zinc-500 text-sm mt-1">Apenas administradores e supervisores podem acessar o módulo financeiro.</p>
        </div>
      </div>
    );
  }

  if (abas.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center bg-zinc-50">
        <div className="text-center">
          <div className="w-16 h-16 flex items-center justify-center bg-red-100 rounded-full mx-auto mb-4">
            <i className="ri-lock-line text-red-500 text-2xl" />
          </div>
          <h2 className="text-lg font-semibold text-zinc-800">Acesso Restrito</h2>
          <p className="text-zinc-500 text-sm mt-1">Nenhuma aba do Financeiro está liberada para o seu perfil. Fale com o administrador.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 md:px-6 pt-3 md:pt-5 pb-0" style={{ background: '#ffffff', borderBottom: '1px solid #f4f4f5' }}>
        <div className="flex items-center gap-2 md:gap-3 mb-2 md:mb-4">
          <div className="w-8 h-8 md:w-9 md:h-9 flex items-center justify-center rounded-xl flex-shrink-0" style={{ background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)' }}>
            <i className="ri-money-dollar-circle-line text-white text-base md:text-lg" />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-base md:text-lg font-bold text-zinc-800">Financeiro</h1>
            <p className="text-xs text-zinc-400 hidden sm:block">Gestão financeira completa do restaurante</p>
          </div>
          <div className="hidden xl:block"><BuscaFinanceiro podeAba={podeAbaOuFreela} onIr={irParaResultado} /></div>
          {/* No celular a busca fica atrás da lupa: a linha dela sozinha comia espaço de todas as abas */}
          <button
            onClick={() => setBuscaAberta((a) => !a)}
            className={`md:hidden w-9 h-9 flex items-center justify-center rounded-xl border cursor-pointer flex-shrink-0 ${buscaAberta ? 'bg-amber-50 border-amber-300 text-amber-600' : 'bg-zinc-50 border-zinc-200 text-zinc-500'}`}
            aria-label="Procurar fornecedor, nota ou valor"
          >
            <i className={`${buscaAberta ? 'ri-close-line' : 'ri-search-line'} text-lg`} />
          </button>
          <button
            onClick={() => setLancarAberto(true)}
            className="flex items-center gap-1.5 h-9 px-3 md:px-4 rounded-xl text-white text-sm font-bold shadow-sm cursor-pointer flex-shrink-0"
            style={{ background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)' }}
          >
            <i className="ri-add-line text-base" />Lançar
          </button>
        </div>
        <div className="hidden md:block xl:hidden mb-3 md:max-w-md"><BuscaFinanceiro podeAba={podeAbaOuFreela} onIr={irParaResultado} /></div>
        {buscaAberta && <div className="md:hidden mb-2"><BuscaFinanceiro podeAba={podeAbaOuFreela} onIr={(p) => { setBuscaAberta(false); irParaResultado(p); }} autoFocus /></div>}
        {/* Grupos — no celular os 6 dividem a largura (ícone em cima, nome embaixo), sem rolar de lado */}
        <div className="flex md:gap-0.5 overflow-x-auto scrollbar-hide -mx-4 md:mx-0 px-1 md:px-0" style={{ borderBottom: '1px solid rgba(245,158,11,0.15)' }}>
          {grupos.map((g) => {
            const aviso = avisoDoGrupo(g);
            return (
              <button
                key={g.id}
                data-fin-ativo={grupoAtivo?.id === g.id ? '' : undefined}
                onClick={() => abrirGrupo(g)}
                className={`relative flex flex-1 md:flex-none flex-col md:flex-row items-center gap-0.5 md:gap-1.5 min-w-[52px] px-1 md:px-4 pt-2 pb-1.5 md:py-2.5 text-[10.5px] md:text-[13px] font-semibold whitespace-nowrap border-b-2 transition-colors cursor-pointer flex-shrink-0 ${
                  grupoAtivo?.id === g.id ? 'border-amber-500 text-amber-600' : 'border-transparent text-zinc-400 hover:text-zinc-700'
                }`}
              >
                <i className={`${g.icon} text-lg leading-none md:text-[13px] md:leading-normal`} />
                {g.label}
                {aviso && (
                  <span title={aviso.dica} className={`absolute top-0.5 left-1/2 ml-2 md:static md:ml-0 text-[9px] font-black px-1.5 py-0.5 rounded-full text-white leading-none md:leading-normal ${aviso.cor}`}>
                    {aviso.n}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        {/* Abas do grupo em pílula (como as abas internas das outras telas) */}
        {grupoAtivo && grupoAtivo.abas.length > 1 && (
          <div className="py-2 md:py-2.5 -mx-4 md:mx-0 px-4 md:px-0 overflow-x-auto scrollbar-hide">
            <div className="flex bg-zinc-100 p-1 rounded-xl w-max">
              {grupoAtivo.abas.map((tab) => (
                <button
                  key={tab.id}
                  data-fin-ativo={abaCanonica === tab.id ? '' : undefined}
                  onClick={() => setActiveTab(tab.id)}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-lg cursor-pointer transition-all whitespace-nowrap flex items-center gap-1.5 ${
                    abaCanonica === tab.id ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500 hover:text-zinc-800'
                  }`}
                >
                  <i className={`${tab.icon} text-sm`} />
                  {tab.label}
                  {(avisoDaAba[tab.id]?.n ?? 0) > 0 && (
                    <span title={avisoDaAba[tab.id].dica} className={`text-[9px] font-black px-1.5 py-0.5 rounded-full text-white ${avisoDaAba[tab.id].cor}`}>
                      {avisoDaAba[tab.id].n}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {lancarAberto && <OQueAconteceu onFechar={() => setLancarAberto(false)} onNavegar={navegarLancar} onListaCompleta={() => setListaLancarAberta(true)} />}
      {listaLancarAberta && <LancarFinanceiroModal podeAba={podeAbaOuFreela} onIr={abrirAba} onClose={() => setListaLancarAberta(false)} />}

      {/* Content */}
      <div key={chaveConteudo} className="flex-1 overflow-y-auto">
        {activeTab === 'painel' && <PainelFinTab onIrAba={setActiveTab} />}
        {activeTab === 'visao' && <VisaoGeralFinTab />}
        {activeTab === 'trilha' && <TrilhaTab />}
        {activeTab === 'pagamentos' && <PagamentosTab />}
        {activeTab === 'receitas' && <ReceitasTab />}
        {activeTab === 'ifood' && <IfoodTab />}
        {activeTab === 'despesas' && <DespesasTab />}
        {/* 'previsao' era uma aba separada; a projeção virou a visão PADRÃO do
            Fluxo de Caixa. O id antigo continua roteando para cá por causa de
            links salvos e de navegações por `location.state`. */}
        {(activeTab === 'fluxo' || activeTab === 'previsao') && <FluxoCaixaTab />}
        {activeTab === 'pagar' && <ContasPagarTab onNavigateToCompras={handleNavigateToCompras} />}
        {activeTab === 'receber' && <ContasReceberTab />}
        {activeTab === 'orcamentos' && <OrcamentosTab />}
        {activeTab === 'notas-entrada' && <NotasEntradaTab />}
        {activeTab === 'itens' && <ItensClassificacaoTab />}
        {activeTab === 'compras' && <ComprasTab highlightId={highlightPurchaseId} onHighlightConsumed={handleClearHighlight} />}
        {/* 'rh-relatorio' e 'freelancers' (abas antigas, links salvos e o assistente) abrem RH já na subaba */}
        {(activeTab === 'rh' || activeTab === 'rh-relatorio' || activeTab === 'freelancers') && (podeRH
          ? <RHTab inicial={activeTab === 'rh-relatorio' ? 'relatorio' : activeTab === 'freelancers' ? 'freelancers' : subRH} />
          : <FreelancersTab />)}
        {activeTab === 'guias' && <GuiasTab />}
        {activeTab === 'entregadores' && <EntregadoresTab />}
        {activeTab === 'centros' && <CentroCustosTab />}
        {activeTab === 'dre' && <DREContainer />}
        {activeTab === 'contas-vencidas' && <ContasVencidasPanel />}
        {activeTab === 'bancos' && <BancosContasTab />}
        {activeTab === 'conciliacao' && <ConciliacaoTab />}
        {activeTab === 'implantacao' && <ImplantacaoTab />}
      </div>
    </div>
  );
}
