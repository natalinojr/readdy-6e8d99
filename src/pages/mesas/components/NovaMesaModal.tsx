import { useState } from 'react';
import type { Mesa } from '../../../contexts/MesasContext';

interface Props {
  mesa: Mesa | null;
  onClose: () => void;
  onSalvar: (data: Mesa) => void;
  onExcluir: (id: string) => void;
}

const AREAS = ['Salão', 'Varanda', 'VIP', 'Terraço', 'Jardim'];

export default function NovaMesaModal({ mesa, onClose, onSalvar, onExcluir }: Props) {
  const editando = mesa !== null;

  const [numero, setNumero] = useState(editando ? String(mesa.numero) : '');
  const [capacidade, setCapacidade] = useState(editando ? String(mesa.capacidade) : '4');
  const [area, setArea] = useState(editando ? (mesa.area ?? 'Salão') : 'Salão');
  const [erros, setErros] = useState<string[]>([]);
  const [confirmarExcluir, setConfirmarExcluir] = useState(false);

  const handleSalvar = () => {
    const msgs: string[] = [];
    const num = parseInt(numero, 10);
    if (!numero || isNaN(num) || num < 1) msgs.push('Informe um número de mesa válido.');
    if (msgs.length > 0) { setErros(msgs); return; }

    const dadosMesa: Mesa = {
      id: editando ? mesa.id : `m${num}-${Date.now()}`,
      numero: num,
      capacidade: parseInt(capacidade, 10),
      area,
      status: editando ? mesa.status : 'livre',
      clienteNome: editando ? mesa.clienteNome : undefined,
      totalConsumo: editando ? mesa.totalConsumo : undefined,
      abertaEm: editando ? mesa.abertaEm : undefined,
      garcomNome: editando ? mesa.garcomNome : undefined,
    };
    onSalvar(dadosMesa);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-lg overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-100">
          <div>
            <h2 className="font-bold text-zinc-900 text-base">
              {editando ? `Editar Mesa ${mesa.numero}` : 'Nova Mesa'}
            </h2>
            <p className="text-xs text-zinc-400 mt-0.5">
              {editando ? 'Altere as configurações da mesa' : 'Adicione uma nova mesa ao salão'}
            </p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-zinc-100 cursor-pointer text-zinc-400 transition-colors">
            <i className="ri-close-line text-lg" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          {/* Número */}
          <div>
            <label className="block text-xs font-semibold text-zinc-700 mb-1.5">Número da Mesa</label>
            <input
              type="number"
              min="1"
              max="200"
              value={numero}
              onChange={(e) => { setNumero(e.target.value); setErros([]); }}
              placeholder="Ex: 16"
              className="w-full border border-zinc-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
              autoFocus
            />
          </div>

          {/* Capacidade */}
          <div>
            <label className="block text-xs font-semibold text-zinc-700 mb-1.5">Capacidade</label>
            <div className="flex gap-2">
              {['2', '4', '6', '8', '10'].map((cap) => (
                <button
                  key={cap}
                  onClick={() => setCapacidade(cap)}
                  className={`flex-1 py-2 rounded-xl text-sm font-semibold border-2 transition-all cursor-pointer whitespace-nowrap ${
                    capacidade === cap
                      ? 'border-amber-500 bg-amber-50 text-amber-700'
                      : 'border-zinc-200 text-zinc-600 hover:border-zinc-300'
                  }`}
                >
                  {cap}
                </button>
              ))}
            </div>
          </div>

          {/* Área */}
          <div>
            <label className="block text-xs font-semibold text-zinc-700 mb-1.5">Área / Localização</label>
            <div className="flex flex-wrap gap-2">
              {AREAS.map((a) => (
                <button
                  key={a}
                  onClick={() => setArea(a)}
                  className={`px-3 py-2 rounded-xl text-sm font-semibold border-2 transition-all cursor-pointer whitespace-nowrap ${
                    area === a
                      ? 'border-amber-500 bg-amber-50 text-amber-700'
                      : 'border-zinc-200 text-zinc-600 hover:border-zinc-300'
                  }`}
                >
                  {a}
                </button>
              ))}
            </div>
          </div>

          {erros.length > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2.5">
              {erros.map((e) => <p key={e} className="text-xs text-red-600 font-medium">{e}</p>)}
            </div>
          )}

          {/* Preview QR URL */}
          {numero && !isNaN(parseInt(numero, 10)) && (
            <div className="bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2.5">
              <p className="text-[10px] font-semibold text-zinc-500 mb-0.5">URL do QR Code (gerada automaticamente)</p>
              <p className="text-xs font-mono text-zinc-700 break-all">/mesa/{numero}</p>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="px-6 pb-5 flex flex-col gap-2">
          <button
            onClick={handleSalvar}
            className="w-full py-3 bg-amber-500 hover:bg-amber-600 text-white font-bold text-sm rounded-xl cursor-pointer whitespace-nowrap transition-colors"
          >
            <i className="ri-save-line mr-1.5" />
            {editando ? 'Salvar Alterações' : 'Criar Mesa'}
          </button>

          {editando && !confirmarExcluir && (
            <button
              onClick={() => setConfirmarExcluir(true)}
              className="w-full py-2.5 border-2 border-red-200 text-red-500 hover:bg-red-50 font-semibold text-sm rounded-xl cursor-pointer whitespace-nowrap transition-colors"
            >
              <i className="ri-delete-bin-line mr-1.5" />
              Remover Mesa
            </button>
          )}

          {confirmarExcluir && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-3">
              <p className="text-xs font-bold text-red-700 text-center mb-3">Confirmar remoção da Mesa {mesa?.numero}?</p>
              <div className="flex gap-2">
                <button
                  onClick={() => setConfirmarExcluir(false)}
                  className="flex-1 py-2 border border-zinc-200 text-zinc-600 text-sm font-semibold rounded-lg cursor-pointer hover:bg-zinc-50 transition-colors whitespace-nowrap"
                >
                  Cancelar
                </button>
                <button
                  onClick={() => { if (mesa) { onExcluir(mesa.id); onClose(); } }}
                  className="flex-1 py-2 bg-red-500 text-white text-sm font-bold rounded-lg cursor-pointer hover:bg-red-600 transition-colors whitespace-nowrap"
                >
                  Sim, remover
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
