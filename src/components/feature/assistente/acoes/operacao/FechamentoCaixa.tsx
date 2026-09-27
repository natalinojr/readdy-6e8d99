// Ação rápida (só leitura): relatório de fechamento de um caixa já fechado (2026-09-27).
// Escolhe entre os últimos caixas fechados da loja e mostra em PAINEL, no mesmo layout do "Caixa aberto":
// contado × esperado × diferença (os valores GRAVADOS no fechamento — cash_registers.closing_value_*,
// os mesmos que o Relatórios › Caixa mostra), abertura, dinheiro em vendas, entradas por forma,
// sangrias/suprimentos e a justificativa.
// Dinheiro em vendas / entradas por forma: mesma leitura do CaixaAberto (payments do caixa, não
// estornados; dinheiro = formas tipo 'cash' ativas). Movimentos: cash_movements do caixa.
import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { dateKeyBrasilia, todayBrasilia } from '@/lib/dateUtils';
import { Roteiro, useRoteiro, Fim, Opcao, OpcaoNeutra, brl, dataBR, horaBR, type AcaoProps } from '../kit';
import { Painel, Kpis, Barras, Linhas, Chip, type Status } from '../painel';

interface CaixaFechado {
  id: string;
  session_id: string | null;
  operator_id: string | null;
  opening_value: number | null;
  closing_value_expected: number | null;
  closing_value_actual: number | null;
  closing_difference: number | null;
  closing_notes: string | null;
  opened_at: string | null;
  closed_at: string;
}

const quando = (iso: string | null) => {
  if (!iso) return '—';
  const dia = dateKeyBrasilia(iso);
  return `${dia === todayBrasilia() ? 'hoje' : dataBR(dia)} ${horaBR(iso)}`;
};
const diffTexto = (d: number) => (Math.abs(d) < 0.01 ? 'bateu certinho' : d > 0 ? `sobrou ${brl(d)}` : `faltou ${brl(Math.abs(d))}`);
const diffStatus = (d: number): Status => (Math.abs(d) < 0.01 ? 'ok' : 'perigo');

