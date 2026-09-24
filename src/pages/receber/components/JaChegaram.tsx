// "Já chegaram" (2026-09-24): o que foi recebido no mês, com troca de mês e busca.
// Só consulta — nada aqui mexe em estoque ou financeiro.
import { useEffect, useMemo, useRef, useState } from 'react';
import { brl, chamar, dataBR, hojeISO, normalizar, qtd, un, type Recebida } from '../api';

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

function somaMes(mes: string, delta: number) {
  const [a, m] = mes.split('-').map(Number);
  const d = new Date(Date.UTC(a, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export default function JaChegaram({ tenantId, filtro, onErro }: { tenantId: string; filtro: string; onErro: (e: string) => void }) {
  const mesAtual = hojeISO().slice(0, 7);
  const [mes, setMes] = useState(mesAtual);
  const [itens, setItens] = useState<Recebida[] | null>(null);
  const [aberto, setAberto] = useState<string | null>(null);
  const pedido = useRef(0);

  useEffect(() => {
    const n = ++pedido.current;
    setItens(null); setAberto(null);
    chamar<{ itens: Recebida[] }>('recebidas', tenantId, { mes }).then(({ data, erro }) => {
      if (n !== pedido.current) return; // trocou de mês/loja no meio: descarta
      if (erro) { onErro(erro); setItens([]); return; }
      setItens(data?.itens ?? []);
    });
  }, [tenantId, mes, onErro]);

  const lista = useMemo(() => {
    const q = normalizar(filtro);
    const base = itens ?? [];
    return q ? base.filter((p) => normalizar(`${p.fornecedor} ${p.numero ?? ''}`).includes(q)) : base;
  }, [itens, filtro]);
  const total = lista.reduce((s, p) => s + p.valor, 0);
  const [a, m] = mes.split('-').map(Number);

  return (
    <>
      <div className="mt-3 flex items-center justify-between bg-white border border-zinc-100 rounded-2xl px-2 py-1.5">
        <button onClick={() => setMes(somaMes(mes, -1))} className="w-10 h-10 rounded-xl flex items-center justify-center text-zinc-600 active:bg-zinc-100 cursor-pointer" aria-label="Mês anterior">
          <i className="ri-arrow-left-s-line text-2xl" />
        </button>
        <div className="text-center">
          <p className="text-[15px] font-bold text-zinc-800 capitalize">{MESES[m - 1]} {a}</p>
          {itens && <p className="text-xs text-zinc-500">{lista.length} {lista.length === 1 ? 'recebimento' : 'recebimentos'} · {brl(total)}</p>}
        </div>
        <button onClick={() => setMes(somaMes(mes, 1))} disabled={mes >= mesAtual} className="w-10 h-10 rounded-xl flex items-center justify-center text-zinc-600 active:bg-zinc-100 disabled:opacity-30 cursor-pointer" aria-label="Próximo mês">
          <i className="ri-arrow-right-s-line text-2xl" />
        </button>
      </div>

      <div className="mt-3 space-y-2.5">
        {itens === null && (
          <div className="flex flex-col items-center justify-center gap-3 py-10">
            <div className="w-9 h-9 border-[3px] border-amber-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-zinc-500">Carregando…</p>
          </div>
        )}
        {itens && lista.length === 0 && (
          <p className="text-center text-sm text-zinc-400 py-8">{filtro ? 'Nada com esse nome neste mês.' : 'Nada recebido neste mês.'}</p>
        )}
        {lista.map((p) => {
          const expandido = aberto === p.id;
          return (
            <button key={p.id} onClick={() => setAberto(expandido ? null : p.id)} className="w-full text-left bg-white rounded-3xl border border-zinc-100 p-4 active:bg-zinc-50 cursor-pointer">
              <div className="flex items-start gap-3">
                <div className="w-11 h-11 rounded-2xl flex items-center justify-center flex-shrink-0 bg-emerald-50 text-emerald-600">
                  <i className="ri-checkbox-circle-line text-xl" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] font-bold text-zinc-800 truncate">{p.fornecedor}</p>
                  <p className="text-sm text-zinc-500">
                    {p.numero ? `NF ${p.numero} · ` : ''}Recebido {dataBR(p.recebido_em)} · {p.itens.length} {p.itens.length === 1 ? 'item' : 'itens'}
                  </p>
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    <span className="text-[11px] font-semibold rounded-full px-2 py-0.5 bg-emerald-50 text-emerald-700">{p.origem}</span>
                    {p.pagamento && <span className="text-[11px] font-semibold rounded-full px-2 py-0.5 bg-zinc-100 text-zinc-600">{p.pagamento}</span>}
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-[15px] font-bold text-zinc-800 whitespace-nowrap">{brl(p.valor)}</p>
                  <i className={`ri-arrow-${expandido ? 'up' : 'down'}-s-line text-zinc-400`} />
                </div>
              </div>
              {expandido && (
                <div className="mt-3 pt-3 border-t border-zinc-100 space-y-1">
                  {p.itens.length === 0 && <p className="text-sm text-zinc-400">Sem itens.</p>}
                  {p.itens.map((it, i) => (
                    <p key={i} className="text-sm text-zinc-600 flex justify-between gap-3">
                      <span className="truncate">{it.descricao}</span>
                      <span className={`whitespace-nowrap font-semibold ${it.quantidade !== it.pedido ? 'text-orange-600' : 'text-zinc-700'}`}>
                        {qtd(it.quantidade)}{it.quantidade !== it.pedido ? ` de ${qtd(it.pedido)}` : ''} {un(it.unidade)}
                      </span>
                    </p>
                  ))}
                  <p className="text-xs text-zinc-400 pt-1">Data da nota {dataBR(p.data)}{p.obs ? ` · ${p.obs}` : ''}</p>
                </div>
              )}
            </button>
          );
        })}
      </div>
    </>
  );
}
