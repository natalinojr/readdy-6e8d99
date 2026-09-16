// Ação rápida: registrar produção — SÓ escolhe a ficha e leva para a tela.
// Não grava pelo chat de propósito: o RegistroProducaoModal exige checklist de passos da ficha,
// valida estoque dos insumos, converte unidades por item, calcula perda/rendimento (toKgAprox) e
// pode CRIAR o insumo do produto acabado antes de chamar production-write create_batch_with_stock.
// Reproduzir isso aqui duplicaria regra sensível (já houve bug de ×1000 na escala).
import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { invokeWithAuth } from '@/lib/supabase';
import { Roteiro, useRoteiro, Opcao, OpcaoNeutra, Campo, Fim, type AcaoProps } from '../kit';
import { normalizar, qtdBR } from './comum';

interface Ficha {
  id: string; nome: string; unidade: string; categoria: string;
  itens: { nome: string; quantidade: number; unidade: string }[]; passos: number;
}
type Passo = 'carregando' | 'lista' | 'ficha' | 'fim';

export default function RegistrarProducao({ onFechar, irPara }: AcaoProps) {
  const { user } = useAuth();
  const r = useRoteiro();
  const [passo, setPasso] = useState<Passo>('carregando');
  const [fichas, setFichas] = useState<Ficha[]>([]);
  const [filtro, setFiltro] = useState('');

  useEffect(() => {
    (async () => {
      if (!user?.tenantId) { r.bot('Nenhuma loja ativa.'); setPasso('fim'); return; }
      // Mesma leitura do ProducaoContext.loadFromBackend
      const { data, error } = await invokeWithAuth<{ success: boolean; data: Record<string, unknown>[]; error?: string }>('production-write', {
        body: { action: 'list_recipes', tenant_id: user.tenantId },
      });
      if (error || !data?.success) { r.bot(`Não consegui ler as fichas: ${error?.message ?? data?.error ?? 'erro'}`); setPasso('fim'); return; }
      const lista: Ficha[] = (data.data ?? [])
        .filter((f) => (f.is_active ?? true) !== false)
        .map((f) => {
          const itens = ((f.items as Record<string, unknown>[]) ?? (f.production_recipe_items as Record<string, unknown>[]) ?? []);
          const passos = ((f.steps as unknown[]) ?? (f.production_recipe_steps as unknown[]) ?? []).length;
          return {
            id: String(f.id),
            nome: String(f.name ?? ''),
            unidade: String(f.unit ?? 'kg'),
            categoria: String(f.category ?? ''),
            passos,
            itens: itens.map((it) => ({
              nome: String(it.ingredient_name ?? it.ingredientName ?? ''),
              quantidade: Number(it.quantity ?? 0),
              unidade: String(it.unit ?? ''),
            })),
          };
        })
        .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
      if (!lista.length) { r.bot(`*${user.loja}*\nNenhuma ficha de produção cadastrada.`); setPasso('fim'); return; }
      setFichas(lista);
      r.bot(`*${user.loja}*\nQual ficha vai produzir?`);
      setPasso('lista');
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const escolher = (f: Ficha) => {
    r.eu(f.nome);
    r.bot([
      `*${f.nome}*${f.categoria ? ` · ${f.categoria}` : ''}`,
      'Insumos por receita:',
      ...(f.itens.length ? f.itens.map((i) => `• ${i.nome}: ${qtdBR(i.quantidade)} ${i.unidade}`) : ['(sem insumos)']),
      ...(f.passos ? [`${f.passos} passo(s) no checklist.`] : []),
      'O registro é feito na tela (checklist, pesagem e perda). Na aba Produção, toque em "Registrar Produção" nesta ficha.',
    ].join('\n'));
    setPasso('ficha');
  };

  const visiveis = filtro ? fichas.filter((f) => normalizar(f.nome).includes(normalizar(filtro))) : fichas;

  return (
    <Roteiro titulo="Registrar produção" icone="ri-restaurant-2-line" cor="bg-orange-50 text-orange-600"
      baloes={r.baloes} carregando={passo === 'carregando'} onFechar={onFechar}>
      {passo === 'lista' && (
        <>
          {fichas.length > 8 && <Campo placeholder="Buscar ficha" onEnviar={(t) => setFiltro(t)} />}
          {filtro && <OpcaoNeutra onClick={() => setFiltro('')}>Limpar busca ({filtro})</OpcaoNeutra>}
          {visiveis.slice(0, 30).map((f) => <Opcao key={f.id} onClick={() => escolher(f)} detalhe={f.unidade}>{f.nome}</Opcao>)}
          {!visiveis.length && <p className="text-xs text-zinc-400 px-1">Nenhuma ficha com esse nome.</p>}
        </>
      )}
      {passo === 'ficha' && (
        <>
          <Opcao onClick={() => irPara('/estoque?tab=producao')}>Abrir Registrar Produção</Opcao>
          <OpcaoNeutra onClick={() => setPasso('lista')}>Outra ficha</OpcaoNeutra>
          <OpcaoNeutra onClick={onFechar}>Fechar</OpcaoNeutra>
        </>
      )}
      {passo === 'fim' && <Fim onFechar={onFechar} acoes={[{ label: 'Abrir Produção', onClick: () => irPara('/estoque?tab=producao') }]} />}
    </Roteiro>
  );
}