export default function FechamentoCaixa({ onFechar, irPara }: AcaoProps) {
  const { user } = useAuth();
  const tenantId = user?.tenantId ?? '';
  const { baloes, bot, eu, painel } = useRoteiro();
  const [passo, setPasso] = useState<'carregando' | 'escolha' | 'fim'>('carregando');
  const [caixas, setCaixas] = useState<CaixaFechado[]>([]);
  const [sessoes, setSessoes] = useState<Map<string, string>>(new Map());
  const iniciou = useRef(false);

  const listar = async () => {
    setPasso('carregando');
    const { data, error } = await supabase.from('cash_registers')
      .select('id, session_id, operator_id, opening_value, closing_value_expected, closing_value_actual, closing_difference, closing_notes, opened_at, closed_at')
      .eq('tenant_id', tenantId).not('closed_at', 'is', null)
      .order('closed_at', { ascending: false }).limit(8);
    if (error) { bot(`Não consegui ler os caixas: ${error.message}`); setPasso('fim'); return; }
    const lista = (data ?? []) as CaixaFechado[];
    if (!lista.length) { bot('*Nenhum caixa fechado*\nEsta loja ainda não fechou nenhum caixa.'); setPasso('fim'); return; }
    const ids = [...new Set(lista.map((c) => c.session_id).filter((s): s is string => !!s))];
    const nums = new Map<string, string>();
    if (ids.length) {
      const { data: ss } = await supabase.from('sessions').select('id, number').in('id', ids);
      for (const s of (ss ?? []) as { id: string; number: string | number | null }[]) if (s.number != null) nums.set(s.id, String(s.number));
    }
    setSessoes(nums);
    setCaixas(lista);
    bot('Qual fechamento de caixa?');
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

  const mostrar = async (c: CaixaFechado) => {
    const sessao = c.session_id ? sessoes.get(c.session_id) : undefined;
    eu(`${sessao ? `Sessão ${sessao} · ` : ''}fechou ${quando(c.closed_at)}`);
    setPasso('carregando');
    const [movR, metR, pagR, opR] = await Promise.all([
      supabase.from('cash_movements').select('type, amount, reason, created_at').eq('cash_register_id', c.id).order('created_at', { ascending: true }),
      supabase.from('payment_methods').select('id, name, type, is_active').eq('tenant_id', tenantId),
      supabase.from('payments').select('amount, payment_method_id').eq('tenant_id', tenantId).eq('cash_register_id', c.id).eq('is_refunded', false),
      c.operator_id ? supabase.from('users').select('name').eq('id', c.operator_id).maybeSingle() : Promise.resolve({ data: null }),
    ]);
    const erro = movR.error ?? metR.error ?? pagR.error;
    if (erro) { bot(`Não consegui ler o caixa: ${erro.message}`); setPasso('fim'); return; }
    const operador = (opR.data as { name?: string } | null)?.name || '—';

    const metodos = new Map(((metR.data ?? []) as { id: string; name: string; type: string; is_active: boolean }[]).map((m) => [m.id, m]));
    const porForma = new Map<string, number>();
    let dinheiro = 0;
    for (const p of (pagR.data ?? []) as { amount: number; payment_method_id: string | null }[]) {
      const m = p.payment_method_id ? metodos.get(p.payment_method_id) : undefined;
      const nome = m?.name ?? 'Outros';
      porForma.set(nome, (porForma.get(nome) ?? 0) + (Number(p.amount) || 0));
      if (m && m.type === 'cash' && m.is_active) dinheiro += Number(p.amount) || 0;
    }
    const totalEntradas = [...porForma.values()].reduce((s, v) => s + v, 0);

    const movs = (movR.data ?? []) as { type: string; amount: number; reason: string | null; created_at: string }[];
    const sangrias = movs.filter((m) => m.type === 'out');
    const suprimentos = movs.filter((m) => m.type !== 'out');
    const somaSang = sangrias.reduce((s, m) => s + Number(m.amount), 0);
    const somaSup = suprimentos.reduce((s, m) => s + Number(m.amount), 0);
    const abertura = Number(c.opening_value ?? 0);
    // Esperado e diferença: o que ficou gravado no fechamento; sem gravação, a conta do CaixaAberto.
    const esperado = c.closing_value_expected != null ? Number(c.closing_value_expected) : abertura + dinheiro - somaSang + somaSup;
    const contado = c.closing_value_actual != null ? Number(c.closing_value_actual) : null;
    const dif = c.closing_difference != null ? Number(c.closing_difference) : contado != null ? contado - esperado : null;

    painel(
      <Painel titulo={`Fechamento de caixa${sessao ? ` · sessão ${sessao}` : ''}`}
        subtitulo={`${operador} · ${quando(c.opened_at)} → ${quando(c.closed_at)}`}
        rodape={`Esperado = abertura ${brl(abertura)} + dinheiro ${brl(dinheiro)} − sangrias ${brl(somaSang)} + suprimentos ${brl(somaSup)}`}>
        <Kpis
          principal={{
            label: 'Contado na gaveta',
            valor: contado != null ? brl(contado) : 'não informado',
            extra: dif != null ? <Chip texto={diffTexto(dif)} status={diffStatus(dif)} /> : undefined,
          }}
          outros={[
            { label: 'Esperado', valor: brl(esperado) },
            { label: 'Diferença', valor: dif != null ? brl(dif) : '—' },
            { label: 'Abertura', valor: brl(abertura) },
            { label: 'Dinheiro em vendas', valor: brl(dinheiro) },
          ]}
        />
        {porForma.size ? (
          <Barras titulo={`Entradas por forma (${brl(totalEntradas)})`}
            itens={[...porForma.entries()].sort((a, b) => b[1] - a[1]).map(([n, v]) => ({ label: n, valor: v }))} />
        ) : <p className="text-xs text-zinc-400">Nenhum pagamento neste caixa.</p>}
        <Linhas titulo={`Sangrias (${brl(somaSang)})`} vazio="Nenhuma sangria."
          itens={sangrias.map((m) => ({ label: m.reason || 'Sangria', detalhe: horaBR(m.created_at), valor: brl(Number(m.amount)), status: 'perigo' as const }))} />
        <Linhas titulo={`Suprimentos (${brl(somaSup)})`} vazio="Nenhum suprimento."
          itens={suprimentos.map((m) => ({ label: m.reason || 'Suprimento', detalhe: horaBR(m.created_at), valor: brl(Number(m.amount)), status: 'ok' as const }))} />
        {c.closing_notes && <Linhas titulo="Justificativa" itens={[{ label: c.closing_notes, status: 'alerta' }]} />}
      </Painel>,
    );
    setPasso('fim');
  };

  return (
    <Roteiro titulo="Fechamento de caixa" icone="ri-safe-line" cor="bg-orange-50 text-orange-600" baloes={baloes}
      carregando={passo === 'carregando'} textoCarregando="Lendo os caixas…" onFechar={onFechar}>
      {passo === 'escolha' && (
        <>
          {caixas.map((c) => {
            const sessao = c.session_id ? sessoes.get(c.session_id) : undefined;
            const dif = c.closing_difference != null ? Number(c.closing_difference) : null;
            return (
              <Opcao key={c.id} onClick={() => mostrar(c)} detalhe={dif != null ? `· ${diffTexto(dif)}` : undefined}>
                {sessao ? `Sessão ${sessao} · ` : ''}fechou {quando(c.closed_at)}
              </Opcao>
            );
          })}
          <OpcaoNeutra onClick={onFechar}>Fechar</OpcaoNeutra>
        </>
      )}
      {passo === 'fim' && (
        <Fim onFechar={onFechar} acoes={[
          ...(caixas.length ? [{ label: 'Outro caixa', onClick: () => { bot('Qual fechamento de caixa?'); setPasso('escolha'); } }] : []),
          { label: 'Abrir Relatórios', onClick: () => irPara('/relatorios') },
        ]} />
      )}
    </Roteiro>
  );
}
