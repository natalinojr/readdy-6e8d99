import { useState, useMemo } from 'react';
import { useAuditoria } from '../../../../contexts/AuditoriaContext';
import { useAuth } from '../../../../contexts/AuthContext';
import { useUsuarios } from '../../../../hooks/useUsuarios';
import { useValidarPIN } from '../../../../hooks/useValidarPIN';
import { useSystemSettings } from '../../../../hooks/useSystemSettings';
import type { PedidoRecente } from '@/types/pdv';

interface Props {
  pedido: PedidoRecente;
  onClose: () => void;
  onConfirmar: (motivo: string, detalhes: string) => void;
}

const MOTIVOS = [
  'Desistência do cliente',
  'Erro no pedido',
  'Item indisponível no momento',
  'Cliente saiu sem consumir',
  'Pedido duplicado',
  'Problema de qualidade',
  'Outros',
];

type Fase = 'novo' | 'preparo' | 'pronto_entregue';
type Etapa = 'motivo' | 'senha_gerente' | 'sucesso';

function detectarFase(pedido: PedidoRecente): Fase {
  if (pedido.status === 'pronto' || pedido.status === 'entregue') return 'pronto_entregue';
  // Se algum item já tem status 'preparo', está em preparo
  const emPreparo = pedido.itensDetalhes.some((i) =>
    i.unidades.some((u) => u.status === 'preparo')
  );
  if (emPreparo) return 'preparo';
  return 'novo';
}

const FASE_CONFIG: Record<Fase, {
  titulo: string;
  subtitulo: string;
  icon: string;
  iconBg: string;
  iconColor: string;
  aviso?: string;
  avisoColor?: string;
}> = {
  novo: {
    titulo: 'Cancelar Pedido',
    subtitulo: 'Nenhum item iniciado — cancelamento livre',
    icon: 'ri-close-circle-line',
    iconBg: 'bg-red-100',
    iconColor: 'text-red-500',
    aviso: 'Este pedido ainda não foi iniciado na cozinha. O cancelamento é imediato.',
    avisoColor: 'bg-green-50 border-green-200 text-green-700',
  },
  preparo: {
    titulo: 'Cancelar Pedido em Preparo',
    subtitulo: 'Itens já em preparo — requer autorização do Gerente',
    icon: 'ri-alert-line',
    iconBg: 'bg-amber-100',
    iconColor: 'text-amber-600',
    aviso: 'Itens já estão sendo preparados. Confirme o cancelamento com o Gerente. A cozinha será notificada.',
    avisoColor: 'bg-amber-50 border-amber-200 text-amber-700',
  },
  pronto_entregue: {
    titulo: 'Pedido não pode ser cancelado',
    subtitulo: 'Pedido já pronto ou entregue — somente estorno financeiro',
    icon: 'ri-information-line',
    iconBg: 'bg-zinc-100',
    iconColor: 'text-zinc-500',
    aviso: 'Pedidos prontos ou entregues não podem ser cancelados. Use o botão "Estornar" para realizar um estorno financeiro com autorização do Gerente.',
    avisoColor: 'bg-zinc-50 border-zinc-200 text-zinc-600',
  },
};

