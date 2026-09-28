// Custos da IA (2026-09-28): quanto a API da Anthropic custou no período, por loja, por pessoa
// e por uso. Dados de public.ai_usage_events (cada Edge Function que chama o modelo grava uma
// linha), lidos pela Edge assistente-config (action ai_usage, só o dono).
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

interface Soma { chave: string; nome: string; usd: number; chamadas: number; tokens_in: number; tokens_out: number }
interface Relatorio {
  de: string; ate: string; total_usd: number; chamadas: number; estimado: boolean;
  cotacao: { rate: number; source: string; at: string } | null;
  por_loja: Soma[]; por_pessoa: Soma[]; por_uso: Soma[]; por_modelo: Soma[]; por_dia: Soma[];
}

const USO_LABEL: Record<string, string> = {
  'assistente': 'Assistente (conversa)',
  'assistente-grupo': 'Assistente nos grupos do WhatsApp',
  'assistente-midia': 'Leitura de foto/PDF pelo assistente',
  'assistente-aquecimento': 'Assistente (aquecimento do cache)',
  'atendimento-whatsapp': 'Atendimento de clientes no WhatsApp',
  'atendimento-simulacao': 'Treino do atendimento (simulação)',
  'canal-publico': 'Canal público (currículos no WhatsApp)',
  'curriculos': 'Leitura de currículos',
  'agendamento-entrevista': 'Agendamento de entrevistas',
  'contas-email': 'Contas a pagar por e-mail',
  'leitura-notinha': 'Leitura de notinha (foto)',
  'traducao-cardapio': 'Tradução do cardápio',
  'trafego-meta-ads': 'Gestor de tráfego (Meta Ads)',
  'trafego-meta-ads-sombra': 'Gestor de tráfego (comparação de modelo)',
  'estudio-nota-foto': 'Estúdio de Criação (nota das fotos)',
  'estudio-kit': 'Estúdio de Criação (kit da marca)',
  'trafego-pesquisador': 'Tráfego Pago (pesquisador de oportunidades)',
};
// A API devolve às vezes o nome com data (claude-haiku-4-5-20251001): a data sai do rótulo.
const MODELO_LABEL = (m: string) => m.replace(/^claude-/, '').replace(/-\d{8}$/, '').replace(/-(\d)-(\d)$/, ' $1.$2').replace(/-(\d)$/, ' $1')
  .replace(/^./, (c) => c.toUpperCase());

type Periodo = 'mes' | 'mes_passado' | '7d' | '30d' | 'custom';
const iso = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
function intervalo(p: Periodo, de: string, ate: string): [string, string] {
  const hoje = new Date();
  if (p === 'mes') return [iso(new Date(hoje.getFullYear(), hoje.getMonth(), 1)), iso(hoje)];
  if (p === 'mes_passado') return [iso(new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1)), iso(new Date(hoje.getFullYear(), hoje.getMonth(), 0))];
  if (p === '7d') return [iso(new Date(hoje.getTime() - 6 * 86400000)), iso(hoje)];
  if (p === '30d') return [iso(new Date(hoje.getTime() - 29 * 86400000)), iso(hoje)];
  return [de, ate];
}

async function carregarRelatorio(de: string, ate: string): Promise<Relatorio> {
  const { data, error } = await supabase.functions.invoke('assistente-config', { body: { action: 'ai_usage', de, ate } });
  if (error) {
    let msg = error.message;
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === 'function') {
      try { const b = await ctx.json(); if (b?.error) msg = String(b.error); } catch { /* corpo não-JSON */ }
    }
    throw new Error(msg);
  }
  const resp = data as { success?: boolean; error?: string; data?: Relatorio } | null;
  if (!resp?.success || !resp.data) throw new Error(resp?.error || 'Falha ao carregar');
  return resp.data;
}

