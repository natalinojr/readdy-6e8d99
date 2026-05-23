import { useState, useEffect, useRef } from 'react';
import { ChevronDown, User, LogOut, WifiOff, Store } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useModoTreino } from '../../contexts/ModoTreinoContext';

// ─── Modal Criar Nova Loja ────────────────────────────────────────────────────
function CriarLojaModal({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const [codigo, setCodigo] = useState('');

  const handleEntrar = () => {
    const code = codigo.trim().toUpperCase();
    if (!code) return;
    navigate(`/onboarding?invite=${encodeURIComponent(code)}`);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full max-w-sm overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-100">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 flex items-center justify-center bg-amber-100 rounded-xl">
              <i className="ri-key-2-line text-amber-600 text-sm" />
            </div>
            <h2 className="text-sm font-black text-zinc-900">Criar nova loja</h2>
          </div>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-zinc-100 cursor-pointer text-zinc-400">
            <i className="ri-close-line text-base" />
          </button>
        </div>
        <div className="px-5 py-5 space-y-4">
          <p className="text-xs text-zinc-500 leading-relaxed">
            Insira o código de convite recebido do administrador para configurar sua nova loja.
          </p>
          <div>
            <label className="block text-xs font-semibold text-zinc-600 mb-1.5">Código de convite</label>
            <input
              type="text"
              value={codigo}
              onChange={e => setCodigo(e.target.value.toUpperCase())}
              onKeyDown={e => e.key === 'Enter' && handleEntrar()}
              placeholder="Ex: XXXX-XXXX-XXXX"
              autoFocus
              className="w-full text-center text-base font-mono font-bold tracking-widest border-2 border-zinc-200 rounded-xl px-4 py-3 focus:outline-none focus:border-amber-400 transition-colors"
              maxLength={20}
            />
          </div>
          <div className="flex gap-2">
            <button onClick={onClose} className="flex-1 py-2.5 text-sm font-semibold text-zinc-600 bg-zinc-100 rounded-xl hover:bg-zinc-200 cursor-pointer whitespace-nowrap">
              Cancelar
            </button>
            <button
              onClick={handleEntrar}
              disabled={!codigo.trim()}
              className="flex-1 py-2.5 text-sm font-bold text-white bg-amber-500 rounded-xl hover:bg-amber-600 disabled:opacity-40 cursor-pointer whitespace-nowrap flex items-center justify-center gap-2"
            >
              <i className="ri-store-line" />
              Configurar loja
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
import CentralNotificacoes from './CentralNotificacoes';
import PrintQueueBadge from './PrintQueueBadge';
import type { PerfilAlvo } from '../../contexts/NotificacoesContext';
import { countPendingOrders } from '@/lib/offlineDB';
import { startAutoSync, stopAutoSync } from '@/lib/offlineSync';

const perfilLabel: Record<string, string> = {
  admin: 'Administrador',
  gerente: 'Gerente',
  caixa: 'Operador de Caixa',
  garcom: 'Garçom',
  cozinha: 'Op. Cozinha',
};

interface TopBarProps {
  onMenuToggle?: () => void;
}

export default function TopBar({ onMenuToggle }: TopBarProps) {
  const { user, logout, canSwitchTenant, switchTenant } = useAuth();
  const navigate = useNavigate();
  const { isModoTreino } = useModoTreino();
  const [currentTime, setCurrentTime] = useState(new Date());
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showCriarLoja, setShowCriarLoja] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  // BUG 2.7 FIX: badge de pedidos pendentes de sincronização
  const [pendingCount, setPendingCount] = useState(0);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const interval = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const handleOnline = () => { setIsOnline(true); };
    const handleOffline = () => { setIsOnline(false); };
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // BUG 2.7 FIX: Iniciar auto-sync e monitorar contador de pendentes
  useEffect(() => {
    if (!user?.tenantId) return;

    const refreshPending = async () => {
      const count = await countPendingOrders(user.tenantId).catch(() => 0);
      setPendingCount(count);
    };

    refreshPending();

    startAutoSync(user.tenantId, (summary) => {
      if (summary.succeeded > 0) {
        refreshPending();
      }
    });

    // Recheck a cada 30s
    const interval = setInterval(refreshPending, 30_000);

    return () => {
      stopAutoSync();
      clearInterval(interval);
    };
  }, [user?.tenantId]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowUserMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const formattedDate = currentTime.toLocaleDateString('pt-BR', {
    weekday: 'long', day: '2-digit', month: 'long',
  });

  const formattedTime = currentTime.toLocaleTimeString('pt-BR', {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });

  const handleLogout = () => { logout(); navigate('/login'); };

  return (
    <header className="h-14 bg-white border-b border-zinc-100 flex items-center justify-between px-4 md:px-6 flex-shrink-0">
      {/* Hamburger — mobile only */}
      <button
        onClick={onMenuToggle}
        className="md:hidden w-9 h-9 flex items-center justify-center rounded-lg hover:bg-zinc-100 cursor-pointer transition-colors text-zinc-600 flex-shrink-0 mr-2"
        aria-label="Abrir menu"
      >
        <i className="ri-menu-line text-xl" />
      </button>

      <p className="text-sm text-zinc-500 capitalize hidden md:block">{formattedDate}</p>

      <div className="flex items-center gap-2 ml-auto">
        {/* TREINO badge */}
        {isModoTreino && (
          <div className="flex items-center gap-1.5 bg-amber-400 text-amber-900 text-xs font-black px-3 py-1.5 rounded-lg">
            <i className="ri-graduation-cap-fill text-sm" />
            TREINO
          </div>
        )}

        {/* OFFLINE badge */}
        {!isOnline && (
          <div className="flex items-center gap-1.5 bg-red-500 text-white text-xs font-bold px-3 py-1.5 rounded-lg animate-pulse">
            <WifiOff size={12} />
            OFFLINE
          </div>
        )}

        {/* BUG 2.7 FIX: Badge de pedidos offline pendentes */}
        {pendingCount > 0 && (
          <div
            className="flex items-center gap-1.5 bg-orange-500 text-white text-xs font-bold px-3 py-1.5 rounded-lg cursor-pointer"
            title={`${pendingCount} pedido(s) aguardando sincronização`}
          >
            <i className="ri-cloud-off-line text-sm" />
            {pendingCount} pendente{pendingCount > 1 ? 's' : ''}
          </div>
        )}

        {/* Badge da fila de impressão offline */}
        <PrintQueueBadge />

        {/* Store indicator — visible for all, switchable for admin with multiple stores */}
        {user?.loja && (
          <div className="hidden md:flex items-center">
            {canSwitchTenant ? (
              <button
                onClick={switchTenant}
                title="Trocar de loja"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-200 bg-zinc-50 hover:border-amber-400 hover:bg-amber-50 transition-colors cursor-pointer"
              >
                <Store size={13} className="text-amber-600 flex-shrink-0" />
                <span className="text-xs font-semibold text-zinc-700 max-w-[120px] truncate">
                  {user.loja}
                </span>
                <i className="ri-refresh-line text-xs text-zinc-400" />
              </button>
            ) : (
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-100 bg-zinc-50">
                <Store size={13} className="text-zinc-400 flex-shrink-0" />
                <span className="text-xs font-medium text-zinc-500 max-w-[120px] truncate">
                  {user.loja}
                </span>
              </div>
            )}
          </div>
        )}

        <span className="text-sm font-semibold text-zinc-700 tabular-nums mr-2">{formattedTime}</span>

        <CentralNotificacoes perfil={(user?.perfil as PerfilAlvo) ?? 'caixa'} />

        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setShowUserMenu((v) => !v)}
            className="flex items-center gap-2 pl-2 pr-2 py-1.5 rounded-lg hover:bg-zinc-100 cursor-pointer transition-colors"
          >
            <div className="w-7 h-7 flex items-center justify-center bg-amber-500 rounded-full flex-shrink-0">
              <span className="text-[11px] font-bold text-zinc-950">{user?.nome.charAt(0)}</span>
            </div>
            <span className="text-sm font-medium text-zinc-700 hidden md:block whitespace-nowrap">{user?.nome}</span>
            <ChevronDown size={13} className="text-zinc-400" />
          </button>

          {showUserMenu && (
            <div className="absolute right-0 top-full mt-1.5 w-56 bg-white border border-zinc-200 rounded-xl py-1.5 z-50 overflow-hidden">
              {/* Cabeçalho do usuário */}
              <div className="px-4 py-3 border-b border-zinc-100">
                <div className="flex items-center gap-2.5 mb-1">
                  <div className="w-8 h-8 flex items-center justify-center bg-amber-500 rounded-full flex-shrink-0">
                    <span className="text-[11px] font-black text-zinc-950">{user?.nome.charAt(0)}</span>
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-zinc-900 truncate">{user?.nome}</p>
                    <p className="text-[11px] text-zinc-400 truncate">{user?.perfil ? perfilLabel[user.perfil] : ''}</p>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 px-2 py-1 bg-zinc-50 rounded-lg border border-zinc-100">
                  <Store size={11} className="text-zinc-400 flex-shrink-0" />
                  <span className="text-[11px] text-zinc-500 truncate font-medium">{user?.loja}</span>
                </div>
                {isModoTreino && (
                  <div className="flex items-center gap-1.5 mt-1.5 px-2 py-1 bg-amber-50 rounded-lg border border-amber-100">
                    <i className="ri-graduation-cap-fill text-amber-500 text-xs" />
                    <span className="text-[10px] font-black text-amber-700 uppercase tracking-wide">Modo Treino</span>
                  </div>
                )}
              </div>

              {/* Ações */}
              <div className="py-1">
                <button
                  onClick={() => { setShowUserMenu(false); navigate('/perfil'); }}
                  className="w-full text-left px-4 py-2.5 text-sm text-zinc-700 hover:bg-zinc-50 flex items-center gap-2.5 cursor-pointer transition-colors"
                >
                  <div className="w-4 h-4 flex items-center justify-center">
                    <User size={14} className="text-zinc-400" />
                  </div>
                  Meu perfil
                </button>

                {canSwitchTenant && (
                  <button
                    onClick={() => { setShowUserMenu(false); switchTenant(); }}
                    className="w-full text-left px-4 py-2.5 text-sm text-zinc-700 hover:bg-zinc-50 flex items-center gap-2.5 cursor-pointer transition-colors"
                  >
                    <div className="w-4 h-4 flex items-center justify-center">
                      <Store size={14} className="text-zinc-400" />
                    </div>
                    Trocar de loja
                  </button>
                )}

                <button
                  onClick={() => { setShowUserMenu(false); setShowCriarLoja(true); }}
                  className="w-full text-left px-4 py-2.5 text-sm text-amber-700 hover:bg-amber-50 flex items-center gap-2.5 cursor-pointer transition-colors"
                >
                  <div className="w-4 h-4 flex items-center justify-center">
                    <i className="ri-store-2-line text-amber-500 text-sm" />
                  </div>
                  Criar nova loja
                </button>
              </div>

              <div className="border-t border-zinc-100" />

              <button
                onClick={handleLogout}
                className="w-full text-left px-4 py-2.5 text-sm text-red-500 hover:bg-red-50 flex items-center gap-2.5 cursor-pointer transition-colors"
              >
                <div className="w-4 h-4 flex items-center justify-center">
                  <LogOut size={14} />
                </div>
                Sair do sistema
              </button>
            </div>
          )}
        </div>
      </div>

      {showCriarLoja && <CriarLojaModal onClose={() => setShowCriarLoja(false)} />}
    </header>
  );
}
