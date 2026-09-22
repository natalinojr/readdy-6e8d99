import { useState, useEffect, useRef } from 'react';
import { invokeWithAuth } from '@/lib/supabase';

// ── Cartão na maquininha (Mercado Pago Point em modo PDV) ───────────────────
// O tablet cria a cobrança; ela aparece sozinha no visor da maquininha ao lado e o
// cliente aproxima/insere o cartão lá. O tablet só acompanha: quem confirma é o
// Mercado Pago (consulta via edge `pix-payment`, igual ao Pix). Em modo TESTE (terminal
// virtual) aparecem botões para simular o resultado.

const fmt = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

type Estado = 'criando' | 'aguardando' | 'cancelando' | 'aprovado' | 'recusado' | 'expirado' | 'erro';

const MOTIVO: Record<string, string> = {
  insufficient_amount: 'Saldo ou limite insuficiente.',
  card_insufficient_amount: 'Saldo ou limite insuficiente.',
  bad_filled_card_data: 'Dados do cartão incorretos.',
  rejected_by_issuer: 'O banco do cartão recusou.',
  required_call_for_authorize: 'O banco do cartão pede autorização por telefone.',
  card_disabled: 'Cartão bloqueado ou desativado.',
  high_risk: 'Pagamento recusado por segurança.',
  max_attempts_exceeded: 'Muitas tentativas com este cartão.',
  canceled_on_terminal: 'Cancelado na maquininha.',
};

interface Props {
  total: number;
  tenantId: string;
  method: 'credit_card' | 'debit_card';
  onPago: (chargeId: string, methodType: string) => void;
  onVoltar: () => void;
}

