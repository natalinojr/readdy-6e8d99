import { useState } from 'react';

interface Props {
  customerName: string;
  phone: string;
  tenantName?: string;
  onSelecionar: (modo: 'entrega' | 'retirada') => void;
  enviando: boolean;
  waUrl?: string;
  /** Cliente já cadastrado? Se NÃO, pedimos o nome aqui (vale p/ delivery e retirada). */
  isExistingCustomer: boolean;
  onNomeChange: (v: string) => void;
}

export default function ModoEntregaDelivery(props: Props) {
  const customerName = props.customerName;
  const phone = props.phone;
  const tenantName = props.tenantName;
  const onSelecionar = props.onSelecionar;
  const enviando = props.enviando;
  const waUrl = props.waUrl;
  const isExistingCustomer = props.isExistingCustomer;
  const onNomeChange = props.onNomeChange;

  // O nome é digitado pelo cliente — o sistema NUNCA assume um nome. Para cliente novo,
  // exigimos o nome antes de escolher como receber (inclusive na retirada, que antes
  // pulava essa etapa e gravava "Cliente Retirada" sozinho).
  const [nomeErro, setNomeErro] = useState(false);
  const precisaNome = !isExistingCustomer;
  const nomeOk = customerName.trim().length > 0;

  // Design "Opção 2": grid de seleção + botão "Ver o cardápio"
  const [modoSel, setModoSel] = useState<'entrega' | 'retirada'>('entrega');

  // Iniciais da loja para o "logo" (mesma linguagem do header do cardápio)
  const iniciais = (tenantName || 'DL')
    .split(/\s+/)
    .slice(0, 2)
    .map(function (w) { return w.charAt(0); })
    .join('')
    .toUpperCase();

  const primeiroNome = customerName.trim().split(' ')[0];

  function continuar() {
    if (precisaNome && !nomeOk) { setNomeErro(true); return; }
    onSelecionar(modoSel);
  }

  return (
    <div className="min-h-screen flex flex-col bg-white">
      {/* Hero gradiente — mesma identidade do header do cardápio */}
      <div className="relative bg-gradient-to-br from-amber-500 via-orange-500 to-orange-600 px-4 pt-6 pb-14 shrink-0">
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ background: 'radial-gradient(circle at 85% -20%, rgba(255,255,255,.25), transparent 45%)' }}
        />
        <div className="relative flex items-center gap-3 max-w-lg mx-auto w-full">
          <div className="w-10 h-10 flex items-center justify-center bg-white rounded-2xl shadow-md shrink-0">
            <span className="text-orange-600 font-black text-sm">{iniciais}</span>
          </div>
          <div className="min-w-0">
            <h1 className="text-white text-sm font-black leading-tight truncate">{tenantName || 'Delivery'}</h1>
            <p className="text-white/80 text-[11px]">{phone}</p>
          </div>
        </div>
        <div className="relative text-center mt-5">
          <h2 className="text-white text-xl font-black">
            {isExistingCustomer && primeiroNome ? 'Olá, ' + primeiroNome + '! 👋' : 'Bem-vindo! 👋'}
          </h2>
          <p className="text-white/85 text-xs mt-1">Como você quer receber seu pedido?</p>
        </div>
      </div>

      {/* Sheet branca sobreposta */}
      <div className="flex-1 -mt-8 relative z-10 bg-white rounded-t-3xl px-4 pt-5 pb-8">
        <div className="w-10 h-1 bg-zinc-200 rounded-full mx-auto mb-5" />

        <div className="max-w-lg mx-auto w-full">
          {/* Nome (cliente novo) — o cliente digita; o sistema não assume nenhum nome */}
          {precisaNome ? (
            <div className="mb-4">
              <label className="block text-xs font-bold text-zinc-600 mb-1.5">
                Seu nome <span className="text-red-500">*</span>{' '}
                <span className="font-semibold text-zinc-400">(só no primeiro pedido)</span>
              </label>
              <input
                type="text"
                value={customerName}
                onChange={function (e) { onNomeChange(e.target.value); if (nomeErro && e.target.value.trim()) setNomeErro(false); }}
                placeholder="Ex: João Silva"
                maxLength={60}
                className={'w-full px-3.5 py-2.5 text-sm border-[1.5px] rounded-2xl focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent transition-all ' +
                  (nomeErro ? 'border-red-300 bg-red-50/40' : 'border-zinc-200')}
              />
              {nomeErro ? (
                <p className="text-[11px] text-red-500 font-medium mt-1.5">Digite seu nome para continuar.</p>
              ) : null}
            </div>
          ) : null}

          {/* Grid de modos */}
          <div className="grid grid-cols-2 gap-2.5">
            {/* Delivery */}
            <button
              type="button"
              onClick={function () { setModoSel('entrega'); }}
              className={'relative rounded-[20px] border-[1.5px] px-3 py-4 text-center cursor-pointer transition-all ' +
                (modoSel === 'entrega'
                  ? 'border-amber-400 bg-gradient-to-b from-amber-50 to-white shadow-lg shadow-amber-500/15'
                  : 'border-zinc-100 bg-white hover:border-zinc-200')}
            >
              {modoSel === 'entrega' ? (
                <span className="absolute top-2.5 right-2.5 w-5 h-5 flex items-center justify-center bg-amber-500 rounded-full">
                  <i className="ri-check-line text-white text-[11px]" />
                </span>
              ) : null}
              <div
                className="w-14 h-14 mx-auto mb-2.5 flex items-center justify-center rounded-2xl bg-gradient-to-br from-amber-500 to-orange-500"
                style={{ boxShadow: '0 6px 14px rgba(245,158,11,.35)' }}
              >
                <i className="ri-e-bike-2-line text-white text-[26px]" />
              </div>
              <h3 className="text-sm font-black text-zinc-900">Delivery</h3>
              <p className="text-[10.5px] text-zinc-500 mt-0.5 leading-snug">O motoboy leva até você</p>
              <span className="inline-flex items-center gap-1 mt-2 px-2 py-1 bg-amber-50 text-amber-700 text-[10px] font-bold rounded-full">
                <i className="ri-truck-line text-[10px]" />
                Taxa de entrega
              </span>
            </button>

            {/* Retirada */}
            <button
              type="button"
              onClick={function () { setModoSel('retirada'); }}
              className={'relative rounded-[20px] border-[1.5px] px-3 py-4 text-center cursor-pointer transition-all ' +
                (modoSel === 'retirada'
                  ? 'border-amber-400 bg-gradient-to-b from-amber-50 to-white shadow-lg shadow-amber-500/15'
                  : 'border-zinc-100 bg-white hover:border-zinc-200')}
            >
              {modoSel === 'retirada' ? (
                <span className="absolute top-2.5 right-2.5 w-5 h-5 flex items-center justify-center bg-amber-500 rounded-full">
                  <i className="ri-check-line text-white text-[11px]" />
                </span>
              ) : null}
              <div
                className="w-14 h-14 mx-auto mb-2.5 flex items-center justify-center rounded-2xl bg-gradient-to-br from-green-500 to-emerald-600"
                style={{ boxShadow: '0 6px 14px rgba(16,185,129,.3)' }}
              >
                <i className="ri-store-2-line text-white text-[26px]" />
              </div>
              <h3 className="text-sm font-black text-zinc-900">Retirada</h3>
              <p className="text-[10.5px] text-zinc-500 mt-0.5 leading-snug">Você busca na loja</p>
              <span className="inline-flex items-center gap-1 mt-2 px-2 py-1 bg-green-50 text-green-700 text-[10px] font-bold rounded-full">
                <i className="ri-check-line text-[10px]" />
                Sem taxa
              </span>
            </button>
          </div>

          {/* Continuar */}
          <button
            type="button"
            onClick={continuar}
            disabled={enviando}
            className="w-full mt-3.5 py-3.5 rounded-2xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white text-sm font-black cursor-pointer transition-all disabled:opacity-60 disabled:cursor-wait flex items-center justify-center gap-2"
            style={{ boxShadow: '0 6px 16px rgba(245,158,11,.35)' }}
          >
            {enviando ? (
              <>
                <i className="ri-loader-4-line animate-spin" />
                Preparando...
              </>
            ) : (
              <>
                <i className="ri-restaurant-2-line" />
                Ver o cardápio
              </>
            )}
          </button>

          {/* Falar com a gente — barra discreta */}
          {waUrl ? (
            <a
              href={waUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3.5 w-full flex items-center justify-center gap-2 py-3 rounded-2xl bg-green-50 border border-green-200 text-green-700 text-xs font-bold hover:bg-green-100 transition-colors"
            >
              <i className="ri-whatsapp-line text-[15px]" />
              Dúvidas? Falar com a gente no WhatsApp
            </a>
          ) : null}

          <p className="text-center text-[10.5px] text-zinc-400 mt-3">
            <i className="ri-information-line mr-0.5" />
            Você pode trocar entre entrega e retirada depois, no cardápio
          </p>
        </div>
      </div>
    </div>
  );
}
