// Janela única "Adicionar currículos": empresa, vaga, área de arrastar e fila de leitura.
// Estado inteiro é controlado por page.tsx (não duplica queue/dragOver/empresaUpload/vagaUpload aqui).
import type { Company, Job } from '../shared';
import type { QueueItem } from '../page';

interface Props {
  open: boolean;
  onClose: () => void;
  empresas: Company[];
  empresaId: string;
  onEmpresaChange: (id: string) => void;
  vagas: Job[];
  vagaId: string;
  onVagaChange: (id: string) => void;
  dragOver: boolean;
  onDragOver: (v: boolean) => void;
  onPickFiles: () => void;
  onDropFiles: (files: FileList) => void;
  queue: QueueItem[];
  onClearQueue: () => void;
  lendo: number;
}

export default function UploadCurriculosModal({
  open, onClose, empresas, empresaId, onEmpresaChange, vagas, vagaId, onVagaChange,
  dragOver, onDragOver, onPickFiles, onDropFiles, queue, onClearQueue, lendo,
}: Props) {
  if (!open) return null;
  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-[60]" onClick={onClose} />
      <div className="fixed inset-x-0 bottom-0 sm:inset-auto sm:top-1/2 sm:left-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 z-[70] w-full sm:max-w-lg max-h-[90vh] bg-white sm:rounded-2xl rounded-t-2xl shadow-2xl flex flex-col">
        <div className="px-5 py-4 border-b border-zinc-100">
          <div className="flex items-center gap-3">
            <i className="ri-upload-2-line text-xl text-rose-600" />
            <h2 className="flex-1 font-black text-zinc-900">Adicionar currículos</h2>
            <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-zinc-100 text-zinc-500 cursor-pointer"><i className="ri-close-line text-lg" /></button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {/* Área de soltar */}
          <div
            onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); onDragOver(true); } }}
            onDragLeave={() => onDragOver(false)}
            onDrop={(e) => { if (e.dataTransfer.files.length) { e.preventDefault(); onDragOver(false); onDropFiles(e.dataTransfer.files); } }}
            className={`mb-4 rounded-2xl border-2 border-dashed px-4 py-3 flex flex-wrap items-center justify-center gap-3 transition-colors ${
              dragOver ? 'border-rose-400 bg-rose-50' : 'border-zinc-200 bg-zinc-50/60'}`}
          >
            <button onClick={onPickFiles} className="flex items-center gap-2 text-left cursor-pointer">
              <i className="ri-file-user-line text-2xl text-rose-400" />
              <span>
                <span className="hidden sm:block text-sm font-semibold text-zinc-700">Arraste PDFs ou fotos de currículos aqui</span>
                <span className="sm:hidden block text-sm font-semibold text-zinc-700">Toque para escolher PDF ou tirar foto</span>
                <span className="block text-xs text-zinc-400">Vários de uma vez. PDF com texto é lido de graça; foto vai para a IA.</span>
              </span>
            </button>
            {empresas.length > 0 && (
              <label className="flex items-center gap-2 text-xs font-semibold text-zinc-600">
                Salvar em
                <select value={empresaId} onChange={(e) => onEmpresaChange(e.target.value)}
                  className="h-8 px-2 rounded-lg border border-zinc-200 text-xs bg-white cursor-pointer">
                  {empresas.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  <option value="">Sem empresa</option>
                </select>
              </label>
            )}
            {vagas.length > 0 && (
              <label className="flex items-center gap-2 text-xs font-semibold text-zinc-600">
                Vaga
                <select value={vagaId} onChange={(e) => onVagaChange(e.target.value)}
                  className="h-8 px-2 rounded-lg border border-zinc-200 text-xs bg-white cursor-pointer max-w-[200px]">
                  <option value="">Só no banco</option>
                  {vagas.map((j) => <option key={j.id} value={j.id}>{j.title}</option>)}
                </select>
              </label>
            )}
          </div>

          {/* Fila de leitura */}
          {queue.length > 0 && (
            <div className="mb-4 rounded-2xl border border-zinc-200 bg-white overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2 border-b border-zinc-100">
                <p className="text-xs font-bold text-zinc-600">{lendo > 0 ? `Lendo ${lendo} currículo${lendo > 1 ? 's' : ''}…` : 'Leitura concluída'}</p>
                {lendo === 0 && <button onClick={onClearQueue} className="text-xs text-zinc-400 hover:text-zinc-700 cursor-pointer">Limpar</button>}
              </div>
              <ul className="max-h-48 overflow-y-auto divide-y divide-zinc-50">
                {queue.map((q) => (
                  <li key={q.key} className="flex items-center gap-3 px-4 py-2 text-xs">
                    {q.state === 'lendo' && <div className="w-3.5 h-3.5 border-2 border-rose-500 border-t-transparent rounded-full animate-spin flex-shrink-0" />}
                    {q.state === 'ok' && <i className="ri-checkbox-circle-fill text-emerald-500 text-sm" />}
                    {q.state === 'erro' && <i className="ri-error-warning-fill text-red-500 text-sm" />}
                    <span className="font-medium text-zinc-700 truncate max-w-[40%]">{q.name}</span>
                    {q.msg && <span className={`truncate ${q.state === 'erro' ? 'text-red-600' : 'text-zinc-500'}`}>{q.msg}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
