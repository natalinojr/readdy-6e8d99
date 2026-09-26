/**
 * /r/:token — relatório de Tarefas aberto por link, sem login.
 * Quem entra se identifica (nome + contato opcional) antes de ver e responder;
 * cada resposta fica gravada com o nome e o horário.
 */
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Loader2, Lock, UserRound, ClipboardList } from 'lucide-react';
import ItemRelatorio, { NovoItem } from '../tarefas/relatorios/ItemRelatorio';
import LinksRelatorio from '../tarefas/relatorios/LinksRelatorio';
import { itensVisiveis } from '../tarefas/relatorios/condicaoItem';
import {
  chamarPublico, enviarImagemPublico, lerConvidado, salvarConvidado, slugRelatorio,
  type Convidado, type ImagemRel, type ItemRel, type LinkRel, type Relatorio, type StatusItem, type ValorCampo,
} from '../tarefas/relatorios/api';

type Dados = { report: Relatorio; items: ItemRel[]; guests: Convidado[]; me: { id: string; name: string } | null };

export default function RelatorioPublicoPage() {
  const { token = '' } = useParams();
  const [guestToken, setGuestToken] = useState<string | null>(() => lerConvidado(token));
  const [dados, setDados] = useState<Dados | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    const r = await chamarPublico<Dados>('public_get', { token, guest_token: guestToken });
    if (!r.ok) { setErro(r.error); return; }
    setErro(null);
    setDados(r.data);
    // Token guardado que não vale mais (ex.: link regenerado): pede identificação de novo.
    if (guestToken && !r.data.me) { salvarConvidado(token, null); setGuestToken(null); }
  }, [token, guestToken]);

  useEffect(() => { carregar(); }, [carregar]);
  // Volta para a aba → busca respostas novas de outras pessoas.
  useEffect(() => {
    const f = () => { if (document.visibilityState === 'visible') carregar(); };
    document.addEventListener('visibilitychange', f);
    const t = window.setInterval(f, 60000);
    return () => { document.removeEventListener('visibilitychange', f); window.clearInterval(t); };
  }, [carregar]);

  useEffect(() => {
    if (!dados?.report.title) return;
    document.title = dados.report.title;
    // Endereço com o nome atual do relatório (o título pode ter mudado depois que o link foi enviado).
    const certo = `/r/${slugRelatorio(dados.report.title) ? `${slugRelatorio(dados.report.title)}/` : ''}${token}`;
    if (window.location.pathname !== certo) window.history.replaceState(null, '', certo + window.location.search);
  }, [dados?.report.title, token]);

  const mostrarAviso = (m: string) => { setAviso(m); window.setTimeout(() => setAviso(null), 4000); };

  const enviarImagem = async (f: File): Promise<ImagemRel | null> => {
    if (!guestToken) return null;
    const r = await enviarImagemPublico(token, guestToken, f);
    if (!r.ok) { mostrarAviso(r.error); return null; }
    return r.data;
  };

  const responder = async (itemId: string, body: string, images: ImagemRel[], novoStatus: StatusItem | null, answers: Record<string, ValorCampo> | null, links: LinkRel[], parentId?: string | null) => {
    const r = await chamarPublico('public_reply', { token, guest_token: guestToken, item_id: itemId, body, images, new_status: novoStatus, answers, links, parent_id: parentId ?? null });
    if (!r.ok) { mostrarAviso(r.error); return false; }
    await carregar();
    return true;
  };

  if (erro && !dados) {
    return (
      <Tela>
        <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center">
          <Lock className="mx-auto text-slate-300" size={36} />
          <p className="mt-3 font-medium text-slate-700">{erro}</p>
          <p className="text-sm text-slate-500 mt-1">Peça um link novo a quem enviou o relatório.</p>
        </div>
      </Tela>
    );
  }
  if (!dados) {
    return <Tela><div className="flex justify-center py-20"><Loader2 className="animate-spin text-slate-400" /></div></Tela>;
  }

  const { report, guests, me } = dados;
  // Item condicional só aparece quando a resposta do outro item pede (itensVisiveis).
  const visiveis = itensVisiveis(dados.items);
  const items = dados.items.filter((i) => visiveis.has(i.id));
  if (!me) {
    return (
      <Tela>
        <Identificar
          titulo={report.title}
          dono={report.owner_name}
          onPronto={(gt) => { salvarConvidado(token, gt); setGuestToken(gt); }}
          token={token}
        />
      </Tela>
    );
  }

  const aberto = report.status === 'open';
  const resolvidos = items.filter((i) => i.status === 'resolved').length;

  return (
    <Tela>
      <header className="bg-white rounded-2xl border border-slate-200 p-5">
        <p className="text-xs text-slate-400 flex items-center gap-1"><ClipboardList size={13} /> Relatório{report.owner_name ? ` de ${report.owner_name}` : ''}</p>
        <h1 className="text-xl font-semibold text-slate-800 mt-1 break-words">{report.title}</h1>
        {report.description && <p className="text-sm text-slate-600 whitespace-pre-wrap mt-2 break-words">{report.description}</p>}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-3 text-xs text-slate-500">
          <span>{items.length} {items.length === 1 ? 'item' : 'itens'} · {resolvidos} resolvido{resolvidos === 1 ? '' : 's'}</span>
          {guests.length > 0 && <span>Participando: {guests.map((g) => g.name).join(', ')}</span>}
        </div>
        <div className="mt-3 flex items-center gap-2 text-sm bg-slate-50 rounded-lg px-3 py-2">
          <UserRound size={16} className="text-slate-400" />
          <span className="flex-1 min-w-0 break-words">Respondendo como <strong>{me.name}</strong></span>
          <button
            onClick={() => { salvarConvidado(token, null); setGuestToken(null); setDados({ ...dados, me: null }); }}
            className="text-xs text-indigo-600 hover:underline shrink-0"
          >
            Não sou eu
          </button>
        </div>
        {!aberto && (
          <p className="mt-3 text-sm bg-slate-100 text-slate-600 rounded-lg px-3 py-2">Este relatório foi encerrado — dá para ler, mas não recebe mais respostas.</p>
        )}
      </header>

      <LinksRelatorio links={report.links ?? []} podeEditar={false} />

      <div className="space-y-3 mt-3">
        {items.map((item, i) => (
          <ItemRelatorio
            key={item.id}
            item={item}
            numero={i + 1}
            podeResponder={aberto}
            meuGuestId={me.id}
            onResponder={(b, imgs, st, ans, links, pai) => responder(item.id, b, imgs, st, ans, links, pai)}
            onEnviarImagem={enviarImagem}
          />
        ))}
        {items.length === 0 && <p className="text-center text-sm text-slate-400 py-8">Nenhum item neste relatório ainda.</p>}
        {aberto && report.guests_can_add_items && (
          <NovoItem
            onEnviarImagem={enviarImagem}
            onCriar={async (title, body, images, _fields, links) => {
              const r = await chamarPublico('public_add_item', { token, guest_token: guestToken, title, body, images, links });
              if (!r.ok) { mostrarAviso(r.error); return false; }
              await carregar();
              return true;
            }}
          />
        )}
      </div>
      <p className="text-center text-[11px] text-slate-400 mt-6">Cada resposta fica registrada com o nome de quem respondeu e o horário.</p>

      {aviso && (
        <div className="fixed bottom-4 inset-x-4 md:left-auto md:right-4 md:w-96 z-50 bg-slate-800 text-white text-sm rounded-xl px-4 py-3 shadow-lg">{aviso}</div>
      )}
    </Tela>
  );
}

