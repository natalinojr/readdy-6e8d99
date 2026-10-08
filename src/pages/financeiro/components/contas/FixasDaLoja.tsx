// Contas fixas dentro de Financeiro › Contas (2026-10-08): a mesma visão que era da aba Pagamentos
// (fn_contas_fixas + FixasView), agora aberta pelo botão "Contas fixas" — a aba Pagamentos saiu.
import { useCallback, useEffect, useState } from 'react';
import { todayBrasilia } from '@/lib/dateUtils';
import type { ContaFixa } from '@/lib/pagamentos';
import { carregarFixas } from '../pagamentos/api';
import FixasView from '../pagamentos/FixasView';

export default function FixasDaLoja({ tenantId, dono, financeiro }: { tenantId: string; dono: boolean; financeiro: boolean }) {
  const mesAtual = `${todayBrasilia().slice(0, 7)}-01`;
  const [mes, setMes] = useState(mesAtual);
  const [itens, setItens] = useState<ContaFixa[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const carregar = useCallback(() => {
    setCarregando(true);
    carregarFixas([tenantId], mes)
      .then((l) => { setItens(l); setErro(null); })
      .catch((e: Error) => setErro(e.message))
      .finally(() => setCarregando(false));
  }, [tenantId, mes]);
  useEffect(() => { carregar(); }, [carregar]);
  return (
    <>
      {erro && <div className="mb-3 rounded-xl bg-red-50 text-red-700 text-sm px-3 py-2">Não consegui carregar as contas fixas: {erro}</div>}
      <FixasView itens={itens} carregando={carregando} tenantUnico={tenantId} mostrarLoja={false} mes={mes} mesAtual={mesAtual}
        onMes={setMes} dono={dono} financeiro={financeiro} onMudou={carregar} atrasadas={[]} />
    </>
  );
}
