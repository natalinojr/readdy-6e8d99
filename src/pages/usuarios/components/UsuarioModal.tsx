import { useState } from 'react';
import { X, Eye, EyeOff, ShieldCheck, Check, Hash } from 'lucide-react';
import { perfilConfig, type PerfilUsuario } from '@/constants/usuarios';
import type { UsuarioReal } from '@/hooks/useUsuarios';

interface Props {
  modo: 'novo' | 'editar' | 'senha';
  usuario?: UsuarioReal | null;
  onClose: () => void;
  onSalvar: (payload: Record<string, unknown>) => Promise<void>;
  onDefinirPIN?: (pin: string) => Promise<{ success: boolean; error?: string }>;
  onLimparPIN?: () => Promise<{ success: boolean; error?: string }>;
}

const PERFIS_NORMAIS: PerfilUsuario[] = ['admin', 'gerente', 'caixa', 'garcom', 'cozinha', 'gestor_entregas'];
const PERFIS_TODOS: PerfilUsuario[] = [...PERFIS_NORMAIS, 'totem'];

export default function UsuarioModal({ modo, usuario, onClose, onSalvar, onDefinirPIN, onLimparPIN }: Props) {
  const [nome, setNome] = useState(usuario?.nome ?? '');
  const [email, setEmail] = useState(usuario?.email?.includes('@totem.erpos.local') ? '' : (usuario?.email ?? ''));
  const [matricula, setMatricula] = useState('');
  const [perfil, setPerfil] = useState<PerfilUsuario>(usuario?.perfil ?? 'garcom');
  const [modoTreino, setModoTreino] = useState(usuario?.modoTreino ?? false);
  const [ativo, setAtivo] = useState(usuario?.ativo ?? true);
  const [senha, setSenha] = useState('');
  const [showSenha, setShowSenha] = useState(false);
  const [erros, setErros] = useState<Record<string, string>>({});
  const [salvando, setSalvando] = useState(false);
  const [extraErro, setExtraErro] = useState<string | null>(null);

  // PIN state
  const [pin, setPin] = useState('');
  const [pinErro, setPinErro] = useState('');
  const [pinStatus, setPinStatus] = useState<'idle' | 'salvando' | 'ok' | 'erro'>('idle');
  const [pinMensagem, setPinMensagem] = useState('');

  const isTotem = perfil === 'totem';

  const validar = () => {
    const e: Record<string, string> = {};
    if (modo !== 'senha') {
      if (!nome.trim()) e.nome = 'Nome obrigatório';
      if (modo === 'novo') {
        // Email só obrigatório se não for totem e se foi preenchido (validar formato)
        if (!isTotem && email.trim() && !email.includes('@')) {
          e.email = 'E-mail inválido';
        }
        if (matricula.trim() && !/^\d{1,10}$/.test(matricula.trim())) {
          e.matricula = 'Matrícula deve ter apenas dígitos';
        }
        // Senha obrigatória para não-totem
        if (!isTotem && senha.length < 6) e.senha = 'Mínimo 6 caracteres';
        // Para totem, PIN é obrigatório
        if (isTotem && pin.trim().length < 4) e.pin = 'PIN obrigatório (mínimo 4 dígitos)';
      }
    }
    if (modo === 'senha' && senha.length < 6) e.senha = 'Mínimo 6 caracteres';
    // No modo editar, senha é opcional — só validar se preenchida
    if (modo === 'editar' && senha && senha.length < 6) e.senha = 'Mínimo 6 caracteres';
    return e;
  };

  const handleSalvar = async () => {
    const e = validar();
    if (Object.keys(e).length) { setErros(e); return; }
    setSalvando(true);
    setExtraErro(null);
    try {
      if (modo === 'novo') {
        await onSalvar({
          nome,
          email: email.trim() || undefined,
          senha: isTotem ? undefined : senha,
          perfil,
          training_mode: modoTreino,
          matricula: matricula.trim() || undefined,
          pin: isTotem ? pin.trim() : undefined,
        });
      } else if (modo === 'editar') {
        // Se PIN preenchido, salvar separadamente primeiro
        if (pin.trim() && onDefinirPIN) {
          if (!/^\d{4,8}$/.test(pin)) {
            setPinErro('PIN deve ter entre 4 e 8 dígitos numéricos');
            setSalvando(false);
            return;
          }
          const pinRes = await onDefinirPIN(pin);
          if (!pinRes.success) {
            setExtraErro(pinRes.error ?? 'Erro ao salvar PIN');
            setSalvando(false);
            return;
          }
        }
        // Salvar dados do usuário
        const payload: Record<string, unknown> = { nome, perfil, modoTreino, ativo };
        if (senha && senha.length >= 6) {
          payload.senha = senha;
        }
        await onSalvar(payload);
      } else {
        await onSalvar({ senha });
      }
    } finally {
      setSalvando(false);
    }
  };

  const handleDefinirPIN = async () => {
    if (!onDefinirPIN) return;
    if (!/^\d{4,8}$/.test(pin)) {
      setPinErro('PIN deve ter entre 4 e 8 dígitos numéricos');
      return;
    }
    setPinErro('');
    setPinStatus('salvando');
    const res = await onDefinirPIN(pin);
    if (res.success) {
      setPinStatus('ok');
      setPinMensagem('PIN definido com sucesso!');
      setPin('');
      setTimeout(() => setPinStatus('idle'), 3000);
    } else {
      setPinStatus('erro');
      setPinMensagem(res.error ?? 'Erro ao definir PIN');
      setTimeout(() => setPinStatus('idle'), 4000);
    }
  };

  const handleLimparPIN = async () => {
    if (!onLimparPIN) return;
    setPinStatus('salvando');
    const res = await onLimparPIN();
    if (res.success) {
      setPinStatus('ok');
      setPinMensagem('PIN removido.');
      setTimeout(() => setPinStatus('idle'), 3000);
    } else {
      setPinStatus('erro');
      setPinMensagem(res.error ?? 'Erro ao remover PIN');
      setTimeout(() => setPinStatus('idle'), 4000);
    }
  };

  const cfg = perfilConfig[perfil];
  const titulo = modo === 'novo' ? 'Novo Usuário' : modo === 'editar' ? 'Editar Usuário' : 'Redefinir Senha';
  const subtitulo = modo === 'novo' ? 'Preencha os dados do colaborador' : `Editando: ${usuario?.nome ?? ''}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl w-full max-w-lg max-h-[92vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-zinc-100 px-6 py-4 flex items-center justify-between rounded-t-2xl z-10">
          <div>
            <h2 className="text-sm font-bold text-zinc-900">{titulo}</h2>
            <p className="text-xs text-zinc-400 mt-0.5">{subtitulo}</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-zinc-100 cursor-pointer text-zinc-500 transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="p-6 space-y-5">
          {modo === 'senha' ? (
            <div>
              {usuario?.perfil === 'totem' && (
                <div className="mb-4 px-3 py-2.5 bg-amber-50 border border-amber-200 rounded-lg">
                  <p className="text-xs text-amber-800 font-medium">
                    Este é um usuário tablet/totem. O login no terminal é feito por <strong>matrícula + PIN</strong>.
                  </p>
                  <p className="text-[11px] text-amber-700 mt-1">
                    A senha do sistema abaixo só é usada em casos especiais. Para redefinir o PIN de acesso, edite o usuário e use a seção "PIN do PDV".
                  </p>
                </div>
              )}
              <label className="block text-xs font-semibold text-zinc-600 mb-1.5">Nova senha</label>
              <div className="relative">
                <input
                  type={showSenha ? 'text' : 'password'}
                  value={senha}
                  onChange={(e) => { setSenha(e.target.value); setErros({}); }}
                  placeholder="Mínimo 6 caracteres"
                  className={`w-full text-sm border rounded-lg px-3 py-2.5 pr-9 text-zinc-800 focus:outline-none focus:border-amber-400 ${erros.senha ? 'border-red-300 bg-red-50' : 'border-zinc-200'}`}
                />
                <button onClick={() => setShowSenha(!showSenha)} className="absolute right-2.5 top-1/2 -translate-y-1/2 w-5 h-5 flex items-center justify-center text-zinc-400 cursor-pointer">
                  {showSenha ? <EyeOff size={13} /> : <Eye size={13} />}
                </button>
              </div>
              {erros.senha && <p className="text-xs text-red-500 mt-1">{erros.senha}</p>}
            </div>
          ) : (
            <>
              {/* Dados pessoais */}
              <div>
                <p className="text-xs font-bold text-zinc-500 uppercase tracking-wide mb-3">Dados pessoais</p>
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-semibold text-zinc-600 mb-1.5">Nome / Identificação</label>
                    <input value={nome} onChange={(e) => { setNome(e.target.value); setErros((p) => ({ ...p, nome: '' })); }}
                      placeholder={isTotem ? 'Ex: Totem 1, Totem Entrada...' : 'Ex: João da Silva'}
                      className={`w-full text-sm border rounded-lg px-3 py-2.5 text-zinc-800 focus:outline-none focus:border-amber-400 ${erros.nome ? 'border-red-300 bg-red-50' : 'border-zinc-200'}`} />
                    {erros.nome && <p className="text-xs text-red-500 mt-1">{erros.nome}</p>}
                  </div>

                  {modo === 'novo' && (
                    <>
                      {/* Matrícula */}
                      <div>
                        <label className="block text-xs font-semibold text-zinc-600 mb-1.5">
                          Matrícula
                          <span className="text-zinc-400 font-normal ml-1">— gerada automaticamente se vazio</span>
                        </label>
                        <input
                          type="text"
                          inputMode="numeric"
                          value={matricula}
                          onChange={(e) => {
                            const v = e.target.value.replace(/\D/g, '').slice(0, 10);
                            setMatricula(v);
                            setErros((p) => ({ ...p, matricula: '' }));
                          }}
                          placeholder="Ex: 0001 (gerado automaticamente)"
                          className={`w-full text-sm border rounded-lg px-3 py-2.5 text-zinc-800 focus:outline-none focus:border-amber-400 ${erros.matricula ? 'border-red-300 bg-red-50' : 'border-zinc-200'}`}
                        />
                        {erros.matricula && <p className="text-xs text-red-500 mt-1">{erros.matricula}</p>}
                        <p className="text-[11px] text-zinc-400 mt-1">
                          Sequencial automático: 0001, 0002, 0003... Usada para login rápido com PIN.
                        </p>
                      </div>

                      {/* Email — opcional para todos, oculto para totem */}
                      {!isTotem && (
                        <div>
                          <label className="block text-xs font-semibold text-zinc-600 mb-1.5">
                            E-mail
                            <span className="text-zinc-400 font-normal ml-1">— opcional</span>
                          </label>
                          <input type="email" value={email} onChange={(e) => { setEmail(e.target.value); setErros((p) => ({ ...p, email: '' })); }}
                            placeholder="colaborador@loja.com.br (opcional)"
                            className={`w-full text-sm border rounded-lg px-3 py-2.5 text-zinc-800 focus:outline-none focus:border-amber-400 ${erros.email ? 'border-red-300 bg-red-50' : 'border-zinc-200'}`} />
                          {erros.email && <p className="text-xs text-red-500 mt-1">{erros.email}</p>}
                          <p className="text-[11px] text-zinc-400 mt-1">Se não informado, o login será feito apenas por matrícula + PIN.</p>
                        </div>
                      )}

                      {/* Senha — apenas para não-totem */}
                      {!isTotem && (
                        <div>
                          <label className="block text-xs font-semibold text-zinc-600 mb-1.5">Senha</label>
                          <div className="relative">
                            <input type={showSenha ? 'text' : 'password'} value={senha} onChange={(e) => { setSenha(e.target.value); setErros((p) => ({ ...p, senha: '' })); }}
                              placeholder="Mínimo 6 caracteres"
                              className={`w-full text-sm border rounded-lg px-3 py-2.5 pr-9 text-zinc-800 focus:outline-none focus:border-amber-400 ${erros.senha ? 'border-red-300 bg-red-50' : 'border-zinc-200'}`} />
                            <button onClick={() => setShowSenha(!showSenha)} className="absolute right-2.5 top-1/2 -translate-y-1/2 w-5 h-5 flex items-center justify-center text-zinc-400 cursor-pointer">
                              {showSenha ? <EyeOff size={13} /> : <Eye size={13} />}
                            </button>
                          </div>
                          {erros.senha && <p className="text-xs text-red-500 mt-1">{erros.senha}</p>}
                        </div>
                      )}

                      {/* PIN — obrigatório para totem, opcional para outros */}
                      {isTotem ? (
                        <div>
                          <label className="block text-xs font-semibold text-zinc-600 mb-1.5">
                            PIN de acesso
                            <span className="text-orange-500 ml-1">*</span>
                          </label>
                          <div className="relative">
                            <div className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 flex items-center justify-center text-zinc-400">
                              <Hash size={13} />
                            </div>
                            <input
                              type="password"
                              inputMode="numeric"
                              value={pin}
                              onChange={(e) => {
                                const v = e.target.value.replace(/\D/g, '').slice(0, 8);
                                setPin(v);
                                setErros((p) => ({ ...p, pin: '' }));
                              }}
                              placeholder="4 a 8 dígitos"
                              maxLength={8}
                              className={`w-full text-sm border rounded-lg pl-8 pr-3 py-2.5 tracking-widest text-zinc-800 focus:outline-none focus:border-amber-400 ${erros.pin ? 'border-red-300 bg-red-50' : 'border-zinc-200'}`}
                            />
                          </div>
                          {erros.pin && <p className="text-xs text-red-500 mt-1">{erros.pin}</p>}
                          <p className="text-[11px] text-zinc-400 mt-1">
                            O totem faz login pela matrícula + este PIN. Não precisa de email ou senha.
                          </p>
                        </div>
                      ) : null}
                    </>
                  )}
                </div>
              </div>

              {/* Perfil */}
              <div>
                <p className="text-xs font-bold text-zinc-500 uppercase tracking-wide mb-3">Perfil e acesso</p>
                <div className="grid grid-cols-3 gap-2 mb-3">
                  {(modo === 'novo' ? PERFIS_TODOS : PERFIS_NORMAIS).map((p) => {
                    const c = perfilConfig[p];
                    return (
                      <button key={p} onClick={() => setPerfil(p)}
                        className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border-2 cursor-pointer transition-all text-center ${perfil === p ? `border-amber-400 ${c.bg}` : 'border-zinc-100 bg-zinc-50 hover:border-zinc-200'}`}>
                        <div className={`w-7 h-7 flex items-center justify-center rounded-full ${perfil === p ? c.bg : 'bg-zinc-100'}`}>
                          <ShieldCheck size={14} className={perfil === p ? c.cor : 'text-zinc-400'} />
                        </div>
                        <span className={`text-[10px] font-bold leading-tight ${perfil === p ? c.cor : 'text-zinc-500'}`}>{c.label}</span>
                      </button>
                    );
                  })}
                </div>
                <div className="flex items-start gap-2 px-3 py-2.5 bg-zinc-50 rounded-lg">
                  <ShieldCheck size={13} className={cfg.cor} />
                  <p className="text-xs text-zinc-500">{cfg.desc}</p>
                </div>
              </div>

              {/* Opções */}
              <div className="space-y-3">
                <p className="text-xs font-bold text-zinc-500 uppercase tracking-wide">Opções</p>
                {modo === 'editar' && (
                  <div className="flex items-center justify-between p-3 bg-zinc-50 rounded-xl">
                    <div>
                      <p className="text-sm font-semibold text-zinc-700">Usuário ativo</p>
                      <p className="text-xs text-zinc-400">Inativo não consegue fazer login</p>
                    </div>
                    <button onClick={() => setAtivo(!ativo)}
                      className={`relative w-11 h-6 rounded-full transition-colors cursor-pointer flex-shrink-0 ${ativo ? 'bg-amber-500' : 'bg-zinc-200'}`}>
                      <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${ativo ? 'left-6' : 'left-1'}`} />
                    </button>
                  </div>
                )}
                {!isTotem && (
                  <div className="flex items-center justify-between p-3 bg-zinc-50 rounded-xl">
                    <div>
                      <p className="text-sm font-semibold text-zinc-700">Modo treino</p>
                      <p className="text-xs text-zinc-400">Dados isolados do sistema real</p>
                    </div>
                    <button onClick={() => setModoTreino(!modoTreino)}
                      className={`relative w-11 h-6 rounded-full transition-colors cursor-pointer flex-shrink-0 ${modoTreino ? 'bg-amber-500' : 'bg-zinc-200'}`}>
                      <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${modoTreino ? 'left-6' : 'left-1'}`} />
                    </button>
                  </div>
                )}
              </div>

              {/* Senha — no modo editar também (opcional) */}
              {modo === 'editar' && (
                <div className="space-y-3">
                  <p className="text-xs font-bold text-zinc-500 uppercase tracking-wide">Senha</p>
                  <div>
                    <label className="block text-xs font-semibold text-zinc-600 mb-1.5">
                      Nova senha
                      <span className="text-zinc-400 font-normal ml-1">— deixe em branco para não alterar</span>
                    </label>
                    <div className="relative">
                      <input
                        type={showSenha ? 'text' : 'password'}
                        value={senha}
                        onChange={(e) => { setSenha(e.target.value); setErros((p) => ({ ...p, senha: '' })); }}
                        placeholder="Mínimo 6 caracteres"
                        className={`w-full text-sm border rounded-lg px-3 py-2.5 pr-9 text-zinc-800 focus:outline-none focus:border-amber-400 ${erros.senha ? 'border-red-300 bg-red-50' : 'border-zinc-200'}`}
                      />
                      <button onClick={() => setShowSenha(!showSenha)} className="absolute right-2.5 top-1/2 -translate-y-1/2 w-5 h-5 flex items-center justify-center text-zinc-400 cursor-pointer">
                        {showSenha ? <EyeOff size={13} /> : <Eye size={13} />}
                      </button>
                    </div>
                    {erros.senha && <p className="text-xs text-red-500 mt-1">{erros.senha}</p>}
                  </div>
                </div>
              )}

              {/* PIN do PDV — apenas no modo editar */}
              {modo === 'editar' && onDefinirPIN && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <p className="text-xs font-bold text-zinc-500 uppercase tracking-wide">PIN do PDV</p>
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200 whitespace-nowrap">
                      Login rápido por matrícula
                    </span>
                  </div>

                  <p className="text-xs text-zinc-400">
                    PIN numérico de 4–8 dígitos usado para login rápido nos terminais PDV, sem precisar de e-mail e senha.
                  </p>

                  <div className="flex gap-2">
                    <div className="flex-1 relative">
                      <div className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 flex items-center justify-center text-zinc-400">
                        <Hash size={13} />
                      </div>
                      <input
                        type="password"
                        inputMode="numeric"
                        value={pin}
                        onChange={(e) => {
                          const v = e.target.value.replace(/\D/g, '').slice(0, 8);
                          setPin(v);
                          setPinErro('');
                          setPinStatus('idle');
                        }}
                        placeholder="4 a 8 dígitos"
                        maxLength={8}
                        className={`w-full text-sm border rounded-lg pl-8 pr-3 py-2.5 tracking-widest text-zinc-800 focus:outline-none focus:border-amber-400 transition-colors ${
                          pinErro ? 'border-red-300 bg-red-50' : 'border-zinc-200'
                        }`}
                      />
                    </div>
                    <button
                      onClick={handleDefinirPIN}
                      disabled={pinStatus === 'salvando' || !pin}
                      className="px-4 py-2.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-40 text-white text-xs font-bold rounded-lg cursor-pointer transition-colors whitespace-nowrap flex items-center gap-1.5"
                    >
                      {pinStatus === 'salvando' ? (
                        <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      ) : (
                        <i className="ri-shield-keyhole-line text-sm" />
                      )}
                      Definir PIN
                    </button>
                    {onLimparPIN && (
                      <button
                        onClick={handleLimparPIN}
                        disabled={pinStatus === 'salvando'}
                        title="Remover PIN deste usuário"
                        className="w-10 h-10 flex items-center justify-center border border-zinc-200 rounded-lg text-zinc-400 hover:text-red-500 hover:border-red-200 cursor-pointer transition-colors disabled:opacity-40"
                      >
                        <i className="ri-delete-bin-6-line text-sm" />
                      </button>
                    )}
                  </div>

                  {pinErro && (
                    <p className="text-xs text-red-500 flex items-center gap-1">
                      <i className="ri-error-warning-line" />{pinErro}
                    </p>
                  )}
                  {pinStatus === 'ok' && (
                    <p className="text-xs text-green-600 flex items-center gap-1 font-semibold">
                      <i className="ri-checkbox-circle-line" />{pinMensagem}
                    </p>
                  )}
                  {pinStatus === 'erro' && (
                    <p className="text-xs text-red-500 flex items-center gap-1">
                      <i className="ri-alert-line" />{pinMensagem}
                    </p>
                  )}

                  {usuario?.matricula && (
                    <p className="text-[11px] text-zinc-400">
                      Matrícula: <span className="font-bold text-zinc-600">{usuario.matricula}</span>
                    </p>
                  )}
                </div>
              )}
            </>
          )}

          {/* Erro extra (ex: PIN falhou no handleSalvar) */}
          {extraErro && (
            <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-xl">
              <i className="ri-error-warning-line text-red-500 text-sm flex-shrink-0 mt-0.5" />
              <p className="text-xs text-red-700">{extraErro}</p>
            </div>
          )}
        </div>

        <div className="sticky bottom-0 bg-white border-t border-zinc-100 px-6 py-4 flex gap-2 rounded-b-2xl">
          <button onClick={onClose} className="flex-1 py-2.5 text-sm font-semibold text-zinc-600 bg-zinc-100 rounded-xl hover:bg-zinc-200 cursor-pointer transition-colors whitespace-nowrap">
            Cancelar
          </button>
          <button onClick={handleSalvar} disabled={salvando}
            className="flex-1 py-2.5 text-sm font-semibold text-white bg-amber-500 rounded-xl hover:bg-amber-600 cursor-pointer transition-colors whitespace-nowrap disabled:opacity-60 flex items-center justify-center gap-2">
            {salvando ? (
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              <Check size={14} />
            )}
            {modo === 'novo' ? 'Criar usuário' : modo === 'senha' ? 'Salvar nova senha' : 'Salvar alterações'}
          </button>
        </div>
      </div>
    </div>
  );
}