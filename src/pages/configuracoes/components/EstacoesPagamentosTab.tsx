import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase, invokeWithAuth } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useCardapio, type EstacaoCozinha } from '@/contexts/CardapioContext';
import { usePaymentMethods, type PaymentMethod } from '@/hooks/usePaymentMethods';
import { useUsuarios } from '@/hooks/useUsuarios';
import { useToast } from '@/contexts/ToastContext';
import { subscribeReload } from '@/lib/reloadSignal';

// ─── Static config ────────────────────────────────────────────────────────────
const CORES = ['#f59e0b', '#f97316', '#10b981', '#06b6d4', '#8b5cf6', '#ec4899', '#ef4444', '#14b8a6'];

const PDV_TERMINAIS = [
  { id: 'caixa', label: 'Caixa', icon: 'ri-safe-2-line', desc: 'PDV principal com gestão de sessão e caixa', obrigatorio: true },
  { id: 'garcom', label: 'Garçom', icon: 'ri-walk-line', desc: 'App de pedidos por mesa para garçons', obrigatorio: false },
  { id: 'delivery', label: 'Delivery', icon: 'ri-bike-line', desc: 'PDV para pedidos de entrega e retirada', obrigatorio: false },
  { id: 'autoatendimento', label: 'Autoatendimento', icon: 'ri-tablet-line', desc: 'Totem de autoatendimento para clientes', obrigatorio: false },
];

type MainTab = 'estacoes' | 'pagamentos' | 'operadores';

// ─── Station Modal ─────────────────────────────────────────────────────────────
interface EstacaoModalProps {
  estacao?: EstacaoCozinha | null;
  onClose: () => void;
  onSalvo: () => void | Promise<void>;
  tenantId: string;
}

