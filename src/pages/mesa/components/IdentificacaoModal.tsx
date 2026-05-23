import { useState } from 'react';
import { Smartphone } from 'lucide-react';
import { supabase } from '@/lib/supabase';

const MSG_TEMPLATES = {
  primeiraVisita: 'Bem-vindo(a)! É a sua primeira vez com a gente — que alegria ter você aqui! Esperamos que aproveite muito!',
  retorno: 'Que bom ver você de volta, {nome}! Esta é a sua {visitas}ª visita — estamos felizes em ter você com a gente novamente!',
};

interface IdentificacaoModalProps {
  mesaNumero: number;
  tenantId?: string;
  onConfirmar: (nome: string, telefone: string) => void;
  ehPrimeiroCliente?: boolean;
  responsavelNome?: string;
  entradaPermitida?: boolean;
}

type Etapa = 'form' | 'boasvindas' | 'aguardando_aprovacao';

export default function IdentificacaoModal({
  mesaNumero,
  tenantId,
  onConfirmar,
  ehPrimeiroCliente = true,
  responsavelNome = '',
  entradaPermitida = true,
}: IdentificacaoModalProps) {
  const [nome, setNome] = useState('');
  const [telefone, setTelefone] = useState('');
  const [erro, setErro] = useState('');
  const [etapa, setEtapa] = useState<Etapa>('form');
  const [msgBoasVindas, setMsgBoasVindas] = useState('');
  const [isPrimeiraVisita, setIsPrimeiraVisita] = useState(true);
  const [nomeConfirmado, setNomeConfirmado] = useState('');
  const [verificando, setVerificando] = useState(false);

  const formatarTelefone = (v: string) => {
    const digits = v.replace(/\D/g, '').slice(0, 11);
    if (digits.length <= 2) return digits;
    if (digits.length <= 7) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  };

  const handleConfirmar = async () => {
    if (!nome.trim()) { setErro('Por favor, informe seu nome.'); return; }
    if (telefone.replace(/\D/g, '').length < 10) { setErro('Informe um celular válido.'); return; }

    setVerificando(true);
    setErro('');

    const primeiroNomeDigitado = nome.trim().split(' ')[0];

    try {
      const celularDigitos = telefone.replace(/\D/g, '');

      let query = supabase
        .from('customers')
        .select('id, name, phone, visit_count')
        .or(`phone.eq.${celularDigitos},phone.eq.${telefone}`);

      // Filtrar por tenant para não pegar clientes de outras lojas
      if (tenantId) {
        query = query.eq('tenant_id', tenantId);
      }

      const { data } = await query.maybeSingle();

      if (data) {
        // Usar o nome que o cliente digitou agora (não o do banco),
        // pois pode ser um familiar com o mesmo telefone ou o nome pode ter mudado
        const visitas = ((data.visit_count as number) ?? 0) + 1;
        const msg = MSG_TEMPLATES.retorno
          .replace('{nome}', primeiroNomeDigitado)
          .replace('{visitas}', String(visitas));
        setMsgBoasVindas(msg);
        setIsPrimeiraVisita(false);
        setNomeConfirmado(primeiroNomeDigitado);
      } else {
        setMsgBoasVindas(MSG_TEMPLATES.primeiraVisita);
        setIsPrimeiraVisita(true);
        setNomeConfirmado(primeiroNomeDigitado);
      }
    } catch {
      setMsgBoasVindas(MSG_TEMPLATES.primeiraVisita);
      setIsPrimeiraVisita(true);
      setNomeConfirmado(primeiroNomeDigitado);
    } finally {
      setVerificando(false);
    }

    setEtapa('boasvindas');
  };

  const handleEntrar = () => {
    onConfirmar(nome.trim(), telefone);
  };

  if (!ehPrimeiroCliente && !entradaPermitida) {
    return (
      <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50">
        <div className="bg-white w-full max-w-sm rounded-t-3xl sm:rounded-2xl p-7 text-center">
          <div className="w-16 h-16 flex items-center justify-center bg-zinc-100 rounded-2xl mx-auto mb-4">
            <i className="ri-lock-line text-3xl text-zinc-400" />
          </div>
          <h2 className="text-lg font-bold text-zinc-900 mb-2">Mesa não disponível</h2>
          <p className="text-sm text-zinc-500 leading-relaxed">
            O responsável desta mesa (<strong>{responsavelNome || 'outro cliente'}</strong>) não está aceitando novos participantes no momento.
          </p>
          <div className="mt-5 bg-zinc-50 rounded-xl p-3">
            <p className="text-xs text-zinc-400">Se isso for um erro, peça ao responsável para ativar a opção de entrada na aba &ldquo;Chamar&rdquo;.</p>
          </div>
        </div>
      </div>
    );
  }

  if (etapa === 'boasvindas') {
    return (
      <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50">
        <div className="bg-white w-full max-w-sm rounded-t-3xl sm:rounded-2xl p-7 text-center">
          <div className={`w-16 h-16 flex items-center justify-center rounded-2xl mx-auto mb-4 ${isPrimeiraVisita ? 'bg-amber-100' : 'bg-green-100'}`}>
            <i className={`text-3xl ${isPrimeiraVisita ? 'ri-star-smile-line text-amber-500' : 'ri-emotion-happy-line text-green-500'}`} />
          </div>
          <h2 className={`text-xl font-bold mb-3 ${isPrimeiraVisita ? 'text-amber-700' : 'text-green-700'}`}>
            {isPrimeiraVisita ? `Olá, ${nomeConfirmado}!` : `Bem-vindo de volta, ${nomeConfirmado}!`}
          </h2>
          <p className="text-sm text-zinc-600 leading-relaxed mb-6">{msgBoasVindas}</p>
          <div className={`rounded-xl p-3 mb-5 ${isPrimeiraVisita ? 'bg-amber-50' : 'bg-green-50'}`}>
            <p className={`text-xs font-medium ${isPrimeiraVisita ? 'text-amber-600' : 'text-green-600'}`}>
              Mesa {mesaNumero} — {nome.trim()}
            </p>
          </div>
          <button
            onClick={handleEntrar}
            className={`w-full py-3.5 text-white text-sm font-bold rounded-xl transition-colors cursor-pointer whitespace-nowrap ${isPrimeiraVisita ? 'bg-amber-500 hover:bg-amber-600' : 'bg-green-500 hover:bg-green-600'}`}
          >
            Ver Cardápio
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50">
      <div className="bg-white w-full max-w-sm rounded-t-3xl sm:rounded-2xl p-6">
        <div className="flex justify-center mb-2">
          <div className="w-10 h-1 bg-zinc-200 rounded-full sm:hidden" />
        </div>
        <div className="flex flex-col items-center text-center mb-6">
          <div className="w-14 h-14 flex items-center justify-center bg-amber-100 rounded-2xl mb-3">
            <Smartphone size={24} className="text-amber-600" />
          </div>
          <h2 className="text-lg font-bold text-zinc-900">Bem-vindo à Mesa {mesaNumero}!</h2>
          <p className="text-sm text-zinc-500 mt-1">Para fazer seu pedido, precisamos te identificar</p>
        </div>
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-semibold text-zinc-600 mb-1.5">Seu nome</label>
            <input
              type="text"
              value={nome}
              onChange={(e) => { setNome(e.target.value); setErro(''); }}
              placeholder="Como devemos te chamar?"
              className="w-full text-sm border border-zinc-200 rounded-xl px-4 py-3 text-zinc-800 placeholder-zinc-400 focus:outline-none focus:border-amber-400"
              autoFocus
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-zinc-600 mb-1.5">Celular</label>
            <input
              type="tel"
              value={telefone}
              onChange={(e) => { setTelefone(formatarTelefone(e.target.value)); setErro(''); }}
              placeholder="(11) 99999-9999"
              className="w-full text-sm border border-zinc-200 rounded-xl px-4 py-3 text-zinc-800 placeholder-zinc-400 focus:outline-none focus:border-amber-400"
            />
          </div>
          {erro && <p className="text-xs text-red-500 font-medium">{erro}</p>}
        </div>
        <button
          onClick={handleConfirmar}
          disabled={verificando}
          className="mt-5 w-full py-3.5 bg-amber-500 text-white text-sm font-bold rounded-xl hover:bg-amber-600 active:bg-amber-700 transition-colors cursor-pointer whitespace-nowrap disabled:opacity-60"
        >
          {verificando ? (
            <span className="flex items-center justify-center gap-2">
              <i className="ri-loader-4-line animate-spin" />
              Verificando...
            </span>
          ) : 'Entrar na Mesa'}
        </button>
        <p className="text-[10px] text-zinc-400 text-center mt-3">
          Seus dados são usados apenas para identificar seu pedido
        </p>
      </div>
    </div>
  );
}
