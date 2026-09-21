import { useState, useEffect } from 'react';
import { invokeWithAuth } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import MpPointConfigModal from './MpPointConfigModal';

// Aba "Maquininha" para quem tem só a permissão `cfg_maquininha_mp`, sem a aba
// Estações & Pagamentos inteira. É o mesmo cartão que vive lá dentro (quem tem
// Estações continua configurando por lá), isolado para a loja poder trocar a
// máquina do balcão sem acesso a formas de pagamento, taxas, Stone e Inter.
export default function MaquininhaTab() {
  const { user } = useAuth();
  const [info, setInfo] = useState<{ is_active: boolean; sandbox: boolean } | null>(null);
  const [showModal, setShowModal] = useState(false);

  useEffect(() => {
    if (!user?.tenantId) return;
    invokeWithAuth<{ is_active: boolean; environment: string }>('pix-payment', {
      body: { action: 'get_point_config', tenant_id: user.tenantId },
    })
      .then(({ data }) => setInfo({ is_active: Boolean(data?.is_active), sandbox: data?.environment === 'sandbox' }))
      .catch(() => setInfo({ is_active: false, sandbox: false }));
  }, [user?.tenantId]);

  const ativa = info?.is_active === true;

  return (
    <div className="space-y-4 max-w-2xl">
      <div>
        <h3 className="text-sm font-bold text-zinc-800">Maquininha do balcão</h3>
        <p className="text-xs text-zinc-400 mt-0.5">
          A máquina do Mercado Pago que recebe as cobranças do sistema. Trocou de máquina? É aqui
          que você diz qual é a nova.
        </p>
      </div>

      <button
        type="button"
        onClick={() => setShowModal(true)}
        className={`w-full text-left border rounded-xl p-4 cursor-pointer transition-colors ${ativa ? 'bg-emerald-50 border-emerald-200 hover:bg-emerald-100/60' : 'bg-sky-50 border-sky-200 hover:bg-sky-100/60'}`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 flex items-center justify-center rounded-xl flex-shrink-0 ${ativa ? 'bg-emerald-500' : 'bg-sky-600'}`}>
              <i className="ri-bank-card-line text-white text-lg" />
            </div>
            <div>
              <p className={`text-sm font-bold ${ativa ? 'text-emerald-800' : 'text-sky-800'}`}>Maquininha (Mercado Pago Point)</p>
              <p className={`text-xs ${ativa ? 'text-emerald-600' : 'text-sky-600'}`}>O sistema manda a cobrança pra máquina do balcão e o Mercado Pago confirma</p>
            </div>
          </div>
          <span className={`text-[10px] font-semibold px-2.5 py-1.5 rounded-lg flex-shrink-0 whitespace-nowrap flex items-center gap-1 ${ativa ? 'text-emerald-600 bg-emerald-100' : 'text-sky-700 bg-sky-100'}`}>
            <i className={`text-sm ${ativa ? 'ri-shield-check-line' : 'ri-settings-3-line'}`} />
            {info === null ? '…' : ativa ? (info.sandbox ? 'Teste' : 'Ativa') : 'Configurar'}
          </span>
        </div>
      </button>

      {showModal && (
        <MpPointConfigModal
          onClose={() => setShowModal(false)}
          onSaved={(novo) => setInfo((prev) => ({ is_active: novo.is_active, sandbox: prev?.sandbox ?? false }))}
        />
      )}
    </div>
  );
}
