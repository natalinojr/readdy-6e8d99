import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/contexts/ToastContext';
import { useDeliveryTela } from '../DeliveryTela';
import NumeroProprio, { type ConectarMeta } from '../NumeroProprio';
import QrCodeDelivery from '../QrCodeDelivery';
import { btn, CaixaCopiar, Cartao, Colunas, LinhaInterruptor, Manchete, Nota, PaginaDelivery, SecaoTitulo } from '../ui';
import { chamarEdge } from './whatsapp/edge';
import type { Bot } from './whatsapp/tipos';
import useTelaGrande from './whatsapp/useTelaGrande';
import { assistenteMudou, camposAssistente, novoCodigo, textoInicialFinal } from './whatsapp/util';

// WhatsApp › Assistente: o assistente responde os clientes da loja pelo WhatsApp (API oficial), mostra o
// cardápio e manda o link do delivery para fechar a venda. Esta aba grava na tabela wa_loja_bots (não no
// delivery_config da página), então tem o próprio "Salvar assistente". Edge `atendimento-loja`.
// Ordem: ligar/desligar → link para divulgar → como ele responde → número próprio.
// Só o dono chega aqui (o banco só deixa o dono ler wa_loja_*; a página esconde a aba dos outros).

// A página desmonta a aba ao trocar de aba; sem isto, o que foi digitado e não salvo se perdia em silêncio.
// Guarda o rascunho (um só, o da loja em edição) e devolve quando a aba reabre.
let rascunhoGuardado: Bot | null = null;

const CAMPO = 'w-full px-3 py-2.5 rounded-xl border border-zinc-200 bg-white text-sm outline-none focus:border-amber-400';
const ROTULO = 'block text-xs font-bold text-zinc-600 mb-1';

