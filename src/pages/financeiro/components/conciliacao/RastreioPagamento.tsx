// Rastreio do pagamento conciliado (2026-09-20)
// "Este pagamento virou o quê?": mostra a corrente inteira — nota fiscal de entrada, compra,
// conta a pagar baixada, juros e folha — com atalho para a tela de cada uma.
// Os dados vêm da edge (conciliacao-pagamentos › trace), com service role: leitura direta do
// front quebra para admin de várias lojas (auth_tenant_id = última membership).
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { invokeWithAuth } from '@/lib/supabase';
import { formatCurrency } from '@/lib/formatters';

interface Conta {
  id: string;
  description: string | null;
  supplier: string | null;
  amount: number;
  paid_amount: number | null;
  paid_date: string | null;
  due_date: string | null;
  status: string;
  category: string | null;
  competence_month: string | null;
  installment_number: number | null;
  installments: number | null;
  reference_type: string | null;
  payment_method: string | null;
}
interface Compra { id: string; supplier: string | null; invoice_number: string | null; total_amount: number; purchase_date: string | null; payment_status: string | null }
interface Nota {
  id: string; numero: number | string | null; serie: number | string | null; modelo: number | null; chave: string | null;
  emitente_nome: string | null; emitente_cnpj: string | null; valor_total: number; emitted_at: string | null;
  status: string; auto_imported: boolean | null;
}
interface Folha { id: string; employee_name: string | null; reference_month: string | null; net_salary: number; status: string; paid_date: string | null }
interface Movimento { origem: string; descricao: string | null; data: string | null; valor: number; tipo: string | null; categoria?: string | null }
interface Trace {
  pagamento: { confirmado_em: string | null; confirmado_por: string | null; origem: string };
  conta: Conta | null;
  juros: Conta | null;
  compra: Compra | null;
  nota: Nota | null;
  folha: Folha | null;
  movimento: Movimento | null;
  nota_do_mes: boolean;
}

const dia = (d: string | null | undefined) => (d ? new Date(String(d).slice(0, 10) + 'T00:00:00').toLocaleDateString('pt-BR') : '—');
const quando = (d: string | null | undefined) => (d ? new Date(d).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : null);
const competencia = (d: string | null | undefined) => (d ? String(d).slice(5, 7) + '/' + String(d).slice(0, 4) : null);
const mesAno = (m: string | null | undefined) => (m && m.length >= 7 ? m.slice(5, 7) + '/' + m.slice(0, 4) : m ?? '');

// De onde veio a conta a pagar (fin_accounts_payable.reference_type)
const ORIGEM: Record<string, string> = {
  purchase: 'gerada pela compra',
  freelancer: 'diárias de freelancer',
  hr_payroll: 'encargo da folha',
  conciliacao_extrato: 'lançada pelo extrato',
  conciliacao_juros: 'juros da conciliação',
};

