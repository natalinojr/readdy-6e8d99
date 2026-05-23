import { useState } from 'react';
import { Play } from 'lucide-react';
import { useSessao, gerarNumeroSessaoStr } from '../../../../contexts/SessaoContext';
import { useAuditoria } from '@/contexts/AuditoriaContext';
import { useAuth } from '@/contexts/AuthContext';

interface Props {
  onClose: () => void;
}

export default function IniciarSessaoModal({ onClose }: Props) {
  const { iniciarSessao } = useSessao();
  const { user } = useAuth();
  const { registrarEvento } = useAuditoria();
  const [confirming, setConfirming] = useState(false);

  const now = new Date();
  const previewNumero = gerarNumeroSessaoStr(now, 1);

  const handleIniciar = async () => {
    setConfirming(true);
    try {
      await iniciarSessao();
      registrarEvento({
        tipo: 'sessao_aberta',
        severidade: 'info',
        usuario: user?.nome ?? 'Operador',
        perfil: user?.perfil ?? 'operador',
        descricao: `Sessão de operação iniciada por ${user?.nome ?? 'Operador'}`,
        entidade: 'sessao',
        entidadeId: previewNumero,
      });
      onClose();
    } catch (e) {
      console.error('[IniciarSessaoModal] error:', e);
      setConfirming(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-sm shadow-xl overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-br from-amber-500 to-orange-500 px-6 py-8 text-center">
          <div className="w-14 h-14 flex items-center justify-center bg-black/30 rounded-2xl mx-auto mb-3">
            <Play size={28} className="text-white" fill="white" />
          </div>
          <h2 className="text-xl font-black text-white">Iniciar Nova Sessão</h2>
          <p className="text-amber-100 text-sm mt-1">O dia de operação começa aqui</p>
        </div>

        <div className="p-6 space-y-4">
          {/* Preview número */}
          <div className="bg-zinc-50 rounded-xl p-4 border border-zinc-100">
            <p className="text-xs text-zinc-500 mb-1 font-medium">Número da sessão que será gerado</p>
            <p className="text-2xl font-black text-zinc-800 tracking-widest">{previewNumero}</p>
            <p className="text-[10px] text-zinc-400 mt-1">
              S + ddmmaa + sequência — reinicia todo mês
            </p>
          </div>

          {/* Informações */}
          <div className="space-y-2">
            {[
              { icon: 'ri-safe-2-line', label: 'Permite abertura de caixa com valor inicial' },
              { icon: 'ri-restaurant-2-line', label: 'Cozinha pode ser ativada no KDS' },
              { icon: 'ri-file-list-3-line', label: 'Pedidos numerados a partir desta sessão' },
              { icon: 'ri-group-line', label: 'PDV Garçom e Autoatendimento liberados' },
              { icon: 'ri-table-line', label: 'Pedidos na mesa liberados' },
            ].map(({ icon, label }) => (
              <div key={label} className="flex items-center gap-3">
                <div className="w-6 h-6 flex items-center justify-center text-amber-500 flex-shrink-0">
                  <i className={`${icon} text-base`} />
                </div>
                <span className="text-xs text-zinc-600">{label}</span>
              </div>
            ))}
          </div>

          <div className="flex gap-3 pt-2">
            <button
              onClick={onClose}
              className="flex-1 py-2.5 border border-zinc-200 text-zinc-600 text-sm font-semibold rounded-xl hover:bg-zinc-50 cursor-pointer whitespace-nowrap transition-colors"
            >
              Cancelar
            </button>
            <button
              onClick={handleIniciar}
              disabled={confirming}
              className="flex-1 py-2.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-60 text-white text-sm font-bold rounded-xl cursor-pointer whitespace-nowrap transition-colors flex items-center justify-center gap-2"
            >
              {confirming ? (
                <>
                  <i className="ri-loader-4-line animate-spin text-base" />
                  Iniciando...
                </>
              ) : (
                <>
                  <i className="ri-play-fill text-base" />
                  Iniciar Sessão
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
