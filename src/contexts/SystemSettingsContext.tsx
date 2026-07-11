/**
 * SystemSettingsContext — singleton global para system_settings.
 *
 * Problema resolvido: useSystemSettings() era chamado em 20+ componentes,
 * cada um fazendo sua própria query e criando seu próprio canal Realtime.
 * Isso causava inconsistências — alguns componentes ficavam com dados velhos.
 *
 * Solução: um único Provider carrega e mantém as settings. Todos os
 * componentes consomem via useSystemSettings() que agora lê do contexto.
 */

import { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from 'react';
import { supabase, invokeWithAuth } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useKioskAuth } from '@/contexts/KioskAuthContext';

// ── Types (re-exportados para compatibilidade) ────────────────────────────────

export interface SectorConfig {
  id: string;
  nome: string;
  cor: string;
  icone: string;
}

export interface PrinterConfigImpressora {
  id: string;
  nome: string;
  ip: string;
  descricao: string;
  paperStyle?: '80mm' | '58mm';
}

export interface PrintTemplateConfig {
  stationKey: string;
  showLogo: boolean;
  showOrderNumber: boolean;
  showDateTime: boolean;
  showStationName: boolean;
  showItemObservations: boolean;
  showItemOptions: boolean;
  showCustomerName: boolean;
  showTableInfo: boolean;
  showWaiterName: boolean;
  footerMessage: string;
  headerMessage: string;
}

export interface PrinterConfig {
  impressoras: PrinterConfigImpressora[];
  mapaEstacoes: Record<string, string>;
  printTemplates?: Record<string, PrintTemplateConfig>;
}

export interface PdvConfig {
  caixa: boolean;
  garcom: boolean;
  delivery: boolean;
  kds: boolean;
  autoatendimento: boolean;
  mesa_qr: boolean;
}

export const DEFAULT_PDV_CONFIG: PdvConfig = {
  caixa: true, garcom: true, delivery: true,
  kds: true, autoatendimento: false, mesa_qr: true,
};

export interface SystemSettings {
  tenant_id?: string;
  pdv_config: PdvConfig;
  service_fee_enabled: boolean;
  service_fee_percentage: number;
  pdv_caixa_show_service_fee: boolean;
  gorjeta_enabled: boolean;
  gorjeta_percentage: number;
  auto_print_enabled: boolean;
  kitchen_close_time: string;
  self_service_id_type: 'nome' | 'senha' | 'comanda' | 'senha_balcao' | 'nenhum';
  self_service_payment_type: 'hora' | 'entrega' | 'ambos';
  welcome_message_new: string;
  welcome_message_returning: string;
  stone_client_id: string;
  stone_client_secret: string;
  timer_verde_max: number;
  timer_ambar_max: number;
  kitchen_view: 'kds' | 'gestor' | 'ambos';
  cancel_mode: 'livre' | 'senha_gerente' | 'proibido';
  discount_profile: 'gerente' | 'admin';
  default_prep_time: number;
  delivery_require_id: boolean;
  delivery_type: 'entrega' | 'retirada' | 'ambos';
  delivery_eta_minutes: number;
  sectors_config: SectorConfig[] | null;
  print_kds_enabled: boolean;
  print_kitchen_copy_enabled: boolean;
  printers_config: PrinterConfig | null;
  pager_count: number;
  motoboy_alertas: MotoboyAlertas;
  whatsapp_msgs: Record<string, string[]>;  // mensagens pro cliente por fase (status)
  updated_at?: string;
}

export interface MotoboyAlertEntry { id: string; nome: string; }
export interface MotoboyAlertas { categorias: MotoboyAlertEntry[]; itens: MotoboyAlertEntry[]; }

// ── Normalizers ───────────────────────────────────────────────────────────────

