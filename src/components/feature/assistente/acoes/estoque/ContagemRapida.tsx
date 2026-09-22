// Ação rápida: contagem de inventário pelo celular, por categoria, um insumo por vez.
// Grava pelo caminho corrigido da tela (EstoqueContext.confirmarInventario → stock-write confirm_inventory
// → RPC transacional fn_confirm_inventory: delta contra o estoque VIVO com FOR UPDATE, sessão numerada).
// Diferença proposital da tela: só vão os insumos CONTADOS. Os pulados não são enviados, então o
// estoque deles não é sobrescrito com o teórico lido no começo da contagem.
import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Roteiro, useRoteiro, Opcao, OpcaoNeutra, Campo, Fim, brl, lerNumero, type AcaoProps } from '../kit';
import { lerInsumos, gravarNaEdge, rotuloUnidade, qtdBR, type InsumoLido } from './comum';

type Passo = 'carregando' | 'categoria' | 'contando' | 'resumo' | 'gravando' | 'fim';
const SEM_CAT = 'Sem categoria';
const catDe = (i: InsumoLido) => (i.categoria && i.categoria.trim() ? i.categoria : SEM_CAT);
// Unidade do banco → UnidadeEstoque do front (formato dos itens que a tela envia)
const unidadeFront = (u: string) => (u === 'unit' ? 'un' : u === 'L' ? 'l' : u);

