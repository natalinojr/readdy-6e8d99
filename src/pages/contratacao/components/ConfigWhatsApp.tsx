// Configurações › WhatsApp: canais sem vaga (bot_channels.job_id = null) e/ou canal padrão
// (is_default = true) — RF-06. Mesmo LinksWhatsApp de sempre, escopo 'sem-vaga' (ver T11 Decisão 1/2).
import LinksWhatsApp from './LinksWhatsApp';
import type { Company, Job } from '../shared';

interface Props { companies: Company[]; jobs: Job[]; onOpenCandidate: (id: string) => void }

export default function ConfigWhatsApp({ companies, jobs, onOpenCandidate }: Props) {
  return <LinksWhatsApp companies={companies} jobs={jobs} onOpenCandidate={onOpenCandidate} escopo={{ tipo: 'sem-vaga' }} />;
}
