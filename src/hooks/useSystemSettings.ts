/**
 * useSystemSettings — re-exporta do SystemSettingsContext (singleton global).
 *
 * Todos os componentes que importam daqui continuam funcionando sem mudança.
 * O estado agora é compartilhado: uma única query, um único canal Realtime.
 */
export {
  useSystemSettings,
  type SystemSettings,
  type PdvConfig,
  type SectorConfig,
  type PrinterConfig,
  DEFAULT_SETTINGS,
  DEFAULT_PDV_CONFIG,
} from '@/contexts/SystemSettingsContext';
