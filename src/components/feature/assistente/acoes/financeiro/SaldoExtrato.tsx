// Ação rápida (só leitura): saldo do Banco Inter, extrato de hoje e pagamentos que ainda não viraram
// despesa — sem IA e sem gravar nada.
// Saldo: Edge inter-bank › get_config (último saldo gravado pelo sync, como o InterSyncPanel).
// Extrato: financial-write › list_statement_imports da conta do Inter (como useConciliacao).
// "Ainda não virou despesa": mesma regra do botão "Lançar" da Conciliação (podeLancarDoExtrato).
import { useEffect, useState } from 'react';
import { invokeWithAuth } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { podeLancarDoExtrato } from '@/pages/financeiro/components/conciliacao/LancarDoExtrato';
import type { StatementImport } from '@/hooks/useConciliacao';
import { Roteiro, useRoteiro, Fim, brl, dataBR, hojeISO, somaDias, type AcaoProps } from '../kit';
import { finWrite } from './comum';

interface InterCfg {
  bank_account_id: string | null; is_active: boolean; environment: string;
  last_sync_at: string | null; last_sync_error: string | null; last_balance: number | null; last_balance_at: string | null;
}
const DIAS_PENDENTES = 30;
const quando = (iso: string | null) => (iso ? new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');
const nome = (s: StatementImport) => (s.counterpart_name || s.description || 'Lançamento').slice(0, 60);

export default function SaldoExtrato({ onFechar, irPara }: AcaoProps) {
  const { user } = useAuth();
  const tenantId = user?.tenantId ?? '';
  const { baloes, bot } = useRoteiro();
  const [carregando, setCarregando] = useState(true);
  const [temConfig, setTemConfig] = useState(false);

  useEffect(() => {
    if (!tenantId) { bot('Nenhuma loja ativa.'); setCarregando(false); return; }
    (async () => {
      const loja = `Loja: *${user?.loja || 'loja ativa'}*`;
      const cfgResp = await invokeWithAuth<{ config?: InterCfg | null; error?: string }>('inter-bank', { body: { action: 'get_config', tenant_id: tenantId } });
      const errCfg = cfgResp.error?.message ?? cfgResp.data?.error;
      if (errCfg) { bot(`${loja}\nNão consegui consultar o Inter: ${errCfg}`); setCarregando(false); return; }
      const cfg = cfgResp.data?.config ?? null;
      if (!cfg || !cfg.bank_account_id) { bot(`${loja}\nO Banco Inter não está conectado nesta loja.`); setCarregando(false); return; }
      setTemConfig(true);

      bot([
        loja,
        `*Saldo no Inter: ${cfg.last_balance != null ? brl(cfg.last_balance) : '—'}*`,
        `Saldo de ${quando(cfg.last_balance_at)} · último sync ${quando(cfg.last_sync_at)}`,
        cfg.environment === 'sandbox' ? '⚠️ Integração em SANDBOX (dados de teste).' : '',
        !cfg.is_active ? '⚠️ Integração desativada.' : '',
        cfg.last_sync_error ? `⚠️ Último sync falhou: ${cfg.last_sync_error}` : '',
        'Para buscar agora, use a ação "Atualizar conciliação".',
      ].filter(Boolean).join('\n'));

      const hoje = hojeISO();
      const r = await finWrite<StatementImport[]>('list_statement_imports', tenantId, {
        bank_account_id: cfg.bank_account_id, date_from: somaDias(hoje, -DIAS_PENDENTES), date_to: hoje,
      });
      if (r.error) { bot(`Não consegui ler o extrato: ${r.error}`); setCarregando(false); return; }
      const linhas = r.data ?? [];

      const deHoje = linhas.filter((s) => s.transaction_date === hoje && s.status !== 'ignored');
      const entradas = deHoje.filter((s) => s.transaction_type === 'credit');
      const saidas = deHoje.filter((s) => s.transaction_type === 'debit');
      const soma = (l: StatementImport[]) => l.reduce((t, s) => t + Number(s.amount ?? 0), 0);
      if (!deHoje.length) bot(`*Extrato de hoje (${dataBR(hoje)})*\nNenhum lançamento importado ainda.`);
      else {
        const mostrar = deHoje.slice(0, 15).map((s) => `${s.transaction_type === 'credit' ? '+' : '−'} ${brl(s.amount)} · ${nome(s)}`);
        bot([
          `*Extrato de hoje (${dataBR(hoje)})*`,
          `Entradas: ${entradas.length} · ${brl(soma(entradas))}`,
          `Saídas: ${saidas.length} · ${brl(soma(saidas))}`,
          '',
          ...mostrar,
          deHoje.length > 15 ? `… e mais ${deHoje.length - 15}` : '',
        ].filter((l, i, a) => l !== '' || a[i - 1] !== '').join('\n'));
      }

      const pend = linhas.filter(podeLancarDoExtrato);
      if (!pend.length) bot(`Nenhum pagamento dos últimos ${DIAS_PENDENTES} dias esperando virar despesa. ✅`);
      else {
        bot([
          `*Pagamentos sem destino (últimos ${DIAS_PENDENTES} dias)*`,
          `${pend.length} · ${brl(soma(pend))} — ainda não viraram despesa/compra nem têm vínculo.`,
          '',
          ...pend.slice(0, 12).map((s) => `${dataBR(s.transaction_date).slice(0, 5)} · ${brl(s.amount)} · ${nome(s)}`),
          pend.length > 12 ? `… e mais ${pend.length - 12}` : '',
          'Lance pela Conciliação (botão Lançar em cada linha).',
        ].filter((l, i, a) => l !== '' || a[i - 1] !== '').join('\n'));
      }
      setCarregando(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Roteiro titulo="Saldo e extrato (Inter)" icone="ri-bank-line" cor="bg-orange-50 text-orange-600" baloes={baloes}
      carregando={carregando} textoCarregando="Consultando…" onFechar={onFechar}>
      {!carregando && <Fim onFechar={onFechar} acoes={temConfig ? [{ label: 'Abrir na conciliação', onClick: () => irPara('/financeiro?tab=conciliacao') }] : undefined} />}
    </Roteiro>
  );
}
