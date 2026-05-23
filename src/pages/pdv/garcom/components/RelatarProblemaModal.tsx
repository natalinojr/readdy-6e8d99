import { useState } from 'react';
import { useAprovacoes, type TipoProblema, type ResolucaoDesejada } from '../../../../contexts/AprovacoesContext';
import { useAuth } from '../../../../contexts/AuthContext';
import type { CarrinhoItem } from '../../../../contexts/PDVContext';

interface Props {
  item: CarrinhoItem;
  mesaNome: string;
  onClose: () => void;
}

const tiposProblema: { id: TipoProblema; label: string; icon: string }[] = [
  { id: 'qualidade', label: 'Qualidade', icon: 'ri-emotion-unhappy-line' },
  { id: 'item_errado', label: 'Item errado', icon: 'ri-exchange-line' },
  { id: 'nao_chegou', label: 'Não chegou', icon: 'ri-eye-off-line' },
  { id: 'quantidade', label: 'Quantidade', icon: 'ri-scales-2-line' },
  { id: 'alergia', label: 'Alergia', icon: 'ri-heart-pulse-line' },
  { id: 'outro', label: 'Outro', icon: 'ri-question-line' },
];

const resolucoes: { id: ResolucaoDesejada; label: string; icon: string; color: string }[] = [
  { id: 'substituicao', label: 'Substituir item', icon: 'ri-refresh-line', color: 'border-amber-400 bg-amber-50 text-amber-700' },
  { id: 'reembolso', label: 'Reembolso', icon: 'ri-money-dollar-circle-line', color: 'border-green-400 bg-green-50 text-green-700' },
  { id: 'desconto', label: 'Desconto', icon: 'ri-percent-line', color: 'border-teal-400 bg-teal-50 text-teal-700' },
  { id: 'registro', label: 'Só registrar', icon: 'ri-file-text-line', color: 'border-zinc-300 bg-zinc-50 text-zinc-600' },
];