function EstacaoModal({ estacao, onClose, onSalvo, tenantId }: EstacaoModalProps) {
  const { success: toastSuccess, error: toastError } = useToast();
  const [nome, setNome] = useState(estacao?.nome ?? '');
  const [cor, setCor] = useState(estacao?.cor ?? CORES[0]);
  const [sla, setSla] = useState(estacao?.slaMinutos ?? 15);
  const [salvando, setSalvando] = useState(false);

  const handleSalvar = async () => {
    if (!nome.trim()) return;
    setSalvando(true);

    if (estacao?.id) {
      const { data, error } = await invokeWithAuth<{ success: boolean; error?: string }>('config-write', {
        body: {
          action: 'update_kitchen_station',
          tenant_id: tenantId,
          id: estacao.id,
          name: nome.trim(),
          color: cor,
          sla_minutes: sla,
        },
      });

      if (error || !data?.success) {
        console.error('[EstacaoModal] update error:', error || data?.error);
        toastError(`Erro ao atualizar estação: ${error?.message || data?.error || 'Erro desconhecido'}`);
        setSalvando(false);
        return;
      }
      toastSuccess('Estação atualizada com sucesso!');
    } else {
      const { data, error } = await invokeWithAuth<{ success: boolean; data?: { id: string }; error?: string }>('config-write', {
        body: {
          action: 'create_kitchen_station',
          tenant_id: tenantId,
          name: nome.trim(),
          color: cor,
          sla_minutes: sla,
        },
      });

      if (error || !data?.success) {
        console.error('[EstacaoModal] insert error:', error || data?.error);
        toastError(`Erro ao criar estação: ${error?.message || data?.error || 'Erro desconhecido'}`);
        setSalvando(false);
        return;
      }
      toastSuccess('Estação criada com sucesso!');
    }

    setSalvando(false);
    await onSalvo();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl p-6 w-full max-w-sm mx-4">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-sm font-bold text-zinc-900">{estacao ? 'Editar Estação' : 'Nova Estação'}</h2>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-zinc-100 cursor-pointer text-zinc-500">
            <i className="ri-close-line text-base" />
          </button>
        </div>
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-zinc-600 mb-1.5">Nome da estação</label>
            <input value={nome} onChange={e => setNome(e.target.value)}
              className="w-full text-sm border border-zinc-200 rounded-lg px-3 py-2.5 text-zinc-800 focus:outline-none focus:border-amber-400"
              placeholder="Ex: Grelha, Frituras..." />
          </div>
          <div>
            <label className="block text-xs font-semibold text-zinc-600 mb-2">Cor de identificação</label>
            <div className="flex gap-2 flex-wrap">
              {CORES.map(c => (
                <button key={c} onClick={() => setCor(c)}
                  className={`w-8 h-8 rounded-full cursor-pointer transition-all ${cor === c ? 'scale-125 ring-2 ring-offset-2 ring-zinc-400' : 'hover:scale-110'}`}
                  style={{ backgroundColor: c }} />
              ))}
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-zinc-600 mb-1.5">SLA padrão (minutos)</label>
            <div className="flex items-center gap-2">
              <input type="number" min={1} max={120} value={sla} onChange={e => setSla(parseInt(e.target.value) || 15)}
                className="w-20 text-sm border border-zinc-200 rounded-lg px-3 py-2.5 text-zinc-800 focus:outline-none focus:border-amber-400" />
              <span className="text-xs text-zinc-400">min por item</span>
            </div>
          </div>
        </div>
        <div className="flex gap-2 mt-5">
          <button onClick={onClose} className="flex-1 py-2 text-sm font-semibold text-zinc-600 bg-zinc-100 rounded-lg hover:bg-zinc-200 cursor-pointer whitespace-nowrap">Cancelar</button>
          <button onClick={handleSalvar} disabled={!nome.trim() || salvando}
            className="flex-1 py-2 text-sm font-semibold bg-amber-500 text-white rounded-lg hover:bg-amber-600 disabled:opacity-40 cursor-pointer whitespace-nowrap">
            {salvando ? 'Salvando...' : 'Salvar'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Payment Method Modal ──────────────────────────────────────────────────────
interface FormaModalProps {
  forma?: PaymentMethod | null;
  onClose: () => void;
  onSalvo: () => void | Promise<void>;
  tenantId: string;
}

const PRAZO_OPCOES = [
  { value: 0, label: 'Mesmo dia (D+0)', desc: 'Antecipação automática' },
  { value: 1, label: 'D+1', desc: 'Próximo dia útil' },
  { value: 2, label: 'D+2', desc: '2 dias úteis' },
  { value: 30, label: 'D+30', desc: '30 dias corridos' },
  { value: 31, label: 'D+31', desc: '31 dias corridos' },
  { value: 32, label: 'D+32', desc: '32 dias corridos' },
];

function FormaModal({ forma, onClose, onSalvo, tenantId }: FormaModalProps) {
  const { success: toastSuccess, error: toastError } = useToast();
  const [nome, setNome] = useState(forma?.nome ?? '');
  const [tipo, setTipo] = useState<PaymentMethod['tipo']>(forma?.tipo ?? 'credito');
  const [taxa, setTaxa] = useState(forma?.taxa?.toString() ?? '0');
  const [prazo, setPrazo] = useState(forma?.prazoRecebimento ?? 30);
  const [prazoCustom, setPrazoCustom] = useState(false);
  const [salvando, setSalvando] = useState(false);

  const tipoLabels: Record<PaymentMethod['tipo'], string> = { dinheiro: 'Dinheiro', credito: 'Crédito', debito: 'Débito', pix: 'PIX', vale: 'Vale' };
  const tipoIcons: Record<PaymentMethod['tipo'], string> = { dinheiro: 'ri-money-dollar-circle-line', credito: 'ri-bank-card-line', debito: 'ri-bank-card-2-line', pix: 'ri-qr-code-line', vale: 'ri-ticket-2-line' };

  const isOpcaoConhecida = PRAZO_OPCOES.some(o => o.value === prazo);

  const handleSalvar = async () => {
    if (!nome.trim()) return;
    setSalvando(true);

    const payload = {
      name: nome.trim(),
      type: tipo,
      fee_percentage: parseFloat(taxa) || 0,
      days_to_receive: tipo === 'credito' || tipo === 'debito' || tipo === 'vale' ? prazo : 0,
    };

    if (forma?.id) {
      const { data, error } = await invokeWithAuth<{ success: boolean; error?: string }>('config-write', {
        body: { action: 'update_payment_method', tenant_id: tenantId, id: forma.id, ...payload },
      });
      if (error || !data?.success) {
        toastError(`Erro ao atualizar: ${error?.message || data?.error || 'Erro desconhecido'}`);
        setSalvando(false);
        return;
      }
      toastSuccess('Forma de pagamento atualizada!');
    } else {
      const { data, error } = await invokeWithAuth<{ success: boolean; data?: { id: string }; error?: string }>('config-write', {
        body: { action: 'create_payment_method', tenant_id: tenantId, ...payload },
      });
      if (error || !data?.success) {
        toastError(`Erro ao criar: ${error?.message || data?.error || 'Erro desconhecido'}`);
        setSalvando(false);
        return;
      }
      toastSuccess('Forma de pagamento criada!');
    }

    setSalvando(false);
    await onSalvo();
    onClose();
  };

  const showPrazo = tipo === 'credito' || tipo === 'debito' || tipo === 'vale';
  const showTaxa = tipo === 'credito' || tipo === 'debito' || tipo === 'vale' || tipo === 'pix';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl p-6 w-full max-w-md mx-4">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-sm font-bold text-zinc-900">{forma ? 'Editar Forma' : 'Nova Forma de Pagamento'}</h2>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-zinc-100 cursor-pointer text-zinc-500">
            <i className="ri-close-line text-base" />
          </button>
        </div>
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-zinc-600 mb-1.5">Nome</label>
            <input value={nome} onChange={e => setNome(e.target.value)}
              className="w-full text-sm border border-zinc-200 rounded-lg px-3 py-2.5 text-zinc-800 focus:outline-none focus:border-amber-400"
              placeholder="Ex: Cartão de Crédito" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-zinc-600 mb-1.5">Tipo</label>
            <div className="grid grid-cols-3 gap-1.5">
              {(['dinheiro', 'credito', 'debito', 'pix', 'vale'] as PaymentMethod['tipo'][]).map(t => (
                <button key={t} onClick={() => setTipo(t)}
                  className={`flex items-center justify-center gap-1.5 py-2 text-xs font-semibold rounded-lg cursor-pointer transition-colors whitespace-nowrap ${tipo === t ? 'bg-amber-500 text-white' : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'}`}>
                  <i className={`${tipoIcons[t]} text-sm`} />
                  {tipoLabels[t]}
                </button>
              ))}
            </div>
          </div>
          {showTaxa && (
            <div>
              <label className="block text-xs font-semibold text-zinc-600 mb-1.5">
                Taxa {tipo === 'pix' ? 'da maquininha / gateway PIX' : 'de operadora'} (%)
              </label>
              <input type="number" step="0.1" value={taxa} onChange={e => setTaxa(e.target.value)}
                className="w-full text-sm border border-zinc-200 rounded-lg px-3 py-2.5 text-zinc-800 focus:outline-none focus:border-amber-400"
                placeholder="0,0" />
              {tipo === 'pix' && (
                <p className="text-[10px] text-zinc-400 mt-1">
                  Ex: Stone cobra 0,99% por transação PIX. Deixe 0 se não houver taxa.
                </p>
              )}
            </div>
          )}
          {showPrazo && (
            <div>
              <label className="block text-xs font-semibold text-zinc-600 mb-1.5">
                Prazo de recebimento
                <span className="ml-1 text-zinc-400 font-normal">(quando o dinheiro cai na conta)</span>
              </label>
              <div className="grid grid-cols-3 gap-1.5 mb-2">
                {PRAZO_OPCOES.map(op => (
                  <button key={op.value} onClick={() => { setPrazo(op.value); setPrazoCustom(false); }}
                    className={`flex flex-col items-center py-2 px-1 rounded-lg border text-xs font-semibold cursor-pointer transition-colors whitespace-nowrap ${prazo === op.value && !prazoCustom ? 'border-amber-400 bg-amber-50 text-amber-700' : 'border-zinc-200 text-zinc-600 hover:border-zinc-300'}`}>
                    <span className="font-bold">{op.label}</span>
                    <span className="text-zinc-400 font-normal text-[10px]">{op.desc}</span>
                  </button>
                ))}
                <button onClick={() => setPrazoCustom(true)}
                  className={`flex flex-col items-center py-2 px-1 rounded-lg border text-xs font-semibold cursor-pointer transition-colors whitespace-nowrap ${prazoCustom || (!isOpcaoConhecida) ? 'border-amber-400 bg-amber-50 text-amber-700' : 'border-zinc-200 text-zinc-600 hover:border-zinc-300'}`}>
                  <span className="font-bold">Personalizado</span>
                  <span className="text-zinc-400 font-normal text-[10px]">Outro prazo</span>
                </button>
              </div>
              {(prazoCustom || !isOpcaoConhecida) && (
                <div className="flex items-center gap-2">
                  <input type="number" min={0} max={365} value={prazo}
                    onChange={e => setPrazo(parseInt(e.target.value) || 0)}
                    className="w-24 text-sm border border-zinc-200 rounded-lg px-3 py-2 text-zinc-800 focus:outline-none focus:border-amber-400" />
                  <span className="text-xs text-zinc-500">dias corridos após a venda</span>
                </div>
              )}
              {prazo === 0 && (
                <div className="mt-2 flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg p-2.5">
                  <i className="ri-information-line text-amber-500 text-sm mt-0.5 flex-shrink-0" />
                  <p className="text-xs text-amber-700">D+0 significa que o valor já entra na conta no mesmo dia — geralmente via antecipação automática da maquininha (com taxa extra).</p>
                </div>
              )}
            </div>
          )}
        </div>
        <div className="flex gap-2 mt-5">
          <button onClick={onClose} className="flex-1 py-2 text-sm font-semibold text-zinc-600 bg-zinc-100 rounded-lg hover:bg-zinc-200 cursor-pointer whitespace-nowrap">Cancelar</button>
          <button onClick={handleSalvar} disabled={!nome.trim() || salvando}
            className="flex-1 py-2 text-sm font-semibold text-white bg-amber-500 rounded-lg hover:bg-amber-600 disabled:opacity-40 cursor-pointer whitespace-nowrap">
            {salvando ? 'Salvando...' : 'Salvar'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────────
export default function EstacoesPagamentosTab() {
  const { user } = useAuth();
  const { estacoes, recarregarEstacoes } = useCardapio();
  const { formas, recarregar: recarregarFormas } = usePaymentMethods();
  const { usuarios, loading: loadingUsuarios } = useUsuarios();
  const { success: toastSuccess, error: toastError } = useToast();
  const showToast = (msg: string, type: 'success' | 'error') => type === 'success' ? toastSuccess(msg) : toastError(msg);

  const [searchParams, setSearchParams] = useSearchParams();
  const rawMainTab = searchParams.get('subtab') as MainTab | null;
  const VALID_MAIN_TABS: MainTab[] = ['estacoes', 'pagamentos', 'operadores'];
  const mainTab: MainTab = rawMainTab && VALID_MAIN_TABS.includes(rawMainTab) ? rawMainTab : 'estacoes';
  const setMainTab = (t: MainTab) => setSearchParams(prev => { prev.set('subtab', t); return prev; }, { replace: true });
  const [estacaoModal, setEstacaoModal] = useState<EstacaoCozinha | 'new' | null>(null);
  const [formaModal, setFormaModal] = useState<PaymentMethod | 'new' | null>(null);

  // Force re-render when kitchen_stations signal fires (ensures list updates after create)
  const [, setStationTick] = useState(0);
  useEffect(() => {
    const unsub = subscribeReload('kitchen_stations', () => {
      setStationTick(t => t + 1);
    });
    return unsub;
  }, []);

  // Per-item loading states
  const [loadingEstacao, setLoadingEstacao] = useState<Record<string, boolean>>({});
  const [loadingForma, setLoadingForma] = useState<Record<string, boolean>>({});
  const [loadingOperador, setLoadingOperador] = useState<Record<string, boolean>>({});

  // Station operators: map userId -> Set of stationIds
  const [operatorMap, setOperatorMap] = useState<Map<string, Set<string>>>(new Map());
  const [loadingOps, setLoadingOps] = useState(false);

  const carregarOperadores = useCallback(async () => {
    if (!user?.tenantId) return;
    setLoadingOps(true);

    const { data, error } = await supabase.rpc('fn_get_station_operators', {
      p_tenant_id: user.tenantId,
    });

    if (error) {
      console.error('[EstacoesPagamentosTab] carregarOperadores error:', error.message);
    } else {
      const rows: { user_id: string; station_id: string }[] = (data as { user_id: string; station_id: string }[]) ?? [];
      const map = new Map<string, Set<string>>();
      rows.forEach((row) => {
        if (!map.has(row.user_id)) map.set(row.user_id, new Set());
        map.get(row.user_id)!.add(row.station_id);
      });
      setOperatorMap(map);
    }
    setLoadingOps(false);
  }, [user?.tenantId]);

  useEffect(() => { carregarOperadores(); }, [carregarOperadores]);

  // Station actions
  const toggleEstacao = async (id: string, atual: boolean) => {
    setLoadingEstacao(prev => ({ ...prev, [id]: true }));
    const { data, error } = await invokeWithAuth<{ success: boolean; error?: string }>('config-write', {
      body: { action: 'update_kitchen_station', tenant_id: user?.tenantId, id, is_active: !atual },
    });
    setLoadingEstacao(prev => ({ ...prev, [id]: false }));
    if (error || !data?.success) {
      showToast(`Erro ao alterar estação: ${error?.message || data?.error || 'Erro desconhecido'}`, 'error');
      return;
    }
    recarregarEstacoes();
  };

  const excluirEstacao = async (id: string) => {
    setLoadingEstacao(prev => ({ ...prev, [`del_${id}`]: true }));
    const { data, error } = await invokeWithAuth<{ success: boolean; error?: string }>('config-write', {
      body: { action: 'delete_kitchen_station', tenant_id: user?.tenantId, id },
    });
    setLoadingEstacao(prev => ({ ...prev, [`del_${id}`]: false }));
    if (error || !data?.success) {
      showToast(`Erro ao excluir estação: ${error?.message || data?.error || 'Erro desconhecido'}`, 'error');
      return;
    }
    showToast('Estação removida', 'success');
    recarregarEstacoes();
  };

  // Payment method actions
  const toggleForma = async (id: string, atual: boolean) => {
    setLoadingForma(prev => ({ ...prev, [id]: true }));
    const { data, error } = await invokeWithAuth<{ success: boolean; error?: string }>('config-write', {
      body: { action: 'update_payment_method', tenant_id: user?.tenantId, id, is_active: !atual },
    });
    setLoadingForma(prev => ({ ...prev, [id]: false }));
    if (error || !data?.success) {
      showToast(`Erro ao alterar forma de pagamento: ${error?.message || data?.error || 'Erro desconhecido'}`, 'error');
      return;
    }
    recarregarFormas();
  };

  const excluirForma = async (id: string) => {
    setLoadingForma(prev => ({ ...prev, [`del_${id}`]: true }));
    const { data, error } = await invokeWithAuth<{ success: boolean; error?: string }>('config-write', {
      body: { action: 'delete_payment_method', tenant_id: user?.tenantId, id },
    });
    setLoadingForma(prev => ({ ...prev, [`del_${id}`]: false }));
    if (error || !data?.success) {
      showToast(`Erro ao excluir forma de pagamento: ${error?.message || data?.error || 'Erro desconhecido'}`, 'error');
      return;
    }
    showToast('Forma de pagamento removida', 'success');
    recarregarFormas();
  };

  // Operator station assignment toggle
  const toggleOperadorEstacao = async (userId: string, stationId: string) => {
    if (!user?.tenantId) return;
    const key = `${userId}_${stationId}`;
    setLoadingOperador(prev => ({ ...prev, [key]: true }));
    const userStations = operatorMap.get(userId);
    const isAssigned = userStations?.has(stationId) ?? false;

    const action = isAssigned ? 'remove_station_operator' : 'assign_station_operator';
    const { data, error } = await invokeWithAuth<{ success: boolean; error?: string }>('config-write', {
      body: { action, tenant_id: user.tenantId, user_id: userId, station_id: stationId },
    });

    setLoadingOperador(prev => ({ ...prev, [key]: false }));
    if (error || !data?.success) {
      showToast(`Erro ao ${isAssigned ? 'remover' : 'adicionar'} operador: ${error?.message || data?.error || 'Erro desconhecido'}`, 'error');
      return;
    }

    await carregarOperadores();
    showToast(isAssigned ? 'Operador removido da estação' : 'Operador adicionado à estação', 'success');
  };

  const tipoIcons: Record<PaymentMethod['tipo'], string> = { dinheiro: 'ri-money-dollar-circle-line', credito: 'ri-bank-card-line', debito: 'ri-bank-card-2-line', pix: 'ri-qr-code-line', vale: 'ri-ticket-2-line' };
  const tipoLabels: Record<PaymentMethod['tipo'], string> = { dinheiro: 'Dinheiro', credito: 'Crédito', debito: 'Débito', pix: 'PIX', vale: 'Vale' };

  const operadores = usuarios.filter(u => u.ativo);

  const tabs: { id: MainTab; label: string; icon: string; count: number }[] = [
    { id: 'estacoes', label: 'Estações da Cozinha', icon: 'ri-fire-line', count: estacoes.filter(e => e.ativo).length },
    { id: 'pagamentos', label: 'Formas de Pagamento', icon: 'ri-bank-card-line', count: formas.filter(f => f.ativo).length },
    { id: 'operadores', label: 'Operadores', icon: 'ri-user-settings-line', count: operadores.length },
  ];

  const tenantId = user?.tenantId ?? '';

  return (
    <div className="max-w-4xl">
      {/* Sub-tabs */}
      <div className="flex items-center gap-1 border-b border-zinc-100 mb-6 overflow-x-auto">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setMainTab(t.id)}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors cursor-pointer whitespace-nowrap -mb-px ${
              mainTab === t.id ? 'border-amber-500 text-amber-600' : 'border-transparent text-zinc-500 hover:text-zinc-700'
            }`}>
            <i className={`${t.icon} text-base`} />
            {t.label}
            <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${mainTab === t.id ? 'bg-amber-100 text-amber-600' : 'bg-zinc-100 text-zinc-500'}`}>
              {t.count}
            </span>
          </button>
        ))}
      </div>

      {/* ── ESTAÇÕES ── */}
      {mainTab === 'estacoes' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-zinc-800">Estações da Cozinha</h3>
              <p className="text-xs text-zinc-400 mt-0.5">Setores de preparo vinculados ao KDS</p>
            </div>
            <button onClick={() => setEstacaoModal('new')}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500 text-white text-xs font-semibold rounded-lg hover:bg-amber-600 cursor-pointer transition-colors whitespace-nowrap">
              <i className="ri-add-line" />Nova estação
            </button>
          </div>

          {estacoes.length === 0 ? (
            <div className="text-center py-12 bg-white border border-zinc-100 rounded-xl">
              <div className="w-12 h-12 flex items-center justify-center bg-zinc-100 rounded-full mx-auto mb-3">
                <i className="ri-fire-line text-zinc-400 text-xl" />
              </div>
              <p className="text-sm text-zinc-500">Nenhuma estação cadastrada</p>
              <p className="text-xs text-zinc-400 mt-1">Clique em &quot;Nova estação&quot; para começar</p>
            </div>
          ) : (
            <div className="space-y-2">
              {estacoes.map(e => (
                <div key={e.id} className="bg-white border border-zinc-100 rounded-xl p-4 flex items-center gap-3">
                  <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: e.cor }} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-zinc-800">{e.nome}</p>
                    <p className="text-[10px] text-zinc-400 mt-0.5">SLA: {e.slaMinutos}min por item</p>
                  </div>
                  <div className="text-xs text-zinc-400">
                    {Array.from(operatorMap.values()).filter(s => s.has(e.id)).length} operador(es)
                  </div>
                  <button
                    onClick={() => toggleEstacao(e.id, e.ativo)}
                    disabled={loadingEstacao[e.id]}
                    className={`relative w-10 h-5 rounded-full transition-colors cursor-pointer flex-shrink-0 disabled:opacity-60 ${e.ativo ? 'bg-amber-500' : 'bg-zinc-200'}`}>
                    {loadingEstacao[e.id]
                      ? <div className="absolute inset-0 flex items-center justify-center"><div className="w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin" /></div>
                      : <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all ${e.ativo ? 'left-5' : 'left-0.5'}`} />
                    }
                  </button>
                  <button onClick={() => setEstacaoModal(e)}
                    className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-amber-50 text-zinc-400 hover:text-amber-600 cursor-pointer transition-colors">
                    <i className="ri-pencil-line text-sm" />
                  </button>
                  <button
                    onClick={() => excluirEstacao(e.id)}
                    disabled={loadingEstacao[`del_${e.id}`]}
                    className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-red-50 text-zinc-400 hover:text-red-400 cursor-pointer transition-colors disabled:opacity-50">
                    {loadingEstacao[`del_${e.id}`]
                      ? <div className="w-3 h-3 border-2 border-red-300 border-t-red-500 rounded-full animate-spin" />
                      : <i className="ri-delete-bin-line text-sm" />
                    }
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── PAGAMENTOS ── */}
      {mainTab === 'pagamentos' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-zinc-800">Formas de Pagamento</h3>
              <p className="text-xs text-zinc-400 mt-0.5">Métodos aceitos no PDV</p>
            </div>
            <button onClick={() => setFormaModal('new')}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500 text-white text-xs font-semibold rounded-lg hover:bg-amber-600 cursor-pointer transition-colors whitespace-nowrap">
              <i className="ri-add-line" />Nova forma
            </button>
          </div>

          {/* PIX Stone Banner */}
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 flex items-center justify-center bg-emerald-500 rounded-xl flex-shrink-0">
                  <i className="ri-qr-code-line text-white text-lg" />
                </div>
                <div>
                  <p className="text-sm font-bold text-emerald-800">PIX Automático via Stone</p>
                  <p className="text-xs text-emerald-600">QR Code dinâmico · Confirmação automática por webhook · Taxa: <strong>0,99% por transação</strong></p>
                </div>
              </div>
              <span className="text-[10px] font-semibold text-emerald-600 bg-emerald-100 px-2.5 py-1.5 rounded-lg flex-shrink-0 whitespace-nowrap flex items-center gap-1">
                <i className="ri-shield-check-line text-sm" />Integrado
              </span>
            </div>
          </div>

          {formas.length === 0 ? (
            <div className="text-center py-12 bg-white border border-zinc-100 rounded-xl">
              <div className="w-12 h-12 flex items-center justify-center bg-zinc-100 rounded-full mx-auto mb-3">
                <i className="ri-bank-card-line text-zinc-400 text-xl" />
              </div>
              <p className="text-sm text-zinc-500">Nenhuma forma de pagamento cadastrada</p>
              <p className="text-xs text-zinc-400 mt-1">Clique em &quot;Nova forma&quot; para começar</p>
            </div>
          ) : (
            <div className="space-y-2">
              {formas.map(f => (
                <div key={f.id} className={`bg-white border rounded-xl p-4 flex items-center gap-3 transition-opacity ${f.ativo ? 'border-zinc-100' : 'border-zinc-100 opacity-50'}`}>
                  <div className="w-7 h-7 flex items-center justify-center bg-zinc-100 rounded-lg flex-shrink-0 text-zinc-500">
                    <i className={`${tipoIcons[f.tipo]} text-sm`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-zinc-800">{f.nome}</p>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      <span className="text-[10px] text-zinc-400">{tipoLabels[f.tipo]}</span>
                      {f.taxa > 0 && <span className="text-[10px] text-amber-600 font-semibold">{f.taxa}% taxa</span>}
                      {(f.tipo === 'credito' || f.tipo === 'debito' || f.tipo === 'vale') && (
                        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${f.prazoRecebimento === 0 ? 'bg-green-100 text-green-700' : 'bg-zinc-100 text-zinc-500'}`}>
                          {f.prazoRecebimento === 0 ? 'D+0 (antecipação)' : `D+${f.prazoRecebimento}`}
                        </span>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => toggleForma(f.id, f.ativo)}
                    disabled={loadingForma[f.id]}
                    className={`relative w-10 h-5 rounded-full transition-colors cursor-pointer flex-shrink-0 disabled:opacity-60 ${f.ativo ? 'bg-amber-500' : 'bg-zinc-200'}`}>
                    {loadingForma[f.id]
                      ? <div className="absolute inset-0 flex items-center justify-center"><div className="w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin" /></div>
                      : <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all ${f.ativo ? 'left-5' : 'left-0.5'}`} />
                    }
                  </button>
                  <button onClick={() => setFormaModal(f)}
                    className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-amber-50 text-zinc-400 hover:text-amber-600 cursor-pointer transition-colors">
                    <i className="ri-pencil-line text-sm" />
                  </button>
                  <button
                    onClick={() => excluirForma(f.id)}
                    disabled={loadingForma[`del_${f.id}`]}
                    className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-red-50 text-zinc-400 hover:text-red-400 cursor-pointer transition-colors disabled:opacity-50">
                    {loadingForma[`del_${f.id}`]
                      ? <div className="w-3 h-3 border-2 border-red-300 border-t-red-500 rounded-full animate-spin" />
                      : <i className="ri-delete-bin-line text-sm" />
                    }
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── OPERADORES ── */}
      {mainTab === 'operadores' && (
        <div className="space-y-4">
          <div>
            <h3 className="text-sm font-bold text-zinc-800">Operadores das Estações</h3>
            <p className="text-xs text-zinc-400 mt-0.5">Defina quais usuários podem atuar em cada estação do KDS</p>
          </div>

          {loadingUsuarios || loadingOps ? (
            <div className="flex items-center justify-center py-10">
              <div className="w-5 h-5 border-2 border-amber-400 border-t-transparent rounded-full animate-spin mr-2" />
              <span className="text-xs text-zinc-400">Carregando...</span>
            </div>
          ) : operadores.length === 0 ? (
            <div className="text-center py-12 bg-white border border-zinc-100 rounded-xl">
              <div className="w-12 h-12 flex items-center justify-center bg-zinc-100 rounded-full mx-auto mb-3">
                <i className="ri-user-settings-line text-zinc-400 text-xl" />
              </div>
              <p className="text-sm text-zinc-500">Nenhum usuário ativo encontrado</p>
              <p className="text-xs text-zinc-400 mt-1">Cadastre usuários na página Usuários do menu lateral</p>
            </div>
          ) : (
            <div className="space-y-2">
              {operadores.map(op => {
                const userStations = operatorMap.get(op.id) ?? new Set<string>();
                const corPerfil: Record<string, string> = { gerente: 'bg-violet-100 text-violet-700', caixa: 'bg-amber-100 text-amber-700', garcom: 'bg-emerald-100 text-emerald-700', cozinha: 'bg-sky-100 text-sky-700', admin: 'bg-red-100 text-red-700' };
                return (
                  <div key={op.id} className="bg-white border border-zinc-100 rounded-xl p-4">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="w-9 h-9 rounded-full bg-zinc-200 flex items-center justify-center flex-shrink-0">
                        <span className="text-sm font-bold text-zinc-600">{op.nome.charAt(0)}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-zinc-800">{op.nome}</p>
                        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${corPerfil[op.perfil] ?? 'bg-zinc-100 text-zinc-500'}`}>
                          {op.perfil.charAt(0).toUpperCase() + op.perfil.slice(1)}
                        </span>
                      </div>
                    </div>
                    {estacoes.length === 0 ? (
                      <p className="text-xs text-zinc-400 italic">Cadastre estações para atribuir</p>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {estacoes.map(e => {
                          const assigned = userStations.has(e.id);
                          const opKey = `${op.id}_${e.id}`;
                          return (
                            <button key={e.id} onClick={() => toggleOperadorEstacao(op.id, e.id)}
                              disabled={loadingOperador[opKey]}
                              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-medium cursor-pointer transition-all whitespace-nowrap disabled:opacity-60 ${
                                assigned ? 'border-amber-300 bg-amber-50 text-amber-700' : 'border-zinc-200 text-zinc-500 hover:border-zinc-300'
                              }`}>
                              {loadingOperador[opKey]
                                ? <div className="w-3 h-3 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
                                : <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: e.cor }} />
                              }
                              {e.nome}
                              {assigned && !loadingOperador[opKey] && <i className="ri-check-line text-amber-500 text-xs" />}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Modals */}
      {estacaoModal && (
        <EstacaoModal
          estacao={estacaoModal === 'new' ? null : estacaoModal}
          tenantId={tenantId}
          onSalvo={recarregarEstacoes}
          onClose={() => setEstacaoModal(null)}
        />
      )}
      {formaModal && (
        <FormaModal
          forma={formaModal === 'new' ? null : formaModal}
          tenantId={tenantId}
          onSalvo={recarregarFormas}
          onClose={() => setFormaModal(null)}
        />
      )}
    </div>
  );
}