import { useState, useEffect, useCallback, useRef } from 'react';
import { Save, Printer, Tablet, ShieldCheck, Clock, Percent, MessageSquare, Eye, EyeOff, AlertCircle, Timer, GraduationCap, Monitor, ChefHat } from 'lucide-react';
import type { ConfigOperacao, PDVTerminal, VisaoCozinha, OrigemPedido } from '@/types/configuracoes';

const DEFAULT_PDV_TERMINAIS: PDVTerminal[] = [
  { id: 'caixa',           label: 'PDV Caixa',              desc: 'Terminal principal de vendas',              icon: 'ri-store-line',       obrigatorio: true,  ativo: true },
  { id: 'garcom',          label: 'PDV Garçom',             desc: 'App/tablet para garçons no salão',          icon: 'ri-user-star-line',   obrigatorio: false, ativo: true },
  { id: 'delivery',        label: 'PDV Delivery',           desc: 'Terminal de pedidos para entrega/retirada', icon: 'ri-bike-line',        obrigatorio: false, ativo: true },
  { id: 'kds',             label: 'KDS — Cozinha',          desc: 'Display digital de pedidos na cozinha',     icon: 'ri-layout-grid-line', obrigatorio: false, ativo: true },
  { id: 'autoatendimento', label: 'Autoatendimento (Kiosk)', desc: 'Totem de pedido sem atendente',            icon: 'ri-tablet-line',      obrigatorio: false, ativo: false },
  { id: 'mesa_qr',         label: 'Cardápio por QR Code',  desc: 'Cliente pede da própria mesa via QR',        icon: 'ri-qr-code-line',     obrigatorio: false, ativo: true },
];

const DEFAULT_ORIGENS: OrigemPedido[] = [
  { id: 'caixa',           label: 'Caixa',                    icon: 'ri-store-2-line',    cor: 'bg-zinc-100 text-zinc-600',    ativo: true,  descricao: 'Pedidos lançados pelo operador do PDV Caixa', bloqueiaEdicao: true },
  { id: 'garcom',          label: 'Garçom',                   icon: 'ri-user-star-line',  cor: 'bg-amber-50 text-amber-700',   ativo: true,  descricao: 'Pedidos lançados pelo app do garçom no salão' },
  { id: 'mesa',            label: 'Mesa (QR Code)',            icon: 'ri-qr-code-line',   cor: 'bg-teal-50 text-teal-700',     ativo: true,  descricao: 'Pedidos feitos pelo cliente via QR Code na mesa' },
  { id: 'autoatendimento', label: 'Autoatendimento (Kiosk)',  icon: 'ri-tablet-line',     cor: 'bg-indigo-50 text-indigo-700', ativo: false, descricao: 'Pedidos feitos no totem de autoatendimento' },
  { id: 'delivery',        label: 'Delivery',                  icon: 'ri-bike-line',       cor: 'bg-orange-50 text-orange-700', ativo: true,  descricao: 'Pedidos para entrega ou retirada' },
];

import { useSystemSettings } from '../../../hooks/useSystemSettings';
import { useUsuarios } from '../../../hooks/useUsuarios';
import { usePaymentMethods } from '@/hooks/usePaymentMethods';

import { useToast } from '@/contexts/ToastContext';
import PixConfigModal from './PixConfigModal';

const CFG_DEFAULTS: ConfigOperacao = {
  taxaServico: 10,
  taxaServicoAtiva: true,
  gorjetaSugerida: 10,
  gorjetaAtiva: true,
  tempoPadraoPreparo: 15,
  senhaDescontoPerfil: 'gerente',
  modoCancelamento: 'senha_gerente',
  impressaoAutomatica: true,
  impressaoKDS: true,
  impressaoViasCozinhaAtiva: true,
  impressaoDeliveryAtiva: false,
  autoatendimentoIdentificacao: 'nome',
  autoatendimentoPagamento: 'hora',
  mensagemBoasVindas: 'Bem-vindo! Faça seu pedido e aproveite!',
  mensagemRetorno: 'Que bom te ver de volta!',
  modoTreinoPadrao: false,
  horarioFechamentoCozinha: '23:00',
  visaoCozinha: 'ambos',
  timerVerdeMax: 45,
  timerAmbarMax: 90,
};

