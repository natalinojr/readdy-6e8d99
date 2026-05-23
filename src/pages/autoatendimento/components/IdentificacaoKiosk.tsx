import { useState, useEffect, useRef } from 'react';
import { useSystemSettings } from '@/hooks/useSystemSettings';

interface Props {
  modo: 'nome' | 'senha' | 'comanda' | 'nenhum';
  total: number;
  pagarNaEntrega: boolean;
  onContinuar: (nome: string, senha: string) => void;
  onVoltar: () => void;
}

const fmt = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

function gerarSenha(): string {
  return String(Math.floor(100 + Math.random() * 900));
}

export default function IdentificacaoKiosk({ modo, total, pagarNaEntrega, onContinuar, onVoltar }: Props) {
  const { settings } = useSystemSettings();
  const mensagemRetorno = settings.welcome_message_returning || 'Que bom te ver de volta!';
  const pagerCount = settings.pager_count ?? 50;

  const [nome, setNome] = useState('');
  const [erro, setErro] = useState('');
  const [senhaGerada] = useState(() => gerarSenha());
  const [confirmado, setConfirmado] = useState(false);
  // Comanda / pager
  const [numeroPager, setNumeroPager] = useState('');
  const [pagerConfirmado, setPagerConfirmado] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (modo === 'nenhum') {
      const t = setTimeout(() => onContinuar('Cliente', gerarSenha()), 400);
      return () => clearTimeout(t);
    }
  }, [modo, onContinuar]);

  if (modo === 'nenhum') {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="flex items-center gap-3 text-zinc-400">
          <i className="ri-loader-4-line text-2xl animate-spin" />
          <span className="text-lg font-semibold">Preparando pedido...</span>
        </div>
      </div>
    );
  }

  // ── MODO COMANDA (PAGER) ──
  if (modo === 'comanda') {
    const handleConfirmarPager = () => {
      const num = parseInt(numeroPager, 10);
      if (!numeroPager.trim() || isNaN(num) || num < 1) {
        setErro('Digite um número de pager válido.');
        return;
      }
      if (num > pagerCount) {
        setErro(`Número inválido. Os pagers vão de 1 a ${pagerCount}.`);
        return;
      }
      setErro('');
      setPagerConfirmado(true);
      setTimeout(() => onContinuar('Cliente', `P-${num}`), 600);
    };

    if (pagerConfirmado) {
      return (
        <div className="flex flex-col items-center justify-center h-full gap-6 text-center p-12">
          <div className="w-20 h-20 flex items-center justify-center bg-amber-500/20 rounded-full">
            <i className="ri-checkbox-circle-line text-4xl text-amber-400" />
          </div>
          <div>
            <p className="text-3xl font-black text-white">Pager Nº {numeroPager} registrado!</p>
            <p className="text-zinc-400 text-lg mt-2">Aguarde ser chamado</p>
          </div>
          <div className="flex items-center gap-2 text-zinc-600">
            <i className="ri-loader-4-line text-xl animate-spin text-amber-500" />
            <span className="text-sm">Finalizando pedido...</span>
          </div>
        </div>
      );
    }

    return (
      <div className="flex flex-col items-center justify-center h-full p-6 text-center overflow-hidden">
        {/* Layout em duas colunas: info à esquerda, teclado à direita */}
        <div className="flex items-center gap-8 w-full max-w-4xl">

          {/* Coluna esquerda — instruções */}
          <div className="flex-1 flex flex-col gap-4 text-left">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <div className="w-12 h-12 flex items-center justify-center bg-amber-500/20 rounded-2xl flex-shrink-0">
                  <i className="ri-wireless-charging-line text-2xl text-amber-400" />
                </div>
                <h2 className="text-3xl font-black text-white">Número do Pager</h2>
              </div>
              <p className="text-zinc-400 text-base">
                Pegue um pager no balcão e digite o número impresso nele
              </p>
            </div>

            {/* Botões */}
            <div className="flex gap-3 mt-2">
              <button onClick={onVoltar}
                className="px-6 py-3 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-bold text-base rounded-2xl cursor-pointer whitespace-nowrap transition-colors">
                Voltar
              </button>
              <button
                onClick={handleConfirmarPager}
                disabled={!numeroPager.trim()}
                className="flex-1 py-3 bg-amber-500 hover:bg-amber-400 disabled:opacity-40 disabled:cursor-not-allowed text-zinc-950 text-lg font-black rounded-2xl cursor-pointer active:scale-95 transition-all whitespace-nowrap"
              >
                Confirmar
              </button>
            </div>
          </div>

          {/* Coluna direita — display + teclado */}
          <div className="flex flex-col items-center gap-3">
            {/* Display do número */}
            <div className="w-64 bg-zinc-800 rounded-2xl px-6 py-4 text-center border border-zinc-700">
              <p className="text-zinc-500 text-xs font-semibold mb-1">Nº do Pager</p>
              <p className={`font-black leading-none ${numeroPager ? 'text-white text-6xl' : 'text-zinc-600 text-4xl'}`}>
                {numeroPager || `1–${pagerCount}`}
              </p>
              {erro && <p className="text-red-400 text-xs mt-2 font-semibold">{erro}</p>}
            </div>

            {/* Teclado numérico */}
            <div className="grid grid-cols-3 gap-2">
              {['1','2','3','4','5','6','7','8','9','','0','⌫'].map((d, i) => (
                <button
                  key={i}
                  onClick={() => {
                    if (d === '⌫') { setNumeroPager((v) => v.slice(0, -1)); setErro(''); }
                    else if (d !== '') { setNumeroPager((v) => (v + d).slice(0, 3)); setErro(''); }
                  }}
                  disabled={d === ''}
                  className={`w-20 h-14 flex items-center justify-center rounded-xl text-xl font-bold cursor-pointer transition-all select-none ${
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
          </div>
        </div>
      </div>
    );
  }

  // ── MODO SENHA ──
  if (modo === 'senha') {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-8 p-12 text-center">
        <div className="text-center">
          <h2 className="text-5xl font-black text-white mb-3">Sua senha</h2>
          <p className="text-zinc-400 text-xl">Anote o número abaixo — ele será chamado na retirada</p>
        </div>

        <div className="bg-amber-500/10 border-4 border-amber-500/50 rounded-3xl px-24 py-10">
          <p className="text-amber-400 text-[7rem] font-black leading-none tracking-wider">{senhaGerada}</p>
        </div>

        <div className="bg-zinc-800 rounded-2xl px-8 py-5 text-center max-w-sm">
          <p className="text-zinc-400 text-sm mb-1">Total do pedido</p>
          <p className="text-amber-400 font-black text-3xl">{fmt(total)}</p>
        </div>



        <div className="flex flex-col items-center gap-3 w-full max-w-md">
          <p className="text-zinc-500 text-sm">Confirme que anotou sua senha para continuar</p>
          <button
            onClick={() => onContinuar('Cliente', senhaGerada)}
            className="w-full py-5 bg-amber-500 hover:bg-amber-400 text-zinc-950 text-xl font-black rounded-2xl cursor-pointer active:scale-95 transition-all whitespace-nowrap"
          >
            <i className="ri-checkbox-circle-line mr-2" />
            Anotei minha senha — Continuar
          </button>
          <button onClick={onVoltar} className="text-zinc-600 hover:text-zinc-400 text-sm cursor-pointer transition-colors">
            Voltar ao carrinho
          </button>
        </div>
      </div>
    );
  }

  // ── MODO NOME ──
  const handleConfirmar = () => {
    if (!nome.trim() || nome.trim().length < 2) {
      setErro('Por favor, informe seu nome (mínimo 2 caracteres).');
      return;
    }
    setConfirmado(true);
    setTimeout(() => onContinuar(nome.trim(), senhaGerada), 800);
  };

  if (confirmado) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-6 text-center p-12">
        <div className="w-20 h-20 flex items-center justify-center bg-amber-500/20 rounded-full">
          <i className="ri-user-smile-line text-4xl text-amber-400" />
        </div>
        <div>
          <p className="text-3xl font-black text-white">Olá, {nome.trim().split(' ')[0]}!</p>
          <p className="text-zinc-400 text-lg mt-2">{mensagemRetorno}</p>
        </div>
        <div className="flex items-center gap-2 text-zinc-600">
          <i className="ri-loader-4-line text-xl animate-spin text-amber-500" />
          <span className="text-sm">Preparando seu pedido...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center h-full gap-8 p-12">
      <div className="text-center">
        <h2 className="text-5xl font-black text-white mb-3">Qual é o seu nome?</h2>
        <p className="text-zinc-400 text-xl">Vamos chamar você quando o pedido estiver pronto</p>
      </div>

      <div className="bg-zinc-800 rounded-2xl px-8 py-4 text-center">
        <p className="text-zinc-400 text-sm mb-0.5">Total do pedido</p>
        <p className="text-amber-400 font-black text-3xl">{fmt(total)}</p>
      </div>



      <div className="w-full max-w-lg">
        <input
          ref={inputRef}
          type="text"
          value={nome}
          onChange={(e) => { setNome(e.target.value); setErro(''); }}
          onKeyDown={(e) => e.key === 'Enter' && handleConfirmar()}
          placeholder="Digite seu nome aqui..."
          autoFocus
          maxLength={50}
          className="w-full bg-zinc-800 text-white text-3xl font-bold text-center rounded-3xl px-8 py-7 placeholder-zinc-600 focus:outline-none focus:ring-4 focus:ring-amber-500/50 transition-all"
        />
        {erro && <p className="text-red-400 text-center text-sm mt-3 font-semibold">{erro}</p>}
      </div>

      <div className="w-full max-w-2xl">
        {[
          ['Q','W','E','R','T','Y','U','I','O','P'],
          ['A','S','D','F','G','H','J','K','L'],
          ['Z','X','C','V','B','N','M'],
        ].map((linha, li) => (
          <div key={li} className="flex justify-center gap-1.5 mb-1.5">
            {linha.map((letra) => (
              <button key={letra} onClick={() => setNome((n) => n + letra)}
                className="w-12 h-12 flex items-center justify-center bg-zinc-700 hover:bg-zinc-600 text-white font-bold text-base rounded-xl cursor-pointer active:scale-90 transition-all">
                {letra}
              </button>
            ))}
          </div>
        ))}
        <div className="flex justify-center gap-2 mt-2">
          <button onClick={() => setNome((n) => n + ' ')}
            className="px-16 py-3 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 font-semibold text-sm rounded-xl cursor-pointer active:scale-95 transition-all whitespace-nowrap">
            Espaço
          </button>
          <button onClick={() => setNome((n) => n.slice(0, -1))}
            className="px-6 py-3 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 font-semibold text-sm rounded-xl cursor-pointer active:scale-95 transition-all whitespace-nowrap">
            <i className="ri-delete-back-2-line text-lg" />
          </button>
        </div>
      </div>

      <div className="flex gap-4 w-full max-w-lg">
        <button onClick={onVoltar}
          className="px-8 py-4 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-bold text-lg rounded-2xl cursor-pointer whitespace-nowrap transition-colors">
          Voltar
        </button>
        <button onClick={handleConfirmar} disabled={!nome.trim()}
          className="flex-1 py-4 bg-amber-500 hover:bg-amber-400 disabled:opacity-40 disabled:cursor-not-allowed text-zinc-950 text-xl font-black rounded-2xl cursor-pointer active:scale-95 transition-all whitespace-nowrap">
          Confirmar
        </button>
      </div>
    </div>
  );
}
