// Ação rápida (só leitura): repasses do iFood — quanto e quando cai na conta.
// Fonte: fin_ifood_settlements e fin_ifood_anticipations (APIs do iFood, busca diária), mesmas regras da
// tela Financeiro › iFood › Repasses (IfoodApiViews): só REPASSE e BOLETO movimentam dinheiro; os
// "saldo positivo/negativo" são a composição do fechamento e NÃO somam (somar inflava o total).
import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { Roteiro, useRoteiro, Fim, brl, dataBR, hojeISO, somaDias, type AcaoProps } from '../kit';
import { Painel, Kpis, Linhas } from '../painel';
import { lojasIfood } from './comum';

interface Liquidacao { merchant_id: string; type: string | null; amount: number | null; status: string | null; payment_date: string | null; calc_begin: string | null; calc_end: string | null }
interface Antecipacao { original_amount: number | null; fee_amount: number | null; anticipated_amount: number | null; original_date: string | null; anticipated_date: string | null }

const n = (v: unknown) => Number(v ?? 0);
const tipo = (t: unknown) => String(t ?? '').toUpperCase();

export default function RepassesIfood({ onFechar, irPara }: AcaoProps) {
  const { user } = useAuth();
  const tenantId = user?.tenantId ?? '';
  const { baloes, bot, painel } = useRoteiro();
  const [carregando, setCarregando] = useState(true);
  const iniciou = useRef(false);

  useEffect(() => {
    if (iniciou.current) return;
    iniciou.current = true;
    (async () => {
      if (!tenantId) { bot('Nenhuma loja ativa.'); setCarregando(false); return; }
      const nomes = await lojasIfood(tenantId);
      if (!Object.keys(nomes).length) { bot('Esta loja não tem iFood ligado.'); setCarregando(false); return; }
      const hoje = hojeISO();
      const inicioMes = `${hoje.slice(0, 7)}-01`;
      const [liq, ant] = await Promise.all([
        supabase.from('fin_ifood_settlements').select('merchant_id, type, amount, status, payment_date, calc_begin, calc_end')
          .eq('tenant_id', tenantId).gte('payment_date', somaDias(hoje, -35)).lte('payment_date', somaDias(hoje, 35)).order('payment_date'),
        supabase.from('fin_ifood_anticipations').select('original_amount, fee_amount, anticipated_amount, original_date, anticipated_date')
          .eq('tenant_id', tenantId).gte('anticipated_date', inicioMes).lte('anticipated_date', hoje),
      ]);
      if (liq.error) { bot(`Não consegui ler os repasses: ${liq.error.message}`); setCarregando(false); return; }
      const linhas = ((liq.data ?? []) as Liquidacao[]).filter((l) => ['REPASSE', 'BOLETO'].includes(tipo(l.type)));
      const variasLojas = new Set(linhas.map((l) => l.merchant_id)).size > 1;
      const loja = (id: string) => (variasLojas ? ` · ${nomes[id] ?? `Loja ${id.slice(0, 8)}`}` : '');
      // O iFood paga o repasse de um dia em VÁRIAS linhas (uma por período de vendas apurado): junta por
      // data + loja + tipo, senão o "próximo repasse" mostrava só um pedaço do dia.
      type Grupo = { data: string; merchant: string; tipo: string; valor: number; de: string | null; ate: string | null; falhou: boolean };
      const agrupar = (ls: Liquidacao[]) => {
        const m = new Map<string, Grupo>();
        for (const l of ls) {
          const k = `${l.payment_date}|${l.merchant_id}|${tipo(l.type)}`;
          const g = m.get(k) ?? { data: l.payment_date ?? '', merchant: l.merchant_id, tipo: tipo(l.type), valor: 0, de: null, ate: null, falhou: false };
          g.valor += n(l.amount);
          if (l.calc_begin && (!g.de || l.calc_begin < g.de)) g.de = l.calc_begin;
          if (l.calc_end && (!g.ate || l.calc_end > g.ate)) g.ate = l.calc_end;
          if (/FAIL/i.test(String(l.status))) g.falhou = true;
          m.set(k, g);
        }
        return [...m.values()].sort((a, b) => a.data.localeCompare(b.data) || a.merchant.localeCompare(b.merchant));
      };
      const futuros = agrupar(linhas.filter((l) => (l.payment_date ?? '') >= hoje));
      const pagos = agrupar(linhas.filter((l) => (l.payment_date ?? '') < hoje)).reverse();
      const aReceber = futuros.filter((g) => g.tipo === 'REPASSE').reduce((a, g) => a + g.valor, 0);
      const boletos = futuros.filter((g) => g.tipo === 'BOLETO');
      const dataProximo = futuros.find((g) => g.tipo === 'REPASSE')?.data ?? null;
      const doProximo = futuros.filter((g) => g.tipo === 'REPASSE' && g.data === dataProximo);
      const valorProximo = doProximo.reduce((a, g) => a + g.valor, 0);
      const pagoMes = pagos.filter((g) => g.tipo === 'REPASSE' && g.data >= inicioMes).reduce((a, g) => a + g.valor, 0);
      const antecip = (ant.data ?? []) as Antecipacao[];
      const taxaAntecip = antecip.reduce((a, x) => a + n(x.fee_amount), 0);
      const periodo = (g: Grupo) => (g.de && g.ate ? `vendas de ${dataBR(g.de).slice(0, 5)} a ${dataBR(g.ate).slice(0, 5)}` : undefined);

      painel(
        <Painel titulo="Repasses do iFood" subtitulo={user?.loja || 'Loja ativa'}
          rodape="Da API do iFood (busca todo dia às 07h20). Só repasses e boletos movimentam dinheiro; os saldos do fechamento não somam.">
          <Kpis
            principal={{ label: 'Próximo repasse', valor: dataProximo ? brl(valorProximo) : '—', extra: dataProximo ? <span className="text-xs text-zinc-500">{dataBR(dataProximo)}{dataProximo === hoje ? ' (hoje)' : ''}{doProximo.length > 1 ? ` · ${doProximo.length} lojas do iFood` : ''}</span> : undefined }}
            outros={[
              { label: 'A receber (35 dias)', valor: brl(aReceber) },
              { label: 'Recebido no mês', valor: brl(pagoMes) },
            ]}
          />
          <Linhas titulo="Próximos" vazio="Nenhum repasse previsto ainda."
            itens={futuros.slice(0, 8).map((g) => ({
              label: `${dataBR(g.data)}${g.tipo === 'BOLETO' ? ' · boleto (loja paga ao iFood)' : ''}${loja(g.merchant)}`,
              valor: brl(g.valor), detalhe: periodo(g), status: g.tipo === 'BOLETO' ? 'perigo' : 'neutro',
            }))} />
          <Linhas titulo="Últimos recebidos"
            itens={pagos.slice(0, 6).map((g) => ({
              label: `${dataBR(g.data)}${g.tipo === 'BOLETO' ? ' · boleto' : ''}${loja(g.merchant)}`,
              valor: brl(g.valor), detalhe: periodo(g), status: g.falhou ? 'perigo' : 'ok',
            }))} />
          {antecip.length > 0 && (
            <Linhas titulo="Antecipações no mês" itens={[
              { label: `${antecip.length} antecipaç${antecip.length === 1 ? 'ão' : 'ões'} · recebido ${brl(antecip.reduce((a, x) => a + n(x.anticipated_amount), 0))}`, valor: brl(taxaAntecip), detalhe: 'taxa paga para receber antes — no prazo normal (D+30) entraria inteiro', status: 'alerta' },
            ]} />
          )}
          {boletos.length > 0 && (
            <p className="text-xs font-semibold text-red-700 bg-red-50 rounded-xl px-3 py-2">⚠️ {boletos.length} boleto(s) do iFood a pagar: {brl(boletos.reduce((a, g) => a + g.valor, 0))}</p>
          )}
        </Painel>,
      );
      setCarregando(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Roteiro titulo="Repasses do iFood" icone="ri-bank-card-line" cor="bg-red-50 text-red-600" baloes={baloes}
      carregando={carregando} textoCarregando="Lendo os repasses…" onFechar={onFechar}>
      {!carregando && <Fim onFechar={onFechar} acoes={tenantId ? [{ label: 'Abrir iFood no Financeiro', onClick: () => irPara('/financeiro?tab=ifood') }] : []} />}
    </Roteiro>
  );
}
