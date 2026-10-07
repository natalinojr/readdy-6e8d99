// Primeiro acesso de quem foi convidado (convite do Supabase) ou recebeu um link de acesso: cria a senha.
// O link do convite (Edge nfse-write) traz ?token_hash=…&type=invite|recovery: a página troca pela sessão
// com verifyOtp (só ao abrir no navegador; pré-visualização de link não queima o token). Links no formato
// antigo do Supabase (#access_token…) também valem: main.tsx manda para cá e o detectSessionInUrl lê.
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

const hashInicial = typeof window !== 'undefined' ? window.location.hash : '';
const erroDoLink = (() => {
  const p = new URLSearchParams(hashInicial.replace(/^#/, ''));
  return p.get('error_code') || p.get('error') ? (p.get('error_description') ?? 'link inválido') : null;
})();

// Troca o token pela sessão uma vez só (o StrictMode roda o efeito duas vezes; o token só vale uma).
let trocaToken: Promise<string | null> | null = null;
function trocarToken(): Promise<string | null> | null {
  if (trocaToken) return trocaToken;
  const q = new URLSearchParams(window.location.search);
  const tokenHash = q.get('token_hash');
  const tipo = q.get('type');
  if (!tokenHash || (tipo !== 'invite' && tipo !== 'recovery')) return null;
  window.history.replaceState(null, '', '/definir-senha');
  trocaToken = supabase.auth.verifyOtp({ token_hash: tokenHash, type: tipo })
    .then(({ data, error }) => (error ? null : data.user?.email ?? data.session?.user?.email ?? null));
  return trocaToken;
}

export default function DefinirSenhaPage() {
  const [email, setEmail] = useState<string | null>(null);
  const [verificando, setVerificando] = useState(true);
  const [senha, setSenha] = useState('');
  const [confirma, setConfirma] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    let vivo = true;
    const marcar = (e: string | null | undefined) => { if (vivo && e) { setEmail(e); setVerificando(false); } };
    const troca = trocarToken();
    if (troca) {
      // Com token, só vale a conta do token: uma sessão que já estava aberta neste navegador (de outra
      // pessoa) não pode aparecer aqui, senão a senha nova iria para ela.
      troca.then((e) => { if (!vivo) return; if (e) marcar(e); else setVerificando(false); });
      return () => { vivo = false; };
    }
    const { data: sub } = supabase.auth.onAuthStateChange((_ev, s) => marcar(s?.user?.email));
    supabase.auth.getSession().then(({ data }) => marcar(data.session?.user?.email));
    // Sem sessão depois de alguns segundos: link vencido, já usado ou aberto sem o hash.
    const t = setTimeout(() => { if (vivo) setVerificando(false); }, 8000);
    return () => { vivo = false; clearTimeout(t); sub.subscription.unsubscribe(); };
  }, []);

  const salvar = async () => {
    setErro(null);
    if (senha.length < 8) { setErro('A senha precisa ter pelo menos 8 caracteres.'); return; }
    if (senha !== confirma) { setErro('As duas senhas não são iguais.'); return; }
    setSalvando(true);
    const { error } = await supabase.auth.updateUser({ password: senha });
    setSalvando(false);
    if (error) { setErro(error.message); return; }
    // Recarrega para o AuthContext montar a sessão do zero.
    window.location.replace('/notas-servico');
  };

  return (
    <div className="min-h-screen bg-zinc-50 flex items-center justify-center px-4 py-10 font-sans">
      <div className="w-full max-w-sm bg-white rounded-2xl border border-zinc-200 p-6 shadow-sm">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 flex items-center justify-center bg-amber-500 rounded-xl">
            <i className="ri-lock-password-line text-xl text-white" />
          </div>
          <div>
            <h1 className="text-lg font-black text-zinc-900">Criar sua senha</h1>
            <p className="text-xs text-zinc-400">ERPOS</p>
          </div>
        </div>

        {verificando ? (
          <p className="text-sm text-zinc-500">Conferindo o link…</p>
        ) : !email ? (
          <div className="space-y-3">
            <p className="text-sm text-zinc-700 font-semibold">Este link não vale mais.</p>
            <p className="text-sm text-zinc-500">
              Ele vence depois de um tempo e só pode ser usado uma vez{erroDoLink ? ` (${erroDoLink})` : ''}.
              Peça um link novo a quem incluiu você no sistema.
            </p>
            <a href="/login" className="inline-block text-sm font-bold text-amber-600 hover:text-amber-700">Já tenho senha → Entrar</a>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-zinc-500">Conta: <b className="text-zinc-800">{email}</b></p>
            <div>
              <label className="block text-xs font-semibold text-zinc-500 mb-1">Nova senha</label>
              <input type="password" autoComplete="new-password" value={senha} onChange={(e) => setSenha(e.target.value)}
                className="w-full h-11 px-3 rounded-xl border border-zinc-200 text-sm focus:outline-none focus:border-amber-400" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-zinc-500 mb-1">Repita a senha</label>
              <input type="password" autoComplete="new-password" value={confirma} onChange={(e) => setConfirma(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') salvar(); }}
                className="w-full h-11 px-3 rounded-xl border border-zinc-200 text-sm focus:outline-none focus:border-amber-400" />
            </div>
            {erro && <p className="text-sm text-red-600">{erro}</p>}
            <button onClick={salvar} disabled={salvando || !senha}
              className="w-full h-11 rounded-xl bg-amber-500 hover:bg-amber-400 text-white text-sm font-bold cursor-pointer disabled:opacity-40">
              {salvando ? 'Salvando…' : 'Salvar e entrar'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
