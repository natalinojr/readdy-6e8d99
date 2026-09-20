import { useAlertasInsumoZerado } from '@/hooks/useAlertasInsumoZerado';
import type { ItemAfetado } from '@/hooks/useAlertasInsumoZerado';

interface Props {
  /** De onde veio a resposta — fica registrado no alerta. */
  origem: 'pdv' | 'kds';
  /** 'kds' usa fonte maior, para ler de longe na cozinha. */
  tamanho?: 'normal' | 'grande';
}

function listaNomes(itens: ItemAfetado[], limite: number): string {
  const nomes = itens.map((i) => i.nome);
  if (nomes.length <= limite) return nomes.join(', ');
  return `${nomes.slice(0, limite).join(', ')} +${nomes.length - limite}`;
}

/**
 * Insumo zerou → pergunta antes de tirar os itens do cardápio.
 * Aparece ao mesmo tempo no PDV e no KDS; o primeiro que responder resolve para todo mundo.
 * Enquanto ninguém responde, nada sai do cardápio — o item continua vendável.
 */
export default function AvisoInsumoZerado({ origem, tamanho = 'normal' }: Props) {
  const { alertas, responder, resolvendo } = useAlertasInsumoZerado(origem);

  if (alertas.length === 0) return null;

  const g = tamanho === 'grande';

  return (
    <div className={`flex flex-col gap-2 ${g ? 'mb-3' : 'mb-4'}`}>
      {alertas.map((a) => {
        const total = a.itens.length + a.opcionais.length;
        const ocupado = resolvendo === a.id;
        return (
          <div key={a.id} className="bg-amber-50 border border-amber-300 rounded-xl p-4 flex items-start gap-3">
            <div className="w-9 h-9 flex items-center justify-center rounded-lg bg-amber-100 flex-shrink-0">
              <i className="ri-alarm-warning-line text-amber-600 text-lg" />
            </div>
            <div className="flex-1 min-w-0">
              <p className={`font-bold text-amber-900 ${g ? 'text-base' : 'text-sm'}`}>
                Acabou o insumo: {a.ingredientName}
              </p>
              <p className={`text-amber-800 mt-0.5 ${g ? 'text-sm' : 'text-xs'}`}>
                {total === 0
                  ? 'Nenhum item do cardápio usa este insumo.'
                  : <>Tira do cardápio {a.itens.length > 0 && <strong>{a.itens.length} {a.itens.length === 1 ? 'item' : 'itens'}</strong>}
                      {a.itens.length > 0 && a.opcionais.length > 0 && ' e '}
                      {a.opcionais.length > 0 && <strong>{a.opcionais.length} {a.opcionais.length === 1 ? 'opcional' : 'opcionais'}</strong>}
                      ? Se ainda tem na prateleira, é só manter vendendo.</>}
              </p>
              {a.itens.length > 0 && (
                <p className={`text-amber-700 mt-1.5 ${g ? 'text-sm' : 'text-xs'}`}>
                  {listaNomes(a.itens, g ? 8 : 5)}
                </p>
              )}
              {a.opcionais.length > 0 && (
                <p className={`text-amber-700 mt-0.5 ${g ? 'text-sm' : 'text-xs'}`}>
                  Opcionais: {listaNomes(a.opcionais, g ? 8 : 5)}
                </p>
              )}

              <div className="flex flex-wrap items-center gap-2 mt-3">
                <button
                  onClick={() => responder(a.id, 'removed')}
                  disabled={ocupado || total === 0}
                  className={`flex items-center gap-1.5 px-3 bg-amber-600 hover:bg-amber-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold rounded-lg cursor-pointer transition-colors whitespace-nowrap ${g ? 'py-2.5 text-sm' : 'py-1.5 text-xs'}`}
                >
                  <i className="ri-eye-off-line" />
                  Tirar do cardápio
                </button>
                <button
                  onClick={() => responder(a.id, 'kept')}
                  disabled={ocupado}
                  className={`flex items-center gap-1.5 px-3 border border-amber-300 bg-white hover:bg-amber-100 disabled:opacity-40 text-amber-800 font-bold rounded-lg cursor-pointer transition-colors whitespace-nowrap ${g ? 'py-2.5 text-sm' : 'py-1.5 text-xs'}`}
                >
                  <i className="ri-check-line" />
                  Tem sim, continua vendendo
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
