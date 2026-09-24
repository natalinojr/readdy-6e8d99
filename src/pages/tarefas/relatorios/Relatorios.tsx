/**
 * Relatórios compartilháveis (Tarefas) — visão da equipe (quem criou e quem divide a pasta).
 * Monta o relatório (itens com texto e imagens), manda o link para quem está
 * fora do sistema e acompanha as respostas, cada uma com nome e horário.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  ArrowLeft, Plus, Link2, Copy, MessageCircle, RefreshCw, Loader2, Trash2, Pencil, ChevronUp, ChevronDown,
  Lock, Unlock, Users, FileText, Check, X, Folder,
} from 'lucide-react';
import { useToast } from '@/contexts/ToastContext';
import ConfirmDialog from '../components/ConfirmDialog';
import ItemRelatorio, { GradeImagens, NovoItem, useAnexos } from './ItemRelatorio';
import {
  chamarDono, enviarImagemDono, linkPublico, dataHora,
  podeEditar, podeExcluir,
  type ImagemRel, type ItemRel, type RelatorioCompleto, type ResumoRelatorio,
} from './api';

/** Pasta de Tarefas (o suficiente para escolher onde o relatório fica). */
export interface PastaRel { id: string; name: string; color: string; access?: 'owner' | 'edit' | 'view' }

/** Pastas onde posso pôr relatório: as minhas e as compartilhadas comigo com 'pode editar'. */
const pastasPermitidas = (pastas: PastaRel[]) => pastas.filter((p) => (p.access ?? 'owner') !== 'view');

