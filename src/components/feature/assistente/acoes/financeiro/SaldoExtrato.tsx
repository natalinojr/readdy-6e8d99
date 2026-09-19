// Ação rápida (só leitura): saldo do Banco Inter, extrato de hoje e pagamentos que ainda não viraram
// despesa — sem IA e sem gravar nada.
// Saldo: Edge inter-bank › get_config (último saldo gravado pelo sync, como o InterSyncPanel).
// Extrato: financial-write › list_statement_imports da conta do Inter (como useConciliacao).
// "Ainda não virou despesa": mesma regra do botão "Lançar" da Conciliação (podeLancarDoExtrato).
// Resposta em PAINEL (2026-09-18): saldo, extrato de hoje e pendências viram cartões; erro/"nada" seguem texto.
import { useEffect, useState } from 'react';
import { invokeWithAuth } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { podeLancarDoExtrato } from '@/pages/financeiro/components/conciliacao/LancarDoExtrato';
import type { StatementImport } from '@/hooks/useConciliacao';
import { Roteiro, useRoteiro, Fim, brl, dataBR, hojeISO, somaDias, type AcaoProps } from '../kit';
import { Painel, Kpis, Linhas } from '../painel';
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
  const { baloes, bot, painel } = useRoteiro();
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

      bot(loja);
      painel(
        <Painel titulo="Saldo no Inter" subtitulo={user?.loja || 'Loja ativa'}
          rodape={`Saldo de ${quando(cfg.last_balance_at)} · último sync ${quando(cfg.last_sync_at)}. Para buscar agora, use "Atualizar conciliação".`}>
          <Kpis
            principal={{ label: 'Saldo', valor: cfg.last_balance != null ? brl(cfg.last_balance) : '—' }}
            outros={[
              { label: 'Status', valor: cfg.is_active ? 'Ativo' : 'Inativo' },
              { label: 'Ambiente', valor: cfg.environment === 'sandbox' ? 'Sandbox' : 'Produção' },
            ]}
          />
          {(cfg.environment === 'sandbox' || !cfg.is_active || cfg.last_sync_error) && (
            <Linhas itens={[
              cfg.environment === 'sandbox' ? { label: 'Integração em SANDBOX (dados de teste)', status: 'alerta' as const } : null,
              !cfg.is_active ? { label: 'Integração desativada', status: 'perigo' as const } : null,
              cfg.last_sync_error ? { label: `Último sync falhou: ${cfg.last_sync_error}`, status: 'perigo' as const } : null,
            ].filter((x): x is { label: string; status: 'alerta' | 'perigo' } => x != null)} />
          )}
        </Painel>,
      );

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
        painel(
          <Painel titulo="Extrato de hoje" subtitulo={dataBR(hoje)} rodape={deHoje.length > 15 ? `… e mais ${deHoje.length - 15}` : undefined}>
            <Kpis
              principal={{ label: 'Entradas', valor: brl(soma(entradas)), extra: <span className="text-[11px] text-violet-700 font-semibold">{entradas.length} lançamento(s)</span> }}
              outros={[{ label: 'Saídas', valor: brl(soma(saidas)) }, { label: 'Qtd. saídas', valor: String(saidas.length) }]}
            />
            <Linhas itens={deHoje.slice(0, 15).map((s) => ({ label: nome(s), valor: `${s.transaction_type === 'credit' ? '+' : '−'} ${brl(s.amount)}`, status: s.transaction_type === 'credit' ? ('ok' as const) : ('neutro' as const) }))} />
          </Painel>,
        );
      }

      const pend = linhas.filter(podeLancarDoExtrato);
      if (!pend.length) bot(`Nenhum pagamento dos últimos ${DIAS_PENDENTES} dias esperando virar despesa. ✅`);
      else {
        painel(
          <Painel titulo="Pagamentos sem destino" subtitulo={`Últimos ${DIAS_PENDENTES} dias`} rodape="Lance pela Conciliação (botão Lançar em cada linha).">
            <Kpis principal={{ label: 'Total', valor: brl(soma(pend)) }} outros={[{ label: 'Lançamentos', valor: String(pend.length) }]} />
            <Linhas itens={pend.slice(0, 12).map((s) => ({ label: nome(s), detalhe: dataBR(s.transaction_date), valor: brl(s.amount), status: 'alerta' as const }))} />
            {pend.length > 12 && <p className="text-[11px] text-zinc-400">… e mais {pend.length - 12}</p>}
          </Painel>,
        );
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
