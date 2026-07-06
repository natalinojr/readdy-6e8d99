// Voucher de aniversário: configuração da loja + geração manual do mês.
// A loja define desconto, gasto mínimo, validade e se a automação diária está ligada.
import { useState, useEffect, useCallback } from 'react';
import { invokeWithAuth } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import type { ClienteCRM } from '@/hooks/useClientes';

interface BirthdayConfig {
  enabled: boolean;
  discount_type: 'percent' | 'fixed' | 'gift_card';
  discount_value: number;
  min_order_amount: number;
  validity_days: number;
  only_opt_in: boolean;
  message: string | null;
}

interface GeradoItem { customer_id: string; name: string; phone: string | null; code: string; }

interface Props {
  aniversariantesMes: ClienteCRM[];
  onClose: () => void;
  onGerado?: () => void;
}

const DEFAULTS: BirthdayConfig = {
  enabled: false, discount_type: 'percent', discount_value: 15,
  min_order_amount: 0, validity_days: 15, only_opt_in: false, message: null,
};

function fmtMoeda(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function labelDesconto(cfg: BirthdayConfig): string {
  if (cfg.discount_type === 'percent') return `${cfg.discount_value}% de desconto`;
  if (cfg.discount_type === 'fixed') return `${fmtMoeda(cfg.discount_value)} de desconto`;
  return `um vale de ${fmtMoeda(cfg.discount_value)}`;
}

export default function BirthdayVoucherModal({ aniversariantesMes, onClose, onGerado }: Props) {
  const { user } = useAuth();
  const [cfg, setCfg] = useState<BirthdayConfig>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [gerando, setGerando] = useState(false);
  const [erro, setErro] = useState('');
  const [okMsg, setOkMsg] = useState('');
  const [resultado, setResultado] = useState<{ created: number; skipped: number; items: GeradoItem[] } | null>(null);

  const carregar = useCallback(async () => {
    if (!user?.tenantId) return;
    setLoading(true);
    try {
      const { data } = await invokeWithAuth('voucher-write', {
        body: { action: 'get_birthday_config', active_tenant_id: user.tenantId },
      });
      const c = (data as { data?: BirthdayConfig })?.data;
      if (c) setCfg({ ...DEFAULTS, ...c });
    } finally {
      setLoading(false);
    }
  }, [user?.tenantId]);

  useEffect(() => { carregar(); }, [carregar]);

  const set = <K extends keyof BirthdayConfig>(k: K, v: BirthdayConfig[K]) => setCfg((p) => ({ ...p, [k]: v }));

  const salvarConfig = async () => {
    setErro(''); setOkMsg('');
    if (cfg.discount_value <= 0) { setErro('O valor do desconto deve ser maior que zero.'); return; }
    if (cfg.discount_type === 'percent' && cfg.discount_value > 100) { setErro('Percentual não pode passar de 100%.'); return; }
    setSalvando(true);
    try {
      const { data, error } = await invokeWithAuth('voucher-write', {
        body: { action: 'set_birthday_config', active_tenant_id: user?.tenantId, config: cfg },
      });
      if (error) throw new Error(String(error));
      const resp = data as { error?: string; data?: BirthdayConfig };
      if (resp?.error) throw new Error(resp.error);
      if (resp?.data) setCfg({ ...DEFAULTS, ...resp.data });
      setOkMsg('Configuração salva.');
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao salvar');
    } finally {
      setSalvando(false);
    }
  };

  const gerarAgora = async () => {
    setErro(''); setOkMsg(''); setResultado(null);
    setGerando(true);
    try {
      // Salva a config antes de gerar, para usar os valores atuais da tela.
      await invokeWithAuth('voucher-write', {
        body: { action: 'set_birthday_config', active_tenant_id: user?.tenantId, config: cfg },
      });
      const { data, error } = await invokeWithAuth('voucher-write', {
        body: { action: 'generate_birthday_vouchers', active_tenant_id: user?.tenantId, scope: 'month' },
      });
      if (error) throw new Error(String(error));
      const resp = data as { error?: string; data?: { created: number; skipped: number; items: GeradoItem[] } };
      if (resp?.error) throw new Error(resp.error);
      setResultado(resp?.data ?? { created: 0, skipped: 0, items: [] });
      onGerado?.();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao gerar');
    } finally {
      setGerando(false);
    }
  };

  const enviarWhatsApp = (item: GeradoItem) => {
    const numero = (item.phone ?? '').replace(/\D/g, '');
    if (!numero) return;
    const primeiro = item.name.split(' ')[0];
    const validade = cfg.validity_days;
    const msg = encodeURIComponent(
      `Olá, ${primeiro}! \u{1F382} Feliz aniversário! Preparamos um presente pra você: use o código *${item.code}* e ganhe ${labelDesconto(cfg)}`
      + (cfg.min_order_amount > 0 ? ` (em pedidos acima de ${fmtMoeda(cfg.min_order_amount)})` : '')
      + `. Válido por ${validade} dias. Te esperamos! \u{1F973}`,
    );
    window.open(`https://wa.me/55${numero}?text=${msg}`, '_blank');
  };

  const inputCls = 'w-full text-sm border border-zinc-200 rounded-lg px-3 py-2 text-zinc-700 focus:outline-none focus:border-amber-400 transition-colors';

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-50" onClick={onClose} />
      <div className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[94vw] max-w-lg bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-100 flex-shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 flex items-center justify-center bg-amber-50 rounded-lg">
              <i className="ri-cake-3-line text-amber-600" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-zinc-900">Voucher de aniversário</h3>
              <p className="text-[11px] text-zinc-400">{aniversariantesMes.length} aniversariante{aniversariantesMes.length !== 1 ? 's' : ''} este mês</p>
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-zinc-100 text-zinc-400 cursor-pointer">
            <i className="ri-close-line text-lg" />
          </button>
        </div>

        <div className="p-5 overflow-y-auto space-y-4">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="w-5 h-5 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <>
              {erro && <div className="px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">{erro}</div>}
              {okMsg && <div className="px-3 py-2 bg-green-50 border border-green-200 rounded-lg text-xs text-green-700">{okMsg}</div>}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-zinc-500 mb-1">Tipo de benefício</label>
                  <select className={`${inputCls} cursor-pointer`} value={cfg.discount_type} onChange={(e) => set('discount_type', e.target.value as BirthdayConfig['discount_type'])}>
                    <option value="percent">Desconto %</option>
                    <option value="fixed">Desconto R$</option>
                    <option value="gift_card">Vale-presente R$</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-zinc-500 mb-1">
                    {cfg.discount_type === 'percent' ? 'Percentual (%)' : 'Valor (R$)'}
                  </label>
                  <input type="number" min={0} className={inputCls} value={cfg.discount_value} onChange={(e) => set('discount_value', Number(e.target.value))} />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-zinc-500 mb-1">Gasto mínimo (R$)</label>
                  <input type="number" min={0} className={inputCls} value={cfg.min_order_amount} onChange={(e) => set('min_order_amount', Number(e.target.value))} placeholder="0 = sem mínimo" />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-zinc-500 mb-1">Validade (dias)</label>
                  <input type="number" min={1} max={365} className={inputCls} value={cfg.validity_days} onChange={(e) => set('validity_days', Number(e.target.value))} />
                </div>
              </div>

              <label className="flex items-center gap-2.5 px-3 py-2.5 bg-zinc-50 border border-zinc-200 rounded-lg cursor-pointer">
                <input type="checkbox" checked={cfg.only_opt_in} onChange={(e) => set('only_opt_in', e.target.checked)} className="w-4 h-4 accent-amber-500 cursor-pointer" />
                <span className="text-xs text-zinc-600">Gerar só para quem aceita marketing (opt-in)</span>
              </label>

              <label className="flex items-center gap-2.5 px-3 py-2.5 bg-amber-50 border border-amber-200 rounded-lg cursor-pointer">
                <input type="checkbox" checked={cfg.enabled} onChange={(e) => set('enabled', e.target.checked)} className="w-4 h-4 accent-amber-500 cursor-pointer" />
                <div>
                  <p className="text-xs font-semibold text-amber-800">Automação diária</p>
                  <p className="text-[10px] text-amber-600">Todo dia gera o voucher para quem faz aniversário naquela data, automaticamente.</p>
                </div>
              </label>

              {/* Resultado da geração */}
              {resultado && (
                <div className="border border-zinc-200 rounded-xl p-3">
                  <p className="text-xs font-semibold text-zinc-700 mb-2">
                    {resultado.created} voucher{resultado.created !== 1 ? 's' : ''} gerado{resultado.created !== 1 ? 's' : ''}
                    {resultado.skipped > 0 && <span className="text-zinc-400 font-normal"> · {resultado.skipped} já tinha{resultado.skipped !== 1 ? 'm' : ''}</span>}
                  </p>
                  {resultado.items.length > 0 && (
                    <div className="space-y-1.5 max-h-40 overflow-auto">
                      {resultado.items.map((it) => (
                        <div key={it.customer_id} className="flex items-center justify-between gap-2 text-xs">
                          <span className="text-zinc-600 truncate">{it.name} · <span className="font-mono text-zinc-400">{it.code}</span></span>
                          <button
                            onClick={() => enviarWhatsApp(it)}
                            disabled={!it.phone}
                            className="flex items-center gap-1 px-2 py-1 rounded-lg text-green-600 hover:bg-green-50 disabled:opacity-30 cursor-pointer flex-shrink-0"
                            title={it.phone ? 'Enviar no WhatsApp' : 'Sem telefone'}
                          >
                            <i className="ri-whatsapp-line" /> Enviar
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {!loading && (
          <div className="flex gap-2 px-5 py-4 border-t border-zinc-100 flex-shrink-0">
            <button onClick={salvarConfig} disabled={salvando || gerando} className="px-4 py-2.5 rounded-xl border border-zinc-200 text-zinc-600 text-sm font-semibold hover:bg-zinc-50 cursor-pointer disabled:opacity-50">
              {salvando ? 'Salvando…' : 'Salvar config'}
            </button>
            <button
              onClick={gerarAgora}
              disabled={gerando || salvando}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-amber-500 text-white text-sm font-semibold hover:bg-amber-600 cursor-pointer disabled:opacity-50"
            >
              {gerando ? <><i className="ri-loader-4-line animate-spin" /> Gerando…</> : <><i className="ri-cake-3-line" /> Gerar vouchers do mês</>}
            </button>
          </div>
        )}
      </div>
    </>
  );
}
