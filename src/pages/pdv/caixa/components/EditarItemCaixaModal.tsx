import { useState } from 'react';
import { invokeWithAuth } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useObsPorItemId } from '@/hooks/useObsPorItemId';
import type { PedidoItemDetalhe } from '@/types/pdv';

const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

interface Props {
  item: PedidoItemDetalhe;
  orderId: string;
  onSalvar: () => void;
  onClose: () => void;
}

export default function EditarItemCaixaModal({ item, orderId, onSalvar, onClose }: Props) {
  const { user } = useAuth();
  const [quantidade, setQuantidade] = useState(item.quantidade);
  const [obs, setObs] = useState(item.observacao || '');
  const [abaObs, setAbaObs] = useState<'todas' | number>('todas');
  const [obsUnidades, setObsUnidades] = useState<string[]>(() => {
    if (item.unidades.length > 1) {
      return item.unidades.map((_, idx) => (idx === 0 ? item.observacao || '' : ''));
    }
    return item.observacao ? [item.observacao] : [];
  });
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  // Observações disponíveis: globais + específicas do item
  const todasObsDisponiveis = useObsPorItemId(item.menuItemId ?? '');

  // Inicializa seleção com obs que já estavam no item (se baterem com as disponíveis)
  const [obsSelecionadas, setObsSelecionadas] = useState<string[]>(() => {
    if (!item.observacao) return [];
    // Tenta cruzar a observação salva com as disponíveis
    const parts = item.observacao.split(' · ').map((s) => s.trim());
    return parts.filter((p) => todasObsDisponiveis.includes(p));
  });

  const toggleObsTag = (obsTexto: string) => {
    setObsSelecionadas((prev) =>
      prev.includes(obsTexto) ? prev.filter((o) => o !== obsTexto) : [...prev, obsTexto],
    );
  };

  const precoUnitario = item.preco;
  const totalItem = precoUnitario * quantidade;

  const handleSetQuantidade = (novaQtd: number) => {
    const q = Math.max(0, novaQtd);
    setQuantidade(q);
    setObsUnidades((prev) => Array.from({ length: q }, (_, i) => prev[i] ?? ''));
    if (typeof abaObs === 'number' && abaObs >= q) setAbaObs('todas');
    if (q === 1) setAbaObs('todas');
  };

  const handleSalvar = async () => {
    setErro(null);
    setSalvando(true);
    try {
      // Monta texto final de observação: tags selecionadas + texto livre
      const partes: string[] = [];
      if (obsSelecionadas.length > 0) partes.push(...obsSelecionadas);
      if (obs.trim()) partes.push(obs.trim());
      const notaFinal = partes.join(' · ') || null;

      const observations = obsSelecionadas.map((t) => ({ text: t, is_checked: true }));
      if (obs.trim()) observations.push({ text: obs.trim(), is_checked: false });

      const body: Record<string, unknown> = {
        action: 'update_order_item',
        order_id: orderId,
        order_item_id: item.id,
        quantity: quantidade,
        notes: notaFinal,
        observations,
        tenant_id: user?.tenantId ?? null,
      };

      // Se tem obs por unidade, sobrescreve
      if (obsUnidades.some((o) => (o ?? '').trim())) {
        const unitObs = obsUnidades
          .map((u, idx) => ((u ?? '').trim() ? `Un.${idx + 1}: ${(u ?? '').trim()}` : ''))
          .filter(Boolean);
        if (unitObs.length > 0) {
          body.notes = unitObs.join(' | ');
          body.observations = unitObs.map((t) => ({ text: t, is_checked: false }));
        }
      }

      const { error } = await invokeWithAuth('order-write', { body });
      if (error) throw new Error(error.message);
      onSalvar();
      onClose();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao salvar');
    } finally {
      setSalvando(false);
    }
  };

  const temObsUnidade = obsUnidades.some(Boolean);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-sm shadow-xl overflow-hidden" style={{ maxHeight: 'min(90dvh, 90vh)' }}>
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-zinc-100">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-zinc-900 truncate">{item.nome}</p>
            {item.opcoes.length > 0 && (
              <p className="text-[11px] text-zinc-400 truncate mt-0.5">
                {item.opcoes.join(' · ')}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-zinc-100 cursor-pointer text-zinc-400 transition-colors"
          >
            <i className="ri-close-line text-base" />
          </button>
        </div>

        <div className="px-4 py-4 space-y-4 overflow-y-auto" style={{ maxHeight: 'calc(min(90dvh, 90vh) - 130px)' }}>
          {/* Quantidade */}
          <div>
            <p className="text-[11px] font-bold text-zinc-500 uppercase tracking-wider mb-2">Quantidade</p>
            <div className="flex items-center gap-4">
              <button
                onClick={() => handleSetQuantidade(quantidade - 1)}
                className={`w-10 h-10 flex items-center justify-center rounded-xl border-2 cursor-pointer transition-colors font-bold text-lg
                  ${quantidade <= 1 ? 'border-red-200 text-red-400 hover:bg-red-50' : 'border-zinc-200 text-zinc-600 hover:bg-zinc-100'}`}
              >
                {quantidade <= 1 ? <i className="ri-delete-bin-line text-base" /> : <i className="ri-subtract-line text-base" />}
              </button>
              <div className="flex-1 text-center">
                <span className="text-3xl font-black text-zinc-900">{quantidade}</span>
                <p className="text-xs text-zinc-400 mt-0.5">{fmt(precoUnitario)} / un</p>
              </div>
              <button
                onClick={() => handleSetQuantidade(quantidade + 1)}
                className="w-10 h-10 flex items-center justify-center rounded-xl border-2 border-zinc-200 text-zinc-600 hover:bg-zinc-100 cursor-pointer transition-colors"
              >
                <i className="ri-add-line text-base font-bold" />
              </button>
            </div>
            {quantidade > 0 && (
              <div className="mt-2 text-center">
                <span className="text-sm font-bold text-amber-600">{fmt(totalItem)}</span>
              </div>
            )}
            {quantidade === 0 && (
              <div className="mt-2 text-center">
                <span className="text-xs font-semibold text-red-500">Item será removido</span>
              </div>
            )}
          </div>

          {/* Observação */}
          <div>
            <p className="text-[11px] font-bold text-zinc-500 uppercase tracking-wider mb-2">Observação</p>

            {/* Tags pré-definidas (globais + do item) */}
            {todasObsDisponiveis.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-3">
                {todasObsDisponiveis.map((obsTexto) => {
                  const sel = obsSelecionadas.includes(obsTexto);
                  return (
                    <button
                      key={obsTexto}
                      onClick={() => toggleObsTag(obsTexto)}
                      className={`text-xs px-3 py-1.5 rounded-full border transition-colors cursor-pointer whitespace-nowrap ${
                        sel
                          ? 'bg-amber-500 border-amber-500 text-white'
                          : 'bg-white border-zinc-200 text-zinc-600 hover:border-amber-300'
                      }`}
                    >
                      {obsTexto}
                    </button>
                  );
                })}
              </div>
            )}

            {/* Abas de unidade */}
            {quantidade > 1 && (
              <div className="flex gap-1 mb-2 flex-wrap">
                <button
                  onClick={() => setAbaObs('todas')}
                  className={`px-2.5 py-1 rounded-full text-xs font-semibold cursor-pointer whitespace-nowrap transition-colors ${
                    abaObs === 'todas' ? 'bg-amber-500 text-white' : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'
                  }`}
                >
                  Todas
                </button>
                {Array.from({ length: quantidade }, (_, i) => (
                  <button
                    key={i}
                    onClick={() => setAbaObs(i)}
                    className={`px-2.5 py-1 rounded-full text-xs font-semibold cursor-pointer whitespace-nowrap transition-colors relative ${
                      abaObs === i ? 'bg-amber-500 text-white' : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'
                    }`}
                  >
                    Un. {i + 1}
                    {obsUnidades[i] && (
                      <span className="ml-1 inline-block w-1.5 h-1.5 rounded-full bg-amber-300 align-middle" />
                    )}
                  </button>
                ))}
              </div>
            )}

            {/* Campo de texto livre */}
            {abaObs === 'todas' || quantidade <= 1 ? (
              <textarea
                value={obs}
                onChange={(e) => setObs(e.target.value.slice(0, 150))}
                placeholder={quantidade > 1 ? 'Obs. para todas as unidades...' : 'Ex: sem cebola, mal passado...'}
                rows={2}
                className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2.5 text-sm text-zinc-800 placeholder-zinc-400 outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100 resize-none"
              />
            ) : (
              <textarea
                value={obsUnidades[abaObs as number] ?? ''}
                onChange={(e) => {
                  const val = e.target.value.slice(0, 150);
                  setObsUnidades((prev) => {
                    const next = [...prev];
                    next[abaObs as number] = val;
                    return next;
                  });
                }}
                placeholder={`Obs. só para unidade ${(abaObs as number) + 1}...`}
                rows={2}
                className="w-full border border-amber-200 rounded-xl px-3 py-2.5 text-sm text-zinc-800 placeholder-zinc-400 outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100 resize-none bg-amber-50"
              />
            )}
            <p className="text-[10px] text-zinc-400 text-right mt-0.5">
              {abaObs === 'todas' ? obs.length : (obsUnidades[abaObs as number]?.length ?? 0)}/150
            </p>

            {/* Resumo obs por unidade */}
            {temObsUnidade && quantidade > 1 && (
              <div className="mt-2 space-y-1">
                {obsUnidades.map((u, i) => u ? (
                  <div key={i} className="flex items-start gap-1.5 text-[10px] text-amber-700 bg-amber-50 border border-amber-100 px-2 py-1 rounded-lg">
                    <span className="font-black flex-shrink-0">Un.{i + 1}:</span>
                    <span className="truncate">{u}</span>
                  </div>
                ) : null)}
              </div>
            )}
          </div>

          {erro && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-3">
              <p className="text-xs font-semibold text-red-600 flex items-center gap-1">
                <i className="ri-error-warning-line" />{erro}
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 pb-5 pt-2 space-y-2.5 flex-shrink-0 border-t border-zinc-100">
          <button
            onClick={handleSalvar}
            disabled={salvando || quantidade === 0}
            className="w-full py-3 bg-amber-500 hover:bg-amber-600 disabled:opacity-40 text-white font-bold rounded-xl cursor-pointer whitespace-nowrap transition-colors text-sm flex items-center justify-center gap-2"
          >
            {salvando ? (
              <><i className="ri-loader-4-line animate-spin" />Salvando...</>
            ) : (
              <><i className="ri-check-line mr-1.5" />Salvar alterações</>
            )}
          </button>
          <button
            onClick={onClose}
            className="w-full py-2.5 border-2 border-zinc-200 text-zinc-600 hover:bg-zinc-50 font-semibold rounded-xl cursor-pointer whitespace-nowrap transition-colors text-sm"
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}