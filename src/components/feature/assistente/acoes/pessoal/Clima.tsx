// Ação rápida: previsão do tempo por loja (sem IA, só leitura). Mesma fonte e mesma lógica de
// local da ferramenta previsao_tempo do assistente-brain: coordenada do delivery
// (system_settings.delivery_config.store_location) ou, sem ela, a cidade do delivery
// (delivery_city) geocodificada — ambas lidas pela Edge delivery-write › get_delivery_settings
// (a mesma da tela Config. Delivery; checa se você é membro da loja, então funciona para qualquer
// loja sua, não só a ativa). Previsão: Open-Meteo (grátis, sem chave, CORS liberado).
// Resposta em PAINEL (2026-09-18): resumo do dia + tabela por período (manhã/tarde/noite).
import { useEffect, useState } from 'react';
import { invokeWithAuth } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { Roteiro, useRoteiro, Opcao, Fim, hojeISO, somaDias, dataBR, type AcaoProps } from '../kit';
import { Painel, Kpis, Linhas } from '../painel';

type Passo = 'lojas' | 'carregando' | 'dia' | 'buscando' | 'fim';
type Local = { lat: number; lng: number; label: string };

const WMO: Record<number, string> = { 0: 'céu limpo', 1: 'quase limpo', 2: 'parcialmente nublado', 3: 'nublado', 45: 'nevoeiro', 48: 'nevoeiro', 51: 'garoa fraca', 53: 'garoa', 55: 'garoa forte', 61: 'chuva fraca', 63: 'chuva', 65: 'chuva forte', 80: 'pancadas fracas', 81: 'pancadas', 82: 'pancadas fortes', 95: 'trovoada', 96: 'trovoada com granizo', 99: 'trovoada forte' };
const desc = (c: number) => WMO[c] ?? `código ${c}`;
const PERIODOS: { nome: string; de: number; ate: number }[] = [
  { nome: 'Manhã', de: 6, ate: 11 },
  { nome: 'Tarde', de: 12, ate: 17 },
  { nome: 'Noite', de: 18, ate: 23 },
];

