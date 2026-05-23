import { useState, useMemo, memo } from 'react';
import type { CarrinhoItem } from '@/contexts/PDVContext';

const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export interface RodadaMock {
  id: string;
  numero: number;
  nomeResponsavel: string;
  hora: string;
  itens: { nome: string; quantidade: number; preco: number }[];
}

function gerarRodadasMock(mesaNumero: number): RodadaMock[] {
  const horas = ['19:10', '19:35', '20:05'];
  const nomes = [
    ['Carlos Lima', 'Ana Souza'],
    ['Pedro Alves', 'Mariana Costa'],
    ['Roberto Nunes', 'Juliana Melo'],
  ];
  const idx = (mesaNumero - 1) % 3;
  return [
    {
      id: `r-${mesaNumero}-1`,
      numero: 1001 + mesaNumero,
      nomeResponsavel: nomes[idx][0],
      hora: horas[0],
      itens: [
        { nome: 'X-Burguer Clássico', quantidade: 2, preco: 28.9 },
        { nome: 'Batata Frita Clássica', quantidade: 1, preco: 14.9 },
      ],
    },
    {
      id: `r-${mesaNumero}-2`,
      numero: 1002 + mesaNumero,
      nomeResponsavel: nomes[idx][1],
      hora: horas[1],
      itens: [
        { nome: 'X-Bacon Duplo', quantidade: 1, preco: 34.9 },
        { nome: 'Refrigerante Lata', quantidade: 2, preco: 7.5 },
      ],
    },
  ];
}

interface Props {
  mesaNumero: number;
  carrinho: CarrinhoItem[];
  totalCarrinho: number;
  onAvancar: (totalSelecionado: number, rodadasSelecionadas: RodadaMock[]) => void;
  onClose: () => void;
}

