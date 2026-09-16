// Ação rápida: pausar / reabrir o delivery da loja ativa.
// Mesmo caminho do botão "Delivery" do PDV Caixa (DeliveryControle): hook useDeliveryState →
// Edge delivery-write get_delivery_state / set_delivery_state (op open|close|pause|resume).
// O hook avisa os outros dispositivos pelo canal delivery-state:<loja>. Poll desligado (0).
// Não há "tempo estimado" único na config: o prazo é por faixa de distância (Config Delivery).
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useDeliveryState, type DeliveryOp, type DeliveryState } from '@/hooks/useDeliveryState';
import { Roteiro, useRoteiro, Opcao, OpcaoNeutra, Fim, horaBR, type AcaoProps } from '../kit';

// Mesmas opções do DeliveryControle (PAUSAS_RAPIDAS)
const PAUSAS = [
  { label: '30 min', minutos: 30 },
  { label: '1 hora', minutos: 60 },
  { label: '2 horas', minutos: 120 },
  { label: '4 horas', minutos: 240 },
];

function statusTexto(s: DeliveryState): string {
  switch (s.reason) {
    case 'horario': return '🟢 Aberto pelo horário programado';
    case 'manual': return '🟢 Aberto manualmente';
    case 'pausado': return `⏸️ Pausado até ${horaBR(s.paused_until)}`;
    case 'fora_horario': return '⚪ Fechado, fora do horário programado';
    case 'fechado_manual': return '⚪ Fechado';
    case 'sem_sessao': return '⚪ Caixa fechado: sem caixa aberto o delivery fica sempre fechado';
    default: return s.open_now ? '🟢 Aberto' : '⚪ Fechado';
  }
}

type Pedido = { op: DeliveryOp; minutos?: number; rotulo: string };

export default function PausarDelivery({ onFechar, irPara }: AcaoProps) {
  const { user } = useAuth();
  const { state, refresh, setOp } = useDeliveryState(0);
  const { baloes, bot, eu } = useRoteiro();
  const [passo, setPasso] = useState<'carregando' | 'menu' | 'confirmar' | 'gravando' | 'fim'>('carregando');
  const [pedido, setPedido] = useState<Pedido | null>(null);
  const iniciou = useRef(false);
  const mostrouEstado = useRef(false);

  // Se o estado não chegar em 15 s (Edge fora / sem rede), avisa em vez de girar para sempre.
  const vigiar = () => setTimeout(() => {
    if (!mostrouEstado.current) { bot('Não consegui ler o estado do delivery. Tente pelo PDV Caixa.'); setPasso('fim'); }
  }, 15000);

  useEffect(() => {
    if (!iniciou.current) {
      iniciou.current = true;
      bot(`Loja: *${user?.loja || 'loja ativa'}*`);
      if (!user?.tenantId) { bot('Nenhuma loja ativa.'); setPasso('fim'); return; }
    }
    const t = vigiar(); // o hook já carrega ao montar
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!state || mostrouEstado.current) return;
    mostrouEstado.current = true;
    bot(`*Delivery agora*\n${statusTexto(state)}`);
    setPasso(state.has_session === false ? 'fim' : 'menu');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const pedir = (p: Pedido) => {
    eu(p.rotulo);
    setPedido(p);
    const resumo: Record<DeliveryOp, string> = {
      pause: `Pausar o delivery por ${p.rotulo.replace('Pausar ', '')}? Volta sozinho depois.`,
      close: state?.schedule_enabled && state?.within_schedule
        ? 'Fechar o delivery? Dentro do horário programado isso pausa até o fim da janela de hoje.'
        : 'Fechar o delivery? Fica fechado até alguém abrir.',
      open: state?.schedule_enabled && state?.reason === 'fora_horario'
        ? 'Abrir o delivery agora, fora do horário programado? Fica aberto até alguém fechar.'
        : 'Abrir o delivery agora?',
      resume: 'Cancelar a pausa e reabrir o delivery?',
      force_off: '',
    };
    bot(resumo[p.op]);
    setPasso('confirmar');
  };

  const gravar = async () => {
    if (!pedido) return;
    eu('Confirmar');
    setPasso('gravando');
    const r = await setOp(pedido.op, pedido.minutos) as { error?: string; open_now?: boolean; reason?: string; paused_until?: string | null } | null | undefined;
    if (!r || r.error) {
      bot(`❌ Não gravou: ${r?.error ?? 'sem resposta do servidor'}\nConfira o estado no PDV Caixa antes de tentar de novo.`);
    } else {
      bot(`✅ Feito.\n${statusTexto({ ...(state as DeliveryState), open_now: !!r.open_now, reason: r.reason ?? '', paused_until: r.paused_until ?? null })}`);
    }
    setPasso('fim');
  };

  const aberto = state?.open_now === true;

  return (
    <Roteiro titulo="Pausar delivery" icone="ri-e-bike-2-line" cor="bg-red-50 text-red-600" baloes={baloes}
      carregando={passo === 'carregando' || passo === 'gravando'} textoCarregando={passo === 'gravando' ? 'Gravando…' : 'Lendo o delivery…'}
      onFechar={onFechar} travarFechar={passo === 'gravando'}>
      {passo === 'menu' && state && (
        aberto ? (
          <>
            {PAUSAS.map((p) => (
              <Opcao key={p.minutos} onClick={() => pedir({ op: 'pause', minutos: p.minutos, rotulo: `Pausar ${p.label}` })}>Pausar {p.label}</Opcao>
            ))}
            <Opcao perigo onClick={() => pedir({ op: 'close', rotulo: 'Fechar delivery' })}>Fechar delivery</Opcao>
            <OpcaoNeutra onClick={onFechar}>Deixar como está</OpcaoNeutra>
          </>
        ) : (
          <>
            {state.reason === 'pausado' && <Opcao onClick={() => pedir({ op: 'resume', rotulo: 'Retomar (cancelar pausa)' })}>Retomar (cancelar pausa)</Opcao>}
            <Opcao onClick={() => pedir({ op: 'open', rotulo: 'Abrir delivery' })}>Abrir delivery</Opcao>
            <OpcaoNeutra onClick={onFechar}>Deixar como está</OpcaoNeutra>
          </>
        )
      )}
      {passo === 'confirmar' && (
        <>
          <Opcao perigo={pedido?.op === 'close' || pedido?.op === 'pause'} onClick={gravar}>Confirmar</Opcao>
          <OpcaoNeutra onClick={() => { eu('Voltar'); bot('Ok, nada alterado.'); setPasso('menu'); }}>Voltar</OpcaoNeutra>
        </>
      )}
      {passo === 'fim' && (
        <Fim onFechar={onFechar} acoes={[
          ...(state?.has_session !== false ? [{ label: 'Ver estado de novo', onClick: () => { mostrouEstado.current = false; setPasso('carregando'); vigiar(); refresh(); } }] : []),
          { label: 'Abrir PDV Caixa', onClick: () => irPara('/pdv/caixa') },
        ]} />
      )}
    </Roteiro>
  );
}
