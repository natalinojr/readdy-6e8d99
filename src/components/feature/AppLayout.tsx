import { Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useModoTreino } from '../../contexts/ModoTreinoContext';
import { useAppMode } from '../../contexts/AppModeContext';
import Sidebar from './Sidebar';
import TopBar from './TopBar';
import SelecionarLojaPage from '../../pages/selecionar-loja/page';
import RotaProtegida from './RotaProtegida';

// Rotas publicas — acessiveis SEM autenticacao
const PUBLIC_ROUTES = ['/login', '/onboarding', '/invite', '/autoatendimento', '/mesa/', '/mesa-qr/', '/pedido/'];
// Rotas full-screen protegidas — sem sidebar/topbar, MAS exigem auth + tenant
const FULL_SCREEN_PROTECTED = ['/modulos'];
// Terminais — full-screen com UI propria
const TERMINAL_ROUTES = ['/pdv/', '/kds', '/gestor-pedidos'];

export default function AppLayout() {
  const { isAuthenticated, needsTenantSelection } = useAuth();
  const location = useLocation();
  const { isModoTreino } = useModoTreino();
  const { mode, setMode } = useAppMode();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Close sidebar on route change
  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);

  const isPublic = PUBLIC_ROUTES.some((r) => location.pathname.startsWith(r));
  const isFullScreenProtected = FULL_SCREEN_PROTECTED.some((r) => location.pathname.startsWith(r));
  const isTerminal = TERMINAL_ROUTES.some((r) => location.pathname.startsWith(r));
  const isModulosPage = location.pathname === '/modulos';

  // 1. Rotas publicas — renderiza sem verificacao de auth
  if (isPublic) {
    return <Outlet />;
  }

  // 2. Protecao de autenticacao
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  // 3. Selecao de loja obrigatoria — bloqueia TUDO ate escolher
  if (needsTenantSelection) {
    return <SelecionarLojaPage />;
  }

  // 4. Full-screen protegidas (modulos) — sem sidebar
  if (isFullScreenProtected) {
    return <Outlet />;
  }

  // Terminais (PDV/KDS/Gestor) — full screen sem barra extra
  if (isTerminal) {
    return (
      <div className={`flex flex-col h-screen overflow-hidden ${isModoTreino ? 'ring-4 ring-inset ring-amber-400' : ''}`}>
        {isModoTreino && (
          <div className="bg-amber-400 px-4 py-2 flex items-center justify-center gap-3 flex-shrink-0 z-10">
            <i className="ri-graduation-cap-fill text-amber-900 text-base" />
            <p className="text-amber-900 text-xs font-black tracking-wide">
              MODO TREINO ATIVO — Pedidos e dados nao afetam o sistema real
            </p>
            <i className="ri-graduation-cap-fill text-amber-900 text-base" />
          </div>
        )}
        <div className="flex-1 overflow-hidden">
          <RotaProtegida>
            <Outlet />
          </RotaProtegida>
        </div>
      </div>
    );
  }

  // Modo Gestao — sidebar filtrada + topbar + pagina
  return (
    <div className={`flex h-screen overflow-hidden font-sans bg-white ${isModoTreino ? 'ring-4 ring-inset ring-amber-400' : ''}`}>
      {isModoTreino && (
        <div className="fixed inset-0 pointer-events-none z-[5] flex items-center justify-center">
          <div
            className="text-amber-300/20 font-black text-[120px] uppercase tracking-widest select-none"
            style={{ transform: 'rotate(-35deg)', userSelect: 'none' }}
          >
            TREINO
          </div>
        </div>
      )}

      <Sidebar
        gestaoMode={mode === 'gestao'}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />
      <div className="relative z-10 flex flex-col flex-1 overflow-hidden min-w-0">
        {isModoTreino && (
          <div className="bg-amber-400 px-4 py-2 flex items-center justify-center gap-3 flex-shrink-0 z-10">
            <i className="ri-graduation-cap-fill text-amber-900 text-base" />
            <p className="text-amber-900 text-xs font-black tracking-wide">
              MODO TREINO ATIVO — Pedidos e dados nao afetam o sistema real
            </p>
            <i className="ri-graduation-cap-fill text-amber-900 text-base" />
          </div>
        )}
        <TopBar onMenuToggle={() => setSidebarOpen((v) => !v)} />
        <main className="flex-1 overflow-y-auto p-4 md:p-6">
          <RotaProtegida>
            {/* O alerta de sessão esquecida é renderizado apenas no PDV Caixa
                (src/pages/pdv/caixa/page.tsx), não globalmente. */}
            <Outlet />
          </RotaProtegida>
        </main>
      </div>
    </div>
  );
}
