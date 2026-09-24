// Leitor ao vivo (2026-09-24): câmera aberta, procura o QR do cupom / código da DANFE quadro a
// quadro — como o leitor do próprio celular. A foto parada falhava quando o QR saía pequeno.
// Sem permissão de câmera (ou navegador sem suporte), cai no "Tirar foto".
import { useEffect, useRef, useState } from 'react';
import { detectorNativo, lerQrDoCanvas, type Lido } from '../leitura';

interface Props {
  onLido: (l: Lido) => void;
  onFoto: () => void;
  onFechar: () => void;
}

export default function ScannerQR({ onLido, onFoto, onFechar }: Props) {
  const video = useRef<HTMLVideoElement>(null);
  const [erro, setErro] = useState<string | null>(null);
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
      const nativo = await detectorNativo();
      const jsQR = (await import('jsqr')).default;
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
      let alterna = false;
      const passo = async () => {
        const v = video.current;
        if (!vivo || lido.current || !v || v.readyState < 2 || !v.videoWidth) { if (vivo && !lido.current) timer = window.setTimeout(passo, 200); return; }
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
      </div>
      <div className="px-4 pt-3 space-y-2 flex-shrink-0" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 12px)' }}>
        <p className="text-center text-xs text-white/70">Lê sozinho quando o QR aparecer no quadrado. Sem QR? Tire foto da notinha.</p>
        <button type="button" onClick={onFoto} className="w-full py-4 rounded-2xl bg-white text-zinc-800 font-bold flex items-center justify-center gap-2 cursor-pointer">
          <i className="ri-camera-line text-xl" /> Tirar foto da notinha
        </button>
      </div>
    </div>
  );
}
