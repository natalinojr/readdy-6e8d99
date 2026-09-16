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
  { id: 'lancar-despesa', grupo: 'Financeiro', label: 'Lançar despesa', icone: 'ri-money-dollar-box-line', cor: 'bg-emerald-50 text-emerald-600', Componente: lazy(() => import('./financeiro/LancarDespesa')) },
  { id: 'contas-vencendo', grupo: 'Financeiro', label: 'Contas vencendo', icone: 'ri-calendar-todo-line', cor: 'bg-emerald-50 text-emerald-600', Componente: lazy(() => import('./financeiro/ContasVencendo')) },
  { id: 'classificar-dre', grupo: 'Financeiro', label: 'Classificar no DRE', icone: 'ri-price-tag-2-line', cor: 'bg-emerald-50 text-emerald-600', Componente: lazy(() => import('./financeiro/ClassificarDre')) },
  { id: 'saldo-extrato', grupo: 'Financeiro', label: 'Saldo e extrato', icone: 'ri-bank-line', cor: 'bg-emerald-50 text-emerald-600', Componente: lazy(() => import('./financeiro/SaldoExtrato')) },
  { id: 'atualizar-conciliacao', grupo: 'Financeiro', label: 'Atualizar conciliação', icone: 'ri-refresh-line', cor: 'bg-emerald-50 text-emerald-600', Componente: lazy(() => import('./financeiro/AtualizarConciliacao')) },
  { id: 'fechamento-dia', grupo: 'Financeiro', label: 'Fechamento do dia', icone: 'ri-scales-3-line', cor: 'bg-emerald-50 text-emerald-600', Componente: lazy(() => import('./financeiro/FechamentoDia')) },
  { id: 'vendas-dia', grupo: 'Operação', label: 'Vendas do dia', icone: 'ri-line-chart-line', cor: 'bg-orange-50 text-orange-600', Componente: lazy(() => import('./operacao/VendasDia')) },
  { id: 'pausar-item', grupo: 'Operação', label: 'Pausar/ativar item', icone: 'ri-pause-circle-line', cor: 'bg-orange-50 text-orange-600', Componente: lazy(() => import('./operacao/PausarItem')) },
  { id: 'pausar-delivery', grupo: 'Operação', label: 'Pausar delivery', icone: 'ri-motorbike-line', cor: 'bg-orange-50 text-orange-600', Componente: lazy(() => import('./operacao/PausarDelivery')) },
  { id: 'pedidos-atrasados', grupo: 'Operação', label: 'Pedidos atrasados', icone: 'ri-timer-flash-line', cor: 'bg-orange-50 text-orange-600', Componente: lazy(() => import('./operacao/PedidosAtrasados')) },
  { id: 'impressora-parada', grupo: 'Operação', label: 'Impressora parada', icone: 'ri-printer-line', cor: 'bg-orange-50 text-orange-600', Componente: lazy(() => import('./operacao/ImpressoraParada')) },
  { id: 'caixa-aberto', grupo: 'Operação', label: 'Caixa aberto', icone: 'ri-safe-2-line', cor: 'bg-orange-50 text-orange-600', Componente: lazy(() => import('./operacao/CaixaAberto')) },
  { id: 'confirmar-recebimento', grupo: 'Compras e estoque', label: 'Confirmar recebimento', icone: 'ri-truck-line', cor: 'bg-amber-50 text-amber-600', Componente: lazy(() => import('./estoque/ConfirmarRecebimento')) },
  { id: 'registrar-perda', grupo: 'Compras e estoque', label: 'Registrar perda', icone: 'ri-delete-bin-6-line', cor: 'bg-amber-50 text-amber-600', Componente: lazy(() => import('./estoque/RegistrarPerda')) },
  { id: 'contagem-rapida', grupo: 'Compras e estoque', label: 'Contagem rápida', icone: 'ri-list-check-3', cor: 'bg-amber-50 text-amber-600', Componente: lazy(() => import('./estoque/ContagemRapida')) },
  { id: 'estoque-critico', grupo: 'Compras e estoque', label: 'Estoque crítico', icone: 'ri-alarm-warning-line', cor: 'bg-amber-50 text-amber-600', Componente: lazy(() => import('./estoque/EstoqueCritico')) },
  { id: 'cadastrar-insumo', grupo: 'Compras e estoque', label: 'Cadastrar insumo', icone: 'ri-add-box-line', cor: 'bg-amber-50 text-amber-600', Componente: lazy(() => import('./estoque/CadastrarInsumo')) },
  { id: 'registrar-producao', grupo: 'Compras e estoque', label: 'Registrar produção', icone: 'ri-restaurant-2-line', cor: 'bg-amber-50 text-amber-600', Componente: lazy(() => import('./estoque/RegistrarProducao')) },
  { id: 'enviar-voucher', grupo: 'Clientes e marketing', label: 'Enviar voucher', icone: 'ri-coupon-3-line', cor: 'bg-pink-50 text-pink-600', Componente: lazy(() => import('./marketing/EnviarVoucher')) },
  { id: 'promocoes', grupo: 'Clientes e marketing', label: 'Promoções ativas', icone: 'ri-price-tag-3-line', cor: 'bg-pink-50 text-pink-600', Componente: lazy(() => import('./marketing/PromocaoRapida')) },
  { id: 'trafego', grupo: 'Clientes e marketing', label: 'Tráfego pago', icone: 'ri-megaphone-line', cor: 'bg-pink-50 text-pink-600', Componente: lazy(() => import('./marketing/TrafegoResumo')) },
  { id: 'trafego-sugestoes', grupo: 'Clientes e marketing', label: 'Sugestões do tráfego', icone: 'ri-lightbulb-flash-line', cor: 'bg-pink-50 text-pink-600', Componente: lazy(() => import('./marketing/AprovarSugestoesTrafego')) },
  { id: 'entrevistas-hoje', grupo: 'Pessoas', label: 'Entrevistas de hoje', icone: 'ri-calendar-check-line', cor: 'bg-rose-50 text-rose-600', Componente: lazy(() => import('./pessoas/EntrevistasHoje')) },
  { id: 'mover-candidato', grupo: 'Pessoas', label: 'Mover candidato', icone: 'ri-user-shared-line', cor: 'bg-rose-50 text-rose-600', Componente: lazy(() => import('./pessoas/MoverCandidato')) },
  { id: 'dias-freelancer', grupo: 'Pessoas', label: 'Dias de freelancer', icone: 'ri-user-star-line', cor: 'bg-rose-50 text-rose-600', Componente: lazy(() => import('./pessoas/DiasFreelancer')) },
  { id: 'nova-tarefa', grupo: 'Pessoal', label: 'Nova tarefa', icone: 'ri-task-line', cor: 'bg-indigo-50 text-indigo-600', Componente: lazy(() => import('./pessoal/NovaTarefa')) },
  { id: 'tarefas-hoje', grupo: 'Pessoal', label: 'Minhas tarefas de hoje', icone: 'ri-checkbox-circle-line', cor: 'bg-indigo-50 text-indigo-600', Componente: lazy(() => import('./pessoal/TarefasHoje')) },
  { id: 'clima', grupo: 'Pessoal', label: 'Previsão do tempo', icone: 'ri-sun-cloudy-line', cor: 'bg-amber-50 text-amber-600', Componente: lazy(() => import('./pessoal/Clima')) },
];
