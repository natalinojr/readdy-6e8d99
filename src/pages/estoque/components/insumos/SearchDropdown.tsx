import { useState, useRef, useEffect } from 'react';
import { Building2 } from 'lucide-react';

interface SearchDropdownProps {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  placeholder: string;
  allowFreeText?: boolean;
  onExtra?: () => void;
  extraLabel?: string;
}

export default function SearchDropdown({ value, onChange, options, placeholder, allowFreeText, onExtra, extraLabel }: SearchDropdownProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(value);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => { setQuery(value); }, [value]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const filtered = options.filter((o) => o.toLowerCase().includes(query.toLowerCase()));

  const handleSelect = (opt: string) => {
    onChange(opt);
    setQuery(opt);
    setOpen(false);
  };

  const handleInput = (v: string) => {
    setQuery(v);
    if (allowFreeText) onChange(v);
    setOpen(true);
  };

  const handleBlur = () => {
    setTimeout(() => {
      if (allowFreeText && query !== value) onChange(query);
    }, 150);
  };

  return (
    <div ref={ref} className="relative">
      <div className="relative flex items-center">
        <input
          value={query}
          onChange={(e) => handleInput(e.target.value)}
          onFocus={() => setOpen(true)}
          onBlur={handleBlur}
          placeholder={placeholder}
          className="w-full text-sm border border-zinc-200 rounded-lg pl-3 pr-8 py-2 text-zinc-800 focus:outline-none focus:border-amber-400 bg-white"
        />
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="absolute right-2 w-5 h-5 flex items-center justify-center text-zinc-400 cursor-pointer"
        >
          {open ? <i className="ri-arrow-up-s-line text-sm" /> : <i className="ri-arrow-down-s-line text-sm" />}
        </button>
      </div>
      {open && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-white border border-zinc-200 rounded-xl shadow-lg overflow-hidden">
          <div className="max-h-44 overflow-y-auto">
            {filtered.length === 0 && !allowFreeText ? (
              <p className="text-xs text-zinc-400 px-3 py-3 text-center">Nenhum resultado</p>
            ) : (
              <>
                {filtered.map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    onMouseDown={() => handleSelect(opt)}
                    className={`w-full text-left px-3 py-2 text-xs hover:bg-amber-50 cursor-pointer transition-colors ${opt === value ? 'font-bold text-amber-700 bg-amber-50' : 'text-zinc-700'}`}
                  >
                    {opt}
                  </button>
                ))}
                {allowFreeText && query && !filtered.includes(query) && (
                  <button
                    type="button"
                    onMouseDown={() => handleSelect(query)}
                    className="w-full text-left px-3 py-2 text-xs text-amber-600 hover:bg-amber-50 cursor-pointer border-t border-zinc-100"
                  >
                    <i className="ri-add-line mr-1" />
                    Usar &ldquo;{query}&rdquo;
                  </button>
                )}
              </>
            )}
          </div>
          {onExtra && (
            <button
              type="button"
              onMouseDown={(e) => { e.preventDefault(); setOpen(false); onExtra(); }}
              className="w-full text-left px-3 py-2 text-xs text-zinc-500 hover:bg-zinc-50 cursor-pointer border-t border-zinc-100 flex items-center gap-1.5"
            >
              <Building2 size={11} className="text-amber-500" />
              {extraLabel}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
