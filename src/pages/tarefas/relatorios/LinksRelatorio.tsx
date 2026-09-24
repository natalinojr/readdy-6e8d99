/**
 * Links de arquivos na nuvem anexados ao relatório (Drive, OneDrive, Dropbox…).
 * O arquivo continua na nuvem de quem compartilhou; aqui fica só o endereço.
 */
import { useState } from 'react';
import { Cloud, ExternalLink, Plus, Trash2, Loader2, Link2, X } from 'lucide-react';
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

/** Links como etiquetas clicáveis (no item, na resposta e no rascunho). */
export function ChipsLinks({ links, onRemover }: { links: LinkRel[]; onRemover?: (i: number) => void }) {
  if (!links.length) return null;
  return (
    <div className="flex flex-wrap gap-2 mt-2">
      {links.map((l, i) => (
        <span key={`${l.url}-${i}`} className="inline-flex items-center max-w-full rounded-xl border border-slate-200 bg-white hover:border-indigo-300 transition">
          <a href={l.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 pl-2.5 pr-2 py-1.5 min-w-0">
            <Cloud size={14} className="text-sky-500 shrink-0" />
            <span className="min-w-0">
              <span className="block text-xs font-medium text-slate-700 truncate max-w-[220px]">{l.title || l.url}</span>
              <span className="block text-[10px] text-slate-400 truncate max-w-[220px]">{servicoDoLink(l.url)}</span>
            </span>
            <ExternalLink size={12} className="text-slate-300 shrink-0" />
          </a>
          {onRemover && (
            <button type="button" onClick={() => onRemover(i)} className="p-1.5 text-slate-300 hover:text-red-500 border-l border-slate-100" title="Tirar link">
              <X size={13} />
            </button>
          )}
        </span>
      ))}
    </div>
  );
}

/**
 * Anexar link de arquivo na nuvem num formulário (item ou resposta):
 * `botao` vai ao lado de "Imagem", `painel` abre o campo do link, `chips` mostra o que já entrou.
 */
export function useLinks(iniciais: LinkRel[] = []) {
  const [links, setLinks] = useState<LinkRel[]>(iniciais);
  const [aberto, setAberto] = useState(false);
  const [url, setUrl] = useState('');
  const [titulo, setTitulo] = useState('');
  const [erro, setErro] = useState<string | null>(null);

  const incluir = () => {
    let u = url.trim();
    if (u && !/^https?:\/\//i.test(u)) u = `https://${u}`;
    try { new URL(u); } catch { setErro('Cole o endereço completo do link'); return; }
    setLinks((a) => [...a, { url: u, title: titulo.trim() || null }]);
    setUrl(''); setTitulo(''); setErro(null); setAberto(false);
  };

  const botao = (
    <button
      type="button"
      onClick={() => setAberto((v) => !v)}
      disabled={links.length >= 30}
      title="Anexar link de arquivo da nuvem (Drive, OneDrive, Dropbox…)"
      className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm border disabled:opacity-50 ${aberto ? 'border-indigo-200 bg-indigo-50 text-indigo-700' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}
    >
      <Link2 size={16} /> Link
    </button>
  );

  const painel = aberto ? (
    <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-2.5 space-y-2">
      <input
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); incluir(); } }}
        autoFocus
        maxLength={1000}
        placeholder="Cole o link de compartilhamento da nuvem (https://…)"
        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-base md:text-sm"
      />
      <div className="flex flex-wrap gap-2">
        <input
          value={titulo}
          onChange={(e) => setTitulo(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); incluir(); } }}
          maxLength={200}
          placeholder="Nome do arquivo (opcional)"
          className="flex-1 min-w-[160px] rounded-lg border border-slate-200 bg-white px-3 py-2 text-base md:text-sm"
        />
        <button type="button" onClick={() => { setAberto(false); setErro(null); }} className="px-3 py-2 rounded-lg text-sm text-slate-500 hover:bg-white">Cancelar</button>
        <button type="button" onClick={incluir} disabled={!url.trim()} className="px-3 py-2 rounded-lg text-sm font-medium bg-indigo-600 text-white disabled:opacity-50">Incluir link</button>
      </div>
      {erro && <p className="text-sm text-red-600">{erro}</p>}
      <p className="text-[11px] text-slate-400">Deixe o link liberado para "qualquer pessoa com o link" na nuvem.</p>
    </div>
  ) : null;

  return {
    links, botao, painel,
    chips: <ChipsLinks links={links} onRemover={(i) => setLinks((a) => a.filter((_, j) => j !== i))} />,
    limpar: () => { setLinks([]); setAberto(false); setUrl(''); setTitulo(''); setErro(null); },
  };
}

export default function LinksRelatorio({ links, podeEditar, onSalvar, className }: {
  links: LinkRel[];
  podeEditar: boolean;
  onSalvar?: (links: LinkRel[]) => Promise<boolean>;
  /** Moldura do cartão (a coluna lateral do relatório usa outra). */
  className?: string;
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
    <section className={className ?? 'bg-white rounded-2xl border border-slate-200 shadow-sm p-4 mt-3'}>
      <div className="flex items-center gap-2">
        <span className="w-7 h-7 rounded-lg bg-sky-50 text-sky-500 flex items-center justify-center shrink-0"><Cloud size={15} /></span>
        <h2 className="text-sm font-semibold text-slate-700 flex-1">Arquivos · {links.length}</h2>
        {podeEditar && !adicionando && (
          <button onClick={() => setAdicionando(true)} className="p-1 rounded-lg text-indigo-600 hover:bg-indigo-50" title="Adicionar link de arquivo"><Plus size={16} /></button>
        )}
      </div>
      {!links.length && !adicionando && (
        <p className="text-xs text-slate-400 mt-2">Para mandar um arquivo, cole o link de compartilhamento da nuvem (Drive, OneDrive, Dropbox…).</p>
      )}
      {links.length > 0 && (
        <ul className="mt-2.5 space-y-1.5">
          {links.map((l, i) => (
            <li key={`${l.url}-${i}`} className="flex items-center gap-2">
              <a
                href={l.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 min-w-0 flex items-center gap-2.5 px-3 py-2 rounded-xl border border-slate-200 hover:border-indigo-300 hover:bg-indigo-50/40 transition"
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
