import { useState } from 'react';

type TipoChamado = 'atendimento' | 'conta' | 'ajuda';

interface ClienteMesa {
  nome: string;
  telefone: string;
}

interface Props {
  mesaNumero: number;
  isResponsavel: boolean;
  entradaPermitida: boolean;
  onToggleEntrada: (v: boolean) => void;
  clientesMesa: ClienteMesa[];
  onTransferirResponsabilidade: (nome: string) => void;
  horaAbertura?: string;
}

const chamados: { id: TipoChamado; label: string; desc: string; icon: string; cor: string }[] = [
  { id: 'atendimento', label: 'Chamar Garçom', desc: 'Solicitar atendimento na mesa', icon: 'ri-service-line', cor: 'bg-amber-500 hover:bg-amber-600' },
  { id: 'conta', label: 'Pedir a Conta', desc: 'Encerrar e pagar com o atendente', icon: 'ri-bank-card-line', cor: 'bg-emerald-500 hover:bg-emerald-600' },
  { id: 'ajuda', label: 'Precisando de Ajuda', desc: 'Alguma dúvida ou problema na mesa', icon: 'ri-question-line', cor: 'bg-zinc-600 hover:bg-zinc-700' },
];

export default function ChamarGarcomPanel({
  mesaNumero,
  isResponsavel,
  entradaPermitida,
  onToggleEntrada,
  clientesMesa,
  onTransferirResponsabilidade,
  horaAbertura,
}: Props) {
  const [enviado, setEnviado] = useState<TipoChamado | null>(null);
  const [timer, setTimer] = useState<ReturnType<typeof setTimeout> | null>(null);
  const [mostrarTransferir, setMostrarTransferir] = useState(false);
  const [clienteDestino, setClienteDestino] = useState('');

  const handleChamar = (tipo: TipoChamado) => {
    if (timer) clearTimeout(timer);
    setEnviado(tipo);
    const t = setTimeout(() => setEnviado(null), 4000);
    setTimer(t);
  };

  const handleTransferir = () => {
    if (!clienteDestino) return;
    onTransferirResponsabilidade(clienteDestino);
    setMostrarTransferir(false);
    setClienteDestino('');
  };

  // Calcular tempo de mesa
  const calcTempo = () => {
    if (!horaAbertura) return null;
    const [h, m] = horaAbertura.split(':').map(Number);
    const agora = new Date();
    const minutos = (agora.getHours() - h) * 60 + (agora.getMinutes() - m);
    if (minutos < 0) return null;
    if (minutos < 60) return `${minutos} min`;
    return `${Math.floor(minutos / 60)}h ${minutos % 60}min`;
  };
  const tempoMesa = calcTempo();

  return (
    <div className="flex flex-col px-4 py-6 pb-28 gap-4">
      <div className="text-center mb-1">
        <h2 className="text-base font-bold text-zinc-900">Precisa de algo?</h2>
        <p className="text-xs text-zinc-500 mt-1">Toque em um botão e o garçom vai até você</p>
      </div>

      {enviado && (
        <div className="flex items-center gap-3 px-4 py-3 bg-emerald-50 border border-emerald-200 rounded-2xl">
          <i className="ri-checkbox-circle-fill text-emerald-500 text-xl flex-shrink-0" />
          <div>
            <p className="text-xs font-bold text-emerald-700">Chamado enviado!</p>
            <p className="text-[10px] text-emerald-600">O garçom foi notificado e está a caminho</p>
          </div>
        </div>
      )}

      {chamados.map((c) => (
        <button
          key={c.id}
          onClick={() => handleChamar(c.id)}
          className={`flex items-center gap-4 px-5 py-5 rounded-2xl text-white transition-all cursor-pointer active:scale-[0.97] ${c.cor} ${enviado === c.id ? 'opacity-70' : ''}`}
        >
          <div className="w-12 h-12 flex items-center justify-center bg-white/20 rounded-xl flex-shrink-0">
            <i className={`${c.icon} text-2xl`} />
          </div>
          <div className="text-left">
            <p className="text-sm font-bold">{c.label}</p>
            <p className="text-xs opacity-80 mt-0.5">{c.desc}</p>
          </div>
        </button>
      ))}

      {/* Info da mesa */}
      <div className="mt-1 px-4 py-4 bg-zinc-50 rounded-2xl">
        <p className="text-xs font-bold text-zinc-700 mb-2">Informações da Mesa</p>
        <div className="space-y-1.5">
          <div className="flex justify-between text-xs">
            <span className="text-zinc-500">Mesa</span>
            <span className="font-semibold text-zinc-800">Mesa {mesaNumero}</span>
          </div>
          {horaAbertura && (
            <div className="flex justify-between text-xs">
              <span className="text-zinc-500">Aberta às</span>
              <span className="font-semibold text-zinc-800">{horaAbertura}</span>
            </div>
          )}
          {tempoMesa && (
            <div className="flex justify-between text-xs">
              <span className="text-zinc-500">Tempo de mesa</span>
              <span className="font-semibold text-zinc-800">{tempoMesa}</span>
            </div>
          )}
          <div className="flex justify-between text-xs">
            <span className="text-zinc-500">Clientes na mesa</span>
            <span className="font-semibold text-zinc-800">{clientesMesa.length}</span>
          </div>
        </div>
      </div>

      {/* Seção Responsável */}
      {isResponsavel && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl overflow-hidden">
          <div className="px-4 pt-4 pb-2">
            <div className="flex items-center gap-2 mb-1">
              <i className="ri-shield-star-line text-amber-600 text-base" />
              <p className="text-xs font-bold text-amber-800">Você é o Responsável desta Mesa</p>
            </div>
            <p className="text-[10px] text-amber-600 mb-3">Controle quem entra e gere os clientes</p>

            {/* Toggle entrada */}
            <div className="flex items-center justify-between bg-white rounded-xl px-3 py-3 mb-3">
              <div>
                <p className="text-xs font-semibold text-zinc-800">Permitir entrada de outros</p>
                <p className="text-[10px] text-zinc-500 mt-0.5">
                  {entradaPermitida ? 'Qualquer pessoa com o QR pode pedir para entrar' : 'Apenas você pode adicionar pessoas'}
                </p>
              </div>
              <button
                onClick={() => onToggleEntrada(!entradaPermitida)}
                className={`relative w-11 h-6 rounded-full transition-colors cursor-pointer flex-shrink-0 ${entradaPermitida ? 'bg-amber-500' : 'bg-zinc-300'}`}
              >
                <div className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${entradaPermitida ? 'translate-x-5.5' : 'translate-x-0.5'}`} style={{ transform: entradaPermitida ? 'translateX(22px)' : 'translateX(2px)' }} />
              </button>
            </div>

            {/* Lista de clientes */}
            {clientesMesa.length > 0 && (
              <div className="mb-3">
                <p className="text-[10px] font-bold text-amber-700 uppercase tracking-wide mb-2">Clientes na mesa</p>
                <div className="space-y-1.5">
                  {clientesMesa.map((c, i) => (
                    <div key={i} className="flex items-center gap-2 bg-white rounded-lg px-3 py-2">
                      <div className="w-6 h-6 flex items-center justify-center rounded-full bg-amber-100 flex-shrink-0">
                        <span className="text-[10px] font-bold text-amber-700">{c.nome.charAt(0).toUpperCase()}</span>
                      </div>
                      <span className="text-xs font-medium text-zinc-700 flex-1 truncate">{c.nome}</span>
                      {i === 0 && (
                        <span className="text-[9px] font-bold text-amber-600 bg-amber-100 px-1.5 py-0.5 rounded-full">Responsável</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Transferir responsabilidade */}
            {clientesMesa.length > 1 && !mostrarTransferir && (
              <button
                onClick={() => setMostrarTransferir(true)}
                className="w-full py-2 border border-amber-300 text-amber-700 text-xs font-semibold rounded-xl cursor-pointer hover:bg-amber-100 transition-colors whitespace-nowrap"
              >
                <i className="ri-exchange-line mr-1" />
                Transferir responsabilidade
              </button>
            )}

            {mostrarTransferir && (
              <div className="bg-white rounded-xl p-3">
                <p className="text-xs font-bold text-zinc-800 mb-2">Transferir para:</p>
                <div className="space-y-1.5 mb-3">
                  {clientesMesa.slice(1).map((c) => (
                    <button
                      key={c.nome}
                      onClick={() => setClienteDestino(c.nome)}
                      className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg border-2 transition-all cursor-pointer ${
                        clienteDestino === c.nome ? 'border-amber-400 bg-amber-50' : 'border-zinc-100 hover:border-zinc-200'
                      }`}
                    >
                      <div className="w-5 h-5 flex items-center justify-center rounded-full bg-zinc-100 flex-shrink-0">
                        <span className="text-[9px] font-bold text-zinc-600">{c.nome.charAt(0).toUpperCase()}</span>
                      </div>
                      <span className="text-xs font-medium text-zinc-700">{c.nome}</span>
                    </button>
                  ))}
                </div>
                <div className="flex gap-2">
                  <button onClick={() => setMostrarTransferir(false)} className="flex-1 py-2 border border-zinc-200 text-zinc-600 text-xs font-semibold rounded-lg cursor-pointer hover:bg-zinc-50 transition-colors whitespace-nowrap">Cancelar</button>
                  <button
                    onClick={handleTransferir}
                    disabled={!clienteDestino}
                    className="flex-1 py-2 bg-amber-500 text-white text-xs font-bold rounded-lg cursor-pointer hover:bg-amber-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
                  >
                    Confirmar
                  </button>
                </div>
              </div>
            )}
          </div>
          <div className="h-3" />
        </div>
      )}
    </div>
  );
}
