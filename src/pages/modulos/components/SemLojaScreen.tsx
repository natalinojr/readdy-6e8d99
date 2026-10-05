import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChefHat, LogOut } from 'lucide-react';

// ─── Tela Sem Loja ────────────────────────────────────────────────────────────

interface SemLojaScreenProps {
  userName: string;
  onLogout: () => void;
}

export default function SemLojaScreen({ userName, onLogout }: SemLojaScreenProps) {
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
