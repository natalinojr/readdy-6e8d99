// Ação rápida: caixa aberto agora (só leitura).
// Caixa/sessão: SessaoContext (RPCs fn_get_active_session + fn_get_active_cash_register, as mesmas
// do PDV Caixa). Movimentos: cash_movements do caixa (PDV caixa/page.tsx › loadMovimentacoes).
// Saldo esperado em dinheiro: MESMA fórmula do FechamentoCaixaModal —
//   abertura + Σ payments.amount em formas tipo 'cash' ativas (não estornados) − sangrias + suprimentos
// (amount já é líquido do troco). "Entradas por forma" soma payments do caixa por forma de pagamento.
// Resposta em PAINEL (2026-09-18): números em destaque, barra por forma de pagamento e listas de
// sangria/suprimento.
import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useSessao } from '@/contexts/SessaoContext';
import { dateKeyBrasilia, todayBrasilia } from '@/lib/dateUtils';
import { Roteiro, useRoteiro, Fim, brl, dataBR, horaBR, type AcaoProps } from '../kit';
import { Painel, Kpis, Barras, Linhas } from '../painel';

export default function CaixaAberto({ onFechar, irPara }: AcaoProps) {
  const { user } = useAuth();
  const { sessao, caixa, loadingSession, sincronizarSessao } = useSessao();
  const { baloes, bot, painel } = useRoteiro();
  const [passo, setPasso] = useState<'carregando' | 'fim'>('carregando');
  const iniciou = useRef(false);
  const [pronto, setPronto] = useState(false);

  useEffect(() => {
    if (iniciou.current) return;
    iniciou.current = true;
    bot(`*Loja: ${user?.loja || 'loja ativa'}*`);
    if (!user?.tenantId) { bot('Nenhuma loja ativa.'); setPasso('fim'); return; }
    (async () => {
      // relê do banco (outro PC pode ter aberto/fechado o caixa)
      await sincronizarSessao().catch(() => null);
      setPronto(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const respondeu = useRef(false);
  useEffect(() => {
    if (!pronto || loadingSession || respondeu.current || !user?.tenantId) return;
    respondeu.current = true;
    (async () => {
      if (!caixa) {
        bot(sessao
          ? `*Nenhum caixa aberto*\nA sessão ${sessao.numero} está aberta, mas sem caixa.`
          : '*Nenhum caixa aberto*\nNão há sessão nem caixa aberto nesta loja agora.');
        setPasso('fim');
        return;
      }
      const tenantId = user.tenantId;
      const [regR, movR, metR, pagR] = await Promise.all([
        supabase.from('cash_registers').select('opened_at, opening_value, operator_id').eq('id', caixa.id).maybeSingle(),
        supabase.from('cash_movements').select('type, amount, reason, created_at').eq('cash_register_id', caixa.id).order('created_at', { ascending: true }),
        supabase.from('payment_methods').select('id, name, type, is_active').eq('tenant_id', tenantId),
        supabase.from('payments').select('amount, payment_method_id').eq('tenant_id', tenantId).eq('cash_register_id', caixa.id).eq('is_refunded', false),
      ]);
      const erro = movR.error ?? metR.error ?? pagR.error;
      if (erro) { bot(`Não consegui ler o caixa: ${erro.message}`); setPasso('fim'); return; }

      const reg = regR.data as { opened_at: string | null; opening_value: number | null; operator_id: string | null } | null;
      let operador = '—';
      if (reg?.operator_id) {
        const { data: u } = await supabase.from('users').select('name').eq('id', reg.operator_id).maybeSingle();
        operador = (u as { name?: string } | null)?.name || '—';
      }

      const metodos = new Map(((metR.data ?? []) as { id: string; name: string; type: string; is_active: boolean }[]).map((m) => [m.id, m]));
      const porForma = new Map<string, number>();
      let dinheiro = 0;
      for (const p of (pagR.data ?? []) as { amount: number; payment_method_id: string | null }[]) {
        const m = p.payment_method_id ? metodos.get(p.payment_method_id) : undefined;
        const nome = m?.name ?? 'Outros';
        porForma.set(nome, (porForma.get(nome) ?? 0) + (Number(p.amount) || 0));
        if (m && m.type === 'cash' && m.is_active) dinheiro += Number(p.amount) || 0;
      }

      const movs = (movR.data ?? []) as { type: string; amount: number; reason: string | null; created_at: string }[];
      const sangrias = movs.filter((m) => m.type === 'out');
      const suprimentos = movs.filter((m) => m.type !== 'out');
      const somaSang = sangrias.reduce((s, m) => s + Number(m.amount), 0);
      const somaSup = suprimentos.reduce((s, m) => s + Number(m.amount), 0);
      const abertura = Number(reg?.opening_value ?? caixa.valorAbertura ?? 0);
      const esperado = abertura + dinheiro - somaSang + somaSup;
      const totalEntradas = [...porForma.values()].reduce((s, v) => s + v, 0);

      const abertoEm = reg?.opened_at
        ? (dateKeyBrasilia(reg.opened_at) === todayBrasilia() ? `hoje ${horaBR(reg.opened_at)}` : `${dataBR(dateKeyBrasilia(reg.opened_at))} ${horaBR(reg.opened_at)}`)
        : caixa.abertaEm;

      painel(
        <Painel titulo={`Caixa aberto${sessao ? ` · sessão ${sessao.numero}` : ''}`} subtitulo={`${operador} · abriu ${abertoEm}`}
          rodape={`Dinheiro esperado = abertura ${brl(abertura)} + dinheiro ${brl(dinheiro)} − sangrias ${brl(somaSang)} + suprimentos ${brl(somaSup)}`}>
          <Kpis
            principal={{ label: 'Dinheiro esperado na gaveta', valor: brl(esperado) }}
            outros={[{ label: 'Abertura', valor: brl(abertura) }, { label: 'Dinheiro em vendas', valor: brl(dinheiro) }]}
          />
          {porForma.size ? (
            <Barras titulo={`Entradas por forma (${brl(totalEntradas)})`}
              itens={[...porForma.entries()].sort((a, b) => b[1] - a[1]).map(([n, v]) => ({ label: n, valor: v }))} />
          ) : <p className="text-xs text-zinc-400">Nenhum pagamento ainda.</p>}
          <Linhas titulo={`Sangrias (${brl(somaSang)})`} vazio="Nenhuma."
            itens={sangrias.map((m) => ({ label: m.reason || 'Sangria', detalhe: horaBR(m.created_at), valor: brl(Number(m.amount)), status: 'perigo' as const }))} />
          <Linhas titulo={`Suprimentos (${brl(somaSup)})`} vazio="Nenhum."
            itens={suprimentos.map((m) => ({ label: m.reason || 'Suprimento', detalhe: horaBR(m.created_at), valor: brl(Number(m.amount)), status: 'ok' as const }))} />
        </Painel>,
      );
      setPasso('fim');
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pronto, loadingSession]);

  return (
    <Roteiro titulo="Caixa aberto" icone="ri-safe-2-line" cor="bg-emerald-50 text-emerald-600" baloes={baloes}
      carregando={passo === 'carregando'} textoCarregando="Lendo o caixa…" onFechar={onFechar}>
      {passo === 'fim' && <Fim onFechar={onFechar} acoes={[{ label: 'Abrir PDV Caixa', onClick: () => irPara('/pdv/caixa') }]} />}
    </Roteiro>
  );
}