function normalizeIdType(v: string | null | undefined): SystemSettings['self_service_id_type'] {
  if (!v) return 'nome';
  const map: Record<string, SystemSettings['self_service_id_type']> = {
    nome: 'nome', name: 'nome',
    senha: 'senha', password: 'senha', pin: 'senha',
    comanda: 'comanda', ticket: 'comanda',
    senha_balcao: 'senha_balcao',
    nenhum: 'nenhum', none: 'nenhum',
  };
  return map[v.toLowerCase()] ?? 'nome';
}

function normalizePaymentType(v: string | null | undefined): SystemSettings['self_service_payment_type'] {
  if (!v) return 'hora';
  const map: Record<string, SystemSettings['self_service_payment_type']> = {
    hora: 'hora', upfront: 'hora', now: 'hora',
    entrega: 'entrega', delivery: 'entrega', later: 'entrega',
    ambos: 'ambos', both: 'ambos',
  };
  return map[v.toLowerCase()] ?? 'hora';
}

// ── Defaults ──────────────────────────────────────────────────────────────────

export const DEFAULT_SETTINGS: SystemSettings = {
  pdv_config: DEFAULT_PDV_CONFIG,
  service_fee_enabled: true,
  service_fee_percentage: 10,
  pdv_caixa_show_service_fee: true,
  gorjeta_enabled: true,
  gorjeta_percentage: 10,
  auto_print_enabled: true,
  kitchen_close_time: '23:00',
  self_service_id_type: 'nome',
  self_service_payment_type: 'hora',
  welcome_message_new: 'Bem-vindo! Faça seu pedido e aproveite!',
  welcome_message_returning: 'Que bom te ver de volta!',
  stone_client_id: '',
  stone_client_secret: '',
  timer_verde_max: 45,
  timer_ambar_max: 90,
  kitchen_view: 'ambos',
  cancel_mode: 'senha_gerente',
  discount_profile: 'gerente',
  default_prep_time: 15,
  delivery_require_id: true,
  delivery_type: 'ambos',
  delivery_eta_minutes: 45,
  sectors_config: null,
  print_kds_enabled: true,
  print_kitchen_copy_enabled: true,
  printers_config: null,
  pager_count: 50,
  motoboy_alertas: { categorias: [], itens: [] },
  whatsapp_msgs: {},
};

// ── Context ───────────────────────────────────────────────────────────────────

interface SystemSettingsContextValue {
  settings: SystemSettings;
  loading: boolean;
  carregar: () => Promise<void>;
  salvar: (updates: Partial<SystemSettings>) => Promise<{ success: boolean; error: string | null }>;
}

const SystemSettingsContext = createContext<SystemSettingsContextValue>({
  settings: DEFAULT_SETTINGS,
  loading: true,
  carregar: async () => undefined,
  salvar: async () => ({ success: false, error: 'Provider not mounted' }),
});

// ── Provider ──────────────────────────────────────────────────────────────────

