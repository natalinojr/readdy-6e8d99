// Aba "Divulgação" da vaga: link wa.me + QR + primeira resposta — o mesmo LinksWhatsApp de sempre,
// só que mostrando apenas o(s) canal(is) desta vaga (escopo 'vaga'). Ver Decisão 1 de T11: em vez de
// duplicar a carga/lógica de bot_channels, LinksWhatsApp ganhou um prop de escopo.
import LinksWhatsApp from './LinksWhatsApp';
import type { Company, Job } from '../shared';

interface Props { job: Job; companies: Company[]; jobs: Job[]; onOpenCandidate: (id: string) => void }

export default function VagaDivulgacao({ job, companies, jobs, onOpenCandidate }: Props) {
  return (
    <LinksWhatsApp companies={companies} jobs={jobs} onOpenCandidate={onOpenCandidate}
      escopo={{ tipo: 'vaga', jobId: job.id, companyId: job.company_id }} />
  );
}
