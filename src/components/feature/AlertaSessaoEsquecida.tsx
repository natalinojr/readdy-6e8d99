import { useState } from 'react';
import { useSessaoEsquecida } from '@/hooks/useSessaoFaturamento';
import { useSessao } from '@/contexts/SessaoContext';
import FecharSessaoModal from '@/pages/pdv/caixa/components/FecharSessaoModal';

export default function AlertaSessaoEsquecida() {
  const { sessaoEsquecida, dismiss } = useSessaoEsquecida();
  const { caixa } = useSessao();
  const [showFecharSessao, setShowFecharSessao] = useState(false);

  if (!sessaoEsquecida) return null;

  const caixaAberto = caixa !== null;

  const handleFecharSessaoClose = () => {
    setShowFecharSessao(false);
    // Dismiss o alerta — se a sessão foi fechada com sucesso, o contexto
    // já atualizou o estado; se não foi, o alerta continua aparecendo na próxima renderização
    dismiss();
  };

  return (
    <>
      <div className="mb-4 bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3">
        <div className="w-9 h-9 flex items-center justify-center rounded-lg bg-red-100 flex-shrink-0">
          <i className="ri-alarm-warning-line text-red-600 text-lg" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-red-800">
            Sessão {sessaoEsquecida.numero} aberta sem vendas há {sessaoEsquecida.horasAberta}h
          </p>
          <p className="text-xs text-red-700 mt-0.5">
            Esta sessão foi aberta em {sessaoEsquecida.abertaEm} e passou da meia-noite sem registrar nenhuma
            venda nas últimas 4 horas. Provavelmente houve um problema ou alguém esqueceu o sistema aberto.
          </p>

          {/* Aviso de caixa aberto */}
          {caixaAberto && (
            <div className="mt-3 flex items-start gap-2 px-3 py-2.5 bg-amber-50 border border-amber-200 rounded-lg">
              <i className="ri-safe-2-line text-amber-600 text-sm mt-px flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-bold text-amber-800">Caixa ainda está aberto</p>
                <p className="text-xs text-amber-700 mt-0.5">
                  É obrigatório fechar o caixa antes de encerrar a sessão. O checklist de fechamento irá guiá-lo.
                </p>
              </div>
            </div>
          )}

          <div className="flex items-center gap-2 mt-3">
            <button
              onClick={() => setShowFecharSessao(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white text-xs font-bold rounded-lg cursor-pointer transition-colors whitespace-nowrap"
            >
              <i className="ri-door-closed-line" />
              Fechar sessão agora
            </button>
            <button
              onClick={dismiss}
              className="px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-100 rounded-lg cursor-pointer transition-colors whitespace-nowrap"
            >
              Ignorar por agora
            </button>
          </div>
        </div>
      </div>

      {/* Modal completo com checklist — mesmas regras do PDV Caixa */}
      {showFecharSessao && (
        <FecharSessaoModal onClose={handleFecharSessaoClose} />
      )}
    </>
  );
}