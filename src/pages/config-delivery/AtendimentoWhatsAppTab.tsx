import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { getPublicUrl } from '@/lib/appUrl';
import QrCodeDelivery from './QrCodeDelivery';
import NumeroProprio, { type ConectarMeta } from './NumeroProprio';

// Aba "Atendimento WhatsApp" (Delivery): o assistente responde os clientes da loja pelo WhatsApp
// (API oficial), mostra o cardápio e manda o link do delivery para fechar a venda.
// Edge `atendimento-loja`; tabelas wa_loja_bots / wa_loja_conversas / wa_loja_mensagens (RLS: admin da loja).

function getEdgeUrl(): string {
  const base = (import.meta.env.VITE_PUBLIC_SUPABASE_URL as string || '').replace(/\/$/, '');
  return base + '/functions/v1/atendimento-loja';
}

interface Bot {
  tenant_id: string;
  is_active: boolean;
  code: string;
  phone_id: string | null;
  waba_id: string | null;
  numero_origem: 'erpos' | 'cliente' | null;
  start_text: string | null;
  welcome: string | null;
  extra_info: string | null;
  forbidden: string | null;
  voucher_code: string | null;
  upsell: boolean;
  notify_owner: boolean;
}

interface Conversa {
  id: string;
  contact_phone: string;
  contact_name: string | null;
  via: string;
  status: string;
  is_test: boolean;
  needs_human: boolean;
  bot_paused_until: string | null;
  link_sent_at: string | null;
  cost_usd: number;
  last_message_at: string;
}

interface Mensagem { id: number; role: 'user' | 'assistant' | 'staff'; content: string; created_at: string }

const novoCodigo = () => {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 4; i++) s += abc[Math.floor(Math.random() * abc.length)];
  return 'PD-' + s;
};

const fmtFone = (d: string) => {
  const x = d.startsWith('55') ? d.slice(2) : d;
  if (x.length === 11) return `(${x.slice(0, 2)}) ${x.slice(2, 7)}-${x.slice(7)}`;
  if (x.length === 10) return `(${x.slice(0, 2)}) ${x.slice(2, 6)}-${x.slice(6)}`;
  return d;
};
const quando = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
};
const pausado = (c: Conversa) => !!c.bot_paused_until && new Date(c.bot_paused_until).getTime() > Date.now();

async function chamarEdge(body: Record<string, unknown>) {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData?.session?.access_token;
  const r = await fetch(getEdgeUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (token ?? '') },
    body: JSON.stringify(body),
  });
  const out = await r.json().catch(() => ({}));
  if (!r.ok || out?.success === false) throw new Error(out?.error || ('Erro ' + r.status));
  return out;
}

