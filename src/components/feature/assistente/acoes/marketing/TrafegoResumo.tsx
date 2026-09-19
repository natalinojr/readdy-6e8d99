// Ação rápida: resumo do Tráfego Pago (Meta Ads) — SÓ LEITURA, sem IA.
// Mesma Edge da tela Tráfego Pago: meta-ads-insights {tenant_id, date_preset} (hoje e últimos 7 dias).
// Pausar campanha não entra: a tela não pausa direto (só o agente, com aprovação).
// Resposta em PAINEL (2026-09-18): cada bloco (Hoje/7 dias/campanhas) vira um cartão; sem gasto ou
// erro seguem texto.
import { useEffect, useState } from 'react';
import { invokeWithAuth } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { Roteiro, useRoteiro, Fim, brl, type AcaoProps } from '../kit';
import { Painel, Kpis, Linhas } from '../painel';
import type { ReactNode } from 'react';

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

/** Painel do bloco (Hoje ou Últimos 7 dias); null quando não há gasto (fica texto simples). */
function blocoPainel(titulo: string, d: Resp): ReactNode {
  const camps = d.campaigns ?? [];
  const gasto = d.totals ? n(d.totals.spend) : camps.reduce((s, c) => s + n(c.spend), 0);
  if (!gasto) return null;
  const porTipo = new Map<string, number>();
  camps.forEach((c) => { const r = resultado(c); porTipo.set(r.type, (porTipo.get(r.type) ?? 0) + n(r.value)); });
  const total = [...porTipo.values()].reduce((s, v) => s + v, 0);
  const conversas = camps.reduce((s, c) => s + n((c.results ?? []).find((x) => x.type === CONVERSA)?.value), 0);
  const compras = d.totals ? n(d.totals.purchases) : camps.reduce((s, c) => s + n(c.purchases), 0);
  const vendas = d.totals ? n(d.totals.purchase_value) : camps.reduce((s, c) => s + n(c.purchase_value), 0);
  const custoMeta = d.totals?.cost_per?.find((x) => x.type === CONVERSA)?.value;
  const outros: Array<{ label: string; valor: string }> = [];
  if (total) outros.push({ label: 'Custo por resultado', valor: brl(gasto / total) });
  if (conversas) outros.push({ label: 'Custo/conversa', valor: brl(custoMeta ?? gasto / conversas) });
  if (compras || vendas) outros.push({ label: 'ROAS', valor: `${(vendas / gasto).toFixed(2).replace('.', ',')}x` });
  return (
    <Painel titulo={titulo} subtitulo="Meta Ads">
      <Kpis principal={{ label: 'Gasto', valor: brl(gasto) }} outros={outros.length ? outros.slice(0, 3) : [{ label: 'Resultados', valor: '0' }]} />
      {total > 0 && (
        <Linhas titulo="Resultados" itens={[...porTipo].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1])
          .map(([t, v]) => ({ label: ROTULO[t] ?? t.replace(/_/g, ' '), valor: String(v) }))} />
      )}
      {(compras || vendas) > 0 && <p className="text-[11px] text-zinc-500">Compras: {compras} · {brl(vendas)}</p>}
    </Painel>
  );
}

export default function TrafegoResumo({ onFechar, irPara }: AcaoProps) {
  const { user } = useAuth();
  const { baloes, bot, painel } = useRoteiro();
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
      if (!dh?.ok) bot(`*Hoje*\nNão consegui buscar (${hoje.error?.message ?? (typeof dh?.error === 'string' ? dh.error : 'erro')}).`);
      else {
        const p = blocoPainel('Hoje', dh);
        if (p) painel(p); else bot('*Hoje*\nSem gasto.');
      }
      const p7 = blocoPainel('Últimos 7 dias', d7);
      if (p7) painel(p7); else bot('*Últimos 7 dias*\nSem gasto.');

      const ativas = (d7.campaigns ?? []).filter((c) => c.status === 'ACTIVE').sort((a, b) => n(b.spend) - n(a.spend));
      if (!ativas.length) bot('Nenhuma campanha ativa com gasto nos últimos 7 dias.');
      else {
        painel(
          <Painel titulo={`Campanhas ativas (${ativas.length})`} subtitulo="Últimos 7 dias">
            <Linhas itens={ativas.map((c) => {
              const r = resultado(c);
              return {
                label: c.campaign,
                detalhe: `${n(r.value)} ${ROTULO[r.type] ?? r.type.replace(/_/g, ' ')}${n(r.value) ? ` · ${brl(n(c.spend) / n(r.value))} cada` : ''}`,
                valor: brl(n(c.spend)),
              };
            })} />
          </Painel>,
        );
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
