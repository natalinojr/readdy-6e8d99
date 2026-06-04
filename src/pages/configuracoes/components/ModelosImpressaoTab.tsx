import { useState, useEffect } from 'react';
import { useImpressoras } from '@/contexts/ImpressorasContext';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { supabase } from '@/lib/supabase';

interface KitchenStation {
  id: string;
  name: string;
  color: string;
  sla_minutes: number;
  sort_order: number;
  is_active: boolean;
}

const CAIXA_PDV_KEY = 'caixa-pdv';
const CAIXA_PDV_NAME = 'Caixa PDV';
const CAIXA_PDV_COLOR = '#52525b';

const CLIENTE_KEY = 'cliente';
const CLIENTE_NAME = 'Cliente (Senha / Comprovante)';
const CLIENTE_COLOR = '#0ea5e9';

const PEDIDOS_KEY = 'pedidos';
const PEDIDOS_NAME = 'Pedidos (Resumo / Relatório)';
const PEDIDOS_COLOR = '#8b5cf6';

const GESTOR_PEDIDOS_KEY = 'gestor-pedidos';
const GESTOR_PEDIDOS_NAME = 'Gestor de Pedidos (Comanda)';
const GESTOR_PEDIDOS_COLOR = '#f59e0b';

const RELATORIOS_KEY = 'relatorios';
const RELATORIOS_NAME = 'Relatórios (DRE / Folha / Caixa)';
const RELATORIOS_COLOR = '#ec4899';

const QR_CODES_KEY = 'qrcodes';
const QR_CODES_NAME = 'QR Codes das Mesas';
const QR_CODES_COLOR = '#10b981';

function colorBadgeStyle(hex: string) {
  return {
    color: hex,
    backgroundColor: hex + '14',
    borderColor: hex + '33',
  };
}

function colorDotStyle(hex: string) {
  return { backgroundColor: hex };
}

