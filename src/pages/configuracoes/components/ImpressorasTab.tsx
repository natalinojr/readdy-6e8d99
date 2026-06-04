import { useState, useEffect, useMemo } from 'react';
import {
  useImpressoras,
  TODAS_ESTACOES_KEY,
  IMPRESSORA_PADRAO_WINDOWS_KEY,
  IMPRESSORA_PADRAO_WINDOWS_LABEL,
  type Impressora,
} from '@/contexts/ImpressorasContext';
import { printHTML } from '@/lib/printUtils';
import { useToast } from '@/contexts/ToastContext';
import { useAuth } from '@/contexts/AuthContext';
import { supabase, invokeWithAuth } from '@/lib/supabase';

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

function getStationIcon(name: string): string {
  const lower = name.toLowerCase();
  if (lower.includes('grelha') || lower.includes('chapa') || lower.includes('forno') || lower.includes('pizza')) return 'ri-fire-line';
  if (lower.includes('frit') || lower.includes('fritadeira')) return 'ri-drop-line';
  if (lower.includes('balcão') || lower.includes('bar') || lower.includes('balcao')) return 'ri-store-line';
  if (lower.includes('bebida') || lower.includes('drink')) return 'ri-goblet-line';
  if (lower.includes('doce') || lower.includes('confeitaria') || lower.includes('chocolate') || lower.includes('sobremesa')) return 'ri-cake-line';
  if (lower.includes('salada') || lower.includes('frio') || lower.includes('condiment')) return 'ri-bowl-line';
  if (lower.includes('sushi') || lower.includes('japa') || lower.includes('oriental')) return 'ri-restaurant-line';
  return 'ri-restaurant-line';
}

function colorBadgeStyle(hex: string) {
  return {
    color: hex,
    backgroundColor: hex + '14',
    borderColor: hex + '33',
  };
}

function colorDotStyle(hex: string) {
  return {
    backgroundColor: hex,
  };
}

function printTestPageUSB() {
  const now = new Date().toLocaleString('pt-BR');
  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8"/>
  <title>Teste USB</title>
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family: Arial, sans-serif; padding: 12px; width: 320px; }
    @media print { body { padding: 6px; width: 100%; } }
  </style>
</head>
<body>
  <div style="text-align:center; border:2px solid #000; padding:10px; margin-bottom:10px; border-radius:4px;">
    <div style="font-size:10px; letter-spacing:2px; color:#555; margin-bottom:3px;">PÁGINA DE TESTE</div>
    <div style="font-size:22px; font-weight:900; line-height:1.1;">Impressora USB</div>
    <div style="font-size:10px; color:#777; margin-top:3px;">Impressora padrão do Windows</div>
  </div>
  <div style="border-top:2px dashed #000; padding-top:6px; text-align:center;">
    <div style="font-size:9px; color:#999;">Impresso em ${now}</div>
  </div>
</body>
</html>`;
  printHTML(html);
}

function printTestPageRede(impressora: Impressora, estacoes: string[]) {
  const now = new Date().toLocaleString('pt-BR');
  const estacoesHtml = estacoes.length > 0
    ? estacoes.map((e) => `<div style="font-size:14px;margin:4px 0;"><span style="display:inline-block;width:100px;font-weight:bold;">${e}</span>✓ Configurada</div>`).join('')
    : '<div style="color:#999;font-size:13px;">Nenhuma estação mapeada ainda</div>';

  const paperWidth = impressora.paperStyle === '58mm' ? 200 : 320;

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8"/>
  <title>Teste de Impressão — ${impressora.nome}</title>
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family: Arial, sans-serif; padding: 12px; width: ${paperWidth}px; }
    @media print { body { padding: 6px; width: 100%; } }
  </style>
</head>
<body>
  <div style="text-align:center; border:2px solid #000; padding:10px; margin-bottom:10px; border-radius:4px;">
    <div style="font-size:10px; letter-spacing:2px; color:#555; margin-bottom:3px;">PÁGINA DE TESTE</div>
    <div style="font-size:${impressora.paperStyle === '58mm' ? '18px' : '24px'}; font-weight:900; line-height:1.1;">${impressora.nome}</div>
    <div style="font-size:10px; color:#777; margin-top:3px;">IP: ${impressora.ip || 'não configurado'}</div>
    <div style="font-size:10px; color:#777; margin-top:2px;">Papel: ${impressora.paperStyle === '58mm' ? '58mm' : '80mm'}</div>
  </div>
  <div style="border:1px solid #ddd; border-radius:4px; padding:8px; margin-bottom:10px;">
    <div style="font-size:9px; font-weight:700; letter-spacing:1px; color:#888; margin-bottom:6px;">ESTAÇÕES VINCULADAS</div>
    ${estacoesHtml}
  </div>
  ${impressora.descricao ? `
  <div style="padding:6px; background:#f5f5f5; border-radius:4px; margin-bottom:10px;">
    <div style="font-size:9px; font-weight:700; color:#888; margin-bottom:2px;">DESCRIÇÃO</div>
    <div style="font-size:11px;">${impressora.descricao}</div>
  </div>` : ''}
  <div style="border-top:2px dashed #000; padding-top:6px; text-align:center;">
    <div style="font-size:9px; color:#999;">Impresso em ${now}</div>
    <div style="font-size:8px; color:#bbb; margin-top:2px;">Sistema de Gestão — Configuração de Impressoras</div>
  </div>
</body>
</html>`;

  printHTML(html);
}