export default function TelaCartaoKiosk({ total, tenantId, method, onPago, onVoltar }: Props) {
  const [estado, setEstado] = useState<Estado>('criando');
  const [erro, setErro] = useState('');
  const [sandbox, setSandbox] = useState(false);
  const [simulando, setSimulando] = useState(false);
  const [aviso, setAviso] = useState('');
  // A cobrança pode estar criada no Mercado Pago sem estar no visor: se a maquininha está com
  // a tela apagada, ela não acorda sozinha (medido na loja em 2026-09-22 — a cobrança ficava
  // em `created` e o cliente encarava uma tela preta achando que era o totem que travou).
  const [naMaquininha, setNaMaquininha] = useState(false);
  const [demorou, setDemorou] = useState(false);
  const chargeRef = useRef<string | null>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const onPagoRef = useRef(onPago);
  onPagoRef.current = onPago;
  const avisouPagoRef = useRef(false);
  // A cobrança fica VIVA na maquininha enquanto ninguém cancelar. Estes dois dizem se ainda
  // há algo a cancelar quando a tela sai do ar (inclusive pelo botão "Cancelar" do topo do
  // totem, que desmonta esta tela sem passar por handleVoltar).
  const vivaRef = useRef(false);
  const desistiuRef = useRef(false);

  const pararPolling = () => { if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null; } };

  // Fica perguntando ao Mercado Pago o que aconteceu com a cobrança (quem confirma é ele).
  const retomarPolling = (id: string) => {
    pararPolling();
    pollingRef.current = setInterval(async () => {
      try {
        const { data: st } = await invokeWithAuth<{ status?: string; method?: string; error?: string | null; point_status?: string | null }>('pix-payment', {
          body: { action: 'check_status', pix_payment_id: id },
        });
        if (st?.point_status === 'at_terminal') setNaMaquininha(true);
        if (st?.status === 'confirmed') {
          pararPolling();
          vivaRef.current = false;
          if (avisouPagoRef.current) return; // consulta paralela que também voltou "confirmed"
          avisouPagoRef.current = true;
          setEstado('aprovado');
          const tipo = st.method === 'debit_card' ? 'debit_card' : 'credit_card';
          setTimeout(() => onPagoRef.current(id, tipo), 3500);
        } else if (st?.status === 'failed') {
          pararPolling();
          vivaRef.current = false;
          setErro(MOTIVO[st.error ?? ''] ?? 'O pagamento não foi aprovado.');
          setEstado('recusado');
        } else if (st?.status === 'expired' || st?.status === 'cancelled') {
          pararPolling();
          vivaRef.current = false;
          setEstado('expirado');
        }
      } catch { /* tenta de novo no próximo ciclo */ }
    }, 2000);
  };

  // Cancela no Mercado Pago. Fire-and-forget: usado no unmount, onde não dá pra esperar.
  const cancelarNoProvedor = (id: string) =>
    invokeWithAuth<{ success?: boolean; status?: string; code?: string; method?: string }>('pix-payment', {
      body: { action: 'cancel', pix_payment_id: id },
    });

  const criar = async () => {
    pararPolling();
    desistiuRef.current = false;
    vivaRef.current = false;
    setEstado('criando');
    setErro('');
    setAviso('');
    setNaMaquininha(false);
    setDemorou(false);
    const { data, error } = await invokeWithAuth<{ pix_payment_id?: string; sandbox?: boolean }>('pix-payment', {
      body: { action: 'create_card_charge', tenant_id: tenantId, amount: total, method },
    });
    if (error || !data?.pix_payment_id) {
      setErro(error?.message || 'Não foi possível enviar a cobrança para a maquininha.');
      setEstado('erro');
      return;
    }
    chargeRef.current = data.pix_payment_id;
    vivaRef.current = true;
    const id = data.pix_payment_id;
    // Cliente desistiu enquanto a cobrança estava sendo criada: ela já nasceu na maquininha,
    // então tem que ser cancelada agora — senão o valor fica lá esperando alguém pagar.
    if (desistiuRef.current) {
      vivaRef.current = false;
      cancelarNoProvedor(id).catch(() => { /* vence sozinha em 15 min */ });
      return;
    }
    setSandbox(Boolean(data.sandbox));
    setEstado('aguardando');
    retomarPolling(id);
  };

  useEffect(() => {
    criar();
    // Saiu do ar sem pagar (botão "Cancelar" do topo, inatividade, troca de tela): cancela a
    // cobrança no Mercado Pago. Sem isto o valor continuava no visor da maquininha e alguém
    // podia pagar um pedido que não existe mais.
    return () => {
      pararPolling();
      desistiuRef.current = true;
      const id = chargeRef.current;
      if (!vivaRef.current || !id) return;
      vivaRef.current = false;
      cancelarNoProvedor(id).catch(() => { /* vence sozinha em 15 min */ });
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Demorou e ninguém pagou. Duas causas, as duas medidas na loja em 2026-09-22: a maquininha
  // não pegou a cobrança (tela apagada) OU pegou e não trouxe a tela para a frente — depois de
  // um cancelamento a Point fica na tela principal e a cobrança entra calada em "Vendas
  // vinculadas". Por isso o aviso não depende de `at_terminal`: nos dois casos a saída é a
  // mesma, tocar na maquininha.
  useEffect(() => {
    if (estado !== 'aguardando') return;
    const t = setTimeout(() => setDemorou(true), 8000);
    return () => clearTimeout(t);
  }, [estado]);

  // Sair: só libera a tela DEPOIS que a maquininha soltar o valor. Antes o totem voltava na
  // hora e a cobrança continuava no visor — o cliente escolhia outra forma e corria o risco de
  // pagar duas vezes. Se o Mercado Pago recusar o cancelamento (cartão já passado no
  // terminal), a tela continua esperando a confirmação.
  const handleVoltar = async () => {
    const id = chargeRef.current;
    if (!id || estado === 'recusado' || estado === 'expirado' || estado === 'erro') {
      desistiuRef.current = true;
      onVoltar();
      return;
    }
    pararPolling();
    desistiuRef.current = true;
    setEstado('cancelando');
    setAviso('');
    try {
      const { data, error } = await cancelarNoProvedor(id);
      if (error || !data) throw error ?? new Error('sem resposta');
      if (data?.status === 'confirmed') {
        vivaRef.current = false;
        avisouPagoRef.current = true;
        setEstado('aprovado');
        setTimeout(() => onPagoRef.current(id, data.method === 'debit_card' ? 'debit_card' : 'credit_card'), 3500);
        return;
      }
      if (data?.code === 'at_terminal' || (data?.success === false && data?.status === 'pending')) {
        // O cartão já foi passado: não dá pra desistir, o pagamento vale.
        desistiuRef.current = false;
        setAviso('O cartão já está sendo processado na maquininha. Aguarde a confirmação.');
        setEstado('aguardando');
        retomarPolling(id);
        return;
      }
      vivaRef.current = false;
      onVoltar();
    } catch {
      // Sem resposta do servidor: não solta a tela às cegas (a cobrança pode estar viva).
      desistiuRef.current = false;
      setAviso('Não foi possível falar com a maquininha. Se o valor sumir do visor, escolha outra forma.');
      setEstado('aguardando');
      retomarPolling(id);
    }
  };

  const simular = async (outcome: 'approved_credit' | 'approved_debit' | 'declined') => {
    if (!chargeRef.current || simulando) return;
    setSimulando(true);
    await invokeWithAuth('pix-payment', { body: { action: 'simulate_card', pix_payment_id: chargeRef.current, outcome } });
    setSimulando(false);
  };

  const rotulo = method === 'debit_card' ? 'débito' : 'crédito';
  // A cobrança existe no Mercado Pago, mas nenhuma maquininha pegou: manda acordar a tela em
  // vez de pedir o cartão numa máquina apagada.
  const precisaAcordar = estado === 'aguardando' && demorou && !naMaquininha;
  // Pegou a cobrança mas o cliente continua parado: a tela dela provavelmente não abriu.
  const naoAbriu = estado === 'aguardando' && demorou && naMaquininha;

  if (estado === 'aprovado') {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 p-6 text-center">
        <div className="relative">
          <div className="w-24 h-24 md:w-32 md:h-32 flex items-center justify-center bg-emerald-500/20 rounded-full">
            <i className="ri-checkbox-circle-fill text-6xl md:text-8xl text-emerald-400" />
          </div>
          <div className="absolute inset-0 rounded-full border-4 border-emerald-500/30 animate-ping" />
        </div>
        <div>
          <h3 className="text-3xl md:text-5xl font-black text-white">Pagamento aprovado!</h3>
          <p className="text-emerald-400 font-semibold text-base md:text-xl mt-1">Pode retirar o cartão</p>
        </div>
        <p className="text-amber-400 font-black text-4xl md:text-5xl">{fmt(total)}</p>
        <div className="flex gap-2 items-center bg-zinc-800 px-4 py-2 rounded-xl">
          <div className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse" />
          <p className="text-zinc-300 text-base md:text-lg">Registrando pedido...</p>
        </div>
      </div>
    );
  }

  if (estado === 'recusado' || estado === 'expirado' || estado === 'erro') {
    const titulo = estado === 'recusado' ? 'Pagamento não aprovado' : estado === 'expirado' ? 'A cobrança expirou' : 'Maquininha indisponível';
    const texto = estado === 'expirado' ? 'O tempo para pagar na maquininha acabou.' : erro;
    return (
      <div className="flex flex-col items-center justify-center h-full gap-5 p-6 text-center">
        <div className="w-16 h-16 md:w-24 md:h-24 flex items-center justify-center bg-red-500/10 rounded-2xl">
          <i className="ri-bank-card-line text-3xl md:text-5xl text-red-400" />
        </div>
        <div>
          <h3 className="text-xl md:text-4xl font-black text-white mb-1">{titulo}</h3>
          <p className="text-zinc-400 text-sm md:text-xl max-w-md">{texto}</p>
        </div>
        <div className="flex gap-3">
          <button onClick={onVoltar} className="px-5 md:px-8 py-3 md:py-4 bg-zinc-700 hover:bg-zinc-600 text-white font-semibold text-sm md:text-lg rounded-xl cursor-pointer whitespace-nowrap">
            Escolher outra forma
          </button>
          {estado !== 'erro' || erro ? (
            <button onClick={criar} className="px-5 md:px-8 py-3 md:py-4 bg-amber-500 hover:bg-amber-400 text-zinc-950 font-bold text-sm md:text-lg rounded-xl cursor-pointer whitespace-nowrap">
              Tentar de novo
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center h-full gap-5 md:gap-6 p-5 md:p-8 text-center">
      <div className="relative">
        <div className="w-20 h-20 md:w-28 md:h-28 flex items-center justify-center bg-amber-500/15 rounded-2xl">
          <i className="ri-bank-card-line text-4xl md:text-6xl text-amber-400" />
        </div>
        {estado === 'aguardando' && <div className="absolute -inset-2 rounded-3xl border-2 border-amber-500/40 animate-pulse" />}
      </div>
      <div>
        <h2 className="text-2xl md:text-5xl font-black text-white">
          {estado === 'criando' ? 'Enviando para a maquininha…'
            : estado === 'cancelando' ? 'Cancelando na maquininha…'
            : precisaAcordar ? 'Toque na tela da maquininha'
            : 'Pague na maquininha ao lado'}
        </h2>
        <p className="text-zinc-400 text-base md:text-2xl mt-2">
          {estado === 'criando' ? 'Só um instante'
            : estado === 'cancelando' ? 'Aguarde o valor sair do visor'
            : precisaAcordar ? 'Ela está com a tela apagada. Toque nela e o valor aparece.'
            : `Aproxime ou insira o cartão de ${rotulo}`}
        </p>
      </div>
      {naoAbriu && !aviso && (
        <p className="max-w-md text-amber-400 text-sm md:text-xl bg-amber-500/10 border border-amber-500/30 rounded-xl px-4 py-3">
          A maquininha não abriu sozinha? <span className="font-bold">Toque na tela dela</span> que o valor aparece.
        </p>
      )}
      {aviso && (
        <p className="max-w-md text-amber-400 text-sm md:text-lg bg-amber-500/10 border border-amber-500/30 rounded-xl px-4 py-3">
          {aviso}
        </p>
      )}
      <p className="text-zinc-400 text-sm md:text-2xl">Total: <span className="text-amber-400 font-black">{fmt(total)}</span></p>
      <div className="flex justify-center gap-2">
        {[0, 1, 2].map((i) => (
          <div key={i} className="w-3 h-3 md:w-4 md:h-4 bg-amber-500 rounded-full animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
        ))}
      </div>

      {sandbox && estado === 'aguardando' && (
        <div className="w-full max-w-md border border-dashed border-sky-500/50 rounded-xl p-3">
          <p className="text-sky-400 text-xs font-bold uppercase tracking-wide mb-2">Modo teste — maquininha virtual</p>
          <div className="grid grid-cols-3 gap-2">
            <button disabled={simulando} onClick={() => simular('approved_credit')} className="py-2 text-xs font-semibold rounded-lg bg-emerald-600/80 hover:bg-emerald-600 text-white cursor-pointer disabled:opacity-50">Aprovar crédito</button>
            <button disabled={simulando} onClick={() => simular('approved_debit')} className="py-2 text-xs font-semibold rounded-lg bg-emerald-600/80 hover:bg-emerald-600 text-white cursor-pointer disabled:opacity-50">Aprovar débito</button>
            <button disabled={simulando} onClick={() => simular('declined')} className="py-2 text-xs font-semibold rounded-lg bg-red-600/80 hover:bg-red-600 text-white cursor-pointer disabled:opacity-50">Recusar</button>
          </div>
          <p className="text-zinc-500 text-[11px] mt-2">O resultado leva até 10 s para chegar, como numa maquininha de verdade.</p>
        </div>
      )}

      <button onClick={handleVoltar} disabled={estado === 'cancelando'}
        className="px-8 md:px-12 py-3 md:py-4 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 font-semibold text-sm md:text-xl rounded-xl cursor-pointer whitespace-nowrap disabled:opacity-50">
        {estado === 'cancelando' ? 'Cancelando…' : 'Escolher outra forma'}
      </button>
    </div>
  );
}
