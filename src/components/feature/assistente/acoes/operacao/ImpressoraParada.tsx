// Ação rápida: "a impressora parou" — fila de impressão da loja ativa.
// Leitura direta de print_queue (últimas 24 h, com tenant_id + header da loja ativa), agrupada
// pela impressora que o agente usaria (mesma resolução da Edge print-queue-agent: impressora_id
// conhecido → mapaEstacoes[station_key] → única impressora da loja).
// Diagnóstico (AI_SYSTEM_MAP › print_queue): pending parado = agente não puxou (PC/agente
// desligado ou sem internet); failed = agente pegou, mas a impressora não respondeu (TCP/IP).
// Reenviar: RPC enqueue_print_ticket com o MESMO payload + update de impressora_id — o mesmo par
// de chamadas de printOrderQueue.enqueueTicket. Sem p_force: se já houver ticket pendente do
// mesmo pedido/estação, a RPC devolve o existente (não duplica).
import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useImpressoras } from '@/contexts/ImpressorasContext';
import { dateKeyBrasilia, todayBrasilia } from '@/lib/dateUtils';
import { Roteiro, useRoteiro, Opcao, OpcaoNeutra, Fim, horaBR, dataBR, type AcaoProps } from '../kit';

interface Ticket {
  id: string;
  order_id: string | null;
  order_number: string | null;
  station_key: string | null;
  station_label: string | null;
  impressora_id: string | null;
  status: string;
  retry_count: number | null;
  last_error: string | null;
  created_at: string;
  updated_at: string | null;
  content_type: string | null;
  payload: Record<string, unknown> | null;
  paper_style: string | null;
}

const MIN = 60_000;
const JANELA_REENVIO_H = 3;

