import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAppMode, type AppMode } from '@/contexts/AppModeContext';
import { useAuth } from '@/contexts/AuthContext';
import { useModoTreino } from '@/contexts/ModoTreinoContext';
import { useSystemSettings } from '@/hooks/useSystemSettings';
import { usePermissoes } from '@/hooks/usePermissoes';
import { useUsuarios } from '@/hooks/useUsuarios';
import { ChefHat, LogOut, Monitor, Store } from 'lucide-react';
import OnboardingShareModal from '@/pages/modulos/components/OnboardingShareModal';


interface ModuloCard {
  id: AppMode;
  titulo: string;
  descricao: string;
  icon: string;
  rota: string;
  acento: string;
  acentoText: string;
  acentoBg: string;
  acentoBorder: string;
  tag: string;
  perfis?: string[];
}

const MODULOS: ModuloCard[] = [
  {
    id: 'pdv_caixa',
    titulo: 'PDV Caixa',
    descricao: 'Vendas, pagamentos e fechamento de caixa',
    icon: 'ri-shopping-cart-2-line',
    rota: '/pdv/caixa',
    acento: '#f59e0b',
    acentoText: 'text-amber-600',
    acentoBg: 'bg-amber-50',
    acentoBorder: 'border-amber-200/70',
    tag: 'Terminal',
    perfis: ['admin', 'gerente', 'caixa'],
  },
  {
    id: 'pdv_garcom',
    titulo: 'PDV Garçom',
    descricao: 'Pedidos no salão, mesas e chamados',
    icon: 'ri-user-star-line',
    rota: '/pdv/garcom',
    acento: '#0d9488',
    acentoText: 'text-teal-600',
    acentoBg: 'bg-teal-50',
    acentoBorder: 'border-teal-200/70',
    tag: 'Terminal',
    perfis: ['admin', 'gerente', 'garcom'],
  },
  {
    id: 'pdv_delivery',
    titulo: 'PDV Delivery',
    descricao: 'Pedidos de entrega e retirada',
    icon: 'ri-bike-line',
    rota: '/pdv/delivery',
    acento: '#ea580c',
    acentoText: 'text-orange-600',
    acentoBg: 'bg-orange-50',
    acentoBorder: 'border-orange-200/70',
    tag: 'Terminal',
    perfis: ['admin', 'gerente', 'caixa'],
  },
  {
    id: 'kds',
    titulo: 'KDS — Cozinha',
    descricao: 'Display de pedidos e SLA em tempo real',
    icon: 'ri-restaurant-2-line',
    rota: '/kds',
    acento: '#059669',
    acentoText: 'text-emerald-600',
    acentoBg: 'bg-emerald-50',
    acentoBorder: 'border-emerald-200/70',
    tag: 'Cozinha',
    perfis: ['admin', 'gerente', 'cozinha'],
  },
  {
    id: 'gestor_pedidos',
    titulo: 'Gestor de Pedidos',
    descricao: 'Kanban de pedidos ativos por estação',
    icon: 'ri-layout-column-line',
    rota: '/gestor-pedidos',
    acento: '#7c3aed',
    acentoText: 'text-violet-600',
    acentoBg: 'bg-violet-50',
    acentoBorder: 'border-violet-200/70',
    tag: 'Cozinha',
    perfis: ['admin', 'gerente', 'cozinha'],
  },
  {
    id: 'gestao',
    titulo: 'Gestão',
    descricao: 'Dashboard, cardápio, relatórios e configurações',
    icon: 'ri-settings-3-line',
    rota: '/dashboard',
    acento: '#64748b',
    acentoText: 'text-slate-600',
    acentoBg: 'bg-slate-50',
    acentoBorder: 'border-slate-200/70',
    tag: 'Admin',
    perfis: ['admin', 'gerente'],
  },
];

const perfilLabel: Record<string, string> = {
  admin: 'Administrador',
  gerente: 'Gerente',
  caixa: 'Operador de Caixa',
  garcom: 'Garçom',
  cozinha: 'Operador de Cozinha',
};

// ─── Tela Sem Loja ────────────────────────────────────────────────────────────

interface SemLojaScreenProps {
  userName: string;
  onLogout: () => void;
}