export default function ModelosImpressaoTab() {
  const {
    impressoras,
    mapaEstacoes,
    printTemplates,
    getTemplateParaEstacao,
    getImpressoraParaEstacao,
    updatePrintTemplate,
    resetPrintTemplate,
    salvarTemplates,
    salvando,
  } = useImpressoras();

  const { user } = useAuth();
  const { success: toastSuccess } = useToast();
  const [stations, setStations] = useState<KitchenStation[]>([]);
  const [stationsLoading, setStationsLoading] = useState(true);
  const [selectedStation, setSelectedStation] = useState<string | null>(null);
  const [salvo, setSalvo] = useState(false);

  useEffect(() => {
    if (!user?.tenantId) { setStationsLoading(false); return; }
    async function fetchStations() {
      setStationsLoading(true);
      const { data, error } = await supabase
        .from('kitchen_stations')
        .select('id,name,color,sla_minutes,sort_order,is_active')
        .eq('tenant_id', user!.tenantId)
        .eq('is_active', true)
        .order('sort_order', { ascending: true })
        .order('name', { ascending: true });
      if (!error && data) setStations(data as KitchenStation[]);
      setStationsLoading(false);
    }
    fetchStations();
  }, [user?.tenantId]);

  const allStations = [
    ...stations.map((s) => ({ key: s.id, label: s.name, color: s.color })),
    { key: CAIXA_PDV_KEY, label: CAIXA_PDV_NAME, color: CAIXA_PDV_COLOR },
    { key: CLIENTE_KEY, label: CLIENTE_NAME, color: CLIENTE_COLOR },
    { key: PEDIDOS_KEY, label: PEDIDOS_NAME, color: PEDIDOS_COLOR },
    { key: GESTOR_PEDIDOS_KEY, label: GESTOR_PEDIDOS_NAME, color: GESTOR_PEDIDOS_COLOR },
    { key: RELATORIOS_KEY, label: RELATORIOS_NAME, color: RELATORIOS_COLOR },
    { key: QR_CODES_KEY, label: QR_CODES_NAME, color: QR_CODES_COLOR },
  ];

  const getImpressoraName = (stationKey: string) => {
    const imp = getImpressoraParaEstacao(stationKey);
    return imp?.nome ?? '— Sem impressora —';
  };

  const handleSalvar = async () => {
    await salvarTemplates();
    setSalvo(true);
    toastSuccess('Modelos salvos!', 'Templates de impressão atualizados com sucesso.');
    setTimeout(() => setSalvo(false), 2500);
  };

  const StationCard = ({ station }: { station: typeof allStations[0] }) => {
    const tpl = getTemplateParaEstacao(station.key);
    const isOpen = selectedStation === station.key;
    const impName = getImpressoraName(station.key);
    const hasCustom = !!printTemplates?.[station.key];

    return (
      <div className="bg-white border border-zinc-200 rounded-xl overflow-hidden">
        <button
          onClick={() => setSelectedStation(isOpen ? null : station.key)}
          className="w-full flex items-center justify-between px-4 py-3 hover:bg-zinc-50 transition-colors cursor-pointer"
        >
          <div className="flex items-center gap-3">
            <div
              className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-lg border"
              style={colorBadgeStyle(station.color)}
            >
              <div className="w-2 h-2 rounded-full" style={colorDotStyle(station.color)} />
              <span className="truncate">{station.label}</span>
            </div>
            <div className="text-left">
              <p className="text-xs font-medium text-zinc-600">{impName}</p>
              {hasCustom && (
                <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-amber-600 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded mt-0.5">
                  <i className="ri-pencil-ruler-2-line text-[10px]" />
                  Customizado
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <i className={`ri-${isOpen ? 'arrow-up' : 'arrow-down'}-s-line text-zinc-400`} />
          </div>
        </button>

        {isOpen && tpl && (
          <div className="px-4 pb-4 pt-1 border-t border-zinc-100">
            <TemplateEditor
              stationKey={station.key}
              stationLabel={station.label}
              template={tpl}
              onUpdate={updatePrintTemplate}
              onReset={resetPrintTemplate}
              hasCustom={hasCustom}
            />
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6 max-w-4xl">
      {salvo && (
        <div className="flex items-center gap-2 px-4 py-3 bg-emerald-50 border border-emerald-200 rounded-xl">
          <i className="ri-check-line text-emerald-500 text-sm" />
          <p className="text-xs font-semibold text-emerald-700">Templates de impressão salvos com sucesso!</p>
        </div>
      )}

      <div>
        <h2 className="text-base font-bold text-zinc-900">Modelos de Impressão</h2>
        <p className="text-xs text-zinc-500 mt-0.5">
          Personalize o layout do ticket impresso para cada estação. Defina quais informações aparecem no cabeçalho, no corpo e no rodapé do ticket.
        </p>
      </div>

      {/* Preview helper */}
      <div className="flex items-start gap-3 p-3 bg-amber-50 border border-amber-200 rounded-xl">
        <div className="w-5 h-5 flex items-center justify-center flex-shrink-0 mt-0.5">
          <i className="ri-lightbulb-line text-amber-600" />
        </div>
        <p className="text-[11px] text-amber-700">
          <strong>Dica:</strong> Cada estação pode ter um modelo diferente. A cozinha pode querer mostrar observações detalhadas, enquanto o caixa prefere dados do cliente e da mesa. Se não configurar, usa o padrão do sistema.
        </p>
      </div>

      {stationsLoading ? (
        <div className="flex items-center gap-2 p-4 bg-zinc-50 border border-zinc-200 rounded-xl text-xs text-zinc-500">
          <div className="w-4 h-4 border-2 border-zinc-300 border-t-transparent rounded-full animate-spin" />
          Carregando estações...
        </div>
      ) : (
        <div className="space-y-2">
          {allStations.map((s) => (
            <StationCard key={s.key} station={s} />
          ))}
        </div>
      )}

      <div className="flex justify-end pb-4">
        <button
          onClick={handleSalvar}
          disabled={salvando}
          className="flex items-center gap-2 px-5 py-2.5 bg-amber-500 text-white text-sm font-bold rounded-lg hover:bg-amber-600 disabled:opacity-60 cursor-pointer transition-colors whitespace-nowrap"
        >
          {salvando ? (
            <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
          ) : (
            <i className="ri-save-line" />
          )}
          {salvando ? 'Salvando...' : 'Salvar modelos de impressão'}
        </button>
      </div>
    </div>
  );
}

function TemplateEditor({
  stationKey,
  stationLabel,
  template,
  onUpdate,
  onReset,
  hasCustom,
}: {
  stationKey: string;
  stationLabel: string;
  template: ReturnType<typeof useImpressoras>['getTemplateParaEstacao'];
  onUpdate: (key: string, data: Partial<ReturnType<typeof useImpressoras>['getTemplateParaEstacao']>) => void;
  onReset: (key: string) => void;
  hasCustom: boolean;
}) {
  if (!template) return null;

  const toggle = (field: keyof typeof template) => {
    onUpdate(stationKey, { [field]: !template[field] });
  };

  const switches = [
    { field: 'showLogo' as const, label: 'Mostrar logo da loja', icon: 'ri-image-line' },
    { field: 'showOrderNumber' as const, label: 'Número do pedido', icon: 'ri-hashtag' },
    { field: 'showDateTime' as const, label: 'Data e hora do pedido', icon: 'ri-time-line' },
    { field: 'showStationName' as const, label: 'Nome da estação', icon: 'ri-store-2-line' },
    { field: 'showItemObservations' as const, label: 'Observações dos itens', icon: 'ri-chat-1-line' },
    { field: 'showItemOptions' as const, label: 'Opções / complementos dos itens', icon: 'ri-list-check-2' },
    { field: 'showCustomerName' as const, label: 'Nome do cliente', icon: 'ri-user-line' },
    { field: 'showTableInfo' as const, label: 'Informações da mesa / comanda', icon: 'ri-table-line' },
    { field: 'showWaiterName' as const, label: 'Nome do garçom / atendente', icon: 'ri-user-star-line' },
  ];

  return (
    <div className="space-y-4 mt-2">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {switches.map((sw) => (
          <label
            key={sw.field}
            className="flex items-center gap-2.5 p-2.5 bg-zinc-50 border border-zinc-200 rounded-lg cursor-pointer hover:bg-zinc-100 transition-colors"
          >
            <div className="w-4 h-4 flex items-center justify-center flex-shrink-0">
              <i className={`${sw.icon} text-zinc-400 text-sm`} />
            </div>
            <span className="text-xs font-medium text-zinc-700 flex-1">{sw.label}</span>
            <div
              onClick={() => toggle(sw.field)}
              className={`w-9 h-5 flex items-center rounded-full cursor-pointer transition-colors px-0.5 ${
                template[sw.field] ? 'bg-amber-500 justify-end' : 'bg-zinc-300 justify-start'
              }`}
            >
              <div className="w-4 h-4 bg-white rounded-full shadow-sm" />
            </div>
          </label>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-semibold text-zinc-700 mb-1 block">Mensagem no cabeçalho</label>
          <input
            type="text"
            value={template.headerMessage}
            onChange={(e) => onUpdate(stationKey, { headerMessage: e.target.value })}
            placeholder="Ex: PEDIDO COZINHA"
            maxLength={40}
            className="w-full text-sm border border-zinc-200 rounded-lg px-3 py-2 text-zinc-900 placeholder-zinc-400 focus:outline-none focus:border-amber-400"
          />
          <p className="text-[10px] text-zinc-400 mt-0.5">{template.headerMessage.length}/40</p>
        </div>
        <div>
          <label className="text-xs font-semibold text-zinc-700 mb-1 block">Mensagem no rodapé</label>
          <input
            type="text"
            value={template.footerMessage}
            onChange={(e) => onUpdate(stationKey, { footerMessage: e.target.value })}
            placeholder="Ex: Obrigado! Volte sempre"
            maxLength={60}
            className="w-full text-sm border border-zinc-200 rounded-lg px-3 py-2 text-zinc-900 placeholder-zinc-400 focus:outline-none focus:border-amber-400"
          />
          <p className="text-[10px] text-zinc-400 mt-0.5">{template.footerMessage.length}/60</p>
        </div>
      </div>

      {hasCustom && (
        <button
          onClick={() => {
            if (window.confirm(`Resetar o modelo de ${stationLabel} para o padrão do sistema?`)) {
              onReset(stationKey);
            }
          }}
          className="text-xs font-semibold text-zinc-500 hover:text-red-500 flex items-center gap-1 cursor-pointer transition-colors"
        >
          <i className="ri-refresh-line" />
          Resetar para padrão
        </button>
      )}
    </div>
  );
}
