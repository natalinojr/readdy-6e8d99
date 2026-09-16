// Registro das AÇÕES RÁPIDAS do chat do assistente (roteiros fixos, sem IA). Cada ação é um
// componente carregado sob demanda; o menu do chat agrupa por `grupo`. Para criar uma nova, veja
// as regras no topo de ./kit.tsx e acrescente aqui.
import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import type { AcaoProps } from './kit';

export interface AcaoDef {
  id: string;
  grupo: string;
  label: string;
  icone: string;
  cor: string;
  Componente: LazyExoticComponent<ComponentType<AcaoProps>>;
}

export const GRUPOS = ['Atalhos', 'Financeiro', 'Operação', 'Compras e estoque', 'Clientes e marketing', 'Pessoas', 'Pessoal'] as const;

const NfseAdaptada = lazy(async () => {
  const m = await import('../AcaoEmitirNfse');
  const C = m.default;
  return { default: (p: AcaoProps) => <C onFechar={p.onFechar} onAbrirNotas={() => p.irPara('/notas-servico')} /> };
});

export const ACOES: AcaoDef[] = [
  { id: 'atalhos', grupo: 'Atalhos', label: 'Ir para uma tela', icone: 'ri-compass-3-line', cor: 'bg-violet-50 text-violet-600', Componente: lazy(() => import('./atalhos/AtalhosTelas')) },
  { id: 'nfse', grupo: 'Financeiro', label: 'Emitir nota de serviço', icone: 'ri-file-text-line', cor: 'bg-sky-50 text-sky-600', Componente: NfseAdaptada },
  { id: 'nova-tarefa', grupo: 'Pessoal', label: 'Nova tarefa', icone: 'ri-task-line', cor: 'bg-indigo-50 text-indigo-600', Componente: lazy(() => import('./pessoal/NovaTarefa')) },
  { id: 'tarefas-hoje', grupo: 'Pessoal', label: 'Minhas tarefas de hoje', icone: 'ri-checkbox-circle-line', cor: 'bg-indigo-50 text-indigo-600', Componente: lazy(() => import('./pessoal/TarefasHoje')) },
  { id: 'clima', grupo: 'Pessoal', label: 'Previsão do tempo', icone: 'ri-sun-cloudy-line', cor: 'bg-amber-50 text-amber-600', Componente: lazy(() => import('./pessoal/Clima')) },
];
