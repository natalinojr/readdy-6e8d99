// Ação rápida: classificar no DRE as contas a pagar sem categoria, uma por vez — sem IA.
// Pendências = mesma regra do assistente-cron (dreClassify) e do pay_bill: fin_accounts_payable sem
// dre_category_id, não cancelada, fora compra (vai ao CMV pelos itens) e folha (DRE lê hr_payroll).
// Gravação igual ao modal "Vincular categorias DRE" de Contas a Pagar: financial-write › bulk_update_bill_dre_category.
// Escolher um GRUPO reaproveita/cria a categoria raiz com o nome dele (mesma regra do pay_bill).
import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { Roteiro, useRoteiro, Opcao, OpcaoNeutra, Fim, brl, dataBR, type AcaoProps } from '../kit';
import { carregarOpcoesDre, resolverCategoriaDre, finWrite, type DreEscolha, type DreGrupoOpcoes } from './comum';
import EscolhaDre from './EscolhaDre';

interface Conta {
  id: string; description: string; supplier: string | null; amount: number; status: string;
  due_date: string; paid_date: string | null; category: string | null;
}
type Passo = 'carregando' | 'escolher' | 'confirmar' | 'gravando' | 'fim';

export default function ClassificarDre({ onFechar, irPara }: AcaoProps) {
  const { user } = useAuth();
  const tenantId = user?.tenantId ?? '';
  const { baloes, bot, eu } = useRoteiro();
  const [passo, setPasso] = useState<Passo>('carregando');
  const [fila, setFila] = useState<Conta[]>([]);
  const [idx, setIdx] = useState(0);
  const [grupos, setGrupos] = useState<DreGrupoOpcoes[]>([]);
  const [escolha, setEscolha] = useState<DreEscolha | null>(null);
  const [feitas, setFeitas] = useState(0);
  const travado = useRef(false);

  const perguntar = (lista: Conta[], i: number) => {
    const c = lista[i];
    if (!c) {
      bot('Fim da fila. Não sobrou conta sem classificação (das que você não pulou).');
      setPasso('fim');
      return;
    }
    const quando = c.status === 'paid' && c.paid_date ? `paga em ${dataBR(c.paid_date)}` : `vence ${dataBR(c.due_date)}`;
    bot([
      `*${i + 1} de ${lista.length}*`,
      `${c.description} · ${brl(c.amount)}`,
      [c.supplier, quando, c.category ? `categoria antiga: ${c.category}` : ''].filter(Boolean).join(' · '),
      'Qual a classificação no DRE?',
    ].join('\n'));
    setEscolha(null);
    setPasso('escolher');
  };

  useEffect(() => {
    if (!tenantId) { bot('Nenhuma loja ativa.'); setPasso('fim'); return; }
    (async () => {
      const [contasRes, dre] = await Promise.all([
        supabase.from('fin_accounts_payable')
          .select('id, description, supplier, amount, status, due_date, paid_date, category')
          .eq('tenant_id', tenantId)
          .is('dre_category_id', null)
          .neq('status', 'cancelled')
          .or('reference_type.is.null,reference_type.not.in.(purchase,hr_payroll)')
          .order('due_date', { ascending: true })
          .limit(500),
        carregarOpcoesDre(tenantId),
      ]);
      if (contasRes.error) { bot(`Não consegui ler as contas: ${contasRes.error.message}`); setPasso('fim'); return; }
      if (dre.error || !dre.grupos.length) { bot(`Não consegui ler as categorias do DRE${dre.error ? `: ${dre.error}` : ''}.`); setPasso('fim'); return; }
      setGrupos(dre.grupos);
      // Pagas primeiro: já estão erradas na DRE (mesma ordem do assistente-cron)
      const lista = ((contasRes.data ?? []) as Conta[]).sort((a, b) => Number(b.status === 'paid') - Number(a.status === 'paid'));
      setFila(lista);
      if (!lista.length) { bot(`Loja: *${user?.loja || 'loja ativa'}*\nNenhuma conta sem classificação no DRE. ✅`); setPasso('fim'); return; }
      bot(`Loja: *${user?.loja || 'loja ativa'}*\n${lista.length}${lista.length === 500 ? '+' : ''} conta(s) sem classificação no DRE.`);
      perguntar(lista, 0);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pular = () => {
    eu('Pular');
    const prox = idx + 1;
    setIdx(prox);
    perguntar(fila, prox);
  };

  const escolher = (e: DreEscolha) => {
    eu(e.label);
    setEscolha(e);
    bot(`Classificar *${fila[idx].description}* como *${e.label}*?`);
    setPasso('confirmar');
  };

  const gravar = async () => {
    if (travado.current || !escolha) return;
    travado.current = true;
    eu('Confirmar');
    setPasso('gravando');
    const c = fila[idx];
    const cat = await resolverCategoriaDre(tenantId, escolha);
    const r = cat.id
      ? await finWrite<{ updated: number }>('bulk_update_bill_dre_category', tenantId, { assignments: [{ bill_id: c.id, dre_category_id: cat.id }] })
      : { data: null, error: cat.error ?? 'categoria inválida' };
    travado.current = false;
    if (r.error || !r.data?.updated) {
      bot(`❌ Não gravei: ${r.error ?? 'a conta não foi encontrada nesta loja'}. Escolha de novo ou pule.`);
      setPasso('escolher');
      return;
    }
    bot(`✅ Classificada: ${cat.nome}`);
    setFeitas((n) => n + 1);
    const prox = idx + 1;
    setIdx(prox);
    perguntar(fila, prox);
  };

  return (
    <Roteiro titulo="Classificar no DRE" icone="ri-price-tag-3-line" cor="bg-indigo-50 text-indigo-600" baloes={baloes}
      carregando={passo === 'carregando' || passo === 'gravando'} textoCarregando={passo === 'gravando' ? 'Gravando…' : undefined}
      onFechar={onFechar} travarFechar={passo === 'gravando'}>
      {passo === 'escolher' && (
        <EscolhaDre key={fila[idx]?.id} grupos={grupos} onEscolher={escolher}
          extra={<>
            <OpcaoNeutra onClick={pular}>Pular</OpcaoNeutra>
            <OpcaoNeutra onClick={onFechar}>Parar por aqui{feitas ? ` (${feitas} feita${feitas > 1 ? 's' : ''})` : ''}</OpcaoNeutra>
          </>} />
      )}
      {passo === 'confirmar' && (
        <>
          <Opcao onClick={gravar}>Confirmar</Opcao>
          <OpcaoNeutra onClick={() => { eu('Escolher outra'); setPasso('escolher'); }}>Escolher outra</OpcaoNeutra>
        </>
      )}
      {passo === 'fim' && <Fim onFechar={onFechar} acoes={[{ label: 'Abrir Contas a Pagar', onClick: () => irPara('/financeiro?tab=pagar') }]} />}
    </Roteiro>
  );
}