export default function ContagemRapida({ onFechar, irPara }: AcaoProps) {
  const { user } = useAuth();
  const r = useRoteiro();
  const [passo, setPasso] = useState<Passo>('carregando');
  const [insumos, setInsumos] = useState<InsumoLido[]>([]);
  const [fila, setFila] = useState<InsumoLido[]>([]);
  const [pos, setPos] = useState(0);
  const [contagens, setContagens] = useState<Record<string, number>>({});
  const [ok, setOk] = useState(false);

  const categorias = useMemo(() => {
    const m = new Map<string, number>();
    insumos.forEach((i) => m.set(catDe(i), (m.get(catDe(i)) ?? 0) + 1));
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], 'pt-BR'));
  }, [insumos]);

  useEffect(() => {
    (async () => {
      if (!user?.tenantId) { r.bot('Nenhuma loja ativa.'); setPasso('fim'); return; }
      const { insumos: lista, erro } = await lerInsumos(user.tenantId);
      if (erro) { r.bot(`Não consegui ler os insumos: ${erro}`); setPasso('fim'); return; }
      // Insumo marcado como "fora do inventário" não entra na contagem.
      const contaveis = lista.filter((i) => i.contaInventario);
      if (!contaveis.length) { r.bot(lista.length ? 'Nenhum insumo desta loja está marcado para contar no inventário.' : 'Esta loja não tem insumos cadastrados.'); setPasso('fim'); return; }
      setInsumos(contaveis);
      r.bot(`*${user.loja}*\nContar qual categoria?`);
      setPasso('categoria');
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const perguntar = (i: InsumoLido, n: number, total: number) => {
    r.bot(`(${n}/${total}) *${i.nome}*\nNo sistema: ${qtdBR(i.estoque)} ${rotuloUnidade(i.unidadeDb)}. Quanto tem?`);
  };

  const escolherCategoria = (c: string) => {
    r.eu(c);
    const lista = c === 'Todas' ? insumos : insumos.filter((i) => catDe(i) === c);
    setFila(lista);
    setPos(0);
    perguntar(lista[0], 1, lista.length);
    setPasso('contando');
  };

  const avancar = (cont: Record<string, number>) => {
    const prox = pos + 1;
    if (prox >= fila.length) { mostrarResumo(cont); return; }
    setPos(prox);
    perguntar(fila[prox], prox + 1, fila.length);
  };

  const contar = (t: string) => {
    const n = lerNumero(t);
    r.eu(t);
    if (!(n >= 0)) { r.bot('Número inválido (zero ou mais). Ex.: 3,5'); return; }
    const i = fila[pos];
    const nova = { ...contagens, [i.id]: n };
    setContagens(nova);
    avancar(nova);
  };

  const confere = () => {
    const i = fila[pos];
    r.eu(`Confere (${qtdBR(i.estoque)})`);
    const nova = { ...contagens, [i.id]: Math.max(0, i.estoque) };
    setContagens(nova);
    avancar(nova);
  };

  const pular = () => { r.eu('Pular'); avancar(contagens); };

  const mostrarResumo = (cont: Record<string, number>) => {
    const contados = insumos.filter((i) => cont[i.id] !== undefined);
    if (!contados.length) { r.bot('Nada foi contado. Nada será gravado.'); setPasso('fim'); return; }
    const difs = contados.filter((i) => Math.abs(cont[i.id] - i.estoque) > 0.00005);
    const valor = difs.reduce((s, i) => s + (cont[i.id] - i.estoque) * i.preco, 0);
    r.bot([
      '*Resumo da contagem:*',
      `${contados.length} contado(s) · ${difs.length} com diferença`,
      ...difs.slice(0, 40).map((i) => {
        const d = cont[i.id] - i.estoque;
        return `• ${i.nome}: ${qtdBR(i.estoque)} → ${qtdBR(cont[i.id])} ${rotuloUnidade(i.unidadeDb)} (${d > 0 ? '+' : ''}${qtdBR(d)})`;
      }),
      ...(difs.length > 40 ? [`… e mais ${difs.length - 40}`] : []),
      ...(difs.length ? [`Ajuste estimado: ${brl(valor)}`] : []),
      'O estoque dos contados passa a ser o número contado. Os pulados não mudam.',
    ].join('\n'));
    setPasso('resumo');
  };

  const encerrar = () => { r.eu('Encerrar aqui'); mostrarResumo(contagens); };

  const gravar = async () => {
    r.eu('Confirmar inventário');
    setPasso('gravando');
    const itens = insumos
      .filter((i) => contagens[i.id] !== undefined)
      .map((i) => ({
        insumoId: i.id,
        insumoNome: i.nome,
        unidade: unidadeFront(i.unidadeDb),
        qtdTeorica: i.estoque,
        qtdContada: contagens[i.id],
        diferenca: parseFloat((contagens[i.id] - i.estoque).toFixed(4)),
        precoUnitario: i.preco,
      }));
    const { data, erro } = await gravarNaEdge<{ ok?: boolean; adjusted?: number; numero?: number | null; valor_ajuste_liquido?: number }>('stock-write', {
      action: 'confirm_inventory',
      tenant_id: user!.tenantId,
      items: itens,
      operator_name: user?.nome ?? 'Operador',
    });
    if (erro) {
      r.bot(`Não gravou: ${erro}\nConfira em Estoque › Inventário antes de tentar de novo.`);
    } else {
      setOk(true);
      r.bot(`Inventário${data?.numero ? ` nº ${data.numero}` : ''} confirmado: ${itens.length} contado(s), ${data?.adjusted ?? 0} ajuste(s), ${brl(Number(data?.valor_ajuste_liquido ?? 0))}.`);
    }
    setPasso('fim');
  };

  const atual = fila[pos];
  const contadosAteAgora = Object.keys(contagens).length;

  return (
    <Roteiro titulo="Contagem rápida" icone="ri-list-check-3" cor="bg-sky-50 text-sky-600"
      baloes={r.baloes} carregando={passo === 'carregando' || passo === 'gravando'}
      textoCarregando={passo === 'gravando' ? 'Gravando inventário…' : 'Carregando…'} onFechar={onFechar} travarFechar={passo === 'gravando'}>
      {passo === 'categoria' && (
        <>
          {categorias.map(([c, n]) => <Opcao key={c} onClick={() => escolherCategoria(c)} detalhe={`(${n})`}>{c}</Opcao>)}
          <OpcaoNeutra onClick={() => escolherCategoria('Todas')}>Todas ({insumos.length})</OpcaoNeutra>
        </>
      )}
      {passo === 'contando' && atual && (
        <>
          <Campo key={atual.id} placeholder={`Contado em ${rotuloUnidade(atual.unidadeDb)}`} modo="decimal" onEnviar={contar} />
          {atual.estoque >= 0 && <Opcao onClick={confere}>Confere ({qtdBR(atual.estoque)} {rotuloUnidade(atual.unidadeDb)})</Opcao>}
          <OpcaoNeutra onClick={pular}>Pular</OpcaoNeutra>
          {contadosAteAgora > 0 && <OpcaoNeutra onClick={encerrar}>Encerrar aqui ({contadosAteAgora} contado{contadosAteAgora > 1 ? 's' : ''})</OpcaoNeutra>}
        </>
      )}
      {passo === 'resumo' && (
        <>
          <Opcao onClick={gravar}>Confirmar inventário</Opcao>
          <OpcaoNeutra onClick={onFechar}>Descartar contagem</OpcaoNeutra>
        </>
      )}
      {passo === 'fim' && <Fim onFechar={onFechar} acoes={ok ? [{ label: 'Abrir Inventário', onClick: () => irPara('/estoque?tab=inventario') }] : undefined} />}
    </Roteiro>
  );
}