export default function CancelamentoModal({ pedido, onClose, onConfirmar }: Props) {
  const fase = detectarFase(pedido);
  const cfg = FASE_CONFIG[fase];
  const { registrarEvento } = useAuditoria();
  const { user } = useAuth();
  const { usuarios } = useUsuarios();
  const { validarPIN, verificando } = useValidarPIN();
  const { settings } = useSystemSettings();
  const cancelMode = settings.cancel_mode ?? 'senha_gerente';

  const autorizadores = useMemo(
    () => usuarios.filter((u) => (u.perfil === 'gerente' || u.perfil === 'admin') && u.ativo),
    [usuarios],
  );

  const [etapa, setEtapa] = useState<Etapa>('motivo');
  const [motivo, setMotivo] = useState('');
  const [detalhes, setDetalhes] = useState('');
  const [autorizadorId, setAutorizadorId] = useState('');
  const [senha, setSenha] = useState('');
  const [senhaErro, setSenhaErro] = useState('');
  const [tentativas, setTentativas] = useState(0);

  const autorizadorSelecionado = autorizadores.find((u) => u.id === autorizadorId) ?? autorizadores[0];

  const podeConfirmar = motivo !== '' && detalhes.length >= 5;

  // Determina se precisa de senha do gerente baseado no cancel_mode e fase
  const precisaSenhaGerente = (() => {
    if (fase === 'novo') return false; // Fase nova nunca precisa
    if (cancelMode === 'livre') return false; // Livre: nunca precisa
    if (cancelMode === 'proibido') return false; // Proibido: bloqueia antes de chegar aqui
    return true; // senha_gerente: precisa quando em preparo
  })();

  // Fase proibido: bloqueia cancelamento de itens em preparo/pronto
  const cancelamentoBloqueado = (fase === 'preparo' || fase === 'pronto_entregue') && cancelMode === 'proibido';

  const handleAvancar = () => {
    if (fase === 'novo' || !precisaSenhaGerente) {
      registrarEvento({
        tipo: 'pedido_cancelado',
        severidade: 'aviso',
        usuario: user?.nome ?? 'Operador',
        perfil: user?.perfil ?? 'caixa',
        descricao: `Pedido #${String(pedido.numero).padStart(4,'0')} cancelado — ${motivo}${cancelMode === 'livre' ? ' (modo livre)' : ''}`,
        entidade: 'Pedido',
        entidadeId: String(pedido.numero),
        detalhes,
      });
      onConfirmar(motivo, detalhes);
      setEtapa('sucesso');
    } else if (fase === 'preparo') {
      setEtapa('senha_gerente');
    }
  };

  const handleConfirmarSenha = async () => {
    if (tentativas >= 3 || verificando) return;

    const autorizador = autorizadorSelecionado;
    if (!autorizador) {
      setSenhaErro('Nenhum gerente selecionado');
      return;
    }

    const result = await validarPIN(autorizador.matricula, senha);

    if (!result.ok) {
      const novasTentativas = tentativas + 1;
      setTentativas(novasTentativas);
      setSenhaErro(
        novasTentativas >= 3
          ? 'Bloqueado — muitas tentativas. Contate o administrador.'
          : `PIN incorreto. ${3 - novasTentativas} tentativa(s) restante(s).`,
      );
      setSenha('');
      return;
    }

    registrarEvento({
      tipo: 'pedido_cancelado',
      severidade: 'critico',
      usuario: user?.nome ?? 'Operador',
      perfil: user?.perfil ?? 'caixa',
      descricao: `Pedido em preparo #${String(pedido.numero).padStart(4, '0')} cancelado — ${motivo} (autorização: ${autorizador.nome})`,
      entidade: 'Pedido',
      entidadeId: String(pedido.numero),
      detalhes,
    });
    onConfirmar(motivo, detalhes);
    setEtapa('sucesso');
  };

  if (etapa === 'sucesso') {
    return (
      <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl w-full max-w-sm p-8 text-center">
          <div className="w-16 h-16 flex items-center justify-center bg-green-100 rounded-full mx-auto mb-4">
            <i className="ri-check-double-line text-3xl text-green-500" />
          </div>
          <h3 className="font-black text-zinc-900 text-lg mb-1">Pedido Cancelado</h3>
          <p className="text-sm text-zinc-500 mb-2">#{String(pedido.numero).padStart(4, '0')} foi cancelado com sucesso</p>
          <p className="text-xs text-zinc-400 mb-6">Registrado no log de auditoria</p>
          <button
            onClick={onClose}
            className="w-full py-3 bg-zinc-800 hover:bg-zinc-900 text-white font-bold rounded-xl cursor-pointer transition-colors whitespace-nowrap"
          >
            Fechar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-md flex flex-col" style={{ maxHeight: 'calc(100vh - 2rem)' }}>
        {/* Header */}
        <div className="flex items-start justify-between px-5 py-4 border-b border-zinc-100 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 flex items-center justify-center rounded-xl flex-shrink-0 ${cfg.iconBg}`}>
              <i className={`${cfg.icon} text-lg ${cfg.iconColor}`} />
            </div>
            <div>
              <h3 className="font-bold text-zinc-900 text-sm">{cfg.titulo}</h3>
              <p className="text-xs text-zinc-400 mt-0.5">{cfg.subtitulo}</p>
            </div>
          </div>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 rounded-lg cursor-pointer transition-colors">
            <i className="ri-close-line text-base" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4 overflow-y-auto flex-1">
          {/* Pedido info */}
          <div className="flex items-center gap-3 p-3 bg-zinc-50 rounded-xl border border-zinc-100">
            <div className="flex-1">
              <p className="text-sm font-bold text-zinc-800">
                #{String(pedido.numero).padStart(4, '0')}
                {pedido.destino === 'mesa' && ` · Mesa ${pedido.mesaNumero}`}
                {pedido.destino === 'nome' && ` · ${pedido.nomeCliente}`}
                {pedido.destino === 'senha' && ` · Senha ${pedido.senha}`}
              </p>
              <p className="text-xs text-zinc-500 mt-0.5">{pedido.itensDetalhes.length} item(ns) · R$ {pedido.total.toFixed(2)}</p>
            </div>
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
              fase === 'novo' ? 'bg-amber-50 text-amber-700 border-amber-200' :
              fase === 'preparo' ? 'bg-yellow-50 text-yellow-700 border-yellow-200' :
              'bg-green-50 text-green-700 border-green-200'
            }`}>
              {fase === 'novo' ? 'Aguardando' : fase === 'preparo' ? 'Em Preparo' : 'Pronto/Entregue'}
            </span>
          </div>

          {/* Aviso de cancelamento bloqueado */}
          {cancelamentoBloqueado && (
            <div className="p-3 rounded-xl border bg-red-50 border-red-200 text-xs text-red-700">
              <i className="ri-lock-line mr-1" />
              <strong>Cancelamento bloqueado.</strong> A configuração do sistema não permite cancelar pedidos após envio ao KDS. Contate o gerente para estorno manual.
            </div>
          )}

          {/* Aviso por fase (quando não bloqueado) */}
          {!cancelamentoBloqueado && cfg.aviso && (
            <div className={`p-3 rounded-xl border text-xs ${cfg.avisoColor}`}>
              <i className="ri-information-line mr-1" />
              {cfg.aviso}
              {fase === 'preparo' && cancelMode === 'livre' && (
                <span className="ml-1 font-bold">(Modo livre — sem necessidade de autorização)</span>
              )}
            </div>
          )}

          {/* Fase pronto_entregue ou bloqueado: só mostra info */}
          {(fase === 'pronto_entregue' || cancelamentoBloqueado) && (
            <button
              onClick={onClose}
              className="w-full py-2.5 bg-zinc-100 hover:bg-zinc-200 text-zinc-700 text-sm font-semibold rounded-xl cursor-pointer whitespace-nowrap transition-colors"
            >
              Fechar
            </button>
          )}

          {/* Formulário de motivo */}
          {fase !== 'pronto_entregue' && !cancelamentoBloqueado && etapa === 'motivo' && (
            <>
              <div>
                <p className="text-xs font-semibold text-zinc-600 mb-2">Motivo do cancelamento *</p>
                <div className="grid grid-cols-1 gap-1.5">
                  {MOTIVOS.map((m) => (
                    <button
                      key={m}
                      onClick={() => setMotivo(m)}
                      className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border text-sm font-medium text-left cursor-pointer transition-all ${
                        motivo === m ? 'border-red-400 bg-red-50 text-red-700' : 'border-zinc-200 hover:border-zinc-300 text-zinc-700'
                      }`}
                    >
                      <div className={`w-4 h-4 flex items-center justify-center rounded-full border-2 flex-shrink-0 ${motivo === m ? 'border-red-500 bg-red-500' : 'border-zinc-300'}`}>
                        {motivo === m && <div className="w-2 h-2 bg-white rounded-full" />}
                      </div>
                      {m}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <p className="text-xs font-semibold text-zinc-600 mb-1.5">Descrição adicional * (mín. 5 caracteres)</p>
                <textarea
                  value={detalhes}
                  onChange={(e) => setDetalhes(e.target.value.slice(0, 300))}
                  className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2.5 text-sm resize-none focus:outline-none focus:border-red-300 transition-colors"
                  rows={2}
                  placeholder="Descreva brevemente o motivo..."
                />
                <p className="text-[10px] text-zinc-400 text-right">{detalhes.length}/300</p>
              </div>

              <div className="flex gap-3">
                <button onClick={onClose} className="flex-1 py-2.5 border border-zinc-200 text-zinc-600 text-sm font-semibold rounded-xl cursor-pointer hover:bg-zinc-50 transition-colors whitespace-nowrap">
                  Cancelar
                </button>
                <button
                  onClick={handleAvancar}
                  disabled={!podeConfirmar}
                  className="flex-1 py-2.5 bg-red-500 hover:bg-red-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-bold rounded-xl cursor-pointer transition-colors whitespace-nowrap"
                >
                  {fase === 'preparo' && precisaSenhaGerente ? 'Próximo: Autorizar' : 'Confirmar Cancelamento'}
                </button>
              </div>
            </>
          )}

          {/* Etapa senha gerente */}
          {etapa === 'senha_gerente' && (
            <>
              <div className="flex items-center gap-3 p-3 bg-amber-50 border border-amber-200 rounded-xl">
                <div className="w-8 h-8 flex items-center justify-center bg-amber-100 rounded-lg flex-shrink-0">
                  <i className="ri-shield-keyhole-line text-amber-600" />
                </div>
                <div>
                  <p className="text-xs font-bold text-amber-800">Autorização do Gerente</p>
                  <p className="text-[10px] text-amber-600 mt-0.5">Selecione o autorizador e insira o PIN</p>
                </div>
              </div>

              {autorizadores.length > 1 && (
                <div>
                  <p className="text-xs font-semibold text-zinc-600 mb-1.5">Quem vai autorizar?</p>
                  <div className="space-y-1">
                    {autorizadores.map((u) => (
                      <button
                        key={u.id}
                        onClick={() => { setAutorizadorId(u.id); setSenhaErro(''); setSenha(''); }}
                        className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg border text-left cursor-pointer transition-colors ${
                          (autorizadorId || autorizadores[0]?.id) === u.id
                            ? 'border-amber-400 bg-amber-50'
                            : 'border-zinc-200 hover:border-zinc-300 bg-white'
                        }`}
                      >
                        <div className="w-6 h-6 rounded-full bg-zinc-200 flex items-center justify-center flex-shrink-0">
                          <span className="text-[9px] font-black text-zinc-600">
                            {u.nome.split(' ').map((n) => n[0]).slice(0, 2).join('')}
                          </span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold text-zinc-800 truncate">{u.nome}</p>
                        </div>
                        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full border ${
                          u.perfil === 'admin' ? 'text-red-600 bg-red-50 border-red-200' : 'text-amber-700 bg-amber-50 border-amber-200'
                        }`}>
                          {u.perfil === 'admin' ? 'ADM' : 'GER'}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {autorizadores.length === 0 && (
                <p className="text-xs text-red-500 italic">Nenhum gerente/admin ativo cadastrado</p>
              )}

              <div>
                <p className="text-xs font-semibold text-zinc-600 mb-1.5">
                  PIN de {autorizadorSelecionado?.nome?.split(' ')[0] ?? 'autorizador'}
                </p>
                <input
                  type="password"
                  value={senha}
                  onChange={(e) => { setSenha(e.target.value); setSenhaErro(''); }}
                  onKeyDown={(e) => e.key === 'Enter' && handleConfirmarSenha()}
                  className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2.5 text-sm text-center tracking-[0.3em] focus:outline-none focus:border-amber-400 transition-colors"
                  placeholder="• • • •"
                  maxLength={8}
                  autoFocus
                  disabled={tentativas >= 3 || !autorizadorSelecionado}
                />
                {senhaErro && <p className="text-red-500 text-xs mt-1">{senhaErro}</p>}
                {tentativas >= 3 && (
                  <p className="text-red-600 text-xs mt-1 font-bold">
                    <i className="ri-lock-line mr-1" />
                    Bloqueado — muitas tentativas incorretas
                  </p>
                )}
              </div>

              <div className="flex gap-3">
                <button onClick={() => setEtapa('motivo')} className="flex-1 py-2.5 border border-zinc-200 text-zinc-600 text-sm font-semibold rounded-xl cursor-pointer hover:bg-zinc-50 transition-colors whitespace-nowrap">
                  Voltar
                </button>
                <button
                  onClick={handleConfirmarSenha}
                  disabled={!senha || tentativas >= 3 || verificando || autorizadores.length === 0}
                  className="flex-1 py-2.5 bg-red-500 hover:bg-red-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-bold rounded-xl cursor-pointer transition-colors whitespace-nowrap flex items-center justify-center gap-1.5"
                >
                  {verificando ? (
                    <><i className="ri-loader-4-line animate-spin" />Verificando...</>
                  ) : (
                    'Confirmar Cancelamento'
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
