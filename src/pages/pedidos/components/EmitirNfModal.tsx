import { useEffect, useState } from 'react';
import { formatCpfCnpj } from '@/lib/fiscal';

interface Props {
  titulo: string;           // ex.: "Emitir NFC-e do pedido #P0809260014"
  valor?: string;           // ex.: "R$ 37,90"
  cpfInicial?: string | null;
  nomeInicial?: string | null;
  onConfirm: (consumer: { cpf?: string; name?: string } | null) => void | Promise<void>;
  onClose: () => void;
}

function validaCpfCnpj(d: string): boolean {
  if (d.length === 11) {
    if (/^(\d)\1{10}$/.test(d)) return false;
    const calc = (len: number) => { let s = 0; for (let i = 0; i < len; i++) s += Number(d[i]) * (len + 1 - i); const r = (s * 10) % 11; return r === 10 ? 0 : r; };
    return calc(9) === Number(d[9]) && calc(10) === Number(d[10]);
  }
  if (d.length === 14) {
    if (/^(\d)\1{13}$/.test(d)) return false;
    const calc = (len: number) => { const w = len === 12 ? [5,4,3,2,9,8,7,6,5,4,3,2] : [6,5,4,3,2,9,8,7,6,5,4,3,2]; let s = 0; for (let i = 0; i < len; i++) s += Number(d[i]) * w[i]; const r = s % 11; return r < 2 ? 0 : 11 - r; };
    return calc(12) === Number(d[12]) && calc(13) === Number(d[13]);
  }
  return false;
}

/**
 * Pergunta, na emissão manual, se o cliente quer CPF/CNPJ na nota.
 * "Emitir sem identificar" é o caminho rápido (consumidor não identificado).
 */
export default function EmitirNfModal({ titulo, valor, cpfInicial, nomeInicial, onConfirm, onClose }: Props) {
  const [cpf, setCpf] = useState((cpfInicial ?? '').replace(/\D/g, ''));
  const [nome, setNome] = useState(nomeInicial ?? '');
  const [enviando, setEnviando] = useState(false);
  const digits = cpf.replace(/\D/g, '');
  const cpfOk = digits.length === 0 || validaCpfCnpj(digits);
  const temCpf = digits.length === 11 || digits.length === 14;

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  const confirmar = async (comCpf: boolean) => {
    setEnviando(true);
    try { await onConfirm(comCpf && temCpf ? { cpf: digits, name: nome.trim() || undefined } : null); }
    finally { setEnviando(false); }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={(e) => { e.stopPropagation(); onClose(); }}>
      <div className="bg-white rounded-2xl p-5 w-full max-w-md shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 mb-1">
          <div>
            <h3 className="text-sm font-bold text-zinc-900">{titulo}</h3>
            {valor && <p className="text-xs text-zinc-500">{valor}</p>}
          </div>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-zinc-100 cursor-pointer text-zinc-500"><i className="ri-close-line" /></button>
        </div>
        <p className="text-xs text-zinc-500 mb-4">O cliente quer CPF ou CNPJ na nota? Se não, emita sem identificar.</p>

        <label className="block text-xs font-semibold text-zinc-600 mb-1.5">CPF ou CNPJ <span className="font-normal text-zinc-400">(opcional)</span></label>
        <input
          autoFocus
          inputMode="numeric"
          value={formatCpfCnpj(digits) || cpf}
          onChange={(e) => setCpf(e.target.value.replace(/\D/g, '').slice(0, 14))}
          onKeyDown={(e) => { if (e.key === 'Enter' && cpfOk) confirmar(temCpf); }}
          placeholder="000.000.000-00"
          className={`w-full text-sm border rounded-lg px-3 py-2.5 text-zinc-800 focus:outline-none ${digits && !cpfOk ? 'border-red-300 focus:border-red-400' : 'border-zinc-200 focus:border-amber-400'}`}
        />
        {digits && !cpfOk && <p className="text-[10px] text-red-500 mt-1">{digits.length < 11 ? 'Faltam dígitos' : 'Documento inválido, confira os dígitos'}</p>}

        <label className="block text-xs font-semibold text-zinc-600 mb-1.5 mt-3">Nome <span className="font-normal text-zinc-400">(opcional, sai no cupom)</span></label>
        <input
          value={nome}
          onChange={(e) => setNome(e.target.value.slice(0, 60))}
          onKeyDown={(e) => { if (e.key === 'Enter' && cpfOk) confirmar(temCpf); }}
          placeholder="Nome do cliente"
          className="w-full text-sm border border-zinc-200 rounded-lg px-3 py-2.5 text-zinc-800 focus:outline-none focus:border-amber-400"
        />

        <div className="flex flex-col sm:flex-row gap-2 mt-5">
          <button onClick={() => confirmar(false)} disabled={enviando}
            className="flex-1 py-2.5 text-sm font-semibold text-zinc-700 bg-zinc-100 rounded-lg hover:bg-zinc-200 disabled:opacity-40 cursor-pointer whitespace-nowrap">
            {enviando ? 'Emitindo…' : 'Emitir sem identificar'}
          </button>
          <button onClick={() => confirmar(true)} disabled={enviando || !temCpf || !cpfOk}
            className="flex-1 py-2.5 text-sm font-semibold text-white bg-amber-500 rounded-lg hover:bg-amber-600 disabled:opacity-40 cursor-pointer whitespace-nowrap">
            {enviando ? 'Emitindo…' : `Emitir com ${digits.length === 14 ? 'CNPJ' : 'CPF'}`}
          </button>
        </div>
      </div>
    </div>
  );
}
