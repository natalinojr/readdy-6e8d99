import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useKioskAuth } from '@/contexts/KioskAuthContext';

/**
 * Página de entrada do totem standalone.
 * O operador gera um link /totem/:token nas configurações.
 * O tablet abre esse link → autentica automaticamente → redireciona para /autoatendimento.
 */
export default function TotemPage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { authenticateWithToken, error, loading } = useKioskAuth();
  const [status, setStatus] = useState<'authenticating' | 'success' | 'error'>('authenticating');

  useEffect(() => {
    if (!token) {
      setStatus('error');
      return;
    }

    let cancelled = false;

    async function doAuth() {
      const ok = await authenticateWithToken(token!);
      if (cancelled) return;
      if (ok) {
        setStatus('success');
        // Pequeno delay para mostrar feedback visual antes de redirecionar
        setTimeout(() => {
          navigate('/autoatendimento', { replace: true });
        }, 1200);
      } else {
        setStatus('error');
      }
    }

    doAuth();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  return (
    <div className="fixed inset-0 bg-zinc-950 flex flex-col items-center justify-center p-8">
      <div className="text-center max-w-sm">
        {/* Logo / ícone */}
        <div className={`w-20 h-20 flex items-center justify-center rounded-3xl mx-auto mb-6 transition-all duration-500 ${
          status === 'success' ? 'bg-emerald-500' : status === 'error' ? 'bg-red-500/20' : 'bg-amber-500'
        }`}>
          {status === 'authenticating' && (
            <div className="w-8 h-8 border-3 border-zinc-950/30 border-t-zinc-950 rounded-full animate-spin" style={{ borderWidth: 3 }} />
          )}
          {status === 'success' && (
            <i className="ri-check-line text-4xl text-white" />
          )}
          {status === 'error' && (
            <i className="ri-error-warning-line text-4xl text-red-400" />
          )}
        </div>

        {status === 'authenticating' && (
          <>
            <h2 className="text-2xl font-black text-white mb-2">Configurando totem...</h2>
            <p className="text-zinc-500 text-sm">Autenticando com o sistema da loja</p>
            <div className="flex items-center justify-center gap-1.5 mt-6">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="w-2 h-2 rounded-full bg-amber-500 animate-bounce"
                  style={{ animationDelay: `${i * 0.15}s` }}
                />
              ))}
            </div>
          </>
        )}

        {status === 'success' && (
          <>
            <h2 className="text-2xl font-black text-white mb-2">Totem pronto!</h2>
            <p className="text-zinc-400 text-sm">Redirecionando para o autoatendimento...</p>
          </>
        )}

        {status === 'error' && (
          <>
            <h2 className="text-2xl font-black text-white mb-2">Falha na autenticação</h2>
            <p className="text-zinc-400 text-sm mb-4">
              {error ?? 'Token inválido ou revogado. Gere um novo link nas configurações.'}
            </p>
            <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-left">
              <p className="text-xs text-red-400 font-semibold mb-1">O que fazer:</p>
              <ol className="text-xs text-zinc-500 space-y-1 list-decimal list-inside">
                <li>Acesse as Configurações no sistema</li>
                <li>Vá em Operação → Autoatendimento</li>
                <li>Clique em &quot;Gerenciar Totens&quot;</li>
                <li>Gere um novo link para este tablet</li>
              </ol>
            </div>
            <button
              onClick={() => window.location.reload()}
              className="mt-4 px-5 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm font-semibold rounded-xl cursor-pointer transition-colors whitespace-nowrap"
            >
              <i className="ri-refresh-line mr-2" />
              Tentar novamente
            </button>
          </>
        )}
      </div>

      {/* Rodapé */}
      <div className="absolute bottom-6 flex items-center gap-2 text-zinc-700 text-xs">
        <i className="ri-tablet-line" />
        <span>ERPOS — Terminal de Autoatendimento</span>
      </div>
    </div>
  );
}
