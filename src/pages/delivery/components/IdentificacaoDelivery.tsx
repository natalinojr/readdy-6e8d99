import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
interface Props {
  phone: string;
  onPhoneChange: (v: string) => void;
  onBuscar: () => void;
  enviando: boolean;
  error: string;
  city?: string;
  tenantName?: string;
  /** Logo da loja (Configurações → Dados da Loja). Ausente = iniciais. */
  logoUrl?: string | null;
  /** Volta para a vitrine/cardápio (quando o cliente chegou pela tela de preview). */
  onVoltar?: () => void;
  /** Seletor de idioma — precisa estar aqui tambem, esta e a PRIMEIRA tela de
   *  quem ja tem cadastro. Botao que so aparece depois nao serve pro estrangeiro. */
  seletorIdioma?: ReactNode;
}

export default function IdentificacaoDelivery(props: Props) {
  const { t } = useTranslation();
  const phone = props.phone;
  const onPhoneChange = props.onPhoneChange;
  const onBuscar = props.onBuscar;
  const enviando = props.enviando;
  const error = props.error;
  const city = props.city;
  const tenantName = props.tenantName;

  function formatPhone(value: string) {
    const digits = value.replace(/\D/g, '').slice(0, 11);
    if (digits.length <= 2) return digits;
    if (digits.length <= 7) return '(' + digits.slice(0, 2) + ') ' + digits.slice(2);
    return '(' + digits.slice(0, 2) + ') ' + digits.slice(2, 7) + '-' + digits.slice(7);
  }

  function handleChange(val: string) {
    onPhoneChange(formatPhone(val));
  }

  function handleSubmit() {
    const digits = phone.replace(/\D/g, '');
    if (digits.length < 10) return;
    onBuscar();
  }

  const digitsOnly = phone.replace(/\D/g, '');
  const isValid = digitsOnly.length >= 10;

  // Iniciais da loja para o "logo" (mesma linguagem do header do cardápio / modo de entrega)
  const iniciais = (tenantName || 'DL')
    .split(/\s+/)
    .slice(0, 2)
    .map(function (w) { return w.charAt(0); })
    .join('')
    .toUpperCase();

  return (
    <div className="min-h-screen flex flex-col bg-[#FBF8F4]">
      {/* Cabeçalho: voltar + loja + idioma (mesmo padrão da sacola) */}
      <div className="flex items-center gap-2.5 px-3 py-2.5 border-b border-stone-200/70">
        {props.onVoltar ? (
          <button
            type="button"
            onClick={props.onVoltar}
            aria-label={t('cliente.voltarCardapio')}
            className="w-11 h-11 flex items-center justify-center rounded-full text-stone-900 hover:bg-stone-100 cursor-pointer shrink-0"
          >
            <i className="ri-arrow-left-s-line text-2xl" />
          </button>
        ) : null}
        <div className="w-9 h-9 rounded-full bg-white border border-stone-200 overflow-hidden flex items-center justify-center shrink-0">
          {props.logoUrl ? (
            <img src={props.logoUrl} alt={tenantName || 'Logo'} className="w-full h-full object-cover" />
          ) : (
            <span className="text-[var(--cor-loja)] font-black text-xs">{iniciais}</span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-extrabold text-stone-900 truncate">{tenantName || 'Delivery'}</p>
          <p className="text-xs text-stone-500">{t('cliente.pecaOnline')}</p>
        </div>
        {props.seletorIdioma}
      </div>

      <div className="flex-1 px-5 pt-8 pb-8 max-w-lg mx-auto w-full">
        <h1 className="text-2xl font-extrabold tracking-tight text-stone-900">{t('cliente.qualCelular')}</h1>
        <p className="text-sm text-stone-600 mt-1.5">
          {city ? t('cliente.receberEm', { cidade: city }) : t('cliente.digiteNumero')}
        </p>

        <label htmlFor="ident-tel" className="block text-[13px] font-semibold text-stone-700 mt-6">
          {t('cliente.seuWhats')}
        </label>
        <input
          id="ident-tel"
          type="tel"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="tel-national"
          value={phone}
          onChange={function (e) { handleChange(e.target.value); }}
          onKeyDown={function (e) { if (e.key === 'Enter') handleSubmit(); }}
          placeholder="(41) 99999-9999"
          maxLength={15}
          className="mt-1.5 w-full h-12 px-3.5 text-[15px] bg-white border border-stone-300 rounded-xl text-stone-900 placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-[color:var(--cor-loja-suave)] focus:border-[var(--cor-loja)]"
        />
        <p className="text-xs text-stone-500 mt-2">{t('cliente.jaPediuAntes')}</p>

        {error ? (
          <div role="alert" className="flex items-start gap-2 px-4 py-3 mt-4 bg-red-50 rounded-xl">
            <i className="ri-error-warning-line text-red-600 text-base leading-none mt-0.5" />
            <p className="text-sm text-red-800">{error}</p>
          </div>
        ) : null}

        <button
          type="button"
          onClick={handleSubmit}
          disabled={!isValid || enviando}
          className="mt-6 w-full h-14 rounded-2xl bg-[var(--cor-loja)] hover:bg-[var(--cor-loja-forte)] text-white text-base font-bold cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {enviando ? (
            <>
              <i className="ri-loader-4-line animate-spin" />
              {t('cliente.buscando')}
            </>
          ) : (
            <>
              {t('cliente.continuar')}
              <i className="ri-arrow-right-line" />
            </>
          )}
        </button>

        <p className="text-center text-xs text-stone-500 mt-3">
          <i className="ri-lock-line mr-1" />
          {t('cliente.dadosSalvos')}
        </p>
      </div>
    </div>
  );
}
