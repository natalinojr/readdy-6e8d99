// Conversas com a equipe dentro da lista do chat (2026-09-23): uma linha por pessoa, com a última
// mensagem, a hora e as não lidas, e o botão "Nova conversa" que abre as pessoas da loja.
import { useEffect, useMemo, useState } from 'react';
import { useVoltarFecha } from '@/lib/voltarAndroid';
import BotaoAvisos from '@/components/feature/BotaoAvisos';
import { chatEquipe, horaCurta, ESCOPO_TAREFAS, type ConversaResumo, type PessoaEquipe } from './api';
import { AvatarPessoa, estadoVisto, Vistos } from './ConversaEquipe';

export interface ConversaAberta { threadId: string; pessoa: PessoaEquipe | null; loja?: string }

export interface LojaEquipe { id: string; nome: string; naoLidas: number }

export function ListaEquipe({ conversas, onAbrir, onNova, lojas, lojaSel, onLoja }: {
  /** Só as conversas da loja escolhida. */
  conversas: ConversaResumo[];
  onAbrir: (c: ConversaAberta) => void;
  onNova: () => void;
  /** Quem trabalha em mais de uma loja escolhe a loja aqui; o número mostra o que chegou em cada uma. */
  lojas: LojaEquipe[];
  lojaSel: string;
  onLoja: (id: string) => void;
}) {
  return (
    <>
      <div className="flex items-center gap-2 px-4 pt-3 pb-1">
        <p className="flex-1 text-[11px] font-bold uppercase tracking-wide text-zinc-400">Equipe</p>
        {/* Aviso no celular quando chega mensagem (2026-09-24): sem este aparelho inscrito o send-push não
            tem para onde mandar — quem não é o dono não tinha onde ligar. Some quando já está ativo. */}
        <BotaoAvisos tenantId={lojaSel === ESCOPO_TAREFAS ? null : lojaSel} titulo="Receber aviso no celular quando chegar mensagem" />
        <button onClick={onNova} className="flex items-center gap-1 text-xs font-bold text-sky-700 hover:text-sky-600 cursor-pointer">
          <i className="ri-chat-new-line text-base" /> Nova conversa
        </button>
      </div>
      {lojas.length > 1 && (
        <div className="flex gap-1.5 px-4 pb-2 overflow-x-auto" role="tablist" aria-label="Loja das conversas">
          {lojas.map((l) => (
            <button key={l.id} role="tab" aria-selected={l.id === lojaSel} onClick={() => onLoja(l.id)}
              className={`flex-shrink-0 flex items-center gap-1.5 h-8 px-3 rounded-full text-xs font-semibold border cursor-pointer ${l.id === lojaSel ? 'bg-sky-600 border-sky-600 text-white' : 'bg-white border-zinc-200 text-zinc-600 hover:bg-zinc-50'}`}>
              <i className={l.id === ESCOPO_TAREFAS ? 'ri-task-line' : 'ri-store-2-line'} /> {l.nome}
              {l.naoLidas > 0 && (
                <span className={`min-w-[18px] h-[18px] px-1 flex items-center justify-center rounded-full text-[10px] font-black ${l.id === lojaSel ? 'bg-white text-sky-700' : 'bg-red-500 text-white'}`}
                  aria-label={`${l.naoLidas} não lida(s) em ${l.nome}`}>
                  {l.naoLidas > 99 ? '99+' : l.naoLidas}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
      {conversas.length === 0 && (
        <button onClick={onNova} className="w-full px-4 py-3 text-left text-xs text-zinc-400 border-b border-zinc-100 hover:bg-zinc-50 cursor-pointer">
          {lojaSel === ESCOPO_TAREFAS ? 'Fale com quem divide pastas ou tarefas com você' : 'Fale com alguém da loja'}: toque em <b className="text-sky-700">Nova conversa</b>.
        </button>
      )}
      {conversas.map((c) => {
        // Como no WhatsApp: a sua última mensagem vem com os vistos na frente, sem "Você:".
        const previa = c.ultima ? c.ultima.texto : 'Nenhuma mensagem ainda';
        return (
          <button key={c.thread_id} onClick={() => onAbrir({ threadId: c.thread_id, pessoa: c.pessoa, loja: c.loja })}
            className="w-full flex items-center gap-3 px-4 py-3 border-b border-zinc-100 hover:bg-zinc-50 cursor-pointer text-left">
            <AvatarPessoa pessoa={c.pessoa} />
            <span className="flex-1 min-w-0">
              <span className="flex items-baseline gap-2">
                <span className="flex-1 text-sm font-bold text-zinc-900 truncate">{c.pessoa?.nome ?? 'Conversa'}</span>
                {c.ultima && <span className={`text-[11px] flex-shrink-0 ${c.nao_lidas ? 'text-sky-700 font-bold' : 'text-zinc-400'}`}>{horaCurta(c.ultima.created_at)}</span>}
              </span>
              <span className="flex items-center gap-2">
                <span className={`flex-1 flex items-center gap-1 min-w-0 text-xs ${c.nao_lidas ? 'text-zinc-700 font-semibold' : 'text-zinc-400'}`}>
                  {c.ultima?.minha && <Vistos estado={estadoVisto(c.ultima.id, Math.max(c.entregue_ao_outro ?? 0, c.lido_pelo_outro), c.lido_pelo_outro)} className="flex-shrink-0 text-sm leading-none" />}
                  <span className="truncate">{previa}</span>
                </span>
                {c.nao_lidas > 0 && (
                  <span className="flex-shrink-0 min-w-[20px] h-5 px-1.5 flex items-center justify-center rounded-full bg-sky-600 text-white text-[11px] font-black" aria-label={`${c.nao_lidas} não lida(s)`}>
                    {c.nao_lidas > 99 ? '99+' : c.nao_lidas}
                  </span>
                )}
              </span>
            </span>
          </button>
        );
      })}
    </>
  );
}

const semAcento = (t: string) => t.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
const PAPEL: Record<string, string> = {
  admin: 'Administrador', manager: 'Gerente', cashier: 'Caixa', waiter: 'Garçom', kitchen: 'Cozinha',
  delivery_manager: 'Entregas', financeiro: 'Financeiro', tarefas: 'Tarefas', supervisao: 'Supervisão',
};

/** Escolher com quem falar: as pessoas da loja escolhida nas abas (a conversa nasce nessa loja). */
export function NovaConversaEquipe({ loja, nomeLoja, onEscolher, onVoltar }: {
  loja: string;
  nomeLoja?: string;
  onEscolher: (c: ConversaAberta) => void;
  onVoltar: () => void;
}) {
  const [colegas, setColegas] = useState<PessoaEquipe[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [filtro, setFiltro] = useState('');
  const [abrindo, setAbrindo] = useState<string | null>(null);

  useVoltarFecha(true, onVoltar, 'chat-equipe-nova');
  const tarefas = loja === ESCOPO_TAREFAS;

  useEffect(() => {
    if (!loja) return;
    let vivo = true;
    setColegas(null); setErro(null);
    chatEquipe<{ colegas: PessoaEquipe[] }>('colegas', { tenant_id: loja })
      .then((r) => { if (vivo) setColegas(r.colegas); })
      .catch((e) => { if (vivo) setErro(e instanceof Error ? e.message : String(e)); });
    return () => { vivo = false; };
  }, [loja]);

  const termo = semAcento(filtro.trim());
  const lista = useMemo(() => (colegas ?? []).filter((p) => !termo || semAcento(p.nome).includes(termo)), [colegas, termo]);

  const escolher = async (p: PessoaEquipe) => {
    if (abrindo) return;
    setAbrindo(p.id); setErro(null);
    try {
      const r = await chatEquipe<{ thread_id: string; pessoa: PessoaEquipe }>('abrir', { tenant_id: loja, user_id: p.id });
      onEscolher({ threadId: r.thread_id, pessoa: r.pessoa, loja: nomeLoja });
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally { setAbrindo(null); }
  };

  return (
    <div data-no-pull className="absolute inset-0 z-30 flex flex-col bg-white">
      <div className="flex items-center gap-2.5 px-3 h-14 border-b border-zinc-100 flex-shrink-0">
        <button onClick={onVoltar} className="w-9 h-9 flex items-center justify-center rounded-xl text-zinc-500 hover:bg-zinc-100 cursor-pointer" aria-label="Voltar para as conversas">
          <i className="ri-arrow-left-line text-xl" />
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-black text-zinc-900 leading-tight">Nova conversa</p>
          <p className="text-[11px] text-zinc-400 leading-tight truncate">{tarefas ? 'Quem divide pastas ou tarefas com você' : `Pessoas da loja ${nomeLoja ?? ''}`}</p>
        </div>
      </div>
      <div className="px-3 pt-3 pb-2 space-y-2 flex-shrink-0">
        <div className="relative">
          <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
          <input type="text" value={filtro} onChange={(e) => setFiltro(e.target.value)} placeholder="Procurar pessoa…"
            aria-label="Procurar pessoa" autoComplete="off"
            className="w-full h-10 pl-9 pr-3 text-sm rounded-xl border border-zinc-200 bg-white focus:outline-none focus:border-sky-400" />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        {erro && <p className="mx-3 my-2 px-3 py-2 rounded-xl text-xs text-red-600 bg-red-50 border border-red-100">{erro}</p>}
        {colegas === null && !erro && <div className="mx-auto my-12 w-6 h-6 border-2 border-sky-500 border-t-transparent rounded-full animate-spin" />}
        {colegas !== null && lista.length === 0 && (
          <p className="text-sm text-zinc-400 text-center py-10">{colegas.length ? 'Ninguém com esse nome.' : tarefas ? 'Ninguém divide pasta ou tarefa com você ainda.' : 'Ainda não há outras pessoas nesta loja.'}</p>
        )}
        {lista.map((p) => (
          <button key={p.id} onClick={() => escolher(p)} disabled={!!abrindo}
            className="w-full flex items-center gap-3 px-4 py-2.5 border-b border-zinc-100 hover:bg-zinc-50 cursor-pointer text-left disabled:opacity-60">
            <AvatarPessoa pessoa={p} tamanho="w-10 h-10" />
            <span className="flex-1 min-w-0">
              <span className="block text-sm font-bold text-zinc-900 truncate">{p.nome}</span>
              {p.papel && <span className="block text-xs text-zinc-400">{PAPEL[p.papel] ?? p.papel}</span>}
            </span>
            {abrindo === p.id && <span className="w-4 h-4 border-2 border-sky-500 border-t-transparent rounded-full animate-spin" />}
          </button>
        ))}
      </div>
    </div>
  );
}
