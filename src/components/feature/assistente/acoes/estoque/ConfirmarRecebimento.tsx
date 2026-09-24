// Ação rápida: confirmar recebimento de compra ("chegou tudo").
// Caminho da tela: Financeiro › Compras › DetalhePurchaseModal → purchase-confirm-delivery
// (receipt_context para os vínculos item→insumo sugeridos; depois a confirmação). É na confirmação
// que a compra ENTRA NO ESTOQUE (desde 2026-09-11). Aqui o corpo é o mesmo que a tela manda quando
// o usuário não mexe em nada: quantidade recebida = pedida, vínculos = sugeridos.
// "Chegou diferente" (quantidade/insumo a ajustar) vai para a tela.
import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { Roteiro, useRoteiro, Opcao, OpcaoNeutra, EscolhaData, Fim, brl, dataBR, hojeISO, type AcaoProps } from '../kit';
import { gravarNaEdge, rotuloUnidade, qtdBR } from './comum';
import { ehAcrescimoNota } from '@/lib/acrescimoNota';

interface Item {
  id: string; description: string | null; quantity: number | null; total_price: number | null;
  unit_label: string | null; units_per_package: number | null; ingredient_id: string | null;
}
interface Compra {
  id: string; supplier: string; purchase_date: string; total_amount: number; invoice_number: string | null; items: Item[];
}
interface Contexto {
  ingredients: { id: string; name: string; unit: string | null }[];
  suggestions: Record<string, { ingredient_id: string; units_per_package: number; source?: string }>;
  stock_already_applied: boolean;
}
type Passo = 'carregando' | 'lista' | 'itens' | 'data' | 'confirmar' | 'gravando' | 'fim';
const LIMITE = 25;