function PingBadge({
  status,
  ms,
}: {
  status: 'idle' | 'testing' | 'online' | 'offline';
  ms?: number;
}) {
  if (status === 'idle') return null;
  if (status === 'testing') {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-bold text-zinc-500 bg-zinc-50 border border-zinc-200 px-2 py-0.5 rounded-lg">
        <div className="w-3 h-3 border-2 border-zinc-300 border-t-transparent rounded-full animate-spin" />
        Testando...
      </span>
    );
  }
  if (status === 'online') {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-bold text-green-600 bg-green-50 border border-green-200 px-2 py-0.5 rounded-lg">
        <i className="ri-wifi-line text-[10px]" />
        Online {ms !== undefined ? `(${ms}ms)` : ''}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-bold text-red-600 bg-red-50 border border-red-200 px-2 py-0.5 rounded-lg">
      <i className="ri-wifi-off-line text-[10px]" />
      Offline
    </span>
  );
}

interface ImpressoraFormData {
  nome: string;
  ip: string;
  descricao: string;
  paperStyle: '80mm' | '58mm';
}

const EMPTY_FORM: ImpressoraFormData = { nome: '', ip: '', descricao: '', paperStyle: '80mm' };

function ImpressoraFormModal({
  initial,
  onSave,
  onClose,
}: {
  initial?: Impressora;
  onSave: (data: ImpressoraFormData) => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState<ImpressoraFormData>(
    initial
      ? { nome: initial.nome, ip: initial.ip, descricao: initial.descricao, paperStyle: initial.paperStyle ?? '80mm' }
      : EMPTY_FORM,
  );

  const isValid = form.nome.trim().length > 0;

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-md p-6 shadow-lg">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-9 h-9 flex items-center justify-center bg-amber-50 rounded-xl">
            <i className="ri-printer-line text-amber-600 text-lg" />
          </div>
          <h3 className="text-base font-bold text-zinc-900">
            {initial ? 'Editar Impressora' : 'Nova Impressora de Rede'}
          </h3>
          <button
            onClick={onClose}
            className="ml-auto w-7 h-7 flex items-center justify-center text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 rounded-lg cursor-pointer transition-colors"
          >
            <i className="ri-close-line text-base" />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="text-xs font-semibold text-zinc-700 mb-1 block">
              Nome da Impressora <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={form.nome}
              onChange={(e) => setForm((f) => ({ ...f, nome: e.target.value }))}
              placeholder="Ex: Impressora Cozinha 1"
              className="w-full text-sm border border-zinc-200 rounded-lg px-3 py-2 text-zinc-900 placeholder-zinc-400 focus:outline-none focus:border-amber-400"
            />
          </div>

          <div>
            <label className="text-xs font-semibold text-zinc-700 mb-1 block">
              Endereço IP <span className="text-zinc-400 font-normal">(obrigatório para rede)</span>
            </label>
            <div className="relative">
              <i className="ri-wifi-line absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 text-sm" />
              <input
                type="text"
                value={form.ip}
                onChange={(e) => setForm((f) => ({ ...f, ip: e.target.value }))}
                placeholder="192.168.1.101"
                className="w-full text-sm border border-zinc-200 rounded-lg pl-9 pr-3 py-2 text-zinc-900 placeholder-zinc-400 focus:outline-none focus:border-amber-400 font-mono"
              />
            </div>
            <p className="text-[10px] text-zinc-400 mt-1">
              IP da impressora térmica na rede local. Para USB, use a opção "Impressora deste PC" abaixo.
            </p>
          </div>

          <div>
            <label className="text-xs font-semibold text-zinc-700 mb-1 block">Estilo de papel</label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setForm((f) => ({ ...f, paperStyle: '80mm' }))}
                className={`flex-1 py-2 rounded-lg border text-xs font-semibold transition-colors cursor-pointer ${
                  form.paperStyle === '80mm'
                    ? 'border-amber-500 text-amber-700 bg-amber-50'
                    : 'border-zinc-200 text-zinc-600 bg-white hover:bg-zinc-50'
                }`}
              >
                <i className="ri-file-text-line mr-1" />
                80mm (padrão)
              </button>
              <button
                type="button"
                onClick={() => setForm((f) => ({ ...f, paperStyle: '58mm' }))}
                className={`flex-1 py-2 rounded-lg border text-xs font-semibold transition-colors cursor-pointer ${
                  form.paperStyle === '58mm'
                    ? 'border-amber-500 text-amber-700 bg-amber-50'
                    : 'border-zinc-200 text-zinc-600 bg-white hover:bg-zinc-50'
                }`}
              >
                <i className="ri-file-list-line mr-1" />
                58mm (compacto)
              </button>
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-zinc-700 mb-1 block">Descrição</label>
            <input
              type="text"
              value={form.descricao}
              onChange={(e) => setForm((f) => ({ ...f, descricao: e.target.value }))}
              placeholder="Ex: Impressora térmica 80mm — Cozinha principal"
              className="w-full text-sm border border-zinc-200 rounded-lg px-3 py-2 text-zinc-900 placeholder-zinc-400 focus:outline-none focus:border-amber-400"
            />
          </div>
        </div>

        <div className="flex gap-3 mt-6">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 bg-zinc-100 hover:bg-zinc-200 text-zinc-700 text-sm font-semibold rounded-xl cursor-pointer transition-colors whitespace-nowrap"
          >
            Cancelar
          </button>
          <button
            disabled={!isValid}
            onClick={() => { if (isValid) { onSave(form); onClose(); } }}
            className="flex-1 py-2.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-bold rounded-xl cursor-pointer transition-colors whitespace-nowrap"
          >
            {initial ? 'Salvar alterações' : 'Adicionar impressora'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ImpressorasTab() {
  const {
    impressoras,
    mapaEstacoes,
    getImpressoraParaEstacao,
    addImpressora,
    updateImpressora,
    removeImpressora,
    setImpressoraEstacao,
    clearImpressoraEstacao,
    salvarImpressoras,
    salvando,
  } = useImpressoras();

  const { user } = useAuth();
  const { success: toastSuccess, error: toastError } = useToast();

  const [stations, setStations] = useState<KitchenStation[]>([]);
  const [stationsLoading, setStationsLoading] = useState(true);
  const [stationsError, setStationsError] = useState<string | null>(null);

  const [showModal, setShowModal] = useState(false);
  const [editando, setEditando] = useState<Impressora | null>(null);
  const [removendoId, setRemovendoId] = useState<string | null>(null);
  const [salvo, setSalvo] = useState(false);

  // Estado do ping por impressora
  const [pingStates, setPingStates] = useState<Record<string, { status: 'idle' | 'testing' | 'online' | 'offline'; ms?: number }>>(
    {},
  );

  // Busca estações reais do banco via Edge Function (bypassa RLS problemático)
  const fetchStations = async () => {
    if (!user?.tenantId) { setStationsLoading(false); return; }
    setStationsLoading(true);
    setStationsError(null);
    try {
      const { data, error } = await invokeWithAuth('config-write', {
        body: { action: 'get_kitchen_stations', active_tenant_id: user!.tenantId },
      });
      if (error) {
        console.error('[ImpressorasTab] Edge Function error:', error);
        setStationsError('Erro ao carregar estações. Tente recarregar.');
        setStations([]);
      } else if (data?.success && Array.isArray(data.data)) {
        setStations(data.data as KitchenStation[]);
      } else {
        console.warn('[ImpressorasTab] Resposta inesperada:', data);
        setStations([]);
      }
    } catch (e) {
      console.error('[ImpressorasTab] Exceção:', e);
      setStationsError('Erro de conexão ao carregar estações.');
      setStations([]);
    }
    setStationsLoading(false);
  };

  useEffect(() => {
    fetchStations();
  }, [user?.tenantId]);

  // Todas as chaves de mapeamento
  const allMappingKeys = useMemo(() => {
    const keys = stations.map((s) => s.id);
    keys.push(CAIXA_PDV_KEY);
    keys.push(CLIENTE_KEY);
    keys.push(PEDIDOS_KEY);
    keys.push(GESTOR_PEDIDOS_KEY);
    keys.push(RELATORIOS_KEY);
    keys.push(QR_CODES_KEY);
    return keys;
  }, [stations]);

  const getMappingLabel = (key: string): string => {
    if (key === CAIXA_PDV_KEY) return CAIXA_PDV_NAME;
    if (key === CLIENTE_KEY) return CLIENTE_NAME;
    if (key === PEDIDOS_KEY) return PEDIDOS_NAME;
    if (key === GESTOR_PEDIDOS_KEY) return GESTOR_PEDIDOS_NAME;
    if (key === RELATORIOS_KEY) return RELATORIOS_NAME;
    if (key === QR_CODES_KEY) return QR_CODES_NAME;
    const st = stations.find((s) => s.id === key);
    return st?.name ?? key;
  };

  // Estações vinculadas a uma impressora
  const estacoesParaImpressora = (impId: string) => {
    const diretas = allMappingKeys.filter((key) => mapaEstacoes?.[key] === impId);
    const viaFallback = mapaEstacoes?.[TODAS_ESTACOES_KEY] === impId ? allMappingKeys : [];
    const todas = [...new Set([...diretas, ...viaFallback])];
    return todas.map(getMappingLabel);
  };

  const usandoImpressoraPadrao = (key: string) => {
    return !mapaEstacoes?.[key] && !!mapaEstacoes?.[TODAS_ESTACOES_KEY];
  };

  const handleSave = (data: ImpressoraFormData) => {
    if (editando) {
      updateImpressora(editando.id, data);
      setEditando(null);
    } else {
      addImpressora(data);
    }
  };

  const handleRemove = (id: string) => {
    removeImpressora(id);
    setRemovendoId(null);
  };

  const handleSalvar = async () => {
    await salvarImpressoras();
    setSalvo(true);
    toastSuccess('Impressoras salvas!', 'Configurações de impressoras atualizadas com sucesso.');
    setTimeout(() => setSalvo(false), 2500);
  };

  const handlePing = async (impressora: Impressora) => {
    if (!impressora.ip) return;
    setPingStates((prev) => ({ ...prev, [impressora.id]: { status: 'testing' } }));
    try {
      const url = `${import.meta.env.VITE_PUBLIC_SUPABASE_URL}/functions/v1/printer-ping`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ip: impressora.ip, port: 9100 }),
      });
      const result = await res.json().catch(() => null);
      if (result.online) {
        setPingStates((prev) => ({
          ...prev,
          [impressora.id]: { status: 'online', ms: result.responseTimeMs },
        }));
        toastSuccess('Impressora online!', `${impressora.nome} respondeu em ${result.responseTimeMs}ms`);
      } else {
        setPingStates((prev) => ({
          ...prev,
          [impressora.id]: { status: 'offline' },
        }));
        toastError('Impressora offline', `${impressora.nome} não respondeu na rede. Verifique o cabo e o IP.`);
      }
    } catch {
      setPingStates((prev) => ({
        ...prev,
        [impressora.id]: { status: 'offline' },
      }));
      toastError('Erro no teste', 'Não foi possível testar a conexão. Tente novamente.');
    }
  };

  const usbAtivoGeral = mapaEstacoes?.[TODAS_ESTACOES_KEY] === IMPRESSORA_PADRAO_WINDOWS_KEY;
  const usbAtivoEmEstacao = (key: string) => mapaEstacoes?.[key] === IMPRESSORA_PADRAO_WINDOWS_KEY;

  const kitchenStationsEntries = stations.map((st) => ({
    key: st.id,
    label: st.name,
    icon: getStationIcon(st.name),
    color: st.color,
  }));

  const outrosEntries = [
    { key: CAIXA_PDV_KEY, label: CAIXA_PDV_NAME, icon: 'ri-bank-card-line', color: CAIXA_PDV_COLOR },
    { key: CLIENTE_KEY, label: CLIENTE_NAME, icon: 'ri-user-smile-line', color: CLIENTE_COLOR },
    { key: PEDIDOS_KEY, label: PEDIDOS_NAME, icon: 'ri-file-list-3-line', color: PEDIDOS_COLOR },
    { key: GESTOR_PEDIDOS_KEY, label: GESTOR_PEDIDOS_NAME, icon: 'ri-restaurant-line', color: GESTOR_PEDIDOS_COLOR },
    { key: RELATORIOS_KEY, label: RELATORIOS_NAME, icon: 'ri-bar-chart-2-line', color: RELATORIOS_COLOR },
    { key: QR_CODES_KEY, label: QR_CODES_NAME, icon: 'ri-qr-code-line', color: QR_CODES_COLOR },
  ];

  return (
    <div className="space-y-6 max-w-4xl">
      {salvo && (
        <div className="flex items-center gap-2 px-4 py-3 bg-emerald-50 border border-emerald-200 rounded-xl">
          <i className="ri-check-line text-emerald-500 text-sm" />
          <p className="text-xs font-semibold text-emerald-700">Impressoras salvas com sucesso!</p>
        </div>
      )}

      {/* ===== SEÇÃO 1: IMPRESSORA USB (SIMPLIFICADA) ===== */}
      <div>
        <h2 className="text-base font-bold text-zinc-900 mb-1">Impressora deste Computador</h2>
        <p className="text-xs text-zinc-500 mb-3">
          Use a impressora padrão do Windows (USB ou Bluetooth). Não precisa cadastrar nada — é só selecionar.
        </p>

        <div className="bg-white border border-zinc-200 rounded-xl overflow-hidden">
          {/* Card da impressora USB */}
          <div className="flex items-center gap-4 px-4 py-4">
            <div className="w-12 h-12 flex items-center justify-center bg-emerald-50 border border-emerald-200 rounded-xl flex-shrink-0">
              <i className="ri-computer-line text-emerald-600 text-xl" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-zinc-900">Impressora Padrão do Windows</p>
              <p className="text-xs text-zinc-500">Usa a impressora configurada como padrão no Painel de Controle do Windows</p>
            </div>
            <button
              onClick={printTestPageUSB}
              className="flex items-center gap-1.5 px-3 py-2 bg-zinc-100 hover:bg-zinc-200 text-zinc-600 text-xs font-semibold rounded-lg cursor-pointer transition-colors whitespace-nowrap"
            >
              <i className="ri-printer-line" />
              Testar
            </button>
          </div>

          {/* Mapeamento rápido USB */}
          <div className="border-t border-zinc-100 px-4 py-3 bg-zinc-50/50">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-zinc-700">Usar para todas as estações:</span>
                {usbAtivoGeral ? (
                  <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-600 bg-emerald-50 border border-emerald-200 px-2 py-1 rounded-lg">
                    <i className="ri-check-line text-[10px]" />
                    Ativo
                  </span>
                ) : (
                  <span className="text-[10px] text-zinc-400">Não configurado</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {usbAtivoGeral ? (
                  <button
                    onClick={() => clearImpressoraEstacao(TODAS_ESTACOES_KEY)}
                    className="px-3 py-1.5 bg-white border border-zinc-200 hover:border-zinc-300 text-zinc-600 text-xs font-semibold rounded-lg cursor-pointer transition-colors whitespace-nowrap"
                  >
                    Desativar
                  </button>
                ) : (
                  <button
                    onClick={() => setImpressoraEstacao(TODAS_ESTACOES_KEY, IMPRESSORA_PADRAO_WINDOWS_KEY)}
                    className="px-3 py-1.5 bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-bold rounded-lg cursor-pointer transition-colors whitespace-nowrap"
                  >
                    <i className="ri-check-line mr-1" />
                    Ativar para todas
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ===== SEÇÃO 2: IMPRESSORAS DE REDE ===== */}
      <div>
        <div className="flex items-start justify-between mb-3">
          <div>
            <h2 className="text-base font-bold text-zinc-900">Impressoras de Rede (Ethernet)</h2>
            <p className="text-xs text-zinc-500 mt-0.5">
              Adicione apenas se você tiver impressoras térmicas conectadas via cabo de rede (IP fixo).
            </p>
          </div>
          <button
            onClick={() => { setEditando(null); setShowModal(true); }}
            className="flex items-center gap-1.5 px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white text-sm font-bold rounded-xl cursor-pointer transition-colors whitespace-nowrap"
          >
            <i className="ri-add-line" />
            Nova Impressora de Rede
          </button>
        </div>

        {impressoras.length === 0 ? (
          <div className="bg-white border border-dashed border-zinc-300 rounded-xl p-6 text-center">
            <div className="w-10 h-10 flex items-center justify-center bg-zinc-100 rounded-full mx-auto mb-2">
              <i className="ri-wifi-line text-zinc-400 text-lg" />
            </div>
            <p className="text-sm font-semibold text-zinc-500">Nenhuma impressora de rede cadastrada</p>
            <p className="text-xs text-zinc-400 mt-1">Use o botão acima para adicionar. Se usa USB, use a seção "Impressora deste Computador".</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {impressoras.map((imp) => (
              <div key={imp.id} className="bg-white border border-zinc-200 rounded-xl p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div className="w-10 h-10 flex items-center justify-center bg-amber-50 border border-amber-200 rounded-xl flex-shrink-0">
                      <i className="ri-printer-line text-amber-600 text-base" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-bold text-zinc-900 truncate">{imp.nome}</p>
                        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${
                          imp.paperStyle === '58mm'
                            ? 'text-zinc-600 bg-zinc-50 border-zinc-200'
                            : 'text-amber-700 bg-amber-50 border-amber-200'
                        }`}>
                          {imp.paperStyle === '58mm' ? '58mm' : '80mm'}
                        </span>
                      </div>
                      {imp.ip && (
                        <p className="text-xs text-zinc-400 font-mono mt-0.5 flex items-center gap-1">
                          <i className="ri-wifi-line text-[10px]" />
                          {imp.ip}
                        </p>
                      )}
                      {imp.descricao && (
                        <p className="text-xs text-zinc-500 mt-0.5 truncate">{imp.descricao}</p>
                      )}
                      <div className="mt-1.5">
                        <PingBadge status={pingStates[imp.id]?.status ?? 'idle'} ms={pingStates[imp.id]?.ms} />
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {imp.ip && (
                      <button
                        onClick={() => handlePing(imp)}
                        disabled={pingStates[imp.id]?.status === 'testing'}
                        title="Testar conexão na rede"
                        className="w-7 h-7 flex items-center justify-center text-zinc-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors cursor-pointer disabled:opacity-40"
                      >
                        <i className="ri-signal-wifi-line text-sm" />
                      </button>
                    )}
                    <button
                      onClick={() => printTestPageRede(imp, estacoesParaImpressora(imp.id))}
                      title="Imprimir página de teste"
                      className="w-7 h-7 flex items-center justify-center text-zinc-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-colors cursor-pointer"
                    >
                      <i className="ri-printer-line text-sm" />
                    </button>
                    <button
                      onClick={() => { setEditando(imp); setShowModal(true); }}
                      className="w-7 h-7 flex items-center justify-center text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 rounded-lg transition-colors cursor-pointer"
                    >
                      <i className="ri-pencil-line text-sm" />
                    </button>
                    <button
                      onClick={() => setRemovendoId(imp.id)}
                      className="w-7 h-7 flex items-center justify-center text-zinc-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors cursor-pointer"
                    >
                      <i className="ri-delete-bin-line text-sm" />
                    </button>
                  </div>
                </div>

                {estacoesParaImpressora(imp.id).length > 0 ? (
                  <div className="mt-3 pt-3 border-t border-zinc-100 flex flex-wrap gap-1.5">
                    {estacoesParaImpressora(imp.id).map((est) => (
                      <span
                        key={est}
                        className="flex items-center gap-0.5 text-[10px] font-bold px-2 py-0.5 rounded-full border text-zinc-600 bg-zinc-50 border-zinc-200"
                      >
                        {est}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="mt-3 pt-3 border-t border-zinc-100 text-[10px] text-zinc-400 italic">
                    Nenhuma estação vinculada
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ===== SEÇÃO 3: MAPEAMENTO POR ESTAÇÃO ===== */}
      <div>
        <h3 className="text-sm font-bold text-zinc-700 mb-1 flex items-center gap-2">
          <i className="ri-git-branch-line" />
          Mapeamento por Estação
        </h3>
        <p className="text-xs text-zinc-400 mb-3">
          Escolha qual impressora cada estação usa. "Padrão do PC" usa a impressora USB do Windows.
        </p>

        {stationsLoading ? (
          <div className="flex items-center gap-2 p-4 bg-zinc-50 border border-zinc-200 rounded-xl text-xs text-zinc-500">
            <div className="w-4 h-4 border-2 border-zinc-300 border-t-transparent rounded-full animate-spin" />
            Carregando estações da cozinha...
          </div>
        ) : (
          <div className="bg-white border border-zinc-200 rounded-xl divide-y divide-zinc-100 overflow-hidden">
            {/* Estações de Cozinha */}
            {kitchenStationsEntries.length > 0 && (
              <>
                <div className="px-4 py-2 bg-zinc-50">
                  <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wide">Estações da Cozinha</span>
                </div>
                {kitchenStationsEntries.map((entry) => {
                  const impAtual = getImpressoraParaEstacao(entry.key);
                  const viaPadrao = usandoImpressoraPadrao(entry.key);
                  const isUSB = usbAtivoEmEstacao(entry.key) || (viaPadrao && usbAtivoGeral);
                  return (
                    <div key={entry.key} className="flex items-center gap-4 px-4 py-3">
                      <div
                        className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border w-36 flex-shrink-0"
                        style={colorBadgeStyle(entry.color)}
                      >
                        <div className="w-2 h-2 rounded-full flex-shrink-0" style={colorDotStyle(entry.color)} />
                        <span className="truncate">{entry.label}</span>
                      </div>
                      <div className="w-5 h-5 flex items-center justify-center flex-shrink-0">
                        <i className="ri-arrow-right-line text-zinc-300 text-sm" />
                      </div>
                      <div className="flex-1 flex items-center gap-2">
                        <select
                          value={mapaEstacoes[entry.key] ?? ''}
                          onChange={(e) => {
                            if (e.target.value) setImpressoraEstacao(entry.key, e.target.value);
                            else clearImpressoraEstacao(entry.key);
                          }}
                          className="flex-1 text-sm border border-zinc-200 rounded-lg px-3 py-1.5 text-zinc-800 bg-white focus:outline-none focus:border-amber-400 cursor-pointer"
                        >
                          <option value="">— Padrão do PC (USB) —</option>
                          {impressoras.map((imp) => (
                            <option key={imp.id} value={imp.id}>{imp.nome} {imp.ip ? `(${imp.ip})` : ''}</option>
                          ))}
                        </select>
                        {isUSB ? (
                          <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-600 bg-emerald-50 border border-emerald-200 px-2 py-1 rounded-lg whitespace-nowrap">
                            <i className="ri-computer-line text-[10px]" />
                            PC USB
                          </span>
                        ) : impAtual ? (
                          <span className="flex items-center gap-1 text-[10px] font-bold text-amber-600 bg-amber-50 border border-amber-200 px-2 py-1 rounded-lg whitespace-nowrap">
                            <i className="ri-wifi-line text-[10px]" />
                            Rede
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 text-[10px] font-bold text-zinc-400 bg-zinc-50 border border-zinc-200 px-2 py-1 rounded-lg whitespace-nowrap">
                            <i className="ri-close-line text-[10px]" />
                            Sem impressora
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </>
            )}

            {kitchenStationsEntries.length === 0 && !stationsLoading && (
              <div className="px-4 py-4 text-center">
                {stationsError ? (
                  <>
                    <p className="text-xs text-red-500 font-semibold mb-2">
                      {stationsError}
                    </p>
                    <button
                      onClick={fetchStations}
                      className="text-xs font-bold text-amber-600 hover:text-amber-800 bg-amber-50 border border-amber-200 px-3 py-1.5 rounded-lg cursor-pointer transition-colors inline-flex items-center gap-1"
                    >
                      <i className="ri-refresh-line" />
                      Tentar novamente
                    </button>
                  </>
                ) : (
                  <>
                    <p className="text-xs text-zinc-400 italic mb-2">
                      Nenhuma estação de cozinha cadastrada ainda.
                    </p>
                    <button
                      onClick={fetchStations}
                      className="text-xs font-bold text-amber-600 hover:text-amber-800 bg-amber-50 border border-amber-200 px-3 py-1.5 rounded-lg cursor-pointer transition-colors inline-flex items-center gap-1"
                    >
                      <i className="ri-refresh-line" />
                      Recarregar estações
                    </button>
                  </>
                )}
              </div>
            )}

            {/* Outros pontos */}
            <div className="px-4 py-2 bg-zinc-50">
              <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wide">Outros pontos</span>
            </div>
            {outrosEntries.map((entry) => {
              const impAtual = getImpressoraParaEstacao(entry.key);
              const viaPadrao = usandoImpressoraPadrao(entry.key);
              const isUSB = usbAtivoEmEstacao(entry.key) || (viaPadrao && usbAtivoGeral);
              return (
                <div key={entry.key} className="flex items-center gap-4 px-4 py-3">
                  <div
                    className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border w-36 flex-shrink-0"
                    style={colorBadgeStyle(entry.color)}
                  >
                    <div className="w-2 h-2 rounded-full flex-shrink-0" style={colorDotStyle(entry.color)} />
                    <span className="truncate">{entry.label}</span>
                  </div>
                  <div className="w-5 h-5 flex items-center justify-center flex-shrink-0">
                    <i className="ri-arrow-right-line text-zinc-300 text-sm" />
                  </div>
                  <div className="flex-1 flex items-center gap-2">
                    <select
                      value={mapaEstacoes[entry.key] ?? ''}
                      onChange={(e) => {
                        if (e.target.value) setImpressoraEstacao(entry.key, e.target.value);
                        else clearImpressoraEstacao(entry.key);
                      }}
                      className="flex-1 text-sm border border-zinc-200 rounded-lg px-3 py-1.5 text-zinc-800 bg-white focus:outline-none focus:border-amber-400 cursor-pointer"
                    >
                      <option value="">— Padrão do PC (USB) —</option>
                      {impressoras.map((imp) => (
                        <option key={imp.id} value={imp.id}>{imp.nome} {imp.ip ? `(${imp.ip})` : ''}</option>
                      ))}
                    </select>
                    {isUSB ? (
                      <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-600 bg-emerald-50 border border-emerald-200 px-2 py-1 rounded-lg whitespace-nowrap">
                        <i className="ri-computer-line text-[10px]" />
                        PC USB
                      </span>
                    ) : impAtual ? (
                      <span className="flex items-center gap-1 text-[10px] font-bold text-amber-600 bg-amber-50 border border-amber-200 px-2 py-1 rounded-lg whitespace-nowrap">
                        <i className="ri-wifi-line text-[10px]" />
                        Rede
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-[10px] font-bold text-zinc-400 bg-zinc-50 border border-zinc-200 px-2 py-1 rounded-lg whitespace-nowrap">
                        <i className="ri-close-line text-[10px]" />
                        Sem impressora
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ===== SEÇÃO 4: RESUMO ===== */}
      {(usbAtivoGeral || impressoras.length > 0) && (
        <div className="bg-zinc-50 border border-zinc-200 rounded-xl p-4">
          <h3 className="text-xs font-bold text-zinc-700 mb-2">Resumo da configuração</h3>
          <div className="space-y-1.5">
            {usbAtivoGeral && (
              <div className="flex items-center gap-2 text-xs text-emerald-700">
                <i className="ri-computer-line text-emerald-500" />
                <span className="font-semibold">Todas as estações</span>
                <span className="text-zinc-400">→</span>
                <span>Impressora padrão do Windows (USB)</span>
              </div>
            )}
            {allMappingKeys.map((key) => {
              if (usbAtivoGeral) return null;
              const imp = getImpressoraParaEstacao(key);
              if (!imp) return null;
              const isUSB = imp.id === IMPRESSORA_PADRAO_WINDOWS_KEY;
              return (
                <div key={key} className="flex items-center gap-2 text-xs">
                  <i className={`${isUSB ? 'ri-computer-line text-emerald-500' : 'ri-wifi-line text-amber-500'}`} />
                  <span className="font-semibold text-zinc-700">{getMappingLabel(key)}</span>
                  <span className="text-zinc-400">→</span>
                  <span className={isUSB ? 'text-emerald-600' : 'text-amber-600'}>{imp.nome}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Botão Salvar */}
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
          {salvando ? 'Salvando...' : 'Salvar configurações'}
        </button>
      </div>

      {/* Modal: adicionar/editar impressora */}
      {showModal && (
        <ImpressoraFormModal
          initial={editando ?? undefined}
          onSave={handleSave}
          onClose={() => { setShowModal(false); setEditando(null); }}
        />
      )}

      {/* Modal: confirmar remoção */}
      {removendoId && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm p-6 shadow-lg">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-9 h-9 flex items-center justify-center bg-red-50 rounded-xl">
                <i className="ri-delete-bin-line text-red-500 text-lg" />
              </div>
              <div>
                <p className="text-sm font-bold text-zinc-900">Remover impressora?</p>
                <p className="text-xs text-zinc-500">
                  {impressoras.find((i) => i.id === removendoId)?.nome}
                </p>
              </div>
            </div>
            <p className="text-xs text-zinc-500 mb-5">
              As estações vinculadas a esta impressora ficarão sem impressora configurada.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setRemovendoId(null)}
                className="flex-1 py-2.5 bg-zinc-100 hover:bg-zinc-200 text-zinc-700 text-sm font-semibold rounded-xl cursor-pointer transition-colors whitespace-nowrap"
              >
                Cancelar
              </button>
              <button
                onClick={() => handleRemove(removendoId)}
                className="flex-1 py-2.5 bg-red-500 hover:bg-red-600 text-white text-sm font-bold rounded-xl cursor-pointer transition-colors whitespace-nowrap"
              >
                Remover
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}