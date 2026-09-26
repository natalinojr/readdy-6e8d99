// Ação rápida: clientes do delivery que sumiram, com voucher num toque.
// Fonte: funil de CRM (edge crm-funnel › list_stage), o mesmo da tela Clientes › Funil — o estágio já é
// calculado lá: "em risco" (passou 1,5× do próprio ciclo sem pedir) e "perdido" (sem pedir há mais de
// N dias, padrão 90). Respeita os bloqueios do funil (sem telefone, pediu para não receber, cooldown,
// teto da semana). O voucher sai pela ação "Enviar voucher" com o cliente já escolhido e, ao criar,
// registra a abordagem no funil (log_send) — igual à tela, para o cooldown e a medição de retorno.
import { useEffect, useRef, useState } from 'react';
import { invokeWithAuth } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { Roteiro, useRoteiro, Opcao, Fim, brl, dataBR, type AcaoProps } from '../kit';
import { Painel, Kpis, Linhas } from '../painel';
import EnviarVoucher, { type ClienteVoucher } from './EnviarVoucher';

type Estagio = 'em_risco' | 'perdido';
interface ClienteFunil {
  customer_id: string; nome: string; phone: string; phone_fmt: string; orders_count: number; total_spent: number;
  last_order_at: string | null; days_since_last: number | null; avg_cycle_days: number | null;
  pode_abordar: boolean; bloqueio: string | null;
}
const NOME: Record<Estagio, string> = { em_risco: 'Em risco', perdido: 'Perdidos' };
const EXPLICA: Record<Estagio, string> = {
  em_risco: 'passaram do próprio ritmo de pedir e não voltaram',
  perdido: 'sem pedir há muito tempo (corte do funil da loja)',
};

