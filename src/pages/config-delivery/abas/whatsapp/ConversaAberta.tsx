import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/contexts/ToastContext';
import { btn, Folha, fmtTelefone, waNumero } from '../../ui';
import { useAtualizacao } from '../inicio/usarAtualizacao';
import { chamarEdge } from './edge';
import EtiquetasConversa from './EtiquetasConversa';
import { estadoDaConversa, nomeDaConversa } from './rotulos';
import type { Conversa, Mensagem } from './tipos';
import { PAUSA_EQUIPE_MS, erroDe24h, pausado, quandoConversa } from './util';

// Conversa aberta: mensagens (atualizam a cada 8 s com a aba do navegador à vista), pausar/devolver o assistente, marcar como resolvida e
// responder como a loja. No celular vira uma Folha (resposta fixa no rodapé); no computador, um painel ao lado.

function useMensagens(conversaId: string) {
  const [mensagens, setMensagens] = useState<Mensagem[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const atual = useRef(conversaId);
  atual.current = conversaId;

  const ler = useCallback(async () => {
    const id = conversaId;
    // As 200 mais recentes (a conversa pode passar disso); a tela mostra da mais antiga para a mais nova.
    const { data, error } = await supabase.from('wa_loja_mensagens').select('id, role, content, created_at')
      .eq('conversa_id', id).order('id', { ascending: false }).limit(200);
    if (atual.current !== id) return; // trocou de conversa no meio da leitura
    if (error) setErro(error.message);
    else { setErro(''); setMensagens(((data ?? []) as Mensagem[]).reverse()); }
    setCarregando(false);
  }, [conversaId]);

  useEffect(() => { setMensagens([]); setCarregando(true); setErro(''); }, [conversaId]);
  useAtualizacao(ler, 8_000, conversaId); // só com a aba à vista; ao voltar para ela atualiza na hora

  return { mensagens, carregando, erro, recarregar: ler };
}

function Baloes({ mensagens, carregando, erro }: { mensagens: Mensagem[]; carregando: boolean; erro: string }) {
  const caixa = useRef<HTMLDivElement>(null);
  // Abre e chega mensagem nova: desce até a última.
  useEffect(() => { const el = caixa.current; if (el) el.scrollTop = el.scrollHeight; }, [mensagens.length, carregando]);
  return (
    <div ref={caixa} className="bg-[#efeae2] rounded-2xl p-3 min-h-[120px] max-h-[46dvh] lg:max-h-[56dvh] overflow-y-auto space-y-2">
      {carregando ? (
        <p className="text-xs text-zinc-500 text-center py-6"><i className="ri-loader-4-line animate-spin mr-1" />Carregando…</p>
      ) : erro && !mensagens.length ? (
        <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2">Não consegui ler as mensagens: {erro}</p>
      ) : !mensagens.length ? (
        <p className="text-xs text-zinc-500 text-center py-6">Nenhuma mensagem nesta conversa.</p>
      ) : mensagens.map((m) => (
        <div key={m.id} className={'flex ' + (m.role === 'user' ? 'justify-start' : 'justify-end')}>
          <div className={'max-w-[85%] rounded-xl px-3 py-1.5 text-[13.5px] whitespace-pre-wrap break-words shadow-sm text-zinc-800 ' +
            (m.role === 'user' ? 'bg-white' : m.role === 'staff' ? 'bg-sky-100' : 'bg-[#d9fdd3]')}>
            {m.role !== 'user' && <div className="text-[10px] font-bold text-zinc-500">{m.role === 'staff' ? 'Equipe' : 'Assistente'}</div>}
            {m.content}
            <div className="text-[10px] text-zinc-400 text-right">{quandoConversa(m.created_at)}</div>
          </div>
        </div>
      ))}
      {erro && mensagens.length > 0 && <p className="text-[11px] text-red-600 text-center">Não consegui atualizar agora: {erro}</p>}
    </div>
  );
}

export default function ConversaAberta({ conversa, grande, onAtualizar, onRespondeu, onFechar }: {
  conversa: Conversa;
  grande: boolean;
  /** Grava a mudança na conversa. Devolve false (e o pai já avisou o erro) se não gravou. */
  onAtualizar: (c: Conversa, patch: Partial<Conversa>) => Promise<boolean>;
  /** A equipe respondeu: o servidor pausou o assistente 2 h e tirou "pede a equipe". */
  onRespondeu: (c: Conversa) => void;
  onFechar: () => void;
}) {
  const toast = useToast();
  const { mensagens, carregando, erro, recarregar } = useMensagens(conversa.id);
  const [resposta, setResposta] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [agindo, setAgindo] = useState(false);

  async function mudar(patch: Partial<Conversa>) {
    if (agindo) return;
    setAgindo(true);
    try { await onAtualizar(conversa, patch); } finally { setAgindo(false); }
  }

  async function responder() {
    const texto = resposta.trim();
    if (!texto || enviando) return;
    setEnviando(true);
    try {
      await chamarEdge({ action: 'reply', conversa_id: conversa.id, text: texto });
      setResposta('');
      onRespondeu(conversa);
      await recarregar();
    } catch (e) {
      const t = e instanceof Error ? e.message : String(e);
      toast.error('Não enviou a mensagem', erroDe24h(t)
        ? 'O cliente não escreve há mais de 24 h: o WhatsApp só deixa responder depois que ele mandar uma mensagem.'
        : t);
    } finally {
      setEnviando(false);
    }
  }

  const acoes = (
    <div className="flex flex-wrap gap-2">
      {pausado(conversa) ? (
        <button type="button" disabled={agindo} onClick={() => void mudar({ bot_paused_until: null })} className={btn('out', 'sm')}>
          <i className="ri-robot-2-line text-emerald-600" />Devolver ao assistente
        </button>
      ) : (
        <button type="button" disabled={agindo} onClick={() => void mudar({ bot_paused_until: new Date(Date.now() + PAUSA_EQUIPE_MS).toISOString() })} className={btn('out', 'sm')}>
          <i className="ri-pause-circle-line text-zinc-400" />Pausar assistente 2 h
        </button>
      )}
      {conversa.needs_human && (
        <button type="button" disabled={agindo} onClick={() => void mudar({ needs_human: false })} className={btn('out', 'sm')}>
          <i className="ri-check-double-line text-emerald-600" />Marcar como resolvida
        </button>
      )}
      <a href={`https://wa.me/${waNumero(conversa.contact_phone)}`} target="_blank" rel="noreferrer" className={btn('out', 'sm')}>
        <i className="ri-whatsapp-line text-emerald-600" />Abrir no WhatsApp
      </a>
    </div>
  );

  const caixaResposta = (
    <div className="flex gap-2 items-end w-full">
      <textarea rows={2} value={resposta} onChange={(e) => setResposta(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void responder(); } }}
        aria-label="Responder como a loja"
        placeholder="Responder como a loja (o assistente pausa por 2 h)"
        className="flex-1 min-w-0 px-3 py-2 rounded-xl border border-zinc-200 text-sm outline-none focus:border-amber-400 resize-none" />
      <button type="button" onClick={() => void responder()} disabled={enviando || !resposta.trim()} className={btn('wa')} aria-label="Enviar">
        {enviando ? <i className="ri-loader-4-line animate-spin" /> : <i className="ri-send-plane-2-fill" />}Enviar
      </button>
    </div>
  );

  const baloes = <Baloes mensagens={mensagens} carregando={carregando} erro={erro} />;

  if (!grande) {
    return (
      <Folha aberta titulo={nomeDaConversa(conversa)} subtitulo={`${fmtTelefone(conversa.contact_phone)} · ${estadoDaConversa(conversa)}`}
        onFechar={onFechar} rodape={caixaResposta}>
        <div className="space-y-3 pb-2">
          <div className="flex flex-wrap gap-1.5 empty:hidden"><EtiquetasConversa c={conversa} /></div>
          {acoes}
          {baloes}
        </div>
      </Folha>
    );
  }

  return (
    <div className="bg-white border border-zinc-200 rounded-2xl p-4 space-y-3 lg:sticky lg:top-4">
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <h3 className="text-base font-extrabold text-zinc-900 truncate">{nomeDaConversa(conversa)}</h3>
          <p className="text-xs text-zinc-500">{fmtTelefone(conversa.contact_phone)} · {estadoDaConversa(conversa)}</p>
        </div>
        <button type="button" onClick={onFechar} aria-label="Fechar a conversa"
          className="w-8 h-8 flex-shrink-0 rounded-full bg-zinc-100 hover:bg-zinc-200 flex items-center justify-center cursor-pointer">
          <i className="ri-close-line text-lg text-zinc-600" />
        </button>
      </div>
      <div className="flex flex-wrap gap-1.5 empty:hidden"><EtiquetasConversa c={conversa} /></div>
      {acoes}
      {baloes}
      {caixaResposta}
    </div>
  );
}
