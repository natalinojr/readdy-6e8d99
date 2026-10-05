import { useMemo, useState } from 'react';
import { useCardapio } from '@/contexts/CardapioContext';
import { useDeliveryTela } from '../DeliveryTela';
import { Colunas, Manchete, Nota, PaginaDelivery, SecaoTitulo, semAcento } from '../ui';

// Delivery › Entregadores › Avisos: categorias e itens que fazem o motoboy receber um alerta ("Tem bebida")
// na mensagem dele e no cartão do Gestor. Categorias em chips; item solto só pela busca (o cardápio
// tem uns 100 itens — a lista inteira aberta atrapalhava).

const MAX_RESULTADOS = 20;

export default function AvisosAba() {
  const { cfg, mudar } = useDeliveryTela();
  const { categorias, itens, loading } = useCardapio();
  const { categorias: marcadasCat, itens: marcadosItens } = cfg.avisosMotoboy;
  const [busca, setBusca] = useState('');

  const idsCatMarcadas = useMemo(() => new Set(marcadasCat.map((c) => c.id)), [marcadasCat]);
  const nomeCategoria = useMemo(() => new Map(categorias.map((c) => [c.id, c.nome])), [categorias]);

  // Categorias do cardápio (ativas, ou já marcadas) + as marcadas que sumiram do cardápio (para poder tirar).
  const categoriasMostradas = useMemo(() => {
    const doCardapio = categorias
      .filter((c) => !c.deleted_at && (c.ativo !== false || idsCatMarcadas.has(c.id)))
      .slice().sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0))
      .map((c) => ({ id: c.id, nome: c.nome }));
    const ids = new Set(doCardapio.map((c) => c.id));
    return [...doCardapio, ...marcadasCat.filter((c) => !ids.has(c.id))];
  }, [categorias, marcadasCat, idsCatMarcadas]);

  const alternarCategoria = (c: { id: string; nome: string }) => {
    mudar((atual) => {
      const lista = atual.avisosMotoboy.categorias;
      const tem = lista.some((x) => x.id === c.id);
      return {
        avisosMotoboy: {
          ...atual.avisosMotoboy,
          categorias: tem ? lista.filter((x) => x.id !== c.id) : [...lista, { id: c.id, nome: c.nome }],
        },
      };
    });
  };
  const adicionarItem = (i: { id: string; nome: string }) => {
    mudar((atual) => {
      const lista = atual.avisosMotoboy.itens;
      if (lista.some((x) => x.id === i.id)) return {};
      return { avisosMotoboy: { ...atual.avisosMotoboy, itens: [...lista, { id: i.id, nome: i.nome }] } };
    });
  };
  const tirarItem = (id: string) => {
    mudar((atual) => ({ avisosMotoboy: { ...atual.avisosMotoboy, itens: atual.avisosMotoboy.itens.filter((x) => x.id !== id) } }));
  };

  // Busca de item solto: só aparece algo depois de digitar.
  const q = semAcento(busca);
  const { resultados, total } = useMemo(() => {
    if (!q) return { resultados: [], total: 0 };
    const jaMarcados = new Set(marcadosItens.map((i) => i.id));
    const achados = itens.filter((i) => i.status === 'ativo' && !i.deleted_at && !jaMarcados.has(i.id) && semAcento(i.nome).includes(q));
    return { resultados: achados.slice(0, MAX_RESULTADOS), total: achados.length };
  }, [q, itens, marcadosItens]);

  // Prévia: usa a 1ª categoria marcada (com um item dela de exemplo) ou, sem categoria, o 1º item solto.
  const alertaPrevia = useMemo(() => {
    const cat = marcadasCat[0];
    if (cat) {
      const exemplo = itens.find((i) => i.categoriaId === cat.id && i.status === 'ativo' && !i.deleted_at);
      return exemplo ? `Tem ${cat.nome}: 2 ${exemplo.nome}` : `Tem ${cat.nome}`;
    }
    const item = marcadosItens[0];
    return item ? `Tem ${item.nome}` : '';
  }, [marcadasCat, marcadosItens, itens]);

  return (
    <PaginaDelivery>
      <Colunas>
        <div>
          <Manchete titulo="Avisar o motoboy quando tiver…">
            A mensagem do motoboy e o cartão no Gestor ganham um alerta para ele conferir antes de sair.
          </Manchete>

          <p className="text-[13px] font-extrabold text-zinc-900 mt-4 mb-1.5">Categorias</p>
          {loading && categoriasMostradas.length === 0 ? (
            <p className="text-xs text-zinc-400"><i className="ri-loader-4-line animate-spin mr-1" />Carregando o cardápio…</p>
          ) : categoriasMostradas.length === 0 ? (
            <p className="text-xs text-zinc-400">Nenhuma categoria no cardápio.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {categoriasMostradas.map((c) => {
                const ligada = idsCatMarcadas.has(c.id);
                return (
                  <button key={c.id} type="button" onClick={() => alternarCategoria(c)} aria-pressed={ligada}
                    className={`inline-flex items-center gap-1 h-8 px-3 rounded-full border text-[12.5px] font-bold cursor-pointer whitespace-nowrap ${
                      ligada ? 'bg-zinc-900 border-zinc-900 text-white' : 'bg-white border-zinc-200 text-zinc-700 hover:border-zinc-300'}`}>
                    {ligada && <i className="ri-check-line" />}{c.nome}
                  </button>
                );
              })}
            </div>
          )}

          <p className="text-[13px] font-extrabold text-zinc-900 mt-5 mb-1.5">
            Itens soltos <span className="font-semibold text-zinc-400 text-[11.5px] ml-1">só se não quiser a categoria inteira</span>
          </p>
          <div className="relative">
            <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
            <input type="text" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Procurar item…" aria-label="Procurar item"
              className="w-full h-[42px] rounded-xl border border-zinc-200 bg-white pl-9 pr-3 text-sm outline-none focus:border-amber-400" />
          </div>

          {q && (
            <div className="mt-2 bg-white border border-zinc-200 rounded-2xl overflow-hidden">
              {resultados.length === 0 ? (
                <p className="px-3.5 py-3 text-xs text-zinc-500">Nenhum item com esse nome (ou ele já está marcado).</p>
              ) : (
                <ul className="max-h-72 overflow-y-auto divide-y divide-zinc-100">
                  {resultados.map((i) => {
                    const jaPelaCategoria = idsCatMarcadas.has(i.categoriaId);
                    return (
                      <li key={i.id}>
                        <button type="button" disabled={jaPelaCategoria} onClick={() => adicionarItem(i)}
                          className="w-full flex items-center gap-2 px-3.5 py-2.5 text-left cursor-pointer hover:bg-zinc-50 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:opacity-60">
                          <span className="flex-1 min-w-0">
                            <span className="block text-[13.5px] font-semibold text-zinc-800 truncate">{i.nome}</span>
                            <span className="block text-[11px] text-zinc-400 truncate">
                              {jaPelaCategoria ? `Já avisa pela categoria ${nomeCategoria.get(i.categoriaId) ?? ''}` : (nomeCategoria.get(i.categoriaId) ?? '')}
                            </span>
                          </span>
                          {!jaPelaCategoria && <i className="ri-add-circle-line text-xl text-amber-600 flex-shrink-0" />}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
              {total > resultados.length && (
                <p className="px-3.5 py-2 text-[11px] text-zinc-400 border-t border-zinc-100">
                  Mostrando {resultados.length} de {total}. Escreva mais do nome para achar o certo.
                </p>
              )}
            </div>
          )}

          {marcadosItens.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-3">
              {marcadosItens.map((i) => (
                <span key={i.id} className="inline-flex items-center gap-1 h-8 pl-3 pr-1.5 rounded-full border border-amber-200 bg-amber-50 text-amber-800 text-[12.5px] font-bold max-w-full">
                  <span className="truncate">{i.nome}</span>
                  <button type="button" onClick={() => tirarItem(i.id)} aria-label={`Tirar ${i.nome} dos avisos`} title="Tirar"
                    className="w-6 h-6 flex-shrink-0 inline-flex items-center justify-center rounded-full hover:bg-amber-100 cursor-pointer">
                    <i className="ri-close-line" />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>

        <div>
          <SecaoTitulo titulo="Como chega para o motoboy" />
          <div className="bg-[#EFEAE2] rounded-2xl p-2.5">
            <div className="ml-auto max-w-[88%] bg-[#D9FDD3] rounded-xl px-2.5 py-2 text-[12.5px] leading-snug text-zinc-800 shadow-sm">
              <p className="text-[10px] font-extrabold text-zinc-500 mb-0.5">ERPOS</p>
              <p>🏍️ Pedido #0042 · Rafael</p>
              <p>Rua das Gaivotas, 120 · 2,8 km</p>
              {alertaPrevia && <p className="font-bold">⚠️ {alertaPrevia}</p>}
              <p>Pagamento: Pix pelo app (já pago)</p>
            </div>
          </div>
          <Nota className="mt-2">
            {alertaPrevia
              ? 'Exemplo com um pedido de mentira. Se o pedido tiver mais de uma coisa marcada, todas aparecem na linha de aviso.'
              : 'Exemplo com um pedido de mentira. Nada marcado: a mensagem sai sem alerta.'}
          </Nota>
        </div>
      </Colunas>
    </PaginaDelivery>
  );
}
