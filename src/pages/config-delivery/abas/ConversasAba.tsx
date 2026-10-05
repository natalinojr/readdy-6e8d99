import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/contexts/ToastContext';
import { useDeliveryTela } from '../DeliveryTela';
import { btn, Colunas, fmtTelefone, Nota, PaginaDelivery, SecaoTitulo, Vazio } from '../ui';
import { useAtualizacao } from './inicio/usarAtualizacao';
import ConversaAberta from './whatsapp/ConversaAberta';
import EtiquetasConversa from './whatsapp/EtiquetasConversa';
import { nomeDaConversa } from './whatsapp/rotulos';
import type { Conversa } from './whatsapp/tipos';
import useTelaGrande from './whatsapp/useTelaGrande';
import { agruparConversas, quandoConversa } from './whatsapp/util';

// WhatsApp › Conversas. Antes a lista ficava no FIM da aba de atendimento, depois de toda a configuração.
// Agora: "Pedem você" em cima, "O assistente está cuidando" depois, "Encerradas" recolhidas. Tocar abre a
// conversa (celular: folha; computador: painel ao lado). A lista atualiza a cada 20 s, só com a aba do navegador à vista.
// Só o dono chega aqui (o banco só deixa o dono ler wa_loja_*; a página esconde a aba dos outros).

const COLUNAS = 'id, contact_phone, contact_name, via, status, is_test, needs_human, bot_paused_until, link_sent_at, cost_usd, last_message_at';

type SituacaoBot = 'carregando' | 'nenhum' | 'ligado' | 'desligado' | 'erro';

