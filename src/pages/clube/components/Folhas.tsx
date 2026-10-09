// Telas cheias (digital, notificações, trava) e folhas (instalar, usar prêmio, indicar,
// aparelhos, sobre) do app do clube.
import { useState, type ReactNode } from 'react';
import { ehIOS, navegadorDeApp, type AparelhoClube, type IndicacaoMinha, type LojaDoClube } from '@/lib/clubeApp';
import type { PremioVisto } from './Telas';
import { Botao, Chave, FUNDO_MARCA, Folha, Icone, Linha, Lista, Logo, brl, dataBR, pts } from './ui';

function Cheia({ children, marca }: { children: ReactNode; marca?: boolean }) {
  return (
    <div className={`min-h-dvh flex flex-col ${marca ? 'text-white' : 'bg-[#FBF7F2] text-zinc-900'}`} style={marca ? { background: FUNDO_MARCA } : undefined}>
      <div className="max-w-md w-full mx-auto flex-1 flex flex-col px-6 pt-[max(64px,calc(env(safe-area-inset-top)+40px))] pb-[max(28px,env(safe-area-inset-bottom))]">{children}</div>
    </div>
  );
}

function Erro({ texto, claro }: { texto: string; claro?: boolean }) {
  return texto ? <p role="alert" className={`text-sm font-semibold text-center mb-3 ${claro ? 'text-white' : 'text-rose-600'}`}>{texto}</p> : null;
}

/** Depois de entrar: oferece ligar a digital neste aparelho. */
export function TelaDigital({ loja, onLigar, onPular }: { loja: LojaDoClube; onLigar: () => Promise<string | null>; onPular: () => void }) {
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState('');
  return (
    <Cheia>
      <div className="w-[86px] h-[86px] rounded-full mx-auto flex items-center justify-center" style={{ background: 'var(--brand-suave)', color: 'var(--brand)' }}>
        <i className="ri-fingerprint-line text-[54px]" />
      </div>
      <h2 className="text-[24px] font-extrabold text-center leading-tight mt-6">Entrar com a digital da próxima vez?</h2>
      <p className="text-[14.5px] text-zinc-600 text-center leading-relaxed mt-3">Abriu o app, encostou o dedo, viu os pontos. Também vale o rosto ou a senha do celular. Usar prêmio pelo celular também pede a digital.</p>
      <div className="mt-6 flex gap-2.5 items-start rounded-[14px] border border-[#DCEBE1] bg-[#F3F7F4] p-3 text-[12.5px] leading-snug text-[#2F5A3E]">
        <i className="ri-shield-check-fill text-lg text-[#2F8A55] leading-none" />
        <span>Sua digital <b>não sai do seu celular</b>. A {loja.nome} recebe só a confirmação de que é você.</span>
      </div>
      <div className="flex-1 min-h-6" />
      <Erro texto={erro} />
      <Botao disabled={ocupado} onClick={async () => { setOcupado(true); setErro(''); const e = await onLigar(); setOcupado(false); if (e) setErro(e); }}>
        <i className="ri-fingerprint-line" />{ocupado ? 'Aguarde…' : 'Usar a digital'}
      </Botao>
      <Botao tipo="fantasma" onClick={onPular} className="mt-1">Agora não</Botao>
    </Cheia>
  );
}