export default function ClientesSumidos({ onFechar, irPara }: AcaoProps) {
  const { user } = useAuth();
  const tenantId = user?.tenantId ?? '';
  const { baloes, bot, eu, painel } = useRoteiro();
  const [passo, setPasso] = useState<'carregando' | 'estagio' | 'cliente' | 'voucher' | 'fim'>('carregando');
  const [listas, setListas] = useState<Record<Estagio, ClienteFunil[]>>({ em_risco: [], perdido: [] });
  const [estagio, setEstagio] = useState<Estagio>('em_risco');
  const [escolhido, setEscolhido] = useState<ClienteFunil | null>(null);
  const iniciou = useRef(false);

  useEffect(() => {
    if (iniciou.current) return;
    iniciou.current = true;
    (async () => {
      if (!tenantId) { bot('Nenhuma loja ativa.'); setPasso('fim'); return; }
      const ler = (stage: Estagio) => invokeWithAuth<{ clientes?: ClienteFunil[]; error?: string; message?: string }>('crm-funnel', { body: { action: 'list_stage', tenant_id: tenantId, stage } });
      const [r, p] = await Promise.all([ler('em_risco'), ler('perdido')]);
      const erro = r.error?.message || r.data?.error || p.error?.message || p.data?.error;
      if (erro) { bot(`Não consegui ler o funil de clientes: ${erro}`); setPasso('fim'); return; }
      const l = { em_risco: r.data?.clientes ?? [], perdido: p.data?.clientes ?? [] };
      setListas(l);
      const abordaveis = (e: Estagio) => l[e].filter((c) => c.pode_abordar);
      const valor = (e: Estagio) => l[e].reduce((a, c) => a + Number(c.total_spent), 0);
      if (!l.em_risco.length && !l.perdido.length) {
        bot(`*Loja: ${user?.loja || 'loja ativa'}*\nNenhum cliente em risco ou perdido no funil agora.`);
        setPasso('fim');
        return;
      }
      painel(
        <Painel titulo="Clientes que sumiram" subtitulo={user?.loja || 'Loja ativa'}
          rodape="Do funil de clientes (Clientes › Funil). Gasto = total já gasto na loja. Voucher só para quem o funil libera agora.">
          <Kpis
            principal={{ label: 'Em risco', valor: String(l.em_risco.length), extra: <span className="text-xs text-zinc-600">{abordaveis('em_risco').length} dá para chamar agora · já gastaram {brl(valor('em_risco'))}</span> }}
            outros={[{ label: 'Perdidos', valor: String(l.perdido.length) }, { label: 'Dá para chamar', valor: String(abordaveis('perdido').length) }]}
          />
          <Linhas titulo="Em risco que mais gastavam" vazio="Ninguém em risco agora."
            itens={l.em_risco.slice(0, 5).map((c) => ({
              label: c.nome, valor: brl(Number(c.total_spent)),
              detalhe: `${c.orders_count} pedido${c.orders_count === 1 ? '' : 's'} · último ${c.last_order_at ? dataBR(c.last_order_at.slice(0, 10)) : '—'}${c.days_since_last != null ? ` (há ${c.days_since_last} dias)` : ''}${c.pode_abordar ? '' : ` · ${c.bloqueio}`}`,
              status: c.pode_abordar ? 'alerta' : 'neutro',
            }))} />
        </Painel>,
      );
      bot('Quer mandar um voucher? Escolha a turma.');
      setPasso('estagio');
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const abrirEstagio = (e: Estagio) => {
    setEstagio(e);
    eu(NOME[e]);
    const podem = listas[e].filter((c) => c.pode_abordar);
    if (!podem.length) { bot(`Ninguém de "${NOME[e]}" pode ser chamado agora (já abordados, sem telefone ou pediram para não receber).`); return; }
    bot(`${NOME[e]}: ${EXPLICA[e]}.\nQuem? (os que mais gastavam primeiro)`);
    setPasso('cliente');
  };

  const escolher = (c: ClienteFunil) => {
    eu(c.nome);
    setEscolhido(c);
    setPasso('voucher');
  };

  // Voucher: a ação "Enviar voucher" com o cliente já escolhido. Ao criar, registra a abordagem no funil.
  if (passo === 'voucher' && escolhido) {
    const cliente: ClienteVoucher = { id: escolhido.customer_id, nome: escolhido.nome, celular: escolhido.phone, totalVisitas: escolhido.orders_count };
    return (
      <EnviarVoucher onFechar={onFechar} irPara={irPara} clienteInicial={cliente}
        aoCriar={(voucherId, mensagem) => {
          void invokeWithAuth('crm-funnel', { body: { action: 'log_send', tenant_id: tenantId, stage: estagio, customer_id: escolhido.customer_id, voucher_id: voucherId, message: mensagem } });
        }} />
    );
  }

  return (
    <Roteiro titulo="Clientes que sumiram" icone="ri-user-unfollow-line" cor="bg-pink-50 text-pink-600" baloes={baloes}
      carregando={passo === 'carregando'} textoCarregando="Lendo o funil de clientes…" onFechar={onFechar}>
      {passo === 'estagio' && (['em_risco', 'perdido'] as Estagio[]).map((e) => (
        <Opcao key={e} onClick={() => abrirEstagio(e)} detalhe={`(${listas[e].filter((c) => c.pode_abordar).length} para chamar)`}>{NOME[e]}</Opcao>
      ))}
      {passo === 'cliente' && (
        <>
          {listas[estagio].filter((c) => c.pode_abordar).slice(0, 12).map((c) => (
            <Opcao key={c.customer_id} onClick={() => escolher(c)} detalhe={`· ${brl(Number(c.total_spent))} em ${c.orders_count} pedido${c.orders_count === 1 ? '' : 's'}${c.days_since_last != null ? ` · há ${c.days_since_last} dias` : ''}`}>{c.nome}</Opcao>
          ))}
          <Opcao onClick={() => { bot('Escolha a turma.'); setPasso('estagio'); }}>Voltar</Opcao>
        </>
      )}
      {(passo === 'fim' || passo === 'estagio') && (
        <Fim onFechar={onFechar} acoes={[{ label: 'Abrir funil de clientes', onClick: () => irPara('/clientes') }]} />
      )}
    </Roteiro>
  );
}
