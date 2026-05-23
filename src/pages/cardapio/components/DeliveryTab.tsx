import type { ConfiguracaoDelivery, FichaTecnicaItem } from '@/types/cardapio';
import FichaTecnicaTab from './FichaTecnicaTab';

interface Props {
  config: ConfiguracaoDelivery | undefined;
  precoBase: number;
  slaBase: number;
  descricaoBase: string;
  onChange: (config: ConfiguracaoDelivery) => void;
}

function formatPrice(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

const defaultConfig = (precoBase: number, slaBase: number): ConfiguracaoDelivery => ({
  ativo: false,
  preco: precoBase,
  slaMinutos: slaBase,
  quantidadeMinima: 1,
  quantidadeMaxima: undefined,
  embalagem: '',
  descricao: '',
  fichaTecnica: [],
});

export default function DeliveryTab({ config, precoBase, slaBase, descricaoBase, onChange }: Props) {
  const cfg = config ?? defaultConfig(precoBase, slaBase);

  const update = (patch: Partial<ConfiguracaoDelivery>) => {
    onChange({ ...cfg, ...patch });
  };

  const handleToggle = (val: boolean) => {
    if (val && !config) {
      onChange(defaultConfig(precoBase, slaBase));
    } else {
      update({ ativo: val });
    }
  };

  const handleFichaChange = (fichas: FichaTecnicaItem[]) => {
    update({ fichaTecnica: fichas });
  };

  const precoDelivery = cfg.preco ?? precoBase;
  const diferencaPreco = precoDelivery - precoBase;

  return (
    <div className="space-y-5">

      {/* Toggle principal */}
      <div className={`flex items-start gap-4 p-4 rounded-xl border transition-colors ${cfg.ativo ? 'bg-orange-50 border-orange-200' : 'bg-zinc-50 border-zinc-200'}`}>
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-0.5">
            <div className="w-5 h-5 flex items-center justify-center">
              <i className="ri-e-bike-2-line text-orange-500 text-base" />
            </div>
            <p className="text-sm font-semibold text-gray-800">Disponível no Delivery</p>
            {cfg.ativo && (
              <span className="text-[10px] font-bold px-2 py-0.5 bg-orange-100 text-orange-700 border border-orange-200 rounded-full">
                ATIVO
              </span>
            )}
          </div>
          <p className="text-xs text-gray-500 mt-0.5">
            Ative para que este item apareça no cardápio de delivery. Você pode definir
            preço, quantidade, embalagem e ficha técnica <strong>diferentes</strong> do cardápio presencial.
          </p>
        </div>
        <button
          onClick={() => handleToggle(!cfg.ativo)}
          className={`relative flex-shrink-0 w-11 h-6 rounded-full transition-colors cursor-pointer mt-0.5 ${cfg.ativo ? 'bg-orange-500' : 'bg-gray-200'}`}
        >
          <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${cfg.ativo ? 'left-6' : 'left-1'}`} />
        </button>
      </div>

      {/* Conteúdo quando ativo */}
      {cfg.ativo && (
        <>
          {/* ── Preço e Quantidade ── */}
          <div className="grid grid-cols-2 gap-4">
            {/* Preço delivery */}
            <div className="col-span-2 md:col-span-1">
              <label className="block text-xs font-semibold text-gray-600 mb-1.5">
                Preço no Delivery (R$)
              </label>
              <div className="relative">
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={cfg.preco ?? precoBase}
                  onChange={(e) => update({ preco: parseFloat(e.target.value) || 0 })}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-orange-400 transition-colors"
                  placeholder={String(precoBase)}
                />
              </div>
              <div className="flex items-center gap-1.5 mt-1">
                <span className="text-[10px] text-gray-400">
                  Cardápio local: <strong className="text-gray-600">{formatPrice(precoBase)}</strong>
                </span>
                {diferencaPreco !== 0 && (
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${diferencaPreco > 0 ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-600'}`}>
                    {diferencaPreco > 0 ? '+' : ''}{formatPrice(diferencaPreco)}
                  </span>
                )}
                {diferencaPreco === 0 && (
                  <span className="text-[10px] text-gray-400 italic">mesmo preço</span>
                )}
              </div>
            </div>

            {/* SLA delivery */}
            <div className="col-span-2 md:col-span-1">
              <label className="block text-xs font-semibold text-gray-600 mb-1.5">
                Tempo de Preparo Delivery (min)
                <span className="text-[10px] font-normal text-gray-400 ml-1">(inclui embalagem)</span>
              </label>
              <input
                type="number"
                min="1"
                value={cfg.slaMinutos ?? slaBase}
                onChange={(e) => update({ slaMinutos: parseInt(e.target.value, 10) || 1 })}
                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-orange-400 transition-colors"
              />
              <p className="text-[10px] text-gray-400 mt-1">
                Cardápio local: <strong className="text-gray-600">{slaBase} min</strong>
                {(cfg.slaMinutos ?? slaBase) !== slaBase && (
                  <span className="ml-1 text-orange-600 font-semibold">
                    ({(cfg.slaMinutos ?? slaBase) - slaBase > 0 ? '+' : ''}{(cfg.slaMinutos ?? slaBase) - slaBase} min)
                  </span>
                )}
              </p>
            </div>

            {/* Qtd mínima */}
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1.5">
                Qtd. Mínima por Pedido
              </label>
              <input
                type="number"
                min="1"
                value={cfg.quantidadeMinima ?? 1}
                onChange={(e) => update({ quantidadeMinima: parseInt(e.target.value, 10) || 1 })}
                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-orange-400 transition-colors"
              />
            </div>

            {/* Qtd máxima */}
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1.5">
                Qtd. Máxima por Pedido
                <span className="text-[10px] font-normal text-gray-400 ml-1">(0 = ilimitado)</span>
              </label>
              <input
                type="number"
                min="0"
                value={cfg.quantidadeMaxima ?? 0}
                onChange={(e) => {
                  const v = parseInt(e.target.value, 10);
                  update({ quantidadeMaxima: v > 0 ? v : undefined });
                }}
                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-orange-400 transition-colors"
              />
            </div>
          </div>

          {/* Embalagem */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">
              <div className="flex items-center gap-1.5">
                <i className="ri-box-3-line text-orange-400 text-sm" />
                Embalagem para Delivery
              </div>
            </label>
            <input
              type="text"
              value={cfg.embalagem ?? ''}
              onChange={(e) => update({ embalagem: e.target.value })}
              placeholder="Ex: Caixa kraft + embalagem isotérmica, Bandeja lacrada..."
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-orange-400 transition-colors"
            />
          </div>

          {/* Descrição alternativa */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">
              Descrição no App de Delivery
              <span className="text-[10px] font-normal text-gray-400 ml-1">(opcional — se diferente do cardápio local)</span>
            </label>
            <textarea
              rows={3}
              value={cfg.descricao ?? ''}
              onChange={(e) => update({ descricao: e.target.value })}
              placeholder={descricaoBase || 'Deixe vazio para usar a descrição padrão do item...'}
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-orange-400 transition-colors resize-none"
            />
            {!cfg.descricao && descricaoBase && (
              <p className="text-[10px] text-gray-400 mt-1 truncate">
                Usando: <em>{descricaoBase}</em>
              </p>
            )}
          </div>

          {/* Divisor Ficha Técnica */}
          <div className="border-t border-gray-100 pt-4">
            <div className="flex items-center gap-2 mb-1">
              <i className="ri-test-tube-line text-orange-400 text-base" />
              <h4 className="text-sm font-semibold text-gray-700">Ficha Técnica — Delivery</h4>
              {(cfg.fichaTecnica?.length ?? 0) > 0 && (
                <span className="text-[10px] font-bold px-1.5 py-0.5 bg-orange-100 text-orange-600 rounded-full">
                  {cfg.fichaTecnica!.length} insumo{cfg.fichaTecnica!.length > 1 ? 's' : ''}
                </span>
              )}
            </div>
            <p className="text-xs text-gray-500 mb-3">
              Defina aqui os insumos <strong>específicos do delivery</strong> — como embalagens descartáveis,
              condimentos extras para entrega, ou proporções diferentes. Se vazio, usa a ficha técnica padrão.
            </p>
            <FichaTecnicaTab
              fichasTecnicas={cfg.fichaTecnica ?? []}
              precoVenda={cfg.preco ?? precoBase}
              onChange={handleFichaChange}
            />
          </div>
        </>
      )}

      {/* Estado inativo */}
      {!cfg.ativo && (
        <div className="text-center py-10 text-gray-300">
          <div className="w-14 h-14 flex items-center justify-center mx-auto mb-3 bg-gray-50 rounded-2xl border border-gray-100">
            <i className="ri-e-bike-2-line text-3xl" />
          </div>
          <p className="text-sm text-gray-400 font-medium">Item não disponível no delivery</p>
          <p className="text-xs text-gray-300 mt-1">
            Ative acima para definir preço, embalagem e ficha técnica para entrega.
          </p>
        </div>
      )}
    </div>
  );
}
