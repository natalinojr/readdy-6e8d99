// Navegação de Contratação: as 5 áreas novas (+ engrenagem) e o mapa de compatibilidade dos
// valores antigos de `?aba=`/localStorage `contratacao_aba` (as 9 abas de antes da Fase 3)
// para o destino novo. Lógica pura — sem JSX, sem localStorage, sem import de page.tsx.
export type Area = 'hoje' | 'candidatos' | 'vagas' | 'entrevistas' | 'relatorios' | 'config';
export type SubAbaEntrevistas = 'dia' | 'calendario' | 'conversas';
export type ModoCandidatos = 'cards' | 'tabela' | 'kanban';
export type SecaoConfig = 'empresas' | 'fases' | 'dados-minimos' | 'entrevista' | 'whatsapp';

export interface Destino {
  area: Area;
  /** Só relevante quando area === 'entrevistas'. */
  subabaEntrevistas?: SubAbaEntrevistas;
  /** Só relevante quando area === 'candidatos'. */
  modoCandidatos?: ModoCandidatos;
  /** Só relevante quando area === 'config'. */
  secaoConfig?: SecaoConfig;
}

export interface AreaDef { id: Area; label: string; icon: string }

// As 5 abas da barra (RF-01: "5 abas... + ícone de engrenagem" — a engrenagem é
// AREA_CONFIG, à parte, não o 6º item aqui). Ícones Remix já em uso no módulo
// (page.tsx:44-52, ABAS pré-Fase-3); "Hoje" reaproveita ri-sun-line, já usado no produto
// para o conceito "hoje" (src/pages/financeiro/components/VisaoGeralFinTab.tsx:550).
export const AREAS: AreaDef[] = [
  { id: 'hoje', label: 'Hoje', icon: 'ri-sun-line' },
  { id: 'candidatos', label: 'Candidatos', icon: 'ri-group-line' },
  { id: 'vagas', label: 'Vagas', icon: 'ri-briefcase-4-line' },
  { id: 'entrevistas', label: 'Entrevistas', icon: 'ri-chat-voice-line' },
  { id: 'relatorios', label: 'Relatórios', icon: 'ri-bar-chart-2-line' },
];
export const AREA_CONFIG: AreaDef = { id: 'config', label: 'Configurações', icon: 'ri-settings-3-line' };

/**
 * Traduz um valor antigo de `?aba=`/localStorage `contratacao_aba` (as 9 abas de antes da
 * Fase 3) — ou já um id de área nova, que para 5 dos 9 valores antigos é a MESMA string
 * (`entrevistas`, `candidatos`, `vagas`, `relatorios`, `config`) — para o destino na
 * navegação nova. Nunca lança; valor desconhecido ou ausente cai no default (RF-01:
 * "valor inválido/ausente → Hoje"). Quem chama decide o que fazer com area === 'hoje'
 * enquanto a área Hoje não existir (T14/T15) — ver T09, Decisão 3.
 */
export function destinoDeAbaAntiga(valor: string | null): Destino {
  switch (valor) {
    case 'entrevistas': return { area: 'entrevistas', subabaEntrevistas: 'dia' };
    // Sem modoCandidatos de propósito: a tabela de compatibilidade (spec RF-01, linha 2) diz que o
    // modo "vem do localStorage contratacao_view, sem mudança". Devolver 'cards' aqui mataria a
    // preferência de quem tem contratacao_view='tabela' gravado, porque o `??` de
    // estadoInicialDeNavegacao (T09) nunca cairia no fallback que lê o localStorage.
    // Só 'kanban' força um modo — é o único valor antigo que ERA uma aba própria.
    case 'candidatos': return { area: 'candidatos' };
    case 'vagas': return { area: 'vagas' };
    case 'kanban': return { area: 'candidatos', modoCandidatos: 'kanban' };
    case 'agenda': return { area: 'entrevistas', subabaEntrevistas: 'calendario' };
    case 'agendamentos': return { area: 'entrevistas', subabaEntrevistas: 'conversas' };
    case 'relatorios': return { area: 'relatorios' };
    case 'links': return { area: 'config', secaoConfig: 'whatsapp' };
    case 'config': return { area: 'config' };
    default: return { area: 'hoje' };
  }
}
