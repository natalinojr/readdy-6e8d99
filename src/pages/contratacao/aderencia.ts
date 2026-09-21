// Melhor nota de aderência do candidato: a maior hiring_applications.score entre as
// candidaturas dele, com o nome da vaga correspondente. Lógica pura — sem query, sem IA.
// Recebe as candidaturas JÁ agrupadas por candidato (page.tsx faz o agrupamento uma vez
// com um Map, O(candidaturas) no total) para não filtrar a lista inteira a cada card
// numa tela com milhares de candidatos.
import { type Application, type Fit, type Job, fitOf } from './shared';

export interface Aderencia {
  score: number;
  fit: Fit;
  jobId: string;
  jobTitle: string;
}

/**
 * Recebe as candidaturas de UM candidato (já filtradas por candidate_id) e a lista de
 * vagas (para achar o título). Ignora candidatura sem score (ainda não analisada ou
 * error != null), candidatura cuja vaga foi apagada (não inventa título — edge case da
 * spec) e candidatura de vaga fechada (mesma convenção do resto do módulo: `status !==
 * 'fechada'` conta como aberta, ver FichaResumo/Vagas/LinksWhatsApp/page.tsx — uma vaga
 * fechada não é mais uma opção real para anunciar no chip do card). Em empate de score,
 * vence a candidatura mais recente (created_at maior).
 */
export function melhorAderencia(applications: Application[], jobs: Job[]): Aderencia | null {
  const jobById = new Map(jobs.map((j) => [j.id, j]));
  let melhor: Aderencia | null = null;
  let melhorCreatedAt = '';
  for (const a of applications) {
    if (a.score == null || a.error) continue; // sem análise ainda, ou erro na IA
    const job = jobById.get(a.job_id);
    const jobTitle = job?.title;
    if (!jobTitle) continue; // vaga apagada: não inventa título, ignora a candidatura
    if (job.status === 'fechada') continue; // vaga fechada não é mais uma opção real
    const ganha = !melhor || a.score > melhor.score || (a.score === melhor.score && a.created_at > melhorCreatedAt);
    if (ganha) {
      melhor = { score: a.score, fit: a.fit ?? fitOf(a.score) ?? 'baixa', jobId: a.job_id, jobTitle };
      melhorCreatedAt = a.created_at;
    }
  }
  return melhor;
}
