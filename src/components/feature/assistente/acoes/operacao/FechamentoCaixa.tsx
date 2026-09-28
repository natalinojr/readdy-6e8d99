// Ação rápida (só leitura): relatório de fechamento de caixa de um DIA (2026-09-27; por dia em 2026-09-28,
// pedido do dono: "em vez de mostrar as sessões, mostrar os dias").
// Escolhe o dia (os últimos dias com caixa fechado, ou outra data) e mostra em PAINEL, no mesmo layout do
// "Caixa aberto", a soma dos caixas que ABRIRAM nesse dia e já fecharam (mesmo critério do Fechamento do dia):
// contado × esperado × diferença (os valores GRAVADOS no fechamento — cash_registers.closing_value_*,
// os mesmos que o Relatórios › Caixa mostra), abertura, dinheiro em vendas, entradas por forma,
// sangrias/suprimentos, os caixas do dia um a um e as justificativas.
// Dinheiro em vendas / entradas por forma: mesma leitura do CaixaAberto (payments dos caixas, não
// estornados; dinheiro = formas tipo 'cash' ativas). Movimentos: cash_movements dos caixas.
import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { dateKeyBrasilia, todayBrasilia } from '@/lib/dateUtils';
import { Roteiro, useRoteiro, Fim, Opcao, OpcaoNeutra, Campo, brl, dataBR, horaBR, hojeISO, somaDias, type AcaoProps } from '../kit';
import { Painel, Kpis, Barras, Linhas, Chip, type Status } from '../painel';

interface CaixaFechado {
  id: string;
  operator_id: string | null;
  opening_value: number | null;
  closing_value_expected: number | null;
  closing_value_actual: number | null;
  closing_difference: number | null;
  closing_notes: string | null;
  opened_at: string;
  closed_at: string;
}
const CAMPOS = 'id, operator_id, opening_value, closing_value_expected, closing_value_actual, closing_difference, closing_notes, opened_at, closed_at';

const DIA_SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const nomeDia = (dia: string) => {
  const semana = DIA_SEMANA[new Date(`${dia}T12:00:00-03:00`).getDay()];
  const hoje = todayBrasilia();
  const rel = dia === hoje ? 'Hoje' : dia === somaDias(hoje, -1) ? 'Ontem' : null;
  return rel ? `${rel} · ${dataBR(dia)}` : `${dataBR(dia)} (${semana})`;
};
const quando = (iso: string | null, dia: string) => {
  if (!iso) return '—';
  const d = dateKeyBrasilia(iso);
  return d === dia ? horaBR(iso) : `${dataBR(d).slice(0, 5)} ${horaBR(iso)}`;
};
const diffTexto = (d: number) => (Math.abs(d) < 0.01 ? 'bateu certinho' : d > 0 ? `sobrou ${brl(d)}` : `faltou ${brl(Math.abs(d))}`);
const diffStatus = (d: number): Status => (Math.abs(d) < 0.01 ? 'ok' : 'perigo');
const difDe = (c: CaixaFechado) => (c.closing_difference != null ? Number(c.closing_difference) : null);