interface ToggleProps { checked: boolean; onChange: (v: boolean) => void; }
function Toggle({ checked, onChange }: ToggleProps) {
  return (
    <button onClick={() => onChange(!checked)}
      className={`relative w-11 h-6 rounded-full transition-colors cursor-pointer flex-shrink-0 ${checked ? 'bg-amber-500' : 'bg-zinc-200'}`}>
      <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${checked ? 'left-6' : 'left-1'}`} />
    </button>
  );
}

interface SectionCardProps { title: string; subtitle?: string; icon: React.ReactNode; children: React.ReactNode; }
function SectionCard({ title, subtitle, icon, children }: SectionCardProps) {
  return (
    <div className="bg-white border border-zinc-100 rounded-xl p-5">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-8 h-8 flex items-center justify-center bg-zinc-100 rounded-lg text-zinc-500">{icon}</div>
        <div>
          <h3 className="text-sm font-bold text-zinc-800">{title}</h3>
          {subtitle && <p className="text-xs text-zinc-400">{subtitle}</p>}
        </div>
      </div>
      {children}
    </div>
  );
}

export default function OperacaoTab() {
  const { settings, loading: settingsLoading, salvar } = useSystemSettings();
  const { usuarios: usuariosReais, loading: loadingUsuarios, editarUsuario } = useUsuarios();
  const { formasAtivas: formasPagamento, loading: loadingFormas } = usePaymentMethods();
  const { success: toastSuccess, error: toastError } = useToast();

  const [cfg, setCfg] = useState<ConfigOperacao>(CFG_DEFAULTS);
  const [pixCfg, setPixCfg] = useState({ stoneClientId: '', stoneClientSecret: '', chavePixTipo: 'cnpj' as const, chavePix: '', webhookUrl: '' });
  const [deliveryCommissionRates, setDeliveryCommissionRates] = useState<Record<string, number>>({});
  // IDs das formas de pagamento aceitas no delivery (null = todas aceitas)
  const [deliveryPaymentMethods, setDeliveryPaymentMethods] = useState<string[] | null>(null);
  const [showSecret, setShowSecret] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [salvo, setSalvo] = useState(false);
  const [pdvTerminais, setPdvTerminais] = useState<PDVTerminal[]>(DEFAULT_PDV_TERMINAIS);
  const [pdvConfigSynced, setPdvConfigSynced] = useState(false);
  // Sync pdv_config from settings on first load (or after a save that changes updated_at).
  // We track the last synced updated_at to re-sync whenever the server confirms a save.
  const lastSyncedAtRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (settingsLoading) return;
    const currentUpdatedAt = settings.updated_at;
    // Sync if: never synced before, OR server timestamp changed (save confirmed)
    if (!pdvConfigSynced || (currentUpdatedAt && currentUpdatedAt !== lastSyncedAtRef.current)) {
      const savedCfg = settings.pdv_config as Record<string, boolean> | undefined;
      setPdvTerminais(prev => prev.map(p => ({
        ...p,
        ativo: p.obrigatorio ? true : (savedCfg ? (savedCfg[p.id] ?? p.ativo) : p.ativo),
      })));
      setPdvConfigSynced(true);
      lastSyncedAtRef.current = currentUpdatedAt;
    }
  }, [settings.updated_at, settings.pdv_config, settingsLoading]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reset synced flag when navigating away so next visit re-syncs from DB
  useEffect(() => () => { setPdvConfigSynced(false); }, []);
  const [showPixModal, setShowPixModal] = useState(false);

  useEffect(() => {
    if (settingsLoading || !settings) return;
    setCfg((prev) => ({
      ...prev,
      taxaServicoAtiva: settings.service_fee_enabled,
      taxaServico: settings.service_fee_percentage,
      pdvCaixaExibirTaxaServico: settings.pdv_caixa_show_service_fee,
      gorjetaAtiva: settings.gorjeta_enabled,
      gorjeta_percentage: settings.gorjeta_percentage ?? prev.gorjetaSugerida,
      gorjetaSugerida: settings.gorjeta_percentage ?? prev.gorjetaSugerida,
      impressaoAutomatica: settings.auto_print_enabled,
      impressaoKDS: settings.print_kds_enabled,
      impressaoViasCozinhaAtiva: settings.print_kitchen_copy_enabled,
      impressaoDeliveryAtiva: (settings as Record<string, unknown>).delivery_print_enabled as boolean ?? false,
      horarioFechamentoCozinha: settings.kitchen_close_time ?? '23:00',
      timerVerdeMax: settings.timer_verde_max ?? 45,
      timerAmbarMax: settings.timer_ambar_max ?? 90,
      autoatendimentoIdentificacao: settings.self_service_id_type,
      autoatendimentoPagamento: settings.self_service_payment_type,
      mensagemBoasVindas: settings.welcome_message_new || prev.mensagemBoasVindas,
      mensagemRetorno: settings.welcome_message_returning || prev.mensagemRetorno,
      pagerCount: settings.pager_count ?? 50,
      visaoCozinha: (settings.kitchen_view as ConfigOperacao['visaoCozinha']) ?? prev.visaoCozinha,
      modoCancelamento: (settings.cancel_mode as ConfigOperacao['modoCancelamento']) ?? prev.modoCancelamento,
      senhaDescontoPerfil: (settings.discount_profile as ConfigOperacao['senhaDescontoPerfil']) ?? prev.senhaDescontoPerfil,
      tempoPadraoPreparo: settings.default_prep_time ?? prev.tempoPadraoPreparo,
      deliveryIdentificacaoObrigatoria: settings.delivery_require_id ?? prev.deliveryIdentificacaoObrigatoria,
      deliveryTipoAtendimento: (settings.delivery_type as ConfigOperacao['deliveryTipoAtendimento']) ?? prev.deliveryTipoAtendimento,
      deliveryTempoEstimado: settings.delivery_eta_minutes ?? prev.deliveryTempoEstimado,
    }));
    setPixCfg((prev) => ({
      ...prev,
      stoneClientId: settings.stone_client_id || '',
      stoneClientSecret: settings.stone_client_secret || '',
    }));
    // Carrega taxas de comissão salvas
    const savedRates = (settings as Record<string, unknown>).delivery_commission_rates as Record<string, number> | undefined;
    if (savedRates && typeof savedRates === 'object') {
      setDeliveryCommissionRates(savedRates);
    }
    // Carrega formas de pagamento aceitas no delivery
    const savedPayMethods = (settings as Record<string, unknown>).delivery_payment_methods as string[] | null | undefined;
    if (Array.isArray(savedPayMethods)) {
      setDeliveryPaymentMethods(savedPayMethods);
    } else {
      setDeliveryPaymentMethods(null); // null = todas aceitas
    }
  }, [settings, settingsLoading]);

  const set = <K extends keyof ConfigOperacao>(k: K, v: ConfigOperacao[K]) =>
    setCfg((prev) => ({ ...prev, [k]: v }));

  const togglePDV = (id: string) => {
    setPdvTerminais((prev) =>
      prev.map((p) => (p.id === id && !p.obrigatorio ? { ...p, ativo: !p.ativo } : p))
    );
  };

  const handleSalvar = useCallback(async () => {
    setSalvando(true);
    const result = await salvar({
      service_fee_enabled: cfg.taxaServicoAtiva,
      service_fee_percentage: cfg.taxaServico,
      pdv_caixa_show_service_fee: (cfg as Record<string, unknown>).pdvCaixaExibirTaxaServico as boolean ?? true,
      gorjeta_enabled: cfg.gorjetaAtiva,
      gorjeta_percentage: cfg.gorjetaSugerida,
      auto_print_enabled: cfg.impressaoAutomatica,
      print_kds_enabled: cfg.impressaoKDS,
      print_kitchen_copy_enabled: cfg.impressaoViasCozinhaAtiva,
      delivery_print_enabled: (cfg as Record<string, unknown>).impressaoDeliveryAtiva as boolean ?? false,
      kitchen_close_time: cfg.horarioFechamentoCozinha,
      welcome_message_new: cfg.mensagemBoasVindas,
      welcome_message_returning: cfg.mensagemRetorno,
      self_service_id_type: cfg.autoatendimentoIdentificacao,
      self_service_payment_type: cfg.autoatendimentoPagamento,
      pager_count: (cfg as Record<string, unknown>).pagerCount as number ?? 50,
      stone_client_id: pixCfg.stoneClientId,
      stone_client_secret: pixCfg.stoneClientSecret,
      timer_verde_max: cfg.timerVerdeMax,
      timer_ambar_max: cfg.timerAmbarMax,
      kitchen_view: cfg.visaoCozinha,
      cancel_mode: cfg.modoCancelamento,
      discount_profile: cfg.senhaDescontoPerfil,
      default_prep_time: cfg.tempoPadraoPreparo,
      delivery_require_id: (cfg as Record<string, unknown>).deliveryIdentificacaoObrigatoria as boolean ?? true,
      delivery_type: (cfg as Record<string, unknown>).deliveryTipoAtendimento as string ?? 'ambos',
      delivery_eta_minutes: (cfg as Record<string, unknown>).deliveryTempoEstimado as number ?? 45,
      delivery_commission_rates: deliveryCommissionRates,
      delivery_payment_methods: deliveryPaymentMethods,
      pdv_config: {
        // Mantém valores do banco como base e aplica as seleções da tela
        ...(settings.pdv_config ?? {}),
        ...Object.fromEntries(pdvTerminais.map(p => [p.id, p.obrigatorio ? true : p.ativo])),
      } as Record<string, boolean>,
    });
    setSalvando(false);
    if (!result.success) {
      console.error('[OperacaoTab] save error:', result.error);
      toastError('Erro ao salvar', 'Não foi possível salvar as configurações. Tente novamente.');
      return;
    }
    setSalvo(true);
    toastSuccess('Configurações salvas!', 'Operação e integrações atualizadas com sucesso.');
    setTimeout(() => setSalvo(false), 2500);
  // pdvTerminais DEVE estar nas deps — sem isso o React reutiliza o closure antigo
  // e qualquer toggle feito pelo usuário é ignorado no save (stale closure bug)
  }, [cfg, pixCfg, salvar, pdvTerminais, settings.pdv_config, deliveryCommissionRates, deliveryPaymentMethods, toastSuccess, toastError]);

  const handleToggleTreino = useCallback(
    async (userId: string) => {
      const u = usuariosReais.find((x) => x.id === userId);
      if (!u) return;
      await editarUsuario(userId, { nome: u.nome, perfil: u.perfil, modoTreino: !u.modoTreino, ativo: u.ativo });
    },
    [usuariosReais, editarUsuario],
  );

  return (
    <div className="space-y-5 max-w-3xl">
      {showPixModal && <PixConfigModal onClose={() => setShowPixModal(false)} />}
      {salvo && (
        <div className="flex items-center gap-2 px-4 py-3 bg-emerald-50 border border-emerald-200 rounded-xl">
          <div className="w-4 h-4 flex items-center justify-center text-emerald-500"><Save size={14} /></div>
          <p className="text-xs font-semibold text-emerald-700">Configurações salvas com sucesso!</p>
        </div>
      )}

      {/* Visão da Cozinha */}
      <SectionCard title="Visão da Cozinha" subtitle="Escolha quais módulos de cozinha estarão disponíveis" icon={<ChefHat size={16} />}>
        <div className="space-y-2">
          {([
            ['kds',    'KDS — Kitchen Display System',   'Display completo com estações, operadores e SLA por item'],
            ['gestor', 'Gestor de Pedidos',               'Visão simplificada em kanban ou lista com ações rápidas'],
            ['ambos',  'KDS + Gestor de Pedidos (ambos)', 'Ambos os módulos disponíveis simultaneamente'],
          ] as [VisaoCozinha, string, string][]).map(([v, label, sub]) => (
            <button key={v} onClick={() => set('visaoCozinha', v)}
              className={`w-full flex items-start gap-3 px-4 py-3 rounded-xl border cursor-pointer text-left transition-all ${cfg.visaoCozinha === v ? 'border-amber-400 bg-amber-50' : 'border-zinc-100 bg-zinc-50 hover:border-zinc-200'}`}>
              <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 mt-0.5 ${cfg.visaoCozinha === v ? 'border-amber-500 bg-amber-500' : 'border-zinc-300'}`}>
                {cfg.visaoCozinha === v && <div className="w-1.5 h-1.5 bg-white rounded-full" />}
              </div>
              <div>
                <p className="text-sm font-semibold text-zinc-800">{label}</p>
                <p className="text-xs text-zinc-400 mt-0.5">{sub}</p>
              </div>
            </button>
          ))}
        </div>
      </SectionCard>

      {/* Terminais PDV */}
      <SectionCard title="Terminais PDV" subtitle="Quais terminais estarão ativos na operação" icon={<Monitor size={16} />}>
        <div className="space-y-2.5">
          {pdvTerminais.filter(p => p.id !== 'autoatendimento').map((pdv) => (
            <div key={pdv.id} className={`flex items-center gap-3 p-3 rounded-xl border transition-all ${pdv.ativo ? 'border-amber-200 bg-amber-50/40' : 'border-zinc-100 bg-zinc-50'}`}>
              <div className={`w-8 h-8 flex items-center justify-center rounded-lg flex-shrink-0 ${pdv.ativo ? 'bg-amber-500' : 'bg-zinc-200'}`}>
                <i className={`${pdv.icon} text-sm ${pdv.ativo ? 'text-white' : 'text-zinc-400'}`} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold text-zinc-800">{pdv.label}</p>
                  {pdv.obrigatorio && <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full bg-zinc-200 text-zinc-600 uppercase tracking-wide whitespace-nowrap">Obrigatório</span>}
                </div>
                <p className="text-xs text-zinc-400">{pdv.desc}</p>
              </div>
              {pdv.obrigatorio ? (
                <div className="relative w-11 h-6 rounded-full bg-amber-500 flex-shrink-0">
                  <div className="absolute top-1 left-6 w-4 h-4 bg-white rounded-full shadow" />
                </div>
              ) : (
                <button onClick={() => togglePDV(pdv.id)}
                  className={`relative w-11 h-6 rounded-full transition-colors cursor-pointer flex-shrink-0 ${pdv.ativo ? 'bg-amber-500' : 'bg-zinc-200'}`}>
                  <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${pdv.ativo ? 'left-6' : 'left-1'}`} />
                </button>
              )}
            </div>
          ))}
        </div>
        <p className="text-[10px] text-zinc-400 mt-3">Desativar um terminal não apaga dados — apenas oculta o acesso. Reative a qualquer momento.</p>
      </SectionCard>

      {/* PDV Delivery */}
      <SectionCard title="PDV Delivery" subtitle="Regras específicas do terminal de delivery" icon={<i className="ri-bike-line text-base" />}>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-zinc-700">Identificação obrigatória</p>
              <p className="text-xs text-zinc-400">Não permite finalizar pedido sem dados do cliente</p>
            </div>
            <Toggle checked={(cfg as Record<string, unknown>).deliveryIdentificacaoObrigatoria as boolean ?? true} onChange={(v) => set('deliveryIdentificacaoObrigatoria' as keyof ConfigOperacao, v as ConfigOperacao[keyof ConfigOperacao])} />
          </div>
          <div className="border-t border-zinc-50 pt-4">
            <label className="block text-xs font-semibold text-zinc-600 mb-2">Tipo de atendimento padrão</label>
            <div className="flex gap-2 flex-wrap">
              {(['entrega', 'retirada', 'ambos'] as const).map((v) => (
                <button key={v}
                  onClick={() => set('deliveryTipoAtendimento' as keyof ConfigOperacao, v as ConfigOperacao[keyof ConfigOperacao])}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-lg cursor-pointer transition-colors whitespace-nowrap ${(cfg as Record<string, unknown>).deliveryTipoAtendimento === v ? 'bg-amber-500 text-white' : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'}`}>
                  {v === 'entrega' ? 'Entrega em domicílio' : v === 'retirada' ? 'Retirada no local' : 'Ambos'}
                </button>
              ))}
            </div>
          </div>
          <div className="border-t border-zinc-50 pt-4 flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-zinc-700">Tempo estimado de entrega</p>
              <p className="text-xs text-zinc-400">Exibido ao cliente na confirmação do pedido</p>
            </div>
            <div className="flex items-center gap-1.5">
              <input type="number" min={5} max={180}
                value={(cfg as Record<string, unknown>).deliveryTempoEstimado as number ?? 45}
                onChange={(e) => set('deliveryTempoEstimado' as keyof ConfigOperacao, (parseInt(e.target.value) || 45) as ConfigOperacao[keyof ConfigOperacao])}
                className="w-16 text-sm border border-zinc-200 rounded-lg px-2 py-1.5 text-center text-zinc-800 focus:outline-none focus:border-amber-400" />
              <span className="text-xs text-zinc-500">min</span>
            </div>
          </div>

          {/* Taxas de comissão por plataforma */}
          <div className="border-t border-zinc-50 pt-4">
            <div className="mb-3">
              <p className="text-sm font-semibold text-zinc-700 flex items-center gap-1.5">
                <i className="ri-percent-line text-zinc-400 text-sm" />
                Taxa de comissão por plataforma
              </p>
              <p className="text-xs text-zinc-400 mt-0.5">
                Usada para calcular a receita líquida real nos relatórios de delivery
              </p>
            </div>
            <div className="space-y-2">
              {[
                { key: 'ifood',     label: 'iFood',     icon: 'ri-store-2-line',   cor: 'bg-red-100 text-red-700',       placeholder: '12' },
                { key: 'rappi',     label: 'Rappi',     icon: 'ri-store-2-line',   cor: 'bg-orange-100 text-orange-700', placeholder: '15' },
                { key: 'uber_eats', label: 'Uber Eats', icon: 'ri-car-line',       cor: 'bg-zinc-800 text-white',        placeholder: '30' },
                { key: '99food',    label: '99Food',    icon: 'ri-store-2-line',   cor: 'bg-yellow-100 text-yellow-700', placeholder: '12' },
                { key: 'whatsapp',  label: 'WhatsApp',  icon: 'ri-whatsapp-line',  cor: 'bg-green-100 text-green-700',   placeholder: '0' },
                { key: 'instagram', label: 'Instagram', icon: 'ri-instagram-line', cor: 'bg-pink-100 text-pink-700',     placeholder: '0' },
                { key: 'telefone',  label: 'Telefone',  icon: 'ri-phone-line',     cor: 'bg-sky-100 text-sky-700',       placeholder: '0' },
                { key: 'site',      label: 'Site/App',  icon: 'ri-global-line',    cor: 'bg-amber-100 text-amber-700',   placeholder: '0' },
              ].map((plat) => (
                <div key={plat.key} className="flex items-center gap-3 p-2.5 bg-zinc-50 rounded-xl border border-zinc-100">
                  <div className={`w-7 h-7 flex items-center justify-center rounded-lg flex-shrink-0 text-xs ${plat.cor}`}>
                    <i className={plat.icon} />
                  </div>
                  <span className="flex-1 text-sm font-medium text-zinc-700">{plat.label}</span>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step={0.5}
                      placeholder={plat.placeholder}
                      value={deliveryCommissionRates[plat.key] ?? ''}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value);
                        setDeliveryCommissionRates((prev) => ({
                          ...prev,
                          [plat.key]: isNaN(val) ? 0 : Math.min(100, Math.max(0, val)),
                        }));
                      }}
                      className="w-16 text-sm border border-zinc-200 rounded-lg px-2 py-1.5 text-center text-zinc-800 focus:outline-none focus:border-amber-400"
                    />
                    <span className="text-xs text-zinc-500 w-4">%</span>
                  </div>
                  {(deliveryCommissionRates[plat.key] ?? 0) > 0 && (
                    <span className="text-[10px] font-bold text-red-500 whitespace-nowrap">
                      -{deliveryCommissionRates[plat.key]}%
                    </span>
                  )}
                </div>
              ))}
            </div>
            <p className="text-[10px] text-zinc-400 mt-2">
              Deixe em 0% para plataformas sem comissão. Os valores são usados apenas nos relatórios — não afetam o valor cobrado do cliente.
            </p>
          </div>

          {/* Formas de pagamento aceitas no delivery */}
          <div className="border-t border-zinc-50 pt-4">
            <div className="mb-3">
              <p className="text-sm font-semibold text-zinc-700 flex items-center gap-1.5">
                <i className="ri-bank-card-line text-zinc-400 text-sm" />
                Formas de pagamento aceitas no delivery
              </p>
              <p className="text-xs text-zinc-400 mt-0.5">
                Defina quais formas aparecem no PDV Delivery. Deixe todas ativas para aceitar qualquer forma.
              </p>
            </div>
            {loadingFormas ? (
              <div className="flex items-center gap-2 py-3">
                <div className="w-4 h-4 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
                <span className="text-xs text-zinc-400">Carregando formas de pagamento...</span>
              </div>
            ) : formasPagamento.length === 0 ? (
              <div className="flex items-center gap-2 px-3 py-2.5 bg-amber-50 border border-amber-200 rounded-xl">
                <i className="ri-alert-line text-amber-500 text-sm" />
                <span className="text-xs text-amber-700">Nenhuma forma de pagamento ativa. Configure em Configurações &gt; Estações e Pagamentos.</span>
              </div>
            ) : (
              <div className="space-y-2">
                {/* Toggle: todas ou selecionadas */}
                <div className="flex items-center justify-between px-3 py-2 bg-zinc-50 rounded-xl border border-zinc-100">
                  <span className="text-xs font-semibold text-zinc-600">Aceitar todas as formas</span>
                  <button
                    onClick={() => setDeliveryPaymentMethods(deliveryPaymentMethods === null ? formasPagamento.map(f => f.id) : null)}
                    className={`relative w-11 h-6 rounded-full transition-colors cursor-pointer flex-shrink-0 ${
                      deliveryPaymentMethods === null ? 'bg-amber-500' : 'bg-zinc-200'
                    }`}
                  >
                    <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${
                      deliveryPaymentMethods === null ? 'left-6' : 'left-1'
                    }`} />
                  </button>
                </div>

                {/* Lista de formas quando não é "todas" */}
                {deliveryPaymentMethods !== null && (
                  <div className="space-y-1.5 pt-1">
                    {formasPagamento.map((forma) => {
                      const ativa = deliveryPaymentMethods.includes(forma.id);
                      const tipoIcone: Record<string, string> = {
                        dinheiro: 'ri-money-dollar-circle-line',
                        credito: 'ri-bank-card-line',
                        debito: 'ri-bank-card-2-line',
                        pix: 'ri-qr-code-line',
                        vale: 'ri-coupon-line',
                      };
                      return (
                        <button
                          key={forma.id}
                          onClick={() => setDeliveryPaymentMethods((prev) => {
                            if (!prev) return [forma.id];
                            return prev.includes(forma.id)
                              ? prev.filter(id => id !== forma.id)
                              : [...prev, forma.id];
                          })}
                          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border cursor-pointer transition-all text-left ${
                            ativa
                              ? 'border-amber-300 bg-amber-50'
                              : 'border-zinc-100 bg-zinc-50 hover:border-zinc-200'
                          }`}
                        >
                          <div className={`w-7 h-7 flex items-center justify-center rounded-lg flex-shrink-0 text-sm ${
                            ativa ? 'bg-amber-500 text-white' : 'bg-zinc-200 text-zinc-500'
                          }`}>
                            <i className={tipoIcone[forma.tipo] ?? 'ri-wallet-line'} />
                          </div>
                          <span className="flex-1 text-sm font-medium text-zinc-700">{forma.nome}</span>
                          <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                            ativa ? 'border-amber-500 bg-amber-500' : 'border-zinc-300'
                          }`}>
                            {ativa && <i className="ri-check-line text-white text-[9px]" />}
                          </div>
                        </button>
                      );
                    })}
                    {deliveryPaymentMethods.length === 0 && (
                      <p className="text-xs text-red-500 flex items-center gap-1 px-1">
                        <i className="ri-error-warning-line" />
                        Selecione ao menos uma forma de pagamento
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </SectionCard>

      {/* Taxas e Gorjeta */}
      <SectionCard title="Taxas e Gorjeta" subtitle="Cobranças automáticas no fechamento" icon={<Percent size={16} />}>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-zinc-700">Taxa de serviço</p>
              <p className="text-xs text-zinc-400">Cobrada automaticamente no pedido</p>
            </div>
            <div className="flex items-center gap-3">
              {cfg.taxaServicoAtiva && (
                <div className="flex items-center gap-1.5">
                  <input type="number" value={cfg.taxaServico} onChange={(e) => set('taxaServico', parseFloat(e.target.value) || 0)}
                    className="w-16 text-sm border border-zinc-200 rounded-lg px-2 py-1.5 text-center text-zinc-800 focus:outline-none focus:border-amber-400" />
                  <span className="text-sm font-semibold text-zinc-500">%</span>
                </div>
              )}
              <Toggle checked={cfg.taxaServicoAtiva} onChange={(v) => set('taxaServicoAtiva', v)} />
            </div>
          </div>
          {cfg.taxaServicoAtiva && (
            <div className="flex items-center justify-between pl-4 border-l-2 border-amber-200">
              <div>
                <p className="text-sm font-semibold text-zinc-700 flex items-center gap-1.5">
                  <i className="ri-store-2-line text-zinc-400 text-sm" />
                  Exibir no PDV Caixa
                </p>
                <p className="text-xs text-zinc-400">O campo de taxa de serviço aparece no carrinho do caixa</p>
              </div>
              <Toggle
                checked={(cfg as Record<string, unknown>).pdvCaixaExibirTaxaServico as boolean ?? true}
                onChange={(v) => set('pdvCaixaExibirTaxaServico' as keyof ConfigOperacao, v as ConfigOperacao[keyof ConfigOperacao])}
              />
            </div>
          )}
          <div className="flex items-center justify-between border-t border-zinc-50 pt-4">
            <div>
              <p className="text-sm font-semibold text-zinc-700">Sugestão de gorjeta</p>
              <p className="text-xs text-zinc-400">Exibida na tela de pagamento</p>
            </div>
            <div className="flex items-center gap-3">
              {cfg.gorjetaAtiva && (
                <div className="flex items-center gap-1.5">
                  <input type="number" value={cfg.gorjetaSugerida} onChange={(e) => set('gorjetaSugerida', parseFloat(e.target.value) || 0)}
                    className="w-16 text-sm border border-zinc-200 rounded-lg px-2 py-1.5 text-center text-zinc-800 focus:outline-none focus:border-amber-400" />
                  <span className="text-sm font-semibold text-zinc-500">%</span>
                </div>
              )}
              <Toggle checked={cfg.gorjetaAtiva} onChange={(v) => set('gorjetaAtiva', v)} />
            </div>
          </div>
        </div>
      </SectionCard>

      {/* Operação do PDV */}
      <SectionCard title="Operação do PDV" subtitle="Regras de desconto e cancelamento" icon={<ShieldCheck size={16} />}>
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-zinc-600 mb-2">Quem pode aplicar desconto?</label>
            <div className="flex gap-2">
              {(['gerente', 'admin'] as const).map((p) => (
                <button key={p} onClick={() => set('senhaDescontoPerfil', p)}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-lg cursor-pointer transition-colors capitalize whitespace-nowrap ${cfg.senhaDescontoPerfil === p ? 'bg-amber-500 text-white' : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'}`}>
                  {p === 'gerente' ? 'Gerente ou Admin' : 'Somente Admin'}
                </button>
              ))}
            </div>
          </div>
          <div className="border-t border-zinc-50 pt-4">
            <label className="block text-xs font-semibold text-zinc-600 mb-2">Regra de cancelamento de item</label>
            <div className="flex flex-col gap-1.5">
              {[
                { v: 'livre', label: 'Livre — qualquer operador pode cancelar' },
                { v: 'senha_gerente', label: 'Requer senha do gerente' },
                { v: 'proibido', label: 'Proibido após envio ao KDS' },
              ].map(({ v, label }) => (
                <button key={v} onClick={() => set('modoCancelamento', v as ConfigOperacao['modoCancelamento'])}
                  className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg border cursor-pointer text-left transition-all ${cfg.modoCancelamento === v ? 'border-amber-400 bg-amber-50' : 'border-zinc-100 bg-zinc-50 hover:border-zinc-200'}`}>
                  <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${cfg.modoCancelamento === v ? 'border-amber-500 bg-amber-500' : 'border-zinc-300'}`}>
                    {cfg.modoCancelamento === v && <div className="w-1.5 h-1.5 bg-white rounded-full" />}
                  </div>
                  <span className="text-xs font-medium text-zinc-700">{label}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="border-t border-zinc-50 pt-4 flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-zinc-700">Tempo padrão de preparo</p>
              <p className="text-xs text-zinc-400">Usado quando o item não tem SLA definido</p>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-4 h-4 flex items-center justify-center text-zinc-400"><Clock size={13} /></div>
              <input type="number" value={cfg.tempoPadraoPreparo} onChange={(e) => set('tempoPadraoPreparo', parseInt(e.target.value) || 0)}
                className="w-16 text-sm border border-zinc-200 rounded-lg px-2 py-1.5 text-center text-zinc-800 focus:outline-none focus:border-amber-400" />
              <span className="text-xs text-zinc-500">min</span>
            </div>
          </div>
        </div>
      </SectionCard>

      {/* Impressão */}
      <SectionCard title="Impressão" subtitle="Configurações de impressora térmica" icon={<Printer size={16} />}>
        <div className="space-y-4">
          {[
            { key: 'impressaoAutomatica' as const, label: 'Imprimir cupom automaticamente', sub: 'Ao finalizar pagamento' },
            { key: 'impressaoKDS' as const, label: 'Imprimir comanda na cozinha', sub: 'Ao enviar pedido para o KDS' },
            { key: 'impressaoViasCozinhaAtiva' as const, label: 'Imprimir via da cozinha automaticamente', sub: 'Via com itens e observações enviada ao confirmar pagamento' },
          ].map(({ key, label, sub }) => (
            <div key={key} className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-zinc-700">{label}</p>
                <p className="text-xs text-zinc-400">{sub}</p>
              </div>
              <Toggle checked={cfg[key]} onChange={(v) => set(key, v)} />
            </div>
          ))}
          {/* Impressão de delivery — desativada por padrão */}
          <div className="flex items-center justify-between border-t border-zinc-50 pt-4">
            <div>
              <p className="text-sm font-semibold text-zinc-700 flex items-center gap-1.5">
                <i className="ri-motorbike-line text-zinc-400 text-sm" />
                Imprimir pedidos do PDV Delivery
              </p>
              <p className="text-xs text-zinc-400">
                Desativado por padrão — pedidos do iFood/apps já chegam impressos pelo próprio app
              </p>
            </div>
            <Toggle
              checked={(cfg as Record<string, unknown>).impressaoDeliveryAtiva as boolean ?? false}
              onChange={(v) => set('impressaoDeliveryAtiva' as keyof ConfigOperacao, v as ConfigOperacao[keyof ConfigOperacao])}
            />
          </div>
        </div>
      </SectionCard>

      {/* Autoatendimento */}
      <SectionCard title="Autoatendimento (Kiosk)" subtitle="Configurações do terminal de autoatendimento" icon={<Tablet size={16} />}>
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-zinc-600 mb-2">Identificação do cliente</label>
            <div className="flex flex-col gap-2">
              {([
                ['nome',    'Por nome',           'O cliente digita o nome no totem para ser chamado na retirada'],
                ['senha',   'Por senha numérica', 'O sistema gera uma senha aleatória exibida na tela'],
                ['comanda', 'Por comanda (pager)', 'O cliente escolhe um pager físico e digita o número no totem'],
              ] as const).map(([v, l, desc]) => (
                <button key={v} onClick={() => set('autoatendimentoIdentificacao', v)}
                  className={`flex items-start gap-3 px-4 py-3 rounded-xl border cursor-pointer text-left transition-all ${cfg.autoatendimentoIdentificacao === v ? 'border-amber-400 bg-amber-50' : 'border-zinc-100 bg-zinc-50 hover:border-zinc-200'}`}>
                  <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 mt-0.5 ${cfg.autoatendimentoIdentificacao === v ? 'border-amber-500 bg-amber-500' : 'border-zinc-300'}`}>
                    {cfg.autoatendimentoIdentificacao === v && <div className="w-1.5 h-1.5 bg-white rounded-full" />}
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-zinc-800">{l}</p>
                    <p className="text-xs text-zinc-400 mt-0.5">{desc}</p>
                  </div>
                </button>
              ))}
              {cfg.autoatendimentoIdentificacao === 'comanda' && (
                <div className="space-y-3 mt-1">
                  <div className="flex items-start gap-2 px-3 py-2.5 bg-amber-50 border border-amber-200 rounded-lg">
                    <i className="ri-information-line text-amber-500 text-sm flex-shrink-0 mt-0.5" />
                    <p className="text-xs text-amber-800">
                      <strong>Como funciona:</strong> Cada pager físico tem um número impresso. O cliente pega um pager disponível, digita o número no totem e aguarda ser chamado. O número do pager aparece no KDS e no gestor de pedidos para o atendente localizar o cliente.
                    </p>
                  </div>
                  <div className="flex items-center justify-between px-4 py-3 bg-zinc-50 border border-zinc-100 rounded-xl">
                    <div>
                      <p className="text-sm font-semibold text-zinc-700">Quantidade de pagers disponíveis</p>
                      <p className="text-xs text-zinc-400">O sistema valida se o número digitado é válido (1 até este limite)</p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="number"
                        min={1}
                        max={999}
                        value={(cfg as Record<string, unknown>).pagerCount as number ?? 50}
                        onChange={(e) => set('pagerCount' as keyof ConfigOperacao, (parseInt(e.target.value) || 50) as ConfigOperacao[keyof ConfigOperacao])}
                        className="w-20 text-sm border border-zinc-200 rounded-lg px-2 py-1.5 text-center text-zinc-800 focus:outline-none focus:border-amber-400"
                      />
                      <span className="text-xs text-zinc-500 whitespace-nowrap">pagers</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
          <div className="border-t border-zinc-50 pt-4">
            <label className="block text-xs font-semibold text-zinc-600 mb-2">Modo de pagamento</label>
            <div className="flex flex-col gap-2">
              {([
                ['hora',    'Pagar agora',            'Cliente paga no totem antes de confirmar o pedido'],
                ['entrega', 'Pagar na entrega',       'Pedido confirmado sem pagamento — cliente paga ao retirar'],
                ['ambos',   'Ambos (cliente escolhe)', 'O totem pergunta ao cliente se quer pagar agora ou na entrega'],
              ] as const).map(([v, l, desc]) => (
                <button key={v} onClick={() => set('autoatendimentoPagamento', v)}
                  className={`flex items-start gap-3 px-4 py-3 rounded-xl border cursor-pointer text-left transition-all ${cfg.autoatendimentoPagamento === v ? 'border-amber-400 bg-amber-50' : 'border-zinc-100 bg-zinc-50 hover:border-zinc-200'}`}>
                  <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 mt-0.5 ${cfg.autoatendimentoPagamento === v ? 'border-amber-500 bg-amber-500' : 'border-zinc-300'}`}>
                    {cfg.autoatendimentoPagamento === v && <div className="w-1.5 h-1.5 bg-white rounded-full" />}
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-zinc-800">{l}</p>
                    <p className="text-xs text-zinc-400 mt-0.5">{desc}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>
          <div className="border-t border-zinc-50 pt-4">
            <label className="block text-xs font-semibold text-zinc-600 mb-1.5 flex items-center gap-1">
              <div className="w-3 h-3 flex items-center justify-center"><MessageSquare size={11} /></div>
              Mensagem de boas-vindas
            </label>
            <textarea value={cfg.mensagemBoasVindas} onChange={(e) => set('mensagemBoasVindas', e.target.value)}
              rows={2} maxLength={200}
              className="w-full text-sm border border-zinc-200 rounded-lg px-3 py-2 text-zinc-800 focus:outline-none focus:border-amber-400 resize-none" />
            <p className="text-[10px] text-zinc-400 mt-1">{cfg.mensagemBoasVindas.length}/200 caracteres</p>
          </div>
          <div className="border-t border-zinc-50 pt-4">
            <label className="block text-xs font-semibold text-zinc-600 mb-1.5 flex items-center gap-1">
              <div className="w-3 h-3 flex items-center justify-center"><MessageSquare size={11} /></div>
              Mensagem de retorno
            </label>
            <textarea value={cfg.mensagemRetorno} onChange={(e) => set('mensagemRetorno', e.target.value)}
              rows={2} maxLength={200}
              className="w-full text-sm border border-zinc-200 rounded-lg px-3 py-2 text-zinc-800 focus:outline-none focus:border-amber-400 resize-none" />
            <p className="text-[10px] text-zinc-400 mt-1">{cfg.mensagemRetorno.length}/200 caracteres</p>
          </div>

          {/* Configuração PIX */}
          <div className="border-t border-zinc-50 pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-zinc-700 flex items-center gap-1.5">
                  <i className="ri-qr-code-line text-zinc-500 text-sm" />
                  Pagamento via PIX
                </p>
                <p className="text-xs text-zinc-400">Configure a chave PIX para receber pagamentos no totem</p>
              </div>
              <button
                onClick={() => setShowPixModal(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-bold rounded-lg cursor-pointer transition-colors whitespace-nowrap"
              >
                <i className="ri-settings-3-line text-xs" />
                Configurar PIX
              </button>
            </div>
          </div>
        </div>
      </SectionCard>

      {/* Modo Treino por Usuário */}
      <SectionCard title="Modo Treino por Usuário" subtitle="Ative o modo treino para operadores em treinamento" icon={<GraduationCap size={16} />}>
        <div className="space-y-3">
          <div className="flex items-center gap-2 px-3 py-2.5 bg-amber-50 border border-amber-200 rounded-lg mb-3">
            <i className="ri-information-line text-amber-500 text-sm flex-shrink-0 mt-0.5" />
            <p className="text-xs text-amber-800">No modo treino, os pedidos e movimentações do operador <strong>não afetam dados reais</strong>.</p>
          </div>
          {loadingUsuarios ? (
            <div className="flex items-center justify-center py-6">
              <div className="w-5 h-5 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
              <span className="text-xs text-zinc-400 ml-2">Carregando usuários...</span>
            </div>
          ) : usuariosReais.filter((u) => u.perfil !== 'admin').length === 0 ? (
            <p className="text-xs text-zinc-400 text-center py-4">Nenhum usuário encontrado.</p>
          ) : (
            usuariosReais.filter((u) => u.perfil !== 'admin').map((u) => {
              const corPerfil: Record<string, string> = { gerente: 'text-violet-600', caixa: 'text-amber-600', garcom: 'text-emerald-600', cozinha: 'text-sky-600' };
              const bgPerfil: Record<string, string> = { gerente: 'bg-violet-50', caixa: 'bg-amber-50', garcom: 'bg-emerald-50', cozinha: 'bg-sky-50' };
              return (
                <div key={u.id} className={`flex items-center gap-3 p-3 rounded-xl border transition-all ${u.modoTreino ? 'border-amber-200 bg-amber-50/50' : 'border-zinc-100 bg-white'}`}>
                  <div className="w-8 h-8 flex items-center justify-center bg-zinc-200 rounded-full flex-shrink-0">
                    <span className="text-xs font-bold text-zinc-600">{u.nome.charAt(0)}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-zinc-800 truncate">{u.nome}</p>
                      {u.modoTreino && <span className="text-[9px] font-black px-1.5 py-0.5 bg-amber-400 text-amber-900 rounded-full uppercase tracking-wide whitespace-nowrap">TREINO</span>}
                    </div>
                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${bgPerfil[u.perfil] ?? 'bg-zinc-50'} ${corPerfil[u.perfil] ?? 'text-zinc-500'}`}>
                      {u.perfil.charAt(0).toUpperCase() + u.perfil.slice(1)}
                    </span>
                  </div>
                  <button onClick={() => handleToggleTreino(u.id)}
                    className={`relative w-11 h-6 rounded-full transition-colors cursor-pointer flex-shrink-0 ${u.modoTreino ? 'bg-amber-400' : 'bg-zinc-200'}`}>
                    <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${u.modoTreino ? 'left-6' : 'left-1'}`} />
                  </button>
                </div>
              );
            })
          )}
        </div>
      </SectionCard>

      {/* Cronômetro de Mesas */}
      <SectionCard title="Cronômetro de Mesas" subtitle="Cores do timer nos cards das mesas do garçom" icon={<Timer size={16} />}>
        <div className="space-y-5">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider w-full mb-1">Pré-visualização</span>
            <span className="text-[11px] font-bold px-2.5 py-1 rounded-full border text-green-600 bg-green-50 border-green-200 whitespace-nowrap">⏱ &lt;{cfg.timerVerdeMax}min — Verde</span>
            <span className="text-[11px] font-bold px-2.5 py-1 rounded-full border text-amber-600 bg-amber-50 border-amber-200 whitespace-nowrap">⏱ {cfg.timerVerdeMax}–{cfg.timerAmbarMax}min — Âmbar</span>
            <span className="text-[11px] font-bold px-2.5 py-1 rounded-full border text-red-600 bg-red-50 border-red-200 whitespace-nowrap">⏱ &gt;{cfg.timerAmbarMax}min — Vermelho</span>
          </div>
          <div>
            <div className="flex items-center justify-between mb-2">
              <div>
                <p className="text-sm font-semibold text-zinc-700 flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-green-400 inline-block" />Até Verde</p>
                <p className="text-xs text-zinc-400 mt-0.5">Card fica verde abaixo deste tempo</p>
              </div>
              <div className="flex items-center gap-2">
                <input type="number" min={5} max={cfg.timerAmbarMax - 5} value={cfg.timerVerdeMax}
                  onChange={(e) => { const v = Math.max(5, Math.min(cfg.timerAmbarMax - 5, parseInt(e.target.value) || 5)); set('timerVerdeMax', v); }}
                  className="w-16 text-sm border border-zinc-200 rounded-lg px-2 py-1.5 text-center text-zinc-800 focus:outline-none focus:border-amber-400" />
                <span className="text-xs text-zinc-500 whitespace-nowrap">min</span>
              </div>
            </div>
            <input type="range" min={5} max={cfg.timerAmbarMax - 5} step={5} value={cfg.timerVerdeMax}
              onChange={(e) => set('timerVerdeMax', parseInt(e.target.value))}
              className="w-full h-2 rounded-full appearance-none cursor-pointer accent-green-500" />
          </div>
          <div className="border-t border-zinc-50 pt-4">
            <div className="flex items-center justify-between mb-2">
              <div>
                <p className="text-sm font-semibold text-zinc-700 flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-amber-400 inline-block" />Até Âmbar</p>
                <p className="text-xs text-zinc-400 mt-0.5">Card fica âmbar abaixo deste tempo; acima vira vermelho</p>
              </div>
              <div className="flex items-center gap-2">
                <input type="number" min={cfg.timerVerdeMax + 5} max={480} value={cfg.timerAmbarMax}
                  onChange={(e) => { const v = Math.max(cfg.timerVerdeMax + 5, Math.min(480, parseInt(e.target.value) || cfg.timerVerdeMax + 5)); set('timerAmbarMax', v); }}
                  className="w-16 text-sm border border-zinc-200 rounded-lg px-2 py-1.5 text-center text-zinc-800 focus:outline-none focus:border-amber-400" />
                <span className="text-xs text-zinc-500 whitespace-nowrap">min</span>
              </div>
            </div>
            <input type="range" min={cfg.timerVerdeMax + 5} max={480} step={5} value={cfg.timerAmbarMax}
              onChange={(e) => set('timerAmbarMax', parseInt(e.target.value))}
              className="w-full h-2 rounded-full appearance-none cursor-pointer accent-amber-500" />
          </div>
        </div>
      </SectionCard>

      {/* PIX Stone */}
      <div className="bg-white border border-zinc-100 rounded-xl p-5">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-8 h-8 flex items-center justify-center bg-zinc-100 rounded-lg">
            <span className="text-xs font-black text-zinc-600">PIX</span>
          </div>
          <div>
            <h3 className="text-sm font-bold text-zinc-800">Integração Stone (PIX)</h3>
            <p className="text-xs text-zinc-400">Credenciais para geração de QR Code dinâmico</p>
          </div>
        </div>
        <div className="flex items-center gap-2 px-3 py-2.5 bg-amber-50 border border-amber-200 rounded-lg mb-4">
          <div className="w-4 h-4 flex items-center justify-center text-amber-500 flex-shrink-0"><AlertCircle size={13} /></div>
          <p className="text-xs text-amber-700">As credenciais são salvas com segurança no banco de dados da loja.</p>
        </div>
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-semibold text-zinc-600 mb-1.5">Stone Client ID</label>
            <input value={pixCfg.stoneClientId} onChange={(e) => setPixCfg((p) => ({ ...p, stoneClientId: e.target.value }))}
              className="w-full text-sm border border-zinc-200 rounded-lg px-3 py-2.5 text-zinc-800 focus:outline-none focus:border-amber-400 font-mono" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-zinc-600 mb-1.5">Stone Client Secret</label>
            <div className="relative">
              <input type={showSecret ? 'text' : 'password'} value={pixCfg.stoneClientSecret}
                onChange={(e) => setPixCfg((p) => ({ ...p, stoneClientSecret: e.target.value }))}
                className="w-full text-sm border border-zinc-200 rounded-lg px-3 py-2.5 pr-10 text-zinc-800 focus:outline-none focus:border-amber-400 font-mono" />
              <button onClick={() => setShowSecret(!showSecret)}
                className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 flex items-center justify-center text-zinc-400 hover:text-zinc-600 cursor-pointer">
                {showSecret ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-zinc-600 mb-1.5">Tipo de chave PIX</label>
              <select value={pixCfg.chavePixTipo} onChange={(e) => setPixCfg((p) => ({ ...p, chavePixTipo: e.target.value as typeof pixCfg.chavePixTipo }))}
                className="w-full text-sm border border-zinc-200 rounded-lg px-3 py-2.5 text-zinc-800 focus:outline-none focus:border-amber-400 cursor-pointer">
                <option value="cnpj">CNPJ</option>
                <option value="email">E-mail</option>
                <option value="celular">Celular</option>
                <option value="aleatoria">Chave aleatória</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-zinc-600 mb-1.5">Chave PIX</label>
              <input value={pixCfg.chavePix} onChange={(e) => setPixCfg((p) => ({ ...p, chavePix: e.target.value }))}
                className="w-full text-sm border border-zinc-200 rounded-lg px-3 py-2.5 text-zinc-800 focus:outline-none focus:border-amber-400" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-zinc-600 mb-1.5">URL do Webhook</label>
            <input value={pixCfg.webhookUrl} onChange={(e) => setPixCfg((p) => ({ ...p, webhookUrl: e.target.value }))}
              className="w-full text-sm border border-zinc-200 rounded-lg px-3 py-2.5 text-zinc-800 focus:outline-none focus:border-amber-400 font-mono text-xs" />
          </div>
        </div>
      </div>

      <div className="flex justify-end pb-4">
        <button onClick={handleSalvar} disabled={salvando}
          className="flex items-center gap-2 px-5 py-2.5 bg-amber-500 text-white text-sm font-bold rounded-lg hover:bg-amber-600 disabled:opacity-60 cursor-pointer transition-colors whitespace-nowrap">
          <div className="w-4 h-4 flex items-center justify-center">
            {salvando ? <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Save size={14} />}
          </div>
          {salvando ? 'Salvando...' : 'Salvar configurações'}
        </button>
      </div>
    </div>
  );
}
