import { useState, useCallback, useEffect, useRef } from 'react';

export type KeyboardMode = 'text' | 'numeric' | 'decimal';

interface VirtualKeyboardProps {
  value: string;
  onChange: (val: string) => void;
  onEnter?: () => void;
  onClose: () => void;
  mode?: KeyboardMode;
  maxLength?: number;
  label?: string;
}

const ROWS_QWERTY = [
  ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
  ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'],
  ['z', 'x', 'c', 'v', 'b', 'n', 'm'],
];

const ROWS_NUMERIC = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['.', '0', '⌫'],
];

export default function VirtualKeyboard({
  value,
  onChange,
  onEnter,
  onClose,
  mode = 'text',
  maxLength,
  label,
}: VirtualKeyboardProps) {
  const [caps, setCaps] = useState(false);
  const [shifted, setShifted] = useState(false);
  const [showSymbols, setShowSymbols] = useState(false);
  const longPressRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const repeatRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Teclas de símbolo
  const SYMBOLS_ROW1 = ['!', '@', '#', '$', '%', '&', '*', '(', ')', '-'];
  const SYMBOLS_ROW2 = ['_', '+', '=', '/', '\\', ':', ';', '"', "'", '?'];
  const SYMBOLS_ROW3 = [',', '.', '<', '>', '[', ']', '{', '}', '~'];

  const effectiveCaps = caps !== shifted; // XOR: shift inverte caps

  const handleChar = useCallback((char: string) => {
    if (maxLength && value.length >= maxLength) return;
    const c = effectiveCaps ? char.toUpperCase() : char;
    onChange(value + c);
    if (shifted) setShifted(false); // one-shot shift
  }, [value, onChange, effectiveCaps, shifted, maxLength]);

  const handleBackspace = useCallback(() => {
    onChange(value.slice(0, -1));
  }, [value, onChange]);

  const handleSpace = useCallback(() => {
    if (maxLength && value.length >= maxLength) return;
    onChange(value + ' ');
  }, [value, onChange, maxLength]);

  // Long press no backspace para apagar tudo
  const startLongPressDelete = () => {
    longPressRef.current = setTimeout(() => {
      onChange('');
      repeatRef.current = setInterval(() => {
        // continua apagando enquanto segura - handled via state ref
      }, 80);
    }, 600);
  };

  const stopLongPress = () => {
    if (longPressRef.current) clearTimeout(longPressRef.current);
    if (repeatRef.current) clearInterval(repeatRef.current);
  };

  useEffect(() => () => stopLongPress(), []);

  if (mode === 'numeric' || mode === 'decimal') {
    return (
      <div className="bg-zinc-100 border-t border-zinc-300 select-none px-3 pt-3 pb-4 safe-area-bottom">
        {label && (
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-zinc-500">{label}</span>
            <button
              onPointerDown={(e) => { e.preventDefault(); onClose(); }}
              className="text-xs text-zinc-400 hover:text-zinc-700 flex items-center gap-1 cursor-pointer"
            >
              <i className="ri-keyboard-line" />
              Fechar
            </button>
          </div>
        )}
        <div className="flex gap-2 mb-2 items-center justify-center">
          {/* Preview */}
          <div className="flex-1 bg-white border border-zinc-200 rounded-xl px-3 py-2.5 text-base font-bold text-zinc-900 text-right min-h-[44px] flex items-center justify-end overflow-hidden">
            <span className="truncate">{value || <span className="text-zinc-300 font-normal text-sm">0</span>}</span>
          </div>
          <button
            onPointerDown={(e) => { e.preventDefault(); handleBackspace(); }}
            onPointerUp={stopLongPress}
            onPointerLeave={stopLongPress}
            className="w-12 h-11 flex items-center justify-center bg-white border border-zinc-200 rounded-xl text-zinc-600 hover:bg-red-50 hover:text-red-500 active:bg-red-100 cursor-pointer transition-colors"
          >
            <i className="ri-delete-back-2-line text-lg" />
          </button>
        </div>
        <div className="space-y-2">
          {ROWS_NUMERIC.map((row, ri) => (
            <div key={ri} className="flex gap-2 justify-center">
              {row.map((key) => {
                if (key === '⌫') {
                  return (
                    <button
                      key={key}
                      onPointerDown={(e) => { e.preventDefault(); handleBackspace(); startLongPressDelete(); }}
                      onPointerUp={stopLongPress}
                      onPointerLeave={stopLongPress}
                      className="flex-1 h-12 flex items-center justify-center bg-red-100 hover:bg-red-200 active:bg-red-300 text-red-600 rounded-xl font-semibold text-lg cursor-pointer transition-colors"
                    >
                      <i className="ri-delete-back-2-line" />
                    </button>
                  );
                }
                if (key === '.' && mode !== 'decimal') return null;
                return (
                  <button
                    key={key}
                    onPointerDown={(e) => { e.preventDefault(); handleChar(key); }}
                    className="flex-1 h-12 flex items-center justify-center bg-white hover:bg-amber-50 active:bg-amber-100 text-zinc-900 rounded-xl font-bold text-lg border border-zinc-200 cursor-pointer transition-colors"
                  >
                    {key}
                  </button>
                );
              })}
            </div>
          ))}
          {onEnter && (
            <button
              onPointerDown={(e) => { e.preventDefault(); onEnter(); }}
              className="w-full h-12 flex items-center justify-center bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-white rounded-xl font-bold text-sm cursor-pointer transition-colors gap-2"
            >
              <i className="ri-check-line text-base" />
              Confirmar
            </button>
          )}
        </div>
      </div>
    );
  }

  // QWERTY mode
  const rows = showSymbols
    ? [SYMBOLS_ROW1, SYMBOLS_ROW2, SYMBOLS_ROW3]
    : ROWS_QWERTY;

  const numberRow = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];

  return (
    <div className="bg-zinc-100 border-t border-zinc-300 select-none px-2 pt-2 pb-3 safe-area-bottom">
      {/* Top bar with label and close */}
      <div className="flex items-center justify-between mb-2 px-1">
        {label ? (
          <span className="text-xs font-semibold text-zinc-500 truncate max-w-[60%]">{label}</span>
        ) : <span />}
        <button
          onPointerDown={(e) => { e.preventDefault(); onClose(); }}
          className="flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-700 cursor-pointer px-2 py-1 rounded-lg hover:bg-zinc-200 transition-colors"
        >
          <i className="ri-close-line text-sm" />
          Fechar
        </button>
      </div>

      {/* Number row */}
      {!showSymbols && (
        <div className="flex gap-1 justify-center mb-1.5">
          {numberRow.map((key) => (
            <button
              key={key}
              onPointerDown={(e) => { e.preventDefault(); handleChar(key); }}
              className="flex-1 max-w-[9.5%] min-w-[28px] h-9 flex items-center justify-center bg-zinc-200 hover:bg-zinc-300 active:bg-zinc-400 text-zinc-700 rounded-lg font-bold text-sm border border-zinc-300 cursor-pointer transition-colors"
            >
              {key}
            </button>
          ))}
        </div>
      )}

      {/* Key rows */}
      <div className="space-y-1.5">
        {rows.map((row, ri) => (
          <div key={ri} className="flex gap-1 justify-center">
            {ri === 2 && !showSymbols && (
              <button
                onPointerDown={(e) => { e.preventDefault(); setShifted((s) => !s); }}
                className={`w-10 h-10 flex items-center justify-center rounded-lg font-semibold text-sm cursor-pointer transition-colors border ${
                  shifted || caps
                    ? 'bg-amber-500 text-white border-amber-600'
                    : 'bg-white text-zinc-700 border-zinc-300 hover:bg-zinc-200 active:bg-zinc-300'
                }`}
                title="Maiúsculas"
              >
                <i className="ri-arrow-up-line text-base" />
              </button>
            )}
            {row.map((key) => (
              <button
                key={key}
                onPointerDown={(e) => { e.preventDefault(); handleChar(key); }}
                className="flex-1 max-w-[9.5%] min-w-[28px] h-10 flex items-center justify-center bg-white hover:bg-amber-50 active:bg-amber-100 text-zinc-900 rounded-lg font-semibold text-sm border border-zinc-300 cursor-pointer transition-colors"
              >
                {effectiveCaps ? key.toUpperCase() : key}
              </button>
            ))}
            {ri === 2 && !showSymbols && (
              <button
                onPointerDown={(e) => {
                  e.preventDefault();
                  handleBackspace();
                  startLongPressDelete();
                }}
                onPointerUp={stopLongPress}
                onPointerLeave={stopLongPress}
                className="w-10 h-10 flex items-center justify-center bg-red-100 hover:bg-red-200 active:bg-red-300 text-red-600 rounded-lg cursor-pointer transition-colors border border-red-200"
              >
                <i className="ri-delete-back-2-line text-base" />
              </button>
            )}
            {ri === 2 && showSymbols && (
              <button
                onPointerDown={(e) => {
                  e.preventDefault();
                  handleBackspace();
                  startLongPressDelete();
                }}
                onPointerUp={stopLongPress}
                onPointerLeave={stopLongPress}
                className="w-10 h-10 flex items-center justify-center bg-red-100 hover:bg-red-200 active:bg-red-300 text-red-600 rounded-lg cursor-pointer transition-colors border border-red-200"
              >
                <i className="ri-delete-back-2-line text-base" />
              </button>
            )}
          </div>
        ))}

        {/* Bottom row: symbols toggle + space + enter */}
        <div className="flex gap-1.5">
          <button
            onPointerDown={(e) => { e.preventDefault(); setCaps((c) => !c); }}
            title="Caps Lock"
            className={`w-10 h-10 flex items-center justify-center rounded-lg font-bold text-xs cursor-pointer transition-colors border ${
              caps
                ? 'bg-amber-400 text-white border-amber-500'
                : 'bg-white text-zinc-500 border-zinc-300 hover:bg-zinc-200'
            }`}
          >
            <i className="ri-font-size-2 text-sm" />
          </button>
          <button
            onPointerDown={(e) => { e.preventDefault(); setShowSymbols((s) => !s); }}
            className={`w-14 h-10 flex items-center justify-center rounded-lg font-semibold text-xs cursor-pointer transition-colors border ${
              showSymbols
                ? 'bg-zinc-700 text-white border-zinc-800'
                : 'bg-white text-zinc-600 border-zinc-300 hover:bg-zinc-200 active:bg-zinc-300'
            }`}
          >
            {showSymbols ? 'ABC' : '!@#'}
          </button>
          <button
            onPointerDown={(e) => { e.preventDefault(); handleSpace(); }}
            className="flex-1 h-10 flex items-center justify-center bg-white hover:bg-zinc-100 active:bg-zinc-200 text-zinc-500 rounded-lg text-xs font-medium border border-zinc-300 cursor-pointer transition-colors"
          >
            espaço
          </button>
          {onEnter ? (
            <button
              onPointerDown={(e) => { e.preventDefault(); onEnter(); }}
              className="w-20 h-10 flex items-center justify-center bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-white rounded-lg font-bold text-sm cursor-pointer transition-colors gap-1 border border-amber-600"
            >
              <i className="ri-corner-down-left-line text-base" />
              OK
            </button>
          ) : (
            <button
              onPointerDown={(e) => { e.preventDefault(); onClose(); }}
              className="w-20 h-10 flex items-center justify-center bg-zinc-600 hover:bg-zinc-700 active:bg-zinc-800 text-white rounded-lg font-bold text-sm cursor-pointer transition-colors gap-1 border border-zinc-700"
            >
              <i className="ri-check-line text-base" />
              OK
            </button>
          )}
        </div>
      </div>
    </div>
  );
}