export default function CustosIaCard() {
  const [periodo, setPeriodo] = useState<Periodo>('mes');
  const [deCustom, setDeCustom] = useState(() => iso(new Date(Date.now() - 6 * 86400000)));
  const [ateCustom, setAteCustom] = useState(() => iso(new Date()));
  const [rel, setRel] = useState<Relatorio | null>(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    const [de, ate] = intervalo(periodo, deCustom, ateCustom);
    if (!de || !ate || de > ate) return;
    setLoading(true);
    try { setRel(await carregarRelatorio(de, ate)); setErro(null); } catch (e) { setErro(e instanceof Error ? e.message : String(e)); } finally { setLoading(false); }
  }, [periodo, deCustom, ateCustom]);
  useEffect(() => { carregar(); }, [carregar]);

  const rate = rel?.cotacao?.rate ?? null;
  const brl = (usd: number) => (rate != null
    ? (usd * rate).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
    : `US$ ${usd.toFixed(2)}`);
  const usdTxt = (usd: number) => `US$ ${usd.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const maxDia = Math.max(0.0001, ...(rel?.por_dia ?? []).map((d) => d.usd));

  const Lista = ({ titulo, icone, itens, rotulo }: { titulo: string; icone: string; itens: Soma[]; rotulo?: (s: Soma) => string }) => {
    const total = rel?.total_usd || 1;
    return (
      <div className="rounded-2xl border border-zinc-200 bg-white overflow-hidden">
        <p className="px-4 py-2.5 text-xs font-bold text-zinc-600 border-b border-zinc-100 flex items-center gap-1.5"><i className={icone} /> {titulo}</p>
        {itens.length === 0 && <p className="px-4 py-6 text-sm text-zinc-400 text-center">Nada no período.</p>}
        <ul className="divide-y divide-zinc-50">
          {itens.map((s) => (
            <li key={s.chave || '_'} className="px-4 py-2.5">
              <div className="flex items-baseline gap-3">
                <p className="flex-1 min-w-0 text-sm text-zinc-800 truncate">{rotulo ? rotulo(s) : s.nome}</p>
                <p className="text-sm font-bold text-zinc-900 tabular-nums">{brl(s.usd)}</p>
              </div>
              <div className="flex items-center gap-2 mt-1">
                <div className="flex-1 h-1.5 rounded-full bg-zinc-100 overflow-hidden">
                  <div className="h-full rounded-full bg-violet-500" style={{ width: `${Math.max(1, (s.usd / total) * 100)}%` }} />
                </div>
                <p className="text-[11px] text-zinc-400 tabular-nums whitespace-nowrap">
                  {usdTxt(s.usd)} · {s.chamadas} {s.chamadas === 1 ? 'chamada' : 'chamadas'}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    );
  };

  const PERIODOS: { id: Periodo; label: string }[] = [
    { id: 'mes', label: 'Este mês' }, { id: 'mes_passado', label: 'Mês passado' },
    { id: '7d', label: '7 dias' }, { id: '30d', label: '30 dias' }, { id: 'custom', label: 'Personalizado' },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {PERIODOS.map((p) => (
          <button
            key={p.id}
            onClick={() => setPeriodo(p.id)}
            className={`px-3 h-8 rounded-lg text-xs font-bold cursor-pointer whitespace-nowrap ${periodo === p.id ? 'bg-violet-600 text-white' : 'bg-white border border-zinc-200 text-zinc-600 hover:bg-zinc-50'}`}
          >{p.label}</button>
        ))}
        {periodo === 'custom' && (
          <div className="flex items-center gap-1.5 text-xs text-zinc-500">
            <input type="date" value={deCustom} onChange={(e) => setDeCustom(e.target.value)} className="h-8 px-2 rounded-lg border border-zinc-200 text-xs" />
            até
            <input type="date" value={ateCustom} onChange={(e) => setAteCustom(e.target.value)} className="h-8 px-2 rounded-lg border border-zinc-200 text-xs" />
          </div>
        )}
      </div>

      {erro && (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Não foi possível carregar os custos: {erro}
          <button onClick={carregar} className="ml-3 underline cursor-pointer">Tentar de novo</button>
        </div>
      )}
      {loading && !rel && (
        <div className="flex items-center justify-center py-16">
          <div className="w-6 h-6 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {rel && (
        <div className={`space-y-4 ${loading ? 'opacity-60' : ''}`}>
          <div className="rounded-2xl border border-zinc-200 bg-white p-4">
            <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
              <div>
                <p className="text-[11px] text-zinc-400 font-semibold">Gasto com IA no período</p>
                <p className="text-2xl font-black text-zinc-900">{brl(rel.total_usd)}</p>
                <p className="text-[11px] text-zinc-400">
                  {usdTxt(rel.total_usd)}{rate != null && ` · dólar R$ ${rate.toFixed(2).replace('.', ',')} (${rel.cotacao?.source})`}
                </p>
              </div>
              <div>
                <p className="text-[11px] text-zinc-400 font-semibold">Chamadas ao modelo</p>
                <p className="text-lg font-black text-zinc-900">{rel.chamadas.toLocaleString('pt-BR')}</p>
              </div>
            </div>
            {rel.por_dia.length > 0 && (
              <div className="mt-4">
                <div className="flex items-end gap-[2px] h-24">
                  {rel.por_dia.map((d) => (
                    <div key={d.chave} className="flex-1 min-w-0 h-full flex items-end group relative" title={`${d.chave.split('-').reverse().join('/')}: ${brl(d.usd)} (${usdTxt(d.usd)})`}>
                      <div className="w-full rounded-t bg-violet-400 group-hover:bg-violet-600" style={{ height: `${Math.max(2, (d.usd / maxDia) * 100)}%` }} />
                    </div>
                  ))}
                </div>
                <div className="flex justify-between text-[10px] text-zinc-400 mt-1">
                  <span>{rel.por_dia[0].chave.split('-').reverse().slice(0, 2).join('/')}</span>
                  <span>{rel.por_dia[rel.por_dia.length - 1].chave.split('-').reverse().slice(0, 2).join('/')}</span>
                </div>
              </div>
            )}
            <p className="text-[11px] text-zinc-400 mt-3 leading-snug">
              Preço de lista da Anthropic convertido pela cotação do dia (sem IOF). O registro por chamada começou em 28/09/2026
              {rel.estimado ? '; antes disso os valores vêm do histórico de cada módulo (assistente, WhatsApp, canal público, tráfego) e são estimados' : ''}.
              O treino do atendimento de 27/09 (~US$ 39) não foi gravado e não aparece aqui.
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Lista titulo="Por uso" icone="ri-apps-2-line" itens={rel.por_uso} rotulo={(s) => USO_LABEL[s.chave] ?? s.chave.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase())} />
            <Lista titulo="Por loja" icone="ri-store-2-line" itens={rel.por_loja} />
            <Lista titulo="Por pessoa" icone="ri-user-3-line" itens={rel.por_pessoa} />
            <Lista titulo="Por modelo" icone="ri-cpu-line" itens={rel.por_modelo} rotulo={(s) => MODELO_LABEL(s.chave)} />
          </div>
        </div>
      )}
    </div>
  );
}
