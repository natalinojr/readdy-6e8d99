import { useState } from 'react';
import type { DestinoInfo, DestinoType } from '../../../../contexts/PDVContext';
import { useMesas } from '../../../../contexts/MesasContext';

interface Props {
  current: DestinoInfo | null;
  onConfirm: (d: DestinoInfo) => void;
  onClose: () => void;
  /** Chamado quando a mesa selecionada está livre — precisa abrir antes */
  onAbrirMesa?: (mesaId: string, mesaNumero: number) => void;
}

const TIPOS: { tipo: DestinoType; label: string; icon: string; desc: string }[] = [
  { tipo: 'mesa', label: 'Mesa', icon: 'ri-table-line', desc: 'Lançar em mesa do salão' },
  { tipo: 'nome', label: 'Nome', icon: 'ri-user-line', desc: 'Chamado pelo nome no balcão' },
  { tipo: 'senha', label: 'Senha', icon: 'ri-ticket-line', desc: 'Chamado por senha' },
  { tipo: 'delivery', label: 'Delivery', icon: 'ri-e-bike-line', desc: 'Entrega em domicílio' },
];

export default function DestinoModal({ current, onConfirm, onClose, onAbrirMesa }: Props) {
  const { mesas } = useMesas();
  const [tipo, setTipo] = useState<DestinoType>(current?.tipo && current.tipo !== 'hora' ? current.tipo : 'mesa');
  const [mesaId, setMesaId] = useState(current?.mesaId ?? '');
  const [nomeCliente, setNomeCliente] = useState(current?.nomeCliente ?? '');
  const [telefone, setTelefone] = useState(current?.telefone ?? '');
  const [senha, setSenha] = useState(current?.senha ?? '');
  const [observacaoPedido, setObservacaoPedido] = useState(current?.observacaoPedido ?? '');

  // Mostra todas as mesas (livres + ocupadas), exceto bloqueadas
  const todasMesas = mesas
    .filter((m) => m.status !== 'bloqueada')
    .sort((a, b) => a.numero - b.numero);

  // Compatível com código antigo
  const mesasLivres = mesas.filter((m) => m.status === 'livre' || m.id === current?.mesaId);

  const handleConfirm = () => {
    let info: DestinoInfo = { tipo };
    if (tipo === 'mesa') {
      const mesa = mesas.find((m) => m.id === mesaId);
      // Se a mesa estiver livre, precisamos abri-la primeiro (pede nome do cliente)
      if (mesa && mesa.status === 'livre' && onAbrirMesa) {
        onAbrirMesa(mesaId, mesa.numero);
        return;
      }
      info = { tipo, mesaId, mesaNumero: mesa?.numero, nomeCliente: mesa?.clienteNome, observacaoPedido: observacaoPedido.trim() || undefined };
    } else if (tipo === 'nome') {
      if (!nomeCliente.trim()) return;
      info = { tipo, nomeCliente, observacaoPedido: observacaoPedido.trim() || undefined };
    } else if (tipo === 'senha') {
      if (!senha.trim()) return;
      info = { tipo, senha, observacaoPedido: observacaoPedido.trim() || undefined };
    } else if (tipo === 'delivery') {
      if (!nomeCliente.trim()) return;
      info = { tipo, nomeCliente, telefone, observacaoPedido: observacaoPedido.trim() || undefined };
    }
    onConfirm(info);
  };

  const isValid = () => {
    if (tipo === 'mesa') return !!mesaId;
    if (tipo === 'nome') return !!nomeCliente.trim();
    if (tipo === 'senha') return !!senha.trim();
    if (tipo === 'delivery') return !!nomeCliente.trim();
    return false;
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-200">
          <p className="font-bold text-zinc-900">Destino do Pedido</p>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-zinc-100 cursor-pointer text-zinc-400">
            <i className="ri-close-line text-lg" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Tipo selector */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {TIPOS.map((t) => (
              <button
                key={t.tipo}
                onClick={() => setTipo(t.tipo)}
                className={`flex flex-col items-center gap-1.5 p-2 rounded-xl border-2 transition-colors cursor-pointer ${
                  tipo === t.tipo
                    ? 'border-amber-500 bg-amber-50'
                    : 'border-zinc-200 hover:border-zinc-300 bg-white'
                }`}
              >
                <div className={`w-8 h-8 flex items-center justify-center rounded-lg ${tipo === t.tipo ? 'text-amber-600' : 'text-zinc-400'}`}>
                  <i className={`${t.icon} text-lg`} />
                </div>
                <span className={`text-[10px] font-semibold text-center leading-tight ${tipo === t.tipo ? 'text-amber-700' : 'text-zinc-500'}`}>
                  {t.label}
                </span>
              </button>
            ))}
          </div>

          {/* Tipo-specific fields */}
          {tipo === 'mesa' && (
            <div>
              <label className="block text-sm font-medium text-zinc-700 mb-2">Selecione a Mesa</label>
              <div className="grid grid-cols-4 sm:grid-cols-5 gap-2 max-h-48 overflow-y-auto pr-1">
                {todasMesas.map((mesa) => {
                  const isOcupada = mesa.status === 'ocupada';
                  const isSelected = mesaId === mesa.id;
                  return (
                    <button
                      key={mesa.id}
                      onClick={() => setMesaId(mesa.id)}
                      title={isOcupada ? `Ocupada${mesa.clienteNome ? ` — ${mesa.clienteNome}` : ''}` : 'Livre'}
                      className={`relative py-3 rounded-lg border-2 text-sm font-bold transition-colors cursor-pointer ${
                        isSelected
                          ? 'border-amber-500 bg-amber-50 text-amber-700'
                          : isOcupada
                            ? 'border-zinc-300 bg-zinc-100 text-zinc-500 hover:border-amber-300'
                            : 'border-zinc-200 text-zinc-700 hover:border-amber-300'
                      }`}
                    >
                      {mesa.numero}
                      {isOcupada && (
                        <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-amber-500" />
                      )}
                    </button>
                  );
                })}
              </div>
              {todasMesas.length === 0 && <p className="text-sm text-zinc-400 text-center py-4">Nenhuma mesa disponível</p>}
              {/* Legenda */}
              <div className="flex items-center gap-3 mt-1.5">
                <span className="flex items-center gap-1 text-[10px] text-zinc-400">
                  <span className="w-2 h-2 rounded-full bg-zinc-200 border border-zinc-300" /> Livre
                </span>
                <span className="flex items-center gap-1 text-[10px] text-zinc-400">
                  <span className="w-2 h-2 rounded-full bg-amber-500" /> Ocupada
                </span>
              </div>
            </div>
          )}

          {(tipo === 'nome' || tipo === 'delivery') && (
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">Nome do Cliente</label>
                <input
                  type="text"
                  value={nomeCliente}
                  onChange={(e) => setNomeCliente(e.target.value)}
                  placeholder="Ex: João Silva"
                  className="w-full border border-zinc-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                />
              </div>
              {tipo === 'delivery' && (
                <div>
                  <label className="block text-sm font-medium text-zinc-700 mb-1">Telefone (opcional)</label>
                  <input
                    type="tel"
                    value={telefone}
                    onChange={(e) => setTelefone(e.target.value)}
                    placeholder="(11) 99999-9999"
                    className="w-full border border-zinc-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                  />
                </div>
              )}
            </div>
          )}

          {tipo === 'senha' && (
            <div>
              <label className="block text-sm font-medium text-zinc-700 mb-1">Senha do Pedido</label>
              <input
                type="text"
                value={senha}
                onChange={(e) => setSenha(e.target.value.toUpperCase())}
                placeholder="Ex: A-01"
                className="w-full border border-zinc-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
              />
            </div>
          )}

          {/* Observação geral do pedido (balcão / delivery) */}
          {(tipo === 'nome' || tipo === 'senha' || tipo === 'delivery') && (
            <div>
              <label className="block text-sm font-medium text-zinc-700 mb-1">
                <span className="flex items-center gap-1.5">
                  <i className="ri-chat-2-line text-zinc-400 text-sm" />
                  Observação do Pedido
                  <span className="text-[10px] text-zinc-400 font-normal">(opcional)</span>
                </span>
              </label>
              <textarea
                value={observacaoPedido}
                onChange={(e) => setObservacaoPedido(e.target.value.slice(0, 300))}
                placeholder="Ex: cliente volta em 20 min, pagar na retirada, etc."
                rows={2}
                className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 resize-none"
              />
              <p className="text-[10px] text-zinc-400 mt-0.5 text-right">{observacaoPedido.length}/300</p>
            </div>
          )}
        </div>

        <div className="px-5 pb-5">
          <button
            onClick={handleConfirm}
            disabled={!isValid()}
            className="w-full py-3 bg-amber-500 hover:bg-amber-600 disabled:opacity-40 text-white font-semibold rounded-lg transition-colors cursor-pointer whitespace-nowrap"
          >
            Confirmar Destino
          </button>
        </div>
      </div>
    </div>
  );
}