function Linha({ c, tom, ativa, onAbrir }: { c: Conversa; tom: 'red' | 'verde' | 'zinc'; ativa: boolean; onAbrir: () => void }) {
  const cor = { red: 'bg-red-50 text-red-600', verde: 'bg-emerald-50 text-emerald-700', zinc: 'bg-zinc-100 text-zinc-400' }[tom];
  const icone = { red: 'ri-customer-service-2-line', verde: 'ri-robot-2-line', zinc: 'ri-check-double-line' }[tom];
  return (
    <button type="button" onClick={onAbrir}
      className={`w-full text-left flex items-center gap-3 px-3.5 py-3 cursor-pointer ${ativa ? 'bg-amber-50' : 'hover:bg-zinc-50'}`}>
      <span className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 ${cor}`}><i className={`${icone} text-lg`} /></span>
      <span className="flex-1 min-w-0">
        <span className="block text-[13.5px] font-extrabold text-zinc-900 truncate">{nomeDaConversa(c)}</span>
        <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1 mt-0.5 text-[11.5px] text-zinc-500">
          <EtiquetasConversa c={c} />
          <span>{c.contact_name ? `${fmtTelefone(c.contact_phone)} · ` : ''}{quandoConversa(c.last_message_at)}</span>
        </span>
      </span>
      <i className="ri-arrow-right-s-line text-xl text-zinc-300 flex-shrink-0" />
    </button>
  );
}

function Lista({ children }: { children: ReactNode }) {
  return <div className="bg-white border border-zinc-200 rounded-2xl divide-y divide-zinc-100 overflow-hidden">{children}</div>;
}

export default function ConversasAba() {
  const { tenantId, irPara } = useDeliveryTela();
  const toast = useToast();
  const grande = useTelaGrande();

  const [bot, setBot] = useState<SituacaoBot>('carregando');
  const [erroBot, setErroBot] = useState('');
  const [tentativaBot, setTentativaBot] = useState(0);
  const [carregando, setCarregando] = useState(true);
  const [erroLista, setErroLista] = useState('');
  const [conversas, setConversas] = useState<Conversa[]>([]);
  const [abertaId, setAbertaId] = useState<string | null>(null);
  const [verEncerradas, setVerEncerradas] = useState(false);
  const tenantAtual = useRef(tenantId);
  tenantAtual.current = tenantId;

  // Existe o assistente? (sem ele não há conversa para ver; o botão leva à aba Assistente)
  useEffect(() => {
    let vivo = true;
    setBot('carregando'); setErroBot('');
    supabase.from('wa_loja_bots').select('is_active').eq('tenant_id', tenantId).maybeSingle()
      .then(({ data, error }) => {
        if (!vivo) return;
        if (error) { setErroBot(error.message); setBot('erro'); return; }
        setBot(!data ? 'nenhum' : data.is_active ? 'ligado' : 'desligado');
      });
    return () => { vivo = false; };
  }, [tenantId, tentativaBot]);

  const ler = useCallback(async () => {
    const id = tenantId;
    const { data, error } = await supabase.from('wa_loja_conversas').select(COLUNAS)
      .eq('tenant_id', id).order('last_message_at', { ascending: false }).limit(50);
    if (tenantAtual.current !== id) return; // trocou de loja no meio da leitura
    if (error) setErroLista(error.message);
    else { setErroLista(''); setConversas((data ?? []) as Conversa[]); }
    setCarregando(false);
  }, [tenantId]);

  // Trocou de loja: nada da anterior fica na tela. Depois atualiza a cada 20 s (mensagens novas de clientes) enquanto
  // a aba do navegador está à vista, e na hora em que a pessoa volta para ela.
  useEffect(() => {
    setCarregando(true); setConversas([]); setAbertaId(null); setErroLista(''); setVerEncerradas(false);
  }, [tenantId]);
  useAtualizacao(ler, 20_000, tenantId);

  const aberta = conversas.find((c) => c.id === abertaId) ?? null;
  const { pedemVoce, cuidando, encerradas } = agruparConversas(conversas);

  async function atualizarConversa(c: Conversa, patch: Partial<Conversa>): Promise<boolean> {
    // .select() para saber se gravou: a regra de acesso do banco devolve "sucesso" com 0 linhas quando recusa.
    const { data, error } = await supabase.from('wa_loja_conversas').update(patch)
      .eq('id', c.id).eq('tenant_id', tenantId).select('id');
    if (error || !data?.length) {
      toast.error('Não salvou a mudança', error?.message ?? 'O banco não aceitou a mudança nesta conversa.');
      return false;
    }
    setConversas((l) => l.map((x) => (x.id === c.id ? { ...x, ...patch } : x)));
    return true;
  }

  function respondeu(c: Conversa) {
    // O servidor já pausou o assistente por 2 h e tirou "pede a equipe"; a tela acompanha sem esperar os 20 s.
    const pausa = new Date(Date.now() + 2 * 3_600_000).toISOString();
    setConversas((l) => l.map((x) => (x.id === c.id ? { ...x, bot_paused_until: pausa, needs_human: false, status: 'aberta' } : x)));
    void ler();
  }

  if (bot === 'carregando') {
    return <PaginaDelivery><div className="flex items-center justify-center py-16 text-sm text-zinc-500 gap-2"><i className="ri-loader-4-line animate-spin" />Carregando…</div></PaginaDelivery>;
  }
  if (bot === 'erro') {
    return (
      <PaginaDelivery>
        <div className="bg-red-50 border border-red-200 rounded-2xl px-4 py-3 text-sm text-red-700 max-w-lg">
          Não consegui abrir o atendimento do WhatsApp: {erroBot}
          <div className="mt-2"><button type="button" className={btn('out', 'sm')} onClick={() => setTentativaBot((n) => n + 1)}>Tentar de novo</button></div>
        </div>
      </PaginaDelivery>
    );
  }
  if (bot === 'nenhum') {
    return (
      <PaginaDelivery>
        <Vazio icone="ri-whatsapp-line" titulo="O assistente do WhatsApp ainda não foi criado"
          acao={<button type="button" className={btn('p')} onClick={() => irPara('assistente')}>Criar o assistente</button>}>
          Depois de criado, as conversas de quem chamar a loja no WhatsApp aparecem aqui, com as que pedem a equipe em cima.
        </Vazio>
      </PaginaDelivery>
    );
  }

  const lista = (
    <div className="space-y-4">
      {bot === 'desligado' && (
        <Nota>O assistente está desligado: as mensagens chegam aqui e a equipe responde. Para ligar, vá em WhatsApp › Assistente.</Nota>
      )}
      {erroLista && (
        <div className="bg-red-50 border border-red-200 rounded-2xl px-4 py-2.5 text-xs text-red-700 flex items-center gap-2">
          <span className="flex-1 min-w-0">Não consegui atualizar as conversas: {erroLista}</span>
          <button type="button" className={btn('out', 'sm')} onClick={() => void ler()}>Tentar de novo</button>
        </div>
      )}

      {carregando ? (
        <div className="flex items-center justify-center py-12 text-sm text-zinc-500 gap-2"><i className="ri-loader-4-line animate-spin" />Carregando…</div>
      ) : !conversas.length ? (
        !erroLista && (
          <Vazio icone="ri-chat-3-line" titulo="Nenhuma conversa ainda"
            acao={<button type="button" className={btn('out', 'sm')} onClick={() => irPara('assistente')}>Ver o link para divulgar</button>}>
            Teste mandando o link do assistente para o seu próprio WhatsApp.
          </Vazio>
        )
      ) : (
        <>
          <section>
            <SecaoTitulo titulo="Pedem você" n={pedemVoce.length} tomN={pedemVoce.length ? 'red' : 'zinc'}
              direita={<button type="button" onClick={() => void ler()} className="text-xs font-bold text-zinc-500 hover:text-zinc-800 cursor-pointer"><i className="ri-refresh-line" /> Atualizar</button>} />
            {pedemVoce.length ? (
              <Lista>{pedemVoce.map((c) => <Linha key={c.id} c={c} tom="red" ativa={c.id === abertaId} onAbrir={() => setAbertaId(c.id)} />)}</Lista>
            ) : (
              <p className="text-[13px] text-zinc-500 bg-white border border-zinc-200 rounded-2xl px-4 py-3"><i className="ri-checkbox-circle-line text-emerald-600 mr-1" />Ninguém está pedindo a equipe agora.</p>
            )}
          </section>

          <section>
            <SecaoTitulo titulo="O assistente está cuidando" n={cuidando.length} tomN="zinc" />
            {cuidando.length ? (
              <Lista>{cuidando.map((c) => <Linha key={c.id} c={c} tom="verde" ativa={c.id === abertaId} onAbrir={() => setAbertaId(c.id)} />)}</Lista>
            ) : (
              <p className="text-[13px] text-zinc-500 bg-white border border-zinc-200 rounded-2xl px-4 py-3">Nenhuma conversa em andamento.</p>
            )}
          </section>

          {encerradas.length > 0 && (
            <section>
              <button type="button" onClick={() => setVerEncerradas((v) => !v)} aria-expanded={verEncerradas}
                className="w-full flex items-center gap-2 mb-2 px-0.5 text-left cursor-pointer">
                <h2 className="text-base lg:text-lg font-extrabold text-zinc-900">Encerradas</h2>
                <span className="text-xs font-bold rounded-full px-2 py-0.5 bg-zinc-200 text-zinc-600">{encerradas.length}</span>
                <i className={`${verEncerradas ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'} text-xl text-zinc-400 ml-auto`} />
              </button>
              {verEncerradas && (
                <Lista>{encerradas.map((c) => <Linha key={c.id} c={c} tom="zinc" ativa={c.id === abertaId} onAbrir={() => setAbertaId(c.id)} />)}</Lista>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );

  // Computador: lista à esquerda, conversa à direita. Celular: a conversa abre numa folha.
  if (grande) {
    return (
      <PaginaDelivery>
        <Colunas>
          {lista}
          {aberta ? (
            <ConversaAberta key={aberta.id} conversa={aberta} grande onAtualizar={atualizarConversa} onRespondeu={respondeu} onFechar={() => setAbertaId(null)} />
          ) : (
            <div className="hidden lg:flex flex-col items-center justify-center text-center bg-white border border-dashed border-zinc-300 rounded-2xl px-6 py-16 lg:sticky lg:top-4">
              <i className="ri-chat-smile-3-line text-3xl text-zinc-300" />
              <p className="text-sm font-bold text-zinc-600 mt-2">Toque numa conversa para abrir aqui</p>
              <p className="text-xs text-zinc-400 mt-0.5">Você vê as mensagens e responde como a loja.</p>
            </div>
          )}
        </Colunas>
      </PaginaDelivery>
    );
  }
  return (
    <PaginaDelivery>
      {lista}
      {aberta && (
        <ConversaAberta key={aberta.id} conversa={aberta} grande={false} onAtualizar={atualizarConversa} onRespondeu={respondeu} onFechar={() => setAbertaId(null)} />
      )}
    </PaginaDelivery>
  );
}
