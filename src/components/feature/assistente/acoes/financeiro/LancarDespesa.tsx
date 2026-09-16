// Ação rápida: lançar uma despesa (conta a pagar), sem IA.
// Caminho igual ao do Financeiro: Edge financial-write › upsert_bill (Contas a Pagar › Nova conta) e, se já
// foi paga, pay_bill (modal de baixa) — que lança o fin_cash_flow (auto_bill_payment). Mesmo formato da
// "despesa sem nota" da conciliação (conciliacao-pagamentos › create_from_statement): conta + baixa.
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Roteiro, useRoteiro, Opcao, OpcaoNeutra, Campo, EscolhaData, Fim, brl, dataBR, hojeISO, lerNumero, type AcaoProps } from '../kit';
import { carregarOpcoesDre, resolverCategoriaDre, finWrite, FORMAS_PAGAMENTO, type DreEscolha, type DreGrupoOpcoes } from './comum';
import EscolhaDre from './EscolhaDre';

type Passo = 'carregando' | 'valor' | 'categoria' | 'data' | 'forma' | 'descricao' | 'confirmar' | 'gravando' | 'fim';
const A_PAGAR = '__a_pagar__';

export default function LancarDespesa({ onFechar, irPara }: AcaoProps) {
  const { user } = useAuth();
  const tenantId = user?.tenantId ?? '';
  const { baloes, bot, eu } = useRoteiro();
  const [passo, setPasso] = useState<Passo>('carregando');
  const [grupos, setGrupos] = useState<DreGrupoOpcoes[]>([]);
  const [valor, setValor] = useState(0);
  const [dre, setDre] = useState<DreEscolha | null>(null);
  const [data, setData] = useState(hojeISO());
  const [forma, setForma] = useState('');
  const [descricao, setDescricao] = useState('');
  const [ok, setOk] = useState(false);
  const travado = useRef(false); // um clique = uma gravação

  useEffect(() => {
    if (!tenantId) { bot('Nenhuma loja ativa.'); setPasso('fim'); return; }
    (async () => {
      const r = await carregarOpcoesDre(tenantId);
      if (r.error) { bot(`Não consegui ler as categorias do DRE: ${r.error}`); setPasso('fim'); return; }
      if (!r.grupos.length) { bot('A loja não tem grupo de despesa no DRE. Cadastre em Financeiro › DRE.'); setPasso('fim'); return; }
      setGrupos(r.grupos);
      bot(`Loja: *${user?.loja || 'loja ativa'}*\nQual o valor da despesa?`);
      setPasso('valor');
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const enviarValor = (t: string) => {
    const v = Math.round(lerNumero(t) * 100) / 100;
    if (!(v > 0)) { bot('Valor inválido. Ex.: 150 ou 1.250,90'); return; }
    eu(brl(v));
    setValor(v);
    bot('Qual a categoria no DRE?');
    setPasso('categoria');
  };

  const escolherDre = (e: DreEscolha) => {
    eu(e.label);
    setDre(e);
    bot('Data do pagamento (ou do vencimento, se ainda vai pagar)?');
    setPasso('data');
  };

  const escolherData = (iso: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) { bot('Data inválida.'); return; }
    eu(dataBR(iso));
    setData(iso);
    if (iso > hojeISO()) {
      bot('Data futura: fica como *conta a pagar* nesse vencimento.');
      setForma(A_PAGAR);
      bot('Descrição? (opcional)');
      setPasso('descricao');
      return;
    }
    bot('Como foi pago?');
    setPasso('forma');
  };

  const escolherForma = (f: string) => {
    eu(f === A_PAGAR ? 'Ainda não paguei' : f);
    setForma(f);
    bot('Descrição? (opcional)');
    setPasso('descricao');
  };

  const mostrarResumo = (desc: string) => {
    setDescricao(desc);
    bot([
      '*Confere a despesa:*',
      `Loja: ${user?.loja || '—'}`,
      `Valor: ${brl(valor)}`,
      `DRE: ${dre!.label}`,
      forma === A_PAGAR ? `A pagar · vence ${dataBR(data)}` : `Paga em ${dataBR(data)} · ${forma}`,
      `Descrição: ${desc || dre!.label}`,
    ].join('\n'));
    setPasso('confirmar');
  };

  const gravar = async () => {
    if (travado.current) return;
    travado.current = true;
    eu('Confirmar');
    setPasso('gravando');
    const cat = await resolverCategoriaDre(tenantId, dre!);
    if (cat.error || !cat.id) { bot(`❌ Não gravei: ${cat.error ?? 'categoria inválida'}`); setPasso('fim'); return; }
    const desc = (descricao || cat.nome).slice(0, 200);
    const nb = await finWrite<{ id: string }>('upsert_bill', tenantId, {
      description: desc, supplier: null, category: cat.nome, amount: valor, due_date: data,
      is_recurring: false, dre_category_id: cat.id, status: 'pending',
      notes: 'Lançada pelo chat do assistente (ação rápida)',
    });
    const billId = nb.data?.id;
    if (nb.error || !billId) { bot(`❌ Não gravei: ${nb.error ?? 'falha ao criar a conta'}`); setPasso('fim'); return; }
    if (forma === A_PAGAR) {
      bot(`✅ Conta a pagar lançada: ${desc} · ${brl(valor)} · vence ${dataBR(data)}`);
      setOk(true); setPasso('fim'); return;
    }
    const pay = await finWrite('pay_bill', tenantId, { id: billId, paid_date: data, paid_amount: valor, payment_method: forma });
    if (pay.error) {
      // Mesmo desfecho da conciliação: sem baixa, a conta criada agora é apagada para não ficar pela metade.
      const del = await finWrite('delete_bill', tenantId, { id: billId });
      bot(del.error
        ? `⚠️ A conta foi criada, mas a baixa falhou (${pay.error}). Confira em Contas a Pagar antes de lançar de novo.`
        : `❌ Não gravei: a baixa falhou (${pay.error}). Nada ficou lançado.`);
      setOk(!!del.error); setPasso('fim'); return;
    }
    bot(`✅ Despesa lançada e paga: ${desc} · ${brl(valor)} · ${dataBR(data)} · ${forma}`);
    setOk(true);
    setPasso('fim');
  };

  return (
    <Roteiro titulo="Lançar despesa" icone="ri-money-dollar-circle-line" cor="bg-rose-50 text-rose-600" baloes={baloes}
      carregando={passo === 'carregando' || passo === 'gravando'} textoCarregando={passo === 'gravando' ? 'Gravando…' : undefined}
      onFechar={onFechar} travarFechar={passo === 'gravando'}>
      {passo === 'valor' && <Campo placeholder="Valor, ex.: 150,00" modo="decimal" onEnviar={enviarValor} />}
      {passo === 'categoria' && <EscolhaDre grupos={grupos} onEscolher={escolherDre} />}
      {passo === 'data' && <EscolhaData onEscolher={escolherData} permitirFuturo />}
      {passo === 'forma' && (
        <>
          {FORMAS_PAGAMENTO.map((f) => <Opcao key={f} onClick={() => escolherForma(f)}>{f}</Opcao>)}
          <OpcaoNeutra onClick={() => escolherForma(A_PAGAR)}>Ainda não paguei (fica a pagar)</OpcaoNeutra>
        </>
      )}
      {passo === 'descricao' && (
        <>
          <Campo placeholder="Ex.: conserto da geladeira" onEnviar={(t) => { eu(t); mostrarResumo(t.slice(0, 200)); }} />
          <OpcaoNeutra onClick={() => { eu('Sem descrição'); mostrarResumo(''); }}>Sem descrição</OpcaoNeutra>
        </>
      )}
      {passo === 'confirmar' && (
        <>
          <Opcao onClick={gravar}>Confirmar e lançar</Opcao>
          <OpcaoNeutra onClick={onFechar}>Cancelar</OpcaoNeutra>
        </>
      )}
      {passo === 'fim' && <Fim onFechar={onFechar} acoes={ok ? [{ label: 'Abrir Contas a Pagar', onClick: () => irPara('/financeiro?tab=pagar') }] : undefined} />}
    </Roteiro>
  );
}
