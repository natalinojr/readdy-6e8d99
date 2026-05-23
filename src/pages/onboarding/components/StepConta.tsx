import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';

export interface ContaData {
  nome: string;
  email: string;
  matricula: string;
  senha: string;
}

interface StepContaProps {
  data: ContaData;
  onNext: (data: ContaData) => void;
  onBack: () => void;
}

export default function StepConta({ data, onNext, onBack }: StepContaProps) {
  const [nome, setNome] = useState(data.nome);
  const [email, setEmail] = useState(data.email);
  const [senha, setSenha] = useState(data.senha);
  const [confirmar, setConfirmar] = useState(data.senha);
  const [showSenha, setShowSenha] = useState(false);
  const [erros, setErros] = useState<Record<string, string>>({});

  // Matrícula sempre gerada automaticamente como 0001 para o primeiro admin
  const matriculaGerada = '0001';

  const validar = () => {
    const e: Record<string, string> = {};
    if (!nome.trim()) e.nome = 'Nome obrigatório';
    if (!email.includes('@')) e.email = 'E-mail inválido';
    if (senha.length < 6) e.senha = 'Mínimo 6 caracteres';
    if (senha !== confirmar) e.confirmar = 'Senhas não coincidem';
    return e;
  };

  const handleNext = () => {
    const e = validar();
    if (Object.keys(e).length) { setErros(e); return; }
    onNext({ nome, email, matricula: matriculaGerada, senha });
  };

  const field = (
    id: string,
    label: string,
    value: string,
    onChange: (v: string) => void,
    placeholder: string,
    type = 'text',
    rightEl?: React.ReactNode
  ) => (
    <div>
      <label className="block text-xs font-semibold text-zinc-600 mb-1.5">{label}</label>
      <div className="relative">
        <input
          type={type}
          value={value}
          onChange={(e) => { onChange(e.target.value); setErros((prev) => ({ ...prev, [id]: '' })); }}
          placeholder={placeholder}
          className={`w-full text-sm border rounded-xl px-3.5 py-2.5 text-zinc-800 focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent transition-all ${erros[id] ? 'border-red-300 bg-red-50' : 'border-zinc-200'} ${rightEl ? 'pr-10' : ''}`}
        />
        {rightEl && <div className="absolute right-3 top-1/2 -translate-y-1/2">{rightEl}</div>}
      </div>
      {erros[id] && <p className="text-xs text-red-500 mt-1">{erros[id]}</p>}
    </div>
  );

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-black text-zinc-900 mb-1">Criar sua conta de administrador</h2>
        <p className="text-sm text-zinc-500">Você terá acesso total ao sistema.</p>
      </div>

      {field('nome', 'Nome completo', nome, setNome, 'Ex: João da Silva')}
      {field('email', 'E-mail de acesso', email, setEmail, 'seu@email.com.br', 'email')}

      {/* Matrícula — gerada automaticamente */}
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

      <div className="grid grid-cols-2 gap-3">
        {field(
          'senha', 'Senha', senha, setSenha, 'Mínimo 6 caracteres',
          showSenha ? 'text' : 'password',
          <button type="button" onClick={() => setShowSenha((v) => !v)} className="text-zinc-400 hover:text-zinc-600 cursor-pointer w-5 h-5 flex items-center justify-center">
            {showSenha ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        )}
        {field('confirmar', 'Confirmar senha', confirmar, setConfirmar, '••••••••', showSenha ? 'text' : 'password')}
      </div>

      <div className="flex gap-3 pt-2">
        <button onClick={onBack} className="px-5 py-2.5 text-sm font-semibold text-zinc-600 bg-zinc-100 rounded-xl hover:bg-zinc-200 cursor-pointer whitespace-nowrap">
          Voltar
        </button>
        <button onClick={handleNext} className="flex-1 py-2.5 text-sm font-bold text-white bg-amber-500 rounded-xl hover:bg-amber-600 cursor-pointer whitespace-nowrap">
          Continuar
        </button>
      </div>
    </div>
  );
}
