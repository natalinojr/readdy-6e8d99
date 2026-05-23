import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { supabase } from '@/lib/supabase';

export interface ContaExistenteData {
  mode: 'new' | 'existing';
  nome: string;
  email: string;
  matricula: string;
  senha: string;
  existingUserId?: string;
}

interface StepContaExistenteProps {
  data: ContaExistenteData;
  onNext: (data: ContaExistenteData) => void;
  onBack: () => void;
}

export default function StepContaExistente({ data, onNext, onBack }: StepContaExistenteProps) {
  const [subStep, setSubStep] = useState<'choice' | 'create' | 'login'>(
    data.mode === 'new' && data.nome ? 'create' : data.mode === 'existing' ? 'login' : 'choice'
  );

  // Create new account state
  const [nome, setNome] = useState(data.nome);
  const [email, setEmail] = useState(data.email);
  const [senha, setSenha] = useState(data.senha);
  const [confirmar, setConfirmar] = useState(data.senha);
  const [showSenha, setShowSenha] = useState(false);

  // Login existing account state
  const [loginEmail, setLoginEmail] = useState(data.email);
  const [loginSenha, setLoginSenha] = useState('');
  const [showLoginSenha, setShowLoginSenha] = useState(false);
  const [loggingIn, setLoggingIn] = useState(false);

  const [erros, setErros] = useState<Record<string, string>>();

  const matriculaGerada = '0001';

  const validarCreate = () => {
    const e: Record<string, string> = {};
    if (!nome.trim()) e.nome = 'Nome obrigatório';
    if (!email.includes('@')) e.email = 'E-mail inválido';
    if (senha.length < 6) e.senha = 'Mínimo 6 caracteres';
    if (senha !== confirmar) e.confirmar = 'Senhas não coincidem';
    return e;
  };

  const handleCreateNext = () => {
    const e = validarCreate();
    if (Object.keys(e).length) { setErros(e); return; }
    onNext({ mode: 'new', nome, email, matricula: matriculaGerada, senha });
  };

  const handleLogin = async () => {
    const e: Record<string, string> = {};
    if (!loginEmail.includes('@')) e.loginEmail = 'E-mail inválido';
    if (loginSenha.length < 1) e.loginSenha = 'Senha obrigatória';
    if (Object.keys(e).length) { setErros(e); return; }

    setLoggingIn(true);
    setErros({});

    const { data: authData, error } = await supabase.auth.signInWithPassword({
      email: loginEmail,
      password: loginSenha,
    });

    if (error || !authData.user) {
      setErros({ loginGlobal: error?.message ?? 'E-mail ou senha incorretos' });
      setLoggingIn(false);
      return;
    }

    // Success
    onNext({
      mode: 'existing',
      nome: authData.user.user_metadata?.name ?? '',
      email: loginEmail,
      matricula: matriculaGerada,
      senha: loginSenha,
      existingUserId: authData.user.id,
    });
  };

  if (subStep === 'choice') {
    return (
      <div className="space-y-5">
        <div>
          <h2 className="text-xl font-black text-zinc-900 mb-1">Você já tem uma conta?</h2>
          <p className="text-sm text-zinc-500">Escolha como deseja prosseguir com a criação da nova loja.</p>
        </div>

        <div className="space-y-3">
          <button
            onClick={() => setSubStep('create')}
            className="w-full flex items-center gap-4 p-4 bg-white border-2 border-zinc-100 hover:border-amber-400 rounded-2xl transition-all cursor-pointer text-left group"
          >
            <div className="w-12 h-12 flex items-center justify-center bg-amber-50 rounded-xl group-hover:bg-amber-100 transition-colors">
              <i className="ri-user-add-line text-xl text-amber-600" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-bold text-zinc-800">Não, quero criar uma conta nova</p>
              <p className="text-xs text-zinc-400 mt-0.5">Criar administrador e nova loja</p>
            </div>
            <div className="w-5 h-5 flex items-center justify-center">
              <i className="ri-arrow-right-line text-zinc-300 group-hover:text-amber-500" />
            </div>
          </button>

          <button
            onClick={() => setSubStep('login')}
            className="w-full flex items-center gap-4 p-4 bg-white border-2 border-zinc-100 hover:border-emerald-400 rounded-2xl transition-all cursor-pointer text-left group"
          >
            <div className="w-12 h-12 flex items-center justify-center bg-emerald-50 rounded-xl group-hover:bg-emerald-100 transition-colors">
              <i className="ri-login-circle-line text-xl text-emerald-600" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-bold text-zinc-800">Sim, já tenho conta</p>
              <p className="text-xs text-zinc-400 mt-0.5">Fazer login e adicionar nova loja</p>
            </div>
            <div className="w-5 h-5 flex items-center justify-center">
              <i className="ri-arrow-right-line text-zinc-300 group-hover:text-emerald-500" />
            </div>
          </button>
        </div>

        <div className="flex gap-3 pt-2">
          <button onClick={onBack} className="px-5 py-2.5 text-sm font-semibold text-zinc-600 bg-zinc-100 rounded-xl hover:bg-zinc-200 cursor-pointer whitespace-nowrap">
            Voltar
          </button>
        </div>
      </div>
    );
  }

  if (subStep === 'create') {
    return (
      <div className="space-y-5">
        <div>
          <button
            onClick={() => setSubStep('choice')}
            className="flex items-center gap-1.5 text-xs font-semibold text-zinc-400 hover:text-zinc-600 mb-3 cursor-pointer whitespace-nowrap"
          >
            <div className="w-4 h-4 flex items-center justify-center">
              <i className="ri-arrow-left-line text-sm" />
            </div>
            Voltar
          </button>
          <h2 className="text-xl font-black text-zinc-900 mb-1">Criar sua conta de administrador</h2>
          <p className="text-sm text-zinc-500">Você terá acesso total ao sistema.</p>
        </div>

        {/* Nome */}
        <div>
          <label className="block text-xs font-semibold text-zinc-600 mb-1.5">Nome completo</label>
          <input
            type="text"
            value={nome}
            onChange={(e) => { setNome(e.target.value); setErros((p) => ({ ...p, nome: '' })); }}
            placeholder="Ex: João da Silva"
            className={`w-full text-sm border rounded-xl px-3.5 py-2.5 text-zinc-800 focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent transition-all ${erros.nome ? 'border-red-300 bg-red-50' : 'border-zinc-200'}`}
          />
          {erros.nome && <p className="text-xs text-red-500 mt-1">{erros.nome}</p>}
        </div>

        {/* Email */}
        <div>
          <label className="block text-xs font-semibold text-zinc-600 mb-1.5">E-mail de acesso</label>
          <input
            type="email"
            value={email}
            onChange={(e) => { setEmail(e.target.value); setErros((p) => ({ ...p, email: '' })); }}
            placeholder="seu@email.com.br"
            className={`w-full text-sm border rounded-xl px-3.5 py-2.5 text-zinc-800 focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent transition-all ${erros.email ? 'border-red-300 bg-red-50' : 'border-zinc-200'}`}
          />
          {erros.email && <p className="text-xs text-red-500 mt-1">{erros.email}</p>}
        </div>

        {/* Matrícula */}
        <div>
          <label className="block text-xs font-semibold text-zinc-600 mb-1.5">Matrícula</label>
          <div className="flex items-center gap-2">
            <div className="flex-1 relative">
              <input
                readOnly
                value={matriculaGerada}
                className="w-full text-sm border border-zinc-200 rounded-xl px-3.5 py-2.5 text-zinc-500 bg-zinc-50 cursor-default font-mono font-bold tracking-widest"
              />
              <div className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 flex items-center justify-center">
                <i className="ri-lock-line text-zinc-400 text-sm" />
              </div>
            </div>
            <span className="text-[10px] font-bold px-2.5 py-1.5 bg-amber-50 text-amber-600 rounded-lg border border-amber-100 whitespace-nowrap">
              Gerado pelo sistema
            </span>
          </div>
          <p className="text-xs text-zinc-400 mt-1">
            A matrícula é atribuída automaticamente em sequência numérica. Usada no login rápido.
          </p>
        </div>

        {/* Senha + Confirmar */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-zinc-600 mb-1.5">Senha</label>
            <div className="relative">
              <input
                type={showSenha ? 'text' : 'password'}
                value={senha}
                onChange={(e) => { setSenha(e.target.value); setErros((p) => ({ ...p, senha: '' })); }}
                placeholder="Mínimo 6 caracteres"
                className={`w-full text-sm border rounded-xl px-3.5 py-2.5 pr-10 text-zinc-800 focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent transition-all ${erros.senha ? 'border-red-300 bg-red-50' : 'border-zinc-200'}`}
              />
              <button
                type="button"
                onClick={() => setShowSenha((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 cursor-pointer w-5 h-5 flex items-center justify-center"
              >
                {showSenha ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
            {erros.senha && <p className="text-xs text-red-500 mt-1">{erros.senha}</p>}
          </div>
          <div>
            <label className="block text-xs font-semibold text-zinc-600 mb-1.5">Confirmar senha</label>
            <input
              type={showSenha ? 'text' : 'password'}
              value={confirmar}
              onChange={(e) => { setConfirmar(e.target.value); setErros((p) => ({ ...p, confirmar: '' })); }}
              placeholder="••••••••"
              className={`w-full text-sm border rounded-xl px-3.5 py-2.5 text-zinc-800 focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent transition-all ${erros.confirmar ? 'border-red-300 bg-red-50' : 'border-zinc-200'}`}
            />
            {erros.confirmar && <p className="text-xs text-red-500 mt-1">{erros.confirmar}</p>}
          </div>
        </div>

        <div className="flex gap-3 pt-2">
          <button onClick={() => setSubStep('choice')} className="px-5 py-2.5 text-sm font-semibold text-zinc-600 bg-zinc-100 rounded-xl hover:bg-zinc-200 cursor-pointer whitespace-nowrap">
            Voltar
          </button>
          <button onClick={handleCreateNext} className="flex-1 py-2.5 text-sm font-bold text-white bg-amber-500 rounded-xl hover:bg-amber-600 cursor-pointer whitespace-nowrap">
            Continuar
          </button>
        </div>
      </div>
    );
  }

  // subStep === 'login'
  return (
    <div className="space-y-5">
      <div>
        <button
          onClick={() => setSubStep('choice')}
          className="flex items-center gap-1.5 text-xs font-semibold text-zinc-400 hover:text-zinc-600 mb-3 cursor-pointer whitespace-nowrap"
        >
          <div className="w-4 h-4 flex items-center justify-center">
            <i className="ri-arrow-left-line text-sm" />
          </div>
          Voltar
        </button>
        <h2 className="text-xl font-black text-zinc-900 mb-1">Fazer login na sua conta</h2>
        <p className="text-sm text-zinc-500">Entre com o e-mail e senha da sua conta existente.</p>
      </div>

      {erros.loginGlobal && (
        <div className="flex items-center gap-2 px-3 py-2.5 bg-red-50 border border-red-200 rounded-xl">
          <div className="w-4 h-4 flex items-center justify-center flex-shrink-0">
            <i className="ri-error-warning-line text-red-500 text-sm" />
          </div>
          <p className="text-xs text-red-600 font-medium">{erros.loginGlobal}</p>
        </div>
      )}

      <div>
        <label className="block text-xs font-semibold text-zinc-600 mb-1.5">E-mail</label>
        <input
          type="email"
          value={loginEmail}
          onChange={(e) => { setLoginEmail(e.target.value); setErros((p) => ({ ...p, loginEmail: '', loginGlobal: '' })); }}
          placeholder="seu@email.com.br"
          className={`w-full text-sm border rounded-xl px-3.5 py-2.5 text-zinc-800 focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:border-transparent transition-all ${erros.loginEmail ? 'border-red-300 bg-red-50' : 'border-zinc-200'}`}
        />
        {erros.loginEmail && <p className="text-xs text-red-500 mt-1">{erros.loginEmail}</p>}
      </div>

      <div>
        <label className="block text-xs font-semibold text-zinc-600 mb-1.5">Senha</label>
        <div className="relative">
          <input
            type={showLoginSenha ? 'text' : 'password'}
            value={loginSenha}
            onChange={(e) => { setLoginSenha(e.target.value); setErros((p) => ({ ...p, loginSenha: '', loginGlobal: '' })); }}
            placeholder="••••••••"
            className={`w-full text-sm border rounded-xl px-3.5 py-2.5 pr-10 text-zinc-800 focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:border-transparent transition-all ${erros.loginSenha ? 'border-red-300 bg-red-50' : 'border-zinc-200'}`}
          />
          <button
            type="button"
            onClick={() => setShowLoginSenha((v) => !v)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 cursor-pointer w-5 h-5 flex items-center justify-center"
          >
            {showLoginSenha ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        </div>
        {erros.loginSenha && <p className="text-xs text-red-500 mt-1">{erros.loginSenha}</p>}
      </div>

      <div className="flex gap-3 pt-2">
        <button onClick={() => setSubStep('choice')} className="px-5 py-2.5 text-sm font-semibold text-zinc-600 bg-zinc-100 rounded-xl hover:bg-zinc-200 cursor-pointer whitespace-nowrap">
          Voltar
        </button>
        <button
          onClick={handleLogin}
          disabled={loggingIn}
          className="flex-1 py-2.5 text-sm font-bold text-white bg-emerald-500 rounded-xl hover:bg-emerald-600 disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer whitespace-nowrap flex items-center justify-center gap-2"
        >
          {loggingIn && <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
          {loggingIn ? 'Entrando...' : 'Entrar e continuar'}
        </button>
      </div>
    </div>
  );
}