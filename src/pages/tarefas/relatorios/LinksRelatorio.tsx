/**
 * Links de arquivos na nuvem anexados ao relatório (Drive, OneDrive, Dropbox…).
 * O arquivo continua na nuvem de quem compartilhou; aqui fica só o endereço.
 */
import { useState } from 'react';
import { Cloud, ExternalLink, Plus, Trash2, Loader2 } from 'lucide-react';
import type { LinkRel } from './api';

/** Nome do serviço pelo endereço, para mostrar ao lado do link. */
export function servicoDoLink(url: string): string {
  try {
    const h = new URL(url).hostname.replace(/^www\./, '');
    if (/drive\.google|docs\.google/.test(h)) return 'Google Drive';
    if (/onedrive|sharepoint|1drv\.ms/.test(h)) return 'OneDrive';
    if (/dropbox/.test(h)) return 'Dropbox';
    if (/icloud/.test(h)) return 'iCloud';
    if (/wetransfer|we\.tl/.test(h)) return 'WeTransfer';
    if (/box\.com/.test(h)) return 'Box';
    return h;
  } catch {
    return '';
  }
}

export default function LinksRelatorio({ links, podeEditar, onSalvar }: {
  links: LinkRel[];
  podeEditar: boolean;
  onSalvar?: (links: LinkRel[]) => Promise<boolean>;
}) {
  const [adicionando, setAdicionando] = useState(false);
  const [url, setUrl] = useState('');
  const [titulo, setTitulo] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [gravando, setGravando] = useState(false);

  if (!links.length && !podeEditar) return null;

  const adicionar = async () => {
    let u = url.trim();
    if (u && !/^https?:\/\//i.test(u)) u = `https://${u}`;
    try { new URL(u); } catch { setErro('Cole o endereço completo do link'); return; }
    setErro(null);
    setGravando(true);
    const ok = await onSalvar?.([...links, { url: u, title: titulo.trim() || null }]);
    setGravando(false);
    if (ok) { setUrl(''); setTitulo(''); setAdicionando(false); }
  };

  return (
    <section className="bg-white rounded-xl border border-slate-200 p-4 mt-3">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold text-slate-700 flex items-center gap-1.5 flex-1"><Cloud size={15} /> Arquivos ({links.length})</h2>
        {podeEditar && !adicionando && (
          <button onClick={() => setAdicionando(true)} className="text-sm text-indigo-600 hover:underline flex items-center gap-1"><Plus size={14} /> Link de arquivo</button>
        )}
      </div>
      {!links.length && !adicionando && (
        <p className="text-sm text-slate-400 mt-1">Para mandar um arquivo, cole o link de compartilhamento da nuvem (Drive, OneDrive, Dropbox…).</p>
      )}
      {links.length > 0 && (
        <ul className="mt-2 space-y-1.5">
          {links.map((l, i) => (
            <li key={`${l.url}-${i}`} className="flex items-center gap-2">
              <a
                href={l.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 min-w-0 flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-200 hover:border-indigo-300 hover:bg-indigo-50/40"
              >
                <ExternalLink size={15} className="text-indigo-500 shrink-0" />
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-slate-700 truncate">{l.title || l.url}</span>
                  <span className="block text-[11px] text-slate-400 truncate">{servicoDoLink(l.url)}</span>
                </span>
              </a>
              {podeEditar && (
                <button
                  onClick={() => onSalvar?.(links.filter((_, j) => j !== i))}
                  className="p-1.5 text-slate-300 hover:text-red-500"
                  title="Tirar link"
                >
                  <Trash2 size={15} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {adicionando && (
        <div className="mt-2 space-y-2 rounded-lg border border-slate-200 p-3">
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            autoFocus
            maxLength={1000}
            placeholder="Cole o link de compartilhamento (https://…)"
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-base md:text-sm"
          />
          <input
            value={titulo}
            onChange={(e) => setTitulo(e.target.value)}
            maxLength={200}
            placeholder="Nome do arquivo (opcional) — ex.: Projeto hidrossanitário rev. 3"
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-base md:text-sm"
          />
          <p className="text-[11px] text-slate-400">Confira na nuvem se o link está liberado para "qualquer pessoa com o link" — senão quem recebe não consegue abrir.</p>
          {erro && <p className="text-sm text-red-600">{erro}</p>}
          <div className="flex justify-end gap-2">
            <button onClick={() => { setAdicionando(false); setErro(null); }} className="px-3 py-1.5 rounded-lg text-sm text-slate-500 hover:bg-slate-100">Cancelar</button>
            <button
              onClick={adicionar}
              disabled={!url.trim() || gravando}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium bg-indigo-600 text-white disabled:opacity-50"
            >
              {gravando && <Loader2 size={14} className="animate-spin" />} Adicionar
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