async function fetchJson(url: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export default function Clima({ onFechar }: AcaoProps) {
  const { user, availableTenants } = useAuth();
  const r = useRoteiro();
  const [passo, setPasso] = useState<Passo>('carregando');
  const [local, setLocal] = useState<Local | null>(null);

  // Loja ativa primeiro.
  const lojas = [...(availableTenants ?? [])].sort((a, b) => (a.tenantId === user?.tenantId ? -1 : b.tenantId === user?.tenantId ? 1 : 0));

  useEffect(() => {
    if (lojas.length > 1) { r.bot('Previsão de qual loja?'); setPasso('lojas'); return; }
    if (lojas.length === 1) { escolherLoja(lojas[0].tenantId, lojas[0].tenantName, true); return; }
    r.bot('Nenhuma loja disponível.');
    setPasso('fim');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const escolherLoja = async (tenantId: string, nome: string, automatico = false) => {
    if (!automatico) r.eu(nome);
    setPasso('carregando');
    try {
      const { data, error } = await invokeWithAuth<{ city?: string; delivery_config?: { store_location?: { lat?: unknown; lng?: unknown } | null }; error?: string; message?: string }>('delivery-write', {
        body: { action: 'get_delivery_settings', tenant_id: tenantId },
      });
      if (error || !data || data.error) throw new Error(data?.message ?? data?.error ?? error?.message ?? 'erro');
      const sl = data.delivery_config?.store_location;
      let l: Local | null = null;
      if (sl && typeof sl.lat === 'number' && typeof sl.lng === 'number') l = { lat: sl.lat, lng: sl.lng, label: nome };
      else if (data.city) {
        const g = await fetchJson(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(data.city)}&count=1&language=pt&format=json`);
        const x = g?.results?.[0];
        if (!x) throw new Error(`cidade "${data.city}" não encontrada`);
        l = { lat: x.latitude, lng: x.longitude, label: `${nome} (${x.name}${x.admin1 ? ` - ${x.admin1}` : ''})` };
      }
      if (!l) { r.bot(`${nome} não tem localização nem cidade cadastrada. Cadastre em Config. Delivery.`); setPasso('fim'); return; }
      setLocal(l);
      r.bot(`${l.label}: hoje ou amanhã?`);
      setPasso('dia');
    } catch (e) {
      r.bot(`Não consegui achar o local da loja: ${e instanceof Error ? e.message : 'erro'}`);
      setPasso('fim');
    }
  };

  const buscar = async (iso: string, rotulo: string) => {
    if (!local) return;
    r.eu(rotulo);
    setPasso('buscando');
    try {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${local.lat}&longitude=${local.lng}&timezone=America%2FSao_Paulo&forecast_days=2`
        + '&hourly=temperature_2m,precipitation_probability,precipitation,weather_code,wind_speed_10m'
        + '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max';
      const w = await fetchJson(url);
      const h = w?.hourly ?? {};
      const tempos: string[] = h.time ?? [];
      const di = (w?.daily?.time ?? []).indexOf(iso);
      const resumo = di >= 0 ? {
        desc: desc(w.daily.weather_code[di]),
        min: Math.round(w.daily.temperature_2m_min[di]),
        max: Math.round(w.daily.temperature_2m_max[di]),
        chuva: w.daily.precipitation_probability_max[di] ?? 0,
        mm: w.daily.precipitation_sum[di],
      } : null;
      const periodos: Array<{ label: string; valor: string; detalhe: string }> = [];
      for (const p of PERIODOS) {
        const idx = tempos.map((t, i) => ({ t, i })).filter(({ t }) => t.slice(0, 10) === iso && Number(t.slice(11, 13)) >= p.de && Number(t.slice(11, 13)) <= p.ate).map(({ i }) => i);
        if (!idx.length) continue;
        const temps = idx.map((i) => Number(h.temperature_2m[i]));
        const chuva = Math.max(...idx.map((i) => Number(h.precipitation_probability?.[i] ?? 0)));
        const mm = idx.reduce((s, i) => s + Number(h.precipitation?.[i] ?? 0), 0);
        const vento = Math.max(...idx.map((i) => Number(h.wind_speed_10m?.[i] ?? 0)));
        const pior = Math.max(...idx.map((i) => Number(h.weather_code[i])));
        const tMin = Math.round(Math.min(...temps));
        const tMax = Math.round(Math.max(...temps));
        periodos.push({
          label: p.nome,
          valor: tMin === tMax ? `${tMin}°` : `${tMin}–${tMax}°`,
          detalhe: `chuva ${chuva}%${mm > 0 ? ` (${mm.toFixed(1)} mm)` : ''} · vento até ${Math.round(vento)} km/h · ${desc(pior)}`,
        });
      }
      if (!resumo && !periodos.length) {
        r.bot(`*${rotulo} (${dataBR(iso)}) · ${local.label}*\nSem dados para esse dia.`);
      } else {
        r.painel(
          <Painel titulo={`${rotulo} · ${local.label}`} subtitulo={dataBR(iso)} rodape="Fonte: Open-Meteo">
            {resumo && (
              <Kpis principal={{ label: resumo.desc, valor: `${resumo.min}° – ${resumo.max}°` }}
                outros={[{ label: 'Chuva', valor: `${resumo.chuva}%${resumo.mm > 0 ? ` (${resumo.mm} mm)` : ''}` }]} />
            )}
            <Linhas titulo="Por período" itens={periodos} />
          </Painel>,
        );
      }
    } catch (e) {
      r.bot(`Não consegui buscar a previsão: ${e instanceof Error ? e.message : 'erro'}`);
    }
    setPasso('dia');
  };

  const hoje = hojeISO();
  return (
    <Roteiro titulo="Previsão do tempo" icone="ri-sun-cloudy-line" cor="bg-sky-50 text-sky-600" baloes={r.baloes}
      carregando={passo === 'carregando' || passo === 'buscando'} textoCarregando={passo === 'buscando' ? 'Buscando previsão…' : undefined}
      onFechar={onFechar}>
      {passo === 'lojas' && lojas.map((l) => (
        <Opcao key={l.tenantId} onClick={() => escolherLoja(l.tenantId, l.tenantName)} detalhe={l.tenantId === user?.tenantId ? '(ativa)' : undefined}>{l.tenantName}</Opcao>
      ))}

      {passo === 'dia' && (
        <>
          <Opcao onClick={() => buscar(hoje, 'Hoje')}>Hoje</Opcao>
          <Opcao onClick={() => buscar(somaDias(hoje, 1), 'Amanhã')}>Amanhã</Opcao>
          {lojas.length > 1 && <Opcao onClick={() => { r.bot('Previsão de qual loja?'); setPasso('lojas'); }}>Outra loja</Opcao>}
          <Fim onFechar={onFechar} />
        </>
      )}

      {passo === 'fim' && <Fim onFechar={onFechar} />}
    </Roteiro>
  );
}
