import { useState, useEffect } from 'react';
import { invokeWithAuth } from '@/lib/supabase';
import { useBankAccounts } from '@/hooks/useFinanceiro';

interface StoneConfig {
  stone_code: string;
  is_active: boolean;
  last_sync_at?: string;
  bank_account_id?: string;
}

interface Props {
  onClose: () => void;
  onSaved: () => void;
}

export default function StoneConfigModal({ onClose, onSaved }: Props) {
  const { accounts: bankAccounts } = useBankAccounts();
  const [stoneCode, setStoneCode] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [bankAccountId, setBankAccountId] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [existingConfig, setExistingConfig] = useState<StoneConfig | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadConfig();
  }, []);

  const loadConfig = async () => {
    setLoading(true);
    const resp = await invokeWithAuth<{ config?: StoneConfig }>('stone-conciliation', {
      body: { action: 'get_config' },
    });

    if (resp.data?.config) {
      const cfg = resp.data.config;
      setExistingConfig(cfg);
      setStoneCode(cfg.stone_code || '');
      setBankAccountId(cfg.bank_account_id || '');
    }
    setLoading(false);
  };

  const handleSave = async () => {
    if (!stoneCode.trim() || !apiKey.trim()) {
      setTestResult({ ok: false, msg: 'Preencha o StoneCode e a Chave de API.' });
      return;
    }
    if (!bankAccountId) {
      setTestResult({ ok: false, msg: 'Selecione a conta bancária para receber as transações.' });
      return;
    }

    setSaving(true);
    setTestResult(null);

    const resp = await invokeWithAuth<{ error?: string }>('stone-conciliation', {
      body: {
        action: 'save_config',
        stone_code: stoneCode.trim(),
        api_key: apiKey.trim(),
        bank_account_id: bankAccountId,
      },
    });

    setSaving(false);

    if (resp.error || (resp.data as Record<string, unknown>)?.error) {
      setTestResult({ ok: false, msg: (resp.data as Record<string, unknown>)?.error as string || 'Erro ao salvar configuração.' });
    } else {
      setTestResult({ ok: true, msg: 'Configuração salva e credenciais validadas com sucesso!' });
      setTimeout(() => {
        onSaved();
        onClose();
      }, 1500);
    }
  };

  const handleTest = async () => {
    if (!stoneCode.trim() || !apiKey.trim()) {
      setTestResult({ ok: false, msg: 'Preencha o StoneCode e a Chave de API para testar.' });
      return;
    }

    setTesting(true);
    setTestResult(null);

    // Test by trying to save (which validates credentials)
    const resp = await invokeWithAuth<{ error?: string }>('stone-conciliation', {
      body: {
        action: 'save_config',
        stone_code: stoneCode.trim(),
        api_key: apiKey.trim(),
        bank_account_id: bankAccountId || null,
      },
    });

    setTesting(false);

    if (resp.error || (resp.data as Record<string, unknown>)?.error) {
      setTestResult({ ok: false, msg: (resp.data as Record<string, unknown>)?.error as string || 'Credenciais inválidas.' });
    } else {
      setTestResult({ ok: true, msg: 'Credenciais válidas! Conexão com a Stone estabelecida.' });
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-lg">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 flex items-center justify-center rounded-xl bg-green-100">
              <i className="ri-bank-card-line text-green-600 text-lg" />
            </div>
            <div>
              <h3 className="font-bold text-zinc-900">Integração Stone</h3>
              <p className="text-xs text-zinc-500">Conciliação automática via API</p>
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
          <div className="p-6 space-y-5">
            {/* Status badge */}
            {existingConfig && (
              <div className="flex items-center gap-2 px-3 py-2 bg-green-50 border border-green-200 rounded-xl">
                <i className="ri-checkbox-circle-fill text-green-600" />
                <div className="flex-1">
                  <p className="text-xs font-semibold text-green-700">Integração configurada</p>
                  {existingConfig.last_sync_at && (
                    <p className="text-xs text-green-600">
                      Última sincronização: {new Date(existingConfig.last_sync_at).toLocaleString('pt-BR')}
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* How to get credentials */}
            <div className="bg-zinc-50 rounded-xl p-4 space-y-2">
              <p className="text-xs font-semibold text-zinc-700 flex items-center gap-1.5">
                <i className="ri-information-line text-zinc-400" />
                Como obter suas credenciais
              </p>
              <ol className="space-y-1.5 text-xs text-zinc-600">
                <li className="flex items-start gap-2">
                  <span className="w-4 h-4 flex items-center justify-center rounded-full bg-zinc-200 text-zinc-600 font-bold text-xs flex-shrink-0 mt-0.5">1</span>
                  Acesse o <strong>Portal Stone</strong> (conta.stone.com.br)
                </li>
                <li className="flex items-start gap-2">
                  <span className="w-4 h-4 flex items-center justify-center rounded-full bg-zinc-200 text-zinc-600 font-bold text-xs flex-shrink-0 mt-0.5">2</span>
                  Vá em <strong>Perfil &gt; Chaves de Autenticação</strong>
                </li>
                <li className="flex items-start gap-2">
                  <span className="w-4 h-4 flex items-center justify-center rounded-full bg-zinc-200 text-zinc-600 font-bold text-xs flex-shrink-0 mt-0.5">3</span>
                  Clique em <strong>Criar Chave &gt; "API de Conciliação Stone"</strong>
                </li>
                <li className="flex items-start gap-2">
                  <span className="w-4 h-4 flex items-center justify-center rounded-full bg-zinc-200 text-zinc-600 font-bold text-xs flex-shrink-0 mt-0.5">4</span>
                  Copie a chave gerada e cole abaixo
                </li>
              </ol>
            </div>

            {/* StoneCode */}
            <div>
              <label className="block text-xs font-semibold text-zinc-700 mb-1.5">
                StoneCode <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={stoneCode}
                onChange={e => setStoneCode(e.target.value)}
                placeholder="Ex: 902591688"
                className="w-full border border-zinc-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-400"
              />
              <p className="text-xs text-zinc-400 mt-1">Número de afiliação da sua maquininha Stone</p>
            </div>

            {/* API Key */}
            <div>
              <label className="block text-xs font-semibold text-zinc-700 mb-1.5">
                Chave de API Stone <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <input
                  type={showApiKey ? 'text' : 'password'}
                  value={apiKey}
                  onChange={e => setApiKey(e.target.value)}
                  placeholder={existingConfig ? '••••••••••••••••••••••••••••••••' : 'Cole sua chave de API aqui'}
                  className="w-full border border-zinc-200 rounded-lg px-3 py-2.5 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-green-400 font-mono"
                />
                <button
                  type="button"
                  onClick={() => setShowApiKey(!showApiKey)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 cursor-pointer"
                >
                  <i className={showApiKey ? 'ri-eye-off-line' : 'ri-eye-line'} />
                </button>
              </div>
              {existingConfig && !apiKey && (
                <p className="text-xs text-amber-600 mt-1 flex items-center gap-1">
                  <i className="ri-information-line" />
                  Deixe em branco para manter a chave atual
                </p>
              )}
            </div>

            {/* Bank Account */}
            <div>
              <label className="block text-xs font-semibold text-zinc-700 mb-1.5">
                Conta bancária para receber as transações <span className="text-red-500">*</span>
              </label>
              <select
                value={bankAccountId}
                onChange={e => setBankAccountId(e.target.value)}
                className="w-full border border-zinc-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-400 bg-white"
              >
                <option value="">Selecione uma conta...</option>
                {bankAccounts.map(a => (
                  <option key={a.id} value={a.id}>{a.name} {a.bank_name ? `(${a.bank_name})` : ''}</option>
                ))}
              </select>
              <p className="text-xs text-zinc-400 mt-1">As transações da Stone serão importadas para esta conta</p>
            </div>

            {/* Test result */}
            {testResult && (
              <div className={`flex items-start gap-2 px-3 py-2.5 rounded-xl text-xs font-medium ${
                testResult.ok ? 'bg-green-50 border border-green-200 text-green-700' : 'bg-red-50 border border-red-200 text-red-700'
              }`}>
                <i className={`${testResult.ok ? 'ri-checkbox-circle-fill' : 'ri-error-warning-fill'} text-sm flex-shrink-0 mt-0.5`} />
                {testResult.msg}
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center gap-3 pt-2">
              <button
                onClick={handleTest}
                disabled={testing || saving || !stoneCode || !apiKey}
                className="flex items-center gap-2 px-4 py-2.5 border border-zinc-200 text-zinc-600 rounded-lg text-sm font-semibold hover:bg-zinc-50 cursor-pointer whitespace-nowrap transition-colors disabled:opacity-50"
              >
                {testing ? (
                  <>
                    <div className="w-4 h-4 border-2 border-zinc-400 border-t-transparent rounded-full animate-spin" />
                    Testando...
                  </>
                ) : (
                  <>
                    <i className="ri-wifi-line" />
                    Testar Conexão
                  </>
                )}
              </button>
              <button
                onClick={onClose}
                className="px-4 py-2.5 text-sm text-zinc-600 hover:bg-zinc-100 rounded-lg cursor-pointer whitespace-nowrap transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !stoneCode || (!apiKey && !existingConfig) || !bankAccountId}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-green-600 text-white rounded-lg text-sm font-semibold hover:bg-green-700 cursor-pointer whitespace-nowrap transition-colors disabled:opacity-50"
              >
                {saving ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                    Salvando...
                  </>
                ) : (
                  <>
                    <i className="ri-save-line" />
                    Salvar Configuração
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
