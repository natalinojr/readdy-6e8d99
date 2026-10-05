// Janela única de "Aprovar / Recusar" (2026-10-05): a mesma da tela Hoje, usada também em Pendências e
// Aprovações — mesmas palavras e a mesma checagem a mais antes de decidir (pedido do dono, 2026-10-03).
import { confirmar } from '@/components/base/Dialogos';

/** Pergunta "Aprovar este pedido?" / "Recusar este pedido?". Devolve true se a pessoa confirmou. */
export function confirmarDecisao(aprovar: boolean, mensagem: string): Promise<boolean> {
  return confirmar({
    titulo: aprovar ? 'Aprovar este pedido?' : 'Recusar este pedido?',
    mensagem,
    confirmarLabel: aprovar ? 'Sim, aprovar' : 'Sim, recusar',
    cancelarLabel: 'Voltar',
    perigo: !aprovar,
  });
}