function SemLojaScreen({ userName, onLogout }: SemLojaScreenProps) {
  const navigate = useNavigate();
  const [codigo, setCodigo] = useState('');
  const [loading, setLoading] = useState(false);

  const handleEntrar = () => {
    const code = codigo.trim().toUpperCase();
    if (!code) return;
    setLoading(true);
    // Redireciona para o onboarding com o código
    navigate(`/onboarding?invite=${encodeURIComponent(code)}`);
  };

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-4 relative overflow-hidden"
      style={{ background: 'linear-gradient(160deg, #fffbf5 0%, #fef6e8 50%, #fdf4e3 100%)' }}
    >
      {/* Orbs decorativos */}
      <div className="absolute -top-40 -left-40 w-96 h-96 rounded-full opacity-25 pointer-events-none"
        style={{ background: 'radial-gradient(circle, #f59e0b 0%, transparent 70%)' }} />
      <div className="absolute top-1/2 -right-32 w-80 h-80 rounded-full opacity-15 pointer-events-none"
        style={{ background: 'radial-gradient(circle, #fb923c 0%, transparent 70%)' }} />

      {/* Logout no canto */}
      <div className="absolute top-5 right-5">
        <button onClick={onLogout}
          className="flex items-center gap-1.5 px-3 py-2 text-xs text-zinc-500 hover:text-red-500 transition-colors cursor-pointer">
          <LogOut size={14} />
          Sair
        </button>
      </div>

      <div className="w-full max-w-sm relative z-10 text-center">
        {/* Logo */}
        <div
          className="w-16 h-16 flex items-center justify-center rounded-2xl mx-auto mb-6"
          style={{ background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)' }}
        >
          <ChefHat size={32} className="text-white" />
        </div>

        <h1 className="text-2xl font-black text-zinc-800 mb-1">
          Olá, {userName.split(' ')[0]}!
        </h1>
        <p className="text-zinc-500 text-sm mb-8 leading-relaxed">
          Sua conta ainda não está vinculada a nenhuma loja.<br />
          Insira o código de convite para configurar sua loja.
        </p>

        {/* Card de entrada do código */}
        <div className="bg-white/80 backdrop-blur-sm border border-amber-200/60 rounded-2xl p-6 text-left mb-4">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-9 h-9 flex items-center justify-center bg-amber-100 rounded-xl flex-shrink-0">
              <i className="ri-key-2-line text-amber-600 text-base" />
            </div>
            <div>
              <p className="text-sm font-black text-zinc-800">Código de convite</p>
              <p className="text-xs text-zinc-400">Recebido do administrador do sistema</p>
            </div>
          </div>

          <input
            type="text"
            value={codigo}
            onChange={e => setCodigo(e.target.value.toUpperCase())}
            onKeyDown={e => e.key === 'Enter' && handleEntrar()}
            placeholder="Ex: XXXX-XXXX-XXXX"
            className="w-full text-center text-lg font-mono font-bold tracking-widest border-2 border-zinc-200 rounded-xl px-4 py-3 focus:outline-none focus:border-amber-400 mb-4 transition-colors"
            maxLength={20}
          />

          <button
            onClick={handleEntrar}
            disabled={loading || !codigo.trim()}
            className="w-full py-3 text-sm font-bold text-white rounded-xl disabled:opacity-40 cursor-pointer whitespace-nowrap transition-all flex items-center justify-center gap-2"
            style={{ background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)' }}
          >
            {loading ? (
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              <i className="ri-store-line" />
            )}
            {loading ? 'Verificando...' : 'Configurar minha loja'}
          </button>
        </div>

        <p className="text-xs text-zinc-400 text-center leading-relaxed">
          Não tem o código? Entre em contato com o administrador do sistema.
        </p>
      </div>
    </div>
  );
}

export default function ModulosPage() {
  const { setMode } = useAppMode();
  const { user, logout, canSwitchTenant, switchTenant, availableTenants, needsTenantSelection, hasNoTenants } = useAuth();
  const { isModoTreino } = useModoTreino();
  const [noTenantUserName, setNoTenantUserName] = useState('');
  const navigate = useNavigate();
  const location = useLocation();
  const [showShareModal, setShowShareModal] = useState(false);
  const { settings, loading: settingsLoading, carregar } = useSystemSettings();
  const { hasPermissao } = usePermissoes();
  const { usuarios } = useUsuarios();
  const [acessoNegadoMsg, setAcessoNegadoMsg] = useState<string | null>(null);
  const [showTotens, setShowTotens] = useState(false);
  const [hora, setHora] = useState(() =>
    new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  );
  const [isFullscreen, setIsFullscreen] = useState(!!document.fullscreenElement);
  const totens = usuarios.filter((u) => u.perfil === 'totem');

  // Totem está online quando a flag kiosk_online = true (setada pelo heartbeat, limpa no logout)
  const totensOnline = totens.filter((u) => u.kioskOnline);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  };

  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

  const handleTrocarLoja = () => {
    switchTenant();
    navigate('/selecionar-loja');
  };

  useEffect(() => {
    const interval = setInterval(() => {
      setHora(new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }));
    }, 10000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  useEffect(() => {
    if (user?.perfil === 'totem') {
      navigate('/autoatendimento', { replace: true });
    }
  }, [user?.perfil, navigate]);

  useEffect(() => {
    const state = location.state as { acessoNegado?: boolean; rota?: string } | null;
    if (state?.acessoNegado) {
      const rotaLabel = state.rota ?? 'esta página';
      setAcessoNegadoMsg(`Você não tem permissão para acessar ${rotaLabel}`);
      navigate('/modulos', { replace: true, state: {} });
      const t = setTimeout(() => setAcessoNegadoMsg(null), 5000);
      return () => clearTimeout(t);
    }
  }, [location.state, navigate]);

  const handleModulo = (m: ModuloCard) => {
    setMode(m.id);
    navigate(m.rota);
  };

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  // ── Tela especial: usuário logado mas sem nenhum tenant ──
  // needsTenantSelection = false + availableTenants = [] + user = null significa sem loja
  // Mas aqui user já seria null. Precisamos detectar pela ausência de user mas com sessão auth ativa.
  // O AuthContext seta user=null quando tenant_count=0. Vamos verificar isso via availableTenants.length === 0 e !needsTenantSelection.
  // Caso o usuário tenha zero tenants, o AuthContext define user=null e needsTenantSelection=false.
  // Nesse caso a RotaProtegida pode ter redirecionado para /login. Precisamos tratar aqui também.
  // Por isso vamos mostrar a tela sem loja se o authContext tiver isAuthenticated=true mas user=null e availableTenants=[]
  // Isso é gerenciado no App.tsx — mas podemos tratar o caso de zero tenants diretamente aqui com um estado local.

  const agora = new Date();
  const data = agora.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });

  const pdvCfg = settings.pdv_config;
  const kitchenView = settings.kitchen_view ?? 'ambos';

  const PDV_MODULE_KEY: Partial<Record<AppMode, keyof typeof pdvCfg>> = {
    pdv_garcom: 'garcom',
    pdv_delivery: 'delivery',
    kds: 'kds',
    gestor_pedidos: 'kds',
  };

  const modulosVisiveis = MODULOS.filter((m) => {
    if (m.perfis && user?.perfil && !m.perfis.includes(user.perfil)) return false;
    if (!settingsLoading) {
      const cfgKey = PDV_MODULE_KEY[m.id];
      if (cfgKey && pdvCfg[cfgKey] === false) return false;
    }
    if (m.id === 'kds' && kitchenView !== 'kds' && kitchenView !== 'ambos') return false;
    if (m.id === 'gestor_pedidos' && kitchenView !== 'gestor' && kitchenView !== 'ambos') return false;
    if (m.id === 'kds' && !hasPermissao('kds_acessar')) return false;
    if (m.id === 'gestor_pedidos' && !hasPermissao('gestor_pedidos_acessar')) return false;
    return true;
  });

  const terminais = modulosVisiveis.filter((m) => m.tag === 'Terminal');
  const cozinha = modulosVisiveis.filter((m) => m.tag === 'Cozinha');
  const admin = modulosVisiveis.filter((m) => m.tag === 'Admin');

  const podeVerTotens = user?.perfil === 'admin' || user?.perfil === 'gerente';
  const isAdminMaster = user?.email === 'natalinojr.engel@gmail.com';

  // Busca nome do usuário autenticado quando hasNoTenants (user=null nesse estado)
  useEffect(() => {
    if (!hasNoTenants) return;
    supabase.auth.getSession().then(({ data }) => {
      const meta = data?.session?.user?.user_metadata;
      const name = meta?.name ?? meta?.nome ?? data?.session?.user?.email ?? 'Usuário';
      setNoTenantUserName(name);
    });
  }, [hasNoTenants]);

  // ── Render: sem loja ──
  if (hasNoTenants) {
    return (
      <SemLojaScreen
        userName={noTenantUserName || user?.nome || 'Usuário'}
        onLogout={handleLogout}
      />
    );
  }

  return (
    <div
      className="min-h-screen flex flex-col overflow-auto relative"
      style={{ background: 'radial-gradient(ellipse at 20% 0%, #fff8ed 0%, #fafaf9 40%, #f5f5f4 100%)' }}
    >
      <style>{`
        @keyframes fadeSlideUp {
          from { opacity: 0; transform: translateY(16px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .mod-enter {
          opacity: 0;
          animation: fadeSlideUp 0.4s cubic-bezier(0.22, 1, 0.36, 1) forwards;
        }
      `}</style>

      {/* Orbs */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-32 -left-32 w-96 h-96 rounded-full opacity-30"
          style={{ background: 'radial-gradient(circle, #fbbf24 0%, transparent 70%)' }} />
        <div className="absolute top-1/2 -right-48 w-[500px] h-[500px] rounded-full opacity-15"
          style={{ background: 'radial-gradient(circle, #f97316 0%, transparent 70%)' }} />
        <div className="absolute -bottom-32 left-1/3 w-80 h-80 rounded-full opacity-15"
          style={{ background: 'radial-gradient(circle, #fbbf24 0%, transparent 70%)' }} />
      </div>

      {/* Banner Modo Treino */}
      {isModoTreino && (
        <div className="relative z-10 bg-amber-400 px-4 py-2 flex items-center justify-center gap-3 flex-shrink-0">
          <i className="ri-graduation-cap-fill text-amber-900 text-base" />
          <p className="text-amber-900 text-xs font-black tracking-wide text-center">
            MODO TREINO ATIVO — Dados não afetam o sistema real
          </p>
          <i className="ri-graduation-cap-fill text-amber-900 text-base" />
        </div>
      )}

      {/* Toast acesso negado */}
      {acessoNegadoMsg && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 bg-red-600 text-white text-sm font-semibold px-5 py-3 rounded-2xl w-[90vw] max-w-sm">
          <i className="ri-shield-keyhole-line text-lg flex-shrink-0" />
          <span className="flex-1">{acessoNegadoMsg}</span>
          <button onClick={() => setAcessoNegadoMsg(null)} className="ml-2 text-red-200 hover:text-white cursor-pointer flex-shrink-0">
            <i className="ri-close-line" />
          </button>
        </div>
      )}

      {/* ── TOPBAR ── */}
      <div className="relative z-10 flex items-center justify-between px-3 sm:px-5 md:px-10 pt-4 sm:pt-5 pb-3 sm:pb-4 flex-shrink-0 gap-2 sm:gap-3 flex-wrap">
        <div className="flex items-center gap-3 flex-shrink-0">
          <div className="w-10 h-10 flex items-center justify-center bg-gradient-to-br from-amber-400 to-amber-600 rounded-xl">
            <ChefHat size={18} className="text-white" />
          </div>
          <div className="hidden sm:block">
            <p className="text-zinc-900 font-black text-base tracking-widest leading-none">ERPOS</p>
            <p className="text-amber-500 text-[10px] mt-0.5 font-semibold tracking-wider">V2</p>
          </div>
        </div>

        <div className="text-center hidden lg:block flex-shrink-0">
          <p className="text-zinc-800 font-black text-2xl tabular-nums tracking-tight">{hora}</p>
          <p className="text-zinc-400 text-[11px] capitalize mt-0.5">{data}</p>
        </div>

        <div className="flex items-center gap-2 ml-auto">
          <div className="flex items-center gap-1.5 px-3 py-2 bg-white/70 rounded-xl border border-zinc-200 lg:hidden flex-shrink-0 backdrop-blur-sm">
            <i className="ri-time-line text-amber-500 text-xs" />
            <span className="text-zinc-800 font-bold text-sm tabular-nums">{hora}</span>
          </div>

          {/* Maximizar tela */}
          <button
            onClick={toggleFullscreen}
            className="flex items-center justify-center w-9 h-9 bg-white/70 hover:bg-zinc-100 border border-zinc-200 rounded-xl text-zinc-500 hover:text-zinc-700 transition-all cursor-pointer flex-shrink-0 backdrop-blur-sm"
            title={isFullscreen ? 'Restaurar tela' : 'Maximizar tela'}
          >
            <div className="w-4 h-4 flex items-center justify-center">
              <i className={`${isFullscreen ? 'ri-fullscreen-exit-line' : 'ri-fullscreen-line'} text-sm`} />
            </div>
          </button>

          {/* Trocar loja — só aparece se o usuário tem acesso a múltiplas lojas */}
          {canSwitchTenant && (
            <button
              onClick={handleTrocarLoja}
              className="flex items-center gap-1.5 px-3 py-2 bg-white/70 hover:bg-amber-50 border border-zinc-200 hover:border-amber-300 rounded-xl text-xs font-bold transition-all cursor-pointer whitespace-nowrap flex-shrink-0 backdrop-blur-sm group"
              title="Trocar de loja"
            >
              <div className="w-4 h-4 flex items-center justify-center text-zinc-400 group-hover:text-amber-500 transition-colors">
                <Store size={14} />
              </div>
              <span className="text-zinc-600 group-hover:text-amber-600 transition-colors hidden sm:inline">Trocar Loja</span>
            </button>
          )}

          {podeVerTotens && totens.length > 0 && (
            <div className="relative flex-shrink-0">
              <button
                onClick={() => setShowTotens((v) => !v)}
                className="flex items-center gap-1.5 px-3 py-2 bg-white/70 hover:bg-white border border-zinc-200 rounded-xl text-xs font-bold transition-all cursor-pointer whitespace-nowrap backdrop-blur-sm"
              >
                <div className="w-4 h-4 flex items-center justify-center text-zinc-500">
                  <Monitor size={14} />
                </div>
                <span className="text-zinc-600 hidden sm:inline">Totens</span>
                <div className="flex items-center gap-1">
                  <div className={`w-2 h-2 rounded-full ${totensOnline.length > 0 ? 'bg-emerald-500 animate-pulse' : 'bg-zinc-300'}`} />
                  <span className={`text-xs ${totensOnline.length > 0 ? 'text-emerald-600' : 'text-zinc-400'}`}>
                    {totensOnline.length}/{totens.length}
                  </span>
                </div>
              </button>
              {showTotens && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowTotens(false)} />
                  <div className="absolute right-0 top-full mt-2 z-50 w-72 bg-white/95 backdrop-blur-xl border border-zinc-200 rounded-2xl overflow-hidden">
                    <div className="px-4 py-3 border-b border-zinc-100">
                      <p className="text-zinc-900 text-sm font-bold">Status dos Totens</p>
                      <p className="text-zinc-400 text-xs mt-0.5">{totensOnline.length} de {totens.length} ativo{totens.length !== 1 ? 's' : ''}</p>
                    </div>
                    <div className="p-2 max-h-64 overflow-y-auto">
                      {totens.map((t) => {
                        const isOnline = t.kioskOnline;
                        const minutosAtras = t.ultimoAcesso
                          ? Math.floor((Date.now() - new Date(t.ultimoAcesso).getTime()) / 60000)
                          : null;
                        return (
                          <div key={t.id} className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-zinc-50 transition-colors">
                            <div className={`w-8 h-8 flex items-center justify-center rounded-lg flex-shrink-0 ${isOnline ? 'bg-emerald-100' : 'bg-zinc-100'}`}>
                              <i className={`ri-tablet-line text-sm ${isOnline ? 'text-emerald-600' : 'text-zinc-400'}`} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-semibold text-zinc-800 truncate">{t.nome}</p>
                              <p className="text-xs text-zinc-400">
                                {isOnline
                                  ? 'Online agora'
                                  : minutosAtras !== null
                                  ? minutosAtras < 60
                                    ? `Há ${minutosAtras}min`
                                    : `Há ${Math.floor(minutosAtras / 60)}h`
                                  : 'Nunca acessou'}
                              </p>
                            </div>
                            <div className="flex items-center gap-1.5 flex-shrink-0">
                              <div className={`w-2 h-2 rounded-full ${isOnline ? 'bg-emerald-500 animate-pulse' : 'bg-zinc-300'}`} />
                              <span className={`text-xs font-semibold ${isOnline ? 'text-emerald-600' : 'text-zinc-400'}`}>{isOnline ? 'Online' : 'Offline'}</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <div className="px-4 py-3 border-t border-zinc-100">
                      <a href="/usuarios" className="text-xs text-amber-500 hover:text-amber-600 font-semibold transition-colors">Gerenciar usuários totem →</a>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {isAdminMaster && (
            <button
              onClick={() => navigate('/admin-master')}
              className="flex items-center gap-1.5 px-3 py-2 bg-amber-500 hover:bg-amber-400 border border-amber-400 rounded-xl text-xs font-bold text-white transition-all cursor-pointer whitespace-nowrap flex-shrink-0"
            >
              <i className="ri-shield-star-line text-sm" />
              <span className="hidden md:inline">Admin Master</span>
            </button>
          )}

          <div className="flex items-center gap-1.5 sm:gap-2 px-2 sm:px-3 py-2 bg-white/70 rounded-xl border border-zinc-200 flex-shrink-0 backdrop-blur-sm">
            <div className="w-7 h-7 flex items-center justify-center bg-gradient-to-br from-amber-400 to-amber-600 rounded-full flex-shrink-0">
              <span className="text-[11px] font-black text-white">{user?.nome.charAt(0)}</span>
            </div>
            <div className="min-w-0 hidden md:block">
              <p className="text-zinc-800 text-xs font-semibold leading-none truncate max-w-[80px] lg:max-w-[120px]">{user?.nome}</p>
              <p className="text-zinc-400 text-[10px] mt-0.5 truncate max-w-[80px] lg:max-w-[120px]">{user?.perfil ? perfilLabel[user.perfil] : ''}</p>
            </div>
            <button onClick={handleLogout} title="Sair" className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-zinc-100 cursor-pointer text-zinc-400 hover:text-red-500 transition-colors">
              <LogOut size={13} />
            </button>
          </div>
        </div>
      </div>

      {/* ── HERO ── */}
      <div className="relative z-10 px-5 md:px-10 pt-2 pb-8">
        {canSwitchTenant ? (
          <button
            onClick={handleTrocarLoja}
            className="inline-flex items-center gap-2 px-3 py-1.5 bg-amber-50 hover:bg-amber-100 border border-amber-200 hover:border-amber-300 rounded-full mb-4 transition-all cursor-pointer group"
          >
            <div className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
            <span className="text-amber-700 text-xs font-semibold">{user?.loja || '—'}</span>
            <i className="ri-arrow-left-right-line text-amber-500 text-xs opacity-60 group-hover:opacity-100 transition-opacity" />
          </button>
        ) : (
          <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-amber-50 border border-amber-200 rounded-full mb-4">
            <div className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
            <span className="text-amber-700 text-xs font-semibold">{user?.loja || '—'}</span>
          </div>
        )}
        <h1 className="text-2xl md:text-3xl font-black text-zinc-900 leading-tight">
          Olá, <span className="text-amber-500">{user?.nome?.split(' ')[0] ?? 'bem-vindo'}</span>
        </h1>
        <p className="text-zinc-400 text-sm mt-1">Selecione o módulo que deseja acessar</p>
      </div>

      {/* ── GRID DE MÓDULOS ── */}
      <div className="relative z-10 flex-1 px-5 md:px-10 pb-12 max-w-5xl w-full">

        {/* Terminais PDV */}
        {terminais.length > 0 && (
          <div className="mb-8">
            <SectionLabel label="Terminais PDV" />
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {terminais.map((m, idx) => (
                <ModuloTile
                  key={m.id}
                  modulo={m}
                  delay={idx * 55}
                  onClick={() => handleModulo(m)}
                />
              ))}
            </div>
          </div>
        )}

        {/* Cozinha */}
        {cozinha.length > 0 && (
          <div className="mb-8">
            <SectionLabel label="Cozinha" />
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {cozinha.map((m, idx) => (
                <ModuloTile
                  key={m.id}
                  modulo={m}
                  delay={(terminais.length + idx) * 55}
                  onClick={() => handleModulo(m)}
                />
              ))}
            </div>
          </div>
        )}

        {/* Admin / Gestão */}
        {admin.length > 0 && (
          <div className="mb-8">
            <SectionLabel label="Gestão" />
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {admin.map((m, idx) => (
                <ModuloTile
                  key={m.id}
                  modulo={m}
                  delay={(terminais.length + cozinha.length + idx) * 55}
                  onClick={() => handleModulo(m)}
                />
              ))}
            </div>
          </div>
        )}

        {modulosVisiveis.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-zinc-400">
            <i className="ri-apps-line text-4xl mb-3" />
            <p className="text-sm font-semibold">Nenhum módulo disponível</p>
          </div>
        )}

        {/* Rodapé */}
        <div className="mt-4 flex items-center gap-3">
          <div className="flex-1 h-px bg-zinc-200" />
          <p className="text-zinc-400 text-xs">
            {modulosVisiveis.length} módulo{modulosVisiveis.length !== 1 ? 's' : ''} disponível{modulosVisiveis.length !== 1 ? 'is' : ''}
          </p>
          <div className="flex-1 h-px bg-zinc-200" />
        </div>
      </div>

      {showShareModal && <OnboardingShareModal onClose={() => setShowShareModal(false)} />}
    </div>
  );
}

/* ── Sub-componentes ── */

function SectionLabel({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 mb-3">
      <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest whitespace-nowrap">
        {label}
      </span>
      <div className="flex-1 h-px bg-zinc-200" />
    </div>
  );
}

interface ModuloTileProps {
  modulo: ModuloCard;
  delay: number;
  onClick: () => void;
}

function ModuloTile({ modulo: m, delay, onClick }: ModuloTileProps) {
  return (
    <button
      onClick={onClick}
      style={{ animationDelay: `${delay}ms` }}
      className={`mod-enter group relative flex flex-col p-5 rounded-2xl border cursor-pointer text-left transition-all duration-200 overflow-hidden bg-white/70 hover:bg-white backdrop-blur-sm ${m.acentoBorder} hover:scale-[1.02]`}
    >
      {/* Orb decorativo no hover */}
      <div
        className="absolute -top-6 -right-6 w-20 h-20 rounded-full opacity-0 group-hover:opacity-15 transition-opacity duration-300"
        style={{ background: m.acento }}
      />

      {/* Topo: ícone + tag */}
      <div className="flex items-start justify-between mb-4">
        <div
          className={`w-11 h-11 flex items-center justify-center rounded-xl ${m.acentoBg} border ${m.acentoBorder} flex-shrink-0`}
        >
          <i className={`${m.icon} text-xl ${m.acentoText}`} />
        </div>
        <span
          className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${m.acentoBg} ${m.acentoText} border ${m.acentoBorder} whitespace-nowrap`}
        >
          {m.tag}
        </span>
      </div>

      {/* Título + descrição */}
      <p className="text-sm font-black text-zinc-800 leading-tight mb-1">{m.titulo}</p>
      <p className="text-xs text-zinc-400 leading-snug flex-1">{m.descricao}</p>

      {/* Rodapé: "Acessar →" aparece no hover */}
      <div
        className={`mt-3 flex items-center gap-1 text-xs font-semibold ${m.acentoText} opacity-0 group-hover:opacity-100 transition-all duration-200 translate-y-1 group-hover:translate-y-0`}
      >
        Acessar
        <i className="ri-arrow-right-line text-xs" />
      </div>
    </button>
  );
}
