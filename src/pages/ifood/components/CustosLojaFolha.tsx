import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Folha, avisar, btn } from '@/components/kit';
import { ROTULO_BASE, type BaseCusto, type CustoExtra } from '@/lib/ifoodCustosPedido';

// Custos da loja nos pedidos do iFood (dono 06/10/2026): impostos, royalties, fundo de propaganda, embalagem…
// Cada um vira uma coluna na tabela Pedidos › Custos e entra no resultado do pedido. Gravação pela RPC
// fn_salvar_ifood_custos_extras (só admin/gerente).

/** Lê os custos da loja (lista vazia se ainda não há nenhum). */
export function useCustosLoja(tenantId: string | null) {
  const [custos, setCustos] = useState<CustoExtra[]>([]);
  const [lido, setLido] = useState(false);
  const [versao, setVersao] = useState(0);
  useEffect(() => {
    // Troca de loja: nunca mostrar (nem salvar por cima) os custos da loja anterior.
    setCustos([]); setLido(false);
    if (!tenantId) return;
    let vivo = true;
    supabase.from('ifood_custos_extras').select('id, nome, tipo, base, valor, ativo').eq('tenant_id', tenantId).order('ordem')
      .then(({ data, error }) => {
        if (!vivo) return;
        if (error) { setLido(false); return; }
        setCustos(((data ?? []) as CustoExtra[]).map((c) => ({ ...c, valor: Number(c.valor) })));
        setLido(true);
      });
    return () => { vivo = false; };
  }, [tenantId, versao]);
  return { custos, lido, recarregar: () => setVersao((v) => v + 1) };
}

const BASES: BaseCusto[] = ['nota', 'venda', 'chega', 'lucro'];
const EXEMPLOS = 'Ex.: Simples Nacional 6% do valor da nota · Royalties 5% das vendas · Fundo de propaganda 2% das vendas · Embalagem R$ 1,50 por pedido.';

type Linha = CustoExtra & { texto: string };

