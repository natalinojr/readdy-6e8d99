import { useMemo, useState } from 'react';
import { invokeWithAuth } from '@/lib/supabase';
import { useToast } from '@/contexts/ToastContext';
import { useAuth } from '@/contexts/AuthContext';

// "Aplicar fichas nas vendas passadas" (dono, 2026-09-26): a ficha técnica de hoje vale para as vendas desde uma
// data, em lote, escolhendo ONDE aplicar — consumo por dia, saldo do estoque, custo das vendas (CMV teórico).
// Venda antes da última contagem de um insumo nunca mexe no saldo: a contagem manda.
// Regras no backend: supabase/functions/_shared/ficha-retroativa.ts (menu-write: fichas_vendidas, reaplicar_ficha).

interface Mudanca { ingredient_id: string; nome: string; unidade: string; diferenca: number; no_saldo: number; na_contagem: number; ultima_contagem: string | null }
interface Resultado {
  vendas: number; vendas_alteradas: number; insumos: Mudanca[]; aplicado: boolean;
  custo?: { vendas_alteradas: number; antes: number; depois: number };
}
interface Vendido { item_id: string; nome: string; vendas: number; tem_ficha: boolean }
interface Opcoes { consumo: boolean; estoque: boolean; custo: boolean }

interface Props { tenantId: string; onFechar: () => void; onAplicado?: () => void }

const hojeISO = () => new Date().toLocaleDateString('sv-SE');
const inicioMesISO = () => hojeISO().slice(0, 8) + '01';
const un = (u: string) => (u === 'unit' ? 'un' : u);
const num = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 3 });
const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dataBR = (iso: string) => new Date(iso + 'T00:00:00').toLocaleDateString('pt-BR');
const dataHoraBR = (iso: string) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const mudou = (r: Resultado | undefined, o: Opcoes) => !!r && ((o.consumo && r.vendas_alteradas > 0) || (o.custo && (r.custo?.vendas_alteradas ?? 0) > 0));