function parseRow(data: Record<string, unknown>): SystemSettings {
  return {
    ...DEFAULT_SETTINGS,
    tenant_id: (data.tenant_id as string) ?? undefined,
    motoboy_alertas: (() => {
      const dc = data.delivery_config as Record<string, unknown> | null | undefined;
      const ma = dc?.motoboy_alertas as { categorias?: unknown; itens?: unknown } | undefined;
      const arr = (x: unknown): MotoboyAlertEntry[] => Array.isArray(x)
        ? x.filter((e) => e && typeof e === 'object' && (e as { id?: unknown }).id)
            .map((e) => ({ id: String((e as { id: unknown }).id), nome: String((e as { nome?: unknown }).nome ?? '') }))
        : [];
      return { categorias: arr(ma?.categorias), itens: arr(ma?.itens) };
    })(),
    whatsapp_msgs: (() => {
      const dc = data.delivery_config as Record<string, unknown> | null | undefined;
      const wm = dc?.whatsapp_msgs as Record<string, unknown> | undefined;
      const out: Record<string, string[]> = {};
      if (wm && typeof wm === 'object') {
        for (const [k, v] of Object.entries(wm)) {
          if (Array.isArray(v)) out[k] = v.filter((s) => typeof s === 'string' && s.trim()).map((s) => String(s));
        }
      }
      return out;
    })(),
    service_fee_enabled: (data.service_fee_enabled as boolean) ?? DEFAULT_SETTINGS.service_fee_enabled,
    service_fee_percentage: Number(data.service_fee_percentage ?? DEFAULT_SETTINGS.service_fee_percentage),
    pdv_caixa_show_service_fee: (data.pdv_caixa_show_service_fee as boolean) ?? DEFAULT_SETTINGS.pdv_caixa_show_service_fee,
    gorjeta_enabled: (data.gorjeta_enabled as boolean) ?? DEFAULT_SETTINGS.gorjeta_enabled,
    gorjeta_percentage: Number(data.gorjeta_percentage ?? DEFAULT_SETTINGS.gorjeta_percentage),
    auto_print_enabled: (data.auto_print_enabled as boolean) ?? DEFAULT_SETTINGS.auto_print_enabled,
    kitchen_close_time: data.kitchen_close_time
      ? String(data.kitchen_close_time).slice(0, 5)
      : DEFAULT_SETTINGS.kitchen_close_time,
    self_service_id_type: normalizeIdType(data.self_service_id_type as string),
    self_service_payment_type: normalizePaymentType(data.self_service_payment_type as string),
    welcome_message_new: (data.welcome_message_new as string) ?? DEFAULT_SETTINGS.welcome_message_new,
    welcome_message_returning: (data.welcome_message_returning as string) ?? DEFAULT_SETTINGS.welcome_message_returning,
    stone_client_id: (data.stone_client_id as string) ?? '',
    stone_client_secret: (data.stone_client_secret as string) ?? '',
    timer_verde_max: Number(data.timer_verde_max ?? DEFAULT_SETTINGS.timer_verde_max),
    timer_ambar_max: Number(data.timer_ambar_max ?? DEFAULT_SETTINGS.timer_ambar_max),
    kitchen_view: (data.kitchen_view as SystemSettings['kitchen_view']) ?? DEFAULT_SETTINGS.kitchen_view,
    cancel_mode: (data.cancel_mode as SystemSettings['cancel_mode']) ?? DEFAULT_SETTINGS.cancel_mode,
    discount_profile: (data.discount_profile as SystemSettings['discount_profile']) ?? DEFAULT_SETTINGS.discount_profile,
    default_prep_time: Number(data.default_prep_time ?? DEFAULT_SETTINGS.default_prep_time),
    delivery_require_id: (data.delivery_require_id as boolean) ?? DEFAULT_SETTINGS.delivery_require_id,
    delivery_type: (data.delivery_type as SystemSettings['delivery_type']) ?? DEFAULT_SETTINGS.delivery_type,
    delivery_eta_minutes: Number(data.delivery_eta_minutes ?? DEFAULT_SETTINGS.delivery_eta_minutes),
    sectors_config: (data.sectors_config as SectorConfig[]) ?? null,
    print_kds_enabled: (data.print_kds_enabled as boolean) ?? DEFAULT_SETTINGS.print_kds_enabled,
    print_kitchen_copy_enabled: (data.print_kitchen_copy_enabled as boolean) ?? DEFAULT_SETTINGS.print_kitchen_copy_enabled,
    printers_config: (data.printers_config as PrinterConfig) ?? null,
    pager_count: Number(data.pager_count ?? DEFAULT_SETTINGS.pager_count),
    pdv_config: data.pdv_config
      ? { ...DEFAULT_PDV_CONFIG, ...(data.pdv_config as Partial<PdvConfig>) }
      : DEFAULT_PDV_CONFIG,
    updated_at: data.updated_at as string | undefined,
  };
}