export default function CustosLojaFolha({ aberta, tenantId, custos, lido, onFechar, onSalvou }: {
  aberta: boolean; tenantId: string; custos: CustoExtra[]; lido: boolean; onFechar: () => void; onSalvou: () => void;
}) {
  const [lista, setLista] = useState<Linha[]>([]);
  const [salvando, setSalvando] = useState(false);
  useEffect(() => { if (aberta) setLista(custos.map((c) => ({ ...c, texto: String(c.valor).replace('.', ',') }))); }, [aberta, custos]);

  const mudar = (i: number, m: Partial<Linha>) => setLista((l) => l.map((c, j) => (j === i ? { ...c, ...m } : c)));
  const novo = () => setLista((l) => [...l, { nome: '', tipo: 'percentual', base: 'nota', valor: 0, ativo: true, texto: '' }]);

  const salvar = async () => {
    if (!lido) { void avisar('Os custos desta loja ainda não carregaram. Feche e abra de novo.', { titulo: 'Espere um pouco', erro: true }); return; }
    if (lista.some((c) => !c.nome.trim() && c.texto.trim())) { void avisar('Dê um nome a cada custo (ex.: Simples Nacional).', { titulo: 'Falta o nome', erro: true }); return; }
    const limpa = lista.filter((c) => c.nome.trim()).map((c) => ({ ...c, valor: Number(c.texto.includes(',') ? c.texto.replace(/\./g, '').replace(',', '.') : c.texto) }));
    if (limpa.some((c) => !Number.isFinite(c.valor) || c.valor < 0 || !c.texto.trim())) { void avisar('Use um número igual ou maior que zero (ex.: 6 ou 1,50).', { titulo: 'Valor inválido', erro: true }); return; }
    setSalvando(true);
    const { error } = await supabase.rpc('fn_salvar_ifood_custos_extras', {
      p_tenant_id: tenantId,
      p_custos: limpa.map((c) => ({ nome: c.nome.trim(), tipo: c.tipo, base: c.tipo === 'fixo' ? null : c.base ?? 'nota', valor: c.valor, ativo: c.ativo })),
    });
    setSalvando(false);
    if (error) { void avisar(error.message, { titulo: 'Não salvou', erro: true }); return; }
    onSalvou();
    onFechar();
  };

  return (
    <Folha aberta={aberta} titulo="Custos da loja nos pedidos do iFood" subtitulo="Cada custo vira uma coluna na tabela e sai do resultado do pedido." onFechar={onFechar} fecharNoFundo={false}
      rodape={(
        <div className="flex gap-2">
          <button type="button" className={btn('out')} onClick={onFechar}>Cancelar</button>
          <button type="button" className={`${btn('p')} flex-1`} disabled={salvando || !lido} onClick={salvar}>{salvando ? 'Salvando…' : 'Salvar'}</button>
        </div>
      )}>
      <div className="space-y-3">
        <p className="text-[12px] text-zinc-500 leading-snug">{EXEMPLOS}</p>
        {lista.length === 0 && <p className="text-[13px] text-zinc-600">Nenhum custo ainda.</p>}
        {lista.map((c, i) => (
          <div key={i} className="rounded-2xl border border-zinc-200 p-3 space-y-2">
            <div className="flex gap-2 items-center">
              <input value={c.nome} maxLength={40} onChange={(e) => mudar(i, { nome: e.target.value })} placeholder="Nome (ex.: Simples Nacional)"
                className="flex-1 min-w-0 h-10 px-3 rounded-xl border border-zinc-200 text-[14px] focus:outline-none focus:border-amber-400" />
              <button type="button" aria-label="Tirar" onClick={() => setLista((l) => l.filter((_, j) => j !== i))}
                className="w-10 h-10 flex items-center justify-center rounded-xl text-zinc-400 hover:bg-zinc-100"><i className="ri-delete-bin-line" /></button>
            </div>
            <div className="flex flex-wrap gap-2 items-center text-[13px] text-zinc-700">
              <select value={c.tipo} onChange={(e) => mudar(i, { tipo: e.target.value as CustoExtra['tipo'], base: e.target.value === 'fixo' ? null : c.base ?? 'nota' })}
                className="h-10 px-2 rounded-xl border border-zinc-200 bg-white">
                <option value="percentual">% sobre</option>
                <option value="fixo">R$ por pedido</option>
              </select>
              <input type="text" inputMode="decimal" value={c.texto} placeholder="0" onChange={(e) => mudar(i, { texto: e.target.value.replace(/[^\d.,]/g, '') })}
                className="w-24 h-10 px-2 rounded-xl border border-zinc-200 text-right tabular-nums" />
              <span>{c.tipo === 'fixo' ? 'reais' : '%'}</span>
              {c.tipo === 'percentual' && (
                <>
                  <span>de</span>
                  <select value={c.base ?? 'nota'} onChange={(e) => mudar(i, { base: e.target.value as BaseCusto })} className="h-10 px-2 rounded-xl border border-zinc-200 bg-white">
                    {BASES.map((b) => <option key={b} value={b}>{ROTULO_BASE[b]}</option>)}
                  </select>
                </>
              )}
              <label className="flex items-center gap-1.5 ml-auto text-[12.5px] text-zinc-500">
                <input type="checkbox" checked={c.ativo} onChange={(e) => mudar(i, { ativo: e.target.checked })} /> ligado
              </label>
            </div>
          </div>
        ))}
        <button type="button" className={`${btn('out', 'sm')} w-full`} onClick={novo}><i className="ri-add-line" /> Adicionar custo</button>
        <p className="text-[11.5px] text-zinc-400 leading-snug">
          Bases: <b>valor da nota fiscal</b> = itens − desconto da loja (o que o Simples tributa); <b>vendas no iFood</b> = preço dos itens;
          <b> o que chega na loja</b> = repasse do iFood; <b>lucro bruto</b> = o que chega − comida.
        </p>
      </div>
    </Folha>
  );
}