export default function ConfirmarRecebimento({ onFechar, irPara }: AcaoProps) {
  const { user } = useAuth();
  const r = useRoteiro();
  const [passo, setPasso] = useState<Passo>('carregando');
  const [compras, setCompras] = useState<Compra[]>([]);
  const [compra, setCompra] = useState<Compra | null>(null);
  const [ctx, setCtx] = useState<Contexto | null>(null);
  const [recebidoEm, setRecebidoEm] = useState(hojeISO());
  const [ok, setOk] = useState(false);

  useEffect(() => {
    (async () => {
      if (!user?.tenantId) { r.bot('Nenhuma loja ativa.'); setPasso('fim'); return; }
      // Mesma leitura do useFinanceiro.fetchPurchases, só as ainda não recebidas
      const { data, error, count } = await supabase
        .from('fin_purchases')
        .select('id, supplier, purchase_date, total_amount, invoice_number, items:fin_purchase_items(id, description, quantity, total_price, unit_label, units_per_package, ingredient_id)', { count: 'exact' })
        .eq('tenant_id', user.tenantId)
        .is('delivery_confirmed_at', null)
        .order('purchase_date', { ascending: false })
        .limit(LIMITE);
      if (error) { r.bot(`Não consegui ler as compras: ${error.message}`); setPasso('fim'); return; }
      const lista = (data ?? []) as unknown as Compra[];
      if (!lista.length) { r.bot(`*${user.loja}*\nNenhuma compra aguardando entrega.`); setPasso('fim'); return; }
      setCompras(lista);
      r.bot(`*${user.loja}*\n${count ?? lista.length} compra(s) aguardando entrega${(count ?? 0) > LIMITE ? ` (mostrando as ${LIMITE} mais recentes)` : ''}. Qual chegou?`);
      setPasso('lista');
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const escolher = async (c: Compra) => {
    r.eu(`${c.supplier} · ${dataBR(c.purchase_date)}`);
    setCompra(c);
    setPasso('carregando');
    const { data, erro } = await gravarNaEdge<Contexto>('purchase-confirm-delivery', {
      action: 'receipt_context', tenant_id: user!.tenantId, payload: { purchase_id: c.id },
    });
    if (erro || !data) { r.bot(`Não consegui abrir a compra: ${erro ?? 'erro'}`); setPasso('fim'); return; }
    setCtx(data);
    const nomeIns = (id: string) => data.ingredients.find((i) => i.id === id);
    const produtos = (c.items ?? []).filter((it) => !ehAcrescimoNota(it.description));
    const linhas = produtos.map((it) => {
      const s = data.suggestions[it.id];
      const ing = s?.ingredient_id ? nomeIns(s.ingredient_id) : null;
      const estoque = ing && data.stock_already_applied && it.ingredient_id
        ? `→ ${ing.name} (já entrou na criação)`
        : ing
        ? `→ ${ing.name} +${qtdBR(Number(it.quantity ?? 0) * (Number(s.units_per_package) > 0 ? Number(s.units_per_package) : 1))} ${rotuloUnidade(ing.unit)}`
        : '→ não entra no estoque';
      return `• ${qtdBR(Number(it.quantity ?? 0))} ${it.unit_label || 'un'} ${it.description || '—'} (${brl(it.total_price)})\n   ${estoque}`;
    });
    const semInsumo = produtos.filter((it) => !data.suggestions[it.id]?.ingredient_id).length;
    r.bot([
      `*${c.supplier}*${c.invoice_number ? ` · NF ${c.invoice_number}` : ''}`,
      `Compra de ${dataBR(c.purchase_date)} · ${brl(c.total_amount)}`,
      ...(linhas.length ? linhas : ['(sem itens)']),
      ...(semInsumo ? [`Atenção: ${semInsumo} item(ns) sem insumo vinculado não entram no estoque. Para vincular, use a tela.`] : []),
      ...(data.stock_already_applied ? ['Compra antiga: o estoque já entrou na criação; só diferenças serão lançadas.'] : []),
      'Chegou tudo como está?',
    ].join('\n'));
    setPasso('itens');
  };

  const chegouTudo = () => {
    r.eu('Chegou tudo');
    r.bot('Quando chegou?');
    setPasso('data');
  };

  const chegouDiferente = () => {
    r.eu('Chegou diferente');
    r.bot(`Ajuste na tela: Financeiro › Compras › ${compra?.supplier} (${dataBR(compra?.purchase_date)}) › Confirmar Recebimento.`);
    setPasso('fim');
    irPara('/financeiro?tab=compras');
  };

  const escolherData = (iso: string) => {
    if (iso > hojeISO()) { r.bot('A data não pode ser no futuro.'); return; }
    r.eu(dataBR(iso));
    setRecebidoEm(iso);
    const c = compra!;
    const comInsumo = (c.items ?? []).filter((it) => ctx?.suggestions[it.id]?.ingredient_id).length;
    r.bot([
      '*Confere o recebimento:*',
      `Loja: ${user?.loja ?? ''}`,
      `${c.supplier} · ${brl(c.total_amount)}`,
      `Recebido em: ${dataBR(iso)}`,
      `Itens: ${(c.items ?? []).length} (${comInsumo} entram no estoque)`,
      'Não dá para desfazer pelo chat.',
    ].join('\n'));
    setPasso('confirmar');
  };

  const gravar = async () => {
    const c = compra!;
    r.eu('Confirmar recebimento');
    setPasso('gravando');
    // Igual ao handleConfirmDelivery da tela com o contexto carregado e nada alterado
    const received_items = (c.items ?? []).map((it) => {
      const link = ctx?.suggestions[it.id];
      return {
        item_id: it.id,
        received_quantity: Number(it.quantity ?? 0),
        received_total_price: Number(it.total_price ?? 0),
        ingredient_id: link?.ingredient_id || null,
        units_per_package: link?.ingredient_id
          ? (Number(link.units_per_package) > 0 ? Number(link.units_per_package) : 1)
          : (Number(it.units_per_package ?? 1) || 1),
      };
    });
    const { data: resp, erro } = await gravarNaEdge<{ data?: { aviso?: string } }>('purchase-confirm-delivery', {
      tenant_id: user!.tenantId,
      payload: { purchase_id: c.id, delivery_notes: '', received_at: recebidoEm, received_items },
    });
    if (erro) r.bot(`Não confirmou: ${erro}\nConfira em Financeiro › Compras antes de tentar de novo.`);
    else {
      setOk(true);
      const aviso = resp?.data?.aviso;
      r.bot(`Recebimento confirmado: ${c.supplier}. O estoque foi atualizado.${aviso ? `\n\nAtenção: ${aviso}` : ''}`);
    }
    setPasso('fim');
  };

  return (
    <Roteiro titulo="Confirmar recebimento" icone="ri-truck-line" cor="bg-green-50 text-green-600"
      baloes={r.baloes} carregando={passo === 'carregando' || passo === 'gravando'}
      textoCarregando={passo === 'gravando' ? 'Confirmando…' : 'Carregando…'} onFechar={onFechar} travarFechar={passo === 'gravando'}>
      {passo === 'lista' && compras.map((c) => (
        <Opcao key={c.id} onClick={() => escolher(c)} detalhe={`${dataBR(c.purchase_date)} · ${brl(c.total_amount)}`}>{c.supplier}</Opcao>
      ))}
      {passo === 'itens' && (
        <>
          <Opcao onClick={chegouTudo}>Chegou tudo</Opcao>
          <Opcao onClick={chegouDiferente}>Chegou diferente</Opcao>
          <OpcaoNeutra onClick={onFechar}>Cancelar</OpcaoNeutra>
        </>
      )}
      {passo === 'data' && <EscolhaData onEscolher={escolherData} />}
      {passo === 'confirmar' && (
        <>
          <Opcao onClick={gravar}>Confirmar recebimento</Opcao>
          <OpcaoNeutra onClick={onFechar}>Cancelar</OpcaoNeutra>
        </>
      )}
      {passo === 'fim' && (
        <Fim onFechar={onFechar} acoes={compra ? [{ label: ok ? 'Abrir Compras' : 'Abrir Financeiro › Compras', onClick: () => irPara('/financeiro?tab=compras') }] : undefined} />
      )}
    </Roteiro>
  );
}
