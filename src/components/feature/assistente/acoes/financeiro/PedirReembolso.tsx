// Ação rápida "Pedir reembolso" (2026-09-24): abre o pedido de reembolso no módulo Recebimentos e
// pagamentos (/receber). Lá a pessoa escolhe se foi mercadoria (entra pelo recebimento, no CMV) ou
// outra despesa (pedido com comprovante, Pix e classificação). O dono aprova antes de virar conta.
import { useEffect, useRef } from 'react';
import type { AcaoProps } from '../kit';

export default function PedirReembolso({ irPara }: AcaoProps) {
  const foi = useRef(false);
  useEffect(() => {
    if (foi.current) return;
    foi.current = true;
    irPara('/receber?pedido=reembolso');
  }, [irPara]);
  return null;
}
