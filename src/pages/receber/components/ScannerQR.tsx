// Leitor ao vivo (2026-09-24): câmera aberta, procura o QR do cupom / código da DANFE quadro a
// quadro — como o leitor do próprio celular. A foto parada falhava quando o QR saía pequeno.
// Sem permissão de câmera (ou navegador sem suporte), cai no "Tirar foto".
import { useEffect, useRef, useState } from 'react';
import { detectorNativo, interpretar, lerQrDoCanvas, type Lido } from '../leitura';

interface Props {
  onLido: (l: Lido) => void;
  /** Link do QR colado (lido pela câmera do próprio celular). */
  onLink: (url: string) => void;
  onFoto: () => void;
  /** Foto ou PDF que já está no celular (galeria, arquivos, WhatsApp). */
  onGaleria: () => void;
  onFechar: () => void;
}

export default function ScannerQR({ onLido, onLink, onFoto, onGaleria, onFechar }: Props) {
  const video = useRef<HTMLVideoElement>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [status, setStatus] = useState('Abrindo a câmera…');
  const [colando, setColando] = useState(false);
  const [link, setLink] = useState('');
  const lido = useRef(false);
  const cb = useRef(onLido);
  cb.current = onLido;

  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer: number | null = null;
    let vivo = true;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false,
        });
      } catch {
        if (vivo) setErro('Não consegui abrir a câmera. Libere a câmera para o app ou use "Tirar foto".');
        return;
      }
      if (!vivo || !video.current) { stream.getTracks().forEach((t) => t.stop()); return; }
      video.current.srcObject = stream;
      await video.current.play().catch(() => undefined);
      // Android: a câmera do navegador às vezes fica com foco fixo de longe — o QR denso da notinha
      // sai borrado de perto. Liga foco contínuo e um zoom leve (dá para ler um pouco mais longe).
      const track = stream.getVideoTracks()[0];
      try {
        const cap = (track.getCapabilities?.() ?? {}) as { focusMode?: string[]; zoom?: { min: number; max: number } };
        const adv: Record<string, unknown>[] = [];
        if (cap.focusMode?.includes('continuous')) adv.push({ focusMode: 'continuous' });
        if (cap.zoom && cap.zoom.max >= 1.5) adv.push({ zoom: Math.min(2, cap.zoom.max) });
        if (adv.length) await track.applyConstraints({ advanced: adv } as MediaTrackConstraints);
      } catch { /* aparelho sem esses controles */ }
      const nativo = await detectorNativo();
      let quadros = 0;
      const jsQR = (await import('jsqr')).default;
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
      let alterna = false;
      const passo = async () => {
        const v = video.current;
        if (!vivo || lido.current || !v || v.readyState < 2 || !v.videoWidth) { if (vivo && !lido.current) timer = window.setTimeout(passo, 200); return; }
        quadros++;
        if (quadros % 10 === 1) setStatus(`Procurando o QR… (${nativo ? 'leitor do Android' : 'leitor do app'})`);
        // Leitor nativo direto no vídeo (resolução cheia) — o mais forte no Android
        if (nativo) {
          try {
            for (const a of await nativo.detect(v)) {
              const r = interpretar(a.rawValue);
              if (r && vivo && !lido.current) { lido.current = true; navigator.vibrate?.(80); cb.current(r); return; }
            }
          } catch { /* segue pelo recorte */ }
        }
        // Alterna quadro inteiro e o centro ampliado (QR pequeno / longe)
        alterna = !alterna;
        const W = v.videoWidth, H = v.videoHeight;
        const [sx, sy, sw, sh] = alterna ? [0, 0, W, H] : [W * 0.2, H * 0.2, W * 0.6, H * 0.6];
        const scale = Math.min(1, 1000 / Math.max(sw, sh)) * (alterna ? 1 : 1.4);
        canvas.width = Math.round(sw * scale);
        canvas.height = Math.round(sh * scale);
        ctx.drawImage(v, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
        const r = await lerQrDoCanvas(canvas, nativo, jsQR).catch(() => null);
        if (r && vivo && !lido.current) {
          lido.current = true;
          navigator.vibrate?.(80);
          cb.current(r);
          return;
        }
        if (vivo) timer = window.setTimeout(passo, 150);
      };
      passo();
    })();
    return () => {
      vivo = false;
      if (timer) window.clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return (
    <div className="fixed inset-0 z-[100] bg-black flex flex-col" role="dialog" aria-modal="true">
      <div className="flex items-center gap-2 px-3 text-white flex-shrink-0" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 8px)', paddingBottom: 8 }}>
        <p className="flex-1 text-base font-bold">Aponte para o QR Code</p>
        <button type="button" onClick={onFechar} className="w-11 h-11 flex items-center justify-center rounded-full active:bg-white/20 cursor-pointer" aria-label="Fechar">
          <i className="ri-close-line text-2xl" />
        </button>
      </div>
      <div className="relative flex-1 min-h-0 overflow-hidden">
        <video ref={video} playsInline muted className="absolute inset-0 w-full h-full object-cover" />
        {!erro && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-64 h-64 max-w-[70vw] max-h-[70vw] border-4 border-white/90 rounded-3xl shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
          </div>
        )}
        {erro && <p className="absolute inset-x-6 top-1/3 text-center text-white text-sm bg-black/60 rounded-2xl p-4">{erro}</p>}
        {!erro && <p className="absolute inset-x-0 bottom-3 text-center text-xs text-white/80">{status}</p>}
      </div>
      <div className="px-4 pt-3 space-y-2 flex-shrink-0" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 12px)' }}>
        <p className="text-center text-xs text-white/70">Lê sozinho quando o QR aparecer no quadrado. Não leu? Afaste um pouco o celular, ou cole o link que a câmera do celular mostra.</p>
        {colando ? (
          <div className="flex gap-2">
            <input autoFocus value={link} onChange={(e) => setLink(e.target.value)} placeholder="Cole aqui o link do QR"
              className="flex-1 min-w-0 rounded-2xl px-4 py-3.5 text-base outline-none" />
            <button type="button" disabled={!link.trim()} onClick={() => onLink(link.trim())} className="px-4 rounded-2xl bg-amber-500 disabled:bg-zinc-500 text-white font-bold cursor-pointer">Ler</button>
          </div>
        ) : (
          <button type="button" onClick={async () => {
            // Tenta ler direto da área de transferência; sem permissão, abre o campo para colar
            try { const t = (await navigator.clipboard?.readText?.())?.trim(); if (t && /^https?:\/\//i.test(t)) { onLink(t); return; } } catch { /* sem permissão */ }
            setColando(true);
          }} className="w-full py-3.5 rounded-2xl bg-white/15 text-white font-bold flex items-center justify-center gap-2 cursor-pointer">
            <i className="ri-clipboard-line text-xl" /> Colar o link do QR
          </button>
        )}
        <div className="flex gap-2">
          <button type="button" onClick={onFoto} className="flex-1 py-4 rounded-2xl bg-white text-zinc-800 font-bold flex items-center justify-center gap-2 cursor-pointer">
            <i className="ri-camera-line text-xl" /> Tirar foto
          </button>
          <button type="button" onClick={onGaleria} className="flex-1 py-4 rounded-2xl bg-white text-zinc-800 font-bold flex items-center justify-center gap-2 cursor-pointer">
            <i className="ri-image-line text-xl" /> Da galeria
          </button>
        </div>
      </div>
    </div>
  );
}
