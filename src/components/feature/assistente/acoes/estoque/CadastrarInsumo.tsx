// Ação rápida: cadastrar insumo NOVO (nunca edita — editar já zerou estoque no passado).
// Caminho da tela: InsumoModal → InsumosTab.handleSaveInsumo → EstoqueContext.upsertInsumo (isNew)
// → stock-write upsert_ingredient → fn_upsert_ingredient (INSERT). Corpo igual ao de um insumo novo
// criado pela tela com os valores padrão do modal (preço automático, sem unidade de compra, uso final).
// Categoria: só as já cadastradas (fin_merchandise_categories, mesma leitura do useIngredientCategories).
import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { Roteiro, useRoteiro, Opcao, OpcaoNeutra, Campo, Fim, lerNumero, type AcaoProps } from '../kit';
import { lerInsumos, gravarNaEdge, normalizar } from './comum';

type Passo = 'carregando' | 'nome' | 'unidade' | 'categoria' | 'minimo' | 'confirmar' | 'gravando' | 'fim';
// Rótulo → código que o EstoqueContext envia (FRONT_UNIT_MAP) e a Edge aceita (UNIT_MAP)
const UNIDADES: { rotulo: string; codigo: string }[] = [
  { rotulo: 'kg', codigo: 'kg' }, { rotulo: 'g', codigo: 'g' }, { rotulo: 'L', codigo: 'L' },
  { rotulo: 'ml', codigo: 'ml' }, { rotulo: 'un', codigo: 'unit' },
];

export default function CadastrarInsumo({ onFechar, irPara }: AcaoProps) {
  const { user } = useAuth();
  const r = useRoteiro();
  const [passo, setPasso] = useState<Passo>('carregando');
  const [nomesExistentes, setNomesExistentes] = useState<Set<string>>(new Set());
  const [categorias, setCategorias] = useState<string[]>([]);
  const [nome, setNome] = useState('');
  const [unidade, setUnidade] = useState(UNIDADES[0]);
  const [categoria, setCategoria] = useState('Sem categoria');
  const [minimo, setMinimo] = useState(0);
  const [ok, setOk] = useState(false);

  useEffect(() => {
    (async () => {
      if (!user?.tenantId) { r.bot('Nenhuma loja ativa.'); setPasso('fim'); return; }
      const [ins, cats] = await Promise.all([
        lerInsumos(user.tenantId),
        supabase.from('fin_merchandise_categories').select('name').eq('tenant_id', user.tenantId).eq('is_active', true)
          .order('sort_order', { ascending: true }).order('name', { ascending: true }),
      ]);
      if (ins.erro) { r.bot(`Não consegui ler os insumos: ${ins.erro}`); setPasso('fim'); return; }
      setNomesExistentes(new Set(ins.insumos.map((i) => normalizar(i.nome))));
      setCategorias(((cats.data ?? []) as { name: string }[]).map((c) => c.name));
      r.bot(`*${user.loja}*\nNome do novo insumo?`);
      setPasso('nome');
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const informarNome = (t: string) => {
    r.eu(t);
    const n = t.trim().replace(/\s+/g, ' ');
    if (n.length < 2) { r.bot('Nome muito curto.'); return; }
    if (nomesExistentes.has(normalizar(n))) { r.bot(`Já existe um insumo "${n}" nesta loja. Digite outro nome.`); return; }
    setNome(n);
    r.bot('Unidade de estoque?');
    setPasso('unidade');
  };

  const escolherUnidade = (u: typeof UNIDADES[number]) => {
    r.eu(u.rotulo);
    setUnidade(u);
    r.bot('Categoria?');
    setPasso('categoria');
  };

  const escolherCategoria = (c: string) => {
    r.eu(c);
    setCategoria(c);
    r.bot(`Estoque mínimo em ${unidade.rotulo}? (opcional)`);
    setPasso('minimo');
  };

  const definirMinimo = (t: string | null) => {
    let m = 0;
    if (t != null) {
      const n = lerNumero(t);
      r.eu(t);
      if (!(n >= 0)) { r.bot('Número inválido. Ex.: 2,5'); return; }
      m = n;
    } else r.eu('Sem mínimo');
    setMinimo(m);
    r.bot([
      '*Confere o cadastro:*',
      `Loja: ${user?.loja ?? ''}`,
      `Nome: ${nome}`,
      `Unidade: ${unidade.rotulo}`,
      `Categoria: ${categoria}`,
      `Estoque mínimo: ${m > 0 ? `${m.toLocaleString('pt-BR')} ${unidade.rotulo}` : 'não definido'}`,
      'Estoque inicial: 0 (entra pela compra ou inventário)',
    ].join('\n'));
    setPasso('confirmar');
  };

  const gravar = async () => {
    r.eu('Cadastrar');
    setPasso('gravando');
    const { erro } = await gravarNaEdge('stock-write', {
      action: 'upsert_ingredient',
      tenant_id: user!.tenantId,
      id: null,
      name: nome,
      unit: unidade.codigo,
      unit_price: 0,
      price_source: 'auto',
      min_stock: minimo,
      current_stock: 0,
      category: categoria,
      purchase_unit: null,
      purchase_factor: 1,
      usage_type: 'final',
      dre_category_id: null,
    });
    if (erro) r.bot(`Não cadastrou: ${erro}`);
    else { setOk(true); r.bot(`Insumo "${nome}" cadastrado.`); }
    setPasso('fim');
  };

  return (
    <Roteiro titulo="Cadastrar insumo" icone="ri-add-box-line" cor="bg-emerald-50 text-emerald-600"
      baloes={r.baloes} carregando={passo === 'carregando' || passo === 'gravando'}
      textoCarregando={passo === 'gravando' ? 'Gravando…' : 'Carregando…'} onFechar={onFechar} travarFechar={passo === 'gravando'}>
      {passo === 'nome' && <Campo placeholder="Ex.: Queijo muçarela" onEnviar={informarNome} />}
      {passo === 'unidade' && UNIDADES.map((u) => <Opcao key={u.codigo} onClick={() => escolherUnidade(u)}>{u.rotulo}</Opcao>)}
      {passo === 'categoria' && (
        <>
          {categorias.map((c) => <Opcao key={c} onClick={() => escolherCategoria(c)}>{c}</Opcao>)}
          <OpcaoNeutra onClick={() => escolherCategoria('Sem categoria')}>Sem categoria</OpcaoNeutra>
        </>
      )}
      {passo === 'minimo' && (
        <>
          <Campo placeholder={`Mínimo em ${unidade.rotulo}`} modo="decimal" onEnviar={definirMinimo} />
          <OpcaoNeutra onClick={() => definirMinimo(null)}>Sem mínimo</OpcaoNeutra>
        </>
      )}
      {passo === 'confirmar' && (
        <>
          <Opcao onClick={gravar}>Cadastrar</Opcao>
          <OpcaoNeutra onClick={onFechar}>Cancelar</OpcaoNeutra>
        </>
      )}
      {passo === 'fim' && <Fim onFechar={onFechar} acoes={ok ? [{ label: 'Abrir Estoque', onClick: () => irPara('/estoque') }] : undefined} />}
    </Roteiro>
  );
}
