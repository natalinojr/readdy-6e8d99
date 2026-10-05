import { useSystemSettings } from '@/hooks/useSystemSettings';
import type { RecursoLoja } from '@/constants/recursosLoja';

/** Recurso novo ligado na loja ativa (Configurações › Operação › Recursos novos). Padrão: desligado. */
export function useRecursoLoja(chave: RecursoLoja): boolean {
  const { settings } = useSystemSettings();
  return settings.recursos?.[chave] === true;
}
