import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ChefHat, Eye, EyeOff, AlertCircle, CheckCircle } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import type { UserPerfil } from '../../contexts/AuthContext';

interface InviteToken {
  nome: string;
  email: string;
  matricula: string;
  perfil: UserPerfil;
  loja: string;
  tempSenha: string;
}

const PERFIL_LABEL: Record<UserPerfil, string> = {
  admin: 'Administrador',
  gerente: 'Gerente',
  caixa: 'Operador de Caixa',
  garcom: 'Garçom',
  cozinha: 'Cozinha / KDS',
  gestor_entregas: 'Gestor de Entregas',
  totem: 'Totem',
};

const PERFIL_ROTA: Record<UserPerfil, string> = {
  admin: '/dashboard',
  gerente: '/dashboard',
  caixa: '/pdv/caixa',
  garcom: '/pdv/garcom',
  cozinha: '/kds',
  gestor_entregas: '/gestor-entregas',
  totem: '/autoatendimento',
};

const PERFIL_COLOR: Record<UserPerfil, string> = {
  admin: 'text-red-600 bg-red-50',
  gerente: 'text-violet-600 bg-violet-50',
  caixa: 'text-amber-600 bg-amber-50',
  garcom: 'text-emerald-600 bg-emerald-50',
  cozinha: 'text-sky-600 bg-sky-50',
  gestor_entregas: 'text-orange-600 bg-orange-50',
  totem: 'text-orange-600 bg-orange-50',
};

function decodeToken(token: string): InviteToken | null {
  try {
    return JSON.parse(atob(token)) as InviteToken;
  } catch {
    return null;
  }
}