export default function ImpressoraParada({ onFechar, irPara }: AcaoProps) {
  const { user } = useAuth();
  const { impressoras, mapaEstacoes } = useImpressoras();
  const { baloes, bot, eu } = useRoteiro();
  const [passo, setPasso] = useState<'carregando' | 'menu' | 'confirmar' | 'gravando' | 'fim'>('carregando');
  const [falhas, setFalhas] = useState<Ticket[]>([]);
  const iniciou = useRef(false);

  const nomeImpressora = (t: Ticket): string => {
    const porId = new Map(impressoras.map((i) => [i.id, i.nome]));
    const direto = t.impressora_id || (t.payload?.impressora_id as string | undefined) || '';
    let pid = direto && porId.has(direto) ? direto : '';
    if (!pid) pid = mapaEstacoes[t.station_key ?? ''] || mapaEstacoes[direto] || (impressoras.length === 1 ? impressoras[0].id : '');
    return porId.get(pid) ?? 'Impressora não definida';
  };

  const quando = (iso: string) => {
    const dia = dateKeyBrasilia(iso);
    return dia === todayBrasilia() ? horaBR(iso) : `${dataBR(dia)} ${horaBR(iso)}`;
  };

  const carregar = async () => {
    if (!user?.tenantId) { bot('Nenhuma loja ativa.'); setPasso('fim'); return; }
    setPasso('carregando');
    const desde = new Date(Date.now() - 24 * 60 * MIN).toISOString();
    const { data, error } = await supabase
      .from('print_queue')
      .select('id, order_id, order_number, station_key, station_label, impressora_id, status, retry_count, last_error, created_at, updated_at, content_type, payload, paper_style')
      .eq('tenant_id', user.tenantId)
      .gte('created_at', desde)
      .order('created_at', { ascending: false })
      .limit(500);
    if (error) { bot(`Não consegui ler a fila: ${error.message}`); setPasso('fim'); return; }
    const todos = (data ?? []) as Ticket[];
    const agora = Date.now();

    // Ticket "superado": já existe outro mais novo do mesmo pedido+estação (reenvio/reimpressão)
    const superado = (t: Ticket) => !!t.order_id && todos.some((o) =>
      o.id !== t.id && o.order_id === t.order_id && o.station_key === t.station_key && o.created_at > t.created_at);

    const problemas = todos.filter((t) => {
      if (superado(t)) return false;
      const idade = agora - Date.parse(t.updated_at ?? t.created_at);
      if (t.status === 'failed') return true;
      if (t.status === 'printing') return idade > 2 * MIN;
      if (t.status === 'pending') return (t.retry_count ?? 0) > 0 || agora - Date.parse(t.created_at) > 2 * MIN;
      return false;
    });

    if (!problemas.length) {
      const ultimo = todos.find((t) => t.status === 'printed');
      bot(`✅ Fila limpa nas últimas 24 h.${ultimo ? `\nÚltimo impresso: ${quando(ultimo.updated_at ?? ultimo.created_at)}.` : ''}\nSe o papel não sai, confira se a impressora está ligada e com papel.`);
      setFalhas([]);
      setPasso('fim');
      return;
    }

    const grupos = new Map<string, Ticket[]>();
    problemas.forEach((t) => {
      const k = nomeImpressora(t);
      grupos.set(k, [...(grupos.get(k) ?? []), t]);
    });

    const blocos: string[] = [];
    for (const [nome, lista] of grupos) {
      const aguardando = lista.filter((t) => t.status === 'pending' && !(t.retry_count ?? 0));
      const tentando = lista.filter((t) => t.status === 'pending' && (t.retry_count ?? 0) > 0);
      const travados = lista.filter((t) => t.status === 'printing');
      const falhou = lista.filter((t) => t.status === 'failed');
      const b: string[] = [`*${nome}*`];
      if (aguardando.length) {
        const maisAntigo = aguardando[aguardando.length - 1];
        b.push(`${aguardando.length} esperando o agente desde ${quando(maisAntigo.created_at)}: o agente do PC da loja não está puxando (PC desligado, agente fechado ou sem internet).`);
      }
      if (tentando.length) {
        b.push(`${tentando.length} com erro, o agente ainda vai tentar de novo${tentando[0].last_error ? `: ${tentando[0].last_error}` : '.'}`);
      }
      if (travados.length) b.push(`${travados.length} travado(s) "imprimindo": o agente caiu no meio; volta para a fila no próximo ciclo.`);
      if (falhou.length) {
        b.push(`${falhou.length} desistido(s) após as tentativas: a impressora não respondeu (ligada? cabo/rede? IP mudou?)${falhou[0].last_error ? `\nÚltimo erro: ${falhou[0].last_error}` : ''}`);
      }
      const pedidos = [...new Set(lista.map((t) => t.order_number).filter(Boolean))].slice(0, 8);
      if (pedidos.length) b.push(`Pedidos: ${pedidos.map((n) => `#${n}`).join(', ')}${lista.length > 8 ? '…' : ''}`);
      blocos.push(b.join('\n'));
    }
    bot(blocos.join('\n\n'));

    // Só oferece reenvio de falhas recentes: ticket de cozinha de horas atrás saindo agora confunde a equipe.
    const falhasTodas = problemas.filter((t) => t.status === 'failed' && t.payload);
    const reenviaveis = falhasTodas.filter((t) => agora - Date.parse(t.created_at) <= JANELA_REENVIO_H * 60 * MIN);
    const antigas = falhasTodas.length - reenviaveis.length;
    setFalhas(reenviaveis);
    if (antigas) bot(`${antigas} falha(s) com mais de ${JANELA_REENVIO_H} h não entram no reenvio. Se precisar, reimprima o pedido no Gestor de Pedidos.`);
    if (reenviaveis.length) {
      bot(`Posso reenviar ${reenviaveis.length} ticket(s) das últimas ${JANELA_REENVIO_H} h que falharam. Conserte a impressora antes, senão falham de novo.`);
      setPasso('menu');
    } else {
      setPasso('fim');
    }
  };

  useEffect(() => {
    if (iniciou.current) return;
    iniciou.current = true;
    bot(`*Loja: ${user?.loja || 'loja ativa'}*`);
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pedirConfirmacao = () => {
    eu('Reenviar');
    const linhas = falhas.slice(0, 10).map((t) => `#${t.order_number ?? '—'} · ${t.station_label ?? t.station_key ?? ''} · ${nomeImpressora(t)}`);
    bot([`*Reenviar ${falhas.length} ticket(s)?*`, ...linhas, ...(falhas.length > 10 ? [`+${falhas.length - 10}`] : []), '', 'Cada um sai UMA vez na impressora da estação.'].join('\n'));
    setPasso('confirmar');
  };

  const reenviar = async () => {
    eu('Confirmar');
    setPasso('gravando');
    let ok = 0;
    const erros: string[] = [];
    for (const t of falhas) {
      const { data, error } = await supabase.rpc('enqueue_print_ticket', {
        p_tenant_id: user!.tenantId,
        p_order_id: t.order_id,
        p_order_number: t.order_number ?? '',
        p_station_key: t.station_key ?? '',
        p_station_label: t.station_label ?? '',
        p_content_type: t.content_type ?? 'ticket_json',
        p_payload: t.payload ?? {},
        p_paper_style: t.paper_style ?? '80mm',
        p_force: false,
      });
      if (error) { erros.push(`#${t.order_number ?? '—'}: ${error.message}`); continue; }
      const novoId = data as string | null;
      const impId = t.impressora_id || (t.payload?.impressora_id as string | undefined);
      if (novoId && impId) {
        await supabase.from('print_queue').update({ impressora_id: impId }).eq('id', novoId);
      }
      ok++;
    }
    bot(erros.length
      ? `${ok ? `✅ ${ok} reenviado(s).\n` : ''}❌ ${erros.length} não foram:\n${erros.slice(0, 5).join('\n')}`
      : `✅ ${ok} ticket(s) de volta na fila. Se o agente estiver ligado, saem em segundos.`);
    setFalhas([]);
    setPasso('fim');
  };

  return (
    <Roteiro titulo="Impressora parada" icone="ri-printer-line" cor="bg-sky-50 text-sky-600" baloes={baloes}
      carregando={passo === 'carregando' || passo === 'gravando'} textoCarregando={passo === 'gravando' ? 'Reenviando…' : 'Lendo a fila de impressão…'}
      onFechar={onFechar} travarFechar={passo === 'gravando'}>
      {passo === 'menu' && (
        <>
          <Opcao onClick={pedirConfirmacao}>Reenviar os que falharam ({falhas.length})</Opcao>
          <OpcaoNeutra onClick={() => { eu('Agora não'); setPasso('fim'); }}>Agora não</OpcaoNeutra>
        </>
      )}
      {passo === 'confirmar' && (
        <>
          <Opcao onClick={reenviar}>Confirmar reenvio</Opcao>
          <OpcaoNeutra onClick={() => { eu('Voltar'); bot('Ok, nada reenviado.'); setPasso('menu'); }}>Voltar</OpcaoNeutra>
        </>
      )}
      {passo === 'fim' && (
        <Fim onFechar={onFechar} acoes={[
          { label: 'Ver a fila de novo', onClick: () => { eu('Ver de novo'); carregar(); } },
          { label: 'Abrir Gestor de Pedidos', onClick: () => irPara('/gestor-pedidos') },
        ]} />
      )}
    </Roteiro>
  );
}