/** Pede as notificações explicando antes (se a pessoa negar a janela do celular, não dá para pedir de novo). */
export function TelaNotificacoes({ loja, onAtivar, onPular }: { loja: LojaDoClube; onAtivar: (p: { pontos: boolean; promocoes: boolean }) => Promise<string | null>; onPular: () => void }) {
  const [pontos, setPontos] = useState(true);
  const [promocoes, setPromocoes] = useState(true);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState('');
  return (
    <Cheia>
      <p className="text-[12px] font-extrabold tracking-[.14em] uppercase text-center" style={{ color: 'var(--brand)' }}>Último passo</p>
      <h2 className="text-[24px] font-extrabold text-center leading-tight mt-1.5">Quer saber quando ganhar um prêmio?</h2>
      <div className="mt-5 bg-white border border-[#EFE7DD] rounded-[20px] p-3 flex gap-3">
        <Logo src={loja.logo} nome={loja.nome} className="w-[38px] h-[38px] rounded-[10px]" />
        <div className="min-w-0">
          <p className="text-[13px] font-bold flex justify-between gap-2"><span>{loja.nome_curto || loja.nome}</span><span className="font-medium text-zinc-400">agora</span></p>
          <p className="text-[13.5px] font-bold">Você ganhou pontos 🎉</p>
          <p className="text-[13px] text-zinc-600">Sua compra somou pontos no clube. Já dá para trocar um prêmio?</p>
        </div>
      </div>
      <Lista className="mt-4">
        <Linha titulo="Meus pontos e prêmios" sub="Ganhou, liberou, vai vencer, aniversário" direita={<Chave ligada={pontos} onChange={setPontos} rotulo="Meus pontos e prêmios" />} />
        <Linha titulo="Promoções da loja" sub="Só de vez em quando. Pode desligar quando quiser." direita={<Chave ligada={promocoes} onChange={setPromocoes} rotulo="Promoções da loja" />} />
      </Lista>
      <div className="flex-1 min-h-6" />
      <Erro texto={erro} />
      <Botao disabled={ocupado} onClick={async () => { setOcupado(true); setErro(''); const e = await onAtivar({ pontos, promocoes }); setOcupado(false); if (e) setErro(e); }}>
        <i className="ri-notification-3-line" />{ocupado ? 'Aguarde…' : 'Ativar notificações'}
      </Botao>
      <Botao tipo="fantasma" onClick={onPular} className="mt-1">Agora não</Botao>
    </Cheia>
  );
}

/** App travado pela digital ("pedir a digital para abrir"). */
export function TelaTrava({ loja, programaNome, nome, onDesbloquear, onOutroJeito }: {
  loja: LojaDoClube; programaNome: string; nome: string | null; onDesbloquear: () => Promise<string | null>; onOutroJeito: () => void;
}) {
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState('');
  const tentar = async () => { setOcupado(true); setErro(''); const e = await onDesbloquear(); setOcupado(false); if (e) setErro(e); };
  return (
    <Cheia marca>
      <div className="flex flex-col items-center text-center mt-10">
        <Logo src={loja.logo} nome={loja.nome} className="w-[104px] h-[104px] rounded-[28px] border-2 border-white/20 shadow-2xl text-4xl" />
        <p className="mt-5 text-[12px] font-extrabold tracking-[.16em] uppercase" style={{ color: 'var(--acc)' }}>{programaNome}</p>
        <p className="text-[26px] font-extrabold mt-1.5">{nome ? `Olá de novo, ${nome}` : 'Olá de novo!'}</p>
      </div>
      <div className="flex-1" />
      <Erro texto={erro} claro />
      <button onClick={() => { void tentar(); }} disabled={ocupado} className="flex flex-col items-center gap-3 cursor-pointer disabled:opacity-60">
        <span className="w-[86px] h-[86px] rounded-full flex items-center justify-center bg-white/10" style={{ color: 'var(--acc)' }}><i className="ri-fingerprint-line text-[54px]" /></span>
        <span className="text-[15px] font-bold">{ocupado ? 'Aguarde…' : 'Toque para entrar com a digital'}</span>
      </button>
      <button onClick={onOutroJeito} className="mt-6 text-[13px] text-white/70 font-semibold cursor-pointer">Entrar com CPF e celular</button>
    </Cheia>
  );
}

