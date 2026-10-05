import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import ComprasPorInsumoTab from './components/ComprasPorInsumoTab';
import ConsumoIngredientesTab from '../relatorios/components/ConsumoIngredientesTab';
import { useEstoque, type Insumo } from '../../contexts/EstoqueContext';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { useEstoqueSituacao } from '../../hooks/useEstoqueSituacao';
import { useIngredientCategories } from '../../hooks/useIngredientCategories';
import { supabase } from '../../lib/supabase';
import { contagemDeHoje, ehProduzido, pedidoDoInsumo, fmtQtd, type InsumoSituacao } from '../../lib/estoqueRegras';
import { usePermissoes } from '../../hooks/usePermissoes';
import CardapioExportImportModal from '../../components/feature/CardapioExportImportModal';
import NovaCompraModal from '../financeiro/components/NovaCompraModal';
import { ContagemFolha } from './components/inicio/ContarSecao';
import ConfigFolha from './components/inicio/ConfigFolha';
import Folha from './components/inicio/Folha';
import InsumoModal from './components/insumos/InsumoModal';
import EntradaRapidaModal from './components/insumos/EntradaRapidaModal';
import RegistrarSaidaModal from './components/RegistrarSaidaModal';
import TransferirEstoqueModal from './components/TransferirEstoqueModal';
import FichaInsumoFolha from './components/folhas/FichaInsumoFolha';
import ArrumarFolha from './components/folhas/ArrumarFolha';
import RegistrarFolha from './components/folhas/RegistrarFolha';
import PerdaFolha from './components/folhas/PerdaFolha';
import { MenuMais, semAcento } from './components/ui/EstoqueUi';
import { EstoqueTelaContext, type AbaEstoque, type DuvidaContagem, type EstoqueTelaApi, type FiltroArrumar } from './EstoqueTela';

// Layout novo (2026-10-04, protótipo docs/prototipos/estoque-abas-proposta.html aprovado pelo dono):
// as 10 abas em 5 grupos, como o Financeiro — em cima o grupo, embaixo as abas dele em pílula. Nenhuma aba
// saiu; os ids (?tab=) continuam os mesmos, então os links antigos abrem no lugar novo.
const VALID_TABS: AbaEstoque[] = ['inicio', 'insumos', 'movimentacoes', 'teorico', 'inventario', 'cmv', 'producao', 'fornecedores', 'compras', 'validade', 'consumo'];

const ABAS: Record<AbaEstoque, { label: string; icon: string }> = {
  inicio: { label: 'Início', icon: 'ri-home-5-line' },
  insumos: { label: 'Lista', icon: 'ri-list-check-2' },
  fornecedores: { label: 'Por fornecedor', icon: 'ri-truck-line' },
  compras: { label: 'Compras por insumo', icon: 'ri-shopping-basket-line' },
  validade: { label: 'Validade e lotes', icon: 'ri-calendar-check-line' },
  movimentacoes: { label: 'Movimentações', icon: 'ri-arrow-left-right-line' },
  producao: { label: 'Produção', icon: 'ri-knife-line' },
  inventario: { label: 'Inventário', icon: 'ri-clipboard-line' },
  teorico: { label: 'Estoque teórico', icon: 'ri-calculator-line' },
  cmv: { label: 'CMV e fichas', icon: 'ri-file-list-3-line' },
  consumo: { label: 'Consumo', icon: 'ri-line-chart-line' },
};

const GRUPOS: { id: string; label: string; icon: string; abas: AbaEstoque[] }[] = [
  { id: 'inicio', label: 'Início', icon: 'ri-home-5-line', abas: ['inicio'] },
  { id: 'insumos', label: 'Insumos', icon: 'ri-archive-line', abas: ['insumos', 'fornecedores', 'compras', 'validade'] },
  { id: 'movimentos', label: 'Movimentos', icon: 'ri-arrow-left-right-line', abas: ['movimentacoes', 'producao'] },
  { id: 'contagem', label: 'Contagem', icon: 'ri-scales-3-line', abas: ['inventario', 'teorico'] },
  { id: 'custo', label: 'Custo', icon: 'ri-percent-line', abas: ['cmv', 'consumo'] },
];

type Selo = { n?: number; ponto?: boolean; cor: 'red' | 'amber'; dica: string } | null;

