import { useState, useEffect, useCallback, useRef } from 'react';
import { confirmar } from '@/components/base/Dialogos';

// Número PRÓPRIO da loja no atendimento pelo WhatsApp (2026-09-27): a loja liga o número sem ninguém entrar
// na Meta. Dois jeitos (edge atendimento-loja, ações numero_* e conectar_meta; ver supabase/functions/
// atendimento-loja/numero.ts):
//   • Chip novo: número + nome → código por SMS/ligação → pronto (número na conta do ERPOS).
//   • Conectar o WhatsApp da loja: janela da Meta (Embedded Signup), conta e cobrança da loja. Só aparece
//     quando o ERPOS estiver aprovado como Tech Provider (a edge devolve `conectar` no info).

type Chamar = (body: Record<string, unknown>) => Promise<any>;
interface Situacao {
  numero: string | null; nome: string | null; nome_status: string | null;
  verificado: boolean; conectado: boolean; qualidade: string | null;
}
export interface ConectarMeta { app_id: string; config_id: string }

const fmtFone = (d: string) => {
  const x = d.startsWith('55') ? d.slice(2) : d;
  if (x.length === 11) return `(${x.slice(0, 2)}) ${x.slice(2, 7)}-${x.slice(7)}`;
  if (x.length === 10) return `(${x.slice(0, 2)}) ${x.slice(2, 6)}-${x.slice(6)}`;
  return d;
};
const NOME_STATUS: Record<string, { txt: string; cor: string }> = {
  APPROVED: { txt: 'Nome aprovado pela Meta', cor: 'text-green-700' },
  AVAILABLE_WITHOUT_REVIEW: { txt: 'Nome em uso (a Meta ainda vai revisar)', cor: 'text-green-700' },
  PENDING_REVIEW: { txt: 'Nome em análise pela Meta (costuma levar algumas horas)', cor: 'text-amber-600' },
  DECLINED: { txt: 'Nome recusado pela Meta — desligue e cadastre com outro nome', cor: 'text-red-600' },
};

// SDK do Facebook para a janela "Conectar WhatsApp" (carrega só quando precisa).
declare global { interface Window { FB?: any; fbAsyncInit?: () => void } }
function carregarSdk(appId: string): Promise<any> {
  return new Promise((resolve, reject) => {
    if (window.FB) { resolve(window.FB); return; }
    window.fbAsyncInit = () => {
      window.FB.init({ appId, autoLogAppEvents: true, xfbml: true, version: 'v25.0' });
      resolve(window.FB);
    };
    const s = document.createElement('script');
    s.src = 'https://connect.facebook.net/en_US/sdk.js';
    s.async = true; s.defer = true; s.crossOrigin = 'anonymous';
    s.onerror = () => reject(new Error('Não consegui abrir a janela da Meta (bloqueador de anúncios?)'));
    document.body.appendChild(s);
  });
}