export default function AssistenteAba() {
  const { tenantId, slug, nomeLoja, linkDelivery, marcarPendenciaExtra, barraSalvarAberta } = useDeliveryTela();
  const toast = useToast();
  const grande = useTelaGrande();

  const [carregando, setCarregando] = useState(true);
  const [erroCarga, setErroCarga] = useState('');
  const [tentativa, setTentativa] = useState(0);
  const [salvo, setSalvo] = useState<Bot | null>(null); // como está no banco
  const [bot, setBot] = useState<Bot | null>(null); // o que está na tela
  const [criando, setCriando] = useState(false);
  const [salvando, setSalvando] = useState(false);

  const [numero, setNumero] = useState<string | null>(null); // número do WhatsApp do sistema
  const [conectar, setConectar] = useState<ConectarMeta | null>(null);
  const [proprio, setProprio] = useState<string | null>(null); // número próprio conectado
  const [infoPronta, setInfoPronta] = useState(false);
  const [erroNumero, setErroNumero] = useState('');
  const [tentativaInfo, setTentativaInfo] = useState(0);

  // Carrega o assistente da loja.
  useEffect(() => {
    let vivo = true;
    setCarregando(true); setErroCarga(''); setBot(null); setSalvo(null);
    supabase.from('wa_loja_bots').select('*').eq('tenant_id', tenantId).maybeSingle()
      .then(({ data, error }) => {
        if (!vivo) return;
        if (error) { setErroCarga(error.message); setCarregando(false); return; }
        const b = (data as Bot | null) ?? null;
        const g = rascunhoGuardado && rascunhoGuardado.tenant_id === tenantId ? rascunhoGuardado : null;
        setSalvo(b);
        setBot(b && g ? {
          ...b, is_active: g.is_active, start_text: g.start_text, welcome: g.welcome, extra_info: g.extra_info,
          forbidden: g.forbidden, voucher_code: g.voucher_code, upsell: g.upsell, notify_owner: g.notify_owner,
        } : b);
        setCarregando(false);
      });
    return () => { vivo = false; };
  }, [tenantId, tentativa]);

  // Número do WhatsApp do sistema e se dá para conectar pela Meta.
  useEffect(() => {
    let vivo = true;
    setNumero(null); setConectar(null); setErroNumero(''); setInfoPronta(false);
    chamarEdge({ action: 'info', tenant_id: tenantId })
      .then((o) => { if (vivo) { setNumero(o?.number ?? null); setConectar(o?.conectar ?? null); } })
      .catch((e) => { if (vivo) setErroNumero(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (vivo) setInfoPronta(true); });
    return () => { vivo = false; };
  }, [tenantId, tentativaInfo]);
  useEffect(() => { setProprio(null); }, [tenantId]); // trocou de loja: não mostra o número próprio da anterior

  const mudou = assistenteMudou(bot, salvo);
  useEffect(() => {
    if (!bot || !salvo) return;
    rascunhoGuardado = mudou ? bot : null;
  }, [bot, salvo, mudou]);
  // Avisa a página: o "Sair sem salvar?" e o aviso do navegador ao fechar a aba contam o rascunho do Assistente
  // (ele tem o próprio "Salvar assistente"; a barra da página é só da configuração do delivery). Enquanto relê,
  // fica o que a página já sabe (o rascunho guardado volta junto com a leitura).
  useEffect(() => {
    if (carregando) return;
    marcarPendenciaExtra('assistente', mudou ? 1 : 0);
  }, [carregando, mudou, marcarPendenciaExtra]);

  const set = (patch: Partial<Bot>) => setBot((b) => (b ? { ...b, ...patch } : b));

  async function ativar() {
    setCriando(true);
    try {
      // Código único: tenta de novo se colidir com o de outra loja.
      for (let i = 0; i < 5; i++) {
        const code = novoCodigo();
        const { data, error } = await supabase.from('wa_loja_bots').insert({
          tenant_id: tenantId, code, is_active: true, start_text: `Oi! Quero ver o cardápio (${code})`,
        }).select('*').single();
        if (!error && data) {
          setSalvo(data as Bot); setBot(data as Bot);
          toast.success('Atendimento criado e ligado', 'Agora escolha como ele responde e divulgue o link.');
          return;
        }
        if (error && !/duplicate|unique/i.test(error.message)) { toast.error('Não criou o atendimento', error.message); return; }
      }
      // Cinco códigos repetidos: pode ser que o assistente já exista (criado em outra tela). Confere de novo.
      toast.error('Não criou o atendimento', 'Não consegui um código livre. Tente de novo.');
      setTentativa((n) => n + 1);
    } finally {
      setCriando(false);
    }
  }

  async function salvar() {
    if (!bot || !salvo) return;
    setSalvando(true);
    try {
      // phone_id/waba_id: só o servidor grava (Número próprio, ações numero_* da edge).
      const { data, error } = await supabase.from('wa_loja_bots')
        .update({ ...camposAssistente(bot), updated_at: new Date().toISOString() })
        .eq('tenant_id', tenantId).select('*').maybeSingle();
      if (error) { toast.error('Não salvou o assistente', error.message); return; }
      if (!data) { toast.error('Não salvou o assistente', 'O banco não aceitou a mudança. Só o Administrador da loja pode mudar o assistente.'); return; }
      setSalvo(data as Bot); setBot(data as Bot);
      toast.success('Assistente salvo', 'Vale para as próximas conversas.');
    } finally {
      setSalvando(false);
    }
  }

  if (carregando) {
    return <PaginaDelivery><div className="flex items-center justify-center py-16 text-sm text-zinc-500 gap-2"><i className="ri-loader-4-line animate-spin" />Carregando…</div></PaginaDelivery>;
  }
  if (erroCarga) {
    return (
      <PaginaDelivery>
        <div className="bg-red-50 border border-red-200 rounded-2xl px-4 py-3 text-sm text-red-700 max-w-lg">
          Não consegui abrir o assistente do WhatsApp: {erroCarga}
          <div className="mt-2"><button type="button" className={btn('out', 'sm')} onClick={() => setTentativa((n) => n + 1)}>Tentar de novo</button></div>
        </div>
      </PaginaDelivery>
    );
  }

  const manchete = (
    <Manchete titulo="O assistente atende no WhatsApp">
      Responde quem chama, mostra o cardápio, as promoções do dia e a taxa de entrega, e manda o link do delivery para a pessoa pedir.
      O pedido é sempre feito pelo link: lá a taxa, o estoque e o pagamento são conferidos. Reclamação, comprovante e pedido
      especial vão para a equipe.
    </Manchete>
  );

  // Ainda não existe assistente nesta loja.
  if (!bot) {
    return (
      <PaginaDelivery>
        {manchete}
        <div>
          <button type="button" onClick={() => void ativar()} disabled={criando} className={btn('wa')}>
            {criando ? <><i className="ri-loader-4-line animate-spin" />Criando…</> : <><i className="ri-whatsapp-line" />Ativar atendimento pelo WhatsApp</>}
          </button>
        </div>
        <Nota>Depois de ligar, você escolhe como ele responde e pega o link e o QR Code para divulgar.</Nota>
      </PaginaDelivery>
    );
  }

  // Com número próprio conectado o link vai direto para ele (lá não precisa do código).
  const numeroLink = proprio ?? numero;
  const linkWa = numeroLink ? `https://wa.me/${numeroLink}?text=${encodeURIComponent(textoInicialFinal(bot))}` : '';
  // A barra "Salvar" da página (configuração do delivery) ocupa o pé da tela quando aparece: a do assistente sobe acima dela.
  const barraDaPagina = barraSalvarAberta;

  const ligar = (
    <Cartao>
      <LinhaInterruptor titulo="Assistente respondendo" ligado={bot.is_active} onChange={(v) => set({ is_active: v })}
        texto={bot.is_active ? 'Ligado: responde quem chamar a loja no WhatsApp' : 'Desligado: as mensagens só aparecem em Conversas'} />
    </Cartao>
  );

  const link = (
    <section>
      <SecaoTitulo titulo="Link para divulgar" />
      <Cartao className="space-y-3">
        <p className="text-xs text-zinc-500 leading-snug">
          Coloque na bio do Instagram, no Google, em anúncios e no QR Code do balcão.{' '}
          {proprio
            ? 'Ele abre direto no número próprio da loja.'
            : <>O código <span className="font-mono font-bold text-zinc-700">{bot.code}</span> no texto pronto liga a conversa a esta loja.</>}
        </p>
        {linkWa ? (
          <>
            <CaixaCopiar texto={linkWa} destaque />
            <QrCodeDelivery url={linkWa} nomeArquivo={`qrcode-whatsapp-${slug || 'loja'}`} titulo="QR do WhatsApp" texto="Quem aponta a câmera cai na conversa com o assistente. Bom para o balcão e a embalagem." />
          </>
        ) : !infoPronta ? (
          <p className="text-xs text-zinc-400"><i className="ri-loader-4-line animate-spin mr-1" />Buscando o número do WhatsApp…</p>
        ) : (
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5 text-xs text-amber-800 flex items-center gap-2">
            <span className="flex-1 min-w-0">
              Não consegui buscar o número do WhatsApp{erroNumero ? `: ${erroNumero}` : '.'}
            </span>
            <button type="button" className={btn('out', 'sm')} onClick={() => setTentativaInfo((n) => n + 1)}>Tentar de novo</button>
          </div>
        )}
        <div>
          <label className={ROTULO} htmlFor="wa-start-text">Texto que já vem digitado</label>
          <input id="wa-start-text" value={bot.start_text ?? ''} onChange={(e) => set({ start_text: e.target.value })}
            placeholder={`Oi! Quero ver o cardápio (${bot.code})`} className={CAMPO} />
        </div>
      </Cartao>
    </section>
  );

  const como = (
    <section>
      <SecaoTitulo titulo="Como ele responde" />
      <Cartao className="space-y-3.5">
        <p className="text-xs text-zinc-500 leading-snug">
          Cardápio, preços, promoções de hoje, horário, taxa, pedido mínimo e retirada ele já lê da configuração do seu delivery
          {slug ? <> (<span className="font-mono break-all">{linkDelivery}</span>)</> : null}.
        </p>
        <div>
          <label className={ROTULO} htmlFor="wa-welcome">Primeira resposta (quem chega pelo link)</label>
          <textarea id="wa-welcome" rows={3} value={bot.welcome ?? ''} onChange={(e) => set({ welcome: e.target.value })}
            placeholder={`Oi, {nome}! 👋 Aqui é da *{loja}*. Quer ver o cardápio e pedir? É só tocar no link: {link}`}
            className={CAMPO} />
          <p className="text-[11px] text-zinc-400 mt-1">Use {'{nome}'}, {'{loja}'} e {'{link}'}. Em branco = texto padrão.</p>
        </div>
        <div>
          <label className={ROTULO} htmlFor="wa-extra">O que mais ele pode contar</label>
          <textarea id="wa-extra" rows={4} value={bot.extra_info ?? ''} onChange={(e) => set({ extra_info: e.target.value })}
            placeholder={'Ex.: Aceitamos Pix, cartão e dinheiro na entrega.\nTempo médio de entrega: 40 a 60 min.\nEndereço para retirada: Rua X, 123.'}
            className={CAMPO} />
        </div>
        <div>
          <label className={ROTULO} htmlFor="wa-forbidden">Assuntos proibidos</label>
          <input id="wa-forbidden" value={bot.forbidden ?? ''} onChange={(e) => set({ forbidden: e.target.value })}
            placeholder="Ex.: vagas de emprego, fornecedores, política" className={CAMPO} />
        </div>
        <div>
          <label className={ROTULO} htmlFor="wa-voucher">Cupom para quem hesita no preço (opcional)</label>
          <input id="wa-voucher" value={bot.voucher_code ?? ''} onChange={(e) => set({ voucher_code: e.target.value.toUpperCase() })}
            placeholder="Código de um cupom já criado em Vouchers" className={`${CAMPO} font-mono`} />
          <p className="text-[11px] text-zinc-400 mt-1">Ele só oferece quando o cliente hesita pelo preço; o link já abre com o cupom aplicado.</p>
        </div>
        <div className="border-t border-zinc-100 pt-3 space-y-3">
          <LinhaInterruptor titulo="Sugerir bebida ou sobremesa" texto="Complemento, acompanhamento ou promoção do dia"
            ligado={bot.upsell} onChange={(v) => set({ upsell: v })} />
          <LinhaInterruptor titulo="Me avisar quando pedirem a equipe" texto="O aviso chega no seu assistente (Telegram)"
            ligado={bot.notify_owner} onChange={(v) => set({ notify_owner: v })} />
        </div>
      </Cartao>
    </section>
  );

  // Número próprio: chip novo (conta do ERPOS) ou Conectar pela Meta (conta da loja).
  const numeroProprio = infoPronta ? (
    <NumeroProprio tenantId={tenantId} lojaNome={nomeLoja} chamar={chamarEdge} conectar={conectar} onMudou={setProprio} />
  ) : (
    <Cartao><p className="text-xs text-zinc-400"><i className="ri-loader-4-line animate-spin mr-1" />Carregando o número próprio…</p></Cartao>
  );

  return (
    <PaginaDelivery>
      {manchete}
      {/* Celular: ligar → link → como responde → número próprio. Computador: duas colunas. */}
      {grande ? (
        <Colunas>
          <div className="space-y-4">{ligar}{link}{numeroProprio}</div>
          <div>{como}</div>
        </Colunas>
      ) : (
        <div className="space-y-4">{ligar}{link}{como}{numeroProprio}</div>
      )}

      {mudou && (
        <div className={`sticky z-20 ${barraDaPagina ? 'bottom-[76px]' : 'bottom-3'}`}>
          <div className="flex items-center gap-2 rounded-2xl pl-4 pr-2 py-2 shadow-xl text-white bg-zinc-900 md:max-w-[560px] md:mx-auto">
            <p className="flex-1 min-w-0 text-[13px] font-bold leading-tight">Mudanças não salvas no assistente</p>
            <button type="button" onClick={() => setBot(salvo)} disabled={salvando}
              className="h-9 px-3 rounded-xl text-[12.5px] font-bold text-amber-300 hover:bg-white/10 cursor-pointer disabled:opacity-50">Desfazer</button>
            <button type="button" onClick={() => void salvar()} disabled={salvando} className={btn('p', 'sm')}>
              {salvando ? <><i className="ri-loader-4-line animate-spin" />Salvando…</> : 'Salvar assistente'}
            </button>
          </div>
        </div>
      )}
    </PaginaDelivery>
  );
}
