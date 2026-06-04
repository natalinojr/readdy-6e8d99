import { useState, useCallback, useRef, useEffect } from 'react';
import QRCodeImport from 'react-qr-code';
const QRCode = ((QRCodeImport as unknown as { default: typeof QRCodeImport }).default || QRCodeImport) as typeof QRCodeImport;
import { useTablesConfig, type MesaConfig, type MesaFormato } from '../../../hooks/useTablesConfig';
import { printHTML, sendToPrinter } from '@/lib/printUtils';
import { useImpressoras, PRINTER_KEY_QRCODES } from '@/contexts/ImpressorasContext';
import { useToast } from '@/contexts/ToastContext';
import { useSystemSettings, type SectorConfig } from '@/hooks/useSystemSettings';
import { getAppBaseUrl } from '@/lib/appUrl';

/* ─── Setor type alias for local use ─── */
type SetorConfig = SectorConfig;

const CORES_OPCOES = [
  { hex: '#f97316', label: 'Laranja' },
  { hex: '#f59e0b', label: 'Âmbar' },
  { hex: '#10b981', label: 'Verde' },
  { hex: '#06b6d4', label: 'Ciano' },
  { hex: '#ec4899', label: 'Rosa' },
  { hex: '#8b5cf6', label: 'Roxo' },
  { hex: '#ef4444', label: 'Vermelho' },
  { hex: '#64748b', label: 'Cinza' },
];

const ICONES_OPCOES = [
  { id: 'ri-home-3-line', label: 'Principal' },
  { id: 'ri-sun-line', label: 'Varanda' },
  { id: 'ri-star-line', label: 'VIP' },
  { id: 'ri-tree-line', label: 'Externo' },
  { id: 'ri-restaurant-line', label: 'Salão' },
  { id: 'ri-cup-line', label: 'Bar' },
  { id: 'ri-building-line', label: 'Terraço' },
  { id: 'ri-group-line', label: 'Eventos' },
];

const SETORES_INICIAIS: SetorConfig[] = [
  { id: 'principal', nome: 'Principal', cor: '#f97316', icone: 'ri-home-3-line' },
  { id: 'varanda', nome: 'Varanda', cor: '#10b981', icone: 'ri-sun-line' },
  { id: 'vip', nome: 'VIP', cor: '#8b5cf6', icone: 'ri-star-line' },
  { id: 'externo', nome: 'Externo', cor: '#06b6d4', icone: 'ri-tree-line' },
];

const FORMATOS: { id: MesaFormato; label: string; icon: string }[] = [
  { id: 'redonda', label: 'Redonda', icon: 'ri-circle-line' },
  { id: 'quadrada', label: 'Quadrada', icon: 'ri-stop-line' },
  { id: 'retangular', label: 'Retangular', icon: 'ri-rectangle-line' },
];

function getMesaUrl(mesa: MesaConfig): string {
  // Usa qr_token do banco (qrCode) quando disponível; fallback para número da mesa
  const token = mesa.qrCode || mesa.numero;
  return `${getAppBaseUrl()}/mesa-qr/${token}`;
}

/* ─── SetorModal ─── */
interface SetorModalProps {
  setor?: SetorConfig | null;
  onSalvar: (s: Omit<SetorConfig, 'id'>) => void;
  onClose: () => void;
}

