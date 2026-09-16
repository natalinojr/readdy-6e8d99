// Ação rápida: resumo do Tráfego Pago (Meta Ads) — SÓ LEITURA, sem IA.
// Mesma Edge da tela Tráfego Pago: meta-ads-insights {tenant_id, date_preset} (hoje e últimos 7 dias).
// Pausar campanha não entra: a tela não pausa direto (só o agente, com aprovação).
import { useEffect, useState } from 'react';
import { invokeWithAuth } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { Roteiro, useRoteiro, Fim, brl, type AcaoProps } from '../kit';

interface ActionVal { type: string; value: number }
interface Linha {
  spend: number; results?: ActionVal[]; result?: ActionVal;
  purchases?: number; purchase_value?: number; status?: string | null;
  campaign?: string; cost_per?: ActionVal[];
}
interface Resp {
  ok: boolean; not_connected?: boolean; no_account?: boolean; ad_account_name?: string;
  totals?: Linha | null; campaigns?: (Linha & { campaign: string })[]; error?: unknown;
}

const CONVERSA = 'onsite_conversion.messaging_conversation_started_7d';
const ROTULO: Record<string, string> = {
  purchase: 'compras', link_click: 'cliques no link', landing_page_view: 'visitas à página', lead: 'leads',
  [CONVERSA]: 'conversas', post_engagement: 'engajamentos', video_view: 'visualizações', reach: 'alcance',
};
// Mesmo critério da tela: "resultado" pelo objetivo; sem ele, cliques no link.
const resultado = (r: Linha): ActionVal => r.result ?? { type: 'link_click', value: (r.results ?? []).find((x) => x.type === 'link_click')?.value ?? 0 };
const n = (v: unknown) => Number(v ?? 0) || 0;

function bloco(titulo: string, d: Resp): string {
  const camps = d.campaigns ?? [];
  const gasto = d.totals ? n(d.totals.spend) : camps.reduce((s, c) => s + n(c.spend), 0);
  if (!gasto) return `*${titulo}*\nSem gasto.`;
  const porTipo = new Map<string, number>();
  camps.forEach((c) => { const r = resultado(c); porTipo.set(r.type, (porTipo.get(r.type) ?? 0) + n(r.value)); });
  const total = [...porTipo.values()].reduce((s, v) => s + v, 0);
  const mix = [...porTipo].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).map(([t, v]) => `${v} ${ROTULO[t] ?? t.replace(/_/g, ' ')}`).join(' · ');
  const conversas = camps.reduce((s, c) => s + n((c.results ?? []).find((x) => x.type === CONVERSA)?.value), 0);
  const compras = d.totals ? n(d.totals.purchases) : camps.reduce((s, c) => s + n(c.purchases), 0);
  const vendas = d.totals ? n(d.totals.purchase_value) : camps.reduce((s, c) => s + n(c.purchase_value), 0);
  const linhas = [
    `*${titulo}*`,
    `Gasto: ${brl(gasto)}`,
    total ? `Resultados: ${mix} · ${brl(gasto / total)} cada` : 'Resultados: nenhum',
  ];
  if (conversas) {
    const custoMeta = d.totals?.cost_per?.find((x) => x.type === CONVERSA)?.value;
    linhas.push(`Custo por conversa: ${brl(custoMeta ?? gasto / conversas)}`);
  }
  if (compras || vendas) linhas.push(`Compras: ${compras} · ${brl(vendas)} · ROAS ${(vendas / gasto).toFixed(2).replace('.', ',')}x`);
  return linhas.join('\n');
}

export default function TrafegoResumo({ onFechar, irPara }: AcaoProps) {
  const { user } = useAuth();
  const { baloes, bot } = useRoteiro();
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    (async () => {
      const tenantId = user?.tenantId;
      if (!tenantId) { bot('Escolha uma loja no app antes.'); setCarregando(false); return; }
      const chamar = (date_preset: string) => invokeWithAuth<Resp>('meta-ads-insights', { body: { tenant_id: tenantId, date_preset } });
      const [hoje, semana] = await Promise.all([chamar('today'), chamar('last_7d')]);
      setCarregando(false);
      const d7 = semana.data;
      if (semana.error || !d7) { bot(`Não consegui falar com a Meta: ${semana.error?.message ?? 'sem resposta'}`); return; }
      if (d7.not_connected) { bot(`*${user!.loja}*\nConta da Meta não conectada. Conecte na tela Tráfego Pago.`); return; }
      if (d7.no_account) { bot(`*${user!.loja}*\nFalta escolher a conta de anúncios na tela Tráfego Pago.`); return; }
      if (!d7.ok) { bot(`Erro da Meta: ${typeof d7.error === 'string' ? d7.error : 'não consegui buscar as campanhas'}`); return; }

      bot(`*${user!.loja}*${d7.ad_account_name ? ` · ${d7.ad_account_name}` : ''}`);
      const dh = hoje.data;
      bot(dh?.ok ? bloco('Hoje', dh) : `*Hoje*\nNão consegui buscar (${hoje.error?.message ?? (typeof dh?.error === 'string' ? dh.error : 'erro')}).`);
      bot(bloco('Últimos 7 dias', d7));

      const ativas = (d7.campaigns ?? []).filter((c) => c.status === 'ACTIVE').sort((a, b) => n(b.spend) - n(a.spend));
      if (!ativas.length) bot('Nenhuma campanha ativa com gasto nos últimos 7 dias.');
      else {
        bot([
          `*Campanhas ativas (${ativas.length})*`,
          ...ativas.map((c) => {
            const r = resultado(c);
            return `• ${c.campaign}\n   ${brl(n(c.spend))} · ${n(r.value)} ${ROTULO[r.type] ?? r.type.replace(/_/g, ' ')}${n(r.value) ? ` · ${brl(n(c.spend) / n(r.value))} cada` : ''}`;
          }),
        ].join('\n'));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Roteiro titulo="Tráfego pago" subtitulo="Resumo · só leitura · sem custo de IA" icone="ri-megaphone-line" cor="bg-amber-50 text-amber-600"
      baloes={baloes} carregando={carregando} textoCarregando="Buscando na Meta…" onFechar={onFechar}>
      {!carregando && (
        <Fim onFechar={onFechar} acoes={[
          { label: 'Abrir Tráfego Pago', onClick: () => irPara('/trafego-pago') },
          { label: 'Ver sugestões do agente', onClick: () => irPara('/trafego-pago#agente') },
        ]} />
      )}
    </Roteiro>
  );
}