export const EtapaContasMesa = memo(function EtapaContasMesa({
  mesaNumero,
  carrinho,
  totalCarrinho,
  onAvancar,
  onClose,
}: Props) {
  const rodadas = useMemo(() => gerarRodadasMock(mesaNumero), [mesaNumero]);
  const [selecionados, setSelecionados] = useState<Set<string>>(
    new Set(rodadas.map((r) => r.id)),
  );
  const [incluirCarrinho, setIncluirCarrinho] = useState(true);

  const toggle = (id: string) => {
    const next = new Set(selecionados);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelecionados(next);
  };

  const totalRodadas = useMemo(
    () =>
      rodadas
        .filter((r) => selecionados.has(r.id))
        .flatMap((r) => r.itens)
        .reduce((a, i) => a + i.preco * i.quantidade, 0),
    [rodadas, selecionados],
  );

  const totalSelecionado = totalRodadas + (incluirCarrinho ? totalCarrinho : 0);
  const podeProsseguir = selecionados.size > 0 || (incluirCarrinho && carrinho.length > 0);

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-200 bg-zinc-50 flex-shrink-0">
          <div>
            <p className="font-bold text-zinc-900">Selecionar Contas</p>
            <p className="text-xs text-zinc-500 mt-0.5">
              Mesa {mesaNumero} · Escolha quais pedidos pagar
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-zinc-200 cursor-pointer text-zinc-400"
          >
            <i className="ri-close-line text-lg" />
          </button>
        </div>

        {/* Lista */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {rodadas.map((rodada) => {
            const subtotal = rodada.itens.reduce((a, i) => a + i.preco * i.quantidade, 0);
            const sel = selecionados.has(rodada.id);
            return (
              <button
                key={rodada.id}
                onClick={() => toggle(rodada.id)}
                className={`w-full text-left border-2 rounded-xl overflow-hidden transition-all cursor-pointer ${
                  sel
                    ? 'border-amber-400 bg-amber-50/40'
                    : 'border-zinc-200 bg-white hover:border-zinc-300'
                }`}
              >
                <div
                  className={`flex items-center gap-2.5 px-3 py-2.5 border-b ${
                    sel ? 'border-amber-100 bg-amber-50' : 'border-zinc-100 bg-zinc-50'
                  }`}
                >
                  <div
                    className={`w-5 h-5 flex items-center justify-center rounded border-2 flex-shrink-0 transition-colors ${
                      sel ? 'bg-amber-500 border-amber-500' : 'border-zinc-300 bg-white'
                    }`}
                  >
                    {sel && <i className="ri-check-line text-white text-[10px]" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold text-zinc-800">
                      Pedido #{rodada.numero} · {rodada.nomeResponsavel}
                    </p>
                    <p className="text-[10px] text-zinc-400">
                      {rodada.hora} · {rodada.itens.length} itens
                    </p>
                  </div>
                  <span
                    className={`text-sm font-black flex-shrink-0 ${
                      sel ? 'text-amber-700' : 'text-zinc-600'
                    }`}
                  >
                    {fmt(subtotal)}
                  </span>
                </div>
                <div className="px-3 py-2">
                  {rodada.itens.map((it, i) => (
                    <div key={i} className="flex items-center gap-1.5 py-0.5">
                      <span className="text-[10px] text-zinc-400 w-4 text-right">
                        {it.quantidade}x
                      </span>
                      <span className="text-[11px] text-zinc-600 truncate">{it.nome}</span>
                    </div>
                  ))}
                </div>
              </button>
            );
          })}

          {/* Carrinho atual */}
          {carrinho.length > 0 && (
            <button
              onClick={() => setIncluirCarrinho((v) => !v)}
              className={`w-full text-left border-2 rounded-xl overflow-hidden transition-all cursor-pointer ${
                incluirCarrinho
                  ? 'border-amber-400 bg-amber-50/40'
                  : 'border-zinc-200 bg-white hover:border-zinc-300'
              }`}
            >
              <div
                className={`flex items-center gap-2.5 px-3 py-2.5 border-b ${
                  incluirCarrinho
                    ? 'border-amber-100 bg-amber-50'
                    : 'border-zinc-100 bg-zinc-50'
                }`}
              >
                <div
                  className={`w-5 h-5 flex items-center justify-center rounded border-2 flex-shrink-0 transition-colors ${
                    incluirCarrinho
                      ? 'bg-amber-500 border-amber-500'
                      : 'border-zinc-300 bg-white'
                  }`}
                >
                  {incluirCarrinho && <i className="ri-check-line text-white text-[10px]" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <p className="text-xs font-bold text-zinc-800">Pedido Atual</p>
                    <span className="text-[9px] font-bold text-amber-600 bg-amber-100 px-1.5 py-0.5 rounded-full">
                      NOVO
                    </span>
                  </div>
                  <p className="text-[10px] text-zinc-400">
                    {carrinho.length} {carrinho.length === 1 ? 'item' : 'itens'} no carrinho
                  </p>
                </div>
                <span
                  className={`text-sm font-black flex-shrink-0 ${
                    incluirCarrinho ? 'text-amber-700' : 'text-zinc-600'
                  }`}
                >
                  {fmt(totalCarrinho)}
                </span>
              </div>
              <div className="px-3 py-2">
                {carrinho.slice(0, 3).map((it) => (
                  <div key={it.cartId} className="flex items-center gap-1.5 py-0.5">
                    <span className="text-[10px] text-zinc-400 w-4 text-right">
                      {it.quantidade}x
                    </span>
                    <span className="text-[11px] text-zinc-600 truncate">{it.nome}</span>
                  </div>
                ))}
                {carrinho.length > 3 && (
                  <p className="text-[10px] text-zinc-400 mt-0.5">
                    +{carrinho.length - 3} mais...
                  </p>
                )}
              </div>
            </button>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-zinc-200 flex-shrink-0 space-y-3">
          <div className="flex items-center justify-between bg-zinc-50 rounded-xl px-4 py-2.5">
            <span className="text-sm font-semibold text-zinc-600">Total selecionado</span>
            <span className="text-lg font-black text-zinc-900">{fmt(totalSelecionado)}</span>
          </div>
          <button
            onClick={() =>
              onAvancar(
                totalSelecionado,
                rodadas.filter((r) => selecionados.has(r.id)),
              )
            }
            disabled={!podeProsseguir}
            className="w-full py-3 bg-amber-500 hover:bg-amber-600 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold rounded-xl cursor-pointer whitespace-nowrap transition-colors flex items-center justify-center gap-2"
          >
            <i className="ri-arrow-right-line" />
            Ir para Pagamento · {fmt(totalSelecionado)}
          </button>
        </div>
      </div>
    </div>
  );
});
