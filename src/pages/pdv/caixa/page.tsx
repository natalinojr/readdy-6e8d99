import { useState, useRef, useEffect, useCallback } from 'react';
import { Clock, Lock } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAppMode } from '@/contexts/AppModeContext';
import { useAuth } from '@/contexts/AuthContext';
import { usePermissoes } from '@/hooks/usePermissoes';
import { PDVProvider, usePDV } from '../../../contexts/PDVContext';
import { useSessao } from '../../../contexts/SessaoContext';
import { useKDS } from '../../../contexts/KDSContext';
import { useToast } from '../../../contexts/ToastContext';
import type { DestinoInfo } from '../../../contexts/PDVContext';
import type { Item } from '@/types/cardapio';
import { useCardapio } from '../../../contexts/CardapioContext';
import { supabase } from '@/lib/supabase';
import CategoriaNav from './components/CategoriaNav';
import ItemGridPDV from './components/ItemGridPDV';
import CarrinhoPanel from './components/CarrinhoPanel';
import OpcoesModal from './components/OpcoesModal';
import DestinoModal from './components/DestinoModal';
import PagamentoModal from './components/PagamentoModal';
import PedidosRecentesPanel from './components/PedidosRecentesPanel';
import MesasPainelCaixa from './components/MesasPainelCaixa';
import CozinhaPainelCaixa from './components/CozinhaPainelCaixa';
import SangriaSuprimentoModal from './components/SangriaSuprimentoModal';
import AberturaCaixaModal from './components/AberturaCaixaModal';
import FechamentoCaixaModal from './components/FechamentoCaixaModal';
import IniciarSessaoModal from './components/IniciarSessaoModal';
import FecharSessaoModal from './components/FecharSessaoModal';
import AbrirMesaCaixaModal from './components/AbrirMesaCaixaModal';
import OfflineStatusBar from '@/components/feature/OfflineStatusBar';
import AlertaSessaoEsquecida from '@/components/feature/AlertaSessaoEsquecida';
import EstoqueZerarModal from './components/EstoqueZerarModal';
import { useEstoqueAlertaPDV, type InsumoZerando } from '@/hooks/useEstoqueAlertaPDV';
import AutorizacaoGerenteModal from '@/components/feature/AutorizacaoGerenteModal';

type ModalState = 'none' | 'opcoes' | 'destino' | 'pagamento' | 'sangria'
  | 'iniciar_sessao' | 'abertura_caixa' | 'fechar_sessao' | 'abrir_mesa';
type TabRight = 'carrinho' | 'mesas' | 'pedidos';

interface MovimentoCaixa {
  tipo: 'sangria' | 'suprimento';
  valor: number;
  motivo: string;
  hora: string;
}

interface FechamentoData {
  caixaId: string;
  historico: MovimentoCaixa[];
  numPedidos: number;
  totalVendas: number;
}

/* ─── Tela: Carregando sessão ─── */
function CarregandoSessaoView() {
  return (
    <div className="flex flex-col h-full items-center justify-center p-8 text-center relative overflow-hidden"
      style={{ background: 'radial-gradient(ellipse at 20% 0%, #fff8ed 0%, #fafaf9 40%, #f5f5f4 100%)' }}
    >
      <div className="relative z-10 flex flex-col items-center">
        <div className="w-16 h-16 flex items-center justify-center bg-amber-50 border border-amber-200 rounded-2xl mb-4">
          <i className="ri-loader-4-line animate-spin text-3xl text-amber-500" />
        </div>
        <p className="text-sm font-bold text-zinc-600">Verificando sessão...</p>
        <p className="text-xs text-zinc-400 mt-1">Aguarde um momento</p>
      </div>
    </div>
  );
}