function SeletorPasta({ pastas, valor, onChange }: { pastas: PastaRel[]; valor: string; onChange: (v: string) => void }) {
  return (
    <select
      value={valor}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-lg border border-slate-200 px-2 py-2 text-base md:text-sm bg-white max-w-full"
      title="Quem divide a pasta também vê o relatório"
    >
      <option value="">Sem pasta (só eu)</option>
      {pastasPermitidas(pastas).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
    </select>
  );
}

interface Props {
  /** Abre direto num relatório (ex.: clique no push → /tarefas?relatorio=<id>). */
  abrirId?: string | null;
  /** Celular: volta para o menu de Tarefas. */
  onVoltar?: () => void;
  /** Pastas de Tarefas que eu vejo (para pôr o relatório numa pasta). */
  pastas: PastaRel[];
  /** Pasta aberta em Tarefas — já vem escolhida ao criar. */
  pastaAtualId?: string | null;
  meuId: string | null;
}

export default function Relatorios({ abrirId, onVoltar, pastas, pastaAtualId, meuId }: Props) {
  const toast = useToast();
  const [lista, setLista] = useState<ResumoRelatorio[] | null>(null);
  const [selecionado, setSelecionado] = useState<string | null>(abrirId ?? null);
  const [criando, setCriando] = useState(false);
  const [novoTitulo, setNovoTitulo] = useState('');
  const [novaPasta, setNovaPasta] = useState('');
  const abrirCriacao = () => {
    setNovaPasta(pastasPermitidas(pastas).some((p) => p.id === pastaAtualId) ? pastaAtualId! : '');
    setCriando(true);
  };

  const carregarLista = useCallback(async () => {
    const r = await chamarDono<{ reports: ResumoRelatorio[] }>('list');
    if (!r.ok) { toast.error('Erro ao carregar relatórios', r.error); setLista([]); return; }
    setLista(r.data.reports);
  }, [toast]);

  useEffect(() => { carregarLista(); }, [carregarLista]);
  useEffect(() => { if (abrirId) setSelecionado(abrirId); }, [abrirId]);

  const criar = async () => {
    if (!novoTitulo.trim()) return;
    const r = await chamarDono<{ id: string }>('create', { title: novoTitulo.trim(), list_id: novaPasta || null });
    if (!r.ok) { toast.error('Erro ao criar relatório', r.error); return; }
    setNovoTitulo('');
    setCriando(false);
    setSelecionado(r.data.id);
    carregarLista();
  };

  if (selecionado) {
    return (
      <DetalheRelatorio
        id={selecionado}
        pastas={pastas}
        meuId={meuId}
        onVoltar={() => { setSelecionado(null); carregarLista(); }}
      />
    );
  }

  return (
    <div className="px-4 md:px-6 py-4 md:py-6 max-w-3xl pb-24 md:pb-6">
      <div className="flex items-center gap-2 mb-1">
        {onVoltar && (
          <button onClick={onVoltar} className="md:hidden p-1.5 -ml-1.5 rounded-lg text-slate-500 active:bg-slate-200"><ArrowLeft size={18} /></button>
        )}
        <h1 className="text-base font-semibold text-slate-800 flex items-center gap-2"><FileText size={17} className="text-indigo-500" /> Relatórios compartilháveis</h1>
      </div>
      <p className="text-sm text-slate-500 mb-4">
        Monte uma lista de pontos (texto e fotos), mande o link para quem está fora do sistema e receba as respostas item a item — cada uma com nome e horário.
        Relatório dentro de uma pasta aparece também para quem divide a pasta.
      </p>

      {criando ? (
        <div className="bg-white rounded-xl border border-slate-200 p-3 flex flex-wrap gap-2 mb-4">
          <input
            value={novoTitulo}
            onChange={(e) => setNovoTitulo(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') criar(); if (e.key === 'Escape') setCriando(false); }}
            autoFocus
            maxLength={200}
            placeholder="Ex.: Vistoria da obra — pendências do empreiteiro"
            className="flex-1 min-w-[200px] rounded-lg border border-slate-200 px-3 py-2 text-base md:text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200"
          />
          <SeletorPasta pastas={pastas} valor={novaPasta} onChange={setNovaPasta} />
          <button onClick={() => setCriando(false)} className="px-3 py-2 rounded-lg text-sm text-slate-500 hover:bg-slate-100">Cancelar</button>
          <button onClick={criar} disabled={!novoTitulo.trim()} className="px-4 py-2 rounded-lg text-sm font-medium bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50">Criar</button>
        </div>
      ) : (
        <button
          onClick={abrirCriacao}
          className="mb-4 flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-indigo-600 text-white hover:bg-indigo-700"
        >
          <Plus size={16} /> Novo relatório
        </button>
      )}

      {lista === null && <div className="py-10 flex justify-center"><Loader2 className="animate-spin text-slate-400" /></div>}
      {lista?.length === 0 && !criando && (
        <p className="text-sm text-slate-400 text-center py-10">Nenhum relatório ainda.</p>
      )}
      <div className="space-y-2">
        {lista?.map((r) => (
          <button
            key={r.id}
            onClick={() => setSelecionado(r.id)}
            className="w-full text-left bg-white rounded-xl border border-slate-200 px-4 py-3 hover:border-indigo-300 transition"
          >
            <div className="flex items-center gap-2">
              <span className="flex-1 min-w-0 font-medium text-slate-800 truncate">{r.title}</span>
              {r.unseen > 0 && (
                <span className="shrink-0 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-indigo-600 text-white">
                  {r.unseen} nova{r.unseen === 1 ? '' : 's'}
                </span>
              )}
              {r.status === 'closed' && <span className="shrink-0 text-[11px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">encerrado</span>}
              {r.status === 'open' && !r.link_enabled && <span className="shrink-0 text-[11px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">link desligado</span>}
            </div>
            {(r.list_name || r.access !== 'creator') && (
              <p className="text-xs text-slate-500 mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                {r.list_name && (
                  <span className="flex items-center gap-1">
                    <Folder size={12} style={{ color: r.list_color ?? undefined }} /> {r.list_name}
                  </span>
                )}
                {r.access !== 'creator' && <span>de {r.owner_name ?? 'outra pessoa'}{r.access === 'view' ? ' · só ver e responder' : ''}</span>}
              </p>
            )}
            <p className="text-xs text-slate-500 mt-1">
              {r.items_total} {r.items_total === 1 ? 'item' : 'itens'} · {r.items_open} aguardando · {r.items_resolved} resolvido{r.items_resolved === 1 ? '' : 's'}
              {' · '}{r.guest_responses} resposta{r.guest_responses === 1 ? '' : 's'} de fora · atualizado {dataHora(r.updated_at)}
            </p>
          </button>
        ))}
      </div>
    </div>
  );
}

function DetalheRelatorio({ id, onVoltar, pastas, meuId }: { id: string; onVoltar: () => void; pastas: PastaRel[]; meuId: string | null }) {
  const toast = useToast();
  const [dados, setDados] = useState<RelatorioCompleto | null>(null);
  const [editandoCabecalho, setEditandoCabecalho] = useState(false);
  const [titulo, setTitulo] = useState('');
  const [descricao, setDescricao] = useState('');
  const [editandoItem, setEditandoItem] = useState<string | null>(null);
  const [excluindoItem, setExcluindoItem] = useState<ItemRel | null>(null);
  const [excluindoRelatorio, setExcluindoRelatorio] = useState(false);
  const [trocandoLink, setTrocandoLink] = useState(false);
  const [copiado, setCopiado] = useState(false);

  const carregar = useCallback(async (marcarVisto = false) => {
    const r = await chamarDono<RelatorioCompleto>('get', { report_id: id, mark_seen: marcarVisto });
    if (!r.ok) { toast.error('Erro ao abrir relatório', r.error); onVoltar(); return; }
    setDados(r.data);
  }, [id, toast, onVoltar]);

  useEffect(() => { carregar(true); }, [carregar]);
  useEffect(() => {
    const f = () => { if (document.visibilityState === 'visible') carregar(true); };
    document.addEventListener('visibilitychange', f);
    return () => document.removeEventListener('visibilitychange', f);
  }, [carregar]);

  const acao = async (action: string, payload: Record<string, unknown> = {}, ok?: string) => {
    const r = await chamarDono(action, { report_id: id, ...payload });
    if (!r.ok) { toast.error('Não foi possível salvar', r.error); return false; }
    if (ok) toast.success(ok);
    await carregar();
    return true;
  };

  const enviarImagem = async (f: File): Promise<ImagemRel | null> => {
    const r = await enviarImagemDono(id, f);
    if (!r.ok) { toast.error('Erro ao enviar imagem', r.error); return null; }
    return r.data;
  };

  if (!dados) return <div className="py-20 flex justify-center"><Loader2 className="animate-spin text-slate-400" /></div>;

  const { report, items, guests } = dados;
  const link = report.share_token ? linkPublico(report.share_token) : '';
  const aberto = report.status === 'open';
  // O que dá pra mexer depende do acesso: quem só vê a pasta lê e responde.
  const edita = podeEditar(report.access);
  const exclui = podeExcluir(report.access);
  const criador = report.access === 'creator';
  const nomePasta = pastas.find((p) => p.id === report.list_id)?.name ?? null;

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopiado(true);
      window.setTimeout(() => setCopiado(false), 2000);
    } catch {
      toast.error('Não consegui copiar', link);
    }
  };
  const whatsapp = () => {
    const txt = `${report.title}\nPor favor, responda os itens por este link:\n${link}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(txt)}`, '_blank', 'noopener');
  };

  const mover = (i: number, dir: -1 | 1) => {
    const alvo = items[i + dir];
    if (!alvo) return;
    // Troca de posição com o vizinho; o depois do vizinho fica no meio para não empatar.
    const vizinho2 = items[i + dir * 2];
    const nova = vizinho2 ? (alvo.position + vizinho2.position) / 2 : alvo.position + dir;
    acao('update_item', { item_id: items[i].id, position: nova });
  };

  return (
    <div className="px-4 md:px-6 py-4 md:py-6 max-w-3xl pb-24 md:pb-6">
      <button onClick={onVoltar} className="flex items-center gap-1 text-sm text-slate-500 hover:text-indigo-600 mb-3">
        <ArrowLeft size={15} /> Relatórios
      </button>

      {/* Cabeçalho */}
      <section className="bg-white rounded-xl border border-slate-200 p-4">
        {editandoCabecalho ? (
          <div className="space-y-2">
            <input
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
              maxLength={200}
              autoFocus
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-base font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-200"
            />
            <textarea
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              rows={3}
              maxLength={5000}
              placeholder="Explicação para quem vai responder (opcional)"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-base md:text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200"
            />
            <div className="flex justify-end gap-2">
              <button onClick={() => setEditandoCabecalho(false)} className="px-3 py-1.5 rounded-lg text-sm text-slate-500 hover:bg-slate-100">Cancelar</button>
              <button
                disabled={!titulo.trim()}
                onClick={async () => { if (await acao('update', { title: titulo, description: descricao })) setEditandoCabecalho(false); }}
                className="px-4 py-1.5 rounded-lg text-sm font-medium bg-indigo-600 text-white disabled:opacity-50"
              >
                Salvar
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-start gap-2">
            <div className="flex-1 min-w-0">
              <h1 className="text-lg font-semibold text-slate-800 break-words">{report.title}</h1>
              {report.description
                ? <p className="text-sm text-slate-600 whitespace-pre-wrap mt-1 break-words">{report.description}</p>
                : <p className="text-sm text-slate-400 mt-1">Sem explicação para quem vai responder.</p>}
              {!aberto && <p className="mt-2 text-xs inline-block px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">Encerrado — o link só mostra, não aceita respostas</p>}
            </div>
            {edita && (
              <button
                onClick={() => { setTitulo(report.title); setDescricao(report.description ?? ''); setEditandoCabecalho(true); }}
                className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-indigo-600"
                title="Editar título e explicação"
              >
                <Pencil size={16} />
              </button>
            )}
          </div>
        )}
        <div className="mt-3 pt-3 border-t border-slate-100 flex flex-wrap items-center gap-2 text-sm text-slate-600">
          <Folder size={15} className="text-slate-400 shrink-0" />
          {criador ? (
            <>
              <SeletorPasta
                pastas={report.list_id && !pastasPermitidas(pastas).some((p) => p.id === report.list_id)
                  ? [...pastas, { id: report.list_id, name: nomePasta ?? 'Pasta atual', color: '' }]
                  : pastas}
                valor={report.list_id ?? ''}
                onChange={(v) => acao('update', { list_id: v || null }, v ? 'Relatório agora está na pasta' : 'Relatório tirado da pasta')}
              />
              <span className="text-xs text-slate-400">{report.list_id ? 'Quem divide essa pasta também vê este relatório.' : 'Só você vê este relatório.'}</span>
            </>
          ) : (
            <span>
              {nomePasta ? <>Na pasta <strong className="font-medium">{nomePasta}</strong> · </> : null}
              criado por {report.owner_name ?? 'outra pessoa'}
              {report.access === 'view' && <span className="text-slate-400"> · você pode ver e responder</span>}
            </span>
          )}
        </div>
      </section>

      {/* Link */}
      <section className="bg-white rounded-xl border border-slate-200 p-4 mt-3">
        <h2 className="text-sm font-semibold text-slate-700 flex items-center gap-1.5"><Link2 size={15} /> Link para responder</h2>
        {report.link_enabled ? (
          <>
            <div className="mt-2 flex items-center gap-2">
              <input readOnly value={link} onFocus={(e) => e.target.select()} className="flex-1 min-w-0 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600" />
              <button onClick={copiar} className="shrink-0 flex items-center gap-1 px-3 py-2 rounded-lg text-sm border border-slate-200 hover:bg-slate-50">
                {copiado ? <Check size={15} className="text-emerald-600" /> : <Copy size={15} />} {copiado ? 'Copiado' : 'Copiar'}
              </button>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <button onClick={whatsapp} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm bg-emerald-600 text-white hover:bg-emerald-700">
                <MessageCircle size={15} /> Mandar no WhatsApp
              </button>
              {edita && <>
              <button onClick={() => setTrocandoLink(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-slate-600 border border-slate-200 hover:bg-slate-50">
                <RefreshCw size={14} /> Trocar link
              </button>
              <button onClick={() => acao('update', { link_enabled: false }, 'Link desligado')} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-slate-600 border border-slate-200 hover:bg-slate-50">
                <Lock size={14} /> Desligar link
              </button>
              </>}
            </div>
          </>
        ) : (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <p className="text-sm text-slate-500 flex-1">O link está desligado — quem tiver o endereço não consegue abrir.</p>
            {edita && (
              <button onClick={() => acao('update', { link_enabled: true }, 'Link ligado')} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border border-slate-200 hover:bg-slate-50">
                <Unlock size={14} /> Ligar link
              </button>
            )}
          </div>
        )}
        <label className={`mt-3 flex items-center gap-2 text-sm text-slate-600 ${edita ? '' : 'opacity-60'}`}>
          <input
            type="checkbox"
            checked={report.guests_can_add_items}
            disabled={!edita}
            onChange={(e) => acao('update', { guests_can_add_items: e.target.checked })}
            className="w-4 h-4"
          />
          Quem recebe o link também pode incluir itens novos
        </label>
      </section>

      {/* Quem entrou */}
      <section className="bg-white rounded-xl border border-slate-200 p-4 mt-3">
        <h2 className="text-sm font-semibold text-slate-700 flex items-center gap-1.5"><Users size={15} /> Quem entrou pelo link ({guests.length})</h2>
        {guests.length === 0 ? (
          <p className="text-sm text-slate-400 mt-1">Ninguém ainda. Cada pessoa informa o nome ao abrir.</p>
        ) : (
          <ul className="mt-2 divide-y divide-slate-100">
            {guests.map((g) => (
              <li key={g.id} className="py-1.5 text-sm flex flex-wrap gap-x-2">
                <strong className="font-medium text-slate-700">{g.name}</strong>
                {g.contact && <span className="text-slate-500">{g.contact}</span>}
                <span className="text-xs text-slate-400 ml-auto">entrou {g.created_at ? dataHora(g.created_at) : '—'} · visto {g.last_seen_at ? dataHora(g.last_seen_at) : '—'}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Itens */}
      <h2 className="text-sm font-semibold text-slate-700 mt-5 mb-2">Itens ({items.length})</h2>
      <div className="space-y-3">
        {items.map((item, i) => editandoItem === item.id ? (
          <EditarItem
            key={item.id}
            item={item}
            onEnviarImagem={enviarImagem}
            onCancelar={() => setEditandoItem(null)}
            onSalvar={async (title, body, images) => {
              const ok = await acao('update_item', { item_id: item.id, title, body, images });
              if (ok) setEditandoItem(null);
              return ok;
            }}
          />
        ) : (
          <ItemRelatorio
            key={item.id}
            item={item}
            numero={i + 1}
            podeResponder
            meuUserId={meuId}
            onEnviarImagem={enviarImagem}
            onResponder={(body, images, st) => acao('reply', { item_id: item.id, body, images, new_status: st })}
            acoes={edita && (
              <div className="shrink-0 flex items-center">
                <button disabled={i === 0} onClick={() => mover(i, -1)} className="p-1 rounded text-slate-400 hover:bg-slate-100 disabled:opacity-30" title="Subir"><ChevronUp size={16} /></button>
                <button disabled={i === items.length - 1} onClick={() => mover(i, 1)} className="p-1 rounded text-slate-400 hover:bg-slate-100 disabled:opacity-30" title="Descer"><ChevronDown size={16} /></button>
                <button onClick={() => setEditandoItem(item.id)} className="p-1 rounded text-slate-400 hover:bg-slate-100 hover:text-indigo-600" title="Editar item"><Pencil size={15} /></button>
                <button onClick={() => setExcluindoItem(item)} className="p-1 rounded text-slate-400 hover:bg-red-50 hover:text-red-500" title="Excluir item"><Trash2 size={15} /></button>
              </div>
            )}
          />
        ))}
        {edita && (
          <NovoItem
            onEnviarImagem={enviarImagem}
            onCriar={(title, body, images) => acao('add_item', { title, body, images })}
          />
        )}
      </div>

      {/* Rodapé */}
      {edita && (
      <div className="mt-6 flex flex-wrap gap-2 border-t border-slate-200 pt-4">
        {aberto ? (
          <button onClick={() => acao('update', { status: 'closed' }, 'Relatório encerrado')} className="px-3 py-2 rounded-lg text-sm text-slate-600 border border-slate-200 hover:bg-slate-50">
            Encerrar relatório
          </button>
        ) : (
          <button onClick={() => acao('update', { status: 'open' }, 'Relatório reaberto')} className="px-3 py-2 rounded-lg text-sm text-slate-600 border border-slate-200 hover:bg-slate-50">
            Reabrir relatório
          </button>
        )}
        {exclui && (
          <button onClick={() => setExcluindoRelatorio(true)} className="px-3 py-2 rounded-lg text-sm text-red-600 border border-red-200 hover:bg-red-50">
            Excluir relatório
          </button>
        )}
      </div>
      )}

      {excluindoItem && (
        <ConfirmDialog
          titulo="Excluir item?"
          descricao={`"${excluindoItem.title}" e as ${excluindoItem.responses.length} resposta(s) dele somem do relatório.`}
          textoConfirmar="Excluir"
          perigo
          onCancelar={() => setExcluindoItem(null)}
          onConfirmar={async () => { const it = excluindoItem; setExcluindoItem(null); await acao('delete_item', { item_id: it.id }, 'Item excluído'); }}
        />
      )}
      {excluindoRelatorio && (
        <ConfirmDialog
          titulo="Excluir relatório?"
          descricao="O link para de funcionar e o relatório sai da sua lista."
          textoConfirmar="Excluir"
          perigo
          onCancelar={() => setExcluindoRelatorio(false)}
          onConfirmar={async () => {
            setExcluindoRelatorio(false);
            const r = await chamarDono('archive', { report_id: id });
            if (!r.ok) { toast.error('Não foi possível excluir', r.error); return; }
            toast.success('Relatório excluído');
            onVoltar();
          }}
        />
      )}
      {trocandoLink && (
        <ConfirmDialog
          titulo="Trocar o link?"
          descricao="O link antigo para de funcionar. Quem já respondeu continua no histórico, mas vai precisar do link novo (e se identificar de novo) para continuar."
          textoConfirmar="Trocar link"
          onCancelar={() => setTrocandoLink(false)}
          onConfirmar={async () => { setTrocandoLink(false); await acao('regenerate_link', {}, 'Link trocado'); }}
        />
      )}
    </div>
  );
}

function EditarItem({ item, onSalvar, onCancelar, onEnviarImagem }: {
  item: ItemRel;
  onSalvar: (title: string, body: string, images: ImagemRel[]) => Promise<boolean>;
  onCancelar: () => void;
  onEnviarImagem: (f: File) => Promise<ImagemRel | null>;
}) {
  const [titulo, setTitulo] = useState(item.title);
  const [corpo, setCorpo] = useState(item.body ?? '');
  const [existentes, setExistentes] = useState<ImagemRel[]>(item.images);
  const [gravando, setGravando] = useState(false);
  const anexos = useAnexos(onEnviarImagem);
  return (
    <div className="bg-white rounded-xl border-2 border-indigo-200 p-4 space-y-2">
      <input
        value={titulo}
        onChange={(e) => setTitulo(e.target.value)}
        maxLength={300}
        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-base md:text-sm font-medium focus:outline-none focus:ring-2 focus:ring-indigo-200"
      />
      <textarea
        value={corpo}
        onChange={(e) => setCorpo(e.target.value)}
        rows={3}
        maxLength={5000}
        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-base md:text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200"
      />
      <GradeImagens imagens={existentes} onRemover={(i) => setExistentes((a) => a.filter((_, j) => j !== i))} />
      <GradeImagens imagens={anexos.imagens} onRemover={anexos.remover} />
      {item.responses.length > 0 && (
        <p className="text-xs text-amber-700">Este item já tem respostas: a edição fica registrada no histórico dele, com o texto anterior.</p>
      )}
      <div className="flex items-center gap-2">
        {anexos.botao}
        <div className="flex-1" />
        <button onClick={onCancelar} className="px-3 py-2 rounded-lg text-sm text-slate-500 hover:bg-slate-100"><X size={15} className="inline -mt-0.5" /> Cancelar</button>
        <button
          disabled={!titulo.trim() || gravando || anexos.enviando}
          onClick={async () => {
            setGravando(true);
            await onSalvar(titulo.trim(), corpo.trim(), [...existentes.map(({ path, name }) => ({ path, name })), ...anexos.paraGravar()]);
            setGravando(false);
          }}
          className="px-4 py-2 rounded-lg text-sm font-medium bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          Salvar
        </button>
      </div>
    </div>
  );
}
