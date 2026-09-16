// Ação rápida: aprovações pendentes (descontos, cancelamentos, problemas de item) — sem IA.
// Mesmo caminho da tela Aprovações: AprovacoesContext (aprovar/rejeitar com o nome de quem decide).
// ATENÇÃO: esse contexto é EM MEMÓRIA, do aparelho/aba — só aparecem pedidos feitos neste mesmo
// app aberto (igual à tela). Pedido feito no caixa de outro aparelho não chega aqui.
import { useEffect, useState } from 'react';
import { useAprovacoes, type SolicitacaoAprovacao } from '@/contexts/AprovacoesContext';
import { useAuth } from '@/contexts/AuthContext';
import { Roteiro, useRoteiro, Opcao, OpcaoNeutra, Fim, brl, type AcaoProps } from '../kit';

type Passo = 'lista' | 'detalhe' | 'confirmar' | 'feito';

const TIPO: Record<SolicitacaoAprovacao['tipo'], string> = { desconto: 'Desconto', cancelamento: 'Cancelamento', problema_item: 'Problema' };
const PROBLEMA: Record<string, string> = {
  qualidade: 'Qualidade', item_errado: 'Item errado', nao_chegou: 'Não chegou', quantidade: 'Quantidade errada', alergia: 'Alergia/Restrição', outro: 'Outro',
};
const RESOLUCAO: Record<string, string> = { substituicao: 'Substituição', reembolso: 'Reembolso', desconto: 'Desconto', registro: 'Registro apenas' };

const rotulo = (s: SolicitacaoAprovacao) =>
  `${s.urgente ? '🔴 ' : ''}${TIPO[s.tipo] ?? s.tipo} · ${s.mesaNome}${s.tipo === 'desconto' && s.valorDesconto !== undefined ? ` · ${brl(s.valorDesconto)}` : ` · ${s.itemNome}`}`;

function detalhe(s: SolicitacaoAprovacao) {
  const l = [`*${TIPO[s.tipo] ?? s.tipo}${s.urgente ? ' (URGENTE)' : ''}*`, `${s.mesaNome} · pedido por ${s.garcomNome} às ${s.criadoEm}`];
  if (s.tipo === 'desconto') {
    if (s.valorDesconto !== undefined) l.push(`Desconto: ${brl(s.valorDesconto)}`);
    if (s.totalPedido !== undefined) l.push(`Pedido: ${brl(s.totalPedido)}${s.valorDesconto !== undefined ? ` → ${brl(s.totalPedido - s.valorDesconto)}` : ''}`);
  } else {
    l.push(`Item: ${s.itemNome}`);
    if (s.tipoProblema) l.push(`Problema: ${PROBLEMA[s.tipoProblema] ?? s.tipoProblema}`);
    if (s.resolucaoDesejada) l.push(`Pede: ${RESOLUCAO[s.resolucaoDesejada] ?? s.resolucaoDesejada}`);
  }
  if (s.descricao) l.push(`"${s.descricao}"`);
  if (s.itensPedido?.length) l.push('Itens:', ...s.itensPedido.map((i) => `• ${i.quantidade}x ${i.nome} ${brl(i.precoTotal)}`));
  return l.join('\n');
}

export default function AprovacoesPendentes({ onFechar, irPara }: AcaoProps) {
  const { solicitacoes, aprovar, rejeitar } = useAprovacoes();
  const { user } = useAuth();
  const operador = user?.nome ?? 'Gerente';
  const pendentes = solicitacoes.filter((s) => s.status === 'pendente');
  const { baloes, bot, eu } = useRoteiro();
  const [passo, setPasso] = useState<Passo>('lista');
  const [selId, setSelId] = useState<string | null>(null);
  const [decisao, setDecisao] = useState<'aprovar' | 'rejeitar'>('aprovar');

  useEffect(() => {
    bot(pendentes.length
      ? `${pendentes.length} pendente(s). Toque numa para ver.\n(Só aparecem pedidos feitos neste aparelho, como na tela Aprovações.)`
      : 'Nenhuma aprovação pendente neste aparelho.\n(Pedidos feitos em outro aparelho não aparecem aqui.)');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sel = solicitacoes.find((s) => s.id === selId) ?? null;

  const abrir = (s: SolicitacaoAprovacao) => {
    setSelId(s.id);
    eu(rotulo(s));
    bot(detalhe(s));
    setPasso('detalhe');
  };

  const pedir = (d: 'aprovar' | 'rejeitar') => {
    setDecisao(d);
    eu(d === 'aprovar' ? 'Aprovar' : 'Recusar');
    bot(d === 'aprovar'
      ? `${sel!.tipo === 'desconto' ? 'Autorizar' : 'Aprovar'} em nome de ${operador}?`
      : `Recusar em nome de ${operador}?`);
    setPasso('confirmar');
  };

  const confirmar = () => {
    const s = sel;
    if (!s || s.status !== 'pendente') {
      bot('Essa solicitação já foi resolvida.');
      setSelId(null); setPasso('lista');
      return;
    }
    if (decisao === 'aprovar') aprovar(s.id, operador); else rejeitar(s.id, operador);
    bot(decisao === 'aprovar' ? `✅ Aprovado por ${operador}.` : `✅ Recusado por ${operador}.`);
    setSelId(null);
    setPasso('feito');
  };

  return (
    <Roteiro titulo="Aprovações pendentes" icone="ri-shield-keyhole-line" cor="bg-amber-50 text-amber-600" baloes={baloes} onFechar={onFechar}>
      {(passo === 'lista' || passo === 'feito') && (
        <>
          {pendentes.map((s) => <Opcao key={s.id} onClick={() => abrir(s)}>{rotulo(s)}</Opcao>)}
          {passo === 'feito' && !pendentes.length && <p className="px-1 text-xs text-zinc-400">Não há mais pendências.</p>}
          <Fim onFechar={onFechar} acoes={[{ label: 'Abrir Aprovações', onClick: () => irPara('/aprovacoes') }]} />
        </>
      )}
      {passo === 'detalhe' && sel && (
        <>
          {sel.status === 'pendente' ? (
            <>
              <Opcao onClick={() => pedir('aprovar')}>{sel.tipo === 'desconto' ? 'Autorizar' : 'Aprovar'}</Opcao>
              <Opcao perigo onClick={() => pedir('rejeitar')}>{sel.tipo === 'desconto' ? 'Negar' : 'Recusar'}</Opcao>
            </>
          ) : <p className="px-1 text-xs text-zinc-400">Já resolvida por {sel.resolvidoPor}.</p>}
          <OpcaoNeutra onClick={() => { setSelId(null); setPasso('lista'); }}>Voltar à lista</OpcaoNeutra>
        </>
      )}
      {passo === 'confirmar' && sel && (
        <>
          <Opcao perigo={decisao === 'rejeitar'} onClick={confirmar}>{decisao === 'aprovar' ? 'Sim, aprovar' : 'Sim, recusar'}</Opcao>
          <OpcaoNeutra onClick={() => { bot('Ok, nada foi feito.'); setPasso('detalhe'); }}>Não</OpcaoNeutra>
        </>
      )}
    </Roteiro>
  );
}