/* ─── Tela: Sem Sessão ─── */
function SemSessaoView({ onIniciar, onVoltar }: { onIniciar: () => void; onVoltar: () => void }) {
  return (
    <div className="flex flex-col h-full items-center justify-center p-8 text-center relative overflow-hidden"
      style={{ background: 'radial-gradient(ellipse at 20% 0%, #fff8ed 0%, #fafaf9 40%, #f5f5f4 100%)' }}
    >
      {/* Orbs decorativos */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-24 -left-24 w-72 h-72 rounded-full opacity-30"
          style={{ background: 'radial-gradient(circle, #fbbf24 0%, transparent 70%)' }} />
        <div className="absolute bottom-0 right-0 w-96 h-96 rounded-full opacity-15"
          style={{ background: 'radial-gradient(circle, #f97316 0%, transparent 70%)' }} />
        <div className="absolute inset-0 opacity-[0.04]"
          style={{
            backgroundImage: 'linear-gradient(rgba(0,0,0,0.4) 1px, transparent 1px), linear-gradient(90deg, rgba(0,0,0,0.4) 1px, transparent 1px)',
            backgroundSize: '40px 40px'
          }} />
      </div>

      <div className="relative z-10 flex flex-col items-center">
        <div className="w-24 h-24 flex items-center justify-center bg-white/70 backdrop-blur-sm rounded-3xl mb-6 border border-zinc-200">
          <i className="ri-lock-2-line text-5xl text-zinc-300" />
        </div>
        <h2 className="text-2xl font-black text-zinc-800 mb-2">Nenhuma sessão ativa</h2>
        <p className="text-zinc-500 text-sm max-w-xs mb-8">
          Inicie uma sessão para liberar o caixa, a cozinha e o atendimento.
        </p>
        <div className="flex items-center gap-3">
          <button
            onClick={onVoltar}
            className="flex items-center gap-2 bg-white hover:bg-zinc-100 text-zinc-600 border border-zinc-200 font-bold px-6 py-3.5 rounded-2xl text-sm transition-colors cursor-pointer whitespace-nowrap"
          >
            <i className="ri-arrow-left-line text-base" />
            Voltar
          </button>
          <button
            onClick={onIniciar}
            className="flex items-center gap-2 bg-amber-500 hover:bg-amber-600 text-white font-bold px-8 py-4 rounded-2xl text-base transition-colors cursor-pointer whitespace-nowrap"
          >
            <i className="ri-play-circle-line text-xl" />
            Iniciar Sessão
          </button>
        </div>
        <p className="text-zinc-400 text-xs mt-4">
          O dia de operação começa com uma sessão aberta
        </p>
      </div>
    </div>
  );
}

/* ─── Tela: Sessão Aberta / Caixa Fechado ─── */
function CaixaFechadoView({
  onAbrirCaixa,
  onFecharSessao,
  onVoltar,
}: {
  onAbrirCaixa: () => void;
  onFecharSessao: () => void;
  onVoltar: () => void;
}) {
  const { sessao, estacoesAbertas } = useSessao();
  const { hasPermissao } = usePermissoes();

  return (
    <div className="flex flex-col h-full items-center justify-center p-8 relative overflow-hidden"
      style={{ background: 'radial-gradient(ellipse at 20% 0%, #fff8ed 0%, #fafaf9 40%, #f5f5f4 100%)' }}
    >
      {/* Orbs decorativos */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-24 -left-24 w-72 h-72 rounded-full opacity-30"
          style={{ background: 'radial-gradient(circle, #fbbf24 0%, transparent 70%)' }} />
        <div className="absolute top-1/2 -right-32 w-80 h-80 rounded-full opacity-15"
          style={{ background: 'radial-gradient(circle, #f97316 0%, transparent 70%)' }} />
        <div className="absolute -bottom-20 left-1/3 w-64 h-64 rounded-full opacity-15"
          style={{ background: 'radial-gradient(circle, #fbbf24 0%, transparent 70%)' }} />
        <div className="absolute inset-0 opacity-[0.04]"
          style={{
            backgroundImage: 'linear-gradient(rgba(0,0,0,0.4) 1px, transparent 1px), linear-gradient(90deg, rgba(0,0,0,0.4) 1px, transparent 1px)',
            backgroundSize: '40px 40px'
          }} />
      </div>

      <div className="relative z-10 bg-white/60 backdrop-blur-sm rounded-3xl w-full max-w-md p-8 border border-zinc-200">
        {/* Voltar */}
        <div className="mb-4">
          <button
            onClick={onVoltar}
            className="flex items-center gap-1.5 text-xs font-semibold text-zinc-400 hover:text-zinc-600 transition-colors cursor-pointer whitespace-nowrap"
          >
            <div className="w-5 h-5 flex items-center justify-center">
              <i className="ri-arrow-left-line text-sm" />
            </div>
            Voltar aos Módulos
          </button>
        </div>

        {/* Sessão info */}
        <div className="text-center mb-7">
          <div className="w-16 h-16 flex items-center justify-center bg-amber-50 border border-amber-200 rounded-2xl mx-auto mb-3">
            <Clock size={30} className="text-amber-500" />
          </div>
          <p className="text-xs text-zinc-400 font-medium mb-1">Sessão Ativa</p>
          <p className="text-3xl font-black text-zinc-800 tracking-wider">{sessao?.numero}</p>
          <p className="text-sm text-zinc-500 mt-1">Iniciada às {sessao?.iniciadaEm}</p>
        </div>

        {/* Status do caixa */}
        <div className="bg-white/70 backdrop-blur-sm rounded-2xl p-4 mb-6 border border-zinc-200">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 flex items-center justify-center bg-zinc-100 border border-zinc-200 rounded-xl">
              <Lock size={18} className="text-zinc-500" />
            </div>
            <div>
              <p className="text-sm font-bold text-zinc-700">Caixa Fechado</p>
              <p className="text-xs text-zinc-500">Abra o caixa para iniciar as vendas</p>
            </div>
            <div className="ml-auto w-3 h-3 rounded-full bg-zinc-300" />
          </div>
        </div>

        {/* Estações KDS */}
        {estacoesAbertas.length > 0 && (
          <div className="mb-6">
            <p className="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2">
              Estações da Cozinha Abertas
            </p>
            <div className="space-y-2">
              {estacoesAbertas.map((e) => (
                <div key={e.estacaoId} className="flex items-center gap-3 px-3 py-2.5 bg-emerald-50 rounded-xl border border-emerald-100">
                  <div className="w-2 h-2 rounded-full bg-emerald-500" />
                  <span className="text-xs font-semibold text-emerald-800">{e.estacaoNome}</span>
                  <span className="text-xs text-emerald-600 ml-auto">{e.operadorNome}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {estacoesAbertas.length === 0 && (
          <div className="flex items-center gap-3 px-3 py-2.5 bg-amber-50 rounded-xl border border-amber-200 mb-6">
            <i className="ri-alert-line text-amber-500 text-sm" />
            <p className="text-xs text-amber-700">
              Nenhuma estação da cozinha aberta ainda — acesse o KDS para liberar a produção.
            </p>
          </div>
        )}

        {/* Ações */}
        <div className="space-y-3">
          {hasPermissao('pdv_abrir_caixa') ? (
            <button
              onClick={onAbrirCaixa}
              className="w-full flex items-center justify-center gap-2 bg-amber-500 hover:bg-amber-600 text-white font-bold py-3.5 rounded-xl transition-colors cursor-pointer whitespace-nowrap text-sm"
            >
              <i className="ri-safe-2-line text-lg" />
              Abrir Caixa
            </button>
          ) : (
            <div className="flex items-center gap-2 px-3 py-2.5 bg-zinc-50 rounded-xl border border-zinc-200 text-xs text-zinc-500">
              <i className="ri-lock-line text-sm" />
              Você não tem permissão para abrir o caixa.
            </div>
          )}
          <button
            onClick={onFecharSessao}
            className="w-full flex items-center justify-center gap-2 bg-white/70 hover:bg-white border border-zinc-200 text-zinc-600 font-semibold py-3 rounded-xl transition-colors cursor-pointer whitespace-nowrap text-sm"
          >
            <i className="ri-stop-circle-line text-base" />
            Fechar Sessão
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── Dropdown de atalhos de teclado ─── */
function AtalhosTeclado() {
  const [open, setOpen] = useState(false);

  const atalhos = [
    { tecla: 'F2',     desc: 'Abrir pagamento',       icon: 'ri-money-dollar-circle-line', color: 'text-amber-600' },
    { tecla: 'Shift+F2', desc: 'Enviar p/ Cozinha',   icon: 'ri-restaurant-line',          color: 'text-stone-600' },
    { tecla: 'F3',     desc: 'Selecionar destino',    icon: 'ri-map-pin-line',             color: 'text-teal-600' },
    { tecla: 'F4',     desc: 'Limpar carrinho',       icon: 'ri-delete-bin-line',          color: 'text-red-500' },
    { tecla: 'F5',     desc: 'Ir para Carrinho',      icon: 'ri-shopping-cart-line',       color: 'text-zinc-500' },
    { tecla: 'F6',     desc: 'Ir para Mesas',         icon: 'ri-layout-grid-line',         color: 'text-zinc-500' },
    { tecla: 'Espaço', desc: 'Focar busca',           icon: 'ri-search-line',              color: 'text-zinc-500' },
    { tecla: 'Esc',    desc: 'Fechar modal',          icon: 'ri-close-circle-line',        color: 'text-zinc-400' },
  ];

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        title="Atalhos de teclado"
        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
          open
            ? 'bg-zinc-800 text-white border-zinc-700'
            : 'bg-zinc-50 text-zinc-500 border-zinc-200 hover:bg-zinc-100 hover:text-zinc-700'
        }`}
      >
        <i className="ri-keyboard-line text-sm" />
        <span className="hidden sm:inline">Atalhos</span>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-2 z-50 bg-white border border-zinc-200 rounded-xl shadow-lg w-64 overflow-hidden">
            <div className="px-3 py-2.5 border-b border-zinc-100 flex items-center gap-2">
              <i className="ri-keyboard-line text-zinc-400 text-sm" />
              <p className="text-xs font-bold text-zinc-700">Atalhos de Teclado</p>
            </div>
            <div className="py-1">
              {atalhos.map(({ tecla, desc, icon, color }) => (
                <div key={tecla} className="flex items-center gap-3 px-3 py-2 hover:bg-zinc-50 transition-colors">
                  <div className={`w-5 h-5 flex items-center justify-center flex-shrink-0 ${color}`}>
                    <i className={`${icon} text-sm`} />
                  </div>
                  <span className="flex-1 text-xs text-zinc-600">{desc}</span>
                  <kbd className="flex-shrink-0 px-1.5 py-0.5 bg-zinc-100 border border-zinc-300 rounded text-[10px] font-mono font-bold text-zinc-600">
                    {tecla}
                  </kbd>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/* ─── Modal de detalhes da cortesia (destinatário + motivo) ─── */
function CortesiaDetalhesModal({
  autorizadoPor,
  onConfirmar,
  onCancelar,
}: {
  autorizadoPor: string;
  onConfirmar: (destinatario: string, motivo: string) => void;
  onCancelar: () => void;
}) {
  const [destinatario, setDestinatario] = useState('');
  const [motivo, setMotivo] = useState('');
  const [erro, setErro] = useState('');

  const handleConfirmar = () => {
    if (!destinatario.trim()) {
      setErro('Informe o destinatário da cortesia.');
      return;
    }
    if (!motivo.trim() || motivo.trim().length < 5) {
      setErro('Informe o motivo (mínimo 5 caracteres).');
      return;
    }
    onConfirmar(destinatario.trim(), motivo.trim());
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="bg-violet-50 border-b border-violet-100 px-5 py-4 flex items-center gap-3">
          <div className="w-10 h-10 flex items-center justify-center rounded-xl bg-violet-100 flex-shrink-0">
            <i className="ri-gift-line text-violet-600 text-xl" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-black text-violet-800 leading-none">Detalhes da Cortesia</h2>
            <p className="text-xs text-violet-600 mt-0.5 leading-snug">Autorizado por: {autorizadoPor}</p>
          </div>
          <button
            onClick={onCancelar}
            className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-violet-100 text-violet-400 cursor-pointer transition-colors flex-shrink-0"
          >
            <i className="ri-close-line text-base" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="block text-[11px] font-bold text-zinc-500 uppercase tracking-wider mb-1.5">
              Para quem <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={destinatario}
              onChange={(e) => { setDestinatario(e.target.value); setErro(''); }}
              placeholder="Ex: João da Silva"
              className="w-full border border-zinc-200 rounded-xl px-3 py-2.5 text-sm text-zinc-800 focus:outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
              autoFocus
            />
          </div>
          <div>
            <label className="block text-[11px] font-bold text-zinc-500 uppercase tracking-wider mb-1.5">
              Motivo / observação <span className="text-red-400">*</span>
            </label>
            <textarea
              value={motivo}
              onChange={(e) => { setMotivo(e.target.value); setErro(''); }}
              placeholder="Ex: cliente VIP aniversário (mín. 5 caracteres)"
              rows={3}
              maxLength={500}
              className="w-full border border-zinc-200 rounded-xl px-3 py-2.5 text-sm text-zinc-800 focus:outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 resize-none"
            />
            <p className="text-[10px] text-zinc-400 mt-1">{motivo.length}/500 caracteres</p>
          </div>

          {erro && (
            <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-xl">
              <i className="ri-error-warning-line text-red-500 text-sm flex-shrink-0 mt-0.5" />
              <p className="text-xs text-red-700 font-medium">{erro}</p>
            </div>
          )}

          <div className="flex gap-2.5 pt-1">
            <button
              type="button"
              onClick={onCancelar}
              className="flex-1 py-2.5 border border-zinc-200 text-zinc-600 text-sm font-semibold rounded-xl cursor-pointer hover:bg-zinc-50 transition-colors whitespace-nowrap"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleConfirmar}
              className="flex-1 py-2.5 text-sm font-bold rounded-xl whitespace-nowrap transition-colors flex items-center justify-center gap-2 bg-violet-500 hover:bg-violet-600 text-white cursor-pointer"
            >
              <i className="ri-check-line text-sm" />
              Confirmar Cortesia
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── PDV Operacional (caixa aberto) ─── */
interface PDVOperacionalProps {
  onAbrirFechamento: (data: FechamentoData) => void;
}

function PDVOperacional({ onAbrirFechamento }: PDVOperacionalProps) {
  const { sessao, caixa } = useSessao();
  const navigate = useNavigate();
  const { setMode } = useAppMode();
  const { user } = useAuth();
  const { hasPermissao } = usePermissoes();
  const { total, clearCart, destino, setDestino, addItem, carrinho, removeItem, enviarParaCozinha, finalizarPedido, isCortesia, setCortesia, clearCortesia, cortesiaAutorizadaPor, cortesiaDestinatario, cortesiaMotivo } = usePDV();
  const { success: toastSuccess, error: toastError } = useToast();
  const { pedidos: kdsPedidos } = useKDS();
  // Count real orders from KDS (not the local sequential counter that resets on reload)
  const numeroPedidos = kdsPedidos.filter((p) => !p.itens.every((i) => i.skip_kds)).length;
  const { itensAtivos, categorias, obsGlobais } = useCardapio();

  const [categoriaAtiva, setCategoriaAtiva] = useState('todas');
  const [busca, setBusca] = useState('');
  const [modal, setModal] = useState<ModalState>('none');
  const [tipoMovimento, setTipoMovimento] = useState<'sangria' | 'suprimento'>('sangria');
  const [itemSelecionado, setItemSelecionado] = useState<Item | null>(null);
  // Estado para abertura de mesa pelo caixa
  const [mesaParaAbrir, setMesaParaAbrir] = useState<{ id: string; numero: number } | null>(null);

  const [editingCartItem, setEditingCartItem] = useState<{
    item: Item;
    cartId: string;
    initialSelecionadas: import('../../../contexts/PDVContext').OpcaoSelecionada[];
    initialObsIndex: number[];
    initialObsLivre: string;
    initialQuantidade: number;
    initialObsUnidades: string[];
  } | null>(null);
  const [tabRight, setTabRight] = useState<TabRight>('carrinho');
  // Mobile tab: 'cardapio' | 'carrinho' | 'mesas' | 'pedidos'
  const [mobileTab, setMobileTab] = useState<'cardapio' | 'carrinho' | 'mesas' | 'pedidos'>('cardapio');
  const [historicoCaixa, setHistoricoCaixa] = useState<MovimentoCaixa[]>([]);
  const [totalVendasSessao, setTotalVendasSessao] = useState(0);
  const [pendingAction, setPendingAction] = useState<'cozinha' | 'pagamento' | null>(null);
  const [showAutorizacaoCortesia, setShowAutorizacaoCortesia] = useState(false);
  const [showCortesiaDetalhes, setShowCortesiaDetalhes] = useState(false);
  const [cortesiaAutorizadoPorTemp, setCortesiaAutorizadoPorTemp] = useState<string | null>(null);
  const [cortesiaDestinatarioInput, setCortesiaDestinatarioInput] = useState('');
  const [cortesiaMotivoInput, setCortesiaMotivoInput] = useState('');
  const [isFinalizandoCortesia, setIsFinalizandoCortesia] = useState(false);
  // Alerta de estoque zerando
  const [insumosZerandoAlerta, setInsumosZerandoAlerta] = useState<InsumoZerando[]>([]);
  const [acaoAposEstoqueConfirmar, setAcaoAposEstoqueConfirmar] = useState<(() => void) | null>(null);
  const { verificarEstoque } = useEstoqueAlertaPDV();
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const [isEnviandoCozinha, setIsEnviandoCozinha] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  // ── Carregar movimentações do banco ─────────────────────────────────────
  const loadMovimentacoes = useCallback(async () => {
    if (!caixa?.id) {
      console.warn('[PDVOperacional] loadMovimentacoes: caixa.id não disponível');
      return;
    }
    const { data, error } = await supabase
      .from('cash_movements')
      .select('id, type, amount, reason, created_at')
      .eq('cash_register_id', caixa.id)
      .order('created_at', { ascending: false });
    if (error) {
      console.error('[PDVOperacional] Erro ao carregar movimentações:', error);
      return;
    }
    if (data) {
      const movimentos: MovimentoCaixa[] = data.map((m) => ({
        tipo: m.type === 'out' ? 'sangria' : 'suprimento',
        valor: Number(m.amount),
        motivo: m.reason ?? '',
        hora: new Date(m.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }),
      }));
      setHistoricoCaixa(movimentos);
    }
  }, [caixa?.id]);

  // Carrega na montagem e sempre que caixa.id mudar
  useEffect(() => {
    loadMovimentacoes();
  }, [loadMovimentacoes]);

  // Recarrega quando a janela volta ao foco (voltar do módulo)
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        loadMovimentacoes();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [loadMovimentacoes]);

  // Global number map for quick-add by number
  const numberToItem = new Map<number, Item>(
    itensAtivos.map((item, idx) => [idx + 1, item])
  );

  // Atalhos de teclado globais do PDV
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName.toLowerCase();
      const isTyping = tag === 'input' || tag === 'textarea' || tag === 'select';

      // Escape — fecha qualquer modal aberto (exceto fechamento, que é controlado externamente)
      if (e.key === 'Escape') {
        setModal('none');
        setItemSelecionado(null);
        setEditingCartItem(null);
        setPendingAction(null);
        return;
      }

      // Não dispara atalhos se estiver digitando em um campo
      if (isTyping) return;

      // Espaço — foca a busca
      if (e.key === ' ') {
        e.preventDefault();
        searchRef.current?.focus();
        return;
      }

      // F2 — abre pagamento (se carrinho tiver itens)
      if (e.key === 'F2' && !e.shiftKey) {
        e.preventDefault();
        if (carrinho.length > 0) handlePagar();
        return;
      }

      // Shift+F2 — enviar para cozinha (sem pagamento)
      if (e.key === 'F2' && e.shiftKey) {
        e.preventDefault();
        if (carrinho.length > 0) handleEnviarCozinha();
        return;
      }

      // F3 — abre seleção de destino
      if (e.key === 'F3') {
        e.preventDefault();
        setModal('destino');
        return;
      }

      // F4 — limpa o carrinho
      if (e.key === 'F4') {
        e.preventDefault();
        if (carrinho.length > 0) handleLimpar();
        return;
      }

      // F5 — alterna para aba Carrinho
      if (e.key === 'F5') {
        e.preventDefault();
        setTabRight('carrinho');
        return;
      }

      // F6 — alterna para aba Mesas
      if (e.key === 'F6') {
        e.preventDefault();
        setTabRight('mesas');
        return;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [carrinho.length, modal]);

  // ── Cortesia: finaliza sem modal de pagamento ────────────────────────────
  const handleFinalizarCortesia = useCallback(async (destinoAtual: DestinoInfo | null) => {
    if (!destinoAtual) {
      setPendingAction('pagamento'); // cortesia também precisa de destino
      setModal('destino');
      return;
    }
    setIsFinalizandoCortesia(true);
    try {
      const result = await finalizarPedido([]);
      const numStr = result?.number || `P${Date.now()}`;
      toastSuccess('Cortesia confirmada!', `#${numStr} — pedido registrado como cortesia`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toastError('Erro ao registrar cortesia', msg);
    } finally {
      setIsFinalizandoCortesia(false);
    }
  }, [finalizarPedido, toastSuccess, toastError]);

  // After destino is confirmed and we were waiting to pay
  // Chamado pelo DestinoModal quando o operador seleciona uma mesa livre
  const handleAbrirMesa = useCallback((mesaId: string, mesaNumero: number) => {
    setMesaParaAbrir({ id: mesaId, numero: mesaNumero });
    setModal('abrir_mesa');
  }, []);

  // Chamado após AbrirMesaCaixaModal confirmar que a mesa foi aberta
  const handleMesaAberta = useCallback((clienteNome: string) => {
    const mesa = mesaParaAbrir;
    if (!mesa) return;
    setMesaParaAbrir(null);
    setModal('none');
    // Monta o destino com os dados da mesa recém-aberta
    const destino: DestinoInfo = {
      tipo: 'mesa',
      mesaId: mesa.id,
      mesaNumero: mesa.numero,
      nomeCliente: clienteNome,
    };
    setDestino(destino);
    // Se tinha uma ação pendente, continua o fluxo
    if (pendingAction === 'pagamento') {
      setPendingAction(null);
      if (isCortesia) {
        setTimeout(() => handleFinalizarCortesia(destino), 50);
      } else {
        setTimeout(() => setModal('pagamento'), 50);
      }
    } else if (pendingAction === 'cozinha') {
      setPendingAction(null);
      setIsEnviandoCozinha(true);
      enviarParaCozinha(destino)
        .then((result) => {
          const numStr = result?.number || `P${Date.now()}`;
          const printOk = result?.printEnqueued;
          toastSuccess('Pedido enviado para cozinha!', `#${numStr} — pague depois${printOk ? ' · Ticket na fila de impressão' : ''}`);
        })
        .catch((err) => {
          const msg = err instanceof Error ? err.message : String(err);
          toastError('Erro ao enviar para cozinha', msg);
        })
        .finally(() => setIsEnviandoCozinha(false));
    }
  }, [mesaParaAbrir, pendingAction, setDestino, enviarParaCozinha, isCortesia, handleFinalizarCortesia]);

  const handleDestinoConfirm = useCallback((d: DestinoInfo) => {
    setDestino(d);
    setModal('none');
    if (pendingAction === 'pagamento') {
      setPendingAction(null);
      if (isCortesia) {
        setTimeout(() => handleFinalizarCortesia(d), 50);
      } else {
        setTimeout(() => setModal('pagamento'), 50);
      }
    } else if (pendingAction === 'cozinha') {
      setPendingAction(null);
      setIsEnviandoCozinha(true);
      // Passa o destino confirmado diretamente para o enviarParaCozinha
      // evitando que o estado desatualizado do React cause perda da identificação
      enviarParaCozinha(d)
        .then((result) => {
          const numStr = result?.number || `P${Date.now()}`;
          const printOk = result?.printEnqueued;
          toastSuccess('Pedido enviado para cozinha!', `#${numStr} — pague depois${printOk ? ' · Ticket na fila de impressão' : ''}`);
        })
        .catch((err) => {
          const msg = err instanceof Error ? err.message : String(err);
          toastError('Erro ao enviar para cozinha', msg);
        })
        .finally(() => setIsEnviandoCozinha(false));
    }
  }, [pendingAction, setDestino, enviarParaCozinha, isCortesia, handleFinalizarCortesia]);

  const handleItemClick = (item: Item) => {
    const temOpcoes = item.gruposOpcoes.length > 0;
    if (temOpcoes) {
      setItemSelecionado(item);
      setEditingCartItem(null);
      setModal('opcoes');
      return;
    }
    const promoAtiva = item.promocoes.find((p) => p.ativo);
    const precoBase = promoAtiva ? promoAtiva.precoPromocional : item.preco;
    const cat = categorias.find((c) => c.id === item.categoriaId);
    addItem({
      itemId: item.id,
      nome: item.nome,
      precoBase,
      precoTotal: precoBase,
      quantidade: 1,
      opcoes: [],
      observacoes: [],
      observacaoLivre: '',
      semPreparo: item.semPreparo ?? false,
      stationId: cat?.estacaoId ?? undefined,
      subproducao: item.subproducao?.filter(sp => sp.estacaoId)
        .map(sp => ({ nome: sp.nome, estacaoId: sp.estacaoId!, estacao: sp.estacao })) ?? undefined,
    });
    // On mobile, show a brief feedback by switching to cart tab
    setTimeout(() => setMobileTab('carrinho'), 150);
  };

  const handleItemObs = (item: Item) => {
    setItemSelecionado(item);
    setEditingCartItem(null);
    setModal('opcoes');
  };

  // Enter pressed in search with a number → add item
  const handleSearchEnter = () => {
    const isPureNumber = /^\d+$/.test(busca.trim());
    if (!isPureNumber) return;
    const num = parseInt(busca.trim(), 10);
    const item = numberToItem.get(num);
    if (!item) return;
    setBusca('');
    searchRef.current?.blur();
    setItemSelecionado(item);
    setEditingCartItem(null);
    setModal('opcoes');
  };

  // Edit item in cart
  const handleEditItem = (cartId: string) => {
    const cartItem = carrinho.find((ci) => ci.cartId === cartId);
    if (!cartItem) return;
    const originalItem = itensAtivos.find((i) => i.id === cartItem.itemId);
    if (!originalItem) return;
    // Mescla obs específicas + globais ativas para reconstruir os índices corretamente
    const obsMescladas = [
      ...originalItem.observacoesPadrao,
      ...obsGlobais
        .filter((og) => og.ativo && !og.excludedItemIds?.includes(originalItem.id) && !og.excludedCategoryIds?.includes(originalItem.categoriaId))
        .map((og) => og.texto)
        .filter((t) => !originalItem.observacoesPadrao.includes(t)),
    ];
    const obsIndex = cartItem.observacoes
      .map((obs) => obsMescladas.indexOf(obs))
      .filter((idx) => idx >= 0);
    setItemSelecionado(originalItem);
    setEditingCartItem({
      item: originalItem,
      cartId,
      initialSelecionadas: cartItem.opcoes,
      initialObsIndex: obsIndex,
      initialObsLivre: cartItem.observacaoLivre,
      initialQuantidade: cartItem.quantidade,
      initialObsUnidades: cartItem.obsUnidades ?? [],
    });
    setModal('opcoes');
  };

  // ── Verificação de estoque antes de pagar/enviar cozinha ─────────────────
  const verificarEContinuar = useCallback(async (acao: () => void) => {
    const resultado = await verificarEstoque(carrinho);
    if (resultado.temAlerta) {
      setInsumosZerandoAlerta(resultado.insumosZerando);
      setAcaoAposEstoqueConfirmar(() => acao);
    } else {
      acao();
    }
  }, [verificarEstoque, carrinho]);

  // Finalizar: check destino first
  const handlePagar = () => {
    const executarPagamento = () => {
      if (isCortesia) {
        handleFinalizarCortesia(destino);
        return;
      }
      if (!destino) {
        setPendingAction('pagamento');
        setModal('destino');
      } else {
        setModal('pagamento');
      }
    };
    verificarEContinuar(executarPagamento);
  };

  const handleEnviarCozinha = async () => {
    const executarEnvio = async () => {
      if (!destino) {
        setPendingAction('cozinha');
        setModal('destino');
        return;
      }
      setIsEnviandoCozinha(true);
      try {
        const result = await enviarParaCozinha();
        const numStr = result?.number || `P${Date.now()}`;
        const printOk = result?.printEnqueued;
        toastSuccess('Pedido enviado para cozinha!', `#${numStr} — pague depois${printOk ? ' · Ticket na fila de impressão' : ''}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        toastError('Erro ao enviar para cozinha', msg);
      } finally {
        setIsEnviandoCozinha(false);
      }
    };
    verificarEContinuar(executarEnvio);
  };

  const handlePagamentoSuccess = () => {
    setTotalVendasSessao((prev) => prev + total);
    setModal('none');
  };

  const handleLimpar = () => {
    clearCart();
  };

  const handleRegistrarMovimento = (mov: MovimentoCaixa) => {
    setHistoricoCaixa((prev) => [...prev, mov]);
    // Recarrega do banco para garantir sincronização
    loadMovimentacoes();
  };

  const handleFecharCaixa = () => {
    if (!caixa?.id) return;
    onAbrirFechamento({
      caixaId: caixa.id,
      historico: historicoCaixa,
      numPedidos: numeroPedidos,
      totalVendas: totalVendasSessao,
    });
  };

  const now = new Date();
  const timeStr = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const dateStr = now.toLocaleDateString('pt-BR', { weekday: 'short', day: 'numeric', month: 'short' });

  const carrinhoCount = carrinho.reduce((a, i) => a + i.quantidade, 0);

  return (
    <div className="flex flex-col h-full bg-zinc-50 overflow-hidden">
      {/* ── TOP BAR ── */}
      <div className="flex items-center justify-between px-3 md:px-4 py-2 md:py-2.5 bg-white border-b border-zinc-100 flex-shrink-0 flex-wrap gap-y-2">
        <div className="flex items-center gap-2 md:gap-3 min-w-0">
          {/* Botão Módulos integrado na top bar */}
          <button
            onClick={() => { setMode('modulos'); navigate('/modulos'); }}
            title="Voltar aos Módulos"
            className="w-8 h-8 flex items-center justify-center rounded-lg border border-zinc-200 bg-zinc-50 hover:bg-zinc-100 text-zinc-500 hover:text-zinc-700 cursor-pointer transition-colors flex-shrink-0"
          >
            <i className="ri-arrow-left-line text-sm" />
          </button>

          <div className="w-px h-4 bg-zinc-200 flex-shrink-0" />

          <div className="flex items-center gap-1.5 text-amber-600 bg-amber-50 border border-amber-200 px-2 py-1 rounded-full flex-shrink-0">
            <div className="w-4 h-4 flex items-center justify-center">
              <i className="ri-safe-2-line text-sm" />
            </div>
            <span className="text-xs font-bold hidden sm:inline">Caixa Aberto</span>
          </div>
          {sessao && (
            <span className="text-xs text-zinc-500 font-medium hidden sm:inline">{sessao.numero}</span>
          )}
          {historicoCaixa.length > 0 && (
            <span className="text-xs text-zinc-400 border-l border-zinc-200 pl-3 hidden md:inline">
              {historicoCaixa.filter((m) => m.tipo === 'sangria').length} retirada(s) ·{' '}
              {historicoCaixa.filter((m) => m.tipo === 'suprimento').length} adição(ões)
            </span>
          )}
        </div>

        {/* Desktop actions */}
        <div className="hidden md:flex items-center gap-2 lg:gap-4 flex-wrap justify-end">
          <div className="text-right">
            <p className="text-sm font-bold text-zinc-900">{timeStr}</p>
            <p className="text-[10px] text-zinc-400 capitalize">{dateStr}</p>
          </div>
          <div className="flex items-center gap-2">
            <AtalhosTeclado />
            {/* Botão Cortesia — exclusivo do PDV Caixa */}
            <button
              onClick={() => {
                if (isCortesia) {
                  clearCortesia();
                } else {
                  setShowAutorizacaoCortesia(true);
                }
              }}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg transition-colors cursor-pointer whitespace-nowrap ${
                isCortesia
                  ? 'bg-violet-600 text-white'
                  : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'
              }`}
            >
              <i className="ri-gift-line text-sm" />
              {isCortesia ? 'Cortesia ativa' : 'Cortesia'}
            </button>
            {hasPermissao('pdv_sangria') && (
              <button
                onClick={() => { setTipoMovimento('sangria'); setModal('sangria'); }}
                className="flex items-center gap-1.5 text-xs font-semibold text-red-600 bg-red-50 hover:bg-red-100 border border-red-200 px-3 py-1.5 rounded-lg transition-colors cursor-pointer whitespace-nowrap"
              >
                <i className="ri-arrow-down-circle-line text-sm" />
                Sangria
              </button>
            )}
            {hasPermissao('pdv_sangria') && (
              <button
                onClick={() => { setTipoMovimento('suprimento'); setModal('sangria'); }}
                className="flex items-center gap-1.5 text-xs font-semibold text-emerald-600 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 px-3 py-1.5 rounded-lg transition-colors cursor-pointer whitespace-nowrap"
              >
                <i className="ri-arrow-up-circle-line text-sm" />
                Suprimento
              </button>
            )}
            <div className="w-px h-5 bg-zinc-200" />
            {hasPermissao('pdv_fechar_caixa') && (
              <button
                onClick={handleFecharCaixa}
                className="flex items-center gap-1.5 text-xs font-semibold text-zinc-500 hover:text-red-600 border border-zinc-200 hover:border-red-300 px-3 py-1.5 rounded-lg transition-colors cursor-pointer whitespace-nowrap"
              >
                <i className="ri-door-lock-line text-sm" />
                Fechar Caixa
              </button>
            )}
          </div>
        </div>

        {/* Mobile actions */}
        <div className="flex md:hidden items-center gap-2">
          <span className="text-sm font-bold text-zinc-900">{timeStr}</span>
          <div className="relative">
            <button
              onClick={() => setShowMobileMenu((v) => !v)}
              className="w-8 h-8 flex items-center justify-center bg-zinc-100 hover:bg-zinc-200 rounded-lg cursor-pointer transition-colors"
            >
              <i className="ri-more-2-fill text-zinc-600 text-base" />
            </button>
            {showMobileMenu && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowMobileMenu(false)} />
                <div className="absolute right-0 top-full mt-1 z-50 bg-white border border-zinc-200 rounded-xl w-48 overflow-hidden">
                  {hasPermissao('pdv_sangria') && (
                    <button
                      onClick={() => { setTipoMovimento('sangria'); setModal('sangria'); setShowMobileMenu(false); }}
                      className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-red-600 hover:bg-red-50 cursor-pointer transition-colors"
                    >
                      <i className="ri-arrow-down-circle-line" /> Sangria
                    </button>
                  )}
                  {hasPermissao('pdv_sangria') && (
                    <button
                      onClick={() => { setTipoMovimento('suprimento'); setModal('sangria'); setShowMobileMenu(false); }}
                      className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-emerald-600 hover:bg-emerald-50 cursor-pointer transition-colors"
                    >
                      <i className="ri-arrow-up-circle-line" /> Suprimento
                    </button>
                  )}
                  <div className="h-px bg-zinc-100" />
                  {hasPermissao('pdv_fechar_caixa') && (
                    <button
                      onClick={() => { handleFecharCaixa(); setShowMobileMenu(false); }}
                      className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-zinc-600 hover:bg-zinc-50 cursor-pointer transition-colors"
                    >
                      <i className="ri-door-lock-line" /> Fechar Caixa
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* ── Banner de status offline ── */}
      <OfflineStatusBar />

      {/* ── Alerta de sessão esquecida ── */}
      <div className="px-4 pt-2">
        <AlertaSessaoEsquecida />
      </div>

      {/* ── DESKTOP LAYOUT: side-by-side ── */}
      <div className="hidden md:flex flex-1 overflow-hidden">
        {/* LEFT: Cardápio */}
        <div className="flex flex-col flex-1 min-w-0 bg-zinc-50">
          <CategoriaNav
            categoriaAtiva={categoriaAtiva}
            busca={busca}
            onCategoria={setCategoriaAtiva}
            onBusca={setBusca}
            searchRef={searchRef}
            onEnter={handleSearchEnter}
          />
          <div className="flex-1 overflow-hidden">
            <ItemGridPDV
              categoriaAtiva={categoriaAtiva}
              busca={busca}
              onItemClick={handleItemClick}
              onItemObs={handleItemObs}
            />
          </div>
        </div>

        {/* RIGHT: Cart + Pedidos */}
        <div className="w-72 lg:w-80 xl:w-96 flex-shrink-0 flex flex-col bg-white border-l border-zinc-200">
          <div className="flex border-b border-zinc-200 bg-zinc-50 flex-shrink-0">
            {([
              { key: 'carrinho', icon: 'ri-shopping-cart-line', label: 'Carrinho', badge: carrinhoCount },
              { key: 'mesas',    icon: 'ri-layout-grid-line',   label: 'Mesas' },
              { key: 'pedidos',  icon: 'ri-file-list-3-line',   label: 'Pedidos', badge: numeroPedidos },
            ] as const).map(({ key, icon, label, badge }) => (
              <button
                key={key}
                onClick={() => setTabRight(key)}
                className={`flex-1 py-2.5 text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                  tabRight === key
                    ? 'bg-white text-amber-600 border-b-2 border-amber-500'
                    : 'text-zinc-500 hover:text-zinc-700'
                }`}
              >
                <i className={`${icon} mr-1`} />
                {label}
                {badge != null && badge > 0 && (
                  <span className="ml-1.5 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 bg-amber-500 text-white text-[9px] font-black rounded-full">
                    {badge > 99 ? '99+' : badge}
                  </span>
                )}
              </button>
            ))}
          </div>
          <div className="flex-1 overflow-hidden">
            {tabRight === 'carrinho' && (
              <CarrinhoPanel
                onDestino={() => setModal('destino')}
                onPagar={handlePagar}
                onLimpar={handleLimpar}
                onEditItem={handleEditItem}
                onEnviarCozinha={handleEnviarCozinha}
                onVincularPedidos={handlePagar}
              />
            )}
            {tabRight === 'mesas' && (
              <MesasPainelCaixa
                onAddItemsMesa={(mesa) => {
                  setDestino({
                    tipo: 'mesa',
                    mesaId: mesa.id,
                    mesaNumero: mesa.numero,
                    nomeCliente: mesa.clienteNome ?? undefined,
                  });
                  setTabRight('carrinho');
                }}
              />
            )}
            {tabRight === 'pedidos' && <PedidosRecentesPanel />}
          </div>
        </div>
      </div>

      {/* ── MOBILE LAYOUT: tab-based full screen ── */}
      <div className="flex md:hidden flex-col flex-1 overflow-hidden">
        {/* Mobile content area */}
        <div className="flex-1 overflow-hidden">
          {mobileTab === 'cardapio' && (
            <div className="flex flex-col h-full bg-zinc-50">
              <CategoriaNav
                categoriaAtiva={categoriaAtiva}
                busca={busca}
                onCategoria={setCategoriaAtiva}
                onBusca={setBusca}
                searchRef={searchRef}
                onEnter={handleSearchEnter}
              />
              <div className="flex-1 overflow-hidden">
                <ItemGridPDV
                  categoriaAtiva={categoriaAtiva}
                  busca={busca}
                  onItemClick={(item) => {
                    handleItemClick(item);
                  }}
                  onItemObs={handleItemObs}
                />
              </div>
            </div>
          )}
          {mobileTab === 'carrinho' && (
            <CarrinhoPanel
              onDestino={() => setModal('destino')}
              onPagar={handlePagar}
              onLimpar={handleLimpar}
              onEditItem={handleEditItem}
              onEnviarCozinha={handleEnviarCozinha}
              onVincularPedidos={handlePagar}
            />
          )}
          {mobileTab === 'mesas' && (
            <MesasPainelCaixa
              onAddItemsMesa={(mesa) => {
                setDestino({
                  tipo: 'mesa',
                  mesaId: mesa.id,
                  mesaNumero: mesa.numero,
                  nomeCliente: mesa.clienteNome ?? undefined,
                });
                setMobileTab('carrinho');
              }}
            />
          )}
          {mobileTab === 'pedidos' && <PedidosRecentesPanel />}
        </div>

        {/* Mobile bottom tab bar */}
        <div className="flex-shrink-0 bg-white border-t border-zinc-200 flex items-stretch">
          {([
            { key: 'cardapio', icon: 'ri-restaurant-2-line', label: 'Cardápio' },
            { key: 'carrinho', icon: 'ri-shopping-cart-line', label: 'Carrinho', badge: carrinhoCount },
            { key: 'mesas',    icon: 'ri-layout-grid-line',   label: 'Mesas' },
            { key: 'pedidos',  icon: 'ri-file-list-3-line',   label: 'Pedidos', badge: numeroPedidos },
          ] as const).map(({ key, icon, label, badge }) => (
            <button
              key={key}
              onClick={() => setMobileTab(key)}
              className={`flex-1 flex flex-col items-center justify-center py-2 gap-0.5 cursor-pointer transition-colors relative ${
                mobileTab === key ? 'text-amber-600' : 'text-zinc-400'
              }`}
            >
              <div className="relative w-6 h-6 flex items-center justify-center">
                <i className={`${icon} text-xl`} />
                {badge != null && badge > 0 && (
                  <span className="absolute -top-1 -right-1.5 bg-amber-500 text-white text-[9px] font-black w-4 h-4 rounded-full flex items-center justify-center">
                    {badge > 9 ? '9+' : badge}
                  </span>
                )}
              </div>
              <span className="text-[10px] font-semibold">{label}</span>
              {mobileTab === key && (
                <span className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 bg-amber-500 rounded-full" />
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Modal de autorização de cortesia */}
      {showAutorizacaoCortesia && (
        <AutorizacaoGerenteModal
          titulo="Autorizar Cortesia"
          descricao="Informe as credenciais de gerente ou admin para liberar o pedido como cortesia (R$ 0,00)."
          niveisPermitidos={['gerente', 'admin']}
          tenantId={user?.tenantId ?? ''}
          onAutorizado={(autorizadoPor) => {
            setCortesiaAutorizadoPorTemp(autorizadoPor);
            setShowAutorizacaoCortesia(false);
            setShowCortesiaDetalhes(true);
          }}
          onCancelar={() => setShowAutorizacaoCortesia(false)}
        />
      )}

      {/* Modal de detalhes da cortesia (destinatário + motivo) */}
      {showCortesiaDetalhes && (
        <CortesiaDetalhesModal
          autorizadoPor={cortesiaAutorizadoPorTemp ?? 'Gerente'}
          onConfirmar={(destinatario, motivo) => {
            setCortesia(true, cortesiaAutorizadoPorTemp, destinatario, motivo);
            setShowCortesiaDetalhes(false);
            setCortesiaDestinatarioInput('');
            setCortesiaMotivoInput('');
          }}
          onCancelar={() => {
            setShowCortesiaDetalhes(false);
            setCortesiaAutorizadoPorTemp(null);
          }}
        />
      )}

      {/* Loading cortesia */}
      {isFinalizandoCortesia && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-2xl p-8 flex flex-col items-center gap-4 shadow-2xl min-w-[260px]">
            <div className="w-16 h-16 flex items-center justify-center bg-violet-50 rounded-full">
              <svg className="animate-spin w-8 h-8 text-violet-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
              </svg>
            </div>
            <div className="text-center">
              <p className="text-base font-bold text-zinc-800">Registrando cortesia...</p>
              <p className="text-sm text-zinc-400 mt-0.5">Aguarde um momento</p>
            </div>
          </div>
        </div>
      )}

      {/* Modal de alerta de estoque zerando */}
      {insumosZerandoAlerta.length > 0 && (
        <EstoqueZerarModal
          insumosZerando={insumosZerandoAlerta}
          onConfirmar={() => {
            const acao = acaoAposEstoqueConfirmar;
            setInsumosZerandoAlerta([]);
            setAcaoAposEstoqueConfirmar(null);
            if (acao) acao();
          }}
          onCancelar={() => {
            setInsumosZerandoAlerta([]);
            setAcaoAposEstoqueConfirmar(null);
          }}
        />
      )}

      {modal === 'opcoes' && itemSelecionado && (
        <OpcoesModal
          item={itemSelecionado}
          editMode={!!editingCartItem}
          initialSelecionadas={editingCartItem?.initialSelecionadas}
          initialObsIndex={editingCartItem?.initialObsIndex}
          initialObsLivre={editingCartItem?.initialObsLivre}
          initialQuantidade={editingCartItem?.initialQuantidade}
          initialObsUnidades={editingCartItem?.initialObsUnidades}
          onAdd={(ci) => {
            if (editingCartItem) {
              removeItem(editingCartItem.cartId);
            }
            addItem(ci);
            setModal('none');
            setItemSelecionado(null);
            setEditingCartItem(null);
          }}
          onClose={() => {
            setModal('none');
            setItemSelecionado(null);
            setEditingCartItem(null);
          }}
        />
      )}
      {modal === 'destino' && (
        <DestinoModal
          current={destino}
          onConfirm={handleDestinoConfirm}
          onClose={() => { setModal('none'); setPendingAction(null); }}
          onAbrirMesa={handleAbrirMesa}
        />
      )}
      {modal === 'abrir_mesa' && mesaParaAbrir && (
        <AbrirMesaCaixaModal
          mesaId={mesaParaAbrir.id}
          mesaNumero={mesaParaAbrir.numero}
          onConfirmed={handleMesaAberta}
          onClose={() => {
            setMesaParaAbrir(null);
            setModal('destino');
          }}
        />
      )}
      {modal === 'pagamento' && (
        <PagamentoModal
          onClose={() => setModal('none')}
          onSuccess={handlePagamentoSuccess}
        />
      )}
      {modal === 'sangria' && (
        <SangriaSuprimentoModal
          tipoInicial={tipoMovimento}
          historico={historicoCaixa}
          onRegistrar={handleRegistrarMovimento}
          onClose={() => {
            setModal('none');
            loadMovimentacoes();
          }}
        />
      )}
    </div>
  );
}

/* ─── Controlador principal ─── */
function PDVCaixaInner() {
  const { estado, loadingSession, sincronizarSessao } = useSessao();
  const navigate = useNavigate();
  const { setMode } = useAppMode();
  const [modal, setModal] = useState<'none' | 'iniciar_sessao' | 'abertura_caixa' | 'fechar_sessao'>('none');
  const [fechamento, setFechamento] = useState<FechamentoData | null>(null);

  const handleVoltar = () => {
    setMode('modulos');
    navigate('/modulos');
  };

  if (loadingSession) {
    return <CarregandoSessaoView />;
  }

  return (
    <>
      {estado === 'sem_sessao' && (
        <SemSessaoView
          onIniciar={() => setModal('iniciar_sessao')}
          onVoltar={handleVoltar}
        />
      )}
      {estado === 'sessao_aberta' && (
        <CaixaFechadoView
          onAbrirCaixa={() => setModal('abertura_caixa')}
          onFecharSessao={() => setModal('fechar_sessao')}
          onVoltar={handleVoltar}
        />
      )}
      {estado === 'caixa_aberto' && (
        <PDVOperacional
          onAbrirFechamento={(data) => setFechamento(data)}
        />
      )}

      {modal === 'iniciar_sessao' && (
        <IniciarSessaoModal onClose={() => setModal('none')} />
      )}
      {modal === 'abertura_caixa' && (
        <AberturaCaixaModal onClose={() => setModal('none')} />
      )}
      {modal === 'fechar_sessao' && (
        <FecharSessaoModal onClose={() => setModal('none')} />
      )}

      {fechamento && (
        <FechamentoCaixaModal
          caixaId={fechamento.caixaId}
          historico={fechamento.historico}
          numPedidos={fechamento.numPedidos}
          totalVendas={fechamento.totalVendas}
          onClose={() => { setFechamento(null); sincronizarSessao(); }}
        />
      )}
    </>
  );
}

export default function PDVCaixaPage() {
  return (
    <PDVProvider>
      <PDVCaixaInner />
    </PDVProvider>
  );
}