export function SystemSettingsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { kioskSession } = useKioskAuth();
  const [settings, setSettings] = useState<SystemSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  // Tenant cujas settings estão (ou estão sendo) carregadas no estado.
  // Impede que as settings de uma loja "vazem" para outra ao trocar de loja.
  const activeTenantRef = useRef<string | null>(null);

  const carregar = useCallback(async () => {
    const tenantId = user?.tenantId ?? kioskSession?.tenantId;
    if (!tenantId) { setLoading(false); return; }
    // Trocou de loja: descarta imediatamente as settings da loja anterior
    if (activeTenantRef.current !== tenantId) {
      activeTenantRef.current = tenantId;
      setSettings({ ...DEFAULT_SETTINGS });
    }
    setLoading(true);
    try {
      const { data } = await supabase
        .from('system_settings')
        .select('*')
        .eq('tenant_id', tenantId)
        .maybeSingle();
      // Resposta chegou depois de nova troca de loja → ignora
      if (activeTenantRef.current !== tenantId) return;
      // Sem linha no banco: usa defaults, mas marca o tenant para que os
      // consumidores (ex.: ImpressorasContext) saibam que a carga terminou.
      setSettings(data
        ? parseRow(data as Record<string, unknown>)
        : { ...DEFAULT_SETTINGS, tenant_id: tenantId });
    } catch (e) {
      console.error('[SystemSettings] load error:', e);
    } finally {
      if (activeTenantRef.current === tenantId) setLoading(false);
    }
  }, [user?.tenantId, kioskSession?.tenantId]);

  // Carrega na montagem
  useEffect(() => { carregar(); }, [carregar]);

  // Recarrega quando a aba/janela volta ao foco (evita dados stale)
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        carregar();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [carregar]);

  // Realtime — um único canal para todo o app
  useEffect(() => {
    const tenantId = user?.tenantId ?? kioskSession?.tenantId;
    if (!tenantId) return;
    const channel = supabase
      .channel(`system_settings_global:${tenantId}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'system_settings',
        filter: `tenant_id=eq.${tenantId}`,
      }, (payload) => {
        // Atualiza diretamente do payload sem nova query.
        // Ignora eventos de canal antigo entregues após troca de loja.
        const row = payload.new as Record<string, unknown> | undefined;
        if (row && row.tenant_id === tenantId) {
          if (activeTenantRef.current === tenantId) {
            setSettings(parseRow(row));
          }
        } else if (!row) {
          carregar();
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user?.tenantId, kioskSession?.tenantId, carregar]);

  const salvar = useCallback(
    async (updates: Partial<SystemSettings>): Promise<{ success: boolean; error: string | null }> => {
      const tenantId = user?.tenantId ?? kioskSession?.tenantId;
      if (!tenantId) return { success: false, error: 'Usuário sem tenant' };
      try {
        // Usa o token do kiosk quando disponível (modo totem por token)
        // Isso evita o erro Unauthorized quando o kiosk não tem sessão Supabase Auth
        const externalToken = kioskSession?.accessToken;
        const { data, error } = await invokeWithAuth<{ success: boolean; error?: string }>('config-write', {
          body: { action: 'upsert_system_settings', tenant_id: tenantId, ...updates },
          externalToken,
        });
        if (error) return { success: false, error: error.message || 'Erro ao salvar' };
        if (!data?.success) return { success: false, error: data?.error || 'Operação falhou' };
        // Atualiza estado local imediatamente para evitar stale data enquanto
        // o Realtime não chega. Faz merge parcial mantendo normalização.
        setSettings((prev) =>
          parseRow({
            ...prev,
            ...updates,
            tenant_id: tenantId,
            updated_at: new Date().toISOString(),
          } as Record<string, unknown>),
        );
        return { success: true, error: null };
      } catch (e) {
        return { success: false, error: String(e) };
      }
    },
    [user?.tenantId, kioskSession?.tenantId, kioskSession?.accessToken],
  );

  return (
    <SystemSettingsContext.Provider value={{ settings, loading, carregar, salvar }}>
      {children}
    </SystemSettingsContext.Provider>
  );
}

// ── Hook público (substitui o antigo useSystemSettings) ───────────────────────

export function useSystemSettings() {
  return useContext(SystemSettingsContext);
}

export {
  type PrintTemplateConfig,
  type PrinterConfigImpressora,
};