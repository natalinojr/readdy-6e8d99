// Ação rápida: registrar perda de um insumo (baixa de estoque).
// Caminho da tela: EstoqueContext.registrarPerda → stock-write add_stock_movement → fn_add_stock_movement.
// Aqui vai type 'perda' (a Edge mapeia para 'loss', que SUBTRAI desde a correção de 07-11) e motivo com
// prefixo "Perda:", para cair em Movimentações › Perda. A tela do KDS manda 'manual_out' e só vira 'loss'
// quando o motivo contém "perda" — com o prefixo o resultado no banco é o mesmo.
import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Roteiro, useRoteiro, Opcao, OpcaoNeutra, Campo, Fim, brl, lerNumero, type AcaoProps } from '../kit';
import { lerInsumos, gravarNaEdge, rotuloUnidade, qtdBR, normalizar, type InsumoLido } from './comum';

type Passo = 'carregando' | 'busca' | 'resultados' | 'quantidade' | 'motivo' | 'motivo_outro' | 'confirmar' | 'gravando' | 'fim';
const MOTIVOS = ['Vencido / estragado', 'Queimou / erro no preparo', 'Caiu / derramou', 'Contaminado', 'Outro'];

export default function RegistrarPerda({ onFechar, irPara }: AcaoProps) {
  const { user } = useAuth();
  const r = useRoteiro();
  const [passo, setPasso] = useState<Passo>('carregando');
  const [insumos, setInsumos] = useState<InsumoLido[]>([]);
  const [achados, setAchados] = useState<InsumoLido[]>([]);
  const [insumo, setInsumo] = useState<InsumoLido | null>(null);
  const [qtd, setQtd] = useState(0);
  const [motivo, setMotivo] = useState('');
  const [ok, setOk] = useState(false);

  useEffect(() => {
    (async () => {
      if (!user?.tenantId) { r.bot('Nenhuma loja ativa.'); setPasso('fim'); return; }
      const { insumos: lista, erro } = await lerInsumos(user.tenantId);
      if (erro) { r.bot(`Não consegui ler os insumos: ${erro}`); setPasso('fim'); return; }
      setInsumos(lista);
      r.bot(`*${user.loja}*\nPerda de qual insumo? Digite parte do nome.`);
      setPasso('busca');
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const buscar = (t: string) => {
    r.eu(t);
    const q = normalizar(t);
    const lista = insumos.filter((i) => normalizar(i.nome).includes(q)).slice(0, 12);
    if (!lista.length) { r.bot('Não achei. Tente outro nome.'); return; }
    if (lista.length === 1) { escolher(lista[0], true); return; }
    setAchados(lista);
    r.bot('Qual deles?');
    setPasso('resultados');
  };

  const escolher = (i: InsumoLido, automatico = false) => {
    if (!automatico) r.eu(i.nome);
    setInsumo(i);
    r.bot(`${i.nome}: estoque ${qtdBR(i.estoque)} ${rotuloUnidade(i.unidadeDb)}.\nQuantos ${rotuloUnidade(i.unidadeDb)} foram perdidos?`);
    setPasso('quantidade');
  };

  const informarQtd = (t: string) => {
    const n = lerNumero(t);
    r.eu(t);
    if (!(n > 0)) { r.bot('Quantidade inválida. Ex.: 0,5'); return; }
    setQtd(n);
    const u = rotuloUnidade(insumo!.unidadeDb);
    if (n > insumo!.estoque) r.bot(`Atenção: é mais que o estoque (${qtdBR(insumo!.estoque)} ${u}). O estoque ficará negativo.`);
    r.bot('Qual o motivo?');
    setPasso('motivo');
  };

  const definirMotivo = (m: string) => {
    r.eu(m);
    if (m === 'Outro') { r.bot('Descreva o motivo.'); setPasso('motivo_outro'); return; }
    if (m.trim().length < 3) { r.bot('Motivo muito curto.'); return; }
    setMotivo(m.trim());
    const i = insumo!;
    const u = rotuloUnidade(i.unidadeDb);
    r.bot([
      '*Confere a perda:*',
      `Loja: ${user?.loja ?? ''}`,
      `Insumo: ${i.nome}`,
      `Quantidade: ${qtdBR(qtd)} ${u}`,
      `Motivo: ${m.trim()}`,
      `Estoque: ${qtdBR(i.estoque)} → ${qtdBR(i.estoque - qtd)} ${u}`,
      ...(i.preco > 0 ? [`Valor aprox.: ${brl(qtd * i.preco)}`] : []),
    ].join('\n'));
    setPasso('confirmar');
  };

  const gravar = async () => {
    const i = insumo!;
    r.eu('Registrar perda');
    setPasso('gravando');
    const { erro } = await gravarNaEdge('stock-write', {
      action: 'add_stock_movement',
      tenant_id: user!.tenantId,
      ingredient_id: i.id,
      type: 'perda',
      quantity: qtd,
      unit: i.unidadeDb,
      reason: `Perda: ${motivo}`,
    });
    if (erro) {
      r.bot(`Não gravou: ${erro}\nConfira em Estoque › Movimentações antes de tentar de novo.`);
    } else {
      setOk(true);
      r.bot(`Perda registrada: ${qtdBR(qtd)} ${rotuloUnidade(i.unidadeDb)} de ${i.nome}.`);
    }
    setPasso('fim');
  };

  return (
    <Roteiro titulo="Registrar perda" icone="ri-delete-bin-6-line" cor="bg-red-50 text-red-600"
      baloes={r.baloes} carregando={passo === 'carregando' || passo === 'gravando'}
      textoCarregando={passo === 'gravando' ? 'Gravando…' : 'Carregando…'} onFechar={onFechar} travarFechar={passo === 'gravando'}>
      {passo === 'busca' && <Campo placeholder="Nome do insumo" onEnviar={buscar} />}
      {passo === 'resultados' && (
        <>
          {achados.map((i) => (
            <Opcao key={i.id} onClick={() => escolher(i)} detalhe={`${qtdBR(i.estoque)} ${rotuloUnidade(i.unidadeDb)}`}>{i.nome}</Opcao>
          ))}
          <Campo placeholder="Buscar outro nome" onEnviar={buscar} />
        </>
      )}
      {passo === 'quantidade' && insumo && (
        <Campo placeholder={`Quantidade em ${rotuloUnidade(insumo.unidadeDb)}, ex.: 0,5`} modo="decimal" onEnviar={informarQtd} />
      )}
      {passo === 'motivo' && MOTIVOS.map((m) => <Opcao key={m} onClick={() => definirMotivo(m)}>{m}</Opcao>)}
      {passo === 'motivo_outro' && <Campo placeholder="Motivo da perda" onEnviar={definirMotivo} />}
      {passo === 'confirmar' && (
        <>
          <Opcao perigo onClick={gravar}>Registrar perda</Opcao>
          <OpcaoNeutra onClick={onFechar}>Cancelar</OpcaoNeutra>
        </>
      )}
      {passo === 'fim' && (
        <Fim onFechar={onFechar} acoes={ok || insumo ? [{ label: 'Abrir Movimentações', onClick: () => irPara('/estoque?tab=movimentacoes') }] : undefined} />
      )}
    </Roteiro>
  );
}