/** Mostra a rastreabilidade de uma linha do extrato já conciliada. */
export default function RastreioPagamento({ transactionId }: { transactionId: string }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [trace, setTrace] = useState<Trace | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    let vivo = true;
    setTrace(null);
    setErro(null);
    setCarregando(true);
    invokeWithAuth<{ success?: boolean; error?: string } & Trace>('conciliacao-pagamentos', {
      body: { action: 'trace', tenant_id: user?.tenantId, id: transactionId },
    }).then((r) => {
      if (!vivo) return;
      setCarregando(false);
      if (r.data?.success) setTrace(r.data as Trace);
      else setErro(r.data?.error ?? r.error?.message ?? 'Não foi possível carregar o rastreio');
    });
    return () => { vivo = false; };
  }, [transactionId, user?.tenantId]);

  if (carregando) return <div className="border border-zinc-200 rounded-xl p-3 text-xs text-zinc-500">Carregando o rastreio...</div>;
  if (erro) return <div className="border border-zinc-200 rounded-xl p-3 text-xs text-zinc-500">{erro}</div>;
  if (!trace) return null;

  const { conta, juros, compra, nota, folha, movimento } = trace;
  if (!conta && !compra && !nota && !folha && !movimento) return null;

  const pago = Number(conta?.paid_amount ?? 0);
  const parcela = conta?.installment_number && Number(conta.installments ?? 0) > 1
    ? `parcela ${conta.installment_number}/${conta.installments}`
    : null;
  // Cai no registro certo, não só na aba: Compras tem destaque por id (?foco=), Notas de Entrada e
  // Contas a Pagar filtram pela busca da própria tela (?busca=).
  const ir = (tab: string, param?: string, valor?: string | null) =>
    navigate('/financeiro?tab=' + tab + (param && valor ? '&' + param + '=' + encodeURIComponent(valor) : ''));

  const Linha = ({ icone, titulo, tab, botao, param, valor, children }: {
    icone: string; titulo: string; tab: string; botao: string;
    param?: string; valor?: string | null; children: React.ReactNode;
  }) => (
    <div className="flex items-start justify-between gap-3 py-2 border-t border-zinc-200 first:border-t-0 first:pt-0">
      <div className="min-w-0">
        <p className="font-semibold text-zinc-800"><i className={icone + ' mr-1 text-zinc-400'} />{titulo}</p>
        <div className="text-zinc-600 space-y-0.5">{children}</div>
      </div>
      <button onClick={() => ir(tab, param, valor)} className="shrink-0 px-2 py-1 bg-white border border-zinc-300 rounded-lg text-zinc-700 hover:bg-zinc-50 cursor-pointer whitespace-nowrap">
        {botao} <i className="ri-arrow-right-up-line" />
      </button>
    </div>
  );

  return (
    <div className="border border-zinc-200 bg-white rounded-xl p-3 text-xs">
      <p className="font-semibold text-zinc-800 mb-2"><i className="ri-node-tree mr-1" />Rastreamento</p>

      {nota && (
        <Linha icone="ri-file-text-line" titulo={`Nota fiscal ${Number(nota.modelo) === 10 ? 'de serviço' : 'de entrada'} nº ${nota.numero ?? '?'}${nota.serie ? '/' + nota.serie : ''}`} tab="notas-entrada" botao="Notas de entrada" param="busca" valor={String(nota.numero ?? nota.emitente_nome ?? '')}>
          <p>{nota.emitente_nome ?? '—'}</p>
          <p>
            Emitida em {dia(nota.emitted_at)} · {formatCurrency(Number(nota.valor_total))}
            {nota.status === 'imported' ? ' · lançada' : nota.status === 'new' ? ' · ainda não lançada' : ' · ' + nota.status}
            {nota.auto_imported ? ' (importada pela conciliação)' : ''}
          </p>
          {trace.nota_do_mes && <p className="text-blue-700">Nota do mês: cobre vários pagamentos deste extrato.</p>}
          {nota.chave && <p className="text-zinc-400 break-all">{nota.chave}</p>}
        </Linha>
      )}

      {compra && (
        <Linha icone="ri-shopping-cart-2-line" titulo="Compra" tab="compras" botao="Compras" param="foco" valor={compra.id}>
          <p>{compra.supplier ?? '—'}{compra.invoice_number ? ' · NF ' + compra.invoice_number : ''}</p>
          <p>{dia(compra.purchase_date)} · {formatCurrency(Number(compra.total_amount))} · entra no CMV</p>
        </Linha>
      )}

      {conta && (
        <Linha icone="ri-bill-line" titulo="Conta a pagar" tab="pagar" botao="Contas a pagar" param="busca" valor={conta.description}>
          <p>{conta.description ?? '—'}{parcela ? ' · ' + parcela : ''}</p>
          <p>
            Vence {dia(conta.due_date)} · {formatCurrency(Number(conta.amount))}
            {conta.paid_date ? ` · baixada em ${dia(conta.paid_date)}` : ' · em aberto'}
            {pago > 0 && Math.abs(pago - Number(conta.amount)) > 0.005 ? ` (pago ${formatCurrency(pago)})` : ''}
          </p>
          <p className="text-zinc-500">
            {conta.category ? 'Classificação: ' + conta.category : 'Sem classificação'}
            {competencia(conta.competence_month) ? ' · competência ' + competencia(conta.competence_month) : ''}
            {ORIGEM[String(conta.reference_type)] ? ' · ' + ORIGEM[String(conta.reference_type)] : ''}
            {movimento ? ' · casada pelo movimento do ERP' : ''}
          </p>
        </Linha>
      )}

      {juros && (
        <Linha icone="ri-error-warning-line" titulo="Juros/multa" tab="pagar" botao="Contas a pagar" param="busca" valor={juros.description}>
          <p>{juros.description ?? '—'}</p>
          <p>{formatCurrency(Number(juros.amount))}{juros.paid_date ? ` · baixada em ${dia(juros.paid_date)}` : ''} · despesa "Juros e multas"</p>
        </Linha>
      )}

      {folha && (
        <Linha icone="ri-team-line" titulo="Folha de pagamento" tab="rh" botao="RH">
          <p>{folha.employee_name ?? '—'} · competência {mesAno(folha.reference_month)}</p>
          <p>
            Líquido {formatCurrency(Number(folha.net_salary))}
            {folha.status === 'paid' ? ` · paga em ${dia(folha.paid_date)}` : ' · ' + folha.status}
            {' '}· a DRE conta pela folha, não como despesa deste pagamento
          </p>
        </Linha>
      )}

      {movimento && !conta && (
        <div className="py-2 border-t border-zinc-200 first:border-t-0 first:pt-0">
          <p className="font-semibold text-zinc-800"><i className="ri-links-line mr-1 text-zinc-400" />Movimento do ERP</p>
          <p className="text-zinc-600">{movimento.descricao ?? '—'}</p>
          <p className="text-zinc-500">
            Casado automaticamente com este movimento do sistema
            {movimento.data ? ' de ' + dia(movimento.data) : ''}
            {movimento.categoria ? ' · ' + movimento.categoria : ''}. A conta de origem não pôde ser identificada.
          </p>
        </div>
      )}

      {(trace.pagamento.confirmado_em || trace.pagamento.confirmado_por) && (
        <p className="text-zinc-400 mt-2 pt-2 border-t border-zinc-200">
          Conciliado{trace.pagamento.confirmado_por ? ' por ' + trace.pagamento.confirmado_por : ''}
          {quando(trace.pagamento.confirmado_em) ? ' em ' + quando(trace.pagamento.confirmado_em) : ''}
        </p>
      )}
    </div>
  );
}