export default function InvitePage() {
  const [searchParams] = useSearchParams();
  const { login, saveDynamicUser, isAuthenticated } = useAuth();
  const navigate = useNavigate();

  const tokenRaw = searchParams.get('t');
  const [tokenData] = useState<InviteToken | null>(tokenRaw ? decodeToken(tokenRaw) : null);

  const [senha, setSenha] = useState(tokenData?.tempSenha ?? '');
  const [showSenha, setShowSenha] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (isAuthenticated) navigate('/dashboard', { replace: true });
  }, [isAuthenticated, navigate]);

  if (!tokenData) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-50">
        <div className="max-w-sm w-full mx-4 text-center">
          <div className="w-16 h-16 flex items-center justify-center bg-red-50 rounded-2xl mx-auto mb-4">
            <AlertCircle size={28} className="text-red-500" />
          </div>
          <h1 className="text-xl font-black text-zinc-900 mb-2">Link inválido</h1>
          <p className="text-sm text-zinc-500 mb-6">
            Este link de convite é inválido ou já expirou. Solicite um novo link ao administrador.
          </p>
          <button
            onClick={() => navigate('/login')}
            className="px-6 py-2.5 bg-zinc-900 text-white text-sm font-bold rounded-xl hover:bg-zinc-800 cursor-pointer whitespace-nowrap"
          >
            Ir para o login
          </button>
        </div>
      </div>
    );
  }

  const handleEntrar = async () => {
    setError('');
    if (!senha.trim()) { setError('Digite sua senha.'); return; }
    setLoading(true);

    // Register in dynamic users if not exists
    saveDynamicUser({
      nome: tokenData.nome,
      email: tokenData.email,
      matricula: tokenData.matricula,
      senha,
      perfil: tokenData.perfil,
      loja: tokenData.loja,
      modoTreino: false,
    });

    const ok = await login(tokenData.email, senha);
    setLoading(false);
    if (ok) {
      setSuccess(true);
      setTimeout(() => navigate(PERFIL_ROTA[tokenData.perfil], { replace: true }), 1200);
    } else {
      setError('Senha incorreta. Verifique com o administrador.');
    }
  };

  const perfilStyle = PERFIL_COLOR[tokenData.perfil];

  return (
    <div className="min-h-screen flex font-sans">
      {/* Left panel */}
      <div className="hidden lg:flex lg:w-1/2 relative overflow-hidden">
        <img
          src="https://readdy.ai/api/search-image?query=professional%20restaurant%20kitchen%20team%20working%20together%2C%20warm%20lighting%2C%20chef%20preparing%20food%2C%20teamwork%20in%20commercial%20kitchen%2C%20soft%20bokeh%20background%20with%20amber%20tones%2C%20inviting%20atmosphere&width=800&height=1200&seq=invite-bg-01&orientation=portrait"
          alt="Restaurante"
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
              Você foi convidado<br />para a equipe!
            </h2>
            <p className="text-zinc-300 text-sm leading-relaxed">
              Acesse o sistema com suas credenciais e comece a operar.
            </p>
          </div>
        </div>
      </div>

      {/* Right panel */}
      <div className="flex-1 flex items-center justify-center bg-white px-6 py-12">
        <div className="w-full max-w-sm">
          <div className="flex items-center gap-3 mb-8 lg:hidden">
            <div className="w-9 h-9 flex items-center justify-center bg-amber-500 rounded-xl">
              <ChefHat size={18} className="text-zinc-950" />
            </div>
            <span className="text-zinc-900 font-bold text-lg">ERPOS V2</span>
          </div>

          {success ? (
            <div className="flex flex-col items-center text-center py-8">
              <div className="w-16 h-16 flex items-center justify-center bg-emerald-100 rounded-2xl mb-4">
                <CheckCircle size={28} className="text-emerald-600" />
              </div>
              <h2 className="text-xl font-black text-zinc-900 mb-2">Bem-vindo, {tokenData.nome.split(' ')[0]}!</h2>
              <p className="text-sm text-zinc-500">Entrando no sistema...</p>
            </div>
          ) : (
            <>
              <div className="mb-7">
                <h1 className="text-2xl font-bold text-zinc-900 mb-1">Bem-vindo!</h1>
                <p className="text-sm text-zinc-500">Você foi convidado para acessar o sistema.</p>
              </div>

              {/* User card */}
              <div className="p-4 bg-zinc-50 rounded-2xl border border-zinc-100 mb-6">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-11 h-11 flex items-center justify-center bg-amber-100 rounded-full font-black text-amber-700 text-base flex-shrink-0">
                    {tokenData.nome.split(' ').map((n) => n[0]).slice(0, 2).join('')}
                  </div>
                  <div>
                    <p className="text-sm font-bold text-zinc-900">{tokenData.nome}</p>
                    <p className="text-xs text-zinc-500">{tokenData.email}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full ${perfilStyle}`}>
                    {PERFIL_LABEL[tokenData.perfil]}
                  </span>
                  <span className="text-[10px] text-zinc-400 font-semibold flex items-center gap-1">
                    <i className="ri-store-line" />
                    {tokenData.loja}
                  </span>
                  <span className="text-[10px] text-zinc-400 font-semibold flex items-center gap-1">
                    <i className="ri-id-card-line" />
                    Matrícula: {tokenData.matricula}
                  </span>
                </div>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-zinc-600 mb-1.5">Senha de acesso</label>
                  <div className="relative">
                    <input
                      type={showSenha ? 'text' : 'password'}
                      value={senha}
                      onChange={(e) => setSenha(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleEntrar()}
                      placeholder="Digite a senha fornecida pelo administrador"
                      className="w-full px-3.5 py-2.5 text-sm border border-zinc-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent transition-all pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowSenha((v) => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 cursor-pointer text-zinc-400 hover:text-zinc-600 w-5 h-5 flex items-center justify-center"
                    >
                      {showSenha ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                </div>

                {error && (
                  <div className="flex items-center gap-2 px-3 py-2.5 bg-red-50 border border-red-100 rounded-xl">
                    <AlertCircle size={14} className="text-red-500 flex-shrink-0" />
                    <p className="text-xs text-red-600">{error}</p>
                  </div>
                )}

                <button
                  onClick={handleEntrar}
                  disabled={loading}
                  className="w-full bg-amber-500 hover:bg-amber-600 disabled:opacity-60 text-zinc-950 font-bold py-3 rounded-xl transition-colors cursor-pointer whitespace-nowrap text-sm"
                >
                  {loading ? 'Entrando...' : 'Entrar no sistema'}
                </button>
              </div>

              <div className="mt-6 p-3.5 bg-zinc-50 rounded-xl border border-zinc-100">
                <p className="text-xs text-zinc-500">
                  <strong>Primeira vez?</strong> Use a senha que o administrador da{' '}
                  <span className="font-semibold text-zinc-700">{tokenData.loja}</span>{' '}
                  enviou junto com este link.
                </p>
              </div>

              <div className="mt-4 text-center">
                <button
                  onClick={() => navigate('/login')}
                  className="text-xs text-zinc-400 hover:text-zinc-600 cursor-pointer underline underline-offset-2"
                >
                  Já tenho login, ir para a tela padrão
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
