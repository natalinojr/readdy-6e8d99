// Navegação de Contratação (reorganização de 2026-09-30, "organizada pelo que fazer"): 3 áreas —
// Minha fila (o que depende de você), Vagas (o funil de cada vaga) e Pessoas (o banco inteiro) —
// mais Números e Configurações como ícones. Traduz também os valores antigos de `?aba=` /
// localStorage `contratacao_aba` (as 9 abas de antes de 09-20 e as 5 áreas de 09-20 a 09-30).
// Lógica pura — sem JSX, sem localStorage, sem import de page.tsx.
export type Area = 'fila' | 'vagas' | 'pessoas' | 'numeros' | 'config';
export type SecaoConfig = 'empresas' | 'fases' | 'dados-minimos' | 'entrevista' | 'whatsapp';
/** Dentro da vaga aberta: funil (fases), ranking pela nota da IA ou as conversas do agendamento. */
export type VisaoVaga = 'funil' | 'ranking' | 'conversas';

export interface Destino {
  area: Area;
  /** Só relevante quando area === 'config'. */
  secaoConfig?: SecaoConfig;
  /** Só relevante quando area === 'vagas' (abre a lista de vagas já na visão das conversas da IA). */
  visaoVaga?: VisaoVaga;
}

export interface AreaDef { id: Area; label: string; icon: string }

/** As 3 áreas da barra. Números e Configurações ficam à parte, como ícones. */
export const AREAS: AreaDef[] = [
  { id: 'fila', label: 'Minha fila', icon: 'ri-checkbox-multiple-line' },
  { id: 'vagas', label: 'Vagas', icon: 'ri-briefcase-4-line' },
  { id: 'pessoas', label: 'Pessoas', icon: 'ri-group-line' },
];
export const AREA_NUMEROS: AreaDef = { id: 'numeros', label: 'Números', icon: 'ri-bar-chart-2-line' };
export const AREA_CONFIG: AreaDef = { id: 'config', label: 'Configurações', icon: 'ri-settings-3-line' };

/**
 * Traduz um valor de `?aba=`/localStorage `contratacao_aba` — atual ou de uma navegação antiga —
 * para o destino na navegação de hoje. Nunca lança; valor desconhecido ou ausente cai na Minha fila.
 * Links do assistente continuam mandando `aba=entrevistas`/`agendamentos` e precisam cair num lugar útil.
 */
export function destinoDeAbaAntiga(valor: string | null): Destino {
  switch (valor) {
    case 'fila': case 'hoje': case 'entrevistas': case 'agenda': return { area: 'fila' };
    case 'pessoas': case 'candidatos': return { area: 'pessoas' };
    case 'vagas': case 'kanban': return { area: 'vagas' };
    case 'agendamentos': return { area: 'vagas', visaoVaga: 'conversas' };
    case 'numeros': case 'relatorios': return { area: 'numeros' };
    case 'links': return { area: 'config', secaoConfig: 'whatsapp' };
    case 'config': return { area: 'config' };
    default: return { area: 'fila' };
  }
}
