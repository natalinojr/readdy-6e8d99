// Detalhe de uma contagem de inventário confirmada + correção depois de confirmada (2026-09-22).
// Editar grava só a diferença no estoque atual e corrige o ajuste na data da contagem
// (stock-write edit_inventory → fn_edit_inventory_session). Item contado de novo numa contagem
// mais nova não é editável aqui: a mais nova já redefiniu o estoque dele.
import { useMemo, useState } from 'react';
import { useEstoque, type Insumo } from '../../../contexts/EstoqueContext';
import type { InventarioSession, InventarioItemContado } from '../../../types/estoque';

const fmt = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);
const qtdBR = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 3 });
const arred = (n: number, casas: number) => Math.round(n * 10 ** casas) / 10 ** casas;
const normalizar = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

// Mesma unidade de contagem da tela de contagem (ex.: pacote de 0,5 kg).
const fatorDe = (i?: Insumo) => (i?.unidadeContagem && i.fatorContagem && i.fatorContagem > 0 ? i.fatorContagem : 1);

interface Props {
  session: InventarioSession;
  /** Contagens mais novas que esta, para saber quais itens já foram recontados. */
  sessoesMaisNovas: InventarioSession[];
  podeEditar: boolean;
  onVoltar: () => void;
}

export default function DetalheInventario({ session, sessoesMaisNovas, podeEditar, onVoltar }: Props) {
  const { insumos, editarInventario } = useEstoque();
  const [editando, setEditando] = useState(false);
  const [valores, setValores] = useState<Record<string, string>>({});
  const [motivo, setMotivo] = useState('');
  const [busca, setBusca] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const insumoPorId = useMemo(() => new Map(insumos.map((i) => [i.id, i])), [insumos]);

  // item → nº da contagem mais nova que o recontou (esse item não se edita aqui)
  const recontadoEm = useMemo(() => {
    const m = new Map<string, number>();
    [...sessoesMaisNovas].sort((a, b) => b.numero - a.numero).forEach((s) => {
      s.itens.forEach((it) => m.set(it.insumoId, s.numero));
    });
    return m;
  }, [sessoesMaisNovas]);

  const itensVisiveis = useMemo(() => {
    const q = normalizar(busca);
    return q ? session.itens.filter((i) => normalizar(i.insumoNome).includes(q)) : session.itens;
  }, [session.itens, busca]);

  const valorInicial = (item: InventarioItemContado) =>
    String(arred(item.qtdContada / fatorDe(insumoPorId.get(item.insumoId)), 3));

  const iniciarEdicao = () => {
    const init: Record<string, string> = {};
    session.itens.forEach((it) => { init[it.insumoId] = valorInicial(it); });
    setValores(init);
    setMotivo('');
    setErro(null);
    setAviso(null);
    setEditando(true);
  };

  /** Novo contado na unidade do ESTOQUE, ou null se não mudou / inválido. */
  const novoContado = (item: InventarioItemContado): number | null => {
    const raw = valores[item.insumoId];
    if (raw === undefined || raw === valorInicial(item)) return null;
    const n = parseFloat(raw.replace(',', '.'));
    if (isNaN(n) || n < 0) return null;
    const emEstoque = arred(n * fatorDe(insumoPorId.get(item.insumoId)), 4);
    return Math.abs(emEstoque - item.qtdContada) > 0.00005 ? emEstoque : null;
  };

  const alterados = editando
    ? session.itens
        .map((it) => ({ it, novo: novoContado(it) }))
        .filter((x): x is { it: InventarioItemContado; novo: number } => x.novo !== null)
    : [];
  const impactoEdicao = alterados.reduce((s, x) => s + (x.novo - x.it.qtdContada) * x.it.precoUnitario, 0);

  const salvar = async () => {
    if (alterados.length === 0) { setEditando(false); return; }
    setSalvando(true);
    setErro(null);
    try {
      const r = await editarInventario(
        session.id,
        alterados.map((x) => ({ insumoId: x.it.insumoId, qtdContada: x.novo })),
        motivo,
      );
      const partes = [`${r.editados} item(ns) corrigido(s).`];
      if (r.bloqueados.length) {
        partes.push(`Não editados (contados de novo depois): ${r.bloqueados.map((b) => `${b.nome} — edite na contagem #${b.contagemMaisNova}`).join('; ')}.`);
      }
      setAviso(partes.join(' '));
      setEditando(false);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível salvar a edição.');
    } finally {
      setSalvando(false);
    }
  };

  const valorTotalContagem = session.itens.reduce((s, i) => s + i.qtdContada * i.precoUnitario, 0);

  const campoEdicao = (item: InventarioItemContado, grande: boolean) => {
    const ins = insumoPorId.get(item.insumoId);
    const f = fatorDe(ins);
    const bloqueio = recontadoEm.get(item.insumoId);
    if (bloqueio) {
      return <span className="text-[10px] text-zinc-400 italic">recontado na #{bloqueio}</span>;
    }
    const novo = novoContado(item);
    return (
      <div className={grande ? '' : 'inline-block'}>
        <div className="flex items-center gap-1 justify-end">
          <input
            type="number"
            inputMode="decimal"
            min="0"
            step="0.001"
            value={valores[item.insumoId] ?? ''}
            onChange={(e) => setValores((p) => ({ ...p, [item.insumoId]: e.target.value }))}
            className={`${grande ? 'h-11 text-base w-full' : 'w-24 text-sm py-1.5'} text-right border rounded-lg px-2 focus:outline-none transition-colors ${
              novo !== null ? 'border-amber-400 bg-amber-50 text-zinc-800' : 'border-zinc-200 bg-white text-zinc-700 focus:border-amber-400'
            }`}
          />
          <span className={`text-[10px] flex-shrink-0 ${f !== 1 ? 'text-amber-700 font-semibold' : 'text-zinc-400'}`}>
            {f !== 1 ? ins?.unidadeContagem : item.unidade}
          </span>
        </div>
        {novo !== null && (
          <p className="text-[10px] text-amber-700 mt-0.5 text-right">
            {qtdBR(item.qtdContada)} → {qtdBR(novo)} {item.unidade}
          </p>
        )}
      </div>
    );
  };

  const originalBadge = (item: InventarioItemContado) =>
    item.qtdOriginal !== undefined && item.qtdOriginal !== item.qtdContada ? (
      <span className="ml-1.5 text-[9px] font-bold text-sky-700 bg-sky-50 border border-sky-200 px-1.5 py-0.5 rounded-full whitespace-nowrap" title={`Contado originalmente: ${qtdBR(item.qtdOriginal)} ${item.unidade}`}>
        editado · era {qtdBR(item.qtdOriginal)}
      </span>
    ) : null;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={onVoltar}
          disabled={salvando}
          className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-zinc-100 cursor-pointer text-zinc-500 transition-colors"
        >
          <i className="ri-arrow-left-line text-sm" />
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-zinc-800">Contagem #{session.numero}</p>
          <p className="text-xs text-zinc-500">{session.data} às {session.hora} · {session.operador}</p>
        </div>
        {podeEditar && !editando && (
          <button
            onClick={iniciarEdicao}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-bold border border-amber-300 text-amber-700 bg-amber-50 hover:bg-amber-100 rounded-lg cursor-pointer transition-colors whitespace-nowrap"
          >
            <i className="ri-edit-line text-sm" />
            Editar contagem
          </button>
        )}
      </div>

      {aviso && (
        <div className="flex items-start gap-2 px-4 py-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-800">
          <i className="ri-check-line text-sm mt-0.5" />
          <p className="flex-1">{aviso}</p>
          <button onClick={() => setAviso(null)} className="text-emerald-600 cursor-pointer"><i className="ri-close-line" /></button>
        </div>
      )}

      {editando && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-3">
          <div className="flex items-start gap-2">
            <i className="ri-information-line text-amber-600 text-sm mt-0.5" />
            <p className="text-xs text-amber-800 leading-relaxed">
              Corrija só o que foi contado errado. O estoque de hoje recebe <strong>apenas a diferença</strong> (o que
              foi vendido ou comprado depois da contagem continua valendo) e o ajuste é corrigido na data da contagem.
            </p>
          </div>
          <input
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Motivo da correção (opcional) — ex.: barbacoa contada em kg em vez de pacote"
            className="w-full text-sm border border-amber-200 rounded-lg px-3 py-2 bg-white text-zinc-800 focus:outline-none focus:border-amber-400"
          />
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <p className="text-xs text-zinc-600">
              {alterados.length === 0
                ? 'Nenhum item alterado ainda.'
                : <>{alterados.length} item(ns) alterado(s) · impacto <strong className={impactoEdicao < 0 ? 'text-red-600' : 'text-emerald-700'}>{impactoEdicao >= 0 ? '+' : ''}{fmt(impactoEdicao)}</strong></>}
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => { setEditando(false); setErro(null); }}
                disabled={salvando}
                className="px-3 py-2 text-xs font-semibold text-zinc-600 bg-white border border-zinc-200 rounded-lg cursor-pointer hover:bg-zinc-50"
              >
                Cancelar
              </button>
              <button
                onClick={salvar}
                disabled={salvando || alterados.length === 0}
                className="px-4 py-2 text-xs font-bold text-white bg-amber-500 hover:bg-amber-600 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg cursor-pointer flex items-center gap-1.5"
              >
                {salvando ? <i className="ri-loader-4-line animate-spin" /> : <i className="ri-save-line" />}
                Salvar correção
              </button>
            </div>
          </div>
          {erro && <p className="text-xs text-red-600">{erro}</p>}
        </div>
      )}

      {/* Resumo */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-white border border-zinc-100 rounded-xl p-4 text-center">
          <p className="text-xl font-black text-zinc-800">{session.itensContados}</p>
          <p className="text-[10px] text-zinc-500">itens contados</p>
        </div>
        <div className="bg-white border border-zinc-100 rounded-xl p-4 text-center">
          <p className="text-xl font-black text-zinc-400">{session.itensContados - session.itensComDiferenca}</p>
          <p className="text-[10px] text-zinc-500">sem diferença</p>
        </div>
        <div className={`bg-white border rounded-xl p-4 text-center ${session.itensComDiferenca > 0 ? 'border-amber-200' : 'border-zinc-100'}`}>
          <p className={`text-xl font-black ${session.itensComDiferenca > 0 ? 'text-amber-600' : 'text-zinc-400'}`}>
            {session.itensComDiferenca}
          </p>
          <p className="text-[10px] text-zinc-500">com diferença</p>
        </div>
        <div className={`bg-white border rounded-xl p-4 text-center ${session.valorAjusteLiquido !== 0 ? (session.valorAjusteLiquido < 0 ? 'border-red-200' : 'border-emerald-200') : 'border-zinc-100'}`}>
          <p className={`text-xl font-black ${session.valorAjusteLiquido < 0 ? 'text-red-500' : session.valorAjusteLiquido > 0 ? 'text-emerald-600' : 'text-zinc-400'}`}>
            {session.valorAjusteLiquido >= 0 ? '+' : ''}{fmt(session.valorAjusteLiquido)}
          </p>
          <p className="text-[10px] text-zinc-500">impacto do ajuste</p>
        </div>
        <div className="col-span-2 bg-zinc-50 border border-zinc-200 rounded-xl p-4 flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-zinc-600">Valor total em estoque na contagem</p>
            <p className="text-[10px] text-zinc-400 mt-0.5">Soma de qtd contada × preço unitário de todos os insumos</p>
          </div>
          <p className="text-lg font-black text-zinc-900">{fmt(valorTotalContagem)}</p>
        </div>
      </div>

      {/* Itens */}
      <div className="bg-white border border-zinc-100 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-zinc-100 flex items-center justify-between gap-3 flex-wrap">
          <p className="text-xs font-bold text-zinc-700">Todos os Insumos Contados</p>
          <div className="flex items-center gap-2">
            <div className="relative">
              <i className="ri-search-line absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400 text-xs pointer-events-none" />
              <input
                type="search"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar insumo..."
                className="w-44 h-8 pl-7 pr-2 text-xs border border-zinc-200 rounded-lg bg-white text-zinc-800 focus:outline-none focus:border-amber-400"
              />
            </div>
            <span className="text-[10px] text-zinc-400 whitespace-nowrap">{session.itens.length} insumos</span>
          </div>
        </div>

        {/* Celular */}
        <ul className="md:hidden p-2 space-y-2 bg-zinc-50/60">
          {itensVisiveis.map((item) => (
            <li key={item.insumoId}>
              <div className={`rounded-xl border bg-white px-3 py-3 ${item.diferenca !== 0 ? 'border-amber-200 bg-amber-50/40' : 'border-zinc-200'}`}>
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-medium text-zinc-800 break-words line-clamp-2">
                    {item.insumoNome}{originalBadge(item)}
                  </p>
                  {item.diferenca !== 0 && (
                    <span className="text-[9px] font-bold text-amber-600 bg-amber-100 px-1.5 py-0.5 rounded-full whitespace-nowrap flex-shrink-0">
                      divergência
                    </span>
                  )}
                </div>
                <div className="flex items-baseline justify-between gap-2 mt-1.5">
                  <span className="text-xs text-zinc-500">Teórico: {item.qtdTeorica} {item.unidade}</span>
                  {!editando && <span className="text-sm font-semibold text-zinc-800">Contado: {item.qtdContada} {item.unidade}</span>}
                </div>
                {editando && <div className="mt-2">{campoEdicao(item, true)}</div>}
                {!editando && item.diferenca !== 0 && (
                  <div className="flex items-center gap-1.5 flex-wrap mt-2">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold ${item.diferenca > 0 ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-500'}`}>
                      {item.diferenca > 0 ? '+' : ''}{item.diferenca} {item.unidade}
                    </span>
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ${item.diferenca * item.precoUnitario < 0 ? 'bg-red-50 text-red-500' : 'bg-emerald-50 text-emerald-600'}`}>
                      {item.diferenca * item.precoUnitario >= 0 ? '+' : ''}{fmt(item.diferenca * item.precoUnitario)}
                    </span>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>

        {/* Computador */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-xs" style={{ minWidth: '420px' }}>
            <thead className="bg-zinc-50 border-b border-zinc-100">
              <tr>
                <th className="px-4 py-2.5 text-left font-semibold text-zinc-500">Insumo</th>
                <th className="px-4 py-2.5 text-right font-semibold text-zinc-500 hidden sm:table-cell">Teórico</th>
                <th className="px-4 py-2.5 text-right font-semibold text-zinc-500">Contado</th>
                <th className="px-4 py-2.5 text-right font-semibold text-zinc-500">Diferença</th>
                <th className="px-4 py-2.5 text-right font-semibold text-zinc-500">Impacto</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-50">
              {itensVisiveis.map((item) => (
                <tr key={item.insumoId} className={`hover:bg-zinc-50 ${item.diferenca !== 0 ? 'bg-amber-50/40' : ''}`}>
                  <td className="px-4 py-2.5 font-medium text-zinc-800">
                    {item.insumoNome}
                    {originalBadge(item)}
                    {item.diferenca !== 0 && (
                      <span className="ml-2 text-[9px] font-bold text-amber-600 bg-amber-100 px-1.5 py-0.5 rounded-full">divergência</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right text-zinc-500 hidden sm:table-cell">{item.qtdTeorica} {item.unidade}</td>
                  <td className="px-4 py-2.5 text-right font-semibold text-zinc-800">
                    {editando ? campoEdicao(item, false) : <>{item.qtdContada} {item.unidade}</>}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {item.diferenca !== 0 ? (
                      <span className={`font-bold ${item.diferenca > 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                        {item.diferenca > 0 ? '+' : ''}{item.diferenca} {item.unidade}
                      </span>
                    ) : <span className="text-zinc-300">—</span>}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {item.diferenca !== 0 ? (
                      <span className={`font-semibold ${item.diferenca * item.precoUnitario < 0 ? 'text-red-500' : 'text-emerald-600'}`}>
                        {item.diferenca * item.precoUnitario >= 0 ? '+' : ''}{fmt(item.diferenca * item.precoUnitario)}
                      </span>
                    ) : <span className="text-zinc-300">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {itensVisiveis.length === 0 && (
          <p className="text-center text-xs text-zinc-400 py-6">Nenhum insumo com esse nome.</p>
        )}
      </div>

      {/* Histórico de correções */}
      {session.edicoes.length > 0 && (
        <div className="bg-white border border-zinc-100 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-zinc-100">
            <p className="text-xs font-bold text-zinc-700">Correções feitas depois de confirmada</p>
          </div>
          <ul className="divide-y divide-zinc-50">
            {[...session.edicoes].reverse().map((ed, idx) => (
              <li key={idx} className="px-4 py-3 text-xs">
                <p className="text-zinc-600">
                  <span className="font-semibold text-zinc-800">{ed.por}</span>
                  {' · '}
                  {ed.em ? new Date(ed.em).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''}
                  {ed.motivo && <> · <span className="italic">{ed.motivo}</span></>}
                </p>
                <ul className="mt-1 space-y-0.5">
                  {ed.itens.map((x) => (
                    <li key={x.insumoId} className="text-zinc-500">
                      {x.nome}: {qtdBR(x.de)} → <span className="font-semibold text-zinc-700">{qtdBR(x.para)}</span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
