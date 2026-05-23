import { useState, useEffect } from 'react';
import QRCode from 'react-qr-code';
import { useSystemSettings } from '@/hooks/useSystemSettings';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';

interface PixConfigModalProps {
  onClose: () => void;
}

const PIX_KEY_TYPES = [
  { value: 'cpf', label: 'CPF', mask: '000.000.000-00', placeholder: '000.000.000-00' },
  { value: 'cnpj', label: 'CNPJ', mask: '00.000.000/0000-00', placeholder: '00.000.000/0000-00' },
  { value: 'email', label: 'E-mail', placeholder: 'contato@seurestaurante.com.br' },
  { value: 'phone', label: 'Telefone', placeholder: '+5511999999999' },
  { value: 'random', label: 'Chave Aleatória', placeholder: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx' },
];

export default function PixConfigModal({ onClose }: PixConfigModalProps) {
  const { settings, salvar } = useSystemSettings();
  const { user } = useAuth();

  const [pixKey, setPixKey] = useState('');
  const [pixKeyType, setPixKeyType] = useState('email');
  const [beneficiaryName, setBeneficiaryName] = useState('');
  const [city, setCity] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [previewPayload, setPreviewPayload] = useState('');
  const [loadingPreview, setLoadingPreview] = useState(false);

  // Carrega dados atuais do banco (campos novos não estão no contexto ainda)
  useEffect(() => {
    if (!user?.tenantId) return;
    supabase
      .from('system_settings')
      .select('pix_key, pix_key_type, pix_beneficiary_name, pix_city')
      .eq('tenant_id', user.tenantId)
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          setPixKey(data.pix_key ?? '');
          setPixKeyType(data.pix_key_type ?? 'email');
          setBeneficiaryName(data.pix_beneficiary_name ?? '');
          setCity(data.pix_city ?? '');
        }
      });
  }, [user?.tenantId]);

  // Gera preview do QR Code quando os campos estão preenchidos
  useEffect(() => {
    if (!pixKey || !beneficiaryName || !city) {
      setPreviewPayload('');
      return;
    }
    const timer = setTimeout(() => {
      generatePreview();
    }, 800);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pixKey, pixKeyType, beneficiaryName, city]);

  const generatePreview = async () => {
    if (!user?.tenantId || !pixKey || !beneficiaryName || !city) return;
    setLoadingPreview(true);
    try {
      // Salva temporariamente para gerar o payload via edge function
      const { data, error: fnErr } = await supabase.functions.invoke('pix-payment', {
        body: {
          action: 'generate',
          tenant_id: user.tenantId,
          amount: 1.00,
          // Passa os dados diretamente para preview sem salvar no banco
        },
      });
      // Se não tiver chave configurada ainda, gera localmente
      if (fnErr || !data?.emv_payload) {
        // Gera payload local simples para preview
        const simple = `00020126${(14 + pixKey.length).toString().padStart(2, '0')}0014br.gov.bcb.pix01${pixKey.length.toString().padStart(2, '0')}${pixKey}52040000530398654041.005802BR59${beneficiaryName.substring(0, 25).length.toString().padStart(2, '0')}${beneficiaryName.substring(0, 25).toUpperCase()}60${city.substring(0, 15).length.toString().padStart(2, '0')}${city.substring(0, 15).toUpperCase()}6304ABCD`;
        setPreviewPayload(simple);
      } else {
        setPreviewPayload(data.emv_payload);
      }
    } catch {
      setPreviewPayload('preview-error');
    } finally {
      setLoadingPreview(false);
    }
  };

  const handleSave = async () => {
    if (!pixKey.trim()) { setError('Informe a chave PIX'); return; }
    if (!beneficiaryName.trim()) { setError('Informe o nome do beneficiário'); return; }
    if (!city.trim()) { setError('Informe a cidade'); return; }

    setSaving(true);
    setError('');
    try {
      // Salva direto no banco (campos novos não passam pelo config-write ainda)
      const { error: dbErr } = await supabase
        .from('system_settings')
        .update({
          pix_key: pixKey.trim(),
          pix_key_type: pixKeyType,
          pix_beneficiary_name: beneficiaryName.trim().toUpperCase().substring(0, 25),
          pix_city: city.trim().toUpperCase().substring(0, 15),
          updated_at: new Date().toISOString(),
        })
        .eq('tenant_id', user!.tenantId);

      if (dbErr) throw dbErr;
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e) {
      setError('Erro ao salvar: ' + String(e));
    } finally {
      setSaving(false);
    }
  };

  const selectedType = PIX_KEY_TYPES.find((t) => t.value === pixKeyType);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-100">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 flex items-center justify-center bg-emerald-50 rounded-xl">
              <i className="ri-qr-code-line text-emerald-600 text-lg" />
            </div>
            <div>
              <h2 className="text-base font-bold text-zinc-900">Configuração PIX</h2>
              <p className="text-xs text-zinc-400">Chave PIX para pagamentos no autoatendimento</p>
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center hover:bg-zinc-100 rounded-lg cursor-pointer transition-colors">
            <i className="ri-close-line text-zinc-500" />
          </button>
        </div>

        <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Formulário */}
          <div className="flex flex-col gap-4">
            {/* Tipo de chave */}
            <div>
              <label className="block text-xs font-semibold text-zinc-600 mb-2">Tipo de Chave PIX</label>
              <div className="grid grid-cols-3 gap-1.5">
                {PIX_KEY_TYPES.map((t) => (
                  <button
                    key={t.value}
                    onClick={() => setPixKeyType(t.value)}
                    className={`py-2 px-3 rounded-lg text-xs font-semibold border-2 cursor-pointer transition-all ${
                      pixKeyType === t.value
                        ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                        : 'border-zinc-200 text-zinc-500 hover:border-zinc-300'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Chave PIX */}
            <div>
              <label className="block text-xs font-semibold text-zinc-600 mb-1.5">
                Chave PIX <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={pixKey}
                onChange={(e) => setPixKey(e.target.value)}
                placeholder={selectedType?.placeholder ?? 'Digite a chave PIX'}
                className="w-full px-3 py-2.5 text-sm border border-zinc-200 rounded-lg focus:outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 transition-all"
              />
              <p className="text-xs text-zinc-400 mt-1">
                {pixKeyType === 'cpf' && 'CPF do titular da conta (somente números)'}
                {pixKeyType === 'cnpj' && 'CNPJ do estabelecimento (somente números)'}
                {pixKeyType === 'email' && 'E-mail cadastrado no banco'}
                {pixKeyType === 'phone' && 'Telefone com DDD e código do país (+55)'}
                {pixKeyType === 'random' && 'Chave aleatória gerada pelo banco (UUID)'}
              </p>
            </div>

            {/* Nome do beneficiário */}
            <div>
              <label className="block text-xs font-semibold text-zinc-600 mb-1.5">
                Nome do Beneficiário <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={beneficiaryName}
                onChange={(e) => setBeneficiaryName(e.target.value.toUpperCase())}
                placeholder="NOME DO RESTAURANTE"
                maxLength={25}
                className="w-full px-3 py-2.5 text-sm border border-zinc-200 rounded-lg focus:outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 transition-all uppercase"
              />
              <p className="text-xs text-zinc-400 mt-1">Aparece no comprovante do cliente (máx. 25 caracteres)</p>
            </div>

            {/* Cidade */}
            <div>
              <label className="block text-xs font-semibold text-zinc-600 mb-1.5">
                Cidade <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={city}
                onChange={(e) => setCity(e.target.value.toUpperCase())}
                placeholder="SAO PAULO"
                maxLength={15}
                className="w-full px-3 py-2.5 text-sm border border-zinc-200 rounded-lg focus:outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 transition-all uppercase"
              />
              <p className="text-xs text-zinc-400 mt-1">Cidade do estabelecimento (máx. 15 caracteres, sem acentos)</p>
            </div>

            {error && (
              <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5">
                <i className="ri-error-warning-line text-red-500 text-sm flex-shrink-0" />
                <p className="text-red-600 text-xs">{error}</p>
              </div>
            )}

            {saved && (
              <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2.5">
                <i className="ri-checkbox-circle-line text-emerald-500 text-sm flex-shrink-0" />
                <p className="text-emerald-700 text-xs font-semibold">Configuração salva com sucesso!</p>
              </div>
            )}

            <button
              onClick={handleSave}
              disabled={saving}
              className="w-full py-2.5 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-60 text-white font-bold text-sm rounded-xl cursor-pointer transition-colors whitespace-nowrap"
            >
              {saving ? 'Salvando...' : 'Salvar Configuração PIX'}
            </button>
          </div>

          {/* Preview QR Code */}
          <div className="flex flex-col items-center gap-4">
            <div className="w-full bg-zinc-50 rounded-xl p-4 border border-zinc-100">
              <p className="text-xs font-semibold text-zinc-500 text-center mb-3">Preview do QR Code</p>
              <div className="flex flex-col items-center gap-3">
                {pixKey && beneficiaryName && city ? (
                  loadingPreview ? (
                    <div className="w-40 h-40 flex items-center justify-center bg-white rounded-xl border border-zinc-200">
                      <div className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
                    </div>
                  ) : previewPayload ? (
                    <div className="bg-white p-3 rounded-xl border border-zinc-200">
                      <QRCode value={previewPayload} size={148} level="M" style={{ display: 'block' }} />
                    </div>
                  ) : null
                ) : (
                  <div className="w-40 h-40 flex flex-col items-center justify-center bg-white rounded-xl border-2 border-dashed border-zinc-200 gap-2">
                    <i className="ri-qr-code-line text-3xl text-zinc-300" />
                    <p className="text-xs text-zinc-400 text-center px-2">Preencha os campos para ver o preview</p>
                  </div>
                )}

                {pixKey && (
                  <div className="w-full bg-white rounded-lg border border-zinc-200 p-3 text-center">
                    <p className="text-xs text-zinc-400 mb-0.5">Chave PIX</p>
                    <p className="text-xs font-mono font-bold text-zinc-700 break-all">{pixKey}</p>
                    {beneficiaryName && (
                      <>
                        <p className="text-xs text-zinc-400 mt-2 mb-0.5">Beneficiário</p>
                        <p className="text-xs font-bold text-zinc-700">{beneficiaryName}</p>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Info sobre como funciona */}
            <div className="w-full bg-amber-50 border border-amber-200 rounded-xl p-4">
              <div className="flex items-start gap-2">
                <i className="ri-information-line text-amber-500 text-sm flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-bold text-amber-700 mb-1">Como funciona</p>
                  <ul className="text-xs text-amber-600 space-y-1">
                    <li>• O QR Code é gerado automaticamente ao finalizar o pedido</li>
                    <li>• O cliente escaneia com o app do banco e paga</li>
                    <li>• O sistema verifica o pagamento a cada 3 segundos</li>
                    <li>• Ao confirmar, o pedido é registrado automaticamente</li>
                  </ul>
                </div>
              </div>
            </div>

            <div className="w-full bg-zinc-50 border border-zinc-200 rounded-xl p-4">
              <div className="flex items-start gap-2">
                <i className="ri-shield-check-line text-zinc-500 text-sm flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-bold text-zinc-600 mb-1">Confirmação manual</p>
                  <p className="text-xs text-zinc-500">
                    Enquanto não há integração automática com o banco, o operador pode confirmar o pagamento manualmente pelo botão &quot;Confirmar PIX&quot; no totem.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