export default function AtendimentoWhatsAppTab({ tenantId }: { tenantId?: string }) {
  const [bot, setBot] = useState<Bot | null>(null);
  const [slug, setSlug] = useState('');
  const [lojaNome, setLojaNome] = useState('');
  const [conectar, setConectar] = useState<ConectarMeta | null>(null);
  const [proprio, setProprio] = useState<string | null>(null);
  const [numero, setNumero] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [msg, setMsg] = useState<{ tipo: 'sucesso' | 'erro'; texto: string } | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [conversas, setConversas] = useState<Conversa[]>([]);
  const [aberta, setAberta] = useState<Conversa | null>(null);
  const [mensagens, setMensagens] = useState<Mensagem[]>([]);
  const [resposta, setResposta] = useState('');
  const [enviando, setEnviando] = useState(false);

  const carregarConversas = useCallback(async () => {
    if (!tenantId) return;
    const { data } = await supabase.from('wa_loja_conversas')
      .select('id, contact_phone, contact_name, via, status, is_test, needs_human, bot_paused_until, link_sent_at, cost_usd, last_message_at')
      .eq('tenant_id', tenantId).order('last_message_at', { ascending: false }).limit(50);
    setConversas((data ?? []) as Conversa[]);
  }, [tenantId]);

  useEffect(() => {
    if (!tenantId) return;
    let vivo = true;
    setProprio(null); // trocou de loja: não mostra o número próprio da anterior
    (async () => {
      setCarregando(true);
      const [{ data: b }, { data: t }] = await Promise.all([
        supabase.from('wa_loja_bots').select('*').eq('tenant_id', tenantId).maybeSingle(),
        supabase.from('tenants').select('slug, name').eq('id', tenantId).maybeSingle(),
      ]);
      if (!vivo) return;
      setBot((b as Bot | null) ?? null);
      setSlug(String(t?.slug ?? ''));
      setLojaNome(String(t?.name ?? ''));
      setCarregando(false);
      chamarEdge({ action: 'info', tenant_id: tenantId }).then((o) => { if (vivo) { setNumero(o?.number ?? null); setConectar(o?.conectar ?? null); } }).catch(() => {});
      carregarConversas();
    })();
    return () => { vivo = false; };
  }, [tenantId, carregarConversas]);

  // Conversas: atualiza a cada 20 s (novas mensagens de clientes).
  useEffect(() => {
    const t = setInterval(carregarConversas, 20_000);
    return () => clearInterval(t);
  }, [carregarConversas]);

  const carregarMensagens = useCallback(async (c: Conversa) => {
    const { data } = await supabase.from('wa_loja_mensagens').select('id, role, content, created_at')
      .eq('conversa_id', c.id).order('id', { ascending: true }).limit(200);
    setMensagens((data ?? []) as Mensagem[]);
  }, []);
  useEffect(() => {
    if (!aberta) return;
    carregarMensagens(aberta);
    const t = setInterval(() => carregarMensagens(aberta), 8_000);
    return () => clearInterval(t);
  }, [aberta, carregarMensagens]);

  async function ativar() {
    if (!tenantId) return;
    setSalvando(true);
    setMsg(null);
    // Código único: tenta de novo se colidir com o de outra loja.
    for (let i = 0; i < 5; i++) {
      const code = novoCodigo();
      const { data, error } = await supabase.from('wa_loja_bots').insert({
        tenant_id: tenantId, code, is_active: true, start_text: `Oi! Quero ver o cardápio (${code})`,
      }).select('*').single();
      if (!error && data) { setBot(data as Bot); setSalvando(false); setMsg({ tipo: 'sucesso', texto: 'Atendimento criado e ligado.' }); return; }
      if (error && !/duplicate|unique/i.test(error.message)) { setMsg({ tipo: 'erro', texto: error.message }); break; }
    }
    setSalvando(false);
  }

  async function salvar() {
    if (!bot || !tenantId) return;
    setSalvando(true);
    setMsg(null);
    const limpo = (s: string | null) => (s ?? '').trim() || null;
    const startText = limpo(bot.start_text) ?? `Oi! Quero ver o cardápio (${bot.code})`;
    const { error } = await supabase.from('wa_loja_bots').update({
      is_active: bot.is_active,
      // O código precisa estar no texto pronto: é ele que liga a conversa à loja.
      start_text: startText.includes(bot.code) ? startText : `${startText} (${bot.code})`,
      welcome: limpo(bot.welcome),
      extra_info: limpo(bot.extra_info),
      forbidden: limpo(bot.forbidden),
      voucher_code: limpo(bot.voucher_code)?.toUpperCase() ?? null,
      upsell: bot.upsell,
      notify_owner: bot.notify_owner,
      // phone_id/waba_id: só o servidor grava (Número próprio, ações numero_* da edge).
      updated_at: new Date().toISOString(),
    }).eq('tenant_id', tenantId);
    setSalvando(false);
    setMsg(error ? { tipo: 'erro', texto: error.message } : { tipo: 'sucesso', texto: 'Atendimento salvo.' });
  }

  async function atualizarConversa(c: Conversa, patch: Partial<Conversa>) {
    const { error } = await supabase.from('wa_loja_conversas').update(patch).eq('id', c.id);
    if (error) { setMsg({ tipo: 'erro', texto: error.message }); return; }
    const nova = { ...c, ...patch };
    setConversas((l) => l.map((x) => (x.id === c.id ? nova : x)));
    if (aberta?.id === c.id) setAberta(nova);
  }

  async function responder() {
    if (!aberta || !resposta.trim()) return;
    setEnviando(true);
    try {
      await chamarEdge({ action: 'reply', conversa_id: aberta.id, text: resposta.trim() });
      setResposta('');
      const pausa = new Date(Date.now() + 2 * 3_600_000).toISOString();
      setAberta({ ...aberta, bot_paused_until: pausa, needs_human: false });
      await carregarMensagens(aberta);
      carregarConversas();
    } catch (e) {
      const t = e instanceof Error ? e.message : String(e);
      setMsg({ tipo: 'erro', texto: /131047|24/.test(t) ? 'O cliente não escreve há mais de 24 h: o WhatsApp só deixa responder depois que ele mandar uma mensagem.' : t });
    }
    setEnviando(false);
  }

  if (!tenantId) return null;
  if (carregando) return <div className="text-sm text-zinc-400">Carregando…</div>;

  const set = (patch: Partial<Bot>) => setBot((b) => (b ? { ...b, ...patch } : b));
  const startText = bot ? ((bot.start_text ?? '').includes(bot.code) ? bot.start_text! : `Oi! Quero ver o cardápio (${bot.code})`) : '';
  // Com número próprio conectado o link vai direto para ele (lá não precisa do código).
  const numeroLink = proprio ?? numero;
  const linkWa = bot && numeroLink ? `https://wa.me/${numeroLink}?text=${encodeURIComponent(startText)}` : '';
  const linkDelivery = slug ? getPublicUrl(`/${slug}-delivery`) : '';
  const precisa = conversas.filter((c) => c.status === 'aberta' && c.needs_human).length;

  return (
    <div className="max-w-3xl space-y-6">
      {msg ? (
        <div className={'px-4 py-3 rounded-xl text-sm font-medium flex items-center gap-2 ' +
          (msg.tipo === 'sucesso' ? 'bg-green-50 text-green-700 border border-green-100' : 'bg-red-50 text-red-600 border border-red-100')}>
          <i className={msg.tipo === 'sucesso' ? 'ri-checkbox-circle-line' : 'ri-error-warning-line'} />
          {msg.texto}
        </div>
      ) : null}

      <div className="bg-white rounded-2xl border border-zinc-200 p-5 space-y-3">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-xl bg-green-100 text-green-600 flex items-center justify-center flex-shrink-0">
            <i className="ri-whatsapp-line text-lg" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-bold text-zinc-800">Atendimento de clientes no WhatsApp</h3>
            <p className="text-xs text-zinc-500 mt-0.5">
              O assistente responde quem chama, mostra o cardápio, as promoções do dia e a taxa de entrega, e manda o link
              do delivery para a pessoa fazer o pedido. O pedido é sempre feito pelo link (lá a taxa, o estoque e o
              pagamento são conferidos). Reclamação, comprovante ou pedido especial vão para a equipe.
            </p>
          </div>
        </div>
        {!bot ? (
          <button type="button" onClick={ativar} disabled={salvando}
            className="px-4 py-2 rounded-xl bg-green-600 text-white text-sm font-bold hover:bg-green-700 disabled:opacity-50">
            {salvando ? 'Criando…' : 'Ativar atendimento pelo WhatsApp'}
          </button>
        ) : (
          <label className="flex items-center gap-2 text-sm font-semibold text-zinc-700 cursor-pointer">
            <input type="checkbox" checked={bot.is_active} onChange={(e) => set({ is_active: e.target.checked })} className="w-4 h-4 accent-green-600" />
            Assistente respondendo os clientes {bot.is_active ? '' : <span className="text-xs font-normal text-zinc-400">(desligado: as mensagens só aparecem aqui)</span>}
          </label>
        )}
      </div>

      {bot ? (
        <>
          {/* Link para divulgar */}
          <div className="bg-white rounded-2xl border border-zinc-200 p-5 space-y-3">
            <h3 className="text-sm font-bold text-zinc-800">Link do WhatsApp para divulgar</h3>
            <p className="text-xs text-zinc-500">
              Coloque na bio do Instagram, no Google, em anúncios e no QR Code do balcão.{' '}
              {proprio ? 'Ele abre direto no número próprio da loja.' : <>O texto pronto leva o código
              <span className="font-mono font-bold text-zinc-700"> {bot.code}</span>, que liga a conversa a esta loja.</>}
            </p>
            {linkWa ? (
              <>
                <div className="flex items-center gap-2 bg-zinc-50 rounded-xl px-3 py-2">
                  <span className="text-xs text-zinc-700 flex-1 truncate font-mono">{linkWa}</span>
                  <button type="button" className="text-xs font-bold text-amber-600 hover:text-amber-700 flex-shrink-0"
                    onClick={() => navigator.clipboard.writeText(linkWa).then(() => { setCopiado(true); setTimeout(() => setCopiado(false), 2000); })}>
                    {copiado ? 'Copiado!' : 'Copiar'}
                  </button>
                </div>
                <QrCodeDelivery url={linkWa} nomeArquivo={`qrcode-whatsapp-${slug || 'loja'}`} />
              </>
            ) : (
              <p className="text-xs text-amber-600">Não consegui buscar o número do WhatsApp agora. Tente recarregar a página.</p>
            )}
            <label className="block text-xs font-bold text-zinc-600 mt-2">Texto que já vem digitado</label>
            <input value={bot.start_text ?? ''} onChange={(e) => set({ start_text: e.target.value })}
              placeholder={`Oi! Quero ver o cardápio (${bot.code})`}
              className="w-full px-3 py-2 rounded-xl border border-zinc-200 text-sm" />
          </div>

          {/* Como ele atende */}
          <div className="bg-white rounded-2xl border border-zinc-200 p-5 space-y-3">
            <h3 className="text-sm font-bold text-zinc-800">Como o assistente atende</h3>
            <p className="text-xs text-zinc-500">
              Cardápio, preços, promoções de hoje, horário, taxa por bairro/distância, pedido mínimo e retirada ele já lê
              da configuração do delivery{linkDelivery ? <> (<span className="font-mono">{linkDelivery}</span>)</> : null}.
            </p>
            <div>
              <label className="block text-xs font-bold text-zinc-600 mb-1">Primeira resposta (quem chega pelo link)</label>
              <textarea rows={3} value={bot.welcome ?? ''} onChange={(e) => set({ welcome: e.target.value })}
                placeholder="Oi, {nome}! 👋 Aqui é da *{loja}*. Quer ver o cardápio e pedir? É só tocar no link: {link}"
                className="w-full px-3 py-2 rounded-xl border border-zinc-200 text-sm" />
              <p className="text-[11px] text-zinc-400 mt-1">Use {'{nome}'}, {'{loja}'} e {'{link}'}. Em branco = texto padrão.</p>
            </div>
            <div>
              <label className="block text-xs font-bold text-zinc-600 mb-1">O que mais ele pode contar</label>
              <textarea rows={4} value={bot.extra_info ?? ''} onChange={(e) => set({ extra_info: e.target.value })}
                placeholder={'Ex.: Aceitamos Pix, cartão e dinheiro na entrega.\nTempo médio de entrega: 40 a 60 min.\nEndereço para retirada: Rua X, 123.'}
                className="w-full px-3 py-2 rounded-xl border border-zinc-200 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-bold text-zinc-600 mb-1">Assuntos proibidos</label>
              <input value={bot.forbidden ?? ''} onChange={(e) => set({ forbidden: e.target.value })}
                placeholder="Ex.: vagas de emprego, fornecedores, política"
                className="w-full px-3 py-2 rounded-xl border border-zinc-200 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-bold text-zinc-600 mb-1">Cupom para fechar a venda (opcional)</label>
              <input value={bot.voucher_code ?? ''} onChange={(e) => set({ voucher_code: e.target.value })}
                placeholder="Código de um cupom já criado em Vouchers"
                className="w-full px-3 py-2 rounded-xl border border-zinc-200 text-sm font-mono uppercase" />
              <p className="text-[11px] text-zinc-400 mt-1">Ele só oferece quando o cliente hesita pelo preço; o link já abre com o cupom aplicado.</p>
            </div>
            <label className="flex items-center gap-2 text-sm text-zinc-700 cursor-pointer">
              <input type="checkbox" checked={bot.upsell} onChange={(e) => set({ upsell: e.target.checked })} className="w-4 h-4 accent-amber-500" />
              Sugerir complemento (bebida, acompanhamento, sobremesa ou promoção do dia)
            </label>
            <label className="flex items-center gap-2 text-sm text-zinc-700 cursor-pointer">
              <input type="checkbox" checked={bot.notify_owner} onChange={(e) => set({ notify_owner: e.target.checked })} className="w-4 h-4 accent-amber-500" />
              Avisar no assistente (Telegram) quando o cliente pedir atendimento
            </label>
          </div>

          {/* Número próprio: chip novo (conta do ERPOS) ou Conectar pela Meta (conta da loja) */}
          <NumeroProprio tenantId={tenantId} lojaNome={lojaNome} chamar={chamarEdge} conectar={conectar} onMudou={setProprio} />

          <button type="button" onClick={salvar} disabled={salvando}
            className="w-full sm:w-auto px-6 py-2.5 rounded-xl bg-amber-500 text-white text-sm font-bold hover:bg-amber-600 disabled:opacity-50">
            {salvando ? 'Salvando…' : 'Salvar atendimento'}
          </button>

          {/* Conversas */}
          <div className="bg-white rounded-2xl border border-zinc-200 p-5 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-bold text-zinc-800">
                Conversas {precisa ? <span className="ml-1 px-2 py-0.5 rounded-full bg-red-100 text-red-600 text-[11px]">{precisa} pedem atendimento</span> : null}
              </h3>
              <button type="button" onClick={carregarConversas} className="text-xs font-bold text-zinc-500 hover:text-zinc-700">
                <i className="ri-refresh-line" /> Atualizar
              </button>
            </div>
            {!conversas.length ? (
              <p className="text-xs text-zinc-400">Nenhuma conversa ainda. Teste mandando o link para o seu WhatsApp.</p>
            ) : (
              <div className="divide-y divide-zinc-100">
                {conversas.map((c) => (
                  <button key={c.id} type="button" onClick={() => setAberta(c)}
                    className={'w-full text-left py-2.5 px-2 rounded-lg flex items-center gap-3 hover:bg-zinc-50 ' + (aberta?.id === c.id ? 'bg-amber-50' : '')}>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-zinc-800 truncate">
                        {c.contact_name || fmtFone(c.contact_phone)}
                        {c.is_test ? <span className="ml-1 text-[10px] text-violet-600">teste</span> : null}
                      </div>
                      <div className="text-[11px] text-zinc-400">{fmtFone(c.contact_phone)} · {quando(c.last_message_at)}</div>
                    </div>
                    <div className="flex flex-wrap gap-1 justify-end">
                      {c.needs_human && c.status === 'aberta' ? <span className="px-2 py-0.5 rounded-full bg-red-100 text-red-600 text-[10px] font-bold">Chamou a equipe</span> : null}
                      {pausado(c) ? <span className="px-2 py-0.5 rounded-full bg-zinc-100 text-zinc-600 text-[10px] font-bold">Equipe atendendo</span> : null}
                      {c.link_sent_at ? <span className="px-2 py-0.5 rounded-full bg-green-100 text-green-700 text-[10px] font-bold">Recebeu o link</span> : null}
                      {c.status === 'encerrada' ? <span className="px-2 py-0.5 rounded-full bg-zinc-100 text-zinc-400 text-[10px]">Encerrada</span> : null}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {aberta ? (
            <div className="bg-white rounded-2xl border border-zinc-200 p-5 space-y-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div>
                  <h3 className="text-sm font-bold text-zinc-800">{aberta.contact_name || fmtFone(aberta.contact_phone)}</h3>
                  <a href={`https://wa.me/${aberta.contact_phone}`} target="_blank" rel="noreferrer" className="text-[11px] text-green-600 font-semibold">
                    {fmtFone(aberta.contact_phone)}
                  </a>
                </div>
                <div className="flex gap-2 flex-wrap">
                  {pausado(aberta) ? (
                    <button type="button" onClick={() => atualizarConversa(aberta, { bot_paused_until: null })}
                      className="px-3 py-1.5 rounded-lg bg-green-50 text-green-700 text-xs font-bold hover:bg-green-100">Devolver ao assistente</button>
                  ) : (
                    <button type="button" onClick={() => atualizarConversa(aberta, { bot_paused_until: new Date(Date.now() + 2 * 3_600_000).toISOString() })}
                      className="px-3 py-1.5 rounded-lg bg-zinc-100 text-zinc-700 text-xs font-bold hover:bg-zinc-200">Pausar assistente (2 h)</button>
                  )}
                  {aberta.needs_human ? (
                    <button type="button" onClick={() => atualizarConversa(aberta, { needs_human: false })}
                      className="px-3 py-1.5 rounded-lg bg-zinc-100 text-zinc-700 text-xs font-bold hover:bg-zinc-200">Marcar como resolvida</button>
                  ) : null}
                  <button type="button" onClick={() => setAberta(null)} className="px-2 py-1.5 text-zinc-400 hover:text-zinc-600" aria-label="Fechar">
                    <i className="ri-close-line" />
                  </button>
                </div>
              </div>
              <div className="bg-[#efeae2] rounded-xl p-3 max-h-96 overflow-y-auto space-y-2">
                {mensagens.map((mm) => (
                  <div key={mm.id} className={'flex ' + (mm.role === 'user' ? 'justify-start' : 'justify-end')}>
                    <div className={'max-w-[85%] rounded-lg px-3 py-1.5 text-sm whitespace-pre-wrap break-words shadow-sm ' +
                      (mm.role === 'user' ? 'bg-white text-zinc-800' : mm.role === 'staff' ? 'bg-sky-100 text-zinc-800' : 'bg-[#d9fdd3] text-zinc-800')}>
                      {mm.role !== 'user' ? <div className="text-[10px] font-bold text-zinc-500">{mm.role === 'staff' ? 'Equipe' : 'Assistente'}</div> : null}
                      {mm.content}
                      <div className="text-[10px] text-zinc-400 text-right">{quando(mm.created_at)}</div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex gap-2">
                <textarea rows={2} value={resposta} onChange={(e) => setResposta(e.target.value)}
                  placeholder="Responder como a loja (o assistente pausa por 2 h)"
                  className="flex-1 px-3 py-2 rounded-xl border border-zinc-200 text-sm" />
                <button type="button" onClick={responder} disabled={enviando || !resposta.trim()}
                  className="px-4 rounded-xl bg-green-600 text-white text-sm font-bold hover:bg-green-700 disabled:opacity-50">
                  {enviando ? '…' : 'Enviar'}
                </button>
              </div>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