function Tela({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-100">
      <div className="max-w-2xl mx-auto px-3 md:px-4 py-4 md:py-8">{children}</div>
    </div>
  );
}

function Identificar({ titulo, dono, token, onPronto }: { titulo: string; dono: string | null; token: string; onPronto: (gt: string) => void }) {
  const [nome, setNome] = useState('');
  const [contato, setContato] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [gravando, setGravando] = useState(false);

  const entrar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (nome.trim().length < 2) { setErro('Informe seu nome'); return; }
    setGravando(true);
    const r = await chamarPublico<{ guest_token: string }>('public_identify', { token, name: nome.trim(), contact: contato.trim() || null });
    setGravando(false);
    if (!r.ok) { setErro(r.error); return; }
    onPronto(r.data.guest_token);
  };

  return (
    <form onSubmit={entrar} className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4">
      <div>
        <p className="text-xs text-slate-400">Relatório{dono ? ` de ${dono}` : ''}</p>
        <h1 className="text-xl font-semibold text-slate-800 mt-1 break-words">{titulo}</h1>
        <p className="text-sm text-slate-500 mt-2">Antes de ver e responder, diga quem é você. Cada resposta fica registrada com seu nome e o horário.</p>
      </div>
      <label className="block">
        <span className="text-sm font-medium text-slate-700">Seu nome *</span>
        <input
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          autoFocus
          maxLength={120}
          autoComplete="name"
          className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-base focus:outline-none focus:ring-2 focus:ring-indigo-200"
          placeholder="Nome e sobrenome"
        />
      </label>
      <label className="block">
        <span className="text-sm font-medium text-slate-700">Empresa, telefone ou e-mail <span className="font-normal text-slate-400">(opcional)</span></span>
        <input
          value={contato}
          onChange={(e) => setContato(e.target.value)}
          maxLength={160}
          className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-base focus:outline-none focus:ring-2 focus:ring-indigo-200"
        />
      </label>
      {erro && <p className="text-sm text-red-600">{erro}</p>}
      <button
        type="submit"
        disabled={gravando}
        className="w-full py-3 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700 disabled:opacity-50 flex items-center justify-center gap-2"
      >
        {gravando && <Loader2 size={16} className="animate-spin" />} Entrar
      </button>
    </form>
  );
}
