// Ação rápida: atualizar os extratos integrados (Inter, Stone, iFood) da loja ativa — sem IA.
// Mesmas chamadas que a Conciliação faz ao abrir (ConciliacaoTab › runBankSync sem período):
// inter-bank › sync e stone-conciliation › sync em paralelo; depois ifood-financial › sync;
// depois conciliacao-pagamentos › rematch e › alerts. Reimportar não duplica (as edges deduplicam).
import { useEffect, useRef, useState } from 'react';
import { invokeWithAuth } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { Roteiro, useRoteiro, Opcao, OpcaoNeutra, Fim, brl, type AcaoProps } from '../kit';

type SyncResp = {
  success?: boolean; not_configured?: boolean; skipped?: boolean; error?: string;
  inserted?: number; fetched?: number; matched?: number; balance?: number | null; days?: number;
};
type Resp = { data: SyncResp | null; error: Error | null };
type Alerta = { count: number; total: number };

// Mesmos rótulos dos alertas da Conciliação (ConciliacaoTab › ALERTAS_DEF)
const ALERTAS: Array<[string, string]> = [
  ['contas_vencidas', 'Contas a pagar vencidas em aberto'],
  ['notas_vencidas', 'Notas com parcela vencida sem pagamento no extrato'],
  ['duplicidades', 'Possíveis pagamentos em duplicidade'],
  ['notas_canceladas_lancadas', 'Notas canceladas na SEFAZ que foram lançadas'],
  ['notas_de_compra_do_extrato', 'Notas que podem ser de compra já lançada pelo extrato'],
  ['pagamentos_sem_nota', 'Pagamentos a empresas sem nota de entrada'],
  ['juros_mes', 'Juros e multas pagos no mês'],
];

function ler(label: string, r: Resp, extra?: (d: SyncResp) => string): string {
  const d = r.data;
  const err = d?.error ?? r.error?.message;
  if (d?.not_configured || /não configurad/i.test(String(err ?? ''))) return `${label}: não integrado nesta loja`;
  if (d?.skipped) return `${label}: integração pausada (sync automático desligado)`;
  if (err || !d?.success) return `${label}: ❌ falhou${err ? ` (${String(err).slice(0, 160)})` : ''}`;
  return `${label}: ✅ ${Number(d.inserted ?? 0)} novo(s)${extra ? extra(d) : ''}`;
}

export default function AtualizarConciliacao({ onFechar, irPara }: AcaoProps) {
  const { user } = useAuth();
  const tenantId = user?.tenantId ?? '';
  const { baloes, bot, eu } = useRoteiro();
  const [passo, setPasso] = useState<'inicio' | 'rodando' | 'fim'>('inicio');
  const travado = useRef(false);

  useEffect(() => {
    if (!tenantId) { bot('Nenhuma loja ativa.'); setPasso('fim'); return; }
    bot(`Loja: *${user?.loja || 'loja ativa'}*\nBusco os extratos do Inter, da Stone e do iFood (o mesmo que a Conciliação faz ao abrir). Pode levar até 2 minutos.`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rodar = async () => {
    if (travado.current) return;
    travado.current = true;
    eu('Atualizar agora');
    setPasso('rodando');
    const [inter, stone] = await Promise.all([
      invokeWithAuth<SyncResp>('inter-bank', { body: { action: 'sync', tenant_id: tenantId } }),
      invokeWithAuth<SyncResp>('stone-conciliation', { body: { action: 'sync', tenant_id: tenantId } }),
    ]);
    // Depois do Inter: os depósitos do iFood casam com o extrato que acabou de chegar.
    const ifood = await invokeWithAuth<SyncResp>('ifood-financial', { body: { action: 'sync', tenant_id: tenantId } });
    bot([
      '*Resultado*',
      ler('Inter', inter, (d) => `${d.matched ? ` · ${d.matched} conciliado(s)` : ''}${d.balance != null ? ` · saldo ${brl(Number(d.balance))}` : ''}`),
      ler('Stone', stone, (d) => (d.days ? ` · ${d.days} dia(s) buscado(s)` : ' · já estava em dia')),
      ler('iFood', ifood),
    ].join('\n'));

    // Sugere de novo os vínculos pagamento × nota/conta, como a tela
    await invokeWithAuth('conciliacao-pagamentos', { body: { action: 'rematch', tenant_id: tenantId } });
    const al = await invokeWithAuth<{ success?: boolean; alerts?: Record<string, Alerta | undefined> }>('conciliacao-pagamentos', { body: { action: 'alerts', tenant_id: tenantId } });
    const alerts = al.data?.alerts;
    if (alerts) {
      const ativos = ALERTAS.filter(([k]) => Number(alerts[k]?.count ?? 0) > 0);
      bot(ativos.length
        ? ['*Pendências na conciliação*', ...ativos.map(([k, rot]) => `• ${rot}: ${alerts[k]!.count} · ${brl(Number(alerts[k]!.total ?? 0))}`)].join('\n')
        : 'Nenhuma pendência de conciliação. ✅');
    }
    setPasso('fim');
  };

  return (
    <Roteiro titulo="Atualizar conciliação" icone="ri-refresh-line" cor="bg-sky-50 text-sky-600" baloes={baloes}
      carregando={passo === 'rodando'} textoCarregando="Buscando Inter, Stone e iFood…" onFechar={onFechar} travarFechar={passo === 'rodando'}>
      {passo === 'inicio' && (
        <>
          <Opcao onClick={rodar}>Atualizar agora</Opcao>
          <OpcaoNeutra onClick={onFechar}>Cancelar</OpcaoNeutra>
        </>
      )}
      {passo === 'fim' && <Fim onFechar={onFechar} acoes={tenantId ? [{ label: 'Abrir na conciliação', onClick: () => irPara('/financeiro?tab=conciliacao') }] : undefined} />}
    </Roteiro>
  );
}
