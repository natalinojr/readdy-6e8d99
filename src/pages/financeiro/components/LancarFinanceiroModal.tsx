/**
 * "Lançar" do Financeiro (2026-09-30): todos os jeitos de lançar que já existem, num lugar só.
 * Não tem formulário próprio — cada opção abre a mesma tela de hoje (e, onde a aba aceita
 * ?abrir=, já com a janela de lançamento aberta). Só aparecem as opções das abas liberadas.
 */
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

interface Opcao { icone: string; titulo: string; detalhe: string; aba?: string; abrir?: string; rota?: string; onde: string }
const GRUPOS: { titulo: string; opcoes: Opcao[] }[] = [
  {
    titulo: 'Chegou nota, cupom ou boleto',
    opcoes: [
      { icone: 'ri-camera-line', titulo: 'Ler nota ou cupom', detalhe: 'QR da NFC-e, foto ou arquivo', aba: 'compras', abrir: 'nova', onde: 'Compras › Nova compra' },
      { icone: 'ri-inbox-archive-line', titulo: 'Notas que chegaram pela SEFAZ', detalhe: 'conferir e lançar', aba: 'notas-entrada', onde: 'Notas de Entrada' },
      { icone: 'ri-mail-download-line', titulo: 'Boletos que chegaram por e-mail', detalhe: 'caixa de boletos', aba: 'pagar', abrir: 'email', onde: 'Contas a Pagar › E-mail' },
    ],
  },
  {
    titulo: 'Tenho que pagar',
    opcoes: [
      { icone: 'ri-bill-line', titulo: 'Nova conta a pagar', detalhe: 'fornecedor, aluguel, serviço', aba: 'pagar', abrir: 'nova', onde: 'Contas a Pagar › Nova Conta' },
      { icone: 'ri-file-upload-line', titulo: 'Guia de imposto', detalhe: 'PDF de DAS, DARF ou FGTS', aba: 'guias', onde: 'Guias e impostos' },
      { icone: 'ri-team-line', titulo: 'Folha, freela ou prestador', detalhe: 'salário, diária, MEI', aba: 'rh', onde: 'RH / Folha' },
      { icone: 'ri-e-bike-2-line', titulo: 'Acerto de entregador', detalhe: 'motoboys do período', aba: 'entregadores', onde: 'Entregadores' },
      { icone: 'ri-hand-coin-line', titulo: 'Pedir para pagar', detalhe: 'reembolso, freela, fornecedor sem nota', rota: '/receber', onde: 'Recebimentos e pagamentos' },
    ],
  },
  {
    titulo: 'Mexeu no dinheiro',
    opcoes: [
      { icone: 'ri-bank-line', titulo: 'Explicar uma saída do extrato', detalhe: 'Pix ou pagamento que ninguém lançou', aba: 'conciliacao', onde: 'Conciliação' },
      { icone: 'ri-exchange-dollar-line', titulo: 'Nova movimentação', detalhe: 'entrada ou saída avulsa', aba: 'fluxo', onde: 'Fluxo de Caixa' },
      { icone: 'ri-bank-card-line', titulo: 'Lançamento manual no banco', detalhe: 'ajuste de saldo de uma conta', aba: 'bancos', onde: 'Bancos e Contas' },
    ],
  },
  {
    titulo: 'Vou comprar',
    opcoes: [
      { icone: 'ri-shopping-cart-2-line', titulo: 'Nova compra digitada', detalhe: 'sem nota ainda', aba: 'compras', abrir: 'nova', onde: 'Compras › Nova compra' },
      { icone: 'ri-file-list-3-line', titulo: 'Orçamento', detalhe: 'cotação antes de comprar', aba: 'orcamentos', onde: 'Orçamentos' },
    ],
  },
];

export default function LancarFinanceiroModal({ podeAba, onIr, onClose }: {
  podeAba: (aba: string) => boolean;
  onIr: (aba: string, abrir?: string) => void;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);
  const grupos = GRUPOS
    .map((g) => ({ ...g, opcoes: g.opcoes.filter((o) => (o.aba ? podeAba(o.aba) : true)) }))
    .filter((g) => g.opcoes.length > 0);
  const escolher = (o: Opcao) => {
    onClose();
    if (o.rota) navigate(o.rota);
    else if (o.aba) onIr(o.aba, o.abrir);
  };
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center p-4 pt-10 md:pt-16" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[85vh] overflow-y-auto">
        <div className="flex items-center gap-3 px-5 py-4 border-b border-zinc-100">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)' }}>
            <i className="ri-add-line text-white text-lg" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-bold text-zinc-800">Lançar no financeiro</h3>
            <p className="text-xs text-zinc-400">Todos os jeitos de lançar, num lugar só. Cada um abre a tela de sempre.</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg hover:bg-zinc-100 text-zinc-500 cursor-pointer"><i className="ri-close-line text-lg" /></button>
        </div>
        <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-5">
          {grupos.map((g) => (
            <div key={g.titulo}>
              <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-400 mb-2">{g.titulo}</p>
              <div className="flex flex-col gap-1.5">
                {g.opcoes.map((o) => (
                  <button key={o.titulo} onClick={() => escolher(o)} className="text-left flex items-center gap-3 rounded-xl border border-zinc-200 px-3 py-2.5 hover:border-amber-400 hover:bg-amber-50/50 transition-all cursor-pointer">
                    <span className="w-8 h-8 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center flex-shrink-0"><i className={o.icone} /></span>
                    <span className="flex-1 min-w-0">
                      <b className="block text-sm text-zinc-800">{o.titulo}</b>
                      <span className="text-[11px] text-zinc-400">{o.detalhe}</span>
                    </span>
                    <span className="text-[10px] text-zinc-400 text-right hidden sm:block">{o.onde}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
