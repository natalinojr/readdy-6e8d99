import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import {
  descreverFrequencia, itensDoPlano, nomeDiaSemana, proximaOcorrencia, quandoFica,
  type FrequenciaContagem, type PlanoContagem, type SituacaoEstoque,
} from '@/lib/estoqueRegras';
import Folha from './Folha';
import { maisGiram } from './ContarSecao';

const SEM_CAT = 'Sem categoria';
const normalizar = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const erroDe = (e: unknown) => (e as { message?: string })?.message ?? String(e);

interface Rascunho {
  id: string | null;
  nome: string;
  frequencia: FrequenciaContagem;
  diaSemana: number;
  diaMes: number;
  todos: boolean;
  itens: Set<string>;
}

const novoRascunho = (): Rascunho => ({ id: null, nome: '', frequencia: 'semanal', diaSemana: 1, diaMes: 0, todos: false, itens: new Set() });

// Configuração do estoque da loja: quanto pedir (dias de uso) e as contagens programadas.
export default function ConfigFolha({ aberta, situacao, onFechar, onReload }: {
  aberta: boolean;
  situacao: SituacaoEstoque;
  onFechar: () => void;
  onReload: () => void;
}) {
  const { user } = useAuth();
  const toast = useToast();
  const [diasCompra, setDiasCompra] = useState(String(situacao.config.diasCompra));
  const [diasPrevisao, setDiasPrevisao] = useState(String(situacao.config.diasPrevisao));
  const [rasc, setRasc] = useState<Rascunho | null>(null);
  const [busca, setBusca] = useState('');
  const [gravando, setGravando] = useState(false);

  useEffect(() => {
    if (!aberta) return;
    setDiasCompra(String(situacao.config.diasCompra));
    setDiasPrevisao(String(situacao.config.diasPrevisao));
    setRasc(null);
  }, [aberta, situacao.config.diasCompra, situacao.config.diasPrevisao]);

  const contaveis = useMemo(() => situacao.insumos.filter((i) => i.contaInventario), [situacao.insumos]);
  const porCategoria = useMemo(() => {
    const q = normalizar(busca);
    const m = new Map<string, typeof contaveis>();
    for (const i of contaveis) {
      if (q && !normalizar(i.nome).includes(q)) continue;
      const c = i.categoria || SEM_CAT;
      m.set(c, [...(m.get(c) ?? []), i]);
    }
    return [...m.entries()].sort((a, b) => (a[0] === SEM_CAT ? 1 : b[0] === SEM_CAT ? -1 : a[0].localeCompare(b[0], 'pt-BR')));
  }, [contaveis, busca]);

  const salvarConfig = async () => {
    const dc = Math.round(Number(diasCompra)), dp = Math.round(Number(diasPrevisao));
    if (!(dc >= 1 && dc <= 365) || !(dp >= 1 && dp <= 60)) { toast.error('Números fora do limite', 'Pedido: 1 a 365 dias. Previsão: 1 a 60 dias.'); return; }
    setGravando(true);
    const { error } = await supabase.rpc('fn_estoque_salvar_config', { p_tenant_id: user!.tenantId, p_dias_compra: dc, p_dias_previsao: dp });
    setGravando(false);
    if (error) { toast.error('Não salvei', error.message); return; }
    toast.success('Salvo', `Pedido sugerido: uso de ${dc} dias. "Vai faltar": ${dp} dias.`);
    onReload();
  };

  const editar = (p: PlanoContagem) => setRasc({
    id: p.id, nome: p.nome, frequencia: p.frequencia, diaSemana: p.diaSemana ?? 1, diaMes: p.diaMes ?? 0, todos: p.todos, itens: new Set(p.itens),
  });

  const salvarPlano = async () => {
    if (!rasc) return;
    if (!rasc.nome.trim()) { toast.error('Dê um nome para a contagem'); return; }
    if (!rasc.todos && rasc.itens.size === 0) { toast.error('Escolha os insumos', 'Ou marque "Todos os insumos da contagem".'); return; }
    setGravando(true);
    const { error } = await supabase.rpc('fn_estoque_salvar_plano', {
      p_tenant_id: user!.tenantId, p_id: rasc.id, p_nome: rasc.nome.trim(), p_frequencia: rasc.frequencia,
      p_dia_semana: rasc.frequencia === 'semanal' ? rasc.diaSemana : null,
      p_dia_mes: rasc.frequencia === 'mensal' ? rasc.diaMes : null,
      p_todos: rasc.todos, p_itens: rasc.todos ? [] : [...rasc.itens],
    });
    setGravando(false);
    if (error) { toast.error('Não salvei a contagem', error.message); return; }
    toast.success('Contagem salva');
    setRasc(null);
    onReload();
  };

  const apagar = async (p: PlanoContagem) => {
    setGravando(true);
    const { error } = await supabase.rpc('fn_estoque_apagar_plano', { p_tenant_id: user!.tenantId, p_id: p.id });
    setGravando(false);
    if (error) { toast.error('Não apaguei', erroDe(error)); return; }
    toast.success(`"${p.nome}" apagada`);
    setRasc(null);
    onReload();
  };

  const alternar = (ids: string[], ligar: boolean) => setRasc((r) => {
    if (!r) return r;
    const s = new Set(r.itens);
    ids.forEach((id) => (ligar ? s.add(id) : s.delete(id)));
    return { ...r, itens: s };
  });

  const planoAtual = rasc?.id ? situacao.planos.find((p) => p.id === rasc.id) ?? null : null;

  return (
    <Folha
      aberta={aberta}
      titulo={rasc ? (rasc.id ? 'Editar contagem' : 'Nova contagem') : 'Programar o estoque'}
      subtitulo={rasc ? 'Quando contar e quais insumos' : 'Quanto pedir e quando contar'}
      onFechar={rasc ? () => setRasc(null) : onFechar}
      rodape={rasc ? (
        <>
          {planoAtual && (
            <button disabled={gravando} onClick={() => apagar(planoAtual)} className="min-h-[44px] px-3 rounded-xl border border-red-200 text-sm font-bold text-red-600 cursor-pointer disabled:opacity-50">Apagar</button>
          )}
          <button onClick={() => setRasc(null)} className="flex-1 min-h-[44px] rounded-xl border border-zinc-200 text-sm font-bold text-zinc-700 cursor-pointer">Voltar</button>
          <button disabled={gravando} onClick={salvarPlano} className="flex-1 min-h-[44px] rounded-xl bg-amber-500 text-zinc-900 text-sm font-bold cursor-pointer disabled:opacity-50">Salvar</button>
        </>
      ) : undefined}
    >
      {!rasc ? (
        <div className="pb-3">
          <h4 className="text-sm font-extrabold text-zinc-900 mt-1">Quanto pedir</h4>
          <div className="grid grid-cols-2 gap-2 mt-2">
            <label className="block">
              <span className="text-[11px] font-bold text-zinc-500">Pedido = uso de quantos dias</span>
              <input value={diasCompra} onChange={(e) => setDiasCompra(e.target.value)} inputMode="numeric"
                className="mt-1 w-full rounded-xl border border-zinc-200 px-3 py-2.5 text-base font-bold focus:outline-none focus:border-amber-400" />
            </label>
            <label className="block">
              <span className="text-[11px] font-bold text-zinc-500">“Vai faltar” olha quantos dias</span>
              <input value={diasPrevisao} onChange={(e) => setDiasPrevisao(e.target.value)} inputMode="numeric"
                className="mt-1 w-full rounded-xl border border-zinc-200 px-3 py-2.5 text-base font-bold focus:outline-none focus:border-amber-400" />
            </label>
          </div>
          <button disabled={gravando} onClick={salvarConfig} className="mt-3 w-full min-h-[42px] rounded-xl bg-zinc-900 text-white text-sm font-bold cursor-pointer disabled:opacity-50">Salvar</button>

          <h4 className="text-sm font-extrabold text-zinc-900 mt-5">Contagens programadas</h4>
          <p className="text-[11px] text-zinc-400 mt-0.5">No dia de cada uma, o Início do Estoque mostra o que contar.</p>
          <div className="mt-2 space-y-2">
            {situacao.planos.map((p) => {
              const n = itensDoPlano(p, situacao.insumos).length;
              return (
                <button key={p.id} onClick={() => editar(p)} className="w-full text-left rounded-2xl border border-zinc-200 px-3 py-2.5 hover:bg-zinc-50 cursor-pointer flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-amber-50 text-amber-700 flex items-center justify-center flex-shrink-0"><i className="ri-calendar-check-line" /></div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13.5px] font-bold text-zinc-800 truncate">{p.nome}</p>
                    <p className="text-[11.5px] text-zinc-500">{descreverFrequencia(p)} · {p.todos ? `todos (${n})` : `${n} ${n === 1 ? 'insumo' : 'insumos'}`} · próxima {quandoFica(proximaOcorrencia(p, situacao.hoje), situacao.hoje)}</p>
                  </div>
                  <i className="ri-arrow-right-s-line text-zinc-400" />
                </button>
              );
            })}
            {situacao.planos.length === 0 && <p className="text-xs text-zinc-500">Nenhuma ainda.</p>}
          </div>
          <button onClick={() => { setBusca(''); setRasc(novoRascunho()); }} className="mt-2 w-full min-h-[42px] rounded-xl border border-dashed border-amber-400 text-sm font-bold text-amber-700 cursor-pointer">
            + Nova contagem
          </button>
        </div>
      ) : (
        <div className="pb-3">
          <label className="block mt-1">
            <span className="text-[11px] font-bold text-zinc-500">Nome</span>
            <input value={rasc.nome} onChange={(e) => setRasc({ ...rasc, nome: e.target.value })} placeholder="Ex.: Semanal das proteínas" maxLength={60}
              className="mt-1 w-full rounded-xl border border-zinc-200 px-3 py-2.5 text-[15px] font-bold focus:outline-none focus:border-amber-400" />
          </label>

          <span className="block text-[11px] font-bold text-zinc-500 mt-3">Quando</span>
          <div className="flex bg-zinc-100 rounded-xl p-1 mt-1">
            {(['diaria', 'semanal', 'mensal'] as FrequenciaContagem[]).map((f) => (
              <button key={f} onClick={() => setRasc({ ...rasc, frequencia: f })}
                className={`flex-1 py-2 rounded-lg text-[13px] font-bold cursor-pointer ${rasc.frequencia === f ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500'}`}>
                {f === 'diaria' ? 'Todo dia' : f === 'semanal' ? 'Semanal' : 'Mensal'}
              </button>
            ))}
          </div>
          {rasc.frequencia === 'semanal' && (
            <div className="flex gap-1 mt-2 overflow-x-auto">
              {[1, 2, 3, 4, 5, 6, 0].map((d) => (
                <button key={d} onClick={() => setRasc({ ...rasc, diaSemana: d })}
                  className={`flex-1 min-w-[42px] py-2 rounded-lg text-[12px] font-bold border cursor-pointer ${rasc.diaSemana === d ? 'bg-zinc-900 border-zinc-900 text-white' : 'border-zinc-200 text-zinc-600'}`}>
                  {nomeDiaSemana(d).slice(0, 3)}
                </button>
              ))}
            </div>
          )}
          {rasc.frequencia === 'mensal' && (
            <select value={rasc.diaMes} onChange={(e) => setRasc({ ...rasc, diaMes: Number(e.target.value) })}
              className="mt-2 w-full rounded-xl border border-zinc-200 px-3 py-2.5 text-sm font-bold bg-white focus:outline-none focus:border-amber-400">
              <option value={0}>No último dia do mês</option>
              {Array.from({ length: 28 }, (_, k) => k + 1).map((d) => <option key={d} value={d}>Todo dia {d}</option>)}
            </select>
          )}

          <span className="block text-[11px] font-bold text-zinc-500 mt-4">Quais insumos</span>
          <label className="flex items-center gap-2 mt-1.5 cursor-pointer">
            <input type="checkbox" checked={rasc.todos} onChange={(e) => setRasc({ ...rasc, todos: e.target.checked })} className="w-4 h-4 accent-amber-500" />
            <span className="text-[13.5px] font-bold text-zinc-800">Todos os insumos da contagem ({contaveis.length})</span>
          </label>
          {!rasc.todos && (
            <>
              <div className="flex gap-2 mt-2">
                <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar insumo"
                  className="flex-1 min-w-0 rounded-xl border border-zinc-200 px-3 py-2 text-sm focus:outline-none focus:border-amber-400" />
                <button onClick={() => alternar(maisGiram(situacao.insumos).map((i) => i.id), true)}
                  className="px-3 rounded-xl border border-zinc-200 text-[12px] font-bold text-zinc-700 whitespace-nowrap cursor-pointer">+ os 10 que mais giram</button>
              </div>
              <p className="text-[11.5px] text-zinc-500 mt-1.5">{rasc.itens.size} {rasc.itens.size === 1 ? 'escolhido' : 'escolhidos'}</p>
              <div className="mt-1 max-h-[40dvh] overflow-y-auto rounded-xl border border-zinc-100">
                {porCategoria.map(([cat, lista]) => {
                  const todosCat = lista.every((i) => rasc.itens.has(i.id));
                  return (
                    <div key={cat}>
                      <div className="sticky top-0 bg-zinc-50 px-3 py-1.5 flex items-center justify-between">
                        <span className="text-[11px] font-bold uppercase tracking-wide text-zinc-500">{cat}</span>
                        <button onClick={() => alternar(lista.map((i) => i.id), !todosCat)} className="text-[11px] font-bold text-amber-700 cursor-pointer">
                          {todosCat ? 'tirar todos' : 'marcar todos'}
                        </button>
                      </div>
                      {lista.map((i) => (
                        <label key={i.id} className="flex items-center gap-2.5 px-3 py-2 border-t border-zinc-50 cursor-pointer">
                          <input type="checkbox" checked={rasc.itens.has(i.id)} onChange={(e) => alternar([i.id], e.target.checked)} className="w-4 h-4 accent-amber-500" />
                          <span className="text-[13px] text-zinc-800 flex-1 truncate">{i.nome}</span>
                        </label>
                      ))}
                    </div>
                  );
                })}
                {porCategoria.length === 0 && <p className="text-xs text-zinc-400 px-3 py-3">Nenhum insumo encontrado.</p>}
              </div>
              <p className="text-[11px] text-zinc-400 mt-1.5">Só aparecem os insumos que entram na contagem (dá para tirar ou pôr um insumo na aba Estoque).</p>
            </>
          )}
        </div>
      )}
    </Folha>
  );
}
