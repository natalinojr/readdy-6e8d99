// Ação rápida: atalhos que levam direto a uma tela/aba do ERPOS (sem IA, sem gravar nada).
// Rotas conferidas no código em 2026-09-16:
// - /financeiro?tab=<id>  → src/pages/financeiro/page.tsx (lê searchParams 'tab'; ids de TABS)
// - /estoque?tab=<id>     → src/pages/estoque/page.tsx (VALID_TABS)
// - /pedidos, /relatorios, /cardapio, /trafego-pago, /tarefas, /contratacao, /notas-servico → src/router
//   (Relatórios e Cardápio guardam a aba só em useState: não abrem aba por URL.)
import { useEffect } from 'react';
import { Roteiro, useRoteiro, Opcao, OpcaoNeutra, type AcaoProps } from '../kit';
import { rotaLiberada, useAcessoAcoes } from '../acesso';

type Atalho = { label: string; rota: string; detalhe?: string };

const GRUPOS_ATALHOS: { titulo: string; itens: Atalho[] }[] = [
  {
    titulo: 'Financeiro',
    itens: [
      // CMV = compras realizadas (regra do dono): é a linha CMV da DRE.
      { label: 'CMV do mês', rota: '/financeiro?tab=dre', detalhe: '(linha CMV na DRE)' },
      { label: 'DRE', rota: '/financeiro?tab=dre' },
      { label: 'Contas a pagar', rota: '/financeiro?tab=pagar' },
      { label: 'Compras', rota: '/financeiro?tab=compras' },
      { label: 'Conciliação', rota: '/financeiro?tab=conciliacao', detalhe: '(Stone / Inter)' },
      { label: 'iFood', rota: '/financeiro?tab=ifood' },
      { label: 'Notas de entrada', rota: '/financeiro?tab=notas-entrada' },
      { label: 'Notas de serviço', rota: '/notas-servico' },
    ],
  },
  {
    titulo: 'Operação',
    itens: [
      { label: 'Estoque', rota: '/estoque?tab=insumos' },
      { label: 'CMV das fichas', rota: '/estoque?tab=cmv', detalhe: '(Estoque › CMV / Fichas)' },
      { label: 'Cardápio', rota: '/cardapio' },
      { label: 'Pedidos', rota: '/pedidos' },
      { label: 'Relatórios', rota: '/relatorios', detalhe: '(abas dentro da tela)' },
    ],
  },
  {
    titulo: 'Outros',
    itens: [
      { label: 'Tráfego pago', rota: '/trafego-pago' },
      { label: 'Tarefas', rota: '/tarefas' },
      { label: 'Pendências', rota: '/pendencias' },
      { label: 'Contratação', rota: '/contratacao' },
    ],
  },
];

export default function AtalhosTelas({ onFechar, irPara }: AcaoProps) {
  const r = useRoteiro();
  // Só as telas que o acesso do usuário abre (2026-09-23: ações rápidas para todos).
  const acesso = useAcessoAcoes();
  const grupos = GRUPOS_ATALHOS
    .map((g) => ({ ...g, itens: g.itens.filter((a) => rotaLiberada(a.rota, acesso)) }))
    .filter((g) => g.itens.length);

  useEffect(() => {
    r.bot('Para qual tela?');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Roteiro titulo="Ir para uma tela" icone="ri-compass-3-line" baloes={r.baloes} onFechar={onFechar}>
      {grupos.map((g) => (
        <div key={g.titulo} className="space-y-1.5">
          <p className="px-1 pt-1 text-[11px] font-bold uppercase tracking-wide text-zinc-400">{g.titulo}</p>
          {g.itens.map((a) => (
            <Opcao key={`${g.titulo}-${a.label}`} onClick={() => irPara(a.rota)} detalhe={a.detalhe}>{a.label}</Opcao>
          ))}
        </div>
      ))}
      <OpcaoNeutra onClick={onFechar}>Fechar</OpcaoNeutra>
    </Roteiro>
  );
}
