import { NavLink, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, ShoppingCart, Coffee, Tablet, Monitor, UtensilsCrossed,
  LayoutGrid, Package, BarChart3, Users, Settings, LogOut, ChefHat,
  Shield, Heart, HelpCircle, ClipboardList, Bell, Truck, ArrowLeft, DollarSign,
  Tag, Gift, Bug, ShieldCheck,
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useAprovacoes } from '../../contexts/AprovacoesContext';
import { useAppMode } from '../../contexts/AppModeContext';
import { useFinanceiroAlertas } from '@/hooks/useFinanceiroAlertas';
import { useSystemSettings } from '@/hooks/useSystemSettings';
import { usePermissoes, type PermissaoKey } from '@/hooks/usePermissoes';

const ADMIN_MASTER_EMAIL = 'natalinojr.engel@gmail.com';

interface NavItem {
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  path: string;
  permissao?: PermissaoKey;
  pdvTerminal?: string;
  adminMasterOnly?: boolean;
}

interface NavSection {
  title?: string;
  items: NavItem[];
  ocultarGestao?: boolean;
}

const navSections: NavSection[] = [
  {
    items: [{ label: 'Dashboard', icon: LayoutDashboard, path: '/dashboard' }],
  },
  {
    title: 'Terminais PDV',
    ocultarGestao: true,
    items: [
      { label: 'PDV Caixa',        icon: ShoppingCart, path: '/pdv/caixa',       pdvTerminal: 'caixa' },
      { label: 'PDV Garçom',       icon: Coffee,       path: '/pdv/garcom',      pdvTerminal: 'garcom' },
      { label: 'PDV Delivery',     icon: Truck,        path: '/pdv/delivery',    pdvTerminal: 'delivery' },
      { label: 'Autoatendimento',  icon: Tablet,       path: '/autoatendimento', pdvTerminal: 'autoatendimento' },
    ],
  },
  {
    title: 'Cozinha',
    ocultarGestao: true,
    items: [
      { label: 'KDS',               icon: Monitor,  path: '/kds',            permissao: 'kds_acessar',            pdvTerminal: 'kds' },
      { label: 'Gestor de Pedidos', icon: ChefHat,  path: '/gestor-pedidos', permissao: 'gestor_pedidos_acessar', pdvTerminal: 'kds' },
    ],
  },
  {
    title: 'Gestão',
    items: [
      { label: 'Pedidos',               icon: ClipboardList,   path: '/pedidos' },
      { label: 'Relatórios',            icon: BarChart3,       path: '/relatorios',    permissao: 'relatorio_financeiro' },
      { label: 'Cardápio',              icon: UtensilsCrossed, path: '/cardapio',      permissao: 'cardapio_editar' },
      { label: 'Estoque',               icon: Package,         path: '/estoque',       permissao: 'estoque_movimentar' },
      { label: 'Financeiro',            icon: DollarSign,      path: '/financeiro',    permissao: 'relatorio_financeiro' },
      { label: 'Usuários',              icon: Users,           path: '/usuarios',      permissao: 'usuarios_gerenciar' },
      { label: 'Mesas',                 icon: LayoutGrid,      path: '/mesas' },
      { label: 'Clientes',              icon: Heart,           path: '/clientes',      permissao: 'clientes_ver' },
      { label: 'Promoções',             icon: Tag,             path: '/promocoes',     permissao: 'cardapio_editar' },
      { label: 'Vouchers & Gift Cards', icon: Gift,            path: '/vouchers',      permissao: 'pdv_desconto' },
      { label: 'Auditoria',             icon: Shield,          path: '/auditoria',     permissao: 'auditoria_ver' },
      { label: 'Aprovações',            icon: Bell,            path: '/aprovacoes' },
      { label: 'Configurações',         icon: Settings,        path: '/configuracoes', permissao: 'configuracoes_editar' },
      { label: 'Ajuda & Tutorial',      icon: HelpCircle,      path: '/ajuda' },
    ],
  },
  {
    title: 'Ferramentas',
    items: [
      { label: 'Diagnóstico de Pedidos', icon: Bug,        path: '/diagnostico',  permissao: 'auditoria_ver', adminMasterOnly: true },
      { label: 'Admin Master',           icon: ShieldCheck, path: '/admin-master',                            adminMasterOnly: true },
    ],
  },
];

const perfilLabel: Record<string, string> = {
  admin: 'Administrador',
  gerente: 'Gerente',
  caixa: 'Operador de Caixa',
  garcom: 'Garçom',
  cozinha: 'Operador de Cozinha',
};

interface SidebarProps {
  gestaoMode?: boolean;
  isOpen?: boolean;
  onClose?: () => void;
}

