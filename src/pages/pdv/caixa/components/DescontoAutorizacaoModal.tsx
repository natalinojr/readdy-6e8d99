import { useState, useMemo, useEffect } from 'react';
import { useUsuarios } from '../../../../hooks/useUsuarios';
import { useValidarPIN } from '../../../../hooks/useValidarPIN';
import { useSystemSettings } from '../../../../hooks/useSystemSettings';

interface Props {
  valorDesconto: number;
  operadorNome: string;
  onAutorizadoSenha: (autorizadorNome: string) => void;
  onFalhouSenha: (tentativas: number) => void;
  onEnviarNotificacao: () => void;
  onClose: () => void;
}

function formatPrice(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export default function DescontoAutorizacaoModal({
  valorDesconto,
  operadorNome,
  onAutorizadoSenha,
  onFalhouSenha,
  onEnviarNotificacao,
  onClose,
}: Props) {
  const { usuarios } = useUsuarios();
  const { validarPIN, verificando } = useValidarPIN();
  const { settings } = useSystemSettings();

  // Filtra autorizadores conforme configuração discount_profile
  const autorizadores = useMemo(() => {
    const perfisPermitidos = settings.discount_profile === 'admin'
      ? ['admin']
      : ['gerente', 'admin'];
    return usuarios.filter((u) => perfisPermitidos.includes(u.perfil) && u.ativo);
  }, [usuarios, settings.discount_profile]);
  const [tab, setTab] = useState<'senha' | 'notificacao'>('senha');
  const [selectedUserId, setSelectedUserId] = useState('');
  const [senha, setSenha] = useState('');

  // Seleciona o primeiro autorizador assim que carregar
  useEffect(() => {
    if (autorizadores.length > 0 && !selectedUserId) {
      setSelectedUserId(autorizadores[0].id);
    }
  }, [autorizadores, selectedUserId]);
  const [erro, setErro] = useState('');
  const [tentativas, setTentativas] = useState(0);
  const [notifEnviada, setNotifEnviada] = useState(false);

  const selectedUser = autorizadores.find((u) => u.id === selectedUserId);

  const handleConfirmarSenha = async () => {
    if (!senha || verificando || !selectedUser) return;

    const result = await validarPIN(selectedUser.matricula, senha);

    if (result.ok) {
      onAutorizadoSenha(selectedUser.nome);
    } else {
      const novasTentativas = tentativas + 1;
      setTentativas(novasTentativas);
      setErro(
        novasTentativas >= 3
          ? 'Muitas tentativas incorretas. Tente via notificação.'
          : `PIN incorreto. Tentativa ${novasTentativas}/3.`,
      );
      setSenha('');
      if (novasTentativas >= 3) {
        onFalhouSenha(novasTentativas);
      }
    }
  };

  const handleEnviarNotificacao = () => {
    setNotifEnviada(true);
    setTimeout(() => {
      onEnviarNotificacao();
    }, 600);
  };

  const perfilCor: Record<string, string> = {
    admin: 'text-red-600 bg-red-50 border-red-200',
    gerente: 'text-violet-600 bg-violet-50 border-violet-200',
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-sm shadow-xl overflow-hidden">

        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 bg-zinc-900">
          <div className="w-8 h-8 flex items-center justify-center bg-amber-500 rounded-lg flex-shrink-0">
            <i className="ri-shield-keyhole-fill text-white text-base" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-bold text-white">Autorizar Desconto</h3>
            <p className="text-[10px] text-zinc-400 truncate">
              Solicitado por <span className="text-zinc-300 font-semibold">{operadorNome}</span>
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-lg bg-zinc-700 hover:bg-zinc-600 text-zinc-300 cursor-pointer flex-shrink-0"
          >
            <i className="ri-close-line text-sm" />
          </button>
        </div>

        {/* Valor */}
        <div className="px-5 pt-4">
          <div className="flex items-center justify-between px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl">
            <span className="text-xs font-semibold text-amber-700">Desconto solicitado</span>
            <span className="text-lg font-black text-amber-700">{formatPrice(valorDesconto)}</span>
          </div>
        </div>

        {/* Tabs */}
        <div className="px-5 pt-4">
          <div className="flex gap-1 bg-zinc-100 rounded-xl p-1">
            <button
              onClick={() => { setTab('senha'); setErro(''); setSenha(''); }}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-bold transition-colors cursor-pointer whitespace-nowrap ${
                tab === 'senha'
                  ? 'bg-white text-zinc-900 shadow-sm'
                  : 'text-zinc-500 hover:text-zinc-700'
              }`}
            >
              <i className="ri-lock-password-line text-sm" />
              Senha In Loco
            </button>
            <button
              onClick={() => { setTab('notificacao'); setErro(''); setSenha(''); }}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-bold transition-colors cursor-pointer whitespace-nowrap ${
                tab === 'notificacao'
                  ? 'bg-white text-zinc-900 shadow-sm'
                  : 'text-zinc-500 hover:text-zinc-700'
              }`}
            >
              <i className="ri-notification-3-line text-sm" />
              Via Notificação
            </button>
          </div>
        </div>

        {/* Conteúdo da aba */}
        <div className="px-5 py-4 space-y-4">
          {tab === 'senha' && (
            <>
              {/* Seletor de autorizador */}
              <div>
                <label className="block text-xs font-semibold text-zinc-600 mb-1.5">
                  Quem vai autorizar?
                </label>
                {autorizadores.length === 0 ? (
                  <div className="px-3 py-2.5 bg-zinc-50 border border-zinc-200 rounded-lg text-xs text-zinc-400 italic">
                    Nenhum gerente/admin ativo
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {autorizadores.map((u) => (
                      <button
                        key={u.id}
                        onClick={() => { setSelectedUserId(u.id); setErro(''); setSenha(''); }}
                        className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg border text-left transition-colors cursor-pointer ${
                          selectedUserId === u.id
                            ? 'border-zinc-900 bg-zinc-50 ring-1 ring-zinc-900'
                            : 'border-zinc-200 hover:border-zinc-300 bg-white'
                        }`}
                      >
                        <div className="w-7 h-7 rounded-full bg-zinc-200 flex items-center justify-center flex-shrink-0">
                          <span className="text-[10px] font-black text-zinc-600">
                            {u.nome.split(' ').map((n) => n[0]).slice(0, 2).join('')}
                          </span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold text-zinc-800 truncate">{u.nome}</p>
                          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full border ${perfilCor[u.perfil] ?? 'text-zinc-600 bg-zinc-50 border-zinc-200'}`}>
                            {u.perfil === 'admin' ? 'Administrador' : 'Gerente'}
                          </span>
                        </div>
                        {selectedUserId === u.id && (
                          <div className="w-4 h-4 flex items-center justify-center flex-shrink-0">
                            <i className="ri-checkbox-circle-fill text-zinc-900 text-base" />
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Senha */}
              {autorizadores.length > 0 && (
                <div>
                  <label className="block text-xs font-semibold text-zinc-600 mb-1.5">
                    Senha de {selectedUser?.nome?.split(' ')[0] ?? 'autorizador'}
                  </label>
                  <input
                    type="password"
                    value={senha}
                    onChange={(e) => { setSenha(e.target.value); setErro(''); }}
                    onKeyDown={(e) => e.key === 'Enter' && handleConfirmarSenha()}
                    placeholder="••••••••"
                    autoFocus
                    disabled={tentativas >= 3}
                    className="w-full border border-zinc-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900 text-zinc-900 tracking-widest disabled:opacity-50 disabled:cursor-not-allowed"
                  />
                  {erro && (
                    <p className={`text-[11px] mt-1.5 flex items-center gap-1 ${tentativas >= 3 ? 'text-orange-600' : 'text-red-500'}`}>
                      <i className={tentativas >= 3 ? 'ri-alert-line' : 'ri-error-warning-line'} />
                      {erro}
                    </p>
                  )}

                </div>
              )}

              <div className="flex gap-3 pt-1">
                <button
                  onClick={onClose}
                  className="flex-1 py-2.5 border border-zinc-200 text-zinc-600 text-sm font-semibold rounded-xl hover:bg-zinc-50 cursor-pointer whitespace-nowrap transition-colors"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleConfirmarSenha}
                  disabled={!senha || verificando || tentativas >= 3 || autorizadores.length === 0}
                  className="flex-1 py-2.5 bg-zinc-900 hover:bg-zinc-800 disabled:opacity-40 text-white text-sm font-bold rounded-xl cursor-pointer whitespace-nowrap transition-colors"
                >
                  {verificando ? (
                    <i className="ri-loader-4-line animate-spin" />
                  ) : (
                    <><i className="ri-shield-check-line mr-1" />Autorizar</>
                  )}
                </button>
              </div>

              {/* Sugestão de ir para notificação após falhas */}
              {tentativas >= 2 && tentativas < 3 && (
                <button
                  onClick={() => setTab('notificacao')}
                  className="w-full text-[11px] text-orange-600 hover:text-orange-700 font-semibold flex items-center justify-center gap-1 cursor-pointer transition-colors"
                >
                  <i className="ri-notification-3-line" />
                  Prefere solicitar por notificação?
                </button>
              )}
            </>
          )}

          {tab === 'notificacao' && (
            <>
              <div className="space-y-2">
                {/* Info destinatários */}
                <div className="px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-xl space-y-2">
                  <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Notificação enviada para</p>
                  <div className="flex flex-wrap gap-1.5">
                    {autorizadores.map((u) => (
                      <span key={u.id} className="flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-full border border-zinc-200 bg-white text-zinc-600">
                        <div className="w-3.5 h-3.5 rounded-full bg-zinc-300 flex items-center justify-center">
                          <span className="text-[7px] font-black text-zinc-600">{u.nome[0]}</span>
                        </div>
                        {u.nome.split(' ')[0]}
                        <span className={`text-[8px] font-bold px-1 rounded ${u.perfil === 'admin' ? 'text-red-600' : 'text-violet-600'}`}>
                          {u.perfil === 'admin' ? 'ADM' : 'GER'}
                        </span>
                      </span>
                    ))}
                  </div>
                </div>

                {/* Preview da notificação */}
                <div className="px-4 py-3 bg-orange-50 border border-orange-200 rounded-xl">
                  <div className="flex items-start gap-2">
                    <div className="w-6 h-6 flex items-center justify-center bg-orange-500 rounded-lg flex-shrink-0 mt-0.5">
                      <i className="ri-shield-keyhole-line text-white text-xs" />
                    </div>
                    <div>
                      <p className="text-xs font-bold text-orange-800">Solicitação de Desconto</p>
                      <p className="text-[11px] text-orange-700 mt-0.5">
                        <span className="font-semibold">{operadorNome}</span> solicita desconto de{' '}
                        <span className="font-bold">{formatPrice(valorDesconto)}</span> no pedido atual.
                      </p>
                    </div>
                  </div>
                </div>

                <p className="text-[10px] text-zinc-400 text-center">
                  O gerente/admin poderá Aprovar ou Recusar pela central de notificações.
                  Você receberá uma confirmação aqui.
                </p>
              </div>

              <div className="flex gap-3 pt-1">
                <button
                  onClick={onClose}
                  className="flex-1 py-2.5 border border-zinc-200 text-zinc-600 text-sm font-semibold rounded-xl hover:bg-zinc-50 cursor-pointer whitespace-nowrap transition-colors"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleEnviarNotificacao}
                  disabled={notifEnviada || autorizadores.length === 0}
                  className="flex-1 py-2.5 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white text-sm font-bold rounded-xl cursor-pointer whitespace-nowrap transition-colors flex items-center justify-center gap-1.5"
                >
                  {notifEnviada ? (
                    <><i className="ri-check-line" />Enviado!</>
                  ) : (
                    <><i className="ri-send-plane-fill" />Enviar Notificação</>
                  )}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
