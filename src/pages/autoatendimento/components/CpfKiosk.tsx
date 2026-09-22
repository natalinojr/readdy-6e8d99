// CPF na nota — passo opcional do totem. Só aparece quando a loja emite NFC-e no
// balcão (fiscal_settings.enabled + emit_on_counter): o CPF digitado aqui vai no
// pedido (orders.customer_cpf) e a nota automática sai identificada.
// Aceita CPF (11) e CNPJ (14) — nota de empresa é o mesmo campo.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isValidCpfCnpj, mascaraCpfCnpj, tipoDoc } from '@/lib/cpfCnpj';

interface Props {
  total: number;
  onContinuar: (cpf: string | null) => void;
  onVoltar: () => void;
}

const fmt = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

export default function CpfKiosk({ total, onContinuar, onVoltar }: Props) {
  const { t } = useTranslation();
  const [digitos, setDigitos] = useState('');
  const [erro, setErro] = useState('');

  const ehCnpj = tipoDoc(digitos) === 'CNPJ' || digitos.length > 11;
  const completo = digitos.length === 11 || digitos.length === 14;
  const valido = completo && isValidCpfCnpj(digitos);

  const teclar = (d: string) => {
    setErro('');
    if (d === '⌫') { setDigitos((v) => v.slice(0, -1)); return; }
    setDigitos((v) => (v + d).slice(0, 14));
  };

  const confirmar = () => {
    if (!valido) {
      setErro(digitos.length < 11 ? t('cliente.cpfFaltamDigitos') : t('cliente.cpfInvalido'));
      return;
    }
    onContinuar(digitos);
  };

  return (
    <div className="flex flex-col items-center justify-center h-full p-4 text-center overflow-hidden portrait:overflow-y-auto portrait:py-6">
      {/* Tablet deitado: duas colunas. Tablet em pé: explicação em cima, teclado embaixo. */}
      <div className="flex portrait:flex-col items-center gap-6 portrait:gap-4 w-full max-w-3xl portrait:max-w-sm">

        {/* Coluna esquerda — explicação */}
        <div className="flex-1 portrait:flex-none flex flex-col gap-3 text-left portrait:text-center portrait:items-center">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 flex items-center justify-center bg-amber-500/20 rounded-2xl flex-shrink-0">
              <i className="ri-file-text-line text-2xl text-amber-400" />
            </div>
            <h2 className="text-2xl font-black text-white">{t('cliente.cpfNaNota')}</h2>
          </div>
          <p className="text-zinc-400 text-base">{t('cliente.cpfExplicacao')}</p>
          <div className="bg-zinc-800 rounded-2xl px-6 py-3 self-start portrait:self-center">
            <p className="text-zinc-400 text-sm mb-0.5">{t('cliente.totalPedido')}</p>
            <p className="text-amber-400 font-black text-2xl">{fmt(total)}</p>
          </div>
        </div>

        {/* Coluna direita — display + teclado */}
        <div className="flex flex-col items-center gap-2 portrait:w-full">
          <div className="w-64 portrait:w-full bg-zinc-800 rounded-2xl px-3 py-3 text-center border border-zinc-700 overflow-hidden">
            <p className="text-zinc-500 text-xs font-semibold mb-1">
              {ehCnpj ? 'CNPJ' : 'CPF'}
            </p>
            {/* CNPJ formatado tem 18 caracteres: em uma linha só, com fonte menor,
                senão o final ("-75") some na borda do display. */}
            <p className={`font-black leading-none whitespace-nowrap tracking-tight ${
              !digitos ? 'text-zinc-600 text-xl portrait:text-2xl' : ehCnpj ? 'text-white text-xl portrait:text-2xl' : 'text-white text-2xl portrait:text-3xl'
            }`}>
              {digitos ? mascaraCpfCnpj(digitos) : '000.000.000-00'}
            </p>
            {erro && <p className="text-red-400 text-sm mt-1 font-semibold">{erro}</p>}
          </div>

          <div className="grid grid-cols-3 gap-1.5">
            {['1','2','3','4','5','6','7','8','9','','0','⌫'].map((d, i) => (
              <button
                key={i}
                onClick={() => teclar(d)}
                disabled={d === ''}
                className={`w-20 h-14 portrait:w-24 portrait:h-16 portrait:text-2xl flex items-center justify-center rounded-xl text-xl font-bold cursor-pointer transition-all select-none ${
                  d === ''
                    ? 'opacity-0 pointer-events-none'
                    : d === '⌫'
                    ? 'bg-zinc-700 hover:bg-zinc-600 text-zinc-300 border border-zinc-600'
                    : 'bg-zinc-800 hover:bg-zinc-700 active:bg-zinc-600 text-white border border-zinc-700'
                }`}
              >
                {d === '⌫' ? <i className="ri-delete-back-2-line text-xl" /> : d}
              </button>
            ))}
          </div>

          <div className="flex gap-2 w-full">
            <button onClick={onVoltar}
              className="px-4 py-3 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-bold text-base rounded-xl cursor-pointer whitespace-nowrap transition-colors">
              <i className="ri-arrow-left-line mr-1" />
              {t('cliente.voltar')}
            </button>
            <button
              onClick={confirmar}
              disabled={!completo}
              className="flex-1 py-3 bg-amber-500 hover:bg-amber-400 disabled:opacity-40 disabled:cursor-not-allowed text-zinc-950 text-xl font-black rounded-xl cursor-pointer active:scale-95 transition-all whitespace-nowrap"
            >
              <i className="ri-checkbox-circle-line mr-1" />
              {t('cliente.confirmar')}
            </button>
          </div>

          {/* Sem CPF é o caminho normal: fica sempre à mão, sem precisar apagar o que digitou */}
          <button
            onClick={() => onContinuar(null)}
            className="w-full py-3 bg-zinc-800/60 hover:bg-zinc-700 text-zinc-300 font-bold text-base rounded-xl cursor-pointer active:scale-95 transition-all whitespace-nowrap"
          >
            {t('cliente.semCpf')}
          </button>
        </div>
      </div>
    </div>
  );
}
