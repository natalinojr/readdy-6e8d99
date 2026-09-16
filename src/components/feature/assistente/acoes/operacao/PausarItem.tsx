// Ação rápida: pausar/ativar um item do cardápio.
// Leitura: RPC fn_get_full_menu (a mesma do CardapioContext). Gravação: Edge menu-write,
// action upsert_item com active_tenant_id — o mesmo caminho do botão ativo/inativo da tela
// Cardápio (ItensTab.toggleStatus → salvarItem).
// PEGADINHA: no upsert_item a Edge sempre grava `photo_url` e `delivery_config` (null quando não
// vêm no payload). Por isso reenviamos os valores ATUAIS do item; os demais campos ausentes
// (nome, preço, canais, grupos de opções…) ficam de fora do UPDATE e não são tocados.
import { useEffect, useRef, useState } from 'react';
import { supabase, invokeWithAuth } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useCardapio } from '@/contexts/CardapioContext';
import { Roteiro, useRoteiro, Opcao, OpcaoNeutra, Campo, Fim, brl, type AcaoProps } from '../kit';

interface ItemMenu {
  id: string;
  name: string;
  price: number | null;
  is_active: boolean | null;
  category_id: string;
  photo_url: string | null;
  delivery_config: unknown;
}

const semAcento = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export default function PausarItem({ onFechar, irPara }: AcaoProps) {
  const { user } = useAuth();
  const { recarregar } = useCardapio();
  const { baloes, bot, eu } = useRoteiro();
  const [passo, setPasso] = useState<'carregando' | 'busca' | 'resultados' | 'confirmar' | 'gravando' | 'fim'>('carregando');
  const [itens, setItens] = useState<ItemMenu[]>([]);
  const [categorias, setCategorias] = useState<Record<string, string>>({});
  const [achados, setAchados] = useState<ItemMenu[]>([]);
  const [escolhido, setEscolhido] = useState<ItemMenu | null>(null);
  const iniciou = useRef(false);

  useEffect(() => {
    if (iniciou.current) return;
    iniciou.current = true;
    (async () => {
      bot(`Loja: *${user?.loja || 'loja ativa'}*`);
      if (!user?.tenantId) { bot('Nenhuma loja ativa.'); setPasso('fim'); return; }
      const { data, error } = await supabase.rpc('fn_get_full_menu', { p_tenant_id: user.tenantId });
      if (error || !data) { bot(`Não consegui abrir o cardápio: ${error?.message ?? 'resposta vazia'}`); setPasso('fim'); return; }
      const d = data as { items?: ItemMenu[]; categories?: { id: string; name: string }[] };
      setItens(d.items ?? []);
      setCategorias(Object.fromEntries((d.categories ?? []).map((c) => [c.id, c.name])));
      bot('Qual item? Digite parte do nome.');
      setPasso('busca');
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const buscar = (texto: string) => {
    eu(texto);
    const q = semAcento(texto);
    const lista = itens.filter((i) => semAcento(i.name ?? '').includes(q)).slice(0, 12);
    if (!lista.length) { bot('Não achei. Tenta outra parte do nome.'); return; }
    setAchados(lista);
    bot(lista.length === 1 ? 'Achei este:' : `Achei ${lista.length}${lista.length === 12 ? ' (mostrando 12)' : ''}. Toque no item:`);
    setPasso('resultados');
  };

  const escolher = (i: ItemMenu) => {
    eu(i.name);
    setEscolhido(i);
    const ativo = i.is_active === true;
    bot([
      `*${i.name}*`,
      `${categorias[i.category_id] ?? 'Sem categoria'} · ${brl(i.price)}`,
      `Agora: ${ativo ? 'ATIVO (aparece para venda)' : 'PAUSADO (não aparece para venda)'}`,
      '',
      ativo ? 'Pausar este item em todos os canais?' : 'Ativar este item de novo?',
    ].join('\n'));
    setPasso('confirmar');
  };

  const gravar = async () => {
    const i = escolhido;
    if (!i || !user?.tenantId) return;
    const novoAtivo = !(i.is_active === true);
    eu(novoAtivo ? 'Ativar' : 'Pausar');
    setPasso('gravando');
    const { error } = await invokeWithAuth('menu-write', {
      body: {
        action: 'upsert_item',
        active_tenant_id: user.tenantId,
        payload: { id: i.id, is_active: novoAtivo, photo_url: i.photo_url ?? null, delivery_config: i.delivery_config ?? null },
      },
    });
    if (error) {
      bot(`❌ Não gravou: ${error.message}\nNada foi alterado. Confira na tela Cardápio antes de tentar de novo.`);
      setPasso('fim');
      return;
    }
    setItens((prev) => prev.map((x) => (x.id === i.id ? { ...x, is_active: novoAtivo } : x)));
    bot(novoAtivo ? `✅ ${i.name} ativado.` : `✅ ${i.name} pausado.`);
    recarregar({ silent: true }).catch(() => { /* a tela recarrega sozinha ao abrir */ });
    setPasso('fim');
  };

  return (
    <Roteiro titulo="Pausar item do cardápio" icone="ri-pause-circle-line" cor="bg-amber-50 text-amber-600" baloes={baloes}
      carregando={passo === 'carregando' || passo === 'gravando'} textoCarregando={passo === 'gravando' ? 'Gravando…' : 'Abrindo o cardápio…'}
      onFechar={onFechar} travarFechar={passo === 'gravando'}>
      {passo === 'busca' && <Campo placeholder="Nome do item" onEnviar={buscar} />}
      {passo === 'resultados' && (
        <>
          {achados.map((i) => (
            <Opcao key={i.id} onClick={() => escolher(i)} detalhe={i.is_active ? '· ativo' : '· pausado'}>{i.name}</Opcao>
          ))}
          <Campo placeholder="Buscar outro nome" onEnviar={buscar} />
        </>
      )}
      {passo === 'confirmar' && escolhido && (
        <>
          <Opcao perigo={escolhido.is_active === true} onClick={gravar}>
            {escolhido.is_active === true ? 'Sim, pausar' : 'Sim, ativar'}
          </Opcao>
          <OpcaoNeutra onClick={() => { eu('Não'); bot('Ok, nada alterado. Qual item?'); setPasso('busca'); }}>Não, voltar</OpcaoNeutra>
        </>
      )}
      {passo === 'fim' && (
        <Fim onFechar={onFechar} acoes={[
          ...(itens.length ? [{ label: 'Outro item', onClick: () => { bot('Qual item?'); setPasso('busca'); } }] : []),
          { label: 'Abrir Cardápio', onClick: () => irPara('/cardapio') },
        ]} />
      )}
    </Roteiro>
  );
}
