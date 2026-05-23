import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';

// ─── Modal Criar Loja com Código ──────────────────────────────────────────────
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
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full max-w-sm overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-100">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 flex items-center justify-center bg-amber-100 rounded-xl">
              <i className="ri-key-2-line text-amber-600 text-sm" />
            </div>
            <h2 className="text-sm font-black text-zinc-900">Criar minha loja</h2>
          </div>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-zinc-100 cursor-pointer text-zinc-400">
            <i className="ri-close-line text-base" />
          </button>
        </div>
        <div className="px-5 py-5 space-y-4">
          <p className="text-xs text-zinc-500 leading-relaxed">
            Insira o código de convite recebido do administrador para configurar sua loja.
          </p>
          <div>
            <label className="block text-xs font-semibold text-zinc-600 mb-1.5">Código de convite</label>
            <input
              type="text"
              value={codigo}
              onChange={e => setCodigo(e.target.value.toUpperCase())}
              onKeyDown={e => e.key === 'Enter' && handleEntrar()}
              placeholder="Ex: XXXX-XXXX-XXXX"
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

const PERFIL_LABEL: Record<string, string> = {
  admin: 'Administrador',
  gerente: 'Gerente',
  caixa: 'Operador de Caixa',
  garcom: 'Garçom',
  cozinha: 'Operador de Cozinha',
};

const PERFIL_COLOR: Record<string, string> = {
  admin: 'text-red-600 bg-red-50 border-red-100',
  gerente: 'text-violet-600 bg-violet-50 border-violet-100',
  caixa: 'text-amber-600 bg-amber-50 border-amber-100',
  garcom: 'text-emerald-600 bg-emerald-50 border-emerald-100',
  cozinha: 'text-sky-600 bg-sky-50 border-sky-100',
};

