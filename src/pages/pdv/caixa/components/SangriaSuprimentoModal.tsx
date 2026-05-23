import { useState } from 'react';
import { invokeWithAuth } from '@/lib/supabase';
import { useSessao } from '@/contexts/SessaoContext';
import { useAuth } from '@/contexts/AuthContext';
import { useAuditoria } from '@/contexts/AuditoriaContext';

type TipoMovimento = 'sangria' | 'suprimento';

interface MovimentoCaixa {
  tipo: TipoMovimento;
  valor: number;
  motivo: string;
  hora: string;
}

interface SangriaSuprimentoModalProps {
  tipoInicial?: TipoMovimento;
  historico: MovimentoCaixa[];
  onRegistrar: (mov: MovimentoCaixa) => void;
  onClose: () => void;
}

type MotivoRetirada = 'Sangria' | 'Fornecedor' | 'Freelancer' | 'Troco' | 'Outro';
type MotivoAdicao = 'Troco' | 'Outros';

const fmt = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

export default function SangriaSuprimentoModal({
  tipoInicial = 'sangria',
  historico,
  onRegistrar,
  onClose,
}: SangriaSuprimentoModalProps) {
  const { caixa } = useSessao();
  const { user } = useAuth();
  const { registrarEvento } = useAuditoria();

  const [tipo, setTipo] = useState<TipoMovimento>(tipoInicial);
  const [valor, setValor] = useState('');
  const [motivoRetirada, setMotivoRetirada] = useState<MotivoRetirada | ''>('');
  const [motivoAdicao, setMotivoAdicao] = useState<MotivoAdicao | ''>('');
  const [nomeFornecedor, setNomeFornecedor] = useState('');
  const [nomeFreelancer, setNomeFreelancer] = useState('');
  const [motivoOutro, setMotivoOutro] = useState('');
  const [erro, setErro] = useState('');
  const [confirmado, setConfirmado] = useState(false);
  const [salvando, setSalvando] = useState(false);

  const motivoFinal = (): string => {
    if (tipo === 'suprimento') return motivoAdicao;
    if (motivoRetirada === 'Fornecedor') return nomeFornecedor ? `Fornecedor: ${nomeFornecedor}` : '';
    if (motivoRetirada === 'Freelancer') return nomeFreelancer ? `Freelancer: ${nomeFreelancer}` : '';
    if (motivoRetirada === 'Outro') return motivoOutro;
    return motivoRetirada;
  };

  const handleRegistrar = async () => {
    const v = parseFloat(valor.replace(',', '.'));
    if (isNaN(v) || v <= 0) { setErro('Informe um valor válido.'); return; }
    const mf = motivoFinal();
    if (!mf.trim()) { setErro('Informe o motivo da movimentação.'); return; }
    if (motivoRetirada === 'Fornecedor' && !nomeFornecedor.trim()) { setErro('Informe o nome do fornecedor.'); return; }
    if (motivoRetirada === 'Freelancer' && !nomeFreelancer.trim()) { setErro('Informe o nome do freelancer.'); return; }

    setSalvando(true);
    const hora = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

    // Persist to DB via Edge Function
    if (caixa?.id && user?.tenantId) {
      const { data, error } = await invokeWithAuth('order-write', {
        body: {
          action: 'add_cash_movement',
          cash_register_id: caixa.id,
          tenant_id: user.tenantId,
          type: tipo === 'sangria' ? 'out' : 'in',
          amount: v,
          reason: mf,
        },
      });

      if (error || !data) {
        console.error('[SangriaSuprimentoModal] persist error:', error?.message ?? data);
        setErro('Erro ao registrar no banco. Tente novamente.');
        setSalvando(false);
        return;
      }
    }

    // Registrar auditoria
    registrarEvento({
      tipo: tipo === 'sangria' ? 'sangria' : 'suprimento',
      severidade: tipo === 'sangria' && v >= 200 ? 'aviso' : 'info',
      usuario: user?.nome ?? 'Operador',
      perfil: user?.perfil ?? 'operador',
      descricao: tipo === 'sangria'
        ? `Sangria de ${fmt(v)} — motivo: ${mf}`
        : `Suprimento de ${fmt(v)} — motivo: ${mf}`,
      entidade: 'Caixa',
      entidadeId: caixa?.id ?? '—',
      detalhes: `Valor: ${fmt(v)} | Motivo: ${mf} | Hora: ${hora}`,
      depois: { valor: v, motivo: mf, tipo },
    });

    onRegistrar({ tipo, valor: v, motivo: mf, hora });
    setSalvando(false);
    setConfirmado(true);
    setTimeout(onClose, 1400);
  };

  const handleTipo = (t: TipoMovimento) => {
    setTipo(t);
    setMotivoRetirada('');
    setMotivoAdicao('');
    setNomeFornecedor('');
    setNomeFreelancer('');
    setMotivoOutro('');
    setErro('');
  };

  const totalRetiradas = historico.filter((m) => m.tipo === 'sangria').reduce((s, m) => s + m.valor, 0);
  const totalAdicoes = historico.filter((m) => m.tipo === 'suprimento').reduce((s, m) => s + m.valor, 0);

  if (confirmado) {
    const v = parseFloat(valor.replace(',', '.')) || 0;
    return (
      <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center">
        <div className="bg-white rounded-2xl p-8 w-full max-w-xs flex flex-col items-center gap-4 text-center">
          <div className={`w-16 h-16 flex items-center justify-center rounded-full ${tipo === 'sangria' ? 'bg-red-100' : 'bg-emerald-100'}`}>
            <i className={`${tipo === 'sangria' ? 'ri-arrow-down-circle-line text-red-500' : 'ri-arrow-up-circle-line text-emerald-500'} text-3xl`} />
          </div>
          <div>
            <p className="text-lg font-black text-zinc-900">
              {tipo === 'sangria' ? 'Retirada registrada!' : 'Adição registrada!'}
            </p>
            <p className="text-2xl font-black mt-1 text-zinc-800">{fmt(v)}</p>
            <p className="text-xs text-zinc-400 mt-1">{motivoFinal()}</p>
            <p className="text-[10px] text-emerald-600 mt-1 font-semibold">Salvo no banco ✓</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-md overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-100">
          <h2 className="text-sm font-bold text-zinc-900">Movimentação de Caixa</h2>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-zinc-100 cursor-pointer text-zinc-400">
            <i className="ri-close-line text-base" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          {/* Tipo */}
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => handleTipo('sangria')}
              className={`flex items-center justify-center gap-2.5 py-3.5 rounded-xl border-2 cursor-pointer transition-all ${tipo === 'sangria' ? 'border-red-400 bg-red-50' : 'border-zinc-100 bg-zinc-50 hover:border-zinc-200'}`}
            >
              <div className={`w-8 h-8 flex items-center justify-center rounded-lg ${tipo === 'sangria' ? 'bg-red-100' : 'bg-zinc-200'}`}>
                <i className={`ri-arrow-down-line text-base font-bold ${tipo === 'sangria' ? 'text-red-600' : 'text-zinc-500'}`} />
              </div>
              <div className="text-left">
                <p className={`text-xs font-bold ${tipo === 'sangria' ? 'text-red-700' : 'text-zinc-600'}`}>Retirada de dinheiro</p>
                <p className="text-[10px] text-zinc-400">Saída do caixa</p>
              </div>
            </button>
            <button
              onClick={() => handleTipo('suprimento')}
              className={`flex items-center justify-center gap-2.5 py-3.5 rounded-xl border-2 cursor-pointer transition-all ${tipo === 'suprimento' ? 'border-emerald-400 bg-emerald-50' : 'border-zinc-100 bg-zinc-50 hover:border-zinc-200'}`}
            >
              <div className={`w-8 h-8 flex items-center justify-center rounded-lg ${tipo === 'suprimento' ? 'bg-emerald-100' : 'bg-zinc-200'}`}>
                <i className={`ri-arrow-up-line text-base font-bold ${tipo === 'suprimento' ? 'text-emerald-600' : 'text-zinc-500'}`} />
              </div>
              <div className="text-left">
                <p className={`text-xs font-bold ${tipo === 'suprimento' ? 'text-emerald-700' : 'text-zinc-600'}`}>Adição de dinheiro</p>
                <p className="text-[10px] text-zinc-400">Entrada no caixa</p>
              </div>
            </button>
          </div>

          {/* Valor */}
          <div>
            <label className="block text-xs font-semibold text-zinc-600 mb-1.5">Valor (R$)</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 text-sm font-semibold">R$</span>
              <input
                type="number" min="0.01" step="0.01" value={valor}
                onChange={(e) => { setValor(e.target.value); setErro(''); }}
                placeholder="0,00"
                className="w-full pl-9 pr-4 py-3 text-lg font-bold border border-zinc-200 rounded-xl text-zinc-800 focus:outline-none focus:border-amber-400"
              />
            </div>
            <div className="flex gap-2 mt-2">
              {[50, 100, 200, 500].map((v) => (
                <button key={v} onClick={() => setValor(String(v))}
                  className="flex-1 py-1.5 text-xs font-semibold bg-zinc-100 text-zinc-600 rounded-lg hover:bg-zinc-200 cursor-pointer transition-colors whitespace-nowrap">
                  R$ {v}
                </button>
              ))}
            </div>
          </div>

          {/* Motivo */}
          <div>
            <label className="block text-xs font-semibold text-zinc-600 mb-2">Motivo <span className="text-red-400">*</span></label>

            {tipo === 'sangria' ? (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 mb-3">
                  {(['Sangria', 'Fornecedor', 'Freelancer', 'Troco', 'Outro'] as MotivoRetirada[]).map((m) => (
                    <button key={m} onClick={() => { setMotivoRetirada(m); setErro(''); }}
                      className={`py-2 px-2 text-xs font-medium rounded-lg cursor-pointer transition-colors text-center ${motivoRetirada === m ? 'bg-red-500 text-white' : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'}`}>
                      {m}
                    </button>
                  ))}
                </div>
                {motivoRetirada === 'Fornecedor' && (
                  <input value={nomeFornecedor} onChange={(e) => setNomeFornecedor(e.target.value)}
                    placeholder="Nome do fornecedor..."
                    className="w-full text-sm border border-zinc-200 rounded-xl px-3 py-2.5 text-zinc-800 focus:outline-none focus:border-amber-400" />
                )}
                {motivoRetirada === 'Freelancer' && (
                  <input value={nomeFreelancer} onChange={(e) => setNomeFreelancer(e.target.value)}
                    placeholder="Nome do freelancer..."
                    className="w-full text-sm border border-zinc-200 rounded-xl px-3 py-2.5 text-zinc-800 focus:outline-none focus:border-amber-400" />
                )}
                {motivoRetirada === 'Outro' && (
                  <input value={motivoOutro} onChange={(e) => setMotivoOutro(e.target.value)}
                    placeholder="Descreva o motivo..."
                    className="w-full text-sm border border-zinc-200 rounded-xl px-3 py-2.5 text-zinc-800 focus:outline-none focus:border-amber-400" />
                )}
              </>
            ) : (
              <div className="grid grid-cols-2 gap-1.5">
                {(['Troco', 'Outros'] as MotivoAdicao[]).map((m) => (
                  <button key={m} onClick={() => { setMotivoAdicao(m); setErro(''); }}
                    className={`py-2.5 px-3 text-xs font-medium rounded-lg cursor-pointer transition-colors text-center ${motivoAdicao === m ? 'bg-emerald-500 text-white' : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'}`}>
                    {m}
                  </button>
                ))}
              </div>
            )}
          </div>

          {erro && <p className="text-xs text-red-500 font-medium">{erro}</p>}

          {/* Histórico resumido */}
          {historico.length > 0 && (
            <div className="bg-zinc-50 rounded-xl p-3 space-y-2">
              <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-wide">Movimentos desta sessão</p>
              {historico.slice(-3).map((h, i) => (
                <div key={i} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-1.5">
                    <i className={`text-xs ${h.tipo === 'sangria' ? 'ri-arrow-down-line text-red-400' : 'ri-arrow-up-line text-emerald-500'}`} />
                    <span className="text-zinc-500 truncate max-w-[140px]">{h.motivo}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-zinc-400">{h.hora}</span>
                    <span className={`font-bold ${h.tipo === 'sangria' ? 'text-red-500' : 'text-emerald-600'}`}>
                      {h.tipo === 'sangria' ? '-' : '+'}{fmt(h.valor)}
                    </span>
                  </div>
                </div>
              ))}
              <div className="border-t border-zinc-200 pt-2 flex justify-between text-xs">
                <div className="flex gap-4">
                  <span className="text-zinc-500">Retiradas: <span className="text-red-500 font-bold">-{fmt(totalRetiradas)}</span></span>
                  <span className="text-zinc-500">Adições: <span className="text-emerald-600 font-bold">+{fmt(totalAdicoes)}</span></span>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="px-6 pb-6 flex gap-2">
          <button onClick={onClose} className="flex-1 py-2.5 text-sm font-semibold text-zinc-600 bg-zinc-100 rounded-xl hover:bg-zinc-200 cursor-pointer whitespace-nowrap">
            Cancelar
          </button>
          <button
            onClick={handleRegistrar}
            disabled={salvando}
            className={`flex-1 py-2.5 text-sm font-bold text-white rounded-xl cursor-pointer whitespace-nowrap transition-colors disabled:opacity-50 ${tipo === 'sangria' ? 'bg-red-500 hover:bg-red-600' : 'bg-emerald-500 hover:bg-emerald-600'}`}
          >
            {salvando ? 'Salvando...' : `Registrar ${tipo === 'sangria' ? 'retirada' : 'adição'}`}
          </button>
        </div>
      </div>
    </div>
  );
}