export default function NumeroProprio({ tenantId, lojaNome, chamar, conectar, onMudou }: {
  tenantId: string; lojaNome: string; chamar: Chamar; conectar: ConectarMeta | null;
  onMudou: (numeroConectado: string | null) => void;
}) {
  const [carregando, setCarregando] = useState(true);
  const [origem, setOrigem] = useState<'erpos' | 'cliente' | null>(null);
  const [sit, setSit] = useState<Situacao | null>(null);
  const [numero, setNumero] = useState('');
  const [nome, setNome] = useState(lojaNome);
  const [codigo, setCodigo] = useState('');
  const [pin, setPin] = useState('');
  const [manterApp, setManterApp] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<{ tipo: 'ok' | 'erro'; txt: string } | null>(null);
  const idsMeta = useRef<{ phone_number_id?: string; waba_id?: string; coex?: boolean }>({});

  const atualizar = useCallback(async () => {
    try {
      const o = await chamar({ action: 'numero_status', tenant_id: tenantId });
      setOrigem(o.origem ?? null);
      setSit(o.situacao ?? null);
      onMudou(o.situacao?.conectado ? o.situacao.numero : null);
    } catch (e) { onMudou(null); setAviso({ tipo: 'erro', txt: e instanceof Error ? e.message : String(e) }); }
    setCarregando(false);
  }, [chamar, tenantId, onMudou]);
  useEffect(() => { atualizar(); }, [atualizar]);

  async function acao(body: Record<string, unknown>, ok?: string) {
    setOcupado(true); setAviso(null);
    try {
      await chamar({ tenant_id: tenantId, ...body });
      if (ok) setAviso({ tipo: 'ok', txt: ok });
      await atualizar();
    } catch (e) { setAviso({ tipo: 'erro', txt: e instanceof Error ? e.message : String(e) }); }
    setOcupado(false);
  }

  // Janela da Meta: os ids chegam por postMessage; o código (vale 30 s) no retorno do FB.login.
  useEffect(() => {
    if (!conectar) return;
    const ouvir = (ev: MessageEvent) => {
      if (!String(ev.origin).endsWith('facebook.com')) return;
      try {
        const d = typeof ev.data === 'string' ? JSON.parse(ev.data) : ev.data;
        if (d?.type !== 'WA_EMBEDDED_SIGNUP') return;
        if (String(d.event).startsWith('FINISH')) {
          idsMeta.current = { phone_number_id: d.data?.phone_number_id, waba_id: d.data?.waba_id, coex: d.event === 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING' };
        } else if (d.event === 'CANCEL') {
          setAviso({ tipo: 'erro', txt: 'A conexão com a Meta foi cancelada.' });
        }
      } catch { /* mensagem de outro tipo */ }
    };
    window.addEventListener('message', ouvir);
    return () => window.removeEventListener('message', ouvir);
  }, [conectar]);

  async function conectarMeta() {
    if (!conectar) return;
    setOcupado(true); setAviso(null); idsMeta.current = {};
    try {
      const FB = await carregarSdk(conectar.app_id);
      FB.login((resp: any) => {
        const code = resp?.authResponse?.code;
        if (!code) { setOcupado(false); if (resp?.status !== 'unknown') setAviso({ tipo: 'erro', txt: 'A Meta não autorizou a conexão.' }); return; }
        // O postMessage com os ids chega um pouco antes do retorno; espera até 3 s por ele.
        const inicio = Date.now();
        const tentar = () => {
          const ids = idsMeta.current;
          if (!ids.phone_number_id && Date.now() - inicio < 3000) { setTimeout(tentar, 200); return; }
          chamar({ action: 'conectar_meta', tenant_id: tenantId, code, phone_number_id: ids.phone_number_id, waba_id: ids.waba_id, coexistencia: ids.coex ?? manterApp })
            .then((o) => setAviso(o?.precisa_pin
              ? { tipo: 'erro', txt: 'Conectado, mas o número tem verificação em duas etapas: digite o PIN abaixo.' }
              : { tipo: 'ok', txt: 'WhatsApp da loja conectado. O assistente já responde nesse número.' }))
            .catch((e) => setAviso({ tipo: 'erro', txt: e instanceof Error ? e.message : String(e) }))
            .finally(() => { setOcupado(false); atualizar(); });
        };
        tentar();
      }, {
        config_id: conectar.config_id, response_type: 'code', override_default_response_type: true,
        extras: { setup: {}, ...(manterApp ? { featureType: 'whatsapp_business_app_onboarding' } : {}) },
      });
    } catch (e) { setAviso({ tipo: 'erro', txt: e instanceof Error ? e.message : String(e) }); setOcupado(false); }
  }

  const avisoBox = aviso ? (
    <div className={'px-3 py-2 rounded-xl text-xs font-medium ' + (aviso.tipo === 'ok' ? 'bg-green-50 text-green-700 border border-green-100' : 'bg-red-50 text-red-600 border border-red-100')}>
      {aviso.txt}
    </div>
  ) : null;

  return (
    <div className="bg-white rounded-2xl border border-zinc-200 p-5 space-y-3">
      <h3 className="text-sm font-bold text-zinc-800">Número próprio da loja</h3>
      {carregando ? <p className="text-xs text-zinc-400">Carregando…</p> : sit?.conectado ? (
        // ── Conectado ──
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-green-500" />
            <span className="text-sm font-bold text-zinc-800">{sit.numero ? fmtFone(sit.numero) : 'Número conectado'}</span>
            {sit.nome ? <span className="text-xs text-zinc-500">· {sit.nome}</span> : null}
          </div>
          {sit.nome_status && NOME_STATUS[sit.nome_status] ? <p className={'text-xs ' + NOME_STATUS[sit.nome_status].cor}>{NOME_STATUS[sit.nome_status].txt}</p> : null}
          <p className="text-xs text-zinc-500">
            Tudo o que chegar nesse número é atendido pelo assistente desta loja — o cliente não precisa de link nem de código.
            {origem === 'cliente' ? ' A conta e a cobrança do WhatsApp são da loja (conectada pela Meta).' : ' O número está na conta do ERPOS.'}
          </p>
          {avisoBox}
          <button type="button" disabled={ocupado}
            onClick={async () => {
              if (await confirmar({ titulo: 'Desligar este número do atendimento?', mensagem: 'As mensagens que chegarem nele deixam de ser respondidas.', confirmarLabel: 'Desligar', perigo: true })) acao({ action: 'numero_desligar' }, 'Número desligado.');
            }}
            className="text-xs font-bold text-red-600 hover:text-red-700 disabled:opacity-50">Desligar número</button>
        </div>
      ) : sit ? (
        // ── Cadastrado, falta terminar ──
        origem === 'cliente' ? (
          // Conectado pela Meta, mas o registro pediu o PIN de 2 etapas que a loja já tinha nesse número.
          <div className="space-y-3">
            <p className="text-xs text-zinc-600">
              Falta um passo: esse número tem <b>verificação em duas etapas</b>. Digite o PIN de 6 números dele (o que a
              loja criou no WhatsApp ou no provedor anterior).
            </p>
            <div className="flex gap-2">
              <input value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" placeholder="PIN"
                className="w-32 px-3 py-2 rounded-xl border border-zinc-200 text-sm font-mono tracking-widest" />
              <button type="button" disabled={ocupado || pin.length !== 6}
                onClick={() => acao({ action: 'numero_registrar', pin }, 'Número conectado! O assistente já responde nele.')}
                className="px-4 py-2 rounded-xl bg-green-600 text-white text-sm font-bold hover:bg-green-700 disabled:opacity-50">Conectar</button>
            </div>
            {avisoBox}
            <button type="button" disabled={ocupado} onClick={() => acao({ action: 'numero_desligar' }, 'Conexão cancelada.')} className="text-xs font-bold text-zinc-400 hover:text-zinc-600 disabled:opacity-50">Cancelar</button>
          </div>
        ) : (
        <div className="space-y-3">
          <p className="text-xs text-zinc-600">
            {sit.verificado ? 'O código já foi confirmado, falta conectar o número.' : <>A Meta mandou um código de 6 números para <b>{sit.numero ? fmtFone(sit.numero) : 'o chip'}</b>. Digite aqui:</>}
          </p>
          {!sit.verificado ? (
            <div className="flex gap-2">
              <input value={codigo} onChange={(e) => setCodigo(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" placeholder="000000"
                className="w-32 px-3 py-2 rounded-xl border border-zinc-200 text-sm font-mono tracking-widest" />
              <button type="button" disabled={ocupado || codigo.length !== 6}
                onClick={() => acao({ action: 'numero_confirmar', codigo }, 'Número conectado! O assistente já responde nele.')}
                className="px-4 py-2 rounded-xl bg-green-600 text-white text-sm font-bold hover:bg-green-700 disabled:opacity-50">
                {ocupado ? 'Conferindo…' : 'Confirmar'}
              </button>
            </div>
          ) : (
            <button type="button" disabled={ocupado} onClick={() => acao({ action: 'numero_registrar' }, 'Número conectado!')}
              className="px-4 py-2 rounded-xl bg-green-600 text-white text-sm font-bold hover:bg-green-700 disabled:opacity-50">Conectar número</button>
          )}
          {avisoBox}
          <div className="flex flex-wrap gap-3 text-xs font-bold">
            {!sit.verificado ? <>
              <button type="button" disabled={ocupado} onClick={() => acao({ action: 'numero_codigo', metodo: 'SMS' }, 'Mandei o código de novo por SMS.')} className="text-amber-600 hover:text-amber-700 disabled:opacity-50">Mandar o SMS de novo</button>
              <button type="button" disabled={ocupado} onClick={() => acao({ action: 'numero_codigo', metodo: 'VOICE' }, 'A Meta vai ligar para o chip e falar o código.')} className="text-amber-600 hover:text-amber-700 disabled:opacity-50">Receber por ligação</button>
            </> : null}
            <button type="button" disabled={ocupado} onClick={() => acao({ action: 'numero_desligar' }, 'Cadastro cancelado.')} className="text-zinc-400 hover:text-zinc-600 disabled:opacity-50">Cancelar</button>
          </div>
        </div>
        )
      ) : (
        // ── Sem número: os dois jeitos ──
        <div className="space-y-4">
          <p className="text-xs text-zinc-500">
            Opcional. Com um número só da loja, o cliente salva o contato e chama direto — sem link nem código. Sem ele, o
            atendimento funciona pelo número do sistema com o link acima.
          </p>
          {conectar ? (
            <div className="rounded-xl border border-green-200 bg-green-50/50 p-4 space-y-2">
              <p className="text-sm font-bold text-zinc-800">Conectar o WhatsApp da loja</p>
              <p className="text-xs text-zinc-500">Abre uma janela da Meta: entre com o Facebook da loja e escolha o número. A conta e a cobrança do WhatsApp ficam com a loja.</p>
              <label className="flex items-start gap-2 text-xs text-zinc-700 cursor-pointer">
                <input type="checkbox" checked={manterApp} onChange={(e) => setManterApp(e.target.checked)} className="w-4 h-4 mt-0.5 accent-green-600" />
                <span>Manter o número também no app <b>WhatsApp Business</b> do celular (a equipe continua usando o app; abra o app pelo menos a cada 14 dias). Grupos, mensagens temporárias e listas de transmissão ficam só no celular.</span>
              </label>
              <button type="button" disabled={ocupado} onClick={conectarMeta}
                className="px-4 py-2 rounded-xl bg-green-600 text-white text-sm font-bold hover:bg-green-700 disabled:opacity-50">
                {ocupado ? 'Conectando…' : 'Conectar pela Meta'}
              </button>
            </div>
          ) : null}
          <div className="rounded-xl border border-zinc-200 p-4 space-y-2">
            <p className="text-sm font-bold text-zinc-800">{conectar ? 'Ou cadastrar um chip novo' : 'Cadastrar um chip novo'}</p>
            <p className="text-xs text-zinc-500">
              Use um chip que receba SMS e <b>não tenha WhatsApp</b> (se tiver, apague a conta no app antes). O número fica
              só com o assistente e a equipe responde por esta tela.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-bold text-zinc-600 mb-1">Número do chip</label>
                <input value={numero} onChange={(e) => setNumero(e.target.value)} inputMode="tel" placeholder="(41) 99999-9999"
                  className="w-full px-3 py-2 rounded-xl border border-zinc-200 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-bold text-zinc-600 mb-1">Nome que aparece no WhatsApp</label>
                <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Nome da loja"
                  className="w-full px-3 py-2 rounded-xl border border-zinc-200 text-sm" />
              </div>
            </div>
            <p className="text-[11px] text-zinc-400">O nome passa por revisão da Meta: use o nome da loja como o cliente conhece (sem link nem telefone).</p>
            {avisoBox}
            <button type="button" disabled={ocupado || numero.replace(/\D/g, '').length < 10 || nome.trim().length < 3}
              onClick={() => acao({ action: 'numero_criar', numero, nome }, 'Pronto! A Meta mandou um código por SMS para o chip.')}
              className="px-4 py-2 rounded-xl bg-amber-500 text-white text-sm font-bold hover:bg-amber-600 disabled:opacity-50">
              {ocupado ? 'Cadastrando…' : 'Cadastrar e receber o código'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
