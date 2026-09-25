// Janela depois de aprovar (2026-09-25): no lugar do alert do navegador. Com o Pix preparado,
// já pede o PIN e paga ali mesmo — o mesmo caminho do botão Pagar do 📥 (assistente-app ›
// pendencia_pagar + pay). "Pagar depois" deixa o cartão no 📥 do chat, como antes.
import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useVoltarFecha } from '@/lib/voltarAndroid';
import { brl } from '../api';

export interface AvisoPagamento {
  nome: string;
  valor: number;
  /** Pendência do Pix preparado: com ela a janela pede o PIN; sem ela só informa. */
  pendenciaId?: string | null;
  texto?: string;
}

interface Pagamento { id: string; status: string; status_label?: string; error?: string | null }

async function assistente<T>(action: string, extra: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('assistente-app', { body: { action, ...extra } });
  if (error) {
    let msg = error.message;
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === 'function') {
      try { const b = await ctx.json(); if (b?.error) msg = String(b.error); } catch { /* corpo não-JSON */ }
    }
    throw new Error(msg);
  }
  const resp = data as { success?: boolean; error?: string; data?: T } | null;
  if (!resp?.success) throw new Error(resp?.error || 'Falha na operação');
  return resp.data as T;
}

type Fase = 'pin' | 'enviando' | 'feito' | 'falhou' | 'info';

export default function JanelaPagamento({ aviso, onFechar }: { aviso: AvisoPagamento; onFechar: () => void }) {
  const [fase, setFase] = useState<Fase>(aviso.pendenciaId ? 'pin' : 'info');
  const [pin, setPin] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [resultado, setResultado] = useState<Pagamento | null>(null);
  const pagamentoId = useRef<string | null>(null);
  const ocupado = fase === 'enviando';

  useVoltarFecha(true, () => { if (!ocupado) onFechar(); }, 'janela-pagamento');
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape' && !ocupado) onFechar(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [ocupado, onFechar]);

  const pagar = async () => {
    if (!/^\d{4,8}$/.test(pin)) { setErro('O PIN tem de 4 a 8 números.'); return; }
    setErro(null);
    setFase('enviando');
    try {
      if (!pagamentoId.current) {
        const out = await assistente<{ payments: Pagamento[]; erros: string[] }>('pendencia_pagar', { id: aviso.pendenciaId });
        const pronto = out.payments.find((p) => ['draft', 'awaiting_pin'].includes(p.status));
        if (!pronto) throw new Error(out.erros?.[0] ?? 'O Pix não está mais pronto para pagar. Veja no 📥 do chat.');
        pagamentoId.current = pronto.id;
      }
      const { payment } = await assistente<{ payment: Pagamento }>('pay', { id: pagamentoId.current, op: 'ok', pin });
      setResultado(payment);
      setFase(['rejected', 'failed', 'expired'].includes(payment.status) ? 'falhou' : 'feito');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setPin('');
      // PIN errado: tenta de novo aqui mesmo. Outro erro (Inter recusou…): mostra e fecha.
      if (/PIN errado/i.test(msg) && !/Bloqueado/i.test(msg)) { setErro(msg); setFase('pin'); return; }
      setErro(msg);
      setFase('falhou');
    }
  };

  const enviado = resultado?.status === 'paid';
  const icone = fase === 'falhou' ? 'ri-error-warning-line' : fase === 'info' ? 'ri-information-line' : 'ri-check-line';
  const corIcone = fase === 'falhou' ? 'bg-red-100 text-red-600' : fase === 'info' ? 'bg-amber-100 text-amber-600' : 'bg-emerald-100 text-emerald-600';
  const titulo = fase === 'feito' ? (enviado ? 'Pix pago' : 'Pix enviado')
    : fase === 'falhou' ? 'O Pix não saiu'
    : fase === 'info' ? 'Pedido aprovado'
    : 'Aprovado! Agora é só pagar';

  return (
    <div className="fixed inset-0 z-[100] bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4" role="dialog" aria-modal="true"
      onClick={() => { if (!ocupado) onFechar(); }}>
      <div className="w-full sm:max-w-sm bg-white rounded-t-3xl sm:rounded-3xl p-6 shadow-2xl" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 24px)' }}
        onClick={(e) => e.stopPropagation()}>
        <div className="flex flex-col items-center text-center">
          <div className={`w-14 h-14 rounded-full flex items-center justify-center ${corIcone}`}>
            <i className={`${icone} text-3xl`} />
          </div>
          <p className="mt-3 text-lg font-black text-zinc-900">{titulo}</p>
          <p className="mt-1 text-sm text-zinc-500">{aviso.nome}</p>
          <p className="text-3xl font-black text-zinc-900 mt-1">{brl(aviso.valor)}</p>
        </div>

        {(fase === 'pin' || fase === 'enviando') && (
          <form className="mt-5" onSubmit={(e) => { e.preventDefault(); pagar(); }}>
            <label className="block text-sm font-semibold text-zinc-600 text-center mb-2">Confirme o Pix com o seu PIN</label>
            <input type="password" inputMode="numeric" autoComplete="one-time-code" autoFocus maxLength={8} value={pin} disabled={ocupado}
              onChange={(e) => { setPin(e.target.value.replace(/\D/g, '')); setErro(null); }}
              className="w-full text-center tracking-[0.5em] text-2xl font-bold border-2 border-zinc-200 focus:border-emerald-400 rounded-2xl py-3 outline-none" />
            {erro && <p className="mt-2 text-sm text-red-600 text-center">{erro}</p>}
            <button type="submit" disabled={ocupado || pin.length < 4}
              className="mt-4 w-full py-3.5 rounded-2xl bg-emerald-500 active:bg-emerald-600 disabled:bg-zinc-200 text-white font-bold flex items-center justify-center gap-2 cursor-pointer">
              {ocupado ? <><span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Enviando ao Inter…</> : <><i className="ri-lock-2-line" /> Pagar {brl(aviso.valor)}</>}
            </button>
            <button type="button" onClick={onFechar} disabled={ocupado}
              className="mt-2 w-full py-3 rounded-2xl text-zinc-500 text-sm font-semibold cursor-pointer">
              Pagar depois (fica no 📥 do chat)
            </button>
          </form>
        )}

        {fase === 'feito' && (
          <p className="mt-4 text-sm text-zinc-600 text-center bg-zinc-50 rounded-2xl px-4 py-3">
            {enviado ? 'Pago. A baixa da conta sai sozinha pelo extrato.' : 'Falta aprovar no app do Inter. Depois a baixa sai sozinha pelo extrato.'}
          </p>
        )}
        {fase === 'falhou' && (
          <p className="mt-4 text-sm text-red-700 text-center bg-red-50 rounded-2xl px-4 py-3">
            {erro ?? resultado?.error ?? resultado?.status_label ?? 'O Inter não aceitou o pagamento.'} O cartão ficou no 📥 do chat para tentar de novo.
          </p>
        )}
        {fase === 'info' && (
          <p className="mt-4 text-sm text-zinc-600 text-center bg-zinc-50 rounded-2xl px-4 py-3">{aviso.texto}</p>
        )}
        {(fase === 'feito' || fase === 'falhou' || fase === 'info') && (
          <button type="button" onClick={onFechar} autoFocus
            className="mt-4 w-full py-3.5 rounded-2xl bg-zinc-900 active:bg-zinc-800 text-white font-bold cursor-pointer">Pronto</button>
        )}
      </div>
    </div>
  );
}
