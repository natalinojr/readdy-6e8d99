import { useEffect, useState } from 'react';
import ConfiguracoesContratacao from '../components/ConfiguracoesContratacao';
import ConfigWhatsApp from '../components/ConfigWhatsApp';
import type { Candidate, Company, Job, Settings, Stage } from '../shared';
import type { SecaoConfig } from '../navegacao';

interface Props {
  companies: Company[]; stages: Stage[]; settings: Settings; candidates: Candidate[];
  onReload: () => Promise<void>; onSettingsSaved: (s: Settings) => void; onRecalcCompany: (companyId: string) => Promise<void>;
  jobs: Job[]; onOpenCandidate: (id: string) => void;
  secaoInicial?: SecaoConfig | null; onSecaoInicialUsada?: () => void;
}

const ITENS_MENU: { id: SecaoConfig; label: string; icon: string }[] = [
  { id: 'empresas', label: 'Empresas', icon: 'ri-building-line' },
  { id: 'fases', label: 'Fases', icon: 'ri-layout-column-line' },
  { id: 'dados-minimos', label: 'Dados mínimos', icon: 'ri-file-list-3-line' },
  { id: 'entrevista', label: 'Entrevista', icon: 'ri-chat-voice-line' },
  { id: 'whatsapp', label: 'WhatsApp', icon: 'ri-whatsapp-line' },
];

export default function AreaConfiguracoes(props: Props) {
  const [secao, setSecao] = useState<SecaoConfig>('empresas');
  useEffect(() => {
    if (props.secaoInicial) { setSecao(props.secaoInicial); props.onSecaoInicialUsada?.(); }
  }, [props.secaoInicial]);
  return (
    <div className="flex flex-col sm:flex-row gap-5">
      <nav className="flex flex-row sm:flex-col gap-1 overflow-x-auto sm:overflow-visible sm:w-48 flex-shrink-0 border-b sm:border-b-0 sm:border-r border-zinc-200 pb-2 sm:pb-0 sm:pr-3">
        {ITENS_MENU.map((item) => (
          <button key={item.id} onClick={() => setSecao(item.id)}
            className={`flex items-center gap-2 px-3 h-10 border-l-2 -ml-px text-sm font-bold whitespace-nowrap cursor-pointer text-left flex-shrink-0 ${
              secao === item.id ? 'border-rose-600 text-rose-700 bg-rose-50/60' : 'border-transparent text-zinc-500 hover:text-zinc-800'}`}>
            <i className={item.icon} /> {item.label}
          </button>
        ))}
      </nav>
      <div className="flex-1 min-w-0">
        {secao === 'whatsapp' ? (
          <ConfigWhatsApp companies={props.companies} jobs={props.jobs} onOpenCandidate={props.onOpenCandidate} />
        ) : (
          <ConfiguracoesContratacao {...props} secao={secao} />
        )}
      </div>
    </div>
  );
}
