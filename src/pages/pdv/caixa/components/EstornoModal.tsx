import { useState } from 'react';
import { useAuditoria } from '../../../../contexts/AuditoriaContext';
import { useAuth } from '../../../../contexts/AuthContext';
import { type PedidoRecente } from '@/types/pdv';

const SENHA_GERENTE_MOCK = '1234'; // Em prod viria da autenticação real

const MOTIVOS = [
  { id: 'desistencia', label: 'Desistência do cliente', icon: 'ri-user-unfollow-line' },
  { id: 'erro_pedido', label: 'Erro no pedido', icon: 'ri-error-warning-line' },
  { id: 'produto_indisponivel', label: 'Produto indisponível', icon: 'ri-close-circle-line' },
  { id: 'dupla_cobranca', label: 'Dupla cobrança', icon: 'ri-refund-2-line' },
  { id: 'qualidade', label: 'Problema de qualidade', icon: 'ri-dislike-line' },
  { id: 'outros', label: 'Outros', icon: 'ri-more-line' },
];

interface Props {
  pedido: PedidoRecente;
  onClose: () => void;
  onConfirmar: (motivo: string, detalhe: string, autorizadoPor: string) => void;
}

type Etapa = 'motivo' | 'autorizacao' | 'sucesso';

function formatPrice(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export default function EstornoModal({ pedido, onClose, onConfirmar }: Props) {
  const { registrarEvento } = useAuditoria();
  const { user } = useAuth();
  const [etapa, setEtapa] = useState<Etapa>('motivo');
  const [motivoId, setMotivoId] = useState('');
  const [detalhe, setDetalhe] = useState('');
  const [senhaGerente, setSenhaGerente] = useState('');
  const [erroSenha, setErroSenha] = useState('');
  const [tentativas, setTentativas] = useState(0);
  const [bloqueado, setBloqueado] = useState(false);
  const [showSenha, setShowSenha] = useState(false);

  const motivoLabel = MOTIVOS.find((m) => m.id === motivoId)?.label ?? '';

  const handleAvancar = () => {
    if (!motivoId) return;
    if (!detalhe.trim() || detalhe.trim().length < 5) return;
    setEtapa('autorizacao');
  };

  const handleConfirmar = () => {
    if (bloqueado) return;
    if (senhaGerente !== SENHA_GERENTE_MOCK) {
      const novasTentativas = tentativas + 1;
      setTentativas(novasTentativas);
      if (novasTentativas >= 3) {
        setBloqueado(true);
        setErroSenha('Muitas tentativas incorretas. Operação bloqueada. Contate o administrador.');
      } else {
        setErroSenha(`Senha incorreta. ${3 - novasTentativas} tentativa(s) restante(s).`);
      }
      setSenhaGerente('');
      return;
    }
    setErroSenha('');
    registrarEvento({
      tipo: 'estorno_realizado',
      severidade: 'critico',
      usuario: user?.nome ?? 'Operador',
      perfil: user?.perfil ?? 'caixa',
      descricao: `Estorno de ${formatPrice(pedido.total)} — Pedido #${String(pedido.numero).padStart(4,'0')} — ${motivoLabel}`,
      entidade: 'Pedido',
      entidadeId: String(pedido.numero),
      detalhes: detalhe,
    });
    onConfirmar(motivoLabel, detalhe, 'Gerente Autorizado');
    setEtapa('sucesso');
  };

  if (etapa === 'sucesso') {
    const protocolo = `EST${Date.now().toString().slice(-6)}`;
    return (
      <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl w-full max-w-md p-8 text-center">
          <div className="w-16 h-16 flex items-center justify-center bg-emerald-100 rounded-full mx-auto mb-5">
            <i className="ri-checkbox-circle-fill text-3xl text-emerald-500" />
          </div>
          <h2 className="text-lg font-bold text-zinc-900 mb-1">Estorno Registrado</h2>
          <p className="text-sm text-zinc-500 mb-5">
            Pedido #{String(pedido.numero).padStart(4, '0')} — {formatPrice(pedido.total)}
          </p>

          <div className="bg-zinc-50 border border-zinc-200 rounded-xl p-4 text-left space-y-2 mb-5">
            <div className="flex justify-between text-sm">
              <span className="text-zinc-500">Protocolo</span>
              <span className="font-mono font-bold text-zinc-800">{protocolo}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-zinc-500">Motivo</span>
              <span className="font-semibold text-zinc-800">{motivoLabel}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-zinc-500">Valor estornado</span>
              <span className="font-bold text-red-600">{formatPrice(pedido.total)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-zinc-500">Autorizado por</span>
              <span className="font-semibold text-zinc-800">Gerente</span>
            </div>
          </div>

          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-6 text-left">
            <div className="flex items-center gap-2 mb-1">
              <i className="ri-shield-check-line text-amber-600 text-sm" />
              <span className="text-xs font-bold text-amber-800">Registrado no Log de Auditoria</span>
            </div>
            <p className="text-xs text-amber-600">
              Este estorno foi registrado com data, hora, operador e gerente autorizador. Consulte em Auditoria &rsaquo; Pedidos.
            </p>
          </div>

          <button
            onClick={onClose}
            className="w-full py-3 bg-zinc-900 text-white font-bold rounded-xl hover:bg-zinc-800 cursor-pointer transition-colors whitespace-nowrap"
          >
            Concluir
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-md overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-100 bg-red-50">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 flex items-center justify-center bg-red-100 rounded-lg flex-shrink-0">
              <i className="ri-refund-2-line text-red-600 text-base" />
            </div>
            <div>
              <p className="font-bold text-zinc-900 text-sm">Estorno de Pagamento</p>
              <p className="text-xs text-zinc-500">
                Pedido #{String(pedido.numero).padStart(4, '0')} · {formatPrice(pedido.total)}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-red-100 cursor-pointer text-zinc-400">
            <i className="ri-close-line text-lg" />
          </button>
        </div>

        <div className="p-5">
          {/* Resumo do pedido */}
          <div className="bg-zinc-50 border border-zinc-100 rounded-xl p-3 mb-5">
            <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider mb-2">Resumo do pedido</p>
            <div className="space-y-1">
              {pedido.itensDetalhes.slice(0, 4).map((item) => (
                <div key={item.id} className="flex justify-between text-xs">
                  <span className="text-zinc-600 truncate">{item.quantidade}x {item.nome}</span>
                  <span className="font-medium text-zinc-800 flex-shrink-0 ml-2">{formatPrice(item.preco * item.quantidade)}</span>
                </div>
              ))}
              {pedido.itensDetalhes.length > 4 && (
                <p className="text-[10px] text-zinc-400">+{pedido.itensDetalhes.length - 4} outros itens</p>
              )}
            </div>
            <div className="flex justify-between font-bold text-sm mt-2 pt-2 border-t border-zinc-200">
              <span className="text-zinc-700">Total a estornar</span>
              <span className="text-red-600">{formatPrice(pedido.total)}</span>
            </div>
          </div>

          {etapa === 'motivo' && (
            <>
              {/* Motivo */}
              <p className="text-xs font-bold text-zinc-700 mb-2">Motivo do estorno <span className="text-red-500">*</span></p>
              <div className="grid grid-cols-2 gap-2 mb-4">
                {MOTIVOS.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => setMotivoId(m.id)}
                    className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border-2 text-left text-xs font-semibold transition-all cursor-pointer ${
                      motivoId === m.id
                        ? 'border-red-400 bg-red-50 text-red-700'
                        : 'border-zinc-200 text-zinc-600 hover:border-zinc-300'
                    }`}
                  >
                    <i className={`${m.icon} text-sm flex-shrink-0`} />
                    <span className="leading-tight">{m.label}</span>
                  </button>
                ))}
              </div>

              {/* Detalhes */}
              <div className="mb-5">
                <label className="block text-xs font-bold text-zinc-700 mb-1.5">
                  Descrição detalhada <span className="text-red-500">*</span>
                </label>
                <textarea
                  value={detalhe}
                  onChange={(e) => setDetalhe(e.target.value)}
                  rows={3}
                  maxLength={300}
                  placeholder="Descreva o motivo completo do estorno... (mínimo 5 caracteres)"
                  className="w-full text-sm border border-zinc-200 rounded-xl px-3 py-2.5 text-zinc-800 placeholder-zinc-400 focus:outline-none focus:border-red-400 resize-none"
                />
                <p className="text-[10px] text-zinc-400 mt-1 text-right">{detalhe.length}/300</p>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={onClose}
                  className="flex-1 py-2.5 border border-zinc-200 text-zinc-600 font-semibold text-sm rounded-xl cursor-pointer hover:bg-zinc-50 transition-colors whitespace-nowrap"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleAvancar}
                  disabled={!motivoId || detalhe.trim().length < 5}
                  className="flex-1 py-2.5 bg-red-500 hover:bg-red-600 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold text-sm rounded-xl cursor-pointer transition-colors whitespace-nowrap"
                >
                  Continuar
                </button>
              </div>
            </>
          )}

          {etapa === 'autorizacao' && (
            <>
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 mb-4">
                <div className="flex items-center gap-2 mb-1">
                  <i className="ri-shield-keyhole-line text-amber-600 text-sm" />
                  <p className="text-xs font-bold text-amber-800">Autorização do Gerente obrigatória</p>
                </div>
                <p className="text-xs text-amber-600">
                  Esta operação requer a senha do gerente para ser concluída e será registrada na auditoria.
                </p>
              </div>

              <div className="bg-zinc-50 rounded-xl p-3 mb-4">
                <p className="text-[10px] font-semibold text-zinc-500 mb-1">Motivo selecionado</p>
                <p className="text-sm font-bold text-zinc-800">{motivoLabel}</p>
                <p className="text-xs text-zinc-500 mt-1 line-clamp-2">{detalhe}</p>
              </div>

              <div className="mb-4">
                <label className="block text-xs font-bold text-zinc-700 mb-1.5">
                  Senha do Gerente <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <input
                    type={showSenha ? 'text' : 'password'}
                    value={senhaGerente}
                    onChange={(e) => { setSenhaGerente(e.target.value); setErroSenha(''); }}
                    onKeyDown={(e) => e.key === 'Enter' && handleConfirmar()}
                    placeholder="Digite a senha do gerente"
                    disabled={bloqueado}
                    autoFocus
                    className="w-full text-sm border border-zinc-200 rounded-xl px-4 py-3 pr-10 text-zinc-800 placeholder-zinc-400 focus:outline-none focus:border-red-400 disabled:opacity-50"
                  />
                  <button
                    onClick={() => setShowSenha((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 flex items-center justify-center text-zinc-400 hover:text-zinc-600 cursor-pointer"
                  >
                    <i className={showSenha ? 'ri-eye-off-line' : 'ri-eye-line'} />
                  </button>
                </div>
                {erroSenha && (
                  <p className="text-xs text-red-500 font-semibold mt-1.5 flex items-center gap-1">
                    <i className="ri-error-warning-line" />
                    {erroSenha}
                  </p>
                )}
                <p className="text-[10px] text-zinc-400 mt-1">Demo: senha "1234"</p>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => setEtapa('motivo')}
                  className="flex-1 py-2.5 border border-zinc-200 text-zinc-600 font-semibold text-sm rounded-xl cursor-pointer hover:bg-zinc-50 transition-colors whitespace-nowrap"
                >
                  Voltar
                </button>
                <button
                  onClick={handleConfirmar}
                  disabled={!senhaGerente || bloqueado}
                  className="flex-1 py-2.5 bg-red-600 hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold text-sm rounded-xl cursor-pointer transition-colors whitespace-nowrap"
                >
                  <i className="ri-refund-2-line mr-1.5" />
                  Confirmar Estorno
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