export default function FechamentoCaixa({ onFechar, irPara }: AcaoProps) {
  const { user } = useAuth();
  const tenantId = user?.tenantId ?? '';
  const { baloes, bot, eu, painel } = useRoteiro();
  const [passo, setPasso] = useState<'carregando' | 'escolha' | 'data' | 'fim'>('carregando');
  // Últimos dias com caixa fechado → diferença somada do dia (null = nenhum caixa com diferença gravada).
  const [dias, setDias] = useState<Array<{ dia: string; caixas: number; dif: number | null }>>([]);
  const iniciou = useRef(false);

  const listar = async () => {
    setPasso('carregando');
    const { data, error } = await supabase.from('cash_registers')
      .select('opened_at, closing_difference')
      .eq('tenant_id', tenantId).not('closed_at', 'is', null)
      .order('opened_at', { ascending: false }).limit(80);
    if (error) { bot(`Não consegui ler os caixas: ${error.message}`); setPasso('fim'); return; }
    const porDia = new Map<string, { caixas: number; dif: number | null }>();
    for (const c of (data ?? []) as { opened_at: string; closing_difference: number | null }[]) {
      const dia = dateKeyBrasilia(c.opened_at);
      if (!porDia.has(dia) && porDia.size >= 7) continue;
      const acc = porDia.get(dia) ?? { caixas: 0, dif: null };
      acc.caixas += 1;
      if (c.closing_difference != null) acc.dif = (acc.dif ?? 0) + Number(c.closing_difference);
      porDia.set(dia, acc);
    }
    setDias([...porDia.entries()].map(([dia, v]) => ({ dia, ...v })));
    bot(porDia.size ? 'Fechamento de caixa de qual dia?' : 'Nenhum caixa fechado nos últimos dias. Quer ver outra data?');
    setPasso('escolha');
  };

  useEffect(() => {
    if (iniciou.current) return;
    iniciou.current = true;
    bot(`*Loja: ${user?.loja || 'loja ativa'}*`);
    if (!tenantId) { bot('Nenhuma loja ativa.'); setPasso('fim'); return; }
    listar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const mostrar = async (dia: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dia) || dia > hojeISO()) { bot('Data inválida.'); return; }
    eu(nomeDia(dia));
    setPasso('carregando');
    const { data, error } = await supabase.from('cash_registers').select(CAMPOS)
      .eq('tenant_id', tenantId).not('closed_at', 'is', null)
      .gte('opened_at', `${dia}T00:00:00-03:00`).lte('opened_at', `${dia}T23:59:59.999-03:00`)
      .order('opened_at', { ascending: true });
    if (error) { bot(`Não consegui ler os caixas: ${error.message}`); setPasso('fim'); return; }
    const caixas = (data ?? []) as CaixaFechado[];
    if (!caixas.length) { bot(`*Fechamento de caixa · ${dataBR(dia)}*\nNenhum caixa aberto nesse dia foi fechado.`); setPasso('fim'); return; }

    const ids = caixas.map((c) => c.id);
    const operadores = [...new Set(caixas.map((c) => c.operator_id).filter((o): o is string => !!o))];
    const [movR, metR, pagR, opR] = await Promise.all([
      supabase.from('cash_movements').select('cash_register_id, type, amount, reason, created_at').in('cash_register_id', ids).order('created_at', { ascending: true }),
      supabase.from('payment_methods').select('id, name, type, is_active').eq('tenant_id', tenantId),
      supabase.from('payments').select('amount, payment_method_id, cash_register_id').eq('tenant_id', tenantId).in('cash_register_id', ids).eq('is_refunded', false),
      operadores.length ? supabase.from('users').select('id, name').in('id', operadores) : Promise.resolve({ data: [] }),
    ]);
    const erro = movR.error ?? metR.error ?? pagR.error;
    if (erro) { bot(`Não consegui ler os caixas: ${erro.message}`); setPasso('fim'); return; }
    const nomes = new Map(((opR.data ?? []) as { id: string; name: string | null }[]).map((u) => [u.id, u.name || '—']));

    const metodos = new Map(((metR.data ?? []) as { id: string; name: string; type: string; is_active: boolean }[]).map((m) => [m.id, m]));
    const porForma = new Map<string, number>();
    const dinheiroDo = new Map<string, number>();
    for (const p of (pagR.data ?? []) as { amount: number; payment_method_id: string | null; cash_register_id: string }[]) {
      const m = p.payment_method_id ? metodos.get(p.payment_method_id) : undefined;
      const nome = m?.name ?? 'Outros';
      porForma.set(nome, (porForma.get(nome) ?? 0) + (Number(p.amount) || 0));
      if (m && m.type === 'cash' && m.is_active) dinheiroDo.set(p.cash_register_id, (dinheiroDo.get(p.cash_register_id) ?? 0) + (Number(p.amount) || 0));
    }
    const totalEntradas = [...porForma.values()].reduce((s, v) => s + v, 0);
    const dinheiro = [...dinheiroDo.values()].reduce((s, v) => s + v, 0);

    const movs = (movR.data ?? []) as { cash_register_id: string; type: string; amount: number; reason: string | null; created_at: string }[];
    const sangrias = movs.filter((m) => m.type === 'out');
    const suprimentos = movs.filter((m) => m.type !== 'out');
    const somaSang = sangrias.reduce((s, m) => s + Number(m.amount), 0);
    const somaSup = suprimentos.reduce((s, m) => s + Number(m.amount), 0);
    const abertura = caixas.reduce((s, c) => s + Number(c.opening_value ?? 0), 0);
    // Esperado e diferença: o que ficou gravado em cada fechamento; sem gravação, a conta do CaixaAberto.
    const esperadoTotal = caixas.reduce((s, c) => {
      if (c.closing_value_expected != null) return s + Number(c.closing_value_expected);
      const doCaixa = movs.filter((m) => m.cash_register_id === c.id);
      const mov = doCaixa.reduce((t, m) => t + (m.type === 'out' ? -1 : 1) * Number(m.amount), 0);
      return s + Number(c.opening_value ?? 0) + (dinheiroDo.get(c.id) ?? 0) + mov;
    }, 0);
    const comContado = caixas.filter((c) => c.closing_value_actual != null);
    const contado = comContado.length ? comContado.reduce((s, c) => s + Number(c.closing_value_actual), 0) : null;
    const comDif = caixas.filter((c) => difDe(c) != null);
    const dif = comDif.length ? comDif.reduce((s, c) => s + (difDe(c) ?? 0), 0) : contado != null ? contado - esperadoTotal : null;
    const notas = caixas.filter((c) => c.closing_notes);

    painel(
      <Painel titulo={`Fechamento de caixa · ${dataBR(dia)}`}
        subtitulo={`${user?.loja || 'Loja ativa'} · ${caixas.length} caixa${caixas.length === 1 ? '' : 's'}`}
        rodape={`Esperado = abertura ${brl(abertura)} + dinheiro ${brl(dinheiro)} − sangrias ${brl(somaSang)} + suprimentos ${brl(somaSup)}`}>
        <Kpis
          principal={{
            label: 'Contado na gaveta',
            valor: contado != null ? brl(contado) : 'não informado',
            extra: dif != null ? <Chip texto={diffTexto(dif)} status={diffStatus(dif)} /> : undefined,
          }}
          outros={[
            { label: 'Esperado', valor: brl(esperadoTotal) },
            { label: 'Diferença', valor: dif != null ? brl(dif) : '—' },
            { label: 'Abertura', valor: brl(abertura) },
            { label: 'Dinheiro em vendas', valor: brl(dinheiro) },
          ]}
        />
        {porForma.size ? (
          <Barras titulo={`Entradas por forma (${brl(totalEntradas)})`}
            itens={[...porForma.entries()].sort((a, b) => b[1] - a[1]).map(([n, v]) => ({ label: n, valor: v }))} />
        ) : <p className="text-xs text-zinc-400">Nenhum pagamento nos caixas do dia.</p>}
        {caixas.length > 1 && (
          <Linhas titulo="Caixas do dia"
            itens={caixas.map((c) => {
              const d = difDe(c);
              return {
                label: `${c.operator_id ? nomes.get(c.operator_id) ?? '—' : '—'} · ${quando(c.opened_at, dia)} → ${quando(c.closed_at, dia)}`,
                detalhe: d != null ? diffTexto(d) : undefined,
                valor: c.closing_value_actual != null ? brl(Number(c.closing_value_actual)) : '—',
                status: d != null ? diffStatus(d) : 'neutro' as const,
              };
            })} />
        )}
        {caixas.length === 1 && (
          <p className="text-xs text-zinc-500">
            {caixas[0].operator_id ? nomes.get(caixas[0].operator_id) ?? '—' : '—'} · abriu {quando(caixas[0].opened_at, dia)} · fechou {quando(caixas[0].closed_at, dia)}
          </p>
        )}
        <Linhas titulo={`Sangrias (${brl(somaSang)})`} vazio="Nenhuma sangria."
          itens={sangrias.map((m) => ({ label: m.reason || 'Sangria', detalhe: quando(m.created_at, dia), valor: brl(Number(m.amount)), status: 'perigo' as const }))} />
        <Linhas titulo={`Suprimentos (${brl(somaSup)})`} vazio="Nenhum suprimento."
          itens={suprimentos.map((m) => ({ label: m.reason || 'Suprimento', detalhe: quando(m.created_at, dia), valor: brl(Number(m.amount)), status: 'ok' as const }))} />
        {notas.length > 0 && (
          <Linhas titulo="Justificativa" itens={notas.map((c) => ({
            label: c.closing_notes as string,
            detalhe: caixas.length > 1 ? `${c.operator_id ? nomes.get(c.operator_id) ?? '—' : '—'} · fechou ${quando(c.closed_at, dia)}` : undefined,
            status: 'alerta' as const,
          }))} />
        )}
      </Painel>,
    );
    setPasso('fim');
  };

  return (
    <Roteiro titulo="Fechamento de caixa" icone="ri-safe-line" cor="bg-orange-50 text-orange-600" baloes={baloes}
      carregando={passo === 'carregando'} textoCarregando="Lendo os caixas…" onFechar={onFechar}>
      {passo === 'escolha' && (
        <>
          {dias.map((d) => (
            <Opcao key={d.dia} onClick={() => mostrar(d.dia)}
              detalhe={`· ${d.caixas} caixa${d.caixas === 1 ? '' : 's'}${d.dif != null ? ` · ${diffTexto(d.dif)}` : ''}`}>
              {nomeDia(d.dia)}
            </Opcao>
          ))}
          <Opcao onClick={() => setPasso('data')}>Outra data</Opcao>
          <OpcaoNeutra onClick={onFechar}>Fechar</OpcaoNeutra>
        </>
      )}
      {passo === 'data' && <Campo placeholder="Data" tipo="date" max={hojeISO()} onEnviar={mostrar} />}
      {passo === 'fim' && (
        <Fim onFechar={onFechar} acoes={[
          ...(tenantId ? [{ label: 'Outro dia', onClick: () => { bot('Fechamento de caixa de qual dia?'); setPasso('escolha'); } }] : []),
          { label: 'Abrir Relatórios', onClick: () => irPara('/relatorios') },
        ]} />
      )}
    </Roteiro>
  );
}