export default function RelatarProblemaModal({ item, mesaNome, onClose }: Props) {
  const { addSolicitacao } = useAprovacoes();
  const { user } = useAuth();
  const [tipo, setTipo] = useState<TipoProblema | null>(null);
  const [resolucao, setResolucao] = useState<ResolucaoDesejada | null>(null);
  const [descricao, setDescricao] = useState('');
  const [urgente, setUrgente] = useState(false);
  const [enviado, setEnviado] = useState(false);

  const podeEnviar = tipo && resolucao && descricao.trim().length >= 5;

  const handleEnviar = () => {
    if (!podeEnviar) return;
    addSolicitacao({
      tipo: 'problema_item',
      tipoProblema: tipo!,
      resolucaoDesejada: resolucao!,
      mesaNome,
      garcomNome: user?.nome ?? 'Garçom',
      itemNome: item.nome,
      descricao: descricao.trim(),
      urgente,
    });
    setEnviado(true);
    setTimeout(onClose, 2500);
  };

  if (enviado) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
        <div className="bg-white rounded-2xl p-8 w-full max-w-sm text-center">
          <div className="w-16 h-16 flex items-center justify-center bg-amber-100 rounded-full mx-auto mb-4">
            <i className="ri-send-check-line text-3xl text-amber-500" />
          </div>
          <h3 className="text-base font-bold text-zinc-900 mb-1">Solicitação Enviada!</h3>
          <p className="text-sm text-zinc-500">O gerente será notificado para aprovação.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-md overflow-hidden flex flex-col" style={{ maxHeight: 'min(92dvh, 92vh)' }}>
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-100 flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 flex items-center justify-center bg-red-100 rounded-lg flex-shrink-0">
              <i className="ri-alert-line text-red-500 text-sm" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-zinc-900">Relatar Problema</h2>
              <p className="text-[11px] text-zinc-400 truncate max-w-[200px]">{item.nome} · {mesaNome}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-lg bg-zinc-100 hover:bg-zinc-200 cursor-pointer text-zinc-600 transition-colors"
          >
            <i className="ri-close-line text-sm" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">

          {/* Item preview */}
          <div className="flex items-center gap-3 p-3 bg-zinc-50 rounded-xl border border-zinc-200">
            <div className="w-8 h-8 flex items-center justify-center bg-red-100 rounded-lg flex-shrink-0">
              <i className="ri-restaurant-line text-red-500 text-sm" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-bold text-zinc-800 truncate">{item.nome}</p>
              {item.opcoes.length > 0 && (
                <p className="text-[10px] text-zinc-400 truncate">{item.opcoes.map((o) => o.opcaoNome).join(' · ')}</p>
              )}
            </div>
            <span className="text-xs font-bold text-zinc-600 flex-shrink-0">
              {item.quantidade}x
            </span>
          </div>

          {/* Tipo do problema */}
          <div>
            <p className="text-xs font-bold text-zinc-700 mb-2">Qual é o problema?</p>
            <div className="grid grid-cols-3 gap-2">
              {tiposProblema.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setTipo(t.id)}
                  className={`flex flex-col items-center gap-1 py-2.5 rounded-xl border-2 cursor-pointer transition-all ${
                    tipo === t.id
                      ? 'border-red-400 bg-red-50 text-red-700'
                      : 'border-zinc-200 text-zinc-500 hover:border-zinc-300'
                  }`}
                >
                  <i className={`${t.icon} text-base`} />
                  <span className="text-[10px] font-semibold leading-tight text-center">{t.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Resolução desejada */}
          <div>
            <p className="text-xs font-bold text-zinc-700 mb-2">O cliente quer...</p>
            <div className="grid grid-cols-2 gap-2">
              {resolucoes.map((r) => (
                <button
                  key={r.id}
                  onClick={() => setResolucao(r.id)}
                  className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border-2 cursor-pointer transition-all ${
                    resolucao === r.id ? r.color + ' border-opacity-100' : 'border-zinc-200 text-zinc-500 hover:border-zinc-300'
                  }`}
                >
                  <i className={`${r.icon} text-sm flex-shrink-0`} />
                  <span className="text-[11px] font-semibold leading-tight">{r.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Descrição */}
          <div>
            <p className="text-xs font-bold text-zinc-700 mb-2">Descreva o problema</p>
            <textarea
              value={descricao}
              onChange={(e) => setDescricao(e.target.value.slice(0, 300))}
              placeholder="Explique o que aconteceu para o gerente avaliar..."
              rows={3}
              className="w-full border border-zinc-200 rounded-xl px-3 py-2.5 text-sm text-zinc-800 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-red-300 resize-none"
            />
            <p className="text-[10px] text-zinc-400 text-right mt-0.5">{descricao.length}/300</p>
          </div>

          {/* Urgente */}
          <button
            onClick={() => setUrgente((v) => !v)}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border-2 cursor-pointer transition-all ${
              urgente ? 'border-red-400 bg-red-50' : 'border-zinc-200 bg-zinc-50 hover:border-zinc-300'
            }`}
          >
            <div className={`w-5 h-5 flex items-center justify-center rounded border-2 flex-shrink-0 transition-colors ${
              urgente ? 'bg-red-500 border-red-500' : 'border-zinc-300 bg-white'
            }`}>
              {urgente && <i className="ri-check-line text-white text-[10px]" />}
            </div>
            <div className="flex-1 text-left">
              <p className={`text-xs font-bold ${urgente ? 'text-red-700' : 'text-zinc-700'}`}>
                <i className="ri-alarm-warning-line mr-1" />
                Urgente — cliente agitado
              </p>
              <p className={`text-[10px] ${urgente ? 'text-red-500' : 'text-zinc-400'}`}>Notifica o gerente com prioridade alta</p>
            </div>
          </button>
        </div>

        {/* Footer */}
        <div className="px-4 pb-5 pt-3 border-t border-zinc-100 bg-white flex-shrink-0">
          <button
            onClick={handleEnviar}
            disabled={!podeEnviar}
            className="w-full py-3.5 bg-red-500 hover:bg-red-600 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold text-sm rounded-xl cursor-pointer whitespace-nowrap transition-colors flex items-center justify-center gap-2"
          >
            <i className="ri-send-plane-line" />
            Enviar para Aprovação
          </button>
          {!podeEnviar && (
            <p className="text-[10px] text-zinc-400 text-center mt-1.5">Preencha o tipo, resolução e descrição</p>
          )}
        </div>
      </div>
    </div>
  );
}
