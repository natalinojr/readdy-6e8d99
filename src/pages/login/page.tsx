import { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ChefHat, Eye, EyeOff, AlertCircle, X } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useAppMode } from '@/contexts/AppModeContext';

interface LoginRecente {
  identifier: string;
  mode: 'email' | 'matricula';
  lastUsed: string;
}

const STORAGE_KEY = 'erpos_logins_recentes';

function getLoginsRecentes(): LoginRecente[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function salvarLoginRecente(identifier: string, mode: 'email' | 'matricula') {
  const logins = getLoginsRecentes();
  const filtered = logins.filter((l) => l.identifier !== identifier || l.mode !== mode);
  const novo = {
    identifier,
    mode,
    lastUsed: new Date().toISOString(),
  };
  const atualizados = [novo, ...filtered].slice(0, 5);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(atualizados));
}

function removerLoginRecente(identifier: string, mode: 'email' | 'matricula') {
  const logins = getLoginsRecentes();
  const atualizados = logins.filter((l) => l.identifier !== identifier || l.mode !== mode);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(atualizados));
}

export default function Login() {
  const { login, isAuthenticated } = useAuth();
  const { setMode: setAppMode } = useAppMode();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [mode, setMode] = useState<'email' | 'matricula'>('email');
  const [identifier, setIdentifier] = useState('');
  const [senha, setSenha] = useState('');
  const [showSenha, setShowSenha] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [loginsRecentes, setLoginsRecentes] = useState<LoginRecente[]>([]);
  const senhaRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const inviteToken = searchParams.get('invite') || searchParams.get('t');
    if (inviteToken) {
      navigate(`/invite?t=${inviteToken}`, { replace: true });
    }
  }, [searchParams, navigate]);

  useEffect(() => {
    setLoginsRecentes(getLoginsRecentes());
  }, []);

  if (isAuthenticated) { navigate('/modulos', { replace: true }); return null; }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!identifier.trim() || !senha.trim()) { setError('Preencha todos os campos.'); return; }
    setLoading(true);
    const result = await login(identifier, senha);
    setLoading(false);
    if (result) {
      salvarLoginRecente(identifier.trim(), mode);
      setAppMode('modulos');
      navigate('/modulos', { replace: true });
    } else {
      setError('Credenciais inválidas. Verifique e tente novamente.');
    }
  };

  const handleSelecionarLogin = (login: LoginRecente) => {
    setMode(login.mode);
    setIdentifier(login.identifier);
    setError('');
    setTimeout(() => senhaRef.current?.focus(), 50);
  };

  const handleRemoverLogin = (e: React.MouseEvent, login: LoginRecente) => {
    e.stopPropagation();
    removerLoginRecente(login.identifier, login.mode);
    setLoginsRecentes(getLoginsRecentes());
  };

  const loginsFiltrados = loginsRecentes.filter((l) => l.mode === mode);

  return (
    <div className="min-h-screen flex font-sans">
      {/* Left panel */}
      <div className="hidden lg:flex lg:w-1/2 relative overflow-hidden">
        <img
          src="https://readdy.ai/api/search-image?query=elegant%20restaurant%20interior%20with%20warm%20amber%20lighting%2C%20wooden%20tables%20set%20for%20dinner%2C%20soft%20bokeh%20background%2C%20professional%20fine%20dining%20atmosphere%2C%20cozy%20and%20inviting%20ambiance%2C%20rich%20warm%20tones&width=800&height=1200&seq=erpos-login-01&orientation=portrait"
          alt="Restaurant"
          className="absolute inset-0 w-full h-full object-cover object-top"
        />
        <div className="absolute inset-0 bg-gradient-to-br from-zinc-950/80 via-zinc-900/60 to-amber-900/40" />
        <div className="relative z-10 flex flex-col justify-between p-12 w-full">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 flex items-center justify-center bg-amber-500 rounded-xl">
              <ChefHat size={20} className="text-zinc-950" />
            </div>
            <span className="text-white font-bold text-xl tracking-wide">ERPOS V2</span>
          </div>
          <div>
            <h2 className="text-white text-3xl font-bold leading-snug mb-4">
              Sistema completo<br />para o seu restaurante
            </h2>
            <p className="text-zinc-300 text-sm leading-relaxed">
              PDV, KDS, mesas, cardápio, estoque e relatórios — tudo integrado em uma plataforma.
            </p>
            <div className="flex flex-wrap gap-2 mt-6">
              {['PDV Caixa', 'PDV Garçom', 'KDS', 'QR Code', 'Relatórios'].map((tag) => (
                <span key={tag} className="text-xs bg-white/10 text-white px-3 py-1 rounded-full border border-white/20">
                  {tag}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Right panel */}
      <div className="flex-1 flex items-center justify-center px-6 py-12 relative" style={{ background: 'linear-gradient(to right, #fef3c7 0%, #fde68a 0%, rgba(253,230,138,0.35) 18%, rgba(251,191,36,0.12) 38%, rgba(255,255,255,0.6) 60%, #ffffff 100%)' }}>
        {/* Subtle warm glow from left edge */}
        <div className="absolute inset-y-0 left-0 w-32 pointer-events-none" style={{ background: 'linear-gradient(to right, rgba(245,158,11,0.18), transparent)' }} />
        <div className="w-full max-w-sm">
          <div className="flex items-center gap-3 mb-8 lg:hidden">
            <div className="w-9 h-9 flex items-center justify-center bg-amber-500 rounded-xl">
              <ChefHat size={18} className="text-zinc-950" />
            </div>
            <span className="text-zinc-900 font-bold text-lg">ERPOS V2</span>
          </div>

          <h1 className="text-2xl font-bold text-zinc-900 mb-1">Entrar no sistema</h1>
          <p className="text-sm text-zinc-500 mb-7">Acesse com suas credenciais de operador</p>

          {/* Mode toggle */}
          <div className="flex bg-zinc-100 rounded-lg p-1 mb-6">
            {(['email', 'matricula'] as const).map((m) => (
              <button
                key={m}
                onClick={() => { setMode(m); setIdentifier(''); setError(''); }}
                className={`flex-1 py-1.5 text-sm font-semibold rounded-md transition-colors cursor-pointer whitespace-nowrap ${mode === m ? 'bg-white text-zinc-900' : 'text-zinc-500 hover:text-zinc-700'}`}
              >
                {m === 'email' ? 'E-mail' : 'Matrícula'}
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-zinc-600 mb-1.5">
                {mode === 'email' ? 'E-mail' : 'Número de Matrícula'}
              </label>
              <input
                type={mode === 'email' ? 'email' : 'text'}
                inputMode={mode === 'matricula' ? 'none' : undefined}
                pattern={mode === 'matricula' ? '[0-9]*' : undefined}
                data-keyboard={mode === 'matricula' ? 'numeric' : undefined}
                data-native-keyboard="false"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                placeholder={mode === 'email' ? 'seu@email.com' : 'Ex: 0001'}
                className="w-full px-3.5 py-2.5 text-sm border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent transition-all"
              />
              {/* Logins recentes */}
              {loginsFiltrados.length > 0 && (
                <div className="mt-2">
                  <p className="text-[10px] text-zinc-400 mb-1.5 uppercase tracking-wider font-semibold">Acessos recentes</p>
                  <div className="flex flex-wrap gap-1.5">
                    {loginsFiltrados.map((login) => (
                      <button
                        key={`${login.mode}-${login.identifier}`}
                        type="button"
                        onClick={() => handleSelecionarLogin(login)}
                        className="group flex items-center gap-1.5 pl-2.5 pr-1 py-1 text-xs bg-amber-50 text-amber-700 border border-amber-200 rounded-md hover:bg-amber-100 transition-colors cursor-pointer"
                        title="Clique para preencher"
                      >
                        <span className="max-w-[140px] truncate">{login.identifier}</span>
                        <span
                          onClick={(e) => handleRemoverLogin(e, login)}
                          className="w-4 h-4 flex items-center justify-center rounded-full hover:bg-amber-200 text-amber-500 hover:text-amber-700 cursor-pointer"
                        >
                          <X size={10} />
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div>
              <label className="block text-xs font-semibold text-zinc-600 mb-1.5">
                {mode === 'email' ? 'Senha' : 'PIN'}
              </label>
              <div className="relative">
                <input
                  ref={senhaRef}
                  type={showSenha ? 'text' : 'password'}
                  inputMode={mode === 'matricula' ? 'none' : undefined}
                  pattern={mode === 'matricula' ? '[0-9]*' : undefined}
                  data-keyboard={mode === 'matricula' ? 'numeric' : undefined}
                  data-native-keyboard="false"
                  value={senha}
                  onChange={(e) => setSenha(e.target.value)}
                  placeholder={mode === 'email' ? '••••••••' : '••••'}
                  className="w-full px-3.5 py-2.5 text-sm border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent transition-all pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowSenha((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 cursor-pointer text-zinc-400 hover:text-zinc-600 w-5 h-5 flex items-center justify-center"
                >
                  {showSenha ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {error && (
              <div className="flex items-center gap-2 px-3 py-2.5 bg-red-50 border border-red-100 rounded-lg">
                <AlertCircle size={14} className="text-red-500 flex-shrink-0" />
                <p className="text-xs text-red-600">{error}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-amber-500 hover:bg-amber-600 disabled:opacity-60 text-zinc-950 font-bold py-2.5 rounded-lg transition-colors cursor-pointer whitespace-nowrap text-sm"
            >
              {loading ? 'Entrando...' : 'Entrar no sistema'}
            </button>
          </form>

        </div>
      </div>
    </div>
  );
}