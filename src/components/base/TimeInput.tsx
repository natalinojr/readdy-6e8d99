import { useState, useEffect, useCallback } from 'react';

interface TimeInputProps {
  value: number; // valor em horas decimais (ex: 2.5 = 2h30m)
  onChange: (hours: number) => void;
  label?: string;
  min?: number;
  max?: number;
  disabled?: boolean;
  className?: string;
}

// Converte decimal (2.5) para string "02:30"
function decimalToTime(decimal: number): string {
  const totalMinutes = Math.round(decimal * 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// Converte string "02:30" para decimal (2.5)
function timeToDecimal(timeStr: string): number | null {
  const match = timeStr.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const h = parseInt(match[1], 10);
  const m = parseInt(match[2], 10);
  if (m < 0 || m > 59) return null;
  return h + m / 60;
}

export default function TimeInput({
  value,
  onChange,
  label,
  min = 0,
  max,
  disabled = false,
  className = '',
}: TimeInputProps) {
  const [text, setText] = useState(decimalToTime(value));
  const [error, setError] = useState(false);

  useEffect(() => {
    setText(decimalToTime(value));
    setError(false);
  }, [value]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    let raw = e.target.value.replace(/[^0-9:]/g, '');

    // Auto-formata: se digitar 4 números, formata como HH:MM
    const digitsOnly = raw.replace(/:/g, '');
    if (digitsOnly.length >= 3 && !raw.includes(':')) {
      const h = digitsOnly.slice(0, -2);
      const m = digitsOnly.slice(-2);
      raw = `${h}:${m}`;
    }

    setText(raw);

    const decimal = timeToDecimal(raw);
    if (decimal !== null) {
      setError(false);
      if (decimal >= min && (!max || decimal <= max)) {
        onChange(Math.round(decimal * 100) / 100);
      }
    } else if (raw === '' || raw === ':') {
      setError(false);
      onChange(0);
    } else {
      setError(true);
    }
  }, [onChange, min, max]);

  const handleBlur = useCallback(() => {
    const decimal = timeToDecimal(text);
    if (decimal !== null) {
      const clamped = Math.max(min, max ? Math.min(decimal, max) : decimal);
      setText(decimalToTime(clamped));
      setError(false);
      onChange(Math.round(clamped * 100) / 100);
    } else {
      setText(decimalToTime(value));
      setError(false);
    }
  }, [text, value, min, max, onChange]);

  return (
    <div className={className}>
      {label && (
        <label className="block text-xs font-semibold text-zinc-600 mb-1">{label}</label>
      )}
      <div className="relative">
        <input
          type="text"
          value={text}
          onChange={handleChange}
          onBlur={handleBlur}
          disabled={disabled}
          placeholder="00:00"
          maxLength={5}
          className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none transition-colors font-mono
            ${error
              ? 'border-red-300 focus:border-red-400 bg-red-50'
              : 'border-zinc-200 focus:border-amber-400'
            }
            ${disabled ? 'bg-zinc-50 text-zinc-400' : ''}
          `}
        />
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-zinc-400 pointer-events-none">
          hh:mm
        </span>
      </div>
      {error && (
        <p className="text-xs text-red-500 mt-1">Formato inválido. Use HH:MM</p>
      )}
    </div>
  );
}