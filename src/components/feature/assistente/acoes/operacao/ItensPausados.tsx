// Ação rápida (só leitura): o que está pausado no cardápio da loja ativa (dono, 2026-09-23).
// Leitura: RPC fn_get_full_menu (a mesma do CardapioContext e do "Pausar/ativar item"); ela já
// deixa de fora o que foi excluído (deleted_at). Pausado = is_active false — o mesmo botão
// ativo/inativo da tela Cardápio. Categoria pausada esconde os itens dela mesmo que estejam ativos,
// por isso aparece à parte. "Esgotado" (insumo zerado) é do estoque e não entra aqui.
import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { Roteiro, useRoteiro, Fim, brl, type AcaoProps } from '../kit';
import { Painel, Kpis, Linhas } from '../painel';

interface Menu {
  items?: { id: string; name: string; price: number | null; is_active: boolean | null; category_id: string }[];
  categories?: { id: string; name: string; is_active: boolean | null; sort_order: number | null; item_count?: number | null }[];
  combos?: { id: string; name: string; price: number | null; is_active: boolean | null }[];
}

export default function ItensPausados({ onFechar, irPara }: AcaoProps) {
  const { user } = useAuth();
  const { baloes, bot, painel } = useRoteiro();
  const [passo, setPasso] = useState<'carregando' | 'fim'>('carregando');
  const iniciou = useRef(false);

  useEffect(() => {
    if (iniciou.current) return;
    iniciou.current = true;
    (async () => {
      if (!user?.tenantId) { bot('Nenhuma loja ativa.'); setPasso('fim'); return; }
      const { data, error } = await supabase.rpc('fn_get_full_menu', { p_tenant_id: user.tenantId });
      if (error || !data) { bot(`Não consegui abrir o cardápio: ${error?.message ?? 'resposta vazia'}`); setPasso('fim'); return; }
      const d = data as Menu;
      const categorias = [...(d.categories ?? [])].sort((a, b) => Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0));
      const itens = (d.items ?? []).filter((i) => i.is_active !== true);
      const catPausadas = categorias.filter((c) => c.is_active !== true);
      const combos = (d.combos ?? []).filter((c) => c.is_active !== true);
      if (!itens.length && !catPausadas.length && !combos.length) {
        bot(`*Loja: ${user.loja || 'loja ativa'}*\nNenhum item pausado ✅ — tudo o que está no cardápio aparece para venda.`);
        setPasso('fim');
        return;
      }
      const porCategoria = new Map<string, typeof itens>();
      for (const i of itens) porCategoria.set(i.category_id, [...(porCategoria.get(i.category_id) ?? []), i]);
      const nomeCat = new Map(categorias.map((c) => [c.id, c.name]));
      const ordem = [...categorias.map((c) => c.id), ...[...porCategoria.keys()].filter((id) => !nomeCat.has(id))];
      const grupos = ordem.filter((id) => porCategoria.has(id)).map((id) => ({
        titulo: nomeCat.get(id) ?? 'Sem categoria',
        itens: porCategoria.get(id)!.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')),
      }));

      painel(
        <Painel titulo="Itens pausados" subtitulo={user.loja || 'Loja ativa'} rodape="Pausado não aparece para venda em nenhum canal. Para ativar: Pausar/ativar item ou tela Cardápio.">
          <Kpis
            principal={{ label: 'Itens pausados', valor: String(itens.length) }}
            outros={[{ label: 'Categorias pausadas', valor: String(catPausadas.length) }, { label: 'Combos pausados', valor: String(combos.length) }]}
          />
          {catPausadas.length > 0 && (
            <Linhas titulo="Categorias pausadas (escondem todos os itens dela)" itens={catPausadas.map((c) => ({
              label: c.name,
              valor: c.item_count != null ? `${c.item_count} ite${Number(c.item_count) === 1 ? 'm' : 'ns'}` : undefined,
              status: 'alerta' as const,
            }))} />
          )}
          {grupos.map((g) => (
            <Linhas key={g.titulo} titulo={g.titulo} itens={g.itens.map((i) => ({ label: i.name, valor: brl(i.price), status: 'alerta' as const }))} />
          ))}
          {combos.length > 0 && (
            <Linhas titulo="Combos" itens={combos.map((c) => ({ label: c.name, valor: brl(c.price), status: 'alerta' as const }))} />
          )}
        </Painel>,
      );
      setPasso('fim');
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Roteiro titulo="Itens pausados" icone="ri-pause-mini-line" cor="bg-orange-50 text-orange-600" baloes={baloes}
      carregando={passo === 'carregando'} textoCarregando="Abrindo o cardápio…" onFechar={onFechar}>
      {passo === 'fim' && (
        <Fim onFechar={onFechar} acoes={[{ label: 'Abrir Cardápio', onClick: () => irPara('/cardapio') }]} />
      )}
    </Roteiro>
  );
}