export default function Sidebar({ gestaoMode = false, isOpen = false, onClose }: SidebarProps) {
  const { user, logout } = useAuth();
  const { pendentesCount } = useAprovacoes();
  const { setMode } = useAppMode();
  const navigate = useNavigate();
  const { totalBadge: financeiroBadge, contasVencidas } = useFinanceiroAlertas();
  const { settings } = useSystemSettings();
  const { hasPermissao } = usePermissoes();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const handleVoltar = () => {
    setMode('modulos');
    navigate('/modulos');
  };

  const pdvConfig = settings.pdv_config;
  const kitchenView = settings.kitchen_view ?? 'ambos';

  const filteredNavSections: NavSection[] = navSections
    .map((section) => {
      const filteredItems = section.items.filter((item) => {
        if (item.adminMasterOnly && user?.email !== ADMIN_MASTER_EMAIL) return false;
        if (item.permissao && !hasPermissao(item.permissao)) return false;
        if (item.pdvTerminal) {
          const terminalAtivo = pdvConfig[item.pdvTerminal as keyof typeof pdvConfig] ?? true;
          if (!terminalAtivo) return false;
        }
        if (item.path === '/kds') return kitchenView === 'kds' || kitchenView === 'ambos';
        if (item.path === '/gestor-pedidos') return kitchenView === 'gestor' || kitchenView === 'ambos';
        return true;
      });
      return { ...section, items: filteredItems };
    })
    .filter((s) => {
      if (gestaoMode && s.ocultarGestao) return false;
      return s.items.length > 0;
    });

  return (
    <>
      {/* Mobile overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 md:hidden"
          onClick={onClose}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`
          fixed inset-y-0 left-0 z-50 w-60 flex-shrink-0 flex flex-col h-full overflow-hidden
          transition-transform duration-300 ease-in-out
          md:static md:translate-x-0 md:z-auto
          ${isOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
        `}
        style={{ background: 'linear-gradient(180deg, #fdf6ee 0%, #faecd8 55%, #f5e0c0 100%)' }}
      >
        {/* Logo */}
        <div className="flex items-center gap-3 px-4 py-4 border-b border-amber-200/60">
          <div className="w-8 h-8 flex items-center justify-center rounded-lg flex-shrink-0 bg-amber-500">
            <ChefHat size={15} className="text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-zinc-800 font-bold text-sm tracking-wide">ERPOS V2</p>
            <p className="text-amber-700/60 text-[10px] truncate max-w-[120px]">{user?.loja}</p>
          </div>
          <button
            onClick={onClose}
            className="md:hidden w-7 h-7 flex items-center justify-center rounded-lg bg-amber-100 hover:bg-amber-200 text-amber-700 hover:text-amber-900 cursor-pointer transition-colors flex-shrink-0"
          >
            <i className="ri-close-line text-base" />
          </button>
        </div>

        {/* Botão voltar */}
        <button
          onClick={() => { handleVoltar(); onClose?.(); }}
          className="flex items-center gap-2 mx-3 mt-3 mb-1 px-3 h-8 rounded-lg bg-amber-100 hover:bg-amber-200 text-amber-800 hover:text-amber-950 cursor-pointer transition-all border border-amber-200 w-[calc(100%-24px)]"
          title="Voltar aos Módulos"
        >
          <ArrowLeft size={13} className="flex-shrink-0" />
          <span className="text-[12px] font-semibold">Módulos</span>
        </button>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto py-3 px-3 space-y-4">
          {filteredNavSections.map((section, si) => (
            <div key={si}>
              {section.title && (
                <p className="text-amber-800/60 text-[9px] font-bold uppercase tracking-widest px-2 mb-1">
                  {section.title}
                </p>
              )}
              <div className="space-y-0.5">
                {section.items.map((item) => (
                  <NavLink
                    key={item.path}
                    to={item.path}
                    onClick={onClose}
                    className={({ isActive }) =>
                      `group flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13px] font-medium transition-all whitespace-nowrap cursor-pointer ${
                        isActive
                          ? 'bg-amber-500 text-white font-semibold'
                          : 'text-zinc-800 hover:bg-amber-100/80 hover:text-zinc-950'
                      }`
                    }
                  >
                    {({ isActive }) => (
                      <>
                        <div className={`w-4 h-4 flex items-center justify-center flex-shrink-0 transition-colors ${
                          isActive ? 'text-white' : 'text-amber-700 group-hover:text-amber-800'
                        }`}>
                          <item.icon size={14} />
                        </div>
                        <span className="flex-1 min-w-0 truncate">{item.label}</span>
                        {item.path === '/aprovacoes' && pendentesCount > 0 && (
                          <span className={`ml-auto text-[9px] font-black px-1.5 py-0.5 rounded-full flex-shrink-0 ${
                            isActive ? 'bg-white/30 text-white' : 'bg-red-500 text-white'
                          }`}>
                            {pendentesCount}
                          </span>
                        )}
                        {item.path === '/financeiro' && financeiroBadge > 0 && (
                          <span className={`ml-auto text-[9px] font-black px-1.5 py-0.5 rounded-full flex-shrink-0 ${
                            isActive
                              ? 'bg-white/30 text-white'
                              : contasVencidas > 0
                                ? 'bg-red-500 text-white'
                                : 'bg-amber-500 text-white'
                          }`}>
                            {financeiroBadge}
                          </span>
                        )}
                      </>
                    )}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>

        {/* User + Logout */}
        <div className="border-t border-amber-200/60 p-3">
          {user?.modoTreino && (
            <div className="mb-2 px-3 py-1.5 bg-amber-100 rounded-lg border border-amber-300">
              <p className="text-amber-700 text-[10px] font-bold text-center tracking-wide">MODO TREINO ATIVO</p>
            </div>
          )}
          <div className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg bg-amber-100/80 border border-amber-200">
            <div className="w-7 h-7 flex-shrink-0 flex items-center justify-center rounded-full bg-amber-500">
              <span className="text-[11px] font-bold text-white">{user?.nome.charAt(0)}</span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-zinc-900 text-xs font-semibold truncate">{user?.nome}</p>
              <p className="text-amber-800/80 text-[10px]">{user?.perfil ? perfilLabel[user.perfil] : ''}</p>
            </div>
            <button
              onClick={handleLogout}
              title="Sair do sistema"
              className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-amber-200 cursor-pointer text-amber-700/70 hover:text-amber-950 transition-colors"
            >
              <LogOut size={13} />
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
