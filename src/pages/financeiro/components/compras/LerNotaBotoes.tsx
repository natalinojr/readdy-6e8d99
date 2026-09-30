// Botões "preencher pela nota" (2026-09-29): câmera lendo o QR da NFC-e, foto, ou arquivo (foto/PDF
// já no celular ou no computador). Usado no "Lançar a partir deste pagamento › Compra" e no
// "Detalhar itens" de uma compra já lançada. Quem usa recebe o ScanResult e monta as linhas.
import { useRef, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import ScannerQR from '@/pages/receber/components/ScannerQR';
import type { Lido } from '@/pages/receber/leitura';
import { isNfcePrQr, lerNotinhaArquivo, lerNotinhaLink, type ScanResult } from '@/lib/leituraNotinha';

interface Props {
  onLido: (r: ScanResult) => void;
  /** Chamado antes de ler (ex.: carregar os insumos para ligar as linhas) */
  onInicio?: () => void;
  disabled?: boolean;
}

export default function LerNotaBotoes({ onLido, onInicio, disabled }: Props) {
  const { user } = useAuth();
  const foto = useRef<HTMLInputElement>(null);
  const arquivo = useRef<HTMLInputElement>(null);
  const [scanner, setScanner] = useState(false);
  const [lendo, setLendo] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const rodar = async (fn: () => Promise<ScanResult>) => {
    setErro(null);
    setLendo('Lendo a nota…');
    onInicio?.();
    try {
      const r = await fn();
      if (!r.readable || r.items.length === 0) {
        setErro(r.warnings[0] || 'Não encontrei itens nesta nota. Tente uma foto mais nítida, reta e com boa luz.');
        return;
      }
      onLido(r);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao ler a nota. Tente de novo.');
    } finally {
      setLendo(null);
    }
  };
  const lerArquivo = (f: File | undefined) => { if (f) void rodar(() => lerNotinhaArquivo(user?.tenantId, f, setLendo)); };
  const lerLink = (url: string) => {
    if (!isNfcePrQr(url)) { setErro('Este QR não é de NFC-e do Paraná. Tire uma foto da nota que a leitura por IA resolve.'); return; }
    void rodar(() => lerNotinhaLink(user?.tenantId, url));
  };
  const lidoDoScanner = (l: Lido) => {
    setScanner(false);
    if (l.tipo === 'qr') lerLink(l.url);
    else if (l.tipo === 'chave') setErro('Isto é o código de barras de uma NF-e (DANFE): ela chega sozinha em Notas de entrada. Tire uma foto da nota se quiser ler os itens agora.');
    else setErro('Não achei o QR Code. Tente a foto.');
  };

  const btn = 'flex items-center justify-center gap-1 px-2 py-2 sm:py-1 rounded-lg border border-violet-300 text-violet-700 text-xs font-semibold cursor-pointer hover:bg-violet-50 whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed';
  return (
    <div className="space-y-1.5">
      {/* Celular: rótulo em cima e os 3 botões numa linha só, cada um com 1/3 da largura */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-1.5">
        <span className="text-[11px] text-zinc-500">Preencher pela nota:</span>
        <div className="grid grid-cols-3 gap-1.5 sm:flex">
        <button type="button" disabled={disabled || !!lendo} onClick={() => setScanner(true)} className={btn}><i className="ri-qr-scan-2-line" />QR Code</button>
        <button type="button" disabled={disabled || !!lendo} onClick={() => foto.current?.click()} className={btn}><i className="ri-camera-line" />Foto</button>
        <button type="button" disabled={disabled || !!lendo} onClick={() => arquivo.current?.click()} className={btn}><i className="ri-attachment-2" />Arquivo</button>
        </div>
      </div>
      <input ref={foto} type="file" accept="image/*" capture="environment" className="hidden"
        onChange={(e) => { lerArquivo(e.target.files?.[0]); e.target.value = ''; }} />
      <input ref={arquivo} type="file" accept="image/*,application/pdf" className="hidden"
        onChange={(e) => { lerArquivo(e.target.files?.[0]); e.target.value = ''; }} />
      {lendo && <p className="text-xs text-violet-700 flex items-center gap-1"><i className="ri-loader-4-line animate-spin" />{lendo}</p>}
      {erro && <p className="text-xs text-red-600">{erro}</p>}
      {scanner && (
        <ScannerQR
          onLido={lidoDoScanner}
          onLink={(url) => { setScanner(false); lerLink(url); }}
          onFoto={() => { setScanner(false); foto.current?.click(); }}
          onGaleria={() => { setScanner(false); arquivo.current?.click(); }}
          onFechar={() => setScanner(false)}
        />
      )}
    </div>
  );
}
