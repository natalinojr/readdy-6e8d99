// Ação rápida (só leitura): CMV do mês e % sobre a receita — a MESMA conta da DRE em regime de caixa
// (DRETab › dreCaixaDoPeriodo): CMV = compras realizadas (pagas no mês), com o split por item
// (item de categoria de despesa vai para a despesa; o resto é CMV); receita = recebidos pelas fontes da
// loja. Compara com o mês anterior inteiro e, no mês corrente, com o anterior até o mesmo dia.
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { dreCaixaDoPeriodo } from '@/pages/financeiro/components/DRETab';
import { Roteiro, useRoteiro, Opcao, Fim, brl, hojeISO, type AcaoProps } from '../kit';
import { Painel, Kpis, Barras, Chip } from '../painel';

const mesAnterior = (m: string) => { const [y, mm] = m.split('-').map(Number); return mm === 1 ? `${y - 1}-12` : `${y}-${String(mm - 1).padStart(2, '0')}`; };
const fimDoMes = (m: string) => { const [y, mm] = m.split('-').map(Number); return `${m}-${String(new Date(Date.UTC(y, mm, 0)).getUTCDate()).padStart(2, '0')}`; };
const nomeMes = (m: string) => new Date(`${m}-15T12:00:00Z`).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
const pct = (a: number, b: number) => (b > 0 ? `${(Math.round((a / b) * 1000) / 10).toLocaleString('pt-BR')}%` : '—');

export default function CmvMes({ onFechar, irPara }: AcaoProps) {
  const { user } = useAuth();
  const tenantId = user?.tenantId ?? '';
  const { baloes, bot, eu, painel } = useRoteiro();
  const [passo, setPasso] = useState<'mes' | 'carregando' | 'fim'>('mes');
  const iniciou = useRef(false);
  const atual = hojeISO().slice(0, 7);

  useEffect(() => {
    if (iniciou.current) return;
    iniciou.current = true;
    bot(tenantId ? `*Loja: ${user?.loja || 'loja ativa'}*\nCMV de qual mês?` : 'Nenhuma loja ativa.');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const carregar = async (mes: string) => {
    eu(nomeMes(mes));
    setPasso('carregando');
    const ant = mesAnterior(mes);
    const emAndamento = mes === atual;
    // Mês corrente: o anterior até o mesmo dia é a comparação justa (o mês ainda não fechou).
    const diaHoje = Number(hojeISO().slice(8, 10));
    const fimAntParcial = `${ant}-${String(Math.min(diaHoje, Number(fimDoMes(ant).slice(8, 10)))).padStart(2, '0')}`;
    try {
      const [r, a] = await Promise.all([
        dreCaixaDoPeriodo(tenantId, `${mes}-01`, emAndamento ? hojeISO() : fimDoMes(mes), user?.tenantKind),
        dreCaixaDoPeriodo(tenantId, `${ant}-01`, emAndamento ? fimAntParcial : fimDoMes(ant), user?.tenantKind),
      ]);
      if (!r.receita && !r.cmv) { bot(`Sem receita nem compras em ${nomeMes(mes)}.`); setPasso('fim'); return; }
      const cats = Object.entries(r.dados.cmvPorCategoria ?? {}).filter(([, v]) => v > 0).sort((x, y) => y[1] - x[1]);
      const pAtual = r.receita > 0 ? r.cmv / r.receita : null;
      const pAnt = a.receita > 0 ? a.cmv / a.receita : null;
      const dif = pAtual != null && pAnt != null ? Math.round((pAtual - pAnt) * 1000) / 10 : null;
      painel(
        <Painel titulo={`CMV · ${nomeMes(mes)}`} subtitulo={user?.loja || 'Loja ativa'}
          rodape={`Mesma conta da DRE (regime de caixa): CMV = compras pagas no mês; receita = recebidos pelas fontes da loja.${emAndamento ? ` Mês em andamento: comparado com ${nomeMes(ant)} até o dia ${diaHoje}.` : ''} Compra é pontual — um mês com estoque grande comprado sobe o CMV e o seguinte cai.`}>
          <Kpis
            principal={{ label: 'CMV sobre a receita', valor: pct(r.cmv, r.receita), extra: dif != null ? <Chip texto={`${dif > 0 ? '+' : ''}${dif.toLocaleString('pt-BR')} p.p. vs ${emAndamento ? 'mesmo período do mês passado' : 'mês anterior'} (${pct(a.cmv, a.receita)})`} status={dif > 0 ? 'perigo' : 'ok'} /> : undefined }}
            outros={[{ label: 'CMV (compras)', valor: brl(r.cmv) }, { label: 'Receita', valor: brl(r.receita) }]}
          />
          {r.dados.cmvComprasPendentes > 0 && (
            <p className="text-xs font-semibold text-amber-700 bg-amber-50 rounded-xl px-3 py-2">⚠️ Compras do mês ainda não pagas: {brl(r.dados.cmvComprasPendentes)} (entram no CMV quando forem pagas).</p>
          )}
          {cats.length > 0 && <Barras titulo="CMV por categoria" cor="bg-amber-500" itens={cats.map(([label, valor]) => ({ label, valor, detalhe: `${pct(valor, r.receita)} da receita` }))} />}
        </Painel>,
      );
    } catch (e) {
      bot(`Não consegui calcular: ${e instanceof Error ? e.message : String(e)}`);
    }
    setPasso('fim');
  };

  return (
    <Roteiro titulo="CMV do mês" icone="ri-pie-chart-2-line" cor="bg-emerald-50 text-emerald-600" baloes={baloes}
      carregando={passo === 'carregando'} textoCarregando="Somando compras e receita…" onFechar={onFechar}>
      {passo === 'mes' && tenantId && (
        <>
          <Opcao onClick={() => carregar(atual)} detalhe="(até hoje)">Este mês</Opcao>
          <Opcao onClick={() => carregar(mesAnterior(atual))}>Mês passado</Opcao>
        </>
      )}
      {(passo === 'fim' || !tenantId) && (
        <Fim onFechar={onFechar} acoes={tenantId ? [
          { label: 'Outro mês', onClick: () => { bot('Qual mês?'); setPasso('mes'); } },
          { label: 'Abrir DRE', onClick: () => irPara('/financeiro?tab=dre') },
        ] : []} />
      )}
    </Roteiro>
  );
}