/** Convite para instalar: Android com 1 toque, iPhone com o passo a passo. */
export function FolhaInstalar({ aberta, loja, umToque, onInstalar, onFechar, onNaoAgora }: {
  aberta: boolean; loja: LojaDoClube; umToque: boolean; onInstalar: () => void; onFechar: () => void; onNaoAgora: () => void;
}) {
  const ios = ehIOS();
  const deApp = navegadorDeApp();
  return (
    <Folha aberta={aberta} onFechar={onFechar} titulo="Instalar o app">
      <div className="flex gap-3.5 items-center -mt-1">
        <Logo src={loja.logo} nome={loja.nome} className="w-16 h-16 rounded-[17px] shadow-lg text-2xl" />
        <div>
          <p className="text-[18px] font-extrabold leading-tight">Leve o clube no seu celular</p>
          <p className="text-[13px] font-semibold text-zinc-400 mt-0.5">App {loja.nome_curto || loja.nome} · grátis</p>
        </div>
      </div>
      <div className="my-4 space-y-2.5">
        {[['ri-flashlight-fill', 'Seus pontos em 1 toque, sem digitar CPF'], ['ri-notification-3-fill', 'Aviso quando ganhar prêmio'], ['ri-fingerprint-line', 'Entra com a sua digital'], ['ri-download-cloud-2-line', 'Sem loja de apps: instala daqui mesmo']].map(([ic, t]) => (
          <p key={t} className="flex items-center gap-3 text-[14px] font-semibold text-zinc-600"><i className={`${ic} text-[21px]`} style={{ color: 'var(--brand)' }} />{t}</p>
        ))}
      </div>
      {deApp ? (
        <p className="text-[13.5px] bg-amber-50 border border-amber-200 rounded-xl p-3 text-amber-900">Este link abriu dentro de outro app. Toque nos <b>⋯</b> lá em cima e escolha <b>Abrir no navegador</b> {ios ? '(Safari)' : '(Chrome)'} — de lá dá para instalar.</p>
      ) : ios ? (
        <ol className="space-y-2.5">
          {[['Toque em <b>Compartilhar</b>', 'O quadrado com a seta, na barra do Safari.', 'ri-share-box-line'], ['Escolha <b>Adicionar à Tela de Início</b>', 'Role a lista um pouco se não aparecer.', 'ri-add-box-line'], ['Toque em <b>Adicionar</b>', `O ícone do ${loja.nome_curto || loja.nome} aparece junto dos seus apps.`, 'ri-checkbox-circle-line']].map(([t, s, ic], i) => (
            <li key={i} className="flex gap-3 items-center bg-[#FBF7F2] border border-[#EFE7DD] rounded-2xl p-3">
              <span className="w-[30px] h-[30px] rounded-full text-white font-extrabold text-sm flex items-center justify-center shrink-0" style={{ background: 'var(--brand)' }}>{i + 1}</span>
              <div className="flex-1"><p className="text-[14px]" dangerouslySetInnerHTML={{ __html: t }} /><p className="text-[12.5px] text-zinc-400">{s}</p></div>
              <i className={`${ic} text-[24px] text-[#007AFF]`} />
            </li>
          ))}
          <li className="text-[12.5px] text-zinc-500 px-1">No iPhone, as notificações do clube só chegam com o app instalado assim.</li>
        </ol>
      ) : umToque ? (
        <Botao onClick={onInstalar}><i className="ri-install-line" />Instalar o app</Botao>
      ) : (
        <p className="text-[13.5px] text-zinc-600 bg-[#FBF7F2] border border-[#EFE7DD] rounded-xl p-3">No menu do navegador (<b>⋮</b>), toque em <b>Instalar app</b> ou <b>Adicionar à tela inicial</b>.</p>
      )}
      <Botao tipo="fantasma" onClick={onNaoAgora} className="mt-1.5">Agora não</Botao>
    </Folha>
  );
}

