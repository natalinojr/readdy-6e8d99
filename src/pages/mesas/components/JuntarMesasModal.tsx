import { useState } from 'react';
import type { Mesa } from '../../../contexts/MesasContext';

interface Props {
  mesaPrincipal: Mesa;
  todasMesas: Mesa[];
  onClose: () => void;
  onJuntar: (mesaPrincipalId: string, mesaSecundariaId: string) => void;
}

function formatPrice(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export default function JuntarMesasModal({ mesaPrincipal, todasMesas, onClose, onJuntar }: Props) {
  const [mesaSecundaria, setMesaSecundaria] = useState<Mesa | null>(null);
  const [etapa, setEtapa] = useState<'escolher' | 'confirmar' | 'sucesso'>('escolher');

  const mesasOcupadas = todasMesas.filter(
    (m) => m.status === 'ocupada' && m.id !== mesaPrincipal.id
  );

  const totalPrincipal = mesaPrincipal.totalConsumo ?? 0;
  const totalSecundaria = mesaSecundaria?.totalConsumo ?? 0;
  const totalJunto = totalPrincipal + totalSecundaria;

  const handleConfirmar = () => {
    if (!mesaSecundaria) return;
    onJuntar(mesaPrincipal.id, mesaSecundaria.id);
    setEtapa('sucesso');
  };

  if (etapa === 'sucesso') {
    return (
      <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl w-full max-w-sm p-8 text-center">
          <div className="w-16 h-16 flex items-center justify-center bg-green-100 rounded-full mx-auto mb-4">
            <i className="ri-merge-cells-horizontal text-3xl text-green-500" />
          </div>
          <h3 className="font-black text-zinc-900 text-lg mb-1">Mesas Unificadas!</h3>
          <p className="text-sm text-zinc-500 mb-2">
            Mesa {mesaSecundaria?.numero} foi unificada com Mesa {mesaPrincipal.numero}
          </p>
          <p className="text-xs text-zinc-400 mb-6">Todos os pedidos e consumo foram consolidados</p>
          <button onClick={onClose} className="w-full py-3 bg-amber-500 hover:bg-amber-600 text-white font-bold rounded-xl cursor-pointer transition-colors whitespace-nowrap">
            Fechar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-md overflow-hidden">
        {/* Header */}
        <div className="flex items-start justify-between px-5 py-4 border-b border-zinc-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 flex items-center justify-center bg-amber-100 rounded-xl">
              <i className="ri-merge-cells-horizontal text-amber-600 text-lg" />
            </div>
            <div>
              <h3 className="font-bold text-zinc-900 text-sm">Juntar Mesas</h3>
              <p className="text-xs text-zinc-400 mt-0.5">Unificar pedidos de duas mesas em uma só</p>
            </div>
          </div>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 rounded-lg cursor-pointer transition-colors">
            <i className="ri-close-line text-base" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          {etapa === 'escolher' && (
            <>
              {/* Mesa principal (destino) */}
              <div>
                <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider mb-2">Mesa Principal (destino)</p>
                <div className="flex items-center gap-3 p-3 bg-amber-50 border-2 border-amber-300 rounded-xl">
                  <div className="w-10 h-10 flex items-center justify-center bg-amber-100 rounded-lg flex-shrink-0">
                    <i className="ri-restaurant-2-line text-amber-600 text-lg" />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-bold text-zinc-800">Mesa {mesaPrincipal.numero}</p>
                    <p className="text-xs text-zinc-500">
                      {mesaPrincipal.clienteNome ?? 'Cliente'}
                      {mesaPrincipal.abertaEm && ` · desde ${mesaPrincipal.abertaEm}`}
                    </p>
                  </div>
                  <span className="text-sm font-black text-amber-700">{formatPrice(totalPrincipal)}</span>
                </div>
              </div>

              {/* Escolher mesa secundária */}
              <div>
                <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider mb-2">Mesa para Unificar (origem — será liberada)</p>
                {mesasOcupadas.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-8 text-zinc-400">
                    <div className="w-10 h-10 flex items-center justify-center mb-2">
                      <i className="ri-restaurant-2-line text-3xl" />
                    </div>
                    <p className="text-sm font-semibold">Nenhuma outra mesa ocupada</p>
                    <p className="text-xs mt-1">Só é possível juntar mesas que estão ocupadas</p>
                  </div>
                ) : (
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {mesasOcupadas.map((m) => (
                      <button
                        key={m.id}
                        onClick={() => setMesaSecundaria(m)}
                        className={`w-full flex items-center gap-3 p-3 rounded-xl border-2 text-left cursor-pointer transition-all ${
                          mesaSecundaria?.id === m.id
                            ? 'border-amber-400 bg-amber-50'
                            : 'border-zinc-200 hover:border-zinc-300'
                        }`}
                      >
                        <div className={`w-4 h-4 flex items-center justify-center rounded-full border-2 flex-shrink-0 ${mesaSecundaria?.id === m.id ? 'border-amber-500 bg-amber-500' : 'border-zinc-300'}`}>
                          {mesaSecundaria?.id === m.id && <div className="w-2 h-2 bg-white rounded-full" />}
                        </div>
                        <div className="flex-1">
                          <p className="text-sm font-bold text-zinc-800">Mesa {m.numero}</p>
                          <p className="text-xs text-zinc-500">
                            {m.clienteNome ?? 'Cliente'}
                            {m.garcomNome && ` · ${m.garcomNome}`}
                            {m.abertaEm && ` · desde ${m.abertaEm}`}
                          </p>
                        </div>
                        <span className="text-sm font-bold text-zinc-600">{formatPrice(m.totalConsumo ?? 0)}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {mesaSecundaria && (
                <div className="p-3 bg-zinc-50 border border-zinc-200 rounded-xl">
                  <p className="text-xs font-semibold text-zinc-500 mb-1">Consumo total unificado</p>
                  <p className="text-lg font-black text-amber-600">{formatPrice(totalJunto)}</p>
                  <p className="text-[10px] text-zinc-400 mt-0.5">
                    Mesa {mesaPrincipal.numero}: {formatPrice(totalPrincipal)} + Mesa {mesaSecundaria.numero}: {formatPrice(totalSecundaria)}
                  </p>
                </div>
              )}

              <div className="flex gap-3">
                <button onClick={onClose} className="flex-1 py-2.5 border border-zinc-200 text-zinc-600 text-sm font-semibold rounded-xl cursor-pointer hover:bg-zinc-50 transition-colors whitespace-nowrap">
                  Cancelar
                </button>
                <button
                  onClick={() => setEtapa('confirmar')}
                  disabled={!mesaSecundaria}
                  className="flex-1 py-2.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-bold rounded-xl cursor-pointer transition-colors whitespace-nowrap"
                >
                  Continuar
                </button>
              </div>
            </>
          )}

          {etapa === 'confirmar' && mesaSecundaria && (
            <>
              <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl">
                <p className="text-xs font-bold text-amber-800 mb-3">Confirmar Unificação</p>
                <div className="space-y-2">
                  {[
                    { label: 'Mesa principal (mantém)', value: `Mesa ${mesaPrincipal.numero} · ${mesaPrincipal.clienteNome ?? 'Cliente'}` },
                    { label: 'Mesa secundária (será liberada)', value: `Mesa ${mesaSecundaria.numero} · ${mesaSecundaria.clienteNome ?? 'Cliente'}` },
                    { label: 'Total unificado', value: formatPrice(totalJunto) },
                  ].map(({ label, value }) => (
                    <div key={label} className="flex items-center justify-between text-xs">
                      <span className="text-amber-700">{label}</span>
                      <span className="font-bold text-amber-900">{value}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="p-3 bg-zinc-50 border border-zinc-200 rounded-xl text-xs text-zinc-600">
                <i className="ri-information-line mr-1 text-zinc-400" />
                Todos os pedidos da Mesa {mesaSecundaria.numero} serão transferidos para a Mesa {mesaPrincipal.numero}. A Mesa {mesaSecundaria.numero} ficará livre.
              </div>

              <div className="flex gap-3">
                <button onClick={() => setEtapa('escolher')} className="flex-1 py-2.5 border border-zinc-200 text-zinc-600 text-sm font-semibold rounded-xl cursor-pointer hover:bg-zinc-50 transition-colors whitespace-nowrap">
                  Voltar
                </button>
                <button
                  onClick={handleConfirmar}
                  className="flex-1 py-2.5 bg-amber-500 hover:bg-amber-600 text-white text-sm font-bold rounded-xl cursor-pointer transition-colors whitespace-nowrap"
                >
                  <i className="ri-merge-cells-horizontal mr-1" />
                  Juntar Mesas
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
