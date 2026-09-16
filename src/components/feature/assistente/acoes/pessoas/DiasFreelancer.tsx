// Ação rápida: informar os dias trabalhados de um freelancer já pago — sem IA.
// Mesmo caminho da tela Financeiro › Freelancers (InformarDias): diárias "aguardando_dias" da loja
// ativa → RPC fn_freelancer_informar_dias {p_payment_id, p_dias} (valor dividido igualmente).
// Registrar um pagamento NOVO de freelancer não entra: só existe no assistente-brain.
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { Roteiro, useRoteiro, Opcao, OpcaoNeutra, EscolhaData, Fim, brl, dataBR, hojeISO, type AcaoProps } from '../kit';

interface Pendente {
  id: string; amount: number; payment_id: string | null; created_at: string;
  hr_freelancers: { name: string; role: string | null } | null;
}
type Passo = 'carregando' | 'lista' | 'dias' | 'mais' | 'confirmar' | 'gravando' | 'fim';

export default function DiasFreelancer({ onFechar, irPara }: AcaoProps) {
  const { user } = useAuth();
  const { baloes, bot, eu } = useRoteiro();
  const [passo, setPasso] = useState<Passo>('carregando');
  const [lista, setLista] = useState<Pendente[]>([]);
  const [sel, setSel] = useState<Pendente | null>(null);
  const [dias, setDias] = useState<string[]>([]);

  const carregar = async (primeira: boolean) => {
    setPasso('carregando');
    const { data, error } = await supabase.from('hr_freelancer_shifts')
      .select('id, amount, payment_id, created_at, hr_freelancers(name, role)')
      .eq('tenant_id', user!.tenantId).eq('status', 'aguardando_dias').order('created_at', { ascending: false });
    if (error) { bot(`Não consegui carregar: ${error.message}`); setPasso('fim'); return; }
    const l = ((data ?? []) as unknown as Pendente[]).filter((p) => p.payment_id);
    setLista(l);
    if (!l.length) { bot(primeira ? `*${user!.loja}*\nNenhum freelancer aguardando os dias.` : 'Não há mais freelancer aguardando os dias.'); setPasso('fim'); return; }
    bot(`${primeira ? `*${user!.loja}*\n` : ''}${l.length} pagamento(s) sem os dias trabalhados. Qual?`);
    setPasso('lista');
  };

  useEffect(() => {
    if (!user?.tenantId) { bot('Escolha uma loja no app antes.'); setPasso('fim'); return; }
    carregar(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const nome = (p: Pendente) => p.hr_freelancers?.name ?? 'Freelancer';

  const escolher = (p: Pendente) => {
    setSel(p);
    setDias([]);
    eu(nome(p));
    bot(`${nome(p)} · ${brl(Number(p.amount))} · pago em ${dataBR(new Date(new Date(p.created_at).getTime() - 3 * 3600_000).toISOString())}\nQual dia trabalhou?`);
    setPasso('dias');
  };

  const addDia = (iso: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso) || iso > hojeISO()) { bot('O dia não pode ser no futuro.'); return; }
    if (dias.includes(iso)) { bot('Esse dia já está na lista.'); setPasso('mais'); return; }
    const novos = [...dias, iso].sort();
    setDias(novos);
    eu(dataBR(iso));
    bot(`Dias: ${novos.map(dataBR).join(', ')}\nMais algum?`);
    setPasso('mais');
  };

  const resumo = () => {
    const p = sel!;
    const v = Number(p.amount);
    eu('Pronto');
    bot([
      '*Confere:*',
      `Freelancer: ${nome(p)}`,
      `Dias: ${dias.map(dataBR).join(', ')}`,
      `Valor: ${brl(v)}${dias.length > 1 ? ` (${brl(v / dias.length)} por dia)` : ''}`,
    ].join('\n'));
    setPasso('confirmar');
  };

  const gravar = async () => {
    const p = sel!;
    eu('Salvar');
    setPasso('gravando');
    const { error } = await supabase.rpc('fn_freelancer_informar_dias', { p_payment_id: p.payment_id, p_dias: dias });
    if (error) { bot(`❌ Não consegui salvar: ${error.message}`); setPasso('fim'); return; }
    bot(`✅ Dias de ${nome(p)} registrados.`);
    setSel(null);
    setDias([]);
    await carregar(false);
  };

  return (
    <Roteiro titulo="Dias de freelancer" icone="ri-user-star-line" cor="bg-amber-50 text-amber-600" baloes={baloes}
      carregando={passo === 'carregando' || passo === 'gravando'} textoCarregando={passo === 'gravando' ? 'Salvando…' : undefined}
      onFechar={onFechar} travarFechar={passo === 'gravando'}>
      {passo === 'lista' && (
        <>
          {lista.map((p) => <Opcao key={p.id} onClick={() => escolher(p)} detalhe={brl(Number(p.amount))}>{nome(p)}</Opcao>)}
          <Fim onFechar={onFechar} acoes={[{ label: 'Abrir Freelancers', onClick: () => irPara('/financeiro?tab=freelancers') }]} />
        </>
      )}
      {passo === 'dias' && <EscolhaData onEscolher={addDia} />}
      {passo === 'mais' && (
        <>
          <Opcao onClick={resumo}>Pronto</Opcao>
          <Opcao onClick={() => { bot('Qual outro dia?'); setPasso('dias'); }}>Mais um dia</Opcao>
          <OpcaoNeutra onClick={() => { setDias([]); bot('Dias apagados. Qual dia trabalhou?'); setPasso('dias'); }}>Recomeçar os dias</OpcaoNeutra>
        </>
      )}
      {passo === 'confirmar' && (
        <>
          <Opcao onClick={gravar}>Salvar</Opcao>
          <OpcaoNeutra onClick={() => { bot('Ok, nada foi salvo.'); setPasso('mais'); }}>Corrigir</OpcaoNeutra>
        </>
      )}
      {passo === 'fim' && <Fim onFechar={onFechar} acoes={[{ label: 'Abrir Freelancers', onClick: () => irPara('/financeiro?tab=freelancers') }]} />}
    </Roteiro>
  );
}