/** Usar um prêmio: delivery (reserva, com digital se ligada) ou na loja (CPF, como hoje). */
export function FolhaUsar({ premio, temDelivery, onDelivery, onFechar }: {
  premio: PremioVisto | null; temDelivery: boolean; onDelivery: (p: PremioVisto) => Promise<string | null>; onFechar: () => void;
}) {
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState('');
  if (!premio) return null;
  return (
    <Folha aberta onFechar={() => { setErro(''); onFechar(); }}>
      <div className="flex gap-3 items-center">
        {premio.foto ? <div className="w-[60px] h-[60px] rounded-[14px] bg-center bg-cover shrink-0" style={{ backgroundImage: `url(${premio.foto})` }} /> : <Icone fundo="var(--brand-suave)">🎁</Icone>}
        <div>
          <p className="text-[17px] font-extrabold leading-tight">{premio.nome}</p>
          <p className="text-[13px] font-bold text-emerald-700 mt-0.5">
            {premio.sai != null ? (premio.sai === 0 ? 'Grátis' : `Sai por ${brl(premio.sai)}`) : 'Prêmio'}
            {premio.custo ? ` · ${pts(premio.custo)} pontos` : premio.ate ? ` · até ${dataBR(premio.ate)}` : ''}
          </p>
        </div>
      </div>
      <p className="text-[14px] font-extrabold mt-5 mb-2.5">Onde você vai usar?</p>
      {temDelivery && (
        <>
          <Botao disabled={ocupado} onClick={async () => { setOcupado(true); setErro(''); const e = await onDelivery(premio); setOcupado(false); if (e) setErro(e); }}>
            <i className="ri-e-bike-2-line" />{ocupado ? 'Aguarde…' : 'Pedir no delivery com este prêmio'}
          </Botao>
          {erro && <p role="alert" className="text-sm font-semibold text-rose-600 mt-2">{erro}</p>}
        </>
      )}
      <Lista className="mt-3">
        <Linha icone={<Icone fundo="#FFF4E0"><i className="ri-store-2-line text-amber-700" /></Icone>}
          titulo="Na loja" sub="Diga seu CPF no tablet ou no caixa — o prêmio aparece lá na hora." />
      </Lista>
      <Botao tipo="fantasma" onClick={onFechar} className="mt-2">Fechar</Botao>
    </Folha>
  );
}

/** Indique e ganhe: mostra o link e abre o compartilhar do celular. */
export function FolhaIndicar({ dados, link, lojaNome, programaNome, onFechar }: {
  dados: IndicacaoMinha | null; link: string; lojaNome: string; programaNome: string; onFechar: () => void;
}) {
  const [copiado, setCopiado] = useState(false);
  if (!dados) return null;
  const texto = `Entra no ${programaNome} da ${lojaNome} pelo meu link${dados.bonus_indicado > 0 ? ` e ganha ${pts(dados.bonus_indicado)} pontos na 1ª compra` : ''}: ${link}`;
  const compartilhar = async () => {
    if (navigator.share) {
      try { await navigator.share({ title: programaNome, text: texto }); return; } catch { /* cancelou */ }
    }
    window.open(`https://wa.me/?text=${encodeURIComponent(texto)}`, '_blank', 'noopener');
  };
  return (
    <Folha aberta onFechar={onFechar} titulo="Indique e ganhe">
      <p className="text-[14.5px] text-zinc-600 leading-relaxed">Você ganha <b className="text-zinc-900">{dados.premio}</b> quando um amigo entrar no clube pelo seu link e fizer a primeira compra.{dados.bonus_indicado > 0 && <> Ele ganha <b className="text-zinc-900">{pts(dados.bonus_indicado)} pontos</b> também.</>}</p>
      <div className="mt-4 rounded-2xl border-2 border-dashed p-3 text-center" style={{ borderColor: 'var(--brand)' }}>
        <p className="text-[11px] font-extrabold tracking-[.14em] uppercase text-zinc-400">Seu código</p>
        <p className="text-[28px] font-extrabold tracking-[.2em]" style={{ color: 'var(--brand)' }}>{dados.codigo}</p>
      </div>
      <div className="mt-4 flex gap-2">
        <Botao onClick={() => { void compartilhar(); }}><i className="ri-share-forward-line" />Convidar amigos</Botao>
        <button onClick={async () => { try { await navigator.clipboard.writeText(link); setCopiado(true); } catch { /* sem clipboard */ } }}
          className="h-[52px] px-4 rounded-2xl bg-white border border-[#EFE7DD] font-bold text-sm whitespace-nowrap cursor-pointer">{copiado ? 'Copiado ✓' : 'Copiar'}</button>
      </div>
      <Lista className="mt-4">
        <Linha titulo="Amigos que entraram pelo seu link" direita={<b>{dados.indicados}</b>} />
        <Linha titulo="Já compraram (você ganhou)" direita={<b className="text-emerald-700">{dados.premiadas}</b>} />
        <Linha titulo="Esperando a 1ª compra" direita={<b>{dados.aguardando}</b>} />
      </Lista>
      {dados.limite_mes > 0 && <p className="text-[12px] text-zinc-400 mt-3">Vale até {dados.limite_mes} {dados.limite_mes > 1 ? 'indicações premiadas' : 'indicação premiada'} por mês.</p>}
    </Folha>
  );
}

