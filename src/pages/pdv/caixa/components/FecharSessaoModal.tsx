import { useState, useEffect } from 'react';
import { CheckCircle } from 'lucide-react';
import { useSessao } from '@/contexts/SessaoContext';
import { invokeWithAuth } from '@/lib/supabase';
import FechamentoCaixaModal from './FechamentoCaixaModal';
import { useAuditoria } from '@/contexts/AuditoriaContext';
import { useAuth } from '@/contexts/AuthContext';

interface Props {
  onClose: () => void;
}

interface PedidoPendente {
  id: string;
  numero: string;
  motivo: 'nao_entregue' | 'nao_pago';
}

interface VerificacaoSessao {
  caixaAberto: boolean;
  pedidosPendentes: PedidoPendente[];
  mesasAbertas: number;
  carregando: boolean;
}

export default function FecharSessaoModal({ onClose }: Props) {
  const { sessao, caixa, fecharSessao } = useSessao();
  const { registrarEvento } = useAuditoria();
  const { user } = useAuth();

  const [etapa, setEtapa] = useState<'checklist' | 'concluido'>('checklist');
  const [fechando, setFechando] = useState(false);
  const [erroFechar, setErroFechar] = useState('');
  const [showFechamentoCaixa, setShowFechamentoCaixa] = useState(false);

  const [verif, setVerif] = useState<VerificacaoSessao>({
    caixaAberto: caixa !== null,
    pedidosPendentes: [],
    mesasAbertas: 0,
    carregando: true,
  });

  useEffect(() => {
    if (!sessao?.id || !user?.tenantId) {
      setVerif((prev) => ({ ...prev, carregando: false }));
      return;
    }

    const verificar = async () => {
      try {
        const { data: efData, error: efError } = await invokeWithAuth<{
          pedidosPendentes: { id: string; numero: string; motivo: string }[];
          mesasAbertas: number;
          totalPedidos: number;
        }>('check-session-pending', {
          body: {
            session_id: sessao.id,
            tenant_id: user.tenantId,
          },
        });

        if (efError || efData?.error) {
          setVerif((prev) => ({ ...prev, carregando: false }));
          return;
        }

        setVerif({
          caixaAberto: caixa !== null,
          pedidosPendentes: (efData?.pedidosPendentes ?? []).map((p) => ({
            id: p.id,
            numero: p.numero,
            motivo: p.motivo as 'nao_entregue' | 'nao_pago',
          })),
          mesasAbertas: efData?.mesasAbertas ?? 0,
          carregando: false,
        });
      } catch {
        setVerif((prev) => ({ ...prev, carregando: false }));
      }
    };

    verificar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessao?.id, user?.tenantId]);

  // Condições do checklist
  const caixaOk = !verif.caixaAberto;
  const pedidosOk = verif.pedidosPendentes.length === 0;
  const mesasOk = verif.mesasAbertas === 0;

  const podeFechar = caixaOk && pedidosOk && mesasOk && !verif.carregando;

  const handleFechar = async () => {
    setFechando(true);
    setErroFechar('');
    try {
      localStorage.removeItem('pdv_rascunhos');

      const duracaoMin = sessao?.dataRef
        ? Math.round((Date.now() - sessao.dataRef.getTime()) / 60000)
        : 0;

      registrarEvento({
        tipo: 'sessao_fechada',
        severidade: 'info',
        usuario: user?.nome ?? 'Operador',
        perfil: user?.perfil ?? 'operador',
        descricao: `Sessão ${sessao?.numero ?? ''} encerrada pelo operador`,
        entidade: 'Sessão',
        entidadeId: sessao?.id ?? sessao?.numero ?? '—',
        detalhes: `Sessão iniciada às ${sessao?.iniciadaEm ?? '—'}. Duração: ${duracaoMin > 0 ? `${duracaoMin} min` : 'N/A'}.`,
      });

      await fecharSessao();
      setEtapa('concluido');
      setTimeout(() => { onClose(); }, 1500);
    } catch (e: any) {
      console.error('[FecharSessaoModal] error:', e);
      setErroFechar(e?.message ?? 'Erro ao fechar a sessão.');
      setFechando(false);
    }
  };

  if (etapa === 'concluido') {
    return (
      <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center">
        <div className="bg-white rounded-2xl p-8 w-full max-w-xs flex flex-col items-center gap-4 text-center">
          <div className="w-16 h-16 flex items-center justify-center bg-emerald-500 rounded-full">
            <CheckCircle size={32} className="text-white" />
          </div>
          <div>
            <p className="text-xl font-black text-zinc-900">Sessão encerrada!</p>
            <p className="text-sm text-zinc-500 mt-1">Operação do dia finalizada com sucesso.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-sm shadow-xl overflow-hidden max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-100">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 flex items-center justify-center bg-red-500 rounded-lg">
              <i className="ri-stop-circle-line text-white text-base" />
            </div>
            <h3 className="text-sm font-bold text-zinc-900">Fechar Sessão</h3>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg bg-zinc-200 hover:bg-zinc-300 text-zinc-800 cursor-pointer transition-colors"
          >
            <i className="ri-close-line text-lg" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Info da sessão */}
          {sessao && (
            <div className="bg-zinc-50 rounded-xl p-3 flex items-center gap-3">
              <div className="w-8 h-8 flex items-center justify-center bg-zinc-800 rounded-lg">
                <i className="ri-time-line text-amber-400 text-sm" />
              </div>
              <div>
                <p className="text-xs font-bold text-zinc-800">{sessao.numero}</p>
                <p className="text-[10px] text-zinc-500">Iniciada às {sessao.iniciadaEm}</p>
              </div>
            </div>
          )}

          {/* Checklist */}
          <div>
            <p className="text-xs font-bold text-zinc-600 uppercase tracking-wider mb-3">
              Condições para fechar sessão
            </p>

            <div className="space-y-2">
              {/* Caixa */}
              <ChecklistItem
                ok={caixaOk}
                label="Caixa fechado"
                detalhe={
                  verif.carregando
                    ? 'Verificando...'
                    : verif.caixaAberto
                      ? 'O caixa ainda está aberto'
                      : 'Caixa fechado'
                }
                bloqueante
                acaoLabel={verif.caixaAberto ? 'Fechar caixa' : undefined}
                onAcao={verif.caixaAberto ? () => setShowFechamentoCaixa(true) : undefined}
              />

              {/* Pedidos pendentes */}
              <ChecklistItem
                ok={pedidosOk}
                label="Todos os pedidos entregues e pagos"
                detalhe={
                  verif.carregando
                    ? 'Verificando pedidos...'
                    : verif.pedidosPendentes.length > 0
                      ? `${verif.pedidosPendentes.length} pedido${verif.pedidosPendentes.length !== 1 ? 's' : ''} pendente${verif.pedidosPendentes.length !== 1 ? 's' : ''}
${verif.pedidosPendentes
                          .map((p) => `${p.numero} — ${p.motivo === 'nao_entregue' ? 'nao entregue (cozinha)' : 'nao pago'}`)
                          .join('\n')}`
                      : 'Nenhum pedido pendente'
                }
                bloqueante
              />

              {/* Mesas */}
              <ChecklistItem
                ok={mesasOk}
                label="Todas as mesas encerradas"
                detalhe={
                  verif.carregando
                    ? 'Verificando mesas...'
                    : verif.mesasAbertas > 0
                      ? `${verif.mesasAbertas} mesa${verif.mesasAbertas !== 1 ? 's' : ''} ainda aberta${verif.mesasAbertas !== 1 ? 's' : ''}`
                      : 'Nenhuma mesa aberta'
                }
                bloqueante
              />
            </div>
          </div>

          {/* Aviso de bloqueio */}
          {!podeFechar && (
            <div className="flex items-start gap-2 px-3 py-2.5 bg-red-50 border border-red-100 rounded-xl">
              <div className="w-4 h-4 flex items-center justify-center text-red-500 mt-0.5 flex-shrink-0">
                <i className="ri-alert-line text-sm" />
              </div>
              <p className="text-xs text-red-700">
                {verif.caixaAberto
                  ? 'Feche o caixa antes de encerrar a sessão.'
                  : verif.pedidosPendentes.length > 0
                    ? 'Existem pedidos pendentes na cozinha ou não pagos. Resolva-os antes de fechar.'
                    : verif.mesasAbertas > 0
                      ? 'Encerre todas as mesas antes de fechar a sessão.'
                      : 'Resolva os itens pendentes antes de fechar a sessão.'}
              </p>
            </div>
          )}

          {erroFechar && (
            <div className="flex items-start gap-2 px-3 py-2.5 bg-red-50 border border-red-200 rounded-xl">
              <div className="w-4 h-4 flex items-center justify-center text-red-500 mt-0.5 flex-shrink-0">
                <i className="ri-error-warning-line text-sm" />
              </div>
              <p className="text-xs text-red-700 font-medium">{erroFechar}</p>
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
              onClick={handleFechar}
              disabled={!podeFechar || fechando}
              className="flex-1 py-2.5 bg-red-500 hover:bg-red-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-bold rounded-xl cursor-pointer whitespace-nowrap transition-colors flex items-center justify-center gap-2"
            >
              {fechando ? (
                <>
                  <i className="ri-loader-4-line animate-spin text-base" />
                  Fechando...
                </>
              ) : (
                'Fechar Sessão'
              )}
            </button>
          </div>
        </div>
      </div>

      {showFechamentoCaixa && (
        <FechamentoCaixaModal
          historico={[]}
          numPedidos={0}
          totalVendas={0}
          onClose={() => setShowFechamentoCaixa(false)}
        />
      )}
    </div>
  );
}

/* ── Sub-componente de checklist ── */
function ChecklistItem({
  ok,
  label,
  detalhe,
  bloqueante,
  acaoLabel,
  onAcao,
}: {
  ok: boolean;
  label: string;
  detalhe: string;
  bloqueante?: boolean;
  acaoLabel?: string;
  onAcao?: () => void;
}) {
  return (
    <div
      className={`flex items-center gap-3 p-3 rounded-xl border ${
        ok
          ? 'bg-emerald-50 border-emerald-100'
          : bloqueante
            ? 'bg-red-50 border-red-200'
            : 'bg-red-50 border-red-100'
      }`}
    >
      <div
        className={`w-6 h-6 flex items-center justify-center rounded-full flex-shrink-0 ${
          ok ? 'bg-emerald-500' : 'bg-red-400'
        }`}
      >
        <i className={`text-white text-xs ${ok ? 'ri-check-line' : 'ri-close-line'}`} />
      </div>
      <div className="flex-1 min-w-0">
        <p className={`text-xs font-semibold ${ok ? 'text-emerald-800' : 'text-red-800'}`}>
          {label}
        </p>
        {detalhe && (
          <p className={`text-[10px] mt-0.5 whitespace-pre-line ${ok ? 'text-emerald-600' : 'text-red-600'}`}>
            {detalhe}
          </p>
        )}
      </div>
      {!ok && acaoLabel && onAcao && (
        <button
          onClick={onAcao}
          className="flex-shrink-0 flex items-center gap-1 px-2.5 py-1.5 bg-red-600 hover:bg-red-700 text-white text-[10px] font-bold rounded-lg cursor-pointer transition-colors whitespace-nowrap"
        >
          <i className="ri-door-lock-line text-xs" />
          {acaoLabel}
        </button>
      )}
    </div>
  );
}