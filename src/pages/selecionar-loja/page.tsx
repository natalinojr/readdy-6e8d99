import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChefHat, LogOut, Store, ArrowRight } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import type { TenantOption } from '@/contexts/AuthContext';

const perfilLabel: Record<string, string> = {
  admin: 'Administrador',
  gerente: 'Gerente',
  caixa: 'Operador de Caixa',
  garcom: 'Garçom',
  cozinha: 'Operador de Cozinha',
};

interface StoreCardProps {
  tenant: TenantOption;
  onSelect: (id: string) => void;
  loading: boolean;
  isSelected: boolean;
}

function StoreCard({ tenant, onSelect, loading, isSelected }: StoreCardProps) {
  return (
    <button
      onClick={() => onSelect(tenant.tenantId)}
      disabled={loading}
      className="w-full group flex items-center gap-4 p-5 rounded-2xl hover:border-amber-300 transition-all cursor-pointer text-left disabled:opacity-60 disabled:cursor-not-allowed border-2"
      style={{ background: 'rgba(255,255,255,0.65)', backdropFilter: 'blur(8px)', borderColor: 'rgba(245,158,11,0.15)' }}
      onMouseEnter={e => (e.currentTarget.style.borderColor = 'rgba(245,158,11,0.5)')}
      onMouseLeave={e => (e.currentTarget.style.borderColor = 'rgba(245,158,11,0.15)')}
    >
      <div className="w-14 h-14 flex items-center justify-center bg-amber-50 rounded-xl group-hover:bg-amber-100 transition-colors flex-shrink-0">
        <Store size={24} className="text-amber-600" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-base font-bold text-zinc-900 truncate">{tenant.tenantName}</p>
        <p className="text-sm text-zinc-500 mt-0.5">{perfilLabel[tenant.role] ?? tenant.role}</p>
        {tenant.trainingMode && (
          <span className="inline-flex items-center gap-1 mt-1.5 text-[10px] font-bold text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">
            <i className="ri-graduation-cap-fill text-xs" />
            MODO TREINO
          </span>
        )}
      </div>
      <div className="w-8 h-8 flex items-center justify-center rounded-full bg-zinc-100 group-hover:bg-amber-500 transition-colors flex-shrink-0">
        {isSelected ? (
          <div className="w-4 h-4 flex items-center justify-center">
            <div className="w-4 h-4 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <ArrowRight size={16} className="text-zinc-400 group-hover:text-white transition-colors" />
        )}
      </div>
    </button>
  );
}

export default function SelecionarLojaPage() {
  const { availableTenants, selectTenant, logout } = useAuth();
  const navigate = useNavigate();
  const [selecting, setSelecting] = useState<string | null>(null);

  const handleSelect = async (tenantId: string) => {
    if (selecting) return;
    setSelecting(tenantId);
    await selectTenant(tenantId);
    navigate('/modulos', { replace: true });
    setSelecting(null);
  };

  const handleLogout = () => {
    logout();
    navigate('/login', { replace: true });
  };

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-4 relative overflow-hidden"
      style={{ background: 'linear-gradient(160deg, #fffbf5 0%, #fef6e8 50%, #fdf4e3 100%)' }}
    >
      {/* Orbs decorativos */}
      <div className="absolute -top-40 -left-40 w-96 h-96 rounded-full opacity-25 pointer-events-none" style={{ background: 'radial-gradient(circle, #f59e0b 0%, transparent 70%)' }} />
      <div className="absolute top-1/2 -right-32 w-80 h-80 rounded-full opacity-15 pointer-events-none" style={{ background: 'radial-gradient(circle, #fb923c 0%, transparent 70%)' }} />
      <div className="absolute -bottom-24 left-1/4 w-72 h-72 rounded-full opacity-10 pointer-events-none" style={{ background: 'radial-gradient(circle, #fbbf24 0%, transparent 70%)' }} />

      <div className="w-full max-w-md relative z-10">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <div
            className="w-16 h-16 flex items-center justify-center rounded-2xl mb-4"
            style={{ background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)' }}
          >
            <ChefHat size={32} className="text-white" />
          </div>
          <h1 className="text-2xl font-black text-zinc-800">Selecionar Loja</h1>
          <p className="text-sm text-zinc-500 mt-1.5 text-center">
            Escolha qual loja você deseja operar nesta sessão
          </p>
        </div>

        {/* Stores list */}
        <div className="space-y-3 mb-6">
          {availableTenants.length === 0 ? (
            <div className="flex flex-col items-center py-10 text-zinc-400">
              <i className="ri-store-line text-4xl mb-3" />
              <p className="text-sm font-semibold">Nenhuma loja disponível</p>
              <p className="text-xs mt-1">Entre em contato com o suporte</p>
            </div>
          ) : (
            availableTenants.map((tenant) => (
              <StoreCard
                key={tenant.tenantId}
                tenant={tenant}
                onSelect={handleSelect}
                loading={selecting !== null}
                isSelected={selecting === tenant.tenantId}
              />
            ))
          )}
        </div>

        {/* Info tip */}
        {availableTenants.length > 0 && (
          <div className="flex items-start gap-2.5 p-3.5 bg-amber-50/80 rounded-xl border border-amber-200/60 mb-6">
            <i className="ri-information-line text-amber-600 text-sm flex-shrink-0 mt-0.5" />
            <p className="text-xs text-amber-800">
              Você tem acesso a{' '}
              <strong>{availableTenants.length} lojas</strong> como administrador.
              A loja selecionada ficará ativa até você trocar ou sair do sistema.
            </p>
          </div>
        )}

        {/* Logout */}
        <button
          onClick={handleLogout}
          className="w-full flex items-center justify-center gap-2 py-3 text-sm text-zinc-400 hover:text-red-500 transition-colors cursor-pointer"
        >
          <LogOut size={15} />
          Sair do sistema
        </button>
      </div>

      <p className="mt-8 text-xs text-zinc-400 relative z-10">ERPOS V2 · Sistema de Gestão</p>
    </div>
  );
}