export function FolhaAparelhos({ aparelhos, onSair, onSairTodos, onFechar }: {
  aparelhos: AparelhoClube[] | null; onSair: (id: string) => Promise<void>; onSairTodos: () => Promise<void>; onFechar: () => void;
}) {
  const [ocupado, setOcupado] = useState<string | null>(null);
  if (!aparelhos) return null;
  const outros = aparelhos.filter((a) => !a.atual);
  return (
    <Folha aberta onFechar={onFechar} titulo="Aparelhos conectados">
      <Lista>
        {aparelhos.map((a) => (
          <Linha key={a.id}
            icone={<Icone><i className={`${/iPhone|iPad/.test(a.nome ?? '') ? 'ri-apple-line' : /Windows|Mac/.test(a.nome ?? '') ? 'ri-computer-line' : 'ri-smartphone-line'} text-slate-600`} /></Icone>}
            titulo={a.atual ? 'Este celular' : (a.nome || (a.via === 'qr_tablet' ? 'Entrou pelo QR do tablet' : 'Navegador'))}
            sub={`${a.atual && a.nome ? `${a.nome} · ` : ''}${a.digital ? 'com digital · ' : ''}desde ${dataBR(a.desde)} · usado ${dataBR(a.visto)}`}
            direita={a.atual ? undefined : (
              <button disabled={!!ocupado} onClick={async () => { setOcupado(a.id); await onSair(a.id); setOcupado(null); }}
                className="h-8 px-3 rounded-full border border-[#EFE7DD] text-[12.5px] font-bold text-rose-600 cursor-pointer disabled:opacity-50">{ocupado === a.id ? '…' : 'Desconectar'}</button>
            )} />
        ))}
      </Lista>
      <p className="text-[12.5px] text-zinc-400 text-center mt-3">Quando um aparelho novo entra, os outros recebem um aviso.</p>
      {outros.length > 0 && (
        <Botao tipo="branco" disabled={!!ocupado} onClick={async () => { setOcupado('todos'); await onSairTodos(); setOcupado(null); }} className="mt-3 !h-12 !text-sm !text-rose-600">
          Desconectar todos os outros
        </Botao>
      )}
      <Botao tipo="fantasma" onClick={onFechar} className="mt-1">Fechar</Botao>
    </Folha>
  );
}

/** Sobre o app — o único lugar com o nome ERPOS (discreto, no rodapé). */
export function FolhaSobre({ aberta, loja, programaNome, onFechar }: { aberta: boolean; loja: LojaDoClube; programaNome: string; onFechar: () => void }) {
  return (
    <Folha aberta={aberta} onFechar={onFechar}>
      <div className="text-center pt-2">
        <Logo src={loja.logo} nome={loja.nome} className="w-24 h-24 rounded-[26px] mx-auto shadow-lg text-3xl" />
        <p className="text-[21px] font-extrabold mt-3.5">{loja.nome}</p>
        <p className="text-[13px] font-semibold text-zinc-400">{programaNome}</p>
      </div>
      <p className="text-[13px] text-zinc-500 text-center leading-relaxed mt-5 px-2">Seus dados ficam com a {loja.nome} e servem só para o clube. Para tirar dúvidas, trocar o celular ou sair do clube, fale com a loja.</p>
      <div className="text-center mt-10 mb-2">
        <span className="inline-flex items-center gap-1.5 text-[12px] font-bold text-zinc-400">
          <span className="w-5 h-5 rounded-md bg-gradient-to-br from-amber-500 to-amber-600 text-white text-[11px] font-extrabold flex items-center justify-center">E</span>
          Feito com ERPOS
        </span>
      </div>
    </Folha>
  );
}
