import { useState, useRef, useEffect } from 'react';
import { supabase } from '@/lib/supabase';

/**
 * Modal de autorização — solicita credenciais de um gerente ou admin
 * para liberar ações restritas (ex: cancelamento de pedido).
 *
 * Estratégia de verificação:
 *  1. Tenta login-pin (matrícula + PIN) — para usuários de cozinha/garçom
 *  2. Tenta signInWithPassword (e-mail + senha) — para gerentes/admins que usam email
 *  Em ambos os casos, verificamos apenas a validade das credenciais SEM fazer logout
 *  do usuário atual (usamos uma chamada direta ao supabase que não altera a sessão ativa).
 */

export type NivelAutorizacao = 'gerente' | 'admin';

interface Props {
  titulo?: string;
  descricao?: string;
  niveisPermitidos?: NivelAutorizacao[];  // padrão: ['gerente', 'admin']
  tenantId: string;
  onAutorizado: (autorizadoPor: string) => void;
  onCancelar: () => void;
}

type Modo = 'pin' | 'email';

export default function AutorizacaoGerenteModal({
  titulo = 'Autorização Necessária',
  descricao = 'Esta ação requer autorização de um gerente ou administrador.',
  niveisPermitidos = ['gerente', 'admin'],
  tenantId,
  onAutorizado,
  onCancelar,
}: Props) {
  const [modo, setModo] = useState<Modo>('pin');
  const [matricula, setMatricula] = useState('');
  const [senha, setSenha] = useState('');
  const [email, setEmail] = useState('');
  const [senhaEmail, setSenhaEmail] = useState('');
  const [verificando, setVerificando] = useState(false);
  const [erro, setErro] = useState('');
  const [tentativas, setTentativas] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 80);
  }, [modo]);

  const MAX_TENTATIVAS = 5;
  const bloqueado = tentativas >= MAX_TENTATIVAS;

  const limparErro = () => setErro('');

  /* ── Verificação via PIN (matrícula + PIN numérico) ── */
  const verificarPin = async () => {
    if (!matricula.trim() || !senha.trim()) {
      setErro('Informe matrícula e PIN.');
      return;
    }
    if (!/^\d+$/.test(matricula.trim())) {
      setErro('Matrícula deve conter apenas números.');
      return;
    }

    setVerificando(true);
    setErro('');

    try {
      // Chama login-pin para obter o hashed_token sem consumir sessão
      const { data, error: fnError } = await supabase.functions.invoke<{
        hashed_token?: string;
        role?: string;
        name?: string;
        tenant_id?: string;
        error?: string;
      }>('login-pin', {
        body: {
          badge_number: matricula.trim(),
          pin: senha.trim(),
          verify_only: true,   // flag para edge function apenas verificar sem gerar sessão
        },
      });

      if (fnError || !data || data.error) {
        throw new Error(data?.error ?? 'Credenciais inválidas.');
      }

      // Verificar tenant correto
      if (data.tenant_id && data.tenant_id !== tenantId) {
        throw new Error('Usuário não pertence a este estabelecimento.');
      }

      // Verificar nível de acesso
      const roleMapa: Record<string, NivelAutorizacao> = {
        admin: 'admin',
        manager: 'gerente',
      };
      const nivelUsuario = roleMapa[data.role ?? ''];

      if (!nivelUsuario || !niveisPermitidos.includes(nivelUsuario)) {
        throw new Error('Usuário não tem permissão para esta ação.\nApenas gerentes ou administradores podem autorizar.');
      }

      onAutorizado(data.name ?? matricula.trim());
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Credenciais inválidas.';
      setErro(msg);
      setTentativas((t) => t + 1);
    } finally {
      setVerificando(false);
    }
  };

  /* ── Verificação via E-mail + Senha ── */
  const verificarEmail = async () => {
    if (!email.trim() || !senhaEmail.trim()) {
      setErro('Informe e-mail e senha.');
      return;
    }

    setVerificando(true);
    setErro('');

    try {
      // Verificamos via RPC dedicada que não altera a sessão atual do usuário
      const { data, error: rpcError } = await supabase.rpc('verify_manager_credentials', {
        p_email: email.trim().toLowerCase(),
        p_password: senhaEmail.trim(),
        p_tenant_id: tenantId,
      });

      if (rpcError || !data) {
        throw new Error('Credenciais inválidas ou usuário não encontrado.');
      }

      const nivelUsuario = (data as { role?: string; name?: string }).role;
      const nomeUsuario = (data as { role?: string; name?: string }).name ?? email;

      const roleMapa: Record<string, NivelAutorizacao> = {
        admin: 'admin',
        manager: 'gerente',
      };
      const nivelFrontend = roleMapa[nivelUsuario ?? ''];

      if (!nivelFrontend || !niveisPermitidos.includes(nivelFrontend)) {
        throw new Error('Usuário não tem permissão para esta ação.\nApenas gerentes ou administradores podem autorizar.');
      }

      onAutorizado(nomeUsuario);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Credenciais inválidas.';
      setErro(msg);
      setTentativas((t) => t + 1);
    } finally {
      setVerificando(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (bloqueado || verificando) return;
    if (modo === 'pin') verificarPin();
    else verificarEmail();
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="bg-amber-50 border-b border-amber-100 px-5 py-4 flex items-center gap-3">
          <div className="w-10 h-10 flex items-center justify-center rounded-xl bg-amber-100 flex-shrink-0">
            <i className="ri-shield-keyhole-line text-amber-600 text-xl" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-black text-amber-800 leading-none">{titulo}</h2>
            <p className="text-xs text-amber-600 mt-0.5 leading-snug">{descricao}</p>
          </div>
          <button
            onClick={onCancelar}
            className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-amber-100 text-amber-400 cursor-pointer transition-colors flex-shrink-0"
          >
            <i className="ri-close-line text-base" />
          </button>
        </div>

        {/* Modo tabs */}
        <div className="flex border-b border-zinc-100 px-4 pt-3">
          <button
            onClick={() => { setModo('pin'); limparErro(); }}
            className={`flex-1 pb-2.5 text-xs font-bold border-b-2 transition-colors cursor-pointer ${
              modo === 'pin' ? 'border-amber-500 text-amber-600' : 'border-transparent text-zinc-400 hover:text-zinc-600'
            }`}
          >
            <i className="ri-id-card-line mr-1" />
            Matrícula + PIN
          </button>
          <button
            onClick={() => { setModo('email'); limparErro(); }}
            className={`flex-1 pb-2.5 text-xs font-bold border-b-2 transition-colors cursor-pointer ${
              modo === 'email' ? 'border-amber-500 text-amber-600' : 'border-transparent text-zinc-400 hover:text-zinc-600'
            }`}
          >
            <i className="ri-mail-line mr-1" />
            E-mail + Senha
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-3">

          {modo === 'pin' ? (
            <>
              <div>
                <label className="block text-[11px] font-bold text-zinc-500 uppercase tracking-wider mb-1.5">
                  Matrícula (gerente/admin)
                </label>
                <input
                  ref={inputRef}
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={matricula}
                  onChange={(e) => { setMatricula(e.target.value); limparErro(); }}
                  placeholder="Ex: 1001"
                  disabled={bloqueado || verificando}
                  className="w-full border border-zinc-200 rounded-xl px-3 py-2.5 text-sm text-zinc-800 focus:outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100 disabled:bg-zinc-50 disabled:text-zinc-400 tabular-nums"
                  maxLength={8}
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-zinc-500 uppercase tracking-wider mb-1.5">
                  PIN
                </label>
                <input
                  type="password"
                  inputMode="numeric"
                  value={senha}
                  onChange={(e) => { setSenha(e.target.value); limparErro(); }}
                  onKeyDown={(e) => e.key === 'Enter' && handleSubmit(e as unknown as React.FormEvent)}
                  placeholder="••••••"
                  disabled={bloqueado || verificando}
                  className="w-full border border-zinc-200 rounded-xl px-3 py-2.5 text-sm text-zinc-800 focus:outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100 disabled:bg-zinc-50 disabled:text-zinc-400 tracking-widest"
                  maxLength={8}
                />
              </div>
            </>
          ) : (
            <>
              <div>
                <label className="block text-[11px] font-bold text-zinc-500 uppercase tracking-wider mb-1.5">
                  E-mail (gerente/admin)
                </label>
                <input
                  ref={inputRef}
                  type="email"
                  value={email}
                  onChange={(e) => { setEmail(e.target.value); limparErro(); }}
                  placeholder="gerente@restaurante.com"
                  disabled={bloqueado || verificando}
                  className="w-full border border-zinc-200 rounded-xl px-3 py-2.5 text-sm text-zinc-800 focus:outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100 disabled:bg-zinc-50 disabled:text-zinc-400"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-zinc-500 uppercase tracking-wider mb-1.5">
                  Senha
                </label>
                <input
                  type="password"
                  value={senhaEmail}
                  onChange={(e) => { setSenhaEmail(e.target.value); limparErro(); }}
                  onKeyDown={(e) => e.key === 'Enter' && handleSubmit(e as unknown as React.FormEvent)}
                  placeholder="••••••••"
                  disabled={bloqueado || verificando}
                  className="w-full border border-zinc-200 rounded-xl px-3 py-2.5 text-sm text-zinc-800 focus:outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100 disabled:bg-zinc-50 disabled:text-zinc-400"
                />
              </div>
            </>
          )}

          {/* Erro */}
          {erro && (
            <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-xl">
              <i className="ri-error-warning-line text-red-500 text-sm flex-shrink-0 mt-0.5" />
              <p className="text-xs text-red-700 font-medium leading-snug whitespace-pre-line">{erro}</p>
            </div>
          )}

          {/* Tentativas restantes */}
          {tentativas > 0 && !bloqueado && (
            <p className="text-[10px] text-zinc-400 text-center">
              {MAX_TENTATIVAS - tentativas} tentativa{MAX_TENTATIVAS - tentativas !== 1 ? 's' : ''} restante{MAX_TENTATIVAS - tentativas !== 1 ? 's' : ''}
            </p>
          )}

          {/* Bloqueado */}
          {bloqueado && (
            <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-xl">
              <i className="ri-lock-fill text-red-500 text-sm flex-shrink-0 mt-0.5" />
              <p className="text-xs text-red-700 font-medium">
                Muitas tentativas incorretas. Entre em contato com o administrador.
              </p>
            </div>
          )}

          {/* Botões */}
          <div className="flex gap-2.5 pt-1">
            <button
              type="button"
              onClick={onCancelar}
              disabled={verificando}
              className="flex-1 py-2.5 border border-zinc-200 text-zinc-600 text-sm font-semibold rounded-xl cursor-pointer hover:bg-zinc-50 transition-colors whitespace-nowrap disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={bloqueado || verificando}
              className={`flex-1 py-2.5 text-sm font-bold rounded-xl whitespace-nowrap transition-colors flex items-center justify-center gap-2 ${
                bloqueado || verificando
                  ? 'bg-zinc-100 text-zinc-400 cursor-not-allowed'
                  : 'bg-amber-500 hover:bg-amber-600 text-white cursor-pointer'
              }`}
            >
              {verificando ? (
                <><i className="ri-loader-4-line animate-spin text-sm" />Verificando...</>
              ) : (
                <><i className="ri-shield-check-line text-sm" />Autorizar</>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