function SetorModal({ setor, onSalvar, onClose }: SetorModalProps) {
  const [nome, setNome] = useState(setor?.nome ?? '');
  const [cor, setCor] = useState(setor?.cor ?? CORES_OPCOES[0].hex);
  const [icone, setIcone] = useState(setor?.icone ?? ICONES_OPCOES[0].id);

  const handleSalvar = () => {
    if (!nome.trim()) return;
    onSalvar({ nome: nome.trim(), cor, icone });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl w-full max-w-sm">
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-100">
          <h2 className="text-sm font-bold text-zinc-900">{setor ? 'Editar Setor' : 'Novo Setor'}</h2>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-zinc-100 cursor-pointer text-zinc-500">
            <i className="ri-close-line text-base" />
          </button>
        </div>
        <div className="p-6 space-y-5">
          {/* Preview */}
          <div className="flex items-center justify-center">
            <div className="flex items-center gap-3 px-5 py-3 rounded-2xl border-2 border-dashed border-zinc-200">
              <div className="w-9 h-9 flex items-center justify-center rounded-xl" style={{ backgroundColor: `${cor}22` }}>
                <i className={`${icone} text-lg`} style={{ color: cor }} />
              </div>
              <span className="text-sm font-bold text-zinc-800">{nome || 'Nome do setor'}</span>
            </div>
          </div>

          {/* Nome */}
          <div>
            <label className="block text-xs font-semibold text-zinc-600 mb-1.5">Nome do setor</label>
            <input
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              placeholder="Ex: Salão, Varanda, Área VIP..."
              maxLength={30}
              className="w-full text-sm border border-zinc-200 rounded-lg px-3 py-2.5 text-zinc-800 focus:outline-none focus:border-amber-400"
            />
          </div>

          {/* Cor */}
          <div>
            <label className="block text-xs font-semibold text-zinc-600 mb-2">Cor do setor</label>
            <div className="flex gap-2 flex-wrap">
              {CORES_OPCOES.map((c) => (
                <button
                  key={c.hex}
                  onClick={() => setCor(c.hex)}
                  title={c.label}
                  className={`w-8 h-8 rounded-full cursor-pointer transition-all ${cor === c.hex ? 'ring-2 ring-offset-2 ring-zinc-400 scale-110' : 'hover:scale-105'}`}
                  style={{ backgroundColor: c.hex }}
                />
              ))}
            </div>
          </div>

          {/* Ícone */}
          <div>
            <label className="block text-xs font-semibold text-zinc-600 mb-2">Ícone</label>
            <div className="grid grid-cols-4 gap-2">
              {ICONES_OPCOES.map((ic) => (
                <button
                  key={ic.id}
                  onClick={() => setIcone(ic.id)}
                  className={`flex flex-col items-center gap-1 py-2.5 rounded-xl border cursor-pointer transition-all ${icone === ic.id ? 'border-amber-400 bg-amber-50' : 'border-zinc-100 bg-zinc-50 hover:border-zinc-200'}`}
                >
                  <i className={`${ic.id} text-lg ${icone === ic.id ? 'text-amber-500' : 'text-zinc-400'}`} />
                  <span className={`text-[9px] font-semibold ${icone === ic.id ? 'text-amber-700' : 'text-zinc-500'}`}>{ic.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="flex gap-2 px-6 pb-6">
          <button onClick={onClose} className="flex-1 py-2.5 text-sm font-semibold text-zinc-600 bg-zinc-100 rounded-xl hover:bg-zinc-200 cursor-pointer whitespace-nowrap">Cancelar</button>
          <button
            onClick={handleSalvar}
            disabled={!nome.trim()}
            className="flex-1 py-2.5 text-sm font-semibold text-white bg-amber-500 rounded-xl hover:bg-amber-600 cursor-pointer whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {setor ? 'Salvar alterações' : 'Criar setor'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── Confirmar exclusão de setor ─── */
interface ConfirmarExclusaoSetorProps {
  setor: SetorConfig;
  mesasNoSetor: number;
  onConfirmar: () => void;
  onClose: () => void;
}

function ConfirmarExclusaoSetorModal({ setor, mesasNoSetor, onConfirmar, onClose }: ConfirmarExclusaoSetorProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl w-full max-w-sm p-6">
        <div className="w-12 h-12 flex items-center justify-center bg-red-50 rounded-xl mx-auto mb-4">
          <i className="ri-delete-bin-line text-red-500 text-xl" />
        </div>
        <h2 className="text-sm font-bold text-zinc-900 text-center mb-1">Remover setor &ldquo;{setor.nome}&rdquo;?</h2>
        {mesasNoSetor > 0 ? (
          <p className="text-xs text-zinc-500 text-center mb-5">
            Este setor possui <strong>{mesasNoSetor} mesa{mesasNoSetor !== 1 ? 's' : ''}</strong>. As mesas serão movidas para o setor <strong>Principal</strong> automaticamente.
          </p>
        ) : (
          <p className="text-xs text-zinc-500 text-center mb-5">
            O setor será removido permanentemente. Esta ação não pode ser desfeita.
          </p>
        )}
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 py-2.5 text-sm font-semibold text-zinc-600 bg-zinc-100 rounded-xl hover:bg-zinc-200 cursor-pointer whitespace-nowrap">Cancelar</button>
          <button onClick={onConfirmar} className="flex-1 py-2.5 text-sm font-semibold text-white bg-red-500 rounded-xl hover:bg-red-600 cursor-pointer whitespace-nowrap">Remover</button>
        </div>
      </div>
    </div>
  );
}

/* ─── PrintAllQRModal ─── */
interface PrintAllQRModalProps {
  mesas: MesaConfig[];
  nomeLoja: string;
  onClose: () => void;
  impressoraQR?: import('@/contexts/ImpressorasContext').Impressora;
}

function PrintAllQRModal({ mesas, nomeLoja, onClose, impressoraQR }: PrintAllQRModalProps) {
  const printRef = useRef<HTMLDivElement>(null);

  const handlePrint = () => {
    if (!printRef.current) return;
    const printContent = printRef.current.innerHTML;
    const dateStr = new Date().toLocaleDateString('pt-BR');
    const html = '<!DOCTYPE html><html><head><meta charset="utf-8"/><title>QR Codes das Mesas</title>'
      + '<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:system-ui,sans-serif;background:white}'
      + '.header{text-align:center;padding:5mm;border-bottom:1px solid #e4e4e7;margin-bottom:5mm}'
      + '.header h1{font-size:14pt;font-weight:700;color:#09090b}.header p{font-size:8pt;color:#71717a;margin-top:1mm}'
      + '@media print{@page{size:A4;margin:5mm}body{print-color-adjust:exact;-webkit-print-color-adjust:exact}}'
      + '</style></head><body>'
      + '<div class="header"><h1>' + nomeLoja + '</h1><p>QR Codes das Mesas — ' + dateStr + '</p></div>'
      + printContent
      + '</body></html>';
    if (impressoraQR && impressoraQR.ip) {
      sendToPrinter(html, impressoraQR);
    } else {
      printHTML(html);
    }
  };

  const mesasOrdenadas = [...mesas].sort((a, b) => a.numero - b.numero);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-3xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-100 flex-shrink-0">
          <div>
            <h2 className="text-sm font-bold text-zinc-900">Imprimir QR Codes em lote</h2>
            <p className="text-xs text-zinc-400 mt-0.5">Layout 3×3 por página, otimizado para corte em cartões de mesa</p>
          </div>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-zinc-100 cursor-pointer text-zinc-500">
            <i className="ri-close-line text-base" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-6">
          <div className="mb-4 flex items-center gap-3 p-3.5 bg-amber-50 border border-amber-100 rounded-xl">
            <i className="ri-information-line text-amber-600 flex-shrink-0" />
            <p className="text-xs text-amber-800">
              <strong>PDF gerado com {mesas.length} QR Codes</strong> em layout 3×3. Imprima em papel A4 e corte pelas linhas tracejadas. Cada cartão tem 90×90mm.
            </p>
          </div>
          <div className="border border-zinc-200 rounded-xl overflow-hidden bg-zinc-50 p-4">
            <div ref={printRef}>
              <div className="grid grid-cols-3 gap-0">
                {mesasOrdenadas.map((m) => (
                  <div key={m.id} className="border border-dashed border-zinc-300 flex flex-col items-center justify-center p-4 aspect-square">
                    <QRCode value={getMesaUrl(m)} size={90} level="H" bgColor="#ffffff" fgColor="#09090b" style={{ display: 'block' }} />
                    <p className="text-base font-black text-zinc-900 mt-2">Mesa {m.numero}</p>
                    <p className="text-[10px] text-zinc-400">{m.setor}</p>
                    <p className="text-[8px] text-zinc-300 mt-0.5 text-center break-all font-mono">{getMesaUrl(m)}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3 px-6 py-4 border-t border-zinc-100 flex-shrink-0">
          <div className="flex-1 text-xs text-zinc-400">
            {mesas.length} QR Codes · {Math.ceil(mesas.length / 9)} página{Math.ceil(mesas.length / 9) !== 1 ? 's' : ''} A4
          </div>
          <button onClick={onClose} className="px-5 py-2.5 text-sm font-semibold text-zinc-600 bg-zinc-100 rounded-xl hover:bg-zinc-200 cursor-pointer whitespace-nowrap">Cancelar</button>
          <button onClick={handlePrint} className="flex items-center gap-2 px-5 py-2.5 text-sm font-bold text-white bg-zinc-900 rounded-xl hover:bg-zinc-800 cursor-pointer whitespace-nowrap">
            <i className="ri-printer-line text-base" />
            Imprimir / Salvar PDF
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── QR Code Modal ─── */
interface QRModalProps {
  mesa: MesaConfig;
  onRegenerate: () => void;
  onClose: () => void;
}

function QRModal({ mesa, onRegenerate, onClose }: QRModalProps) {
  const [copied, setCopied] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const qrUrl = getMesaUrl(mesa);

  const handleCopy = () => {
    navigator.clipboard.writeText(qrUrl).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownloadPNG = async () => {
    setDownloading(true);
    try {
      const canvas = containerRef.current?.querySelector('canvas');
      if (!canvas) return;
      const outputSize = 400;
      const paddingTop = 20;
      const paddingBottom = 60;
      const totalHeight = outputSize + paddingTop + paddingBottom;
      const outputCanvas = document.createElement('canvas');
      outputCanvas.width = outputSize;
      outputCanvas.height = totalHeight;
      const ctx = outputCanvas.getContext('2d');
      if (!ctx) return;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, outputSize, totalHeight);
      ctx.strokeStyle = '#e4e4e7';
      ctx.lineWidth = 2;
      ctx.strokeRect(1, 1, outputSize - 2, totalHeight - 2);
      ctx.drawImage(canvas, 20, paddingTop, outputSize - 40, outputSize - 40);
      ctx.fillStyle = '#09090b';
      ctx.font = 'bold 20px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`Mesa ${mesa.numero}`, outputSize / 2, outputSize + paddingTop + 28);
      ctx.fillStyle = '#71717a';
      ctx.font = '13px system-ui, sans-serif';
      ctx.fillText(mesa.setor, outputSize / 2, outputSize + paddingTop + 48);
      const link = document.createElement('a');
      link.download = `mesa-${mesa.numero}-qrcode.png`;
      link.href = outputCanvas.toDataURL('image/png');
      link.click();
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl w-full max-w-xs">
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-100">
          <h2 className="text-sm font-bold text-zinc-900">QR Code — Mesa {mesa.numero}</h2>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-zinc-100 cursor-pointer text-zinc-500">
            <i className="ri-close-line text-base" />
          </button>
        </div>
        <div className="p-6 flex flex-col items-center gap-4">
          <div ref={containerRef} className="p-3 bg-white border-2 border-zinc-100 rounded-xl">
            <QRCode value={qrUrl} size={180} level="H" bgColor="#ffffff" fgColor="#09090b" style={{ display: 'block' }} />
          </div>
          <div className="text-center">
            <p className="text-xs font-bold text-zinc-700">Mesa {mesa.numero} — {mesa.setor}</p>
            <p className="text-[10px] text-zinc-400 mt-0.5 break-all font-mono">{qrUrl}</p>
          </div>
          <div className="flex flex-col gap-2 w-full">
            <button onClick={handleDownloadPNG} disabled={downloading}
              className="flex items-center justify-center gap-2 w-full py-2.5 text-xs font-semibold rounded-xl cursor-pointer transition-colors bg-amber-500 text-white hover:bg-amber-600 whitespace-nowrap">
              <i className="ri-download-line" />
              {downloading ? 'Gerando PNG...' : 'Baixar QR Code (PNG)'}
            </button>
            <button onClick={handleCopy}
              className={`flex items-center justify-center gap-2 w-full py-2.5 text-xs font-semibold rounded-xl cursor-pointer transition-colors whitespace-nowrap ${copied ? 'bg-emerald-500 text-white' : 'bg-zinc-100 text-zinc-700 hover:bg-zinc-200'}`}>
              <i className={copied ? 'ri-check-line' : 'ri-clipboard-line'} />
              {copied ? 'URL copiada!' : 'Copiar URL da mesa'}
            </button>
            <button onClick={onRegenerate}
              className="flex items-center justify-center gap-2 w-full py-2 text-xs font-semibold rounded-xl cursor-pointer bg-white border border-zinc-200 text-zinc-600 hover:bg-zinc-50 transition-colors whitespace-nowrap">
              <i className="ri-refresh-line" />
              Regenerar QR Code
            </button>
          </div>
          <p className="text-[10px] text-zinc-400 text-center">O PNG está otimizado para impressão em papel A4 ou cartão de mesa.</p>
        </div>
      </div>
    </div>
  );
}

/* ─── Mesa Modal ─── */
interface MesaModalProps {
  mesa?: MesaConfig | null;
  maxNumero: number;
  setores: SetorConfig[];
  onSalvar: (m: Partial<MesaConfig>) => Promise<void>;
  onClose: () => void;
}

function MesaModal({ mesa, maxNumero, setores, onSalvar, onClose }: MesaModalProps) {
  const [numero, setNumero] = useState(mesa?.numero ?? maxNumero + 1);
  const [capacidade, setCapacidade] = useState(mesa?.capacidade ?? 4);
  const [formato, setFormato] = useState<MesaFormato>(mesa?.formato ?? 'quadrada');
  const [setor, setSetor] = useState<string>(mesa?.setor ?? (setores[0]?.nome ?? 'Principal'));
  const [observacao, setObservacao] = useState(mesa?.observacao ?? '');

  const handleSalvar = async () => {
    await onSalvar({ numero, capacidade, formato, setor, observacao });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-100">
          <h2 className="text-sm font-bold text-zinc-900">{mesa ? `Editar Mesa ${mesa.numero}` : 'Nova Mesa'}</h2>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-zinc-100 cursor-pointer text-zinc-500">
            <i className="ri-close-line text-base" />
          </button>
        </div>
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-zinc-600 mb-1.5">Número da mesa</label>
              <input type="number" min={1} max={999} value={numero}
                onChange={(e) => setNumero(parseInt(e.target.value) || 1)}
                className="w-full text-sm border border-zinc-200 rounded-lg px-3 py-2.5 text-zinc-800 focus:outline-none focus:border-amber-400" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-zinc-600 mb-1.5">Capacidade (pessoas)</label>
              <input type="number" min={1} max={50} value={capacidade}
                onChange={(e) => setCapacidade(parseInt(e.target.value) || 1)}
                className="w-full text-sm border border-zinc-200 rounded-lg px-3 py-2.5 text-zinc-800 focus:outline-none focus:border-amber-400" />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-zinc-600 mb-2">Formato</label>
            <div className="flex gap-2">
              {FORMATOS.map((f) => (
                <button key={f.id} onClick={() => setFormato(f.id)}
                  className={`flex-1 flex flex-col items-center gap-1.5 py-3 rounded-xl border-2 cursor-pointer transition-all ${formato === f.id ? 'border-amber-400 bg-amber-50' : 'border-zinc-100 bg-zinc-50 hover:border-zinc-200'}`}>
                  <i className={`${f.icon} text-xl ${formato === f.id ? 'text-amber-500' : 'text-zinc-400'}`} />
                  <span className={`text-[10px] font-semibold ${formato === f.id ? 'text-amber-700' : 'text-zinc-500'}`}>{f.label}</span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-zinc-600 mb-2">Setor / Área</label>
            <div className="grid grid-cols-2 gap-2">
              {setores.map((s) => (
                <button key={s.id} onClick={() => setSetor(s.nome)}
                  className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border cursor-pointer transition-all ${setor === s.nome ? 'border-amber-400 bg-amber-50' : 'border-zinc-100 bg-zinc-50 hover:border-zinc-200'}`}>
                  <div className="w-5 h-5 flex items-center justify-center flex-shrink-0">
                    <i className={`${s.icone} text-sm`} style={{ color: setor === s.nome ? s.cor : '#a1a1aa' }} />
                  </div>
                  <span className={`text-xs font-semibold ${setor === s.nome ? 'text-amber-700' : 'text-zinc-600'}`}>{s.nome}</span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-zinc-600 mb-1.5">Observação (opcional)</label>
            <input value={observacao} onChange={(e) => setObservacao(e.target.value)}
              placeholder="Ex: Próximo à janela, mesa com tomada..."
              className="w-full text-sm border border-zinc-200 rounded-lg px-3 py-2.5 text-zinc-800 focus:outline-none focus:border-amber-400" />
          </div>
        </div>
        <div className="flex gap-2 px-6 pb-6">
          <button onClick={onClose} className="flex-1 py-2.5 text-sm font-semibold text-zinc-600 bg-zinc-100 rounded-xl hover:bg-zinc-200 cursor-pointer whitespace-nowrap">Cancelar</button>
          <button onClick={handleSalvar} className="flex-1 py-2.5 text-sm font-semibold text-white bg-amber-500 rounded-xl hover:bg-amber-600 cursor-pointer whitespace-nowrap">
            {mesa ? 'Salvar alterações' : 'Criar mesa'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── Confirmar exclusão de mesa ─── */
function ConfirmarExclusaoModal({ mesa, onConfirmar, onClose }: { mesa: MesaConfig; onConfirmar: () => void; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl w-full max-w-sm p-6">
        <div className="w-12 h-12 flex items-center justify-center bg-red-50 rounded-xl mx-auto mb-4">
          <i className="ri-delete-bin-line text-red-500 text-xl" />
        </div>
        <h2 className="text-sm font-bold text-zinc-900 text-center mb-1">Remover Mesa {mesa.numero}?</h2>
        <p className="text-xs text-zinc-500 text-center mb-5">
          Isso remove a mesa permanentemente. Pedidos abertos nesta mesa precisam ser fechados antes.
        </p>
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 py-2.5 text-sm font-semibold text-zinc-600 bg-zinc-100 rounded-xl hover:bg-zinc-200 cursor-pointer whitespace-nowrap">Cancelar</button>
          <button onClick={onConfirmar} className="flex-1 py-2.5 text-sm font-semibold text-white bg-red-500 rounded-xl hover:bg-red-600 cursor-pointer whitespace-nowrap">Remover</button>
        </div>
      </div>
    </div>
  );
}

/* ─── Main ─── */
export default function MesasConfigTab() {
  const { settings, salvar: salvarSettings } = useSystemSettings();
  const { getImpressoraParaEstacao } = useImpressoras();
  const [setores, setSetores] = useState<SectorConfig[]>(SETORES_INICIAIS);
  const setoresCarregadosRef = useRef(false);

  // Load sectors from DB on first load
  useEffect(() => {
    if (setoresCarregadosRef.current) return;
    if (settings.sectors_config && settings.sectors_config.length > 0) {
      setSetores(settings.sectors_config);
      setoresCarregadosRef.current = true;
    }
  }, [settings.sectors_config]);

  // Persist sectors to DB whenever they change (after initial load)
  const persistSetores = useCallback(async (novosSetores: SectorConfig[]) => {
    await salvarSettings({ sectors_config: novosSetores });
  }, [salvarSettings]);

  const { mesas: mesasDB, loading: loadingMesas, criarMesa, editarMesa, excluirMesa: excluirMesaDB, regenerarQR: regenerarQRDB } = useTablesConfig();
  const { success: toastSuccess, error: toastError } = useToast();
  const [mesas, setMesas] = useState<MesaConfig[]>([]);
  useEffect(() => { if (mesasDB.length > 0 || !loadingMesas) setMesas(mesasDB); }, [mesasDB, loadingMesas]);
  const [filtroSetor, setFiltroSetor] = useState<string>('Todos');

  const [mesaModal, setMesaModal] = useState<MesaConfig | 'new' | null>(null);
  const [qrModal, setQrModal] = useState<MesaConfig | null>(null);
  const [excluirModal, setExcluirModal] = useState<MesaConfig | null>(null);
  const [printAllModal, setPrintAllModal] = useState(false);
  const [regeneradoTodos, setRegeneradoTodos] = useState(false);

  const [setorModal, setSetorModal] = useState<SectorConfig | 'new' | null>(null);
  const [excluirSetorModal, setExcluirSetorModal] = useState<SectorConfig | null>(null);

  const maxNumero = Math.max(...mesas.map((m) => m.numero), 0);
  const filtradas = filtroSetor === 'Todos' ? mesas : mesas.filter((m) => m.setor === filtroSetor);

  /* Setor helpers */
  const getSetorConfig = (nome: string) => setores.find((s) => s.nome === nome);

  const handleSalvarSetor = useCallback(async (dados: Omit<SectorConfig, 'id'>) => {
    let novosSetores: SectorConfig[];
    if (setorModal === 'new') {
      const novo: SectorConfig = { id: `s${Date.now()}`, ...dados };
      novosSetores = [...setores, novo];
    } else if (setorModal && setorModal !== 'new') {
      const nomeAntigo = setorModal.nome;
      novosSetores = setores.map((s) => s.id === setorModal.id ? { ...s, ...dados } : s);
      if (nomeAntigo !== dados.nome) {
        setMesas((prev) => prev.map((m) => m.setor === nomeAntigo ? { ...m, setor: dados.nome } : m));
      }
    } else {
      return;
    }
    setSetores(novosSetores);
    await persistSetores(novosSetores);
  }, [setorModal, setores, persistSetores]);

  const handleExcluirSetor = useCallback(async (setor: SectorConfig) => {
    const principal = setores.find((s) => s.id !== setor.id);
    const fallback = principal?.nome ?? 'Principal';
    setMesas((prev) => prev.map((m) => m.setor === setor.nome ? { ...m, setor: fallback } : m));
    const novosSetores = setores.filter((s) => s.id !== setor.id);
    setSetores(novosSetores);
    await persistSetores(novosSetores);
    if (filtroSetor === setor.nome) setFiltroSetor('Todos');
    setExcluirSetorModal(null);
  }, [setores, filtroSetor, persistSetores]);

  /* Mesa helpers — persistidos no banco */
  const handleSalvarMesa = useCallback(async (dados: Partial<MesaConfig>) => {
    if (mesaModal === 'new') {
      const { mesa, error } = await criarMesa({
        numero: dados.numero ?? maxNumero + 1,
        capacidade: dados.capacidade ?? 4,
        formato: dados.formato ?? 'quadrada',
        setor: dados.setor ?? (setores[0]?.nome ?? 'Principal'),
        observacao: dados.observacao,
        x: 50, y: 50,
        status: 'livre',
      });
      if (error) {
        toastError(`Erro ao criar mesa: ${error}`, 'error');
      } else if (mesa) {
        toastSuccess(`Mesa ${mesa.numero} criada com sucesso!`);
      }
    } else if (mesaModal && mesaModal !== 'new') {
      const { success, error } = await editarMesa(mesaModal.id, dados);
      if (error) {
        toastError(`Erro ao editar mesa: ${error}`);
      } else if (success) {
        toastSuccess('Mesa atualizada!');
      }
    }
  }, [mesaModal, maxNumero, setores, criarMesa, editarMesa, toastSuccess, toastError]);

  const handleRegenerarQR = useCallback(async (id: string) => {
    const { success, error } = await regenerarQRDB(id);
    if (error) {
      toastError(`Erro ao regenerar QR: ${error}`, 'error');
      return;
    }
    if (success) {
      setQrModal((prev) => {
        if (!prev || prev.id !== id) return prev;
        return prev;
      });
      toastSuccess('QR Code regenerado com sucesso!', 'success');
    }
  }, [regenerarQRDB, toastSuccess, toastError]);

  const handleRegenerarTodos = async () => {
    const results = await Promise.all(mesas.map((m) => regenerarQRDB(m.id)));
    const erros = results.filter(r => r.error);
    if (erros.length > 0) {
      toastError(`${erros.length} QR(s) falharam ao regenerar`);
    } else {
      toastSuccess(`${erros.length === 0 ? 'Todos QR Codes regenerados!' : 'QR Codes regenerados!'}`);
      setTimeout(() => setRegeneradoTodos(false), 2500);
    }
  };

  const handleExcluirMesa = useCallback(async (id: string) => {
    const { success, error } = await excluirMesaDB(id);
    if (error) {
      toastError(`Erro ao excluir mesa: ${error}`, 'error');
    } else if (success) {
      toastSuccess('Mesa removida', 'success');
    }
    setExcluirModal(null);
  }, [excluirMesaDB, toastSuccess, toastError]);

  const formatoIcon: Record<MesaFormato, string> = {
    redonda: 'ri-circle-line', quadrada: 'ri-stop-line', retangular: 'ri-rectangle-line',
  };

  return (
    <div className="max-w-4xl space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-bold text-zinc-800">Configuração de Mesas</h3>
          <p className="text-xs text-zinc-400 mt-0.5">Gerencie setores, mesas, capacidades e QR Codes.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setPrintAllModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg cursor-pointer transition-colors whitespace-nowrap bg-zinc-900 text-white hover:bg-zinc-800">
            <i className="ri-printer-line" />
            Imprimir todos QR
          </button>
          <button onClick={handleRegenerarTodos}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg cursor-pointer transition-colors whitespace-nowrap ${regeneradoTodos ? 'bg-emerald-500 text-white' : 'bg-zinc-100 text-zinc-700 hover:bg-zinc-200'}`}>
            <i className={regeneradoTodos ? 'ri-check-line' : 'ri-refresh-line'} />
            {regeneradoTodos ? 'Regenerados!' : 'Regenerar QR'}
          </button>
          <button onClick={() => setMesaModal('new')}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500 text-white text-xs font-semibold rounded-lg hover:bg-amber-600 cursor-pointer transition-colors whitespace-nowrap">
            <i className="ri-add-line" />Nova mesa
          </button>
        </div>
      </div>

      {/* ─── SETORES ─── */}
      <div className="bg-white border border-zinc-100 rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-zinc-100">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 flex items-center justify-center">
              <i className="ri-layout-column-line text-zinc-500 text-sm" />
            </div>
            <div>
              <p className="text-xs font-bold text-zinc-800">Setores e Áreas</p>
              <p className="text-[10px] text-zinc-400">{setores.length} setor{setores.length !== 1 ? 'es' : ''} configurado{setores.length !== 1 ? 's' : ''}</p>
            </div>
          </div>
          <button onClick={() => setSetorModal('new')}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-900 text-white text-xs font-semibold rounded-lg hover:bg-zinc-700 cursor-pointer transition-colors whitespace-nowrap">
            <i className="ri-add-line" />
            Novo setor
          </button>
        </div>

        <div className="p-4">
          <div className="grid grid-cols-2 gap-3">
            {setores.map((s) => {
              const count = mesas.filter((m) => m.setor === s.nome).length;
              const isPrincipal = setores.indexOf(s) === 0;
              return (
                <div key={s.id} className="flex items-center gap-3 p-3.5 rounded-xl border border-zinc-100 bg-zinc-50 group">
                  {/* Icon */}
                  <div className="w-10 h-10 flex items-center justify-center rounded-xl flex-shrink-0" style={{ backgroundColor: `${s.cor}18` }}>
                    <i className={`${s.icone} text-lg`} style={{ color: s.cor }} />
                  </div>
                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <p className="text-xs font-bold text-zinc-800 truncate">{s.nome}</p>
                      {isPrincipal && (
                        <span className="text-[9px] font-semibold bg-zinc-200 text-zinc-500 px-1.5 py-0.5 rounded-full whitespace-nowrap">Padrão</span>
                      )}
                    </div>
                    <p className="text-[10px] text-zinc-400 mt-0.5">{count} mesa{count !== 1 ? 's' : ''}</p>
                  </div>
                  {/* Dot de cor */}
                  <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: s.cor }} />
                  {/* Actions */}
                  <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => setSetorModal(s)}
                      className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-amber-50 text-zinc-400 hover:text-amber-600 cursor-pointer transition-colors"
                      title="Editar setor"
                    >
                      <i className="ri-pencil-line text-sm" />
                    </button>
                    <button
                      onClick={() => setExcluirSetorModal(s)}
                      disabled={setores.length <= 1}
                      className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-red-50 text-zinc-400 hover:text-red-400 cursor-pointer transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                      title={setores.length <= 1 ? 'Não é possível remover o único setor' : 'Remover setor'}
                    >
                      <i className="ri-delete-bin-line text-sm" />
                    </button>
                  </div>
                </div>
              );
            })}

            {/* Add new setor card */}
            <button
              onClick={() => setSetorModal('new')}
              className="flex items-center gap-3 p-3.5 rounded-xl border border-dashed border-zinc-200 hover:border-amber-300 hover:bg-amber-50/50 cursor-pointer transition-all group"
            >
              <div className="w-10 h-10 flex items-center justify-center rounded-xl bg-zinc-100 group-hover:bg-amber-100 transition-colors">
                <i className="ri-add-line text-zinc-400 group-hover:text-amber-500 text-lg transition-colors" />
              </div>
              <span className="text-xs font-semibold text-zinc-400 group-hover:text-amber-600 transition-colors">Adicionar setor</span>
            </button>
          </div>
        </div>
      </div>

      {/* ─── FILTRO + CONTADORES ─── */}
      <div className="grid grid-cols-6 gap-3">
        <div
          className={`bg-white border rounded-xl p-3 cursor-pointer transition-all col-span-1 ${filtroSetor === 'Todos' ? 'border-amber-400' : 'border-zinc-100 hover:border-zinc-200'}`}
          onClick={() => setFiltroSetor('Todos')}
        >
          <p className={`text-xl font-black ${filtroSetor === 'Todos' ? 'text-amber-600' : 'text-zinc-900'}`}>{mesas.length}</p>
          <p className="text-[10px] text-zinc-500 mt-0.5">Todas</p>
        </div>
        {setores.map((s) => {
          const count = mesas.filter((m) => m.setor === s.nome).length;
          return (
            <div key={s.id}
              className={`bg-white border rounded-xl p-3 cursor-pointer transition-all ${filtroSetor === s.nome ? 'border-amber-400' : 'border-zinc-100 hover:border-zinc-200'}`}
              onClick={() => setFiltroSetor(s.nome)}
            >
              <div className="flex items-center gap-1.5 mb-0.5">
                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: s.cor }} />
                <p className={`text-xl font-black ${filtroSetor === s.nome ? 'text-amber-600' : 'text-zinc-900'}`}>{count}</p>
              </div>
              <p className="text-[10px] text-zinc-500 truncate">{s.nome}</p>
            </div>
          );
        })}
      </div>

      <div className="flex items-start gap-2.5 px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl">
        <i className="ri-qr-code-line text-amber-500 text-sm flex-shrink-0 mt-0.5" />
        <p className="text-xs text-amber-800">
          <strong>QR Codes reais:</strong> clique em &ldquo;Ver QR&rdquo; para visualizar o QR Code escaneável e <strong>baixar em PNG</strong> para impressão ou uso em papel de mesa.
        </p>
      </div>

      {/* ─── TABLE ─── */}
      <div className="bg-white border border-zinc-100 rounded-xl overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-zinc-50 border-b border-zinc-100">
            <tr>
              <th className="px-4 py-3 text-left font-semibold text-zinc-500 w-16">Mesa</th>
              <th className="px-4 py-3 text-left font-semibold text-zinc-500 w-28">Setor</th>
              <th className="px-4 py-3 text-left font-semibold text-zinc-500">Capacidade</th>
              <th className="px-4 py-3 text-left font-semibold text-zinc-500">Formato</th>
              <th className="px-4 py-3 text-left font-semibold text-zinc-500">Observação</th>
              <th className="px-4 py-3 text-left font-semibold text-zinc-500">QR Code</th>
              <th className="px-4 py-3 text-right font-semibold text-zinc-500 w-28">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-50">
            {filtradas.sort((a, b) => a.numero - b.numero).map((m) => {
              const sc = getSetorConfig(m.setor);
              return (
                <tr key={m.id} className="hover:bg-zinc-50 transition-colors">
                  <td className="px-4 py-3">
                    <span className="w-8 h-8 flex items-center justify-center bg-amber-100 rounded-lg font-black text-amber-700">{m.numero}</span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      {sc && <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: sc.cor }} />}
                      <span className="text-xs text-zinc-600 font-medium">{m.setor}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      <i className="ri-group-line text-zinc-400" />
                      <span className="font-semibold text-zinc-700">{m.capacidade} pax</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      <i className={`${formatoIcon[m.formato]} text-zinc-400`} />
                      <span className="text-zinc-600 capitalize">{m.formato}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 max-w-[140px]">
                    {m.observacao ? <p className="text-zinc-500 truncate">{m.observacao}</p> : <span className="text-zinc-300">—</span>}
                  </td>
                  <td className="px-4 py-3">
                    <button onClick={() => setQrModal(m)}
                      className="flex items-center gap-1.5 text-[10px] font-semibold text-zinc-500 bg-zinc-100 hover:bg-zinc-200 px-2.5 py-1.5 rounded-lg cursor-pointer transition-colors whitespace-nowrap">
                      <i className="ri-qr-code-line text-sm" />
                      Ver QR
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={() => setMesaModal(m)} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-amber-50 text-zinc-400 hover:text-amber-600 cursor-pointer transition-colors">
                        <i className="ri-pencil-line text-sm" />
                      </button>
                      <button onClick={() => setExcluirModal(m)} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-red-50 text-zinc-400 hover:text-red-400 cursor-pointer transition-colors">
                        <i className="ri-delete-bin-line text-sm" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {filtradas.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16">
            <div className="w-12 h-12 flex items-center justify-center bg-zinc-100 rounded-2xl mb-3">
              <i className="ri-layout-grid-line text-zinc-300 text-xl" />
            </div>
            <p className="text-sm font-semibold text-zinc-500">Nenhuma mesa neste setor</p>
            <button onClick={() => setMesaModal('new')} className="mt-3 text-xs text-amber-600 font-semibold hover:underline cursor-pointer">+ Adicionar mesa</button>
          </div>
        )}
      </div>

      {/* Resumo */}
      <div className="bg-white border border-zinc-100 rounded-xl p-4">
        <p className="text-xs font-bold text-zinc-500 uppercase tracking-wide mb-3">Resumo de capacidade</p>
        <div className="grid grid-cols-4 gap-3">
          {[
            { label: 'Total de mesas', value: mesas.length, icon: 'ri-layout-grid-line' },
            { label: 'Capacidade total', value: `${mesas.reduce((acc, m) => acc + m.capacidade, 0)} lugares`, icon: 'ri-group-line' },
            { label: 'Cap. média', value: `${(mesas.reduce((acc, m) => acc + m.capacidade, 0) / Math.max(mesas.length, 1)).toFixed(1)} pax`, icon: 'ri-bar-chart-2-line' },
            { label: 'Mesas 2 pax', value: mesas.filter((m) => m.capacidade <= 2).length, icon: 'ri-user-2-line' },
          ].map(({ label, value, icon }) => (
            <div key={label} className="text-center">
              <div className="w-8 h-8 flex items-center justify-center bg-zinc-100 rounded-lg mx-auto mb-1.5">
                <i className={`${icon} text-zinc-500 text-sm`} />
              </div>
              <p className="text-sm font-black text-zinc-800">{value}</p>
              <p className="text-[10px] text-zinc-400">{label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Modals */}
      {mesaModal && (
        <MesaModal
          mesa={mesaModal === 'new' ? null : mesaModal}
          maxNumero={maxNumero}
          setores={setores}
          onSalvar={handleSalvarMesa}
          onClose={() => setMesaModal(null)}
        />
      )}
      {qrModal && (
        <QRModal
          mesa={qrModal}
          onRegenerate={() => handleRegenerarQR(qrModal.id)}
          onClose={() => setQrModal(null)}
        />
      )}
      {excluirModal && (
        <ConfirmarExclusaoModal
          mesa={excluirModal}
          onConfirmar={() => handleExcluirMesa(excluirModal.id)}
          onClose={() => setExcluirModal(null)}
        />
      )}
      {printAllModal && (
        <PrintAllQRModal
          mesas={filtradas.length > 0 ? filtradas : mesas}
          nomeLoja="Meu Restaurante"
          onClose={() => setPrintAllModal(false)}
          impressoraQR={getImpressoraParaEstacao(PRINTER_KEY_QRCODES)}
        />
      )}
      {setorModal && (
        <SetorModal
          setor={setorModal === 'new' ? null : setorModal}
          onSalvar={handleSalvarSetor}
          onClose={() => setSetorModal(null)}
        />
      )}
      {excluirSetorModal && (
        <ConfirmarExclusaoSetorModal
          setor={excluirSetorModal}
          mesasNoSetor={mesas.filter((m) => m.setor === excluirSetorModal.nome).length}
          onConfirmar={() => handleExcluirSetor(excluirSetorModal)}
          onClose={() => setExcluirSetorModal(null)}
        />
      )}
    </div>
  );
}