export default function EstoquePage() {
  // Aba guardada na URL (?tab=producao): sair do módulo e voltar (ou F5) abre onde estava.
  const [searchParams, setSearchParams] = useSearchParams();
  const rawTab = searchParams.get('tab') as AbaEstoque | null;
  // Quem só conta o estoque (estoque_inventario sem estoque_movimentar — "Conta o estoque" dado por pessoa,
  // 2026-10-03) vê só o Inventário: sem Registrar, busca, menu e nada que grave além da contagem.
  const { hasPermissao } = usePermissoes();
  const soContar = !hasPermissao('estoque_movimentar') && hasPermissao('estoque_inventario');
  const tab: AbaEstoque = soContar ? 'inventario' : rawTab && VALID_TABS.includes(rawTab) ? rawTab : 'inicio';
  const setTab = useCallback((t: AbaEstoque) => setSearchParams({ tab: t }, { replace: true }), [setSearchParams]);

  const { user } = useAuth();
  const toast = useToast();
  const { insumos, reloadInsumos, addMovimentacao, upsertInsumo } = useEstoque();
  const { names: categoriasDB, addCategory } = useIngredientCategories();
  const situacao = useEstoqueSituacao();
  const podeContar = hasPermissao('estoque_inventario');
  const podeConfigurar = !!situacao.data?.config.podeConfigurar;

  // ── Números dos grupos (regra única; os mesmos do Início) ──
  const selos = useMemo(() => {
    const s = situacao.data;
    if (!s) return { porPedir: 0, contar: 0, produzir: 0 };
    const lista = s.insumos.filter((i) => i.abaixoMinimo || i.naLista);
    // Mesma conta do "Hoje: pedir N" do Início (inclui o que a cozinha produz).
    const porPedir = lista.filter((i) => !pedidoDoInsumo(i, s.pedidos)).length;
    const produzir = s.insumos.filter((i) => ehProduzido(i) && i.abaixoMinimo).length;
    return { porPedir, contar: contagemDeHoje(s).itens.length, produzir };
  }, [situacao.data]);

  // Validade: bolinha só quando tem lote vencido ou vencendo em até 3 dias.
  const [vencendo, setVencendo] = useState(0);
  useEffect(() => {
    if (!user?.tenantId) return;
    let vivo = true;
    supabase.from('ingredient_expiry_alerts').select('id', { count: 'exact', head: true })
      .eq('tenant_id', user.tenantId).in('alert_level', ['expired', 'critical'])
      .then(({ count }) => { if (vivo) setVencendo(count ?? 0); });
    return () => { vivo = false; };
  }, [user?.tenantId]);

  const seloAba = (a: AbaEstoque): Selo => {
    if (a === 'inicio' && selos.porPedir) return { n: selos.porPedir, cor: 'red', dica: `${selos.porPedir} para pedir` };
    if (a === 'inventario' && selos.contar) return { n: selos.contar, cor: 'amber', dica: `${selos.contar} para contar` };
    if (a === 'producao' && selos.produzir) return { n: selos.produzir, cor: 'amber', dica: `${selos.produzir} para produzir` };
    if (a === 'validade' && vencendo) return { ponto: true, cor: 'amber', dica: `${vencendo} lote(s) vencido(s) ou vencendo` };
    return null;
  };
  // Selo do grupo: o da aba mais urgente (sem somar, para não contar a mesma coisa duas vezes).
  const seloGrupo = (g: (typeof GRUPOS)[number]): Selo => {
    const todos = g.abas.map(seloAba).filter(Boolean) as NonNullable<Selo>[];
    return todos.find((x) => x.n) ?? todos[0] ?? null;
  };

  const gruposVisiveis = soContar ? [{ ...GRUPOS[3], abas: ['inventario' as AbaEstoque] }] : GRUPOS;
  const grupoAtivo = gruposVisiveis.find((g) => g.abas.includes(tab)) ?? gruposVisiveis[0];
  // Voltar a um grupo reabre a última aba usada nele.
  const [ultimaDoGrupo, setUltimaDoGrupo] = useState<Record<string, AbaEstoque>>({});
  useEffect(() => {
    setUltimaDoGrupo((u) => (u[grupoAtivo.id] === tab ? u : { ...u, [grupoAtivo.id]: tab }));
  }, [grupoAtivo.id, tab]);
  const abrirGrupo = (g: (typeof GRUPOS)[number]) => setTab(ultimaDoGrupo[g.id] ?? g.abas[0]);

  // ── Janelas comuns (abertas por qualquer aba via EstoqueTela) ──
  const [fichaId, setFichaId] = useState<string | null>(null);
  const [registrar, setRegistrar] = useState(false);
  const [arrumar, setArrumar] = useState<{ filtro?: FiltroArrumar; insumoId?: string } | null>(null);
  const [perda, setPerda] = useState<{ insumoId?: string } | null>(null);
  const [contagem, setContagem] = useState<{ titulo: string; itens: InsumoSituacao[] } | null>(null);
  const [entradaId, setEntradaId] = useState<string | null>(null);
  const [saida, setSaida] = useState<{ insumoId?: string } | null>(null);
  const [transferir, setTransferir] = useState(false);
  const [compra, setCompra] = useState<{ insumoId?: string } | null>(null);
  const [insumoModal, setInsumoModal] = useState<'novo' | string | null>(null);
  const [showExportImport, setShowExportImport] = useState(false);
  const [config, setConfig] = useState(false);
  const [buscaAberta, setBuscaAberta] = useState(false);

  const insumoPorId = (id: string | null | undefined): Insumo | undefined => (id ? insumos.find((i) => i.id === id) : undefined);

  // Quem só conta não abre nada que grave fora da contagem (a tela era a única barreira: o stock-write só confere a loja).
  const naoSoContar = <A extends unknown[]>(f: (...a: A) => void) => (...a: A) => { if (!soContar) f(...a); };
  // Itens "em dúvida" da contagem (fn_estoque_duvidas): ficam na fila até serem contados de novo.
  const [duvidas, setDuvidas] = useState<Map<string, DuvidaContagem>>(new Map());
  const carregarDuvidas = useCallback(async () => {
    if (!user?.tenantId) return;
    const { data, error } = await supabase.rpc('fn_estoque_duvidas', { p_tenant_id: user.tenantId });
    if (error) { console.error('[Estoque] dúvidas da contagem:', error.message); return; }
    setDuvidas(new Map(((data ?? []) as Array<Record<string, unknown>>).map((r) => [String(r.ingredient_id), {
      nota: r.nota ? String(r.nota) : null, por: r.marcado_por_nome ? String(r.marcado_por_nome) : null, em: String(r.marcado_em ?? ''),
    }])));
  }, [user?.tenantId]);
  useEffect(() => { void carregarDuvidas(); }, [carregarDuvidas]);
  const marcarDuvida = async (insumoId: string, duvida: boolean, nota?: string): Promise<boolean> => {
    const { error } = await supabase.rpc('fn_estoque_duvida', { p_tenant_id: user!.tenantId, p_ingredient_id: insumoId, p_duvida: duvida, p_nota: nota ?? null });
    if (error) { toast.error(duvida ? 'Não marquei em dúvida' : 'Não tirei da dúvida', error.message); return false; }
    await carregarDuvidas();
    return true;
  };

  const api: EstoqueTelaApi = {
    situacao: situacao.data,
    recarregarSituacao: situacao.reload,
    irPara: naoSoContar(setTab),
    abrirFicha: naoSoContar((id: string) => setFichaId(id)),
    abrirRegistrar: naoSoContar(() => setRegistrar(true)),
    abrirArrumar: naoSoContar((opcoes?: { filtro?: FiltroArrumar; insumoId?: string }) => setArrumar(opcoes ?? {})),
    contar: (itens, titulo) => {
      if (!podeContar) { toast.info('Quem conta é quem faz o inventário', 'Peça para o Líder ou o Supervisor contar.'); return; }
      if (!itens.length) { toast.info('Nada para contar agora'); return; }
      setContagem({ itens, titulo });
    },
    abrirEntrada: naoSoContar((id: string) => setEntradaId(id)),
    abrirSaida: naoSoContar((id?: string) => setSaida({ insumoId: id })),
    abrirPerda: naoSoContar((id?: string) => setPerda({ insumoId: id })),
    abrirTransferir: naoSoContar(() => setTransferir(true)),
    abrirProgramar: naoSoContar(() => { if (podeConfigurar && situacao.data) setConfig(true); }),
    abrirCompra: naoSoContar((id?: string) => setCompra({ insumoId: id })),
    abrirNovoInsumo: naoSoContar(() => setInsumoModal('novo')),
    editarInsumo: naoSoContar((id: string) => setInsumoModal(id)),
    podeConfigurar: podeConfigurar && !soContar,
    podeContar,
    duvidas,
    marcarDuvida,
  };

  const depoisDeMexer = () => { void reloadInsumos(); void situacao.reload(); void carregarDuvidas(); };

  const salvarInsumo = async (data: Omit<Insumo, 'estoqueAtual' | 'ultimaEntrada' | 'fichaTecnica' | 'esgotado'> & { id?: string }) => {
    if (data.categoria && data.categoria !== 'Sem categoria' && !categoriasDB.includes(data.categoria)) await addCategory(data.categoria);
    await upsertInsumo({
      id: data.id, nome: data.nome, unidade: data.unidade, categoria: data.categoria, usageType: data.usageType,
      precoUnitario: data.precoUnitario, priceSource: data.priceSource, estoqueMinimo: data.estoqueMinimo,
      purchaseUnit: data.purchaseUnit, purchaseFactor: data.purchaseFactor ?? 1, dreCategoryId: data.dreCategoryId,
      rastrearEstoque: data.rastrearEstoque, contaInventario: data.contaInventario,
      unidadeContagem: data.unidadeContagem ?? null, fatorContagem: data.fatorContagem ?? null,
    }, { lancarErro: true }).catch((e) => {
      // A janela fica aberta com o que foi digitado (antes fechava e nada mudava, sem aviso).
      toast.error('Insumo não salvo', e instanceof Error ? e.message : String(e));
      throw e;
    });
    toast.success(data.id ? `${data.nome} salvo` : `${data.nome} cadastrado`);
    depoisDeMexer();
  };
  const categoriasModal = useMemo(() => {
    const s = new Set<string>(categoriasDB);
    insumos.forEach((i) => { if (i.categoria) s.add(i.categoria); });
    return [...s].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [categoriasDB, insumos]);

  const insumoEntrada = insumoPorId(entradaId);
  const insumoCompra = insumoPorId(compra?.insumoId);
  const insumoEditado = insumoModal && insumoModal !== 'novo' ? insumoPorId(insumoModal) : null;

  return (
    <EstoqueTelaContext.Provider value={api}>
      <div className="flex flex-col h-full">
        {/* Cabeçalho */}
        <div className="px-4 md:px-6 pt-3 md:pt-5 pb-0" style={{ background: '#ffffff', borderBottom: '1px solid #f4f4f5' }}>
          <div className="flex items-center gap-2 md:gap-3 mb-2 md:mb-4">
            <div className="w-8 h-8 md:w-9 md:h-9 flex items-center justify-center rounded-xl flex-shrink-0" style={{ background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)' }}>
              <i className="ri-archive-line text-white text-base md:text-lg" />
            </div>
            <div className="min-w-0 flex-1">
              <h1 className="text-base md:text-lg font-bold text-zinc-800">Estoque</h1>
              <p className="text-xs text-zinc-400 hidden sm:block">Comprar, contar e o que vai faltar</p>
            </div>
            {!soContar && (<>
            <div className="hidden lg:block w-72"><BuscaInsumo insumos={insumos} onEscolher={(id) => setFichaId(id)} /></div>
            <button onClick={() => setBuscaAberta(true)} aria-label="Procurar insumo"
              className="lg:hidden w-9 h-9 flex items-center justify-center rounded-xl border border-zinc-200 bg-zinc-50 text-zinc-500 cursor-pointer flex-shrink-0">
              <i className="ri-search-line text-lg" />
            </button>
            <MenuMais rotulo="Mais: exportar, configurar" itens={[
              { rotulo: 'Arrumar a lista', icone: 'ri-magic-line', onClick: () => setArrumar({}), oculto: !podeConfigurar },
              { rotulo: 'Quanto pedir e contagens', icone: 'ri-settings-3-line', onClick: () => setConfig(true), oculto: !podeConfigurar || !situacao.data },
              { rotulo: 'Novo insumo', icone: 'ri-add-box-line', onClick: () => setInsumoModal('novo') },
              { rotulo: 'Exportar / Importar', icone: 'ri-exchange-line', onClick: () => setShowExportImport(true) },
            ]} className="!w-9 !h-9" />
            <button onClick={() => setRegistrar(true)}
              className="flex items-center gap-1.5 h-9 px-3 md:px-4 rounded-xl text-white text-sm font-bold shadow-sm cursor-pointer flex-shrink-0"
              style={{ background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)' }}>
              <i className="ri-add-line text-base" />Registrar
            </button>
            </>)}
          </div>

          {/* Grupos — no celular os 5 dividem a largura (ícone em cima, nome embaixo), sem rolar de lado */}
          <div className="flex md:gap-0.5 -mx-4 md:mx-0 px-1 md:px-0" style={{ borderBottom: '1px solid rgba(245,158,11,0.15)' }}>
            {gruposVisiveis.map((g) => {
              const selo = seloGrupo(g);
              const ativo = grupoAtivo.id === g.id;
              return (
                <button key={g.id} onClick={() => abrirGrupo(g)}
                  className={`relative flex flex-1 md:flex-none flex-col md:flex-row items-center gap-0.5 md:gap-1.5 min-w-0 px-1 md:px-4 pt-2 pb-1.5 md:py-2.5 text-[10.5px] md:text-[13px] font-semibold whitespace-nowrap border-b-2 transition-colors cursor-pointer ${
                    ativo ? 'border-amber-500 text-amber-600' : 'border-transparent text-zinc-400 hover:text-zinc-700'}`}>
                  <i className={`${g.icon} text-lg leading-none md:text-[13px] md:leading-normal`} />
                  {g.label}
                  {selo && (selo.n
                    ? <span title={selo.dica} className={`absolute top-0.5 left-1/2 ml-2 md:static md:ml-0 text-[9px] font-black px-1.5 py-0.5 rounded-full text-white leading-none md:leading-normal ${selo.cor === 'red' ? 'bg-red-500' : 'bg-amber-500'}`}>{selo.n}</span>
                    : <span title={selo.dica} className="absolute top-1.5 left-1/2 ml-2.5 md:static md:ml-0 w-2 h-2 rounded-full bg-amber-500" />)}
                </button>
              );
            })}
          </div>
          {/* Abas do grupo em pílula */}
          {grupoAtivo.abas.length > 1 ? (
            <div className="py-2 md:py-2.5 -mx-4 md:mx-0 px-4 md:px-0 overflow-x-auto scrollbar-hide">
              <div className="flex bg-zinc-100 p-1 rounded-xl w-max">
                {grupoAtivo.abas.map((a) => {
                  const selo = seloAba(a);
                  return (
                    <button key={a} onClick={() => setTab(a)}
                      className={`px-3 py-1.5 text-xs font-semibold rounded-lg cursor-pointer transition-all whitespace-nowrap flex items-center gap-1.5 ${
                        tab === a ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500 hover:text-zinc-800'}`}>
                      <i className={`${ABAS[a].icon} text-sm`} />{ABAS[a].label}
                      {selo && (selo.n
                        ? <span title={selo.dica} className={`text-[9px] font-black px-1.5 py-0.5 rounded-full text-white ${selo.cor === 'red' ? 'bg-red-500' : 'bg-amber-500'}`}>{selo.n}</span>
                        : <span title={selo.dica} className="w-1.5 h-1.5 rounded-full bg-amber-500" />)}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : <div className="h-1" />}
        </div>

        {/* Conteúdo — cada aba cuida do próprio container */}
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
          {tab === 'compras' && <ComprasPorInsumoTab />}
          {tab === 'validade' && <ValidadeTab />}
        </div>

        {/* Janelas comuns */}
        <FichaInsumoFolha insumoId={fichaId} onFechar={() => setFichaId(null)} />
        <RegistrarFolha aberta={registrar} onFechar={() => setRegistrar(false)} />
        <ArrumarFolha aberta={!!arrumar} filtro={arrumar?.filtro} insumoId={arrumar?.insumoId} onFechar={() => { setArrumar(null); depoisDeMexer(); }} />
        <PerdaFolha aberta={!!perda} insumoId={perda?.insumoId} onFechar={() => setPerda(null)} />
        <ContagemFolha aberta={!!contagem} titulo={contagem?.titulo ?? ''} itens={contagem?.itens ?? []}
          onFechar={() => setContagem(null)} onConcluida={() => { setContagem(null); depoisDeMexer(); }} />
        {insumoEntrada && (
          <EntradaRapidaModal
            insumo={insumoEntrada}
            onClose={() => setEntradaId(null)}
            onConfirm={async (quantidade, motivo) => {
              const r = await addMovimentacao({ insumoId: insumoEntrada.id, tipo: 'entrada', quantidade, unidade: insumoEntrada.unidade, motivo, operadorId: user?.id });
              if (r.ok) { toast.success(`Entrada de ${fmtQtd(quantidade, insumoEntrada.unidade === 'un' ? 'unit' : insumoEntrada.unidade === 'l' ? 'L' : insumoEntrada.unidade)} em ${insumoEntrada.nome}`); void situacao.reload(); }
              return r;
            }}
            onOpenCompra={(ins) => { setEntradaId(null); setCompra({ insumoId: ins.id }); }}
          />
        )}
        {saida && <RegistrarSaidaModal insumoIdInicial={saida.insumoId} onClose={() => { setSaida(null); void situacao.reload(); }} />}
        {transferir && <TransferirEstoqueModal onClose={() => { setTransferir(false); void situacao.reload(); }} />}
        {compra && (
          <NovaCompraModal
            insumoPreSelecionado={insumoCompra ? { id: insumoCompra.id, nome: insumoCompra.nome, unidade: insumoCompra.unidade } : null}
            onClose={() => setCompra(null)}
            onSaved={() => { setCompra(null); depoisDeMexer(); }}
          />
        )}
        {insumoModal && (insumoModal === 'novo' || insumoEditado) && (
          <InsumoModal
            insumo={insumoModal === 'novo' ? null : insumoEditado}
            categoriasDisponiveis={categoriasModal}
            onClose={() => setInsumoModal(null)}
            onSave={salvarInsumo}
          />
        )}
        <CardapioExportImportModal open={showExportImport} onClose={() => setShowExportImport(false)} onSuccess={depoisDeMexer} />
        {situacao.data && <ConfigFolha aberta={config} situacao={situacao.data} onFechar={() => setConfig(false)} onReload={situacao.reload} />}
        <Folha aberta={buscaAberta} titulo="Procurar insumo" onFechar={() => setBuscaAberta(false)}>
          <div className="pb-4"><BuscaInsumo insumos={insumos} autoFocus lista onEscolher={(id) => { setBuscaAberta(false); setFichaId(id); }} /></div>
        </Folha>
      </div>
    </EstoqueTelaContext.Provider>
  );
}

/** Busca de insumo do topo: abre a ficha do insumo. `lista` = resultados embaixo (folha do celular). */
function BuscaInsumo({ insumos, onEscolher, autoFocus, lista }: { insumos: Insumo[]; onEscolher: (id: string) => void; autoFocus?: boolean; lista?: boolean }) {
  const [q, setQ] = useState('');
  const [aberto, setAberto] = useState(false);
  const caixa = useRef<HTMLDivElement>(null);
  const achados = useMemo(() => {
    const t = semAcento(q);
    if (!t) return [];
    return insumos.filter((i) => semAcento(i.nome).includes(t)).slice(0, 8);
  }, [q, insumos]);
  useEffect(() => {
    if (lista || !aberto) return;
    const fora = (e: MouseEvent) => { if (!caixa.current?.contains(e.target as Node)) setAberto(false); };
    document.addEventListener('mousedown', fora);
    return () => document.removeEventListener('mousedown', fora);
  }, [aberto, lista]);
  const escolher = (id: string) => { setQ(''); setAberto(false); onEscolher(id); };
  const resultados = (
    <div className={lista ? 'mt-2' : 'absolute left-0 right-0 top-full mt-1 z-40 bg-white border border-zinc-200 rounded-xl shadow-lg py-1'}>
      {achados.length === 0 ? (
        <p className="px-3 py-2 text-xs text-zinc-400">{q.trim() ? 'Nenhum insumo com esse nome' : 'Digite o nome do insumo'}</p>
      ) : achados.map((i) => (
        <button key={i.id} onClick={() => escolher(i.id)}
          className={`w-full flex items-center justify-between gap-3 px-3 ${lista ? 'py-3 border-b border-zinc-100' : 'py-2'} text-left hover:bg-amber-50 cursor-pointer`}>
          <span className="text-[13px] font-semibold text-zinc-800 truncate">{i.nome}</span>
          <span className="text-[11px] text-zinc-400 flex-shrink-0">{i.categoria || 'Sem categoria'}</span>
        </button>
      ))}
    </div>
  );
  return (
    <div ref={caixa} className="relative">
      <div className="flex items-center gap-2 h-9 px-3 rounded-xl border border-zinc-200 bg-zinc-50 focus-within:border-amber-300 focus-within:bg-white">
        <i className="ri-search-line text-zinc-400" />
        <input value={q} autoFocus={autoFocus} onChange={(e) => { setQ(e.target.value); setAberto(true); }} onFocus={() => setAberto(true)}
          onKeyDown={(e) => { if (e.key === 'Enter' && achados[0]) escolher(achados[0].id); if (e.key === 'Escape') setAberto(false); }}
          placeholder="Procurar insumo…" className="flex-1 min-w-0 bg-transparent outline-none text-[13px] text-zinc-800" />
      </div>
      {(lista || (aberto && q.trim())) && resultados}
    </div>
  );
}
