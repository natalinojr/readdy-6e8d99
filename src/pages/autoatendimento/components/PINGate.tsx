import { useState } from 'react';

const PIN_ATIVO_KEY = 'erpos_kiosk_pin_ativo';
const PIN_KEY = 'erpos_kiosk_pin';

export function isPINAtivo(): boolean {
  return localStorage.getItem(PIN_ATIVO_KEY) === 'true';
}

export function getPIN(): string {
  return localStorage.getItem(PIN_KEY) ?? '';
}

export function setPINAtivo(ativo: boolean, pin?: string) {
  localStorage.setItem(PIN_ATIVO_KEY, ativo ? 'true' : 'false');
  if (pin !== undefined) localStorage.setItem(PIN_KEY, pin);
}

interface Props {
  onUnlock: () => void;
}

export default function PINGate({ onUnlock }: Props) {
  const [input, setInput] = useState('');
  const [shake, setShake] = useState(false);
  const [tentativas, setTentativas] = useState(0);

  const pin = getPIN();
  const maxLen = pin.length > 0 ? pin.length : 4;

  const handleDigit = (d: string) => {
    if (input.length >= maxLen) return;
    const novo = input + d;
    setInput(novo);
    if (novo.length === maxLen) {
      setTimeout(() => verificar(novo), 80);
    }
  };

  const verificar = (val: string) => {
    if (val === pin) {
      onUnlock();
    } else {
      setShake(true);
      setTentativas((t) => t + 1);
      setTimeout(() => { setShake(false); setInput(''); }, 600);
    }
  };

  const handleBackspace = () => setInput((v) => v.slice(0, -1));

  const DIGITS = [
    ['1','2','3'],
    ['4','5','6'],
    ['7','8','9'],
    ['*','0','⌫'],
  ];

  return (
    <div className="fixed inset-0 bg-zinc-950 flex flex-col items-center justify-center p-8">
      <div className="text-center mb-10">
        <div className="w-16 h-16 flex items-center justify-center bg-amber-500 rounded-2xl mx-auto mb-5">
          <i className="ri-lock-line text-3xl text-zinc-950" />
        </div>
        <h2 className="text-2xl font-black text-white mb-2">Autoatendimento</h2>
        <p className="text-zinc-500 text-sm">Digite o PIN de acesso para liberar o totem</p>
      </div>

      {/* Pontos do PIN */}
      <div className={`flex items-center gap-4 mb-8 transition-all ${shake ? 'translate-x-2' : ''}`} style={{ animation: shake ? 'shake 0.4s ease' : 'none' }}>
        {Array.from({ length: maxLen }).map((_, i) => (
          <div
            key={i}
            className={`w-4 h-4 rounded-full transition-all ${i < input.length ? 'bg-amber-400 scale-110' : 'bg-zinc-700'}`}
          />
        ))}
      </div>

      {tentativas >= 3 && (
        <p className="text-red-400 text-xs font-semibold mb-4 animate-pulse">
          <i className="ri-alarm-warning-line mr-1" />
          PIN incorreto. Tente novamente.
        </p>
      )}

      {/* Teclado numérico */}
      <div className="grid grid-rows-4 gap-3">
        {DIGITS.map((row, ri) => (
          <div key={ri} className="flex gap-3">
            {row.map((d) => (
              <button
                key={d}
                onClick={() => {
                  if (d === '⌫') handleBackspace();
                  else if (d !== '*') handleDigit(d);
                }}
                className={`w-20 h-16 flex items-center justify-center rounded-2xl text-xl font-bold cursor-pointer transition-all select-none ${
                  d === '*'
                    ? 'opacity-0 pointer-events-none'
                    : d === '⌫'
                    ? 'bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-white border border-zinc-700'
                    : 'bg-zinc-800 hover:bg-zinc-700 active:bg-zinc-600 text-white border border-zinc-700'
                }`}
              >
                {d === '⌫' ? <i className="ri-delete-back-2-line text-2xl" /> : d}
              </button>
            ))}
          </div>
        ))}
      </div>

      <p className="text-zinc-700 text-xs mt-8">
        <i className="ri-information-line mr-1" />
        O PIN é configurado em Configurações → Autoatendimento
      </p>

      <style>{`
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          20% { transform: translateX(-6px); }
          40% { transform: translateX(6px); }
          60% { transform: translateX(-4px); }
          80% { transform: translateX(4px); }
        }
      `}</style>
    </div>
  );
}