export default function PerfilPage() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [showCriarLoja, setShowCriarLoja] = useState(false);

  const [senhaAtual, setSenhaAtual] = useState('');
  const [novaSenha, setNovaSenha] = useState('');
  const [confirmarSenha, setConfirmarSenha] = useState('');
  const [showAtual, setShowAtual] = useState(false);
  const [showNova, setShowNova] = useState(false);
  const [showConfirmar, setShowConfirmar] = useState(false);
  const [sucesso, setSucesso] = useState('');
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [abaSelecionada, setAbaSelecionada] = useState<'perfil' | 'senha'>('perfil');

  if (!user) {
    navigate('/login', { replace: true });
    return null;
  }

  const handleAlterarSenha = async () => {
    setErro('');
    setSucesso('');
    if (!senhaAtual) { setErro('Digite a senha atual.'); return; }
    if (!novaSenha) { setErro('Digite a nova senha.'); return; }
    if (novaSenha.length < 4) { setErro('A nova senha deve ter no mínimo 4 caracteres.'); return; }
    if (novaSenha !== confirmarSenha) { setErro('As senhas não coincidem.'); return; }

    setSalvando(true);
    await new Promise((r) => setTimeout(r, 800));
    setSalvando(false);
    setSucesso('Senha alterada com sucesso!');
    setSenhaAtual('');
    setNovaSenha('');
    setConfirmarSenha('');
  };

  const perfilStyle = PERFIL_COLOR[user.perfil] ?? 'text-zinc-600 bg-zinc-50 border-zinc-100';
  const initials = user.nome.split(' ').map((n) => n[0]).slice(0, 2).join('').toUpperCase();

  return (
    <div className="max-w-2xl mx-auto py-8 px-4">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => navigate(-1)}
          className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-zinc-100 text-zinc-500 cursor-pointer transition-colors"
        >
          <i className="ri-arrow-left-line text-base" />
        </button>
        <div>
          <h1 className="text-lg font-black text-zinc-900">Meu perfil</h1>
          <p className="text-xs text-zinc-400">Informações da conta e segurança</p>
        </div>
      </div>

      {/* Avatar + info */}
      <div className="flex items-center gap-5 p-5 bg-white border border-zinc-100 rounded-2xl mb-5">
        <div className="w-16 h-16 flex items-center justify-center bg-amber-500 rounded-2xl flex-shrink-0">
          <span className="text-xl font-black text-zinc-950">{initials}</span>
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-base font-black text-zinc-900 mb-1">{user.nome}</h2>
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-xs font-bold px-2.5 py-1 rounded-full border ${perfilStyle}`}>
              {PERFIL_LABEL[user.perfil] ?? user.perfil}
            </span>
            <span className="flex items-center gap-1 text-xs text-zinc-400">
              <i className="ri-store-line text-sm" />
              {user.loja}
            </span>
            {user.modoTreino && (
              <span className="flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded-full bg-amber-50 border border-amber-200 text-amber-700">
                <i className="ri-graduation-cap-line" />
                Modo Treino
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-zinc-100 rounded-xl mb-5">
        <button
          onClick={() => setAbaSelecionada('perfil')}
          className={`flex-1 flex items-center justify-center gap-2 py-2 text-sm font-semibold rounded-lg cursor-pointer transition-colors whitespace-nowrap ${abaSelecionada === 'perfil' ? 'bg-white text-zinc-900' : 'text-zinc-500 hover:text-zinc-700'}`}
        >
          <i className="ri-user-line" />
          Informações
        </button>
        <button
          onClick={() => setAbaSelecionada('senha')}
          className={`flex-1 flex items-center justify-center gap-2 py-2 text-sm font-semibold rounded-lg cursor-pointer transition-colors whitespace-nowrap ${abaSelecionada === 'senha' ? 'bg-white text-zinc-900' : 'text-zinc-500 hover:text-zinc-700'}`}
        >
          <i className="ri-lock-password-line" />
          Alterar senha
        </button>
      </div>

      {/* Tab: Perfil */}
      {abaSelecionada === 'perfil' && (
        <div className="space-y-3">
          {[
            { label: 'Nome completo', value: user.nome, icon: 'ri-user-line' },
            { label: 'Loja / Estabelecimento', value: user.loja, icon: 'ri-store-line' },
            { label: 'Perfil de acesso', value: PERFIL_LABEL[user.perfil] ?? user.perfil, icon: 'ri-shield-user-line' },
            { label: 'ID de sessão', value: user.id, icon: 'ri-fingerprint-line' },
          ].map((info) => (
            <div key={info.label} className="flex items-center gap-4 p-4 bg-white border border-zinc-100 rounded-xl">
              <div className="w-9 h-9 flex items-center justify-center bg-zinc-50 rounded-lg border border-zinc-100 flex-shrink-0">
                <i className={`${info.icon} text-zinc-500 text-base`} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wide">{info.label}</p>
                <p className="text-sm font-semibold text-zinc-800 truncate">{info.value}</p>
              </div>
            </div>
          ))}

          {/* Permissões */}
          <div className="p-4 bg-zinc-50 border border-zinc-100 rounded-xl">
            <p className="text-xs font-semibold text-zinc-600 mb-3 flex items-center gap-1.5">
              <i className="ri-shield-check-line text-zinc-400" />
              Permissões do seu perfil
            </p>
            <div className="grid grid-cols-2 gap-1.5">
              {getPermissoes(user.perfil).map((p) => (
                <div key={p.label} className="flex items-center gap-2">
                  <i className={`${p.ok ? 'ri-checkbox-circle-fill text-emerald-500' : 'ri-close-circle-fill text-zinc-200'} text-sm`} />
                  <span className={`text-xs ${p.ok ? 'text-zinc-700' : 'text-zinc-300'}`}>{p.label}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="pt-2 flex items-center gap-3 flex-wrap">
            <button
              onClick={() => setShowCriarLoja(true)}
              className="flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-amber-700 border border-amber-200 rounded-xl hover:bg-amber-50 cursor-pointer transition-colors whitespace-nowrap"
            >
              <i className="ri-store-2-line" />
              Criar nova loja
            </button>
            <button
              onClick={() => { logout(); navigate('/login'); }}
              className="flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-red-600 border border-red-100 rounded-xl hover:bg-red-50 cursor-pointer transition-colors whitespace-nowrap"
            >
              <i className="ri-logout-circle-r-line" />
              Encerrar sessão
            </button>
          </div>
        </div>
      )}

      {showCriarLoja && <CriarLojaModal onClose={() => setShowCriarLoja(false)} />}

      {/* Tab: Senha */}
      {abaSelecionada === 'senha' && (
        <div className="space-y-4">
          <div className="p-4 bg-amber-50 border border-amber-100 rounded-xl">
            <div className="flex items-start gap-3">
              <i className="ri-shield-keyhole-line text-amber-600 text-lg flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-bold text-amber-800 mb-0.5">Segurança da conta</p>
                <p className="text-xs text-amber-700">
                  Se você recebeu uma senha temporária pelo link de convite, recomendamos alterar agora.
                </p>
              </div>
            </div>
          </div>

          <div className="space-y-3">
            {/* Senha atual */}
            <div>
              <label className="block text-xs font-semibold text-zinc-600 mb-1.5">Senha atual</label>
              <div className="relative">
                <input
                  type={showAtual ? 'text' : 'password'}
                  value={senhaAtual}
                  onChange={(e) => setSenhaAtual(e.target.value)}
                  placeholder="Digite a senha atual"
                  className="w-full text-sm border border-zinc-200 rounded-xl px-3.5 py-2.5 pr-10 focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent"
                />
                <button
                  onClick={() => setShowAtual((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 flex items-center justify-center text-zinc-400 cursor-pointer"
                >
                  <i className={`${showAtual ? 'ri-eye-off-line' : 'ri-eye-line'} text-sm`} />
                </button>
              </div>
            </div>

            {/* Nova senha */}
            <div>
              <label className="block text-xs font-semibold text-zinc-600 mb-1.5">Nova senha</label>
              <div className="relative">
                <input
                  type={showNova ? 'text' : 'password'}
                  value={novaSenha}
                  onChange={(e) => setNovaSenha(e.target.value)}
                  placeholder="Mínimo 4 caracteres"
                  className="w-full text-sm border border-zinc-200 rounded-xl px-3.5 py-2.5 pr-10 focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent"
                />
                <button
                  onClick={() => setShowNova((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 flex items-center justify-center text-zinc-400 cursor-pointer"
                >
                  <i className={`${showNova ? 'ri-eye-off-line' : 'ri-eye-line'} text-sm`} />
                </button>
              </div>
              {novaSenha && (
                <div className="flex items-center gap-1.5 mt-1.5">
                  {[
                    { ok: novaSenha.length >= 4, label: 'Mín. 4 chars' },
                    { ok: /[A-Z]/.test(novaSenha), label: 'Maiúscula' },
                    { ok: /[0-9]/.test(novaSenha), label: 'Número' },
                  ].map((c) => (
                    <span key={c.label} className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${c.ok ? 'bg-emerald-100 text-emerald-700' : 'bg-zinc-100 text-zinc-400'}`}>
                      {c.ok ? '✓' : '○'} {c.label}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Confirmar senha */}
            <div>
              <label className="block text-xs font-semibold text-zinc-600 mb-1.5">Confirmar nova senha</label>
              <div className="relative">
                <input
                  type={showConfirmar ? 'text' : 'password'}
                  value={confirmarSenha}
                  onChange={(e) => setConfirmarSenha(e.target.value)}
                  placeholder="Repita a nova senha"
                  className={`w-full text-sm border rounded-xl px-3.5 py-2.5 pr-10 focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent ${
                    confirmarSenha && confirmarSenha !== novaSenha ? 'border-red-300' : 'border-zinc-200'
                  }`}
                />
                <button
                  onClick={() => setShowConfirmar((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 flex items-center justify-center text-zinc-400 cursor-pointer"
                >
                  <i className={`${showConfirmar ? 'ri-eye-off-line' : 'ri-eye-line'} text-sm`} />
                </button>
              </div>
              {confirmarSenha && confirmarSenha !== novaSenha && (
                <p className="text-xs text-red-500 mt-1">As senhas não coincidem</p>
              )}
            </div>
          </div>

          {erro && (
            <div className="flex items-center gap-2 px-3 py-2.5 bg-red-50 border border-red-100 rounded-xl">
              <i className="ri-error-warning-line text-red-500 flex-shrink-0" />
              <p className="text-xs text-red-600">{erro}</p>
            </div>
          )}

          {sucesso && (
            <div className="flex items-center gap-2 px-3 py-2.5 bg-emerald-50 border border-emerald-100 rounded-xl">
              <i className="ri-checkbox-circle-line text-emerald-500 flex-shrink-0" />
              <p className="text-xs text-emerald-700 font-semibold">{sucesso}</p>
            </div>
          )}

          <button
            onClick={handleAlterarSenha}
            disabled={salvando}
            className="w-full py-3 text-sm font-bold text-white bg-amber-500 rounded-xl hover:bg-amber-600 disabled:opacity-60 cursor-pointer whitespace-nowrap transition-colors"
          >
            {salvando ? 'Salvando...' : 'Alterar senha'}
          </button>
        </div>
      )}
    </div>
  );
}

function getPermissoes(perfil: string): { label: string; ok: boolean }[] {
  const mapa: Record<string, string[]> = {
    admin: ['Dashboard', 'PDV Caixa', 'PDV Garçom', 'KDS', 'Cardápio', 'Estoque', 'Relatórios', 'Usuários', 'Configurações', 'Auditoria'],
    gerente: ['Dashboard', 'PDV Caixa', 'PDV Garçom', 'KDS', 'Cardápio', 'Estoque', 'Relatórios', 'Auditoria'],
    caixa: ['PDV Caixa', 'Dashboard'],
    garcom: ['PDV Garçom', 'Dashboard'],
    cozinha: ['KDS'],
  };
  const todos = ['Dashboard', 'PDV Caixa', 'PDV Garçom', 'KDS', 'Cardápio', 'Estoque', 'Relatórios', 'Usuários', 'Configurações', 'Auditoria'];
  const permitidos = mapa[perfil] ?? [];
  return todos.map((label) => ({ label, ok: permitidos.includes(label) }));
}
