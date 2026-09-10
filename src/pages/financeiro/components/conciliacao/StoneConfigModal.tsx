import { useState, useEffect } from 'react';
import { invokeWithAuth } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useBankAccounts } from '@/hooks/useFinanceiro';

// Configuração da API de Conciliação da Stone. A chave nunca volta para o front:
// get_config devolve só has_key. Salvar valida baixando um arquivo na Stone.

interface StoneConfig {
  stone_code: string;
  is_active: boolean;
  last_sync_at?: string | null;
  last_sync_error?: string | null;
  bank_account_id?: string | null;
  auto_sync?: boolean;
  has_key?: boolean;
}

interface Props {
  onClose: () => void;
  onSaved: () => void;
}

type Resp = { success?: boolean; error?: string; message?: string; config?: StoneConfig | null };

export default function StoneConfigModal({ onClose, onSaved }: Props) {
  const { user } = useAuth();
  const { accounts: bankAccounts } = useBankAccounts();
  const [stoneCode, setStoneCode] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [bankAccountId, setBankAccountId] = useState('');
  const [autoSync, setAutoSync] = useState(true);
  const [showApiKey, setShowApiKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [existingConfig, setExistingConfig] = useState<StoneConfig | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const resp = await invokeWithAuth<Resp>('stone-conciliation', { body: { action: 'get_config', tenant_id: user?.tenantId } });
      const cfg = resp.data?.config ?? null;
      if (cfg) {
        setExistingConfig(cfg);
        setStoneCode(cfg.stone_code || '');
        setBankAccountId(cfg.bank_account_id || '');
        setAutoSync(cfg.auto_sync !== false);
      }
      setLoading(false);
    })();
  }, [user?.tenantId]);

  const handleSave = async () => {
    if (!stoneCode.trim()) { setResult({ ok: false, msg: 'Informe o StoneCode.' }); return; }
    if (!apiKey.trim() && !existingConfig?.has_key) { setResult({ ok: false, msg: 'Informe a Chave Secreta da Stone.' }); return; }
    if (!bankAccountId) { setResult({ ok: false, msg: 'Selecione a conta que recebe os repasses da Stone.' }); return; }
    setSaving(true);
    setResult(null);
    const resp = await invokeWithAuth<Resp>('stone-conciliation', {
      body: { action: 'save_config', tenant_id: user?.tenantId, stone_code: stoneCode.trim(), api_key: apiKey.trim(), bank_account_id: bankAccountId, auto_sync: autoSync },
    });
    setSaving(false);
    const err = resp.error?.message ?? resp.data?.error;
    if (err || !resp.data?.success) {
      setResult({ ok: false, msg: err || 'Erro ao salvar configuração.' });
      return;
    }
    setResult({ ok: true, msg: resp.data.message || 'Configuração salva.' });
    setTimeout(() => { onSaved(); onClose(); }, 1500);
  };

  const handleRemove = async () => {
    if (!window.confirm('Remover a integração com a Stone? As linhas já importadas continuam na conciliação.')) return;
    setRemoving(true);
    const resp = await invokeWithAuth<Resp>('stone-conciliation', { body: { action: 'delete_config', tenant_id: user?.tenantId } });
    setRemoving(false);
    if (resp.error || resp.data?.error) { setResult({ ok: false, msg: resp.error?.message ?? resp.data?.error ?? 'Erro ao remover.' }); return; }
    onSaved();
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-lg max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 flex items-center justify-center rounded-xl bg-green-100">
              <i className="ri-bank-card-line text-green-600 text-lg" />
            </div>
            <div>
              <h3 className="font-bold text-zinc-900">Integração Stone</h3>
              <p className="text-xs text-zinc-500">Repasses, tarifas e chargebacks da maquininha, todo dia</p>
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-zinc-100 cursor-pointer">
            <i className="ri-close-line text-zinc-500" />
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="w-6 h-6 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <div className="p-6 space-y-5 overflow-y-auto">
            {existingConfig && (
              <div className={`flex items-start gap-2 px-3 py-2 rounded-xl border ${existingConfig.last_sync_error ? 'bg-red-50 border-red-200' : 'bg-green-50 border-green-200'}`}>
                <i className={`${existingConfig.last_sync_error ? 'ri-error-warning-fill text-red-600' : 'ri-checkbox-circle-fill text-green-600'} mt-0.5`} />
                <div className="flex-1 text-xs">
                  <p className={`font-semibold ${existingConfig.last_sync_error ? 'text-red-700' : 'text-green-700'}`}>Integração configurada</p>
                  {existingConfig.last_sync_at && <p className="text-zinc-600">Última sincronização: {new Date(existingConfig.last_sync_at).toLocaleString('pt-BR')}</p>}
                  {existingConfig.last_sync_error && <p className="text-red-700 mt-1">Último erro: {existingConfig.last_sync_error}</p>}
                </div>
              </div>
            )}

            <div className="bg-zinc-50 rounded-xl p-4 space-y-2">
              <p className="text-xs font-semibold text-zinc-700 flex items-center gap-1.5">
                <i className="ri-information-line text-zinc-400" /> Como obter a Chave Secreta
              </p>
              <ol className="space-y-1.5 text-xs text-zinc-600 list-decimal pl-4">
                <li>Acesse o <strong>Portal Stone</strong> com o usuário dono da conta.</li>
                <li>Vá em <strong>Conciliação</strong> (ou Perfil › Chaves de autenticação) e crie uma chave para a <strong>API de Conciliação</strong>.</li>
                <li>Copie a <strong>Chave Secreta</strong> e cole abaixo. O <strong>StoneCode</strong> é o número de afiliação que aparece no portal e no comprovante da maquininha.</li>
              </ol>
              <p className="text-[11px] text-zinc-400">O arquivo de um dia fica disponível a partir das 05h do dia seguinte. A sincronização automática roda às 06h30.</p>
            </div>

            <div>
              <label className="block text-xs font-semibold text-zinc-700 mb-1.5">StoneCode <span className="text-red-500">*</span></label>
              <input type="text" inputMode="numeric" value={stoneCode} onChange={(e) => setStoneCode(e.target.value)} placeholder="Ex: 902591688"
                className="w-full border border-zinc-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-400 font-mono" />
            </div>

            <div>
              <label className="block text-xs font-semibold text-zinc-700 mb-1.5">Chave Secreta da Stone {!existingConfig?.has_key && <span className="text-red-500">*</span>}</label>
              <div className="relative">
                <input type={showApiKey ? 'text' : 'password'} value={apiKey} onChange={(e) => setApiKey(e.target.value)}
                  placeholder={existingConfig?.has_key ? '•••••••••••• (manter a atual)' : 'Cole a chave aqui'}
                  className="w-full border border-zinc-200 rounded-lg px-3 py-2.5 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-green-400 font-mono" />
                <button type="button" onClick={() => setShowApiKey(!showApiKey)} className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 cursor-pointer">
                  <i className={showApiKey ? 'ri-eye-off-line' : 'ri-eye-line'} />
                </button>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-zinc-700 mb-1.5">Conta que recebe os repasses da Stone <span className="text-red-500">*</span></label>
              <select value={bankAccountId} onChange={(e) => setBankAccountId(e.target.value)}
                className="w-full border border-zinc-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-400 bg-white">
                <option value="">Selecione uma conta...</option>
                {bankAccounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.name} {a.bank_name ? `(${a.bank_name})` : ''}</option>
                ))}
              </select>
              <p className="text-xs text-zinc-400 mt-1">
                Cada parcela depositada, tarifa e chargeback vira uma linha na conciliação desta conta. Se você também importar o OFX da mesma conta, os depósitos aparecem duas vezes: use contas separadas ou só uma das fontes.
              </p>
            </div>

            <label className="flex items-center gap-2 text-xs text-zinc-700 cursor-pointer">
              <input type="checkbox" checked={autoSync} onChange={(e) => setAutoSync(e.target.checked)} className="rounded" />
              Importar automaticamente todo dia às 06h30
            </label>

            {result && (
              <div className={`flex items-start gap-2 px-3 py-2.5 rounded-xl text-xs font-medium ${result.ok ? 'bg-green-50 border border-green-200 text-green-700' : 'bg-red-50 border border-red-200 text-red-700'}`}>
                <i className={`${result.ok ? 'ri-checkbox-circle-fill' : 'ri-error-warning-fill'} text-sm flex-shrink-0 mt-0.5`} />
                <span className="break-words">{result.msg}</span>
              </div>
            )}

            <div className="flex items-center gap-3 pt-2">
              {existingConfig && (
                <button onClick={handleRemove} disabled={removing || saving} className="px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 rounded-lg cursor-pointer whitespace-nowrap disabled:opacity-50">
                  {removing ? 'Removendo...' : 'Remover'}
                </button>
              )}
              <div className="flex-1" />
              <button onClick={onClose} className="px-4 py-2.5 text-sm text-zinc-600 hover:bg-zinc-100 rounded-lg cursor-pointer whitespace-nowrap">Cancelar</button>
              <button onClick={handleSave} disabled={saving}
                className="flex items-center gap-2 px-4 py-2.5 bg-green-600 text-white rounded-lg text-sm font-semibold hover:bg-green-700 cursor-pointer whitespace-nowrap disabled:opacity-50">
                {saving ? <><div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" /> Validando na Stone...</> : <><i className="ri-save-line" /> Salvar e validar</>}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
