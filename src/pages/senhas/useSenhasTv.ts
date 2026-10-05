// Leitura e voz do painel de senhas (/senhas/<token>). Sem login: fala com a Edge `senhas-tv` pelo token.
// Ao vivo: ping do canal público orders-ping (mesmo das telas da loja) + recarga a cada 15 s de segurança.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useOrdersPing } from '@/hooks/useOrdersPing';
import { fraseChamada, lerRespostaPainel, novasProntas, type PainelSenhas, type RespostaPainel } from '@/lib/senhasTv';

const RECARGA_MS = 15000;
const SEM_CONEXAO_MS = 45000;
const MAX_FALADAS_POR_LEITURA = 4;

async function buscar(token: string, comLogo: boolean): Promise<RespostaPainel> {
  const base = ((import.meta.env.VITE_PUBLIC_SUPABASE_URL as string) || '').replace(/\/$/, '');
  const anon = import.meta.env.VITE_PUBLIC_SUPABASE_ANON_KEY as string;
  try {
    const res = await fetch(`${base}/functions/v1/senhas-tv`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: anon, Authorization: `Bearer ${anon}` },
      body: JSON.stringify({ token, logo: comLogo }),
      cache: 'no-store',
    });
    return lerRespostaPainel(await res.json());
  } catch {
    return { status: 'erro' };
  }
}

// ── Som e voz (o navegador só libera depois de um toque) ──
let audioCtx: AudioContext | null = null;

function sino() {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    audioCtx = audioCtx ?? new Ctx();
    const ctx = audioCtx;
    const t0 = ctx.currentTime;
    [[880, 0], [1320, 0.28]].forEach(([freq, atraso]) => {
      const osc = ctx.createOscillator();
      const ganho = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      ganho.gain.setValueAtTime(0.0001, t0 + atraso);
      ganho.gain.exponentialRampToValueAtTime(0.5, t0 + atraso + 0.02);
      ganho.gain.exponentialRampToValueAtTime(0.0001, t0 + atraso + 0.9);
      osc.connect(ganho).connect(ctx.destination);
      osc.start(t0 + atraso);
      osc.stop(t0 + atraso + 1);
    });
  } catch { /* sem áudio: o painel segue mudo */ }
}

function falar(texto: string) {
  try {
    const synth = window.speechSynthesis;
    if (!synth) return;
    const u = new SpeechSynthesisUtterance(texto);
    u.lang = 'pt-BR';
    u.rate = 0.9;
    const vozes = synth.getVoices();
    const voz = vozes.find((v) => v.lang === 'pt-BR') ?? vozes.find((v) => v.lang.toLowerCase().startsWith('pt'));
    if (voz) u.voice = voz;
    synth.speak(u);
  } catch { /* sem voz: fica o sino */ }
}

export function useSenhasTv(token: string | undefined) {
  const [resposta, setResposta] = useState<RespostaPainel | null>(null);
  const [painel, setPainel] = useState<PainelSenhas | null>(null);
  const [semConexao, setSemConexao] = useState(false);
  const [somLigado, setSomLigado] = useState(false);

  const somRef = useRef(false);
  const conhecidasRef = useRef<Set<string> | null>(null); // null = ainda não leu (1ª leitura não fala)
  const logoRef = useRef<string | null>(null);
  const ultimoOkRef = useRef(0);
  const carregandoRef = useRef(false);
  const filaRef = useRef<string[]>([]);
  const falandoRef = useRef(false);

  const processarFila = useCallback(() => {
    if (falandoRef.current) return;
    const proxima = filaRef.current.shift();
    if (!proxima) return;
    falandoRef.current = true;
    sino();
    window.setTimeout(() => {
      falar(fraseChamada(proxima));
      window.setTimeout(() => { falandoRef.current = false; processarFila(); }, 3800);
    }, 800);
  }, []);

  const carregar = useCallback(async () => {
    if (!token || carregandoRef.current) return;
    carregandoRef.current = true;
    try {
      const r = await buscar(token, logoRef.current === null);
      if (r.status === 'erro') {
        if (Date.now() - ultimoOkRef.current > SEM_CONEXAO_MS) setSemConexao(true);
        return;
      }
      ultimoOkRef.current = Date.now();
      setSemConexao(false);
      setResposta(r);
      if (r.status !== 'ok') { setPainel(null); return; }

      const p = r.painel;
      if (p.loja.logo) logoRef.current = p.loja.logo;
      else if (logoRef.current === null) logoRef.current = ''; // loja sem logo: não pede de novo
      const comLogo = { ...p, loja: { ...p.loja, logo: logoRef.current || null } };
      setPainel(comLogo);

      const atuais = p.prontas.map((x) => x.senha);
      if (conhecidasRef.current) {
        const novas = novasProntas(conhecidasRef.current, atuais);
        if (novas.length && somRef.current) {
          // a mais antiga primeiro; passa de 4 de uma vez, o resto fica só na tela
          filaRef.current.push(...novas.slice().reverse().slice(0, MAX_FALADAS_POR_LEITURA));
          processarFila();
        }
      }
      conhecidasRef.current = new Set(atuais);
    } finally {
      carregandoRef.current = false;
    }
  }, [token, processarFila]);

  // 1ª leitura + recarga de segurança a cada 15 s (cobre ping perdido e queda do Realtime)
  useEffect(() => {
    if (!token) return;
    carregar();
    const t = window.setInterval(() => {
      if (document.visibilityState === 'hidden') return;
      carregar();
    }, RECARGA_MS);
    return () => window.clearInterval(t);
  }, [token, carregar]);

  // Ping ao vivo: junta uma rajada de mudanças em uma leitura só.
  const debounceRef = useRef<number | null>(null);
  useOrdersPing(painel?.tenantId, () => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => { carregar(); }, 600);
  });
  useEffect(() => () => { if (debounceRef.current) window.clearTimeout(debounceRef.current); }, []);

  /** Chamar num toque: libera sino e voz (regra do navegador) e confirma em voz alta. */
  const ligarSom = useCallback(() => {
    if (somRef.current) return;
    somRef.current = true;
    setSomLigado(true);
    try {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (Ctx) { audioCtx = audioCtx ?? new Ctx(); void audioCtx.resume(); }
    } catch { /* ignora */ }
    sino();
    window.setTimeout(() => falar('Som ligado'), 600);
  }, []);

  return { resposta, painel, semConexao, somLigado, ligarSom };
}
