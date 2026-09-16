// Ação rápida: contas a pagar vencidas, de hoje e dos próximos 7 dias, com baixa manual — sem IA.
// Leitura igual a Financeiro › Contas Vencidas (fin_accounts_payable, status overdue/pending/partial).
// Baixa pela Edge financial-write › pay_bill, igual ao modal "Registrar pagamento" (com a classificação
// DRE junto quando a conta não tem; compra e folha não precisam). NÃO paga nada no banco (Pix/boleto Inter).
import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { Roteiro, useRoteiro, Opcao, OpcaoNeutra, Campo, EscolhaData, Fim, brl, dataBR, hojeISO, somaDias, lerNumero, type AcaoProps } from '../kit';
import { carregarOpcoesDre, dreParaPayBill, finWrite, FORMAS_PAGAMENTO, type DreEscolha, type DreGrupoOpcoes } from './comum';
import EscolhaDre from './EscolhaDre';

interface Conta {
  id: string; description: string; supplier: string | null; category: string | null;
  amount: number; paid_amount: number | null; due_date: string; status: string;
  dre_category_id: string | null; reference_type: string | null;
}
type Passo = 'carregando' | 'lista' | 'detalhe' | 'data' | 'valor' | 'forma' | 'dre' | 'confirmar' | 'gravando' | 'fim';

const saldo = (c: Conta) => Math.max(0, Math.round((Number(c.amount ?? 0) - Number(c.paid_amount ?? 0)) * 100) / 100);
/** Mesma regra do DreClassificacaoSelect.precisaClassificarDRE / pay_bill. */
const precisaDre = (c: Conta) => !c.dre_category_id && !['purchase', 'hr_payroll'].includes(String(c.reference_type ?? ''));

