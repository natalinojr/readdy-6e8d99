import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { todayBrasilia, somarDias } from '@/lib/dateUtils';
import { intervaloDoPreset, validarPeriodo } from '@/lib/consumoInsumos';
import { fmtQtd, fmtPrecoUnit } from '@/lib/estoqueRegras';
import {
  csvCompras, dataBR, lerCompras, ordenarCompras, totaisCompras,
  type ComprasPeriodo, type InsumoComprado, type OrdemCompras,
} from '@/lib/comprasPorInsumo';
import { useEstoqueTela } from '../EstoqueTela';
import { CartaoAcao, CartaoBarra, Chips, Faixa, Pagina, Vazio, btn, brl, brlInteiro, semAcento } from './ui/EstoqueUi';

// Insumos › Compras por insumo (2026-10-05): o que foi comprado de cada insumo num período escolhido —
// quanto, quanto custou, preço médio e de quem. Lê fn_estoque_compras_periodo (notas ligadas ao insumo).
type Periodo = '30d' | '90d' | 'mes' | 'custom';

export default function ComprasPorInsumoTab() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { abrirFicha, podeConfigurar } = useEstoqueTela();
  const hoje = todayBrasilia();
  const [periodo, setPeriodo] = useState<Periodo>('30d');
  const [de, setDe] = useState(somarDias(hoje, -29));
  const [ate, setAte] = useState(hoje);
  const [busca, setBusca] = useState('');
  const [ordem, setOrdem] = useState<OrdemCompras>('gasto');
  const [aberto, setAberto] = useState<string | null>(null);
  const [dados, setDados] = useState<ComprasPeriodo | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const pedido = useRef(0);

  const aviso = periodo === 'custom' ? validarPeriodo(de, ate, hoje) : null;
  const escolher = (p: Periodo) => {
    setPeriodo(p);
    if (p === 'custom') return;
    if (p === '30d') { setDe(somarDias(hoje, -29)); setAte(hoje); }
    else if (p === '90d') { setDe(somarDias(hoje, -89)); setAte(hoje); }
    else { const r = intervaloDoPreset('mes', hoje); setDe(r.from); setAte(r.to); }
  };

  const carregar = useCallback(async () => {
    if (!user?.tenantId || aviso) return;
    const meu = ++pedido.current;
    setCarregando(true);
    setErro(null);
    const { data, error } = await supabase.rpc('fn_estoque_compras_periodo', { p_tenant_id: user.tenantId, p_de: de, p_ate: ate });
    if (meu !== pedido.current) return;
    if (error) { setErro(error.message); setDados(null); setCarregando(false); return; }
    try { setDados(lerCompras(data)); } catch (e) { setErro(e instanceof Error ? e.message : String(e)); setDados(null); }
    setCarregando(false);
  }, [user?.tenantId, de, ate, aviso]);
  useEffect(() => { void carregar(); }, [carregar]);

  const lista = useMemo(() => {
    const t = semAcento(busca);
    const base = (dados?.insumos ?? []).filter((i) => !t || semAcento(i.nome).includes(t) || i.fornecedores.some((f) => semAcento(f).includes(t)));
    return ordenarCompras(base, ordem);
  }, [dados, busca, ordem]);
  const tot = totaisCompras(lista);

  const baixar = () => {
    const blob = new Blob(['﻿' + csvCompras(lista)], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `compras_por_insumo_${de}_a_${ate}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const unidade = (i: InsumoComprado) => fmtQtd(i.qtd, i.unidade);
  const semInsumo = dados?.semInsumo;

  return (
    <Pagina>
      <Chips<Periodo>
        valor={periodo} onChange={escolher}
        opcoes={[{ id: '30d', rotulo: '30 dias' }, { id: '90d', rotulo: '3 meses' }, { id: 'mes', rotulo: 'Este mês' }, { id: 'custom', rotulo: 'Período' }]}
      />
      {periodo === 'custom' && (
        <div className="flex flex-wrap items-center gap-2">
          <input type="date" value={de} max={hoje} onChange={(e) => setDe(e.target.value)} aria-label="De" className="h-10 rounded-xl border border-zinc-200 px-3 text-sm" />
          <span className="text-xs text-zinc-400">até</span>
          <input type="date" value={ate} max={hoje} onChange={(e) => setAte(e.target.value)} aria-label="Até" className="h-10 rounded-xl border border-zinc-200 px-3 text-sm" />
          {aviso && <span className="text-xs font-semibold text-red-600">{aviso}</span>}
        </div>
      )}
      <p className="text-xs text-zinc-400 -mt-1">Compras de {dataBR(de)} a {dataBR(ate)}, pelo dia da compra.</p>

      {erro ? (
        <CartaoAcao tom="alerta" icone="ri-error-warning-line" titulo="Não consegui ler as compras"
          acoes={<button className={btn('out', 'sm')} onClick={() => void carregar()}>Tentar de novo</button>}>{erro}</CartaoAcao>
      ) : (
        <>
          <Faixa itens={[
            { valor: carregando ? '…' : tot.insumos, rotulo: 'insumos comprados' },
            { valor: carregando ? '…' : brlInteiro(tot.gasto), rotulo: 'gasto no período', tom: 'amber' },
            { valor: carregando ? '…' : tot.compras, rotulo: 'compras (por insumo)' },
          ]} />

          {semInsumo && semInsumo.itens > 0 && (
            <CartaoAcao tom="prop" icone="ri-links-line" titulo={`${semInsumo.itens} ${semInsumo.itens === 1 ? 'item de mercadoria' : 'itens de mercadoria'} sem insumo ligado (${brlInteiro(semInsumo.valor)})`}
              acoes={podeConfigurar ? <button className={btn('p', 'sm')} onClick={() => navigate('/financeiro?tab=itens&filtro=sem_insumo')}>Ligar no Financeiro</button> : undefined}>
              Comprados no período e ainda sem insumo: não entram no estoque nem aparecem aqui. Despesas e serviços já ficam de fora.
            </CartaoAcao>
          )}

          <div className="flex flex-col md:flex-row gap-2 md:items-center">
            <div className="flex items-center gap-2 h-10 px-3 rounded-xl border border-zinc-200 bg-white flex-1 min-w-0">
              <i className="ri-search-line text-zinc-400" />
              <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Procurar insumo ou fornecedor (acha sem acento)" className="flex-1 min-w-0 bg-transparent outline-none text-sm" />
            </div>
            <div className="flex gap-2">
              <select value={ordem} onChange={(e) => setOrdem(e.target.value as OrdemCompras)} aria-label="Ordem" className="h-10 rounded-xl border border-zinc-200 bg-white px-3 text-sm font-semibold text-zinc-700 flex-1 md:flex-none">
                <option value="gasto">Quem gastou mais</option>
                <option value="qtd">Maior quantidade</option>
                <option value="recente">Compra mais recente</option>
                <option value="nome">Nome A–Z</option>
              </select>
              <button className={btn('out', 'sm')} disabled={!lista.length} onClick={baixar}><i className="ri-download-line" />CSV</button>
            </div>
          </div>

          {carregando && !dados ? (
            <p className="text-sm text-zinc-500 py-6 text-center">Carregando as compras…</p>
          ) : lista.length === 0 ? (
            <Vazio icone="ri-shopping-cart-2-line" titulo={busca ? 'Nada com esse nome neste período' : 'Nenhuma compra ligada a insumo neste período'}>
              {busca ? 'Tire a busca ou aumente o período.' : 'Só entram notas de compra com o item ligado a um insumo.'}
            </Vazio>
          ) : (
            <>
              {/* Celular: cartões */}
              <div className="space-y-2 md:hidden">
                {lista.map((i) => (
                  <CartaoBarra key={i.id} cor="amber">
                    <button type="button" className="w-full text-left cursor-pointer" onClick={() => setAberto(aberto === i.id ? null : i.id)}>
                      <div className="flex items-start gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-[14.5px] font-extrabold text-zinc-900 truncate">{i.nome}</p>
                          <p className="text-[11.5px] text-zinc-500 mt-0.5">{unidade(i)} · {i.nCompras} {i.nCompras === 1 ? 'compra' : 'compras'} · última {dataBR(i.ultima)}</p>
                          <p className="text-[11.5px] text-zinc-400 truncate">{i.fornecedores.join(', ') || 'sem fornecedor'}</p>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <p className="text-[15px] font-extrabold text-zinc-900 tabular-nums">{brl(i.gasto)}</p>
                          <p className="text-[11px] text-zinc-400">{fmtPrecoUnit(i.precoMedio, i.unidade)}</p>
                        </div>
                      </div>
                    </button>
                    {aberto === i.id && <Detalhe i={i} onFicha={() => abrirFicha(i.id)} />}
                  </CartaoBarra>
                ))}
              </div>

              {/* Computador: tabela */}
              <div className="hidden md:block bg-white border border-zinc-200 rounded-2xl overflow-hidden">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="text-left text-[10.5px] uppercase tracking-wide text-zinc-400 bg-zinc-50">
                      <th className="px-4 py-2.5 font-bold">Insumo</th>
                      <th className="px-3 py-2.5 font-bold text-right">Comprou</th>
                      <th className="px-3 py-2.5 font-bold text-right">Gasto</th>
                      <th className="px-3 py-2.5 font-bold text-right">Preço médio</th>
                      <th className="px-3 py-2.5 font-bold text-right">Compras</th>
                      <th className="px-3 py-2.5 font-bold">Última</th>
                      <th className="px-4 py-2.5 font-bold">Fornecedor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lista.map((i) => (
                      <Fragment key={i.id}>
                        <tr className="border-t border-zinc-100 hover:bg-amber-50/40 cursor-pointer" onClick={() => setAberto(aberto === i.id ? null : i.id)}>
                          <td className="px-4 py-2.5 font-bold text-zinc-900">
                            <i className={`ri-arrow-${aberto === i.id ? 'down' : 'right'}-s-line text-zinc-400 mr-1`} />{i.nome}
                            {i.categoria && <span className="block text-[11px] font-medium text-zinc-400 ml-5">{i.categoria}</span>}
                          </td>
                          <td className="px-3 py-2.5 text-right tabular-nums">{unidade(i)}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums font-extrabold">{brl(i.gasto)}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-zinc-600">{fmtPrecoUnit(i.precoMedio, i.unidade)}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums">{i.nCompras}</td>
                          <td className="px-3 py-2.5 text-zinc-600">{dataBR(i.ultima)}</td>
                          <td className="px-4 py-2.5 text-zinc-600 max-w-[220px] truncate">{i.fornecedores.join(', ') || '—'}</td>
                        </tr>
                        {aberto === i.id && (
                          <tr className="bg-zinc-50/60"><td colSpan={7} className="px-4 pb-3"><Detalhe i={i} onFicha={() => abrirFicha(i.id)} /></td></tr>
                        )}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </Pagina>
  );
}

/** Cada compra do insumo no período. */
function Detalhe({ i, onFicha }: { i: InsumoComprado; onFicha: () => void }) {
  return (
    <div className="mt-2 pt-2 border-t border-zinc-100">
      <ul className="divide-y divide-zinc-100">
        {i.compras.map((c, k) => (
          <li key={k} className="py-1.5 flex items-center gap-3 text-[12.5px]">
            <span className="w-[72px] text-zinc-500 flex-shrink-0">{dataBR(c.dia)}</span>
            <span className="flex-1 min-w-0 truncate text-zinc-700">{c.fornecedor || 'sem fornecedor'}{c.nota ? ` · NF ${c.nota}` : ''}</span>
            <span className="tabular-nums text-zinc-500 flex-shrink-0">{fmtQtd(c.qtd, i.unidade)}</span>
            <span className="tabular-nums font-bold text-zinc-900 w-[84px] text-right flex-shrink-0">{brl(c.total)}</span>
          </li>
        ))}
      </ul>
      <button type="button" onClick={onFicha} className={`${btn('out', 'sm')} mt-2`}>Abrir o insumo</button>
    </div>
  );
}
