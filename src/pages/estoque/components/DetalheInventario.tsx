// Detalhe de uma contagem de inventário confirmada + correção depois de confirmada (2026-09-22).
// Editar grava só a diferença no estoque atual e corrige o ajuste na data da contagem
// (stock-write edit_inventory → fn_edit_inventory_session). Item contado de novo numa contagem
// mais nova não é editável aqui: a mais nova já redefiniu o estoque dele.
import { useMemo, useState } from 'react';
import { useEstoque, type Insumo } from '../../../contexts/EstoqueContext';
import type { InventarioSession, InventarioItemContado } from '../../../types/estoque';
import { fmtQtdSinal, fmtQtdTela, impactoDe, porImpacto, reaisComSinal, resumirContagem, temDiferenca } from '@/lib/contagemResumo';
import { Chips, Etiqueta, Faixa, SecaoTitulo, Vazio, btn, brl, semAcento } from './ui/EstoqueUi';

const qtdBR = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 3 });
const arred = (n: number, casas: number) => Math.round(n * 10 ** casas) / 10 ** casas;
const plural = (n: number, um: string, varios: string) => (n === 1 ? um : varios);

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
  // Abre só com o que deu diferença (sem nenhuma diferença, mostra tudo para não abrir vazio).
  const [soDiferencas, setSoDiferencas] = useState(() => session.itens.some(temDiferenca));
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

  const resumo = useMemo(() => resumirContagem(session.itens), [session.itens]);

  // Do que mais pesa em R$ para o que menos pesa (os sem diferença vão para o fim, por nome).
  const itensVisiveis = useMemo(() => {
    const q = semAcento(busca);
    const base = session.itens
      .filter((i) => (!soDiferencas || temDiferenca(i)) && (!q || semAcento(i.insumoNome).includes(q)))
      .sort((a, b) => a.insumoNome.localeCompare(b.insumoNome, 'pt-BR'));
    return porImpacto(base);
  }, [session.itens, busca, soDiferencas]);

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
      const partes = [`${r.editados} ${plural(r.editados, 'item corrigido', 'itens corrigidos')}.`];
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
            {fmtQtdTela(item.qtdContada, item.unidade)} → {fmtQtdTela(novo, item.unidade)}
          </p>
        )}
      </div>
    );
  };

  const originalBadge = (item: InventarioItemContado) =>
    item.qtdOriginal !== undefined && item.qtdOriginal !== item.qtdContada ? (
      <span className="ml-1.5 text-[11px] font-semibold text-sky-700 bg-sky-50 px-2 py-0.5 rounded-md whitespace-nowrap" title={`Contado originalmente: ${fmtQtdTela(item.qtdOriginal, item.unidade)}`}>
        editado · era {fmtQtdTela(item.qtdOriginal, item.unidade)}
      </span>
    ) : null;

  const dif = (item: InventarioItemContado) => temDiferenca(item);
  const tituloLista = soDiferencas ? 'Itens com diferença' : 'Todos os insumos contados';

  return (
    <div className="space-y-4">
      {/* Cabeçalho */}
      <div className="flex items-center gap-3 flex-wrap">
        <button onClick={onVoltar} disabled={salvando} className={btn('out', 'sm')}>
          <i className="ri-arrow-left-line" />Voltar
        </button>
        <div className="flex-1 min-w-0">
          <h3 className="text-[15px] font-extrabold text-zinc-900">Contagem #{session.numero}</h3>
          <p className="text-xs text-zinc-400">{session.data} às {session.hora} · {session.operador}</p>
        </div>
        {podeEditar && !editando && (
          <button onClick={iniciarEdicao} className={btn('out', 'sm')}>
            <i className="ri-edit-line" />Editar contagem
          </button>
        )}
      </div>

      {aviso && (
        <div className="flex items-start gap-2 px-4 py-3 bg-emerald-50 border border-emerald-200 rounded-2xl text-xs text-emerald-800">
          <i className="ri-check-line text-sm mt-0.5" />
          <p className="flex-1">{aviso}</p>
          <button onClick={() => setAviso(null)} aria-label="Fechar aviso" className="text-emerald-600 cursor-pointer"><i className="ri-close-line" /></button>
        </div>
      )}

      {editando && (
        <div className="bg-gradient-to-b from-amber-50/80 to-white border border-amber-200 rounded-2xl px-4 py-3 space-y-3">
          <div className="flex items-start gap-2">
            <i className="ri-information-line text-amber-600 text-sm mt-0.5" />
            <p className="text-xs text-amber-800 leading-relaxed">
              Corrija só o que foi contado errado. O estoque de hoje recebe <strong>apenas a diferença</strong> (o que
              foi vendido ou comprado depois da contagem continua valendo) e o ajuste é corrigido na data da contagem.
              {soDiferencas && ' Para corrigir um item que não deu diferença, toque em “Todos”.'}
            </p>
          </div>
          <input
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Motivo da correção (opcional) — ex.: barbacoa contada em kg em vez de pacote"
            className="w-full text-sm border border-amber-200 rounded-xl px-3 py-2 bg-white text-zinc-800 focus:outline-none focus:border-amber-400"
          />
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <p className="text-xs text-zinc-600">
              {alterados.length === 0
                ? 'Nenhum item alterado ainda.'
                : <>{alterados.length} {plural(alterados.length, 'item alterado', 'itens alterados')} · impacto <strong className={impactoEdicao < 0 ? 'text-red-600' : 'text-emerald-700'}>{reaisComSinal(impactoEdicao)}</strong></>}
            </p>
            <div className="flex items-center gap-2">
              <button onClick={() => { setEditando(false); setErro(null); }} disabled={salvando} className={btn('out', 'sm')}>
                Cancelar
              </button>
              <button onClick={salvar} disabled={salvando || alterados.length === 0} className={btn('p', 'sm')}>
                {salvando ? <i className="ri-loader-4-line animate-spin" /> : <i className="ri-save-line" />}
                Salvar correção
              </button>
            </div>
          </div>
          {erro && <p className="text-xs text-red-600">{erro}</p>}
        </div>
      )}

      {/* Resumo da contagem: os mesmos números de antes, numa linha só */}
      <div className="space-y-2">
        <Faixa itens={[
          { valor: session.itensContados, rotulo: 'Contados' },
          { valor: session.itensContados - session.itensComDiferenca, rotulo: 'Sem diferença', tom: 'green' },
          { valor: session.itensComDiferenca, rotulo: 'Com diferença', tom: session.itensComDiferenca > 0 ? 'amber' : 'neutro' },
          { valor: reaisComSinal(session.valorAjusteLiquido), rotulo: 'Impacto do ajuste', tom: session.valorAjusteLiquido < 0 ? 'red' : session.valorAjusteLiquido > 0 ? 'green' : 'neutro' },
          { valor: brl(valorTotalContagem), rotulo: 'Estoque contado', ajuda: 'Soma de quantidade contada × preço unitário de todos os insumos desta contagem.' },
        ]} />
        <p className="text-xs text-zinc-500 px-0.5">
          {session.itensComDiferenca === 0
            ? 'O contado bateu com o sistema: nenhuma diferença.'
            : resumo.explicam
              ? <>{resumo.explicam.n} {plural(resumo.explicam.n, 'item explica', 'itens explicam')} {Math.round(resumo.explicam.fracao * 100)}% da diferença em reais.</>
              : resumo.comDiferenca === 1
                ? 'Só 1 item deu diferença.'
                : resumo.comDiferenca > 1
                  ? 'A diferença está espalhada: nenhum grupo pequeno de itens explica a maior parte.'
                  : null}
        </p>
      </div>

      {/* Itens */}
      <div className="space-y-2.5">
        <SecaoTitulo titulo={tituloLista} n={itensVisiveis.length} tomN="zinc" sub="do que mais pesa em reais para o que menos pesa" />
        <div className="flex items-center gap-2 flex-wrap">
          <div className="w-full md:w-auto md:mr-auto min-w-0">
            <Chips<'dif' | 'todos'>
              opcoes={[
                { id: 'dif', rotulo: 'Só diferenças', n: resumo.comDiferenca, tom: resumo.comDiferenca > 0 ? 'amber' : undefined },
                { id: 'todos', rotulo: 'Todos', n: session.itens.length },
              ]}
              valor={soDiferencas ? 'dif' : 'todos'}
              onChange={(v) => setSoDiferencas(v === 'dif')}
            />
          </div>
          <div className="relative w-full md:w-60">
            <i className="ri-search-line absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400 text-xs pointer-events-none" />
            <input
              type="search"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar insumo..."
              className="w-full h-10 pl-8 pr-2 text-base md:text-xs border border-zinc-200 rounded-xl bg-white text-zinc-800 focus:outline-none focus:border-amber-400"
            />
          </div>
        </div>

        {itensVisiveis.length === 0 ? (
          <Vazio icone="ri-search-line" titulo={busca.trim() ? 'Nenhum insumo com esse nome.' : 'Nenhum item com diferença.'}
            acao={soDiferencas ? <button onClick={() => setSoDiferencas(false)} className={btn('out', 'sm')}>Ver todos os {session.itens.length}</button> : undefined} />
        ) : (
          <>
            {/* Celular */}
            <ul className="md:hidden space-y-2">
              {itensVisiveis.map((item) => (
                <li key={item.insumoId}>
                  <div className={`rounded-2xl border bg-white px-3 py-3 ${dif(item) ? 'border-amber-200 bg-amber-50/40' : 'border-zinc-200'}`}>
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-semibold text-zinc-800 break-words line-clamp-2">
                        {item.insumoNome}{originalBadge(item)}
                      </p>
                      {dif(item) && <Etiqueta tom="amber">diferença</Etiqueta>}
                    </div>
                    <div className="flex items-baseline justify-between gap-2 mt-1.5">
                      <span className="text-xs text-zinc-500">Teórico: {fmtQtdTela(item.qtdTeorica, item.unidade)}</span>
                      {!editando && <span className="text-sm font-semibold text-zinc-800">Contado: {fmtQtdTela(item.qtdContada, item.unidade)}</span>}
                    </div>
                    {editando && <div className="mt-2">{campoEdicao(item, true)}</div>}
                    {!editando && dif(item) && (
                      <div className="flex items-center gap-1.5 flex-wrap mt-2">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold ${item.diferenca > 0 ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-500'}`}>
                          {fmtQtdSinal(item.diferenca, item.unidade)}
                        </span>
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold ${impactoDe(item) < 0 ? 'bg-red-50 text-red-500' : 'bg-emerald-50 text-emerald-600'}`}>
                          {reaisComSinal(impactoDe(item))}
                        </span>
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ul>

            {/* Computador */}
            <div className="hidden md:block bg-white rounded-2xl border border-zinc-200 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-xs" style={{ minWidth: '420px' }}>
                  <thead className="border-b border-zinc-200 bg-zinc-50/60">
                    <tr>
                      <th className="pl-5 pr-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Insumo</th>
                      <th className="px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Teórico</th>
                      <th className="px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Contado</th>
                      <th className="px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Diferença</th>
                      <th className="px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Impacto</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100/80">
                    {itensVisiveis.map((item) => (
                      <tr key={item.insumoId} className={`hover:bg-zinc-50 ${dif(item) ? 'bg-amber-50/40' : ''}`}>
                        <td className="pl-5 pr-4 py-2.5 font-medium text-zinc-800">
                          {item.insumoNome}
                          {originalBadge(item)}
                          {dif(item) && <span className="ml-2 align-middle"><Etiqueta tom="amber">diferença</Etiqueta></span>}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums whitespace-nowrap text-zinc-500">{fmtQtdTela(item.qtdTeorica, item.unidade)}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums whitespace-nowrap font-semibold text-zinc-800">
                          {editando ? campoEdicao(item, false) : fmtQtdTela(item.qtdContada, item.unidade)}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums whitespace-nowrap">
                          {dif(item) ? (
                            <span className={`font-bold ${item.diferenca > 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                              {fmtQtdSinal(item.diferenca, item.unidade)}
                            </span>
                          ) : <span className="text-zinc-300">—</span>}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums whitespace-nowrap">
                          {dif(item) ? (
                            <span className={`font-semibold ${impactoDe(item) < 0 ? 'text-red-500' : 'text-emerald-600'}`}>
                              {reaisComSinal(impactoDe(item))}
                            </span>
                          ) : <span className="text-zinc-300">—</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Histórico de correções */}
      {session.edicoes.length > 0 && (
        <div className="bg-white rounded-2xl border border-zinc-200 overflow-hidden">
          <div className="px-5 py-3 border-b border-zinc-100">
            <h3 className="text-sm font-extrabold text-zinc-900">Correções feitas depois de confirmada</h3>
          </div>
          <ul className="divide-y divide-zinc-100/80">
            {[...session.edicoes].reverse().map((ed, idx) => (
              <li key={idx} className="px-5 py-3 text-xs">
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
