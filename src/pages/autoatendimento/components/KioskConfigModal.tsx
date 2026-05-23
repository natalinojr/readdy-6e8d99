import { useState, useEffect, useCallback } from 'react';
import { invokeWithAuth, supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useSessao } from '@/contexts/SessaoContext';
import { useKioskAuth } from '@/contexts/KioskAuthContext';

const fmt = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

interface OrderSummary {
  id: string;
  numero: number;
  status: string;
  total_amount: number;
  destination_name: string | null;
  created_at: string;
  origin_type: string;
}

interface KioskConfigModalProps {
  onClose: () => void;
}

const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  new:       { label: 'Aguardando', color: 'text-amber-600 bg-amber-50 border-amber-200' },
  preparing: { label: 'Em preparo', color: 'text-yellow-700 bg-yellow-50 border-yellow-200' },
  ready:     { label: 'Pronto',     color: 'text-emerald-700 bg-emerald-50 border-emerald-200' },
  delivered: { label: 'Entregue',   color: 'text-zinc-500 bg-zinc-50 border-zinc-200' },
  cancelled: { label: 'Cancelado',  color: 'text-red-600 bg-red-50 border-red-200' },
};

export default function KioskConfigModal({ onClose }: KioskConfigModalProps) {
  const { user } = useAuth();
  const { sessao } = useSessao();
  const { kioskSession } = useKioskAuth();

  const [step, setStep] = useState<'pin' | 'info'>('pin');
  const [pin, setPin] = useState('');
  const [pinErro, setPinErro] = useState('');
  const [loading, setLoading] = useState(false);
  const [orders, setOrders] = useState<OrderSummary[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(false);

  const tenantId = kioskSession?.tenantId ?? user?.tenantId;
  const sessionId = sessao?.id ?? kioskSession?.sessionId;
  // Quando em modo kiosk, sempre mostrar o label do totem — nunca o usuário admin logado
  const isKioskMode = !!kioskSession;
  const userName = isKioskMode ? (kioskSession.kioskLabel ?? 'Totem') : (user?.nome ?? 'Operador');
  const userEmail = isKioskMode ? null : (user?.email ?? null);
  const userRole = isKioskMode ? 'Terminal de Autoatendimento' : (user?.perfil === 'admin' ? 'Administrador' : user?.perfil ?? 'Operador');

  // Invoca edge function usando o token do kiosk (se disponível) ou sessão normal
  const kioskInvoke = useCallback(async <T = unknown>(
    functionName: string,
    body: Record<string, unknown>,
  ): Promise<{ data: T | null; error: Error | null }> => {
    const token = kioskSession?.accessToken;
    if (!token) {
      return invokeWithAuth<T>(functionName, { body });
    }
    try {
      const response = await fetch(`${SUPABASE_URL}/functions/v1/${functionName}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'apikey': SUPABASE_ANON_KEY,
        },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        let errMsg = `HTTP ${response.status}`;
        try {
          const errBody = await response.json();
          errMsg = errBody?.error ?? errMsg;
        } catch { /* ignore */ }
        return { data: null, error: new Error(errMsg) };
      }
      const data = (await response.json()) as T;
      return { data, error: null };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { data: null, error: new Error(msg) };
    }
  }, [kioskSession?.accessToken]);

  const handleValidarPin = useCallback(async () => {
    if (!pin.trim()) { setPinErro('Digite o PIN'); return; }

    // Modo kiosk: sem matrícula de usuário normal — aceita PIN de 4+ dígitos
    if (!user?.matricula) {
      if (pin.length >= 4) { setStep('info'); return; }
      setPinErro('PIN inválido');
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await kioskInvoke('login-pin', {
        badge_number: user.matricula,
        pin,
      });
      if (error || !(data as Record<string, unknown>)?.user) {
        setPinErro('PIN incorreto');
        return;
      }
      setStep('info');
    } catch {
      setPinErro('Erro ao validar PIN');
    } finally {
      setLoading(false);
    }
  }, [pin, user, kioskInvoke]);

  // Carrega pedidos da sessão ao entrar na tela de info
  useEffect(() => {
    if (step !== 'info' || !sessionId || !tenantId) return;
    setLoadingOrders(true);
    supabase
      .from('orders')
      .select('id, number, status, total_amount, destination_name, created_at, origin_type')
      .eq('session_id', sessionId)
      .eq('tenant_id', tenantId)
      .eq('origin_type', 'self_service')
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        setOrders((data ?? []) as OrderSummary[]);
        setLoadingOrders(false);
      });
  }, [step, sessionId, tenantId]);

  const totalVendas = orders
    .filter((o) => o.status !== 'cancelled')
    .reduce((s, o) => s + (o.total_amount ?? 0), 0);

  const totalPedidos = orders.filter((o) => o.status !== 'cancelled').length;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 p-6">
      <div className="bg-zinc-900 border border-zinc-700 rounded-3xl w-full max-w-lg overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 flex items-center justify-center bg-zinc-800 rounded-xl">
              <i className="ri-settings-3-line text-zinc-400 text-lg" />
            </div>
            <div>
              <p className="text-white font-bold text-sm">Configurações do Totem</p>
              <p className="text-zinc-500 text-xs">Acesso restrito ao operador</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center bg-zinc-800 hover:bg-zinc-700 text-zinc-400 rounded-xl cursor-pointer transition-colors"
          >
            <i className="ri-close-line text-base" />
          </button>
        </div>

        {/* PIN step */}
        {step === 'pin' && (
          <div className="p-6 flex flex-col items-center gap-5">
            <div className="w-16 h-16 flex items-center justify-center bg-amber-500/10 rounded-2xl">
              <i className="ri-lock-password-line text-3xl text-amber-400" />
            </div>
            <div className="text-center">
              <p className="text-white font-bold text-lg">Digite seu PIN</p>
              <p className="text-zinc-500 text-sm mt-1">Apenas operadores autorizados podem acessar</p>
            </div>

            {/* Teclado numérico */}
            <div className="w-full max-w-xs">
              {/* Display */}
              <div className="flex justify-center gap-3 mb-5">
                {[0, 1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className={`w-12 h-12 flex items-center justify-center rounded-xl border-2 text-2xl font-black transition-all ${
                      pin.length > i
                        ? 'border-amber-500 bg-amber-500/10 text-amber-400'
                        : 'border-zinc-700 bg-zinc-800 text-zinc-700'
                    }`}
                  >
                    {pin.length > i ? '●' : ''}
                  </div>
                ))}
              </div>

              {/* Teclado */}
              <div className="grid grid-cols-3 gap-3">
                {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
                  <button
                    key={n}
                    onClick={() => { if (pin.length < 8) { setPin((p) => p + n); setPinErro(''); } }}
                    className="h-14 flex items-center justify-center bg-zinc-800 hover:bg-zinc-700 text-white text-xl font-bold rounded-2xl cursor-pointer active:scale-95 transition-all"
                  >
                    {n}
                  </button>
                ))}
                <button
                  onClick={() => setPin((p) => p.slice(0, -1))}
                  className="h-14 flex items-center justify-center bg-zinc-800 hover:bg-zinc-700 text-zinc-400 rounded-2xl cursor-pointer active:scale-95 transition-all"
                >
                  <i className="ri-delete-back-2-line text-xl" />
                </button>
                <button
                  onClick={() => { if (pin.length < 8) { setPin((p) => p + '0'); setPinErro(''); } }}
                  className="h-14 flex items-center justify-center bg-zinc-800 hover:bg-zinc-700 text-white text-xl font-bold rounded-2xl cursor-pointer active:scale-95 transition-all"
                >
                  0
                </button>
                <button
                  onClick={handleValidarPin}
                  disabled={loading || pin.length < 4}
                  className="h-14 flex items-center justify-center bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-zinc-950 rounded-2xl cursor-pointer active:scale-95 transition-all"
                >
                  {loading
                    ? <i className="ri-loader-4-line text-xl animate-spin" />
                    : <i className="ri-arrow-right-line text-xl" />}
                </button>
              </div>

              {pinErro && (
                <p className="text-red-400 text-sm font-semibold text-center mt-3">{pinErro}</p>
              )}
            </div>
          </div>
        )}

        {/* Info step */}
        {step === 'info' && (
          <div className="p-6 space-y-5 max-h-[70vh] overflow-y-auto">
            {/* Usuário identificado */}
            <div className="bg-zinc-800 rounded-2xl p-4 flex items-center gap-4">
              <div className="w-12 h-12 flex items-center justify-center bg-amber-500/20 rounded-xl flex-shrink-0">
                <i className="ri-user-line text-2xl text-amber-400" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-white font-black text-base truncate">{userName}</p>
                {userEmail && <p className="text-zinc-500 text-xs truncate">{userEmail}</p>}
                <span className="inline-block mt-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-zinc-700 text-zinc-400">
                  {userRole}
                </span>
              </div>
            </div>

            {/* Sessão ativa */}
            <div className="bg-zinc-800 rounded-2xl p-4">
              <p className="text-zinc-500 text-xs font-semibold mb-1">Sessão ativa</p>
              <p className="text-white font-black text-base">{sessao?.numero ?? '—'}</p>
              <p className="text-zinc-500 text-xs mt-0.5">
                {sessao ? `Aberta às ${sessao.iniciadaEm}` : 'Sem sessão'}
              </p>
            </div>

            {/* Resumo da sessão */}
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-4">
                <p className="text-amber-400 text-xs font-semibold mb-1">Pedidos nesta sessão</p>
                <p className="text-amber-400 font-black text-3xl">{totalPedidos}</p>
              </div>
              <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-2xl p-4">
                <p className="text-emerald-400 text-xs font-semibold mb-1">Total vendido</p>
                <p className="text-emerald-400 font-black text-xl">{fmt(totalVendas)}</p>
              </div>
            </div>

            {/* Lista de pedidos */}
            <div>
              <p className="text-zinc-400 text-xs font-bold uppercase tracking-widest mb-3">
                Pedidos do autoatendimento
              </p>
              {loadingOrders ? (
                <div className="flex justify-center py-8">
                  <div className="flex gap-1.5">
                    {[0, 1, 2].map((i) => (
                      <div key={i} className="w-2 h-2 bg-amber-500 rounded-full animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
                    ))}
                  </div>
                </div>
              ) : orders.length === 0 ? (
                <div className="text-center py-8 text-zinc-600 text-sm">
                  Nenhum pedido nesta sessão ainda
                </div>
              ) : (
                <div className="space-y-2">
                  {orders.map((o) => {
                    const statusCfg = STATUS_LABEL[o.status] ?? { label: o.status, color: 'text-zinc-400 bg-zinc-800 border-zinc-700' };
                    const hora = new Date(o.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
                    return (
                      <div key={o.id} className="flex items-center justify-between bg-zinc-800 rounded-xl px-4 py-3">
                        <div className="flex items-center gap-3">
                          <span className="text-white font-black text-sm">#{String(o.numero).padStart(4, '0')}</span>
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${statusCfg.color}`}>
                            {statusCfg.label}
                          </span>
                          {o.destination_name && (
                            <span className="text-zinc-400 text-xs">{o.destination_name}</span>
                          )}
                        </div>
                        <div className="text-right">
                          <p className="text-amber-400 font-bold text-sm">{fmt(o.total_amount ?? 0)}</p>
                          <p className="text-zinc-600 text-xs">{hora}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="px-6 py-4 border-t border-zinc-800">
          <button
            onClick={onClose}
            className="w-full py-3 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-semibold rounded-2xl cursor-pointer transition-colors whitespace-nowrap"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}