export default function ContasVencendo({ onFechar, irPara }: AcaoProps) {
  const { user } = useAuth();
  const tenantId = user?.tenantId ?? '';
  const { baloes, bot, eu } = useRoteiro();
  const [passo, setPasso] = useState<Passo>('carregando');
  const [contas, setContas] = useState<Conta[]>([]);
  const [conta, setConta] = useState<Conta | null>(null);
  const [grupos, setGrupos] = useState<DreGrupoOpcoes[]>([]);
  const [pagData, setPagData] = useState(hojeISO());
  const [pagValor, setPagValor] = useState(0);
  const [pagForma, setPagForma] = useState('');
  const [pagDre, setPagDre] = useState<DreEscolha | null>(null);
  const travado = useRef(false);

  const carregar = async (primeira: boolean) => {
    setPasso('carregando');
    const hoje = hojeISO();
    const { data, error } = await supabase.from('fin_accounts_payable')
      .select('id, description, supplier, category, amount, paid_amount, due_date, status, dre_category_id, reference_type')
      .eq('tenant_id', tenantId)
      .in('status', ['overdue', 'pending', 'partial'])
      .lte('due_date', somaDias(hoje, 7))
      .order('due_date', { ascending: true })
      .limit(500);
    if (error) { bot(`Não consegui ler as contas: ${error.message}`); setPasso('fim'); return; }
    const lista = ((data ?? []) as Conta[]).filter((c) => saldo(c) > 0.005);
    setContas(lista);
    const venc = lista.filter((c) => c.due_date < hoje);
    const hj = lista.filter((c) => c.due_date === hoje);
    const prox = lista.filter((c) => c.due_date > hoje);
    const soma = (l: Conta[]) => brl(l.reduce((s, c) => s + saldo(c), 0));
    if (!lista.length) {
      bot(`${primeira ? `Loja: *${user?.loja || 'loja ativa'}*\n` : ''}Nenhuma conta vencida nem vencendo nos próximos 7 dias.`);
      setPasso('fim');
      return;
    }
    bot([
      primeira ? `Loja: *${user?.loja || 'loja ativa'}*` : '*Atualizado:*',
      `Vencidas: ${venc.length} · ${soma(venc)}`,
      `Hoje: ${hj.length} · ${soma(hj)}`,
      `Próximos 7 dias: ${prox.length} · ${soma(prox)}`,
      'Toque numa conta para ver ou dar baixa.',
    ].join('\n'));
    setPasso('lista');
  };

  useEffect(() => {
    if (!tenantId) { bot('Nenhuma loja ativa.'); setPasso('fim'); return; }
    carregar(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const abrir = (c: Conta) => {
    eu(c.description);
    setConta(c);
    const pago = Number(c.paid_amount ?? 0);
    bot([
      `*${c.description}*`,
      c.supplier ? `Fornecedor: ${c.supplier}` : '',
      `Vence: ${dataBR(c.due_date)}${c.due_date < hojeISO() ? ' (vencida)' : ''}`,
      `Valor: ${brl(c.amount)}${pago > 0 ? ` · já pago ${brl(pago)} · falta ${brl(saldo(c))}` : ''}`,
      `DRE: ${c.dre_category_id ? 'classificada' : precisaDre(c) ? 'sem classificação' : 'não precisa (compra/folha)'}`,
    ].filter(Boolean).join('\n'));
    setPasso('detalhe');
  };

  const iniciarBaixa = () => {
    eu('Marcar como paga');
    setPagDre(null);
    bot('Data do pagamento?');
    setPasso('data');
  };

  const escolherData = (iso: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso) || iso > hojeISO()) { bot('Data inválida (não pode ser futura).'); return; }
    eu(dataBR(iso));
    setPagData(iso);
    bot(`Valor pago? (falta ${brl(saldo(conta!))})`);
    setPasso('valor');
  };

  const escolherValor = (v: number) => {
    const r = Math.round(v * 100) / 100;
    if (!(r > 0)) { bot('Valor inválido.'); return; }
    if (r > saldo(conta!) + 0.005) { bot(`O valor passa do que falta (${brl(saldo(conta!))}).`); return; }
    eu(brl(r));
    setPagValor(r);
    bot('Forma de pagamento?');
    setPasso('forma');
  };

  const escolherForma = async (f: string) => {
    eu(f);
    setPagForma(f);
    if (precisaDre(conta!)) {
      if (!grupos.length) {
        const r = await carregarOpcoesDre(tenantId);
        if (r.error || !r.grupos.length) { bot(`Não consegui ler as categorias do DRE${r.error ? `: ${r.error}` : ''}. Dê baixa pela tela.`); setPasso('fim'); return; }
        setGrupos(r.grupos);
      }
      bot('A conta não tem classificação no DRE (sem ela não dá baixa). Qual é?');
      setPasso('dre');
      return;
    }
    resumo(f, null);
  };

  const resumo = (forma: string, dre: DreEscolha | null) => {
    const c = conta!;
    bot([
      '*Confere a baixa:*',
      c.description,
      `Pago: ${brl(pagValor)} em ${dataBR(pagData)} · ${forma}`,
      pagValor < saldo(c) - 0.005 ? `Pagamento parcial: continua faltando ${brl(saldo(c) - pagValor)}` : 'Quita a conta',
      dre ? `DRE: ${dre.label}` : '',
      'Só registra no sistema: não faz pagamento no banco.',
    ].filter(Boolean).join('\n'));
    setPasso('confirmar');
  };

  const gravar = async () => {
    if (travado.current) return;
    travado.current = true;
    eu('Confirmar baixa');
    setPasso('gravando');
    const c = conta!;
    const r = await finWrite('pay_bill', tenantId, {
      id: c.id, paid_date: pagData, paid_amount: pagValor, payment_method: pagForma,
      ...(precisaDre(c) && pagDre ? dreParaPayBill(pagDre) : {}),
    });
    travado.current = false;
    if (r.error) { bot(`❌ Baixa não registrada: ${r.error}`); setPasso('detalhe'); return; }
    bot(`✅ Baixa registrada: ${c.description} · ${brl(pagValor)} · ${dataBR(pagData)}`);
    await carregar(false);
  };

  const hoje = hojeISO();
  const grupoLista = (titulo: string, l: Conta[]) => l.length ? (
    <>
      <p className="text-[11px] font-bold text-zinc-400 uppercase px-1 pt-1">{titulo}</p>
      {l.map((c) => (
        <Opcao key={c.id} onClick={() => abrir(c)} perigo={c.due_date < hoje} detalhe={`${brl(saldo(c))} · ${dataBR(c.due_date).slice(0, 5)}`}>{c.description}</Opcao>
      ))}
    </>
  ) : null;

  return (
    <Roteiro titulo="Contas vencendo" icone="ri-alarm-warning-line" cor="bg-amber-50 text-amber-600" baloes={baloes}
      carregando={passo === 'carregando' || passo === 'gravando'} textoCarregando={passo === 'gravando' ? 'Registrando…' : undefined}
      onFechar={onFechar} travarFechar={passo === 'gravando'}>
      {passo === 'lista' && (
        <>
          {grupoLista('Vencidas', contas.filter((c) => c.due_date < hoje))}
          {grupoLista('Hoje', contas.filter((c) => c.due_date === hoje))}
          {grupoLista('Próximos 7 dias', contas.filter((c) => c.due_date > hoje))}
          <OpcaoNeutra onClick={() => irPara('/financeiro?tab=pagar')}>Abrir Contas a Pagar</OpcaoNeutra>
          <OpcaoNeutra onClick={onFechar}>Fechar</OpcaoNeutra>
        </>
      )}
      {passo === 'detalhe' && (
        <>
          <Opcao onClick={iniciarBaixa}>Marcar como paga</Opcao>
          <Opcao onClick={() => irPara('/financeiro?tab=pagar')}>Abrir no Financeiro</Opcao>
          <OpcaoNeutra onClick={() => { eu('Voltar'); setPasso('lista'); }}>Voltar à lista</OpcaoNeutra>
        </>
      )}
      {passo === 'data' && <EscolhaData onEscolher={escolherData} />}
      {passo === 'valor' && conta && (
        <>
          <Opcao onClick={() => escolherValor(saldo(conta))}>Valor que falta ({brl(saldo(conta))})</Opcao>
          <Campo placeholder="Outro valor, ex.: 150,00" modo="decimal" onEnviar={(t) => escolherValor(lerNumero(t))} />
        </>
      )}
      {passo === 'forma' && FORMAS_PAGAMENTO.map((f) => <Opcao key={f} onClick={() => escolherForma(f)}>{f}</Opcao>)}
      {passo === 'dre' && (
        <EscolhaDre grupos={grupos} onEscolher={(e) => { eu(e.label); setPagDre(e); resumo(pagForma, e); }}
          extra={<OpcaoNeutra onClick={() => { eu('Cancelar'); setPasso('detalhe'); }}>Cancelar</OpcaoNeutra>} />
      )}
      {passo === 'confirmar' && (
        <>
          <Opcao onClick={gravar}>Confirmar baixa</Opcao>
          <OpcaoNeutra onClick={() => { eu('Cancelar'); bot('Baixa cancelada.'); setPasso('detalhe'); }}>Cancelar</OpcaoNeutra>
        </>
      )}
      {passo === 'fim' && <Fim onFechar={onFechar} acoes={[{ label: 'Abrir Contas a Pagar', onClick: () => irPara('/financeiro?tab=pagar') }]} />}
    </Roteiro>
  );
}
