import { useState } from 'react';

// ── "Pagar de outra forma" para um pedido segurado (Pix pelo app) ────────────
// Usado na tela do pedido (abaixo do painel do Pix) e no acompanhamento. O cliente
// escolhe dinheiro (troco opcional) ou cartão; quem libera o pedido pra cozinha é
// `delivery-write › change_held_payment`, chamado por `onConfirmar`.

export interface MetodoAlternativo { key: string; label: string; icon: string }

interface Props {
  metodos: MetodoAlternativo[];
  orderTotal: number;
  modoEntrega: 'entrega' | 'retirada';
  /** Texto do link que abre o seletor */
  labelAbrir: string;
  onConfirmar: (metodoKey: string, cashAmount?: string) => Promise<boolean>;
}

export default function TrocarPagamentoDelivery(props: Props) {
  const { metodos, orderTotal, modoEntrega, labelAbrir, onConfirmar } = props;
  const [aberto, setAberto] = useState(false);
  const [metodo, setMetodo] = useState('');
  const [valorDinheiro, setValorDinheiro] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');

  if (metodos.length === 0) return null;

  async function confirmar() {
    if (!metodo) return;
    if (metodo === 'dinheiro' && valorDinheiro !== '' && (parseFloat(valorDinheiro) || 0) < orderTotal) {
      setErro('O valor em dinheiro precisa cobrir o total de R$ ' + orderTotal.toFixed(2));
      return;
    }
    setSalvando(true);
    setErro('');
    const ok = await onConfirmar(metodo, metodo === 'dinheiro' ? valorDinheiro : undefined);
    setSalvando(false);
    if (ok) setAberto(false);
    else setErro('Não foi possível trocar a forma de pagamento. Tente de novo.');
  }

  if (!aberto) {
    return (
      <button
        type="button"
        onClick={function () { setAberto(true); setMetodo(''); setValorDinheiro(''); setErro(''); }}
        className="w-full py-2.5 text-xs font-bold text-zinc-500 hover:text-zinc-700 underline cursor-pointer whitespace-nowrap"
      >
        {labelAbrir}
      </button>
    );
  }

  return (
    <div className="bg-zinc-50 border border-zinc-200 rounded-2xl p-3">
      <p className="text-xs font-bold text-zinc-700 mb-2">Como você prefere pagar {modoEntrega === 'retirada' ? 'na retirada' : 'na entrega'}?</p>
      <div className="space-y-1.5">
        {metodos.map(function (m) {
          const sel = metodo === m.key;
          return (
            <button
              key={m.key}
              type="button"
              onClick={function () { setMetodo(m.key); setValorDinheiro(''); setErro(''); }}
              className={'w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border text-left cursor-pointer transition-all ' +
                (sel ? 'bg-amber-50 border-amber-300 ring-2 ring-amber-200/50' : 'bg-white border-zinc-100 hover:border-zinc-200')}
            >
              <div className={'w-8 h-8 flex items-center justify-center rounded-lg shrink-0 ' + (sel ? 'bg-amber-500 text-white' : 'bg-zinc-100 text-zinc-400')}>
                <i className={m.icon + ' text-base'} />
              </div>
              <span className="text-sm font-bold text-zinc-700 flex-1">{m.label}</span>
              <div className={'w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ' + (sel ? 'bg-amber-500 border-amber-500' : 'border-zinc-200')}>
                {sel ? <i className="ri-check-line text-white text-[9px]" /> : null}
              </div>
            </button>
          );
        })}
      </div>
      {metodo === 'dinheiro' ? (
        <div className="mt-2">
          <label className="block text-[11px] font-bold text-zinc-600 mb-1">Troco para quanto? (opcional)</label>
          <div className="relative">
            <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-xs font-bold text-zinc-400">R$</span>
            <input
              type="number" inputMode="decimal" step="0.01" min="0"
              value={valorDinheiro}
              onChange={function (e) { setValorDinheiro(e.target.value); setErro(''); }}
              placeholder={orderTotal.toFixed(2)}
              className="w-full pl-9 pr-3 py-2 text-sm border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-300"
            />
          </div>
        </div>
      ) : null}
      {erro ? <p className="mt-2 text-[11px] text-red-600">{erro}</p> : null}
      <div className="flex gap-2 mt-3">
        <button type="button" onClick={function () { setAberto(false); }} disabled={salvando}
          className="flex-1 py-2 text-xs font-bold text-zinc-600 bg-white border border-zinc-200 rounded-xl cursor-pointer whitespace-nowrap disabled:opacity-50">
          Voltar
        </button>
        <button type="button" onClick={confirmar} disabled={!metodo || salvando}
          className="flex-1 py-2 text-xs font-bold text-white bg-amber-500 hover:bg-amber-600 rounded-xl cursor-pointer whitespace-nowrap disabled:opacity-40">
          {salvando ? 'Enviando…' : 'Confirmar e enviar pedido'}
        </button>
      </div>
    </div>
  );
}
