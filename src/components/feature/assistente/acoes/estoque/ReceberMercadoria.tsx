// Ação rápida: "Receber mercadoria" só ABRE o módulo /receber (dono, 2026-09-24). Substituiu o antigo
// "Confirmar recebimento", que refazia no chat só o caso "chegou tudo" pelo Financeiro › Compras.
// O /receber já cobre nota recebida, entrega sem nota, pagamento em dinheiro (sangria) e quantidade
// diferente — ter dois caminhos para a mesma entrada de estoque era pedir divergência.
import { useEffect, useRef } from 'react';
import type { AcaoProps } from '../kit';

export default function ReceberMercadoria({ irPara }: AcaoProps) {
  const foi = useRef(false);
  useEffect(() => {
    if (foi.current) return;
    foi.current = true;
    irPara('/receber');
  }, [irPara]);
  return null;
}