export default function FichasVendasPassadasModal({ tenantId, onFechar, onAplicado }: Props) {
  const { success: toastOk, error: toastErr } = useToast();
  const [desde, setDesde] = useState(inicioMesISO());
  const [opcoes, setOpcoes] = useState<Opcoes>({ consumo: true, estoque: true, custo: true });
  const [vendidos, setVendidos] = useState<Vendido[] | null>(null);
  const [previas, setPrevias] = useState<Map<string, Resultado>>(new Map());
  const [erros, setErros] = useState<Map<string, string>>(new Map());
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [progresso, setProgresso] = useState<{ fase: 'calculando' | 'aplicando'; feito: number; total: number } | null>(null);
  const [verSemFicha, setVerSemFicha] = useState(false);

  const limpar = () => { setVendidos(null); setPrevias(new Map()); setErros(new Map()); setSel(new Set()); };
  const mudarOpcao = (k: keyof Opcoes, v: boolean) => {
    // Estoque depende do consumo: o saldo muda pela baixa refeita de cada venda
    const n = { ...opcoes, [k]: v };
    if (k === 'estoque' && v) n.consumo = true;
    if (k === 'consumo' && !v) n.estoque = false;
    setOpcoes(n);
    limpar();
  };

  const chamarItem = async (itemId: string, aplicar: boolean) => {
    const { data, error } = await invokeWithAuth<{ data: Resultado }>('menu-write', {
      body: { action: 'reaplicar_ficha', active_tenant_id: tenantId, payload: { item_id: itemId, desde, aplicar, opcoes } },
    });
    if (error) throw error;
    return data?.data as Resultado;
  };

  const calcular = async () => {
    if (!desde || desde > hojeISO()) { toastErr('Data inválida', 'Escolha uma data até hoje.'); return; }
    limpar();
    setProgresso({ fase: 'calculando', feito: 0, total: 0 });
    const { data, error } = await invokeWithAuth<{ data: Vendido[] }>('menu-write', {
      body: { action: 'fichas_vendidas', active_tenant_id: tenantId, payload: { desde } },
    });
    if (error) { setProgresso(null); toastErr('Não foi possível listar as vendas', error.message); return; }
    const lista = data?.data ?? [];
    setVendidos(lista);
    const comFicha = lista.filter((v) => v.tem_ficha);
    const ps = new Map<string, Resultado>();
    const es = new Map<string, string>();
    for (let i = 0; i < comFicha.length; i++) {
      setProgresso({ fase: 'calculando', feito: i, total: comFicha.length });
      try { ps.set(comFicha[i].item_id, await chamarItem(comFicha[i].item_id, false)); }
      catch (e) { es.set(comFicha[i].item_id, e instanceof Error ? e.message : String(e)); }
    }
    setPrevias(ps);
    setErros(es);
    setSel(new Set(comFicha.filter((v) => mudou(ps.get(v.item_id), opcoes)).map((v) => v.item_id)));
    setProgresso(null);
  };

  const aplicar = async () => {
    const ids = [...sel];
    if (!ids.length) return;
    let ok = 0;
    const falhas: string[] = [];
    for (let i = 0; i < ids.length; i++) {
      setProgresso({ fase: 'aplicando', feito: i, total: ids.length });
      try { await chamarItem(ids[i], true); ok++; }
      catch (e) { falhas.push(`${vendidos?.find((v) => v.item_id === ids[i])?.nome ?? ids[i]}: ${e instanceof Error ? e.message : e}`); }
    }
    setProgresso(null);
    if (falhas.length) toastErr(`${falhas.length} produto(s) não foram aplicados`, falhas.slice(0, 3).join(' · '));
    if (ok) {
      toastOk('Fichas aplicadas', `${ok} produto(s) refeitos desde ${dataBR(desde)}.`);
      onAplicado?.();
      onFechar();
    }
  };

  const comFicha = useMemo(() => (vendidos ?? []).filter((v) => v.tem_ficha), [vendidos]);
  const semFicha = useMemo(() => (vendidos ?? []).filter((v) => !v.tem_ficha), [vendidos]);
  const mudam = useMemo(() => comFicha.filter((v) => mudou(previas.get(v.item_id), opcoes) || erros.has(v.item_id)), [comFicha, previas, erros, opcoes]);

  // Soma por insumo dos produtos marcados (o mesmo insumo em vários produtos)
  const resumo = useMemo(() => {
    const porIng = new Map<string, Mudanca>();
    let custoAntes = 0; let custoDepois = 0; let vendasCusto = 0;
    for (const id of sel) {
      const r = previas.get(id);
      if (!r) continue;
      if (opcoes.consumo) {
        for (const m of r.insumos) {
          const a = porIng.get(m.ingredient_id) ?? { ...m, diferenca: 0, no_saldo: 0, na_contagem: 0 };
          a.diferenca += m.diferenca; a.no_saldo += m.no_saldo; a.na_contagem += m.na_contagem;
          porIng.set(m.ingredient_id, a);
        }
      }
      if (opcoes.custo && r.custo) { custoAntes += r.custo.antes; custoDepois += r.custo.depois; vendasCusto += r.custo.vendas_alteradas; }
    }
    return { insumos: [...porIng.values()].sort((a, b) => a.nome.localeCompare(b.nome)), custoAntes, custoDepois, vendasCusto };
  }, [sel, previas, opcoes]);

  const toggle = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const nenhumaOpcao = !opcoes.consumo && !opcoes.custo;
  const busy = !!progresso;

  const Opcao = ({ k, titulo, texto, disabled }: { k: keyof Opcoes; titulo: string; texto: string; disabled?: boolean }) => (
    <label className={`flex items-start gap-2 rounded-lg border px-3 py-2 cursor-pointer ${opcoes[k] ? 'border-amber-300 bg-amber-50/60' : 'border-zinc-200'} ${disabled ? 'opacity-50' : ''}`}>
      <input type="checkbox" className="mt-0.5 accent-amber-500" checked={opcoes[k]} disabled={busy || disabled} onChange={(e) => mudarOpcao(k, e.target.checked)} />
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-zinc-800">{titulo}</span>
        <span className="block text-[11px] text-zinc-500 leading-snug">{texto}</span>
      </span>
    </label>
  );

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end md:items-center justify-center p-0 md:p-4" onClick={busy ? undefined : onFechar}>
      <div className="bg-white w-full md:max-w-2xl rounded-t-2xl md:rounded-2xl max-h-[92vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="p-4 border-b border-zinc-100 flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-zinc-800">Aplicar fichas nas vendas passadas</p>
            <p className="text-xs text-zinc-500 mt-0.5">A ficha técnica de hoje passa a valer para as vendas desde a data escolhida.</p>
          </div>
          <button disabled={busy} onClick={onFechar} className="w-8 h-8 flex items-center justify-center rounded-lg text-zinc-400 hover:bg-zinc-100 cursor-pointer" aria-label="Fechar">
            <i className="ri-close-line text-lg" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <label className="flex flex-wrap items-center gap-2 text-sm text-zinc-700">
            Vendas desde
            <input type="date" value={desde} max={hojeISO()} disabled={busy} onChange={(e) => { setDesde(e.target.value); limpar(); }}
              className="border border-zinc-200 rounded-lg px-2 py-1 text-sm" />
          </label>

          <div className="space-y-2">
            <p className="text-[11px] font-semibold text-zinc-400 uppercase">Aplicar em</p>
            <Opcao k="consumo" titulo="Consumo e relatórios por dia"
              texto="Refaz a baixa dos insumos de cada venda, na data da venda (Consumo, Estoque Teórico). Sozinho, não muda o saldo de hoje." />
            <Opcao k="estoque" titulo="Estoque (saldo de hoje)"
              texto="O saldo recebe a diferença das vendas DEPOIS da última contagem de cada insumo. Antes da contagem nunca dá saída: a contagem já acertou o saldo. Vai junto com o consumo." />
            <Opcao k="custo" titulo="Custo das vendas (CMV teórico)"
              texto="Recalcula o custo do prato gravado em cada venda (DRE teórica, margem por prato) com a ficha e os preços dos insumos de hoje." />
          </div>

          {progresso && (
            <div className="rounded-lg bg-zinc-50 px-3 py-2 text-sm text-zinc-600 flex items-center gap-2">
              <div className="w-4 h-4 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
              {progresso.fase === 'calculando' ? 'Calculando' : 'Aplicando'}{progresso.total ? ` ${progresso.feito + 1} de ${progresso.total} produtos…` : '…'}
            </div>
          )}

          {vendidos && !progresso && (
            <>
              {mudam.length === 0 ? (
                <p className="text-sm text-zinc-500 bg-zinc-50 rounded-lg px-3 py-2">
                  {comFicha.length} produto(s) com ficha vendidos desde {dataBR(desde)} — nenhuma venda muda com as fichas de hoje.
                </p>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[11px] font-semibold text-zinc-400 uppercase">Produtos ({sel.size} de {mudam.length} marcados)</p>
                    <button className="text-[11px] font-semibold text-amber-700 hover:underline cursor-pointer"
                      onClick={() => setSel(sel.size === mudam.length ? new Set() : new Set(mudam.filter((v) => !erros.has(v.item_id)).map((v) => v.item_id)))}>
                      {sel.size === mudam.length ? 'Desmarcar todos' : 'Marcar todos'}
                    </button>
                  </div>
                  <div className="rounded-xl border border-zinc-100 divide-y divide-zinc-50">
                    {mudam.map((v) => {
                      const r = previas.get(v.item_id);
                      const erro = erros.get(v.item_id);
                      return (
                        <label key={v.item_id} className="flex items-start gap-2 px-3 py-2 cursor-pointer hover:bg-zinc-50/60">
                          <input type="checkbox" className="mt-0.5 accent-amber-500" disabled={!!erro} checked={sel.has(v.item_id)} onChange={() => toggle(v.item_id)} />
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm text-zinc-800 break-words">{v.nome}</span>
                            {erro ? <span className="block text-[11px] text-red-600">{erro}</span> : (
                              <span className="block text-[11px] text-zinc-500">
                                {opcoes.consumo && r && r.vendas_alteradas > 0 && `${r.vendas_alteradas} de ${r.vendas} venda(s) mudam a baixa`}
                                {opcoes.consumo && r && r.vendas_alteradas > 0 && opcoes.custo && (r.custo?.vendas_alteradas ?? 0) > 0 && ' · '}
                                {opcoes.custo && r?.custo && r.custo.vendas_alteradas > 0 && `custo ${brl(r.custo.antes)} → ${brl(r.custo.depois)}`}
                              </span>
                            )}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}

              {sel.size > 0 && (resumo.insumos.length > 0 || resumo.vendasCusto > 0) && (
                <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-3 space-y-2">
                  <p className="text-sm font-semibold text-zinc-800">Efeito dos produtos marcados</p>
                  {resumo.insumos.map((m) => (
                    <div key={m.ingredient_id} className="text-xs text-zinc-700 flex flex-wrap gap-x-2">
                      <span className="font-medium">{m.nome}</span>
                      <span>{m.diferenca > 0 ? 'baixa a mais' : 'baixa a menos'}: {m.diferenca > 0 ? '+' : ''}{num(m.diferenca)} {un(m.unidade)}</span>
                      {Math.abs(m.no_saldo) > 0 && (opcoes.estoque
                        ? <span className="text-zinc-500">· saldo de hoje {m.no_saldo > 0 ? '-' : '+'}{num(Math.abs(m.no_saldo))} {un(m.unidade)}</span>
                        : <span className="text-zinc-500">· saldo de hoje não muda</span>)}
                      {Math.abs(m.na_contagem) > 0 && (
                        <span className="text-zinc-500">· {num(Math.abs(m.na_contagem))} {un(m.unidade)} antes da contagem{m.ultima_contagem ? ` de ${dataHoraBR(m.ultima_contagem)}` : ''} (saldo não muda)</span>
                      )}
                    </div>
                  ))}
                  {opcoes.custo && resumo.vendasCusto > 0 && (
                    <p className="text-xs text-zinc-700">
                      <span className="font-medium">Custo das vendas</span>: {resumo.vendasCusto} venda(s), {brl(resumo.custoAntes)} → {brl(resumo.custoDepois)}
                    </p>
                  )}
                </div>
              )}

              {semFicha.length > 0 && (
                <div className="rounded-lg border border-zinc-100 px-3 py-2">
                  <button className="text-xs text-zinc-600 flex items-center gap-1 cursor-pointer" onClick={() => setVerSemFicha(!verSemFicha)}>
                    <i className={verSemFicha ? 'ri-arrow-down-s-line' : 'ri-arrow-right-s-line'} />
                    {semFicha.length} produto(s) vendidos sem ficha técnica — cadastre a ficha no Cardápio e aplique de novo
                  </button>
                  {verSemFicha && (
                    <p className="mt-1 text-[11px] text-zinc-500 leading-relaxed">
                      {semFicha.map((v) => `${v.nome} (${num(v.vendas)})`).join(' · ')}
                    </p>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        <div className="p-4 border-t border-zinc-100 flex flex-wrap items-center gap-2 justify-end">
          <button disabled={busy} onClick={onFechar} className="px-3 py-2 rounded-lg bg-zinc-100 text-zinc-700 text-xs font-semibold hover:bg-zinc-200 disabled:opacity-50 cursor-pointer">
            Fechar
          </button>
          {!vendidos || busy ? (
            <button disabled={busy || nenhumaOpcao} onClick={calcular} className="px-3 py-2 rounded-lg bg-amber-500 text-white text-xs font-semibold hover:bg-amber-600 disabled:opacity-50 cursor-pointer">
              {progresso?.fase === 'calculando' ? 'Calculando…' : 'Ver o efeito'}
            </button>
          ) : sel.size > 0 ? (
            <button disabled={busy} onClick={aplicar} className="px-3 py-2 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 disabled:opacity-50 cursor-pointer">
              Aplicar em {sel.size} produto(s) desde {dataBR(desde)}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** Botão que abre a janela (Estoque › Consumo e CMV/Fichas). Só administrador e gerente — o backend confere de novo. */
export function BotaoFichasVendasPassadas({ onAplicado, className }: { onAplicado?: () => void; className?: string }) {
  const { user } = useAuth();
  const [aberto, setAberto] = useState(false);
  if (!user?.tenantId || !['admin', 'gerente'].includes(String(user.perfil))) return null;
  return (
    <>
      <button onClick={() => setAberto(true)}
        className={className ?? 'inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-amber-200 bg-amber-50 text-amber-800 text-xs font-semibold hover:bg-amber-100 cursor-pointer'}>
        <i className="ri-history-line" /> Aplicar fichas nas vendas passadas
      </button>
      {aberto && <FichasVendasPassadasModal tenantId={user.tenantId} onFechar={() => setAberto(false)} onAplicado={onAplicado} />}
    </>
  );
}
