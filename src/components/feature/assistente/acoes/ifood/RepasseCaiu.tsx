// Ação rápida (só leitura): o repasse do iFood caiu na conta? Por DIA, soma os repasses previstos
// (fin_ifood_settlements, só REPASSE — mesma regra da tela: saldos do fechamento não somam) de todas as
// lojas do iFood e compara com os créditos do iFood no extrato do Inter (fin_bank_statement_imports,
// source 'inter', crédito com "iFood" no texto ou já casado pela conciliação — match_kind ifood_deposit).
// O iFood paga um dia em várias entradas (transferência + "crédito domicílio cartão"): por isso a
// conferência é pelo total do dia, com tolerância de R$ 0,05 e até 2 dias de atraso do banco.
import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { Roteiro, useRoteiro, Fim, brl, dataBR, hojeISO, somaDias, type AcaoProps } from '../kit';
import { Painel, Kpis, Linhas, type Status } from '../painel';

const n = (v: unknown) => Number(v ?? 0);

export default function RepasseCaiu({ onFechar, irPara }: AcaoProps) {
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
      const hoje = hojeISO();
      const de = somaDias(hoje, -35);
      const [rep, ext, ult] = await Promise.all([
        supabase.from('fin_ifood_settlements').select('payment_date, amount, type')
          .eq('tenant_id', tenantId).gte('payment_date', de).lte('payment_date', somaDias(hoje, 14)),
        supabase.from('fin_bank_statement_imports').select('transaction_date, amount, description, counterpart_name, match_kind')
          .eq('tenant_id', tenantId).eq('source', 'inter').eq('transaction_type', 'credit')
          .gte('transaction_date', de).lte('transaction_date', somaDias(hoje, 2)).limit(5000),
        supabase.from('fin_bank_statement_imports').select('transaction_date')
          .eq('tenant_id', tenantId).eq('source', 'inter').order('transaction_date', { ascending: false }).limit(1),
      ]);
      if (rep.error) { bot(`Não consegui ler os repasses: ${rep.error.message}`); setCarregando(false); return; }
      const previsto = new Map<string, number>();
      for (const r of (rep.data ?? []) as Array<{ payment_date: string; amount: number; type: string | null }>) {
        if (String(r.type ?? '').toUpperCase() !== 'REPASSE' || !r.payment_date) continue;
        previsto.set(r.payment_date, (previsto.get(r.payment_date) ?? 0) + n(r.amount));
      }
      const creditos = new Map<string, number>();
      for (const e of (ext.data ?? []) as Array<{ transaction_date: string; amount: number; description: string | null; counterpart_name: string | null; match_kind: string | null }>) {
        const ehIfood = e.match_kind === 'ifood_deposit' || /ifood/i.test(`${e.description ?? ''} ${e.counterpart_name ?? ''}`);
        if (ehIfood) creditos.set(e.transaction_date, (creditos.get(e.transaction_date) ?? 0) + n(e.amount));
      }
      const ultimoExtrato = (ult.data?.[0] as { transaction_date?: string } | undefined)?.transaction_date ?? null;
      const datas = [...previsto.keys()].sort();
      const passados = datas.filter((d) => d <= hoje).reverse();
      const proximo = datas.find((d) => d > hoje) ?? null;
      if (!datas.length) { bot('Nenhum repasse do iFood nos últimos 35 dias (a API do iFood desta loja está ligada?).'); setCarregando(false); return; }

      // Casa cada dia de repasse com os créditos do iFood no mesmo dia ou até 2 dias depois.
      const usados = new Set<string>();
      const linhas = passados.map((d) => {
        const esperado = previsto.get(d) ?? 0;
        let recebido = 0; let quando: string | null = null;
        for (let k = 0; k <= 2; k++) {
          const dia = somaDias(d, k);
          if (!usados.has(dia) && creditos.has(dia)) { recebido = creditos.get(dia)!; quando = dia; usados.add(dia); break; }
        }
        let status: Status; let texto: string;
        if (!ultimoExtrato) { status = 'neutro'; texto = 'sem extrato do Inter nesta loja'; }
        else if (quando && Math.abs(recebido - esperado) <= 0.05) { status = 'ok'; texto = `caiu${quando !== d ? ` em ${dataBR(quando).slice(0, 5)}` : ''} ✓`; }
        else if (quando) { status = 'alerta'; texto = `caiu ${brl(recebido)} — diferença de ${brl(recebido - esperado)}`; }
        else if (ultimoExtrato < d) { status = 'neutro'; texto = `extrato só vai até ${dataBR(ultimoExtrato).slice(0, 5)}`; }
        else if (ultimoExtrato < somaDias(d, 2)) { status = 'neutro'; texto = 'ainda pode cair (até 2 dias)'; }
        else { status = 'perigo'; texto = 'não achei no extrato do Inter'; }
        return { d, esperado, status, texto };
      });
      const faltando = linhas.filter((l) => l.status === 'perigo');
      const ultimo = linhas[0];
      painel(
        <Painel titulo="O repasse do iFood caiu?" subtitulo={user?.loja || 'Loja ativa'}
          rodape={`Previsto = repasses da API do iFood no dia (todas as lojas do iFood). Recebido = créditos do iFood no extrato do Inter (transferência + crédito domicílio cartão), até 2 dias depois.${ultimoExtrato ? ` Extrato do Inter até ${dataBR(ultimoExtrato)}.` : ''}`}>
          <Kpis
            principal={{ label: `Último repasse · ${dataBR(ultimo.d)}`, valor: brl(ultimo.esperado), extra: <span className={`text-xs font-bold ${ultimo.status === 'ok' ? 'text-emerald-700' : ultimo.status === 'perigo' ? 'text-red-700' : 'text-zinc-600'}`}>{ultimo.texto}</span> }}
            outros={[
              { label: 'Não caíram', valor: String(faltando.length) },
              { label: 'Próximo', valor: proximo ? `${brl(previsto.get(proximo) ?? 0)}` : '—', extra: proximo ? <span className="text-[11px] text-zinc-500">{dataBR(proximo)}</span> : undefined },
            ]}
          />
          <Linhas titulo="Repasses dos últimos 35 dias" itens={linhas.map((l) => ({ label: dataBR(l.d), valor: brl(l.esperado), detalhe: l.texto, status: l.status }))} />
          {faltando.length > 0 && (
            <p className="text-xs font-semibold text-red-700 bg-red-50 rounded-xl px-3 py-2">⚠️ {faltando.length} repasse{faltando.length === 1 ? '' : 's'} sem crédito no Inter: {brl(faltando.reduce((a, l) => a + l.esperado, 0))}. Confira se foram para outra conta ou se houve antecipação.</p>
          )}
        </Painel>,
      );
      setCarregando(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Roteiro titulo="O repasse caiu?" icone="ri-bank-line" cor="bg-red-50 text-red-600" baloes={baloes}
      carregando={carregando} textoCarregando="Conferindo com o extrato…" onFechar={onFechar}>
      {!carregando && <Fim onFechar={onFechar} acoes={tenantId ? [
        { label: 'Abrir Conciliação', onClick: () => irPara('/financeiro?tab=conciliacao') },
        { label: 'Abrir iFood no Financeiro', onClick: () => irPara('/financeiro?tab=ifood') },
      ] : []} />}
    </Roteiro>
  );
}
